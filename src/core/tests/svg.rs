// SVG-Import (Spec §11: Pfade, Formen, Gruppen, Füllung/Kontur, Text als Kurven) + Roundtrip Export → Import.
use base64::Engine;
use kw_core::color::Cms;
use kw_core::scene::{leaves, Color, Fill, GradientKind, Item, Mat, Point, Scene, Stroke, Subpath};
use kw_core::{svg_export, svg_import, Images};
use std::io::Cursor;

const K: f64 = 25.4 / 96.0; // SVG-px → mm

fn import(svg: &str) -> svg_import::Imported {
    svg_import::import(svg.as_bytes()).unwrap()
}

fn apply(m: &Mat, p: Point) -> Point {
    Point {
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5],
    }
}

fn near(a: f64, b: f64, tol: f64) -> bool {
    (a - b).abs() <= tol
}

/// Alle Stütz- und Kontrollpunkte in Seiten-mm; fehlender Anfasser = Knoten selbst.
fn world_points(m: &Mat, subpaths: &[Subpath]) -> Vec<Vec<[Point; 3]>> {
    subpaths
        .iter()
        .map(|sp| {
            sp.nodes
                .iter()
                .map(|n| {
                    let p = Point { x: n.x, y: n.y };
                    [
                        apply(m, n.handle_in.unwrap_or(p)),
                        apply(m, p),
                        apply(m, n.handle_out.unwrap_or(p)),
                    ]
                })
                .collect()
        })
        .collect()
}

type PathLeaf = (Mat, Vec<Subpath>, Option<Fill>, Option<Stroke>);

fn paths(scene: &Scene) -> Vec<PathLeaf> {
    leaves(&scene.items)
        .into_iter()
        .filter_map(|(m, it)| match it {
            Item::Path {
                subpaths,
                fill,
                stroke,
                ..
            } => Some((m, subpaths.clone(), fill.clone(), stroke.clone())),
            _ => None,
        })
        .collect()
}

fn rgb(f: &Option<Fill>) -> [f64; 3] {
    match f {
        Some(Fill::Color(Color { values, .. })) => [values[0], values[1], values[2]],
        other => panic!("Vollton erwartet: {other:?}"),
    }
}

#[test]
fn masse_in_mm_viewbox_und_formen() {
    let imp = import(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 200 100">
        <rect x="20" y="10" width="40" height="20" fill="#ff0000"/></svg>"##,
    );
    assert!(near(imp.scene.width, 100.0, 1e-3) && near(imp.scene.height, 50.0, 1e-3));
    let ps = paths(&imp.scene);
    assert_eq!(ps.len(), 1);
    let pts: Vec<Point> = world_points(&ps[0].0, &ps[0].1)[0]
        .iter()
        .map(|n| n[1])
        .collect();
    assert_eq!(
        pts.len(),
        4,
        "Rechteck → 4 Ecken, ohne doppelten Schlusspunkt"
    );
    assert!(
        near(pts[0].x, 10.0, 1e-3)
            && near(pts[0].y, 5.0, 1e-3)
            && near(pts[2].x, 30.0, 1e-3)
            && near(pts[2].y, 15.0, 1e-3),
        "{pts:?}"
    );
    assert!(ps[0].1[0].closed);
    assert_eq!(rgb(&ps[0].2), [1.0, 0.0, 0.0]);
    assert!(imp.warnings.is_empty(), "{:?}", imp.warnings);
}

#[test]
fn gruppen_bleiben_gruppen() {
    let imp = import(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
        <g transform="translate(96 0)"><path d="M0 0 L10 0"/><path d="M0 5 L10 5"/></g></svg>"#,
    );
    fn find_group(items: &[Item]) -> Option<usize> {
        items.iter().find_map(|it| match it {
            Item::Group { children, .. }
                if children.iter().all(|c| matches!(c, Item::Path { .. })) =>
            {
                Some(children.len())
            }
            Item::Group { children, .. } => find_group(children),
            _ => None,
        })
    }
    assert_eq!(find_group(&imp.scene.items), Some(2));
    let ps = paths(&imp.scene);
    assert!(
        near(apply(&ps[0].0, Point { x: 0.0, y: 0.0 }).x, 25.4, 1e-3),
        "96 px = 25,4 mm"
    );
}

