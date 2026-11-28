// Placing premade buildings as a preview that can be rotated, flipped and
// moved before its footprint is laid.

import { hasFixedFootprint, landmarkDims, isLandmark, AREAS, FACING_NAMES, defaultCell } from '../core/state.js';
import { BRUSHES, grid, ui } from '../app/config.js';
import { toast } from '../app/files.js';
import { updateUndoButtons } from '../app/shell.js';
import { applyAt, brushFootprint, currentPatch } from './painting.js';
import { $ } from '../app/dom.js';
import { projTmp } from '../play/playView.js';
import { landmarks, targetHeights } from '../render/board.js';
import { camera, cellToWorld, wake } from '../render/scene.js';

// --- Placing premade buildings ----------------------------------------------------
// With a premade building's brush (Spaces tool, Brush shape), a tap shows the
// building as a preview, nothing painted yet. Drag it to move it; Rotate,
// Flip, then Place lays its footprint (or Cancel). Tapping a placed building
// with its own brush picks it up the same way. Rectangle shape still tiles
// buildings directly, facing their roads.
export let placing = null; // { brush, sub, x, y, w, h, face, flip, from: block | null, valid }
export const brushSub = () => (ui.tool === 'cells' && ui.brush?.includes(':') ? ui.brush.split(':')[1] : null);
export const placingBrush = () => ui.tool === 'cells' && ui.shape !== 'rect' && hasFixedFootprint(brushSub());

