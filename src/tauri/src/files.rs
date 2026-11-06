//! Datei-Befehle der Oberfläche: Dialoge + Lesen/Schreiben hier, Umwandlung in kw-core.
//! Bilder reisen als Base64 über die Brücke (Hash → PNG).
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use kw_core::color::ColorSettings;
use kw_core::pdf_print::{self, Print, Stamp};
use kw_core::plot_export::{self, Plot};
use kw_core::scene::Scene;
use kw_core::{kwk, pdf_export, png_export, raster, svg_export, svg_import, Images};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

pub(crate) type Wire = BTreeMap<String, String>;

fn encode(images: Images) -> Wire {
    images
        .into_iter()
        .map(|(h, png)| (h, B64.encode(png)))
        .collect()
}

fn decode(images: Wire) -> Result<Images, String> {
    images
        .into_iter()
        .map(|(h, s)| {
            B64.decode(s)
                .map(|png| (h.clone(), png))
                .map_err(|e| format!("Bild {h} fehlerhaft übertragen: {e}"))
        })
        .collect()
}

pub(crate) fn local(p: FilePath) -> Result<PathBuf, String> {
    p.into_path().map_err(|e| e.to_string())
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{} nicht lesbar: {e}", path.display()))
}

/// Erst Nachbardatei schreiben, dann umbenennen: Absturz mittendrin lässt die alte Datei heil.
pub(crate) fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    std::fs::write(&tmp, data)
        .and_then(|_| std::fs::rename(&tmp, path))
        .map_err(|e| format!("{} nicht schreibbar: {e}", path.display()))
}

#[derive(Serialize)]
pub struct Opened {
    path: String,
    document: String,
    images: Wire,
}

fn open_path(path: &Path) -> Result<Opened, String> {
    let (document, images) = kwk::unpack(&read(path)?)?;
    Ok(Opened {
        path: path.display().to_string(),
        document,
        images: encode(images),
    })
}

fn save_path(path: &Path, document: &str, images: Wire) -> Result<(), String> {
    write_atomic(path, &kwk::pack(document, &decode(images)?)?)
}

#[tauri::command]
pub async fn open_kwk(app: AppHandle) -> Result<Option<Opened>, String> {
    let Some(p) = app
        .dialog()
        .file()
        .add_filter("Konturwerk", &["kwk"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    open_path(&local(p)?).map(Some)
}

/// path = None → „Speichern unter“. Liefert den Pfad, None bei Abbruch.
#[tauri::command]
pub async fn save_kwk(
    app: AppHandle,
    path: Option<String>,
    document: String,
    images: Wire,
) -> Result<Option<String>, String> {
    let path = match path {
        Some(p) => PathBuf::from(p),
        None => match app
            .dialog()
            .file()
            .add_filter("Konturwerk", &["kwk"])
            .set_file_name("Unbenannt.kwk")
            .blocking_save_file()
        {
            Some(p) => local(p)?,
            None => return Ok(None),
        },
    };
    save_path(&path, &document, images)?;
    Ok(Some(path.display().to_string()))
}

#[derive(Serialize)]
pub struct Imported {
    scene: Scene,
    images: Wire,
    warnings: Vec<String>,
    /// Pixelbild: Oberfläche passt es auf die Seite ein; SVG behält seine Größe.
    raster: bool,
}

fn import_path(path: &Path) -> Result<Imported, String> {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase());
    let (imp, raster) = match ext.as_deref() {
        Some("cdr" | "cdt" | "cdrt") => (crate::cdr::import(path)?, false),
        Some("svg") => (svg_import::import(&read(path)?)?, false),
        _ => (raster::import_scene(&read(path)?)?, true),
    };
    Ok(Imported {
        scene: imp.scene,
        images: encode(imp.images),
        warnings: imp.warnings,
        raster,
    })
}

#[tauri::command]
pub async fn import_file(app: AppHandle) -> Result<Option<Imported>, String> {
    let Some(p) = app
        .dialog()
        .file()
        .add_filter(
            "SVG, CDR, PNG, JPG",
            &["svg", "cdr", "cdt", "cdrt", "png", "jpg", "jpeg"],
        )
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    import_path(&local(p)?).map(Some)
}

/// Exporteinstellungen der Oberfläche; fehlende Felder = Standard (DEFAULT_EXPORT_OPTIONS in files.ts).
#[derive(Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct ExportOptions {
    /// nur PNG
    pub dpi: f64,
    /// druckfertiges PDF: Beschnittzugabe in mm, Schnittmarken, Dokumenttitel
    pub bleed: f64,
    pub marks: bool,
    pub title: String,
    /// HPGL
    pub plot: Plot,
}

