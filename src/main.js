import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GridState, COLS, ROWS, colLabel, cellLabel, defaultCell } from './state.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'minty-pickle.grid.v1';
const TILE = 1;               // world units per cell
const INSET = 0.94;           // tile size inside its cell (gap = grid lines)
const FLOOR_H = 0.06;         // walkable tile thickness
const BLOCK_H = 0.75;         // unwalkable cells are raised blocks

// Night-time PNW palette. "Lit" outdoor reads as old mercury-vapor streetlight
// (sickly green-white); lit indoor reads as warm incandescent.
const PALETTE = {
  outdoor: { unlit: '#4a6158', lit: '#9fbf8f' },
  indoor: { unlit: '#7a5338', lit: '#f0a85a' },
  blockedShade: 0.8,
  glowOutdoor: '#c6e0c0',
  glowIndoor: '#ffbe73',
  // single-layer views
  areaOutdoor: '#34574c',
  areaIndoor: '#8a5a36',
  lightOff: '#2a3036',
  lightOn: '#f3cf7a',
  walkOk: '#4c5654',
  walkNo: '#a2392f',
};

const BRUSHES = {
  outdoor: { indoor: false },
  indoor: { indoor: true },
  unlit: { lit: false },
  lit: { lit: true },
  walkable: { walkable: true },
  blocked: { walkable: false },
  reset: defaultCell(),
};
const BRUSH_KEYS = { 1: 'outdoor', 2: 'indoor', 3: 'unlit', 4: 'lit', 5: 'walkable', 6: 'blocked', 0: 'reset' };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const grid = new GridState(COLS, ROWS);
const ui = {
  brush: 'indoor',
  shape: 'brush',      // 'brush' | 'rect'
  view: 'all',         // 'all' | 'area' | 'light' | 'walk'
  orbitMode: false,    // toggle: left-drag orbits
  spaceHeld: false,
  labels: true,
  atmosphere: true,
};

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) grid.parse(JSON.parse(saved)).forEach((c, i) => Object.assign(grid.cells[i], c));
} catch { /* storage unavailable or corrupt: start fresh */ }

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = new THREE.Color('#070a10');
scene.background = SKY;
const FOG = new THREE.Fog(SKY, 38, 95);
scene.fog = FOG;

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 6;
controls.maxDistance = 90;
controls.screenSpacePanning = false;
applyControlBindings();

const CAMERAS = {
  angled: { pos: new THREE.Vector3(0, 27, 29), target: new THREE.Vector3(0, 0, 1) },
  top: { pos: new THREE.Vector3(0, 42, 0.001), target: new THREE.Vector3(0, 0, 0) },
};
let camTween = null;
// Pull a preset camera back far enough that the whole board fits the
// viewport (portrait phones need much more distance), and push fog back too.
function fitPreset(name) {
  const c = CAMERAS[name];
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const needW = (COLS * TILE / 2 + 1.5) / (Math.tan(halfFov) * camera.aspect);
  const base = c.pos.distanceTo(c.target);
  const dist = Math.max(base, needW * (name === 'top' ? 1 : 1.15));
  const pos = c.pos.clone().sub(c.target).setLength(dist).add(c.target);
  FOG.near = Math.max(38, dist + 6);
  FOG.far = FOG.near + 57;
  controls.maxDistance = Math.max(90, dist * 1.5);
  return { pos, target: c.target };
}
function setCamera(name, instant = false) {
  const c = fitPreset(name);
  if (instant) {
    camera.position.copy(c.pos);
    controls.target.copy(c.target);
    controls.update();
    return;
  }
  camTween = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: c.pos.clone(),
    toTarget: c.target.clone(),
  };
}
setCamera(window.innerWidth < window.innerHeight ? 'top' : 'angled', true);

// Lighting: dim cool moonlight + sky/ground fill.
scene.add(new THREE.HemisphereLight('#56627a', '#181a18', 2.4));
const moon = new THREE.DirectionalLight('#a9bcff', 1.8);
moon.position.set(-18, 30, -14);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 90 });
moon.shadow.bias = -0.0008;
scene.add(moon);

