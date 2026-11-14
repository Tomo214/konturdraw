//! Druck in Kacheln: Seite größer als das Papier → eine PDF-Seite je Blatt, Inhalt 1:1, dazu Passkreuze und
//! Blattname. Die Aufteilung rechnet das Frontend (src/model/tiles.ts); hier nur die Ausgabe.
use super::*;
use pdf_writer::Str;
use serde::Deserialize;

/// Blätter in mm: Papier, Rand (nicht bedruckt), bedruckbare Fläche je Blatt, halbe Kreuzgröße.
#[derive(Clone, Debug, Deserialize)]
pub struct Sheets {
    pub paper: [f64; 2],
    pub margin: f64,
    pub area: [f64; 2],
    pub mark: f64,
    pub tiles: Vec<Sheet>,
}

/// Ausschnitt ab Seitenpunkt (x, y), Blattname (leer = keiner) und Passkreuze in Seitenkoordinaten.
#[derive(Clone, Debug, Deserialize)]
pub struct Sheet {
    pub x: f64,
    pub y: f64,
    pub label: String,
    pub marks: Vec<Point>,
}

/// Schriftgröße des Blattnamens in pt.
const LABEL: f32 = 7.0;

pub fn tiled(scene: &Scene, images: &Images, cms: &Cms, s: &Sheets) -> Result<Vec<u8>, String> {
    let mut w = Writer {
        pdf: Pdf::new(),
        ids: Ids(0),
        out: Out {
            cms,
            cmyk: cms.mode == ColorMode::Cmyk,
        },
        images,
        res: Res::default(),
        tiles: Vec::new(),
    };
    let (catalog, tree, font) = (w.ids.next(), w.ids.next(), w.ids.next());
    let (pw, ph) = ((s.paper[0] * PT) as f32, (s.paper[1] * PT) as f32);
    let n = s.tiles.len();
    let mut contents = Vec::with_capacity(n);
    for (i, t) in s.tiles.iter().enumerate() {
        let mut c = Content::new();
        // Seite in mm, y nach unten; Seitenpunkt (x, y) liegt in der Ecke der bedruckbaren Fläche.
        let base = [PT, 0.0, 0.0, -PT, (s.margin - t.x) * PT, ph as f64 - (s.margin - t.y) * PT];
        c.save_state();
        c.transform(mat(&base));
        let (x1, y1) = ((t.x + s.area[0]).min(scene.width), (t.y + s.area[1]).min(scene.height));
        c.rect(t.x as f32, t.y as f32, (x1 - t.x) as f32, (y1 - t.y) as f32);
        c.clip_nonzero().end_path();
        w.draw(&mut c, &scene.items, &base)?;
        c.restore_state();
        if !t.marks.is_empty() {
            c.save_state();
            c.transform(mat(&base));
            c.set_stroke_gray(0.0).set_line_width(0.2);
            let (r, f) = (s.mark, |v: f64| v as f32);
            for p in &t.marks {
                c.move_to(f(p.x - r), f(p.y)).line_to(f(p.x + r), f(p.y));
                c.move_to(f(p.x), f(p.y - r)).line_to(f(p.x), f(p.y + r));
            }
            c.stroke();
            c.restore_state();
        }
        if !t.label.is_empty() {
            let text = format!("{}  {}/{n}", t.label, i + 1);
            let edge = (s.margin * PT) as f32;
            c.set_fill_gray(0.0);
            c.begin_text();
            c.set_font(Name(b"F1"), LABEL);
            c.next_line(edge + 2.0, ph - edge - LABEL - 1.0);
            c.show(Str(text.as_bytes()));
            c.end_text();
        }
        contents.push(c.finish());
    }
    w.write_tiles();

    let Writer {
        mut pdf,
        mut ids,
        out,
        res,
        ..
    } = w;
    pdf.catalog(catalog).pages(tree);
    let pages: Vec<(Ref, Ref)> = (0..n).map(|_| (ids.next(), ids.next())).collect();
    pdf.pages(tree)
        .kids(pages.iter().map(|p| p.0))
        .count(n as i32);
    pdf.type1_font(font).base_font(Name(b"Helvetica"));
    for ((page_id, content_id), data) in pages.into_iter().zip(contents) {
        let mut page = pdf.page(page_id);
        page.media_box(Rect::new(0.0, 0.0, pw, ph))
            .parent(tree)
            .contents(content_id);
        if !res.alphas.is_empty() {
            res::blend_group(&mut page, out.cmyk);
        }
        let mut r = page.resources();
        r.fonts().pair(Name(b"F1"), font);
        res.write(r);
        page.finish();
        let data = compress_to_vec_zlib(&data, 6);
        pdf.stream(content_id, &data).filter(Filter::FlateDecode);
    }
    Ok(pdf.finish())
}
