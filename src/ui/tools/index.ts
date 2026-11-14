// Alle Werkzeuge des Werkzeugkastens an einem Editor.
import type { Tool as ToolName } from '../shortcuts';
import type { TextFields } from './text-tool';
import { contourParams } from '../contour-params.svelte';
import { contourTool } from './contour-tool';
import { eraserTool, eyedropperTool, knifeTool, type CutParams } from './cut-tools';
import { freehandTool, penTool } from './draw-tools';
import { gradientTool } from './gradient-tool';
import { nodeTool } from './node-tool';
import { pieceTool } from './piece-tool';
import { selectTool } from './select-tool';
import { shapeTool, type ShapeParams } from './shape-tool';
import { smoothParams } from '../smooth-params.svelte';
import { smoothTool } from './smooth-tool';
import { textTool } from './text-tool';
import type { Editor, Tool } from './tool';
import { handTool, zoomTool } from './view-tools';

export function createTools(
  ed: Editor,
  o: { smoothing: () => number; shape: () => ShapeParams; cut: () => CutParams; redraw: () => void; textDefaults: () => TextFields },
): Record<ToolName, Tool> {
  return {
    select: selectTool(ed),
    lasso: selectTool(ed, { freehand: true }),
    node: nodeTool(ed),
    smooth: smoothTool(ed, smoothParams),
    pen: penTool(ed),
    freehand: freehandTool(ed, o.smoothing),
    rect: shapeTool(ed, 'rect', o.shape),
    ellipse: shapeTool(ed, 'ellipse', o.shape),
    polygon: shapeTool(ed, 'polygon', o.shape),
    knife: knifeTool(ed, o.cut, o.redraw),
    piece: pieceTool(ed),
    eraser: eraserTool(ed, o.cut, o.redraw),
    eyedropper: eyedropperTool(ed, o.cut),
    contour: contourTool(ed, contourParams, o.redraw),
    gradient: gradientTool(ed),
    text: textTool(ed, o.redraw, o.textDefaults),
    hand: handTool(ed),
    zoom: zoomTool(ed),
  };
}
