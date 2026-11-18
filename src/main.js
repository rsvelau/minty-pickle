import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GridState, COLS, ROWS, MIN_SIZE, MAX_SIZE, AREAS, colLabel, cellLabel, defaultCell, defaultWalkable, areaLabel, parseEdgeKey,
  hasStreetLamp, lightKind, centreBrightness, MAX_RADIUS, blocksLight,
} from './state.js';
import { createWaterSurface } from './water.js';
import { createProps } from './props.js';
import { METERS_PER_CELL, m } from './scale.js';
import { createStreets } from './street.js';
import { createBridges } from './bridge.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'minty-pickle.grid.v1';

// Real-world scale lives in src/scale.js: one cell is a narrow two-lane street
// with small sidewalks (~7 m). Everything built in metres converts through m().

const TILE = 1;               // world units per cell
const INSET = 0.94;           // tile size inside its cell (gap = grid lines)
const FLOOR_H = 0.06;         // top of a land tile (ground level ~ 0)
const BASE = m(4.5);          // tiles are columns reaching down this far
const WATER_Y = -m(2);        // water surface sits ~2 m below the street (bridge piers show)
const BED_H = -m(3.6);        // river/lake bed
const DECK_TOP = FLOOR_H + 0.03; // bridge decks sit just above street level
const DECK_T = m(0.5);        // deck thickness
const RAIL_H = m(1.1);        // railing height
const WALL_FULL = m(2.6);     // interior wall height
const WALL_LOW = m(0.8);      // cutaway wall height (default, keeps rooms visible)
const WALL_T = 0.06;          // wall thickness
const DOOR_W = m(1.2);        // door opening, centred on its edge
const DOOR_H = m(2.1);        // door height (lintel above when walls are full height)

// Per-subcategory surface colours (night) and tile heights. Street cells are
// drawn by src/street.js on top of a tile just below street level.
const SUB_LOOK = {
  ground: { unlit: '#4a6158', lit: '#9fbf8f', area: '#3e6b5a' },
  street: { unlit: '#34383b', lit: '#8a9599', area: '#4a5058', h: FLOOR_H - 0.01 },
  path: { unlit: '#544537', lit: '#b5946f', area: '#8c6a45' },
  cemetery: { unlit: '#33463a', lit: '#86a487', area: '#5b7f5f' },
  cemeteryPath: { unlit: '#5a564c', lit: '#b3ab92', area: '#a39a80' },
  forestCemetery: { unlit: '#24312a', lit: '#6f8f74', area: '#3f5a44' },
  forest: { unlit: '#1e2c24', lit: '#5f8566', area: '#24503a' },
  brambles: { unlit: '#2e2926', lit: '#7a6a5c', area: '#6b4a5e' },
  hardwood: { unlit: '#7a5338', lit: '#f0a85a', area: '#9a6a3e' },
  carpet: { unlit: '#58303a', lit: '#c4727c', area: '#8a3f52' },
};


// Night-time PNW palette. "Lit" outdoor reads as old mercury-vapor streetlight
// (sickly green-white); lit indoor reads as warm incandescent.
const PALETTE = {
  outdoor: { unlit: '#4a6158', lit: '#9fbf8f' },
  indoor: { unlit: '#7a5338', lit: '#f0a85a' },
  bed: '#1b231f',
  deck: { unlit: '#3a3f44', lit: '#9aa0a4' }, // asphalt road deck
  rail: '#8a8e92',                             // galvanized pipe railing
  areaWater: '#24506a',
  areaDeck: '#b39a72',
  blockedShade: 0.88,
  glowOutdoor: '#c6e0c0',
  glowLamp: '#ffd38a',       // warm incandescent glow of an antique street lamp
  lightLamp: '#fff0c4',      // Light view: the lamp cell itself
  spillWarm: '#b89a62',      // surfaces near a lit lamp
  glowIndoor: '#ffbe73',
  // single-layer views
  areaOutdoor: '#34574c',
  areaIndoor: '#8a5a36',
  lightOff: '#2a3036',
  lightOn: '#f3cf7a',
  walkOk: '#4c5654',
  walkNo: '#a2392f',
};

