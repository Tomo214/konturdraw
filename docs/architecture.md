# Konturwerk – Architektur (Phase 2)

Stand: 2026-11-02 · Status: **Entwurf, wartet auf Abnahme** · Basis: `spec.md` (abgenommen)

Annahmen aus Spec §15, weil unbeantwortet: kein Verkauf ausgeschlossen → **kein GPL-Code**; kein Windows-Rechner → Windows nur über CI; Drucker/Plotter generisch.

## 0. Empfehlung

**Tauri 2 + TypeScript (Svelte 5) + Canvas 2D.** Dokumentmodell in TypeScript. Rust als Bibliothek **zustandsloser Funktionen** (Geometrie, Nachzeichnen, Text-Konturen, Import/Export, Farbe), nativ hinter Tauri-Befehlen. `.cdr` über separaten Hilfsprozess.

## 1. Abweichungen von deinem Vorschlag

| Vorschlag | Stattdessen | Grund |
|---|---|---|
| Canvas/WebGL | **Canvas 2D**, WebGL nur falls Leistungs-Gate (§6) scheitert | Canvas 2D bringt Kantenglättung, Konturen, Trefferprüfung (`isPointInPath`) gratis. WebGL heißt: Tessellierung, eigene Linien-Shader, eigene Kantenglättung = Wochen Mehrarbeit ohne belegten Bedarf. |
| Rust-Kern für Geometrie | Ja, aber **Dokument + Undo in TypeScript** | Ziehen, Knoten-Bearbeitung, Auswahl laufen 60×/s. Läge das Modell in Rust, kostet jede Mausbewegung einen IPC-Umlauf. Rust bekommt nur Operationen, die einmal pro Befehl laufen (Boolesch, Nachzeichnen, Export). |
| (implizit) Rust per WASM im Webview | **Kein WASM**, Rust nativ | Nichts aus Rust wird pro Frame gebraucht → IPC reicht. Spart WASM-Toolchain; Nachzeichnen nutzt native Threads. |
| libcdr eingelinkt | **Hilfsprozess** (eigene Binärdatei) | C++ mit boost/icu bleibt aus dem App-Build; ein Absturz beim Parsen fremder Dateien reißt die App nicht mit. |

**Spec-Abweichung (braucht dein OK):** SVG-Import über `usvg` wandelt Text und Rechtecke/Ellipsen in Pfade um. Spec §11 sagt „Import … Text“. Vorschlag: Text kommt als Kurven an (P0), editierbarer Text aus SVG wird P2.

## 2. Schichten

```
┌──────────────────────── Webview (WKWebView / WebView2) ────────────────────────┐
│  UI  (Svelte 5)        Werkzeuge, Panels, Eigenschaften-Leiste, Objekt-Manager │
│  Model (TypeScript)    Dokument, Ebenen, Gruppen, Befehle, Undo/Redo, Auswahl  │
│  Render (Canvas 2D)    Path2D-Cache, rbush-Index, Gesten-Bitmap                │
│  Bridge                invoke("…") → Tauri-Befehle                             │
└──────────────────────────────────────┬─────────────────────────────────────────┘
                                       │ JSON / Binär-IPC
┌──────────────────────── Tauri-Hülle (Rust, src/tauri) ─────────────────────────┐
│  Dateien, Dialoge, Autosave, Absturz-Wiederherstellung, Drucken, Schriften     │
│  ruft ↓                                       startet ↓                        │
│  kw-core (Rust, src/core): reine Funktionen   cdr-import (Hilfsprozess, libcdr)│
└────────────────────────────────────────────────────────────────────────────────┘
```

Regel: `kw-core` hat **keinen Zustand und kein I/O** → komplett mit `cargo test` prüfbar, ohne App.

## 3. Wer macht was

| Aufgabe | Ort | Warum dort |
|---|---|---|
| Dokument, Befehle, Undo/Redo, Auswahl | TS Model | interaktiv, 60 fps |
| Knoten ziehen, Bézier-Griffe, Transformieren | TS Model | pro Mausbewegung |
| Trefferprüfung | TS Render (`isPointInPath`/`isPointInStroke`) | Browser kann es schon |
| Boolesche Operationen, Pfad vereinfachen | kw-core | numerisch heikel, testbar |
| Nachzeichnen (Mittellinie + Umriss) | kw-core | rechenintensiv, Threads |
| Text formen + Glyphen-Konturen, Text auf Pfad | kw-core | Bildschirm = Export (WYSIWYG) |
| ICC-Umrechnung, Soft-Proof-Farben | kw-core (lcms2) | C-Bibliothek, nur nativ |
| Export SVG / PDF / PNG / DXF / HPGL | kw-core | Ausgabe identisch auf Mac + Win |
| Import SVG / PNG / JPG | kw-core | Parser in Rust |
| Import CDR | Hilfsprozess → SVG → kw-core | Isolation, s. §1 |
| Dateien, Autosave, Drucken, Systemschriften | Tauri-Hülle | Betriebssystem-Zugriff |

Exporte (3g-2): **Druckfertig = PDF/X-4** (ISO 15930-7) – alles DeviceCMYK über das Dokumentprofil (auch Bilder), OutputIntent = dieses Profil, Beschnitt + Schnittmarken, Text als Kurven → keine Schriften im PDF, kein fsType-Problem. **Plotter/Laser:** DXF R12 (Polylinien, mm) und HPGL (Standard 40 Einh./mm), Kurven auf 0,01 mm geglättet, nur Konturen sichtbarer Pfade. **CDR:** Hilfsprozess `kw-cdr` (src/cdr-import/build.sh) liefert ein SVG je Seite, importiert wird Seite 1; Zeitlimit 30 s.

