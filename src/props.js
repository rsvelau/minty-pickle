// Cell props: the walkable and blocked look of every surface.
//
// Blocked cells no longer rise as blocks. Each subcategory has two variants,
// chosen by the cell's `walkable` flag (see VARIANTS below). Props are built
// to real-world scale (metres -> cells via `m`), drawn with one InstancedMesh
// per prop kind, and rebuilt from the grid after every change.
import * as THREE from 'three';
import { flickerize } from './dread.js';
import { m } from './scale.js';
import { terrainify } from './terrain.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isLandmark } from './state.js';


// --- geometry helpers --------------------------------------------------------

// Bake a flat colour into a geometry (so one material serves every prop).
function part(geo, hex) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  geo.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
// Box sitting on y = 0 at (x, z), size in metres.
const box = (w, h, d, hex, x = 0, z = 0, y = 0) =>
  part(new THREE.BoxGeometry(m(w), m(h), m(d)).translate(m(x), m(y) + m(h) / 2, m(z)), hex);
const merge = (...parts) => mergeGeometries(parts);

// All prop shapes, modelled along the x axis (rotate 90 degrees to run along z).
function buildKinds() {
  const stone = '#8b908c';
  const iron = '#3c3e42';
  return {
    headstone: merge(box(0.6, 0.9, 0.2, stone)),
    // Round-topped headstone ~0.6 m wide, 0.9 m tall.
    roundstone: merge(
      box(0.6, 0.6, 0.2, '#9a9d98'),
      part(new THREE.CylinderGeometry(m(0.3), m(0.3), m(0.2), 12, 1, false, 0, Math.PI)
        .rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, m(0.6), 0), '#9a9d98'),
    ),
    // Stone cross ~1.2 m tall on a low plinth.
    cross: merge(
      box(0.45, 0.15, 0.3, '#7d817c'),
      box(0.14, 1.1, 0.12, '#858984', 0, 0, 0.15),
      box(0.6, 0.14, 0.12, '#858984', 0, 0, 0.8),
    ),
    // Large: obelisk ~3 m tall on a stepped base.
    obelisk: merge(
      box(1.1, 0.3, 1.1, '#6c706b'),
      box(0.8, 0.4, 0.8, '#767a75', 0, 0, 0.3),
      part(new THREE.CylinderGeometry(m(0.2), m(0.32), m(2.2), 4).rotateY(Math.PI / 4).translate(0, m(0.7) + m(1.1), 0), '#8d918c'),
      part(new THREE.ConeGeometry(m(0.24), m(0.35), 4).rotateY(Math.PI / 4).translate(0, m(2.9) + m(0.17), 0), '#8d918c'),
    ),
    // Large: wide family monument ~1.4 m wide, ~2 m tall.
    monument: merge(
      box(1.6, 0.3, 0.7, '#6c706b'),
      box(1.4, 1.3, 0.35, '#868a85', 0, 0, 0.3),
      part(new THREE.CylinderGeometry(m(0.7), m(0.7), m(0.35), 16, 1, false, 0, Math.PI)
        .rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, m(1.6), 0), '#868a85'),
    ),
    boulder: merge(part(new THREE.IcosahedronGeometry(m(0.8), 0).scale(1, 0.7, 1).translate(0, m(0.35), 0), '#5d615e')),
    shrub: merge(part(new THREE.IcosahedronGeometry(m(0.9), 1).scale(1, 0.8, 1).translate(0, m(0.6), 0), '#284034')),
    bramble: merge(part(new THREE.IcosahedronGeometry(m(0.9), 0).scale(1, 0.6, 1).translate(0, m(0.3), 0), '#5e4a4e')),
    // Sawhorse barricade, ~2.4 m wide, orange/white rails.
    barricade: merge(
      box(0.1, 1.0, 0.5, '#4a4a48', -1.0), box(0.1, 1.0, 0.5, '#4a4a48', 1.0),
      box(2.4, 0.22, 0.06, '#d8742a', 0, 0, 0.75), box(2.4, 0.22, 0.06, '#e0dcd0', 0, 0, 0.4),
    ),
    cone: merge(
      box(0.4, 0.04, 0.4, '#c8602a'),
      part(new THREE.ConeGeometry(m(0.16), m(0.7), 10).translate(0, m(0.39), 0), '#e07030'),
    ),
    // Dumpster ~1.9 x 1.1 m, 1.3 m tall.
    dumpster: merge(box(1.9, 1.2, 1.1, '#2f4a3a'), box(2.0, 0.1, 1.2, '#3c5a48', 0, 0, 1.2)),
    // Fallen log ~3.6 m long, 0.7 m thick, with a broken stub branch.
    log: merge(
      part(new THREE.CylinderGeometry(m(0.35), m(0.4), m(3.6), 8).rotateZ(Math.PI / 2).translate(0, m(0.35), 0), '#3e2c1f'),
      part(new THREE.CylinderGeometry(m(0.08), m(0.1), m(0.8), 5).rotateZ(-0.6).translate(m(0.6), m(0.7), 0), '#3e2c1f'),
    ),
    // Wrought-iron gate ~3.6 m wide, 1.8 m tall: two stone posts, bars, rails.
    gate: merge(
      box(0.35, 2.0, 0.35, stone, -1.8), box(0.35, 2.0, 0.35, stone, 1.8),
      box(3.4, 0.06, 0.06, iron, 0, 0, 1.6), box(3.4, 0.06, 0.06, iron, 0, 0, 0.3),
      ...Array.from({ length: 11 }, (_, i) => box(0.04, 1.75, 0.04, iron, -1.5 + i * 0.3)),
    ),
    crate: merge(box(1.0, 1.0, 1.0, '#8a6a40'), box(1.02, 0.08, 1.02, '#6e5232', 0, 0, 0.5)),
    // Wardrobe 1.4 m wide, 2 m tall.
    cabinet: merge(box(1.4, 2.0, 0.6, '#5a3a24'), box(0.02, 1.7, 0.02, '#2a1a10', 0, 0.31, 0.15)),
    // 90s sofa, 2.2 m long, dusty teal.
    sofa: merge(
      box(2.2, 0.45, 0.9, '#4f6b6b'), box(2.2, 0.55, 0.22, '#4f6b6b', 0, -0.34, 0.45),
      box(0.2, 0.3, 0.9, '#45605f', -1.0, 0, 0.45), box(0.2, 0.3, 0.9, '#45605f', 1.0, 0, 0.45),
    ),
    armchair: merge(
      box(0.9, 0.45, 0.9, '#6b4f5c'), box(0.9, 0.5, 0.2, '#6b4f5c', 0, -0.35, 0.45),
    ),
    table: merge(box(1.1, 0.06, 0.6, '#6e4a2e', 0, 0, 0.4), box(0.9, 0.4, 0.4, '#4e321e')),
    // Church pew, 4.4 m long, facing +z (seat at the front, back behind),
    // dark old oak with carved end panels and a hymnal shelf on the back.
    pew: (() => {
      const oak = '#5a3820', end = '#43291a';
      return merge(
        box(4.4, 0.07, 0.5, oak, 0, 0.02, 0.42),             // seat
        box(4.4, 0.6, 0.07, oak, 0, -0.24, 0.48),            // back
        box(4.4, 0.05, 0.12, end, 0, -0.24, 1.08),           // top rail
        box(4.2, 0.05, 0.12, oak, 0, -0.33, 0.74),           // hymnal shelf (behind)
        box(4.2, 0.08, 0.16, end, 0, 0.42, 0.12),            // kneeler
        box(0.09, 1.0, 0.62, end, -2.2, -0.02, 0),           // end panels
        box(0.09, 1.0, 0.62, end, 2.2, -0.02, 0),
        box(0.07, 0.42, 0.42, end, 0, 0.02, 0),              // middle support
        box(0.3, 0.2, 0.05, '#2a2a30', -1.2, -0.31, 0.79),    // a couple of hymnals
        box(0.3, 0.2, 0.05, '#3a1e22', 1.0, -0.31, 0.79),
      );
    })(),
    // The pulpit end of the church, facing +z (towards the pews): a raised
    // oak dais with a red runner and front step, a carved octagonal pulpit
    // with a sloped reading desk and open Bible, an altar in white cloth
    // with candlesticks behind it, and a tall wooden cross at the back.
    pulpit: (() => {
      const oak = '#5a3820', dark = '#3f2616', cloth = '#ddd3bc', brass = '#a08440';
      const desk = part(new THREE.BoxGeometry(m(0.78), m(0.04), m(0.5)).rotateX(0.32)
        .translate(0, m(0.35 + 1.22), m(0.62)), dark);
      const bible = part(new THREE.BoxGeometry(m(0.5), m(0.06), m(0.36)).rotateX(0.32)
        .translate(0, m(0.35 + 1.27), m(0.62)), '#f0e8d4');
      return merge(
        box(6.2, 0.35, 5.0, '#4a3020', 0, -0.4),             // dais
        box(3.0, 0.17, 0.6, '#4a3020', 0, 2.4),              // front step
        box(1.6, 0.02, 4.9, '#6a1820', 0, -0.35, 0.35),      // red runner
        part(new THREE.CylinderGeometry(m(0.66), m(0.58), m(1.15), 8)
          .translate(0, m(0.35 + 0.575), m(0.45)), oak),     // pulpit body
        part(new THREE.CylinderGeometry(m(0.74), m(0.74), m(0.07), 8)
          .translate(0, m(0.35 + 1.18), m(0.45)), dark),     // top rim
        part(new THREE.CylinderGeometry(m(0.5), m(0.66), m(0.1), 8)
          .translate(0, m(0.35 + 0.05), m(0.45)), dark),     // base moulding
        desk, bible,
        box(2.0, 0.95, 0.8, cloth, 0, -1.7, 0.35),           // altar
        box(2.1, 0.05, 0.9, '#efe8d6', 0, -1.7, 1.3),        // altar top
        box(0.05, 0.4, 0.05, brass, -0.7, -1.7, 1.35),       // candlesticks
        box(0.05, 0.4, 0.05, brass, 0.7, -1.7, 1.35),
        box(0.06, 0.16, 0.06, '#f4ecd2', -0.7, -1.7, 1.75),  // candles
        box(0.06, 0.16, 0.06, '#f4ecd2', 0.7, -1.7, 1.75),
        box(0.16, 2.8, 0.12, '#6e4a26', 0, -2.65, 0.35),     // cross
        box(1.3, 0.16, 0.12, '#6e4a26', 0, -2.65, 2.3),
      );
    })(),
    // Used early-80s full-size van, ~4.8 m long, 2 m wide, 2.1 m tall, along
    // x with the front at +x: two-tone cream and brown with an orange stripe,
    // rust spots, chrome bumpers, a spare on the back door.
    van: (() => {
      const cream = '#e6d6a6', brown = '#8a5530', glass = '#1a252d', tyre = '#141414', rust = '#7a3e1c';
      const wheel = (x, z) => part(new THREE.CylinderGeometry(m(0.36), m(0.36), m(0.24), 12)
        .rotateX(Math.PI / 2).translate(m(x), m(0.36), m(z)), tyre);
      return merge(
        wheel(1.55, 0.92), wheel(1.55, -0.92), wheel(-1.6, 0.92), wheel(-1.6, -0.92),
        box(4.8, 0.85, 1.98, cream, 0, 0, 0.32),            // lower body
        box(4.82, 0.16, 2.0, '#cf7a2e', 0, 0, 1.12),         // orange stripe
        box(4.7, 0.78, 1.96, brown, -0.05, 0, 1.28),         // upper body
        box(4.5, 0.1, 1.86, cream, -0.1, 0, 2.06),           // roof
        box(1.2, 0.12, 1.4, '#3a3d40', -0.6, 0, 2.16),       // roof rack
        box(0.06, 0.62, 1.7, glass, 2.4, 0, 1.3),            // windshield
        box(0.9, 0.5, 0.03, glass, 1.7, 0.99, 1.38),         // cab windows
        box(0.9, 0.5, 0.03, glass, 1.7, -0.99, 1.38),
        box(2.6, 0.42, 0.03, glass, -0.6, 0.99, 1.42),       // side windows
        box(2.6, 0.42, 0.03, glass, -0.6, -0.99, 1.42),
        box(0.06, 0.45, 1.2, glass, -2.41, 0, 1.4),          // rear windows
        box(0.14, 0.24, 2.04, '#9a9c9e', 2.44, 0, 0.36),     // bumpers
        box(0.14, 0.24, 2.04, '#9a9c9e', -2.44, 0, 0.36),
        box(0.05, 0.3, 0.9, '#2a2c2e', 2.43, 0, 0.72),       // grille
        box(0.7, 0.3, 0.02, rust, -1.3, 1.0, 0.42),          // rust
        box(0.45, 0.25, 0.02, rust, 0.9, -1.0, 0.5),
        box(0.3, 0.2, 0.02, rust, 2.0, 1.0, 1.0),
        part(new THREE.CylinderGeometry(m(0.34), m(0.34), m(0.22), 12)   // spare tyre
          .rotateZ(Math.PI / 2).translate(-m(2.55), m(1.1), 0), tyre),
      );
    })(),
    // Glowing bits (separate unlit materials): headlights + tail lights,
    // blinking hazards, headlight beams on the road, painted start box.
    vanLights: merge(
      // 80s-90s sealed-beam / early halogen lamps: warm yellowish white (~3200 K).
      box(0.04, 0.2, 0.32, '#ffe1ae', 2.47, 0.68, 0.62), box(0.04, 0.2, 0.32, '#ffe1ae', 2.47, -0.68, 0.62),
      box(0.04, 0.28, 0.16, '#ff3020', -2.47, 0.86, 0.8), box(0.04, 0.28, 0.16, '#ff3020', -2.47, -0.86, 0.8),
    ),
    vanHazard: merge(
      box(0.1, 0.12, 0.18, '#ffffff', 2.42, 0.9, 0.95), box(0.1, 0.12, 0.18, '#ffffff', 2.42, -0.9, 0.95),
      box(0.1, 0.12, 0.18, '#ffffff', -2.42, 0.9, 1.15), box(0.1, 0.12, 0.18, '#ffffff', -2.42, -0.9, 1.15),
    ),
    vanBeam: (() => {
      const sh = new THREE.Shape();
      // Out across the start cell in front and into the next one (~15 m).
      sh.moveTo(m(2.5), -m(0.9)); sh.lineTo(m(15), -m(3.0)); sh.lineTo(m(15), m(3.0)); sh.lineTo(m(2.5), m(0.9));
      sh.closePath();
      return part(new THREE.ShapeGeometry(sh).rotateX(Math.PI / 2).translate(0, 0.03, 0), '#ffc480');
    })(),
    // Soft beams of light in the air from each headlamp: narrow at the lamp,
    // ~1.9 m wide after 13 m, brightest at the lamp and fading out.
    vanCone: (() => {
      const L = m(13), lampX = m(2.47), lampY = m(0.62);
      const warm = new THREE.Color('#ffbf78');
      const cone = (z) => {
        let g = new THREE.CylinderGeometry(m(1.9), m(0.12), L, 18, 8, true) // top (wide) -> far end
          .rotateZ(-Math.PI / 2)                                             // axis along +x
          .translate(lampX + L / 2, lampY, m(z));
        g = g.toNonIndexed();
        g.deleteAttribute('uv');
        const pos = g.attributes.position;
        // Light stops at the road: flatten anything below road level.
        for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(pos.getY(i), m(0.04)));
        const col = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          const t = Math.min(1, Math.max(0, (pos.getX(i) - lampX) / L));
          const k = Math.pow(1 - t, 1.6);
          col.set([warm.r * k, warm.g * k, warm.b * k], i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return g;
      };
      return merge(cone(0.68), cone(-0.68));
    })(),
    // Painted box around the cell edge (cell units) plus corner chevrons.
    startFrame: (() => {
      const y = 0.022, t = 0.065, e = 0.45, hex = '#ffffff';
      const strip = (w, d, x, z) => part(new THREE.BoxGeometry(w, 0.006, d).translate(x, y, z), hex);
      return merge(
        strip(2 * e + t, t, 0, -e), strip(2 * e + t, t, 0, e), strip(t, 2 * e, -e, 0), strip(t, 2 * e, e, 0),
        strip(0.2, t * 1.5, -e + 0.1, -e + 0.08), strip(t * 1.5, 0.2, -e + 0.08, -e + 0.1),
        strip(0.2, t * 1.5, e - 0.1, e - 0.08), strip(t * 1.5, 0.2, e - 0.08, e - 0.1),
        strip(0.2, t * 1.5, e - 0.1, -e + 0.08), strip(t * 1.5, 0.2, e - 0.08, -e + 0.1),
        strip(0.2, t * 1.5, -e + 0.1, e - 0.08), strip(t * 1.5, 0.2, -e + 0.08, e - 0.1),
      );
    })(),
    // Soft amber wash over the whole start cell.
    startFill: part(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2).translate(0, 0.02, 0), '#ffffff'),
    // Flat stepping stone for a ford.
    steppingStone: merge(part(new THREE.CylinderGeometry(m(0.5), m(0.55), m(0.25), 7), '#727670')),
  };
}

