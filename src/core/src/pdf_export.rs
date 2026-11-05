//! PDF-Export: eine Seite in Dokumentgröße, Pfade als Vektoren, Verläufe als Shading, Bilder als
//! XObject mit Alpha-Maske. Farben: RGB-Modus je Modell (rg/k/g), CMYK-Modus alles k über das
//! Dokumentprofil (auch Bilder); Sonderfarben als Separation mit Ersatzwert. Druckfertig: pdf_print.
use crate::color::{Cms, ColorMode};
use crate::pdf_print::{self, Meta, Print};
use crate::scene::{
    apply, leaves, segments, Cap, Color, ColorModel, Fill, Gradient, GradientKind, Item, Join, Mat,
    Point, Scene, Seg, Subpath,
};
use crate::Images;
use miniz_oxide::deflate::compress_to_vec_zlib;
use pdf_writer::types::{ColorSpaceOperand, FunctionShadingType, LineCapStyle, LineJoinStyle};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use std::collections::BTreeMap;

const PT: f64 = 72.0 / 25.4; // pt je mm

pub(crate) struct Ids(i32);

impl Ids {
    pub(crate) fn next(&mut self) -> Ref {
        self.0 += 1;
        Ref::new(self.0)
    }
}

/// Farbe im Ausgaberaum der PDF.
#[derive(Clone, Copy)]
enum Device {
    Rgb([f32; 3]),
    Cmyk([f32; 4]),
    Gray(f32),
}

/// Umrechnung für die Ausgabe; `cmyk` = alles DeviceCMYK (CMYK-Modus oder druckfertig).
struct Out<'a> {
    cms: &'a Cms,
    cmyk: bool,
}

impl Out<'_> {
    fn device(&self, c: &Color) -> Device {
        let f = |v: f64| v.clamp(0.0, 1.0) as f32;
        if self.cmyk {
            return Device::Cmyk(self.cms.cmyk(c).map(f));
        }
        match c.model {
            ColorModel::Rgb => Device::Rgb(self.cms.srgb(c).map(f)),
            ColorModel::Cmyk => Device::Cmyk(self.cms.cmyk(c).map(f)),
            ColorModel::Gray => Device::Gray(f(c.values[0])),
        }
    }
}

/// Separation-Farbräume je Sonderfarbname, Ressourcen Cs1, Cs2, …; der Ersatzwert der ersten Verwendung gilt.
struct Spots(Vec<(String, Ref)>);

impl Spots {
    fn resource(&mut self, pdf: &mut Pdf, ids: &mut Ids, name: &str, alt: Device) -> String {
        let i = self
            .0
            .iter()
            .position(|(n, _)| n == name)
            .unwrap_or_else(|| {
                let id = ids.next();
                // Farbton 0 = keine Farbe, 1 = voller Ersatzwert.
                let (c0, c1) = match alt {
                    Device::Rgb(v) => (vec![1.0; 3], v.to_vec()),
                    Device::Cmyk(v) => (vec![0.0; 4], v.to_vec()),
                    Device::Gray(v) => (vec![1.0], vec![v]),
                };
                let mut sep = pdf.color_space(id).separation(Name(name.as_bytes()));
                let space = sep.alternate_color_space();
                match alt {
                    Device::Rgb(_) => space.device_rgb(),
                    Device::Cmyk(_) => space.device_cmyk(),
                    Device::Gray(_) => space.device_gray(),
                }
                sep.tint_exponential()
                    .domain([0.0, 1.0])
                    .c0(c0)
                    .c1(c1)
                    .n(1.0);
                self.0.push((name.to_string(), id));
                self.0.len() - 1
            });
        format!("Cs{}", i + 1)
    }
}

fn set_color(
    c: &mut Content,
    col: &Color,
    out: &Out,
    pdf: &mut Pdf,
    ids: &mut Ids,
    spots: &mut Spots,
    stroke: bool,
) {
    let dev = out.device(col);
    if let Some(name) = &col.spot {
        let res = spots.resource(pdf, ids, name, dev);
        let space = ColorSpaceOperand::Named(Name(res.as_bytes()));
        if stroke {
            c.set_stroke_color_space(space).set_stroke_color([1.0]);
        } else {
            c.set_fill_color_space(space).set_fill_color([1.0]);
        }
        return;
    }
    match (dev, stroke) {
        (Device::Rgb([r, g, b]), false) => c.set_fill_rgb(r, g, b),
        (Device::Rgb([r, g, b]), true) => c.set_stroke_rgb(r, g, b),
        (Device::Cmyk([cy, m, y, k]), false) => c.set_fill_cmyk(cy, m, y, k),
        (Device::Cmyk([cy, m, y, k]), true) => c.set_stroke_cmyk(cy, m, y, k),
        (Device::Gray(v), false) => c.set_fill_gray(v),
        (Device::Gray(v), true) => c.set_stroke_gray(v),
    };
}

