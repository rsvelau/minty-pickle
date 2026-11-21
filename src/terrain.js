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
import { isLandmark } from './state.js';

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

// --- per-cell overrides -------------------------------------------------------
// Some cells don't follow the smooth formula: lakes sit level, rivers are
// flattened down to their lowest point, buildings are levelled, and bridges
// keep the height of the road on their banks. Roads are smoothed (see
// updateOverrides). Each board cell stores
//   R = 1 if its ground level is overridden, G = that level (cells),
//   R = 2 for a road cell: G = its smoothed level; between road cells the
//         ground is blended along the road only, never across it,
//   B = 1 if it is a bridge cell,           A = the bridge deck level (cells).
// Shaders read this texture; picking and marker badges read the same array.
export const terrainUniforms = {
  terrainTex: { value: null },
  terrainBoard: { value: new THREE.Vector2(1, 1) },
};
let overrideData = new Float32Array(4);
let ovCols = 1, ovRows = 1;
// Vertices this close (cells) to an overridden neighbour follow it: lets
// walls and foundations on a building's edge rise with the building, while
// neighbouring tiles (inset further than this) keep their own ground.
const EDGE_GRAB = 0.027;
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
#if defined( TERRAIN_CENTRE ) || defined( TERRAIN_INSTANCE )
// Whole-cell surfaces take their override from their own cell (the instance
// centre), never from a levelled neighbour across the edge. Upright props
// (TERRAIN_INSTANCE) are lifted as one piece by the ground at their base.
{
	vec4 tc = vec4( 0.0, 0.0, 0.0, 1.0 );
	#ifdef USE_INSTANCING
	tc = instanceMatrix * tc;
	#endif
	terrainHint = ( modelMatrix * tc ).xz;
}
#endif
vec4 terrainWorld = modelMatrix * mvPosition;
terrainWorld.y += terrainHeight( terrainWorld.xyz );
mvPosition = viewMatrix * terrainWorld;
gl_Position = projectionMatrix * mvPosition;
`;

// Set by main.js: bed and deck heights, for stretching bridge piers.
export const BRIDGE_SPAN = { bed: -0.5, deck: 0.0 };

function glslFor(expr) {
  const mpc = METERS_PER_CELL.toFixed(4);
  const f = (v) => v.toFixed(5);
  return `
