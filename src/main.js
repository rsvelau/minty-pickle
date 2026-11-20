import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  GridState, COLS, ROWS, MIN_SIZE, MAX_SIZE, AREAS, colLabel, cellLabel, defaultCell, defaultWalkable, areaLabel, parseEdgeKey, edgeKey,
  hasStreetLamp, lightKind, centreBrightness, MAX_RADIUS, blocksLight, MARKERS, FACINGS, FACING_NAMES,
} from './state.js';
import { createWaterSurface } from './water.js';
import { createProps } from './props.js';
import { METERS_PER_CELL, m } from './scale.js';
import { createStreets } from './street.js';
import { createBridges } from './bridge.js';
import { createClocktowers } from './clocktower.js';
import { dreadUniforms, swayUniforms, setLightSeeds, flickerize, flickerAt, swayFir } from './dread.js';
import { createPlay, defaultConfig, OBOLS, OBOL_TYPES, formatClock, obolCounts, INVENTORY_TABS, MONSTERS, monsterDef } from './play.js';
import { MONSTER_CARDS, MONSTER_BY_ID, MONSTER_POOLS, DAMAGE_KINDS } from './game/cards/monsters.js';
import { OBSERVATIONS, LAIRS, ATTACK_TYPES, evidenceLabel } from './game/cards/evidence.js';
import { matchesEvidence } from './game/mystery.js';
import { INJURY_TRACKS } from './game/cards/injuries.js';
import { createMarkers, drawMarkerIcon } from './markers.js';
import {
  installTerrain, setTerrain, terrainHeight, rayTerrain, isFlat, terrainId, TERRAIN_PRESETS,
  updateOverrides, terrainify, cellLevel, BRIDGE_SPAN, terrainSmoothAt,
} from './terrain.js';

// Elevation is applied to every material on the GPU; patch three's shader
// chunks before anything compiles.
installTerrain();

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
const WALL_T = 0.05;          // wall thickness (thin enough to rise with a levelled building)
const DOOR_W = m(1.2);        // door opening, centred on its edge
const DOOR_H = m(2.1);        // door height (lintel above when walls are full height)

// Per-subcategory surface colours (night) and tile heights. Street cells are
// drawn by src/street.js on top of a tile just below street level.
const SUB_LOOK = {
  ground: { unlit: '#4a6158', lit: '#9fbf8f', area: '#3e6b5a' },
  street: { unlit: '#34383b', lit: '#8a9599', area: '#4a5058', h: FLOOR_H - 0.01 },
  start: { unlit: '#34383b', lit: '#8a9599', area: '#e0b030', h: FLOOR_H - 0.01 },
  path: { unlit: '#544537', lit: '#b5946f', area: '#8c6a45' },
  cemetery: { unlit: '#33463a', lit: '#86a487', area: '#5b7f5f' },
  cemeteryPath: { unlit: '#5a564c', lit: '#b3ab92', area: '#a39a80' },
  forestCemetery: { unlit: '#24312a', lit: '#6f8f74', area: '#3f5a44' },
  forest: { unlit: '#1e2c24', lit: '#5f8566', area: '#24503a' },
  brambles: { unlit: '#2e2926', lit: '#7a6a5c', area: '#6b4a5e' },
  hardwood: { unlit: '#7a5338', lit: '#f0a85a', area: '#9a6a3e' },
  carpet: { unlit: '#58303a', lit: '#c4727c', area: '#8a3f52' },
  church: { unlit: '#5a4a3c', lit: '#d9a46c', area: '#6c5a8c' }, // worn oak boards
  condemned: { unlit: '#3a3430', lit: '#8a7a68', area: '#6a4a3e' },
  clocktower: { unlit: '#46443f', lit: '#a39d8e', area: '#b08850' }, // cobbled plaza
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
// Start space: paints the van's cell (facing chosen automatically). Using the
// brush on an existing start space turns the van to face the next way.
BRUSHES['outdoor:start'] = (c, i, g) => {
  if (c.sub === 'start') {
    const { x, y } = g.coords(i);
    const cur = g.startFacing(i);
    for (let k = 1; k <= 4; k++) {
      const f = (cur + k) % 4;
      if (g.inBounds(x + FACINGS[f][0], y + FACINGS[f][1])) return { facing: f };
    }
    return null;
  }
  return { area: 'outdoor', sub: 'start', bridge: false, walkable: false, facing: null };
};
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
  lowWalls: false,  // full-height walls by default; Low walls in the view menu cuts them away
  lightRadius: 1,      // radius for the Light source brush (cells)
  markerBrush: 'investigation', // marker the Markers tool places ('erase' removes)
  showMarkers: true,
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

let hoverIndex = -1; // cell under the pointer (-1 = none)

const rand32 = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------------------------------------------------------------------------
// Renderer / scene / camera
// ---------------------------------------------------------------------------

// Bridge piers stretch from bed to deck when a river is lowered.
BRIDGE_SPAN.bed = BED_H;
BRIDGE_SPAN.deck = DECK_TOP;
setTerrain(grid.terrain);
// Exported ground elevation (metres) per cell, including levelled lakes,
// rivers and buildings.
grid.elevationAt = (x, y) => cellLevel(x, y) * METERS_PER_CELL;

const container = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // replaced by applyQuality below
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
const hemi = new THREE.HemisphereLight('#56627a', '#181a18', 2.4);
scene.add(hemi);
const moon = new THREE.DirectionalLight('#a9bcff', 1.8);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
moon.shadow.bias = -0.0008;
scene.add(moon);
scene.add(moon.target);

// --- Quality (per device) ------------------------------------------------------
// Phones run this for a whole game night, so heat and battery matter more
// than peak frame rate. Each level sets the render resolution, shadows, how
// many trees surround the town, how much rain falls, and the "idle" frame
// rate used while nothing is moving (see the render loop at the bottom).
const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowSize: 1024, trees: 0.35, rain: 0.35, idleFps: 12 },
  medium: { pixelRatio: 1.5, shadows: true, shadowSize: 1024, trees: 0.65, rain: 0.6, idleFps: 20 },
  high: { pixelRatio: 2, shadows: true, shadowSize: 2048, trees: 1, rain: 1, idleFps: 30 },
};
const QUALITY_KEY = 'minty-pickle.quality';
const isPhoneish = () => window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
let qualityName = (() => {
  try { const q = localStorage.getItem(QUALITY_KEY); if (QUALITY[q]) return q; } catch { /* ignore */ }
  return isPhoneish() ? 'medium' : 'high';
})();
let quality = QUALITY[qualityName];
function applyQuality(name) {
  qualityName = QUALITY[name] ? name : 'high';
  quality = QUALITY[qualityName];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (renderer.shadowMap.enabled !== quality.shadows) {
    renderer.shadowMap.enabled = quality.shadows;
    moon.castShadow = quality.shadows;
    // Materials compile differently with shadows on or off.
    scene.traverse((o) => { for (const mat of [].concat(o.material ?? [])) mat.needsUpdate = true; });
  }
  if (moon.shadow.mapSize.x !== quality.shadowSize) {
    moon.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    moon.shadow.map?.dispose();
    moon.shadow.map = null;
  }
  if (typeof surroundFirs !== 'undefined' && surroundFirs) surroundFirs.count = Math.round(surroundFirsPlaced * quality.trees);
  document.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('on', b.dataset.quality === qualityName));
  wake();
}

// --- Render on demand ------------------------------------------------------------
// The scene redraws at full rate only while something is happening: the
// camera or a finger moving, a runner jogging, dice tumbling, a marker
// burst, a camera tween, tiles easing, midnight setting in. Otherwise it
// ticks over at the quality's idle rate (rain, water and flicker keep going,
// just more slowly), which keeps phones cool. wake(ms) asks for full rate.
let wakeUntil = 0;
function wake(ms = 1200) { wakeUntil = Math.max(wakeUntil, performance.now() + ms); }

// ---------------------------------------------------------------------------
// Shared materials / geometry
// ---------------------------------------------------------------------------

const cellToWorld = (x, y) => new THREE.Vector3(
  (x - grid.cols / 2 + 0.5) * TILE, 0, (y - grid.rows / 2 + 0.5) * TILE,
);

const slabMat = new THREE.MeshLambertMaterial({ color: '#07090b' });
const groundMat = new THREE.MeshLambertMaterial({ color: '#0b100e' });
// Forest floor: hidden over the board (and, for the outer ring, over the
// inner ground) so sunken water and the board edge show through.
const groundHole = { value: new THREE.Vector2(1, 1) };
const outerHole = { value: new THREE.Vector2(1, 1) };
function holedGround(hole) {
  const mat = new THREE.MeshLambertMaterial({ color: '#0b100e' });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHole = hole;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;\nuniform vec2 uHole;')
      .replace('void main() {', 'void main() {\n  if (abs(vGroundXZ.x) < uHole.x && abs(vGroundXZ.y) < uHole.y) discard;');
  };
  return mat;
}
const innerGroundMat = holedGround(groundHole);
const outerGroundMat = holedGround(outerHole);

const tileGeoBase = new THREE.BoxGeometry(INSET * TILE, 1, INSET * TILE).translate(0, 0.5, 0); // origin at bottom
const tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
// Bridge decks share the tile shader but stay at bank level on slopes.
const deckMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const railMat = new THREE.MeshLambertMaterial({ color: '#8a8e92' });
tileMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
    // Glow only on top faces, so a lit tile's sides don't shine through the
    // gaps between cells.
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow * step(0.5, normal.y);');
  // Lit cells emit their own colour so they stay bright regardless of moonlight.
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlow;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;');
};

deckMat.onBeforeCompile = tileMat.onBeforeCompile;
terrainify(deckMat, { bridge: true });
// Lit cells flicker with their light source at midnight (src/dread.js).
flickerize(tileMat, { part: 'emissive' });
flickerize(deckMat, { part: 'emissive' });
terrainify(railMat, { bridge: true });

// Soft light pools that spill past lit cells onto their neighbours.
const poolMat = new THREE.MeshBasicMaterial({
  map: makeRadialTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2,
});
flickerize(poolMat);
const poolGeo = new THREE.PlaneGeometry(2.6 * TILE, 2.6 * TILE).rotateX(-Math.PI / 2);

