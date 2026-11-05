//! Farbe (3f): Dokumentprofil finden und laden, Anzeigefarben, Profil-Liste, Paletten-Dateien.
//! Keine Profile im Programm (Lizenz): nur System- und vom Nutzer gewählte Dateien.
use crate::files::{local, write_atomic};
use kw_core::color::{byte, cmyk_profile_name, Cms, ColorSettings};
use kw_core::scene::{Color, ColorModel};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[cfg(target_os = "macos")]
const DEFAULT_PROFILE: &str = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";
#[cfg(target_os = "windows")]
const DEFAULT_PROFILE: &str = r"C:\Windows\System32\spool\drivers\color\RSWOP.icm";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const DEFAULT_PROFILE: &str = "";

fn profile_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![r"C:\Windows\System32\spool\drivers\color".into()]
    } else {
        vec![
            "/System/Library/ColorSync/Profiles".into(),
            "/Library/ColorSync/Profiles".into(),
        ]
    };
    if let (true, Some(home)) = (cfg!(target_os = "macos"), std::env::var_os("HOME")) {
        dirs.push(Path::new(&home).join("Library/ColorSync/Profiles"));
    }
    dirs
}

/// Umrechner nach den Dokument-Einstellungen. Ohne Pfad das Systemprofil; fehlt auch das, einfache Formel.
pub(crate) fn cms(settings: &ColorSettings) -> Result<Cms, String> {
    let icc = match &settings.cmyk_profile {
        Some(path) => {
            Some(std::fs::read(path).map_err(|e| format!("ICC-Profil {path} nicht lesbar: {e}"))?)
        }
        None => std::fs::read(DEFAULT_PROFILE).ok(),
    };
    Cms::new(settings, icc.as_deref())
}

#[derive(Serialize)]
pub struct Display {
    /// Name des benutzten Profils; None = einfache Formel.
    profile: Option<String>,
    colors: Vec<[u8; 3]>,
}

fn display(settings: &ColorSettings, colors: &[Color], proof: bool) -> Result<Display, String> {
    let cms = cms(settings)?;
    let srgb = |c: &Color| if proof { cms.proof(c) } else { cms.srgb(c) };
    Ok(Display {
        profile: cms.profile_name().map(String::from),
        colors: colors.iter().map(|c| srgb(c).map(byte)).collect(),
    })
}

/// Bildschirmfarben (sRGB-Bytes); `proof` = so, wie sie gedruckt aussehen.
#[tauri::command]
pub async fn display_colors(
    color: ColorSettings,
    colors: Vec<Color>,
    proof: bool,
) -> Result<Display, String> {
    display(&color, &colors, proof)
}

/// Modellwechsel im Farbwähler über das Dokumentprofil.
#[tauri::command]
pub async fn convert_colors(
    color: ColorSettings,
    colors: Vec<Color>,
    model: ColorModel,
) -> Result<Vec<Color>, String> {
    let cms = cms(&color)?;
    Ok(colors.iter().map(|c| cms.convert(c, model)).collect())
}

#[derive(Serialize, Debug)]
pub struct ProfileEntry {
    name: String,
    path: String,
}

fn entry(path: &Path) -> Option<ProfileEntry> {
    let name = cmyk_profile_name(&std::fs::read(path).ok()?).ok()?;
    Some(ProfileEntry {
        name,
        path: path.display().to_string(),
    })
}

fn scan(dirs: &[PathBuf]) -> Vec<ProfileEntry> {
    let is_icc = |p: &Path| {
        p.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("icc") || e.eq_ignore_ascii_case("icm"))
    };
    let mut list: Vec<ProfileEntry> = dirs
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flat_map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())))
        .filter(|p| is_icc(p))
        .filter_map(|p| entry(&p))
        .collect();
    list.sort_by_key(|p| p.name.to_lowercase());
    list
}

/// CMYK-Druckerprofile aus den Systemordnern.
#[tauri::command]
pub async fn list_cmyk_profiles() -> Vec<ProfileEntry> {
    scan(&profile_dirs())
}