// A brush is a patch, or a function of the current cell returning a patch
// (or null to leave the cell alone).
// - Painting water makes land unwalkable; painting land over water makes it
//   walkable again and removes any bridge.
// - Bridges only go on water and are walkable.
// - Subcategories that start blocked (forest, brambles...) block the cell;
//   painting something ordinary over a default-blocked cell unblocks it.
//   Otherwise the cell keeps whatever walkability it had.
const paintArea = (area, sub) => (c) => {
  if (area === 'water' && c.area === 'water') return { sub }; // keep bridge + walkability
  const patch = { area, sub, bridge: false };
  if (!defaultWalkable(area, sub)) patch.walkable = false;
  else if (!defaultWalkable(c.area, c.sub) && !c.bridge) patch.walkable = true;
  return patch;
};
const BRUSHES = {
  bridge: (c) => (c.area === 'water' ? { bridge: true, walkable: true } : null),
  unbridge: (c) => (c.bridge ? { bridge: false, walkable: false } : null),
  unlit: { lit: false, radius: 0, lamp: false },
  // Light source with the radius set in the panel.
  lit: () => ({ lit: true, radius: ui.lightRadius }),
  // Switch on the street lamp: only where one stands (T-junctions, crossings).
  lamp: (c, i, g) => {
    const { x, y } = g.coords(i);
    return hasStreetLamp(g, x, y) ? { lamp: true, lit: true } : null;
  },
  walkable: { walkable: true },
  blocked: { walkable: false },
  reset: defaultCell(),
};
for (const area in AREAS) {
  for (const sub in AREAS[area].subs) BRUSHES[`${area}:${sub}`] = paintArea(area, sub);
}
const BRUSH_KEYS = {
  1: 'outdoor:ground', 2: 'indoor:hardwood', 3: 'unlit', 4: 'lit', 5: 'walkable', 6: 'blocked',
  7: 'water:lake', 8: 'water:river', 9: 'bridge', 0: 'reset', l: 'lamp', L: 'lamp',
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const grid = new GridState(COLS, ROWS);
const ui = {
  brush: 'indoor:hardwood',
  tool: 'cells',       // 'cells' | 'walls'
  edgeBrush: 'wall',   // 'wall' | 'door' | 'erase'
  lowWalls: true,
  lightRadius: 1,      // radius for the Light source brush (cells)
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
controls.minDistance = 1.5;      // close enough for detail work on one cell
controls.screenSpacePanning = false; // pan across the board, not up into the sky
controls.zoomToCursor = true;    // wheel / pinch zooms toward the pointer, not the centre
controls.keyPanSpeed = 25;
controls.listenToKeyEvents(window); // arrow keys pan
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
// Keep the orbit/zoom focus over the board (plus a small margin) so panning
// to the edges never loses it. The camera moves with the target, so the view
// doesn't swing.
function clampTarget() {
  const t = controls.target;
  const hx = board.w / 2 + 1, hz = board.d / 2 + 1;
  const cx = THREE.MathUtils.clamp(t.x, -hx, hx);
  const cz = THREE.MathUtils.clamp(t.z, -hz, hz);
  const dy = THREE.MathUtils.clamp(t.y, 0, 2) - t.y;
  if (cx !== t.x || cz !== t.z || dy) {
    const shift = new THREE.Vector3(cx - t.x, dy, cz - t.z);
    t.add(shift);
    camera.position.add(shift);
  }
}

// F: fly to the cell (or edge) under the pointer and move in close.
function focusHovered() {
  let point = null;
  if (hoverIndex >= 0) {
    const { x, y } = grid.coords(hoverIndex);
    point = cellToWorld(x, y);
  } else if (hoverEdge) {
    const { o, x, y } = hoverEdge;
    point = o === 'v'
      ? new THREE.Vector3(x - grid.cols / 2, 0, y - grid.rows / 2 + 0.5)
      : new THREE.Vector3(x - grid.cols / 2 + 0.5, 0, y - grid.rows / 2);
  }
  if (!point) return;
  const offset = camera.position.clone().sub(controls.target);
  offset.setLength(Math.min(offset.length(), 9));
  camTween = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos: point.clone().add(offset),
    toTarget: point,
  };
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

// Unit box with its base at y = 0 (walls, door leaves).
const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const wallMat = new THREE.MeshLambertMaterial({ color: '#b8b0a0' });
const doorMat = new THREE.MeshLambertMaterial({ color: '#d08a40', emissive: '#5a3414' });
// Storefront windows: painted frames (instance colour), and glass that is
// dark, or glows warm when light reaches either side.
const frameMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
const glassDarkMat = new THREE.MeshLambertMaterial({ color: '#2b3c46', transparent: true, opacity: 0.6, depthWrite: false });
const glassLitMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.78, depthWrite: false });
const FRAME_COLOURS = ['#1f3a2e', '#5a1f1c', '#1b1b1d', '#c8bfa6', '#2a3550']; // green, oxblood, black, cream, navy


// ---------------------------------------------------------------------------
// Board (rebuilt whenever the dimensions change)
// ---------------------------------------------------------------------------

