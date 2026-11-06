//! PDF-Export: eine Seite in Dokumentgröße, Pfade als Vektoren, Verläufe als Shading, Bilder als
//! XObject mit Alpha-Maske. Farben: RGB-Modus je Modell (rg/k/g), CMYK-Modus alles k über das
//! Dokumentprofil (auch Bilder); Sonderfarben als Separation mit Ersatzwert. Druckfertig: pdf_print.
use crate::color::{Cms, ColorMode};
use crate::pdf_print::{self, Meta, Print};
use crate::scene::{
    apply, clipped_leaves, common_clips, mul, segments, Cap, ClipRef, Color, ColorModel, Fill,
    Gradient, GradientKind, Item, Join, Mat, Pattern, Point, Scene, Seg, Subpath, IDENTITY,
};
use crate::Images;
use miniz_oxide::deflate::compress_to_vec_zlib;
use pdf_writer::types::{
    ColorSpaceOperand, FunctionShadingType, LineCapStyle, LineJoinStyle, PaintType, TilingType,
};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref};
use std::collections::BTreeMap;

mod res;
use res::{alpha_state, shading, xobject, Res, Tile};

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
#[derive(Default)]
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
    let mut w = Writer {
        pdf: Pdf::new(),
        ids: Ids(0),
        out: Out {
            cms,
            cmyk: cms.mode == ColorMode::Cmyk || print.is_some(),
        },
        images,
        res: Res::default(),
        tiles: Vec::new(),
    };
    let (catalog, tree, page_id, content_id) =
        (w.ids.next(), w.ids.next(), w.ids.next(), w.ids.next());
    let margin = print.map_or(0.0, |p| p.margin());
    let (pw, ph) = (
        (scene.width + 2.0 * margin) * PT,
        (scene.height + 2.0 * margin) * PT,
    );
    let (wf, hf) = (pw as f32, ph as f32);

    let mut c = Content::new();
    // Seite in mm, y nach unten – wie das Dokumentmodell; Ursprung = Ecke des Endformats.
    let base = [PT, 0.0, 0.0, -PT, margin * PT, ph - margin * PT];
    let m = (margin * PT) as f32;
    c.transform(mat(&base));
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
    w.draw(&mut c, &scene.items, &base)?;
    if let Some(p) = print {
        c.restore_state();
        if p.marks {
            // Passerfarbe: erscheint auf jedem Farbauszug.
            let reg = Color {
                model: ColorModel::Cmyk,
                values: vec![1.0; 4],
                spot: Some("All".into()),
            };
            let Writer {
                pdf, ids, out, res, ..
            } = &mut w;
            set_color(&mut c, &reg, out, pdf, ids, &mut res.spots, true);
            pdf_print::marks(&mut c, scene.width, scene.height, p);
        }
    }
    w.write_tiles();

    let Writer {
        mut pdf,
        mut ids,
        out,
        res,
        ..
    } = w;
    let meta = print.map(|_| Meta::new(&mut ids));
    let mut cat = pdf.catalog(catalog);
    cat.pages(tree);
    if let Some(meta) = &meta {
        meta.catalog(&mut cat, cms.profile_name().unwrap_or("CMYK"));
    }
    cat.finish();
    pdf.pages(tree).kids([page_id]).count(1);
    let mut page = pdf.page(page_id);
    page.media_box(Rect::new(0.0, 0.0, wf, hf))
        .parent(tree)
        .contents(content_id);
    if let Some(p) = print {
        let b = m - (p.bleed * PT) as f32;
        page.trim_box(Rect::new(m, m, wf - m, hf - m));
        page.bleed_box(Rect::new(b, b, wf - b, hf - b));
    }
    if !res.alphas.is_empty() {
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
    res.write(page.resources());
    page.finish();
    let data = compress_to_vec_zlib(&c.finish(), 6);
    pdf.stream(content_id, &data).filter(Filter::FlateDecode);
    if let (Some(meta), Some(p), Some(icc)) = (&meta, print, icc) {
        meta.finish(&mut pdf, p, icc, &data);
    }
    Ok(pdf.finish())
}

/// Dokument im Bau; Seite und Musterkacheln teilen dieselben Ressourcen.
struct Writer<'a> {
    pdf: Pdf,
    ids: Ids,
    out: Out<'a>,
    images: &'a Images,
    res: Res,
    /// Kacheln, deren Inhalt erst am Ende geschrieben wird (Ressourcen dann vollständig).
    tiles: Vec<Tile>,
}

