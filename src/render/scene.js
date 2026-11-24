// The three.js renderer, scene, camera and controls, lights, sky and fog,
// quality presets and render-on-demand, and the shared materials and
// geometry used to draw the board.

import { BRIDGE_SPAN, setTerrain, terrainify, cellLevel } from './terrain.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { flickerize } from './dread.js';
import { METERS_PER_CELL } from '../core/scale.js';
import { edgeKey } from '../core/state.js';
import { BED_H, DECK_TOP, INSET, TILE, grid, hoverIndex } from '../app/config.js';
import { applyControlBindings } from '../app/controls.js';
import { hoverEdge } from '../editor/walls.js';
import { setForestDensity } from './surroundings.js';
import { makeRadialTexture } from './textures.js';

// Module state: assigned by init() below, in the same order as before the split.
export let container, renderer, scene, SKY, FOG, camera;
export let controls, board, hemi, moon, QUALITY, qualityName;
export let quality, slabMat, groundMat, groundHole, outerHole, innerGroundMat;
export let outerGroundMat, tileGeoBase, tileMat, deckMat, railMat, bridgeDepthMat;
export let poolMat, poolGeo, unitBoxGeo, wallMat, doorMat, frameMat;
export let glassDarkMat, glassLitMat, FRAME_COLOURS, BUILDING_STYLES, INTERIOR_STYLES;

export function __set_camTween(v) { camTween = v; return v; }