let N = 0;
let tiles, pools, glowAttr, slab, ground, decks, deckGlow, rails;
let walls, doorLeaves, frames, glassDark, glassLit;
let props = null; // walkable/blocked variants of every surface (src/props.js)
let bridges = null; // steel truss bridge structures (src/bridge.js)
let streets = null; // street surfaces: lanes, lines, sidewalks (src/street.js)
let deckVisible = new Uint8Array(0);
const water = createWaterSurface();
scene.add(water.mesh);
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
      if (o.geometry && ![tileGeoBase, poolGeo, firGeo, unitBoxGeo].includes(o.geometry)) o.geometry.dispose();
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

  // Dark slab under the tile columns; the gaps between tiles read as grid lines.
  slab = new THREE.Mesh(new THREE.BoxGeometry(board.w + 0.4, 0.3, board.d + 0.4), slabMat);
  slab.position.y = -BASE - 0.15;
  slab.receiveShadow = true;
  boardGroup.add(slab);

  // Forest floor level with the town, with a hole where the board sits so
  // sunken water cells show through.
  const shape = new THREE.Shape().absarc(0, 0, board.radius + 260, 0, Math.PI * 2, false);
  const hw = board.w / 2 + 0.2, hd = board.d / 2 + 0.2;
  shape.holes.push(new THREE.Path().moveTo(-hw, -hd).lineTo(hw, -hd).lineTo(hw, hd).lineTo(-hw, hd).lineTo(-hw, -hd));
  ground = new THREE.Mesh(new THREE.ShapeGeometry(shape, 64).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true;
  boardGroup.add(ground);

  // Water surface + its per-cell textures.
  water.resize(cols, rows);
  water.mesh.position.y = WATER_Y;

  // Bridge decks: one per cell (hidden unless that cell is a bridge).
  const deckGeo = new THREE.BoxGeometry(TILE, DECK_T, TILE).translate(0, -DECK_T / 2, 0);
  deckGlow = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  deckGeo.setAttribute('aGlow', deckGlow);
  decks = new THREE.InstancedMesh(deckGeo, tileMat, N);
  decks.castShadow = true;
  decks.receiveShadow = true;
  deckVisible = new Uint8Array(N);
  boardGroup.add(decks);

  // Railings along bridge edges that face open water (up to 4 per cell).
  // Pipe railing: top and mid rails on posts.
  const railGeo = mergeGeometries([
    new THREE.BoxGeometry(TILE, 0.025, 0.025).translate(0, RAIL_H, 0),
    new THREE.BoxGeometry(TILE, 0.02, 0.02).translate(0, RAIL_H * 0.5, 0),
    ...[-0.375, -0.125, 0.125, 0.375].map((x) => new THREE.BoxGeometry(0.02, RAIL_H, 0.02).translate(x, RAIL_H / 2, 0)),
  ]);
  rails = new THREE.InstancedMesh(railGeo, new THREE.MeshLambertMaterial({ color: PALETTE.rail }), N * 4);
  rails.userData.ownMaterial = true;
  rails.castShadow = true;
  rails.raycast = () => {};
  rails.count = 0;
  boardGroup.add(rails);

  // Cell props: each surface's walkable / blocked look.
  props?.clear();
  props = createProps(boardGroup, { firGeo, firMat });
  bridges?.clear();
  bridges = createBridges(boardGroup);
  streets?.clear();
  streets = createStreets(boardGroup);

  // Walls and doors on cell edges (a door = two short wall pieces, an
  // optional lintel, and an open door leaf).
  const maxEdges = 2 * N + cols + rows;
  walls = new THREE.InstancedMesh(unitBoxGeo, wallMat, maxEdges * 3);
  doorLeaves = new THREE.InstancedMesh(unitBoxGeo, doorMat, maxEdges * 2);
  frames = new THREE.InstancedMesh(unitBoxGeo, frameMat, maxEdges * 9);
  glassDark = new THREE.InstancedMesh(unitBoxGeo, glassDarkMat, maxEdges);
  glassLit = new THREE.InstancedMesh(unitBoxGeo, glassLitMat, maxEdges);
  glassDark.renderOrder = glassLit.renderOrder = 3;
  for (const mesh of [walls, doorLeaves, frames, glassDark, glassLit]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    mesh.count = 0;
    boardGroup.add(mesh);
  }

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
      l.position.copy(cellToWorld(x, zEdge)).setY(0.02);
      labelGroup.add(l);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (const xEdge of [-1, cols]) {
      const l = makeLabel(String(y + 1));
      l.position.copy(cellToWorld(xEdge, y)).setY(0.02);
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

// Water mask, river flow, bridge decks and railings depend on neighbours, so
// they are refreshed for the whole board after any change (cheap: <= 3600 cells).
function refreshWaterAndBridges() {
  water.update(grid, grid.riverFlow());
  water.mesh.visible = ui.view === 'all' || ui.view === 'area';
  water.setFlat(ui.view === 'area');

  const showDecks = ui.view !== 'light';
  let r = 0;
  const railAt = (pos, rotY) => {
    tmpMatrix.compose(pos, tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY), tmpScale.set(1, 1, 1));
    rails.setMatrixAt(r++, tmpMatrix);
  };
  const openWater = (x, y) => grid.isWater(x, y) && !grid.cells[grid.index(x, y)].bridge;
  for (let i = 0; i < N; i++) {
    const c = grid.cells[i];
    const { x, y } = grid.coords(i);
    const on = showDecks && c.bridge;
    deckVisible[i] = on ? 1 : 0;
    if (on) {
      tmpPos.copy(cellToWorld(x, y)).setY(DECK_TOP);
      tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale.set(1, 1, 1));
      decks.setMatrixAt(i, tmpMatrix);
      const look = deckLook(c, i);
      decks.setColorAt(i, tmpColor.set(look.color));
      deckGlow.array[i] = look.glow;
      if (ui.view === 'all') {
        const p = cellToWorld(x, y).setY(DECK_TOP);
        const e = 0.5 * TILE - 0.15; // just inside the truss
        if (openWater(x, y - 1)) railAt(p.clone().add(tmpScale.set(0, 0, -e)), 0);
        if (openWater(x, y + 1)) railAt(p.clone().add(tmpScale.set(0, 0, e)), 0);
        if (openWater(x - 1, y)) railAt(p.clone().add(tmpScale.set(-e, 0, 0)), Math.PI / 2);
        if (openWater(x + 1, y)) railAt(p.clone().add(tmpScale.set(e, 0, 0)), Math.PI / 2);
      }
    } else {
      // Parked far below and tiny rather than zero-scaled, so raycasts stay sane.
      tmpMatrix.compose(tmpPos.set(0, -1000, 0), tmpQuat.identity(), tmpScale.set(1e-4, 1e-4, 1e-4));
      decks.setMatrixAt(i, tmpMatrix);
      decks.setColorAt(i, tmpColor.set(0x000000));
    }
  }
  rails.count = r;
  rails.instanceMatrix.needsUpdate = true;
  decks.instanceMatrix.needsUpdate = true;
  decks.instanceColor.needsUpdate = true;
  deckGlow.needsUpdate = true;
  decks.computeBoundingSphere();
  bridges.update(grid, { visible: ui.view === 'all', deckTop: DECK_TOP, bedY: BED_H });
  streets.update(grid, { visible: ui.view === 'all', cellToWorld, surfaceY: SUB_LOOK.street.h + 0.002, lightLevels, lampsOn });
  refreshPropsAndWalls();
}

