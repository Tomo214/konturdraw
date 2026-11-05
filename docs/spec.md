# Konturwerk – Funktions-Spezifikation (Phase 1)

Stand: 2026-11-02 · Status: **Entwurf, wartet auf Abnahme** · Name = Arbeitstitel

## 0. Zweck

Eigenes Vektorgrafik-Programm für zwei Use Cases, in dieser Reihenfolge (Annahme, siehe §15):

1. **Tattoo-Stencils** – Motiv/Foto → saubere Linien → 1:1 auf Thermo-/Stencil-Drucker.
2. **Logos** – Formen, Boolesche Operationen, Text → druckfertige und Plotter-Dateien.

Plattformen: **macOS + Windows** (Desktop).

Nicht Ziel: CorelDRAW-Vollumfang. Alles, was keinem der zwei Use Cases dient, steht in §14.

## 1. Rechtliche Leitplanken (Kurzfassung)

- Grundlage nur: öffentliche Hilfe-Seiten (Quellen §16), Standards (SVG, PDF, ICC), eigene Analyse der Use Cases.
- Kein Code, keine Icons, Texte, Presets, Fonts, Namen oder Logos von Corel.
- Eigene Begriffe: „Panel“ (nicht „Docker“), „Nachzeichnen“ (nicht der Produktname des Corel-Tracers), eigene Werkzeugnamen.
- Eigene Tastenbelegung (§13), angelehnt an allgemein übliche Konventionen, nicht an Corels Belegung.
- Keine Pantone-Farbdaten mitliefern (lizenzpflichtig) → nur eigene Paletten (§9).
- `.cdr` nur lesend über libcdr (MPL-2.0); Lizenzprüfung in Phase 2.

## 2. Prioritäten

| Stufe | Bedeutung |
|---|---|
| **P0** | MVP: ohne geht Use Case 1 nicht durchgängig. |
| **P1** | v1.0: deine Muss-Features + Logo-Workflow komplett. |
| **P2** | Nice-to-have, erst nach v1.0. |

Deine Muss-Antworten → alle P0 oder P1: Bild → Vektor (P0), CMYK + ICC (P1), Text-auf-Pfad (P1), `.cdr`-Import (P1), Export PDF/SVG/PNG/Plotter (P0/P1).

## 3. Kern-Workflows (Abnahme-Szenarien)

**W1 – Stencil aus Foto (P0)**
1. Foto/Scan (PNG/JPG) importieren.
2. Bild auf eigener Ebene: Deckkraft runter, Ebene sperren, Ebene „nicht drucken“.
3. Entweder automatisch nachzeichnen (Mittellinie) oder von Hand mit Stift/Freihand nachziehen.
4. Bereinigen: Knoten löschen/glätten, Radierer, Linien verbinden.
5. Einheitliche Linienstärke für Auswahl setzen (z. B. 0,5 mm).
6. Motiv auf Zielgröße in mm bringen (Körperstelle).
7. Drucken 1:1 (optional gespiegelt) oder als PDF/PNG exportieren.

**W2 – Logo bauen (P1)**
1. Grundformen + Stift zeichnen.
2. Vereinen / Subtrahieren / Schnittmenge.
3. Text setzen, ggf. auf Pfad, dann in Kurven umwandeln.
4. Farben aus eigener Palette, Dokument in CMYK mit ICC-Profil.
5. Export: PDF druckfertig, SVG, PNG, DXF/HPGL.

**W3 – Altbestand öffnen (P1)**: `.cdr` öffnen → bearbeiten → im eigenen Format speichern.

## 4. Dokumentmodell

| Funktion | Prio |
|---|---|
| Dokument mit Seitengröße in mm/in/pt/px, Hoch/Quer | P0 |
| Mehrere Seiten anlegen, löschen, umsortieren | P1 |
| Ebenen: anlegen, umbenennen, Reihenfolge, sichtbar, gesperrt, druckbar | P0 |
| Objekte: Pfad, Rechteck, Ellipse, Polygon/Stern, Text, Bild | P0 (Text P1) |
| Gruppen, verschachtelt; Gruppe betreten und darin bearbeiten | P0 |
| Stapelreihenfolge: vor, zurück, ganz nach vorn/hinten | P0 |
| Undo/Redo, mind. 200 Schritte, auch über Werkzeugwechsel | P0 |
| Eigenes Dateiformat, speichert alles verlustfrei inkl. eingebetteter Bilder | P0 |
| Kopieren/Einfügen innerhalb der App, Duplizieren | P0 |
| Kopieren/Einfügen mit anderen Apps (SVG/PNG über Zwischenablage) | P2 |

