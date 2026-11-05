//! Text (Spec §10): Grafiktext, Fließtext im Rahmen, Text auf Pfad → Glyphenlage + Umriss in mm.
//! Formen mit harfrust, Konturen mit skrifa, Schriften aus fontdb (alle schon über usvg im Baum).
mod face;
mod on_path;

use crate::scene::Subpath;
use face::{Face, Shaped};
use serde::{Deserialize, Serialize};
use std::ops::Range;
use std::sync::{Arc, OnceLock};
use usvg::fontdb::{self, Database};

#[derive(Deserialize, Clone, Debug)]
pub struct FontSpec {
    pub family: String,
    pub weight: u16,
    pub italic: bool,
    /// pt
    pub size: f64,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Align {
    Left,
    Center,
    Right,
}

/// Fließtext-Rahmen, mm; Ursprung = linke obere Ecke.
#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Frame {
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Above,
    /// Andere Seite: läuft gegen die Pfadrichtung
    Below,
}

/// Pfad in Textkoordinaten; offset = Startversatz entlang, distance = Abstand quer zum Pfad (mm).
#[derive(Deserialize, Clone, Debug)]
pub struct OnPath {
    pub path: Subpath,
    pub offset: f64,
    pub distance: f64,
    pub side: Side,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TextSpec {
    pub text: String,
    pub font: FontSpec,
    /// Laufweite in % der Leerzeichenbreite
    pub tracking: f64,
    /// % der natürlichen Zeilenhöhe der Schrift
    pub line_spacing: f64,
    pub align: Align,
    #[serde(default)]
    pub frame: Option<Frame>,
    #[serde(default)]
    pub on_path: Option<OnPath>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PlacedGlyph {
    /// Ursprung auf der Grundlinie, mm
    pub x: f64,
    pub y: f64,
    /// Bogenmaß; y nach unten → positiv = im Uhrzeigersinn
    pub angle: f64,
    pub advance: f64,
    /// Stelle im Text in UTF-16-Einheiten (wie selectionStart im Textfeld)
    pub index: usize,
}

/// Zeile: Grundlinie, Breite ohne Leerzeichen am Ende, Textbereich in UTF-16-Einheiten.
#[derive(Serialize, Clone, Debug)]
pub struct Line {
    pub baseline: f64,
    pub x0: f64,
    pub x1: f64,
    pub start: usize,
    pub end: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct Layout {
    pub glyphs: Vec<PlacedGlyph>,
    pub lines: Vec<Line>,
    pub outline: Vec<Subpath>,
    /// Ober-/Unterlänge der Schrift, mm, beide positiv
    pub ascent: f64,
    pub descent: f64,
    /// Fließtext passt nicht in den Rahmen
    pub overflow: bool,
}

/// Systemschriften, einmal geladen (auch für SVG-Import).
pub fn system_fonts() -> Arc<Database> {
    static DB: OnceLock<Arc<Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = Database::new();
        db.load_system_fonts();
        Arc::new(db)
    })
    .clone()
}

/// Familiennamen sortiert, jeder einmal (für die Schriftauswahl).
pub fn families(db: &Database) -> Vec<String> {
    let mut out: Vec<String> = db
        .faces()
        .filter_map(|f| f.families.first().map(|(name, _)| name.clone()))
        .collect();
    out.sort_by_key(|s| s.to_lowercase());
    out.dedup();
    out
}

pub fn layout(db: &Database, spec: &TextSpec) -> Result<Layout, String> {
    let f = &spec.font;
    let style = if f.italic {
        fontdb::Style::Italic
    } else {
        fontdb::Style::Normal
    };
    let query = fontdb::Query {
        families: &[fontdb::Family::Name(&f.family)],
        weight: fontdb::Weight(f.weight),
        stretch: fontdb::Stretch::Normal,
        style,
    };
    let id = db
        .query(&query)
        .ok_or_else(|| format!("Schrift nicht gefunden: {}", f.family))?;
    db.with_face_data(id, |data, index| {
        let face = Face::new(data, index, f.size * 25.4 / 72.0)?;
        Ok(match &spec.on_path {
            Some(p) => on_path::place(&face, spec, p),
            None => block(&face, spec),
        })
    })
    .unwrap_or_else(|| Err(format!("Schrift nicht lesbar: {}", f.family)))
}

/// Byte → UTF-16-Stelle (gültig an Zeichengrenzen).
fn utf16_table(s: &str) -> Vec<usize> {
    let mut t = vec![0; s.len() + 1];
    let mut n = 0;
    for (b, ch) in s.char_indices() {
        t[b] = n;
        n += ch.len_utf16();
    }
    t[s.len()] = n;
    t
}

/// Rechte Kante der letzten sichtbaren Glyphe (Leerzeichen am Zeilenende zählen nicht).
fn line_width(g: &[Shaped], text: &str) -> f64 {
    let x0 = g.first().map_or(0.0, |s| s.x);
    g.iter()
        .rev()
        .find(|s| !text[s.cluster..].starts_with(' '))
        .map_or(0.0, |s| s.x + s.advance - x0)
}

/// Gieriger Umbruch an Leerzeichen; ein Wort länger als die Breite bleibt ganz.
fn wrap(g: &[Shaped], text: &str, width: Option<f64>) -> Vec<Range<usize>> {
    let Some(w) = width else {
        return std::iter::once(0..g.len()).collect();
    };
    let space = |i: usize| text[g[i].cluster..].starts_with(' ');
    let (mut out, mut start, mut word) = (Vec::new(), 0, 0);
    for i in 0..g.len() {
        if i > 0 && !space(i) && space(i - 1) {
            word = i;
        }
        if !space(i) && word > start && g[i].x + g[i].advance - g[start].x > w + 1e-9 {
            out.push(start..word);
            start = word;
        }
    }
    out.push(start..g.len());
    out
}

/// Grafiktext (erste Grundlinie bei y = 0) oder Fließtext (Rahmen oben links bei 0,0).
fn block(face: &Face, spec: &TextSpec) -> Layout {
    let track = spec.tracking / 100.0 * face.space;
    let u16 = utf16_table(&spec.text);
    // Zeilen: Absatzanfang (Byte), Glyphen relativ zum Absatz, Textbereich in Bytes
    let mut rows: Vec<(usize, Vec<Shaped>, Range<usize>)> = Vec::new();
    let mut at = 0;
    for para in spec.text.split('\n') {
        let g = face.shape(para, track);
        let parts = wrap(&g, para, spec.frame.map(|f| f.width));
        let n = parts.len();
        for (k, r) in parts.into_iter().enumerate() {
            let start = if k == 0 { 0 } else { g[r.start].cluster };
            let end = if k + 1 == n {
                para.len()
            } else {
                g[r.end].cluster
            };
            rows.push((at, g[r].to_vec(), at + start..at + end));
        }
        at += para.len() + 1;
    }
    let widths: Vec<f64> = rows
        .iter()
        .map(|(p, g, _)| line_width(g, &spec.text[*p..]))
        .collect();
    let full = spec
        .frame
        .map_or_else(|| widths.iter().cloned().fold(0.0, f64::max), |f| f.width);
    let share = match spec.align {
        Align::Left => 0.0,
        Align::Center => 0.5,
        Align::Right => 1.0,
    };
    let step = face.line_height * spec.line_spacing / 100.0;
    let top = if spec.frame.is_some() {
        face.ascent
    } else {
        0.0
    };
    let mut out = Layout {
        glyphs: vec![],
        lines: vec![],
        outline: vec![],
        ascent: face.ascent,
        descent: face.descent,
        overflow: false,
    };
    for (k, ((para, g, bytes), w)) in rows.iter().zip(&widths).enumerate() {
        let (x0, baseline) = ((full - w) * share, top + k as f64 * step);
        let dx = x0 - g.first().map_or(0.0, |s| s.x);
        for s in g {
            out.glyphs.push(PlacedGlyph {
                x: s.x + dx,
                y: baseline + s.y,
                angle: 0.0,
                advance: s.advance,
                index: u16[para + s.cluster],
            });
            out.outline
                .extend(face.outline(s.id, s.x + dx, baseline + s.y, 0.0));
        }
        out.lines.push(Line {
            baseline,
            x0,
            x1: x0 + w,
            start: u16[bytes.start],
            end: u16[bytes.end],
        });
    }
    if let (Some(f), Some(last)) = (spec.frame, out.lines.last()) {
        out.overflow = last.baseline + face.descent > f.height + 1e-9;
    }
    out
}
