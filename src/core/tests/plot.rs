// 3g-2: Plotter-Formate – DXF (R12, Polylinien) und HPGL; nur Konturen, Kurven geglättet auf 0,01 mm.
use kw_core::plot_export::{dxf, hpgl, Origin, Plot};
use kw_core::scene::{Color, Fill, Item, NodeType, PathPoint, Point, Scene, Subpath, IDENTITY};

fn node(x: f64, y: f64) -> PathPoint {
    PathPoint {
        x,
        y,
        kind: NodeType::Corner,
        handle_in: None,
        handle_out: None,
    }
}

fn path(nodes: Vec<PathPoint>, closed: bool, fill: bool) -> Item {
    Item::Path {
        matrix: IDENTITY,
        subpaths: vec![Subpath { nodes, closed }],
        fill: fill.then(|| Fill::Color(Color::rgb(0.0, 0.0, 0.0))),
        stroke: None,
        fill_rule: None,
        opacity: 1.0,
    }
}

/// 10 × 10 mm ab (5, 5) auf einer 40 × 20-mm-Seite.
fn square() -> Item {
    path(
        vec![
            node(5.0, 5.0),
            node(15.0, 5.0),
            node(15.0, 15.0),
            node(5.0, 15.0),
        ],
        true,
        true,
    )
}

/// Kreis r = 5 um (20, 10) aus vier Kubik-Bögen.
fn circle() -> Item {
    let k = 0.552_284_75 * 5.0;
    let p = |x: f64, y: f64, ix: f64, iy: f64, ox: f64, oy: f64| PathPoint {
        x,
        y,
        kind: NodeType::Smooth,
        handle_in: Some(Point { x: ix, y: iy }),
        handle_out: Some(Point { x: ox, y: oy }),
    };
    path(
        vec![
            p(25.0, 10.0, 25.0, 10.0 - k, 25.0, 10.0 + k),
            p(20.0, 15.0, 20.0 + k, 15.0, 20.0 - k, 15.0),
            p(15.0, 10.0, 15.0, 10.0 + k, 15.0, 10.0 - k),
            p(20.0, 5.0, 20.0 - k, 5.0, 20.0 + k, 5.0),
        ],
        true,
        true,
    )
}

fn page(items: Vec<Item>) -> Scene {
    Scene {
        width: 40.0,
        height: 20.0,
        items,
    }
}

/// DXF als (Gruppencode, Wert)-Paare.
fn groups(dxf: &str) -> Vec<(i32, String)> {
    let lines: Vec<&str> = dxf.lines().collect();
    assert!(lines.len().is_multiple_of(2), "DXF hat ungerade Zeilenzahl");
    lines
        .chunks(2)
        .map(|c| (c[0].trim().parse().unwrap(), c[1].trim().to_string()))
        .collect()
}

/// Polylinien: (geschlossen, Punkte in DXF-Koordinaten).
fn polylines(dxf: &str) -> Vec<(bool, Vec<(f64, f64)>)> {
    let g = groups(dxf);
    let mut out: Vec<(bool, Vec<(f64, f64)>)> = Vec::new();
    let mut entity = String::new();
    for (code, v) in g {
        match code {
            0 => {
                entity = v.clone();
                match v.as_str() {
                    "POLYLINE" => out.push((false, vec![])),
                    "VERTEX" => out.last_mut().unwrap().1.push((f64::NAN, f64::NAN)),
                    _ => {}
                }
            }
            70 if entity == "POLYLINE" => out.last_mut().unwrap().0 = v == "1",
            10 if entity == "VERTEX" => {
                out.last_mut().unwrap().1.last_mut().unwrap().0 = v.parse().unwrap()
            }
            20 if entity == "VERTEX" => {
                out.last_mut().unwrap().1.last_mut().unwrap().1 = v.parse().unwrap()
            }
            _ => {}
        }
    }
    out
}

