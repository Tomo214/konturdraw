//! Umriss farbig (5d): Bild → höchstens N Farben (k-means über ein 15-bit-Farbhistogramm, ohne Zufall) →
//! Flecken unter `speckle` Pixeln nehmen die häufigste Nachbarfarbe an → je Farbe die Umrisse (visioncortex).
use super::{cluster_paths, Background, Params, Piece};
use image::RgbaImage;
use visioncortex::BinaryImage;

type Rgb = [f64; 3];

fn bin(p: [u8; 3]) -> usize {
    (usize::from(p[0] >> 3) << 10) | (usize::from(p[1] >> 3) << 5) | usize::from(p[2] >> 3)
}

fn d2(a: Rgb, b: Rgb) -> f64 {
    (0..3).map(|c| (a[c] - b[c]).powi(2)).sum()
}

fn nearest(centers: &[Rgb], c: Rgb) -> usize {
    (0..centers.len()).min_by(|&a, &b| d2(centers[a], c).total_cmp(&d2(centers[b], c))).unwrap_or(0)
}

/// Transparenz zählt als Papier (wie beim Schwellwert).
fn flatten(img: &RgbaImage) -> Vec<[u8; 3]> {
    img.pixels()
        .map(|p| {
            let a = u32::from(p.0[3]);
            let f = |c: u8| ((u32::from(c) * a + 255 * (255 - a)) / 255) as u8;
            [f(p.0[0]), f(p.0[1]), f(p.0[2])]
        })
        .collect()
}

/// Palette (0–255) + Fach → Farbindex. Vertreter einer Farbe = Mittel ihres häufigsten Fachs:
/// flache Logo-Farben bleiben exakt, Kantenpixel ziehen sie nicht ins Graue.
fn quantize(px: &[[u8; 3]], k: usize) -> (Vec<Rgb>, Vec<u16>) {
    let mut bins = vec![(0u64, [0u64; 3]); 1 << 15];
    for p in px {
        let b = &mut bins[bin(*p)];
        b.0 += 1;
        (0..3).for_each(|c| b.1[c] += u64::from(p[c]));
    }
    let used: Vec<usize> = (0..bins.len()).filter(|&i| bins[i].0 > 0).collect();
    let col: Vec<Rgb> = used.iter().map(|&i| bins[i].1.map(|s| s as f64 / bins[i].0 as f64)).collect();
    let w: Vec<f64> = used.iter().map(|&i| bins[i].0 as f64).collect();
    let argmax = |v: &mut dyn Iterator<Item = f64>| v.enumerate().max_by(|a, b| a.1.total_cmp(&b.1)).map_or(0, |e| e.0);

    // Start wie k-means++ ohne Zufall: häufigste Farbe, dann jeweils größtes Gewicht × Abstand²
    let mut centers = vec![col[argmax(&mut w.iter().copied())]];
    let mut gap: Vec<f64> = col.iter().map(|&c| d2(c, centers[0])).collect();
    while centers.len() < k.max(1) {
        let j = argmax(&mut gap.iter().zip(&w).map(|(g, w)| g * w));
        if gap[j] == 0.0 {
            break;
        }
        centers.push(col[j]);
        gap.iter_mut().zip(&col).for_each(|(g, &c)| *g = g.min(d2(c, col[j])));
    }
    let mut assign: Vec<usize> = col.iter().map(|&c| nearest(&centers, c)).collect();
    for _ in 0..20 {
        let mut acc = vec![(0.0, [0.0; 3]); centers.len()];
        for (i, &a) in assign.iter().enumerate() {
            acc[a].0 += w[i];
            (0..3).for_each(|c| acc[a].1[c] += col[i][c] * w[i]);
        }
        for (ctr, (n, s)) in centers.iter_mut().zip(acc) {
            if n > 0.0 {
                *ctr = s.map(|v| v / n);
            }
        }
        let next: Vec<usize> = col.iter().map(|&c| nearest(&centers, c)).collect();
        if next == assign {
            break;
        }
        assign = next;
    }
    // leere Farben fallen weg; Vertreter = häufigstes Fach
    let mut best: Vec<Option<usize>> = vec![None; centers.len()];
    for (i, &a) in assign.iter().enumerate() {
        if best[a].is_none_or(|b| w[i] > w[b]) {
            best[a] = Some(i);
        }
    }
    let mut index = vec![0u16; centers.len()];
    let mut palette = vec![];
    for (a, b) in best.iter().enumerate() {
        if let Some(b) = b {
            index[a] = palette.len() as u16;
            palette.push(col[*b]);
        }
    }
    let mut lut = vec![0u16; bins.len()];
    for (i, &u) in used.iter().enumerate() {
        lut[u] = index[assign[i]];
    }
    (palette, lut)
}