float terrainSmooth( vec2 p ) {
	float X = p.x * ${mpc};
	float Z = p.y * ${mpc};
	return ( ${expr} ) / ${mpc};
}
#ifdef TERRAIN_TEX
uniform sampler2D terrainTex;
uniform vec2 terrainBoard;
vec2 terrainHint = vec2( 0.0 );
vec4 terrainCell( vec2 g ) {
	ivec2 c = ivec2( floor( g ) );
	if ( c.x < 0 || c.y < 0 || float( c.x ) >= terrainBoard.x || float( c.y ) >= terrainBoard.y ) return vec4( 0.0 );
	return texelFetch( terrainTex, c, 0 );
}
// Road surface at a point: the smoothed levels of the road cells around it,
// blended by distance. Only road cells count, so a road is level from side
// to side and slopes gently along its length.
float terrainRoad( vec2 p, float fallback ) {
	vec2 g = p + terrainBoard * 0.5 - 0.5;
	vec2 i0 = floor( g ) + 0.5;
	vec2 f = g - floor( g );
	float s = 0.0, wsum = 0.0;
	vec4 c; float w;
	c = terrainCell( i0 );                  w = ( 1.0 - f.x ) * ( 1.0 - f.y ); if ( c.r > 1.5 ) { s += w * c.g; wsum += w; }
	c = terrainCell( i0 + vec2( 1.0, 0.0 ) ); w = f.x * ( 1.0 - f.y );         if ( c.r > 1.5 ) { s += w * c.g; wsum += w; }
	c = terrainCell( i0 + vec2( 0.0, 1.0 ) ); w = ( 1.0 - f.x ) * f.y;         if ( c.r > 1.5 ) { s += w * c.g; wsum += w; }
	c = terrainCell( i0 + vec2( 1.0, 1.0 ) ); w = f.x * f.y;                   if ( c.r > 1.5 ) { s += w * c.g; wsum += w; }
	return wsum > 1e-4 ? s / wsum : fallback;
}
// Override for a point: its own cell, else an overridden neighbour whose edge
// it hugs (within ${f(EDGE_GRAB)} cells).
vec4 terrainOverride( vec2 p ) {
	vec2 g = p + terrainBoard * 0.5;
	vec4 o = terrainCell( g );
	if ( o.r > 0.5 || o.b > 0.5 ) return o;
	vec2 fr = fract( g );
	vec2 d = vec2( fr.x < ${f(EDGE_GRAB)} ? -1.0 : ( fr.x > ${f(1 - EDGE_GRAB)} ? 1.0 : 0.0 ),
	               fr.y < ${f(EDGE_GRAB)} ? -1.0 : ( fr.y > ${f(1 - EDGE_GRAB)} ? 1.0 : 0.0 ) );
	if ( d.x != 0.0 ) { vec4 n = terrainCell( g + vec2( d.x, 0.0 ) ); if ( n.r > 0.5 ) return n; }
	if ( d.y != 0.0 ) { vec4 n = terrainCell( g + vec2( 0.0, d.y ) ); if ( n.r > 0.5 ) return n; }
	if ( d.x != 0.0 && d.y != 0.0 ) { vec4 n = terrainCell( g + d ); if ( n.r > 0.5 ) return n; }
	return vec4( 0.0 );
}
#endif
// World position (cells) -> how far to lift it.
float terrainHeight( vec3 w ) {
#ifdef TERRAIN_NONE
	return 0.0; // placed at its final height on the CPU (walls, doors...)
#endif
#ifdef TERRAIN_INSTANCE
	float h = terrainSmooth( terrainHint );
#else
	float h = terrainSmooth( w.xz );
#endif
#ifdef TERRAIN_TEX
	#if defined( TERRAIN_CENTRE ) || defined( TERRAIN_INSTANCE )
	vec4 o = terrainCell( terrainHint + terrainBoard * 0.5 );
	#else
	vec4 o = terrainOverride( w.xz );
	#endif
	#ifdef TERRAIN_INSTANCE
	if ( o.r > 0.5 ) h = o.g; // props stand on their cell's level
	#else
	if ( o.r > 1.5 ) h = terrainRoad( w.xz, o.g );
	else if ( o.r > 0.5 ) h = o.g;
	#endif
	#ifdef TERRAIN_BRIDGE
	// Bridge parts: deck and trusses at bank level; piers stretch from the
	// (possibly lowered) riverbed up to the deck.
	if ( o.b > 0.5 ) h = mix( h, o.a, smoothstep( ${f(BRIDGE_SPAN.bed)}, ${f(BRIDGE_SPAN.deck)} - 0.25, w.y ) );
	#endif
#endif
	return h;
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
// Smooth preset height (cells) at world (x, z), ignoring overrides.
export const terrainSmoothAt = (x, z) => fn(x, z);

// Ground level (cells) at world (x, z), including lake/river/building
// overrides; `bridge` uses bridge deck level on bridge cells.
export function terrainHeight(x, z, { bridge = false } = {}) {
  const gx = Math.floor(x + ovCols / 2), gy = Math.floor(z + ovRows / 2);
  if (gx >= 0 && gy >= 0 && gx < ovCols && gy < ovRows) {
    const o = (gy * ovCols + gx) * 4;
    if (bridge && overrideData[o + 2] > 0.5) return overrideData[o + 3];
    if (overrideData[o] > 1.5) return roadHeight(x, z, overrideData[o + 1]);
    if (overrideData[o] > 0.5) return overrideData[o + 1];
  }
  return fn(x, z);
}
// The same blend as terrainRoad() in the shader.
function roadHeight(x, z, fallback) {
  const gx = x + ovCols / 2 - 0.5, gy = z + ovRows / 2 - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
  let s = 0, wsum = 0;
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const cx = x0 + dx, cy = y0 + dy;
    if (cx < 0 || cy < 0 || cx >= ovCols || cy >= ovRows) continue;
    const o = (cy * ovCols + cx) * 4;
    if (overrideData[o] > 1.5) { s += w * overrideData[o + 1]; wsum += w; }
  }
  return wsum > 1e-4 ? s / wsum : fallback;
}

