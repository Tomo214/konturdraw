//! Eine Schrift in einer Größe: Zeile formen (harfrust), Maße und Glyphen-Umrisse (skrifa).
use crate::scene::Subpath;
use crate::svg_import::subpaths;
use harfrust::{Direction, ShapeOptions, ShaperData, UnicodeBuffer};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::prelude::{LocationRef, Size};
use skrifa::{FontRef, GlyphId, MetadataProvider};
use usvg::tiny_skia_path as tsp;

/// Geformte Glyphe in mm, x ab Zeilenanfang; cluster = Byte im geformten Text.
#[derive(Clone, Debug)]
pub(super) struct Shaped {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub advance: f64,
    pub cluster: usize,
}

pub(super) struct Face<'a> {
    font: FontRef<'a>,
    data: ShaperData,
    /// mm je Schrifteinheit
    scale: f64,
    pub ascent: f64,
    pub descent: f64,
    pub line_height: f64,
    pub space: f64,
}

impl<'a> Face<'a> {
    pub fn new(bytes: &'a [u8], index: u32, size_mm: f64) -> Result<Self, String> {
        let font = FontRef::from_index(bytes, index).map_err(|e| format!("Schrift defekt: {e}"))?;
        let m = font.metrics(Size::unscaled(), LocationRef::default());
        let scale = size_mm / f64::from(m.units_per_em.max(1));
        let data = ShaperData::new(&font);
        let mut face = Face {
            font,
            data,
            scale,
            ascent: f64::from(m.ascent) * scale,
            descent: -f64::from(m.descent) * scale,
            line_height: f64::from(m.ascent - m.descent + m.leading) * scale,
            space: 0.0,
        };
        face.space = face.shape(" ", 0.0).first().map_or(0.0, |s| s.advance);
        Ok(face)
    }

    /// Eine Zeile links nach rechts; Laufweite nach jeder Glyphe mit Vorschub.
    pub fn shape(&self, text: &str, tracking: f64) -> Vec<Shaped> {
        let mut buf = UnicodeBuffer::new();
        buf.push_str(text);
        buf.set_direction(Direction::LeftToRight);
        buf.guess_segment_properties();
        let out = self
            .data
            .shaper(&self.font)
            .build()
            .shape(buf, ShapeOptions::new());
        let mut pen = 0.0;
        let mut glyphs = Vec::with_capacity(out.len());
        for (info, pos) in out.glyph_infos().iter().zip(out.glyph_positions()) {
            let advance = f64::from(pos.x_advance) * self.scale;
            glyphs.push(Shaped {
                id: info.glyph_id,
                x: pen + f64::from(pos.x_offset) * self.scale,
                y: -f64::from(pos.y_offset) * self.scale,
                advance,
                cluster: info.cluster as usize,
            });
            pen += advance + if pos.x_advance != 0 { tracking } else { 0.0 };
        }
        glyphs
    }

    /// Umriss in mm: Ursprung (x, y) auf der Grundlinie, gedreht um angle.
    pub fn outline(&self, id: u32, x: f64, y: f64, angle: f64) -> Vec<Subpath> {
        let Some(glyph) = self.font.outline_glyphs().get(GlyphId::new(id)) else {
            return vec![];
        };
        let mut pen = Pen(tsp::PathBuilder::new());
        if glyph
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut pen,
            )
            .is_err()
        {
            return vec![];
        }
        let Some(path) = pen.0.finish() else {
            return vec![];
        };
        // Schrifteinheiten (y oben) → mm (y unten), drehen, an den Ursprung
        let (c, s) = (
            (angle.cos() * self.scale) as f32,
            (angle.sin() * self.scale) as f32,
        );
        let ts = tsp::Transform::from_row(c, s, s, -c, x as f32, y as f32);
        path.transform(ts).map(|p| subpaths(&p)).unwrap_or_default()
    }
}

struct Pen(tsp::PathBuilder);

impl OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to(x, y);
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.0.quad_to(cx0, cy0, x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.0.cubic_to(cx0, cy0, cx1, cy1, x, y);
    }
    fn close(&mut self) {
        self.0.close();
    }
}
