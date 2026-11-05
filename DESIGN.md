# Konturwerk – Design

Werkzeug-Oberfläche (Operate-Modus). Aufbau, Abläufe und Kürzel folgen dem Vorbild-Arbeitsablauf; Optik, Icons, Farben, Texte und Name sind eigen.
Ziel-Plattformen: Windows (WebView2) zuerst, macOS (WKWebView) gleichwertig.

## Grundsätze

- Die weiße Seite ist das hellste Element im Fenster; die Oberfläche tritt zurück (Graphit).
- Ein Akzent (Orange) nur für: aktives Werkzeug, Auswahl, Fokus, Hauptknopf in Dialogen, „keine Farbe“-Strich.
- Systemschrift, 12 px, Ziffern tabellarisch (Maße stehen ruhig untereinander).
- Rückmeldung beim Drücken (0 ms), Menüs und Ausklapper wachsen aus ihrem Auslöser (120 ms, kein Federn), reduzierte Bewegung wird beachtet.
- Eigene Strich-Icons (20 × 20, 1,5 px, runde Enden), keine Unicode-Symbole, kein Glas, keine Verläufe in Text.

## Tokens (`src/ui/theme.css`)

| Token | Wert | Zweck |
|---|---|---|
| `--pasteboard` | #2b2b30 | Fläche um die Seite |
| `--bar` | #202024 | Leisten, Menüs, Popover |
| `--panel` | #25252a | Andockfenster-Inhalt, schwebende Felder |
| `--control` / `--hover` / `--pressed` | #2f2f35 / #38383f / #42424a | Bedienelemente in drei Zuständen |
| `--line` / `--line-strong` | #3a3a42 / #50505a | Trennlinien / Rahmen schwebender Felder |
| `--text` / `--text-strong` / `--text-dim` | #c8c8cc / #ededf0 / #8e8e96 | Normal / Überschriften / Hinweise |
| `--accent` / `--accent-hover` / `--accent-ink` | #ff6a3d / #ff7d55 / #1a1a1d | Akzent, Hover des Hauptknopfs, Schrift auf Akzent |
| `--accent-soft` | Akzent 16 % | Textauswahl |
| `--radius` | 4 px | Bedienelemente; schwebende Felder 6 px |
| `--fast` / `--ease-out` | 120 ms / cubic-bezier(0.2, 0, 0, 1) | alle Übergänge |

Kontrast (gemessen): `--text` auf `--bar` 9,7 : 1 · `--text-dim` auf `--bar` 5,0 : 1 · `--accent-ink` auf `--accent` 6,1 : 1.
`ACCENT` in `overlay.ts` = `--accent` (Auswahlrahmen, Griffe, Zoom-Rahmen auf der Zeichenfläche).

## Fensteraufbau (`App.svelte`, CSS-Grid)

```
Menüleiste            28 px   MenuBar
Standardleiste        36 px   StandardBar (Datei, Drucken, Zwischenablage, Rückgängig, Import/Export, Zoom)
Eigenschaftsleiste    50 px   PropertyBar (ohne Auswahl Seite, mit Auswahl Maße + Formen-Befehle, sonst Werkzeug-Optionen)
Werkzeugkasten | Lineale 20 px + Zeichenfläche (Canvas) | Andockfenster | Palette
Seitenleiste          28 px   PageTabs (unter der Zeichenfläche)
Statusleiste          26 px   StatusBar (Position mm · Objektinfo · Hinweis · Füllung · Kontur)
```

## Bausteine