## 5. Werkzeuge

| Werkzeug | Funktion | Prio |
|---|---|---|
| Auswahl | Klicken, Rahmen ziehen, Shift = hinzufügen; Griffe: verschieben, skalieren, drehen, scheren | P0 |
| Knoten | Knoten wählen/verschieben/hinzufügen/löschen; Typ Ecke/glatt/symmetrisch; Segment Gerade ↔ Kurve; Pfad öffnen/schließen; zwei Endknoten verbinden; Pfad an Knoten trennen | P0 |
| Stift (Bézier) | Klick = Eckpunkt, Ziehen = Kurvenpunkt, Klick auf Start = schließen, Enter/Esc = beenden | P0 |
| Freihand | Zeichnen mit einstellbarer Glättung (wichtig für Tattoo-Linien) | P0 |
| Rechteck | Mit Eckenradius, Shift = Quadrat, Alt = aus Mitte | P0 |
| Ellipse | Shift = Kreis, Alt = aus Mitte | P0 |
| Polygon/Stern | Eckenzahl, Stern-Spitzentiefe | P1 |
| Text | Grafiktext per Klick, Fließtext per Rahmen, Klick auf Pfad = Text auf Pfad | P1 |
| Messer | Objekt entlang gezogener Linie in zwei Objekte teilen | P1 |
| Radierer | Teile von Pfaden wegradieren (Stencil-Bereinigung) | P1 |
| Pipette | Füllung/Kontur von einem Objekt auf andere übertragen | P1 |
| Verlauf | Verlauf direkt auf dem Objekt anlegen und Anfasser ziehen | P1 |
| Hand | Ansicht verschieben; Leertaste halten = temporär | P0 |
| Zoom | Klick = rein, Alt-Klick = raus, Rahmen = auf Bereich | P0 |

## 6. Füllungen, Konturen, Transformationen

| Funktion | Prio |
|---|---|
| Füllung: keine / Vollton | P0 |
| Füllung: linearer + radialer Verlauf, mehrere Farbstopps | P1 |
| Kontur: Breite (mm/pt), Farbe, keine | P0 |
| Kontur: Linienenden (stumpf/rund/eckig), Ecken (spitz/rund/abgeschrägt) | P0 |
| Kontur skaliert mit Objekt: an/aus | P1 |
| Kontur gestrichelt | P2 |
| Kontur in Objekt umwandeln (Linie → Fläche, für Plotter/Logo) | P1 |
| Linienstärke für Mehrfachauswahl auf einmal setzen | P0 |
| Transformieren numerisch: Position, Größe (mm), Winkel, Schere | P0 |
| Spiegeln horizontal/vertikal | P0 |
| Proportional sperren | P0 |
| Ausrichten (links/mitte/rechts, oben/mitte/unten) + Verteilen | P1 |

## 7. Pfad- und Formen-Befehle

Leitlinie (Timon 03.11.): Aufbau, Leisten-Anordnung, Bedienlogik, Befehlsumfang und Kürzel so nah wie möglich am Vorbild; Icons, Farben, Texte und Name bleiben eigen. **Ziel** = zuletzt angeklicktes Objekt, bei Rahmenauswahl das unterste.

| Befehl | Funktion (Semantik wie Vorbild-Hilfe) | Prio |
|---|---|---|
| Verschmelzen | Alle → eine Umrissform; Stil + Ebenenplatz des Ziels; Originale weg | P1 |
| Zuschneiden | Ziel minus alle anderen; andere bleiben, Ziel behält Stil | P1 |
| Schnittmenge | Gemeinsame Fläche aller als neues Objekt (Stil des Ziels); Originale bleiben | P1 |
| Vereinfachen | Jedes Objekt minus alle darüber; leere fallen weg | P1 |
| Vorne minus hinten | Oberstes minus Rest; Rest weg | P1 |
| Hinten minus vorne | Unterstes minus Rest; Rest weg | P1 |
| Umrandung | Umriss der Vereinigung als neues Objekt ohne Füllung, oben; Originale bleiben | P1 |
| Kombinieren | Mehrere Pfade → ein Pfad mit Löchern (gerade/ungerade Regel), Stil des Ziels | P0 |
| Aufbrechen | Kombinierten Pfad in Einzelpfade zerlegen | P0 |
| In Kurven umwandeln | Rechteck/Ellipse/Text → bearbeitbarer Pfad | P0 (Text: P1) |
| Pfad vereinfachen | Knotenzahl reduzieren mit Toleranz (nach Nachzeichnen wichtig) | P0 |
| Original behalten | Option bei Verschmelzen/Zuschneiden/Schnittmenge | P2 |

