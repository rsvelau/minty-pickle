// Cell props: the walkable and blocked look of every surface.
//
// Blocked cells no longer rise as blocks. Each subcategory has two variants,
// chosen by the cell's `walkable` flag (see VARIANTS below). Props are built
// to real-world scale (metres -> cells via `m`), drawn with one InstancedMesh
// per prop kind, and rebuilt from the grid after every change.
import * as THREE from 'three';
import { flickerize } from './dread.js';
import { m } from '../core/scale.js';
import { terrainify } from './terrain.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isLandmark } from '../core/state.js';
import { STREET_LIFT } from './street.js';
import { BUILDING_TYPES, buildingIds, roomIds, typeAt, unitRooms } from '../core/buildings.js';


// --- geometry helpers --------------------------------------------------------

// The start van is parked very slightly askew (PARK_SKEW radians), headlights
// and all. Over their 15 m that angle swings the beams ~1.2 m to one side, so
// the whole van sits VAN_SHIFT to the other side of its cell: the beams then
// stay between the sides of the cells they shine into (inside a bridge's
// railings), and the van stays well inside its own cell.
const PARK_SKEW = 0.08;
const VAN_SHIFT = m(15) * Math.sin(PARK_SKEW);

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
    // --- Hospital (modelled at real size; see VARIANTS.hospital) ---
    // Adjustable ward bed ~2.1 x 0.95 m along x, head at -x: wheeled steel
    // frame, pale blue mattress raised at the head, pillow, blanket, rails.
    hospitalBed: (() => {
      const steel = '#b4b8b8', board = '#d6d4c8';
      const tilt = (w, h, d, hex, x, y) => part(new THREE.BoxGeometry(m(w), m(h), m(d))
        .rotateZ(-0.45).translate(m(x), m(y), 0), hex);
      return merge(
        ...[[-0.9, -0.38], [-0.9, 0.38], [0.9, -0.38], [0.9, 0.38]].flatMap(([x, z]) => [
          box(0.1, 0.1, 0.05, '#222', x, z),                 // castor
          box(0.05, 0.22, 0.05, steel, x, z, 0.08),          // leg
        ]),
        box(2.0, 0.1, 0.86, steel, 0, 0, 0.3),               // frame
        box(1.3, 0.16, 0.84, '#a6c2c8', 0.32, 0, 0.4),       // mattress (flat part)
        tilt(0.75, 0.16, 0.84, '#a6c2c8', -0.62, 0.66),      // mattress (raised head)
        tilt(0.32, 0.12, 0.6, '#ecebe4', -0.72, 0.84),       // pillow
        box(1.1, 0.05, 0.88, '#7d9cab', 0.38, 0, 0.53),      // blanket
        box(0.05, 1.0, 0.94, board, -1.04, 0, 0.22),         // headboard
        box(0.05, 0.7, 0.94, board, 1.04, 0, 0.22),          // footboard
        box(0.04, 0.12, 0.3, '#7a8a90', 1.08, 0, 0.62),      // chart clipboard
        box(0.9, 0.04, 0.03, steel, 0.15, 0.47, 0.72),       // side rails
        box(0.9, 0.04, 0.03, steel, 0.15, -0.47, 0.72),
        box(0.04, 0.3, 0.03, steel, -0.27, 0.47, 0.44),
        box(0.04, 0.3, 0.03, steel, 0.57, 0.47, 0.44),
        box(0.04, 0.3, 0.03, steel, -0.27, -0.47, 0.44),
        box(0.04, 0.3, 0.03, steel, 0.57, -0.47, 0.44),
      );
    })(),
    // Wheeled stretcher ~2 x 0.6 m along x, a folded sheet on top.
    gurney: (() => {
      const steel = '#a8acac';
      return merge(
        ...[[-0.85, -0.24], [-0.85, 0.24], [0.85, -0.24], [0.85, 0.24]].flatMap(([x, z]) => [
          box(0.09, 0.09, 0.04, '#222', x, z),
          box(0.04, 0.72, 0.04, steel, x, z, 0.08),
        ]),
        box(1.9, 0.06, 0.6, steel, 0, 0, 0.8),
        box(1.85, 0.08, 0.56, '#2c4a52', 0, 0, 0.86),        // vinyl pad
        box(0.5, 0.06, 0.5, '#e4e2da', 0.55, 0, 0.94),       // folded sheet
        box(1.6, 0.03, 0.03, steel, 0, 0.32, 0.98),          // rails
        box(1.6, 0.03, 0.03, steel, 0, -0.32, 0.98),
      );
    })(),
    // IV drip stand ~1.95 m tall: five-legged base, pole, hook bar, a bag.
    ivStand: merge(
      ...[0, 1, 2, 3, 4].map((k) => part(new THREE.BoxGeometry(m(0.3), m(0.03), m(0.04))
        .translate(m(0.15), m(0.06), 0).rotateY(k * Math.PI * 2 / 5), '#9a9e9e')),
      part(new THREE.CylinderGeometry(m(0.015), m(0.015), m(1.85), 6).translate(0, m(0.08 + 0.925), 0), '#c4c8c8'),
      box(0.36, 0.02, 0.02, '#c4c8c8', 0, 0, 1.88),
      box(0.12, 0.2, 0.05, '#d4e4dc', 0.15, 0, 1.62),      // bag
      box(0.01, 0.6, 0.01, '#d4e4dc', 0.15, 0, 1.02),       // line
    ),
    // Folding privacy screen ~2.4 m wide, 1.8 m tall along x: three pale
    // green fabric panels on a steel tube frame with castors.
    screen: (() => {
      const tube = '#c0c4c4', fabric = '#86a89a';
      const out = [];
      for (let k = 0; k < 3; k++) {
        const x = -0.8 + k * 0.8, tw = (k - 1) * 0.12; // panels zig-zag a little
        out.push(part(new THREE.BoxGeometry(m(0.72), m(1.4), m(0.02)).rotateY(tw)
          .translate(m(x), m(0.3 + 0.7), 0), fabric));
      }
      for (const x of [-1.2, -0.4, 0.4, 1.2]) {
        out.push(box(0.035, 1.75, 0.035, tube, x, 0, 0.06), box(0.08, 0.06, 0.08, '#222', x, 0));
      }
      out.push(box(2.44, 0.03, 0.03, tube, 0, 0, 1.78), box(2.44, 0.03, 0.03, tube, 0, 0, 0.26));
      return merge(...out);
    })(),
    // Vital-signs monitor on a wheeled cart, green trace on the screen.
    monitorCart: merge(
      box(0.5, 0.06, 0.42, '#5a5e5e', 0, 0, 0.06),
      box(0.04, 0.72, 0.04, '#a8acac', 0, 0, 0.12),
      box(0.48, 0.05, 0.4, '#c8cac4', 0, 0, 0.84),
      box(0.44, 0.34, 0.3, '#d2d0c6', 0, 0, 0.89),           // monitor case
      box(0.34, 0.24, 0.01, '#123a26', 0, 0.152, 0.94),      // screen
      box(0.28, 0.03, 0.012, '#3fd88a', 0, 0.155, 1.04),     // trace
      box(0.08, 0.06, 0.012, '#d8483c', 0.1, 0.155, 0.97),   // alarm readout
    ),
    // Folding wheelchair, facing +z.
    wheelchair: (() => {
      const frame = '#8c9090', vinyl = '#2a2c30';
      const wheel = (x) => part(new THREE.CylinderGeometry(m(0.3), m(0.3), m(0.03), 14)
        .rotateZ(Math.PI / 2).translate(m(x), m(0.3), -m(0.08)), '#1e1f22');
      return merge(
        wheel(-0.29), wheel(0.29),
        box(0.06, 0.08, 0.06, '#1e1f22', -0.2, 0.26), box(0.06, 0.08, 0.06, '#1e1f22', 0.2, 0.26),
        box(0.03, 0.4, 0.03, frame, -0.2, 0.24, 0.08), box(0.03, 0.4, 0.03, frame, 0.2, 0.24, 0.08),
        box(0.46, 0.05, 0.44, vinyl, 0, 0.02, 0.48),           // seat
        box(0.46, 0.42, 0.03, vinyl, 0, -0.2, 0.56),           // back
        box(0.03, 0.5, 0.03, frame, -0.24, -0.22, 0.5), box(0.03, 0.5, 0.03, frame, 0.24, -0.22, 0.5),
        box(0.36, 0.03, 0.12, frame, 0, 0.38, 0.12),           // footrest
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
    ...buildingKinds(),
  };
}

// --- Building furniture (src/core/buildings.js types) --------------------------
// Modelled along x, backed against a wall at -z (front facing +z), real size.
const cyl = (r, h, hex, x = 0, z = 0, y = 0, seg = 10) =>
  part(new THREE.CylinderGeometry(m(r), m(r), m(h), seg).translate(m(x), m(y) + m(h) / 2, m(z)), hex);
const ball = (r, hex, x = 0, z = 0, y = 0, sy = 1) =>
  part(new THREE.IcosahedronGeometry(m(r), 0).scale(1, sy, 1).translate(m(x), m(y), m(z)), hex);
const BOOKS = ['#7a2a24', '#2a4a6a', '#3a5a3a', '#8a6a2a', '#4a2a4a', '#6a6a5a'];
const GOODS = ['#c8402a', '#e0b030', '#3a7ac0', '#40a060', '#e0e0d0', '#a03a7a'];
// Rows of coloured blocks on shelves (books, goods, bottles).
function rows(w, d, levels, y0, dy, colours, { h = 0.28, z = 0, n = 6 } = {}) {
  const out = [];
  for (let r = 0; r < levels; r++) for (let k = 0; k < n; k++) {
    const bw = (w - 0.1) / n;
    out.push(box(bw * 0.92, h * (0.75 + ((r * 7 + k * 3) % 5) * 0.06), d, colours[(r * 3 + k) % colours.length], -w / 2 + 0.05 + bw * (k + 0.5), z, y0 + r * dy));
  }
  return out;
}
function buildingKinds() {
  const oak = '#5a3a24', darkOak = '#3e271a', steel = '#9aa0a4', cream = '#e6dcc4';
  return {
    // Library / shop: tall bookcase 1.8 m wide, 2 m tall, books on four shelves.
    bookshelf: merge(
      box(1.8, 2.0, 0.08, darkOak, 0, -0.16), box(0.06, 2.0, 0.36, darkOak, -0.87), box(0.06, 2.0, 0.36, darkOak, 0.87),
      ...[0.05, 0.52, 0.99, 1.46, 1.94].map((y) => box(1.8, 0.04, 0.36, oak, 0, 0, y)),
      ...rows(1.7, 0.24, 4, 0.09, 0.47, BOOKS, { h: 0.34, n: 9 }),
    ),
    // Market / pharmacy: steel gondola shelving with goods, 1.8 m wide, 1.6 m tall.
    storeShelf: merge(
      box(1.8, 1.6, 0.06, steel, 0, -0.22), ...[0.1, 0.55, 1.0, 1.45].map((y) => box(1.8, 0.04, 0.48, steel, 0, 0, y)),
      box(1.8, 0.1, 0.5, '#6a6e72'), ...rows(1.7, 0.3, 3, 0.14, 0.45, GOODS, { h: 0.26, n: 8 }),
    ),
    // Shop counter 1.8 m with a cash register.
    counter: merge(
      box(1.8, 0.95, 0.6, oak), box(1.9, 0.05, 0.66, '#8a6a48', 0, 0, 0.95),
      box(0.4, 0.22, 0.35, '#3a3a3a', 0.5, -0.05, 1.0), box(0.36, 0.08, 0.18, '#d8d0b8', 0.5, 0.1, 1.2),
    ),
    // Boutique: clothes rail 1.5 m with garments hanging.
    rack: merge(
      box(0.04, 1.5, 0.04, steel, -0.72), box(0.04, 1.5, 0.04, steel, 0.72), box(1.5, 0.03, 0.03, steel, 0, 0, 1.48),
      box(0.4, 0.03, 0.4, steel, -0.72), box(0.4, 0.03, 0.4, steel, 0.72),
      ...['#7a3a52', '#2a3a5a', '#c8b89a', '#5a2a2a', '#3a5a4a', '#8a7a9a', '#2a2a2a'].map((c, k) => box(0.12, 0.85, 0.45, c, -0.6 + k * 0.2, 0, 0.6)),
    ),
    mannequin: merge(
      cyl(0.18, 0.04, '#2a2a2a'), cyl(0.02, 0.9, steel), box(0.42, 0.6, 0.24, cream, 0, 0, 0.9),
      box(0.36, 0.45, 0.26, '#7a3a52', 0, 0, 0.95), ball(0.11, cream, 0, 0, 1.68),
    ),
    // Bar: a long dark counter with a brass foot rail, and the back bar.
    barCounter: merge(
      box(2.6, 1.05, 0.6, darkOak), box(2.7, 0.06, 0.7, '#6a4a30', 0, 0, 1.05),
      box(2.6, 0.04, 0.04, '#b08a3a', 0, 0.36, 0.2),
    ),
    backBar: merge(
      box(2.4, 0.9, 0.45, darkOak), box(2.4, 1.2, 0.06, '#7a8a90', 0, -0.2, 0.9),   // mirror
      box(2.4, 0.04, 0.25, oak, 0, -0.08, 1.4), box(2.4, 0.04, 0.25, oak, 0, -0.08, 1.85),
      ...rows(2.2, 0.08, 2, 1.44, 0.45, ['#3a6a3a', '#8a5a1a', '#c8c0a0', '#5a1a1a', '#2a4a2a'], { h: 0.32, n: 10, z: -0.08 }),
    ),
    stool: merge(cyl(0.2, 0.06, '#7a2a2a', 0, 0, 0.72), cyl(0.03, 0.72, steel), cyl(0.2, 0.03, steel)),
    chair: merge(box(0.44, 0.05, 0.44, oak, 0, 0, 0.45), box(0.44, 0.5, 0.05, oak, 0, -0.2, 0.47),
      ...[[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]].map(([x, z]) => box(0.04, 0.45, 0.04, darkOak, x, z))),
    // Cafe: a small round table.
    cafeTable: merge(cyl(0.35, 0.04, '#e8e0d0', 0, 0, 0.74, 14), cyl(0.04, 0.74, '#2a2a2a'), cyl(0.22, 0.03, '#2a2a2a')),
    // Library: reading table with a green banker's lamp.
    readingTable: merge(
      box(2.0, 0.06, 0.9, oak, 0, 0, 0.72), ...[[-0.9, -0.38], [0.9, -0.38], [-0.9, 0.38], [0.9, 0.38]].map(([x, z]) => box(0.07, 0.72, 0.07, darkOak, x, z)),
      box(0.1, 0.3, 0.1, '#b08a3a', 0, 0, 0.78), box(0.36, 0.1, 0.16, '#2a6a3a', 0, 0, 1.06),
    ),
    // Curio shop: glass-fronted cabinet of oddities; a grandfather clock.
    curioCabinet: merge(
      box(1.2, 2.0, 0.45, darkOak), box(1.1, 1.5, 0.02, '#9ab0b4', 0, 0.23, 0.35),
      ...rows(1.0, 0.2, 3, 0.45, 0.5, ['#b08a3a', '#c8c0a0', '#6a3a2a', '#3a4a5a', '#8a2a2a'], { h: 0.22, n: 4, z: 0.05 }),
    ),
    clock: merge(box(0.5, 2.1, 0.35, '#4a2a1a'), cyl(0.18, 0.03, cream, 0, 0.18, 1.7), box(0.06, 0.6, 0.02, '#b08a3a', 0, 0.18, 0.7)),
    // Florist: tiered stand of flower buckets; a single bucket.
    flowerStand: merge(
      box(1.4, 0.4, 0.6, '#6a5a3a'), box(1.4, 0.4, 0.4, '#6a5a3a', 0, -0.1, 0.4), box(1.4, 0.4, 0.2, '#6a5a3a', 0, -0.2, 0.8),
      ...[[0, 0.15, 0.4], [1, -0.05, 0.8], [2, -0.2, 1.2]].flatMap(([r, z, y]) => [-0.45, 0, 0.45].flatMap((x, k) => [
        cyl(0.13, 0.25, '#7a8a8a', x, z, y), ball(0.2, ['#c84a6a', '#e8d040', '#e8e0f0', '#d0603a', '#8a4ac0'][(r * 3 + k) % 5], x, z, y + 0.38, 0.8)])),
    ),
    flowerBucket: merge(cyl(0.16, 0.35, '#7a8a8a'), ball(0.26, '#c84a6a', 0, 0, 0.5, 0.8), ball(0.18, '#e8d040', 0.12, 0.08, 0.62, 0.8)),
    // Outdoor store: gear rack of jackets and packs; a pitched tent; a canoe on stands.
    gearRack: merge(
      box(1.6, 1.8, 0.08, '#4a4a40', 0, -0.2), box(1.6, 0.04, 0.4, '#4a4a40', 0, 0, 1.5),
      ...['#3a5a2a', '#c86a1a', '#8a2a1a', '#2a4a6a', '#5a5a3a'].map((c, k) => box(0.26, 0.8, 0.35, c, -0.6 + k * 0.3, 0, 0.65)),
      box(0.45, 0.55, 0.3, '#c86a1a', -0.4, 0, 0), box(0.45, 0.55, 0.3, '#3a5a2a', 0.3, 0, 0),
    ),
    tent: merge(part(new THREE.ConeGeometry(m(1.2), m(1.4), 4).rotateY(Math.PI / 4).translate(0, m(0.7), 0), '#d8742a'), box(0.5, 0.9, 0.02, '#3a2a1a', 0, 0.62, 0)),
    canoe: merge(part(new THREE.CylinderGeometry(m(0.38), m(0.38), m(4.2), 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI).translate(0, m(0.85), 0), '#a82a1a'),
      box(0.1, 0.6, 0.8, '#5a4a30', -1.3), box(0.1, 0.6, 0.8, '#5a4a30', 1.3)),
    // Funeral parlor: a casket on a draped bier with a spray of lilies; rows of chairs; a wreath on an easel.
    casket: merge(
      box(2.3, 0.7, 0.8, '#4a3a4a'), box(2.1, 0.55, 0.65, '#3a1e14', 0, 0, 0.7), box(2.15, 0.08, 0.7, '#5a2e1e', 0, 0, 1.25),
      box(2.12, 0.04, 0.05, '#b08a3a', 0, 0.34, 0.95), ball(0.3, '#ece8dc', 0, 0, 1.4, 0.5), ball(0.2, '#4a6a3a', 0.3, 0, 1.36, 0.5),
    ),
    chairRow: merge(...[-0.75, 0, 0.75].flatMap((x) => [box(0.46, 0.05, 0.44, '#6a6a6a', x, 0, 0.45), box(0.46, 0.45, 0.04, '#6a6a6a', x, -0.2, 0.48),
      box(0.04, 0.45, 0.44, '#4a4a4a', x - 0.2), box(0.04, 0.45, 0.44, '#4a4a4a', x + 0.2)])),
    wreath: merge(box(0.04, 1.4, 0.04, oak, 0, -0.1), box(0.6, 0.04, 0.04, oak, 0, 0.1, 0.1),
      part(new THREE.TorusGeometry(m(0.35), m(0.09), 5, 12).translate(0, m(1.3), m(0.02)), '#3a5a2a'), ball(0.12, '#ece8dc', 0, 0.08, 1.0)),
    // Hotel and apartments: a bed, nightstand, dresser, kitchenette; the front desk
    // and its key board; a bank of mailboxes; a potted plant.
    bed: merge(
      box(2.0, 0.4, 1.0, oak), box(1.9, 0.18, 0.92, cream, 0, 0, 0.4), box(1.2, 0.12, 0.94, '#6a3a4a', 0.35, 0, 0.5),
      box(0.4, 0.12, 0.7, '#f0ece0', -0.7, 0, 0.6), box(0.08, 0.9, 1.0, darkOak, -1.0),
    ),
    nightstand: merge(box(0.45, 0.55, 0.4, oak), cyl(0.07, 0.3, '#c8b890', 0, 0, 0.55), cyl(0.14, 0.18, '#e8dcb0', 0, 0, 0.85)),
    dresser: merge(box(1.2, 0.85, 0.5, oak), ...[0.15, 0.42, 0.68].map((y) => box(1.1, 0.02, 0.02, darkOak, 0, 0.26, y)), box(0.7, 0.5, 0.04, '#8a9aa0', 0, -0.2, 0.9)),
    kitchenette: merge(
      box(2.0, 0.9, 0.6, cream), box(2.0, 0.04, 0.62, '#6a6a62', 0, 0, 0.9), box(0.6, 0.02, 0.5, '#2a2a2a', 0.5, 0, 0.92),
      box(2.0, 0.6, 0.35, cream, 0, -0.12, 1.45), box(0.4, 0.3, 0.4, '#d8d8d0', -0.6, 0, 0.92),
    ),
    frontDesk: merge(
      box(2.4, 1.05, 0.7, '#5a2a1e'), box(2.5, 0.05, 0.78, '#8a6a48', 0, 0, 1.05), cyl(0.06, 0.06, '#c8a040', 0.7, 0.15, 1.1),
      box(1.4, 0.9, 0.12, darkOak, 0, -0.45, 1.25), ...[0, 1, 2, 3].flatMap((c) => [0, 1, 2].map((r) => box(0.06, 0.12, 0.02, '#b08a3a', -0.5 + c * 0.33, -0.38, 1.38 + r * 0.25))),
    ),
    mailboxes: merge(box(1.4, 1.2, 0.3, '#8a6a3a', 0, 0, 0.6), ...[0, 1, 2, 3].flatMap((c) => [0, 1, 2].map((r) => box(0.28, 0.3, 0.02, '#c8a040', -0.5 + c * 0.33, 0.16, 0.72 + r * 0.36)))),
    plant: merge(cyl(0.22, 0.4, '#8a4a2a'), ball(0.45, '#2e5a32', 0, 0, 0.8, 1.1)),
    // Pharmacy counter with a green cross over it.
    pharmCounter: merge(box(2.0, 1.0, 0.6, cream), box(2.1, 0.05, 0.66, '#6a8a7a', 0, 0, 1.0), box(0.5, 0.15, 0.05, '#2aa05a', 0, -0.2, 1.8), box(0.15, 0.5, 0.05, '#2aa05a', 0, -0.2, 1.62)),
    // Market: angled produce bins.
    produce: merge(box(1.8, 0.7, 0.9, '#7a5a3a'), ...[[-0.6, '#c8402a'], [0, '#e0a030'], [0.6, '#5a9a3a']].map(([x, c]) => ball(0.32, c, x, 0, 0.75, 0.45))),
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
// Turn a whole layout (offsets and headings) by angle `a` about the cell
// centre, so a room's furniture follows the way the room runs.
function turn(list, a) {
  const c = Math.cos(a), sn = Math.sin(a);
  return list.map(([kind, x, z, rot = 0, ...rest]) => [kind, x * c + z * sn, -x * sn + z * c, rot + a, ...rest]);
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
  // Hospital: pale linoleum. Walkable cells are mostly clear with the odd
  // parked wheelchair, drip stand or gurney against an edge; a blocked cell
  // is a ward bay: two beds with a privacy screen between them, drip stands,
  // a monitor cart, and a gurney left across the front.
  hospital: {
    walkable: ({ along, rnd }) => {
      const v = rnd(), e = 0.36, s = rnd() < 0.5 ? 1 : -1;
      if (v < 0.4) return [];
      if (v < 0.65) return turn([['wheelchair', jit(rnd, 0.4), e * s, s > 0 ? Math.PI : 0]], along);
      if (v < 0.85) return turn([['ivStand', e * s, jit(rnd, 0.5), rnd() * 6]], along);
      return turn([['gurney', jit(rnd, 0.2), e * s, jit(rnd, 0.08)]], along);
    },
    blocked: ({ along, rnd }) => turn([
      ['hospitalBed', -0.2, -0.08, -Math.PI / 2],
      ['hospitalBed', 0.2, -0.08, -Math.PI / 2],
      ['screen', 0, -0.06, Math.PI / 2],
      ['ivStand', -0.34, -0.28, rnd() * 6],
      ['ivStand', 0.07, -0.3, rnd() * 6],
      ['monitorCart', 0.36, -0.3, jit(rnd, 0.4)],
      ['gurney', -0.12, 0.33, jit(rnd, 0.12)],
      ['wheelchair', 0.3, 0.3, rnd() * 6],
    ], along + (rnd() < 0.5 ? 0 : Math.PI)),
  },
  // Water: a ford of stepping stones when walkable; open water otherwise.
  lake: { walkable: (ctx) => ford(ctx) },
  river: { walkable: (ctx) => ford(ctx) },
};

// --- Typed buildings (src/core/buildings.js) ----------------------------------
// ctx adds `back`: the turn that puts a piece's back (-z) against a wall of
// this cell (or `along` when it has none), and `unit`: the cell is in a
// private room (a hotel room, a flat). Walkable cells only get something
// against a wall, leaving the floor clear to walk; blocked cells are full.
const W = -0.43;   // against the back wall (cell units)
const atWall = (ctx, list) => turn(list, ctx.back);
const BUILDING_VARIANTS = {
  hotel: {
    walkable: (ctx) => atWall(ctx, ctx.unit ? [['dresser', 0.1, W + 0.02, 0]] : [['plant', 0.35, W + 0.05, 0], ['armchair', -0.15, W + 0.07, 0]]),
    blocked: (ctx) => atWall(ctx, ctx.unit
      ? [['bed', -0.05, -0.28, 0], ['nightstand', 0.35, W + 0.02, 0], ['dresser', 0.05, 0.36, Math.PI]]
      : ctx.rnd() < 0.45 ? [['frontDesk', 0, -0.25, 0], ['plant', 0.4, 0.3, 0]]
        : [['sofa', 0, -0.25, 0], ['table', 0, 0.05, 0], ['armchair', -0.33, 0.3, Math.PI * 0.85], ['armchair', 0.33, 0.3, -Math.PI * 0.85]]),
  },
  apartments: {
    walkable: (ctx) => atWall(ctx, ctx.unit ? [[ctx.rnd() < 0.5 ? 'armchair' : 'dresser', 0, W + 0.06, 0]] : ctx.rnd() < 0.4 ? [['plant', 0.38, W + 0.05, 0]] : []),
    blocked: (ctx) => atWall(ctx, ctx.unit
      ? (ctx.rnd() < 0.5 ? [['bed', -0.05, -0.28, 0], ['nightstand', 0.35, W + 0.02, 0], ['dresser', 0.05, 0.36, Math.PI]]
        : [['kitchenette', 0, W + 0.04, 0], ['table', 0, 0.12, 0], ['chair', -0.15, 0.3, Math.PI], ['sofa', 0, 0.38, Math.PI]])
      : [['mailboxes', 0, W + 0.02, 0], ['plant', 0.38, -0.1, 0], ['crate', -0.3, 0.2, 0.3, 0.6]]),
  },
  boutique: {
    walkable: (ctx) => atWall(ctx, ctx.rnd() < 0.5 ? [['rack', 0, W + 0.05, 0]] : [['mannequin', -0.25, W + 0.06, 0], ['mannequin', 0.25, W + 0.06, 0.3]]),
    blocked: (ctx) => atWall(ctx, [['rack', 0, -0.3, 0], ['rack', 0, 0.05, 0], ['mannequin', -0.3, 0.35, 0.4], ['mannequin', 0.3, 0.35, -0.4], ['counter', 0, W + 0.0, 0, 0.0]].filter((p) => p[4] !== 0)),
  },
  market: {
    walkable: (ctx) => atWall(ctx, [[ctx.rnd() < 0.5 ? 'produce' : 'storeShelf', 0, W + 0.04, 0]]),
    blocked: (ctx) => atWall(ctx, [['storeShelf', 0, -0.03, Math.PI], ['storeShelf', 0, 0.03, 0], ['produce', 0, W + 0.04, 0], ['produce', 0, 0.42, Math.PI]]),
  },
  bar: {
    walkable: (ctx) => atWall(ctx, [['stool', -0.2, -0.3, 0], ['stool', 0.2, -0.3, 0], ['cafeTable', 0, W + 0.04, 0, 0.8]]),
    blocked: (ctx) => atWall(ctx, [['backBar', 0, W + 0.02, 0], ['barCounter', 0, -0.05, Math.PI], ['stool', -0.3, 0.22, 0], ['stool', 0, 0.22, 0], ['stool', 0.3, 0.22, 0]]),
  },
  library: {
    walkable: (ctx) => atWall(ctx, [['bookshelf', 0, W + 0.02, 0]]),
    blocked: (ctx) => atWall(ctx, ctx.rnd() < 0.6
      ? [['bookshelf', 0, -0.03, Math.PI], ['bookshelf', 0, 0.03, 0], ['bookshelf', 0, W + 0.02, 0], ['bookshelf', 0, 0.45, Math.PI]]
      : [['bookshelf', 0, W + 0.02, 0], ['readingTable', 0, 0.1, 0], ['chair', -0.25, -0.1, 0], ['chair', 0.25, -0.1, 0], ['chair', -0.25, 0.3, Math.PI], ['chair', 0.25, 0.3, Math.PI]]),
  },
  curio: {
    walkable: (ctx) => atWall(ctx, ctx.rnd() < 0.7 ? [['curioCabinet', 0, W + 0.04, 0]] : [['clock', 0.3, W + 0.03, 0]]),
    blocked: (ctx) => atWall(ctx, [['curioCabinet', -0.2, W + 0.04, 0], ['clock', 0.3, W + 0.03, 0], ['curioCabinet', 0, 0.05, 0], ['crate', -0.3, 0.35, 0.4, 0.7], ['crate', 0.25, 0.3, -0.3, 0.6], ['armchair', 0.3, 0.05, -0.8]]),
  },
  florist: {
    walkable: (ctx) => atWall(ctx, [['flowerBucket', -0.3, W + 0.05, 0], ['flowerBucket', 0, W + 0.05, 1], ['flowerBucket', 0.3, W + 0.05, 2]]),
    blocked: (ctx) => atWall(ctx, [['flowerStand', 0, -0.3, 0], ['flowerStand', 0, 0.3, Math.PI], ['flowerBucket', -0.4, 0, 0], ['flowerBucket', 0.4, 0, 1], ['counter', 0, 0.02, 0, 0.0]].filter((p) => p[4] !== 0)),
  },
  cafe: {
    walkable: (ctx) => atWall(ctx, [['cafeTable', 0, -0.32, 0, 0.9], ['chair', -0.2, -0.32, Math.PI / 2], ['chair', 0.2, -0.32, -Math.PI / 2]]),
    blocked: (ctx) => atWall(ctx, ctx.rnd() < 0.5
      ? [['backBar', 0, W + 0.02, 0], ['counter', 0, -0.05, Math.PI], ['stool', -0.25, 0.2, 0], ['stool', 0.25, 0.2, 0]]
      : [['cafeTable', -0.22, -0.2, 0], ['cafeTable', 0.22, 0.2, 0], ...[[-0.22, -0.2], [0.22, 0.2]].flatMap(([x, z]) => [['chair', x - 0.12, z, Math.PI / 2], ['chair', x + 0.12, z, -Math.PI / 2]])]),
  },
  outdoor: {
    walkable: (ctx) => atWall(ctx, [['gearRack', 0, W + 0.04, 0]]),
    blocked: (ctx) => atWall(ctx, [['gearRack', 0, W + 0.04, 0], ctx.rnd() < 0.5 ? ['tent', 0, 0.12, 0.4] : ['canoe', 0, 0.12, 0]]),
  },
  funeral: {
    walkable: (ctx) => atWall(ctx, ctx.rnd() < 0.5 ? [['chairRow', 0, -0.25, Math.PI]] : [['wreath', 0.3, W + 0.04, 0]]),
    blocked: (ctx) => atWall(ctx, [['casket', 0, -0.2, 0], ['wreath', -0.38, W + 0.04, 0.3], ['wreath', 0.38, W + 0.04, -0.3], ['chairRow', 0, 0.32, Math.PI]]),
  },
  pharmacy: {
    walkable: (ctx) => atWall(ctx, [['storeShelf', 0, W + 0.04, 0]]),
    blocked: (ctx) => atWall(ctx, ctx.rnd() < 0.4 ? [['pharmCounter', 0, W + 0.05, 0], ['storeShelf', 0, 0.3, Math.PI]]
      : [['storeShelf', 0, -0.03, Math.PI], ['storeShelf', 0, 0.03, 0], ['storeShelf', 0, W + 0.04, 0]]),
  },
};
// Which way a cell's furniture backs onto a wall: the turn (radians) that
// puts local -z against a walled side (a wall or window of its own, or the
// building's edge; not a door), or null if it has none. N 0, E -π/2, S π, W π/2.
const SIDE_TURN = [[0, -1, 0], [1, 0, -Math.PI / 2], [0, 1, Math.PI], [-1, 0, Math.PI / 2]];
function wallTurn(grid, i, ids) {
  const { x, y } = grid.coords(i);
  const auto = grid.autoEdges();
  const walled = SIDE_TURN.filter(([dx, dy]) => {
    const k = dx ? `v${dx > 0 ? x + 1 : x},${y}` : `h${x},${dy > 0 ? y + 1 : y}`;
    const t = grid.edges.get(k) ?? auto.get(k);
    if (t && /door/i.test(t) && t !== 'boardedDoor') return false;
    if (t) return true;
    const n = grid.inBounds(x + dx, y + dy) ? grid.index(x + dx, y + dy) : -1;
    return n < 0 || ids[n] !== ids[i];
  });
  if (!walled.length) return null;
  return walled[(x * 7 + y * 13) % walled.length][2];
}

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
      if (!seen.has(k) && typeAt(grid, k) === 'church') { seen.add(k); order.push(k); }
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
  const rot = Math.atan2(-fz, fx) + PARK_SKEW; // parked, very slightly askew
  // Back a touch, and over to the side the skew swings the beams away from
  // (the van's right, looking ahead).
  const x = -fx * 0.04 - fz * VAN_SHIFT, z = -fz * 0.04 + fx * VAN_SHIFT;
  // The van stands on the asphalt (lifted STREET_LIFT above the tile); the
  // flat light on the road keeps its old height, just under a bridge deck
  // ahead (level with it, the two flicker against each other).
  const d = -STREET_LIFT;
  return [
    ['van', x, z, rot], ['vanLights', x, z, rot],
    ['vanHazard', x, z, rot], ['vanBeam', x, z, rot, 1, d],
    ['vanCone', x, z, rot, 1, d],
    ['startFrame', fx, fz, 0, 1, d], ['startFill', fx, fz, 0, 1, d],
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

  // Culling chunks: a kind with lots of triangles on the board (forest firs,
  // thickets, packed cemeteries...) is drawn as one batch per CHUNK x CHUNK
  // cells instead of one for the whole board, so the renderer can skip the
  // batches that are off screen. Light kinds stay one batch (fewer draw calls).
  const CHUNK = 6;
  const CHUNK_MIN_TRIS = 20000;
  const trisPer = (kind) => { const g = kind === 'fir' ? firGeo : kinds[kind]; return (g.index ? g.index.count : g.attributes.position.count) / 3; };

  // `key` is the kind, or kind@chunk for a chunked kind.
  function meshFor(key, kind, needed) {
    let mesh = meshes[key];
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
    meshes[key] = mesh;
    group.add(mesh);
    return mesh;
  }

  // ctx: { visible, cellToWorld(x,y), baseY(i) }
  function update(grid, ctx) {
    const placements = {}; // kind -> array of [x, y, z, rot, scale]
    if (ctx.visible) {
      const ids = buildingIds(grid);
      const units = unitRooms(grid);
      grid.cells.forEach((c, i) => {
        const variant = VARIANTS[c.sub]?.[c.walkable ? 'walkable' : 'blocked'];
        const { x, y } = grid.coords(i);
        let list = variant ? null : [];
        const type = c.area === 'indoor' ? typeAt(grid, i) : null;
        // Church: a pew facing the pulpit, or the pulpit facing the pews.
        if (type === 'church') {
          const [fx, fz] = churchFacing(grid, i);
          list = [[c.walkable ? 'pew' : 'pulpit', 0, 0, Math.atan2(fx, fz)]];
        } else if (type === 'hospital' || BUILDING_VARIANTS[type]) {
          // A typed building: its own furniture, backed onto a wall.
          let seed = (i * 2654435761) % 2147483647 || 1;
          const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
          const axis = runAxis(grid, x, y, c);
          const along = axis === 'x' ? 0 : Math.PI / 2;
          const back = wallTurn(grid, i, ids) ?? along;
          const unit = !!BUILDING_TYPES[type]?.rooms && units.has(roomIds(grid)[i]);
          const v = type === 'hospital' ? VARIANTS.hospital : BUILDING_VARIANTS[type];
          const make = v[c.walkable ? 'walkable' : 'blocked'];
          list = make ? make({ rnd, along, across: along + Math.PI / 2, back, unit }) : [];
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
    const batches = {}; // key -> placements
    for (const [kind, list] of Object.entries(placements)) {
      const chunked = list.length * trisPer(kind) >= CHUNK_MIN_TRIS;
      for (const pl of list) {
        let key = kind;
        if (chunked) { const { x, y } = grid.coords(pl[5]); key = `${kind}@${Math.floor(x / CHUNK)},${Math.floor(y / CHUNK)}`; }
        (batches[key] ??= []).push(pl);
      }
    }
    // Batches that emptied go (a chunk the forest no longer reaches).
    for (const key of Object.keys(meshes)) {
      if (!batches[key]) { group.remove(meshes[key]); meshes[key].dispose(); delete meshes[key]; }
    }
    for (const [key, list] of Object.entries(batches)) {
      const kind = key.split('@')[0];
      const mesh = meshFor(key, kind, list.length);
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
      // The terrain shader lifts props a little: keep culling on the safe side.
      mesh.boundingSphere.radius += 0.5;
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