// --- variants ----------------------------------------------------------------
// Each entry: (ctx) => list of placements [kind, dx, dz, rotY, scale?, dy?]
// in cell units from the cell centre. `ctx.across` is the rotation that lays a
// prop across the direction the neighbouring cells run; `ctx.along` lays it
// along that direction. `ctx.rnd()` is a stable per-cell random number.

const jit = (r, a) => (r() - 0.5) * a;
// An n x n grid of jittered placements across the cell; `make(k)` returns
// [kind, scale] for the k-th spot.
function scatter(rnd, n, wobble, make) {
  const out = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const [kind, scale] = make(j * n + i);
      out.push([kind, ((i + 0.5) / n - 0.5) * 0.9 + jit(rnd, wobble / n), ((j + 0.5) / n - 0.5) * 0.9 + jit(rnd, wobble / n), rnd() * 6, scale]);
    }
  }
  return out;
}
// Mostly plain headstones, some round-topped, the odd cross.
const smallMarker = (r) => { const v = r(); return v < 0.5 ? 'headstone' : v < 0.85 ? 'roundstone' : 'cross'; };

const VARIANTS = {
  ground: {
    // Overgrown: boulders in a thicket of shrubs.
    blocked: ({ rnd }) => scatter(rnd, 3, 0.3, (k) => (k % 3 === 1 ? ['boulder', 1.2 + rnd() * 0.6] : ['shrub', 1.1 + rnd() * 0.6])),
  },
  street: {
    // Two sawhorse barricades across both lanes, cones on the sidewalk edge.
    blocked: ({ across, rnd }) => {
      const alongX = across !== 0; // road runs along x when barricades turn
      const off = (t) => (alongX ? [0, t] : [t, 0]);
      const [ax, az] = off(-0.18), [bx, bz] = off(0.18);
      const [cx, cz] = off(0.38), [dx, dz] = off(-0.38);
      return [
        ['barricade', ax, az, across],
        ['barricade', bx, bz, across + jit(rnd, 0.15)],
        ['cone', cx + (alongX ? 0.15 : 0), cz + (alongX ? 0 : 0.15), 0],
        ['cone', dx - (alongX ? 0.12 : 0), dz - (alongX ? 0 : 0.12), 0],
      ];
    },
  },
  path: {
    blocked: ({ across, rnd }) => [
      ['log', 0, jit(rnd, 0.1), across + jit(rnd, 0.3)],
      ['boulder', 0.3, 0.28, rnd() * 6, 0.7],
      ['boulder', -0.32, -0.25, rnd() * 6, 0.6],
    ],
  },
  cemetery: {
    // A few small markers scattered loosely; plenty of room to walk.
    walkable: ({ rnd }) => {
      const spots = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
      const count = 2 + (rnd() < 0.4 ? 1 : 0);
      const out = [];
      for (let k = 0; k < count; k++) {
        const [dx, dz] = spots.splice(Math.floor(rnd() * spots.length), 1)[0];
        out.push([smallMarker(rnd), dx + jit(rnd, 0.12), dz + jit(rnd, 0.12), jit(rnd, 0.5), 0.9 + rnd() * 0.25]);
      }
      return out;
    },
    // Packed rows of markers with one or two large monuments among them.
    blocked: ({ rnd }) => {
      const out = [];
      const large = [];
      const corners = [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]];
      const bigCount = 1 + (rnd() < 0.4 ? 1 : 0);
      for (let k = 0; k < bigCount; k++) {
        const [dx, dz] = corners.splice(Math.floor(rnd() * corners.length), 1)[0];
        large.push([dx, dz]);
        out.push([rnd() < 0.5 ? 'obelisk' : 'monument', dx, dz, jit(rnd, 0.25), 0.9 + rnd() * 0.2]);
      }
      // Four rows of four small markers, skipping spots the monuments take.
      for (const dz of [-0.36, -0.12, 0.12, 0.36]) {
        for (const dx of [-0.36, -0.12, 0.12, 0.36]) {
          if (large.some(([lx, lz]) => Math.abs(lx - dx) < 0.3 && Math.abs(lz - dz) < 0.3)) continue;
          out.push([smallMarker(rnd), dx + jit(rnd, 0.05), dz + jit(rnd, 0.05), jit(rnd, 0.35), 0.75 + rnd() * 0.3]);
        }
      }
      return out;
    },
  },
  cemeteryPath: {
    blocked: ({ across }) => [['gate', 0, 0, across]],
  },
  forestCemetery: {
    walkable: ({ rnd }) => [
      ['fir', -0.3, -0.3, rnd() * 6, 0.75],
      [smallMarker(rnd), 0.25, 0.2, jit(rnd, 0.5)],
    ],
    blocked: ({ rnd }) => [
      ['fir', -0.25, -0.25, rnd() * 6, 1],
      ['fir', 0.25, -0.15, rnd() * 6, 0.85],
      ['fir', -0.1, 0.28, rnd() * 6, 0.9],
      [smallMarker(rnd), 0.28, 0.25, jit(rnd, 0.6)],
      [smallMarker(rnd), 0.05, -0.05, jit(rnd, 0.6), 0.9],
    ],
  },
  forest: {
    // A clearing with one young fir.
    walkable: ({ rnd }) => [['fir', 0.3 * (rnd() > 0.5 ? 1 : -1), 0.3 * (rnd() > 0.5 ? 1 : -1), rnd() * 6, 0.7]],
    // Dense stand of young firs with undergrowth.
    blocked: ({ rnd }) => [
      ...scatter(rnd, 3, 0.3, () => ['fir', 0.85 + rnd() * 0.45]),
      ['shrub', jit(rnd, 0.5), jit(rnd, 0.5), 0, 0.9],
    ],
  },
  brambles: {
    walkable: ({ rnd }) => [['bramble', 0.3, -0.28, rnd() * 6, 0.55], ['bramble', -0.3, 0.3, rnd() * 6, 0.45]],
    // A solid thorn thicket.
    blocked: ({ rnd }) => scatter(rnd, 4, 0.24, () => ['bramble', 1.3 + rnd() * 0.6]),
  },
  hardwood: {
    // A storeroom: wardrobes along the back, stacked crates in front.
    blocked: ({ along, rnd }) => [
      ['cabinet', -0.2, -0.32, along],
      ['cabinet', 0.12, -0.32, along],
      ['crate', -0.25, 0.05, jit(rnd, 0.4)],
      ['crate', -0.25, 0.05, jit(rnd, 0.6), 0.8, m(1.0)],
      ['crate', 0.05, 0.12, jit(rnd, 0.4), 0.95],
      ['crate', 0.3, 0.05, jit(rnd, 0.4), 0.9],
      ['crate', 0.3, 0.05, jit(rnd, 0.5), 0.75, m(0.9)],
      ['crate', -0.05, 0.36, jit(rnd, 0.4), 0.85],
      ['crate', 0.25, 0.34, jit(rnd, 0.4), 1.0],
    ],
  },
  // Condemned: rubble, junk and fallen boards inside.
  condemned: {
    blocked: ({ rnd }) => scatter(rnd, 2, 0.5, (k) => (k % 2 ? ['crate', 0.7 + rnd() * 0.3] : ['boulder', 0.5 + rnd() * 0.3])),
    walkable: ({ rnd }) => [['crate', jit(rnd, 0.4), jit(rnd, 0.4), rnd() * 6, 0.6]],
  },
  carpet: {
    // A cluttered living room: two sofas facing over a coffee table, armchairs.
    blocked: ({ along }) => [
      ['sofa', 0, -0.25, along],
      ['sofa', 0, 0.25, along + Math.PI],
      ['table', 0, 0, along],
      ['armchair', -0.33, 0, along + Math.PI / 2],
      ['armchair', 0.33, 0, along - Math.PI / 2],
    ],
  },
  // Water: a ford of stepping stones when walkable; open water otherwise.
  lake: { walkable: (ctx) => ford(ctx) },
  river: { walkable: (ctx) => ford(ctx) },
};