#[test]
fn kurven_bleiben_kurven() {
    let imp = import(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><path d="M0 0 C 10 0 20 10 20 20 Q 30 30 40 20"/></svg>"#,
    );
    let ps = paths(&imp.scene);
    let n = &ps[0].1[0].nodes;
    assert_eq!(n.len(), 3);
    assert!(n[0].handle_in.is_none() && n[0].handle_out.is_some() && n[1].handle_in.is_some());
    // Quadratisch → kubisch: Kontrollpunkt 2/3 Richtung q.
    let w = world_points(&ps[0].0, &ps[0].1);
    assert!(
        near(w[0][1][2].x, (20.0 + 2.0 / 3.0 * 10.0) * K, 1e-4),
        "{:?}",
        w[0][1][2]
    );
}

#[test]
fn kontur_breite_in_seiten_mm() {
    let imp = import(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><g transform="scale(2)">
        <path d="M0 0 L10 0" fill="none" stroke="#00ff00" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel"/></g></svg>"##,
    );
    let s = paths(&imp.scene)[0].3.clone().unwrap();
    assert!(near(s.width, 6.0 * K, 1e-4), "{}", s.width);
    assert_eq!(s.color.values, [0.0, 1.0, 0.0]);
    assert_eq!(
        serde_json::to_string(&(s.cap, s.join)).unwrap(),
        r#"["round","bevel"]"#
    );
}

#[test]
fn verlaeufe_linear_und_radial() {
    let imp = import(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><defs>
        <linearGradient id="l"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>
        <radialGradient id="r" cx="50" cy="50" r="10" gradientUnits="userSpaceOnUse"><stop offset="0.5" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient></defs>
        <rect x="10" y="0" width="20" height="10" fill="url(#l)"/><rect x="40" y="40" width="20" height="20" fill="url(#r)"/></svg>"##,
    );
    let ps = paths(&imp.scene);
    let Some(Fill::Gradient(l)) = &ps[0].2 else {
        panic!("linear erwartet")
    };
    // objectBoundingBox (Vorgabe) → x1 = 0 % … x2 = 100 % der Box.
    assert!(
        matches!(l.kind, GradientKind::Linear)
            && near(l.from.x, 10.0, 1e-3)
            && near(l.to.x, 30.0, 1e-3),
        "{l:?}"
    );
    assert_eq!(l.stops.len(), 2);
    let Some(Fill::Gradient(r)) = &ps[1].2 else {
        panic!("radial erwartet")
    };
    assert!(
        matches!(r.kind, GradientKind::Radial)
            && near(r.from.x, 50.0, 1e-3)
            && near(r.to.x - r.from.x, 10.0, 1e-3),
        "{r:?}"
    );
}

#[test]
fn text_kommt_als_kurven() {
    let imp = import(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60">
        <text x="10" y="40" font-family="Helvetica, Arial, sans-serif" font-size="30">Hallo</text></svg>"#,
    );
    let ps = paths(&imp.scene);
    assert!(
        !ps.is_empty(),
        "Text ohne Kurven – keine Systemschrift gefunden?"
    );
    assert!(
        ps.iter().flat_map(|p| &p.1).count() >= 5,
        "mind. ein Teilpfad je Buchstabe"
    );
}

fn png(w: u32, h: u32) -> Vec<u8> {
    let img = image::RgbaImage::from_fn(w, h, |x, _| image::Rgba([x as u8 * 100, 0, 0, 255]));
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
        .unwrap();
    out
}

#[test]
fn eingebettetes_png_wird_bild() {
    let data = png(3, 2);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    let imp = import(&format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><image x="96" y="0" width="30" height="20" href="data:image/png;base64,{b64}"/></svg>"#
    ));
    let imgs: Vec<_> = leaves(&imp.scene.items)
        .into_iter()
        .filter(|(_, it)| matches!(it, Item::Image { .. }))
        .collect();
    assert_eq!(imgs.len(), 1);
    let (
        m,
        Item::Image {
            width,
            height,
            image,
            ..
        },
    ) = &imgs[0]
    else {
        unreachable!()
    };
    assert_eq!(
        imp.images.get(image),
        Some(&data),
        "PNG byte-gleich übernommen"
    );
    let (a, b) = (
        apply(m, Point { x: 0.0, y: 0.0 }),
        apply(
            m,
            Point {
                x: *width,
                y: *height,
            },
        ),
    );
    assert!(
        near(a.x, 25.4, 1e-3) && near(b.x - a.x, 30.0 * K, 1e-3) && near(b.y - a.y, 20.0 * K, 1e-3),
        "{a:?} {b:?}"
    );
}

#[test]
fn nicht_unterstuetztes_wird_gemeldet() {
    let imp = import(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
        <clipPath id="c"><rect width="5" height="5"/></clipPath>
        <g clip-path="url(#c)" opacity="0.5"><path d="M0 0 L10 0" stroke="black" stroke-dasharray="2 1"/></g></svg>"#,
    );
    let w = imp.warnings.join(" | ");
    assert!(
        w.contains("Beschneidung") && w.contains("Deckkraft") && w.contains("Gestrichelt"),
        "{w}"
    );
}