// Unit box with its base at y = 0 (walls, door leaves).
const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
// Every wall has two faces, each with its own colour and texture: the face
// toward the west/north cell (aNegColor, aWallTex) and the face toward the
// east/south cell (aPosColor, aPosTex). Textures are drawn in the shader in
// metres along the wall. Exterior: 0 clapboard, 1 brick, 2 board-and-batten,
// 3 worn plaster, 4 cedar shingle. Interior: 5 striped wallpaper, 6 floral
// wallpaper, 7 oak wainscot under plaster, 8 beadboard, 9 walnut panelling
// (and 3 plaster).
const wallMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
wallMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aWallTex;
      attribute float aPosTex;
      attribute vec3 aNegColor;
      attribute vec3 aPosColor;
      varying float vWallTex;
      varying vec3 vWallCol;
      varying vec3 vWallP;`)
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wallW = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wallW = instanceMatrix * wallW;
      #endif
      vWallP = (modelMatrix * wallW).xyz;
      // Which face: walls are axis-aligned, so the face normal points east/
      // south (+) or west/north (-); tops and ends take the west/north look.
      float wallSide = normal.x + normal.z;
      vWallTex = wallSide > 0.5 ? aPosTex : aWallTex;
      vWallCol = wallSide > 0.5 ? aPosColor : aNegColor;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying float vWallTex;
      varying vec3 vWallCol;
      varying vec3 vWallP;
      float wallHash(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
      float wallNoise(vec2 v) {
        vec2 i = floor(v), f = fract(v);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(wallHash(i), wallHash(i + vec2(1.0, 0.0)), f.x),
                   mix(wallHash(i + vec2(0.0, 1.0)), wallHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float wallPattern(vec3 wp, float tex) {
        float a = (wp.x + wp.z) * ${METERS_PER_CELL.toFixed(1)};   // metres along the wall
        float y = wp.y * ${METERS_PER_CELL.toFixed(1)};            // metres up
        float grime = 0.92 + 0.1 * wallNoise(vec2(a * 0.6, y * 0.8)) - 0.06 * (1.0 - smoothstep(0.0, 0.6, y));
        if (tex < 0.5) {            // clapboard: lapped boards with a shadow line under each
          float f = fract(y / 0.22);
          return grime * mix(0.74, 1.0, smoothstep(0.0, 0.3, f)) * (0.96 + 0.06 * wallNoise(vec2(a * 3.0, floor(y / 0.22))));
        } else if (tex < 1.5) {     // brick in running bond, pale mortar
          float bh = 0.15, bw = 0.42;
          float row = floor(y / bh);
          float u = a / bw + 0.5 * mod(row, 2.0);
          float mortar = max(step(fract(y / bh), 0.12), step(fract(u), 0.06));
          float brick = 0.82 + 0.22 * wallHash(vec2(floor(u), row));
          return grime * mix(brick, 1.35, mortar);
        } else if (tex < 2.5) {     // board-and-batten: wide boards, raised battens
          float f = fract(a / 0.6);
          float batten = step(f, 0.1);
          float shade = mix(1.0, 0.86, smoothstep(0.1, 0.16, f) * (1.0 - smoothstep(0.16, 0.3, f)));
          return grime * (batten > 0.5 ? 1.08 : shade) * (0.95 + 0.08 * wallNoise(vec2(a * 0.8, y * 4.0)));
        } else if (tex < 3.5) {     // worn plaster: mottled, stained, a few cracks
          float mottle = 0.86 + 0.16 * wallNoise(vec2(a * 2.2, y * 2.2)) + 0.06 * wallNoise(vec2(a * 9.0, y * 9.0));
          float stain = 1.0 - 0.12 * smoothstep(0.55, 0.9, wallNoise(vec2(a * 0.7, y * 0.35)));
          return grime * mottle * stain;
        }
        // cedar shingles: staggered courses of uneven shingles
        float ch = 0.3;
        float row = floor(y / ch);
        float u = a / 0.24 + 0.5 * mod(row, 2.0) + 0.3 * wallHash(vec2(row, 3.0));
        float fy = fract(y / ch);
        float gap = step(fract(u), 0.05);
        float sh = 0.8 + 0.25 * wallHash(vec2(floor(u), row));
        return grime * mix(0.7, sh, smoothstep(0.0, 0.25, fy)) * (1.0 - 0.3 * gap);
      }
      // Interior finishes (a tint, so wainscot can be wood under plaster).
      vec3 wallInterior(vec3 wp, float tex) {
        float a = (wp.x + wp.z) * ${METERS_PER_CELL.toFixed(1)};
        float y = wp.y * ${METERS_PER_CELL.toFixed(1)};
        float age = 0.94 + 0.08 * wallNoise(vec2(a * 0.9, y * 0.9));
        if (tex < 5.5) {            // striped wallpaper, a pinstripe at each seam
          float s = fract(a / 0.14);
          float v = mix(0.9, 1.04, step(0.5, s)) - 0.1 * step(abs(s - 0.5), 0.03);
          return vec3(v * age);
        } else if (tex < 6.5) {     // small floral print in a half-drop repeat
          vec2 uv = vec2(a / 0.3, y / 0.3);
          uv.x += 0.5 * mod(floor(uv.y), 2.0);
          float d = length(fract(uv) - 0.5);
          float flower = 1.0 - smoothstep(0.08, 0.13, d);
          float ring = 1.0 - smoothstep(0.015, 0.04, abs(d - 0.2));
          return vec3((1.02 - 0.2 * flower - 0.08 * ring) * age);
        } else if (tex < 7.5) {     // oak wainscot, chair rail, plaster above
          if (y < 0.88) {
            float grain = 0.88 + 0.16 * wallNoise(vec2(a * 0.6, y * 18.0));
            float groove = 1.0 - 0.3 * step(fract(a / 0.5), 0.04);
            return vec3(0.56, 0.41, 0.3) * grain * groove;
          }
          if (y < 0.96) return vec3(0.42, 0.3, 0.22);
          return vec3(age * (0.96 + 0.05 * wallNoise(vec2(a * 3.0, y * 3.0))));
        } else if (tex < 8.5) {     // painted beadboard: narrow tongue-and-groove
          float g = fract(a / 0.1);
          return vec3((1.0 - 0.22 * step(g, 0.12) + 0.05 * step(0.5, g) * (1.0 - step(0.6, g))) * age);
        }
        // walnut panelling: stiles and rails framing sunken panels
        float sx = fract(a / 0.75), sy = fract((y - 0.12) / 0.9);
        float frame = max(step(sx, 0.12), max(step(sy, 0.1), step(0.92, sy)));
        float bevel = (1.0 - frame) * (smoothstep(0.12, 0.17, sx) * (1.0 - smoothstep(0.87, 0.92, sx))) ;
        float grain = 0.86 + 0.18 * wallNoise(vec2(a * 0.5, y * 14.0));
        return vec3(grain * (frame > 0.5 ? 1.05 : mix(0.8, 0.95, bevel)));
      }
      vec3 wallTint(vec3 wp, float tex) {
        return tex < 4.5 ? vec3(wallPattern(wp, tex)) : wallInterior(wp, tex);
      }`)
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vWallCol * wallTint(vWallP, vWallTex);');
};
wallMat.customProgramCacheKey = () => 'walls-textured';
const doorMat = new THREE.MeshLambertMaterial({ color: '#d08a40', emissive: '#5a3414' });
// Storefront windows: painted frames (instance colour), and glass that is
// dark, or glows warm when light reaches either side.
const frameMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
const glassDarkMat = new THREE.MeshLambertMaterial({ color: '#2b3c46', transparent: true, opacity: 0.6, depthWrite: false });
const glassLitMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.78, depthWrite: false });
flickerize(glassLitMat);
const FRAME_COLOURS = ['#1f3a2e', '#5a1f1c', '#1b1b1d', '#c8bfa6', '#2a3550']; // green, oxblood, black, cream, navy
// Muted, old-town building finishes. Every building (connected indoor
// cells) gets exactly one: wall colour and texture, plus one window design
// and frame colour, so nothing on a building looks mismatched.
const BUILDING_STYLES = [
  { name: 'Faded barn-red clapboard', colour: '#a8705e', tex: 0 },
  { name: 'Weathered olive clapboard', colour: '#949e7a', tex: 0 },
  { name: 'Dusty mustard clapboard', colour: '#cdb984', tex: 0 },
  { name: 'Old cream clapboard', colour: '#ddd3b8', tex: 0 },
  { name: 'Slate-blue clapboard', colour: '#8a97a6', tex: 0 },
  { name: 'Red-brown brick', colour: '#a8684f', tex: 1 },
  { name: 'Soot-dark brick', colour: '#86594a', tex: 1 },
  { name: 'Sage board-and-batten', colour: '#a8b39c', tex: 2 },
  { name: 'Grey-brown board-and-batten', colour: '#a39684', tex: 2 },
  { name: 'Worn plaster', colour: '#c3bcab', tex: 3 },
  { name: 'Cedar shingle', colour: '#9a7658', tex: 4 },
];
// Interior finishes, one per building (walls facing into it), independent
// of its exterior.
const INTERIOR_STYLES = [
  { name: 'Faded rose striped wallpaper', colour: '#cfaaa2', tex: 5 },
  { name: 'Sage striped wallpaper', colour: '#b0bca0', tex: 5 },
  { name: 'Yellowed floral wallpaper', colour: '#d8c99e', tex: 6 },
  { name: 'Dusty blue floral wallpaper', colour: '#a6b7c6', tex: 6 },
  { name: 'Oak wainscot and cream plaster', colour: '#e0d4b8', tex: 7 },
  { name: 'Mint beadboard', colour: '#bccfb8', tex: 8 },
  { name: 'Nicotine-stained plaster', colour: '#cdbd92', tex: 3 },
  { name: 'Grey-green plaster', colour: '#aeb4a2', tex: 3 },
  { name: 'Dark walnut panelling', colour: '#8a6648', tex: 9 },
];
const hash32 = (n) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};
// A building's look, from its first cell (so it stays put as you paint).
function buildingStyle(seed) {
  const h = hash32(seed * 2654435761 + 1013904223);
  const s = BUILDING_STYLES[h % BUILDING_STYLES.length];
  return { ...s, windowVariant: (h >>> 8) % 4, frame: FRAME_COLOURS[(h >>> 12) % FRAME_COLOURS.length] };
}
function interiorStyle(seed) {
  return INTERIOR_STYLES[hash32(seed * 40503 + 2246822519) % INTERIOR_STYLES.length];
}
// Which building each cell belongs to: the lowest cell index of its
// building (-1 outdoors). A building is indoor floor joined by open floor or
// doors; a wall or window between two floors splits them, so a row of shops
// sharing walls gets a different look per shop.
function buildingSeeds() {
  const seeds = new Int32Array(grid.cells.length).fill(-1);
  const auto = grid.autoEdges();
  const passable = (t) => !t || t === 'door' || t === 'lockedDoor' || t === 'boardedDoor' || t.startsWith('oneWayDoor');
  for (let i = 0; i < grid.cells.length; i++) {
    if (seeds[i] >= 0 || grid.cells[i].area !== 'indoor') continue;
    seeds[i] = i;
    const queue = [i];
    while (queue.length) {
      const { x, y } = grid.coords(queue.pop());
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!grid.inBounds(x + dx, y + dy)) continue;
        const k = grid.index(x + dx, y + dy);
        if (seeds[k] >= 0 || grid.cells[k].area !== 'indoor') continue;
        const ek = dx ? edgeKey('v', dx > 0 ? x + 1 : x, y) : edgeKey('h', x, dy > 0 ? y + 1 : y);
        if (!passable(grid.edges.get(ek) ?? auto.get(ek))) continue;
        seeds[k] = i;
        queue.push(k);
      }
    }
  }
  return seeds;
}
// Walls, doors, windows and foundations are placed at their final height on
// the CPU (see edgeBase) and stand perfectly upright: the terrain doesn't
// bend them.


// ---------------------------------------------------------------------------
// Board (rebuilt whenever the dimensions change)
// ---------------------------------------------------------------------------

let N = 0;
let clocktowers;
let tiles, pools, glowAttr, slab, ground, decks, deckGlow, rails;
let walls, doorLeaves, frames, glassDark, glassLit, foundations;
const foundationMat = new THREE.MeshLambertMaterial({ color: '#615b51' });
for (const mat of [wallMat, doorMat, frameMat, glassDarkMat, glassLitMat, foundationMat]) terrainify(mat, { none: true });

// Where an edge piece stands. On the edge of an indoor floor it stands on
// that (level) floor; elsewhere on the average ground of the two cells.
// `drop` is how far below that the ground falls anywhere along the edge, so
// walls can reach down to it with no gap.
function edgeBase(o, x, y) {
  const sides = grid.edgeCells(o, x, y).filter((c) => grid.inBounds(c.x, c.y)).map((c) => ({
    level: cellLevel(c.x, c.y),
    indoor: grid.cells[grid.index(c.x, c.y)].area === 'indoor',
  }));
  if (!sides.length) return { base: 0, drop: 0 };
  const indoor = sides.filter((s) => s.indoor);
  const base = indoor.length
    ? Math.max(...indoor.map((s) => s.level))
    : sides.reduce((a, s) => a + s.level, 0) / sides.length;
  const ends = o === 'v' ? [[x, y], [x, y + 1]] : [[x, y], [x + 1, y]];
  const lows = [
    ...sides.map((s) => s.level),
    ...ends.map(([gx, gy]) => terrainSmoothAt(gx - grid.cols / 2, gy - grid.rows / 2)),
  ];
  return { base, drop: Math.max(0, base - Math.min(...lows)) };
}
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

  // Forest floor level with the town. Near the board it is finely divided so
  // it follows the elevation; further out a coarse ring runs into the fog.
  // Both are hidden over what they surround (sunken water shows through).
  const hw = board.w / 2 + 0.2, hd = board.d / 2 + 0.2;
  groundHole.value.set(hw, hd);
  const innerW = board.w + 64, innerD = board.d + 64;
  outerHole.value.set(innerW / 2 - 0.5, innerD / 2 - 0.5);
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(innerW, innerD, Math.ceil(innerW * 2), Math.ceil(innerD * 2)).rotateX(-Math.PI / 2),
    innerGroundMat,
  );
  ground.receiveShadow = true;
  boardGroup.add(ground);
  const outerSize = 2 * (board.radius + 260);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(outerSize, outerSize, 140, 140).rotateX(-Math.PI / 2), outerGroundMat);
  outer.position.y = -0.04;
  outer.receiveShadow = true;
  boardGroup.add(outer);

  // Water surface + its per-cell textures.
  water.resize(cols, rows);
  water.mesh.position.y = WATER_Y;

  // Bridge decks: one per cell (hidden unless that cell is a bridge).
  const deckGeo = new THREE.BoxGeometry(TILE, DECK_T, TILE).translate(0, -DECK_T / 2, 0);
  deckGlow = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  deckGeo.setAttribute('aGlow', deckGlow);
  decks = new THREE.InstancedMesh(deckGeo, deckMat, N);
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
  rails = new THREE.InstancedMesh(railGeo, railMat, N * 4);
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
  clocktowers?.clear();
  clocktowers = createClocktowers(boardGroup);

  // Walls and doors on cell edges (a door = two short wall pieces, an
  // optional lintel, and an open door leaf).
  const maxEdges = 2 * N + cols + rows;
  // Walls get their own box geometry with a per-instance texture index.
  const wallGeo = unitBoxGeo.clone();
  const wallN = maxEdges * 3;
  wallGeo.setAttribute('aWallTex', new THREE.InstancedBufferAttribute(new Float32Array(wallN), 1));
  wallGeo.setAttribute('aPosTex', new THREE.InstancedBufferAttribute(new Float32Array(wallN), 1));
  wallGeo.setAttribute('aNegColor', new THREE.InstancedBufferAttribute(new Float32Array(wallN * 3), 3));
  wallGeo.setAttribute('aPosColor', new THREE.InstancedBufferAttribute(new Float32Array(wallN * 3), 3));
  walls = new THREE.InstancedMesh(wallGeo, wallMat, wallN);
  doorLeaves = new THREE.InstancedMesh(unitBoxGeo, doorMat, maxEdges * 2);
  frames = new THREE.InstancedMesh(unitBoxGeo, frameMat, maxEdges * 9);
  foundations = new THREE.InstancedMesh(unitBoxGeo, foundationMat, maxEdges);
  glassDark = new THREE.InstancedMesh(unitBoxGeo, glassDarkMat, maxEdges);
  glassLit = new THREE.InstancedMesh(unitBoxGeo, glassLitMat, maxEdges);
  glassDark.renderOrder = glassLit.renderOrder = 3;
  for (const mesh of [walls, doorLeaves, frames, glassDark, glassLit, foundations]) {
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
  updateOverrides(grid);
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
  refreshMarkers();
  for (const mat of bridges.materials) terrainify(mat, { bridge: true });
  scene.traverse((o) => { for (const mat of [].concat(o.material ?? [])) terrainify(mat); });
}

// Gameplay markers float over their cells in every view.
const markers = createMarkers(scene);
// Markers the play demo has collected or used (set once the demo exists).
let markerUsed = () => false;
let markerHidden = () => false; // objectives stay hidden in play until midnight
function refreshMarkers() {
  const list = [];
  grid.cells.forEach((c, i) => {
    if (!c.marker || markerHidden(i)) return;
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    list.push({ type: c.marker, x: p.x, y: Math.max(visibleTop(i), WATER_Y) + terrainHeight(p.x, p.z, { bridge: c.bridge }), z: p.z, dim: !c.walkable, faded: markerUsed(i) });
  });
  markers.update(list);
  markers.setVisible(ui.showMarkers);
  refreshKeyHighlight();
}

// Hovering a key marker outlines every door it would unlock.
const keyHighlight = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.85, depthTest: false }),
  256,
);
keyHighlight.renderOrder = 13;
terrainify(keyHighlight.material, { none: true });
keyHighlight.raycast = () => {};
keyHighlight.count = 0;
scene.add(keyHighlight);
function refreshKeyHighlight() {
  let n = 0;
  if (hoverIndex >= 0 && hoverIndex < N && grid.cells[hoverIndex].marker === 'key' && ui.showMarkers) {
    const h = (ui.lowWalls ? WALL_LOW : WALL_FULL) + 0.05;
    for (const k of grid.keyDoors(hoverIndex).slice(0, 256)) {
      const { o, x, y } = parseEdgeKey(k);
      const vertical = o === 'v';
      const cx = vertical ? x - grid.cols / 2 : x - grid.cols / 2 + 0.5;
      const cz = vertical ? y - grid.rows / 2 + 0.5 : y - grid.rows / 2;
      tmpMatrix.compose(tmpPos.set(cx, FLOOR_H + edgeBase(o, x, y).base, cz), tmpQuat.identity(),
        vertical ? tmpScale.set(0.2, h, 0.6) : tmpScale.set(0.6, h, 0.2));
      keyHighlight.setMatrixAt(n++, tmpMatrix);
    }
  }
  keyHighlight.count = n;
  keyHighlight.instanceMatrix.needsUpdate = true;
}

