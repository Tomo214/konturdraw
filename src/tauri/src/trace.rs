//! Nachzeichnen: Bild kommt als Base64 über die Brücke, Ergebnis geht als Teile (Pfade in Bild-mm) zurück.
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use kw_core::trace::{trace, trace_colors, Mode, Params, Piece};

/// Farbig: ein Teil je Objekt; Umriss s/w und Mittellinie: ein Teil ohne Farbe.
fn run(png: &str, params: &Params, width: f64, height: f64) -> Result<Vec<Piece>, String> {
    let png = B64
        .decode(png)
        .map_err(|e| format!("Bild fehlerhaft übertragen: {e}"))?;
    if params.mode == Mode::Color {
        return trace_colors(&png, params, width, height);
    }
    let subpaths = trace(&png, params, width, height)?;
    Ok(vec![Piece { rgb: None, subpaths }])
}

/// Rechnet abseits der Oberfläche; sie bleibt bedienbar.
#[tauri::command]
pub async fn trace_image(
    png: String,
    params: Params,
    width: f64,
    height: f64,
) -> Result<Vec<Piece>, String> {
    tauri::async_runtime::spawn_blocking(move || run(&png, &params, width, height))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use kw_core::scene::{Color, Fill, Item, PathPoint, Scene, Subpath, IDENTITY};
    use kw_core::{png_export, Images};

    #[test]
    fn bild_rein_pfade_raus() {
        let pt = |x: f64, y: f64| PathPoint {
            x,
            y,
            kind: kw_core::scene::NodeType::Corner,
            handle_in: None,
            handle_out: None,
        };
        let square = Subpath {
            closed: true,
            nodes: vec![pt(2.0, 2.0), pt(8.0, 2.0), pt(8.0, 8.0), pt(2.0, 8.0)],
        };
        let item = Item::Path {
            matrix: IDENTITY,
            subpaths: vec![square],
            fill: Some(Fill::Color(Color::rgb(0.0, 0.0, 0.0))),
            stroke: None,
            fill_rule: None,
        };
        let png = png_export::export(
            &Scene {
                width: 10.0,
                height: 10.0,
                items: vec![item],
            },
            &Images::new(),
            254.0,
            &kw_core::color::Cms::default(),
        )
        .unwrap();
        let p = Params {
            mode: Mode::Outline,
            threshold: 128,
            speckle: 16,
            smooth: 0.5,
            ..Params::default()
        };
        let one = run(&B64.encode(&png), &p, 10.0, 10.0).unwrap();
        assert!(one.len() == 1 && one[0].rgb.is_none() && one[0].subpaths.len() == 1);
        let color = run(&B64.encode(&png), &Params { mode: Mode::Color, ..p }, 10.0, 10.0).unwrap();
        assert!(color.len() == 1 && color[0].rgb == Some([0.0, 0.0, 0.0]), "Hintergrund weg, Schwarz bleibt");
        assert!(run("%%%", &p, 10.0, 10.0).unwrap_err().contains("Bild"));
    }

    /// Vertrag mit src/io/bridge.ts: genau dieses JSON schickt das Panel (Vorgaben, farbig), so kommt das Ergebnis zurück.
    #[test]
    fn json_wie_vom_panel() {
        let p: Params = serde_json::from_str(
            r#"{"mode":"color","threshold":128,"speckle":16,"smooth":0.5,"corners":0.3,"colors":8,"merge":true,"background":"edge","cutout":false}"#,
        )
        .unwrap();
        assert!(p.mode == Mode::Color && p.colors == 8 && p.merge && !p.cutout && p.corners == 0.3);
        assert_eq!(p.background, kw_core::trace::Background::Edge);
        for (s, b) in [("keep", "Keep"), ("all", "All")] {
            let q: Params = serde_json::from_str(&format!(r#"{{"background":"{s}"}}"#)).unwrap();
            assert_eq!(format!("{:?}", q.background), b);
        }
        let piece = serde_json::to_value(Piece { rgb: None, subpaths: vec![] }).unwrap();
        assert_eq!(piece, serde_json::json!({ "rgb": null, "subpaths": [] }));
    }
}
