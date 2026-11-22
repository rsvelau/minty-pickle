// Street surface: a narrow small-town two-lane road with small sidewalks,
// one cell wide (see src/scale.js). Each street cell looks at its four
// neighbours and picks a layout:
//
//   straight   two lanes, dashed centre line, sidewalks on the closed sides
//   corner     curved dashed centre line, outer sidewalks, inner corner square
//   T          through road keeps its centre line; crosswalk across the stem
//   crossing   corner squares and crosswalks on all four approaches
//   dead end   centre line stops; sidewalk wraps the end
//
// A neighbour "connects" if it is a street or a bridge (bridges carry the
// road). A street running straight off the board edge continues off it.
// Paint is faded yellow/white; asphalt is cracked and patched; sidewalks are
// jointed, cracked concrete with moss. Everything is drawn once into an atlas
// (16 layouts x 2 wear variants) and instanced per layout.
//
// Intersections (T and crossing) also get street furniture:
//   stop signs   on the corner to the right of each approach that must stop
//                (all four at a crossing; only the side street at a T),
//                facing oncoming traffic
//   street lamp  an antique cast-iron post with an acorn globe (the town is a
//                late-1800s logging town kept historic); the globe glows when
//                the cell's lamp is switched on ("Lit lamp"), else it's dark
import * as THREE from 'three';
import { flickerize } from './dread.js';
import { METERS_PER_CELL, m, SIDEWALK_W } from '../core/scale.js';
import { streetMask } from '../core/state.js';
import { terrainify } from './terrain.js';
export { streetMask };

const N = 1, E = 2, S = 4, W = 8;
const TILE_PX = 256;
const ATLAS_COLS = 8, ATLAS_ROWS = 4;  // 16 masks x 2 wear variants
const WEARS = 2;
const CURB = m(0.15);                   // sidewalk curb height

const ASPHALT = '#34383b';
const CONCRETE = '#8a8984';
const YELLOW = 'rgba(206, 168, 72, 0.8)';
const WHITE = 'rgba(206, 204, 194, 0.7)';