## 4. Bibliotheken und Lizenzen

Keine GPL/AGPL in ausgelieferter Software. Prüfung automatisch per `cargo-deny` (Rust) und Lizenz-Check (npm) in CI, Erlaubt-Liste: MIT, Apache-2.0, BSD, ISC, Zlib, MPL-2.0, Unicode, BSL-1.0 (boost-Header im CDR-Hilfsprozess).

| Zweck | Bibliothek | Lizenz | Stand |
|---|---|---|---|
| App-Hülle | Tauri 2 | MIT/Apache-2.0 | Wissen |
| UI | Svelte 5 + Vite | MIT | Wissen |
| Räumlicher Index | rbush | MIT | Wissen |
| Bézier-Mathe, Bogenlänge, Kurven-Fit | kurbo | MIT/Apache-2.0 | Wissen |
| Boolesch (Polygon, ganzzahlig robust) | i_overlay 9.1 + eigene Kurven-Rückgewinnung (kurbo 0.13) | MIT/Apache-2.0 | **gewählt** nach Spike 3d |
| Boolesch (Kurven direkt) | linesweeper 0.5 | MIT/Apache-2.0 | verworfen: deckungsgleiche Kreise falsch (5/120 im Korpus) |
| Umriss-Nachzeichnen (s/w + farbig) | visioncortex 0.9.3 (Kern von vtracer) + eigene Farbreduktion (`trace/colors.rs`) | MIT | **gewählt** (5d) |
| Mittellinien-Nachzeichnen | **eigener Code** (Skelett → Graph → Kurven-Fit) | – | keine passende freie Bibliothek |
| SVG-Import | usvg | MIT/Apache-2.0 | Wissen |
| PNG/JPG lesen | image | MIT/Apache-2.0 | Wissen |
| PNG-Export (Rastern) | tiny-skia | BSD-3 | Wissen |
| PDF schreiben | pdf-writer (Text kommt als Kurven an, daher kein subsetter) | MIT/Apache-2.0 | **gebaut** |
| Text: Schriften finden, formen, Konturen | fontdb, harfrust, skrifa (über usvg) | MIT (/Apache) | Wissen |
| ICC-Farbmanagement | lcms2 (Little CMS) | MIT | Wissen |
| Eigenes Dateiformat | zip, serde_json | MIT/Apache-2.0 | Wissen |
| CDR lesen (Hilfsprozess) | libcdr 0.1.9 + eigener Patch `src/cdr-import/patches/` (Bild-Alpha, Füllungen CDR 2024, Vorlagen .cdt), librevenge 0.0.6 (statisch; Quellen vom LibreOffice-Spiegel, SHA-256 aus dessen download.lst); boost-Header; macOS: lcms2 aus lcms2-sys, ICU + zlib vom System; Windows (MSYS2 UCRT64): lcms2 + zlib + MinGW-Laufzeit statisch, ICU = `icu.dll` von Windows | MPL-2.0 (librevenge MPL/LGPL, gewählt MPL); boost BSL-1.0; lcms2 MIT; zlib-Lizenz; libstdc++/libgcc mit GCC Runtime Library Exception (keine GPL-Pflicht für das Programm) | **gebaut** auf macOS (nur System-dylibs) und Windows (nur System-DLLs, CI-Job `cdr`); per `bundle.externalBin` neben der App |

„Wissen“ = aus Erfahrung, wird in 3a durch `cargo-deny` hart geprüft.
MPL-2.0 (libcdr): ausgelieferte Binärdatei → Quelltext der MPL-Dateien muss zugänglich sein, auch unser Patch (liegt als Datei im Repo, `build.sh` wendet ihn an). Kein Problem, auch nicht beim Verkauf.

Nur zum Testen, nie ausgeliefert: vitest (MIT), Playwright (Apache-2.0), qpdf (Apache-2.0), Ghostscript (AGPL, lokal als Prüfwerkzeug).

**Mittellinie = eigener Code**, weil die bekannten freien Lösungen GPL sind (potrace kennt keine Mittellinie; autotrace ist GPL [ungeprüft]). Ablauf: Graustufen → Schwellwert → Flecken filtern → Verdünnung auf 1 px (Zhang-Suen) → Pixelgraph (Enden, Kreuzungen) → kurze Äste kappen → Polylinien vereinfachen → kubische Béziers fitten (kurbo). Geschätzt 600–900 Zeilen Rust.

## 5. Datenmodell (Kern)

