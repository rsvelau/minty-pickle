// Bridge structure: a Pacific Northwest steel through-truss road bridge
// (loosely after Snohomish's Avenue D bridge). Rust-painted Warren trusses on
// both sides with inclined end posts and verticals, overhead struts with
// X lateral bracing, a pale concrete edge girder at deck level, and round
// concrete piers with cap beams standing in the water.
//
// Bridge cells come from the grid (cell.bridge). Connected bridge cells form
// one bridge; it spans along its majority bridgeAxis(). Rectangular bridges
// get a single truss pair across their full width; irregular ones fall back
// to one truss pair per run of cells.
import * as THREE from 'three';
import { m } from './scale.js';


const TRUSS_H = m(6);        // top chord height above the deck
const CHORD = m(0.45);       // chord/end-post section
const WEB = m(0.3);          // diagonal/vertical section
const STRUT = m(0.25);       // overhead bracing section
const GIRDER_H = m(0.9);     // concrete edge girder depth
const PIER_R = m(0.45);      // pier column radius
const RUST = '#93492f';      // weathered rust-red paint
const CONCRETE = '#b8b5aa';  // pale concrete

export function createBridges(group) {
  const unitBox = new THREE.BoxGeometry(1, 1, 1);           // centred
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);   // centred, axis y
  const steel = new THREE.MeshLambertMaterial({ color: RUST, emissive: '#1c0b06' });
  const concrete = new THREE.MeshLambertMaterial({ color: CONCRETE });
  // Faded yellow centre-line dashes, matching the streets.
  const paint = new THREE.MeshLambertMaterial({ color: '#a8893e', emissive: '#2a220c' });
  const meshes = {};
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0);

  function meshFor(name, geo, mat, needed) {
    let mesh = meshes[name];
    if (mesh && mesh.instanceMatrix.count >= needed) return mesh;
    if (mesh) { group.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geo, mat, Math.max(64, Math.ceil(needed * 1.5)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    meshes[name] = mesh;
    group.add(mesh);
    return mesh;
  }

  // update(grid, { visible, deckTop, bedY })
  function update(grid, { visible, deckTop, bedY }) {
    const steelBars = [];   // [ax, ay, az, bx, by, bz, thickness]
    const blocks = [];      // concrete boxes: [cx, cy, cz, sx, sy, sz]
    const dashes = [];      // paint boxes, same layout as blocks
    const columns = [];     // concrete cylinders: [x, yBottom, yTop, z]
    if (visible) {
      for (const bridge of findBridges(grid)) buildBridge(grid, bridge, deckTop, bedY, steelBars, blocks, columns, dashes);
    }

    // Steel members: unit boxes stretched between their end points.
    const bars = meshFor('steel', unitBox, steel, steelBars.length);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    steelBars.forEach(([ax, ay, az, bx, by, bz, t], n) => {
      a.set(ax, ay, az); b.set(bx, by, bz);
      d.subVectors(b, a);
      const len = d.length();
      tmpQ.setFromUnitVectors(X, d.normalize());
      tmpM.compose(a.add(b).multiplyScalar(0.5), tmpQ, tmpS.set(len + t * 0.5, t, t));
      bars.setMatrixAt(n, tmpM);
    });
    bars.count = steelBars.length;

    const boxes = meshFor('concrete', unitBox, concrete, blocks.length);
    blocks.forEach(([cx, cy, cz, sx, sy, sz], n) => {
      tmpM.compose(a.set(cx, cy, cz), tmpQ.identity(), tmpS.set(sx, sy, sz));
      boxes.setMatrixAt(n, tmpM);
    });
    boxes.count = blocks.length;

    const marks = meshFor('paint', unitBox, paint, dashes.length);
    dashes.forEach(([cx, cy, cz, sx, sy, sz], n) => {
      tmpM.compose(a.set(cx, cy, cz), tmpQ.identity(), tmpS.set(sx, sy, sz));
      marks.setMatrixAt(n, tmpM);
    });
    marks.count = dashes.length;

    const cols = meshFor('columns', unitCyl, concrete, columns.length);
    columns.forEach(([x, y0, y1, z], n) => {
      tmpM.compose(a.set(x, (y0 + y1) / 2, z), tmpQ.identity(), tmpS.set(PIER_R, y1 - y0, PIER_R));
      cols.setMatrixAt(n, tmpM);
    });
    cols.count = columns.length;

    for (const k in meshes) {
      meshes[k].instanceMatrix.needsUpdate = true;
      meshes[k].computeBoundingSphere();
    }
  }

  function clear() {
    for (const k in meshes) { group.remove(meshes[k]); meshes[k].dispose(); delete meshes[k]; }
  }

  return { update, clear };
}

// Connected bridge cells -> [{ axis, cells: [{x,y}], minX, maxX, minY, maxY }]
function findBridges(grid) {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const out = [];
  for (let i = 0; i < grid.cells.length; i++) {
    if (seen[i] || !grid.cells[i].bridge) continue;
    const cells = [];
    const queue = [i];
    seen[i] = 1;
    while (queue.length) {
      const j = queue.pop();
      const { x, y } = grid.coords(j);
      cells.push({ x, y });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!grid.inBounds(nx, ny)) continue;
        const k = grid.index(nx, ny);
        if (!seen[k] && grid.cells[k].bridge) { seen[k] = 1; queue.push(k); }
      }
    }
    let votesX = 0;
    for (const c of cells) if (grid.bridgeAxis(c.x, c.y) === 'x') votesX++;
    const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
    out.push({
      axis: votesX * 2 > cells.length ? 'x' : 'y',
      cells,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    });
  }
  return out;
}