impl Default for ExportOptions {
    fn default() -> Self {
        ExportOptions {
            dpi: 300.0,
            bleed: 3.0,
            marks: true,
            title: "Unbenannt".into(),
            plot: Plot::default(),
        }
    }
}

/// Format → (Filtername, Endung); prüft die Einstellungen – vor dem Dialog.
fn check(format: &str, o: &ExportOptions) -> Result<(&'static str, &'static str), String> {
    if !(1.0..=2400.0).contains(&o.dpi) {
        return Err("Auflösung muss zwischen 1 und 2400 dpi liegen.".into());
    }
    if !(0.0..=25.0).contains(&o.bleed) {
        return Err("Beschnittzugabe: 0 bis 25 mm.".into());
    }
    if !(1.0..=1000.0).contains(&o.plot.units_per_mm) {
        return Err("Plottereinheiten je mm: 1 bis 1000 (Standard 40).".into());
    }
    match format {
        "pdf" => Ok(("PDF", "pdf")),
        "pdfx" => Ok(("PDF/X-4", "pdf")),
        "svg" => Ok(("SVG", "svg")),
        "png" => Ok(("PNG", "png")),
        "dxf" => Ok(("DXF", "dxf")),
        "plt" => Ok(("HPGL", "plt")),
        _ => Err(format!("Format {format} unbekannt.")),
    }
}

pub(crate) fn render(
    format: &str,
    scene: &Scene,
    images: Wire,
    o: &ExportOptions,
    color: &ColorSettings,
) -> Result<Vec<u8>, String> {
    check(format, o)?;
    let images = decode(images)?;
    let cms = crate::color::cms(color)?;
    match format {
        "svg" => Ok(svg_export::export(scene, &images, &cms)?.into_bytes()),
        "png" => png_export::export(scene, &images, o.dpi, &cms),
        "dxf" => Ok(plot_export::dxf(scene).into_bytes()),
        "plt" => Ok(plot_export::hpgl(scene, &o.plot)?.into_bytes()),
        "pdfx" => {
            let secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |d| d.as_secs());
            let print = Print {
                bleed: o.bleed,
                marks: o.marks,
                title: o.title.clone(),
                time: Stamp::from_unix(secs),
            };
            pdf_print::export(scene, &images, &cms, &print)
        }
        _ => pdf_export::export(scene, &images, &cms),
    }
}