// Ground level of a board cell's centre (cells).
export function cellLevel(x, y, opts) {
  return terrainHeight(x - ovCols / 2 + 0.5, y - ovRows / 2 + 0.5, opts);
}

// Recompute per-cell overrides from the grid. Lakes: level at their lowest
// cell. Rivers: flattened to their lowest cell. Buildings (connected indoor
// cells): level at their average ground. Bridges: deck at the average height
// of the ground just beyond each end of the span.
export function updateOverrides(grid) {
  const { cols, rows } = grid;
  const n = cols * rows;
  const data = new Float32Array(n * 4);
  const centre = (i) => {
    const x = i % cols, y = Math.floor(i / cols);
    return fn(x - cols / 2 + 0.5, y - rows / 2 + 0.5);
  };
  const seen = new Uint8Array(n);
  const flood = (i, same) => {
    const out = [i];
    seen[i] = 1;
    for (let k = 0; k < out.length; k++) {
      const j = out[k], x = j % cols, y = Math.floor(j / cols);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const m = ny * cols + nx;
        if (!seen[m] && same(m)) { seen[m] = 1; out.push(m); }
      }
    }
    return out;
  };
  const kind = (i) => {
    const c = grid.cells[i];
    if (c.area === 'water') return c.sub === 'river' ? 'river' : 'lake';
    if (c.area === 'indoor') return 'indoor';
    if (c.area === 'outdoor' && isLandmark(c.sub)) return `tower:${c.sub}`; // landmarks are levelled like buildings
    return null;
  };
  if (current !== 'flat') {
    for (let i = 0; i < n; i++) {
      const k = kind(i);
      if (!k || seen[i]) continue;
      const cells = flood(i, (m) => kind(m) === k);
      const hs = cells.map(centre);
      const level = k === 'indoor' || k.startsWith('tower') ? hs.reduce((a, b) => a + b, 0) / hs.length : Math.min(...hs);
      for (const j of cells) { data[j * 4] = 1; data[j * 4 + 1] = level; }
    }
    // Roads (street, start space, path): each cell gets a smoothed level, pulled
    // toward its neighbours along the road (so bumps and kinks even out) and,
    // in front of a levelled building or landmark, toward that building's
    // floor, so the road there runs level with the building.
    const isRoad = (i) => {
      const c = grid.cells[i];
      return c.area === 'outdoor' && (c.sub === 'street' || c.sub === 'start' || c.sub === 'path');
    };
    const roads = [];
    for (let i = 0; i < n; i++) if (isRoad(i)) roads.push(i);
    if (roads.length) {
      const level = new Float32Array(n), target = new Float32Array(n), pull = new Float32Array(n);
      const nbrs = new Map();
      for (const i of roads) {
        const x = i % cols, y = Math.floor(i / cols);
        const near = [], beside = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const m = ny * cols + nx;
          if (isRoad(m)) near.push(m);
          else if (data[m * 4] > 0.5) {
            const k = kind(m);
            if (k === 'indoor' || k?.startsWith('tower')) beside.push(data[m * 4 + 1]);
          }
        }
        nbrs.set(i, near);
        level[i] = centre(i);
        // Next to a building: aim for its floor (firmly). Otherwise: the hill (gently).
        target[i] = beside.length ? beside.reduce((a, b) => a + b, 0) / beside.length : level[i];
        pull[i] = beside.length ? 4 : 0.5;
      }
      for (let it = 0; it < 60; it++) {
        const next = new Float32Array(level);
        for (const i of roads) {
          const near = nbrs.get(i);
          let sum = pull[i] * target[i];
          for (const m of near) sum += level[m];
          next[i] = sum / (pull[i] + near.length);
        }
        level.set(next);
      }
      for (const i of roads) { data[i * 4] = 2; data[i * 4 + 1] = level[i]; }
    }
    // Bridges: deck level from the land beyond each end of the span.
    const bseen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!grid.cells[i].bridge || bseen[i]) continue;
      const cells = [i];
      bseen[i] = 1;
      for (let k = 0; k < cells.length; k++) {
        const j = cells[k], x = j % cols, y = Math.floor(j / cols);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const m = ny * cols + nx;
          if (!bseen[m] && grid.cells[m].bridge) { bseen[m] = 1; cells.push(m); }
        }
      }
      const ends = [];
      for (const j of cells) {
        const x = j % cols, y = Math.floor(j / cols);
        const axis = grid.bridgeAxis(x, y);
        const steps = axis === 'x' ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
        for (const [dx, dy] of steps) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const m = ny * cols + nx;
          if (grid.cells[m].bridge || grid.cells[m].area === 'water') continue;
          ends.push(data[m * 4] > 0.5 ? data[m * 4 + 1] : centre(m));
        }
      }
      const level = ends.length ? ends.reduce((a, b) => a + b, 0) / ends.length
        : cells.map(centre).reduce((a, b) => a + b, 0) / cells.length;
      for (const j of cells) { data[j * 4 + 2] = 1; data[j * 4 + 3] = level; }
    }
  }
  overrideData = data;
  ovCols = cols;
  ovRows = rows;
  let tex = terrainUniforms.terrainTex.value;
  if (!tex || tex.image.width !== cols || tex.image.height !== rows) {
    tex?.dispose();
    tex = new THREE.DataTexture(data, cols, rows, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    terrainUniforms.terrainTex.value = tex;
  } else {
    tex.image.data = data;
  }
  tex.needsUpdate = true;
  terrainUniforms.terrainBoard.value.set(cols, rows);
}