Boolesche Befehle müssen mit offenen Pfaden definiert umgehen (offene Pfade werden für die Operation geschlossen behandelt, Hinweis in UI). Gruppen und Bilder: Befehl lehnt mit Hinweis ab (erst Gruppierung aufheben). Kurven bleiben Kurven: Ergebnis-Kanten werden auf Teilstücke der Original-Segmente zurückgeführt.

## 8. Bild → Vektor (Nachzeichnen)

Eigenes Panel mit Vorher/Nachher-Vorschau. Ergebnis landet gruppiert auf neuer Ebene, Original bleibt.

| Modus | Zweck | Prio |
|---|---|---|
| **Mittellinie** | Linienzeichnung → offene Pfade ohne Füllung, mit Kontur. Kern für Stencils. | P0 |
| **Umriss, schwarz-weiß** | Bild → gefüllte Flächen nach Schwellwert (Logos, Line Art) | P0 |
| **Umriss, farbig** | Bild → Flächen mit N Farben (Logos mit wenigen Farben) | P1 |

Regler:

| Regler | Wirkung | Prio |
|---|---|---|
| Schwellwert | Hell/dunkel-Grenze | P0 |
| Detail / Rauschfilter | Kleine Flecken unter X px ignorieren | P0 |
| Glättung | Wie stark Kurven geglättet werden | P0 |
| Ecken | Wie scharf Ecken erhalten bleiben | P1 |
| Linienstärke (Mittellinie) | Konturbreite der erzeugten Pfade | P0 |
| Hintergrund entfernen | Fläche der Hintergrundfarbe weglassen | P1 |
| Farbanzahl (farbig) | Anzahl Farben im Ergebnis | P1 |
| Benachbarte gleiche Farben zusammenführen | Weniger Objekte | P1 |

Abnahme-Ziel: Testbild (eigene Strichzeichnung, 2000×2000 px) → Mittellinie in < 3 s, Pfade folgen der Linienmitte ±2 px.

## 9. Farbe

| Funktion | Prio |
|---|---|
| Farbwähler: RGB, Hex | P0 |
| Farbwähler: CMYK, Graustufen | P1 |
| Dokument-Farbmodus RGB oder CMYK | P1 |
| ICC: Dokumentprofil wählen (aus System oder Datei laden) | P1 |
| ICC: Rendering-Intent (perzeptiv, relativ farbmetrisch, …) | P1 |
| Soft-Proof: CMYK-Vorschau am Bildschirm | P1 |
| Warnung „Farbe außerhalb Druckbereich“ | P2 |
| Standardpalette (eigene Farben, eigene Benennung) | P0 |
| Eigene Paletten anlegen, Farben benennen, als Datei speichern/laden | P1 |
| Volltonfarben (Spot) mit Namen, im PDF als Sonderfarbe ausgegeben | P1 |
| Import fremder Palettendateien (.ase/.gpl) | P2 |

Keine ICC-Profile mitliefern, deren Lizenz nicht geklärt ist; Systemprofile nutzen.

## 10. Text (P1, Muss)

| Funktion | Prio |
|---|---|
| Grafiktext: frei platziert, mehrzeilig | P1 |
| Fließtext in Rahmen mit Umbruch | P1 |
| Text auf Pfad: Abstand zum Pfad, Startversatz, Seite (oben/unten) | P1 |
| Text nach dem Einpassen weiter editierbar | P1 |
| Schrift (Systemschriften), Größe, Schnitt, Laufweite, Zeilenabstand, Ausrichtung | P1 |
| In Kurven umwandeln (auch Text auf Pfad) | P1 |
| Schriften im PDF einbetten (Teilmenge) | P1 |
| OpenType-Sonderfunktionen (Ligaturen-Steuerung, Varianten) | P2 |

## 11. Import / Export

| Format | Import | Export | Prio | Hinweis |
|---|---|---|---|---|
| Eigenes Format | ✓ | ✓ | P0 | verlustfrei |
| PNG / JPG | ✓ | – | P0 | Vorlage fürs Nachzeichnen |
| SVG | ✓ | ✓ | P0 | Import: Pfade, Formen, Gruppen, Füllung/Kontur, Text |
| PNG | – | ✓ | P0 | DPI wählbar, transparenter Hintergrund |
| PDF (RGB, einfach) | – | ✓ | P0 | Vektoren bleiben Vektoren |
| PDF druckfertig | – | ✓ | P1 | CMYK, Beschnittzugabe, Schnittmarken, Output-Intent (PDF/X-Variante in Phase 2 festlegen) |
| DXF | – | ✓ | P1 | Kurven als Polylinien oder Splines (Zielgerät klären, §15) |
| HPGL / PLT | – | ✓ | P1 | Nur Konturen, Einheit + Ursprung einstellbar |
| CDR | ✓ | – | P1 | nur lesend via libcdr; Versionen laut libcdr-Support |
| PDF-Import | ✓ | – | P2 | |

