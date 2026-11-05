//! Formen-Befehle: Aufträge kommen fertig geplant aus der Oberfläche (model/shaping.ts), gerechnet wird in kw-core.
use kw_core::boolean::cut::{erase, knife};
use kw_core::boolean::outline::outline;
use kw_core::boolean::{apply, Op, Shape};
use kw_core::scene::{Cap, Join, Subpath};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Job {
    op: Op,
    shapes: Vec<Shape>,
}

fn run(jobs: &[Job]) -> Result<Vec<Vec<Subpath>>, String> {
    jobs.iter().map(|j| apply(j.op, &j.shapes)).collect()
}

/// Rechnet abseits der Oberfläche; sie bleibt bedienbar.
#[tauri::command]
pub async fn shape_objects(jobs: Vec<Job>) -> Result<Vec<Vec<Subpath>>, String> {
    tauri::async_runtime::spawn_blocking(move || run(&jobs))
        .await
        .map_err(|e| e.to_string())?
}

/// Messer: ein Objekt, ein Schnitt (Weltkoordinaten).
#[derive(Deserialize)]
pub struct KnifeJob {
    shape: Shape,
    cut: Subpath,
}

/// Radierer: ein Objekt, die Spur der Spitze.
#[derive(Deserialize)]
pub struct EraseJob {
    shape: Shape,
    trail: Subpath,
    width: f64,
    square: bool,
}

type Pieces = Option<Vec<Vec<Subpath>>>;

fn run_knife(jobs: &[KnifeJob]) -> Result<Vec<Pieces>, String> {
    jobs.iter().map(|j| knife(&j.shape, &j.cut)).collect()
}

fn run_erase(jobs: &[EraseJob]) -> Result<Vec<Option<Vec<Subpath>>>, String> {
    jobs.iter()
        .map(|j| erase(&j.shape, &j.trail, j.width, j.square))
        .collect()
}

#[tauri::command]
pub async fn knife_objects(jobs: Vec<KnifeJob>) -> Result<Vec<Pieces>, String> {
    tauri::async_runtime::spawn_blocking(move || run_knife(&jobs))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn erase_objects(jobs: Vec<EraseJob>) -> Result<Vec<Option<Vec<Subpath>>>, String> {
    tauri::async_runtime::spawn_blocking(move || run_erase(&jobs))
        .await
        .map_err(|e| e.to_string())?
}

/// Kontur in Objekt: Teilpfade in Seiten-mm, Breite in Seiten-mm.
#[derive(Deserialize)]
pub struct OutlineJob {
    subpaths: Vec<Subpath>,
    width: f64,
    cap: Cap,
    join: Join,
}

fn run_outline(jobs: &[OutlineJob]) -> Result<Vec<Vec<Subpath>>, String> {
    jobs.iter()
        .map(|j| outline(&j.subpaths, j.width, j.cap, j.join))
        .collect()
}

#[tauri::command]
pub async fn outline_objects(jobs: Vec<OutlineJob>) -> Result<Vec<Vec<Subpath>>, String> {
    tauri::async_runtime::spawn_blocking(move || run_outline(&jobs))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    // Gleiches Format wie ShapeJob in model/shaping.ts
    fn job(json: &str) -> Job {
        serde_json::from_str(json).unwrap()
    }
    const SQ: &str = r#"{"closed":true,"nodes":[{"x":0,"y":0,"type":"corner"},{"x":10,"y":0,"type":"corner"},{"x":10,"y":10,"type":"corner"},{"x":0,"y":10,"type":"corner"}]}"#;
    const SQ2: &str = r#"{"closed":true,"nodes":[{"x":5,"y":5,"type":"corner"},{"x":15,"y":5,"type":"corner"},{"x":15,"y":15,"type":"corner"},{"x":5,"y":15,"type":"corner"}]}"#;

    #[test]
    fn auftraege_aus_der_oberflaeche() {
        let union = job(&format!(
            r#"{{"op":"union","shapes":[{{"subpaths":[{SQ}],"evenOdd":false}},{{"subpaths":[{SQ2}],"evenOdd":true}}]}}"#
        ));
        let diff = job(&format!(
            r#"{{"op":"difference","shapes":[{{"subpaths":[{SQ}],"evenOdd":false}},{{"subpaths":[{SQ}],"evenOdd":false}}]}}"#
        ));
        let r = run(&[union, diff]).unwrap();
        assert_eq!(r[0].len(), 1);
        assert_eq!(r[0][0].nodes.len(), 8);
        assert!(r[1].is_empty());
    }

    // Gleiches Format wie KnifeJob/EraseJob in model/cutting.ts
    const CUT: &str = r#"{"closed":false,"nodes":[{"x":4,"y":-5,"type":"corner"},{"x":4,"y":15,"type":"corner"}]}"#;

    #[test]
    fn messer_und_radierer_auftraege() {
        let k: KnifeJob = serde_json::from_str(&format!(
            r#"{{"shape":{{"subpaths":[{SQ}],"evenOdd":false}},"cut":{CUT}}}"#
        ))
        .unwrap();
        let r = run_knife(&[k]).unwrap();
        assert_eq!(r[0].as_ref().map(|g| g.len()), Some(2));
        let e: EraseJob = serde_json::from_str(&format!(
            r#"{{"shape":{{"subpaths":[{SQ}],"evenOdd":false}},"trail":{CUT},"width":2,"square":false}}"#
        ))
        .unwrap();
        let r = run_erase(&[e]).unwrap();
        assert_eq!(r[0].as_ref().map(|g| g.len()), Some(2));
    }

    #[test]
    fn kontur_auftrag() {
        let o: OutlineJob = serde_json::from_str(&format!(
            r#"{{"subpaths":[{SQ}],"width":2,"cap":"butt","join":"miter"}}"#
        ))
        .unwrap();
        let r = run_outline(&[o]).unwrap();
        assert_eq!(r[0].len(), 2, "Ring: außen + Loch");
    }
}
