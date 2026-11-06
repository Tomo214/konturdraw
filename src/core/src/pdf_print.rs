//! Druckfertiges PDF (3g-2): PDF/X-4 (ISO 15930-7). Alles in CMYK über das Dokumentprofil, das als
//! Output-Intent eingebettet wird; Endformat = Seite (TrimBox), Beschnittzugabe (BleedBox), Schnittmarken
//! in Passerfarbe außerhalb des Beschnitts. Text liegt als Kurven vor – keine Schriften nötig.
use crate::color::Cms;
use crate::pdf_export::{write, Ids};
use crate::scene::Scene;
use crate::Images;
use pdf_writer::types::{OutputIntentSubtype, TrappingStatus};
use pdf_writer::writers::Catalog;
use pdf_writer::{Content, Date, Name, Pdf, Ref, TextStr};
use sha2::{Digest, Sha256};

const PT: f64 = 72.0 / 25.4;
/// Schnittmarken: Abstand hinter dem Beschnitt und Länge, in mm.
const GAP: f64 = 2.0;
const LEN: f64 = 5.0;

pub struct Print {
    /// Beschnittzugabe je Seite in mm
    pub bleed: f64,
    pub marks: bool,
    pub title: String,
    pub time: Stamp,
}

impl Print {
    /// Rand des Blatts um das Endformat in mm.
    pub(crate) fn margin(&self) -> f64 {
        self.bleed + if self.marks { GAP + LEN } else { 0.0 }
    }
}

/// Zeitpunkt in UTC.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stamp {
    pub year: u16,
    pub month: u8,
    pub day: u8,
    pub hour: u8,
    pub minute: u8,
    pub second: u8,
}

impl Stamp {
    /// Sekunden seit 1970 → Kalenderdatum (Algorithmus „civil_from_days“ von H. Hinnant).
    pub fn from_unix(secs: u64) -> Stamp {
        let z = (secs / 86_400) as i64 + 719_468;
        let era = z.div_euclid(146_097);
        let doe = z - era * 146_097;
        let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        let mp = (5 * doy + 2) / 153;
        let month = if mp < 10 { mp + 3 } else { mp - 9 };
        let year = yoe + era * 400 + i64::from(month <= 2);
        let rem = secs % 86_400;
        Stamp {
            year: year as u16,
            month: month as u8,
            day: (doy - (153 * mp + 2) / 5 + 1) as u8,
            hour: (rem / 3600) as u8,
            minute: (rem / 60 % 60) as u8,
            second: (rem % 60) as u8,
        }
    }

    fn pdf(&self) -> Date {
        Date::new(self.year)
            .month(self.month)
            .day(self.day)
            .hour(self.hour)
            .minute(self.minute)
            .second(self.second)
            .utc_offset_hour(0)
    }

    fn iso(&self) -> String {
        format!(
            "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
            self.year, self.month, self.day, self.hour, self.minute, self.second
        )
    }
}

pub fn export(scene: &Scene, images: &Images, cms: &Cms, print: &Print) -> Result<Vec<u8>, String> {
    write(scene, images, cms, Some(print))
}

/// Schnittmarken an den vier Ecken des Endformats; Farbe ist schon gesetzt (Passer).
pub(crate) fn marks(c: &mut Content, w: f64, h: f64, p: &Print) {
    let (s, e) = (p.bleed + GAP, p.bleed + GAP + LEN);
    c.set_line_width((0.25 / PT) as f32); // 0,25 pt
    for (x, y, dx, dy) in [
        (0.0, 0.0, -1.0, -1.0),
        (w, 0.0, 1.0, -1.0),
        (0.0, h, -1.0, 1.0),
        (w, h, 1.0, 1.0),
    ] {
        let f = |v: f64| v as f32;
        c.move_to(f(x + dx * s), f(y)).line_to(f(x + dx * e), f(y));
        c.move_to(f(x), f(y + dy * s)).line_to(f(x), f(y + dy * e));
    }
    c.stroke();
}

/// Objekte für Output-Intent, XMP und Dokument-Info; vor dem Katalog reservieren.
pub(crate) struct Meta {
    icc: Ref,
    xmp: Ref,
    info: Ref,
}

impl Meta {
    pub(crate) fn new(ids: &mut Ids) -> Meta {
        Meta {
            icc: ids.next(),
            xmp: ids.next(),
            info: ids.next(),
        }
    }

    pub(crate) fn catalog(&self, cat: &mut Catalog, profile: &str) {
        cat.metadata(self.xmp);
        cat.output_intents()
            .push()
            .subtype(OutputIntentSubtype::PDFX)
            .output_condition_identifier(TextStr("Custom"))
            .output_condition(TextStr(profile))
            .info(TextStr(profile))
            .dest_output_profile(self.icc);
    }

    /// Profil, Metadaten, Kennungen; `content` = Seiteninhalt, aus dem die Datei-IDs abgeleitet werden.
    pub(crate) fn finish(&self, pdf: &mut Pdf, p: &Print, icc: &[u8], content: &[u8]) {
        pdf.set_version(1, 6);
        pdf.icc_profile(self.icc, icc)
            .n(4)
            .alternate()
            .device_cmyk();

        let mut h = Sha256::new();
        h.update(content);
        h.update(p.title.as_bytes());
        h.update(p.time.iso().as_bytes());
        let hash = h.finalize();
        pdf.set_file_id((hash[..16].to_vec(), hash[..16].to_vec()));

        let mut info = pdf.document_info(self.info);
        info.title(TextStr(&p.title))
            .creator(TextStr("KonturDraw"))
            .producer(TextStr("KonturDraw"))
            .creation_date(p.time.pdf())
            .modified_date(p.time.pdf())
            .trapped(TrappingStatus::NotTrapped);
        info.pair(Name(b"GTS_PDFXVersion"), TextStr("PDF/X-4"));
        drop(info);

        let xmp = xmp(p, &uuid(&hash[..16]), &uuid(&hash[16..]));
        pdf.metadata(self.xmp, xmp.as_bytes());
    }
}

fn uuid(b: &[u8]) -> String {
    let hex: String = b.iter().map(|v| format!("{v:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// XMP muss zur Dokument-Info passen (Titel, Daten, Programm, Trapped).
fn xmp(p: &Print, doc: &str, instance: &str) -> String {
    let (t, title) = (p.time.iso(), escape(&p.title));
    format!(
        r#"<?xpacket begin="{bom}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
 xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
 xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">{title}</rdf:li></rdf:Alt></dc:title>
<xmp:CreateDate>{t}</xmp:CreateDate>
<xmp:ModifyDate>{t}</xmp:ModifyDate>
<xmp:MetadataDate>{t}</xmp:MetadataDate>
<xmp:CreatorTool>KonturDraw</xmp:CreatorTool>
<pdf:Producer>KonturDraw</pdf:Producer>
<pdf:Trapped>False</pdf:Trapped>
<xmpMM:DocumentID>uuid:{doc}</xmpMM:DocumentID>
<xmpMM:InstanceID>uuid:{instance}</xmpMM:InstanceID>
<xmpMM:VersionID>1</xmpMM:VersionID>
<xmpMM:RenditionClass>default</xmpMM:RenditionClass>
<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#,
        bom = '\u{feff}'
    )
}