function buildBridge(grid, br, deckTop, bedY, steelBars, blocks, columns, dashes) {
  const full = (br.maxX - br.minX + 1) * (br.maxY - br.minY + 1) === br.cells.length;
  // Spans: [alongStart, length, acrossMin, acrossMax] in grid units, along
  // the bridge axis. Rectangles: one span; otherwise one per run of cells.
  const spans = [];
  if (full) {
    spans.push(br.axis === 'x'
      ? [br.minX, br.maxX - br.minX + 1, br.minY, br.maxY + 1]
      : [br.minY, br.maxY - br.minY + 1, br.minX, br.maxX + 1]);
  } else {
    const isB = (x, y) => grid.inBounds(x, y) && grid.cells[grid.index(x, y)].bridge;
    const lines = br.axis === 'x' ? [br.minY, br.maxY] : [br.minX, br.maxX];
    for (let c = lines[0]; c <= lines[1]; c++) {
      let start = null;
      const lo = br.axis === 'x' ? br.minX : br.minY;
      const hi = br.axis === 'x' ? br.maxX : br.maxY;
      for (let s = lo; s <= hi + 1; s++) {
        const on = s <= hi && (br.axis === 'x' ? isB(s, c) : isB(c, s));
        if (on && start === null) start = s;
        if (!on && start !== null) { spans.push([start, s - start, c, c + 1]); start = null; }
      }
    }
  }

  // Grid (along, across) -> world (x, z).
  const toWorld = (along, across) => (br.axis === 'x'
    ? [along - grid.cols / 2, across - grid.rows / 2]
    : [across - grid.cols / 2, along - grid.rows / 2]);
  const bar = (s0, c0, y0, s1, c1, y1, t) => {
    const [ax, az] = toWorld(s0, c0);
    const [bx, bz] = toWorld(s1, c1);
    steelBars.push([ax, y0, az, bx, y1, bz, t]);
  };
  const block = (s0, s1, c0, c1, y0, y1) => {
    const [ax, az] = toWorld(s0, c0);
    const [bx, bz] = toWorld(s1, c1);
    blocks.push([(ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2, Math.abs(bx - ax), y1 - y0, Math.abs(bz - az)]);
  };

  const yb = deckTop + m(0.2);   // bottom chord just above the deck surface
  const yt = deckTop + TRUSS_H;
  const underside = deckTop - GIRDER_H;

  for (const [s0, L, cMin, cMax] of spans) {
    const inset = m(0.35);
    const sides = [cMin + inset, cMax - inset];
    for (const c of sides) {
      // Concrete edge girder along the deck (the pale band in the photo).
      block(s0, s0 + L, c - m(0.35), c + m(0.35), underside, deckTop + m(0.15));
      // Bottom chord, top chord between the end posts.
      bar(s0, c, yb, s0 + L, c, yb, CHORD);
      if (L > 1) bar(s0 + 0.5, c, yt, s0 + L - 0.5, c, yt, CHORD);
      // Warren web: each cell is a triangle; the first and last members
      // are the inclined end posts. Verticals at interior panel points.
      for (let i = 0; i < L; i++) {
        bar(s0 + i, c, yb, s0 + i + 0.5, c, yt, i === 0 ? CHORD : WEB);
        bar(s0 + i + 0.5, c, yt, s0 + i + 1, c, yb, i === L - 1 ? CHORD : WEB);
        if (L > 1 && i > 0 && i < L - 1) bar(s0 + i + 0.5, c, yb, s0 + i + 0.5, c, yt, WEB * 0.8);
      }
    }
    // Centre line down the middle of the roadway: one 3 m dash per cell,
    // in step with the street dashes.
    const mid = (cMin + cMax) / 2;
    for (let i = 0; i < L; i++) {
      const [ax, az] = toWorld(s0 + i + 0.5 - m(1.5), mid - m(0.06));
      const [bx, bz] = toWorld(s0 + i + 0.5 + m(1.5), mid + m(0.06));
      dashes.push([(ax + bx) / 2, deckTop + 0.002, (az + bz) / 2, Math.abs(bx - ax), 0.003, Math.abs(bz - az)]);
    }
    // Overhead: struts at each top panel point, X bracing between them,
    // and a portal strut at each end.
    const [c1, c2] = sides;
    const pts = [];
    for (let i = 0; i < L; i++) pts.push(s0 + i + 0.5);
    for (const s of pts) bar(s, c1, yt, s, c2, yt, STRUT);
    for (let k = 0; k + 1 < pts.length; k++) {
      bar(pts[k], c1, yt, pts[k + 1], c2, yt, STRUT * 0.7);
      bar(pts[k], c2, yt, pts[k + 1], c1, yt, STRUT * 0.7);
    }
    for (const s of [s0 + 0.32, s0 + L - 0.32]) {
      const y = yb + (yt - yb) * 0.64;
      bar(s, c1, y, s, c2, y, STRUT);
    }
    // Piers: a cap beam across the deck with two round columns down to the
    // riverbed, at each end and every two cells in between.
    const pierAt = [s0 + 0.15];
    for (let s = s0 + 2; s < s0 + L - 1; s += 2) pierAt.push(s);
    pierAt.push(s0 + L - 0.15);
    for (const s of pierAt) {
      block(s - m(0.6), s + m(0.6), cMin + 0.05, cMax - 0.05, underside - m(0.8), underside);
      for (const c of [cMin + 0.28, cMax - 0.28]) {
        const [x, z] = toWorld(s, c);
        columns.push([x, bedY, underside - m(0.8), z]);
      }
    }
  }
}
