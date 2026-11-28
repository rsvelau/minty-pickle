// Midnight dread: the town turns menacing once the clock strikes twelve.
//
// - Every light source flickers, each on its own rhythm, with its whole pool
//   of light (lit cells, street surface, light pools, lamp globes, van
//   headlights, lit windows) dipping together. A per-cell texture says which
//   source lights each cell; shaders look it up from the instance's position.
//   Dips are slow (well under 3 a second per light) and never go fully dark,
//   so it unsettles without strobing.
// - Trees sway in the wind (see swayFir).
//
// `dreadUniforms.uDread` (0..1) fades all of it in and out.
import * as THREE from 'three';

export const dreadUniforms = {
  uDread: { value: 0 },
  uDreadTime: { value: 0 },
  uSeedTex: { value: null },
  uSeedBoard: { value: new THREE.Vector2(1, 1) },
};
{
  const tex = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  dreadUniforms.uSeedTex.value = tex;
}

// src[i] = index of the strongest light source on cell i (-1 = none).
export function setLightSeeds(cols, rows, src) {
  const data = new Float32Array(cols * rows);
  for (let i = 0; i < data.length; i++) {
    const s = src[i] ?? -1;
    data[i] = s < 0 ? 0 : 0.05 + 0.95 * ((Math.sin((s + 1) * 12.9898) * 43758.5453) % 1 + 1) % 1;
  }
  let tex = dreadUniforms.uSeedTex.value;
  if (tex.image.width !== cols || tex.image.height !== rows) {
    tex.dispose();
    tex = new THREE.DataTexture(data, cols, rows, THREE.RedFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    dreadUniforms.uSeedTex.value = tex;
  } else {
    tex.image.data = data;
  }
  tex.needsUpdate = true;
  dreadUniforms.uSeedBoard.value.set(cols, rows);
}

// Brightness multiplier (0.08..1) for a light with seed h (0..1) at time t.
const FLICKER_GLSL = /* glsl */ `
uniform float uDread;
uniform float uDreadTime;
uniform sampler2D uSeedTex;
uniform vec2 uSeedBoard;
float dreadHash(float n) { return fract(sin(n) * 43758.5453); }
float dreadFlicker(vec3 wp) {
  if (uDread <= 0.0) return 1.0;
  vec2 uv = (wp.xz + uSeedBoard * 0.5) / uSeedBoard;
  float h = texture2D(uSeedTex, clamp(uv, 0.0, 1.0)).r;
  if (h <= 0.0) h = 0.37; // not tied to a source (e.g. off the board)
  float t = uDreadTime;
  // A sickly waver that never settles.
  float slow = 0.11 * sin(t * 5.3 + h * 40.0) + 0.08 * sin(t * 8.9 + h * 17.0);
  // Dropouts: the light sags, sometimes nearly out, for a fraction of a second.
  float k = t * (0.85 + 0.55 * fract(h * 7.3)) + fract(h * 13.7) * 10.0;
  float slot = floor(k), ph = fract(k);
  float r = dreadHash(slot * 12.9898 + h * 78.233);
  float st = 0.15 + 0.5 * fract(r * 9.1);
  float len = 0.1 + 0.16 * fract(r * 3.7);
  float dip = smoothstep(st, st + 0.04, ph) * (1.0 - smoothstep(st + len, st + len + 0.06, ph));
  dip *= step(0.22, r);
  float depth = 0.6 + 0.3 * fract(r * 5.3);
  return clamp(1.0 - uDread * (depth * dip + 0.12 + slow), 0.08, 1.0);
}
`;

// The same flicker on the CPU, for point lights and single meshes.
export function flickerAt(h, t, dread) {
  if (dread <= 0) return 1;
  const hash = (n) => { const v = Math.sin(n) * 43758.5453; return v - Math.floor(v); };
  const fr = (v) => v - Math.floor(v);
  const slow = 0.11 * Math.sin(t * 5.3 + h * 40) + 0.08 * Math.sin(t * 8.9 + h * 17);
  const k = t * (0.85 + 0.55 * fr(h * 7.3)) + fr(h * 13.7) * 10;
  const slot = Math.floor(k), ph = fr(k);
  const r = hash(slot * 12.9898 + h * 78.233);
  const st = 0.15 + 0.5 * fr(r * 9.1);
  const len = 0.1 + 0.16 * fr(r * 3.7);
  const ss = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  let dip = ss(st, st + 0.04, ph) * (1 - ss(st + len, st + len + 0.06, ph));
  if (r < 0.22) dip = 0;
  const depth = 0.6 + 0.3 * fr(r * 5.3);
  return Math.min(1, Math.max(0.08, 1 - dread * (depth * dip + 0.12 + slow)));
}

// Make a glowing material flicker with its light source. `part`: 'emissive'
// (only the self-lit part dims: lit tiles, street surfaces) or 'all' (the
// whole colour: glows, pools, lamp glass, headlight beams).
// `perInstance`: seed from the instance's position (instanced meshes placed
// on their cell); otherwise from each vertex's position.
export function flickerize(material, { part = 'all', perInstance = true } = {}) {
  if (!material || material.userData.flickerized) return;
  material.userData.flickerized = true;
  const original = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey.call(material);
  material.onBeforeCompile = function dreadOBC(shader, renderer) {
    original.call(this, shader, renderer);
    Object.assign(shader.uniforms, dreadUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDreadWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 dwp = vec4(${perInstance ? 'vec3(0.0)' : 'transformed'}, 1.0);
        #ifdef USE_INSTANCING
          dwp = instanceMatrix * dwp;
        #endif
        vDreadWP = (modelMatrix * dwp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDreadWP;\n${FLICKER_GLSL}`);
    if (part === 'emissive') {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>',
        'totalEmissiveRadiance *= dreadFlicker(vDreadWP);\n#include <lights_fragment_begin>');
    } else {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight *= dreadFlicker(vDreadWP);\n#include <opaque_fragment>');
    }
  };
  material.customProgramCacheKey = () => `${originalKey}|dread:${part}${perInstance ? 'i' : 'v'}`;
  material.needsUpdate = true;
}

// Firs bend in the wind at midnight: the crown sways most, the trunk not at
// all, each tree on its own phase, with slow gusts rolling through.
export const swayUniforms = { uSway: { value: 0 }, uSwayTime: { value: 0 } };
export function swayFir(shader) {
  Object.assign(shader.uniforms, swayUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uSway;\nuniform float uSwayTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      if (uSway > 0.0) {
        vec2 base = vec2(0.0);
        #ifdef USE_INSTANCING
          base = instanceMatrix[3].xz;
        #endif
        float ph = dot(base, vec2(0.37, 0.61));
        float gust = 0.55 + 0.45 * sin(uSwayTime * 0.45 + base.x * 0.05 + base.y * 0.03);
        float bend = (sin(uSwayTime * 1.4 + ph) * 0.65 + sin(uSwayTime * 2.7 + ph * 1.9) * 0.25) * gust;
        float hgt = max(transformed.y - 0.12, 0.0);
        // Wind from the west-south-west in world space, turned into the
        // tree's own (rotated, scaled) space.
        vec3 world = vec3(bend + 0.6 * gust, 0.0, 0.45 * sin(uSwayTime * 1.1 + ph * 2.3) * gust);
        vec3 offs = world * (uSway * hgt * hgt * 0.05);
        #ifdef USE_INSTANCING
          // Into the tree's own space. Its matrix is a turn times a scale
          // per axis, so the inverse is each column over its length squared
          // (cheap, unlike inverse() on every vertex).
          vec3 c0 = instanceMatrix[0].xyz, c1 = instanceMatrix[1].xyz, c2 = instanceMatrix[2].xyz;
          float l1 = dot(c1, c1);
          offs *= sqrt(l1); // taller trees bend further
          offs = vec3(dot(c0, offs) / dot(c0, c0), dot(c1, offs) / l1, dot(c2, offs) / dot(c2, c2));
        #endif
        transformed += offs;
      }`);
}