#[tauri::command]
pub async fn pick_cmyk_profile(app: AppHandle) -> Result<Option<ProfileEntry>, String> {
    let Some(p) = app
        .dialog()
        .file()
        .add_filter("ICC-Profil", &["icc", "icm"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = local(p)?;
    let icc = std::fs::read(&path).map_err(|e| format!("{} nicht lesbar: {e}", path.display()))?;
    Ok(Some(ProfileEntry {
        name: cmyk_profile_name(&icc)?,
        path: path.display().to_string(),
    }))
}

/// Palettendatei als Text; geprüft wird sie in der Oberfläche (src/model/palette.ts).
#[tauri::command]
pub async fn open_palette(app: AppHandle) -> Result<Option<String>, String> {
    let Some(p) = app
        .dialog()
        .file()
        .add_filter("Konturwerk-Palette", &["kwp"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = local(p)?;
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("{} nicht lesbar: {e}", path.display()))
}

#[tauri::command]
pub async fn save_palette(
    app: AppHandle,
    name: String,
    text: String,
) -> Result<Option<String>, String> {
    let Some(p) = app
        .dialog()
        .file()
        .add_filter("Konturwerk-Palette", &["kwp"])
        .set_file_name(format!("{name}.kwp"))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = local(p)?;
    write_atomic(&path, text.as_bytes())?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use kw_core::color::{ColorMode, ColorSettings};
    use kw_core::scene::Color;

    // Auf macOS und Windows bringt das System ein CMYK- und ein sRGB-Profil mit; dort muss jeder Test echt prüfen.
    const SYSTEM: bool = cfg!(any(target_os = "macos", target_os = "windows"));
    #[cfg(target_os = "macos")]
    const SRGB: &str = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";
    #[cfg(target_os = "windows")]
    const SRGB: &str = r"C:\Windows\System32\spool\drivers\color\sRGB Color Space Profile.icm";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    const SRGB: &str = "";

    fn system_name() -> String {
        let icc = std::fs::read(DEFAULT_PROFILE).expect("Systemprofil fehlt");
        cmyk_profile_name(&icc).unwrap()
    }

    #[test]
    fn ohne_pfad_gilt_das_systemprofil() {
        let cms = cms(&ColorSettings::default()).unwrap();
        if !SYSTEM {
            return assert_eq!(cms.profile_name(), None);
        }
        assert_eq!(cms.profile_name(), Some(system_name().as_str()));
        if cfg!(target_os = "macos") {
            assert_eq!(cms.profile_name(), Some("Allgemeines CMYK-Profil"));
        }
    }

    #[test]
    fn unlesbarer_pfad_ist_ein_fehler() {
        let settings = ColorSettings {
            cmyk_profile: Some("/gibt/es/nicht.icc".into()),
            ..Default::default()
        };
        assert!(cms(&settings).err().unwrap().contains("nicht lesbar"));
    }

    #[test]
    fn anzeige_rechnet_cmyk_ueber_das_profil() {
        if !SYSTEM {
            return;
        }
        let cyan = Color::cmyk(1.0, 0.0, 0.0, 0.0);
        let out = display(
            &ColorSettings {
                mode: ColorMode::Cmyk,
                ..Default::default()
            },
            &[cyan, Color::rgb(0.0, 1.0, 0.0)],
            false,
        )
        .unwrap();
        assert_eq!(out.profile, Some(system_name()));
        assert_ne!(out.colors[0], [0, 255, 255], "Profil statt Formel");
        assert_eq!(out.colors[1], [0, 255, 0], "RGB bleibt ohne Proof");
        let proof = display(
            &ColorSettings::default(),
            &[Color::rgb(0.0, 1.0, 0.0)],
            true,
        )
        .unwrap();
        assert_ne!(proof.colors[0], [0, 255, 0], "Proof zeigt Druckfarbe");
    }

    #[test]
    fn profil_liste_nur_cmyk_druckerprofile() {
        let dir = std::env::temp_dir().join(format!("kw-profile-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("kaputt.icc"), b"kein icc").unwrap();
        std::fs::write(dir.join("notiz.txt"), b"x").unwrap();
        if SYSTEM {
            std::fs::copy(DEFAULT_PROFILE, dir.join("Druck.ICC")).expect("CMYK-Systemprofil fehlt");
            std::fs::copy(SRGB, dir.join("srgb.icm")).expect("sRGB-Systemprofil fehlt");
        }
        let list = scan(&[dir.clone(), dir.join("fehlt")]);
        if SYSTEM {
            assert_eq!(list.len(), 1, "{list:?}");
            assert_eq!(list[0].name, system_name());
            assert!(list[0].path.ends_with("Druck.ICC"));
        } else {
            assert!(list.is_empty());
        }
        std::fs::remove_dir_all(&dir).ok();
    }
}
