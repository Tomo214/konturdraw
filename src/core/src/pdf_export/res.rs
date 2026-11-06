//! Ressourcen der PDF-Seite: Verlauf-Shadings und Bild-XObjects (ausgelagert aus pdf_export.rs).
use super::*;

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
