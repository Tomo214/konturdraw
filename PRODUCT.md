# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Desktop-App (Tauri 2, Webview: WebView2 auf Windows, WKWebView auf macOS). **Windows ist die wichtigste Zielplattform**, macOS läuft mit (Timon 03.11.).

## Users

Timon, privat: Tattoo-Stencils (Foto/Scan → saubere Linien → 1:1 drucken) zuerst, Logos danach. Kommt von CorelDRAW und arbeitet mit dessen Handgriffen.

## Product Purpose

Eigenes Vektorprogramm für genau diese zwei Jobs, ohne CorelDRAW-Lizenz. Erfolg = Stencil aus Foto in wenigen Minuten, Logo bis zur druckfertigen PDF, ohne nach Befehlen suchen zu müssen.

## Positioning

Bedienung wie CorelDRAW (Aufbau, Leisten-Anordnung, Bedienlogik, Befehle, Kürzel), eigene Optik, eigener Name. Mittellinien-Nachzeichnen und 1:1-Druck für Stencils sind Kern, nicht Zusatz.

## Operating Context

- Workflows W1 Stencil aus Foto, W2 Logo bauen, W3 `.cdr` öffnen (docs/spec.md §3).
- Ausgabe: Drucker 1:1 (auch gespiegelt), PDF/X-4 druckfertig, SVG, PNG, DXF/HPGL für Plotter/Laser.
- Lange Sitzungen am Schreibtisch, Maus und Tastatur, Kürzel aus CorelDRAW-Gewohnheit.

## Capabilities and Constraints

- Funktionsumfang und Prioritäten: docs/spec.md; Aufbau und Phasen: docs/architecture.md.
- Kürzel: Vorbild-Belegung laut öffentlicher Corel-Kurzreferenz (spec §13).
- Menüleiste im Fenster (wie Vorbild unter Windows), auf beiden Plattformen gleich.
- Rechtsgrenze: nichts aus CorelDRAW kopieren (Code, Icons, Texte, Presets, Schriften, Namen, Logos); nur öffentliche Hilfe/Doku, Standards, passende Open-Source-Lizenzen; keine GPL.
- Offen: Windows wurde noch nie auf echter Hardware getestet (kein Windows-Rechner bekannt).

## Brand Commitments

- Arbeitstitel „Konturwerk“ (Markencheck vor Veröffentlichung offen).
- Optik muss eigen sein: ähnliche Arbeitsabläufe ja, identische Optik nein.

## Evidence on Hand

- Testvorlagen: tests/fixtures/ (Testseite 100 mm, CDR-Datei aus LibreOffice-Korpus). Eigene Stencil-Vorlagen und eigene `.cdr`-Dateien von Timon fehlen noch.

## Product Principles

1. Ein CorelDRAW-Nutzer findet jeden Befehl dort, wo er ihn erwartet.
2. Die Zeichnung führt, die Oberfläche tritt zurück.
3. Maße stimmen: mm-genau auf Bildschirm, im Export und im Druck.
4. Kein Feature ohne Beleg (Test, Messung, Screenshot).