export function createStreets(group) {
  const atlas = buildAtlas();
  // One material per light level: unlit, lamp spill (diagonal, side), Lit,
  // and the lamp cell itself (warm and bright).
  const LEVELS = [
    { e: null },
    { e: '#3a3326' },
    { e: '#5e523a' },
    { e: '#a39d8c' },
    { e: '#d8b77c' },
  ];
  const mats = LEVELS.map(({ e }) => (e
    ? new THREE.MeshLambertMaterial({ map: atlas, emissiveMap: atlas, emissive: new THREE.Color(e) })
    : new THREE.MeshLambertMaterial({ map: atlas })));
  for (const mat of mats) terrainify(mat, { centre: true });
  for (const mat of mats.slice(1)) flickerize(mat, { part: 'emissive' }); // lit street surfaces flicker at midnight
  const levelIndex = (level, lamp) => (lamp ? 4 : level >= 0.8 ? 3 : level >= 0.45 ? 2 : level > 0 ? 1 : 0);
  const geos = new Map();
  const meshes = new Map();
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();

  function geometryFor(mask, wear) {
    const k = `${mask}:${wear}`;
    if (!geos.has(k)) geos.set(k, buildGeometry(mask, wear));
    return geos.get(k);
  }

  function meshFor(key, mask, wear, lvl, needed) {
    let mesh = meshes.get(key);
    if (mesh && mesh.instanceMatrix.count >= needed) return mesh;
    if (mesh) { group.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geometryFor(mask, wear), mats[lvl], Math.max(16, Math.ceil(needed * 1.5)));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.raycast = () => {};
    meshes.set(key, mesh);
    group.add(mesh);
    return mesh;
  }

  const furniture = createFurniture(group);

  // ctx: { visible, cellToWorld(x, y), surfaceY }
  function update(grid, { visible, cellToWorld, surfaceY, lightLevels, lampsOn }) {
    const buckets = new Map(); // key -> { mask, wear, lit, positions[] }
    const items = [];          // street furniture: [kind, x, y, z, rotY]
    if (visible) {
      grid.cells.forEach((c, i) => {
        // Start spaces are drawn as street (the van is a prop on top).
        if (c.sub !== 'street' && c.sub !== 'start') return;
        const { x, y } = grid.coords(i);
        const mask = streetMask(grid, x, y);
        const lamp = !!lampsOn?.[i];
        if (c.sub === 'street') placeFurniture(items, mask, cellToWorld(x, y), surfaceY + CURB, lamp, x * 31 + y * 17);
        const wear = ((x * 73856093) ^ (y * 19349663)) >>> 0 & 1;
        const lvl = levelIndex(lightLevels?.[i] ?? 0, lamp);
        const key = `${mask}:${wear}:${lvl}`;
        if (!buckets.has(key)) buckets.set(key, { positions: [] });
        buckets.get(key).positions.push(cellToWorld(x, y));
      });
    }
    for (const key of new Set([...meshes.keys(), ...buckets.keys()])) {
      const b = buckets.get(key);
      const [mask, wear, lvl] = key.split(':').map(Number);
      const list = b?.positions ?? [];
      const mesh = meshFor(key, mask, wear, lvl, list.length);
      list.forEach((p, n) => {
        tmpM.makeTranslation(tmpP.set(p.x, surfaceY, p.z));
        mesh.setMatrixAt(n, tmpM);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    furniture.update(items);
  }

  function clear() {
    for (const mesh of meshes.values()) { group.remove(mesh); mesh.dispose(); }
    meshes.clear();
    furniture.clear();
  }

  return { update, clear };
}

// --- geometry ------------------------------------------------------------------

// Asphalt slab over the whole cell plus raised sidewalk slabs, with planar
// UVs into this layout's atlas tile.
function buildGeometry(mask, wear) {
  const { sidewalks } = layout(mask);
  const parts = [boxGeo(0, 0, 1, 1, -0.006, 0)];
  for (const [u0, v0, u1, v1] of sidewalks) parts.push(boxGeo(u0, v0, u1, v1, 0, CURB));
  const geo = mergeBoxes(parts);
  const tile = mask + wear * 16;
  const tx = tile % ATLAS_COLS, ty = Math.floor(tile / ATLAS_COLS);
  const inset = 2 / TILE_PX;
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const u = THREE.MathUtils.clamp(pos.getX(i) + 0.5, 0, 1);
    const v = THREE.MathUtils.clamp(pos.getZ(i) + 0.5, 0, 1);
    uv[i * 2] = (tx + inset + u * (1 - 2 * inset)) / ATLAS_COLS;
    uv[i * 2 + 1] = (ty + inset + v * (1 - 2 * inset)) / ATLAS_ROWS;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// Box over cell-local rect (u, v in 0..1, v = 0 is north) from y0 to y1.
function boxGeo(u0, v0, u1, v1, y0, y1) {
  const g = new THREE.BoxGeometry(u1 - u0, Math.max(y1 - y0, 0.002), v1 - v0);
  g.translate((u0 + u1) / 2 - 0.5, (y0 + y1) / 2, (v0 + v1) / 2 - 0.5);
  return g.toNonIndexed();
}
function mergeBoxes(list) {
  const total = list.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}

// --- layout --------------------------------------------------------------------

// Sidewalk rects (cell units) and the kind of junction for a mask.
function layout(mask) {
  const sw = SIDEWALK_W / METERS_PER_CELL;
  const open = (bit) => (mask & bit) !== 0;
  const count = [N, E, S, W].filter(open).length;
  // An isolated cell draws as an east-west stretch.
  const eff = count === 0 ? E | W : mask;
  const o = (bit) => (eff & bit) !== 0;
  const sidewalks = [];
  if (!o(N)) sidewalks.push([0, 0, 1, sw]);
  if (!o(S)) sidewalks.push([0, 1 - sw, 1, 1]);
  if (!o(W)) sidewalks.push([0, o(N) ? 0 : sw, sw, o(S) ? 1 : 1 - sw]);
  if (!o(E)) sidewalks.push([1 - sw, o(N) ? 0 : sw, 1, o(S) ? 1 : 1 - sw]);
  // Corner squares where both sides of a corner are open.
  if (o(N) && o(W)) sidewalks.push([0, 0, sw, sw]);
  if (o(N) && o(E)) sidewalks.push([1 - sw, 0, 1, sw]);
  if (o(S) && o(W)) sidewalks.push([0, 1 - sw, sw, 1]);
  if (o(S) && o(E)) sidewalks.push([1 - sw, 1 - sw, 1, 1]);
  return { sidewalks, eff, count: count === 0 ? 2 : count };
}

// --- atlas painting ------------------------------------------------------------

function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX * ATLAS_COLS;
  canvas.height = TILE_PX * ATLAS_ROWS;
  const g = canvas.getContext('2d');
  for (let wear = 0; wear < WEARS; wear++) {
    for (let mask = 0; mask < 16; mask++) {
      const tile = mask + wear * 16;
      g.save();
      g.translate((tile % ATLAS_COLS) * TILE_PX, Math.floor(tile / ATLAS_COLS) * TILE_PX);
      g.beginPath();
      g.rect(0, 0, TILE_PX, TILE_PX);
      g.clip();
      paintTile(g, mask, rng(mask * 977 + wear * 7919 + 13));
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 8;
  return tex;
}

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const PX = TILE_PX / METERS_PER_CELL; // pixels per metre

function paintTile(g, mask, r) {
  const { sidewalks, eff } = layout(mask);
  const T = TILE_PX;

  // Asphalt: base, grain, patches, stains, cracks.
  g.fillStyle = ASPHALT;
  g.fillRect(0, 0, T, T);
  for (let i = 0; i < 2200; i++) {
    const v = 40 + Math.floor(r() * 30);
    g.fillStyle = `rgba(${v},${v + 3},${v + 6},${0.25 + r() * 0.3})`;
    g.fillRect(r() * T, r() * T, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  for (let i = 0; i < 2; i++) {
    const w = (1 + r() * 2) * PX, h = (0.8 + r() * 1.6) * PX;
    g.fillStyle = r() < 0.5 ? 'rgba(28,31,33,0.55)' : 'rgba(70,72,72,0.35)';
    g.fillRect(r() * (T - w), r() * (T - h), w, h);
  }
  for (let i = 0; i < 2; i++) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, (0.4 + r() * 0.5) * PX);
    gr.addColorStop(0, 'rgba(15,16,18,0.5)');
    gr.addColorStop(1, 'rgba(15,16,18,0)');
    g.save();
    g.translate(T * (0.3 + r() * 0.4), T * (0.3 + r() * 0.4));
    g.scale(1.6, 1);
    g.fillStyle = gr;
    g.fillRect(-PX, -PX, 2 * PX, 2 * PX);
    g.restore();
  }
  crack(g, r, 3 + Math.floor(r() * 3), 'rgba(18,20,22,0.85)', T);

  // Paint on its own layer so it can be worn away.
  const paint = document.createElement('canvas');
  paint.width = paint.height = T;
  const p = paint.getContext('2d');
  paintMarkings(p, eff, mask);
  p.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++) {
    p.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
    p.beginPath();
    p.arc(r() * T, r() * T, 0.5 + r() * 2.2, 0, Math.PI * 2);
    p.fill();
  }
  g.drawImage(paint, 0, 0);

  // Sidewalks: concrete slabs with joints, cracks, moss and a curb edge.
  for (const [u0, v0, u1, v1] of sidewalks) {
    const x = u0 * T, y = v0 * T, w = (u1 - u0) * T, h = (v1 - v0) * T;
    g.fillStyle = CONCRETE;
    g.fillRect(x, y, w, h);
    for (let i = 0; i < w * h / 6; i++) {
      const v = 120 + Math.floor(r() * 30);
      g.fillStyle = `rgba(${v},${v},${v - 6},${0.25 + r() * 0.3})`;
      g.fillRect(x + r() * w, y + r() * h, 1.5, 1.5);
    }
    // Expansion joints every 1.5 m along the long side.
    g.strokeStyle = 'rgba(60,62,58,0.7)';
    g.lineWidth = 1.2;
    const long = w >= h;
    const step = 1.5 * PX;
    for (let t = step; t < (long ? w : h) - 2; t += step) {
      g.beginPath();
      if (long) { g.moveTo(x + t, y); g.lineTo(x + t, y + h); } else { g.moveTo(x, y + t); g.lineTo(x + w, y + t); }
      g.stroke();
    }
    // Moss and grime creeping in from the joints and edges.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${70 + r() * 20},${90 + r() * 25},${55 + r() * 15},${0.15 + r() * 0.25})`;
      g.beginPath();
      g.arc(x + r() * w, y + r() * h, 1 + r() * 3, 0, Math.PI * 2);
      g.fill();
    }
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    crack(g, r, 1 + Math.floor(r() * 2), 'rgba(55,56,52,0.8)', T, [x, y, w, h]);
    g.restore();
    g.strokeStyle = 'rgba(160,158,150,0.6)';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  // Faint cell outline so streets can still be counted in squares.
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, T - 2, T - 2);
}

function paintMarkings(p, eff, rawMask) {
  const T = TILE_PX;
  const o = (bit) => (eff & bit) !== 0;
  const opens = [N, E, S, W].filter(o);
  const count = opens.length;
  const lineW = 0.12 * PX;
  const dash = [3 * PX, 4 * PX];  // 3 m dashes, 4 m gaps: one dash per cell
  const centre = T / 2;
  p.lineCap = 'butt';

  const dashedLine = (x0, y0, x1, y1, offset = -2 * PX) => {
    p.strokeStyle = YELLOW;
    p.lineWidth = lineW;
    p.setLineDash(dash);
    p.lineDashOffset = offset;
    p.beginPath();
    p.moveTo(x0, y0);
    p.lineTo(x1, y1);
    p.stroke();
    p.setLineDash([]);
  };
  const crosswalk = (side) => {
    // Zebra bars in the 1 m band at this edge, between the corner squares.
    const sw = SIDEWALK_W * PX;
    p.fillStyle = WHITE;
    const bar = 0.4 * PX, gap = 0.45 * PX;
    for (let t = sw + gap / 2; t + bar <= T - sw; t += bar + gap) {
      if (side === N) p.fillRect(t, 0.1 * PX, bar, sw - 0.2 * PX);
      if (side === S) p.fillRect(t, T - sw + 0.1 * PX, bar, sw - 0.2 * PX);
      if (side === W) p.fillRect(0.1 * PX, t, sw - 0.2 * PX, bar);
      if (side === E) p.fillRect(T - sw + 0.1 * PX, t, sw - 0.2 * PX, bar);
    }
  };

  if (count === 2 && ((o(N) && o(S)) || (o(E) && o(W)))) {
    // Straight run.
    if (o(N)) dashedLine(centre, 0, centre, T);
    else dashedLine(0, centre, T, centre);
  } else if (count === 1 && rawMask !== 0) {
    // Dead end: the line comes in from the open side and stops.
    const end = T - 1.5 * PX;
    if (o(N)) dashedLine(centre, 0, centre, end);
    if (o(S)) dashedLine(centre, T, centre, T - end);
    if (o(W)) dashedLine(0, centre, end, centre);
    if (o(E)) dashedLine(T, centre, T - end, centre);
  } else if (count === 2) {
    // Corner: a quarter arc around the inner corner (the tile clips the
    // rest of the circle), joining the centre lines of the two open sides.
    const cx = o(E) ? T : 0;
    const cy = o(S) ? T : 0;
    p.strokeStyle = YELLOW;
    p.lineWidth = lineW;
    p.setLineDash(dash);
    p.lineDashOffset = -2 * PX;
    p.beginPath();
    p.arc(cx, cy, centre, 0, Math.PI * 2);
    p.stroke();
    p.setLineDash([]);
  } else if (count === 3) {
    // T: the through road keeps its centre line; crosswalk across the stem.
    const stem = [N, E, S, W].find((b) => o(b) && !o(opposite(b)));
    if (o(N) && o(S)) dashedLine(centre, 0, centre, T);
    else dashedLine(0, centre, T, centre);
    crosswalk(stem);
  } else if (count === 4) {
    for (const side of [N, E, S, W]) crosswalk(side);
  }
}

const opposite = (b) => ({ [N]: S, [S]: N, [E]: W, [W]: E }[b]);

// Random-walk cracks.
function crack(g, r, n, colour, T, rect = [0, 0, T, T]) {
  const [x0, y0, w, h] = rect;
  g.strokeStyle = colour;
  for (let k = 0; k < n; k++) {
    let x = x0 + r() * w, y = y0 + r() * h;
    let a = r() * Math.PI * 2;
    g.lineWidth = 0.8 + r() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 6 + Math.floor(r() * 10);
    for (let i = 0; i < steps; i++) {
      a += (r() - 0.5) * 1.2;
      x += Math.cos(a) * (3 + r() * 6);
      y += Math.sin(a) * (3 + r() * 6);
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

// --- street furniture --------------------------------------------------------

const SW = SIDEWALK_W / METERS_PER_CELL;
const CORNER = 0.5 - SW / 2; // centre of a corner sidewalk square (cell units)

// Unit vector (x, z) pointing from the cell centre toward each side.
const DIR = { [N]: [0, -1], [E]: [1, 0], [S]: [0, 1], [W]: [-1, 0] };
// Rotation that turns a +z-facing prop to face a side.
const FACE = { [N]: Math.PI, [S]: 0, [E]: Math.PI / 2, [W]: -Math.PI / 2 };
// Traffic keeps right: a car arriving from side d stops at this corner.
const RIGHT_CORNER = { [N]: [-1, -1], [E]: [1, -1], [S]: [1, 1], [W]: [-1, 1] };

function placeFurniture(items, mask, centre, y, lit, hash) {
  const open = [N, E, S, W].filter((b) => mask & b);
  if (open.length < 3) return;
  const stops = open.length === 4 ? open : open.filter((b) => !(mask & opposite(b))); // T: the stem only
  for (const d of stops) {
    const [cx, cz] = RIGHT_CORNER[d];
    const [dx, dz] = DIR[d];
    // On the corner square, nudged back toward the approach.
    const px = centre.x + cx * CORNER + dx * 0.02;
    const pz = centre.z + cz * CORNER + dz * 0.02;
    items.push(['stopSign', px, y, pz, FACE[d]]);
  }
  // Street lamp: at a T, mid-sidewalk opposite the stem; at a crossing, on a
  // corner square (varies per junction), at the curb side of the sidewalk.
  let lx, lz;
  if (open.length === 3) {
    const closed = [N, E, S, W].find((b) => !(mask & b));
    [lx, lz] = DIR[closed].map((v) => v * (CORNER - SW * 0.15));
  } else {
    const corners = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    [lx, lz] = corners[hash % 4].map((v) => v * (CORNER - SW * 0.1));
  }
  const rot = (hash % 8) * (Math.PI / 4); // ladder bar direction varies
  items.push(['lampPost', centre.x + lx, y, centre.z + lz, rot]);
  items.push([lit ? 'globeOn' : 'globeOff', centre.x + lx, y, centre.z + lz, rot]);
  if (lit) items.push(['lampHalo', centre.x + lx, y, centre.z + lz, rot]);
}

function createFurniture(group) {
  const kinds = furnitureKinds();
  const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mats = {
    stopSign: vcMat,
    lampPost: vcMat,
    globeOn: new THREE.MeshBasicMaterial({ color: '#ffe2a6' }),        // warm incandescent glass
    globeOff: new THREE.MeshLambertMaterial({ color: '#3d4441', transparent: true, opacity: 0.85 }), // dark glass
    // Soft glow round a lit lamp so it reads from above too.
    lampHalo: new THREE.MeshBasicMaterial({
      color: '#ffc370', transparent: true, opacity: 0.15, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  };
  terrainify(vcMat, { instance: true }); // posts stand upright on slopes
  flickerize(mats.globeOn);
  flickerize(mats.lampHalo);
  const meshes = {};
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpP = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const UP = new THREE.Vector3(0, 1, 0);

  function meshFor(kind, needed) {
    let mesh = meshes[kind];
    if (mesh && mesh.instanceMatrix.count >= needed) return mesh;
    if (mesh) { group.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(kinds[kind], mats[kind], Math.max(16, Math.ceil(needed * 1.5)));
    mesh.castShadow = kind !== 'globeOn' && kind !== 'lampHalo';
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    meshes[kind] = mesh;
    group.add(mesh);
    return mesh;
  }

  function update(items) {
    const byKind = {};
    for (const it of items) (byKind[it[0]] ??= []).push(it);
    for (const kind of Object.keys(kinds)) {
      const list = byKind[kind] ?? [];
      const mesh = meshFor(kind, list.length);
      list.forEach(([, x, y, z, rot], n) => {
        tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromAxisAngle(UP, rot), one);
        mesh.setMatrixAt(n, tmpM);
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  function clear() {
    for (const k in meshes) { group.remove(meshes[k]); meshes[k].dispose(); delete meshes[k]; }
  }

  return { update, clear };
}

// Geometry in metres (via m()), base at y = 0.
function furnitureKinds() {
  const paint = (geo, hex) => {
    geo = geo.index ? geo.toNonIndexed() : geo;
    geo.deleteAttribute('uv');
    const c = new THREE.Color(hex);
    const arr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) arr.set([c.r, c.g, c.b], i);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };
  const merge = (parts) => {
    const geo = mergeBoxes(parts);
    const total = parts.reduce((n, g) => n + g.attributes.position.count, 0);
    const col = new Float32Array(total * 3);
    let o = 0;
    for (const g of parts) { col.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  // Octagonal sign plate facing +z, centred at (0, y).
  const octagon = (r, t, y, z, hex) => paint(
    new THREE.CylinderGeometry(r, r, t, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, y, z), hex);

  // Antique cast-iron street lamp (late-1800s style, kept by the historic
  // town): octagonal plinth, flared base, fluted shaft with collars, a ladder
  // bar, and an acorn globe under a cap with a finial. ~4.4 m tall.
  const IRON = '#1f2c25';        // old dark-green paint over cast iron
  const IRON_HI = '#2e3e34';
  const GLOBE_Y = m(3.78);
  const globe = () => new THREE.SphereGeometry(m(0.24), 16, 12).scale(1, 1.45, 1).translate(0, GLOBE_Y, 0);
  const ring = (r, h, y) => paint(new THREE.CylinderGeometry(r, r, m(h), 16).translate(0, y, 0), IRON_HI);
  return {
    // Faded red octagon (~0.75 m) with a white border on a 2.1 m galvanized post.
    stopSign: merge([
      paint(new THREE.CylinderGeometry(m(0.035), m(0.035), m(2.1), 6).translate(0, m(1.05), 0), '#8a8d90'),
      octagon(m(0.39), m(0.02), m(2.05), m(0.04), '#d3cfc4'),
      octagon(m(0.34), m(0.03), m(2.05), m(0.05), '#9a2b25'),
      // a pale bar standing in for the STOP lettering
      paint(new THREE.BoxGeometry(m(0.42), m(0.1), m(0.01)).translate(0, m(2.05), m(0.072)), '#cfc9bd'),
    ]),
    lampPost: merge([
      paint(new THREE.CylinderGeometry(m(0.28), m(0.32), m(0.22), 8).translate(0, m(0.11), 0), IRON),     // plinth
      paint(new THREE.CylinderGeometry(m(0.13), m(0.25), m(0.55), 8).translate(0, m(0.22) + m(0.275), 0), IRON), // flared base
      ring(m(0.15), 0.08, m(0.8)),
      paint(new THREE.CylinderGeometry(m(0.07), m(0.095), m(2.5), 12).translate(0, m(0.84) + m(1.25), 0), IRON), // fluted shaft
      ring(m(0.11), 0.07, m(1.6)),
      ring(m(0.12), 0.1, m(3.32)),
      // Ladder bar with ball ends, for the lamplighter's ladder.
      paint(new THREE.BoxGeometry(m(0.8), m(0.05), m(0.05)).translate(0, m(3.05), 0), IRON),
      paint(new THREE.SphereGeometry(m(0.045), 8, 6).translate(m(0.42), m(3.05), 0), IRON_HI),
      paint(new THREE.SphereGeometry(m(0.045), 8, 6).translate(-m(0.42), m(3.05), 0), IRON_HI),
      // Fitter holding the globe.
      paint(new THREE.CylinderGeometry(m(0.13), m(0.09), m(0.16), 12).translate(0, m(3.45), 0), IRON),
      // Cap over the globe, and a finial.
      paint(new THREE.ConeGeometry(m(0.2), m(0.22), 12).translate(0, m(4.2), 0), IRON),
      ring(m(0.21), 0.04, m(4.09)),
      paint(new THREE.SphereGeometry(m(0.045), 8, 6).translate(0, m(4.34), 0), IRON_HI),
      paint(new THREE.ConeGeometry(m(0.025), m(0.12), 6).translate(0, m(4.44), 0), IRON_HI),
    ]),
    // The acorn globe: glowing or dark.
    globeOn: globe(),
    globeOff: globe(),
    lampHalo: new THREE.SphereGeometry(m(0.75), 14, 10).translate(0, GLOBE_Y, 0),
  };
}