// Props on cells (main view only) and walls/doors on edges (every view).
function refreshPropsAndWalls() {
  clocktowers.update({
    visible: ui.view === 'all',
    anchors: grid.clocktowers().map((i) => {
      const { x, y } = grid.coords(i);
      const p = cellToWorld(x, y);
      return { x: p.x + TILE / 2, y: targetHeights[i], z: p.z + TILE / 2 };
    }),
  });
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
  // Each edge takes the style of the building it belongs to (the indoor cell
  // on either side); edges with no building beside them use their own hash.
  const seeds = buildingSeeds();
  const wa = walls.geometry.attributes;
  // The two faces of the current edge, and its building's style (windows).
  let style = BUILDING_STYLES[0];
  let faceNeg = style, facePos = style;
  const seedOf = (c) => (grid.inBounds(c.x, c.y) ? seeds[grid.index(c.x, c.y)] : -1);
  // A face looking into a building shows that building's interior; a face
  // looking outdoors shows the exterior of the building it belongs to.
  const edgeFaces = (o, x, y) => {
    const [ca, cb] = grid.edgeCells(o, x, y);
    const sa = seedOf(ca), sb = seedOf(cb);
    const own = sa >= 0 ? sa : sb >= 0 ? sb : 100000 + (o === 'v' ? 1 : 2) * 7919 + x * 131 + y;
    style = buildingStyle(own);
    faceNeg = sa >= 0 ? interiorStyle(sa) : sb >= 0 ? buildingStyle(sb) : style;
    facePos = sb >= 0 ? interiorStyle(sb) : sa >= 0 ? buildingStyle(sa) : style;
  };
  let EY = 0, DROP = 0; // current edge: floor level, and how far the ground falls below it
  const piece = (cx, cz, along, len, base, height, vertical) => {
    // `along` is the offset along the edge from its centre. Pieces standing
    // on the floor reach down to the lowest ground under the edge.
    const px = vertical ? cx : cx + along;
    const pz = vertical ? cz + along : cz;
    const extra = base <= FLOOR_H + 1e-6 ? DROP : 0;
    tmpMatrix.compose(
      tmpPos.set(px, base + EY - extra, pz),
      tmpQuat.identity(),
      vertical ? tmpScale.set(WALL_T, height + extra, len) : tmpScale.set(len, height + extra, WALL_T),
    );
    walls.setMatrixAt(nw, tmpMatrix);
    tmpColor.set(faceNeg.colour).toArray(wa.aNegColor.array, nw * 3);
    tmpColor.set(facePos.colour).toArray(wa.aPosColor.array, nw * 3);
    wa.aWallTex.array[nw] = faceNeg.tex;
    wa.aPosTex.array[nw++] = facePos.tex;
  };
  let nf = 0, ngd = 0, ngl = 0;
  // A box along the edge into any instanced mesh (`colour` for frames).
  const strip = (mesh, n, cx, cz, along, len, y0, y1, thick, vertical, colour) => {
    const px = vertical ? cx : cx + along;
    const pz = vertical ? cz + along : cz;
    tmpMatrix.compose(
      tmpPos.set(px, y0 + EY, pz), tmpQuat.identity(),
      vertical ? tmpScale.set(thick, y1 - y0, len) : tmpScale.set(len, y1 - y0, thick),
    );
    mesh.setMatrixAt(n, tmpMatrix);
    if (colour) mesh.setColorAt(n, tmpColor.set(colour));
  };
  // Boards nailed across an opening, as a box in the wall plane rotated by
  // `tilt` (radians, about the wall's normal).
  const board = (cx, cz, along, yMid, len, h, thick, vertical, tilt, colour) => {
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, vertical ? Math.PI / 2 : 0)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
    tmpMatrix.compose(
      tmpPos.set(vertical ? cx : cx + along, yMid + EY - h / 2 * 0, vertical ? cz + along : cz),
      q, tmpScale.set(len, h, thick),
    );
    // unitBoxGeo has its base at y = 0: shift so the board is centred.
    tmpMatrix.multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0));
    frames.setMatrixAt(nf, tmpMatrix);
    frames.setColorAt(nf++, tmpColor.set(colour));
  };
  const PLY = '#a08660', PLANK = '#6e5638';
  // In the play demo, doors whose key has been collected are drawn unlocked.
  const unlockedNow = ui.tool === 'play' && typeof play !== 'undefined' ? play.unlockedEdges() : new Set();
  for (const [k, type0] of grid.allEdges()) {
    const unlockedDoor = unlockedNow.has(k) && (type0 === 'lockedDoor' || type0.startsWith('oneWayDoor'));
    const type = unlockedDoor ? 'door' : type0;
    const { o, x, y } = parseEdgeKey(k);
    const vertical = o === 'v';
    const cx = vertical ? x - grid.cols / 2 : x - grid.cols / 2 + 0.5;
    const cz = vertical ? y - grid.rows / 2 + 0.5 : y - grid.rows / 2;
    ({ base: EY, drop: DROP } = edgeBase(o, x, y));
    edgeFaces(o, x, y);
    if (type === 'wall') {
      piece(cx, cz, 0, TILE + WALL_T, FLOOR_H, H, vertical);
      continue;
    }
    if (type === 'window') {
      // Storefront: masonry piers at the ends, a painted wooden bulkhead
      // under a big glass pane, mullions/transom by variant, a header above.
      // One window design and frame colour per building.
      const variant = style.windowVariant;
      const colour = style.frame;
      const pier = m(0.35);
      const sill = ui.lowWalls ? m(0.3) : m(0.6);
      const head = m(2.8);
      const top = Math.min(head, H);
      const inner = TILE - 2 * pier;
      piece(cx, cz, -(TILE / 2 - pier / 2), pier + WALL_T, FLOOR_H, H, vertical);
      piece(cx, cz, TILE / 2 - pier / 2, pier + WALL_T, FLOOR_H, H, vertical);
      if (H > head) piece(cx, cz, 0, inner, FLOOR_H + head, H, vertical);
      strip(frames, nf++, cx, cz, 0, inner, FLOOR_H, FLOOR_H + sill, WALL_T, vertical, colour); // bulkhead
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
    if (type === 'boardedWindow' || type === 'boardedDoor') {
      // Condemned: the opening is sheeted with weathered plywood and nailed
      // across with planks.
      const door = type === 'boardedDoor';
      const open = door ? DOOR_W : TILE - 2 * m(0.35);
      const side = (TILE - open) / 2;
      const y0 = door ? 0 : (ui.lowWalls ? m(0.3) : m(0.6));
      const y1 = Math.min(door ? DOOR_H : m(2.8), H);
      piece(cx, cz, -(open / 2 + side / 2), side + WALL_T, FLOOR_H, H, vertical);
      piece(cx, cz, open / 2 + side / 2, side + WALL_T, FLOOR_H, H, vertical);
      if (y0 > 0) piece(cx, cz, 0, open, FLOOR_H, y0, vertical);
      if (H > y1) piece(cx, cz, 0, open, FLOOR_H + y1, H - y1, vertical);
      strip(frames, nf++, cx, cz, 0, open, FLOOR_H + y0, FLOOR_H + y1, WALL_T * 0.9, vertical, PLY);
      const hgt = y1 - y0, mid = FLOOR_H + (y0 + y1) / 2;
      const diag = Math.hypot(open, hgt) * 0.86;
      const ang = Math.atan2(hgt, open);
      board(cx, cz, 0, mid, diag, m(0.16), WALL_T * 1.25, vertical, ang, PLANK);
      board(cx, cz, 0, mid, diag, m(0.16), WALL_T * 1.25, vertical, -ang, PLANK);
      board(cx, cz, 0, FLOOR_H + y0 + hgt * 0.78, open * 0.96, m(0.16), WALL_T * 1.3, vertical, 0.04, PLANK);
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
    // An unlocked door is thrown wide open (further than a plain door).
    const swing = unlockedDoor ? 1.45 : type === 'door' ? 1.2 : oneWay ? 0.5 * sign : 0;
    const leafH = Math.min(DOOR_H, H) * 0.98;
    const hingeAlong = -DOOR_W / 2;
    const hx = vertical ? cx : cx + hingeAlong;
    const hz = vertical ? cz + hingeAlong : cz;
    const angle = vertical ? -Math.PI / 2 + swing : -swing;
    const dir = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    tmpMatrix.compose(
      tmpPos.set(hx + dir.x * DOOR_W / 2, FLOOR_H + EY, hz + dir.z * DOOR_W / 2),
      tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle),
      tmpScale.set(DOOR_W, leafH, 0.05),
    );
    if (unlockedDoor) {
      // Unlocked: the leaf is drawn in pale green (frames mesh takes a colour).
      frames.setMatrixAt(nf, tmpMatrix);
      frames.setColorAt(nf++, tmpColor.set('#7fcf8f'));
    } else {
      doorLeaves.setMatrixAt(nd++, tmpMatrix);
    }
    // Rotated marker box into the frames mesh (instance colour).
    const mark = (px, py, pz, sx, sy, sz, rot, colour) => {
      tmpMatrix.compose(tmpPos.set(px, py + EY, pz), tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot), tmpScale.set(sx, sy, sz));
      frames.setMatrixAt(nf, tmpMatrix);
      frames.setColorAt(nf++, tmpColor.set(colour));
    };
    const edgeRot = vertical ? Math.PI / 2 : 0; // a box's x axis along the edge
    if (unlockedDoor) {
      // Bright green threshold and an open padlock hanging on the jamb.
      mark(cx, FLOOR_H, cz, DOOR_W, 0.018, 0.32, edgeRot, '#3fd06a');
      const jx = vertical ? cx : cx + DOOR_W / 2, jz = vertical ? cz + DOOR_W / 2 : cz;
      mark(jx, FLOOR_H + leafH * 0.45, jz, m(0.16), m(0.14), m(0.07), edgeRot, '#c9a23a');
      mark(jx, FLOOR_H + leafH * 0.45 + m(0.14), jz + (vertical ? 0 : 0), m(0.04), m(0.12), m(0.04), edgeRot, '#c9a23a');
    } else if (type === 'lockedDoor') {
      // Red lock plate through the leaf (shows on both faces), a brass lock,
      // and a red threshold.
      mark(cx, FLOOR_H + leafH * 0.4, cz, DOOR_W * 0.55, Math.max(leafH * 0.18, 0.01), 0.054, edgeRot, '#b8322a');
      mark(cx + (vertical ? 0 : DOOR_W * 0.32), FLOOR_H + leafH * 0.48, cz + (vertical ? DOOR_W * 0.32 : 0),
        m(0.18), Math.max(leafH * 0.12, 0.008), 0.054, edgeRot, '#c9a23a');
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
        tmpPos.set(cx, FLOOR_H + EY, cz),
        tmpQuat.identity(),
        vertical ? tmpScale.set(0.3, 0.015, DOOR_W) : tmpScale.set(DOOR_W, 0.015, 0.3),
      );
      doorLeaves.setMatrixAt(nd++, tmpMatrix);
    }
  }
  // Levelled buildings on slopes: stone foundation where the ground outside
  // is lower, retaining wall where it is higher (the building is dug in).
  let nfd = 0;
  if (!isFlat()) {
    for (let i = 0; i < N; i++) {
      const kind = (c) => (c.area === 'indoor' ? 'indoor' : c.sub === 'clocktower' ? 'tower' : null);
      const k0 = kind(grid.cells[i]);
      if (!k0) continue;
      const { x, y } = grid.coords(i);
      const level = cellLevel(x, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (grid.inBounds(nx, ny) && kind(grid.cells[grid.index(nx, ny)]) === k0) continue;
        const out = cellLevel(nx, ny);
        const diff = out - level;
        if (Math.abs(diff) < 0.004) continue;
        const vertical = dx !== 0;
        const c = cellToWorld(x, y);
        const ex = c.x + dx * 0.5, ez = c.z + dy * 0.5;
        const y0 = level + Math.min(diff, 0) - 0.03, y1 = level + Math.max(diff, 0) + FLOOR_H;
        tmpMatrix.compose(tmpPos.set(ex, y0, ez), tmpQuat.identity(),
          // A little thicker than walls, so where both meet the stone wraps the
          // wall's base instead of flickering in the same plane.
          vertical ? tmpScale.set(WALL_T * 1.5, y1 - y0, TILE + WALL_T * 1.5) : tmpScale.set(TILE + WALL_T * 1.5, y1 - y0, WALL_T * 1.5));
        foundations.setMatrixAt(nfd++, tmpMatrix);
      }
    }
  }
  foundations.count = nfd;
  foundations.instanceMatrix.needsUpdate = true;
  foundations.computeBoundingSphere();
  walls.count = nw;
  for (const k of ['aWallTex', 'aPosTex', 'aNegColor', 'aPosColor']) wa[k].needsUpdate = true;
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
  const src = new Int32Array(grid.cells.length);
  lightLevels = grid.lightLevels(src);
  setLightSeeds(grid.cols, grid.rows, src); // which light each cell flickers with
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
  swayFir(shader); // wind at midnight
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
    win.userData.flickerWindow = true;
    win.position.set(-w / 4, m(1.6), d / 2 + 0.005);
    g.add(win);
  }
  return g;
}

const ghostHouse = makeHouse({ ghost: true });
ghostHouse.visible = false;
scene.add(ghostHouse);

let porchLight = null, houseWindow = null;
let surroundFirs = null, surroundFirsPlaced = 0; // the forest ring (thinned on lower quality)
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
  porch.userData.baseIntensity = 2.2;
  porchLight = porch;
  houseWindow = house.children.find((o) => o.userData.flickerWindow) ?? null;
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
  surroundFirs = firs;
  surroundFirsPlaced = placed;
  firs.count = Math.round(placed * quality.trees);
}