- **Menü** (`MenuBar`, Inhalt `menus.ts`): öffnet beim Drücken, Wechsel per Überfahren, Haken-Spalte für Schalter, Kürzel rechts (auf dem Mac als Symbole). Esc schließt, ohne die Auswahl aufzuheben.
- **Werkzeugkasten** (`Toolbox`): 32-px-Knöpfe, Gruppen mit Ausklapper (Eckdreieck oder Rechtsklick), vorne liegt das zuletzt gewählte Werkzeug der Gruppe. Kurzinfo mit Kürzel rechts, 450 ms Verzögerung.
- **Andockfenster** (`DockPanel`): 272 px Inhalt + senkrechte Reiter am rechten Rand, aktiver Reiter mit Akzentkante; Klick auf den aktiven Reiter klappt zu. Alle Bereiche bleiben geladen. Erster Reiter „Objekte“.
- **Objekt-Manager** (`ObjectManager`, Reiter „Objekte“): Kopfzeile 32 px mit Pfad „Seite › aktive Ebene“ (Ebene im Akzent) + Neue Ebene / Ebene löschen. Zeilen 24 px, Einzug 14 px je Tiefe, vorderstes Objekt oben; Ebenenzeile hell, aktive Ebene 600 im Akzent, rechts Schalter Auge / Drucker / Schloss (aus = gedimmt). Gewählt = `--accent-soft`, verborgene Ebene gedimmt. Ziehen: Akzentlinie 2 px zwischen Zeilen oder Akzentrahmen „hinein“ (Drittel-Regel bei Ebenen/Gruppen), auch über Seiten hinweg; nahe am Listenrand (24 px) rollt die Liste mit, je näher desto schneller. Je Seite eine Seitenzeile über ihren Ebenen, Klick wechselt die Seite. Tastatur im Baum: ↑/↓/Pos1/Ende bewegt die Markierung und wählt, → klappt auf bzw. springt zum ersten Kind, ← klappt zu bzw. springt zur Elternzeile; die Pfeile verschieben dabei nichts auf der Fläche. Nur sichtbare Zeilen werden gebaut.
- **Seitenleiste** (`PageTabs`): links Blättern (+ davor, erste, vorige, „n von m“, nächste, letzte, + danach), rechts Reiter je Seite. Reiter hängen unten an der Arbeitsfläche: aktiver in `--pasteboard` mit Akzentkante oben, Rundung unten. Ziehen zeigt die Lücke als 2-px-Akzentstrich; Doppelklick benennt im Feld um.
- **Kontextmenü** (`ContextMenu`): Optik wie die Menüleiste (Haken-Spalte, Trennlinien), wächst aus dem Zeiger, bleibt im Fenster; Esc, Klick daneben oder Fensterwechsel schließt.
- **Formular** (Klasse `.form`): Beschriftung 84 px links, Feld rechts; `label.row` hält beides zusammen, `.wide` / `h3` / `hr` gehen über beide Spalten; `.unit` für Feld + Einheit, `.check` für Schalter, `.hint` für Hinweise.
- **Eigenschaftsleiste** (`PropertyBar`): Werkzeugname links mit Trennkante; `PageFields` (Format, B/H, Hoch/Quer, Einheit, Verschiebe-Schritt), `ObjectFields` (X/Y Mitte, B/H, Skalierung %, Schloss, Winkel, Neigen waagerecht/senkrecht mit eigenen Parallelogramm-Icons – relativ, Feld zeigt immer 0 –, Spiegeln), `ShapeFields` (Ecken, Seiten, Stern), `CutFields` (Messer Gerade/Freihand, Radierer Dicke + Rund/Eckig, Pipette Füllung/Kontur), `TextBar` (Text-Werkzeug oder gewählter Text: Schrift 170 px, Größe in pt, Fett / Kursiv, Links / Zentriert / Rechts mit eigenen Icons; Klick nimmt dem Text nicht den Fokus). Werkzeug-Regler (`slider` in `tool.ts`): Knoten-Werkzeug „Glätte“ live + Knopf „Knoten reduzieren“, Ergebnis als Hinweis „Knoten: a → b“; Ziehen = ein Rückgängig-Schritt. Paare stehen übereinander (Felder 20 px), Gruppen mit `.sep`. Kein `overflow`, damit Kurzinfos nach unten über die Zeichenfläche ragen. Gedrückte Schalter: Akzent-Text auf `--accent-soft`.
- **Transparenz** (Andockfenster Eigenschaften, nur Bilder): Regler + Zahlenfeld in %, 0 % = deckend (Sprache des Vorbilds); Ziehen = ein Rückgängig-Schritt.
- **Maßfeld** (`NumField`): 64 px, rechtsbündig, Einheit dahinter; Enter übernimmt (ein Rückgängig-Schritt), Esc verwirft, Fokus markiert alles. Eingaben mit Komma oder Punkt, fremde Einheit als Suffix („2 cm“).
- **Icons** (`icons.ts`): 20 × 20, Strich 1,5. Ein Paar `[Ergebnis, Vorlage]` zeichnet die Vorlage mit 45 % Deckkraft (Formen-Befehle: Ausgangsformen blass, Ergebnis kräftig).
- **Ausrichten und Verteilen** (`AlignPanel`, Reiter „Ausrichten“, Mod+Shift+A): 6 Ausricht-Icons (3 + Lücke + 3), Bezug Letztes Objekt / Seitenrand / Seitenmitte, „Auf Seite zentrieren“; 8 Verteil-Icons in 4 Spalten, Bereich Auswahlrahmen / Seite. Gesperrt, solange zu wenig gewählt ist.
- **Nachzeichnen** (`TracePanel`, Reiter „Nachzeichnen“, Mod+Shift+B übernimmt auch bei geschlossenem Panel): Art Mittellinie / Umriss schwarz-weiß / Umriss farbig; Ansichtsschalter Vorher/Nachher · Ergebnis · Drahtmodell (gedrückt = Akzent auf `--accent-soft`), Vorschau in allen Ansichten 224 px hoch, Ergebnis auf Schachbrett (= durchsichtig), Drahtmodell = Bild 35 % + Kurven im Akzent 1 px; veraltete Vorschau 50 % blass. Ergebniszeile „Kurven · Knoten · Farben · Zeit“ in Tabellenziffern. Regler je Art; farbig: Farben 2–256 + vier Schalter, „Farbe im ganzen Bild“ eingerückt und nur mit „Hintergrund entfernen“.
- **Farbwähler** (`ColorPicker`): Farbfeld 32 × 22, Popover in der obersten Ebene (wird nicht von rollenden Feldern abgeschnitten), Kanäle paarweise, Klick daneben oder Esc schließt.
- **Palette** (`PaletteBar`): 20 × 16 Felder, erstes Feld = keine Farbe (weiß mit Akzent-Diagonale, wie in der Statusleiste); Linksklick Füllung, Rechtsklick Kontur.
- **Dialoge** (`FileDialogs`, `DocOptions`): natives `<dialog>`, Hauptknopf im Akzent rechts; gemeinsame Regeln global in `theme.css` (Abschnitt Dialoge).
- **Lineale** (`decor.ts`, in `Canvas`): oben + links 20 px auf `--bar`, Seitenbereich auf `--control`, Zahlen 10 px in Dokumenteinheit ab Nullpunkt (y nach oben), linke Zahlen gedreht; Zeigerlage als Akzentstrich. Ecke 20 × 20 mit Icon `origin`: Ziehen setzt den Nullpunkt (Fadenkreuz), Doppelklick setzt ihn zurück. Doppelklick aufs Lineal öffnet Dokumentoptionen.
- **Hilfslinien**: eigenes Blau `#3aa6e8`, gewählt im Akzent, gesperrt gestrichelt 5/3; über die ganze Fläche, über den Objekten. `GuideFields` in der Eigenschaftsleiste: Lage + Sperren.
- **Raster**: Linien `rgb(120 120 135 / 0.32)` ab Nullpunkt über die ganze Fläche, hinter den Objekten; zu dicht → nur jede 2./5./10. Linie (≥ 8 px).
- **Fangmarke** (`decor.ts` `drawSnap`): Form je Ziel – Knoten Quadrat, Kantenmitte Dreieck, Kante Raute, Mittelpunkt Kreis mit Kreuz, Hilfslinie/Raster Plus; 2 px Akzent auf 4 px weißem Halo. Daneben Etikett (Knoten, Mitte, Kante …) 11 px weiß auf `rgb(26 26 29 / 0.92)`, Radius 4. Fangradius 10 Bildschirm-px.
- **Verlaufslinie** (`overlay.ts` `drawGradientLine`): Linie 1 px Akzent; Anfang Quadrat, Ende Kreis, Zwischenknoten kleinere Quadrate oben drauf – alle in ihrer Knotenfarbe mit 1 px Weiß auf 3 px Dunkel (auf jeder Verlaufsfarbe sichtbar); gewählter Knoten 4 px größer mit Akzent-Ring statt Dunkel.
- **Drahtmodell** (Shift+F9): nur 1-px-Umrisse, Weiß per `difference` → schwarz auf der Seite, hell auf der Arbeitsfläche; Bilder als Umriss.
- **Menü Ansicht**: Drahtmodell oben; nach Hilfslinien „Fangen aus“ (Alt+Q) und Untermenü „Fangen an“ (Objekte Alt+Z, Dokumentraster Alt+Y, Hilfslinien).
- **Menüleiste** (`MenuBar`, Tastatur `menu-nav.ts`): Merkbuchstaben unterstrichen nur bei Tastaturbedienung (Alt antippen / Alt + Buchstabe); markierter Eintrag `--hover`; ausgegraut 45 % Deckkraft, per Tastatur markierbar, nicht ausführbar (Regeln `menu-enabled.ts`).
- **Mausrad** (`wheel.ts`): ohne Taste Zoom um den Zeiger, Alt senkrecht, Umschalt waagerecht verschieben, Kipprad/Trackpad seitlich verschieben.
- **Griffe**: 6 px außerhalb der Auswahlecken (`HANDLE_GAP`), Innenfläche verschiebt. Nach dem Zeichnen mit Rechteck & Co. bleiben die Griffe sichtbar (dort nur Anzeige).
- **Radierer live**: Ergebnis schon beim Ziehen (immer vom Stand beim Drücken aus gerechnet); noch nicht gerechneter Rest der Spur als Streifen in 35 % Akzent, Spitze als 1-px-Umriss am Zeiger; Loslassen = ein Rückgängig-Schritt. Fängt nie (freie Spur, `noSnap`), wie Hand und Zoom.
- **Mauszeiger** (`toolCursor`): Zeichenwerkzeuge Fadenkreuz, Hand greifen, Zoom Lupe, Pipette eigener Zeiger aus dem Werkzeug-Symbol mit weißem Rand, Hotspot an der Spitze.
- **Statusleiste**: Farbfelder für Füllung/Kontur mit Klartext; Hinweise (`role=status`) in der Mitte.

