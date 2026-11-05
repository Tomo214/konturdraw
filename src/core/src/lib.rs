//! kw-core: zustandslose Funktionen ohne I/O (architecture.md §2). Fehler sind deutsche Meldungen für die Oberfläche.
pub mod boolean;
pub mod color;
pub mod kwk;
pub mod pdf_export;
pub mod pdf_print;
pub mod plot_export;
pub mod png_export;
pub mod raster;
pub mod scene;
pub mod svg_export;
pub mod svg_import;
pub mod text;
pub mod trace;

/// Bildablage: Hash → PNG-Bytes (architecture.md §5: `images/<hash>.png`).
pub type Images = std::collections::BTreeMap<String, Vec<u8>>;