/// Flächen unter `min` Pixeln (4er-Nachbarschaft) nehmen die häufigste angrenzende Farbe an.
fn despeckle(labels: &mut [u16], w: usize, h: usize, min: usize) {
    let mut seen = vec![false; w * h];
    let (mut stack, mut comp, mut around) = (vec![], vec![], Vec::<(u16, u32)>::new());
    for start in 0..w * h {
        if seen[start] {
            continue;
        }
        let l = labels[start];
        seen[start] = true;
        stack.push(start);
        comp.clear();
        around.clear();
        while let Some(i) = stack.pop() {
            comp.push(i);
            let (x, y) = (i % w, i / w);
            for (ok, j) in [(x > 0, i.wrapping_sub(1)), (x + 1 < w, i + 1), (y > 0, i.wrapping_sub(w)), (y + 1 < h, i + w)] {
                if !ok {
                    continue;
                }
                if labels[j] == l {
                    if !seen[j] {
                        seen[j] = true;
                        stack.push(j);
                    }
                } else if comp.len() < min {
                    match around.iter_mut().find(|e| e.0 == labels[j]) {
                        Some(e) => e.1 += 1,
                        None => around.push((labels[j], 1)),
                    }
                }
            }
        }
        if comp.len() < min {
            if let Some(&(to, _)) = around.iter().max_by_key(|e| e.1) {
                comp.iter().for_each(|&i| labels[i] = to);
            }
        }
    }
}

/// Teile von unten nach oben in Pixeln: Hintergrund (häufigste Randfarbe) zuerst, dann nach Fläche.
/// Gestapelt deckt jede Farbe auch die Flächen aller späteren mit ab – keine Spalten zwischen Nachbarn.
pub(super) fn pieces(img: &RgbaImage, p: &Params) -> Vec<Piece> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let px = flatten(img);
    let (palette, lut) = quantize(&px, p.colors.clamp(2, 256));
    let mut labels: Vec<u16> = px.iter().map(|&c| lut[bin(c)]).collect();
    despeckle(&mut labels, w, h, p.speckle);

    let mut count = vec![0usize; palette.len()];
    labels.iter().for_each(|&l| count[l as usize] += 1);
    let mut rim = vec![0usize; palette.len()];
    for i in (0..w * h).filter(|i| i % w == 0 || i % w == w - 1 || i / w == 0 || i / w == h - 1) {
        rim[labels[i] as usize] += 1;
    }
    let bg = (0..palette.len()).max_by_key(|&l| rim[l]).unwrap_or(0);
    let mut order: Vec<usize> = (0..palette.len()).filter(|&l| count[l] > 0 && l != bg).collect();
    order.sort_by_key(|&l| std::cmp::Reverse(count[l]));
    order.insert(0, bg);
    let mut rank = vec![0usize; palette.len()];
    order.iter().enumerate().for_each(|(k, &l)| rank[l] = k);

    // jede Farblage für sich: parallel auf allen Kernen, Reihenfolge bleibt
    let layer = |k: usize, l: usize| -> Vec<Piece> {
        let edge_only = k == 0 && p.background == Background::Edge;
        if k == 0 && p.background == Background::All {
            return vec![];
        }
        let stacked = !p.cutout && !edge_only;
        let mut mask = BinaryImage::new_w_h(w, h);
        for (i, &lab) in labels.iter().enumerate() {
            let r = rank[lab as usize];
            if r == k || (stacked && r > k) {
                mask.set_pixel(i % w, i / w, true);
            }
        }
        let rgb = Some(palette[l].map(|v| v / 255.0));
        let clusters = mask.to_clusters(false);
        // gestapelt nur Flächen mit eigener Farbe: sonst läge unter jeder fremden Insel ein versteckter Doppelgänger
        let own = |c: &visioncortex::clusters::Cluster| c.points.iter().any(|q| rank[labels[q.y as usize * w + q.x as usize] as usize] == k);
        let kept = clusters.iter().filter(|c| {
            let rim = c.rect.left == 0 || c.rect.top == 0 || c.rect.right == w as i32 || c.rect.bottom == h as i32;
            c.size() >= p.speckle && !(edge_only && rim) && (!stacked || own(c))
        });
        let pieces: Vec<Piece> = if p.merge {
            vec![Piece { rgb, subpaths: kept.flat_map(|c| cluster_paths(c, p)).collect() }]
        } else {
            kept.map(|c| Piece { rgb, subpaths: cluster_paths(c, p) }).collect()
        };
        pieces.into_iter().filter(|pc| !pc.subpaths.is_empty()).collect()
    };
    let layers: Vec<Vec<Piece>> = std::thread::scope(|s| {
        let jobs: Vec<_> = order.iter().enumerate().map(|(k, &l)| s.spawn(move || layer(k, l))).collect();
        jobs.into_iter().map(|j| j.join().unwrap_or_else(|e| std::panic::resume_unwind(e))).collect()
    });
    layers.into_iter().flatten().collect()
}
