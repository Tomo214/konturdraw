//! Nachzeichnen (Spec §8): Pixelbild → Pfade in Bild-mm. Umriss über visioncortex (MIT),
//! Mittellinie eigen: Verdünnung (thin) → Pixelgraph (graph) → Bézier-Anpassung (fit),
//! farbig eigen: Farben verringern und Flecken umfärben (colors), je Farbe ein Umriss.
mod colors;
mod fit;
mod graph;
mod thin;

use crate::scene::{NodeType, PathPoint, Point, Subpath};
use serde::{Deserialize, Serialize};
use visioncortex::{clusters::Cluster, BinaryImage, CompoundPathElement, PathSimplifyMode, Spline};

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Flächen mit Löchern, gefüllt.
    Outline,
    /// Offene Linien durch die Strichmitte (Stencil).
    Centerline,
    /// Flächen in höchstens `colors` Farben.
    Color,
}

/// Farbig: was mit der Hintergrundfarbe (häufigste Farbe am Bildrand) passiert.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Background {
    Keep,
    /// Nur die Flächen, die den Bildrand berühren; Innenräume (Buchstaben-Löcher) bleiben.
    Edge,
    /// Die Farbe verschwindet im ganzen Bild.
    All,
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(default)]
pub struct Params {
    pub mode: Mode,
    /// Helligkeit 0–255: dunkler zählt als Linie.
    pub threshold: u8,
    /// Flecken mit weniger Pixeln fallen weg.
    pub speckle: usize,
    /// Glättung 0–1.
    pub smooth: f64,
    /// Eckenglättung 0–1: 0 = Ecken bleiben spitz, 1 = alle Ecken rund.
    pub corners: f64,
    /// Farbig: höchstens so viele Farben.
    pub colors: usize,
    /// Farbig: alle Flächen einer Farbe = ein Objekt (sonst jede Fläche einzeln).
    pub merge: bool,
    pub background: Background,
    /// Farbig: Flächen schneiden sich aus (sonst liegt jede Farbe vollflächig unter den folgenden).
    pub cutout: bool,
}

impl Default for Params {
    fn default() -> Self {
        Params {
            mode: Mode::Outline,
            threshold: 128,
            speckle: 16,
            smooth: 0.5,
            corners: 0.3,
            colors: 8,
            merge: true,
            background: Background::Edge,
            cutout: false,
        }
    }
}

/// Ein Ergebnis-Objekt; rgb 0–1, None bei Umriss s/w und Mittellinie (Farbe setzt die Oberfläche).
#[derive(Serialize, Clone, Debug)]
pub struct Piece {
    pub rgb: Option<[f64; 3]>,
    pub subpaths: Vec<Subpath>,
}

/// Eckenglättung → Winkel, ab dem ein Knick als Ecke gilt: 15° (fast alles Ecke) bis 165° (keine), Vorgabe 0,3 = 60°.
fn corner_angle(p: &Params) -> f64 {
    (15.0 + 150.0 * p.corners.clamp(0.0, 1.0)).to_radians()
}

/// Ergebnis liegt in der Bildbox (0, 0)–(width_mm, height_mm) wie ein Bildobjekt.
pub fn trace(
    png: &[u8],
    p: &Params,
    width_mm: f64,
    height_mm: f64,
) -> Result<Vec<Subpath>, String> {
    let img = binarize(png, p.threshold)?;
    let (sx, sy) = (width_mm / img.width as f64, height_mm / img.height as f64);
    let px = match p.mode {
        Mode::Outline => outline(&img, p),
        Mode::Centerline => centerline(&img, p),
        Mode::Color => return Err("Farbig über trace_colors.".into()),
    };
    Ok(px.into_iter().map(|sp| scale(sp, sx, sy)).collect())
}

/// Umriss farbig: Teile von unten nach oben, Hintergrund zuerst; Lage wie `trace`.
pub fn trace_colors(png: &[u8], p: &Params, width_mm: f64, height_mm: f64) -> Result<Vec<Piece>, String> {
    let img = image::load_from_memory(png).map_err(|e| format!("Bild nicht lesbar: {e}"))?.to_rgba8();
    let (sx, sy) = (width_mm / img.width() as f64, height_mm / img.height() as f64);
    Ok(colors::pieces(&img, p)
        .into_iter()
        .map(|pc| Piece {
            subpaths: pc.subpaths.into_iter().map(|sp| scale(sp, sx, sy)).collect(),
            ..pc
        })
        .collect())
}

