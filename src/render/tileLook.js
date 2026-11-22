// How each cell looks: surface colour, light, height; per-cell refresh.

import * as THREE from 'three';
import { setLightSeeds } from './dread.js';
import { BASE, BED_H, DECK_TOP, FLOOR_H, PALETTE, SUB_LOOK, TILE, WATER_Y, grid, ui } from '../app/config.js';
import { N, glowAttr, heights, jitter, pools, refreshWaterAndBridges, targetHeights, tiles } from './board.js';
import { cellToWorld, scene } from './scene.js';
import { refreshPropsAndWalls } from './board.js';

// Module state: assigned by init() below, in the same order as before the split.
export let tmpColor, tmpMatrix, tmpPos, tmpQuat, tmpScale, ZERO;
export let lightLevels, lampsOn, tmpColor2, hoverBox;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // ---------------------------------------------------------------------------
  // Tile appearance
  // ---------------------------------------------------------------------------

  tmpColor = new THREE.Color();
  tmpMatrix = new THREE.Matrix4();
  tmpPos = new THREE.Vector3();
  tmpQuat = new THREE.Quaternion();
  tmpScale = new THREE.Vector3();
  ZERO = new THREE.Vector3(0, 0, 0);

  // Light level per cell (0..1, includes lamp spill) and which lamps are on;
  // recomputed on every change because a lamp lights its neighbours too.
  lightLevels = new Float32Array(0);
  lampsOn = new Uint8Array(0);
  tmpColor2 = new THREE.Color();

  // Hover outline
  hoverBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(TILE, 1, TILE).translate(0, 0.5, 0)),
    new THREE.LineBasicMaterial({ color: '#f1d9a8', transparent: true, opacity: 0.9, depthTest: false }),
  );
  hoverBox.renderOrder = 10;
  hoverBox.visible = false;
  scene.add(hoverBox);
}

// Power Outage (a Global event in a game): every light off except vehicle
// headlights. Set by the play view; the editor never sees it.
export let powerOut = false;
export function setPowerOut(on) {
  if (on === powerOut) return;
  powerOut = on;
  refreshAll();
  refreshPropsAndWalls();
}
export function recomputeLight() {
  const src = new Int32Array(grid.cells.length);
  lightLevels = grid.lightLevels(src, { powerOut });
  setLightSeeds(grid.cols, grid.rows, src); // which light each cell flickers with
  lampsOn = Uint8Array.from(grid.cells, (_, i) => (!powerOut && grid.lampOn(i) ? 1 : 0));
}

export const mixHex = (a, b, t) => tmpColor2.set(a).lerp(new THREE.Color(b), t).getHex();

export function cellLook(cell, level = 0, lamp = false) {
  // Returns { color, glow, height (tile top), pool: hexOrNull, poolY, poolScale }
  if (powerOut && cell.lit) cell = { ...cell, lit: false };
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

export function refreshCell(i) {
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

export function writeTileMatrix(i) {
  const { x, y } = grid.coords(i);
  tmpPos.copy(cellToWorld(x, y)).setY(-BASE);
  tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale.set(1, Math.max(BASE + heights[i], 0.001), 1));
  tiles.setMatrixAt(i, tmpMatrix);
}

export function refreshAll(instant = false) {
  recomputeLight();
  for (let i = 0; i < N; i++) refreshCell(i);
  if (instant) heights.set(targetHeights);
  for (let i = 0; i < N; i++) writeTileMatrix(i);
  refreshWaterAndBridges();
  flagDirty();
}

export function flagDirty() {
  tiles.instanceMatrix.needsUpdate = true;
  tiles.instanceColor.needsUpdate = true;
  glowAttr.needsUpdate = true;
  pools.instanceMatrix.needsUpdate = true;
  pools.instanceColor.needsUpdate = true;
  tiles.computeBoundingSphere();
}

export function makeLabel(text) {
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