// Which way a church cell faces, as a unit step (fx, fz) along one axis.
// A pulpit (blocked church cell) faces its congregation: the average
// direction to every pew in its church. Pews all face back along that line,
// towards their nearest pulpit, like a nave (so a pew beside the pulpit
// still faces the front, not sideways). With no pulpit, north.
function churchCells(grid, i) {
  const seen = new Set([i]);
  const order = [i];
  for (let q = 0; q < order.length; q++) {
    const { x, y } = grid.coords(order[q]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!grid.inBounds(nx, ny)) continue;
      const k = grid.index(nx, ny);
      if (!seen.has(k) && grid.cells[k].sub === 'church') { seen.add(k); order.push(k); }
    }
  }
  return order; // breadth-first from i: nearest first
}
const snapAxis = (vx, vy, fallback) => (vx === 0 && vy === 0 ? fallback
  : Math.abs(vx) >= Math.abs(vy) ? [Math.sign(vx), 0] : [0, Math.sign(vy)]);
function pulpitFacing(grid, j, cells = churchCells(grid, j)) {
  const { x: px, y: py } = grid.coords(j);
  let vx = 0, vy = 0;
  for (const k of cells) {
    if (!grid.cells[k].walkable) continue;
    const { x, y } = grid.coords(k);
    vx += x - px; vy += y - py;
  }
  return snapAxis(vx, vy, [0, 1]);
}
function churchFacing(grid, i) {
  const cells = churchCells(grid, i);
  if (!grid.cells[i].walkable) return pulpitFacing(grid, i, cells);
  const pulpit = cells.find((k) => !grid.cells[k].walkable);
  if (pulpit === undefined) return [0, -1];
  const [fx, fz] = pulpitFacing(grid, pulpit, cells);
  return [-fx, -fz];
}

