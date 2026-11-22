// Painting cells: picking the cell under the pointer and applying the
// current brush (fixed-size landmark brushes paint a whole block).

import * as THREE from 'three';
import { isFlat, rayTerrain } from '../render/terrain.js';
import { footprintOf } from '../core/state.js';
import { BRUSHES, FLOOR_H, TILE, WATER_Y, grid, ui } from '../app/config.js';
import { decks, tiles, water } from '../render/board.js';
import { camera, renderer } from '../render/scene.js';

// Module state: assigned by init() below, in the same order as before the split.
export let raycaster, pointer, boardPlane, waterPlane, activeTouches;

export function __set_painting(v) { painting = v; return v; }

// Run once at startup (called from src/main.js, in order).
export function init() {
  // ---------------------------------------------------------------------------
  // Interaction: painting
  // ---------------------------------------------------------------------------

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y); // { pointerId, start:{x,y}, last:{x,y}, rect:boolean }
  activeTouches = new Set();
}

export let painting = null;

export function pickCell(ev, { clamp = false } = {}) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!isFlat()) {
    // Ground isn't flat: find where the ray meets street level on the terrain.
    const tp = rayTerrain(raycaster.ray, FLOOR_H);
    if (!tp) return null;
    let x = Math.floor(tp.x / TILE + grid.cols / 2);
    let y = Math.floor(tp.z / TILE + grid.rows / 2);
    if (clamp) {
      x = THREE.MathUtils.clamp(x, 0, grid.cols - 1);
      y = THREE.MathUtils.clamp(y, 0, grid.rows - 1);
    }
    return grid.inBounds(x, y) ? { x, y } : null;
  }
  const hit = raycaster.intersectObjects([tiles, decks], false)[0];
  // Water surfaces aren't meshes we can hit, so test their plane too: the
  // cell under the surface is what the eye sees, not the bed below it.
  if (water.mesh.visible) {
    const wp = raycaster.ray.intersectPlane(waterPlane, new THREE.Vector3());
    if (wp && (!hit || raycaster.ray.origin.distanceTo(wp) < hit.distance)) {
      const wx = Math.floor(wp.x / TILE + grid.cols / 2);
      const wy = Math.floor(wp.z / TILE + grid.rows / 2);
      if (grid.isWater(wx, wy)) return { x: wx, y: wy };
    }
  }
  if (hit && hit.instanceId !== undefined) return grid.coords(hit.instanceId);
  // Fallback: intersect the board plane (lets drags continue off the tile tops).
  const p = raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3());
  if (!p) return null;
  let x = Math.floor(p.x / TILE + grid.cols / 2);
  let y = Math.floor(p.z / TILE + grid.rows / 2);
  if (clamp) {
    x = THREE.MathUtils.clamp(x, 0, grid.cols - 1);
    y = THREE.MathUtils.clamp(y, 0, grid.rows - 1);
  }
  return grid.inBounds(x, y) ? { x, y } : null;
}

export const paintAllowed = () => !ui.orbitMode && !ui.spaceHeld;

// What a stroke paints: a cell brush, or (Markers tool) just the marker.
export function currentPatch() {
  if (ui.tool !== 'markers') return BRUSHES[ui.brush];
  if (ui.markerBrush === 'erase') return (c) => (c.marker ? { marker: null } : null);
  return (c) => {
    if (!c.walkable) { if (painting) painting.skipped = true; return null; }
    return { marker: ui.markerBrush };
  };
}

// Fixed-size landmark brushes (the 2x2 Old Clocktower, a 3x4 lumber mill...)
// paint a whole block: the cell under the pointer is its north-west corner.
// Cells already of that landmark are left alone, so dragging lays them side
// by side instead of smearing them.
export function brushFootprint() {
  if (ui.tool === 'markers' || !ui.brush) return null;
  const [area, sub] = ui.brush.split(':');
  const fp = footprintOf(area, sub);
  return Array.isArray(fp) && (fp[0] > 1 || fp[1] > 1) ? { sub, w: fp[0], h: fp[1] } : null;
}
export function applyAt(x, y, patch, opts) {
  const fp = brushFootprint();
  if (!fp) return grid.apply(grid.index(x, y), patch, opts) ? [grid.index(x, y)] : [];
  if (grid.cells[grid.index(x, y)].sub === fp.sub) return [];
  const out = [];
  for (let dy = 0; dy < fp.h; dy++) for (let dx = 0; dx < fp.w; dx++) {
    if (!grid.inBounds(x + dx, y + dy)) continue;
    const i = grid.index(x + dx, y + dy);
    if (grid.apply(i, patch, opts)) out.push(i);
  }
  return out;
}
