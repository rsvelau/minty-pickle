// Pointer input on the board (mouse and touch) for every tool, hover, and
// switching tools.

import { __set_hoverIndex, grid, hoverIndex, ui } from './config.js';
import { toast } from './files.js';
import { updateHoverInfo, updateUndoButtons } from './shell.js';
import { move, moveClick, refreshMoveOverlay } from '../editor/moveCheck.js';
import { __set_painting, activeTouches, paintAllowed, painting, pickCell } from '../editor/painting.js';
import { cancelPlacing, fitPlacing, paintLine, paintRect, placing, placingBrush, showPlacing, startPlacing } from '../editor/placing.js';
import { $, $$ } from './dom.js';
import { canvas, endEdgeStroke, gridPoint, isDoorBrush, moveEdgeStroke, nearestEdge, setHoverEdge, startEdgeStroke } from '../editor/walls.js';
import { play, renderPlay } from '../play/playView.js';
import { refreshKeyHighlight, refreshMarkers, refreshPropsAndWalls } from '../render/board.js';
import { __set_camTween, camera, cellToWorld, controls } from '../render/scene.js';
import { hoverBox } from '../render/tileLook.js';

// Run once at startup (called from src/main.js, in order).
export function init() {
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch') {
      activeTouches.add(ev.pointerId);
      if (activeTouches.size > 1 && painting) { cancelPainting(); return; }
    }
    if (ev.button !== 0 || !paintAllowed() || activeTouches.size > 1) return;
    if (ui.tool === 'walls') { startEdgeStroke(ev); return; }
    if (ui.tool === 'move') { moveClick(pickCell(ev)); return; }
    if (ui.tool === 'play') {
      // A tap on (or near) a direction choice picks it...
      const cell = pickCell(ev);
      if (cell && play.choose(grid.index(cell.x, cell.y))) return;
      const pt = gridPoint(ev);
      if (pt && play.state.phase === 'choosing') {
        let best = null, bestD = 1.0;
        for (const o of play.state.options) {
          const c = grid.coords(o.i);
          const d = Math.hypot(pt.gx - (c.x + 0.5), pt.gy - (c.y + 0.5));
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best) { play.choose(best.i); return; }
      }
      // ...otherwise press and hold to fast-forward anyone still running.
      if (play.anyRunning() || play.state.phase === 'rolling') {
        play.setFast(true);
        canvas.setPointerCapture?.(ev.pointerId);
        renderPlay();
      }
      return;
    }
    const cell = pickCell(ev);
    if (!cell) return;
    canvas.setPointerCapture(ev.pointerId);
    if (placingBrush() && !ev.shiftKey) {
      // Premade building: preview it (or move the preview); nothing is painted.
      const inside = placing && placing.brush === ui.brush
        && cell.x >= placing.x && cell.x < placing.x + placing.w && cell.y >= placing.y && cell.y < placing.y + placing.h;
      if (!placing || placing.brush !== ui.brush) startPlacing(cell);
      else if (!inside) { fitPlacing(placing, cell.x + 0.5, cell.y + 0.5); showPlacing(); }
      __set_painting({ pointerId: ev.pointerId, placingDrag: true, off: { x: cell.x - placing.x, y: cell.y - placing.y } });
      return;
    }
    __set_painting({ pointerId: ev.pointerId, start: cell, last: cell, rect: ui.shape === 'rect' || ev.shiftKey });
    grid.beginStroke();
    if (painting.rect) paintRect(cell, cell);
    else paintLine(cell, cell);
  });

  canvas.addEventListener('pointermove', (ev) => {
    const cell = pickCell(ev, { clamp: !!painting });
    if (ui.tool === 'play') {
      setHover(cell);
      canvas.style.cursor = cell && play.isOption(grid.index(cell.x, cell.y)) ? 'pointer' : 'crosshair';
      return;
    }
    if (ui.tool === 'move') {
      setHover(cell);
      if (move.start >= 0 && move.pinned < 0) refreshMoveOverlay();
      return;
    }
    if (ui.tool === 'walls') {
      const rect = (ui.shape === 'rect' || ev.shiftKey) && !isDoorBrush();
      setHoverEdge(rect ? null : nearestEdge(gridPoint(ev)));
      setHover(rect ? cell : null);
      if (painting?.edges && ev.pointerId === painting.pointerId) moveEdgeStroke(ev);
      return;
    }
    setHover(cell);
    if (!painting || ev.pointerId !== painting.pointerId || !cell) return;
    if (painting.placingDrag) {
      const nx = cell.x - painting.off.x, ny = cell.y - painting.off.y;
      if (placing && (nx !== placing.x || ny !== placing.y)) { fitPlacing(placing, nx + placing.w / 2, ny + placing.h / 2); showPlacing(); }
      return;
    }
    if (cell.x === painting.last.x && cell.y === painting.last.y) return;
    if (painting.rect) paintRect(painting.start, cell);
    else paintLine(painting.last, cell);
    painting.last = cell;
  });
  canvas.addEventListener('pointerup', finishPainting);
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, () => { if (play.state.fast) { play.setFast(false); renderPlay(); } });
  }
  canvas.addEventListener('pointercancel', (ev) => {
    activeTouches.delete(ev.pointerId);
    if (painting && ev.pointerId === painting.pointerId) cancelPainting();
  });
  canvas.addEventListener('pointerleave', () => { if (!painting) { setHover(null); setHoverEdge(null); } });
}

