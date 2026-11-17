import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GridState, COLS, ROWS, MIN_SIZE, MAX_SIZE, colLabel, cellLabel, defaultCell } from './state.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'minty-pickle.grid.v1';

// Real-world scale. The board is a whole town; a small home covers 2 x 2 cells
// (about 8 m x 8 m / 26 ft square), so one cell is about 4 m (13 ft).
// Everything around the board (trees, the reference house, rain) uses this.
const METERS_PER_CELL = 4;
const m = (meters) => meters / METERS_PER_CELL; // metres -> world units (cells)

const TILE = 1;               // world units per cell
const INSET = 0.94;           // tile size inside its cell (gap = grid lines)
const FLOOR_H = 0.06;         // walkable tile thickness
const BLOCK_H = m(3);         // blocked cells rise one storey (~3 m)

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
  ghost: false,        // small-home footprint follows the cursor
};

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) grid.load(grid.parse(JSON.parse(saved)));
} catch { /* storage unavailable or corrupt: start fresh */ }

const rand32 = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

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

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1500);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.47;
controls.minDistance = 4;
controls.screenSpacePanning = false;
applyControlBindings();

// Board extents in world units, refreshed by buildBoard().
const board = { w: 0, d: 0, radius: 0 };

let camTween = null;
// Camera presets are fitted to the current board size and the viewport
// (portrait phones need much more distance). Fog is pushed back to match.
function fitPreset(name) {
  const halfV = THREE.MathUtils.degToRad(camera.fov / 2);
  const tanV = Math.tan(halfV);
  const tanH = tanV * camera.aspect;
  const target = new THREE.Vector3(0, 0, name === 'top' ? 0 : board.d * 0.04);
  let dir, dist;
  if (name === 'top') {
    dir = new THREE.Vector3(0, 1, 0.00001);
    dist = Math.max((board.d / 2 + 1.5) / tanV, (board.w / 2 + 1.5) / tanH);
  } else {
    dir = new THREE.Vector3(0, 27, 29).normalize();
    dist = (board.radius + 1.5) / Math.min(tanV, tanH) * 0.85;
  }
  FOG.near = dist + board.radius * 0.6;
  FOG.far = FOG.near + 45 + board.radius;
  controls.maxDistance = dist * 2.5;
  return { pos: dir.multiplyScalar(dist).add(target), target };
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

// Lighting: dim cool moonlight + sky/ground fill.
scene.add(new THREE.HemisphereLight('#56627a', '#181a18', 2.4));
const moon = new THREE.DirectionalLight('#a9bcff', 1.8);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.bias = -0.0008;
scene.add(moon);
scene.add(moon.target);

// ---------------------------------------------------------------------------
// Shared materials / geometry
// ---------------------------------------------------------------------------

const cellToWorld = (x, y) => new THREE.Vector3(
  (x - grid.cols / 2 + 0.5) * TILE, 0, (y - grid.rows / 2 + 0.5) * TILE,
);

const slabMat = new THREE.MeshLambertMaterial({ color: '#07090b' });
const groundMat = new THREE.MeshLambertMaterial({ color: '#0b100e' });

const tileGeoBase = new THREE.BoxGeometry(INSET * TILE, 1, INSET * TILE).translate(0, 0.5, 0); // origin at bottom
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

// Soft light pools that spill past lit cells onto their neighbours.
const poolMat = new THREE.MeshBasicMaterial({
  map: makeRadialTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2,
});
const poolGeo = new THREE.PlaneGeometry(2.6 * TILE, 2.6 * TILE).rotateX(-Math.PI / 2);

// ---------------------------------------------------------------------------
// Board (rebuilt whenever the dimensions change)
// ---------------------------------------------------------------------------

let N = 0;
let tiles, pools, glowAttr, slab, ground;
let heights = new Float32Array(0);
let targetHeights = new Float32Array(0);
let jitter = new Float32Array(0); // stable per-cell colour variation
const boardGroup = new THREE.Group();
scene.add(boardGroup);
const labelGroup = new THREE.Group();
scene.add(labelGroup);

function disposeChildren(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && ![tileGeoBase, poolGeo, firGeo].includes(o.geometry)) o.geometry.dispose();
      if (o.material && o.userData.ownMaterial) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}