```
Document  { schemaVersion, units:"mm", pages[], palettes?[], color?:{mode:"rgb"|"cmyk", cmykProfile: Pfad|null, intent} }
          // Seit 3f: cmykProfile null = Systemprofil (Tauri sucht es); intent gilt für beide Richtungen, Tiefenkompensierung immer an.
Palette   { id, name, colors:[{ name, color }] }   // eigene Paletten im Dokument; Standardpalette (24 CMYK) gehört zum Programm
          // Datei .kwp = JSON { format:"konturwerk-palette", version:1, name, colors }
Page      { id, width, height, layers[] }
Layer     { id, name, visible, locked, printable, children: Node[] }
Node      = Group | Path | Shape | Text | Image
  gemeinsam: { id, name?, transform: [a,b,c,d,e,f], style:{fill, stroke}, version }
Shape     { shape: rect{x,y,width,height,radius} | ellipse{x,y,width,height} | polygon{x,y,width,height,sides,inner|null} }
          // Seit 3c ein Typ statt Rect/Ellipse/Polygon. shape ist eigenes Objekt: Verschieben ändert nur transform,
          // Bézier-Cache (je shape) bleibt gültig. Skalieren über transform → Eckenradius verzerrt bei ungleicher Skalierung.
Path      { subpaths: [{ closed, nodes: [{ x, y, type:"corner"|"smooth"|"symmetric", handleIn?, handleOut? }] }] }   // mm, float64; Griffe absolut
          // Segment i = nodes[i] → nodes[i+1] (geschlossen: letzter → erster); Gerade, wenn beide Griffe fehlen.
          // Seit 3b statt M/L/C-Liste: Knotentyp gehört zum Knoten, Knoten-Werkzeug braucht ihn direkt.
Color     { model:"rgb"|"cmyk"|"gray", values[], spot?: name }   // 0..1; gray: 0 = Schwarz, druckt als reines K
          // Anzeige: CMYK/Proof exakt je Farbe über lcms (Tauri display_colors, gebündelt + Cache), keine LUT (Fehler zu groß).
          // Modellwechsel (convert): neues Modell = Prozessfarbe (spot fällt weg); K-only → gray exakt 1−k, sonst Helligkeit 0,299/0,587/0,114.
          // Sonderfarben werden über ihre Ersatzwerte umgerechnet.
Stroke    { color, width_mm, cap, join, scaleWithObject? }   // fehlt/false: Breite bleibt in Seiten-mm, nie verzerrt (seit 3c)
Fill      = Color | Gradient
Gradient  { kind:"linear"|"radial", from, to, stops:[{ offset 0..1, color }] }   // Objekt-Koordinaten; radial: Mitte from, Radius |to − from|
```

- **Undo:** Stapel unveränderlicher Dokument-Zustände; Unberührtes wird geteilt → ein Schritt kostet nur die geänderten Knoten (nicht das ganze Dokument). Ziehen = eine Transaktion. Tiefe ≥ 200 (Standard 500).
- **Dateiformat `.kwk`:** ZIP mit `document.json` (versioniertes Schema) + `images/<hash>.png`. JSON bleibt lesbar → Fehlersuche und Migration einfach.
- **Einheiten:** intern mm als float64; Anzeige mm/cm/in/pt/px.

## 6. Rendern und Leistung

- Ein `Path2D` pro Objekt, im Cache bis sich `version` ändert.
- `rbush`-Index → nur Objekte im Sichtbereich zeichnen.
- Während Pan/Zoom-Geste: letztes Bild als Bitmap verschieben/skalieren; scharf neu zeichnen nach ~100 ms Ruhe.
- Text wird als Glyphen-Kontur aus kw-core gezeichnet → Bildschirm und Export identisch, keine Schrift-Unterschiede Mac/Win.
- **Leistungs-Gate in 3a** (Beleg-Skript): 10 000 Objekte (gemischt Füllung/Kontur, Kurven) → Pan/Zoom p95-Frame < 18 ms oder ≤ 5 % verpasste Bilder (> 25 ms; nötig, weil WebKit rAF nur ms-genau liefert), Klick-Auswahl < 50 ms, Öffnen < 2 s. Messung: `tests/perf/run-bench.cjs` (Chrome nativ arm64 + Playwright-WebKit) + echte Tauri-App (WKWebView); Belege in `tests/perf/results/`. Scheitert es → Plan B: WebGL mit Tessellierung (lyon, MIT/Apache).

## 7. Plattform-Themen

| Thema | Lösung | Beleg |
|---|---|---|
| Drucken 1:1 | Weg A: Druckseite als SVG mit `@page`-Größe in mm → Webview-Druck (WKWebView/WebView2). Weg B (Ersatz): PDF erzeugen → System-Viewer | Spike in 3h: Testdruck mit 100-mm-Linie, Lineal-Messung ±0,5 mm, Mac von dir, Windows offen |
| Gespiegelt drucken | Transform beim Erzeugen der Druckseite | Teil desselben Spikes |
| Schriften | fontdb liest Systemschriften auf Mac + Win; Einbettungs-Erlaubnis (fsType) beim PDF-Export beachten | Test mit Schrift ohne Einbettungsrecht → wird in Kurven gewandelt + Hinweis |
| Autosave | alle 60 s + nach Änderung im Leerlauf, in App-Datenordner, nie über Originaldatei | Test: Prozess hart beenden → Start bietet Wiederherstellung |
| Signieren | Mac: Notarisierung (Apple-Developer, 99 $/Jahr); Windows: Code-Signing-Zertifikat | nur nötig bei Weitergabe/Verkauf (Spec §15.2) |

## 8. Tests und Belege