// ---------------------------------------------------------------------------
// Board base + surroundings
// ---------------------------------------------------------------------------

const cellToWorld = (x, y) => new THREE.Vector3(
  (x - COLS / 2 + 0.5) * TILE, 0, (y - ROWS / 2 + 0.5) * TILE,
);

// Dark slab under the tiles; the gaps between tiles read as grid lines.
const slab = new THREE.Mesh(
  new THREE.BoxGeometry(COLS * TILE + 0.4, 0.3, ROWS * TILE + 0.4),
  new THREE.MeshLambertMaterial({ color: '#07090b' }),
);
slab.position.y = -0.15;
slab.receiveShadow = true;
scene.add(slab);

// Forest floor stretching into the fog.
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(160, 48),
  new THREE.MeshLambertMaterial({ color: '#0b100e' }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.3;
ground.receiveShadow = true;
scene.add(ground);

// ---------------------------------------------------------------------------
// Tiles: one instanced mesh, per-instance color + per-instance "glow" (lit)
// ---------------------------------------------------------------------------

const N = COLS * ROWS;
const tileGeo = new THREE.BoxGeometry(INSET * TILE, 1, INSET * TILE);
tileGeo.translate(0, 0.5, 0); // origin at the bottom so Y-scale = height
const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
tileGeo.setAttribute('aGlow', glowAttr);

const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
tileMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
  // Lit cells emit their own colour so they stay bright regardless of moonlight.
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlow;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
};

const tiles = new THREE.InstancedMesh(tileGeo, tileMat, N);
tiles.castShadow = true;
tiles.receiveShadow = true;
tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(tiles);

// Soft light pools that spill past lit cells onto their neighbours.
const glowTex = makeRadialTexture();
const poolMat = new THREE.MeshBasicMaterial({
  map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2,
});
const poolGeo = new THREE.PlaneGeometry(2.6 * TILE, 2.6 * TILE).rotateX(-Math.PI / 2);
const pools = new THREE.InstancedMesh(poolGeo, poolMat, N);
pools.raycast = () => {};
pools.renderOrder = 2;
scene.add(pools);

// Per-cell animated height so changes feel tactile.
const heights = new Float32Array(N);
const targetHeights = new Float32Array(N);
const jitter = new Float32Array(N); // stable per-cell colour variation
{
  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) jitter[i] = (rand() - 0.5) * 0.12;
}

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const ZERO = new THREE.Vector3(0, 0, 0);

function cellLook(cell) {
  // Returns { color: hex, glow: number, height: number, pool: hexOrNull }
  const blocked = !cell.walkable;
  switch (ui.view) {
    case 'area':
      return { color: cell.indoor ? PALETTE.areaIndoor : PALETTE.areaOutdoor, glow: 0.15, height: FLOOR_H, pool: null };
    case 'light':
      return { color: cell.lit ? PALETTE.lightOn : PALETTE.lightOff, glow: cell.lit ? 0.45 : 0, height: FLOOR_H, pool: null };
    case 'walk':
      return { color: blocked ? PALETTE.walkNo : PALETTE.walkOk, glow: 0.2, height: blocked ? BLOCK_H : FLOOR_H, pool: null };
    default: {
      const set = cell.indoor ? PALETTE.indoor : PALETTE.outdoor;
      return {
        color: cell.lit ? set.lit : set.unlit,
        glow: cell.lit ? 0.18 : 0,
        height: blocked ? BLOCK_H : FLOOR_H,
        pool: cell.lit ? (cell.indoor ? PALETTE.glowIndoor : PALETTE.glowOutdoor) : null,
        shade: blocked ? PALETTE.blockedShade : 1,
      };
    }
  }
}

