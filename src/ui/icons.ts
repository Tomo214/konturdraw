// Eigene Strich-Icons, Raster 20 × 20, Linie 1,5 (Icon.svelte). Keine Vorlage aus fremden Programmen.
// Paar [Ergebnis, Ausgang]: der zweite Teil wird gedimmt gezeichnet (Formen-Befehle).
import type { Tool } from './shortcuts';

export const ICONS = {
  // Werkzeuge
  select: 'M5.5 3l10 7.5-4.6 1 2.6 5.2-2 1-2.6-5.3-3.4 3.1z',
  lasso: 'M10 3.5c4 0 7 2 7 4.75S14 13 10 13s-7-2-7-4.75S6 3.5 10 3.5z M6.5 12.25c-1.5 1-1.75 2.5-.75 3.5s2.5.75 3-.5',
  node: 'M4 16C5 9 10 5 16 4 M2.75 14.75h2.5v2.5h-2.5z M14.75 2.75h2.5v2.5h-2.5z M9 6.5l-3.5 1',
  zoom: 'M13.5 8.5a5 5 0 1 1-10 0 5 5 0 0 1 10 0z M12.2 12.2L17 17',
  hand: 'M7.5 10V5a1.25 1.25 0 0 1 2.5 0v4.5 M10 9.5V3.75a1.25 1.25 0 0 1 2.5 0V9.5 M12.5 9.5V5.25a1.25 1.25 0 0 1 2.5 0V12c0 3-2 5.5-5 5.5h-.5c-2 0-3.2-1-4.2-2.6L3.6 11.5a1.2 1.2 0 0 1 2-1.3l1.9 2.3V10',
  freehand: 'M3 13c1.5-3 3-4 4-1.5s2 3 3.5.5 2.5-6 6.5-6',
  pen: 'M7.5 4.5h5l2.5 5.5-5 7.5-5-7.5z M10 17.5V12 M11 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0z',
  rect: 'M3.5 5.5h13v9h-13z',
  ellipse: 'M17 10a7 4.75 0 1 1-14 0 7 4.75 0 0 1 14 0z',
  polygon: 'M10 3.5l6.66 4.84-2.55 7.82H5.89L3.34 8.34z',
  text: 'M4.5 16.5L10 3.5l5.5 13 M6.6 11.75h6.8',
  gradient: 'M3.5 3.5h13v13h-13z M7 13l6-6 M5.75 11.75h2.5v2.5h-2.5z M14.5 5.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
  knife: 'M3 17l3-3 M6 14l9.5-9.5c1.3 2.6.6 5.2-1.8 7.6L11 14.8z',
  // Stück zwischen zwei Kreuzungen gedimmt = wird gelöscht
  // Pinselkreis glättet, links der zackige Ausgang
  smooth: ['M17.5 11.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0z M8.5 11.5c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0', 'M2 11.5l1.6-2 1.6 2 1.6-2 1.6 2'],
  piece: ['M6 3.5v13 M14 3.5v13 M2.5 11H6 M14 11h3.5', 'M6 11h8'],
  eraser: 'M3.75 12.6l7.9-7.9a1.5 1.5 0 0 1 2.1 0l2.55 2.55a1.5 1.5 0 0 1 0 2.1L9.4 16.25H6.6l-2.85-2.85a.57.57 0 0 1 0-.8z M7.6 8.75l4.65 4.65 M9.4 16.25h7.1',
  contour: 'M8 8h4v4H8z M5.5 5.5h9v9h-9z M5 3h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
  eyedropper: 'M4 16l1-3 6.5-6.5 2 2L7 15z M10.25 5.25l4.5 4.5 M12.5 7.5l2.25-2.25a1.6 1.6 0 0 0-2.25-2.25L10.25 5.25',
  // Standardleiste
  new: 'M5 2.5h6.5L15 6v11.5H5z M11.5 2.5V6H15',
  open: 'M2.5 15.5v-10h5L9 7h6.5v2 M2.5 15.5L5 9h13l-2.5 6.5z',
  save: 'M3.5 3.5h10l3 3v10h-13z M6.5 3.5v4h6v-4 M6 16.5v-5h8v5',
  import: 'M6.5 6.5v-3h10v13h-10v-3 M2.5 10h9 M8.5 7l3 3-3 3',
  export: 'M13.5 6.5v-3h-10v13h10v-3 M8.5 10h9 M14.5 7l3 3-3 3',
  print: 'M5.5 8V2.5h9V8 M5.5 14.5h-3V8h15v6.5h-3 M5.5 12h9v5.5h-9z',
  cut: 'M7 14.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0z M17.5 14.5a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0z M6.3 12.8L14 2.5 M13.7 12.8L6 2.5',
  copy: 'M7 6.5h9.5v11H7z M4 13.5v-10h9',
  paste: 'M6.5 4h-2v13.5h11V4h-2 M7.5 2.5h5v3h-5z',
  undo: 'M7 4L3 8l4 4 M3 8h8.5a4.5 4.5 0 0 1 0 9H8',
  redo: 'M13 4l4 4-4 4 M17 8H8.5a4.5 4.5 0 0 0 0 9H12',
  // Eigenschaftsleiste
  lock: 'M5.5 9.5h9v7h-9z M7.5 9.5V7a2.5 2.5 0 0 1 5 0v2.5',
  rotate: 'M16 10a6 6 0 1 1-1.76-4.24 M14.5 2.5V6H11',
  mirrorH: 'M10 2.5v15 M8 5L3 15h5z M12 5l5 10h-5z',
  mirrorV: 'M2.5 10h15 M5 8l10-5v5z M5 12l10 5v-5z',
  skewH: 'M6.5 5.5h11l-4 9h-11z',
  skewV: 'M5.5 2.5v11l9 4v-11z',
  portrait: 'M5.5 2.5h9v15h-9z',
  landscape: 'M2.5 5.5h15v9h-15z',
  nudge: 'M10 3v14 M3 10h14 M8 5l2-2 2 2 M8 15l2 2 2-2 M5 8l-2 2 2 2 M15 8l2 2-2 2',
  scale: 'M3.5 10.5h6v6h-6z M3.5 10.5v-7h13v13h-7 M9.5 10.5l6-6 M12 4.5h3.5V8',
  size: 'M6.5 6.5h10v10h-10z M6.5 3.5h10 M6.5 2.5v2 M16.5 2.5v2 M3.5 6.5v10 M2.5 6.5h2 M2.5 16.5h2',
  // Lineal-Ecke: Nullpunkt
  origin: 'M10 2.5v15 M2.5 10h15 M13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  // Knoten-Werkzeug (Quadrat = Knoten, Kreis = Anfasser; gedimmt = Ausgangslage)
  nodeAdd: 'M3 16C3.5 9.5 7.5 5 15 4.5 M5.15 6.75h2.5v2.5h-2.5z M14.5 11.5v6 M11.5 14.5h6',
  nodeDelete: 'M3 16C3.5 9.5 7.5 5 15 4.5 M5.15 6.75h2.5v2.5h-2.5z M11.5 14.5h6',
  nodeJoin: 'M2.5 16.5C3.5 13 5.5 11 8.75 11 M17.5 16.5C16.5 13 14.5 11 11.25 11 M8.75 9.75h2.5v2.5h-2.5z M7 4l3 3 3-3',
  nodeBreak: 'M2.5 16.5C3.5 13.5 5 11.5 7 11 M17.5 16.5C16.5 13.5 15 11.5 13 11 M5.75 9.75h2.5v2.5h-2.5z M11.75 9.75h2.5v2.5h-2.5z M10 3.5V6 M10 14v2.5',
  segLine: 'M3 14.5h2.5V17H3z M14.5 3H17v2.5h-2.5z M5.5 14.5l9-9',
  segCurve: 'M3 14.5h2.5V17H3z M14.5 3H17v2.5h-2.5z M5.5 14.5C5.5 8 8 5.5 14.5 5.5',
  nodeCorner:
    'M8.75 13.25h2.5v2.5h-2.5z M9.15 13.25L4.7 6.55 M10.85 13.25l4.45-6.7 M5.25 5.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z M17.25 5.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
  // Glatt/Symmetrisch: Anfasser hell, Kurve gedimmt; Unterschied = ungleich vs. gleich lange Anfasser
  nodeSmooth: [
    'M8.75 8.75h2.5v2.5h-2.5z M8 10h.75 M11.25 10h5.25 M8 10a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z M19 10a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
    'M2.5 16C4 12 6.5 10 10 10s6 2 7.5 6',
  ],
  nodeSymmetric: [
    'M8.75 8.75h2.5v2.5h-2.5z M5 10h3.75 M11.25 10H15 M5 10a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z M17.5 10a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
    'M2.5 16C4 12 6.5 10 10 10s6 2 7.5 6',
  ],
  pathReverse: 'M3.5 7h12 M12.5 4l3 3-3 3 M16.5 13h-12 M7.5 10l-3 3 3 3',
  pathClose: 'M12.5 5.55A6 6 0 1 1 7.5 5.55 M11.25 4.3h2.5v2.5h-2.5z M6.25 4.3h2.5v2.5h-2.5z',
  subpathExtract: ['M17.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z M9 11l3.5-3.5 M9.5 7.5h3v3', 'M2.5 7.5h10v10h-10z M9.5 12.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'],
  nodesAlignH: ['M3.25 8.75h2.5v2.5h-2.5z M8.75 8.75h2.5v2.5h-2.5z M14.25 8.75h2.5v2.5h-2.5z', 'M2 10h16 M3.25 3.75h2.5v2.5h-2.5z M14.25 13.75h2.5v2.5h-2.5z'],
  nodesAlignV: ['M8.75 3.25h2.5v2.5h-2.5z M8.75 8.75h2.5v2.5h-2.5z M8.75 14.25h2.5v2.5h-2.5z', 'M10 2v16 M3.75 3.25h2.5v2.5h-2.5z M13.75 14.25h2.5v2.5h-2.5z'],
  nodesStretch: ['M5.25 9.25h2.5v2.5h-2.5z M9.25 5.25h2.5v2.5h-2.5z M12 12l4 4 M16 12.5V16h-3.5', 'M2.5 2.5h15v15h-15z'],
  nodesRotate: ['M5.25 9.25h2.5v2.5h-2.5z M9.25 5.25h2.5v2.5h-2.5z M15.5 10.5a4.5 4.5 0 0 1-4.5 4.5 M12.75 13.25L11 15l1.75 1.75', 'M2.5 2.5h15v15h-15z'],
  nodesReduce: ['M3 15C5.5 7 11.5 4.5 17 5 M1.75 13.75h2.5v2.5h-2.5z M15.75 3.75h2.5v2.5h-2.5z', 'M5.25 7.5h2.5v2.5h-2.5z M10.25 4.35h2.5v2.5h-2.5z'],
  // Ausrichten (Linie = Bezug)
  // Text-Ausrichtung (Eigenschaftsleiste Text)
  textLeft: 'M3.5 5h13 M3.5 8.5h8 M3.5 12h13 M3.5 15.5h8',
  textCenter: 'M3.5 5h13 M6 8.5h8 M3.5 12h13 M6 15.5h8',
  textRight: 'M3.5 5h13 M8.5 8.5h8 M3.5 12h13 M8.5 15.5h8',
  alignLeft: 'M3.5 2.5v15 M6 5.5h10v3H6z M6 11.5h6v3H6z',
  alignCenterX: 'M10 2.5v15 M4.5 5.5h11v3h-11z M7 11.5h6v3H7z',
  alignRight: 'M16.5 2.5v15 M4 5.5h10v3H4z M8 11.5h6v3H8z',
  alignTop: 'M2.5 3.5h15 M5.5 6h3v10h-3z M11.5 6h3v6h-3z',
  alignCenterY: 'M2.5 10h15 M5.5 4.5h3v11h-3z M11.5 7h3v6h-3z',
  alignBottom: 'M2.5 16.5h15 M5.5 4h3v10h-3z M11.5 8h3v6h-3z',
  alignPage: 'M3.5 2.5h13v15h-13z M7.5 7.5h5v5h-5z',
  // Verteilen (Linien = gleich weit auseinander)
  distLeft: 'M3 3v14 M8.5 3v14 M14 3v14 M3 6h3v8H3z M8.5 6h4v8h-4z M14 6h2.5v8H14z',
  distCenterX: 'M4.5 3v14 M10 3v14 M15.5 3v14 M3 6h3v8H3z M8 6h4v8H8z M14 6h3v8h-3z',
  distRight: 'M6 3v14 M11.5 3v14 M17 3v14 M3 6h3v8H3z M7.5 6h4v8h-4z M14.5 6H17v8h-2.5z',
  distSpacingX: 'M3 5h3v10H3z M8.5 5h4v10h-4z M15 5h2.5v10H15z M6 10h2.5 M12.5 10H15',
  distTop: 'M3 3h14 M3 8.5h14 M3 14h14 M6 3h8v3H6z M6 8.5h8v4H6z M6 14h8v2.5H6z',
  distCenterY: 'M3 4.5h14 M3 10h14 M3 15.5h14 M6 3h8v3H6z M6 8h8v4H6z M6 14h8v3H6z',
  distBottom: 'M3 6h14 M3 11.5h14 M3 17h14 M6 3h8v3H6z M6 7.5h8v4H6z M6 14.5h8V17H6z',
  distSpacingY: 'M5 3h10v3H5z M5 8.5h10v4H5z M5 15h10v2.5H5z M10 6v2.5 M10 12.5V15',
  // Formen-Befehle: Quadrat hinten, Kreis vorn
  weld: ['M3 3h9v4a5 5 0 1 1-5 5H3z', 'M12 7v5H7 M12 7a5 5 0 0 0-5 5'],
  trim: ['M3 3h9v4a5 5 0 0 0-5 5H3z M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0z', 'M12 7v5H7'],
  intersect: ['M12 7a5 5 0 0 0-5 5h5z', 'M3 3h9v9H3z M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0z'],
  simplify: ['M3 3h7v3.5H6.5V10H3z M6.5 6.5h7V10H10v3.5H6.5z M10 10h7v7h-7z', 'M10 6.5V10H6.5 M13.5 10v3.5H10'],
  frontMinusBack: ['M12 7a5 5 0 1 1-5 5h5z', 'M3 3h9v9H3z'],
  backMinusFront: ['M3 3h9v4a5 5 0 0 0-5 5H3z', 'M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0z'],
  boundary: [
    'M4 2.5h7A1.5 1.5 0 0 1 12.5 4v2.52a5.5 5.5 0 1 1-5.98 5.98H4A1.5 1.5 0 0 1 2.5 11V4A1.5 1.5 0 0 1 4 2.5z',
    'M4 4h7v7H4z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  ],
  combine: 'M2.5 6.5h7v7h-7z M17.5 10a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M6 16v1.5h8V16',
  breakApart: 'M2.5 6.5h7v7h-7z M17.5 10a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M6 16v1.5h2 M14 16v1.5h-2',
  // Kleinteile
  close: 'M5.5 5.5l9 9 M14.5 5.5l-9 9',
  chevronRight: 'M8 5l5 5-5 5',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  menu: 'M4 6h12 M4 10h12 M4 14h12',
  none: 'M4 16L16 4',
  chevronLeft: 'M12 5l-5 5 5 5',
  chevronDown: 'M5 8l5 5 5-5',
  first: 'M5.5 5v10 M14 5l-5 5 5 5',
  last: 'M14.5 5v10 M6 5l5 5-5 5',
  plus: 'M10 4.5v11 M4.5 10h11',
  trash: 'M4 6h12 M8 6V4h4v2 M5.5 6l1 11h7l1-11',
  // Objekt-Manager
  layer: 'M10 3.5l7 3.75-7 3.75-7-3.75z M3 11l7 3.75L17 11',
  layerAdd: 'M10 3.5l7 3.75-7 3.75-7-3.75z M3 11l7 3.75 2-1.07 M15.5 12.5v5 M13 15h5',
  group: 'M5.5 5.5h6v6h-6z M8.5 8.5h6v6h-6z M2.5 5V2.5H5 M15 2.5h2.5V5 M17.5 15v2.5H15 M5 17.5H2.5V15',
  image: 'M3 4.5h14v11H3z M3 13l4-4 3 3 2-2 5 5 M14 8a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0z',
  eye: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z M12.5 10a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  eyeOff: ['M3.5 16.5l13-13', 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z'],
  printer: 'M5.5 7.5V3h9v4.5 M5.5 14h-2V7.5h13V14h-2 M5.5 11.5h9V17h-9z',
  printerOff: ['M3.5 16.5l13-13', 'M5.5 7.5V3h9v4.5 M5.5 14h-2V7.5h13V14h-2 M5.5 11.5h9V17h-9z'],
  unlock: 'M5.5 9.5h9v7h-9z M7.5 9.5V7a2.5 2.5 0 0 1 4.9-.7',
} as const;

export type IconName = keyof typeof ICONS;
export type IconPath = string | readonly [string, string];

/** Jedes Werkzeug hat ein Icon gleichen Namens. */
export const toolIcon = (t: Tool): IconName => t;