// Props on cells (main view only) and walls/doors on edges (every view).
function refreshPropsAndWalls() {
  props.update(grid, {
    visible: ui.view === 'all',
    cellToWorld,
    // Props stand on whatever the cell's surface is: deck, water or floor.
    baseY: (i) => {
      const c = grid.cells[i];
      if (c.bridge) return DECK_TOP;
      if (c.area === 'water') return WATER_Y;
      return targetHeights[i];
    },
  });

  // Walls and doors.
  const H = ui.lowWalls ? WALL_LOW : WALL_FULL;
  let nw = 0, nd = 0;
  const piece = (cx, cz, along, len, base, height, vertical) => {
    // `along` is the offset along the edge from its centre.
    const px = vertical ? cx : cx + along;
    const pz = vertical ? cz + along : cz;
    tmpMatrix.compose(
      tmpPos.set(px, base, pz),
      tmpQuat.identity(),
      vertical ? tmpScale.set(WALL_T, height, len) : tmpScale.set(len, height, WALL_T),
    );
    walls.setMatrixAt(nw++, tmpMatrix);
  };
  let nf = 0, ngd = 0, ngl = 0;
  // A box along the edge into any instanced mesh (`colour` for frames).
  const strip = (mesh, n, cx, cz, along, len, y0, y1, thick, vertical, colour) => {
    const px = vertical ? cx : cx + along;
    const pz = vertical ? cz + along : cz;
    tmpMatrix.compose(
      tmpPos.set(px, y0, pz), tmpQuat.identity(),
      vertical ? tmpScale.set(thick, y1 - y0, len) : tmpScale.set(len, y1 - y0, thick),
    );
    mesh.setMatrixAt(n, tmpMatrix);
    if (colour) mesh.setColorAt(n, tmpColor.set(colour));
  };
  for (const [k, type] of grid.edges) {
    const { o, x, y } = parseEdgeKey(k);
    const vertical = o === 'v';
    const cx = vertical ? x - grid.cols / 2 : x - grid.cols / 2 + 0.5;
    const cz = vertical ? y - grid.rows / 2 + 0.5 : y - grid.rows / 2;
    if (type === 'wall') {
      piece(cx, cz, 0, TILE + WALL_T, FLOOR_H, H, vertical);
      continue;
    }
    if (type === 'window') {
      // Storefront: masonry piers at the ends, a painted wooden bulkhead
      // under a big glass pane, mullions/transom by variant, a header above.
      const hash = (x * 73856093) ^ (y * 19349663) ^ (vertical ? 83492791 : 0);
      const variant = (hash >>> 0) % 4;
      const colour = FRAME_COLOURS[(hash >>> 3) % FRAME_COLOURS.length];
      const pier = m(0.35);
      const sill = ui.lowWalls ? m(0.3) : m(0.6);
      const head = m(2.8);
      const top = Math.min(head, H);
      const inner = TILE - 2 * pier;
      piece(cx, cz, -(TILE / 2 - pier / 2), pier + WALL_T, FLOOR_H, H, vertical);
      piece(cx, cz, TILE / 2 - pier / 2, pier + WALL_T, FLOOR_H, H, vertical);
      if (H > head) piece(cx, cz, 0, inner, FLOOR_H + head, H, vertical);
      strip(frames, nf++, cx, cz, 0, inner, FLOOR_H, FLOOR_H + sill, WALL_T * 1.1, vertical, colour); // bulkhead
      // Glass: lit if light reaches either side of the window.
      const [ca, cb] = grid.edgeCells(o, x, y);
      const lvl = (c) => (grid.inBounds(c.x, c.y) ? lightLevels[grid.index(c.x, c.y)] : 0);
      const lit = Math.max(lvl(ca), lvl(cb)) > 0.2;
      strip(lit ? glassLit : glassDark, lit ? ngl++ : ngd++, cx, cz, 0, inner, FLOOR_H + sill, FLOOR_H + top, WALL_T * 0.35, vertical);
      // Frame: sill and head rails, mullions, transom.
      const rail = m(0.12), bar = m(0.1);
      strip(frames, nf++, cx, cz, 0, inner, FLOOR_H + sill, FLOOR_H + sill + rail, WALL_T * 0.9, vertical, colour);
      if (H > head) strip(frames, nf++, cx, cz, 0, inner, FLOOR_H + head - rail, FLOOR_H + head, WALL_T * 0.9, vertical, colour);
      const transom = m(2.15);
      const panes = [2, 3, 1, 4][variant];
      const hasTransom = variant === 0 || variant === 2;
      const mullionTop = hasTransom ? Math.min(transom, top) : top;
      for (let i = 1; i < panes; i++) {
        strip(frames, nf++, cx, cz, -inner / 2 + (inner * i) / panes, bar, FLOOR_H + sill, FLOOR_H + mullionTop, WALL_T * 0.8, vertical, colour);
      }
      if (hasTransom && top > transom) {
        strip(frames, nf++, cx, cz, 0, inner, FLOOR_H + transom, FLOOR_H + transom + bar, WALL_T * 0.8, vertical, colour);
        // Small transom lights above a single big pane.
        if (variant === 2) {
          for (let i = 1; i < 3; i++) strip(frames, nf++, cx, cz, -inner / 2 + (inner * i) / 3, bar, FLOOR_H + transom, FLOOR_H + top, WALL_T * 0.8, vertical, colour);
        }
      }
      continue;
    }
    // Door: wall either side of a centred opening.
    const side = (TILE - DOOR_W) / 2;
    piece(cx, cz, -(DOOR_W / 2 + side / 2), side + WALL_T, FLOOR_H, H, vertical);
    piece(cx, cz, DOOR_W / 2 + side / 2, side + WALL_T, FLOOR_H, H, vertical);
    if (H > DOOR_H) piece(cx, cz, 0, DOOR_W, FLOOR_H + DOOR_H, H - DOOR_H, vertical);
    // Leaf hinged on one jamb. Unlocked doors stand open (~70 degrees);
    // locked doors are shut; one-way doors stand ajar toward the side they
    // open to. Positive swing opens into the east/south cell.
    const oneWay = type.startsWith('oneWayDoor');
    const sign = type.endsWith('-') ? -1 : 1;
    const swing = type === 'door' ? 1.2 : oneWay ? 0.5 * sign : 0;
    const leafH = Math.min(DOOR_H, H) * 0.98;
    const hingeAlong = -DOOR_W / 2;
    const hx = vertical ? cx : cx + hingeAlong;
    const hz = vertical ? cz + hingeAlong : cz;
    const angle = vertical ? -Math.PI / 2 + swing : -swing;
    const dir = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    tmpMatrix.compose(
      tmpPos.set(hx + dir.x * DOOR_W / 2, FLOOR_H, hz + dir.z * DOOR_W / 2),
      tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle),
      tmpScale.set(DOOR_W, leafH, 0.05),
    );
    doorLeaves.setMatrixAt(nd++, tmpMatrix);
    // Rotated marker box into the frames mesh (instance colour).
    const mark = (px, py, pz, sx, sy, sz, rot, colour) => {
      tmpMatrix.compose(tmpPos.set(px, py, pz), tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot), tmpScale.set(sx, sy, sz));
      frames.setMatrixAt(nf, tmpMatrix);
      frames.setColorAt(nf++, tmpColor.set(colour));
    };
    const edgeRot = vertical ? Math.PI / 2 : 0; // a box's x axis along the edge
    if (type === 'lockedDoor') {
      // Red lock plate through the leaf (shows on both faces), a brass lock,
      // and a red threshold.
      mark(cx, FLOOR_H + leafH * 0.4, cz, DOOR_W * 0.55, Math.max(leafH * 0.18, 0.01), 0.075, edgeRot, '#b8322a');
      mark(cx + (vertical ? 0 : DOOR_W * 0.32), FLOOR_H + leafH * 0.48, cz + (vertical ? DOOR_W * 0.32 : 0),
        m(0.18), Math.max(leafH * 0.12, 0.008), 0.09, edgeRot, '#c9a23a');
      mark(cx, FLOOR_H, cz, DOOR_W, 0.016, 0.3, edgeRot, '#9a2a22');
    } else if (oneWay) {
      // Green arrow on the floor through the doorway, pointing the way you
      // can go.
      const nx = vertical ? sign : 0, nz = vertical ? 0 : sign;
      const phi = Math.atan2(-nz, nx);
      const len = 0.38;
      mark(cx, FLOOR_H, cz, len, 0.014, 0.05, phi, '#5fcf6a');
      const tipX = cx + nx * len / 2, tipZ = cz + nz * len / 2;
      for (const off of [0.75 * Math.PI, -0.75 * Math.PI]) {
        const a2 = phi + off;
        const arm = 0.14;
        mark(tipX + Math.cos(a2) * arm / 2, FLOOR_H, tipZ - Math.sin(a2) * arm / 2, arm, 0.014, 0.05, a2, '#5fcf6a');
      }
    } else {
      // Threshold plate across the opening so doors read from any angle.
      tmpMatrix.compose(
        tmpPos.set(cx, FLOOR_H, cz),
        tmpQuat.identity(),
        vertical ? tmpScale.set(0.3, 0.015, DOOR_W) : tmpScale.set(DOOR_W, 0.015, 0.3),
      );
      doorLeaves.setMatrixAt(nd++, tmpMatrix);
    }
  }
  walls.count = nw;
  doorLeaves.count = nd;
  frames.count = nf;
  glassDark.count = ngd;
  glassLit.count = ngl;
  for (const mesh of [walls, doorLeaves, frames, glassDark, glassLit]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
}