// Which sides of an outdoor cell must stay clear: a neighbour that is
// indoors, a clocktower, or an edge piece (wall, door, window) between them.
function guardedSides(grid, x, y) {
  const g = { e: false, w: false, n: false, s: false };
  const wallish = (o, ex, ey) => !!grid.edgeAt(`${o}${ex},${ey}`);
  const solid = (nx, ny) => {
    if (!grid.inBounds(nx, ny)) return false;
    const n = grid.cells[grid.index(nx, ny)];
    return n.area === 'indoor' || isLandmark(n.sub);
  };
  g.e = solid(x + 1, y) || wallish('v', x + 1, y);
  g.w = solid(x - 1, y) || wallish('v', x, y);
  g.s = solid(x, y + 1) || wallish('h', x, y + 1);
  g.n = solid(x, y - 1) || wallish('h', x, y);
  return g;
}
const EDGE_PAD = 0.04; // cells kept clear of a guarded edge (walls are ~0.05 thick)
function keepInside(grid, x, y, list, reach) {
  const g = guardedSides(grid, x, y);
  if (!g.e && !g.w && !g.n && !g.s) return list;
  return list.map((p) => {
    let [kind, dx, dz, rot = 0, scale = 1, dy = 0] = p;
    let r = (reach[kind] ?? 0.2) * scale;
    // Largest reach that still fits: between two guarded edges it must fit
    // in half the cell; against one it may overhang the open side, but its
    // centre stays inside its own cell.
    const limit = (a, b) => (a && b ? 0.5 - EDGE_PAD : a || b ? 1 - EDGE_PAD : Infinity);
    const most = Math.min(limit(g.e, g.w), limit(g.n, g.s));
    if (r > most) { scale *= most / r; r = most; }
    if (g.e) dx = Math.max(-0.5, Math.min(dx, 0.5 - EDGE_PAD - r));
    if (g.w) dx = Math.min(0.5, Math.max(dx, -0.5 + EDGE_PAD + r));
    if (g.s) dz = Math.max(-0.5, Math.min(dz, 0.5 - EDGE_PAD - r));
    if (g.n) dz = Math.min(0.5, Math.max(dz, -0.5 + EDGE_PAD + r));
    return [kind, dx, dz, rot, scale, dy];
  });
}

