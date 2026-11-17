// Water surface: one plane over the whole board. A per-cell mask texture says
// which cells are lake or river; a linearly filtered flow texture carries the
// river direction so currents bend smoothly along the painted path.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D uMask;
  uniform sampler2D uFlow;
  uniform vec2 uSize;
  uniform float uTime;
  uniform float uFlat;
  uniform vec3 uLakeDeep, uLakeLight, uRiverDeep, uRiverLight, uFoam, uFlatLake, uFlatRiver;
  varying vec3 vW;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  // Streaks stretched along the current.
  float streaks(vec2 p, vec2 dir) {
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 q = vec2(dot(p, dir) * 0.8, dot(p, perp) * 3.2);
    return noise(q * 1.7) * 0.6 + noise(q * 4.3 + 7.1) * 0.4;
  }

  void main() {
    vec2 uv = (vW.xz + uSize * 0.5) / uSize;
    float kind = texture2D(uMask, uv).r;          // 0 land, 0.5 lake, 1 river
    if (kind < 0.25) discard;
    bool river = kind > 0.75;
    vec2 p = vW.xz;
    vec3 col;

    if (uFlat > 0.5) {
      col = river ? uFlatRiver : uFlatLake;
    } else if (river) {
      vec3 f = texture2D(uFlow, uv).rgb;
      vec2 flow = (f.rg * 2.0 - 1.0) * f.b;       // fades to zero at the banks
      float speed = length(flow);
      vec2 dir = speed > 0.05 ? flow / speed : vec2(-1.0, 0.0);
      // Two-phase flow map: offsets reset every period, cross-faded so the
      // pattern keeps moving downstream without stretching.
      float t = uTime * 0.45;
      float ph0 = fract(t), ph1 = fract(t + 0.5);
      float a = streaks(p - flow * ph0 * 1.8, dir);
      float b = streaks(p - flow * ph1 * 1.8 + 0.37, dir);
      float n = mix(a, b, abs(0.5 - ph0) * 2.0);
      col = mix(uRiverDeep, uRiverLight, smoothstep(0.35, 0.85, n));
      col += uFoam * smoothstep(0.8, 0.97, n) * 0.6;
    } else {
      // Still lake: slow, faint ripples and the odd glint of moonlight.
      float n = noise(p * 1.3 + vec2(uTime * 0.04, uTime * 0.03)) * 0.6 + noise(p * 3.1 - uTime * 0.06) * 0.4;
      col = mix(uLakeDeep, uLakeLight, smoothstep(0.45, 0.9, n));
      col += uFoam * pow(n, 10.0) * 0.5;
    }

    // Faint cell lines so water can still be counted in squares.
    vec2 c = fract(vW.xz + uSize * 0.5);
    float edge = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
    col *= 1.0 - 0.35 * (1.0 - smoothstep(0.015, 0.045, edge));

    gl_FragColor = vec4(col, 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function createWaterSurface() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uMask: { value: null },
    uFlow: { value: null },
    uSize: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uFlat: { value: 0 },
    uLakeDeep: { value: new THREE.Color('#0b1d26') },
    uLakeLight: { value: new THREE.Color('#1d3d4a') },
    uRiverDeep: { value: new THREE.Color('#10262c') },
    uRiverLight: { value: new THREE.Color('#2f5a60') },
    uFoam: { value: new THREE.Color('#9fb8bc') },
    uFlatLake: { value: new THREE.Color('#2a5a78') },
    uFlatRiver: { value: new THREE.Color('#3f8aa8') },
  }]);
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, fog: true, transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = 1;
  mesh.raycast = () => {};

  let mask = null;
  let flowTex = null;

  return {
    mesh,
    // Board dimensions changed: resize the plane and textures.
    resize(cols, rows) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(cols, rows).rotateX(-Math.PI / 2);
      mask?.dispose();
      flowTex?.dispose();
      mask = new THREE.DataTexture(new Uint8Array(cols * rows * 4), cols, rows);
      mask.magFilter = mask.minFilter = THREE.NearestFilter;
      flowTex = new THREE.DataTexture(new Uint8Array(cols * rows * 4), cols, rows);
      flowTex.magFilter = flowTex.minFilter = THREE.LinearFilter;
      uniforms.uMask.value = mask;
      uniforms.uFlow.value = flowTex;
      uniforms.uSize.value.set(cols, rows);
    },
    // Refresh from the grid: which cells hold water, and the river flow field.
    update(grid, flow) {
      const m = mask.image.data;
      const f = flowTex.image.data;
      grid.cells.forEach((c, i) => {
        const o = i * 4;
        const water = c.area === 'water';
        const river = water && c.sub === 'river';
        m[o] = !water ? 0 : river ? 255 : 128;
        m[o + 3] = 255;
        f[o] = Math.round((flow[i * 2] * 0.5 + 0.5) * 255);
        f[o + 1] = Math.round((flow[i * 2 + 1] * 0.5 + 0.5) * 255);
        f[o + 2] = river ? 255 : 0;
        f[o + 3] = 255;
      });
      mask.needsUpdate = true;
      flowTex.needsUpdate = true;
    },
    setFlat(flat) { uniforms.uFlat.value = flat ? 1 : 0; },
    tick(time) { uniforms.uTime.value = time; },
  };
}