/// Sporne kürzer als die mittlere Strichbreite (Fläche / Skelettlänge) fallen weg; Glättung = Toleranz 0,5–2 px,
/// Eckenglättung = ab welchem Knick ein Eckknoten entsteht.
fn centerline(img: &BinaryImage, p: &Params) -> Vec<Subpath> {
    let mut g = thin::Grid::new(img, p.speckle);
    let area = g.count();
    thin::thin(&mut g);
    let spur = (area as f64 / g.count().max(1) as f64).max(3.0);
    let tol = 0.5 + 1.5 * p.smooth.clamp(0.0, 1.0);
    // Knicke über etwa eine Strichbreite messen: kürzer misst die Pixeltreppe, länger verschluckt kurze Zacken
    let k = (spur.round() as usize).max(4);
    graph::lines(&g, spur)
        .iter()
        .filter_map(|l| fit::subpath(&l.pts, l.closed, tol, corner_angle(p), k))
        .collect()
}

fn binarize(png: &[u8], threshold: u8) -> Result<BinaryImage, String> {
    let img = image::load_from_memory(png)
        .map_err(|e| format!("Bild nicht lesbar: {e}"))?
        .to_luma_alpha8();
    let mut bin = BinaryImage::new_w_h(img.width() as usize, img.height() as usize);
    for (x, y, px) in img.enumerate_pixels() {
        let [l, a] = px.0.map(u32::from);
        // Transparenz zählt als Papier.
        if (l * a + 255 * (255 - a)) / 255 < u32::from(threshold) {
            bin.set_pixel(x as usize, y as usize, true);
        }
    }
    Ok(bin)
}

/// Umriss s/w: alle dunklen Flächen mit Löchern.
fn outline(img: &BinaryImage, p: &Params) -> Vec<Subpath> {
    img.to_clusters(false)
        .iter()
        .filter(|c| c.size() >= p.speckle)
        .flat_map(|c| cluster_paths(c, p))
        .collect()
}

/// Umriss einer Fläche (außen + Löcher). Kantenparameter wie vtracer-Vorgaben, Ecken nach Eckenglättung;
/// Glättung verlängert die Mindest-Segmentlänge (3,5–10 px).
fn cluster_paths(c: &Cluster, p: &Params) -> Vec<Subpath> {
    let seg = 3.5 + 6.5 * p.smooth.clamp(0.0, 1.0);
    c.to_compound_path(PathSimplifyMode::Spline, corner_angle(p), seg, 10, 45f64.to_radians())
        .paths
        .into_iter()
        .filter_map(|e| match e {
            CompoundPathElement::Spline(s) if s.points.len() >= 4 => Some(closed(&s)),
            _ => None,
        })
        .collect()
}

/// Spline = Start + je Kurve (Anfasser 1, Anfasser 2, Ende); geschlossen, letztes Ende = Start.
fn closed(s: &Spline) -> Subpath {
    let pts = &s.points;
    let n = (pts.len() - 1) / 3;
    let at = |i: usize| Point {
        x: pts[i].x,
        y: pts[i].y,
    };
    let nodes = (0..n)
        .map(|k| PathPoint {
            x: pts[3 * k].x,
            y: pts[3 * k].y,
            kind: NodeType::Corner,
            handle_in: Some(at(if k == 0 { 3 * n - 1 } else { 3 * k - 1 })),
            handle_out: Some(at(3 * k + 1)),
        })
        .collect();
    Subpath {
        closed: true,
        nodes,
    }
}

fn scale(sp: Subpath, sx: f64, sy: f64) -> Subpath {
    let s = |p: Point| Point {
        x: p.x * sx,
        y: p.y * sy,
    };
    let nodes = sp
        .nodes
        .into_iter()
        .map(|n| PathPoint {
            x: n.x * sx,
            y: n.y * sy,
            handle_in: n.handle_in.map(s),
            handle_out: n.handle_out.map(s),
            ..n
        })
        .collect();
    Subpath { nodes, ..sp }
}