Allgemein: Export „nur Auswahl“ oder „ganze Seite“ (P0); nicht druckbare Ebenen werden nicht exportiert (P0).

## 12. Ansicht, Hilfen, Drucken

| Funktion | Prio |
|---|---|
| Zoom stufenlos 1 %–64 000 %, Zoom auf Auswahl/Seite, Mausrad/Trackpad-Pinch | P0 |
| Lineale in Dokumenteinheit | P0 |
| Raster (Abstand einstellbar), ein/aus | P1 |
| Hilfslinien aus Lineal ziehen, sperren, löschen | P1 |
| Fangen: Raster, Hilfslinien, Knoten, Objektkanten/-mitten | P1 |
| Drahtmodell-Ansicht (nur Pfade, ohne Füllung/Kontur) | P1 |
| Eigenschaften-Leiste kontextabhängig (zeigt Optionen des aktiven Werkzeugs/Objekts) | P0 |
| Objekt-Manager: Ebenen/Gruppen/Objekte als Baum, Drag zum Umsortieren | P0 |
| Drucken 1:1 (Originalgröße, mm-genau) über System-Druckdialog | P0 |
| Drucken gespiegelt | P1 |
| Druckvorschau | P1 |

## 13. Tastenkürzel (Belegung wie Vorbild, Timon 03.11.)

`Mod` = Cmd (macOS) / Strg (Windows). Quelle: CorelDRAW Graphics Suite 2019 Quick Reference Card (öffentlich, product.corel.com); wo die Karte nichts nennt, gilt die frühere eigene Belegung.

| Funktion | Kürzel |
|---|---|
| Knoten / Freihand / Rechteck / Ellipse / Vieleck / Text | F10 / F5 / F6 / F7 / Y / F8 |
| Radierer / Interaktive Füllung (Verlauf) / Hand / Zoom | X / G / H / Z |
| Stift, Messer, Pipette | ohne Taste (wie Vorbild) |
| Auswahl | Leertaste schaltet zwischen Auswahl und letztem Werkzeug (Mod+Leertaste auch beim Texteingeben) |
| Rückgängig / Wiederholen | Mod+Z / Mod+Shift+Z |
| Gruppieren / Gruppierung aufheben | Mod+G / Mod+U |
| Kombinieren / Aufbrechen | Mod+L / Mod+K |
| In Kurven umwandeln | Mod+Q (Mod+Shift+O bleibt als Zweitbelegung, weil Cmd+Q auf dem Mac beendet) |
| Kontur in Objekt umwandeln | Mod+Shift+Q |
| Nach vorn / zurück (eine Stufe) | Mod+Bild↑ / Mod+Bild↓ (Mod+] / Mod+[ bleiben für Tastaturen ohne Bild-Tasten) |
| Ganz nach vorn / hinten (Ebene) | Shift+Bild↑ / Shift+Bild↓ (Mod+Shift+] / [ bleiben) |
| Ausrichten links/rechts/oben/unten/Mitte waagrecht/Mitte senkrecht/Seitenmitte | L / R / T / B / C / E / P (bei Auswahl) |
| Ausrichten und Verteilen / Objekteigenschaften / Text-Eigenschaften / Optionen | Mod+Shift+A / Alt+Enter / Mod+T / Mod+J |
| Fangen Raster / Objekte / Fangen aus | Alt+Y / Alt+Z / Alt+Q |
| Verschieben fein / normal / grob, Ansicht rollen | Mod+Pfeil / Pfeil / Shift+Pfeil, Alt+Pfeil |
| Verschmelzen / Zuschneiden / Schnittmenge | Mod+Alt+U / Mod+Alt+T / Mod+Alt+I (Vorbild ohne Standardkürzel) |
| Duplizieren | Mod+D |
| Nachzeichnen-Panel | Mod+Shift+B |
| Zoom Seite / 100 % / Auswahl | Mod+0 / Mod+1 / Mod+2 |
| Zoom rein / raus | Mod+= / Mod+- |
| Raster / Hilfslinien zeigen | Mod+' / Mod+; (Vorbild ohne Standardkürzel) |
| Drahtmodell-Ansicht | Mod+Y |
| Neu / Öffnen / Speichern / Speichern unter | Mod+N / Mod+O / Mod+S / Mod+Shift+S |
| Importieren / Exportieren / Drucken | Mod+I / Mod+E / Mod+P |
| Verschiebe-Schritte | 0,1 mm / 1 mm / 0,01 mm (Pfeil / Shift / Mod), in 4b einstellbar |
| Löschen / Abbrechen | Entf bzw. Backspace / Esc |