function deckLook(c, i) {
  if (ui.view === 'area') return { color: PALETTE.areaDeck, glow: 0.15 };
  if (ui.view === 'walk') return { color: c.walkable ? PALETTE.walkOk : PALETTE.walkNo, glow: 0.2 };
  const lvl = lightLevels[i] ?? 0;
  return { color: mixHex(PALETTE.deck.unlit, PALETTE.deck.lit, lvl), glow: 0.18 * lvl };
}

// Top of what you see in a cell: deck, water surface, or tile.
function visibleTop(i) {
  const c = grid.cells[i];
  if (deckVisible[i]) return DECK_TOP;
  if (c.area === 'water' && water.mesh.visible) return WATER_Y;
  return heights[i];
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

// Light level per cell (0..1, includes lamp spill) and which lamps are on;
// recomputed on every change because a lamp lights its neighbours too.
let lightLevels = new Float32Array(0);
let lampsOn = new Uint8Array(0);
function recomputeLight() {
  lightLevels = grid.lightLevels();
  lampsOn = Uint8Array.from(grid.cells, (_, i) => (grid.lampOn(i) ? 1 : 0));
}

const mixHex = (a, b, t) => tmpColor2.set(a).lerp(new THREE.Color(b), t).getHex();
const tmpColor2 = new THREE.Color();

function cellLook(cell, level = 0, lamp = false) {
  // Returns { color, glow, height (tile top), pool: hexOrNull, poolY, poolScale }
  const blocked = !cell.walkable;
  const isWater = cell.area === 'water';
  const look = SUB_LOOK[cell.sub] ?? {};
  const surfaceH = look.h ?? FLOOR_H;
  // Water cells are sunken. Blocked cells stay flat: their props (see
  // src/props.js) show why you can't walk there.
  const height = isWater ? BED_H : surfaceH;
  switch (ui.view) {
    case 'area':
      return {
        color: isWater ? PALETTE.areaWater : look.area ?? PALETTE.areaOutdoor,
        glow: 0.15, height: isWater ? BED_H : surfaceH, pool: null,
      };
    case 'light':
      // Gradient: dark -> lit by light level; lamp cells brightest.
      return {
        color: lamp ? PALETTE.lightLamp : mixHex(PALETTE.lightOff, PALETTE.lightOn, level),
        glow: lamp ? 0.6 : 0.45 * level,
        height: isWater ? BED_H : FLOOR_H, pool: null,
      };
    case 'walk':
      return { color: blocked ? PALETTE.walkNo : PALETTE.walkOk, glow: 0.2, height, pool: null };
    default: {
      if (isWater) {
        return {
          color: PALETTE.bed, glow: 0, height,
          pool: cell.lit ? PALETTE.glowOutdoor : null,
          poolScale: cell.lit ? 0.6 + 0.2 * Math.min(cell.radius, 2) : 1,
          poolY: (cell.bridge ? DECK_TOP : WATER_Y) + 0.012,
        };
      }
      const set = SUB_LOOK[cell.sub] ?? PALETTE[cell.area];
      if (lamp) {
        // Bright pool spreading over the neighbouring cells.
        return {
          color: set.lit, glow: 0.3, height,
          pool: PALETTE.glowLamp, poolScale: 1.15, poolY: FLOOR_H + 0.045,
          shade: blocked ? PALETTE.blockedShade : 1,
        };
      }
      return {
        // Lit cells use their lit colour; lamp spill warms the surface toward
        // the lamp's incandescent glow by how much light reaches it.
        // A light source cell takes its lit colour by how bright it is (a
        // candle is faint); cells reached by light warm toward lamplight.
        color: cell.lit ? mixHex(set.unlit, set.lit, level) : level > 0 ? mixHex(set.unlit, PALETTE.spillWarm, level * 0.55) : set.unlit,
        glow: 0.18 * level,
        height,
        // Glow pool on the source itself (small: walls aren't drawn into it;
        // the per-cell light levels carry the real reach).
        pool: cell.lit ? (cell.area === 'indoor' ? PALETTE.glowIndoor : PALETTE.glowOutdoor) : null,
        poolScale: 0.55 + 0.2 * Math.min(cell.radius, 2),
        shade: blocked ? PALETTE.blockedShade : 1,
      };
    }
  }
}

function refreshCell(i) {
  const look = cellLook(grid.cells[i], lightLevels[i], !!lampsOn[i]);
  tmpColor.set(look.color);
  tmpColor.offsetHSL(0, 0, jitter[i] * (ui.view === 'all' ? 0.18 : 0.06));
  if (look.shade) tmpColor.multiplyScalar(look.shade);
  tiles.setColorAt(i, tmpColor);
  glowAttr.array[i] = look.glow;
  targetHeights[i] = look.height;

  const { x, y } = grid.coords(i);
  if (look.pool) {
    tmpPos.copy(cellToWorld(x, y)).setY(look.poolY ?? FLOOR_H + 0.04); // above curbs
    const ps = look.poolScale ?? 1;
    tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale.set(ps, 1, ps));
    pools.setColorAt(i, tmpColor.set(look.pool));
  } else {
    tmpMatrix.compose(ZERO, tmpQuat.identity(), tmpScale.set(0, 0, 0));
    pools.setColorAt(i, tmpColor.set(0x000000));
  }
  pools.setMatrixAt(i, tmpMatrix);
}