#[test]
fn kaputtes_svg_ist_fehler() {
    assert!(svg_import::import(b"<svg").is_err());
    assert!(svg_import::import(b"kein svg").is_err());
}

fn golden() -> Scene {
    #[derive(serde::Deserialize)]
    struct F {
        scene: Scene,
    }
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/golden-scene.json"
    );
    serde_json::from_str::<F>(&std::fs::read_to_string(path).unwrap())
        .unwrap()
        .scene
}

#[test]
fn roundtrip_export_import_golden() {
    let scene = golden();
    let back = import(&svg_export::export(&scene, &Images::new(), &Cms::default()).unwrap()).scene;
    assert!(near(back.width, scene.width, 1e-3) && near(back.height, scene.height, 1e-3));
    let (a, b) = (paths(&scene), paths(&back));
    assert_eq!(a.len(), b.len());
    let rules = |s: &Scene| {
        leaves(&s.items)
            .into_iter()
            .filter_map(|(_, it)| {
                if let Item::Path { fill_rule, .. } = it {
                    Some(*fill_rule)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(rules(&back), rules(&scene), "Füllregel");
    assert!(
        rules(&scene).iter().any(Option::is_some),
        "Golden-Szene ohne gerade/ungerade"
    );
    for (i, (x, y)) in a.iter().zip(&b).enumerate() {
        let (wx, wy) = (world_points(&x.0, &x.1), world_points(&y.0, &y.1));
        assert_eq!(wx.len(), wy.len(), "Objekt {i}: Teilpfade");
        for (sx, sy) in wx.iter().zip(&wy) {
            assert_eq!(sx.len(), sy.len(), "Objekt {i}: Knotenzahl");
            for (p, q) in sx.iter().flatten().zip(sy.iter().flatten()) {
                assert!(
                    near(p.x, q.x, 1e-3) && near(p.y, q.y, 1e-3),
                    "Objekt {i}: {p:?} ≠ {q:?}"
                );
            }
        }
        match (&x.2, &y.2) {
            (Some(Fill::Color(c)), Some(Fill::Color(d))) => assert!(
                (0..3).all(|k| near(c.values[k], d.values[k], 0.5 / 255.0)),
                "Objekt {i}"
            ),
            (Some(Fill::Gradient(g)), Some(Fill::Gradient(h))) => {
                let (gf, gt, hf, ht) = (
                    apply(&x.0, g.from),
                    apply(&x.0, g.to),
                    apply(&y.0, h.from),
                    apply(&y.0, h.to),
                );
                assert!(
                    near(gf.x, hf.x, 1e-3)
                        && near(gt.x, ht.x, 1e-3)
                        && near(gf.y, hf.y, 1e-3)
                        && near(gt.y, ht.y, 1e-3),
                    "Objekt {i}"
                );
                assert_eq!(g.stops.len(), h.stops.len());
            }
            (None, None) => {}
            other => panic!("Objekt {i}: Füllung {other:?}"),
        }
        match (&x.3, &y.3) {
            (Some(s), Some(t)) => assert!(
                near(s.width, t.width, 1e-3) && s.cap == t.cap && s.join == t.join,
                "Objekt {i}: {s:?} {t:?}"
            ),
            (None, None) => {}
            other => panic!("Objekt {i}: Kontur {other:?}"),
        }
    }
}

#[test]
fn roundtrip_bild() {
    let data = png(2, 1);
    let item = Item::Image {
        matrix: [2.0, 0.0, 0.0, 2.0, 5.0, 3.0],
        width: 10.0,
        height: 5.0,
        image: "x".into(),
        opacity: 1.0,
    };
    let scene = Scene {
        width: 40.0,
        height: 20.0,
        items: vec![item],
    };
    let imp = import(
        &svg_export::export(
            &scene,
            &Images::from([("x".to_string(), data.clone())]),
            &Cms::default(),
        )
        .unwrap(),
    );
    let found = leaves(&imp.scene.items)
        .into_iter()
        .find_map(|(m, it)| match it {
            Item::Image {
                width,
                height,
                image,
                ..
            } => Some((
                apply(
                    &m,
                    Point {
                        x: *width,
                        y: *height,
                    },
                ),
                imp.images[image].clone(),
            )),
            _ => None,
        });
    let (corner, bytes) = found.expect("Bild fehlt");
    assert_eq!(bytes, data);
    assert!(
        near(corner.x, 25.0, 1e-3) && near(corner.y, 13.0, 1e-3),
        "{corner:?}"
    );
}
