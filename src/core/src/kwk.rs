//! Dateiformat `.kwk`: ZIP mit `document.json` + `images/<hash>.png` (architecture.md §5).
//! Das Dokument bleibt hier Text; Aufbau und Migration gehören dem TS-Modell.
use crate::{raster, Images};
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;

/// Höchste Schema-Version, die diese Programmversion lesen kann.
pub const SCHEMA_MAX: u64 = 1;

pub fn pack(document: &str, images: &Images) -> Result<Vec<u8>, String> {
    let err = |e: zip::result::ZipError| format!("Datei konnte nicht gepackt werden: {e}");
    let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
    z.start_file("document.json", SimpleFileOptions::default())
        .map_err(err)?;
    z.write_all(document.as_bytes())
        .map_err(|e| e.to_string())?;
    // PNG ist schon komprimiert.
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (hash, png) in images {
        z.start_file(format!("images/{hash}.png"), stored)
            .map_err(err)?;
        z.write_all(png).map_err(|e| e.to_string())?;
    }
    Ok(z.finish().map_err(err)?.into_inner())
}

pub fn unpack(data: &[u8]) -> Result<(String, Images), String> {
    let mut z = zip::ZipArchive::new(Cursor::new(data))
        .map_err(|_| "Keine KonturDraw-Datei (kein ZIP).".to_string())?;
    let mut document = String::new();
    z.by_name("document.json")
        .map_err(|_| "Datei unvollständig: document.json fehlt.".to_string())?
        .read_to_string(&mut document)
        .map_err(|e| format!("document.json nicht lesbar: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&document)
        .map_err(|e| format!("document.json ist kein gültiges JSON: {e}"))?;
    match json.get("schemaVersion").and_then(|v| v.as_u64()) {
        None => return Err("document.json ohne schemaVersion.".into()),
        Some(v) if v > SCHEMA_MAX => {
            return Err(format!(
                "Datei stammt aus einer neueren KonturDraw-Version (Schema {v})."
            ))
        }
        _ => {}
    }

    let mut images = Images::new();
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| e.to_string())?;
        let Some(hash) = f
            .name()
            .map_err(|e| e.to_string())?
            .strip_prefix("images/")
            .and_then(|n| n.strip_suffix(".png"))
            .map(str::to_owned)
        else {
            continue;
        };
        let mut png = Vec::new();
        f.read_to_end(&mut png).map_err(|e| e.to_string())?;
        if raster::hash(&png) != hash {
            return Err(format!("Bild {hash} ist beschädigt."));
        }
        images.insert(hash, png);
    }
    Ok((document, images))
}
