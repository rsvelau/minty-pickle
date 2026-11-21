// Bridge structure: a Pacific Northwest steel through-truss road bridge
// (loosely after Snohomish's Avenue D bridge). Warren trusses on both sides
// with inclined end posts and verticals, overhead struts with X lateral
// bracing, a concrete edge girder at deck level, and round concrete piers with
// cap beams standing in the water. Decades past its last coat of paint: the
// steel is rusted through (with a few scabs of old paint), and the concrete is
// stained, rust weeping down from the deck and damp grime near the water.
// The weathering is drawn in the shader from world position (weather()), so it
// stays the same scale on every stretched beam and pier.
//
// Bridge cells come from the grid (cell.bridge). Connected bridge cells form
// one bridge; it spans along its majority bridgeAxis(). Rectangular bridges
// get a single truss pair across their full width; irregular ones fall back
// to one truss pair per run of cells.
import * as THREE from 'three';
import { m } from './scale.js';


const TRUSS_H = m(6);        // top chord height above the deck
const CHORD = m(0.45);       // chord/end-post section
const WEB = m(0.3);          // diagonal/vertical section
const STRUT = m(0.25);       // overhead bracing section
const GIRDER_H = m(0.9);     // concrete edge girder depth
const PIER_R = m(0.45);      // pier column radius
// Shared with weather(): heights (cells, before terrain) of the riverbed and deck.
const WEATHER = { bed: { value: -0.5 }, deck: { value: 0 } };

// GLSL: value noise, and the two weathered surfaces (p in metres, world space).
const NOISE = /* glsl */ `
varying vec3 vWeatherPos;
uniform float uWeatherBed;
uniform float uWeatherDeck;
float wHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float wNoise( vec3 x ) {
	vec3 i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( mix( wHash( i ), wHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( wHash( i + vec3( 0, 1, 0 ) ), wHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
	            mix( mix( wHash( i + vec3( 0, 0, 1 ) ), wHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( wHash( i + vec3( 0, 1, 1 ) ), wHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float wFbm( vec3 p ) { float a = 0.5, s = 0.0; for ( int i = 0; i < 4; i++ ) { s += a * wNoise( p ); p *= 2.03; a *= 0.5; } return s; }
vec3 rustedSteel( vec3 p ) {
	vec3 c = mix( vec3( 0.20, 0.09, 0.05 ), vec3( 0.42, 0.20, 0.09 ), smoothstep( 0.25, 0.75, wFbm( p * 1.4 ) ) );   // dark to orange rust
	c = mix( c, vec3( 0.55, 0.30, 0.13 ), smoothstep( 0.66, 0.78, wNoise( p * 7.0 ) ) * 0.8 );                        // fresh flaking rust
	c = mix( c, vec3( 0.25, 0.29, 0.26 ), smoothstep( 0.60, 0.66, wFbm( p * 0.7 + 5.0 ) ) * 0.85 );                  // scabs of old grey-green paint
	float streak = wNoise( vec3( p.x * 3.0, p.y * 0.35, p.z * 3.0 ) );                                                // grime running down
	c *= mix( 1.0, 0.6, smoothstep( 0.55, 0.85, streak ) );
	return c;
}
vec3 weatheredConcrete( vec3 p, float h ) {
	vec3 c = mix( vec3( 0.30, 0.28, 0.25 ), vec3( 0.45, 0.42, 0.36 ), smoothstep( 0.3, 0.7, wFbm( p * 1.1 ) ) );     // dirty, uneven concrete
	// Rust weeping down from the deck steel: thin vertical runs, strongest up high.
	float runs = smoothstep( 0.45, 0.68, wNoise( vec3( p.x * 6.0, p.y * 0.18, p.z * 6.0 ) ) );
	runs *= 0.5 + 0.5 * wNoise( vec3( p.x * 14.0, p.y * 0.5, p.z * 14.0 ) );
	float high = smoothstep( uWeatherBed, uWeatherDeck, h );
	c = mix( c, vec3( 0.40, 0.19, 0.07 ), runs * ( 0.45 + 0.5 * high ) );
	// Damp green-black grime and a tide line near the water.
	float low = 1.0 - smoothstep( uWeatherBed, mix( uWeatherBed, uWeatherDeck, 0.45 ), h + ( wNoise( p * 2.0 ) - 0.5 ) * 0.06 );
	c = mix( c, vec3( 0.14, 0.17, 0.12 ), low * 0.75 );
	// Spalled, darker patches.
	c *= mix( 1.0, 0.8, smoothstep( 0.72, 0.78, wNoise( p * 6.0 + 11.0 ) ) );
	return c;
}
`;