#[test]
fn dxf_r12_rahmen_und_quadrat_mit_y_nach_oben() {
    let d = dxf(&page(vec![square()]));
    let g = groups(&d);
    assert!(g.contains(&(1, "AC1009".into())), "R12-Kennung fehlt");
    assert!(
        g.contains(&(9, "$INSUNITS".into())) && g.contains(&(70, "4".into())),
        "Einheit mm fehlt"
    );
    assert_eq!(g.last(), Some(&(0, "EOF".into())));
    let p = polylines(&d);
    assert_eq!(p.len(), 1);
    assert!(p[0].0, "geschlossen");
    // y gespiegelt: Ursprung unten links auf der Seite
    assert_eq!(
        p[0].1,
        vec![(5.0, 15.0), (15.0, 15.0), (15.0, 5.0), (5.0, 5.0)]
    );
}

#[test]
fn dxf_kurven_auf_001_mm_genau() {
    let p = polylines(&dxf(&page(vec![circle()])));
    assert_eq!(p.len(), 1);
    let pts = &p[0].1;
    assert!(pts.len() >= 16, "zu grob: {} Punkte", pts.len());
    for &(x, y) in pts {
        let r = (x - 20.0).hypot(y - 10.0);
        assert!(
            (r - 5.0).abs() < 0.011,
            "Punkt ({x}, {y}) weicht ab: r = {r}"
        );
    }
    // Sehnenmitten liegen ebenfalls nah am Kreis (Glättungstoleranz)
    for w in pts.windows(2) {
        let (mx, my) = ((w[0].0 + w[1].0) / 2.0, (w[0].1 + w[1].1) / 2.0);
        assert!(5.0 - (mx - 20.0).hypot(my - 10.0) < 0.011);
    }
}

#[test]
fn nur_sichtbare_pfade_gruppen_mit_matrix() {
    let invisible = path(vec![node(0.0, 0.0), node(1.0, 1.0)], false, false);
    let image = Item::Image {
        matrix: IDENTITY,
        width: 5.0,
        height: 5.0,
        image: "x".into(),
        opacity: 1.0,
    };
    let group = Item::Group {
        matrix: [1.0, 0.0, 0.0, 1.0, 10.0, 0.0],
        children: vec![square()],
    };
    let p = polylines(&dxf(&page(vec![invisible, image, group])));
    assert_eq!(
        p.len(),
        1,
        "unsichtbare Pfade und Bilder gehören nicht in die Plotdatei"
    );
    assert_eq!(p[0].1[0], (15.0, 15.0), "Gruppenverschiebung fehlt");
}

#[test]
fn hpgl_unten_links_40_einheiten_je_mm() {
    let plot = Plot {
        units_per_mm: 40.0,
        origin: Origin::LowerLeft,
    };
    assert_eq!(
        hpgl(&page(vec![square()]), &plot).unwrap(),
        "IN;SP1;PU200,600;PD600,600,600,200,200,200,200,600;PU;SP0;"
    );
}

#[test]
fn hpgl_ursprung_mitte_und_offene_pfade() {
    let plot = Plot {
        units_per_mm: 10.0,
        origin: Origin::Center,
    };
    let line = path(vec![node(0.0, 0.0), node(40.0, 20.0)], false, false);
    let Item::Path { subpaths, .. } = line else {
        unreachable!()
    };
    let line = Item::Path {
        matrix: IDENTITY,
        subpaths,
        fill: None,
        stroke: Some(kw_core::scene::Stroke {
            color: Color::rgb(0.0, 0.0, 0.0),
            width: 0.3,
            cap: kw_core::scene::Cap::Butt,
            join: kw_core::scene::Join::Miter,
            dash: vec![],
        }),
        fill_rule: None,
        opacity: 1.0,
    };
    assert_eq!(
        hpgl(&page(vec![square(), line]), &plot).unwrap(),
        "IN;SP1;PU-150,50;PD-50,50,-50,-50,-150,-50,-150,50;PU-200,100;PD200,-100;PU;SP0;"
    );
}

#[test]
fn hpgl_einheiten_werden_geprueft() {
    for units in [0.0, -1.0, f64::NAN, 1001.0] {
        let plot = Plot {
            units_per_mm: units,
            origin: Origin::LowerLeft,
        };
        assert!(
            hpgl(&page(vec![square()]), &plot).is_err(),
            "{units} angenommen"
        );
    }
}
