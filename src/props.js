// Cell props: the walkable and blocked look of every surface.
//
// Blocked cells no longer rise as blocks. Each subcategory has two variants,
// chosen by the cell's `walkable` flag (see VARIANTS below). Props are built
// to real-world scale (metres -> cells via `m`), drawn with one InstancedMesh
// per prop kind, and rebuilt from the grid after every change.
import * as THREE from 'three';
import { m } from './scale.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';


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
      : new THREE.InstancedMesh(kinds[kind], material, cap);
    mesh.castShadow = true;
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
        // Blocked bridges get a barricade on the deck.
        if (c.bridge) {
          list = c.walkable ? [] : [['barricade', 0, 0, grid.bridgeAxis(x, y) === 'x' ? Math.PI / 2 : 0]];
        } else if (variant) {
          let seed = (i * 2654435761) % 2147483647 || 1;
          const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
          const axis = runAxis(grid, x, y, c);
          list = variant({ rnd, along: axis === 'x' ? 0 : Math.PI / 2, across: axis === 'x' ? Math.PI / 2 : 0 });
        }
        if (!list.length) return;
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
        mesh.setColorAt(n, tmpC.setScalar(0.85 + ((i * 37 + n * 11) % 30) / 100));
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

  return { update, clear };
}

// Which way the surrounding cells run: 'x' (east-west) or 'y' (north-south).
// For roads, paths and gates that's neighbours of the same surface; for a
// walkable cemetery or a ford, walkable neighbours (where the path leads),
// with same-surface neighbours counting double.
function runAxis(grid, x, y, c) {
  const water = c.area === 'water';
  const sameRun = ['street', 'path', 'cemeteryPath'].includes(c.sub);
  const pred = (nx, ny) => {
    if (!grid.inBounds(nx, ny)) return 0;
    const n = grid.cells[grid.index(nx, ny)];
    if (sameRun) return n.sub === c.sub || (c.sub === 'street' && n.bridge) ? 1 : 0;
    // Paths and fords lead on to walkable cells, preferring the same surface.
    if (water || c.sub === 'cemetery') return n.walkable ? (n.sub === c.sub ? 2 : 1) : 0;
    return 0;
  };
  const ew = pred(x - 1, y) + pred(x + 1, y);
  const ns = pred(x, y - 1) + pred(x, y + 1);
  return ew >= ns ? 'x' : 'y';
}