// Give a bridge material its weathered surface ('steel' or 'concrete').
function weather(material, kind) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWeatherBed = WEATHER.bed;
    shader.uniforms.uWeatherDeck = WEATHER.deck;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWeatherPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
	{
		vec4 wp = vec4( transformed, 1.0 );
		#ifdef USE_INSTANCING
		wp = instanceMatrix * wp;
		#endif
		vWeatherPos = ( modelMatrix * wp ).xyz;
	}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
	diffuseColor.rgb = ${kind === 'steel' ? 'rustedSteel( vWeatherPos * 7.0 )' : 'weatheredConcrete( vWeatherPos * 7.0, vWeatherPos.y )'};`);
  };
  material.customProgramCacheKey = () => `weather-${kind}`;
  return material;
}

export function createBridges(group) {
  const unitBox = new THREE.BoxGeometry(1, 1, 1);           // centred
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 12);   // centred, axis y
  const steel = weather(new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#0d0604' }), 'steel');
  const concrete = weather(new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#050505' }), 'concrete');
  // Worn, half-gone yellow centre-line dashes.
  const paint = new THREE.MeshLambertMaterial({ color: '#7d6c3e', emissive: '#16120a' });
  const meshes = {};
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0);

  function meshFor(name, geo, mat, needed) {
    let mesh = meshes[name];
    if (mesh && mesh.instanceMatrix.count >= needed) return mesh;
    if (mesh) { group.remove(mesh); mesh.dispose(); }
    mesh = new THREE.InstancedMesh(geo, mat, Math.max(64, Math.ceil(needed * 1.5)));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    meshes[name] = mesh;
    group.add(mesh);
    return mesh;
  }

  // update(grid, { visible, deckTop, bedY })
  function update(grid, { visible, deckTop, bedY }) {
    WEATHER.deck.value = deckTop;
    WEATHER.bed.value = bedY;
    const steelBars = [];   // [ax, ay, az, bx, by, bz, thickness]
    const blocks = [];      // concrete boxes: [cx, cy, cz, sx, sy, sz]
    const dashes = [];      // paint boxes, same layout as blocks
    const columns = [];     // concrete cylinders: [x, yBottom, yTop, z]
    if (visible) {
      for (const bridge of findBridges(grid)) buildBridge(grid, bridge, deckTop, bedY, steelBars, blocks, columns, dashes);
    }

    // Steel members: unit boxes stretched between their end points.
    const bars = meshFor('steel', unitBox, steel, steelBars.length);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    steelBars.forEach(([ax, ay, az, bx, by, bz, t], n) => {
      a.set(ax, ay, az); b.set(bx, by, bz);
      d.subVectors(b, a);
      const len = d.length();
      tmpQ.setFromUnitVectors(X, d.normalize());
      tmpM.compose(a.add(b).multiplyScalar(0.5), tmpQ, tmpS.set(len + t * 0.5, t, t));
      bars.setMatrixAt(n, tmpM);
    });
    bars.count = steelBars.length;

    const boxes = meshFor('concrete', unitBox, concrete, blocks.length);
    blocks.forEach(([cx, cy, cz, sx, sy, sz], n) => {
      tmpM.compose(a.set(cx, cy, cz), tmpQ.identity(), tmpS.set(sx, sy, sz));
      boxes.setMatrixAt(n, tmpM);
    });
    boxes.count = blocks.length;

    const marks = meshFor('paint', unitBox, paint, dashes.length);
    dashes.forEach(([cx, cy, cz, sx, sy, sz], n) => {
      tmpM.compose(a.set(cx, cy, cz), tmpQ.identity(), tmpS.set(sx, sy, sz));
      marks.setMatrixAt(n, tmpM);
    });
    marks.count = dashes.length;

    const cols = meshFor('columns', unitCyl, concrete, columns.length);
    columns.forEach(([x, y0, y1, z], n) => {
      tmpM.compose(a.set(x, (y0 + y1) / 2, z), tmpQ.identity(), tmpS.set(PIER_R, y1 - y0, PIER_R));
      cols.setMatrixAt(n, tmpM);
    });
    cols.count = columns.length;

    for (const k in meshes) {
      meshes[k].instanceMatrix.needsUpdate = true;
      meshes[k].computeBoundingSphere();
    }
  }

  function clear() {
    for (const k in meshes) { group.remove(meshes[k]); meshes[k].dispose(); delete meshes[k]; }
  }

  return { update, clear, materials: [steel, concrete, paint] };
}

// Connected bridge cells -> [{ axis, cells: [{x,y}], minX, maxX, minY, maxY }]
function findBridges(grid) {
  const seen = new Uint8Array(grid.cols * grid.rows);
  const out = [];
  for (let i = 0; i < grid.cells.length; i++) {
    if (seen[i] || !grid.cells[i].bridge) continue;
    const cells = [];
    const queue = [i];
    seen[i] = 1;
    while (queue.length) {
      const j = queue.pop();
      const { x, y } = grid.coords(j);
      cells.push({ x, y });
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!grid.inBounds(nx, ny)) continue;
        const k = grid.index(nx, ny);
        if (!seen[k] && grid.cells[k].bridge) { seen[k] = 1; queue.push(k); }
      }
    }
    let votesX = 0;
    for (const c of cells) if (grid.bridgeAxis(c.x, c.y) === 'x') votesX++;
    const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
    out.push({
      axis: votesX * 2 > cells.length ? 'x' : 'y',
      cells,
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    });
  }
  return out;
}

function buildBridge(grid, br, deckTop, bedY, steelBars, blocks, columns, dashes) {
  const full = (br.maxX - br.minX + 1) * (br.maxY - br.minY + 1) === br.cells.length;
  // Spans: [alongStart, length, acrossMin, acrossMax] in grid units, along
  // the bridge axis. Rectangles: one span; otherwise one per run of cells.
  const spans = [];
  if (full) {
    spans.push(br.axis === 'x'
      ? [br.minX, br.maxX - br.minX + 1, br.minY, br.maxY + 1]
      : [br.minY, br.maxY - br.minY + 1, br.minX, br.maxX + 1]);
  } else {
    const isB = (x, y) => grid.inBounds(x, y) && grid.cells[grid.index(x, y)].bridge;
    const lines = br.axis === 'x' ? [br.minY, br.maxY] : [br.minX, br.maxX];
    for (let c = lines[0]; c <= lines[1]; c++) {
      let start = null;
      const lo = br.axis === 'x' ? br.minX : br.minY;
      const hi = br.axis === 'x' ? br.maxX : br.maxY;
      for (let s = lo; s <= hi + 1; s++) {
        const on = s <= hi && (br.axis === 'x' ? isB(s, c) : isB(c, s));
        if (on && start === null) start = s;
        if (!on && start !== null) { spans.push([start, s - start, c, c + 1]); start = null; }
      }
    }
  }

  // Grid (along, across) -> world (x, z).
  const toWorld = (along, across) => (br.axis === 'x'
    ? [along - grid.cols / 2, across - grid.rows / 2]
    : [across - grid.cols / 2, along - grid.rows / 2]);
  const bar = (s0, c0, y0, s1, c1, y1, t) => {
    const [ax, az] = toWorld(s0, c0);
    const [bx, bz] = toWorld(s1, c1);
    steelBars.push([ax, y0, az, bx, y1, bz, t]);
  };
  const block = (s0, s1, c0, c1, y0, y1) => {
    const [ax, az] = toWorld(s0, c0);
    const [bx, bz] = toWorld(s1, c1);
    blocks.push([(ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2, Math.abs(bx - ax), y1 - y0, Math.abs(bz - az)]);
  };

  const yb = deckTop + m(0.2);   // bottom chord just above the deck surface
  const yt = deckTop + TRUSS_H;
  const underside = deckTop - GIRDER_H;

  for (const [s0, L, cMin, cMax] of spans) {
    const inset = m(0.35);
    const sides = [cMin + inset, cMax - inset];
    for (const c of sides) {
      // Concrete edge girder along the deck (the pale band in the photo).
      block(s0, s0 + L, c - m(0.35), c + m(0.35), underside, deckTop + m(0.15));
      // Bottom chord, top chord between the end posts.
      bar(s0, c, yb, s0 + L, c, yb, CHORD);
      if (L > 1) bar(s0 + 0.5, c, yt, s0 + L - 0.5, c, yt, CHORD);
      // Warren web: each cell is a triangle; the first and last members
      // are the inclined end posts. Verticals at interior panel points.
      for (let i = 0; i < L; i++) {
        bar(s0 + i, c, yb, s0 + i + 0.5, c, yt, i === 0 ? CHORD : WEB);
        bar(s0 + i + 0.5, c, yt, s0 + i + 1, c, yb, i === L - 1 ? CHORD : WEB);
        if (L > 1 && i > 0 && i < L - 1) bar(s0 + i + 0.5, c, yb, s0 + i + 0.5, c, yt, WEB * 0.8);
      }
    }
    // Centre line down the middle of the roadway: one 3 m dash per cell,
    // in step with the street dashes.
    const mid = (cMin + cMax) / 2;
    for (let i = 0; i < L; i++) {
      const [ax, az] = toWorld(s0 + i + 0.5 - m(1.5), mid - m(0.06));
      const [bx, bz] = toWorld(s0 + i + 0.5 + m(1.5), mid + m(0.06));
      dashes.push([(ax + bx) / 2, deckTop + 0.002, (az + bz) / 2, Math.abs(bx - ax), 0.003, Math.abs(bz - az)]);
    }
    // Overhead: struts at each top panel point, X bracing between them,
    // and a portal strut at each end.
    const [c1, c2] = sides;
    const pts = [];
    for (let i = 0; i < L; i++) pts.push(s0 + i + 0.5);
    for (const s of pts) bar(s, c1, yt, s, c2, yt, STRUT);
    for (let k = 0; k + 1 < pts.length; k++) {
      bar(pts[k], c1, yt, pts[k + 1], c2, yt, STRUT * 0.7);
      bar(pts[k], c2, yt, pts[k + 1], c1, yt, STRUT * 0.7);
    }
    for (const s of [s0 + 0.32, s0 + L - 0.32]) {
      const y = yb + (yt - yb) * 0.64;
      bar(s, c1, y, s, c2, y, STRUT);
    }
    // Piers: a cap beam across the deck with two round columns down to the
    // riverbed, at each end and every two cells in between.
    const pierAt = [s0 + 0.15];
    for (let s = s0 + 2; s < s0 + L - 1; s += 2) pierAt.push(s);
    pierAt.push(s0 + L - 0.15);
    for (const s of pierAt) {
      block(s - m(0.6), s + m(0.6), cMin + 0.05, cMax - 0.05, underside - m(0.8), underside);
      for (const c of [cMin + 0.28, cMax - 0.28]) {
        const [x, z] = toWorld(s, c);
        columns.push([x, bedY, underside - m(0.8), z]);
      }
    }
  }
}
