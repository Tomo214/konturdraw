//! Verdünnung nach Zhang/Suen (CACM 27(3), 1984), danach Treppenstufen weg: übrig bleibt ein 8-zusammenhängendes,
//! 1 px breites Skelett. Raster mit 1 px freiem Rand, damit Nachbarzugriffe ohne Prüfung gehen.
use visioncortex::BinaryImage;

pub(super) struct Grid {
    pub w: usize,
    pub px: Vec<bool>,
}

impl Grid {
    /// Nur Flecken ab `speckle` Pixeln.
    pub fn new(img: &BinaryImage, speckle: usize) -> Self {
        let w = img.width + 2;
        let mut px = vec![false; w * (img.height + 2)];
        for c in img
            .to_clusters(false)
            .iter()
            .filter(|c| c.size() >= speckle)
        {
            for p in c.iter() {
                px[(p.y as usize + 1) * w + p.x as usize + 1] = true;
            }
        }
        Grid { w, px }
    }

    pub fn count(&self) -> usize {
        self.px.iter().filter(|&&b| b).count()
    }

    /// Nachbarn ab Norden im Uhrzeigersinn (P2…P9 bei Zhang/Suen).
    pub fn offsets(&self) -> [isize; 8] {
        let w = self.w as isize;
        [-w, -w + 1, 1, w + 1, w, w - 1, -1, -w - 1]
    }

    pub fn at(&self, i: usize, o: isize) -> usize {
        (i as isize + o) as usize
    }

    pub fn nbrs(&self, i: usize) -> [bool; 8] {
        self.offsets().map(|o| self.px[self.at(i, o)])
    }

    /// Pixelmitte in Bildkoordinaten (ohne Rand).
    pub fn pos(&self, i: usize) -> (f64, f64) {
        ((i % self.w) as f64 - 0.5, (i / self.w) as f64 - 0.5)
    }
}

fn zhang_suen(n: &[bool; 8], step: usize) -> bool {
    let b = n.iter().filter(|&&v| v).count();
    let a = (0..8).filter(|&i| !n[i] && n[(i + 1) % 8]).count();
    let [p2, _, p4, _, p6, _, p8, _] = *n;
    let keep = if step == 0 {
        (p2 && p4 && p6) || (p4 && p6 && p8)
    } else {
        (p2 && p4 && p8) || (p2 && p6 && p8)
    };
    (2..=6).contains(&b) && a == 1 && !keep
}

/// 8-einfach (Yokoi-Zusammenhangszahl = 1): Entfernen ändert weder Zusammenhang noch Löcher.
fn simple(n: &[bool; 8]) -> bool {
    let c = |i: usize| i32::from(!n[i % 8]);
    (0..4)
        .map(|k| 2 * k)
        .map(|k| c(k) - c(k) * c(k + 1) * c(k + 2))
        .sum::<i32>()
        == 1
}

pub(super) fn thin(g: &mut Grid) {
    let offs = g.offsets();
    // Nur Randpixel und Nachbarn gelöschter Pixel prüfen: Aufwand ~ Fläche statt Fläche × Durchläufe.
    let mut cand: Vec<usize> = (0..g.px.len())
        .filter(|&i| g.px[i] && g.nbrs(i).contains(&false))
        .collect();
    let mut mark = vec![false; g.px.len()];
    for &i in &cand {
        mark[i] = true;
    }
    loop {
        let mut changed = false;
        for step in 0..2 {
            let del: Vec<usize> = cand
                .iter()
                .copied()
                .filter(|&i| zhang_suen(&g.nbrs(i), step))
                .collect();
            for &i in &del {
                g.px[i] = false;
            }
            for &i in &del {
                for o in offs {
                    let j = g.at(i, o);
                    if g.px[j] && !mark[j] {
                        mark[j] = true;
                        cand.push(j);
                    }
                }
            }
            cand.retain(|&i| g.px[i]);
            changed |= !del.is_empty();
        }
        if !changed {
            break;
        }
    }
    // Zhang/Suen lässt 4-zusammenhängende Ecken stehen; Enden (1 Nachbar) bleiben.
    loop {
        let mut changed = false;
        for &i in &cand {
            let n = g.nbrs(i);
            if g.px[i] && n.iter().filter(|&&b| b).count() >= 2 && simple(&n) {
                g.px[i] = false;
                changed = true;
            }
        }
        cand.retain(|&i| g.px[i]);
        if !changed {
            break;
        }
    }
}