// Give a material the override map (built-in materials get it through
// onBeforeCompile). `bridge` materials keep bridge decks at bank level.
// `none` materials aren't lifted at all: their geometry is already placed at
// its final height (walls, doors and windows stand upright on the floor).
// `centre` materials are whole-cell surfaces (streets): they follow their own
// cell only, so a levelled building or lowered river next door can't kink them.
// `instance` materials are upright props (trees, headstones, furniture): each
// instance rises as one rigid piece with the ground under its base, so tall
// trees beside a levelled building or on a slope never stretch or lean
// into their neighbours.
export function terrainify(material, { bridge = false, none = false, centre = false, instance = false } = {}) {
  if (!material || material.userData.terrainified || material.isSpriteMaterial) return;
  material.userData.terrainified = true;
  if (material.isShaderMaterial) return; // handled by the shader itself
  const original = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey.call(material);
  material.onBeforeCompile = function terrainOBC(shader, renderer) {
    original.call(this, shader, renderer);
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = `#define TERRAIN_TEX\n${bridge ? '#define TERRAIN_BRIDGE\n' : ''}${none ? '#define TERRAIN_NONE\n' : ''}${centre ? '#define TERRAIN_CENTRE\n' : ''}${instance ? '#define TERRAIN_INSTANCE\n' : ''}${shader.vertexShader}`;
  };
  material.customProgramCacheKey = () => `${originalKey}|tt${bridge ? 'b' : ''}${none ? 'n' : ''}${centre ? 'c' : ''}${instance ? 'i' : ''}|terrain:${current}`;
  material.needsUpdate = true;
}

// Where a ray meets the terrain lifted by `offset` (cells): marches along the
// ray and refines with bisection. Returns a Vector3 or null.
export function rayTerrain(ray, offset = 0, maxDist = 600) {
  const p = new THREE.Vector3();
  const above = (t) => {
    ray.at(t, p);
    return p.y - (offset + terrainHeight(p.x, p.z));
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