// Drizzle: streaks ~1.5 m long, spread over the board and the near forest.
let rain = null;
let rainPos = new Float32Array(0);
let rainSpeed = new Float32Array(0);
const RAIN_TOP = m(80);
const STREAK = m(1.5);
const rainBox = { x: 0, z: 0 };
const RAIN_GREY = new THREE.Color('#8aa0b8'), RAIN_RED = new THREE.Color('#c41e2a');
const rainMat = new THREE.LineBasicMaterial({ color: '#8aa0b8', transparent: true, opacity: 0.22, depthWrite: false });

function buildRain() {
  if (rain) { atmos.remove(rain); rain.geometry.dispose(); }
  rainBox.x = board.w + 50;
  rainBox.z = board.d + 50;
  // Twice the drops are kept ready: a drizzle draws half, the midnight
  // downpour all of them.
  const count = 2 * Math.min(6000, Math.round(rainBox.x * rainBox.z * 0.3));
  rainPos = new Float32Array(count * 6);
  rainSpeed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    spawnDrop(i, Math.random() * RAIN_TOP);
    rainSpeed[i] = m(7) + Math.random() * m(3); // ~7-10 m/s
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0, count); // half the drops (2 vertices each)
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
  // At midnight: twice the drops, falling faster and driven by the wind.
  const d = dread;
  const n = Math.round(rainSpeed.length * (0.5 + 0.5 * d) * quality.rain);
  rain.geometry.setDrawRange(0, n * 2);
  rainMat.opacity = 0.22 + 0.16 * d;
  rainMat.color.copy(RAIN_GREY).lerp(RAIN_RED, d); // blood-red at midnight
  const fall = 1 + 0.8 * d, drift = 0.3 + 1.6 * d;
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const dy = rainSpeed[i] * dt * fall;
    rainPos[o + 1] -= dy;
    rainPos[o + 4] -= dy;
    rainPos[o] += dt * drift;
    rainPos[o + 3] += dt * drift;
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
  if (move.start >= N) { move.start = -1; move.pinned = -1; }
  play.boardChanged();
  renderPlay();
  if (move.pinned >= N) move.pinned = -1;
  refreshMoveOverlay();
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
let painting = null; // { pointerId, start:{x,y}, last:{x,y}, rect:boolean }
const activeTouches = new Set();

function pickCell(ev, { clamp = false } = {}) {
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

const paintAllowed = () => !ui.orbitMode && !ui.spaceHeld;

// What a stroke paints: a cell brush, or (Markers tool) just the marker.
function currentPatch() {
  if (ui.tool !== 'markers') return BRUSHES[ui.brush];
  if (ui.markerBrush === 'erase') return (c) => (c.marker ? { marker: null } : null);
  return (c) => {
    if (!c.walkable) { if (painting) painting.skipped = true; return null; }
    return { marker: ui.markerBrush };
  };
}

// The Old Clocktower brush paints a whole 2x2 tower: the cell under the
// pointer is its north-west corner (cells already part of a tower are left
// alone, so dragging lays towers side by side instead of smearing them).
const towerBrush = () => ui.tool !== 'markers' && ui.brush === 'outdoor:clocktower';
function applyAt(x, y, patch, opts) {
  if (!towerBrush()) return grid.apply(grid.index(x, y), patch, opts) ? [grid.index(x, y)] : [];
  if (grid.cells[grid.index(x, y)].sub === 'clocktower') return [];
  const out = [];
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    if (!grid.inBounds(x + dx, y + dy)) continue;
    const i = grid.index(x + dx, y + dy);
    if (grid.apply(i, patch, opts)) out.push(i);
  }
  return out;
}

function paintLine(a, b) {
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

function paintRect(a, b) {
  grid.revertStroke();
  const patch = currentPatch();
  const touched = [];
  const step = towerBrush() ? 2 : 1; // towers tile the rectangle 2x2 at a time
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += step) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x += step) {
      touched.push(...applyAt(x, y, patch, { silent: true }));
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
  const p = isFlat() ? raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3()) : rayTerrain(raycaster.ray, FLOOR_H);
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
terrainify(edgeMarker.material, { none: true });
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
  edgeMarker.position.set(cx, FLOOR_H + edgeBase(e.o, e.x, e.y).base, cz);
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
  if (ui.tool === 'move') { moveClick(pickCell(ev)); return; }
  if (ui.tool === 'play') {
    // A tap on (or near) a direction choice picks it...
    const cell = pickCell(ev);
    if (cell && play.choose(grid.index(cell.x, cell.y))) return;
    const pt = gridPoint(ev);
    if (pt && play.state.phase === 'choosing') {
      let best = null, bestD = 1.0;
      for (const o of play.state.options) {
        const c = grid.coords(o.i);
        const d = Math.hypot(pt.gx - (c.x + 0.5), pt.gy - (c.y + 0.5));
        if (d < bestD) { bestD = d; best = o; }
      }
      if (best) { play.choose(best.i); return; }
    }
    // ...otherwise press and hold to fast-forward anyone still running.
    if (play.anyRunning() || play.state.phase === 'rolling') {
      play.setFast(true);
      canvas.setPointerCapture?.(ev.pointerId);
      renderPlay();
    }
    return;
  }
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
  if (cell.x === painting.last.x && cell.y === painting.last.y) return;
  if (painting.rect) paintRect(painting.start, cell);
  else paintLine(painting.last, cell);
  painting.last = cell;
});

function finishPainting(ev) {
  if (ev && ev.pointerType === 'touch') activeTouches.delete(ev.pointerId);
  if (!painting || (ev && ev.pointerId !== painting.pointerId)) return;
  if (painting.edges) endEdgeStroke();
  if (painting.skipped) toast('Markers only go on walkable cells; blocked cells were skipped.');
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
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, () => { if (play.state.fast) { play.setFast(false); renderPlay(); } });
}
canvas.addEventListener('pointercancel', (ev) => {
  activeTouches.delete(ev.pointerId);
  if (painting && ev.pointerId === painting.pointerId) cancelPainting();
});
canvas.addEventListener('pointerleave', () => { if (!painting) { setHover(null); setHoverEdge(null); } });

function setHover(cell) {
  const prev = hoverIndex;
  hoverIndex = cell ? grid.index(cell.x, cell.y) : -1;
  hoverBox.visible = !!cell;
  updateHoverInfo();
  if (prev !== hoverIndex) refreshKeyHighlight();
}

// `start` (play only): 'standard' (11 PM) or 'midnight'; switching restarts.
function setTool(tool, start) {
  if (tool === 'play' && start && start !== play.state.startMode) play.setStartMode(start);
  ui.tool = tool;
  $$('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool
    && (!b.dataset.start || b.dataset.start === play.state.startMode)));
  $('#cellTools').hidden = tool !== 'cells';
  $('#wallTools').hidden = tool !== 'walls';
  $('#moveTools').hidden = tool !== 'move';
  $('#markerTools').hidden = tool !== 'markers';
  $('#playTools').hidden = tool !== 'play';
  $('#playHud').hidden = tool !== 'play';
  if (tool !== 'play') $('#gameClock').hidden = true;
  if (tool !== 'play') {
    $('#playTray').hidden = true; $('#askCard').hidden = true; $('#obolReveal').hidden = true; $('#inventory').hidden = true;
    $('#revealSheet').hidden = true; $('#cardPop').hidden = true; $('#casebook').hidden = true; $('#intentBanner').hidden = true;
  }
  document.body.classList.toggle('playing', tool === 'play');
  // Phones: fold the panel away so the board and the play bar are visible.
  if (tool === 'play' && window.innerWidth < 700) {
    $('#panel').hidden = true;
    $('#expand').hidden = false;
    // ...and move in close to the pawn so cells are big enough to tap.
    play.setActive(true); // places the pawn on the Start space if needed
    if (play.state.pos >= 0) {
      const { x, y } = grid.coords(play.state.pos);
      const p = cellToWorld(x, y);
      const offset = camera.position.clone().sub(controls.target).setLength(11);
      camTween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: p.clone().add(offset), toTarget: p };
    }
  }
  play.setActive(tool === 'play');
  refreshMarkers();
  refreshPropsAndWalls();
  renderPlay();
  setHoverEdge(null);
  setHover(null);
  refreshMoveOverlay();
}

// --- Movement check ------------------------------------------------------------
// Pick a start cell; the route to the hovered (or pinned) cell is drawn with
// its move count, and an optional range shades every cell reachable within N
// moves. Rules live in GridState (canStep / moveField / route).

const move = { start: -1, pinned: -1, range: 0, diagonal: false, keys: true };
const moveGroup = new THREE.Group();
scene.add(moveGroup);
const movePlates = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.38, depthWrite: false }),
  64 * 64,
);
const moveBars = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshBasicMaterial({ color: '#58d0e8', depthTest: false, transparent: true, opacity: 0.95 }),
  64 * 64,
);
const ringGeo = new THREE.RingGeometry(0.28, 0.4, 28).rotateX(-Math.PI / 2);
const startRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#6fe07a', depthTest: false, transparent: true }));
const endRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#f0b060', depthTest: false, transparent: true }));
for (const o of [movePlates, moveBars, startRing, endRing]) { o.raycast = () => {}; o.renderOrder = 12; moveGroup.add(o); }
// Rings marking keys a route picks up (up to 8).
const keyRingMat = new THREE.MeshBasicMaterial({ color: '#ffd24a', depthTest: false, transparent: true });
const keyRings = Array.from({ length: 8 }, () => {
  const r = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 28).rotateX(-Math.PI / 2), keyRingMat);
  r.renderOrder = 12;
  r.raycast = () => {};
  r.visible = false;
  moveGroup.add(r);
  return r;
});
movePlates.renderOrder = 5;
moveGroup.visible = false;

// Height of what you see in a cell, plus a hair.
const overlayY = (i) => Math.max(visibleTop(i), WATER_Y) + 0.02;

function refreshMoveOverlay() {
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

function clearMove() {
  move.start = -1;
  move.pinned = -1;
  refreshMoveOverlay();
}

// Click in the Movement tool: set the start, pin/unpin a destination, or
// clear by clicking the start again.
function moveClick(cell) {
  if (!cell) return;
  const i = grid.index(cell.x, cell.y);
  if (move.start < 0) move.start = i;
  else if (i === move.start) { clearMove(); return; }
  else move.pinned = move.pinned === i ? -1 : i;
  refreshMoveOverlay();
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
  $('#viewCurrent').textContent = { all: 'All', area: 'Area', light: 'Light', walk: 'Move' }[name];
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
$$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool, b.dataset.start)));
$('#moveRange').addEventListener('input', (e) => {
  move.range = Number(e.target.value);
  $('#moveRangeOut').textContent = move.range ? `${move.range}` : 'off';
  refreshMoveOverlay();
});
$('#moveDiagonal').addEventListener('change', (e) => { move.diagonal = e.target.checked; refreshMoveOverlay(); });
$('#moveKeys').addEventListener('change', (e) => { move.keys = e.target.checked; refreshMoveOverlay(); });

// --- Play demo -------------------------------------------------------------------
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
$('#playDie').innerHTML = '<i></i>'.repeat(9);
$('#hudDie').innerHTML = '<i></i>'.repeat(9);
function renderPlay() {
  if (ui.tool !== 'play') return;
  const s = play.state;
  // One-die face for the legacy die widgets: only while rolling, or for a
  // total a single die can show (moves can add up to 7+ with several dice).
  const f0 = s.phase === 'rolling' ? s.rollFace : s.roll;
  const face = PIPS[f0] ? f0 : 0;
  [...$('#playDie').children].forEach((el, n) => el.classList.toggle('on', !!face && PIPS[face].includes(n)));
  const roll = $('#playRoll');
  roll.disabled = !['idle', 'done'].includes(s.phase);
  const here = s.pos >= 0 ? (() => { const c = grid.coords(s.pos); return cellLabel(c.x, c.y); })() : '';
  const cur = s.players[s.cur];
  const chip = cur ? `<span class="who-chip" style="background:${cur.colour}">${cur.name}</span> ` : '';
  $('#playStatus').innerHTML = chip + ({
    nostart: 'No Start space yet. Paint one (Spaces → Outdoor → Start space).',
    idle: `On <b>${here}</b>. Roll to move.`,
    rolling: 'Rolling…',
    slotting: `Slot dice into up to <b>${s.maxSlots}</b> movement slots${s.lit ? ' (in light: extra slot open)' : ''}, then Move.`,
    asking: `Investigation spot. Investigate? <b>${s.steps}</b> move${s.steps === 1 ? '' : 's'} left.`,
    revealing: 'Evidence! Choose a face-down card to turn over.',
    over: 'Everyone is dead. The night wins. Press Restart to play again.',
    moving: s.fast ? `Fast-forward ⏩ <b>${s.steps}</b> left` : `Running… <b>${s.steps}</b> left (press and hold the board to fast-forward)`,
    choosing: `${s.stopReason ? `Stopped at <b>${s.stopReason}</b>. ` : ''}Choose a direction: <b>${s.steps}</b> move${s.steps === 1 ? '' : 's'} left (${s.options.map((o) => o.name).join(', ')})`,
    done: `On <b>${here}</b>. Roll again.`,
  }[s.phase] ?? '');
  // The pawn's light: whatever lights its cell (at the start, the van's headlights).
  const inHeadlights = s.pos >= 0 && grid.cells.some((c, j) => c.sub === 'start' && grid.startFront(j) === s.pos);
  const lightHere = s.pos >= 0 ? `Light <b>${Math.round(lightLevels[s.pos] * 100)}%</b>${inHeadlights ? ' (van headlights)' : ''} · ` : '';
  $('#playStats').innerHTML = `${lightHere}Turn <b>${s.turn}</b> · Black dice <b>${s.blackCount}</b> (everyone)` +
    ` · Obol bag <b>${s.bag.length}</b>` +
    (s.keys ? ` · Keys found <b>${s.keys.toString(2).split('').filter((b) => b === '1').length}</b>` : '');
  // Scoreboard: each player's cell and dice.
  $('#playBoard').innerHTML = s.players.map((p, k) => {
    const c = p.pos >= 0 ? grid.coords(p.pos) : null;
    const counts = obolCounts(p);
    const inDanger = s.monsters.some((mo) => mo.intent?.danger?.includes(k));
    return `<div class="pl${k === s.cur ? ' cur' : ''}${p.dead ? ' dead' : ''}${inDanger && !p.dead ? ' danger' : ''}" data-inv="${k}" title="Open ${p.name}'s inventory"><span class="chip" style="background:${p.colour}">${p.name}</span>` +
      `<span>${c ? cellLabel(c.x, c.y) : '–'}</span><span>White dice ${p.white}</span>` +
      `<span class="inj-row">${injuryPips(p)}${p.dead ? ' <b>Dead</b>' : inDanger ? ' <b style="color:#ff6a50">In danger</b>' : ''}</span>` +
      `<span class="obol-row">${OBOL_TYPES.map((t) => `<span class="obol-count${counts[t] ? '' : ' zero'}" title="${OBOLS[t].label} Obols">${obolHTML(t)}${counts[t]}</span>`).join('')}</span></div>`;
  }).join('');
  $('#playBoard').innerHTML += s.monsters.map((mo) => {
    const c = grid.coords(mo.pos);
    return `<div class="pl monster-row"><span class="chip" style="background:#6a0a12">!</span>` +
      `<span>${monsterDef(mo.kind)?.label ?? mo.kind}</span><span>${cellLabel(c.x, c.y)}</span></div>`;
  }).join('');
  $('#playLog').innerHTML = s.log.map((l) => `<li>${l}</li>`).join('');
  renderTray();
  renderClock();
  renderAsk();
  renderIntent();
  renderRevealSheet();
  if (!$('#casebook').hidden) renderCasebook();
  if (!$('#inventory').hidden) renderInventory();
  // Floating bar.
  [...$('#hudDie').children].forEach((el, n) => el.classList.toggle('on', !!face && PIPS[face].includes(n)));
  $('#hudRoll').disabled = roll.disabled;
  $('#hudStatus').innerHTML = chip + ({
    nostart: 'Paint a Start space first.',
    idle: `On <b>${here}</b>${s.pos >= 0 ? ` · light ${Math.round(lightLevels[s.pos] * 100)}%` : ''}. Roll.` +
      (play.anyRunning() ? (s.fast ? ' · ⏩' : ' · <span class="muted">hold board to fast-forward</span>') : ''),
    rolling: 'Rolling…',
    slotting: `Slot dice · move <b>${play.slotTotal()}</b>`,
    moving: s.fast ? `Fast-forward ⏩ <b>${s.steps}</b> left` : `Running… <b>${s.steps}</b> left · hold to fast-forward`,
    choosing: `${s.stopReason ? `<b>${s.stopReason}</b> · ` : ''}Tap an arrow · <b>${s.steps}</b> left`,
    asking: `Investigate? · <b>${s.steps}</b> left`,
    revealing: 'Evidence! Choose a card',
    over: 'Everyone is dead. Restart to play again.',
    done: `On <b>${here}</b>. Roll again.`,
  }[s.phase] ?? '');
  renderChoices();
}