Alle Kürzel umbelegbar: P2.

## 14. Nicht-Ziele (bewusst weggelassen)

Effekte (Überblendung, Extrusion, Hülle, Verzerrung, Schatten, Transparenz-Effekte, Netzfüllung) · Tabellen · Maßlinien · Verbinder · Seriendruck · Bitmap-Bearbeitung/Filter · Muster-/Texturfüllungen · Makros/Plugins · Cloud/Zusammenarbeit · Vorlagen-Bibliothek · Symbol-Bibliothek · Maske/„in Form einfügen“.

Kommt eines davon später als Wunsch → neue Abnahme, nicht still nachrüsten.

## 15. Annahmen und offene Entscheidungen (bitte bestätigen oder korrigieren)

| # | Punkt | Annahme bis Antwort |
|---|---|---|
| 1 | Reihenfolge Use Cases | Stencils vor Logos |
| 2 | Verkauf geplant? | Offen. Entscheidet Lizenzen: GPL-Bibliotheken (z. B. für Nachzeichnen) nur ohne Verkauf. Bis zur Antwort: nur MIT/BSD/MPL/Apache einplanen. |
| 3 | Windows-Tests | Kein Windows-Rechner bekannt → CI-Build + Tests auf Windows-Runner; manuelle Prüfung durch dich? |
| 4 | Performance | 10 000 Objekte: Pan/Zoom 60 fps, Klick-Auswahl < 50 ms, Datei öffnen < 2 s (Mac M5; Windows-Referenzgerät offen) |
| 5 | Stencil-Drucker | Modell unbekannt → Druck über Systemdialog, kein Treiber-Spezialcode |
| 6 | Plotter/Laser | Gerät unbekannt → DXF + HPGL generisch; Zielgerät nennen, dann testen |
| 7 | Phasenplan | Nachzeichnen + Drucken fehlen im Original-Phasenplan → Vorschlag: neuer Schritt 3h nach 3g; Stencil-first spräche für 3h direkt nach 3c |
| 8 | Name | „Konturwerk“ ist Arbeitstitel; Markencheck vor Veröffentlichung |
| 9 | `.cdr`-Versionen | Nur was libcdr kann; neue CorelDRAW-Versionen evtl. nicht → in Phase 2 mit Testdateien prüfen (eigene `.cdr`-Dateien von dir nötig) |

## 16. Quellen (öffentliche Hilfe, nur Funktionsumfang übernommen)

- Nachzeichnen von Bitmaps: https://product.corel.com/help/CorelDRAW/Documentation-Windows/CorelDRAW-en/CorelDRAW-Trace-bitmaps.html
- Formen kombinieren: https://product.corel.com/help/CorelDRAW/540227992/Main/EN/Documentation/CorelDRAW-Shaping-objects.html
- Zuschneiden: https://product.corel.com/help/CorelDRAW/Documentation-Mac/CorelDRAW-en/CorelDRAW-Trim-objects.html
- Text auf Pfad: https://product.corel.com/help/CorelDRAW/540111147/CorelDRAW-en/CorelDRAW-Fit-text-to-a-path.html
- Werkzeugkasten: https://product.corel.com/help/CorelDRAW/540111147/CorelDRAW-en/CorelDRAW-Toolbox.html
- Farbmanagement: https://product.corel.com/help/CorelDRAW/540111147/CorelDRAW-en/CorelDRAW-Get-started-with-color-management.html
- Farbgenau drucken: https://product.corel.com/help/CorelDRAW/540111147/CorelDRAW-en/CorelDRAW-Print-colors-accurately.html
- Standards: SVG 1.1/2 (W3C), PDF 1.7 / ISO 32000, ICC.1 (color.org), HP-GL/2, DXF-Referenz (Autodesk)

## 17. Abnahme Phase 1

- [ ] Use Cases + Reihenfolge stimmen (§0, §15.1)
- [ ] P0/P1/P2-Zuordnung passt
- [ ] Nicht-Ziele (§14) ok
- [ ] Offene Punkte §15 beantwortet
