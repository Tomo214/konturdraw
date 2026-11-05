// 3f: Farbumrechnung gegen Little-CMS-Referenz (tests/fixtures/color-ref.json aus lcms-ref.py, Pillow/lcms 2.19).
use kw_core::color::{cmyk_profile_name, Cms, ColorMode, ColorSettings, RenderIntent};
use kw_core::scene::{Color, ColorModel};
use serde::Deserialize;

const GENERIC_CMYK: &str = "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc";
const SRGB_ICC: &str = "/System/Library/ColorSync/Profiles/sRGB Profile.icc";
const INTENTS: [RenderIntent; 4] = [
    RenderIntent::Perceptual,
    RenderIntent::Relative,
    RenderIntent::Saturation,
    RenderIntent::Absolute,
];

#[derive(Deserialize)]
struct Reference {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    intent: RenderIntent,
    from: String,
    #[serde(rename = "in")]
    input: Vec<f64>,
    out: Vec<f64>,
}

/// Systemprofil nur auf macOS; fehlt es, wird der Test übersprungen.
fn generic_cmyk() -> Option<Vec<u8>> {
    let icc = std::fs::read(GENERIC_CMYK).ok();
    if icc.is_none() {
        eprintln!("übersprungen: {GENERIC_CMYK} fehlt");
    }
    icc
}

fn cms(intent: RenderIntent, icc: &[u8]) -> Cms {
    let settings = ColorSettings {
        mode: ColorMode::Cmyk,
        intent,
        ..Default::default()
    };
    Cms::new(&settings, Some(icc)).unwrap()
}

fn color(json: &str) -> Color {
    serde_json::from_str(json).unwrap()
}

fn to_bytes(v: &[f64]) -> Vec<f64> {
    v.iter().map(|x| (x * 255.0).round()).collect()
}

#[test]
fn matches_little_cms_reference() {
    let Some(icc) = generic_cmyk() else { return };
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/color-ref.json"
    );
    let reference: Reference =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let all: Vec<(RenderIntent, Cms)> = INTENTS.iter().map(|&i| (i, cms(i, &icc))).collect();
    assert_eq!(reference.cases.len(), 468);
    for case in &reference.cases {
        let cms = &all.iter().find(|(i, _)| *i == case.intent).unwrap().1;
        let unit: Vec<f64> = case.input.iter().map(|v| v / 255.0).collect();
        let got = match case.from.as_str() {
            "cmyk" => to_bytes(&cms.srgb(&Color::cmyk(unit[0], unit[1], unit[2], unit[3]))),
            _ => to_bytes(&cms.cmyk(&Color::rgb(unit[0], unit[1], unit[2]))),
        };
        for (g, w) in got.iter().zip(&case.out) {
            assert!(
                (g - w).abs() <= 1.0,
                "{:?} {} {:?}: {got:?} statt {:?}",
                case.intent,
                case.from,
                case.input,
                case.out
            );
        }
    }
}

#[test]
fn reads_profile_name_and_rejects_non_cmyk() {
    let Some(icc) = generic_cmyk() else { return };
    assert_eq!(
        cms(RenderIntent::Relative, &icc).profile_name(),
        Some("Allgemeines CMYK-Profil")
    );
    let srgb = std::fs::read(SRGB_ICC).unwrap();
    let err = Cms::new(&ColorSettings::default(), Some(&srgb))
        .err()
        .unwrap();
    assert!(err.contains("kein CMYK-Profil"), "{err}");
    let err = Cms::new(&ColorSettings::default(), Some(b"kein icc"))
        .err()
        .unwrap();
    assert!(err.contains("ICC-Profil"), "{err}");
    // Profil-Liste: Name ohne Umrechner, nur Druckerprofile
    assert_eq!(cmyk_profile_name(&icc).unwrap(), "Allgemeines CMYK-Profil");
    assert!(cmyk_profile_name(&srgb).is_err());
}

#[test]
fn same_model_passes_through_unchanged() {
    let Some(icc) = generic_cmyk() else { return };
    let cms = cms(RenderIntent::Perceptual, &icc);
    assert_eq!(cms.srgb(&Color::rgb(0.2, 0.4, 0.6)), [0.2, 0.4, 0.6]);
    assert_eq!(
        cms.cmyk(&Color::cmyk(0.1, 0.2, 0.3, 0.4)),
        [0.1, 0.2, 0.3, 0.4]
    );
}