function refreshCell(i) {
  const look = cellLook(grid.cells[i]);
  tmpColor.set(look.color);
  tmpColor.offsetHSL(0, 0, jitter[i] * (ui.view === 'all' ? 0.18 : 0.06));
  if (look.shade) tmpColor.multiplyScalar(look.shade);
  tiles.setColorAt(i, tmpColor);
  glowAttr.array[i] = look.glow;
  targetHeights[i] = look.height;

  const { x, y } = grid.coords(i);
  if (look.pool) {
    tmpPos.copy(cellToWorld(x, y)).setY(FLOOR_H + 0.012);
    tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale.set(1, 1, 1));
    pools.setColorAt(i, tmpColor.set(look.pool));
  } else {
    tmpMatrix.compose(ZERO, tmpQuat.identity(), tmpScale.set(0, 0, 0));
    pools.setColorAt(i, tmpColor.set(0x000000));
  }
  pools.setMatrixAt(i, tmpMatrix);
}

function writeTileMatrix(i) {
  const { x, y } = grid.coords(i);
  tmpPos.copy(cellToWorld(x, y));
  tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale.set(1, Math.max(heights[i], 0.001), 1));
  tiles.setMatrixAt(i, tmpMatrix);
}

function refreshAll(instant = false) {
  for (let i = 0; i < N; i++) refreshCell(i);
  if (instant) heights.set(targetHeights);
  for (let i = 0; i < N; i++) writeTileMatrix(i);
  flagDirty();
}

function flagDirty() {
  tiles.instanceMatrix.needsUpdate = true;
  tiles.instanceColor.needsUpdate = true;
  glowAttr.needsUpdate = true;
  pools.instanceMatrix.needsUpdate = true;
  pools.instanceColor.needsUpdate = true;
  tiles.computeBoundingSphere();
}

refreshAll(true);
tiles.computeBoundingBox();

grid.onChange((indices) => {
  for (const i of indices) refreshCell(i);
  flagDirty();
  updateCounts();
  updateHoverInfo();
  scheduleSave();
});

// Hover outline
const hoverBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, 1, TILE).translate(0, 0.5, 0)),
  new THREE.LineBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.9, depthTest: false }),
);
hoverBox.renderOrder = 10;
hoverBox.visible = false;
scene.add(hoverBox);

// ---------------------------------------------------------------------------
// Coordinate labels (A..T across, 1..26 down)
// ---------------------------------------------------------------------------

const labelGroup = new THREE.Group();
scene.add(labelGroup);
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '600 64px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#8f9f9a';
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
  );
  return m;
}
for (let x = 0; x < COLS; x++) {
  for (const zEdge of [-1, ROWS]) {
    const m = makeLabel(colLabel(x));
    m.position.copy(cellToWorld(x, zEdge)).setY(0.01);
    labelGroup.add(m);
  }
}
for (let y = 0; y < ROWS; y++) {
  for (const xEdge of [-1, COLS]) {
    const m = makeLabel(String(y + 1));
    m.position.copy(cellToWorld(xEdge, y)).setY(0.01);
    labelGroup.add(m);
  }
}

// ---------------------------------------------------------------------------
// Atmosphere: fir silhouettes in the fog, drizzle, faint drifting mist
// ---------------------------------------------------------------------------

const atmos = new THREE.Group();
scene.add(atmos);
{
  let seed = 90210;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const firMat = new THREE.MeshLambertMaterial({ color: '#0c1814' });
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#150f0b' });
  const tiers = [
    new THREE.ConeGeometry(1.6, 3.2, 7).translate(0, 3.0, 0),
    new THREE.ConeGeometry(1.25, 2.8, 7).translate(0, 4.6, 0),
    new THREE.ConeGeometry(0.85, 2.4, 7).translate(0, 6.1, 0),
  ];
  const trunk = new THREE.CylinderGeometry(0.18, 0.25, 1.8, 6).translate(0, 0.9, 0);
  const halfW = (COLS * TILE) / 2 + 3;
  const halfD = (ROWS * TILE) / 2 + 3;
  let placed = 0;
  while (placed < 140) {
    const px = (rand() - 0.5) * 140;
    const pz = (rand() - 0.5) * 140;
    if (Math.abs(px) < halfW && Math.abs(pz) < halfD) continue;
    const tree = new THREE.Group();
    tree.add(new THREE.Mesh(trunk, trunkMat));
    for (const t of tiers) {
      const m = new THREE.Mesh(t, firMat);
      m.castShadow = true;
      tree.add(m);
    }
    const s = 0.8 + rand() * 1.4;
    tree.scale.set(s, s * (0.9 + rand() * 0.6), s);
    tree.rotation.y = rand() * Math.PI;
    tree.position.set(px, -0.3, pz);
    atmos.add(tree);
    placed++;
  }
}