// Run once at startup (called from src/main.js, in order).
export function init() {
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

  container = document.getElementById('app');
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // replaced by applyQuality below
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Shadows on demand: the moon's shadow map is redrawn only when something
  // that casts a shadow may have changed (see markShadows and the frame loop),
  // not on every frame. Moving the camera never needs it.
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  SKY = new THREE.Color('#070a10');
  scene.background = SKY;
  FOG = new THREE.Fog(SKY, 38, 95);
  scene.fog = FOG;

  camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1500);

  controls = new OrbitControls(camera, renderer.domElement);
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
  board = { w: 0, d: 0, radius: 0 };

  // Lighting: dim cool moonlight + sky/ground fill.
  hemi = new THREE.HemisphereLight('#56627a', '#181a18', 2.4);
  scene.add(hemi);
  moon = new THREE.DirectionalLight('#a9bcff', 1.8);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.bias = -0.0008;
  // Offsets shadow lookups along the surface normal: stops jagged self-shadow
  // bands ("acne") on steep faces the moon grazes, like bridge girders.
  moon.shadow.normalBias = 0.02;
  scene.add(moon);
  scene.add(moon.target);

  // --- Quality (per device) ------------------------------------------------------
  // Phones run this for a whole game night, so heat and battery matter more
  // than peak frame rate. Each level sets the render resolution, shadows, how
  // many trees surround the town, how much rain falls, and the "idle" frame
  // rate used while nothing is moving (see the render loop at the bottom).
  // After midnight the town never keeps still (the monster, danger rings,
  // flickering lights, swaying trees, the downpour), so it gets its own,
  // smoother rate: `midnightFps` (Infinity = the screen's full rate).
  QUALITY = {
    low: { pixelRatio: 1, shadows: false, shadowSize: 1024, trees: 0.35, rain: 0.35, idleFps: 12, midnightFps: 30 },
    medium: { pixelRatio: 1.5, shadows: true, shadowSize: 1024, trees: 0.65, rain: 0.6, idleFps: 20, midnightFps: 30 },
    high: { pixelRatio: 2, shadows: true, shadowSize: 2048, trees: 1, rain: 1, idleFps: 30, midnightFps: Infinity },
  };
  qualityName = (() => {
    try { const q = localStorage.getItem(QUALITY_KEY); if (QUALITY[q]) return q; } catch { /* ignore */ }
    return isPhoneish() ? 'medium' : 'high';
  })();
  quality = QUALITY[qualityName];

  slabMat = new THREE.MeshLambertMaterial({ color: '#07090b' });
  groundMat = new THREE.MeshLambertMaterial({ color: '#0b100e' });
  // Forest floor: hidden over the board (and, for the outer ring, over the
  // inner ground) so sunken water and the board edge show through.
  groundHole = { value: new THREE.Vector2(1, 1) };
  outerHole = { value: new THREE.Vector2(1, 1) };
  innerGroundMat = holedGround(groundHole);
  outerGroundMat = holedGround(outerHole);

  tileGeoBase = new THREE.BoxGeometry(INSET * TILE, 1, INSET * TILE).translate(0, 0.5, 0); // origin at bottom
  tileMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  // Bridge decks share the tile shader but stay at bank level on slopes.
  deckMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  railMat = new THREE.MeshLambertMaterial({ color: '#8a8e92' });
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
  // Decks and railings cast shadows from where they are drawn (deck level on slopes).
  bridgeDepthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  terrainify(bridgeDepthMat, { bridge: true });

  // Soft light pools that spill past lit cells onto their neighbours.
  poolMat = new THREE.MeshBasicMaterial({
    map: makeRadialTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.2,
  });
  flickerize(poolMat);
  poolGeo = new THREE.PlaneGeometry(2.6 * TILE, 2.6 * TILE).rotateX(-Math.PI / 2);

  // Unit box with its base at y = 0 (walls, door leaves).
  unitBoxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  // Every wall has two faces, each with its own colour and texture: the face
  // toward the west/north cell (aNegColor, aWallTex) and the face toward the
  // east/south cell (aPosColor, aPosTex). Textures are drawn in the shader in
  // metres along the wall. Exterior: 0 clapboard, 1 brick, 2 board-and-batten,
  // 3 worn plaster, 4 cedar shingle. Interior: 5 striped wallpaper, 6 floral
  // wallpaper, 7 oak wainscot under plaster, 8 beadboard, 9 walnut panelling
  // (and 3 plaster).
  wallMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
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
  doorMat = new THREE.MeshLambertMaterial({ color: '#d08a40', emissive: '#5a3414' });
  // Storefront windows: painted frames (instance colour), and glass that is
  // dark, or glows warm when light reaches either side.
  frameMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  glassDarkMat = new THREE.MeshLambertMaterial({ color: '#2b3c46', transparent: true, opacity: 0.6, depthWrite: false });
  glassLitMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', transparent: true, opacity: 0.78, depthWrite: false });
  flickerize(glassLitMat);
  FRAME_COLOURS = ['#1f3a2e', '#5a1f1c', '#1b1b1d', '#c8bfa6', '#2a3550']; // green, oxblood, black, cream, navy
  // Muted, old-town building finishes. Every building (connected indoor
  // cells) gets exactly one: wall colour and texture, plus one window design
  // and frame colour, so nothing on a building looks mismatched.
  BUILDING_STYLES = [
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
  INTERIOR_STYLES = [
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
}

export let camTween = null;
// Camera presets are fitted to the current board size and the viewport
// (portrait phones need much more distance). Fog is pushed back to match.
export function fitPreset(name) {
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
export function clampTarget() {
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
export function focusHovered() {
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

export function setCamera(name, instant = false) {
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
export const QUALITY_KEY = 'minty-pickle.quality';
// Automatic resolution (src/app/loop.js) scales the quality's pixel ratio
// down when frames come too slowly: RES_STEPS, never below MIN_PIXEL_RATIO.
export const RES_STEPS = [1, 0.85, 0.7, 0.6, 0.5];
const MIN_PIXEL_RATIO = 0.75;
export let resScale = 1;
export const basePixelRatio = () => Math.min(window.devicePixelRatio, quality.pixelRatio);
export function setResScale(s) { resScale = s; applyResolution(); }
export function applyResolution() {
  renderer.setPixelRatio(Math.max(Math.min(MIN_PIXEL_RATIO, basePixelRatio()), basePixelRatio() * resScale));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
export const isPhoneish = () => window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
export function applyQuality(name) {
  qualityName = QUALITY[name] ? name : 'high';
  quality = QUALITY[qualityName];
  resScale = 1; // a fresh choice starts at full resolution again
  applyResolution();
  if (renderer.shadowMap.enabled !== quality.shadows) {
    renderer.shadowMap.enabled = quality.shadows;
    moon.castShadow = quality.shadows;
    // Materials compile differently with shadows on or off.
    scene.traverse((o) => { for (const mat of [].concat(o.material ?? [])) mat.needsUpdate = true; });
  }
  markShadows();
  if (moon.shadow.mapSize.x !== quality.shadowSize) {
    moon.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    moon.shadow.map?.dispose();
    moon.shadow.map = null;
  }
  setForestDensity(quality.trees);
  document.querySelectorAll('[data-quality]').forEach((b) => b.classList.toggle('on', b.dataset.quality === qualityName));
  wake();
}

// --- Render on demand ------------------------------------------------------------
// The scene redraws at full rate only while something is happening: the
// camera or a finger moving, a runner jogging, dice tumbling, a marker
// burst, a camera tween, tiles easing, midnight setting in. Otherwise it
// ticks over at the quality's idle rate (rain, water and flicker keep going,
// just more slowly), which keeps phones cool. wake(ms) asks for full rate.
export let wakeUntil = 0;
// --- Shadow window -----------------------------------------------------------------
// The moon's shadows cover only the ground in view plus a margin, not the
// whole board: on a 60 x 60 board a shadow redraw drew the whole forest
// (3.4M triangles on a Pixel 10a) even for a close-up.
// The shadow camera looks along the moonlight from above the board's centre;
// only its rectangle changes. Each frame the ground in view is found (the
// view's corner rays meeting the ground) and turned into moonlight space,
// where a caster lines up with the shadow it throws, so that rectangle holds
// everything casting into the view. The window moves (and shadows are
// redrawn) only when the view leaves it or zooms well in, so redraws stay
// rare; a view taking in most of the board gets the whole board.
const SHADOW_MARGIN = 0.3;   // added on each side, as a share of the view's size
const SHADOW_MIN = 6;        // smallest window side, cells
const LIGHT_DIR = new THREE.Vector3(-0.6, 1.2, -0.5).normalize();
const LX = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), LIGHT_DIR).normalize(); // moonlight-space x
const LY = new THREE.Vector3().crossVectors(LIGHT_DIR, LX);                                       // moonlight-space y
const shadowWin = { full: 30, all: null, win: null };
const tmpRay = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const NDC_CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]];
const rectOf = (pts) => {
  const r = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const p of pts) { const x = p.dot(LX), y = p.dot(LY); r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y); }
  return r;
};
export function resetShadowWindow(full) {
  shadowWin.full = full;
  const c = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => new THREE.Vector3(a * full, 0, b * full));
  shadowWin.all = rectOf(c);
  const L = full * 1.6; // far enough above anything on the board
  moon.target.position.set(0, 0, 0);
  moon.position.copy(LIGHT_DIR).multiplyScalar(L);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = L + full * 2;
  moon.target.updateMatrixWorld();
  shadowWin.win = null; // refit on the next frame
}
function setShadowRect(r) {
  shadowWin.win = r;
  Object.assign(moon.shadow.camera, { left: r.x0, right: r.x1, bottom: r.y0, top: r.y1 });
  moon.shadow.camera.updateProjectionMatrix();
  markShadows();
}
// The ground in view, as a rectangle in moonlight space, clipped to the
// whole shadow area (null: nothing of the board in view).
export function viewShadowRect() {
  const cam = camera.position;
  const reach = Math.max(40, cam.distanceTo(controls.target) * 1.5); // rays that miss the ground stop here
  const pts = [controls.target.clone().setY(0)];
  for (const [nx, ny] of NDC_CORNERS) {
    tmpRay.set(nx, ny, 0.5).unproject(camera).sub(cam).normalize();
    const t = tmpRay.y < -1e-3 ? -cam.y / tmpRay.y : Infinity;
    if (t < reach) pts.push(tmpP.set(cam.x + tmpRay.x * t, 0, cam.z + tmpRay.z * t).clone());
    else { const h = Math.hypot(tmpRay.x, tmpRay.z) || 1; pts.push(tmpP.set(cam.x + (tmpRay.x / h) * reach, 0, cam.z + (tmpRay.z / h) * reach).clone()); }
  }
  const r = rectOf(pts), a = shadowWin.all;
  return { x0: Math.max(r.x0, a.x0), x1: Math.min(r.x1, a.x1), y0: Math.max(r.y0, a.y0), y1: Math.min(r.y1, a.y1) };
}
const area = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0);
// Called every frame; changes the shadow window (and asks for a redraw)
// only when the view needs it.
export function fitShadows() {
  if (!renderer.shadowMap.enabled || !shadowWin.all) return;
  const need = viewShadowRect(), w = shadowWin.win, a = shadowWin.all;
  if (need.x0 >= need.x1 || need.y0 >= need.y1) { if (!w) setShadowRect(a); return; }
  const inside = w && need.x0 >= w.x0 && need.x1 <= w.x1 && need.y0 >= w.y0 && need.y1 <= w.y1;
  const tooLoose = w && area(w) > area(need) * 4 && area(w) > SHADOW_MIN * SHADOW_MIN * 4;
  if (inside && !tooLoose) return;
  const mx = Math.max(SHADOW_MIN / 2, (need.x1 - need.x0) * SHADOW_MARGIN), my = Math.max(SHADOW_MIN / 2, (need.y1 - need.y0) * SHADOW_MARGIN);
  const r = { x0: Math.max(a.x0, need.x0 - mx), x1: Math.min(a.x1, need.x1 + mx), y0: Math.max(a.y0, need.y0 - my), y1: Math.min(a.y1, need.y1 + my) };
  setShadowRect(area(r) >= area(a) * 0.7 ? a : r); // most of the board: all of it
}
export const shadowWindow = () => ({ ...shadowWin.win });