#[test]
fn gray_is_neutral_rgb_and_k_only_cmyk() {
    let cms = Cms::default();
    let gray = color(r#"{"model":"gray","values":[0.25]}"#);
    assert_eq!(cms.srgb(&gray), [0.25, 0.25, 0.25]);
    assert_eq!(cms.cmyk(&gray), [0.0, 0.0, 0.0, 0.75]);
}

#[test]
fn without_profile_uses_naive_formula() {
    let cms = Cms::default();
    assert_eq!(cms.profile_name(), None);
    assert_eq!(cms.srgb(&Color::cmyk(0.5, 0.0, 1.0, 0.5)), [0.25, 0.5, 0.0]);
    let [c, m, y, k] = cms.cmyk(&Color::rgb(0.2, 0.4, 0.8));
    for (got, want) in [c, m, y, k].iter().zip([0.75, 0.5, 0.0, 0.2]) {
        assert!((got - want).abs() < 1e-12, "{got} statt {want}");
    }
    assert_eq!(cms.cmyk(&Color::rgb(0.0, 0.0, 0.0)), [0.0, 0.0, 0.0, 1.0]);
}

#[test]
fn spot_converts_through_its_alternate_values() {
    let cms = Cms::default();
    let spot = color(r#"{"model":"cmyk","values":[0,1,0,0],"spot":"Stencil-Violett"}"#);
    assert_eq!(spot.spot.as_deref(), Some("Stencil-Violett"));
    assert_eq!(cms.srgb(&spot), [1.0, 0.0, 1.0]);
}

#[test]
fn rejects_values_that_do_not_fit_the_model() {
    for bad in [
        r#"{"model":"rgb","values":[0,0,0,0]}"#,
        r#"{"model":"cmyk","values":[0,0,0]}"#,
        r#"{"model":"gray","values":[0,0]}"#,
        r#"{"model":"rgb","values":[0,2,0]}"#,
        r#"{"model":"lab","values":[0,0,0]}"#,
    ] {
        assert!(serde_json::from_str::<Color>(bad).is_err(), "{bad}");
    }
    let c = color(r#"{"model":"cmyk","values":[0.1,0.2,0.3,0.4]}"#);
    assert_eq!(
        serde_json::to_string(&c).unwrap(),
        r#"{"model":"cmyk","values":[0.1,0.2,0.3,0.4]}"#
    );
}

#[test]
fn settings_read_camel_case_with_defaults() {
    let s: ColorSettings =
        serde_json::from_str(r#"{"mode":"cmyk","cmykProfile":"/x.icc","intent":"perceptual"}"#)
            .unwrap();
    assert_eq!(
        (s.mode, s.cmyk_profile.as_deref(), s.intent),
        (ColorMode::Cmyk, Some("/x.icc"), RenderIntent::Perceptual)
    );
    let d: ColorSettings = serde_json::from_str("{}").unwrap();
    assert_eq!(
        (d.mode, d.cmyk_profile, d.intent),
        (ColorMode::Rgb, None, RenderIntent::Relative)
    );
}

#[test]
fn proof_shows_colors_after_the_trip_through_the_print_profile() {
    let Some(icc) = generic_cmyk() else { return };
    let cms = cms(RenderIntent::Relative, &icc);
    let green = Color::rgb(0.1, 0.9, 0.2); // außerhalb des Druckbereichs
    let [c, m, y, k] = cms.cmyk(&green);
    let proofed = cms.proof(&green);
    assert_eq!(proofed, cms.srgb(&Color::cmyk(c, m, y, k)));
    assert!(
        to_bytes(&proofed) != to_bytes(&cms.srgb(&green)),
        "{proofed:?}"
    );
    let cmyk = Color::cmyk(0.2, 0.3, 0.4, 0.1);
    assert_eq!(cms.proof(&cmyk), cms.srgb(&cmyk));
    let gray = color(r#"{"model":"gray","values":[0.5]}"#);
    assert_eq!(cms.proof(&gray), cms.srgb(&Color::cmyk(0.0, 0.0, 0.0, 0.5)));
}

#[test]
fn model_switch_converts_through_the_profile_and_drops_the_spot_name() {
    let Some(icc) = generic_cmyk() else { return };
    let cms = cms(RenderIntent::Relative, &icc);
    let orange = Color::rgb(1.0, 0.5, 0.0);
    let [c, m, y, k] = cms.cmyk(&orange);
    assert_eq!(
        cms.convert(&orange, ColorModel::Cmyk),
        Color::cmyk(c, m, y, k)
    );
    let spot = color(r#"{"model":"cmyk","values":[0.6,0.9,0,0],"spot":"Stencil-Violett"}"#);
    let [r, g, b] = cms.srgb(&spot);
    assert_eq!(cms.convert(&spot, ColorModel::Rgb), Color::rgb(r, g, b));
    assert_eq!(
        cms.convert(&spot, ColorModel::Cmyk),
        spot,
        "gleiches Modell bleibt, wie es ist"
    );
}

#[test]
fn gray_from_k_only_is_exact_otherwise_luminance() {
    let cms = Cms::default();
    let gray = |v: f64| color(&format!(r#"{{"model":"gray","values":[{v}]}}"#));
    assert_eq!(
        cms.convert(&Color::cmyk(0.0, 0.0, 0.0, 0.75), ColorModel::Gray),
        gray(0.25)
    );
    assert_eq!(
        cms.convert(&gray(0.25), ColorModel::Cmyk),
        Color::cmyk(0.0, 0.0, 0.0, 0.75)
    );
    assert_eq!(
        cms.convert(&Color::rgb(1.0, 1.0, 1.0), ColorModel::Gray),
        gray(1.0)
    );
    let g = cms
        .convert(&Color::rgb(0.0, 1.0, 0.0), ColorModel::Gray)
        .values[0];
    assert!((g - 0.587).abs() < 1e-12, "{g}");
}
