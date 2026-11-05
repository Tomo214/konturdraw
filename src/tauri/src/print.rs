//! Drucken 1:1 (Weg B, architecture.md §7): Seite als PDF in die Druckansicht des Systems, dort mit 100 % drucken.
use crate::files::{render, Wire};
use kw_core::color::ColorSettings;
use kw_core::scene::Scene;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Eigene Datei je Auftrag: eine noch offene Druckansicht bleibt unberührt.
fn write_pdf(
    dir: &Path,
    scene: &Scene,
    images: Wire,
    color: &ColorSettings,
) -> Result<PathBuf, String> {
    static N: AtomicU32 = AtomicU32::new(0);
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let path = dir.join(format!(
        "Konturwerk-Druck-{stamp}-{}.pdf",
        N.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::write(
        &path,
        render("pdf", scene, images, &Default::default(), color)?,
    )
    .map_err(|e| format!("{} nicht schreibbar: {e}", path.display()))?;
    Ok(path)
}

/// cmd.exe trennt an „&“ und liest „^“ als Escape, außer in Anführungszeichen. Rust fasst ein Argument nur bei
/// Leerzeichen ein → Pfad selbst einfassen (Windows-Pfade enthalten nie ").
#[cfg(target_os = "windows")]
fn cmd_with_path(before: &[&str], path: &Path) -> Command {
    use std::os::windows::process::CommandExt;
    let mut quoted = std::ffi::OsString::from("\"");
    quoted.push(path);
    quoted.push("\"");
    let mut c = Command::new("cmd");
    c.arg("/C").args(before).raw_arg(quoted).creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}

/// Öffnet die Datei im Standardprogramm (macOS Vorschau, Windows PDF-Anzeige).
fn show(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(path);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = cmd_with_path(&["start", ""], path);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(path);
        c
    };
    match cmd.status() {
        Ok(s) if s.success() => Ok(()),
        _ => Err("Druckansicht ließ sich nicht öffnen.".into()),
    }
}

#[tauri::command]
pub async fn print_page(
    scene: Scene,
    images: Wire,
    color: ColorSettings,
) -> Result<String, String> {
    let path = write_pdf(&std::env::temp_dir(), &scene, images, &color)?;
    show(&path)?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn druck_pdf_je_auftrag_neu() {
        let dir = std::env::temp_dir().join(format!("kw-druck-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let scene = Scene {
            width: 210.0,
            height: 297.0,
            items: vec![],
        };
        let (a, b) = (
            write_pdf(&dir, &scene, Wire::new(), &Default::default()).unwrap(),
            write_pdf(&dir, &scene, Wire::new(), &Default::default()).unwrap(),
        );
        assert_ne!(a, b, "offene Druckansicht wird nicht überschrieben");
        assert!(
            a.extension().is_some_and(|e| e == "pdf")
                && std::fs::read(&a).unwrap().starts_with(b"%PDF-")
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Benutzername wie „Max&Moritz“ (ohne Leerzeichen) landet so im Temp-Pfad der Druckdatei.
    #[cfg(target_os = "windows")]
    #[test]
    fn druckansicht_pfad_mit_cmd_sonderzeichen() {
        let dir = std::env::temp_dir().join(format!("kw-a&b^c-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("probe.txt");
        std::fs::write(&file, "kw-probe").unwrap();
        let printed = |mut c: Command| String::from_utf8_lossy(&c.output().unwrap().stdout).trim().to_string();
        // Gegenprobe: als normales Argument (nur bei Leerzeichen in Anführungszeichen) zerlegt cmd den Pfad
        let mut naive = Command::new("cmd");
        naive.args(["/C", "type"]).arg(&file);
        let (naive, fixed) = (printed(naive), printed(cmd_with_path(&["type"], &file)));
        std::fs::remove_dir_all(&dir).ok();
        assert_ne!(naive, "kw-probe", "Prüfpfad löst den Fehler nicht aus");
        assert_eq!(fixed, "kw-probe");
    }
}
