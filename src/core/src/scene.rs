//! Austausch-Szene TS ↔ kw-core, Gegenstück zu src/io/ir.ts. Einheiten mm, y nach unten,
//! Matrix [a, b, c, d, e, f] wie Canvas: x' = a·x + c·y + e, y' = b·x + d·y + f.
use serde::{Deserialize, Serialize};

pub type Mat = [f64; 6];
pub const IDENTITY: Mat = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

/// m · n: erst n, dann m (wie multiply in geometry.ts).
pub fn mul(m: &Mat, n: &Mat) -> Mat {
    [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

pub fn apply(m: &Mat, p: Point) -> Point {
    Point {
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5],
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    Corner,
    Smooth,
    Symmetric,
}

/// Knoten mit absoluten Anfassern; fehlender Anfasser = liegt auf dem Knoten.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PathPoint {
    pub x: f64,
    pub y: f64,
    #[serde(rename = "type")]
    pub kind: NodeType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_in: Option<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_out: Option<Point>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Subpath {
    pub closed: bool,
    pub nodes: Vec<PathPoint>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorModel {
    Rgb,
    Cmyk,
    Gray,
}

impl ColorModel {
    fn channels(self) -> usize {
        match self {
            ColorModel::Rgb => 3,
            ColorModel::Cmyk => 4,
            ColorModel::Gray => 1,
        }
    }
}

/// Werte 0..1, Graustufen 0 = schwarz. `spot` = Name einer Volltonfarbe, `values` = ihr Ersatzwert.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(try_from = "RawColor")]
pub struct Color {
    pub model: ColorModel,
    pub values: Vec<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub spot: Option<String>,
}

#[derive(Deserialize)]
struct RawColor {
    model: ColorModel,
    values: Vec<f64>,
    #[serde(default)]
    spot: Option<String>,
}

impl TryFrom<RawColor> for Color {
    type Error = String;

    fn try_from(raw: RawColor) -> Result<Self, String> {
        if raw.values.len() != raw.model.channels() {
            return Err(format!(
                "Farbmodell {:?} braucht {} Werte.",
                raw.model,
                raw.model.channels()
            ));
        }
        if !raw.values.iter().all(|v| (0.0..=1.0).contains(v)) {
            return Err("Farbwerte müssen zwischen 0 und 1 liegen.".into());
        }
        Ok(Color {
            model: raw.model,
            values: raw.values,
            spot: raw.spot,
        })
    }
}

impl Color {
    pub fn rgb(r: f64, g: f64, b: f64) -> Self {
        Color {
            model: ColorModel::Rgb,
            values: vec![r, g, b],
            spot: None,
        }
    }

    pub fn cmyk(c: f64, m: f64, y: f64, k: f64) -> Self {
        Color {
            model: ColorModel::Cmyk,
            values: vec![c, m, y, k],
            spot: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GradientStop {
    pub offset: f64,
    pub color: Color,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GradientKind {
    Linear,
    Radial,
}

/// Objekt-Koordinaten. Linear: from → to. Radial: Mitte from, Radius |to − from|.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Gradient {
    pub kind: GradientKind,
    pub from: Point,
    pub to: Point,
    pub stops: Vec<GradientStop>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum Fill {
    Gradient(Gradient),
    Color(Color),
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Cap {
    Butt,
    Round,
    Square,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Join {
    Miter,
    Round,
    Bevel,
}

/// Breite in Seiten-mm, unverzerrt (wie renderer.ts zeichnet).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Stroke {
    pub color: Color,
    pub width: f64,
    pub cap: Cap,
    pub join: Join,
    /// Strich, Lücke, … in Seiten-mm; leer = durchgehend.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dash: Vec<f64>,
}

impl Stroke {
    /// Zeichenbares Strichmuster, sonst None = durchgehend.
    pub fn dash_pattern(&self) -> Option<&[f64]> {
        dash_pattern(&self.dash)
    }
}

/// Strichmuster mit gerader Anzahl, nicht negativ und nicht alles 0, sonst None.
pub fn dash_pattern(d: &[f64]) -> Option<&[f64]> {
    let ok = d.len() >= 2
        && d.len() % 2 == 0
        && d.iter().all(|x| x.is_finite() && *x >= 0.0)
        && d.iter().sum::<f64>() > 0.0;
    ok.then_some(d)
}

/// Abweichung von nonzero; Kombinieren erzeugt gerade/ungerade (Überlappung = Loch).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub enum FillRule {
    #[serde(rename = "evenodd")]
    EvenOdd,
}

fn opaque() -> f64 {
    1.0
}

fn is_opaque(o: &f64) -> bool {
    *o >= 1.0
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    Path {
        matrix: Mat,
        subpaths: Vec<Subpath>,
        fill: Option<Fill>,
        stroke: Option<Stroke>,
        /// fehlt = nonzero
        #[serde(default, rename = "fillRule", skip_serializing_if = "Option::is_none")]
        fill_rule: Option<FillRule>,
        /// Deckkraft 0–1, gilt für Füllung und Kontur je einzeln; fehlt = 1.
        #[serde(default = "opaque", skip_serializing_if = "is_opaque")]
        opacity: f64,
    },
    /// Bild füllt die Box (0, 0)–(width, height); `image` = Hash in der Bildablage.
    Image {
        matrix: Mat,
        width: f64,
        height: f64,
        image: String,
        /// Deckkraft 0–1 (Oberfläche: Transparenz in %); fehlt = 1.
        #[serde(default = "opaque", skip_serializing_if = "is_opaque")]
        opacity: f64,
    },
    Group {
        matrix: Mat,
        children: Vec<Item>,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Scene {
    pub width: f64,
    pub height: f64,
    pub items: Vec<Item>,
}

/// Pfade und Bilder in Zeichenreihenfolge mit Weltmatrix (Gruppen aufgelöst).
pub fn leaves(items: &[Item]) -> Vec<(Mat, &Item)> {
    fn visit<'a>(items: &'a [Item], parent: &Mat, out: &mut Vec<(Mat, &'a Item)>) {
        for it in items {
            match it {
                Item::Group { matrix, children } => visit(children, &mul(parent, matrix), out),
                Item::Path { matrix, .. } | Item::Image { matrix, .. } => {
                    out.push((mul(parent, matrix), it))
                }
            }
        }
    }
    let mut out = Vec::new();
    visit(items, &IDENTITY, &mut out);
    out
}

pub enum Seg {
    Line(Point),
    Cubic(Point, Point, Point),
}

/// Segmente wie segmentAt in bezier.ts: i → i+1, geschlossen auch letzter → erster; Gerade ohne Anfasser.
pub fn segments(sp: &Subpath) -> Vec<Seg> {
    let n = sp.nodes.len();
    let count = if n < 2 {
        0
    } else if sp.closed {
        n
    } else {
        n - 1
    };
    (0..count)
        .map(|i| {
            let (p, q) = (&sp.nodes[i], &sp.nodes[(i + 1) % n]);
            let end = Point { x: q.x, y: q.y };
            match (p.handle_out, q.handle_in) {
                (None, None) => Seg::Line(end),
                (a, b) => Seg::Cubic(a.unwrap_or(Point { x: p.x, y: p.y }), b.unwrap_or(end), end),
            }
        })
        .collect()
}