// Round tap targets over each option, pointing the way you'd go.
let choiceButtons = [];
function renderChoices() {
  const host = $('#playChoices');
  const s = play.state;
  const opts = ui.tool === 'play' && s.phase === 'choosing' ? s.options : [];
  const key = opts.map((o) => o.i).join(',');
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.replaceChildren();
  choiceButtons = opts.map((o) => {
    const b = document.createElement('button');
    b.className = 'choice-btn';
    b.setAttribute('aria-label', `Move ${o.name}`);
    b.innerHTML = '<span>↑</span>';
    b.addEventListener('click', (e) => { e.stopPropagation(); play.choose(o.i); });
    host.appendChild(b);
    return { b, o };
  });
  positionChoices();
}
const projTmp = new THREE.Vector3();
function screenOf(i) {
  const { x, y } = grid.coords(i);
  const p = cellToWorld(x, y);
  const c = grid.cells[i];
  projTmp.set(p.x, Math.max(visibleTop(i), WATER_Y) + terrainHeight(p.x, p.z, { bridge: c.bridge }) + 0.05, p.z).project(camera);
  return { x: (projTmp.x + 1) / 2 * window.innerWidth, y: (1 - projTmp.y) / 2 * window.innerHeight, behind: projTmp.z > 1 };
}
function positionChoices() {
  if (!choiceButtons.length) return;
  const from = screenOf(play.state.pos);
  for (const { b, o } of choiceButtons) {
    const to = screenOf(o.i);
    // Sit on the option cell, but at least 72 px out from the pawn so the
    // buttons never overlap when zoomed out.
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const r = Math.max(len, 72);
    b.style.left = `${from.x + (dx / len) * r}px`;
    b.style.top = `${from.y + (dy / len) * r}px`;
    b.style.visibility = to.behind ? 'hidden' : 'visible';
    const ang = Math.atan2(dx, -dy);
    b.firstChild.style.transform = `rotate(${ang}rad)`;
  }
}
// Game settings (the adjustable mechanics), saved on this device.
const CONFIG_KEY = 'minty-pickle.gameConfig';
function loadConfig() {
  const cfg = defaultConfig();
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(cfg)) {
        if (k === 'obols') {
          for (const t of OBOL_TYPES) if (Number.isFinite(saved.obols?.[t])) cfg.obols[t] = saved.obols[t];
        } else if (k === 'monster' && (saved.configVersion ?? 1) < 3) {
          // Saved before the monster setting mattered: use today's default.
        } else if (typeof saved[k] === typeof cfg[k]) cfg[k] = saved[k];
      }
    }
  } catch { /* defaults */ }
  return cfg;
}
const gameConfig = loadConfig();
function saveConfig() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...gameConfig, configVersion: 3 })); } catch { /* ignore */ }
}

const play = createPlay({
  config: gameConfig,
  onObol: (draw) => showObol(draw),
  // A monster appears: say so (the camera goes to look at it).
  onMonster: ({ kind, cell }) => {
    const { x, y } = grid.coords(cell);
    toast(`The ${monsterDef(kind)?.label ?? 'monster'} has appeared at ${cellLabel(x, y)}.`);
  },
  onEvidence: (e) => {
    showCard({ kind: e.kind, code: e.code, sub: `Found by ${e.player?.name ?? ''} · added to the Casebook` });
    markCaseNew();
  },
  onAttacked: (e) => {
    showCard({ kind: 'attack', code: e.attack, amount: e.amount, first: e.first, sub: hitText({ ...e, source: 'Something unseen' }) });
    if (e.first) markCaseNew();
  },
  onNamed: (e) => showCard({ kind: 'named', monster: e.monster, correct: e.correct }),
  onDamage: (e) => showCard({ kind: 'hurt', code: e.attack, e }),
  onIntent: () => renderIntent(),
  onGameOver: () => showCard({ kind: 'over' }),
  onMonsterRevealed: (e) => showCard({ kind: 'monster', monster: e.monster, correct: e.correct }),
  // A monster lunges: a brief, soft red flash at the edges of the screen.
  onAttack: () => {
    const el = $('#attackFlash');
    el.classList.remove('on');
    void el.offsetWidth; // restart the fade
    el.classList.add('on');
  },
  grid, scene, camera, controls, cellToWorld, terrainify, cellLabel,
  cellTop: (i) => Math.max(visibleTop(i), WATER_Y) + 0.01,
  onChange: () => { wake(); renderPlay(); },
  onUsed: () => { refreshMarkers(); refreshPropsAndWalls(); },
  onCollect: (i, type, text) => {
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    const fy = Math.max(visibleTop(i), WATER_Y) + terrainHeight(p.x, p.z, { bridge: grid.cells[i].bridge });
    markers.burst(type, p.x, fy, p.z, text);
  },
});
markerUsed = (i) => ui.tool === 'play' && play.state.shownUsed.has(i);
markerHidden = (i) => ui.tool === 'play' && grid.cells[i].marker === 'objective' && !play.midnight() && !play.state.mystery?.initiative;
$('#playRoll').addEventListener('click', () => play.roll());

// Game clock: "11:05 PM · Turn 2/12"; from midnight on, just the time.
function renderClock() {
  const el = $('#gameClock');
  el.hidden = ui.tool !== 'play' || play.state.phase === 'nostart';
  if (el.hidden) return;
  const r = play.state.round;
  const t = formatClock(play.clockMinutes());
  el.classList.toggle('midnight', play.midnight());
  const turns = play.state.cfg.turnsToMidnight;
  el.innerHTML = r <= turns
    ? `${t}<span class="sep">·</span><span class="turn-word">Turn </span>${r}/${turns}`
    : `${t}<span class="sep">·</span>${r === turns + 1 ? 'Midnight' : `Turn ${r}`}`;
}

// Dice tray: tap rolled dice into movement slots, then Move.
function dieHTML(d, extra = '') {
  return `<button class="tdie ${d.kind} ${extra}" aria-label="${d.kind} ${d.v}">` +
    Array.from({ length: 9 }, (_, n) => `<i class="${PIPS[d.v].includes(n) ? 'on' : ''}"></i>`).join('') + '</button>';
}
function renderTray() {
  const s = play.state;
  const show = ui.tool === 'play' && (s.phase === 'slotting' || s.phase === 'rolling');
  $('#playTray').hidden = !show;
  if (!show) return;
  const rolling = s.phase === 'rolling';
  // While rolling, every die tumbles.
  $('#trayPool').innerHTML = s.pool.map((d, n) =>
    dieHTML(rolling ? { ...d, v: 1 + ((s.rollFace + n * 2) % 6) } : d, s.slots.includes(n) || s.defSlots.includes(n) ? 'used' : '')).join('');
  [...$('#trayPool').children].forEach((b, n) => { b.onclick = () => play.toggleSlot(n, trayTarget); });
  document.querySelectorAll('#trayTarget [data-to]').forEach((b) => b.classList.toggle('on', b.dataset.to === trayTarget));
  // Defense slots (Defense ⬜ +💡⬜), after injuries.
  const defs = [];
  const dBase = s.cfg.defenseSlots ?? 1;
  for (let k = 0; k < Math.max(s.maxDefense, dBase + 1); k++) {
    const n = s.defSlots[k];
    if (n !== undefined) defs.push(dieHTML(s.pool[n], 'in-def'));
    else if (k < s.maxDefense) defs.push(`<span class="tdie slot def">${k >= dBase ? 'light' : ''}</span>`);
    else defs.push('<span class="tdie slot def" title="Needs light (or lost to an injury)" style="opacity:.35">—</span>');
  }
  $('#trayDefense').innerHTML = defs.join('');
  [...$('#trayDefense').querySelectorAll('.in-def')].forEach((b, k) => { b.onclick = () => play.toggleSlot(s.defSlots[k], 'defense'); });
  $('#trayDefTotal').textContent = s.defSlots.reduce((a, n) => a + (s.pool[n]?.v ?? 0), 0);
  const slots = [];
  const base = s.cfg.moveSlots, most = Math.max(base, s.cfg.litSlots);
  for (let k = 0; k < most; k++) {
    const n = s.slots[k];
    if (n !== undefined) slots.push(dieHTML(s.pool[n], 'in-slot'));
    else if (k < s.maxSlots) slots.push(`<span class="tdie slot${k >= base ? ' lit' : ''}">${k >= base ? 'light' : ''}</span>`);
    else slots.push('<span class="tdie slot" title="Extra slots need a lit cell at the start of the turn" style="opacity:.35">dark</span>');
  }
  $('#traySlots').innerHTML = slots.join('');
  // Unrolled white dice in this player's reserve: tap one to roll it for this turn.
  $('#trayReserveRow').hidden = !s.white;
  $('#trayReserve').innerHTML = Array.from({ length: s.white }, () =>
    `<button class="tdie white reserve" ${rolling ? 'disabled' : ''} title="Roll this white die (usable this turn only)">roll</button>`).join('');
  [...$('#trayReserve').children].forEach((b) => { b.onclick = () => play.rollWhite(); });
  [...$('#traySlots').querySelectorAll('.in-slot')].forEach((b, k) => { b.onclick = () => play.toggleSlot(s.slots[k], 'move'); });
  $('#trayTotal').textContent = rolling ? '…' : play.slotTotal();
  $('#trayMove').disabled = rolling;
  $('#trayMove').textContent = play.slotTotal() ? `Move ${play.slotTotal()}` : 'Stay put';
  $('#trayHint').textContent = rolling ? 'Rolling…' : s.deathsDoor ? "Death's Door: one die only"
    : trayTarget === 'defense' ? 'Defense lasts until your next turn'
      : (s.pool.some((d) => d.kind === 'white') ? 'Rolled white dice are discarded after this turn' : 'Tap dice to slot them');
}
let trayTarget = 'move';
document.querySelectorAll('#trayTarget [data-to]').forEach((b) => b.addEventListener('click', () => { trayTarget = b.dataset.to; renderTray(); }));