// Ask for the shadow map to be redrawn on the next frame.
export let shadowsDirty = true;
export function markShadows() { shadowsDirty = true; }
export function __clearShadowsDirty() { shadowsDirty = false; }
export function wake(ms = 1200) { wakeUntil = Math.max(wakeUntil, performance.now() + ms); }

// ---------------------------------------------------------------------------
// Shared materials / geometry
// ---------------------------------------------------------------------------

export const cellToWorld = (x, y) => new THREE.Vector3(
  (x - grid.cols / 2 + 0.5) * TILE, 0, (y - grid.rows / 2 + 0.5) * TILE,
);
export function holedGround(hole) {
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
export const hash32 = (n) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
};
// A building's look, from its first cell (so it stays put as you paint).
export function buildingStyle(seed) {
  const h = hash32(seed * 2654435761 + 1013904223);
  const s = BUILDING_STYLES[h % BUILDING_STYLES.length];
  return { ...s, windowVariant: (h >>> 8) % 4, frame: FRAME_COLOURS[(h >>> 12) % FRAME_COLOURS.length] };
}
export function interiorStyle(seed) {
  return INTERIOR_STYLES[hash32(seed * 40503 + 2246822519) % INTERIOR_STYLES.length];
}
// Which building each cell belongs to: the lowest cell index of its
// building (-1 outdoors). A building is indoor floor joined by open floor or
// doors; a wall or window between two floors splits them, so a row of shops
// sharing walls gets a different look per shop.
export function buildingSeeds() {
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
