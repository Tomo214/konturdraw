// 3f: Exporte mit Dokument-Farbeinstellungen – PDF-Farboperatoren, Sonderfarben, CMYK-Modus; PNG/SVG über sRGB.
use kw_core::color::{byte, Cms, ColorMode, ColorSettings, RenderIntent};
use kw_core::scene::{Cap, Join, Stroke};
use kw_core::scene::{
    Color, Fill, Gradient, GradientKind, GradientStop, Item, NodeType, PathPoint, Point, Scene,
    Subpath, IDENTITY,
};
use kw_core::{pdf_export, png_export, svg_export, Images};
use miniz_oxide::inflate::decompress_to_vec_zlib;
use tiny_skia::Pixmap;

const GENERIC_CMYK: &str = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";

fn color(json: &str) -> Color {
    serde_json::from_str(json).unwrap()
}

/// 10 × 10 mm ab x, wahlweise mit Füllung und Kontur.
fn square(x: f64, fill: Option<Fill>, stroke: Option<Color>) -> Item {
    let node = |x: f64, y: f64| PathPoint {
        x,
        y,
        kind: NodeType::Corner,
        handle_in: None,
        handle_out: None,
    };
    let nodes = vec![
        node(x, 0.0),
        node(x + 10.0, 0.0),
        node(x + 10.0, 10.0),
        node(x, 10.0),
    ];
    let stroke = stroke.map(|color| Stroke {
        color,
        width: 0.5,
        cap: Cap::Butt,
        join: Join::Miter,
        dash: vec![],
    });
    Item::Path {
        matrix: IDENTITY,
        subpaths: vec![Subpath {
            closed: true,
            nodes,
        }],
        fill,
        stroke,
        fill_rule: None,
    }
}