const RAIN_COUNT = 1800;
const RAIN_BOX = { x: 70, y: 40, z: 70 };
const rainPos = new Float32Array(RAIN_COUNT * 6);
const rainSpeed = new Float32Array(RAIN_COUNT);
for (let i = 0; i < RAIN_COUNT; i++) {
  const x = (Math.random() - 0.5) * RAIN_BOX.x;
  const y = Math.random() * RAIN_BOX.y;
  const z = (Math.random() - 0.5) * RAIN_BOX.z;
  rainPos.set([x, y, z, x + 0.05, y - 0.45, z + 0.02], i * 6);
  rainSpeed[i] = 14 + Math.random() * 8;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
const rain = new THREE.LineSegments(
  rainGeo,
  new THREE.LineBasicMaterial({ color: '#8aa0b8', transparent: true, opacity: 0.22, depthWrite: false }),
);
rain.frustumCulled = false;
atmos.add(rain);

function updateRain(dt) {
  for (let i = 0; i < RAIN_COUNT; i++) {
    const o = i * 6;
    const dy = rainSpeed[i] * dt;
    rainPos[o + 1] -= dy;
    rainPos[o + 4] -= dy;
    rainPos[o] += dt * 0.6;
    rainPos[o + 3] += dt * 0.6;
    if (rainPos[o + 4] < -0.3) {
      const x = (Math.random() - 0.5) * RAIN_BOX.x;
      const z = (Math.random() - 0.5) * RAIN_BOX.z;
      rainPos.set([x, RAIN_BOX.y, z, x + 0.05, RAIN_BOX.y - 0.45, z + 0.02], o);
    }
  }
  rainGeo.attributes.position.needsUpdate = true;
}

function applyAtmosphere() {
  atmos.visible = ui.atmosphere;
  scene.fog = ui.atmosphere ? FOG : null;
}

// ---------------------------------------------------------------------------
// Interaction: painting
// ---------------------------------------------------------------------------

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let hoverIndex = -1;
let painting = null; // { pointerId, start:{x,y}, last:{x,y}, rect:boolean }
const activeTouches = new Set();

function pickCell(ev, { clamp = false } = {}) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(tiles, false)[0];
  if (hit && hit.instanceId !== undefined) return grid.coords(hit.instanceId);
  // Fallback: intersect the board plane (lets drags continue off the tile tops).
  const p = raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3());
  if (!p) return null;
  let x = Math.floor(p.x / TILE + COLS / 2);
  let y = Math.floor(p.z / TILE + ROWS / 2);
  if (clamp) {
    x = THREE.MathUtils.clamp(x, 0, COLS - 1);
    y = THREE.MathUtils.clamp(y, 0, ROWS - 1);
  }
  return grid.inBounds(x, y) ? { x, y } : null;
}

const paintAllowed = () => !ui.orbitMode && !ui.spaceHeld;

function paintLine(a, b) {
  // Bresenham so quick drags don't skip cells.
  const patch = BRUSHES[ui.brush];
  let { x: x0, y: y0 } = a;
  const { x: x1, y: y1 } = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    grid.apply(grid.index(x0, y0), patch);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function paintRect(a, b) {
  grid.revertStroke();
  const patch = BRUSHES[ui.brush];
  const touched = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      const i = grid.index(x, y);
      if (grid.apply(i, patch, { silent: true })) touched.push(i);
    }
  }
  if (touched.length) grid.emit(touched);
}

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'touch') {
    activeTouches.add(ev.pointerId);
    if (activeTouches.size > 1 && painting) { cancelPainting(); return; }
  }
  if (ev.button !== 0 || !paintAllowed() || activeTouches.size > 1) return;
  const cell = pickCell(ev);
  if (!cell) return;
  canvas.setPointerCapture(ev.pointerId);
  painting = { pointerId: ev.pointerId, start: cell, last: cell, rect: ui.shape === 'rect' || ev.shiftKey };
  grid.beginStroke();
  if (painting.rect) paintRect(cell, cell);
  else paintLine(cell, cell);
});