export function fitPlacing(p, cx, cy) {
  // Centre the block on (cx, cy) as far as the board allows.
  [p.w, p.h] = landmarkDims(p.sub, p.face);
  p.x = Math.max(0, Math.min(grid.cols - p.w, Math.round(cx - p.w / 2)));
  p.y = Math.max(0, Math.min(grid.rows - p.h, Math.round(cy - p.h / 2)));
  // It can't cover a different premade or area landmark (move that first).
  const mine = new Set(p.from?.cells ?? []);
  p.valid = p.w <= grid.cols && p.h <= grid.rows;
  for (let dy = 0; dy < p.h && p.valid; dy++) for (let dx = 0; dx < p.w && p.valid; dx++) {
    const i = grid.index(p.x + dx, p.y + dy);
    if (!mine.has(i) && isLandmark(grid.cells[i].sub)) p.valid = false;
  }
  p.anchor = grid.index(p.x, p.y);
}
export function showPlacing() {
  landmarks.setPreview(placing && { sub: placing.sub, x: placing.x, y: placing.y, w: placing.w, h: placing.h, face: placing.face, flip: placing.flip, valid: placing.valid, anchor: placing.anchor, hide: placing.from?.anchor ?? -1 });
  $('#placeBar').hidden = !placing;
  if (placing) {
    $('#placeName').textContent = `${AREAS.outdoor.subs[placing.sub]?.label ?? 'Building'} · faces ${FACING_NAMES[placing.face]}${placing.flip ? ' · flipped' : ''}`;
    $('#placeOk').disabled = !placing.valid;
    $('#placeOk').title = placing.valid ? 'Lay the building here' : 'It overlaps another landmark';
    $('#placeFlip').hidden = $('#placeRotate').hidden = placing.sub === 'clocktower'; // the same from every side
  }
  positionPlaceBar();
  wake();
}
export function startPlacing(cell) {
  const fp = { sub: brushSub() };
  const i = grid.index(cell.x, cell.y);
  const block = grid.cells[i].sub === fp.sub ? grid.landmarkAt(i) : null;
  if (block) {
    // Pick up a placed building where it stands.
    const face = block.face ?? autoFacing(block.x, block.y, block.w, block.h);
    placing = { brush: ui.brush, sub: fp.sub, face, flip: block.flip, from: block };
    fitPlacing(placing, block.x + block.w / 2, block.y + block.h / 2);
    toast('Picked up: drag to move, then Rotate, Flip or Place.');
  } else {
    placing = { brush: ui.brush, sub: fp.sub, face: 2, flip: false, from: null };
    // Start facing the most road around the tapped spot.
    let best = -1;
    for (const f of [2, 0, 1, 3]) {
      const p = { ...placing, face: f };
      fitPlacing(p, cell.x + 0.5, cell.y + 0.5);
      const n = grid.roadsAlong(p.x, p.y, p.w, p.h, f);
      if (n > best) { best = n; placing.face = f; }
    }
  }
  fitPlacing(placing, placing.x !== undefined ? placing.x + placing.w / 2 : cell.x + 0.5, placing.y !== undefined ? placing.y + placing.h / 2 : cell.y + 0.5);
  showPlacing();
}
export function autoFacing(x, y, w, h) {
  const sides = [0, 1, 2, 3].filter((f) => w === h || (w > h ? f % 2 === 0 : f % 2 === 1));
  let face = sides.includes(2) ? 2 : sides[0], best = -1;
  for (const f of sides) {
    const n = grid.roadsAlong(x, y, w, h, f);
    if (n > best || (n === best && f === 2)) { best = n; face = f; }
  }
  return face;
}
export function rotatePlacing() {
  if (!placing) return;
  const cx = placing.x + placing.w / 2, cy = placing.y + placing.h / 2;
  placing.face = (placing.face + 1) % 4; // clockwise from above
  fitPlacing(placing, cx, cy);
  showPlacing();
}
export function flipPlacing() {
  if (!placing) return;
  placing.flip = !placing.flip;
  showPlacing();
}
export function cancelPlacing() {
  if (!placing) return;
  placing = null;
  showPlacing();
}
export function confirmPlacing() {
  if (!placing?.valid) return;
  const p = placing;
  const cells = [];
  for (let dy = 0; dy < p.h; dy++) for (let dx = 0; dx < p.w; dx++) cells.push(grid.index(p.x + dx, p.y + dy));
  grid.beginStroke();
  const touched = [];
  // Moving a building leaves plain ground where it stood.
  if (p.from) for (const i of p.from.cells) if (!cells.includes(i) && grid.apply(i, { ...defaultCell() }, { silent: true })) touched.push(i);
  const brush = BRUSHES[p.brush];
  for (const i of cells) {
    const c = grid.cells[i];
    const base = typeof brush === 'function' ? brush(c, i, grid) : brush;
    if (grid.apply(i, { ...base, sub: p.sub, facing: p.face, flip: p.flip }, { silent: true })) touched.push(i);
  }
  grid.endStroke();
  placing = null;
  showPlacing();
  if (touched.length) grid.emit(touched);
  updateUndoButtons();
  toast(p.from ? 'Building moved. Undo puts it back.' : 'Building placed. Tap it again with this brush to move or turn it.');
}
export function positionPlaceBar() {
  if (!placing) return;
  const a = cellToWorld(placing.x, placing.y);
  projTmp.set(a.x - 0.5 + placing.w / 2, targetHeights[placing.anchor] ?? 0, a.z - 0.5 + placing.h).project(camera);
  const sx = (projTmp.x + 1) / 2 * window.innerWidth, sy = (1 - projTmp.y) / 2 * window.innerHeight;
  const placeBar = $('#placeBar');
  const r = placeBar.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - r.width - 8, sx - r.width / 2));
  const top = Math.max(8, Math.min(window.innerHeight - r.height - 8, sy + 16));
  placeBar.style.left = `${left}px`;
  placeBar.style.top = `${top}px`;
}

export function paintLine(a, b) {
  // Bresenham so quick drags don't skip cells.
  const patch = currentPatch();
  let { x: x0, y: y0 } = a;
  const { x: x1, y: y1 } = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    applyAt(x0, y0, patch);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function paintRect(a, b) {
  grid.revertStroke();
  const patch = currentPatch();
  const touched = [];
  const fp = brushFootprint(); // fixed landmarks tile the rectangle block by block
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += fp?.h ?? 1) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += fp?.w ?? 1) {
      touched.push(...applyAt(x, y, patch, { silent: true }));
    }
  }
  if (touched.length) grid.emit(touched);
}