// --- Investigating and Obols ------------------------------------------------------
const OBOL_GLYPHS = {
  attack: '<path d="M7 4.5 10.5 19.5M11.5 4 14 18.5M16 5 17.5 15.5"/>',
  event: '<path d="M4 9.5c3-3 6 2.5 9 0s5-1.5 7 0M4 14.5c3-3 6 2.5 9 0s5-1.5 7 0"/>',
  equipment: '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H20M17 12v3.2M19.6 12v2.2"/>',
  evidence: '<path d="M3 12c4-6.5 14-6.5 18 0-4 6.5-14 6.5-18 0z"/><circle cx="12" cy="12" r="2.6"/>',
};
function obolHTML(type, big = false) {
  return `<span class="obol obol-${type}${big ? ' big' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24">${OBOL_GLYPHS[type]}</svg></span>`;
}
// "Investigate?" while the runner stands on an Investigation space.
function renderAsk() {
  const s = play.state;
  const show = ui.tool === 'play' && s.phase === 'asking' && !!s.ask;
  $('#askCard').hidden = !show;
  if (!show) return;
  const cur = s.players[s.cur];
  const { x, y } = grid.coords(s.ask.i);
  $('#askSub').innerHTML = `<b style="color:${cur.colour}">${cur.name}</b> at ${cellLabel(x, y)} · ` +
    `${s.bag.length ? `draw an Obol (${s.bag.length} in the bag)` : 'the Obol bag is empty'}`;
}
$('#askYes').addEventListener('click', () => play.answerInvestigate(true));
$('#askNo').addEventListener('click', () => play.answerInvestigate(false));
// The Obol just drawn, shown for a moment (tap to dismiss).
let obolTimer = 0;
function showObol({ player, type, left }) {
  const el = $('#obolReveal');
  $('#obolCoin').innerHTML = type ? obolHTML(type, true) : '';
  $('#obolTitle').textContent = type ? `${OBOLS[type].label} Obol` : 'Nothing found';
  $('#obolSub').innerHTML = type
    ? `<b style="color:${player.colour}">${player.name}</b> drew it · ${left} left in the bag`
    : `<b style="color:${player.colour}">${player.name}</b>: the Obol bag is empty`;
  el.hidden = false;
  clearTimeout(obolTimer);
  obolTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
$('#obolReveal').addEventListener('click', () => { $('#obolReveal').hidden = true; });

// --- The mystery: choosing evidence, cards turning over, Casebook, Field Guide -------
const ATTACK_GLYPH = { P: '🩸', M: '🌀', S: '👻' };
const OBS_GLYPH = '👁', LAIR_GLYPH = '⚰';
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const placeLabel = (cell) => { const { x, y } = grid.coords(cell); return cellLabel(x, y); };

// Evidence Obol: the remaining face-down cards, to tap.
function renderRevealSheet() {
  const s = play.state;
  const deck = s.mystery?.deck ?? [];
  const show = ui.tool === 'play' && s.phase === 'revealing';
  $('#revealSheet').hidden = !show;
  if (!show) return;
  const cur = s.players[s.cur];
  const left = deck.filter((c) => !c).length;
  $('#revealTitle').textContent = 'Evidence found';
  $('#revealSub').innerHTML = `<b style="color:${cur.colour}">${cur.name}</b>: choose 1 of ${left} face-down cards to turn over`;
  const host = $('#revealCards');
  const key = deck.map((c) => (c ? 1 : 0)).join('');
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  let n = 0;
  host.innerHTML = deck.map((c, i) => (c ? '<span class="card-back gone"></span>'
    : `<button type="button" class="card-back" data-card="${i}" aria-label="Face-down evidence card ${++n}">?</button>`)).join('');
  host.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => play.revealCard(Number(b.dataset.card))));
}

// A card turning over, big and centred (tap to dismiss).
let cardTimer = 0;
function showCard(c) {
  const card = $('#cardPopCard');
  card.className = 'paper-card paper';
  let html = '';
  let stay = false;
  if (c.kind === 'observation' || c.kind === 'lair') {
    const lair = c.kind === 'lair';
    if (lair) card.classList.add('lair');
    html = `<div class="pc-kind">${lair ? 'Evidence · the Lair' : 'Evidence · Observation'}</div>` +
      `<div class="pc-glyph">${lair ? LAIR_GLYPH : OBS_GLYPH}</div>` +
      `<div class="pc-title">${esc(evidenceLabel(c.kind, c.code))}</div><div class="pc-sub">${esc(c.sub)}</div>`;
  } else if (c.kind === 'attack') {
    card.classList.add('attack');
    card.style.setProperty('--atk', ATTACK_TYPES[c.code].colour);
    html = `<div class="pc-kind">${c.first ? 'Attacked! The Attack card' : 'Attacked again'}</div>` +
      `<div class="pc-glyph">${ATTACK_GLYPH[c.code]}</div>` +
      `<div class="pc-title">${ATTACK_TYPES[c.code].label}</div><div class="pc-sub">${esc(c.sub)}</div>`;
  } else if (c.kind === 'hurt') {
    const e = c.e;
    card.classList.add('hurt');
    card.style.setProperty('--atk', ATTACK_TYPES[e.attack].colour);
    html = `<div class="pc-kind">${esc(e.source)}</div><div class="pc-glyph">${ATTACK_GLYPH[e.attack]}</div>` +
      `<div class="pc-title">${e.outcome === 'blocked' ? 'Blocked!' : e.outcome === 'killed' ? `${esc(e.player?.name ?? '')} is dead` : esc(INJURY_TRACKS[e.attack].tiers[e.tier - 1].name)}</div>` +
      `<div class="pc-sub">${esc(hitText(e))}</div>`;
  } else if (c.kind === 'over') {
    html = '<div class="pc-kind">The night wins</div><div class="pc-glyph">☠</div><div class="pc-title">Everyone is dead</div>' +
      '<div class="pc-sub">Restart to try again.</div>';
    stay = true;
  } else if (c.kind === 'named') {
    const name = MONSTER_BY_ID[c.monster]?.name ?? '';
    html = c.correct
      ? `<div class="pc-kind">Initiative!</div><div class="pc-glyph">☠</div><div class="pc-title">The ${esc(name)}</div>` +
        `<div class="pc-sub">The signs fit. Where it will rise is marked on the map, and the objectives are showing.</div>`
      : `<div class="pc-kind">Named: the ${esc(name)}</div><div class="pc-glyph">✗</div><div class="pc-title">The signs don't fit</div>` +
        `<div class="pc-sub">No Initiative this time. Keep gathering evidence: you'll know at midnight.</div>`;
    stay = true;
  } else if (c.kind === 'monster') {
    const m = MONSTER_BY_ID[c.monster];
    card.classList.add('monster');
    html = `<div class="pc-kind" style="text-align:center">Midnight · it's here</div><div class="pc-title">The ${esc(m.name)}</div>` +
      `<div class="pc-sub" style="text-align:center">${esc(m.traits.join(', '))}${c.correct ? ' · you named it right' : ''}</div>` +
      guideDetails(m, currentFound(), true);
    stay = true;
  }
  card.innerHTML = html;
  $('#cardPop').hidden = false;
  clearTimeout(cardTimer);
  if (!stay) cardTimer = setTimeout(hideCard, 4200);
  $('#cardPopHint').textContent = stay ? 'Tap to continue' : 'Tap to continue · added to the Casebook';
}
function hideCard() { $('#cardPop').hidden = true; clearTimeout(cardTimer); }
$('#cardPop').addEventListener('click', hideCard);

// What's been found, in the shape matchesEvidence wants.
function currentFound() {
  const my = play.state.mystery;
  return { attack: my?.attack?.code ?? null, cards: (my?.found ?? []).filter((f) => f.kind !== 'attack') };
}
const caseUI = { tab: 'case', showAll: false, seen: 0 };
function markCaseNew() { $('#caseBadge').hidden = !$('#casebook').hidden ? true : false; }
function openCasebook(tab) {
  if (tab) caseUI.tab = tab;
  $('#caseBadge').hidden = true;
  renderCasebook();
  $('#casebook').hidden = false;
}
function closeCasebook() { $('#casebook').hidden = true; }
$('#hudCase').addEventListener('click', () => openCasebook());
$('#caseClose').addEventListener('click', closeCasebook);
$('#casebook').addEventListener('click', (e) => { if (e.target === $('#casebook')) closeCasebook(); });
document.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => { caseUI.tab = b.dataset.ctab; renderCasebook(); }));

function renderCasebook() {
  document.querySelectorAll('[data-ctab]').forEach((b) => b.classList.toggle('on', b.dataset.ctab === caseUI.tab));
  $('#caseTitle').textContent = caseUI.tab === 'case' ? 'Casebook' : 'Field Guide';
  const body = $('#caseBody');
  const my = play.state.mystery;
  if (!my) {
    body.innerHTML = '<p class="case-note">No mystery in this game. Choose <b>Mystery</b> under Game settings → Monster.</p>';
    return;
  }
  const scroll = body.scrollTop;
  body.innerHTML = caseUI.tab === 'case' ? casebookHTML(my) : fieldGuideHTML(my);
  body.scrollTop = scroll;
  body.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => {
    closeCasebook();
    const i = Number(el.dataset.goto);
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    const offset = camera.position.clone().sub(controls.target);
    play.state.follow = false;
    $('#playFollow').checked = false;
    camTween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: p.clone().add(offset), toTarget: p };
  }));
  body.querySelector('#openGuide')?.addEventListener('click', () => { caseUI.tab = 'guide'; renderCasebook(); });
  body.querySelector('#guideAll')?.addEventListener('change', (e) => { caseUI.showAll = e.target.checked; renderCasebook(); });
  body.querySelectorAll('[data-name]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const id = b.dataset.name;
    if (!confirmName(id)) return;
    if (play.nameMonster(id)) closeCasebook();
  }));
}
function confirmName(id) {
  return window.confirm(`Name the ${MONSTER_BY_ID[id].name}?\n\nThe team gets one try before midnight. If you're right, you earn Initiative.`);
}

function casebookHTML(my) {
  const slot = (kind, f, label, wide = false) => (f
    ? `<button type="button" class="case-slot filled${wide ? ' wide' : ''}" data-goto="${f.cell}" title="Show where it was found">` +
      `<span class="cs-kind">${label}</span><span class="cs-name">${esc(evidenceLabel(kind, f.code))}</span>` +
      `<span class="cs-where">${esc(play.state.players[f.seat]?.name ?? '')} · ${placeLabel(f.cell)} · ${esc(f.time)}</span></button>`
    : `<div class="case-slot empty${wide ? ' wide' : ''}"><span class="cs-kind">${label}</span><span class="cs-name">?</span>` +
      `<span class="cs-where">${kind === 'attack' ? 'Revealed when it attacks someone' : 'Turn over an Evidence card'}</span></div>`);
  const obs = my.found.filter((f) => f.kind === 'observation');
  const lair = my.found.find((f) => f.kind === 'lair');
  const pool = my.pool.map((id) => MONSTER_BY_ID[id]);
  const fits = pool.filter((c) => matchesEvidence(c, currentFound()));
  const guess = my.guess ? MONSTER_BY_ID[my.guess.id]?.name : null;
  const status = my.revealed
    ? `It's the <b>${esc(MONSTER_BY_ID[my.monster]?.name ?? '')}</b>.${guess ? ` You named the ${esc(guess)}${my.guess.correct ? ', and you were right.' : '.'}` : ''}`
    : guess
      ? (my.guess.correct ? `You named the <b>${esc(guess)}</b>. <b>Initiative:</b> its spawn point is marked ☠.` : `You named the <b>${esc(guess)}</b>, but the signs didn't fit.`)
      : 'Name the monster from the Field Guide before midnight to earn <b>Initiative</b> (one try).';
  return `<div class="case-slots">` +
    slot('attack', my.attack, 'Attack', true) +
    [0, 1, 2].map((k) => slot('observation', obs[k], `Observation ${k + 1}`)).join('') +
    slot('lair', lair, 'Lair') +
    `</div>` +
    `<p class="case-note">${fits.length === 1 ? 'Only <b>one</b> monster fits' : `<b>${fits.length}</b> of ${pool.length} monsters fit`} the evidence so far.</p>` +
    `<p class="case-note">${status}</p>` +
    `<div class="case-actions"><button type="button" class="ink" id="openGuide">Open the Field Guide</button></div>`;
}

function guideDetails(c, found, open) {
  const hitObs = new Set(found.cards.filter((f) => f.kind === 'observation').map((f) => f.code));
  const hitLair = found.cards.find((f) => f.kind === 'lair')?.code;
  const chip = (text, cls) => `<span class="ge-chip ${cls}">${esc(text)}</span>`;
  const ev = c.evidence;
  const evChips = [
    chip(`Attack: ${ATTACK_TYPES[ev.attack].label}`, found.attack === ev.attack ? 'hit' : ''),
    ...ev.observations.map((o) => chip(OBSERVATIONS[o].label, hitObs.has(o) ? 'hit' : '')),
    chip(`Lair: ${LAIRS[ev.lair].label}`, `lair${hitLair === ev.lair ? ' hit' : ''}`),
  ].join('');
  const stat = (v) => (v === null ? '∞' : v);
  const dmg = (list, cls, word) => (list.length ? `<div class="ge-chips">${list.map((k) => chip(`${word} ${DAMAGE_KINDS[k].icon} ${DAMAGE_KINDS[k].label}`, cls)).join('')}</div>` : '');
  return `<div class="ge-body"${open ? '' : ''}>` +
    `<p><b>Evidence:</b></p><div class="ge-chips">${evChips}</div>` +
    `<p>Health <b>${stat(c.hp)}</b> · Toughness <b>${stat(c.toughness)}</b></p>` +
    dmg(c.weakness, 'weak', 'Weak to') + dmg(c.immune, 'imm', 'Immune to') +
    `<p>${esc(c.note)}</p><p><b>Objective:</b> ${esc(c.objective)}</p>` +
    c.abilities.map((a) => `<p class="ge-abil ${a.kind}"><b>${esc(a.name)}</b> <i>[${esc(a.roll)}]</i> ${esc(a.text)}</p>`).join('') +
    (c.wounds.length ? `<p><b>When wounded:</b> ${c.wounds.map((w) => `${w.at === null ? '∞' : w.at}: ${esc(w.text)}`).join(' · ')}</p>` : '') +
    `</div>`;
}

function fieldGuideHTML(my) {
  const found = currentFound();
  const pool = my.pool.map((id) => MONSTER_BY_ID[id]).sort((a, b) => a.name.localeCompare(b.name));
  const fits = pool.filter((c) => matchesEvidence(c, found));
  const out = pool.filter((c) => !fits.includes(c));
  const canName = !my.guess && !my.revealed && play.state.phase !== 'nostart';
  const nFound = found.cards.length + (found.attack ? 1 : 0);
  const entry = (c, ruledOut) => {
    const hits = (found.attack && c.evidence.attack === found.attack ? 1 : 0)
      + found.cards.filter((f) => (f.kind === 'lair' ? f.code === c.evidence.lair : c.evidence.observations.includes(f.code))).length;
    return `<details class="guide-entry${ruledOut ? ' out' : ''}"${fits.length <= 2 && !ruledOut ? ' open' : ''}>` +
      `<summary><span class="ge-name">${esc(c.name)}</span><span class="ge-traits">${esc(c.traits.join(', '))}</span>` +
      `<span class="ge-fit">${ruledOut ? 'ruled out' : nFound ? `fits ${hits}/${nFound}` : ''}</span></summary>` +
      guideDetails(c, found) +
      (!ruledOut && canName ? `<div class="case-actions"><button type="button" class="ink" data-name="${c.id}">Name the ${esc(c.name)}</button></div>` : '') +
      `</details>`;
  };
  return `<div class="guide-top"><span>${nFound ? `${fits.length} of ${pool.length} fit the evidence` : `${pool.length} monsters could be out there`}</span>` +
    `<label><input type="checkbox" id="guideAll"${caseUI.showAll ? ' checked' : ''} />Show ruled out</label></div>` +
    fits.map((c) => entry(c, false)).join('') +
    (out.length ? (caseUI.showAll ? `<p class="ge-out-head">Ruled out</p>${out.map((c) => entry(c, true)).join('')}`
      : `<p class="ge-out-head">${out.length} ruled out (tick “Show ruled out” to see them)</p>`) : '');
}