function buildBoard() {
  const { cols, rows } = grid;
  N = cols * rows;
  board.w = cols * TILE;
  board.d = rows * TILE;
  board.radius = 0.5 * Math.hypot(board.w, board.d);

  disposeChildren(boardGroup);
  disposeChildren(labelGroup);

  // Dark slab under the tiles; the gaps between tiles read as grid lines.
  slab = new THREE.Mesh(new THREE.BoxGeometry(board.w + 0.4, 0.3, board.d + 0.4), slabMat);
  slab.position.y = -0.15;
  slab.receiveShadow = true;
  boardGroup.add(slab);

  // Forest floor stretching into the fog.
  ground = new THREE.Mesh(new THREE.CircleGeometry(board.radius + 260, 64).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = -0.3;
  ground.receiveShadow = true;
  boardGroup.add(ground);

  // Tiles: one instanced mesh, per-instance colour + per-instance "glow" (lit).
  const tileGeo = tileGeoBase.clone();
  glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  tileGeo.setAttribute('aGlow', glowAttr);
  tiles = new THREE.InstancedMesh(tileGeo, tileMat, N);
  tiles.castShadow = true;
  tiles.receiveShadow = true;
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boardGroup.add(tiles);

  pools = new THREE.InstancedMesh(poolGeo, poolMat, N);
  pools.raycast = () => {};
  pools.renderOrder = 2;
  boardGroup.add(pools);

  heights = new Float32Array(N);
  targetHeights = new Float32Array(N);
  jitter = new Float32Array(N);
  const rnd = rand32(1337);
  for (let i = 0; i < N; i++) jitter[i] = (rnd() - 0.5) * 0.12;

  // Coordinate labels (A.. across, 1.. down) on all four sides.
  for (let x = 0; x < cols; x++) {
    for (const zEdge of [-1, rows]) {
      const l = makeLabel(colLabel(x));
      l.position.copy(cellToWorld(x, zEdge)).setY(0.01);
      labelGroup.add(l);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (const xEdge of [-1, cols]) {
      const l = makeLabel(String(y + 1));
      l.position.copy(cellToWorld(xEdge, y)).setY(0.01);
      labelGroup.add(l);
    }
  }

  // Moon shadows cover the board plus the nearest ring of trees.
  const s = board.radius + 14;
  Object.assign(moon.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: s * 4 });
  moon.shadow.camera.updateProjectionMatrix();
  moon.position.set(-0.6 * s, 1.2 * s, -0.5 * s);

  buildSurroundings();
  buildRain();
  refreshAll(true);
  tiles.computeBoundingBox();
}

// ---------------------------------------------------------------------------
// Tile appearance
// ---------------------------------------------------------------------------

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

// Hover outline
const hoverBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, 1, TILE).translate(0, 0.5, 0)),
  new THREE.LineBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.9, depthTest: false }),
);
hoverBox.renderOrder = 10;
hoverBox.visible = false;
scene.add(hoverBox);

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = `600 ${text.length > 2 ? 48 : 64}px ui-monospace, Menlo, Consolas, monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#8f9f9a';
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.75, 0.75).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }),
  );
  mesh.userData.ownMaterial = true;
  return mesh;
}

// ---------------------------------------------------------------------------
// Surroundings, built to real-world scale (1 cell = METERS_PER_CELL metres)
// ---------------------------------------------------------------------------

const atmos = new THREE.Group();
scene.add(atmos);
const surroundGroup = new THREE.Group();
atmos.add(surroundGroup);

// A Douglas fir in unit space: base at y=0, top at y=1, crown radius 1 at the
// bottom tier. Instances scale it to (crownRadius, height, crownRadius).
function makeFirGeometry() {
  const parts = [];
  const paint = (geo, hex) => {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geo.deleteAttribute('uv');
    return geo;
  };
  parts.push(paint(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 6).translate(0, 0.15, 0), '#3a2a1e'));
  const tiers = [[1.0, 0.42, 0.33], [0.8, 0.38, 0.52], [0.58, 0.32, 0.7], [0.36, 0.28, 0.86]];
  for (const [r, h, y] of tiers) {
    parts.push(paint(new THREE.ConeGeometry(r, h, 8).translate(0, y, 0), '#2c4a3e'));
  }
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}
const firGeo = makeFirGeometry();

// Trees between the camera and the board dissolve so they never hide cells.
const fadeUniforms = { uCamXZ: { value: new THREE.Vector2() }, uFadeD: { value: 0 } };
const firMat = new THREE.MeshLambertMaterial({ vertexColors: true });
firMat.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, fadeUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
      #endif
      vWPos = (modelMatrix * wp).xyz;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vWPos;
      uniform vec2 uCamXZ;
      uniform float uFadeD;`)
    .replace('void main() {', `void main() {
      float dCam = distance(vWPos.xz, uCamXZ);
      float fade = 1.0 - smoothstep(uFadeD - 2.5, uFadeD - 0.3, dCam);
      float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      if (fade > noise * 0.999) discard;`);
};

