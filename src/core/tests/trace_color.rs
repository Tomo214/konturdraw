//! Nachzeichnen 5d (Spec §8): Umriss farbig (Farbanzahl, je Farbe ein Objekt, Hintergrund, Überlappung),
//! Eckenglättung für Umriss und Mittellinie. Synthetische Bilder mit bekannten Farben und Ecken.
use kw_core::color::Cms;
use kw_core::png_export;
use kw_core::scene::{segments, Color, Fill, Item, NodeType, Scene, Seg, Subpath, IDENTITY};
use kw_core::trace::{trace, trace_colors, Background, Mode, Params, Piece};
use kw_core::Images;
use std::time::Instant;
use tiny_skia::{FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform};

type Rgb = [u8; 3];
const WHITE: Rgb = [255, 255, 255];
const RED: Rgb = [255, 0, 0];
const BLUE: Rgb = [0, 0, 255];
const BLACK: Rgb = [0, 0, 0];

fn colored(colors: usize, background: Background) -> Params {
    Params {
        mode: Mode::Color,
        colors,
        background,
        merge: true,
        cutout: false,
        ..Params::default()
    }
}

fn paint(c: Rgb) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8(c[0], c[1], c[2], 255);
    p
}

fn png(w: u32, h: u32, draw: impl FnOnce(&mut Pixmap)) -> Vec<u8> {
    let mut pm = Pixmap::new(w, h).unwrap();
    pm.fill(tiny_skia::Color::WHITE);
    draw(&mut pm);
    pm.encode_png().unwrap()
}

fn rect(pm: &mut Pixmap, x: f32, y: f32, w: f32, h: f32, c: Rgb) {
    pm.fill_rect(Rect::from_xywh(x, y, w, h).unwrap(), &paint(c), Transform::identity(), None);
}

fn circle(pm: &mut Pixmap, x: f32, y: f32, r: f32, c: Rgb) {
    let p = PathBuilder::from_circle(x, y, r).unwrap();
    pm.fill_path(&p, &paint(c), FillRule::Winding, Transform::identity(), None);
}

fn same(rgb: Option<[f64; 3]>, c: Rgb) -> bool {
    rgb.is_some_and(|v| v.iter().zip(c).all(|(a, b)| (a * 255.0 - b as f64).abs() <= 2.0))
}

/// Teile übereinander wie in der Gruppe (unten zuerst), 1 px je mm, transparenter Grund.
fn render(pieces: &[Piece], w: f64, h: f64) -> image::RgbaImage {
    let items = pieces
        .iter()
        .map(|p| {
            let [r, g, b] = p.rgb.unwrap();
            Item::Path {
                matrix: IDENTITY,
                subpaths: p.subpaths.clone(),
                fill: Some(Fill::Color(Color::rgb(r, g, b))),
                stroke: None,
                fill_rule: None,
            }
        })
        .collect();
    let out = png_export::export(&Scene { width: w, height: h, items }, &Images::new(), 25.4, &Cms::default()).unwrap();
    image::load_from_memory(&out).unwrap().to_rgba8()
}

/// Farbe am Pixel; None = durchsichtig.
fn at(img: &image::RgbaImage, x: u32, y: u32) -> Option<Rgb> {
    let [r, g, b, a] = img.get_pixel(x, y).0;
    (a == 255).then_some([r, g, b])
}

#[test]
fn drei_farben_exakt_hintergrund_unten() {
    let img = png(300, 300, |pm| {
        rect(pm, 40.0, 40.0, 100.0, 100.0, RED);
        circle(pm, 210.0, 210.0, 50.0, BLUE);
    });
    let pieces = trace_colors(&img, &colored(3, Background::Keep), 300.0, 300.0).unwrap();
    assert_eq!(pieces.len(), 3);
    assert!(same(pieces[0].rgb, WHITE), "unten liegt der Hintergrund: {:?}", pieces[0].rgb);
    for c in [RED, BLUE] {
        assert!(pieces.iter().any(|p| same(p.rgb, c)), "{c:?} fehlt: {:?}", pieces.iter().map(|p| p.rgb).collect::<Vec<_>>());
    }
    let out = render(&pieces, 300.0, 300.0);
    assert_eq!(
        [at(&out, 90, 90), at(&out, 210, 210), at(&out, 20, 20), at(&out, 280, 40)],
        [Some(RED), Some(BLUE), Some(WHITE), Some(WHITE)]
    );
}

#[test]
fn farbanzahl_zwei_fasst_zusammen() {
    let img = png(300, 300, |pm| {
        rect(pm, 40.0, 40.0, 100.0, 100.0, RED);
        circle(pm, 210.0, 210.0, 50.0, BLUE);
    });
    let pieces = trace_colors(&img, &colored(2, Background::Keep), 300.0, 300.0).unwrap();
    assert_eq!(pieces.len(), 2);
    assert!(same(pieces[0].rgb, WHITE));
}