impl Writer<'_> {
    /// Objekte in `c`; `base` = Standardraum ← Szene des Inhaltsstroms (für Mustermatrizen).
    fn draw(&mut self, c: &mut Content, items: &[Item], base: &Mat) -> Result<(), String> {
        let mut dashed = false;
        // Offene Beschneidungen je q … W n; Q setzt auch das Strichmuster zurück → merken.
        let mut open: Vec<(ClipRef, bool)> = Vec::new();
        for leaf in clipped_leaves(items) {
            let chain: Vec<ClipRef> = open.iter().map(|(c, _)| *c).collect();
            let k = common_clips(&chain, &leaf.clips);
            while open.len() > k {
                c.restore_state();
                dashed = open.pop().map_or(dashed, |(_, d)| d);
            }
            for clip in &leaf.clips[k..] {
                c.save_state();
                path(c, &clip.matrix, clip.subpaths);
                if clip.subpaths.iter().all(|sp| sp.nodes.is_empty()) {
                    c.rect(0.0, 0.0, 0.0, 0.0); // leerer Umriss verdeckt alles; W ohne Pfad wirkte nicht
                }
                if clip.fill_rule.is_some() {
                    c.clip_even_odd()
                } else {
                    c.clip_nonzero()
                };
                c.end_path();
                open.push((*clip, dashed));
            }
            let (m, it) = (leaf.matrix, leaf.item);
            match it {
                Item::Path {
                    subpaths,
                    fill,
                    stroke,
                    fill_rule,
                    opacity,
                    ..
                } => {
                    // Deckkraft gilt für Füllung und Kontur je einzeln; Grafikzustand danach zurück.
                    let dashed_before = dashed;
                    if *opacity < 1.0 {
                        c.save_state();
                        let gs = alpha_state(
                            &mut self.pdf,
                            &mut self.ids,
                            &mut self.res.alphas,
                            *opacity,
                        );
                        c.set_parameters(Name(gs.as_bytes()));
                    }
                    let even_odd = fill_rule.is_some();
                    let solid = match fill {
                        None => None,
                        Some(Fill::Color(col)) => Some(col),
                        Some(Fill::Pattern(p)) => {
                            if let Some(name) = self.pattern(p, &mul(base, &m))? {
                                c.set_fill_color_space(ColorSpaceOperand::Pattern)
                                    .set_fill_pattern([0.0f32; 0], Name(name.as_bytes()));
                                path(c, &m, subpaths);
                                if even_odd {
                                    c.fill_even_odd()
                                } else {
                                    c.fill_nonzero()
                                };
                            }
                            None
                        }
                        Some(Fill::Gradient(g)) => {
                            let det = m[0] * m[3] - m[1] * m[2];
                            match shading(&mut self.pdf, &mut self.ids, g, &self.out)
                                .filter(|_| det.abs() > 1e-12)
                            {
                                Some(r) => {
                                    let name = format!("Sh{}", self.res.shadings.len() + 1);
                                    c.save_state();
                                    path(c, &m, subpaths);
                                    if even_odd {
                                        c.clip_even_odd()
                                    } else {
                                        c.clip_nonzero()
                                    };
                                    c.end_path()
                                        .transform(mat(&m))
                                        .shading(Name(name.as_bytes()));
                                    c.restore_state();
                                    self.res.shadings.push((name, r));
                                    None
                                }
                                None => g.stops.last().map(|s| &s.color),
                            }
                        }
                    };
                    let Writer {
                        pdf, ids, out, res, ..
                    } = self;
                    if let Some(col) = solid {
                        set_color(c, col, out, pdf, ids, &mut res.spots, false);
                        path(c, &m, subpaths);
                        if even_odd {
                            c.fill_even_odd()
                        } else {
                            c.fill_nonzero()
                        };
                    }
                    if let Some(s) = stroke {
                        set_color(c, &s.color, out, pdf, ids, &mut res.spots, true);
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
                        // Strichmuster bleibt im Grafikzustand → nur beim Wechsel setzen
                        let dash = s.dash_pattern();
                        if dash.is_some() || dashed {
                            c.set_dash_pattern(dash.unwrap_or(&[]).iter().map(|x| *x as f32), 0.0);
                            dashed = dash.is_some();
                        }
                        path(c, &m, subpaths);
                        c.stroke();
                    }
                    if *opacity < 1.0 {
                        c.restore_state();
                        dashed = dashed_before;
                    }
                }
                Item::Image {
                    width,
                    height,
                    image: hash,
                    opacity,
                    ..
                } => {
                    let png = self
                        .images
                        .get(hash)
                        .ok_or_else(|| format!("Bild {hash} fehlt in der Ablage."))?;
                    let xobjects = &mut self.res.xobjects;
                    if !xobjects.contains_key(hash) {
                        let r = xobject(&mut self.pdf, &mut self.ids, png, hash, &self.out)?;
                        xobjects.insert(hash.clone(), (format!("Im{}", xobjects.len() + 1), r));
                    }
                    let name = xobjects[hash].0.clone();
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
                        let gs = alpha_state(
                            &mut self.pdf,
                            &mut self.ids,
                            &mut self.res.alphas,
                            *opacity,
                        );
                        c.set_parameters(Name(gs.as_bytes()));
                    }
                    c.x_object(Name(name.as_bytes()));
                    c.restore_state();
                }
                Item::Group { .. } | Item::Clip { .. } => {
                    unreachable!("clipped_leaves löst Gruppen und Rahmen auf")
                }
            }
        }
        for _ in &open {
            c.restore_state();
        }
        Ok(())
    }
}