// The van faces (fx, fz); the painted start box sits on the cell in front.
function startSpace(fx, fz) {
  const rot = Math.atan2(-fz, fx) + 0.08; // parked, very slightly askew
  return [
    ['van', -fx * 0.04, -fz * 0.04, rot], ['vanLights', -fx * 0.04, -fz * 0.04, rot],
    ['vanHazard', -fx * 0.04, -fz * 0.04, rot], ['vanBeam', -fx * 0.04, -fz * 0.04, rot],
    ['vanCone', -fx * 0.04, -fz * 0.04, rot],
    ['startFrame', fx, fz, 0], ['startFill', fx, fz, 0],
  ];
}

function ford({ along, rnd }) {
  const out = [];
  for (const t of [-0.32, 0, 0.32]) {
    const a = along === 0 ? [t, jit(rnd, 0.14)] : [jit(rnd, 0.14), t];
    out.push(['steppingStone', a[0], a[1], rnd() * 6, 0.9 + rnd() * 0.3]);
  }
  return out;
}

// --- renderer ------------------------------------------------------------------

export function createProps(group, { firGeo, firMat }) {
  const kinds = buildKinds();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  // Unlit, glowing materials for the start space.
  const glow = {
    vanLights: new THREE.MeshBasicMaterial({ vertexColors: true }),
    vanHazard: new THREE.MeshBasicMaterial({ color: '#ffa424' }),
    vanBeam: new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    vanCone: new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    startFill: new THREE.MeshBasicMaterial({
      color: '#ffb43a', transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    startFrame: new THREE.MeshBasicMaterial({ color: '#ffd23a', transparent: true, opacity: 0.95 }),
  };
  // Headlight beams are lifted as a whole by the van's cell (not point by
  // point), so they stay level with the road and bridge deck instead of
  // dipping into a lowered river ahead.
  for (const k of ['vanLights', 'vanBeam', 'vanCone']) flickerize(glow[k]); // headlights flicker at midnight
  // Upright props rise as one piece with the ground at their base.
  terrainify(material, { instance: true });
  terrainify(firMat, { instance: true });
  // How far each prop reaches from its centre (cells, at scale 1), for
  // keeping it clear of neighbouring walls. Firs are scaled specially.
  const reach = {};
  for (const [kind, geo] of Object.entries(kinds)) {
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    reach[kind] = Math.hypot(Math.max(-b.min.x, b.max.x), Math.max(-b.min.z, b.max.z));
  }
  reach.fir = m(7) * 0.3;
  terrainify(glow.vanCone, { centre: true });
  terrainify(glow.vanBeam, { centre: true });
  // The painted start box and glow follow the start cell only (their edges
  // would otherwise be pulled down to a lowered river next door).
  terrainify(glow.startFrame, { centre: true });
  terrainify(glow.startFill, { centre: true });
  const meshes = {};
  const tmpM = new THREE.Matrix4();
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);

  function meshFor(kind, needed) {
    let mesh = meshes[kind];
    if (mesh && mesh.instanceMatrix.count >= needed) return mesh;
    if (mesh) { group.remove(mesh); mesh.dispose(); }
    const cap = Math.max(64, Math.ceil(needed * 1.5));
    mesh = kind === 'fir'
      ? new THREE.InstancedMesh(firGeo, firMat, cap)
      : new THREE.InstancedMesh(kinds[kind], glow[kind] ?? material, cap);
    mesh.castShadow = !glow[kind];
    if (glow[kind]) mesh.renderOrder = 3;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    mesh.count = 0;
    meshes[kind] = mesh;
    group.add(mesh);
    return mesh;
  }

  // ctx: { visible, cellToWorld(x,y), baseY(i) }
  function update(grid, ctx) {
    const placements = {}; // kind -> array of [x, y, z, rot, scale]
    if (ctx.visible) {
      grid.cells.forEach((c, i) => {
        const variant = VARIANTS[c.sub]?.[c.walkable ? 'walkable' : 'blocked'];
        const { x, y } = grid.coords(i);
        let list = variant ? null : [];
        // Church: a pew facing the pulpit, or the pulpit facing the pews.
        if (c.sub === 'church') {
          const [fx, fz] = churchFacing(grid, i);
          list = [[c.walkable ? 'pew' : 'pulpit', 0, 0, Math.atan2(fx, fz)]];
        } else
        // Start space: the van, facing along the road.
        if (c.sub === 'start') {
          const [fx, fz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][grid.startFacing(i)];
          list = startSpace(fx, fz);
        } else if (c.bridge) {
          list = c.walkable ? [] : [['barricade', 0, 0, grid.bridgeAxis(x, y) === 'x' ? Math.PI / 2 : 0]];
        } else if (variant) {
          let seed = (i * 2654435761) % 2147483647 || 1;
          const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
          const axis = runAxis(grid, x, y, c);
          list = variant({ rnd, along: axis === 'x' ? 0 : Math.PI / 2, across: axis === 'x' ? Math.PI / 2 : 0 });
        }
        if (!list.length) return;
        // Outdoors, next to a building, a wall or the clocktower, props stay
        // inside their own cell on that side so trees and thickets never
        // poke through the neighbour's walls (big props shrink to fit).
        if (c.area === 'outdoor' && c.sub !== 'start' && !c.bridge) list = keepInside(grid, x, y, list, reach);
        const centre = ctx.cellToWorld(x, y);
        const base = ctx.baseY(i);
        for (const [kind, dx, dz, rot = 0, scale = 1, dy = 0] of list) {
          (placements[kind] ??= []).push([centre.x + dx, base + dy, centre.z + dz, rot, scale, i]);
        }
      });
    }
    for (const kind of new Set([...Object.keys(meshes), ...Object.keys(placements)])) {
      const list = placements[kind] ?? [];
      const mesh = meshFor(kind, list.length);
      list.forEach(([x, y, z, rot, scale, i], n) => {
        // Firs are unit-height geometry: scale to young trees ~5-8 m.
        const s = kind === 'fir'
          ? tmpS.set(m(7) * 0.3 * scale, m(7) * scale, m(7) * 0.3 * scale)
          : tmpS.setScalar(scale);
        tmpM.compose(tmpP.set(x, y, z), tmpQ.setFromAxisAngle(UP, rot), s);
        mesh.setMatrixAt(n, tmpM);
        mesh.setColorAt(n, glow[kind] ? tmpC.setScalar(1) : tmpC.setScalar(0.85 + ((i * 37 + n * 11) % 30) / 100));
      });
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  function clear() {
    for (const k in meshes) { group.remove(meshes[k]); meshes[k].dispose(); delete meshes[k]; }
  }

  // Hazards blink; the painted start box pulses.
  function tick(t) {
    glow.vanHazard.color.set(Math.sin(t * 5.5) > 0 ? '#ffa424' : '#2a1804');
    glow.startFrame.opacity = 0.65 + 0.35 * Math.sin(t * 2.4);
    glow.startFill.opacity = 0.16 + 0.1 * Math.sin(t * 2.4);
  }

  return { update, clear, tick };
}

// Which way the surrounding cells run: 'x' (east-west) or 'y' (north-south).
// For roads, paths and gates that's neighbours of the same surface; for a
// walkable cemetery or a ford, walkable neighbours (where the path leads),
// with same-surface neighbours counting double.
function runAxis(grid, x, y, c) {
  const water = c.area === 'water';
  const sameRun = ['street', 'start', 'path', 'cemeteryPath'].includes(c.sub);
  const pred = (nx, ny) => {
    if (!grid.inBounds(nx, ny)) return 0;
    const n = grid.cells[grid.index(nx, ny)];
    const roadLike = (k) => k.sub === 'street' || k.sub === 'start' || k.bridge;
    if (c.sub === 'start') return roadLike(n) ? 1 : 0;
    if (sameRun) return n.sub === c.sub || (c.sub === 'street' && n.bridge) ? 1 : 0;
    // Paths and fords lead on to walkable cells, preferring the same surface.
    if (water || c.sub === 'cemetery') return n.walkable ? (n.sub === c.sub ? 2 : 1) : 0;
    return 0;
  };
  const ew = pred(x - 1, y) + pred(x + 1, y);
  const ns = pred(x, y - 1) + pred(x, y + 1);
  return ew >= ns ? 'x' : 'y';
}
