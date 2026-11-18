// Elevation presets.
//
// Each preset is one height formula in metres of (X, Z): metres from the
// board centre, +X east, +Z south (toward the bottom row). The same text
// runs as GLSL on the GPU (it lifts every vertex of the scene, so tiles,
// streets, walls, props, bridges and the forest all follow the ground) and
// as JavaScript on the CPU (picking cells under the pointer, placing marker
// badges). Write float literals with a decimal point (2.0, not 2) so the
// formula is valid in both languages.
import * as THREE from 'three';
import { METERS_PER_CELL } from './scale.js';

export const TERRAIN_PRESETS = {
  flat: {
    label: 'Flat',
    note: 'Level ground (the original board).',
    expr: '0.0',
  },
  hillside: {
    label: 'Gentle hillside',
    note: 'Rises about 4% from the bottom row to the top, with soft left-to-right undulations.',
    // ~4% grade uphill toward the top (-Z), plus gentle swells across X that
    // drift a little down the slope.
    expr: '(-Z * 0.04)'
      + ' + 0.9 * sin(X * 0.114 + 0.7) * (0.8 + 0.2 * sin(Z * 0.05))'
      + ' + 0.45 * sin(X * 0.27 + Z * 0.03 + 1.3)',
  },
  rolling: {
    label: 'Rolling hills',
    note: 'Soft hills and dips across the whole board, up to about 3 m either way.',
    expr: '2.0 * sin(X * 0.07 + 0.4) * cos(Z * 0.085 - 0.8)'
      + ' + 1.2 * sin((X * 0.6 + Z) * 0.09 + 1.1)'
      + ' + 0.6 * cos(X * 0.2 - Z * 0.16)',
  },
  hillHollow: {
    label: 'Hill and hollow',
    note: 'A rounded rise toward the top right and a damp hollow toward the bottom left, with a low ridge between.',
    expr: '5.0 * exp(-((X - 25.0) * (X - 25.0) + (Z + 35.0) * (Z + 35.0)) / 2600.0)'
      + ' - 2.6 * exp(-((X + 35.0) * (X + 35.0) + (Z - 45.0) * (Z - 45.0)) / 1500.0)'
      + ' + 0.9 * exp(-((X + Z * 0.8) * (X + Z * 0.8)) / 900.0)'
      + ' + 0.35 * sin(X * 0.21 + Z * 0.13)',
  },
};

let current = 'flat';
let fn = () => 0;
let installed = false;
const BASE_COMMON = THREE.ShaderChunk.common;
const BASE_PROJECT = THREE.ShaderChunk.project_vertex;

// Lift a world-space position by the terrain (cells). Used by every
// built-in material through the patched project_vertex chunk, and by the
// water shader directly.
const PROJECT = /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
vec4 terrainWorld = modelMatrix * mvPosition;
terrainWorld.y += terrainHeight( terrainWorld.xz );
mvPosition = viewMatrix * terrainWorld;
gl_Position = projectionMatrix * mvPosition;
`;

function glslFor(expr) {
  const mpc = METERS_PER_CELL.toFixed(4);
  return `
float terrainHeight( vec2 p ) {
	float X = p.x * ${mpc};
	float Z = p.y * ${mpc};
	return ( ${expr} ) / ${mpc};
}
`;
}

// Patch three's shader chunks once, before any material compiles.
export function installTerrain() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.project_vertex = PROJECT;
  // Programs must be rebuilt when the preset changes: fold it into every
  // material's program cache key.
  const orig = THREE.Material.prototype.customProgramCacheKey;
  THREE.Material.prototype.customProgramCacheKey = function terrainKey() {
    return `${orig.call(this)}|terrain:${current}`;
  };
  setTerrain(current);
}

// Switch preset. Returns true if it changed. Callers then mark the scene's
// materials for recompiling (see main.js).
export function setTerrain(id) {
  if (!TERRAIN_PRESETS[id]) id = 'flat';
  const changed = id !== current || !fn.ready;
  current = id;
  const { expr } = TERRAIN_PRESETS[id];
  THREE.ShaderChunk.common = `${BASE_COMMON}\n${glslFor(expr)}`;
  // Same formula in JS (sin/cos/exp from Math).
  const js = new Function('X', 'Z', `const { sin, cos, exp } = Math; return (${expr});`);
  fn = (x, z) => js(x * METERS_PER_CELL, z * METERS_PER_CELL) / METERS_PER_CELL;
  fn.ready = true;
  return changed;
}

export const terrainId = () => current;
export const isFlat = () => current === 'flat';
// Height of the ground (cells) at world (x, z).
export const terrainHeight = (x, z) => fn(x, z);

// Where a ray meets the terrain lifted by `offset` (cells): marches along the
// ray and refines with bisection. Returns a Vector3 or null.
export function rayTerrain(ray, offset = 0, maxDist = 600) {
  const p = new THREE.Vector3();
  const above = (t) => {
    ray.at(t, p);
    return p.y - (offset + fn(p.x, p.z));
  };
  let t0 = 0;
  let f0 = above(0);
  if (f0 <= 0) return null;
  const step = 0.2;
  for (let t = step; t <= maxDist; t += step * (1 + t / 60)) {
    const f = above(t);
    if (f <= 0) {
      let a = t0, b = t;
      for (let k = 0; k < 18; k++) {
        const mid = (a + b) / 2;
        if (above(mid) > 0) a = mid; else b = mid;
      }
      return ray.at(b, new THREE.Vector3());
    }
    t0 = t;
    f0 = f;
  }
  return null;
}

export { BASE_PROJECT };