#[test]
fn hintergrund_entfernen_am_rand_oder_im_ganzen_bild() {
    // schwarzes O mit weißem Innenraum, daneben ein rotes Feld
    let img = png(300, 200, |pm| {
        circle(pm, 100.0, 100.0, 80.0, BLACK);
        circle(pm, 100.0, 100.0, 40.0, WHITE);
        rect(pm, 210.0, 60.0, 60.0, 80.0, RED);
    });
    let probe = |bg| {
        let out = render(&trace_colors(&img, &colored(3, bg), 300.0, 200.0).unwrap(), 300.0, 200.0);
        [at(&out, 5, 5), at(&out, 100, 100), at(&out, 100, 40), at(&out, 240, 100)]
    };
    assert_eq!(probe(Background::Keep), [Some(WHITE), Some(WHITE), Some(BLACK), Some(RED)]);
    assert_eq!(probe(Background::Edge), [None, Some(WHITE), Some(BLACK), Some(RED)], "Innenraum bleibt weiß");
    assert_eq!(probe(Background::All), [None, None, Some(BLACK), Some(RED)], "Farbe im ganzen Bild weg");
}

#[test]
fn je_farbe_ein_objekt_oder_jede_flaeche_einzeln() {
    let img = png(300, 200, |pm| {
        rect(pm, 20.0, 20.0, 80.0, 80.0, RED);
        rect(pm, 180.0, 80.0, 80.0, 80.0, RED);
    });
    let merged = trace_colors(&img, &colored(2, Background::Edge), 300.0, 200.0).unwrap();
    assert_eq!(merged.len(), 1);
    assert_eq!(merged[0].subpaths.len(), 2);
    let single = trace_colors(&img, &Params { merge: false, ..colored(2, Background::Edge) }, 300.0, 200.0).unwrap();
    assert_eq!(single.len(), 2);
    assert!(single.iter().all(|p| same(p.rgb, RED) && p.subpaths.len() == 1));
}

#[test]
fn ueberlappung_entfernen_schneidet_untere_flaechen_aus() {
    let img = png(200, 200, |pm| rect(pm, 50.0, 50.0, 100.0, 100.0, RED));
    let bottom = |cutout| {
        let pieces = trace_colors(&img, &Params { cutout, ..colored(2, Background::Keep) }, 200.0, 200.0).unwrap();
        assert!(same(pieces[0].rgb, WHITE));
        let out = render(&pieces[..1], 200.0, 200.0);
        [at(&out, 100, 100), at(&out, 10, 10)]
    };
    assert_eq!(bottom(false), [Some(WHITE), Some(WHITE)], "gestapelt: Weiß liegt vollflächig unter Rot");
    assert_eq!(bottom(true), [None, Some(WHITE)], "ausgeschnitten: Loch unter Rot");
}

/// Gestapelt füllt eine Farbe nur unter Flächen, die sie berührt: kein versteckter Doppelgänger unter fremden
/// Flächen (beim Plotten oder Löschen der oberen Farbe käme er zum Vorschein). Gefunden in der echten App am Logo.
#[test]
fn gestapelt_keine_versteckte_kopie_unter_fremden_flaechen() {
    // Blau ist größer, liegt also unter Rot
    let apart = png(300, 200, |pm| {
        rect(pm, 20.0, 20.0, 150.0, 150.0, BLUE);
        rect(pm, 210.0, 70.0, 60.0, 60.0, RED);
    });
    let inside = png(300, 200, |pm| {
        rect(pm, 20.0, 20.0, 150.0, 150.0, BLUE);
        rect(pm, 70.0, 70.0, 50.0, 50.0, RED);
    });
    let blue = |img: &[u8]| {
        let pieces = trace_colors(img, &colored(3, Background::Edge), 300.0, 200.0).unwrap();
        let b = pieces.into_iter().find(|p| same(p.rgb, BLUE)).unwrap();
        (b.subpaths.len(), render(std::slice::from_ref(&b), 300.0, 200.0))
    };
    let (n, out) = blue(&apart);
    assert_eq!(n, 1, "unter dem roten Feld liegt kein blauer Doppelgänger");
    assert_eq!([at(&out, 95, 95), at(&out, 240, 100)], [Some(BLUE), None]);
    let (_, out) = blue(&inside);
    assert_eq!(at(&out, 95, 95), Some(BLUE), "berührt: Blau liegt weiter vollflächig unter Rot");
}