fn mat(m: &Mat) -> [f32; 6] {
    m.map(|v| v as f32)
}

fn path(c: &mut Content, m: &Mat, subpaths: &[Subpath]) {
    let p = |q: Point| {
        let w = apply(m, q);
        (w.x as f32, w.y as f32)
    };
    for sp in subpaths {
        let Some(first) = sp.nodes.first() else {
            continue;
        };
        let (x, y) = p(Point {
            x: first.x,
            y: first.y,
        });
        c.move_to(x, y);
        for s in segments(sp) {
            match s {
                Seg::Line(e) => {
                    let (x, y) = p(e);
                    c.line_to(x, y);
                }
                Seg::Cubic(a, b, e) => {
                    let (a, b, e) = (p(a), p(b), p(e));
                    c.cubic_to(a.0, a.1, b.0, b.1, e.0, e.1);
                }
            }
        }
        if sp.closed {
            c.close_path();
        }
    }
}

/// Shading in Objekt-Koordinaten; None bei entartetem Verlauf (Länge/Radius 0).
/// CMYK-Modus oder ein CMYK-Stopp → DeviceCMYK, sonst DeviceRGB. Sonderfarben zählen mit ihrem Ersatzwert.
fn shading(pdf: &mut Pdf, ids: &mut Ids, g: &Gradient, out: &Out) -> Option<Ref> {
    let len = (g.to.x - g.from.x).hypot(g.to.y - g.from.y);
    if len < 1e-9 || g.stops.is_empty() {
        return None;
    }
    // Stopps auf 0..1 auffüllen: vor dem ersten / nach dem letzten Stopp gilt dessen Farbe.
    let cms = out.cms;
    let cmyk = out.cmyk || g.stops.iter().any(|s| s.color.model == ColorModel::Cmyk);
    let f = |v: &f64| v.clamp(0.0, 1.0) as f32;
    let color = |c: &Color| -> Vec<f32> {
        if cmyk {
            cms.cmyk(c).iter().map(f).collect()
        } else {
            cms.srgb(c).iter().map(f).collect()
        }
    };
    let mut stops: Vec<(f32, Vec<f32>)> = g
        .stops
        .iter()
        .map(|s| (s.offset.clamp(0.0, 1.0) as f32, color(&s.color)))
        .collect();
    if stops[0].0 > 0.0 {
        stops.insert(0, (0.0, stops[0].1.clone()));
    }
    let last = stops[stops.len() - 1].clone();
    if last.0 < 1.0 {
        stops.push((1.0, last.1));
    }
    let mut parts = Vec::new();
    for w in stops.windows(2) {
        let id = ids.next();
        pdf.exponential_function(id)
            .domain([0.0, 1.0])
            .c0(w[0].1.iter().copied())
            .c1(w[1].1.iter().copied())
            .n(1.0);
        parts.push(id);
    }
    let func = if parts.len() == 1 {
        parts[0]
    } else {
        let id = ids.next();
        pdf.stitching_function(id)
            .domain([0.0, 1.0])
            .functions(parts.iter().copied())
            .bounds(stops[1..stops.len() - 1].iter().map(|s| s.0))
            .encode(parts.iter().flat_map(|_| [0.0, 1.0]));
        id
    };
    let id = ids.next();
    let mut sh = pdf.function_shading(id);
    let (a, b) = (g.from, g.to);
    match g.kind {
        GradientKind::Linear => sh
            .shading_type(FunctionShadingType::Axial)
            .coords([a.x, a.y, b.x, b.y].map(|v| v as f32)),
        GradientKind::Radial => sh
            .shading_type(FunctionShadingType::Radial)
            .coords([a.x, a.y, 0.0, a.x, a.y, len].map(|v| v as f32)),
    };
    if cmyk {
        sh.color_space().device_cmyk();
    } else {
        sh.color_space().device_rgb();
    }
    sh.function(func).extend([true, true]);
    Some(id)
}