function writeTileMatrix(i) {
  const { x, y } = grid.coords(i);
  tmpPos.copy(cellToWorld(x, y)).setY(-BASE);
  tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale.set(1, Math.max(BASE + heights[i], 0.001), 1));
  tiles.setMatrixAt(i, tmpMatrix);
}

function refreshAll(instant = false) {
  recomputeLight();
  for (let i = 0; i < N; i++) refreshCell(i);
  if (instant) heights.set(targetHeights);
  for (let i = 0; i < N; i++) writeTileMatrix(i);
  refreshWaterAndBridges();
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

// Small-home reference: a ~9 x 8 m house (about 1.3 x 1.1 cells), ~3 m walls,
// hipped roof to ~6.5 m. Built centred on the origin.
const HOUSE_W = m(9), HOUSE_D = m(8);
function makeHouse({ ghost = false } = {}) {
  const g = new THREE.Group();
  const w = HOUSE_W, d = HOUSE_D;
  const wallMat = ghost
    ? new THREE.MeshBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.18, depthWrite: false })
    : new THREE.MeshLambertMaterial({ color: '#3b3a36' });
  const roofMat = ghost
    ? wallMat
    : new THREE.MeshLambertMaterial({ color: '#1c1f22' });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, m(3), d).translate(0, m(3) / 2, 0), wallMat);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(w * 0.78, m(3.5), 4).rotateY(Math.PI / 4).scale(1, 1, d / w).translate(0, m(3) + m(3.5) / 2, 0),
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
    win.position.set(-w / 4, m(1.6), d / 2 + 0.005);
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
  house.position.set(halfW + 3, 0, halfD - 2);
  surroundGroup.add(house);
  const porch = new THREE.PointLight('#ffb866', 2.2, 4, 1.6);
  porch.position.set(halfW + 3 - HOUSE_W / 4, m(2.6), halfD - 2 + HOUSE_D / 2 + m(1));
  surroundGroup.add(porch);

  // Fir forest: a ring starting ~17 m past the labels, ~150 m deep.
  // Mature Douglas firs: 20-40 m tall, crown about a third as wide as tall.
  const clear = m(17) + 1;
  const depth = m(150);
  const ringArea = (board.w + 2 * (clear + depth)) * (board.d + 2 * (clear + depth)) - (board.w + 2 * clear) * (board.d + 2 * clear);
  const spacing = m(6);
  const count = Math.min(4500, Math.round(ringArea / (spacing * spacing * 1.4)));
  const firs = new THREE.InstancedMesh(firGeo, firMat, count);
  firs.castShadow = true;
  firs.receiveShadow = true;
  const cellHash = new Map();
  const key = (x, z) => `${Math.floor(x / spacing)},${Math.floor(z / spacing)}`;
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
    const maturity = Math.min(1, (edge - clear) / m(40));
    const h = m(16 + 14 * maturity + rnd() * 14);   // 16-44 m
    const r = h * (0.15 + rnd() * 0.06);            // crown radius
    tmpMatrix.compose(
      tmpPos.set(x, 0, z),
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
    // Light spills between cells: also refresh any cell whose level changed.
    const oldLevels = lightLevels, oldLamps = lampsOn;
    recomputeLight();
    const dirty = new Set(indices);
    for (let i = 0; i < N; i++) {
      if (lightLevels[i] !== oldLevels[i] || lampsOn[i] !== oldLamps[i]) dirty.add(i);
    }
    for (const i of dirty) refreshCell(i);
    refreshWaterAndBridges();
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
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
let hoverIndex = -1;
let painting = null; // { pointerId, start:{x,y}, last:{x,y}, rect:boolean }
const activeTouches = new Set();

function pickCell(ev, { clamp = false } = {}) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
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

// --- Walls & doors tool --------------------------------------------------------
// Edges are drawn along grid lines: the pointer snaps to grid corners and each
// step between neighbouring corners sets one edge. A click without moving
// toggles the edge nearest the pointer. Rectangle mode outlines a room.

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_H);

// Pointer -> fractional grid coordinates on the floor (0..cols, 0..rows).
function gridPoint(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const p = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
  return p ? { gx: p.x / TILE + grid.cols / 2, gy: p.z / TILE + grid.rows / 2 } : null;
}
const clampV = (v) => ({
  x: THREE.MathUtils.clamp(Math.round(v.gx), 0, grid.cols),
  y: THREE.MathUtils.clamp(Math.round(v.gy), 0, grid.rows),
});
function nearestEdge(pt) {
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
const isDoorBrush = () => ['door', 'lockedDoor', 'oneWayDoor'].includes(ui.edgeBrush);
function edgeType(o, x, y, pt) {
  if (ui.edgeBrush === 'erase') return null;
  if (ui.edgeBrush !== 'oneWayDoor') return ui.edgeBrush;
  const fromLow = pt ? (o === 'v' ? pt.gx < x : pt.gy < y) : true; // pointer in the west/north cell
  return fromLow ? 'oneWayDoor+' : 'oneWayDoor-';
}

// Walk corner to corner, setting the edge for each unit step.
function drawEdgePath(a, b, pt) {
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
function edgeRect(a, b) {
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

// Highlight for the edge under the pointer.
const edgeMarker = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  new THREE.MeshBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.85, depthTest: false }),
);
edgeMarker.renderOrder = 11;
edgeMarker.visible = false;
scene.add(edgeMarker);
let hoverEdge = null;