// --- Injuries and the monster's declared action -----------------------------------
function injuryPips(p) {
  const inj = p.injuries ?? { P: 0, M: 0, S: 0 };
  return ['P', 'M', 'S'].map((t) => `<span class="inj" title="${INJURY_TRACKS[t].label}: ${inj[t] ? INJURY_TRACKS[t].tiers[inj[t] - 1].name : 'unhurt'}">` +
    `${t}${[1, 2, 3].map((k) => `<i class="${inj[t] >= k ? `on${k}` : ''}"></i>`).join('')}</span>`).join('');
}
function hitText(e) {
  const who = e.player?.name ?? '';
  const type = ATTACK_TYPES[e.attack].label;
  if (e.outcome === 'blocked') return `${who} blocks ${e.amount} ${type} damage (defense ${e.defense}).`;
  if (e.outcome === 'killed') return `${e.amount} ${type} damage against defense ${e.defense}. ${who} was at Death's Door.`;
  const tier = INJURY_TRACKS[e.attack].tiers[(e.tier ?? 1) - 1];
  return `${who} takes ${e.amount} ${type} damage against defense ${e.defense}: ${tier?.name}. ${tier?.text}.`;
}
function renderIntent() {
  const el = $('#intentBanner');
  const s = play.state;
  const mo = ui.tool === 'play' ? s.monsters.find((m) => m.intent) : null;
  el.hidden = !mo;
  if (!mo) return;
  const i = mo.intent;
  const name = monsterDef(mo.kind)?.label ?? 'The monster';
  const danger = i.danger.map((k) => s.players[k]?.name).filter(Boolean);
  el.innerHTML = `<b>${esc(name)}</b> rolled ${i.roll}: <b>${esc(i.name)}</b>${i.ability >= 0 ? ` · ${esc(i.text)}` : ''}<br>` +
    (danger.length ? `<span class="danger">⚠ In danger: ${danger.join(', ')}</span>` : '<span class="muted">No one in reach, for now</span>') +
    ' <span class="muted">· it acts at the end of the round</span>';
}
$('#intentBanner').addEventListener('click', () => {
  const mo = play.state.monsters.find((m) => m.intent);
  if (!mo) return;
  const { x, y } = grid.coords(mo.pos);
  const p = cellToWorld(x, y);
  const offset = camera.position.clone().sub(controls.target);
  camTween = { t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: p.clone().add(offset), toTarget: p };
});

// --- Inventory -----------------------------------------------------------------------
// Each player's own inventory, in tabs. Opens on the current player (the bag
// button on the play bar, or I), or on whoever you tap in the scoreboard.
const inv = { player: 0, tab: 'obolcraft' };
function renderInventory() {
  const s = play.state;
  const pl = s.players[inv.player] ?? s.players[0];
  if (!pl) return;
  $('#invTitle').textContent = `${pl.name}'s inventory`;
  const host = $('#invPlayers');
  host.innerHTML = s.players.map((p, k) =>
    `<button type="button" role="tab" data-k="${k}" class="${k === inv.player ? 'on' : ''}" aria-selected="${k === inv.player}">` +
    `<span class="chip" style="background:${p.colour}"></span>${p.name}</button>`).join('');
  host.querySelectorAll('button').forEach((b) => { b.onclick = () => { inv.player = Number(b.dataset.k); renderInventory(); }; });
  const tabs = $('#invTabs');
  tabs.innerHTML = Object.entries(INVENTORY_TABS).map(([id, t]) =>
    `<button type="button" role="tab" data-tab="${id}" class="${id === inv.tab ? 'on' : ''}" aria-selected="${id === inv.tab}">` +
    `${t.label}<span class="n">${id === 'injuries' ? Object.values(pl.injuries ?? {}).reduce((a, b) => a + b, 0) : pl.inventory[id].length}</span></button>`).join('');
  tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => { inv.tab = b.dataset.tab; renderInventory(); }; });
  const body = $('#invBody');
  if (inv.tab === 'injuries') {
    const inj = pl.injuries ?? { P: 0, M: 0, S: 0 };
    body.innerHTML = `<div class="inj-list">${['P', 'M', 'S'].map((t) => `<div class="inj-track"><b>${INJURY_TRACKS[t].label}</b>` +
      INJURY_TRACKS[t].tiers.map((tier, k) => `<div class="inj-tier${inj[t] > k ? ' has' : ''}"><span class="sw" style="background:${tier.colour}"></span>` +
        `<span><b style="display:inline">${esc(tier.name)}</b> · ${esc(tier.text)}</span></div>`).join('') + '</div>').join('')}</div>` +
      `<p class="inv-empty" style="padding:12px 4px">${pl.dead ? `${esc(pl.name)} is dead.` : 'Tiers add up; each track is separate. Tier 3 on any track is Death’s Door.'}</p>`;
    return;
  }
  const items = pl.inventory[inv.tab];
  if (!items.length) {
    body.innerHTML = `<p class="inv-empty">${INVENTORY_TABS[inv.tab].empty}</p>`;
    return;
  }
  if (inv.tab === 'obolcraft') {
    const counts = obolCounts(pl);
    body.innerHTML = `<div class="inv-summary">${OBOL_TYPES.map((t) =>
      `<span class="obol-count${counts[t] ? '' : ' zero'}">${obolHTML(t)}${OBOLS[t].label} ${counts[t]}</span>`).join('')}</div>` +
      `<div class="inv-grid">${items.map((o) => `<div class="inv-item">${obolHTML(o.type)}<b>${OBOLS[o.type].label}</b>` +
        `<small>${o.at} · ${o.time}</small></div>`).join('')}</div>`;
  } else {
    body.innerHTML = `<div class="inv-grid">${items.map((e) => `<div class="inv-item"><b>${e.label ?? 'Item'}</b></div>`).join('')}</div>`;
  }
}
function openInventory(k = play.state.cur) {
  inv.player = k;
  renderInventory();
  $('#inventory').hidden = false;
}
function closeInventory() { $('#inventory').hidden = true; }
$('#hudInv').addEventListener('click', () => openInventory());
$('#invClose').addEventListener('click', closeInventory);
$('#inventory').addEventListener('click', (e) => { if (e.target === $('#inventory')) closeInventory(); });
$('#playBoard').addEventListener('click', (e) => {
  const row = e.target instanceof Element && e.target.closest('[data-inv]');
  if (row) openInventory(Number(row.dataset.inv));
});

