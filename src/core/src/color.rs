//! Farbumrechnung (architecture.md §10, 3f): Little CMS (lcms2) zwischen sRGB und dem CMYK-Profil des Dokuments.
//! Ohne Profil einfache Formel. Eine Absicht für beide Richtungen, Tiefenkompensierung immer an.
use crate::scene::{Color, ColorModel};
use lcms2::{
    ColorSpaceSignature, Flags, InfoType, Intent, Locale, PixelFormat, Profile,
    ProfileClassSignature, Transform,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum ColorMode {
    #[default]
    Rgb,
    Cmyk,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RenderIntent {
    Perceptual,
    #[default]
    Relative,
    Saturation,
    Absolute,
}

/// Farbeinstellungen des Dokuments (doc.color in TS).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ColorSettings {
    pub mode: ColorMode,
    /// Pfad zum ICC-Profil; None = Systemprofil, das die Tauri-Schale sucht.
    pub cmyk_profile: Option<String>,
    pub intent: RenderIntent,
}

struct Icc {
    name: String,
    bytes: Vec<u8>,
    intent: Intent,
    to_rgb: Transform<[f64; 4], [f64; 3]>,
    to_cmyk: Transform<[f64; 3], [f64; 4]>,
}

/// Umrechner für ein Dokument. Default = kein Profil, RGB-Modus.
#[derive(Default)]
pub struct Cms {
    pub mode: ColorMode,
    icc: Option<Icc>,
}

impl Cms {
    pub fn new(settings: &ColorSettings, icc: Option<&[u8]>) -> Result<Cms, String> {
        let icc = icc.map(|bytes| load(bytes, settings.intent)).transpose()?;
        Ok(Cms {
            mode: settings.mode,
            icc,
        })
    }

    pub fn profile_name(&self) -> Option<&str> {
        self.icc.as_ref().map(|icc| icc.name.as_str())
    }

    /// Das CMYK-Profil selbst, z. B. als Output-Intent im druckfertigen PDF.
    pub fn profile_bytes(&self) -> Option<&[u8]> {
        self.icc.as_ref().map(|icc| icc.bytes.as_slice())
    }

    /// Bildpunkte sRGB (je 3 Byte) → CMYK (je 4 Byte, 255 = volle Farbe), gleiche Absicht wie die Farben.
    pub fn image_to_cmyk(&self, rgb: &[u8]) -> Result<Vec<u8>, String> {
        let px = rgb.as_chunks::<3>().0;
        let mut out = vec![[0u8; 4]; px.len()];
        match &self.icc {
            None => {
                for (o, p) in out.iter_mut().zip(px) {
                    let [r, g, b] = p.map(|v| v as f64 / 255.0);
                    *o = naive_cmyk(r, g, b).map(byte);
                }
            }
            Some(icc) => {
                let cmyk = open(&icc.bytes)?;
                let t = Transform::new_flags(
                    &Profile::new_srgb(),
                    PixelFormat::RGB_8,
                    &cmyk,
                    PixelFormat::CMYK_8,
                    icc.intent,
                    Flags::BLACKPOINT_COMPENSATION,
                )
                .map_err(|e| format!("ICC-Profil nicht nutzbar: {e}"))?;
                t.transform_pixels(px, &mut out);
            }
        }
        Ok(out.concat())
    }

    /// sRGB 0..1. Volltonfarben über ihre Ersatzwerte.
    pub fn srgb(&self, c: &Color) -> [f64; 3] {
        let v = &c.values;
        match c.model {
            ColorModel::Rgb => [v[0], v[1], v[2]],
            ColorModel::Gray => [v[0]; 3],
            ColorModel::Cmyk => self.cmyk_to_srgb(&[[v[0], v[1], v[2], v[3]]])[0],
        }
    }

    /// CMYK 0..1. Graustufen werden reines Schwarz (K), damit Stencils nicht vierfarbig drucken.
    pub fn cmyk(&self, c: &Color) -> [f64; 4] {
        let v = &c.values;
        match c.model {
            ColorModel::Cmyk => [v[0], v[1], v[2], v[3]],
            ColorModel::Gray => [0.0, 0.0, 0.0, 1.0 - v[0]],
            ColorModel::Rgb => self.srgb_to_cmyk(&[[v[0], v[1], v[2]]])[0],
        }
    }

    /// Soft-Proof: so sieht die Farbe nach dem Druck mit dem Dokumentprofil aus.
    pub fn proof(&self, c: &Color) -> [f64; 3] {
        let [c, m, y, k] = self.cmyk(c);
        self.srgb(&Color::cmyk(c, m, y, k))
    }

    /// Modellwechsel im Farbwähler. Neues Modell = Prozessfarbe (Volltonname fällt weg).
    /// Graustufen: reines Schwarz exakt zurück, sonst Helligkeit (0,299 R + 0,587 G + 0,114 B).
    pub fn convert(&self, c: &Color, to: ColorModel) -> Color {
        if c.model == to {
            return c.clone();
        }
        match to {
            ColorModel::Rgb => {
                let [r, g, b] = self.srgb(c);
                Color::rgb(r, g, b)
            }
            ColorModel::Cmyk => {
                let [c, m, y, k] = self.cmyk(c);
                Color::cmyk(c, m, y, k)
            }
            ColorModel::Gray => {
                let v = &c.values;
                let g = if c.model == ColorModel::Cmyk && v[..3].iter().all(|&x| x == 0.0) {
                    1.0 - v[3]
                } else {
                    let [r, g, b] = self.srgb(c);
                    // gerundet: Weiß soll 1 sein, nicht 0,9999…
                    ((0.299 * r + 0.587 * g + 0.114 * b) * 1e6).round() / 1e6
                };
                Color {
                    model: ColorModel::Gray,
                    values: vec![g.clamp(0.0, 1.0)],
                    spot: None,
                }
            }
        }
    }

    fn cmyk_to_srgb(&self, src: &[[f64; 4]]) -> Vec<[f64; 3]> {
        let Some(icc) = &self.icc else {
            return src
                .iter()
                .map(|&[c, m, y, k]| {
                    [
                        (1.0 - c) * (1.0 - k),
                        (1.0 - m) * (1.0 - k),
                        (1.0 - y) * (1.0 - k),
                    ]
                })
                .collect();
        };
        // CMYK_DBL rechnet in Prozent, RGB_DBL in 0..1.
        let percent: Vec<[f64; 4]> = src.iter().map(|p| p.map(|v| v * 100.0)).collect();
        let mut out = vec![[0.0; 3]; src.len()];
        icc.to_rgb.transform_pixels(&percent, &mut out);
        out.iter().map(|p| p.map(|v| v.clamp(0.0, 1.0))).collect()
    }

    fn srgb_to_cmyk(&self, src: &[[f64; 3]]) -> Vec<[f64; 4]> {
        let Some(icc) = &self.icc else {
            return src.iter().map(|&[r, g, b]| naive_cmyk(r, g, b)).collect();
        };
        let mut out = vec![[0.0; 4]; src.len()];
        icc.to_cmyk.transform_pixels(src, &mut out);
        out.iter()
            .map(|p| p.map(|v| (v / 100.0).clamp(0.0, 1.0)))
            .collect()
    }
}

/// Liest ein CMYK-Druckerprofil; Geräteverknüpfungen und andere Farbräume werden abgelehnt.
fn open(bytes: &[u8]) -> Result<Profile, String> {
    let p = Profile::new_icc(bytes)
        .map_err(|_| "ICC-Profil ist beschädigt oder keine ICC-Datei.".to_string())?;
    if p.color_space() != ColorSpaceSignature::CmykData
        || p.device_class() != ProfileClassSignature::OutputClass
    {
        return Err("Das ICC-Profil ist kein CMYK-Profil für den Druck.".into());
    }
    Ok(p)
}

fn name(p: &Profile) -> String {
    p.info(InfoType::Description, Locale::new("de_DE"))
        .unwrap_or_else(|| "CMYK-Profil".into())
}

/// Anzeigename eines CMYK-Profils für die Profil-Liste, ohne Umrechner zu bauen.
pub fn cmyk_profile_name(icc: &[u8]) -> Result<String, String> {
    open(icc).map(|p| name(&p))
}

fn load(bytes: &[u8], intent: RenderIntent) -> Result<Icc, String> {
    let cmyk = open(bytes)?;
    let intent = match intent {
        RenderIntent::Perceptual => Intent::Perceptual,
        RenderIntent::Relative => Intent::RelativeColorimetric,
        RenderIntent::Saturation => Intent::Saturation,
        RenderIntent::Absolute => Intent::AbsoluteColorimetric,
    };
    let srgb = Profile::new_srgb();
    let flags = Flags::BLACKPOINT_COMPENSATION;
    let unusable = |e: lcms2::Error| format!("ICC-Profil nicht nutzbar: {e}");
    let to_rgb = Transform::new_flags(
        &cmyk,
        PixelFormat::CMYK_DBL,
        &srgb,
        PixelFormat::RGB_DBL,
        intent,
        flags,
    )
    .map_err(unusable)?;
    let to_cmyk = Transform::new_flags(
        &srgb,
        PixelFormat::RGB_DBL,
        &cmyk,
        PixelFormat::CMYK_DBL,
        intent,
        flags,
    )
    .map_err(unusable)?;
    Ok(Icc {
        name: name(&cmyk),
        bytes: bytes.to_vec(),
        intent,
        to_rgb,
        to_cmyk,
    })
}

fn naive_cmyk(r: f64, g: f64, b: f64) -> [f64; 4] {
    let k = 1.0 - r.max(g).max(b);
    if k >= 1.0 {
        return [0.0, 0.0, 0.0, 1.0];
    }
    [
        (1.0 - r - k) / (1.0 - k),
        (1.0 - g - k) / (1.0 - k),
        (1.0 - b - k) / (1.0 - k),
        k,
    ]
}

pub fn byte(v: f64) -> u8 {
    (v.clamp(0.0, 1.0) * 255.0).round() as u8
}