| Ebene | Werkzeug | Läuft |
|---|---|---|
| kw-core: Einheit + Golden-Dateien | `cargo test` | Mac lokal + Windows CI |
| Model, Undo, Werkzeug-Logik | vitest | Mac lokal + Windows CI |
| UI-Screenshots, Interaktion | Playwright gegen Vite-Dev-Server, Rust-Brücke gemockt | Mac lokal |
| App-Rauchtest (echte Tauri-App) | eigenes Skript `tests/e2e/windows-smoke.mjs` (DevTools-Protokoll, Port per `KONTURWERK_DEBUG_PORT`) | **nur Windows-CI** |
| App auf Mac | manuell durch dich + Screenshot durch mich | Mac |
| Export-Prüfung | SVG: Re-Import via usvg; PDF: `qpdf --check` + Rendern via Ghostscript; DXF: Parser-Roundtrip; HPGL: Golden-Text | lokal + CI |
| Leistung | Gate-Skript (§6) | lokal |
| Lizenzen | cargo-deny + npm-Lizenzcheck | CI |

CI: GitHub Actions, **nur Windows-Runner**. Mac-Läufe lokal, weil macOS-Minuten bei privaten Repos etwa 10-fach zählen [Annahme, prüfen].

## 9. Ordnerstruktur

```
konturwerk/
  package.json  Cargo.toml (Workspace)  vite.config.ts  tsconfig.json  deny.toml
  src/ui/        Svelte: App, Panels, Werkzeuge
  src/model/     TS: Dokument, Befehle, Undo, Auswahl
  src/render/    TS: Canvas-Renderer, Index, Gesten-Cache
  src/core/      Rust-Crate kw-core (reine Funktionen)
  src/tauri/     Rust: Tauri-Hülle + Befehle
  src/cdr-import/ Build-Skript + Wrapper für libcdr-Hilfsprozess
  tests/         fixtures/, golden/, e2e/, perf/
  docs/          spec.md, architecture.md
```

`src/tauri` weicht von der Tauri-Konvention `src-tauri/` ab (deine Regel: nur /src, /tests, /docs). Wird in 3a geprüft; klappt die CLI damit nicht → `src-tauri/` als einzige begründete Ausnahme.

Alle Dateien < 500 Zeilen.

## 10. Reihenfolge Phase 3 (Stencil zuerst, Spec §15.7)

| Schritt | Inhalt | Überprüfbares Ziel |
|---|---|---|
| 3a | Projektgerüst, Modell, Undo, Minimal-Canvas, Lizenz-Gate | vitest grün; Leistungs-Gate §6 bestanden; `cargo deny check` grün |
| 3b | Pfade, Knoten-Werkzeug, Stift, Freihand, Transformieren | Tests Knoten-Operationen; Screenshot gezeichneter Pfad |
| 3c | Formen, Füllung, Kontur, Verläufe | Golden-Render-Vergleich |
| 3g-1 | Import PNG/JPG/SVG; Export `.kwk`/SVG/PNG/PDF einfach | Roundtrip-Tests |
| 3h | Nachzeichnen (Mittellinie, Umriss s/w) + Drucken 1:1 | Testbild → Mittellinie ±2 px, < 3 s; Testdruck 100 mm ±0,5 mm → **MVP (W1) fertig** |
| 3d | Boolesch: erst Spike linesweeper vs. i_overlay mit Testkorpus, dann einbauen | Korpus 30 Fälle (Löcher, Berührung, deckungsgleiche Kanten) fehlerfrei |
| 3e | Text, Text auf Pfad, in Kurven | Golden-Tests Glyphen-Positionen |
| 3f | CMYK, ICC, Soft-Proof, Paletten, Sonderfarben | bekannte Farbwerte gegen lcms-Referenz |
| 3g-2 | PDF druckfertig, DXF, HPGL, CDR | `qpdf --check`; DXF-Roundtrip; CDR-Testdateien von dir |

Phase 3 enthält zwangsläufig eine **Minimal-Zeichenfläche** (Werkzeuge sind interaktiv). Phase 4 baut die volle Oberfläche: Leisten, Panels, Raster, Hilfslinien, Fangen.

### Reihenfolge Phase 4 (Oberfläche wie Vorbild, Windows zuerst)

Anordnung wie Vorbild: Menüleiste im Fenster · Standardleiste · Eigenschaftsleiste · Werkzeugkasten links · Fläche mit Linealen · Andockfenster rechts · Palettenleiste ganz rechts · Seitenreiter + Statusleiste unten. Optik, Icons und Texte eigen (PRODUCT.md, DESIGN.md).