/// rgb | cmyk | grau | Sonderfarbe, nebeneinander.
fn swatches() -> Scene {
    let fills = [
        color(r#"{"model":"rgb","values":[0.5,0.25,0.75]}"#),
        color(r#"{"model":"cmyk","values":[0.5,0.25,0,0.75]}"#),
        color(r#"{"model":"gray","values":[0.25]}"#),
        color(r#"{"model":"cmyk","values":[0.5,1,0,0],"spot":"Stencil-Violett"}"#),
    ];
    let items = fills
        .into_iter()
        .enumerate()
        .map(|(i, c)| square(i as f64 * 10.0, Some(Fill::Color(c)), None))
        .collect();
    Scene {
        width: 40.0,
        height: 10.0,
        items,
    }
}

fn cmyk_cms(mode: ColorMode) -> Option<Cms> {
    let icc = std::fs::read(GENERIC_CMYK).ok()?;
    Some(
        Cms::new(
            &ColorSettings {
                mode,
                intent: RenderIntent::Relative,
                ..Default::default()
            },
            Some(&icc),
        )
        .unwrap(),
    )
}

/// Alle Flate-Ströme der PDF entpackt hintereinander (Inhalt der Seite).
fn content(pdf: &[u8]) -> String {
    let mut out = String::new();
    let mut at = 0;
    while let Some(i) = find(&pdf[at..], b"stream\n") {
        let start = at + i + 7;
        let Some(len) = find(&pdf[start..], b"\nendstream") else {
            break;
        };
        if let Ok(data) = decompress_to_vec_zlib(&pdf[start..start + len]) {
            out.push_str(&String::from_utf8_lossy(&data));
            out.push('\n');
        }
        at = start + len;
    }
    out
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Operanden aller Vorkommen eines Operators, z. B. ops(c, "k", 4).
fn ops(content: &str, op: &str, arity: usize) -> Vec<Vec<f32>> {
    let tokens: Vec<&str> = content.split_whitespace().collect();
    (arity..tokens.len())
        .filter(|&i| tokens[i] == op)
        .filter_map(|i| {
            tokens[i - arity..i]
                .iter()
                .map(|t| t.parse().ok())
                .collect()
        })
        .collect()
}

fn close(a: &[f32], b: &[f64]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (*x as f64 - y).abs() < 1e-3)
}

#[test]
fn pdf_rgb_mode_keeps_each_model_native() {
    let c = content(&pdf_export::export(&swatches(), &Images::new(), &Cms::default()).unwrap());
    assert_eq!(ops(&c, "rg", 3), [vec![0.5, 0.25, 0.75]], "{c}");
    assert_eq!(ops(&c, "k", 4), [vec![0.5, 0.25, 0.0, 0.75]], "{c}");
    assert_eq!(ops(&c, "g", 1), [vec![0.25]], "{c}");
}

#[test]
fn pdf_cmyk_mode_converts_everything_to_cmyk() {
    let Some(cms) = cmyk_cms(ColorMode::Cmyk) else {
        return;
    };
    let c = content(&pdf_export::export(&swatches(), &Images::new(), &cms).unwrap());
    assert!(
        ops(&c, "rg", 3).is_empty() && ops(&c, "g", 1).is_empty(),
        "{c}"
    );
    let k = ops(&c, "k", 4);
    assert_eq!(k.len(), 3, "{c}");
    assert!(
        close(
            &k[0],
            &cms.cmyk(&color(r#"{"model":"rgb","values":[0.5,0.25,0.75]}"#))
        ),
        "{k:?}"
    );
    assert!(close(&k[1], &[0.5, 0.25, 0.0, 0.75]), "{k:?}");
    assert!(
        close(&k[2], &[0.0, 0.0, 0.0, 0.75]),
        "Grau = nur Schwarz: {k:?}"
    );
}

#[test]
fn pdf_spot_color_becomes_separation() {
    let mut scene = swatches();
    let spot = color(r#"{"model":"cmyk","values":[0.5,1,0,0],"spot":"Stencil-Violett"}"#);
    scene.items.push(square(30.0, None, Some(spot))); // gleiche Sonderfarbe als Kontur → ein Farbraum
    let pdf = pdf_export::export(&scene, &Images::new(), &Cms::default()).unwrap();
    let raw = String::from_utf8_lossy(&pdf);
    assert_eq!(
        raw.matches("/Separation /Stencil-Violett /DeviceCMYK")
            .count(),
        1,
        "{raw}"
    );
    let c = content(&pdf);
    assert!(c.contains("/Cs1 cs") && c.contains("/Cs1 CS"), "{c}");
    assert_eq!(
        (ops(&c, "scn", 1), ops(&c, "SCN", 1)),
        (vec![vec![1.0]], vec![vec![1.0]]),
        "{c}"
    );
}

#[test]
fn pdf_gradient_with_cmyk_stops_shades_in_cmyk() {
    let stop = |offset: f64, json: &str| GradientStop {
        offset,
        color: color(json),
    };
    let g = Gradient {
        kind: GradientKind::Linear,
        from: Point { x: 0.0, y: 0.0 },
        to: Point { x: 10.0, y: 0.0 },
        stops: vec![
            stop(0.0, r#"{"model":"cmyk","values":[1,0,0,0]}"#),
            stop(1.0, r#"{"model":"gray","values":[1]}"#),
        ],
    };
    let scene = Scene {
        width: 10.0,
        height: 10.0,
        items: vec![square(0.0, Some(Fill::Gradient(g)), None)],
    };
    let raw = String::from_utf8_lossy(
        &pdf_export::export(&scene, &Images::new(), &Cms::default()).unwrap(),
    )
    .into_owned();
    assert!(
        raw.contains("/ColorSpace /DeviceCMYK")
            && raw.contains("/C0 [1 0 0 0]")
            && raw.contains("/C1 [0 0 0 0]"),
        "{raw}"
    );
}

#[test]
fn png_and_svg_show_cmyk_through_the_profile() {
    let Some(cms) = cmyk_cms(ColorMode::Rgb) else {
        return;
    };
    let cyan = color(r#"{"model":"cmyk","values":[1,0,0,0]}"#);
    let want = cms.srgb(&cyan).map(byte);
    assert!(want != [0, 255, 255], "Profil wirkt nicht: {want:?}");
    let scene = Scene {
        width: 10.0,
        height: 10.0,
        items: vec![square(0.0, Some(Fill::Color(cyan)), None)],
    };
    let pm = Pixmap::decode_png(&png_export::export(&scene, &Images::new(), 254.0, &cms).unwrap())
        .unwrap();
    let p = pm.pixel(50, 50).unwrap();
    assert_eq!([p.red(), p.green(), p.blue()], want);
    let svg = svg_export::export(&scene, &Images::new(), &cms).unwrap();
    let hex = format!("#{:02x}{:02x}{:02x}", want[0], want[1], want[2]);
    assert!(svg.contains(&hex), "{hex} fehlt: {svg}");
}
