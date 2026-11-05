// Kein Konsolenfenster unter Windows im Release-Build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cdr;
mod color;
mod files;
mod print;
mod shape;
mod text;
mod trace;

fn main() {
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
        .run(tauri::generate_context!())
        .expect("Konturwerk konnte nicht starten");
}