#[tauri::command]
pub async fn export_file(
    app: AppHandle,
    format: String,
    scene: Scene,
    images: Wire,
    options: ExportOptions,
    color: ColorSettings,
) -> Result<Option<String>, String> {
    let (label, ext) = check(&format, &options)?;
    let Some(p) = app
        .dialog()
        .file()
        .add_filter(label, &[ext])
        .set_file_name(format!("Unbenannt.{ext}"))
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = local(p)?;
    write_atomic(&path, &render(&format, &scene, images, &options, &color)?)?;
    Ok(Some(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use kw_core::scene::{Item, IDENTITY};

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("kw-tauri-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Szene mit einem Bild (transparentes PNG aus dem eigenen Export) + Ablage dazu.
    fn image_scene() -> (Scene, Wire) {
        let png = png_export::export(
            &Scene {
                width: 2.0,
                height: 1.0,
                items: vec![],
            },
            &Images::new(),
            254.0,
            &kw_core::color::Cms::default(),
        )
        .unwrap();
        let hash = raster::hash(&png);
        let item = Item::Image {
            matrix: IDENTITY,
            width: 20.0,
            height: 10.0,
            image: hash.clone(),
            opacity: 1.0,
        };
        (
            Scene {
                width: 30.0,
                height: 10.0,
                items: vec![item],
            },
            Wire::from([(hash, B64.encode(png))]),
        )
    }

    #[test]
    fn kwk_speichern_und_oeffnen() {
        let (_, images) = image_scene();
        let path = dir("kwk").join("a.kwk");
        let doc = r#"{"schemaVersion":1,"pages":[]}"#;
        save_path(&path, doc, images.clone()).unwrap();
        save_path(&path, doc, images.clone()).unwrap(); // Überschreiben geht
        let opened = open_path(&path).unwrap();
        assert_eq!((opened.document.as_str(), &opened.images), (doc, &images));
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1,
            "keine .tmp-Reste"
        );
    }

    #[test]
    fn import_nach_dateiendung() {
        let (scene, images) = image_scene();
        let d = dir("import");
        let opts = ExportOptions {
            dpi: 96.0,
            ..Default::default()
        };
        std::fs::write(
            d.join("x.SVG"),
            render("svg", &scene, images.clone(), &opts, &Default::default()).unwrap(),
        )
        .unwrap();
        std::fs::write(
            d.join("y.png"),
            render("png", &scene, images, &opts, &Default::default()).unwrap(),
        )
        .unwrap();
        let svg = import_path(&d.join("x.SVG")).unwrap();
        assert!(!svg.raster && svg.images.len() == 1, "{:?}", svg.warnings);
        let png = import_path(&d.join("y.png")).unwrap();
        assert!(png.raster && png.images.len() == 1);
    }

    #[test]
    #[ignore = "braucht src/cdr-import/build.sh"]
    fn cdr_nach_dateiendung() {
        let p =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/cdr/fdo65220-2.cdr");
        let cdr = import_path(&p).unwrap();
        assert!(!cdr.raster && cdr.images.is_empty() && !cdr.scene.items.is_empty());
    }

    #[test]
    #[ignore = "braucht src/cdr-import/build.sh"]
    fn cdr_vorlage_nach_dateiendung() {
        // Vorlage = Dokument mit Kennung "CDT" statt "CDR" im RIFF-Kopf
        let p =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/cdr/fdo65220-2.cdr");
        let mut data = std::fs::read(p).unwrap();
        let riff = data.windows(4).position(|w| w == b"RIFF").unwrap();
        assert_eq!(&data[riff + 8..riff + 11], b"CDR");
        data[riff + 10] = b'T';
        let d = dir("vorlage");
        for name in ["Vorlage.cdt", "Vorlage.CDRT"] {
            std::fs::write(d.join(name), &data).unwrap();
            let imp = import_path(&d.join(name)).unwrap();
            assert!(!imp.raster && !imp.scene.items.is_empty(), "{name}");
        }
    }

    #[test]
    fn export_formate_und_grenzen() {
        let (scene, images) = image_scene();
        let opts = ExportOptions::default();
        let out = |format: &str, opts: &ExportOptions| {
            render(format, &scene, images.clone(), opts, &Default::default())
        };
        assert!(out("pdf", &opts).unwrap().starts_with(b"%PDF-1.7"));
        assert!(out("svg", &opts).unwrap().starts_with(b"<?xml"));
        assert!(out("png", &opts).unwrap().starts_with(b"\x89PNG"));
        assert!(out("dxf", &opts).unwrap().starts_with(b"0\nSECTION"));
        assert!(out("plt", &opts).unwrap().starts_with(b"IN;"));
        // Druckfertig braucht das Systemprofil (macOS: Allgemeines CMYK-Profil).
        if cfg!(target_os = "macos") {
            assert!(out("pdfx", &opts).unwrap().starts_with(b"%PDF-1.6"));
        }
        assert!(out("gif", &opts).is_err());
        let bad = |f: fn(&mut ExportOptions)| {
            let mut o = ExportOptions::default();
            f(&mut o);
            o
        };
        assert!(out("png", &bad(|o| o.dpi = 0.0))
            .unwrap_err()
            .contains("dpi"));
        assert!(out("pdfx", &bad(|o| o.bleed = -1.0))
            .unwrap_err()
            .contains("Beschnitt"));
        assert!(out("plt", &bad(|o| o.plot.units_per_mm = 0.0))
            .unwrap_err()
            .contains("Plottereinheiten"));
        assert!(decode(Wire::from([("h".into(), "%%%".into())]))
            .unwrap_err()
            .contains("Bild h"));
    }
}
