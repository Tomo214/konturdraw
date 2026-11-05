//! CDR-Import (3g-2) über den Hilfsprozess kw-cdr (src/cdr-import): .cdr → SVG je Seite → svg_import.
//! Eigener Prozess mit Zeitlimit: Absturz oder Endlosschleife in libcdr trifft die App nicht.
use kw_core::svg_import::{self, Imported};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn import(path: &Path) -> Result<Imported, String> {
    run(&helper()?, path, Duration::from_secs(30))
}

/// Neben der App-Datei; im Debug-Build auch das Ergebnis von build.sh.
fn helper() -> Result<PathBuf, String> {
    let name = if cfg!(windows) {
        "kw-cdr.exe"
    } else {
        "kw-cdr"
    };
    let mut places = vec![std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|d| d.join(name)))];
    if cfg!(debug_assertions) {
        places.push(Some(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../cdr-import/.build/bin")
                .join(name),
        ));
    }
    places
        .into_iter()
        .flatten()
        .find(|p| p.is_file())
        .ok_or_else(|| {
            "CDR-Import fehlt (kw-cdr nicht gefunden) – src/cdr-import/build.sh ausführen.".into()
        })
}

/// Seiten sind durch \f getrennt; importiert wird Seite 1, der Rest nur als Hinweis.
fn pages(out: &[u8]) -> Result<Imported, String> {
    let mut all = out.split(|&b| b == b'\x0c');
    let mut imp = svg_import::import(all.next().unwrap_or_default())?;
    let more = all.count();
    if more > 0 {
        imp.warnings
            .push(format!("{} Seiten – nur Seite 1 importiert", more + 1));
    }
    Ok(imp)
}

/// Exit-Codes von kw_cdr.cpp; None = per Signal beendet.
fn failure(code: Option<i32>) -> String {
    match code {
        Some(2) => "Keine lesbare CorelDRAW-Datei (Format oder Version unbekannt).".into(),
        Some(3) => "CorelDRAW-Datei beschädigt oder nicht lesbar.".into(),
        Some(c) => format!("CDR-Import fehlgeschlagen (Code {c})."),
        None => "CDR-Import abgebrochen (Absturz beim Lesen der Datei).".into(),
    }
}

fn run(exe: &Path, path: &Path, limit: Duration) -> Result<Imported, String> {
    let mut child = Command::new(exe)
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("kw-cdr startet nicht: {e}"))?;
    // Ausgabe nebenher lesen, sonst blockiert ein voller Pipe-Puffer den Prozess.
    let mut stdout = child.stdout.take().expect("stdout ist umgeleitet");
    let reader = std::thread::spawn(move || {
        let mut v = Vec::new();
        stdout.read_to_end(&mut v).map(|_| v)
    });
    let start = Instant::now();
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(s);
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let out = reader
        .join()
        .map_err(|_| "kw-cdr: Ausgabe nicht lesbar".to_string())?
        .map_err(|e| e.to_string())?;
    match status {
        Some(s) if s.success() => pages(&out),
        Some(s) => Err(failure(s.code())),
        None => Err("CDR-Import abgebrochen: Zeitlimit überschritten.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SVG: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>"#;

    #[test]
    fn mehrere_seiten_nur_die_erste_mit_hinweis() {
        let one = pages(SVG.as_bytes()).unwrap();
        assert!((one.scene.width - 10.0).abs() < 1e-6);
        assert!(one.warnings.is_empty());
        let two = pages(format!("{SVG}\x0c{SVG}").as_bytes()).unwrap();
        assert_eq!(two.scene.items, one.scene.items);
        assert!(two.warnings.iter().any(|w| w.contains("2 Seiten")));
    }

    #[test]
    fn fehlercodes_verstaendlich() {
        assert!(failure(Some(2)).contains("Version"));
        assert!(failure(Some(3)).contains("beschädigt"));
        assert!(failure(None).contains("Absturz"));
    }

    #[cfg(unix)]
    #[test]
    fn zeitlimit_beendet_den_prozess() {
        let t = std::time::Instant::now();
        let err = run(
            Path::new("/bin/sleep"),
            Path::new("5"),
            Duration::from_millis(200),
        )
        .err()
        .expect("Fehler erwartet");
        assert!(err.contains("Zeitlimit"), "{err}");
        assert!(t.elapsed() < Duration::from_secs(2));
    }

    #[test]
    #[ignore = "braucht src/cdr-import/build.sh"]
    fn cdr_x4_datei_und_fremddatei() {
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/cdr");
        let imp = import(&fixtures.join("fdo65220-2.cdr")).unwrap();
        assert!((imp.scene.width - 210.0).abs() < 0.01 && (imp.scene.height - 297.0).abs() < 0.01);
        let leaves = kw_core::scene::leaves(&imp.scene.items);
        let paths = leaves
            .iter()
            .filter(|(_, it)| matches!(it, kw_core::scene::Item::Path { .. }))
            .count();
        assert_eq!(paths, 5, "fünf Rechtecke");
        // Datenmüll mit RIFF-Kopf wie alte CDR-Dateien → klare Meldung statt Absturz
        let junk = std::env::temp_dir().join(format!("kw-junk-{}.cdr", std::process::id()));
        std::fs::write(&junk, b"RIFF\x10\0\0\0CDR9vrsn\xff\xff\xff\xff").unwrap();
        let err = import(&junk).err().expect("Fehler erwartet");
        std::fs::remove_file(&junk).ok();
        assert!(
            err.contains("Version") || err.contains("beschädigt"),
            "{err}"
        );
    }
}