## Offen

- Griffe in Form-Werkzeugen nur Anzeige: Ziehen daran zeichnet neu statt zu skalieren.
- Alt antippen (Leiste per Tastatur) nur unter Windows/Linux; unter Windows im echten Fenster noch ungetestet. Mac: nur Alt + Merkbuchstabe.
- Fangen: kein Halten von Q, keine Schnittpunkte/Tangenten/Lote, kein Fangradius-Feld, keine dynamischen Hilfslinien; aus dem Lineal gezogene Hilfslinien fangen nicht.
- Textleiste ohne Unterstreichen, Blocksatz und Abstände (Abstände nur im Andockfenster „Text“). Größenfeld der Textleiste in der echten App ungeprüft (Fokus ließ sich dort nicht setzen).
- Objekt-Manager: keine Masterseite, kein Umschalt+Pfeil (Mehrfachwahl per Tastatur). Formen-Befehle (Verschweißen usw.), Messer und Radierer nehmen keine Kinder in Gruppen.
- Messer: kein Bézier-Modus, keine Lücke/Überlappung beim Teilen; Schnitt muss ganz durchgehen. Radierer ohne Klick-Klick-Linie, Druck und „Knoten reduzieren“. Pipette überträgt nur Füllung/Kontur. Radierer-Keil (Haarnadel nach oben) einmal in echter App gesehen (05.11.), danach 0/3 nachgestellt; Form passt zu einem einzelnen Ausreißer-Zeigerpunkt, Ursache offen.
- Verlauf: Palettenfarbe lässt sich nicht auf die Linie ziehen (Vorbild: neuer Knoten); Lage und Farbe des Knotens nicht als Feld in der Eigenschaftsleiste. Kontur in Objekt auf dem Mac ohne Kürzel (⇧⌘Q meldet ab), nur Menü.
- Seiten: keine Vorschaubilder, alle Seiten gleich groß; PDF-Export und Drucken nehmen nur die aktuelle Seite.