function setHoverEdge(e) {
  hoverEdge = e;
  edgeMarker.visible = !!e;
  if (!e) return;
  const vertical = e.o === 'v';
  const cx = vertical ? e.x - grid.cols / 2 : e.x - grid.cols / 2 + 0.5;
  const cz = vertical ? e.y - grid.rows / 2 + 0.5 : e.y - grid.rows / 2;
  edgeMarker.position.set(cx, FLOOR_H, cz);
  const h = (ui.lowWalls ? WALL_LOW : WALL_FULL) + 0.02;
  edgeMarker.scale.set(vertical ? 0.1 : 1, h, vertical ? 1 : 0.1);
  edgeMarker.material.color.set({
    erase: '#e88a7f', door: '#f0b060', lockedDoor: '#d04a3a', oneWayDoor: '#6fd07a', window: '#9fd0e8',
  }[ui.edgeBrush] ?? '#f1d9a8');
}

const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function startEdgeStroke(ev) {
  const pt = gridPoint(ev);
  if (!pt) return;
  canvas.setPointerCapture(ev.pointerId);
  const rect = (ui.shape === 'rect' || ev.shiftKey) && !isDoorBrush();
  painting = { edges: true, pointerId: ev.pointerId, rect, moved: false, click: nearestEdge(pt), startPt: pt };
  grid.beginStroke();
  if (rect) {
    const cell = pickCell(ev, { clamp: true });
    painting.start = painting.last = cell;
    if (cell) edgeRect(cell, cell);
  } else {
    painting.lastV = clampV(pt);
  }
}

