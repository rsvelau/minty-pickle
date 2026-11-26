// Pointer input on the board (mouse and touch) for every tool, hover, and
// switching tools.

import { BUILDING_TYPES } from '../core/buildings.js';
import { isLandmark, areaLabel } from '../core/state.js';
import * as THREE from 'three';
import { FACINGS } from '../core/state.js';
import { __set_hoverIndex, grid, hoverIndex, ui } from './config.js';
import { toast } from './files.js';
import { updateHoverInfo, updateUndoButtons } from './shell.js';
import { move, moveClick, refreshMoveOverlay } from '../editor/moveCheck.js';
import { __set_painting, activeTouches, paintAllowed, painting, pickCell } from '../editor/painting.js';
import { cancelPlacing, fitPlacing, paintLine, paintRect, placing, placingBrush, showPlacing, startPlacing } from '../editor/placing.js';
import { $, $$ } from './dom.js';
import { canvas, endEdgeStroke, gridPoint, isDoorBrush, moveEdgeStroke, nearestEdge, setHoverEdge, startEdgeStroke } from '../editor/walls.js';
import { cellPick, play, renderPlay } from '../play/playView.js';
import { refreshKeyHighlight, refreshMarkers, refreshPropsAndWalls } from '../render/board.js';
import { __set_camTween, camera, cellToWorld, controls } from '../render/scene.js';
import { hoverBox } from '../render/tileLook.js';
import { syncPowerOut } from '../play/playView.js';

// Run once at startup (called from src/main.js, in order).
export function init() {
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'touch') {
      activeTouches.add(ev.pointerId);
      if (activeTouches.size > 1 && painting) { cancelPainting(); return; }
    }
    // Play: a tap (down and up without moving: see pointerup) picks a
    // direction or a space, orbit mode or not; holding fast-forwards runners.
    if (ui.tool === 'play') {
      tapStart = ev.button === 0 && activeTouches.size <= 1 ? { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now() } : null;
      if (play.anyRunning() || play.state.phase === 'rolling') {
        play.setFast(true);
        if (!ui.orbitMode) canvas.setPointerCapture?.(ev.pointerId);
        renderPlay();
      }
      return;
    }
    if (ev.button !== 0 || !paintAllowed() || activeTouches.size > 1) return;
    if (ui.tool === 'walls') { startEdgeStroke(ev); return; }
    if (ui.tool === 'move') { moveClick(pickCell(ev)); return; }
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
  canvas.addEventListener('pointerup', (ev) => {
    const t = tapStart;
    tapStart = null;
    if (ui.tool !== 'play' || !t || t.id !== ev.pointerId) return;
    if (Math.hypot(ev.clientX - t.x, ev.clientY - t.y) > 10 || performance.now() - t.t > 600) return; // a drag or a hold
    playTap(ev);
  });
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
  // Buildings tool: always say what happened.
  if (ui.tool === 'buildings') {
    const label = ui.buildingBrush ? BUILDING_TYPES[ui.buildingBrush].label : 'generic';
    const n = painting.buildings?.size ?? 0;
    if (n) toast(n === 1 ? `That building is now ${ui.buildingBrush ? `a ${label}` : 'generic'}.` : `${n} buildings are now ${ui.buildingBrush ? `${label}s` : 'generic'}.`);
    else if (painting.missed !== undefined) {
      const c = grid.cells[painting.missed];
      toast(isLandmark(c.sub)
        ? `The ${areaLabel(c).toLowerCase()} is a premade building with its own look; it can't take a type. Building types are for buildings laid out with indoor floor (Hardwood, Carpet), walls and doors.`
        : 'Tap a building laid out with indoor floor (Hardwood or Carpet), walls and doors.');
    }
  }
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
  $('#buildingTools').hidden = tool !== 'buildings';
  $('#playTools').hidden = tool !== 'play';
  $('#playHud').hidden = tool !== 'play';
  if (tool !== 'play') $('#gameClock').hidden = true;
  if (tool !== 'play') {
    $('#endConfirm').hidden = true;
    $('#playTray').hidden = true; $('#trayPill').hidden = true; $('#moveModeBtn').hidden = true; $('#askCard').hidden = true; $('#obolReveal').hidden = true; $('#inventory').hidden = true;
    $('#revealSheet').hidden = true; $('#cardPop').hidden = true; $('#casebook').hidden = true; $('#intentBanner').hidden = true;
  }
  document.body.classList.toggle('playing', tool === 'play');
  // Phones: fold the panel away so the board and the play bar are visible.
  if (tool === 'play' && window.innerWidth < 700) {
    $('#panel').hidden = true;
    $('#expand').hidden = false;
  }
  if (tool === 'play') {
    play.setActive(true); // places the pawn on the Start space if needed
    frameAhead();
  }
  play.setActive(tool === 'play');
  syncPowerOut(); // a game's Power Outage never reaches the editor
  refreshMarkers();
  refreshPropsAndWalls();
  renderPlay();
  setHoverEdge(null);
  setHover(null);
  refreshMoveOverlay();
}

// Starting play: the camera behind the players, a little above, looking a few
// cells ahead of them, the way they're headed (the way they last came, or out
// of the van).
const AHEAD = 2.5, CAM_DIST = 11, CAM_PITCH = THREE.MathUtils.degToRad(42);
export function frameAhead() {
  const pose = aheadPose();
  if (pose) __set_camTween({ t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: pose.pos, toTarget: pose.target });
}
// The over-the-shoulder view of the player who is up: { pos, target } (or null).
export function aheadPose() {
  const i = play.state.pos;
  if (i < 0) return null;
  const { x, y } = grid.coords(i);
  let fx = 0, fy = -1;
  const prev = play.state.prev;
  if (prev >= 0) { const p = grid.coords(prev); fx = x - p.x; fy = y - p.y; }
  else {
    const van = grid.cells.findIndex((c, j) => c.sub === 'start' && grid.startFront(j) === i);
    if (van >= 0) [fx, fy] = FACINGS[grid.startFacing(van)];
  }
  const fwd = new THREE.Vector3(fx, 0, fy).normalize();
  const target = cellToWorld(x, y).addScaledVector(fwd, AHEAD);
  const pos = target.clone().addScaledVector(fwd, -CAM_DIST * Math.cos(CAM_PITCH)).setY(CAM_DIST * Math.sin(CAM_PITCH));
  return { pos, target };
}

let tapStart = null;
// A tap on the board in play: a space being picked (Distract), or a direction
// choice (on or near its cell).
function playTap(ev) {
  const cell = pickCell(ev);
  if (cellPick) {
    const i = cell ? grid.index(cell.x, cell.y) : -1;
    if (cellPick.cells.has(i)) cellPick.onPick(i);
    return;
  }
  if (cell && play.choose(grid.index(cell.x, cell.y))) return;
  const pt = gridPoint(ev);
  if (pt && play.state.phase === 'choosing') {
    let best = null, bestD = 1.0;
    for (const o of play.state.options) {
      const c = grid.coords(o.i);
      const d = Math.hypot(pt.gx - (c.x + 0.5), pt.gy - (c.y + 0.5));
      if (d < bestD) { bestD = d; best = o; }
    }
    if (best) play.choose(best.i);
  }
}