/// PNG → RGB- oder CMYK-Bild + Graustufen-Maske (nur wenn transparent).
fn xobject(pdf: &mut Pdf, ids: &mut Ids, png: &[u8], hash: &str, out: &Out) -> Result<Ref, String> {
    let img = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|e| format!("Bild {hash} nicht lesbar: {e}"))?
        .to_rgba8();
    let rgb: Vec<u8> = img.pixels().flat_map(|p| [p[0], p[1], p[2]]).collect();
    let alpha: Vec<u8> = img.pixels().map(|p| p[3]).collect();
    let (w, h) = (img.width() as i32, img.height() as i32);
    let mask = if alpha.iter().any(|&a| a < 255) {
        let id = ids.next();
        let data = compress_to_vec_zlib(&alpha, 6);
        let mut x = pdf.image_xobject(id, &data);
        x.width(w).height(h).bits_per_component(8);
        x.filter(Filter::FlateDecode);
        x.color_space().device_gray();
        Some(id)
    } else {
        None
    };
    let id = ids.next();
    let samples = if out.cmyk {
        out.cms.image_to_cmyk(&rgb)?
    } else {
        rgb
    };
    let data = compress_to_vec_zlib(&samples, 6);
    let mut x = pdf.image_xobject(id, &data);
    x.width(w).height(h).bits_per_component(8).interpolate(true);
    x.filter(Filter::FlateDecode);
    if out.cmyk {
        x.color_space().device_cmyk();
    } else {
        x.color_space().device_rgb();
    }
    if let Some(m) = mask {
        x.s_mask(m);
    }
    Ok(id)
}

pub fn export(scene: &Scene, images: &Images, cms: &Cms) -> Result<Vec<u8>, String> {
    write(scene, images, cms, None)
}