canvas.addEventListener('pointermove', (ev) => {
  const cell = pickCell(ev, { clamp: !!painting });
  setHover(cell);
  if (!painting || ev.pointerId !== painting.pointerId || !cell) return;
  if (cell.x === painting.last.x && cell.y === painting.last.y) return;
  if (painting.rect) paintRect(painting.start, cell);
  else paintLine(painting.last, cell);
  painting.last = cell;
});

function finishPainting(ev) {
  if (ev && ev.pointerType === 'touch') activeTouches.delete(ev.pointerId);
  if (!painting || (ev && ev.pointerId !== painting.pointerId)) return;
  painting = null;
  grid.endStroke();
  updateUndoButtons();
}
function cancelPainting() {
  grid.revertStroke();
  grid.endStroke();
  painting = null;
}
canvas.addEventListener('pointerup', finishPainting);
canvas.addEventListener('pointercancel', (ev) => {
  activeTouches.delete(ev.pointerId);
  if (painting && ev.pointerId === painting.pointerId) cancelPainting();
});
canvas.addEventListener('pointerleave', () => { if (!painting) setHover(null); });

function setHover(cell) {
  hoverIndex = cell ? grid.index(cell.x, cell.y) : -1;
  hoverBox.visible = !!cell;
  updateHoverInfo();
}

// ---------------------------------------------------------------------------
// Camera bindings
// ---------------------------------------------------------------------------

function applyControlBindings() {
  const orbitLeft = ui.orbitMode || ui.spaceHeld;
  controls.mouseButtons = {
    LEFT: orbitLeft ? THREE.MOUSE.ROTATE : null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: orbitLeft ? THREE.TOUCH.ROTATE : null,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };
  if (renderer) renderer.domElement.style.cursor = orbitLeft ? 'grab' : 'crosshair';
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function setBrush(name) {
  ui.brush = name;
  $$('.brush').forEach((b) => b.classList.toggle('on', b.dataset.brush === name));
}
function setShape(name) {
  ui.shape = name;
  $$('[data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === name));
}
function setView(name) {
  ui.view = name;
  $$('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  refreshAll();
}
function setOrbitMode(on) {
  ui.orbitMode = on;
  $('#camMode').classList.toggle('on', on);
  applyControlBindings();
}

$$('.brush').forEach((b) => b.addEventListener('click', () => setBrush(b.dataset.brush)));
$$('[data-shape]').forEach((b) => b.addEventListener('click', () => setShape(b.dataset.shape)));
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$$('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.cam)));
$('#camMode').addEventListener('click', () => setOrbitMode(!ui.orbitMode));

$('#optLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; labelGroup.visible = ui.labels; });
$('#optAtmos').addEventListener('change', (e) => { ui.atmosphere = e.target.checked; applyAtmosphere(); });

$('#undo').addEventListener('click', () => { grid.undo(); updateUndoButtons(); });
$('#redo').addEventListener('click', () => { grid.redo(); updateUndoButtons(); });
$('#clear').addEventListener('click', () => {
  if (!confirm('Reset every cell to outdoor / unlit / walkable? (You can undo this.)')) return;
  grid.replaceAll(Array.from({ length: N }, defaultCell));
  updateUndoButtons();
});

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(grid.toJSON(), null, 2)], { type: 'application/json' });
  download(blob, `board-grid-${stamp()}.json`);
});
$('#import').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    grid.replaceAll(grid.parse(JSON.parse(await file.text())));
    updateUndoButtons();
  } catch (err) {
    alert(`Couldn't import that file: ${err.message}`);
  }
});
$('#png').addEventListener('click', () => {
  hoverBox.visible = false;
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => blob && download(blob, `board-grid-${stamp()}.png`));
  hoverBox.visible = hoverIndex >= 0;
});