| Schritt | Inhalt | Überprüfbares Ziel |
|---|---|---|
| 4a | Grundgerüst: App.svelte zerlegen; Menüleiste, Standardleiste, Werkzeugkasten mit eigenen Icons und Flyouts, Andockfenster mit Reitern (bestehende Panels ziehen um), Statusleiste (Cursor in mm, Objektinfo, Füllung/Kontur); Werkzeug-Kürzel nach Vorbild; Hand- und Zoom-Werkzeug | vitest: Kürzel-Tabelle, Zoom-Werkzeug, jeder Menüpunkt löst einen Befehl aus; svelte-check 0; App.svelte ≤ 300 Zeilen; Screenshots 1366×768 und 1920×1080 |
| 4b | Eigenschaftsleiste kontextabhängig: ohne Auswahl Seite (Format, Hoch/Quer, Einheit, Verschiebe-Schritt), mit Auswahl X/Y/B/H, Skalierung, Schloss, Winkel, Spiegeln, je Werkzeug dessen Optionen; Ausrichten und Verteilen (Andockfenster + Tasten L/R/T/B/C/E/P) | Modell-Tests für Transformieren/Ausrichten (mm-genau); Rückgängig je Eingabe ein Schritt |
| 4c | Lineale (Dokumenteinheit, Nullpunkt), Hilfslinien aus Lineal ziehen/verschieben/löschen/sperren, Raster ein/aus + Abstand; in `.kwk` gespeichert | Tests Skalenteilung, Hilfslinien-Modell, `.kwk`-Roundtrip; Screenshot |
| 4d | Fangen an Raster, Hilfslinien, Knoten, Kanten, Mitten (Alt+Y, Alt+Z, Alt+Q wie Vorbild) mit Fangpunkt-Anzeige; Drahtmodell | Tests Fang-Funktion je Ziel und Schwelle; Werkzeuge nutzen sie |
| 4e | Objekt-Manager (Baum Ebenen/Gruppen/Objekte, Ziehen zum Umsortieren, sichtbar/gesperrt/druckbar, umbenennen); mehrere Seiten mit Seitenreitern | Modell-Tests Umsortieren/Seiten; Rückgängig; Screenshot |
| 4f | Werkzeuge aus Spec §5, die in Phase 3 fehlen: Messer, Radierer (X), Pipette | Geometrie-Tests je Werkzeug |

Kürzel-Quelle: CorelDRAW Graphics Suite 2019 Quick Reference Card (product.corel.com), nur Belegung übernommen.

### Phase 5: Lücken + Politur (Timon 04.11.: vor Windows)

Abgleich Spec ↔ Code am 04.11. (Beleg = Datei im Code; „fehlt“ = kein Befehl/Feld gefunden). Erfüllt und hier nicht gelistet: §4 bis auf Gruppe betreten, §5 komplett, §6 bis auf Kontur in Objekt/Farbstopps, §7 Formen-Befehle, §9 komplett, §11 komplett, §12 komplett.

| Spec | Prio | Lücke |
|---|---|---|
| W1 Schritt 2 | P0 | ~~Bild-Deckkraft fehlt~~ erledigt 5a: `ImageNode.opacity`, Transparenz im Andockfenster, Anzeige + PNG/SVG/PDF |
| §4 Gruppen | P0 | ~~Objekt in Gruppe wählen fehlt~~ erledigt 5b: Strg/⌘-Klick eine Stufe tiefer, Strg+Umschalt mehrere, alle Befehle in Seitenkoordinaten, Objekt-Manager klappt auf |
| §7 Pfad vereinfachen | P0 | ~~Knoten reduzieren fehlt~~ erledigt 5a: `reduce.ts`, Knoten-Werkzeug Glätte-Regler + Knopf; gewählte Knoten oder ganzer Pfad, Ecken + Enden fest |
| §6 Transformieren | P0 | ~~Schere nur per Griff~~ erledigt 5a: Neigen H/V als Zahl (relativ, Drehsinn wie Winkel) |
| §6 Kontur in Objekt | P1 | ~~fehlt~~ erledigt 5c: `boolean/outline.rs` (kurbo-Stift, Gehrungsgrenze 10, nonzero vereinigt, Kurven bleiben), `model/outline.ts`; neues Objekt direkt darüber, Original behält Füllung ohne Kontur bzw. entfällt; Windows Strg+Umschalt+Q, Mac nur Menü (⇧⌘Q meldet ab) |
| §6 Verlauf | P1 | ~~nur zwei Farben~~ erledigt 5c: `model/gradient.ts`; Doppelklick auf Linie = Knoten (sichtbare Farbe), auf Knoten = weg, Ziehen = Lage, Klick + Palette = Farbe, Entf; Bedienfeld behält Zwischenknoten. ~~Offen: Farbe auf Linie ziehen, Knotenfelder in Eigenschaftsleiste~~ erledigt 7b/7c |
| §8 Nachzeichnen | P0/P1 | ~~Vorschau, Umriss farbig, Ecken, Hintergrund, Farbanzahl, Zusammenführen fehlen~~ erledigt 5d: `trace/colors.rs` (k-means auf 15-bit-Histogramm ohne Zufall, Flecken → häufigste Nachbarfarbe, Hintergrund = häufigste Randfarbe, Lagen parallel), Ecken-Regler (Umriss: Knickwinkel 15–165°, Mittellinie: Knick über Strichbreite), Panel mit Vorschau Vorher/Nachher · Ergebnis · Drahtmodell (rechnet nur bei offenem Panel, 250 ms entprellt, Übernehmen ohne zweite Rechnung) + Ergebniszeile Kurven/Knoten/Farben/Zeit; 2000 px mit 6 Farben 0,64 s. Gestapelt füllt eine Farbe nur unter Flächen, die sie berührt (kein versteckter Doppelgänger; Befund echte App). ~~Offen: Palette im Panel bearbeiten/zusammenführen, Originalbild löschen~~ erledigt 7a/7d |
| §10 PDF-Schriften | P1 | ~~bewusst so lassen?~~ entschieden 05.11. (Timon): Text bleibt als Kurven im PDF – Druck gleich, Text nicht durchsuchbar |