/// Mit `print` druckfertig (PDF/X-4): Blatt = Endformat + Rand, Inhalt auf den Beschnitt begrenzt.
pub(crate) fn write(
    scene: &Scene,
    images: &Images,
    cms: &Cms,
    print: Option<&Print>,
) -> Result<Vec<u8>, String> {
    let icc = match print {
        Some(_) => Some(cms.profile_bytes().ok_or(
            "Druckfertiges PDF braucht ein CMYK-Profil – in den Farbeinstellungen wählen.",
        )?),
        None => None,
    };
    let out = Out {
        cms,
        cmyk: cms.mode == ColorMode::Cmyk || print.is_some(),
    };
    let mut pdf = Pdf::new();
    let mut ids = Ids(0);
    let (catalog, tree, page_id, content_id) = (ids.next(), ids.next(), ids.next(), ids.next());
    let margin = print.map_or(0.0, |p| p.margin());
    let (w, h) = (
        ((scene.width + 2.0 * margin) * PT) as f32,
        ((scene.height + 2.0 * margin) * PT) as f32,
    );

    let mut c = Content::new();
    // Seite in mm, y nach unten – wie das Dokumentmodell; Ursprung = Ecke des Endformats.
    let m = (margin * PT) as f32;
    c.transform([PT as f32, 0.0, 0.0, -PT as f32, m, h - m]);
    if let Some(p) = print {
        let b = p.bleed as f32;
        c.save_state();
        c.rect(
            -b,
            -b,
            scene.width as f32 + 2.0 * b,
            scene.height as f32 + 2.0 * b,
        );
        c.clip_nonzero().end_path();
    }
    let mut shadings: Vec<(String, Ref)> = Vec::new();
    let mut xobjects: BTreeMap<String, (String, Ref)> = BTreeMap::new();
    let mut alphas: Vec<(f64, Ref)> = Vec::new();
    let mut spots = Spots(Vec::new());

    for (m, it) in leaves(&scene.items) {
        match it {
            Item::Path {
                subpaths,
                fill,
                stroke,
                fill_rule,
                ..
            } => {
                let even_odd = fill_rule.is_some();
                let solid = match fill {
                    None => None,
                    Some(Fill::Color(col)) => Some(col),
                    Some(Fill::Gradient(g)) => {
                        let det = m[0] * m[3] - m[1] * m[2];
                        match shading(&mut pdf, &mut ids, g, &out).filter(|_| det.abs() > 1e-12) {
                            Some(r) => {
                                let name = format!("Sh{}", shadings.len() + 1);
                                c.save_state();
                                path(&mut c, &m, subpaths);
                                if even_odd {
                                    c.clip_even_odd()
                                } else {
                                    c.clip_nonzero()
                                };
                                c.end_path()
                                    .transform(mat(&m))
                                    .shading(Name(name.as_bytes()));
                                c.restore_state();
                                shadings.push((name, r));
                                None
                            }
                            None => g.stops.last().map(|s| &s.color),
                        }
                    }
                };
                if let Some(col) = solid {
                    set_color(&mut c, col, &out, &mut pdf, &mut ids, &mut spots, false);
                    path(&mut c, &m, subpaths);
                    if even_odd {
                        c.fill_even_odd()
                    } else {
                        c.fill_nonzero()
                    };
                }
                if let Some(s) = stroke {
                    set_color(&mut c, &s.color, &out, &mut pdf, &mut ids, &mut spots, true);
                    c.set_line_width(s.width as f32).set_miter_limit(10.0);
                    c.set_line_cap(match s.cap {
                        Cap::Butt => LineCapStyle::ButtCap,
                        Cap::Round => LineCapStyle::RoundCap,
                        Cap::Square => LineCapStyle::ProjectingSquareCap,
                    });
                    c.set_line_join(match s.join {
                        Join::Miter => LineJoinStyle::MiterJoin,
                        Join::Round => LineJoinStyle::RoundJoin,
                        Join::Bevel => LineJoinStyle::BevelJoin,
                    });
                    path(&mut c, &m, subpaths);
                    c.stroke();
                }
            }
            Item::Image {
                width,
                height,
                image: hash,
                opacity,
                ..
            } => {
                let png = images
                    .get(hash)
                    .ok_or_else(|| format!("Bild {hash} fehlt in der Ablage."))?;
                if !xobjects.contains_key(hash) {
                    let r = xobject(&mut pdf, &mut ids, png, hash, &out)?;
                    xobjects.insert(hash.clone(), (format!("Im{}", xobjects.len() + 1), r));
                }
                let name = &xobjects[hash].0;
                // Bildraum: Einheitsquadrat, erste Zeile oben → auf (0,0)–(width,height) mit y nach unten.
                c.save_state();
                c.transform(mat(&m)).transform([
                    *width as f32,
                    0.0,
                    0.0,
                    -*height as f32,
                    0.0,
                    *height as f32,
                ]);
                if *opacity < 1.0 {
                    let i = alphas.iter().position(|(o, _)| o == opacity).unwrap_or_else(|| {
                        let r = ids.next();
                        pdf.ext_graphics(r).non_stroking_alpha(*opacity as f32);
                        alphas.push((*opacity, r));
                        alphas.len() - 1
                    });
                    c.set_parameters(Name(format!("Gs{}", i + 1).as_bytes()));
                }
                c.x_object(Name(name.as_bytes()));
                c.restore_state();
            }
            Item::Group { .. } => unreachable!("leaves löst Gruppen auf"),
        }
    }
    if let Some(p) = print {
        c.restore_state();
        if p.marks {
            // Passerfarbe: erscheint auf jedem Farbauszug.
            let reg = Color {
                model: ColorModel::Cmyk,
                values: vec![1.0; 4],
                spot: Some("All".into()),
            };
            set_color(&mut c, &reg, &out, &mut pdf, &mut ids, &mut spots, true);
            pdf_print::marks(&mut c, scene.width, scene.height, p);
        }
    }

    let meta = print.map(|_| Meta::new(&mut ids));
    let mut cat = pdf.catalog(catalog);
    cat.pages(tree);
    if let Some(meta) = &meta {
        meta.catalog(&mut cat, cms.profile_name().unwrap_or("CMYK"));
    }
    cat.finish();
    pdf.pages(tree).kids([page_id]).count(1);
    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, w, h))
        .parent(tree)
        .contents(content_id);
    if let Some(p) = print {
        let b = m - (p.bleed * PT) as f32;
        page.trim_box(Rect::new(m, m, w - m, h - m));
        page.bleed_box(Rect::new(b, b, w - b, h - b));
    }
    if !alphas.is_empty() {
        // Transparenz braucht eine Mischgruppe der Seite; Farbraum = Ausgabe (PDF/X-4 verlangt ihn).
        let mut g = page.group();
        g.transparency();
        let cs = g.color_space();
        if out.cmyk {
            cs.device_cmyk();
        } else {
            cs.device_rgb();
        }
    }
    let mut res = page.resources();
    let mut xo = res.x_objects();
    for (name, r) in xobjects.values() {
        xo.pair(Name(name.as_bytes()), *r);
    }
    xo.finish();
    let mut sh = res.shadings();
    for (name, r) in &shadings {
        sh.pair(Name(name.as_bytes()), *r);
    }
    sh.finish();
    let mut cs = res.color_spaces();
    for (i, (_, r)) in spots.0.iter().enumerate() {
        cs.pair(Name(format!("Cs{}", i + 1).as_bytes()), *r);
    }
    cs.finish();
    let mut gs = res.ext_g_states();
    for (i, (_, r)) in alphas.iter().enumerate() {
        gs.pair(Name(format!("Gs{}", i + 1).as_bytes()), *r);
    }
    gs.finish();
    res.finish();
    page.finish();
    let data = compress_to_vec_zlib(&c.finish(), 6);
    pdf.stream(content_id, &data).filter(Filter::FlateDecode);
    if let (Some(meta), Some(p), Some(icc)) = (&meta, print, icc) {
        meta.finish(&mut pdf, p, icc, &data);
    }
    Ok(pdf.finish())
}
