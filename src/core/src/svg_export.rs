//! SVG-Export: Pfade in Seiten-mm (viewBox = mm), Kontur unverzerrt, Verläufe mit gradientTransform.
use crate::color::{byte, Cms};
use crate::scene::{
    apply, leaves, segments, Cap, Color, Fill, GradientKind, Item, Join, Mat, Scene, Subpath,
};
use crate::Images;
use base64::Engine;
use std::fmt::Write;

/// Zahl mit höchstens 4 Nachkommastellen (0,1 µm), ohne überflüssige Nullen.
pub(crate) fn num(v: f64) -> String {
    let s = format!("{:.4}", v);
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" {
        "0".into()
    } else {
        s.into()
    }
}

fn hex(c: &Color, cms: &Cms) -> String {
    let [r, g, b] = cms.srgb(c).map(byte);
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn mat(m: &Mat) -> String {
    format!("matrix({})", m.map(num).join(" "))
}

/// Pfaddaten in Seitenkoordinaten.
pub(crate) fn path_data(m: &Mat, subpaths: &[Subpath]) -> String {
    let mut d = String::new();
    let pt = |p| {
        let q = apply(m, p);
        format!("{} {}", num(q.x), num(q.y))
    };
    for sp in subpaths {
        let Some(first) = sp.nodes.first() else {
            continue;
        };
        let _ = write!(
            d,
            "M{}",
            pt(crate::scene::Point {
                x: first.x,
                y: first.y
            })
        );
        let segs = segments(sp);
        let last = segs.len().saturating_sub(1);
        for (i, s) in segs.into_iter().enumerate() {
            match s {
                // Schließende Gerade übernimmt Z.
                crate::scene::Seg::Line(_) if sp.closed && i == last => {}
                crate::scene::Seg::Line(p) => d += &format!("L{}", pt(p)),
                crate::scene::Seg::Cubic(a, b, p) => {
                    d += &format!("C{} {} {}", pt(a), pt(b), pt(p))
                }
            }
        }
        if sp.closed {
            d += "Z";
        }
    }
    d
}

pub fn export(scene: &Scene, images: &Images, cms: &Cms) -> Result<String, String> {
    let (w, h) = (num(scene.width), num(scene.height));
    let mut defs = String::new();
    let mut body = String::new();
    for (i, (m, it)) in leaves(&scene.items).into_iter().enumerate() {
        match it {
            Item::Path {
                subpaths,
                fill,
                stroke,
                fill_rule,
                opacity,
                ..
            } => {
                // Füllung und Kontur je einzeln abgedeckt (wie Leinwand/PNG/PDF).
                let alpha = if *opacity < 1.0 {
                    format!(r#" fill-opacity="{0}" stroke-opacity="{0}""#, num(*opacity))
                } else {
                    String::new()
                };
                let rule = if fill_rule.is_some() {
                    r#" fill-rule="evenodd""#
                } else {
                    ""
                };
                let fill = match fill {
                    None => "none".to_string(),
                    Some(Fill::Color(c)) => hex(c, cms),
                    Some(Fill::Gradient(g)) => {
                        let stops: String = g
                            .stops
                            .iter()
                            .map(|s| {
                                format!(
                                    r#"<stop offset="{}" stop-color="{}"/>"#,
                                    num(s.offset),
                                    hex(&s.color, cms)
                                )
                            })
                            .collect();
                        let (a, b) = (g.from, g.to);
                        let geo = match g.kind {
                            GradientKind::Linear => format!(
                                r#"linearGradient id="g{i}" x1="{}" y1="{}" x2="{}" y2="{}""#,
                                num(a.x),
                                num(a.y),
                                num(b.x),
                                num(b.y)
                            ),
                            GradientKind::Radial => {
                                let r = num((b.x - a.x).hypot(b.y - a.y));
                                format!(
                                    r#"radialGradient id="g{i}" cx="{0}" cy="{1}" fx="{0}" fy="{1}" r="{r}""#,
                                    num(a.x),
                                    num(a.y)
                                )
                            }
                        };
                        let tag = geo.split(' ').next().unwrap_or_default();
                        let _ = write!(
                            defs,
                            r#"<{geo} gradientUnits="userSpaceOnUse" gradientTransform="{}">{stops}</{tag}>"#,
                            mat(&m)
                        );
                        format!("url(#g{i})")
                    }
                };
                let stroke = match stroke {
                    None => String::new(),
                    Some(s) => {
                        let cap = match s.cap {
                            Cap::Butt => "butt",
                            Cap::Round => "round",
                            Cap::Square => "square",
                        };
                        let join = match s.join {
                            Join::Miter => "miter",
                            Join::Round => "round",
                            Join::Bevel => "bevel",
                        };
                        let dash = s.dash_pattern().map_or(String::new(), |d| {
                            let list: Vec<String> = d.iter().map(|x| num(*x)).collect();
                            format!(r#" stroke-dasharray="{}""#, list.join(" "))
                        });
                        format!(
                            r#" stroke="{}" stroke-width="{}" stroke-linecap="{cap}" stroke-linejoin="{join}" stroke-miterlimit="10"{dash}"#,
                            hex(&s.color, cms),
                            num(s.width)
                        )
                    }
                };
                let _ = writeln!(
                    body,
                    r#"<path d="{}" fill="{fill}"{rule}{stroke}{alpha}/>"#,
                    path_data(&m, subpaths)
                );
            }
            Item::Image {
                width,
                height,
                image,
                opacity,
                ..
            } => {
                let png = images
                    .get(image)
                    .ok_or_else(|| format!("Bild {image} fehlt in der Ablage."))?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(png);
                let alpha = if *opacity < 1.0 {
                    format!(r#" opacity="{}""#, num(*opacity))
                } else {
                    String::new()
                };
                let _ = writeln!(
                    body,
                    r#"<image width="{}" height="{}" preserveAspectRatio="none" transform="{}"{alpha} href="data:image/png;base64,{b64}"/>"#,
                    num(*width),
                    num(*height),
                    mat(&m)
                );
            }
            Item::Group { .. } => unreachable!("leaves löst Gruppen auf"),
        }
    }
    let defs = if defs.is_empty() {
        defs
    } else {
        format!("<defs>{defs}</defs>\n")
    };
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}mm\" height=\"{h}mm\" viewBox=\"0 0 {w} {h}\">\n{defs}{body}</svg>\n"
    ))
}