// --- Game settings -------------------------------------------------------------------
const SETTINGS = [
  { section: 'Players' },
  { key: 'players', label: 'Characters', note: 'Play solo with 1, or take turns with up to 4', min: 1, max: 4,
    fmt: (v) => (v === 1 ? '1 · solo' : `${v}`) },
  { section: 'Dice & movement' },
  { key: 'startBlack', label: 'Starting black dice', note: 'Everyone; renew each turn', min: 1, max: 6 },
  { key: 'moveSlots', label: 'Movement slots', min: 1, max: 4 },
  { key: 'litSlots', label: 'Slots when starting in light', min: 1, max: 5 },
  { key: 'litThreshold', label: 'Light that counts as lit', min: 0.1, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%` },
  { section: 'Clock' },
  { key: 'turnMinutes', label: 'Minutes per turn', min: 1, max: 15, fmt: (v) => `${v} min` },
  { key: 'turnsToMidnight', label: 'Turns until midnight', note: 'start', min: 1, max: 24 },
  { section: 'Markers' },
  { key: 'stopAtMarkers', label: 'Stop on every marker', note: 'Choose a way on at each marker', bool: true },
  { key: 'askInvestigate', label: 'Ask before investigating', note: '"Investigate?" on Investigation spaces', bool: true },
  { section: 'Monster' },
  { key: 'monster', label: 'Monster', note: 'Mystery: a secret monster you uncover through evidence',
    choice: [['mystery', 'Mystery'], ...Object.entries(MONSTERS).map(([id, d]) => [id, d.label]), ['none', 'None']] },
  { key: 'monsterPool', label: 'Monster pool', note: 'Which monsters the mystery can be', when: () => gameConfig.monster === 'mystery',
    select: Object.entries(MONSTER_POOLS).map(([id, p]) => [id, `${p.label} (${p.ids.length})`]) },
  { key: 'monsterPick', label: 'Specific monster', note: 'For testing: always fight this one', when: () => gameConfig.monster === 'mystery',
    select: [['random', 'Random from the pool'], ...[...MONSTER_CARDS].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name])] },
  { section: 'Obol bag' },
  ...OBOL_TYPES.map((t) => ({ obol: t, label: `${OBOLS[t].label} Obols`, note: OBOLS[t].note, min: 0, max: 20 })),
];
let settingsDirty = false;
function renderSettings() {
  const body = $('#settingsBody');
  body.replaceChildren();
  const startNote = () => `Night starts at ${formatClock(24 * 60 - gameConfig.turnMinutes * gameConfig.turnsToMidnight)}`;
  for (const f of SETTINGS) {
    if (f.section) {
      const h = document.createElement('div');
      h.className = 'set-section';
      h.textContent = f.section;
      body.appendChild(h);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'set-row';
    const id = `set-${f.key ?? f.obol}`;
    const note = f.note === 'start' ? startNote() : f.note;
    row.innerHTML = `${f.obol ? obolHTML(f.obol) : ''}<label for="${id}">${f.label}${note ? `<small>${note}</small>` : ''}</label>`;
    const get = () => (f.obol ? gameConfig.obols[f.obol] : gameConfig[f.key]);
    const set = (v) => {
      if (f.obol) gameConfig.obols[f.obol] = v; else gameConfig[f.key] = v;
      // Keep the lit slots at least the normal slots.
      if (f.key === 'moveSlots' && gameConfig.litSlots < v) gameConfig.litSlots = v;
      if (f.key === 'litSlots' && gameConfig.moveSlots > v) gameConfig.moveSlots = v;
      settingsDirty = true;
      saveConfig();
      renderSettings();
    };
    if (f.when && !f.when()) continue;
    if (f.select) {
      row.classList.add('stack');
      const sel = document.createElement('select');
      sel.id = id;
      sel.className = 'set-select';
      for (const [value, text] of f.select) sel.add(new Option(text, value, false, get() === value));
      sel.addEventListener('change', () => set(sel.value));
      row.appendChild(sel);
    } else if (f.choice) {
      row.classList.add('stack');
      const wrap = document.createElement('div');
      wrap.className = 'seg set-choice';
      for (const [value, text] of f.choice) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.classList.toggle('on', get() === value);
        b.addEventListener('click', () => set(value));
        wrap.appendChild(b);
      }
      row.appendChild(wrap);
    } else if (f.bool) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.checked = get();
      cb.addEventListener('change', () => set(cb.checked));
      row.appendChild(cb);
    } else {
      const step = f.step ?? 1;
      const wrap = document.createElement('div');
      wrap.className = 'stepper';
      const v = get();
      wrap.innerHTML = `<button type="button" aria-label="Less">−</button><output id="${id}">${f.fmt ? f.fmt(v) : v}</output><button type="button" aria-label="More">+</button>`;
      const [less, more] = wrap.querySelectorAll('button');
      const nudge = (d) => set(Math.round(Math.min(f.max, Math.max(f.min, get() + d * step)) * 100) / 100);
      less.disabled = v <= f.min;
      more.disabled = v >= f.max;
      less.addEventListener('click', () => nudge(-1));
      more.addEventListener('click', () => nudge(1));
      row.appendChild(wrap);
    }
    body.appendChild(row);
  }
  const total = OBOL_TYPES.reduce((a, t) => a + gameConfig.obols[t], 0);
  const tot = document.createElement('div');
  tot.className = 'set-total';
  tot.textContent = `${total} Obols in the bag`;
  body.appendChild(tot);
}
function openSettings() {
  settingsDirty = false;
  renderSettings();
  $('#settings').hidden = false;
}
function closeSettings() {
  $('#settings').hidden = true;
  syncPlayerButtons();
  if (settingsDirty && ui.tool === 'play') {
    play.reset();
    toast('Game restarted with the new settings.');
  } else if (settingsDirty) {
    play.invalidate(); // the next Play / Midnight demo starts fresh with them
  }
  settingsDirty = false;
}
$('#openSettings').addEventListener('click', openSettings);
$('#setDone').addEventListener('click', closeSettings);
$('#settings').addEventListener('click', (e) => { if (e.target === $('#settings')) closeSettings(); });
$('#setDefaults').addEventListener('click', () => {
  const d = defaultConfig();
  Object.assign(gameConfig, d);
  gameConfig.obols = d.obols;
  settingsDirty = true;
  saveConfig();
  renderSettings();
});
$('#trayMove').addEventListener('click', () => play.confirmMove());
$('#hudRoll').addEventListener('click', () => play.roll());
$('#playStreets').addEventListener('change', (e) => { play.state.followStreets = e.target.checked; });
$('#playReset').addEventListener('click', () => play.reset());
// The panel's player buttons and Game settings share one setting.
function syncPlayerButtons() {
  document.querySelectorAll('[data-players]').forEach((o) => o.classList.toggle('on', Number(o.dataset.players) === gameConfig.players));
}
syncPlayerButtons();
document.querySelectorAll('[data-players]').forEach((b) => b.addEventListener('click', () => {
  play.setPlayers(Number(b.dataset.players));
  saveConfig();
  syncPlayerButtons();
}));
$('#playFollow').addEventListener('change', (e) => { play.state.follow = e.target.checked; });
// Arrow keys choose a direction at a fork (before the camera can pan).
window.addEventListener('keydown', (e) => {
  if (ui.tool !== 'play' || !dlg.root.hidden) return;
  if (e.key.startsWith('Arrow') && play.chooseByKey(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
$$('[data-edge]').forEach((b) => b.addEventListener('click', () => setEdgeBrush(b.dataset.edge)));
$$('[data-shape]').forEach((b) => b.addEventListener('click', () => setShape(b.dataset.shape)));
$$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$$('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.cam)));
$('#camMode').addEventListener('click', () => setOrbitMode(!ui.orbitMode));

// View menu: open/closed is remembered per browser.
function setViewMenu(open) {
  $('#viewList').hidden = !open;
  $('#viewToggle').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('view-open', open);
  try { localStorage.setItem('minty-pickle.viewMenu', open ? '1' : '0'); } catch { /* ignore */ }
}
$('#viewToggle').addEventListener('click', () => setViewMenu($('#viewList').hidden));
{
  let open = window.innerWidth >= 700;
  try { const v = localStorage.getItem('minty-pickle.viewMenu'); if (v !== null) open = v === '1'; } catch { /* ignore */ }
  setViewMenu(open);
}

$('#optLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; labelGroup.visible = ui.labels; });
$('#optAtmos').addEventListener('change', (e) => { ui.atmosphere = e.target.checked; applyAtmosphere(); });
$('#optGhost').addEventListener('change', (e) => { ui.ghost = e.target.checked; });
$('#optLowWalls').addEventListener('change', (e) => { ui.lowWalls = e.target.checked; refreshPropsAndWalls(); });
$('#optMarkers').addEventListener('change', (e) => { ui.showMarkers = e.target.checked; refreshMarkers(); });

// Elevation presets: switch the height formula, then rebuild every shader.
function applyTerrain(id) {
  setTerrain(id);
  grid.terrain = terrainId();
  refreshWaterAndBridges();
  scene.traverse((o) => {
    for (const mat of [].concat(o.material ?? [])) mat.needsUpdate = true;
  });
  document.querySelectorAll('[data-terrain]').forEach((b) => b.classList.toggle('on', b.dataset.terrain === grid.terrain));
  $('#terrainNote').textContent = TERRAIN_PRESETS[grid.terrain].note;
  refreshMarkers();
}
{
  const host = $('#terrainPresets');
  for (const [id, t] of Object.entries(TERRAIN_PRESETS)) {
    const b = document.createElement('button');
    b.dataset.terrain = id;
    b.textContent = t.label;
    b.title = t.note;
    b.addEventListener('click', () => { applyTerrain(id); scheduleSave(); });
    host.appendChild(b);
  }
  applyTerrain(grid.terrain);
}

// Marker brushes: icons drawn from the same art as the board badges.
function setMarkerBrush(name) {
  ui.markerBrush = name;
  document.querySelectorAll('[data-marker]').forEach((b) => b.classList.toggle('on', b.dataset.marker === name));
}
document.querySelectorAll('[data-marker]').forEach((b) => {
  const t = b.dataset.marker;
  if (MARKERS[t]) {
    const icon = b.querySelector('.marker-icon');
    if (icon) icon.style.backgroundImage = `url(${drawMarkerIcon(t, 64).toDataURL()})`;
    b.title = MARKERS[t].note;
  }
  b.addEventListener('click', () => { setTool('markers'); setMarkerBrush(t); });
});
setMarkerBrush(ui.markerBrush);

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
    applyTerrain(data.terrain);
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

function minimizePanel() { $('#panel').hidden = true; $('#expand').hidden = false; }
$('#collapse').addEventListener('click', minimizePanel);
$('#expand').addEventListener('click', () => { $('#panel').hidden = false; $('#expand').hidden = true; });

// Click or tap off an open window (the side panel or the view menu) to
// minimise it. A press on the board that only closes a window is swallowed,
// so it never paints a tile, places a wall or moves the camera.
window.addEventListener('pointerdown', (ev) => {
  const panelOpen = !$('#panel').hidden;
  const viewOpen = !$('#viewList').hidden;
  if (!panelOpen && !viewOpen) return;
  const t = ev.target;
  const inside = (sel) => t instanceof Element && !!t.closest(sel);
  if (inside('#dialog') || inside('#settings') || inside('#inventory') || inside('#playHud') || inside('#playChoices') || inside('#playTray')
    || inside('#askCard') || inside('#obolReveal') || inside('#revealSheet') || inside('#cardPop') || inside('#casebook') || inside('#intentBanner')) return;
  let closed = false;
  if (panelOpen && !inside('#panel') && !inside('#expand')) { minimizePanel(); closed = true; }
  if (viewOpen && !inside('#viewMenu')) { setViewMenu(false); closed = true; }
  if (closed && t === renderer.domElement) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }
}, true);
if (window.innerWidth < 700) { $('#panel').hidden = true; $('#expand').hidden = false; }

window.addEventListener('keydown', (e) => {
  if (!dlg.root.hidden) { if (e.key === 'Escape') closeDialog(); return; }
  if (!$('#settings').hidden) { if (e.key === 'Escape') closeSettings(); return; }
  if (!$('#inventory').hidden) { if (e.key === 'Escape' || e.key.toLowerCase() === 'i') closeInventory(); return; }
  if (!$('#casebook').hidden) { if (e.key === 'Escape' || e.key.toLowerCase() === 'c') closeCasebook(); return; }
  if (!$('#cardPop').hidden && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); hideCard(); return; }
  if (ui.tool === 'play' && play.state.phase === 'revealing' && /^[1-4]$/.test(e.key)) {
    const faceDown = (play.state.mystery?.deck ?? []).map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
    const n = faceDown[Number(e.key) - 1];
    if (n !== undefined) play.revealCard(n);
    return;
  }
  if (ui.tool === 'play' && e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey
    && !(e.target instanceof HTMLInputElement)) { openCasebook(); return; }
  if (ui.tool === 'play' && e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey
    && !(e.target instanceof HTMLInputElement)) { openInventory(); return; }
  // "Investigate?": Enter or Y = yes, Escape or N = no.
  if (ui.tool === 'play' && play.state.phase === 'asking') {
    const k = e.key.toLowerCase();
    if (k === 'enter' || k === 'y') { e.preventDefault(); play.answerInvestigate(true); return; }
    if (k === 'escape' || k === 'n') { e.preventDefault(); play.answerInvestigate(false); return; }
  }
  if (e.key === 'Escape' && ui.tool === 'move') { clearMove(); return; }
  if (ui.tool === 'play' && e.key === 'Enter') {
    e.preventDefault();
    if (play.state.phase === 'slotting') play.confirmMove(); else play.roll();
    return;
  }
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
  else if (key === 'm') setTool('move');
  else if (key === 'p') setTool('markers');
  else if (key === 'v') setViewMenu($('#viewList').hidden);
  else if (key === 'y') setTool('play', 'standard');
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
    const type = grid.edgeAt(`${o}${x},${y}`);
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
    `<span class="tag">${AREAS[c.area].label} · ${areaLabel(c)}${c.sub === 'start' ? ` (van facing ${FACING_NAMES[grid.startFacing(hoverIndex)]})` : ''}</span>` +
    (c.area === 'indoor' ? (() => {
      const seed = buildingSeeds()[hoverIndex];
      return `<span class="tag">Outside: ${buildingStyle(seed).name}</span><span class="tag">Inside: ${interiorStyle(seed).name}</span>`;
    })() : '') +
    (grid.cells.some((s, j) => s.sub === 'start' && grid.startFront(j) === hoverIndex) ? '<span class="tag marker-tag">Player start</span>' : '') +
    (c.bridge ? `<span class="tag">Bridge (spans ${grid.bridgeAxis(x, y) === 'x' ? 'E–W' : 'N–S'})</span>` : '') +
    `<span class="tag">${lightLabel(c, hoverIndex)}</span>` +
    `<span class="tag">${c.walkable ? 'Walkable' : 'Blocked'}</span>` +
    (c.marker && !markerHidden(hoverIndex) ? `<span class="tag marker-tag">${markerLabel(c, hoverIndex)}</span>` : '');
}

function edgeLabel(o, x, y, type) {
  if (type?.startsWith('oneWayDoor')) {
    const [a, b] = grid.edgeCellsLabels(o, x, y).map((l) => l ?? 'edge');
    return type.endsWith('+') ? `One-way door ${a} → ${b}` : `One-way door ${b} → ${a}`;
  }
  const auto = type && !grid.edges.has(`${o}${x},${y}`) ? ' (condemned)' : '';
  return ({
    door: 'Unlocked door', lockedDoor: 'Locked door', wall: 'Wall', window: 'Window',
    boardedDoor: 'Boarded-up door', boardedWindow: 'Boarded-up window',
  }[type] ?? 'Open') + auto;
}

function markerLabel(c, i) {
  const label = `${MARKERS[c.marker].label} marker`;
  if (!c.walkable) return `${label} (cell is blocked)`;
  if (markerUsed(i)) return `${label} (${{ whiteDice: 'collected', blackDice: 'attuned', key: 'picked up', investigation: 'visited', objective: 'visited' }[c.marker] ?? 'used'})`;
  if (c.marker === 'key') {
    const n = grid.keyDoors(i).length;
    return `${label}: unlocks ${n} door${n === 1 ? '' : 's'}`;
  }
  return label;
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
    (n.boardedDoor + n.boardedWindow ? `Boarded up: doors <b>${n.boardedDoor}</b> · windows <b>${n.boardedWindow}</b><br>` : '') +
    `Light sources <b>${n.lit}</b> · Lit cells <b>${lightLevels.reduce((k, v) => k + (v > 0), 0)}</b><br>` +
    (Object.keys(n.markers).length
      ? `Markers: ${Object.keys(MARKERS).filter((t) => n.markers[t]).map((t) => `${MARKERS[t].label} <b>${n.markers[t]}</b>`).join(' · ')}<br>`
      : '') +
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

// Midnight dread (play demo, from midnight on): lights flicker, the
// clocktower's dials die, the rain comes down harder, the forest sways and
// the night closes in a little. Eases in over a few seconds.
let dread = 0;
const TINT = {
  sky: new THREE.Color('#56627a'), skyRed: new THREE.Color('#7c4650'),
  ground: new THREE.Color('#181a18'), groundRed: new THREE.Color('#241516'),
  moon: new THREE.Color('#a9bcff'), moonRed: new THREE.Color('#dc9196'),
  bg: new THREE.Color('#070a10'), bgRed: new THREE.Color('#0e0709'),
};
let towerOut = 0; // 0..1 progress of the clock dials dying
let dreadT = 0;
function updateDread(dt) {
  const want = ui.tool === 'play' && play.midnight() ? 1 : 0;
  dread += Math.sign(want - dread) * Math.min(Math.abs(want - dread), dt / 4);
  towerOut += Math.sign(want - towerOut) * Math.min(Math.abs(want - towerOut), dt / 2.5);
  dreadT += dt;
  dreadUniforms.uDread.value = dread;
  dreadUniforms.uDreadTime.value = dreadT;
  swayUniforms.uSway.value = dread;
  swayUniforms.uSwayTime.value = dreadT;
  // The dials sputter two or three times as they die, then stay dark.
  const p = towerOut;
  const sputter = p > 0 && p < 0.85 ? (Math.sin(p * Math.PI * 7) > 0.2 ? 1 : 0.35) : 1;
  clocktowers.setGlow(Math.max(0, 1 - p) * sputter);
  // Darker, closer night, and the cold blue turns a muted, bloody red.
  hemi.intensity = 2.4 - 0.5 * dread;
  hemi.color.copy(TINT.sky).lerp(TINT.skyRed, dread);
  hemi.groundColor.copy(TINT.ground).lerp(TINT.groundRed, dread);
  moon.color.copy(TINT.moon).lerp(TINT.moonRed, dread);
  SKY.copy(TINT.bg).lerp(TINT.bgRed, dread);
  FOG.color.copy(SKY);
  FOG.near = 38 - 10 * dread;
  FOG.far = 95 - 18 * dread;
  if (porchLight) porchLight.intensity = porchLight.userData.baseIntensity * flickerAt(0.71, dreadT, dread);
  if (houseWindow) houseWindow.material.color.set('#e9a85c').multiplyScalar(flickerAt(0.71, dreadT, dread));
}

const clock = new THREE.Clock();
let heightsEasing = false;
let lastFrame = 0;
const fpsMeter = { frames: 0, since: performance.now(), show: false, active: false };
renderer.setAnimationLoop(() => {
  // Full rate while anything moves; the idle rate otherwise (see wake()).
  const now = performance.now();
  const active = now < wakeUntil || !!camTween || heightsEasing || play.busy() || markers.busy()
    || clocktowers.busy() || (dread > 0 && dread < 1) || (towerOut > 0 && towerOut < 1);
  if (!active && now - lastFrame < 1000 / quality.idleFps - 2) return;
  lastFrame = now;
  fpsMeter.active = active;
  const dt = Math.min(clock.getDelta(), 0.1);

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
  heightsEasing = moved;

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
  props?.tick(clock.elapsedTime);
  markers.tick(clock.elapsedTime, camera);
  // A bug in game code must never stop the render loop (the board would
  // freeze and stop taking input): log it and keep going.
  try { play.tick(dt, clock.elapsedTime); } catch (e) { console.error(e); }
  // Clocktower dials: the game time while playing, 11 PM (the start) otherwise.
  clocktowers.setTime(ui.tool === 'play' ? play.clockMinutes() : play.startMinutes());
  clocktowers.tick(dt);
  updateDread(dt);
  try { positionChoices(); } catch (e) { console.error(e); }
  updateTreeFade();
  if (atmos.visible) updateRain(dt);
  renderer.render(scene, camera);
  // FPS readout (View → FPS).
  fpsMeter.frames++;
  if (now - fpsMeter.since >= 1000) {
    if (fpsMeter.show) {
      const fps = Math.round((fpsMeter.frames * 1000) / (now - fpsMeter.since));
      $('#fps').textContent = `${fps} fps · ${fpsMeter.active ? 'active' : 'idle'} · ${qualityName}`;
    }
    fpsMeter.frames = 0;
    fpsMeter.since = now;
  }
});

// Anything the player does wakes the renderer to full rate.
for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'touchmove']) {
  window.addEventListener(type, () => wake(), { passive: true, capture: true });
}
controls.addEventListener('change', () => wake(400));
grid.onChange(() => wake());
applyQuality(qualityName);
document.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => {
  applyQuality(b.dataset.quality);
  try { localStorage.setItem(QUALITY_KEY, qualityName); } catch { /* ignore */ }
}));
$('#optFps').addEventListener('change', (e) => {
  fpsMeter.show = e.target.checked;
  $('#fps').hidden = !fpsMeter.show;
  $('#fps').textContent = '…';
});

// Handy for debugging / future tooling from the console.
window.gridPlanner = { grid, scene, camera, controls, brushes: BRUSHES, terrainHeight, play, dread: () => dread };