| Schritt | Inhalt | Überprüfbares Ziel |
|---|---|---|
| 5a ✓ 04.11. | P0-Lücken klein: Bild-Deckkraft (Eigenschaftsleiste, Anzeige + alle Exporte), Knoten reduzieren (Knoten-Werkzeug, Toleranz), Neigen als Zahl | Modell-Tests; Export-Tests Deckkraft; Rückgängig je Eingabe ein Schritt |
| 5b ✓ 04.11. | Objekt in Gruppe wählen und bearbeiten wie Vorbild (Strg-Klick, Objekt-Manager) | Tests Auswahl/Transformation verschachtelt; Rückgängig |
| 5c ✓ 04.11. | Kontur in Objekt (Mod+Shift+Q); Verlauf mit mehreren Farbstopps auf der Verlaufslinie | Geometrie-Tests; Golden PDF/SVG |
| 5d ✓ 04.11. | Nachzeichnen: Vorher/Nachher, Umriss farbig mit Farbanzahl + Zusammenführen, Ecken, Hintergrund entfernen | Testbilder: Farbanzahl, Zeit < 3 s |
| 5e ✓ 04.11. | Bedienung: Menü per Tastatur + ausgegraute Einträge, Mausrad wie Vorbild, Griffe außerhalb der Ecken, App.svelte ≤ 300 Zeilen | vitest Menü-Navigation; Klicktest |
| 5f ✓ 05.11. | Bedienung: Text-Optionen in der Eigenschaftsleiste, Objekt-Manager (alle Seiten, Pfeiltasten, Rollen), Radierer live, Pipetten-Zeiger | Klicktest Chrome + WebKit |

### Phase 6: Windows (Timon 05.11.: eigenes Repo + CI, Handtest später per VM oder fremdem PC)

