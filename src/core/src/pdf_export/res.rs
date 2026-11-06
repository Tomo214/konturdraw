//! Ressourcen der PDF-Seite: Verlauf-Shadings, Bild-XObjects, Kachelmuster (ausgelagert aus pdf_export.rs).
use super::*;
use pdf_writer::writers::Resources;

/// Ressourcen, die Seite und Musterkacheln gemeinsam nutzen; Namen dokumentweit eindeutig.
#[derive(Default)]
pub(super) struct Res {
    pub shadings: Vec<(String, Ref)>,
    pub xobjects: BTreeMap<String, (String, Ref)>,
    pub alphas: Vec<(f64, Ref)>,
    pub spots: Spots,
    /// Kachelmuster, Name P<Objektnummer>
    pub patterns: Vec<Ref>,
}

impl Res {
    pub fn write(&self, mut res: Resources) {
        let mut xo = res.x_objects();
        for (name, r) in self.xobjects.values() {
            xo.pair(Name(name.as_bytes()), *r);
        }
        xo.finish();
        let mut sh = res.shadings();
        for (name, r) in &self.shadings {
            sh.pair(Name(name.as_bytes()), *r);
        }
        sh.finish();
        let mut cs = res.color_spaces();
        for (i, (_, r)) in self.spots.0.iter().enumerate() {
            cs.pair(Name(format!("Cs{}", i + 1).as_bytes()), *r);
        }
        cs.finish();
        let mut gs = res.ext_g_states();
        for (i, (_, r)) in self.alphas.iter().enumerate() {
            gs.pair(Name(format!("Gs{}", i + 1).as_bytes()), *r);
        }
        gs.finish();
        let mut pt = res.patterns();
        for r in &self.patterns {
            pt.pair(Name(format!("P{}", r.get()).as_bytes()), *r);
        }
        pt.finish();
    }
}

/// Musterkachel: Inhalt in Kachel-Koordinaten, Matrix = Elternraum ← Kachel.
pub(super) struct Tile {
    pub id: Ref,
    pub content: Vec<u8>,
    pub width: f64,
    pub height: f64,
    pub matrix: Mat,
}

impl Writer<'_> {
    /// Kachelmuster anlegen, Name P<Objektnummer>; `parent` = Elternraum ← Objekt (Seite:
    /// Standardraum in pt, Kachel: deren Musterraum). None = Kachel ohne Fläche.
    pub(super) fn pattern(&mut self, p: &Pattern, parent: &Mat) -> Result<Option<String>, String> {
        let matrix = mul(parent, &p.matrix);
        let det = matrix[0] * matrix[3] - matrix[1] * matrix[2];
        if !(p.width as f32 > 0.0 && p.height as f32 > 0.0 && det.abs() > 1e-12) {
            return Ok(None);
        }
        let id = self.ids.next();
        let mut c = Content::new();
        self.draw(&mut c, &p.items, &IDENTITY)?;
        self.res.patterns.push(id);
        self.tiles.push(Tile {
            id,
            content: c.finish().to_vec(),
            width: p.width,
            height: p.height,
            matrix,
        });
        Ok(Some(format!("P{}", id.get())))
    }

    pub(super) fn write_tiles(&mut self) {
        for t in std::mem::take(&mut self.tiles) {
            let data = compress_to_vec_zlib(&t.content, 6);
            let (tw, th) = (t.width as f32, t.height as f32);
            let mut tp = self.pdf.tiling_pattern(t.id, &data);
            tp.filter(Filter::FlateDecode);
            tp.paint_type(PaintType::Colored)
                .tiling_type(TilingType::ConstantSpacing)
                .bbox(Rect::new(0.0, 0.0, tw, th))
                .x_step(tw)
                .y_step(th)
                .matrix(mat(&t.matrix));
            self.res.write(tp.resources());
        }
    }
}

/// Shading in Objekt-Koordinaten; None bei entartetem Verlauf (Länge/Radius 0).
/// CMYK-Modus oder ein CMYK-Stopp → DeviceCMYK, sonst DeviceRGB. Sonderfarben zählen mit ihrem Ersatzwert.
pub(super) fn shading(pdf: &mut Pdf, ids: &mut Ids, g: &Gradient, out: &Out) -> Option<Ref> {
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
pub(super) fn xobject(
    pdf: &mut Pdf,
    ids: &mut Ids,
    png: &[u8],
    hash: &str,
    out: &Out,
) -> Result<Ref, String> {
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

/// ExtGState mit Deckkraft für Füllung und Kontur (ca + CA), je Wert einmal angelegt; Name Gs1, Gs2, …
pub(super) fn alpha_state(
    pdf: &mut Pdf,
    ids: &mut Ids,
    alphas: &mut Vec<(f64, Ref)>,
    opacity: f64,
) -> String {
    let i = alphas
        .iter()
        .position(|(o, _)| *o == opacity)
        .unwrap_or_else(|| {
            let r = ids.next();
            pdf.ext_graphics(r)
                .non_stroking_alpha(opacity as f32)
                .stroking_alpha(opacity as f32);
            alphas.push((opacity, r));
            alphas.len() - 1
        });
    format!("Gs{}", i + 1)
}