// Small-home reference: 2 x 2 cells, ~3 m walls, hipped roof to ~6.5 m.
function makeHouse({ ghost = false } = {}) {
  const g = new THREE.Group();
  const w = 2 * TILE - 0.2;
  const wallMat = ghost
    ? new THREE.MeshBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.18, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color: '#3b3a36' });
  const roofMat = ghost
    ? wallMat
    : new THREE.MeshLambertMaterial({ color: '#1c1f22' });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, m(3), w).translate(0, m(3) / 2, 0), wallMat);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(w * 0.78, m(3.5), 4).rotateY(Math.PI / 4).translate(0, m(3) + m(3.5) / 2, 0),
    roofMat,
  );
  for (const part of [walls, roof]) {
    part.castShadow = !ghost;
    part.receiveShadow = !ghost;
    part.userData.ownMaterial = true;
    g.add(part);
  }
  if (ghost) {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(walls.geometry),
      new THREE.LineBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.7 }),
    );
    edges.userData.ownMaterial = true;
    g.add(edges);
  } else {
    // One dim lit window and a porch light: someone is still up.
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(m(1.1), m(1.0)),
      new THREE.MeshBasicMaterial({ color: '#e9a85c' }),
    );
    win.userData.ownMaterial = true;
    win.position.set(-w / 4, m(1.6), w / 2 + 0.005);
    g.add(win);
  }
  return g;
}

const ghostHouse = makeHouse({ ghost: true });
ghostHouse.visible = false;
scene.add(ghostHouse);

function buildSurroundings() {
  disposeChildren(surroundGroup);
  const rnd = rand32(90210);
  const halfW = board.w / 2;
  const halfD = board.d / 2;

  // Reference house in the clearing off the right edge, near the front.
  const house = makeHouse();
  house.position.set(halfW + 4.2, 0, halfD - 2);
  surroundGroup.add(house);
  const porch = new THREE.PointLight('#ffb866', 2.2, 7, 1.6);
  porch.position.set(halfW + 4.2 - 0.4, m(2.6), halfD - 2 + 1.2);
  surroundGroup.add(porch);

  // Fir forest: a ring starting ~10 m (2.5 cells) past the labels.
  // Mature Douglas firs: 20-40 m tall, crown about a third as wide as tall.
  const clear = 3.5;
  const depth = 32;
  const ringArea = (board.w + 2 * (clear + depth)) * (board.d + 2 * (clear + depth)) - (board.w + 2 * clear) * (board.d + 2 * clear);
  const count = Math.min(3500, Math.round(ringArea / 4.2));
  const firs = new THREE.InstancedMesh(firGeo, firMat, count);
  firs.castShadow = true;
  firs.receiveShadow = true;
  const cellHash = new Map();
  const key = (x, z) => `${Math.floor(x / 1.5)},${Math.floor(z / 1.5)}`;
  const shade = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < count && tries < count * 12; tries++) {
    const x = (rnd() - 0.5) * (board.w + 2 * (clear + depth));
    const z = (rnd() - 0.5) * (board.d + 2 * (clear + depth));
    const edge = Math.max(Math.abs(x) - halfW, Math.abs(z) - halfD); // distance past the board edge
    if (edge < clear) continue;
    if (Math.hypot(x - house.position.x, z - house.position.z) < 3.2) continue;
    const k = key(x, z);
    if (cellHash.has(k)) continue;
    cellHash.set(k, true);
    // Younger, shorter trees at the forest edge; old growth further back.
    const maturity = Math.min(1, (edge - clear) / 10);
    const h = m(16 + 14 * maturity + rnd() * 14);   // 16-44 m
    const r = h * (0.15 + rnd() * 0.06);            // crown radius
    tmpMatrix.compose(
      tmpPos.set(x, -0.3, z),
      tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * Math.PI * 2),
      tmpScale.set(r, h, r),
    );
    firs.setMatrixAt(placed, tmpMatrix);
    shade.setScalar(0.75 + rnd() * 0.5);
    firs.setColorAt(placed, shade);
    placed++;
  }
  firs.count = placed;
  firs.computeBoundingSphere();
  surroundGroup.add(firs);
}

// Drizzle: streaks ~1.5 m long, spread over the board and the near forest.
let rain = null;
let rainPos = new Float32Array(0);
let rainSpeed = new Float32Array(0);
const RAIN_TOP = m(80);
const STREAK = m(1.5);
const rainBox = { x: 0, z: 0 };
const rainMat = new THREE.LineBasicMaterial({ color: '#8aa0b8', transparent: true, opacity: 0.22, depthWrite: false });