| Schritt | Inhalt | Überprüfbares Ziel |
|---|---|---|
| 6a ✓ 05.11. | Privates Repo `konturwerk` + Windows-CI (vitest, svelte-check, cargo test, cargo deny, Tauri-Installer als Artefakt); Mac-Trackpad: Zwei-Finger-Wischen verschiebt, Kneifen zoomt, Mausrad zoomt weiter | CI grün auf windows-latest; Installer-Artefakt; vitest Mausrad/Trackpad |
| 6b ✓ 05.11. | Windows-Befunde aus CI und erstem Start. Erledigt 05.11.: Farbprofil-Tests prüfen je System echt (macOS Generic CMYK, Windows `RSWOP.icm` + sRGB aus `spool\drivers\color`); WebView2-Browsertasten geschluckt, auch in Feldern (F3/F5/F7, Strg+R/F/G/P/S – Neu laden hätte das Dokument verworfen; Tauri 2.12 bietet keinen Schalter, Seitenzoom ist dort schon aus); Browser-Kontextmenü nur noch in Textfeldern (beide Systeme); AltGr-Zeichen (Windows: Strg+Alt) lösen keine Befehle aus. Geprüft ohne Befund: Pfadanzeige (`[\\/]`), Schriften (fontdb kennt Windows-Ordner, Standard Arial, UI Segoe UI), Kürzel-Beschriftung Strg/⌘ | CI grün; Befundliste abgearbeitet; Farbprofil-Tests prüfen auf Windows echt |
| 6c ✓ 05.11. | .cdr-Import unter Windows: libcdr-Hilfsprozess `kw-cdr.exe` bauen oder ehrliche Meldung. Erledigt 05.11.: `kw-cdr.exe` in MSYS2 UCRT64 statisch gebaut (CI-Job `cdr`; nur System-DLLs, ICU = `icu.dll` von Windows über Importbibliothek, ohne Debug-Symbole); Helfer per `bundle.externalBin` im Installer **und im Mac-App-Bundle** – dort fehlte er bisher, .cdr-Import ging im fertigen Programm also nirgends; Helfer liest die Datei in den Speicher, unter Windows über `wmain`/`_wfopen` (librevenge öffnet sonst per `fopen(char*)` in der ANSI-Codepage → Pfade mit z. B. „Ω“ scheitern); Windows-Absturz (NTSTATUS, negativer Exit-Code) ergibt die Absturz-Meldung; Zeitlimit-Test läuft auch unter Windows. Offen: eigene CDR-Dateien (bisher nur X4+-Testdatei aus dem LibreOffice-Korpus) | CDR-Test mit eigener Datei oder Meldung belegt |
| 6d | Handtest nach Checkliste (VM oder fremder PC), Druck 1:1 unter Windows, ggf. tauri-driver-Rauchtest in CI. Nur dort prüfbar (aus 6b): Strg+R/F5 laden wirklich nicht neu; Rechtsklick ohne Browsermenü; AltGr+8 tippt „[“ im Textfeld; Alt allein/F10 öffnet das eigene Menü statt Systemmenü; Präzisions-Touchpad wischt/kneift, Mausrad zoomt; Druckansicht öffnet auch bei Benutzernamen mit Leerzeichen (`cmd /C start`, bricht bei `&`/`^`). Erledigt 05.11.: Prüfliste `docs/windows-handtest.md` (11 Schritte, VM-Weg über UTM + Windows 11 Arm64); Druckansicht fasst den Pfad für cmd selbst in Anführungszeichen (Rust tat das nur bei Leerzeichen → `&`/`^` ohne Leerzeichen brachen ab; Windows-Test mit Gegenprobe); CI-Rauchtest `tests/e2e/windows-smoke.mjs`: Start-Check (App + WebView2 laufen), dann DevTools-Protokoll – fertige App zeigt die Oberfläche (Bildschirmfoto als Artefakt `rauchtest-bild`), F5/Strg+R laden nicht neu, Gegenprobe ohne preventDefault lädt neu → Prüfung scharf (Lauf 42071966218). Den Port öffnet die App selbst bei `KONTURWERK_DEBUG_PORT` über die Fensterkonfiguration (`main.rs`, ohne Variable unverändert); tauri-driver/msedgedriver und `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` brachten ihn nicht an die WebView2 (Kommandozeile ohne Port, Ursache unbelegt). Offen: Handtest durch Timon (VM oder PC), Papierdruck gemessen | Checkliste abgehakt; Druckmaß gemessen |

### Phase 7: Extras außerhalb der Spezifikation (Timon 05.11.: „ja“; abgenommen 05.11.)

| Schritt | Inhalt | Beleg |
|---|---|---|
| 7a ✓ 05.11. | Nachzeichnen: Häkchen „Originalbild löschen“ – `addTrace(doc, node, pi, drop)` löscht das Bild im selben Schritt, ein Rückgängig holt es zurück | `trace.test.ts`, Klicktest |
| 7b ✓ 05.11. | Verlaufswerkzeug: Eigenschaftsleiste zeigt „Knoten n von m“, Knotenfarbe (Farbwähler) und Lage in % (Enden fest); ohne Knotenwahl ein Hinweis. Werkzeug-Schnittstelle `knot.get/set` | `gradient-tool.test.ts`, Klicktest |
| 7c ✓ 05.11. | Palettenfarbe auf die Verlaufslinie ziehen: auf einen Knoten = umfärben, auf die Linie = neuer Knoten mit der Farbe, daneben = Hinweis. Ziehen per Pointer-Events statt HTML5-Drag (Tauri fängt HTML5-Drag unter Windows ab); Farbfleck folgt dem Zeiger | `gradient-tool.test.ts`, Klicktest |
| 7d ✓ 05.11. | Nachzeichnen-Panel: Ergebnisfarben als Liste – mehrere wählen + Zusammenführen, eine Farbe ändern, Zurücksetzen. kw-core färbt auf Label-Ebene vor dem Entflecken um (`recolor` in `trace/colors.rs`), damit Stapeln, Zusammenführen und Ausschneiden stimmen | `trace_color.rs`, `trace.test.ts`, Klicktest |
| Befund | Esc im offenen Farbwähler schloss ihn **und** hob die Auswahl auf (seit Phase 4). Offener Farbwähler zählt jetzt wie ein Dialog (`keyCommand(…, popover)`); WebKit springt mit Tab nicht auf Knöpfe, daher Prüfung „Popover offen“ statt Fokusziel | `shortcuts.test.ts`, Klicktest WebKit |
| Befund echte App | Nach Übernehmen mit „Originalbild löschen“ zeigte das Panel „Erst ein Bild wählen.“, aber noch die alten Ergebnisfarben samt Farbfeld; nach Rückgängig war eine Farbe weiter gewählt. Farbliste nur bei gewähltem Bild, Wahl hängt wie `p.recolor` am Bild (`{#key imageId}`) | Klicktest Chromium + WebKit |

Klicktest Phase 7: Chromium + WebKit, 1366 und 1920 px, Tauri-Brücke nachgebildet, 136 Prüfungen grün. Echte Mac-App 05.11.: Nachzeichnen (Ergebnisfarben wählen, zusammenführen, umfärben, zurücksetzen), Esc im Farbwähler, Originalbild löschen + Rückgängig, Verlaufsknoten-Felder, Palettenfarbe auf Linie (Lage 49,80 % = Ablagepunkt) + Rückgängig von Hand geprüft.

### Phase 8: Nicht-Ziele nachgebaut (Timon 06.11.: „okay fixe alles“ → „mach weiter“ = neue Abnahme, Spec §14)

Grundsatz wie Phase 4: Ablauf nah am Vorbild, Optik und Namen eigen. Jeder Schritt über alle Wege: Modell → `.kwk` → Anzeige → SVG/PNG/PDF (Druck = PDF) → Import SVG/CDR.

| Schritt | Inhalt | Überprüfbares Ziel |
|---|---|---|
| 8a ✓ 06.11. | Transparenz (gleichmäßig) für jedes Objekt, nicht nur Bilder (5a): `opacity` an jedem Knoten; Gruppe wirkt auf jedes Kind (multipliziert); Füllung und Kontur je mit dieser Deckkraft; Andockfenster „Transparenz %“ für jede Auswahl; Import SVG `opacity`/`fill-opacity`/`stroke-opacity`, CDR (libcdr: gleichmäßige Transparenz → `fill-opacity`) | Modell-Tests; Export-Tests SVG/PNG/PDF; Golden; Rückgängig je Eingabe ein Schritt |
| 8b | PowerClip: „In Rahmen einfügen“ (Ziel = zuletzt gewähltes Objekt wie beim Formen) und „Inhalt herausnehmen“; Inhalt liegt im Koordinatensystem des Rahmens (wandert und skaliert mit); Rahmenfüllung unter, Rahmenkontur über dem Inhalt; Klick auf Inhalt wählt den Rahmen; Exporte SVG `clipPath`, PDF Beschneidungspfad, PNG Maske, Plotter schneidet Linien am Rahmen; Import SVG `clip-path` (libcdr kennt kein PowerClip) | Modell-Tests Einfügen/Herausnehmen/Duplizieren/Rückgängig; Export-Tests je Format; Golden; Klicktest |
| 8c | Musterfüllung: Füllart „Muster“ mit eigenen Zweifarb-Vorlagen (Farben, Größe, Winkel) und „Muster aus Auswahl“ (Vektor + Bild); Kachel liegt im Objekt-Koordinatensystem; Exporte SVG `pattern`, PDF Kachelmuster, PNG; Import SVG `pattern` + CDR (Zweifarb- und Bitmapmuster kommen von libcdr als Bildkachel) | Modell-Tests; Export-Tests je Format; Golden; Klicktest |

8a-Importregeln (06.11.): SVG-Gruppen-Deckkraft wird auf die Objekte verteilt (bei Überlappung oder Füllung + Kontur mit Hinweis, weil SVG die Gruppe als Ganzes abdeckt); verschiedene Deckkraft von Füllung und Kontur → zwei Pfade; Verlauf mit gleicher Stopp-Deckkraft → Objekt-Deckkraft, wechselnde → Hinweis; 0 % = Teil fehlt (libcdr schreibt „keine Füllung“ als `fill-opacity: 0` – vorher wurde daraus fälschlich eine deckende Füllung).

## 11. Risiken

| # | Risiko | W. | Folge | Gegenmaßnahme |
|---|---|---|---|---|
| R1 | Mittellinie (eigener Code) liefert keine sauberen Stencil-Linien | hoch | Kern-Feature schwach | Früh mit **deinen** echten Stencil-Vorlagen testen; falls kein Verkauf: GPL-Werkzeug als Hilfsprozess erlaubt |
| R2 | linesweeper ist Alpha → Randfälle falsch | eingetreten (Spike 3d) | Logo-Formen kaputt | i_overlay + Rückführung der Ergebnis-Kanten auf Teilstücke der Original-Segmente (kein Refit) |
| R3 | Zwei Web-Engines (WebKit/Chromium) rendern verschieden; Windows nie von Hand getestet | mittel | Fehler nur auf Windows | Text/Pfade selbst konturieren; Windows-CI (Tests, Installer, App-Rauchtest mit Tastenprüfung); Windows-Rechner/VM klären |
| R4 | Druck nicht 1:1 (Skalierung im Druckdialog) | mittel | Stencil falsche Größe | Spike in 3h, Ersatzweg PDF |
| R5 | Kein freier PDF/X-Prüfer | hoch | Druckerei lehnt ab | Strukturprüfung + Probedruck bei echter Druckerei vor „fertig“ |
| R6 | libcdr: ~~Windows-Build aufwendig~~ (05.11. gelöst: MSYS2, CI-Job `cdr`); CDR ab 2022 nur teilweise lesbar | mittel | Import fehlt teilweise | Hilfsprozess; ehrliche Fehlermeldung. **05.11. mit 31 echten Dateien geprüft** (LibreOffice-Bugtracker, Corel 7 bis 2024; nur lokal, nicht im Repo): bis X6+ Vektoren, Text, Verläufe wie libcdr. Befund: eingebettete Bilder gingen stumm verloren (libcdr liefert BMP) → BMP→PNG im SVG-Import, unbekannte Bildformate gemeldet. libcdr-Grenzen: Bild-Transparenz fehlt immer (Alpha 0); 2022/2024: Pinselstriche fehlen, 1 von 3 Dateien nicht lesbar → Meldung „in CorelDRAW als ältere Version speichern“. **06.11. gepatcht** (`patches/libcdr-0.1.9-konturwerk.patch`, MPL): Bildmaske → Alpha, CDR-2024-Füllblock (alle 3 Dateien lesbar), Vorlagen .cdt/.cdrt; gestrichelte Konturen kommen jetzt mit. Bleibt: echte Transparenz/Deckkraft, PowerClip, Musterfüllung (Spec §14 Nicht-Ziele), Tabellen, Live-Pinsel, Verbinder; CMX nie |
| R7 | Canvas 2D schafft 10 000 Objekte nicht | niedrig–mittel | ruckelt | Gate in 3a, Plan B WebGL |
| R8 | Umfang: Mac + Win + alle Muss | hoch | Monate statt Wochen | MVP nach 3h nutzbar; Rest in P-Reihenfolge |
| R9 | CI-Minuten privat begrenzt (Free 2000 min/Monat, Windows zählt doppelt) | niedrig | Kosten | nur Windows-CI, Mac lokal; Doku-Änderungen lösen keinen Lauf aus; Rust-Cache |

## 12. Offen vor Phase 3

1. **Verkauf ja/nein?** (bestimmt R1-Ausweg und Signierung)
2. ~~Eigenes Git-Repo oder Monorepo?~~ 05.11.: eigenes privates Repo + Windows-CI.
3. ~~Windows-Rechner/VM vorhanden?~~ 05.11.: nein; Handtest später per VM oder fremdem PC (6d).
4. **OK zur Spec-Abweichung SVG-Text-Import** (§1).

## 13. Quellen

- Tauri WebDriver (macOS nicht unterstützt): https://v2.tauri.app/develop/tests/webdriver/
- linesweeper (Alpha, MIT/Apache): https://docs.rs/linesweeper · https://github.com/anthrotype/linesweeper
- vtracer (MIT/Apache): https://lib.rs/crates/vtracer
- libcdr-Changelog (CDR 1–23 ab 0.1.7): https://build.opensuse.org/projects/openSUSE/packages/libcdr/files/libcdr.changes?expand=0
