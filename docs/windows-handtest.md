# Windows-Handtest (Phase 6d)

Prüft, was nur an einem echten Windows geht. Dauer ca. 30 Minuten. Bei einem Fehler: Schritt-Nummer und Bildschirmfoto an Timon bzw. Claude.

## Vorbereitung

1. **Installer holen:** github.com/Tomo214/konturdraw → Actions → letzter grüner Lauf „windows“ → Artefakt `konturdraw-windows` (ZIP) → `KonturDraw_…_x64-setup.exe`.
2. **Installieren:** Windows warnt, weil der Installer nicht signiert ist („Der Computer wurde durch Windows geschützt“). Dann „Weitere Informationen“ → „Trotzdem ausführen“ wählen.
3. **Ohne Windows-PC: VM auf dem Mac**
   - UTM installieren (kostenlos, mac.getutm.app).
   - Bei Microsoft das ISO „Windows 11 (multi-edition ISO for Arm64)“ laden, in UTM als neue Windows-VM einrichten. Zum Testen reicht es ohne Lizenzschlüssel.
   - KonturDraw ist eine x64-App. Windows auf ARM führt sie per Emulation aus, für den Test reicht das.
   - Schritte 7 (Touchpad) und 8 (Papierdruck) gehen in der VM nicht oder nur teilweise. Die beiden einmal an einem echten Windows-PC prüfen.

## Prüfliste

| ☐ | # | Tun | Erwartung |
|---|---|---|---|
| ☐ | 1 | KonturDraw starten; Windows-Anzeige auf 125 % oder 150 % stellen und neu starten | Fenster mit Menüleiste, Werkzeugkasten, Palette; Schrift und Icons scharf, nichts abgeschnitten |
| ☐ | 2 | Rechteck zeichnen, dann F5, danach Strg+R | Rechteck bleibt, nichts lädt neu |
| ☐ | 3 | F3, F7, Strg+F, Strg+G | Keine Suchleiste, kein Dialog „Caret-Browsing“ |
| ☐ | 4 | Rechtsklick auf Zeichenfläche und auf das Rechteck; danach Rechtsklick in ein Zahlenfeld der Eigenschaftsleiste | Zeichenfläche: eigenes KonturDraw-Menü, nie „Zurück / Neu laden / Untersuchen“. Zahlenfeld: Kopieren/Einfügen-Menü ist in Ordnung |
| ☐ | 5 | Text-Werkzeug (F8), auf die Seite klicken, mit deutscher Tastatur tippen: AltGr+8, AltGr+9, AltGr+Q, AltGr+E | Es erscheint `[ ] @ €`, kein Befehl wird ausgelöst |
| ☐ | 6 | Alt kurz allein drücken, dann Pfeil ↓; danach Esc und F10 | Alt: KonturDraw-Menüleiste wird aktiv. F10: Form-Werkzeug ist gewählt (Belegung wie Vorbild). Nie das Windows-Fenstermenü (Wiederherstellen/Verschieben/Schließen) |
| ☐ | 7 | Mausrad über der Zeichenfläche; am Laptop-Touchpad zwei Finger wischen und kneifen | Mausrad zoomt; Wischen verschiebt; Kneifen zoomt |
| ☐ | 8 | Rechteck auf B = 100 mm, H = 100 mm setzen; Datei → Drucken; in der PDF-Anzeige „Tatsächliche Größe“ bzw. 100 % wählen und drucken | Gedrucktes Quadrat misst 100 mm ± 0,5 mm. In der VM: auf „Microsoft Print to PDF“ drucken, die PDF-Datei an Claude, er misst |
| ☐ | 9 | Datei → Importieren: eine eigene CorelDRAW-Datei (.cdr), auch aus einem Ordner mit Umlaut im Namen | Zeichnung erscheint; sonst eine verständliche Meldung, kein Absturz |
| ☐ | 10 | Speichern als .kwk in einen Ordner wie `Entwürfe Ä`, schließen, wieder öffnen; Export als PDF, SVG und PNG | Datei öffnet unverändert; Exporte öffnen in anderen Programmen |
| ☐ | 11 | Foto importieren → Nachzeichnen (Andockfenster) → Anwenden | Vektor-Ergebnis erscheint, App bleibt bedienbar |

## Schon automatisch belegt (CI, jeder Push)

- Die fertige App startet unter Windows, die Oberfläche steht (Rauchtest, Bildschirmfoto als Artefakt `rauchtest-bild`).
- F5 und Strg+R laden nicht neu. Eine Gegenprobe zeigt, dass F5 ohne den Schutz neu laden würde, die Prüfung greift also.
- Die Druckansicht öffnet auch bei Pfaden mit `&` oder `^`, etwa bei einem Benutzernamen „Max&Moritz“.
- Der .cdr-Import funktioniert mit einer Testdatei, auch bei einem Pfad mit „Ω“.
- Der Installer enthält den CDR-Helfer.