function buildRain() {
  if (rain) { atmos.remove(rain); rain.geometry.dispose(); }
  rainBox.x = board.w + 50;
  rainBox.z = board.d + 50;
  const count = Math.min(6000, Math.round(rainBox.x * rainBox.z * 0.3));
  rainPos = new Float32Array(count * 6);
  rainSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    spawnDrop(i, Math.random() * RAIN_TOP);
    rainSpeed[i] = m(7) + Math.random() * m(3); // ~7-10 m/s
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  rain = new THREE.LineSegments(geo, rainMat);
  rain.frustumCulled = false;
  atmos.add(rain);
}
function spawnDrop(i, y) {
  const x = (Math.random() - 0.5) * rainBox.x;
  const z = (Math.random() - 0.5) * rainBox.z;
  rainPos.set([x, y, z, x + 0.03, y - STREAK, z + 0.01], i * 6);
}
function updateRain(dt) {
  const n = rainSpeed.length;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const dy = rainSpeed[i] * dt;
    rainPos[o + 1] -= dy;
    rainPos[o + 4] -= dy;
    rainPos[o] += dt * 0.3;
    rainPos[o + 3] += dt * 0.3;
    if (rainPos[o + 4] < -0.3) spawnDrop(i, RAIN_TOP);
  }
  rain.geometry.attributes.position.needsUpdate = true;
}

function applyAtmosphere() {
  atmos.visible = ui.atmosphere;
  scene.fog = ui.atmosphere ? FOG : null;
}

// Horizontal distance from the camera to the nearest edge of the board (incl.
// labels). Trees closer to the camera than this are dissolved.
function updateTreeFade() {
  const hx = board.w / 2 + 1.2;
  const hz = board.d / 2 + 1.2;
  const cx = camera.position.x;
  const cz = camera.position.z;
  const nx = THREE.MathUtils.clamp(cx, -hx, hx);
  const nz = THREE.MathUtils.clamp(cz, -hz, hz);
  fadeUniforms.uCamXZ.value.set(cx, cz);
  fadeUniforms.uFadeD.value = Math.hypot(cx - nx, cz - nz);
}

buildBoard();
setCamera(window.innerWidth < window.innerHeight ? 'top' : 'angled', true);

