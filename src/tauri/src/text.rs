//! Text setzen: Satz-Felder kommen aus der Oberfläche (model/text.ts textSpec), gesetzt mit den Systemschriften.
use kw_core::text::{families, layout, system_fonts, Layout, TextSpec};

/// Der erste Aufruf lädt die Systemschriften → abseits der Oberfläche.
#[tauri::command]
pub async fn layout_text(spec: TextSpec) -> Result<Layout, String> {
    tauri::async_runtime::spawn_blocking(move || layout(&system_fonts(), &spec))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_fonts() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(|| families(&system_fonts()))
        .await
        .map_err(|e| e.to_string())
}
