// Kein Konsolenfenster unter Windows im Release-Build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cdr;
mod color;
mod files;
mod print;
mod shape;
mod text;
mod trace;

/// Rauchtest (6d): KONTURWERK_DEBUG_PORT öffnet das DevTools-Protokoll der WebView2 (nur Windows wirksam).
/// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS kam in der CI nicht an (Kommandozeile ohne Port). Ohne Variable bleibt alles Standard.
fn browser_args(port: Option<&str>) -> Option<String> {
    let port: u16 = port?.trim().parse().ok().filter(|p| *p != 0)?;
    Some(format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port={port}"))
}

fn main() {
    let mut context = tauri::generate_context!();
    if let Some(args) = browser_args(std::env::var("KONTURWERK_DEBUG_PORT").ok().as_deref()) {
        for window in &mut context.config_mut().app.windows {
            window.additional_browser_args = Some(args.clone());
        }
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            color::display_colors,
            color::convert_colors,
            color::list_cmyk_profiles,
            color::pick_cmyk_profile,
            color::open_palette,
            color::save_palette,
            files::open_kwk,
            files::save_kwk,
            files::import_file,
            files::export_file,
            print::print_page,
            shape::shape_objects,
            shape::knife_objects,
            shape::erase_objects,
            shape::outline_objects,
            text::layout_text,
            text::list_fonts,
            trace::trace_image
        ])
        .run(context)
        .expect("Konturwerk konnte nicht starten");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_port_nur_mit_gueltiger_variable() {
        assert_eq!(browser_args(None), None);
        for bad in ["", "abc", "0", "70000", "9333 --x"] {
            assert_eq!(browser_args(Some(bad)), None, "{bad:?}");
        }
        let args = browser_args(Some(" 9333 ")).unwrap();
        assert!(args.ends_with(" --remote-debugging-port=9333"), "{args}");
        // eigene Argumente ersetzen wrys Standard → den mitgeben
        assert!(args.starts_with("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection "), "{args}");
    }
}