$('#collapse').addEventListener('click', () => { $('#panel').hidden = true; $('#expand').hidden = false; });
$('#expand').addEventListener('click', () => { $('#panel').hidden = false; $('#expand').hidden = true; });
if (window.innerWidth < 700) { $('#panel').hidden = true; $('#expand').hidden = false; }

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? grid.redo() : grid.undo();
    updateUndoButtons();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); grid.redo(); updateUndoButtons(); return; }
  if (mod) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!ui.spaceHeld) { ui.spaceHeld = true; applyControlBindings(); }
    return;
  }
  if (BRUSH_KEYS[e.key]) setBrush(BRUSH_KEYS[e.key]);
  else if (e.key === 'r' || e.key === 'R') setShape(ui.shape === 'rect' ? 'brush' : 'rect');
  else if (e.key === 't' || e.key === 'T') setCamera('top');
  else if (e.key === 'a' || e.key === 'A') setCamera('angled');
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { ui.spaceHeld = false; applyControlBindings(); }
});
window.addEventListener('blur', () => { ui.spaceHeld = false; applyControlBindings(); });

function updateUndoButtons() {
  $('#undo').disabled = grid.undoStack.length === 0;
  $('#redo').disabled = grid.redoStack.length === 0;
}

function updateHoverInfo() {
  const el = $('#hover');
  if (hoverIndex < 0) { el.textContent = 'Hover a cell'; return; }
  const { x, y } = grid.coords(hoverIndex);
  const c = grid.cells[hoverIndex];
  el.innerHTML =
    `<span class="id">${cellLabel(x, y)}</span>` +
    `<span class="tag">${c.indoor ? 'Indoor' : 'Outdoor'}</span>` +
    `<span class="tag">${c.lit ? 'Lit' : 'Unlit'}</span>` +
    `<span class="tag">${c.walkable ? 'Walkable' : 'Blocked'}</span>`;
}

function updateCounts() {
  const n = grid.counts();
  $('#counts').innerHTML =
    `Indoor <b>${n.indoor}</b> · Outdoor <b>${n.outdoor}</b><br>` +
    `Lit <b>${n.lit}</b> · Unlit <b>${n.unlit}</b><br>` +
    `Walkable <b>${n.walkable}</b> · Blocked <b>${n.blocked}</b> · ${COLS}×${ROWS}`;
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(grid.toJSON()));
      $('#saveNote').textContent = `Autosaved ${new Date().toLocaleTimeString()}.`;
    } catch {
      $('#saveNote').textContent = 'Autosave unavailable here — use Export JSON.';
    }
  }, 300);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

function makeRadialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

setBrush(ui.brush);
setShape(ui.shape);
updateUndoButtons();
updateCounts();
applyControlBindings();
applyAtmosphere();

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (camTween) {
    camTween.t = Math.min(1, camTween.t + dt / 0.6);
    const k = 1 - Math.pow(1 - camTween.t, 3);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    if (camTween.t >= 1) camTween = null;
  }
  controls.update();

  // Ease tile heights toward their targets.
  let moved = false;
  const ease = 1 - Math.exp(-dt * 18);
  for (let i = 0; i < N; i++) {
    const d = targetHeights[i] - heights[i];
    if (Math.abs(d) > 1e-4) {
      heights[i] += d * ease;
      if (Math.abs(targetHeights[i] - heights[i]) < 1e-3) heights[i] = targetHeights[i];
      writeTileMatrix(i);
      moved = true;
    }
  }
  if (moved) { tiles.instanceMatrix.needsUpdate = true; tiles.computeBoundingSphere(); }

  if (hoverIndex >= 0) {
    const { x, y } = grid.coords(hoverIndex);
    hoverBox.position.copy(cellToWorld(x, y));
    hoverBox.scale.set(1, heights[hoverIndex] + 0.02, 1);
  }

  if (atmos.visible) updateRain(dt);
  renderer.render(scene, camera);
});

// Handy for debugging / future tooling from the console.
window.gridPlanner = { grid, scene, camera };