export function finishPainting(ev) {
  if (ev && ev.pointerType === 'touch') activeTouches.delete(ev.pointerId);
  if (!painting || (ev && ev.pointerId !== painting.pointerId)) return;
  if (painting.placingDrag) { __set_painting(null); return; }
  if (painting.edges) endEdgeStroke();
  if (painting.skipped) toast('Markers only go on walkable cells; blocked cells were skipped.');
  __set_painting(null);
  grid.endStroke();
  updateUndoButtons();
}
export function cancelPainting() {
  if (painting?.placingDrag) { __set_painting(null); return; }
  grid.revertStroke();
  grid.endStroke();
  __set_painting(null);
}

export function setHover(cell) {
  const prev = hoverIndex;
  __set_hoverIndex(cell ? grid.index(cell.x, cell.y) : -1);
  hoverBox.visible = !!cell;
  updateHoverInfo();
  if (prev !== hoverIndex) refreshKeyHighlight();
}

// `start` (play only): 'standard' (11 PM) or 'midnight'; switching restarts.
export function setTool(tool, start) {
  if (tool !== 'cells') cancelPlacing();
  if (tool === 'play' && start && start !== play.state.startMode) play.setStartMode(start);
  ui.tool = tool;
  $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool
    && (!b.dataset.start || b.dataset.start === play.state.startMode)));
  $('#cellTools').hidden = tool !== 'cells';
  $('#wallTools').hidden = tool !== 'walls';
  $('#moveTools').hidden = tool !== 'move';
  $('#markerTools').hidden = tool !== 'markers';
  $('#playTools').hidden = tool !== 'play';
  $('#playHud').hidden = tool !== 'play';
  if (tool !== 'play') $('#gameClock').hidden = true;
  if (tool !== 'play') {
    $('#endConfirm').hidden = true;
    $('#playTray').hidden = true; $('#askCard').hidden = true; $('#obolReveal').hidden = true; $('#inventory').hidden = true;
    $('#revealSheet').hidden = true; $('#cardPop').hidden = true; $('#casebook').hidden = true; $('#intentBanner').hidden = true;
  }
  document.body.classList.toggle('playing', tool === 'play');
  // Phones: fold the panel away so the board and the play bar are visible.
  if (tool === 'play' && window.innerWidth < 700) {
    $('#panel').hidden = true;
    $('#expand').hidden = false;
    // ...and move in close to the pawn so cells are big enough to tap.
    play.setActive(true); // places the pawn on the Start space if needed
    if (play.state.pos >= 0) {
      const { x, y } = grid.coords(play.state.pos);
      const p = cellToWorld(x, y);
      const offset = camera.position.clone().sub(controls.target).setLength(11);
      __set_camTween({ t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: p.clone().add(offset), toTarget: p });
    }
  }
  play.setActive(tool === 'play');
  refreshMarkers();
  refreshPropsAndWalls();
  renderPlay();
  setHoverEdge(null);
  setHover(null);
  refreshMoveOverlay();
}