#[test]
fn rauschen_flecken_nehmen_die_umgebende_farbe_an() {
    let img = png(200, 200, |pm| {
        rect(pm, 50.0, 50.0, 100.0, 100.0, RED);
        rect(pm, 99.0, 99.0, 3.0, 3.0, BLUE);
    });
    let pieces = trace_colors(&img, &Params { cutout: true, ..colored(3, Background::Keep) }, 200.0, 200.0).unwrap();
    assert!(pieces.iter().all(|p| !same(p.rgb, BLUE)));
    assert_eq!(at(&render(&pieces, 200.0, 200.0), 100, 100), Some(RED), "kein Loch, wo der Fleck war");
}

/// Kleinster Abstand der Kurve zum Punkt (Kurven fein abgetastet).
fn dist(sps: &[Subpath], q: (f64, f64)) -> f64 {
    let mut best = f64::MAX;
    for sp in sps {
        let mut a = (sp.nodes[0].x, sp.nodes[0].y);
        for s in segments(sp) {
            let end = match s {
                Seg::Line(b) | Seg::Cubic(_, _, b) => (b.x, b.y),
            };
            for k in 0..=64 {
                let t = k as f64 / 64.0;
                let p = match s {
                    Seg::Line(_) => (a.0 + (end.0 - a.0) * t, a.1 + (end.1 - a.1) * t),
                    Seg::Cubic(b, c, _) => {
                        let u = 1.0 - t;
                        let f = |p0: f64, p1: f64, p2: f64, p3: f64| u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3;
                        (f(a.0, b.x, c.x, end.0), f(a.1, b.y, c.y, end.1))
                    }
                };
                best = best.min((p.0 - q.0).hypot(p.1 - q.1));
            }
            a = end;
        }
    }
    best
}

/// Größter Knick (Grad) zwischen Anfasser hin und her an Knoten im Umkreis r um q; 0 ohne Knoten dort.
fn kink(sps: &[Subpath], q: (f64, f64), r: f64) -> f64 {
    sps.iter()
        .flat_map(|s| &s.nodes)
        .filter(|n| (n.x - q.0).hypot(n.y - q.1) <= r)
        .filter_map(|n| {
            let (i, o) = (n.handle_in?, n.handle_out?);
            let turn = ((o.y - n.y).atan2(o.x - n.x) - (n.y - i.y).atan2(n.x - i.x)).to_degrees().abs();
            Some(if turn > 180.0 { 360.0 - turn } else { turn })
        })
        .fold(0.0, f64::max)
}

#[test]
fn eckenglaettung_umriss_schwarz_weiss_und_farbig() {
    // Vorgabe 0,3 und bis 0,5 bleibt die 90°-Ecke spitz, darüber wird sie glatt durchlaufen (wie vtracer).
    let img = png(200, 200, |pm| rect(pm, 50.0, 50.0, 100.0, 100.0, BLACK));
    for mode in [Mode::Outline, Mode::Color] {
        let run = |corners| {
            let p = Params { corners, ..colored(2, Background::Edge) };
            let sps = match mode {
                Mode::Color => trace_colors(&img, &p, 200.0, 200.0).unwrap().remove(0).subpaths,
                _ => trace(&img, &Params { mode, ..p }, 200.0, 200.0).unwrap(),
            };
            (dist(&sps, (50.0, 50.0)), kink(&sps, (50.0, 50.0), 3.0))
        };
        for c in [0.0, 0.3, 0.5] {
            let (d, k) = run(c);
            assert!(d < 0.5 && k > 80.0, "{mode:?} {c}: Ecke spitz erwartet, Abstand {d:.2}, Knick {k:.0}°");
        }
        let (_, k) = run(1.0);
        assert!(k < 30.0, "{mode:?}: bei 1 keine Ecke mehr, Knick {k:.0}°");
    }
}

fn stroked(w: u32, h: u32, pts: &[(f32, f32)], closed: bool) -> Vec<u8> {
    png(w, h, |pm| {
        let mut pb = PathBuilder::new();
        pb.move_to(pts[0].0, pts[0].1);
        for p in &pts[1..] {
            pb.line_to(p.0, p.1);
        }
        if closed {
            pb.close();
        }
        let s = Stroke { width: 8.0, line_cap: LineCap::Round, line_join: LineJoin::Round, ..Stroke::default() };
        pm.stroke_path(&pb.finish().unwrap(), &paint(BLACK), &s, Transform::identity(), None);
    })
}

/// Eckknoten (ohne offene Enden) in der Nähe von q.
fn corner_near(sps: &[Subpath], q: (f64, f64), r: f64) -> bool {
    sps.iter().any(|sp| {
        let n = sp.nodes.len();
        sp.nodes.iter().enumerate().any(|(i, k)| {
            let end = !sp.closed && (i == 0 || i == n - 1);
            !end && k.kind == NodeType::Corner && (k.x - q.0).hypot(k.y - q.1) <= r
        })
    })
}