function moveEdgeStroke(ev) {
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

function endEdgeStroke() {
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

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.pointerType === 'touch') {
    activeTouches.add(ev.pointerId);
    if (activeTouches.size > 1 && painting) { cancelPainting(); return; }
  }
  if (ev.button !== 0 || !paintAllowed() || activeTouches.size > 1) return;
  if (ui.tool === 'walls') { startEdgeStroke(ev); return; }
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
  if (ui.tool === 'walls') {
    const rect = (ui.shape === 'rect' || ev.shiftKey) && !isDoorBrush();
    setHoverEdge(rect ? null : nearestEdge(gridPoint(ev)));
    setHover(rect ? cell : null);
    if (painting?.edges && ev.pointerId === painting.pointerId) moveEdgeStroke(ev);
    return;
  }
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
  if (painting.edges) endEdgeStroke();
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
canvas.addEventListener('pointerleave', () => { if (!painting) { setHover(null); setHoverEdge(null); } });

function setHover(cell) {
  hoverIndex = cell ? grid.index(cell.x, cell.y) : -1;
  hoverBox.visible = !!cell;
  updateHoverInfo();
}

function setTool(tool) {
  ui.tool = tool;
  $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  $('#cellTools').hidden = tool !== 'cells';
  $('#wallTools').hidden = tool !== 'walls';
  setHoverEdge(null);
  setHover(null);
}
function setEdgeBrush(name) {
  ui.edgeBrush = name;
  $$('[data-edge]').forEach((b) => b.classList.toggle('on', b.dataset.edge === name));
  if (hoverEdge) setHoverEdge(hoverEdge);
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
    TWO: THREE.TOUCH.DOLLY_PAN, // pinch zooms toward the fingers, drag pans
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
  $$('.brush[data-brush]').forEach((b) => b.classList.toggle('on', b.dataset.brush === name));
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

// Area brushes are generated from AREAS so new subcategories show up here.
{
  const keyFor = Object.fromEntries(Object.entries(BRUSH_KEYS).map(([k, v]) => [v, k]));
  const host = $('#areaBrushes');
  for (const [area, def] of Object.entries(AREAS)) {
    const group = document.createElement('div');
    group.className = 'area-group';
    group.innerHTML = `<span class="group-label">${def.label}</span><div class="area-grid"></div>`;
    for (const [sub, sdef] of Object.entries(def.subs)) {
      const id = `${area}:${sub}`;
      const look = SUB_LOOK[sub];
      const b = document.createElement('button');
      b.className = 'brush';
      b.dataset.brush = id;
      b.title = `${def.label}: ${sdef.label}${defaultWalkable(area, sub) ? '' : ' (blocked)'}`;
      const sw = look ? `<i class="sw" style="background:${look.unlit}"></i>` : `<i class="sw sw-${sub}"></i>`;
      b.innerHTML = `${sw}<span>${sdef.label}</span>${keyFor[id] ? `<kbd>${keyFor[id]}</kbd>` : ''}`;
      group.querySelector('.area-grid').appendChild(b);
    }
    host.appendChild(group);
  }
}
$$('.brush[data-brush]').forEach((b) => b.addEventListener('click', () => setBrush(b.dataset.brush)));
$$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$$('[data-edge]').forEach((b) => b.addEventListener('click', () => setEdgeBrush(b.dataset.edge)));
$$('[data-shape]').forEach((b) => b.addEventListener('click', () => setShape(b.dataset.shape)));
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$$('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.cam)));
$('#camMode').addEventListener('click', () => setOrbitMode(!ui.orbitMode));

$('#optLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; labelGroup.visible = ui.labels; });
$('#optAtmos').addEventListener('change', (e) => { ui.atmosphere = e.target.checked; applyAtmosphere(); });
$('#optGhost').addEventListener('change', (e) => { ui.ghost = e.target.checked; });
$('#optLowWalls').addEventListener('change', (e) => { ui.lowWalls = e.target.checked; refreshPropsAndWalls(); });

// Light source radius: the centre brightness follows the size of the light.
function syncRadius() {
  const r = ui.lightRadius;
  $('#lightRadiusOut').textContent = `${r} · ${Math.round(centreBrightness(r) * 100)}%`;
  $('#lightRadiusNote').textContent =
    `${lightKind(r)}: centre ${Math.round(centreBrightness(r) * 100)}% bright` +
    (r < 1 ? ', lights only its own cell.' : `, reaches ${r} cell${r === 1 ? '' : 's'} out. Walls block it; windows and doors let it through.`);
}
$('#lightRadius').max = MAX_RADIUS;
$('#lightRadius').addEventListener('input', (e) => {
  ui.lightRadius = Number(e.target.value);
  syncRadius();
  setTool('cells');
  setBrush('lit');
});
syncRadius();

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
  grid.replaceAll(grid.cols, grid.rows, Array.from({ length: N }, defaultCell), new Map());
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
    grid.replaceAll(data.cols, data.rows, data.cells, data.edges);
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
  const key = e.key.toLowerCase();
  if (BRUSH_KEYS[e.key]) { setTool('cells'); setBrush(BRUSH_KEYS[e.key]); }
  else if (['w', 'd', 'k', 'o', 'x', 'g'].includes(key)) {
    setTool('walls');
    setEdgeBrush({ w: 'wall', d: 'door', k: 'lockedDoor', o: 'oneWayDoor', x: 'erase', g: 'window' }[key]);
  }
  else if (e.key === 'r' || e.key === 'R') setShape(ui.shape === 'rect' ? 'brush' : 'rect');
  else if (e.key === 't' || e.key === 'T') setCamera('top');
  else if (e.key === 'a' || e.key === 'A') setCamera('angled');
  else if (key === 'f') focusHovered();
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
  if (hoverEdge && hoverIndex < 0) {
    const { o, x, y } = hoverEdge;
    const type = grid.edges.get(`${o}${x},${y}`);
    const names = grid.edgeCells(o, x, y).map((c) => (grid.inBounds(c.x, c.y) ? cellLabel(c.x, c.y) : 'edge'));
    el.innerHTML = `<span class="id">${names.join(' | ')}</span>` +
      `<span class="tag">${edgeLabel(o, x, y, type)}</span>` +
      (type ? `<span class="tag">${blocksLight(type) ? 'Blocks light' : 'Light passes'}</span>` : '');
    return;
  }
  if (hoverIndex < 0) { el.textContent = 'Hover a cell'; return; }
  const { x, y } = grid.coords(hoverIndex);
  const c = grid.cells[hoverIndex];
  el.innerHTML =
    `<span class="id">${cellLabel(x, y)}</span>` +
    `<span class="tag">${AREAS[c.area].label} · ${areaLabel(c)}</span>` +
    (c.bridge ? `<span class="tag">Bridge (spans ${grid.bridgeAxis(x, y) === 'x' ? 'E–W' : 'N–S'})</span>` : '') +
    `<span class="tag">${lightLabel(c, hoverIndex)}</span>` +
    `<span class="tag">${c.walkable ? 'Walkable' : 'Blocked'}</span>`;
}

function edgeLabel(o, x, y, type) {
  if (type?.startsWith('oneWayDoor')) {
    const [a, b] = grid.edgeCellsLabels(o, x, y).map((l) => l ?? 'edge');
    return type.endsWith('+') ? `One-way door ${a} → ${b}` : `One-way door ${b} → ${a}`;
  }
  return { door: 'Unlocked door', lockedDoor: 'Locked door', wall: 'Wall', window: 'Window' }[type] ?? 'Open';
}

function lightLabel(c, i) {
  const pct = `${Math.round(lightLevels[i] * 100)}%`;
  if (lampsOn[i]) return `Lit lamp · ${pct}`;
  if (c.lit) return `Light source r ${c.radius} (${lightKind(c.radius)}) · ${pct}`;
  return lightLevels[i] > 0 ? `Light ${pct}` : 'Dark';
}

function updateCounts() {
  const n = grid.counts();
  // Category totals, then every subcategory in use.
  const subs = [];
  for (const area in AREAS) {
    for (const sub in AREAS[area].subs) {
      if (n.subs[sub]) subs.push(`${AREAS[area].subs[sub].label} <b>${n.subs[sub]}</b>`);
    }
  }
  $('#counts').innerHTML =
    `Outdoor <b>${n.outdoor}</b> · Indoor <b>${n.indoor}</b> · Water <b>${n.water}</b><br>` +
    `<span class="sub-counts">${subs.join(' · ')}</span><br>` +
    `Bridges <b>${n.bridge}</b> · Walls <b>${n.wall}</b> · Windows <b>${n.window}</b> · Lit lamps <b>${n.lamp}</b><br>` +
    `Doors: unlocked <b>${n.door}</b> · locked <b>${n.lockedDoor}</b> · one-way <b>${n.oneWayDoor}</b><br>` +
    `Light sources <b>${n.lit}</b> · Lit cells <b>${lightLevels.reduce((k, v) => k + (v > 0), 0)}</b><br>` +
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
setEdgeBrush(ui.edgeBrush);
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
  // Zoom-to-cursor re-derives the target from the camera's facing after a
  // wheel zoom; switch it off while we animate the camera ourselves.
  controls.zoomToCursor = !camTween;
  controls.update();
  clampTarget();

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
    const top = visibleTop(hoverIndex);
    hoverBox.position.copy(cellToWorld(x, y));
    if (top < 0) {
      hoverBox.position.y = top - 0.01;
      hoverBox.scale.set(1, 0.03, 1);
    } else {
      hoverBox.scale.set(1, top + 0.02, 1);
    }
    // Ghost home covers the hovered cell and the cells right/below it.
    // Ghost home's north-west corner sits on the hovered cell's corner.
    ghostHouse.position.copy(cellToWorld(x, y)).add(tmpPos.set(HOUSE_W / 2 - 0.5 * TILE, FLOOR_H, HOUSE_D / 2 - 0.5 * TILE));
  }
  ghostHouse.visible = ui.ghost && hoverIndex >= 0;

  water.tick(clock.elapsedTime);
  updateTreeFade();
  if (atmos.visible) updateRain(dt);
  renderer.render(scene, camera);
});

// Handy for debugging / future tooling from the console.
window.gridPlanner = { grid, scene, camera, controls, brushes: BRUSHES };