grid.onChange((indices, resized) => {
  if (resized) {
    buildBoard();
    setHover(null);
    setCamera(window.innerWidth < window.innerHeight ? 'top' : 'angled');
    syncSizeInputs();
  } else {
    for (const i of indices) refreshCell(i);
    flagDirty();
  }
  updateCounts();
  updateHoverInfo();
  scheduleSave();
});

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
  let x = Math.floor(p.x / TILE + grid.cols / 2);
  let y = Math.floor(p.z / TILE + grid.rows / 2);
  if (clamp) {
    x = THREE.MathUtils.clamp(x, 0, grid.cols - 1);
    y = THREE.MathUtils.clamp(y, 0, grid.rows - 1);
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
$('#optGhost').addEventListener('change', (e) => { ui.ghost = e.target.checked; });

// Board size
function syncSizeInputs() {
  $('#sizeCols').value = grid.cols;
  $('#sizeRows').value = grid.rows;
  $('#sizeReadout').textContent =
    `${grid.cols} × ${grid.rows} cells ≈ ${grid.cols * METERS_PER_CELL} × ${grid.rows * METERS_PER_CELL} m ` +
    `(${Math.round(grid.cols * METERS_PER_CELL * 3.281)} × ${Math.round(grid.rows * METERS_PER_CELL * 3.281)} ft)`;
}
for (const id of ['#sizeCols', '#sizeRows']) {
  Object.assign($(id), { min: MIN_SIZE, max: MAX_SIZE });
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') applySize(); });
}
function applySize() {
  const cols = Number($('#sizeCols').value);
  const rows = Number($('#sizeRows').value);
  const shrinking = cols < grid.cols || rows < grid.rows;
  if (grid.resize(cols, rows)) {
    updateUndoButtons();
    toast(shrinking ? 'Board resized. Cells past the new edge were removed; undo restores them.' : 'Board resized.');
  }
  syncSizeInputs(); // shows clamped values
}
$('#sizeApply').addEventListener('click', applySize);
syncSizeInputs();

$('#undo').addEventListener('click', () => { grid.undo(); updateUndoButtons(); });
$('#redo').addEventListener('click', () => { grid.redo(); updateUndoButtons(); });
$('#clear').addEventListener('click', () => {
  grid.replaceAll(grid.cols, grid.rows, Array.from({ length: N }, defaultCell));
  updateUndoButtons();
  toast('Board cleared. Undo (Ctrl/Cmd+Z) brings it back.');
});

// In-page dialog for export / import / PNG. Works even where native
// alert()/confirm() and file downloads are blocked (e.g. sandboxed embeds).
const dlg = {
  root: $('#dialog'), title: $('#dlgTitle'), text: $('#dlgText'),
  area: $('#dlgArea'), img: $('#dlgImg'), actions: $('#dlgActions'),
};
function openDialog({ title, text = '', area = null, readonly = true, img = null, actions = [] }) {
  dlg.title.textContent = title;
  dlg.text.textContent = text;
  dlg.text.classList.remove('error');
  dlg.area.hidden = area === null;
  if (area !== null) { dlg.area.value = area; dlg.area.readOnly = readonly; }
  dlg.img.hidden = !img;
  if (img) dlg.img.src = img;
  dlg.actions.replaceChildren(...actions.map(([label, fn, primary]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.classList.add('on');
    b.addEventListener('click', fn);
    return b;
  }), Object.assign(document.createElement('button'), { textContent: 'Close', onclick: closeDialog }));
  dlg.root.hidden = false;
  (area !== null && !readonly ? dlg.area : dlg.actions.firstElementChild)?.focus();
}
function closeDialog() { dlg.root.hidden = true; dlg.img.removeAttribute('src'); }
function dialogError(msg) { dlg.text.textContent = msg; dlg.text.classList.add('error'); }
dlg.root.addEventListener('click', (e) => { if (e.target === dlg.root) closeDialog(); });

function importText(text) {
  try {
    const data = grid.parse(JSON.parse(text));
    grid.replaceAll(data.cols, data.rows, data.cells);
    updateUndoButtons();
    closeDialog();
    toast('Layout imported. Undo restores the previous board.');
  } catch (err) {
    dialogError(`That isn't a grid layout this app can read (${err.message}). Paste the JSON from Export, or choose a .json file.`);
  }
}

$('#export').addEventListener('click', () => {
  const json = JSON.stringify(grid.toJSON(), null, 2);
  openDialog({
    title: 'Export layout',
    text: 'Copy this JSON somewhere safe, or download it as a file. Import accepts either.',
    area: json,
    actions: [
      ['Copy JSON', async () => {
        try { await navigator.clipboard.writeText(json); toast('JSON copied.'); } catch { dlg.area.select(); dialogError('Copy was blocked here. The text is selected; press Ctrl/Cmd+C.'); }
      }, true],
      ['Download .json', () => download(new Blob([json], { type: 'application/json' }), `board-grid-${stamp()}.json`)],
    ],
  });
});
$('#import').addEventListener('click', () => {
  openDialog({
    title: 'Import layout',
    text: 'Paste exported JSON below, or choose a .json file. This replaces the board (undo restores it).',
    area: '',
    readonly: false,
    actions: [
      ['Load pasted JSON', () => importText(dlg.area.value), true],
      ['Choose file…', () => $('#importFile').click()],
    ],
  });
  dlg.area.placeholder = '{ "format": "minty-pickle-grid", ... }';
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importText(await file.text());
});
$('#png').addEventListener('click', () => {
  hoverBox.visible = false;
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  hoverBox.visible = hoverIndex >= 0;
  openDialog({
    title: 'Snapshot',
    text: 'Right-click (or long-press) the image to save or copy it.',
    img: url,
    actions: [['Download .png', () => renderer.domElement.toBlob((b) => b && download(b, `board-grid-${stamp()}.png`)), true]],
  });
});

let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

$('#collapse').addEventListener('click', () => { $('#panel').hidden = true; $('#expand').hidden = false; });
$('#expand').addEventListener('click', () => { $('#panel').hidden = false; $('#expand').hidden = true; });
if (window.innerWidth < 700) { $('#panel').hidden = true; $('#expand').hidden = false; }

window.addEventListener('keydown', (e) => {
  if (!dlg.root.hidden) { if (e.key === 'Escape') closeDialog(); return; }
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
    `Walkable <b>${n.walkable}</b> · Blocked <b>${n.blocked}</b> · ${grid.cols}×${grid.rows}`;
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
    // Ghost home covers the hovered cell and the cells right/below it.
    ghostHouse.position.copy(cellToWorld(x, y)).add(tmpPos.set(0.5 * TILE, FLOOR_H, 0.5 * TILE));
  }
  ghostHouse.visible = ui.ghost && hoverIndex >= 0;

  updateTreeFade();
  if (atmos.visible) updateRain(dt);
  renderer.render(scene, camera);
});

// Handy for debugging / future tooling from the console.
window.gridPlanner = { grid, scene, camera };