#[test]
fn eckenglaettung_mittellinie_spitze_und_rahmen() {
    let line = |corners| Params { mode: Mode::Centerline, corners, ..Params::default() };
    // V mit Spitze oben: Knick 127°. Die Strichmitte endet an der Spitze ein paar Pixel tiefer
    // (Mitte zwischen äußerer Rundung und innerer Ecke) → Umkreis 6 px.
    let v = stroked(300, 300, &[(50.0, 250.0), (150.0, 50.0), (250.0, 250.0)], false);
    let sharp = trace(&v, &line(0.3), 300.0, 300.0).unwrap();
    assert_eq!(sharp.len(), 1);
    assert!(corner_near(&sharp, (150.0, 50.0), 6.0), "Eckknoten an der Spitze fehlt");
    assert!(kink(&sharp, (150.0, 50.0), 6.0) > 90.0, "Spitze nicht spitz: {:.0}°", kink(&sharp, (150.0, 50.0), 6.0));
    let round = trace(&v, &line(1.0), 300.0, 300.0).unwrap();
    assert!(!corner_near(&round, (150.0, 50.0), 20.0), "bei 1 keine Ecke");
    assert!(kink(&round, (150.0, 50.0), 20.0) < 30.0, "bei 1 glatt durchlaufen");

    // geschlossener Rahmen: vier Ecken
    let frame = stroked(300, 300, &[(60.0, 60.0), (240.0, 60.0), (240.0, 240.0), (60.0, 240.0)], true);
    let sps = trace(&frame, &line(0.3), 300.0, 300.0).unwrap();
    assert_eq!(sps.len(), 1);
    assert!(sps[0].closed);
    for q in [(60.0, 60.0), (240.0, 60.0), (240.0, 240.0), (60.0, 240.0)] {
        assert!(corner_near(&sps, q, 6.0), "Rahmenecke {q:?} fehlt");
    }
}

#[test]
fn farbig_2000px_unter_3s() {
    let colors: [Rgb; 6] = [WHITE, RED, BLUE, BLACK, [0, 160, 0], [250, 200, 0]];
    let img = png(2000, 2000, |pm| {
        for i in 0..5u32 {
            for j in 0..5u32 {
                let c = colors[1 + ((i + 2 * j) % 5) as usize];
                let (x, y) = (100.0 + i as f32 * 380.0, 100.0 + j as f32 * 380.0);
                if (i + j) % 2 == 0 {
                    circle(pm, x + 140.0, y + 140.0, 140.0, c);
                } else {
                    rect(pm, x, y, 280.0, 280.0, c);
                }
            }
        }
    });
    let t = Instant::now();
    let pieces = trace_colors(&img, &colored(6, Background::Keep), 2000.0, 2000.0).unwrap();
    let secs = t.elapsed().as_secs_f64();
    println!("Farbig: {} Teile in {secs:.2} s", pieces.len());
    assert_eq!(pieces.len(), 6);
    for c in colors {
        assert!(pieces.iter().any(|p| same(p.rgb, c)), "{c:?} fehlt");
    }
    if !cfg!(debug_assertions) {
        assert!(secs < 3.0, "{secs:.2} s");
    }
}

#[test]
fn palette_bearbeiten_umfaerben_und_zusammenfuehren() {
    // 7d: Farben aus dem Ergebnis (0–1) bekommen eine neue Farbe; gleiche Zielfarben = eine Farbe, ein Objekt.
    let img = png(300, 300, |pm| {
        rect(pm, 40.0, 40.0, 100.0, 100.0, RED);
        circle(pm, 210.0, 210.0, 50.0, BLUE);
    });
    let p = colored(3, Background::Keep);
    let base = trace_colors(&img, &p, 300.0, 300.0).unwrap();
    let rgb = |c: Rgb| base.iter().find(|pc| same(pc.rgb, c)).and_then(|pc| pc.rgb).unwrap();
    const GREEN: Rgb = [0, 255, 0];
    let green = [0.0, 1.0, 0.0];
    let edited = Params { recolor: vec![(rgb(RED), green)], ..p.clone() };
    let out = trace_colors(&img, &edited, 300.0, 300.0).unwrap();
    assert_eq!(out.len(), 3);
    assert!(out.iter().any(|pc| same(pc.rgb, GREEN)) && !out.iter().any(|pc| same(pc.rgb, RED)));
    let merged = Params { recolor: vec![(rgb(RED), green), (rgb(BLUE), green)], ..p };
    let out = trace_colors(&img, &merged, 300.0, 300.0).unwrap();
    assert_eq!(out.len(), 2, "Weiß und Grün");
    assert_eq!(out[1].subpaths.len(), 2, "Rechteck und Kreis in einem Objekt");
    let r = render(&out, 300.0, 300.0);
    assert_eq!([at(&r, 90, 90), at(&r, 210, 210), at(&r, 20, 20)], [Some(GREEN), Some(GREEN), Some(WHITE)]);
}
