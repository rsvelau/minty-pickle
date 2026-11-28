// The Movement check tool: routes, move counts and reachable range.

import * as THREE from 'three';
import { cellLabel } from '../core/state.js';
import { WATER_Y, grid, hoverIndex, ui } from '../app/config.js';
import { $, $$ } from '../app/dom.js';
import { hoverEdge, setHoverEdge } from './walls.js';
import { N, visibleTop } from '../render/board.js';
import { cellToWorld, scene } from '../render/scene.js';
import { tmpColor, tmpMatrix, tmpPos, tmpQuat, tmpScale } from '../render/tileLook.js';

// Module state: assigned by init() below, in the same order as before the split.
export let move, moveGroup, movePlates, moveBars, ringGeo, startRing;
export let endRing, keyRingMat, keyRings;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // --- Movement check ------------------------------------------------------------
  // Pick a start cell; the route to the hovered (or pinned) cell is drawn with
  // its move count, and an optional range shades every cell reachable within N
  // moves. Rules live in GridState (canStep / moveField / route).

  move = { start: -1, pinned: -1, range: 0, diagonal: false, keys: true };
  moveGroup = new THREE.Group();
  scene.add(moveGroup);
  movePlates = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.38, depthWrite: false }),
    64 * 64,
  );
  moveBars = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: '#58d0e8', depthTest: false, transparent: true, opacity: 0.95 }),
    64 * 64,
  );
  ringGeo = new THREE.RingGeometry(0.28, 0.4, 28).rotateX(-Math.PI / 2);
  startRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#6fe07a', depthTest: false, transparent: true }));
  endRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#f0b060', depthTest: false, transparent: true }));
  for (const o of [movePlates, moveBars, startRing, endRing]) { o.raycast = () => {}; o.renderOrder = 12; moveGroup.add(o); }
  // Rings marking keys a route picks up (up to 8).
  keyRingMat = new THREE.MeshBasicMaterial({ color: '#ffd24a', depthTest: false, transparent: true });
  keyRings = Array.from({ length: 8 }, () => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 28).rotateX(-Math.PI / 2), keyRingMat);
    r.renderOrder = 12;
    r.raycast = () => {};
    r.visible = false;
    moveGroup.add(r);
    return r;
  });
  movePlates.renderOrder = 5;
  moveGroup.visible = false;
}

// Height of what you see in a cell, plus a hair.
export const overlayY = (i) => Math.max(visibleTop(i), WATER_Y) + 0.02;

export function refreshMoveOverlay() {
  const active = ui.tool === 'move' && move.start >= 0 && move.start < N;
  moveGroup.visible = active;
  if (!active) {
    if (ui.tool === 'move') $('#moveInfo').textContent = 'No start cell yet. Click one.';
    return;
  }
  const { x: sx, y: sy } = grid.coords(move.start);
  const field = grid.moveField(sx, sy, { diagonal: move.diagonal, keys: move.keys });

  // Range shading: reachable within N moves, brighter when closer.
  let np = 0;
  let reachable = 0;
  if (move.range > 0) {
    for (let i = 0; i < N; i++) {
      const d = field.dist[i];
      if (d < 1 || d > move.range) continue;
      reachable++;
      const { x, y } = grid.coords(i);
      tmpMatrix.makeTranslation(tmpPos.copy(cellToWorld(x, y)).setY(overlayY(i)));
      movePlates.setMatrixAt(np, tmpMatrix);
      movePlates.setColorAt(np++, tmpColor.set('#3fc06a').multiplyScalar(1.15 - 0.6 * (d / move.range)));
    }
  }
  movePlates.count = np;
  movePlates.instanceMatrix.needsUpdate = true;
  if (movePlates.instanceColor) movePlates.instanceColor.needsUpdate = true;

  startRing.position.copy(cellToWorld(sx, sy)).setY(overlayY(move.start) + 0.005);
  for (const r of keyRings) r.visible = false;

  // Route to the pinned cell, else the hovered one.
  const target = move.pinned >= 0 ? move.pinned : hoverIndex;
  let nb = 0;
  endRing.visible = target >= 0 && target !== move.start;
  const startLabel = cellLabel(sx, sy);
  let line = `Start <b>${startLabel}</b>. Hover a cell to see the route.`;
  if (target >= 0 && target !== move.start) {
    const { x: tx, y: ty } = grid.coords(target);
    endRing.position.copy(cellToWorld(tx, ty)).setY(overlayY(target) + 0.005);
    const d = field.dist[target];
    if (d < 0) {
      endRing.material.color.set('#e8665a');
      line = `${startLabel} → <b>${cellLabel(tx, ty)}</b>: <b>no route</b> (walls, windows, locked or one-way doors, or blocked cells are in the way${move.keys ? ', and no reachable key opens them' : ''}).`;
    } else {
      endRing.material.color.set('#f0b060');
      // The route, including any detour to pick up keys.
      const pts = field.path(target);
      const keyCells = field.keysOn(target);
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = grid.coords(pts[k]);
        const b = grid.coords(pts[k + 1]);
        const pa = cellToWorld(a.x, a.y).setY(overlayY(pts[k]) + 0.03);
        const pb = cellToWorld(b.x, b.y).setY(overlayY(pts[k + 1]) + 0.03);
        const len = pa.distanceTo(pb);
        tmpQuat.setFromUnitVectors(new THREE.Vector3(1, 0, 0), pb.clone().sub(pa).normalize());
        tmpMatrix.compose(pa.add(pb).multiplyScalar(0.5), tmpQuat, tmpScale.set(len + 0.06, 0.03, 0.06));
        moveBars.setMatrixAt(nb++, tmpMatrix);
      }
      line = `${startLabel} → <b>${cellLabel(tx, ty)}</b>: <b>${d}</b> move${d === 1 ? '' : 's'}${move.pinned >= 0 ? ' (pinned)' : ''}.`;
      if (keyCells.length) {
        line += `<br>Picks up ${keyCells.length === 1 ? 'a key' : `${keyCells.length} keys`} at ` +
          keyCells.map((i) => { const c = grid.coords(i); return `<b>${cellLabel(c.x, c.y)}</b>`; }).join(', ') +
          ', unlocking its building\'s locked and one-way doors.';
      }
      // Gold rings on the keys this route picks up.
      keyCells.forEach((i, n) => {
        if (n >= keyRings.length) return;
        const c = grid.coords(i);
        keyRings[n].position.copy(cellToWorld(c.x, c.y)).setY(overlayY(i) + 0.008);
        keyRings[n].visible = true;
      });
    }
  }
  if (move.range > 0) line += `<br><b>${reachable}</b> cells reachable within ${move.range} move${move.range === 1 ? '' : 's'}.`;
  moveBars.count = nb;
  moveBars.instanceMatrix.needsUpdate = true;
  $('#moveInfo').innerHTML = line;
}

export function clearMove() {
  move.start = -1;
  move.pinned = -1;
  refreshMoveOverlay();
}

// Click in the Movement tool: set the start, pin/unpin a destination, or
// clear by clicking the start again.
export function moveClick(cell) {
  if (!cell) return;
  const i = grid.index(cell.x, cell.y);
  if (move.start < 0) move.start = i;
  else if (i === move.start) { clearMove(); return; }
  else move.pinned = move.pinned === i ? -1 : i;
  refreshMoveOverlay();
}

export function setEdgeBrush(name) {
  ui.edgeBrush = name;
  $$('[data-edge]').forEach((b) => b.classList.toggle('on', b.dataset.edge === name));
  if (hoverEdge) setHoverEdge(hoverEdge);
}
