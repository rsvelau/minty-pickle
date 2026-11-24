// Everything around the board, at real-world scale: the forest ring, the
// small reference house, rain, atmosphere and tree fading near the camera.

import * as THREE from 'three';
import { m } from '../core/scale.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { swayFir } from './dread.js';
import { grid, rand32, ui } from '../app/config.js';
import { dread } from '../app/loop.js';
import { syncSizeInputs } from '../app/panelControls.js';
import { setHover } from '../app/pointer.js';
import { scheduleSave, updateCounts, updateHoverInfo } from '../app/shell.js';
import { move, refreshMoveOverlay } from '../editor/moveCheck.js';
import { play, renderPlay } from '../play/playView.js';
import { N, buildBoard, disposeChildren, refreshWaterAndBridges } from './board.js';
import { FOG, board, camera, quality, scene, setCamera } from './scene.js';
import { flagDirty, lampsOn, lightLevels, recomputeLight, refreshCell, tmpMatrix, tmpPos, tmpQuat, tmpScale } from './tileLook.js';

// Module state: assigned by init() below, in the same order as before the split.
export let atmos, surroundGroup, firGeo, fadeUniforms, firMat, HOUSE_W;
export let HOUSE_D, ghostHouse, rainPos, rainSpeed, RAIN_TOP, STREAK;
export let rainBox, RAIN_GREY, RAIN_RED, rainMat;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // ---------------------------------------------------------------------------
  // Surroundings, built to real-world scale (1 cell = METERS_PER_CELL metres)
  // ---------------------------------------------------------------------------

  atmos = new THREE.Group();
  scene.add(atmos);
  surroundGroup = new THREE.Group();
  atmos.add(surroundGroup);
  firGeo = makeFirGeometry();

  // Trees between the camera and the board dissolve so they never hide cells.
  fadeUniforms = { uCamXZ: { value: new THREE.Vector2() }, uFadeD: { value: 0 } };
  firMat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
  HOUSE_W = m(9);
  HOUSE_D = m(8);

  ghostHouse = makeHouse({ ghost: true });
  ghostHouse.visible = false;
  scene.add(ghostHouse);
  rainPos = new Float32Array(0);
  rainSpeed = new Float32Array(0);
  RAIN_TOP = m(80);
  STREAK = m(1.5);
  rainBox = { x: 0, z: 0 };
  RAIN_GREY = new THREE.Color('#8aa0b8');
  RAIN_RED = new THREE.Color('#c41e2a');
  rainMat = new THREE.LineBasicMaterial({ color: '#8aa0b8', transparent: true, opacity: 0.22, depthWrite: false });

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
}

// A Douglas fir in unit space: base at y=0, top at y=1, crown radius 1 at the
// bottom tier. Instances scale it to (crownRadius, height, crownRadius).
export function makeFirGeometry() {
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
export function makeHouse({ ghost = false } = {}) {
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

export let porchLight = null, houseWindow = null;
export function buildSurroundings() {
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
  // Trees go into square sectors, one batch each, so the renderer skips the
  // sectors behind the camera and those lost in the fog (see cullForest).
  const SECTOR = 14;
  const sectors = new Map(); // "sx,sz" -> [{ matrix, shade }]
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
    const sk = `${Math.floor(x / SECTOR)},${Math.floor(z / SECTOR)}`;
    if (!sectors.has(sk)) sectors.set(sk, []);
    sectors.get(sk).push({ matrix: tmpMatrix.clone(), shade: 0.75 + rnd() * 0.5 });
    placed++;
  }
  forestChunks = [];
  for (const list of sectors.values()) {
    const firs = new THREE.InstancedMesh(firGeo, firMat, list.length);
    firs.castShadow = true;
    firs.receiveShadow = true;
    firs.raycast = () => {};
    list.forEach((t, k) => { firs.setMatrixAt(k, t.matrix); firs.setColorAt(k, shade.setScalar(t.shade)); });
    firs.computeBoundingSphere();
    surroundGroup.add(firs);
    forestChunks.push({ mesh: firs, placed: list.length });
  }
  setForestDensity(quality.trees);
}

// The forest ring in sectors: { mesh, placed }. Lower quality draws fewer
// trees in each (trees were placed in random order, so cutting the list
// thins every sector evenly).
export let forestChunks = [];
export function setForestDensity(fraction) {
  for (const c of forestChunks) c.mesh.count = Math.round(c.placed * fraction);
}
// Sectors wholly beyond the fog can't be seen (fog fades to the sky colour):
// don't draw them at all. Fog goes by depth along the view direction, so a
// sector is hidden only when even its nearest point is deeper than fog.far.
// Called every frame.
const tmpFwd = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
export function cullForest() {
  const far = scene.fog ? scene.fog.far : Infinity;
  camera.getWorldDirection(tmpFwd);
  for (const c of forestChunks) {
    const s = c.mesh.boundingSphere;
    c.mesh.visible = tmpTo.subVectors(s.center, camera.position).dot(tmpFwd) - s.radius < far;
  }
}

// Drizzle: streaks ~1.5 m long, spread over the board and the near forest.
export let rain = null;

export function buildRain() {
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
export function spawnDrop(i, y) {
  const x = (Math.random() - 0.5) * rainBox.x;
  const z = (Math.random() - 0.5) * rainBox.z;
  rainPos.set([x, y, z, x + 0.03, y - STREAK, z + 0.01], i * 6);
}
export function updateRain(dt) {
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

export function applyAtmosphere() {
  atmos.visible = ui.atmosphere;
  scene.fog = ui.atmosphere ? FOG : null;
}

// Horizontal distance from the camera to the nearest edge of the board (incl.
// labels). Trees closer to the camera than this are dissolved.
export function updateTreeFade() {
  const hx = board.w / 2 + 1.2;
  const hz = board.d / 2 + 1.2;
  const cx = camera.position.x;
  const cz = camera.position.z;
  const nx = THREE.MathUtils.clamp(cx, -hx, hx);
  const nz = THREE.MathUtils.clamp(cz, -hz, hz);
  fadeUniforms.uCamXZ.value.set(cx, cz);
  fadeUniforms.uFadeD.value = Math.hypot(cx - nx, cz - nz);
}
