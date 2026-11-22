// The Walls & doors tool: drawing walls, doors, windows and locks on cell
// edges, by stroke or rectangle.

import * as THREE from 'three';
import { terrainify, isFlat, rayTerrain } from '../render/terrain.js';
import { FLOOR_H, TILE, WALL_FULL, WALL_LOW, grid, ui } from '../app/config.js';
import { __set_painting, painting, pickCell, pointer, raycaster } from './painting.js';
import { edgeBase } from '../render/board.js';
import { camera, renderer, scene } from '../render/scene.js';

// Module state: assigned by init() below, in the same order as before the split.
export let floorPlane, edgeMarker, canvas;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // --- Walls & doors tool --------------------------------------------------------
  // Edges are drawn along grid lines: the pointer snaps to grid corners and each
  // step between neighbouring corners sets one edge. A click without moving
  // toggles the edge nearest the pointer. Rectangle mode outlines a room.

  floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_H);

  // Highlight for the edge under the pointer.
  edgeMarker = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.85, depthTest: false }),
  );
  edgeMarker.renderOrder = 11;
  terrainify(edgeMarker.material, { none: true });
  edgeMarker.visible = false;
  scene.add(edgeMarker);

  canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// Pointer -> fractional grid coordinates on the floor (0..cols, 0..rows).
export function gridPoint(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const p = isFlat() ? raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3()) : rayTerrain(raycaster.ray, FLOOR_H);
  return p ? { gx: p.x / TILE + grid.cols / 2, gy: p.z / TILE + grid.rows / 2 } : null;
}
export const clampV = (v) => ({
  x: THREE.MathUtils.clamp(Math.round(v.gx), 0, grid.cols),
  y: THREE.MathUtils.clamp(Math.round(v.gy), 0, grid.rows),
});
export function nearestEdge(pt) {
  if (!pt) return null;
  const dv = Math.abs(pt.gx - Math.round(pt.gx));
  const dh = Math.abs(pt.gy - Math.round(pt.gy));
  const e = dv < dh
    ? { o: 'v', x: Math.round(pt.gx), y: Math.floor(pt.gy) }
    : { o: 'h', x: Math.floor(pt.gx), y: Math.round(pt.gy) };
  return grid.edgeInBounds(e.o, e.x, e.y) ? e : null;
}
// The piece the current brush places on edge (o, x, y). One-way doors open
// away from the side the pointer is on: click in the cell people come from.
export const isDoorBrush = () => ['door', 'lockedDoor', 'oneWayDoor'].includes(ui.edgeBrush);
export function edgeType(o, x, y, pt) {
  if (ui.edgeBrush === 'erase') return null;
  if (ui.edgeBrush !== 'oneWayDoor') return ui.edgeBrush;
  const fromLow = pt ? (o === 'v' ? pt.gx < x : pt.gy < y) : true; // pointer in the west/north cell
  return fromLow ? 'oneWayDoor+' : 'oneWayDoor-';
}

// Walk corner to corner, setting the edge for each unit step.
export function drawEdgePath(a, b, pt) {
  let { x, y } = a;
  let any = false;
  while (x !== b.x || y !== b.y) {
    if (Math.abs(b.x - x) >= Math.abs(b.y - y)) {
      const nx = x + Math.sign(b.x - x);
      const ex = Math.min(x, nx);
      any = grid.setEdge('h', ex, y, edgeType('h', ex, y, pt)) || any;
      x = nx;
    } else {
      const ny = y + Math.sign(b.y - y);
      const ey = Math.min(y, ny);
      any = grid.setEdge('v', x, ey, edgeType('v', x, ey, pt)) || any;
      y = ny;
    }
  }
  return any;
}

// Outline the cell rectangle a..b with walls; Erase clears inside it too.
export function edgeRect(a, b) {
  grid.revertStroke();
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const type = edgeType('v', 0, 0, null);
  const opt = { silent: true };
  if (type === null) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1 + 1; x++) grid.setEdge('v', x, y, null, opt);
    for (let y = y0; y <= y1 + 1; y++) for (let x = x0; x <= x1; x++) grid.setEdge('h', x, y, null, opt);
  } else {
    for (let x = x0; x <= x1; x++) { grid.setEdge('h', x, y0, type, opt); grid.setEdge('h', x, y1 + 1, type, opt); }
    for (let y = y0; y <= y1; y++) { grid.setEdge('v', x0, y, type, opt); grid.setEdge('v', x1 + 1, y, type, opt); }
  }
  grid.emit([]);
}
export let hoverEdge = null;

export function setHoverEdge(e) {
  hoverEdge = e;
  edgeMarker.visible = !!e;
  if (!e) return;
  const vertical = e.o === 'v';
  const cx = vertical ? e.x - grid.cols / 2 : e.x - grid.cols / 2 + 0.5;
  const cz = vertical ? e.y - grid.rows / 2 + 0.5 : e.y - grid.rows / 2;
  edgeMarker.position.set(cx, FLOOR_H + edgeBase(e.o, e.x, e.y).base, cz);
  const h = (ui.lowWalls ? WALL_LOW : WALL_FULL) + 0.02;
  edgeMarker.scale.set(vertical ? 0.1 : 1, h, vertical ? 1 : 0.1);
  edgeMarker.material.color.set({
    erase: '#e88a7f', door: '#f0b060', lockedDoor: '#d04a3a', oneWayDoor: '#6fd07a', window: '#9fd0e8',
  }[ui.edgeBrush] ?? '#f1d9a8');
}

export function startEdgeStroke(ev) {
  const pt = gridPoint(ev);
  if (!pt) return;
  canvas.setPointerCapture(ev.pointerId);
  const rect = (ui.shape === 'rect' || ev.shiftKey) && !isDoorBrush();
  __set_painting({ edges: true, pointerId: ev.pointerId, rect, moved: false, click: nearestEdge(pt), startPt: pt });
  grid.beginStroke();
  if (rect) {
    const cell = pickCell(ev, { clamp: true });
    painting.start = painting.last = cell;
    if (cell) edgeRect(cell, cell);
  } else {
    painting.lastV = clampV(pt);
  }
}

export function moveEdgeStroke(ev) {
  if (painting.rect) {
    const cell = pickCell(ev, { clamp: true });
    if (!cell || !painting.start) return;
    if (cell.x === painting.last.x && cell.y === painting.last.y) return;
    painting.last = cell;
    edgeRect(painting.start, cell);
    return;
  }
  const pt = gridPoint(ev);
  if (!pt) return;
  const v = clampV(pt);
  if (v.x === painting.lastV.x && v.y === painting.lastV.y) return;
  if (drawEdgePath(painting.lastV, v, painting.startPt)) painting.moved = true;
  painting.lastV = v;
}

export function endEdgeStroke() {
  // A click (no drag) toggles the single edge under the pointer.
  if (!painting.rect && !painting.moved && painting.click) {
    const { o, x, y } = painting.click;
    // Clicking the same piece again removes it; a one-way door clicked from
    // its other side flips direction.
    const current = grid.edges.get(`${o}${x},${y}`) ?? null;
    const type = edgeType(o, x, y, painting.startPt);
    grid.setEdge(o, x, y, type && current === type ? null : type);
  }
}
