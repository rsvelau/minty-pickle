// The board: built from the grid (tiles, water, bridges, walls, doors,
// windows, props, landmarks, markers) and refreshed when cells change.

import * as THREE from 'three';
import { createWaterSurface } from './water.js';
import { createMarkers } from './markers.js';
import { terrainify, cellLevel, terrainSmoothAt, updateOverrides, terrainHeight, isFlat } from './terrain.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createProps } from './props.js';
import { createBridges } from './bridge.js';
import { createStreets, STREET_LIFT } from './street.js';
import { createClocktowers } from './clocktower.js';
import { createLandmarks } from './landmarks.js';
import { createBuildingDress } from './buildingDress.js';
import { BUILDING_TYPES, buildingTypes, frontDoor } from '../core/buildings.js';
import { anyDoor } from '../game/doors.js';
import { flickerize } from './dread.js';
import { colLabel, parseEdgeKey, isLandmark } from '../core/state.js';
import { m } from '../core/scale.js';
import { BASE, BED_H, DECK_T, DECK_TOP, DOOR_H, DOOR_W, FLOOR_H, PALETTE, RAIL_H, SUB_LOOK, TILE, WALL_FULL, WALL_LOW, WALL_T, WATER_Y, grid, hoverIndex, rand32, ui } from '../app/config.js';
import { play } from '../play/playView.js';
import { BUILDING_STYLES, INTERIOR_STYLES, board, bridgeDepthMat, buildingSeeds, buildingStyle, cellToWorld, deckMat, doorMat, frameMat, glassDarkMat, glassLitMat, groundHole, innerGroundMat, interiorStyle, outerGroundMat, outerHole, poolGeo, poolMat, railMat, scene, slabMat, tileGeoBase, tileMat, unitBoxGeo, wallMat, resetShadowWindow } from './scene.js';
import { buildRain, buildSurroundings, firGeo, firMat } from './surroundings.js';
import { lampsOn, lightLevels, makeLabel, mixHex, refreshAll, tmpColor, tmpMatrix, tmpPos, tmpQuat, tmpScale } from './tileLook.js';

// Module state: assigned by init() below, in the same order as before the split.
export let foundationMat, deckVisible, water, heights, targetHeights, jitter;
export let boardGroup, labelGroup, markers, keyHighlight;

export function __set_markerUsed(v) { markerUsed = v; return v; }
export function __set_markerHidden(v) { markerHidden = v; return v; }

// Run once at startup (called from src/main.js, in order).
export function init() {
  foundationMat = new THREE.MeshLambertMaterial({ color: '#615b51' });
  for (const mat of [wallMat, doorMat, frameMat, glassDarkMat, glassLitMat, foundationMat]) terrainify(mat, { none: true }); // street surfaces: lanes, lines, sidewalks (src/street.js)
  deckVisible = new Uint8Array(0);
  water = createWaterSurface();
  scene.add(water.mesh);
  heights = new Float32Array(0);
  targetHeights = new Float32Array(0);
  jitter = new Float32Array(0); // stable per-cell colour variation
  boardGroup = new THREE.Group();
  scene.add(boardGroup);
  labelGroup = new THREE.Group();
  scene.add(labelGroup);

  // Gameplay markers float over their cells in every view.
  markers = createMarkers(scene);

  // Hovering a key marker outlines every door it would unlock.
  keyHighlight = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.85, depthTest: false }),
    256,
  );
  keyHighlight.renderOrder = 13;
  terrainify(keyHighlight.material, { none: true });
  keyHighlight.raycast = () => {};
  keyHighlight.count = 0;
  scene.add(keyHighlight);
}

// Walls, doors, windows and foundations are placed at their final height on
// the CPU (see edgeBase) and stand perfectly upright: the terrain doesn't
// bend them.

// ---------------------------------------------------------------------------
// Board (rebuilt whenever the dimensions change)
// ---------------------------------------------------------------------------

export let N = 0;
export let clocktowers;
export let landmarks;
export let tiles, pools, glowAttr, slab, ground, decks, deckGlow, rails;
export let walls, doorLeaves, frames, glassDark, glassLit, foundations;

// Where an edge piece stands. On the edge of an indoor floor it stands on
// that (level) floor; elsewhere on the average ground of the two cells.
// `drop` is how far below that the ground falls anywhere along the edge, so
// walls can reach down to it with no gap.
export function edgeBase(o, x, y) {
  const sides = grid.edgeCells(o, x, y).filter((c) => grid.inBounds(c.x, c.y)).map((c) => ({
    level: cellLevel(c.x, c.y),
    indoor: grid.cells[grid.index(c.x, c.y)].area === 'indoor',
  }));
  if (!sides.length) return { base: 0, drop: 0 };
  const indoor = sides.filter((s) => s.indoor);
  const base = indoor.length
    ? Math.max(...indoor.map((s) => s.level))
    : sides.reduce((a, s) => a + s.level, 0) / sides.length;
  const ends = o === 'v' ? [[x, y], [x, y + 1]] : [[x, y], [x + 1, y]];
  const lows = [
    ...sides.map((s) => s.level),
    ...ends.map(([gx, gy]) => terrainSmoothAt(gx - grid.cols / 2, gy - grid.rows / 2)),
  ];
  return { base, drop: Math.max(0, base - Math.min(...lows)) };
}
export let props = null; // walkable/blocked variants of every surface (src/props.js)
export let bridges = null; // steel truss bridge structures (src/bridge.js)
export let streets = null;
let dress = null; // typed buildings' signs and awnings (src/render/buildingDress.js)

export function disposeChildren(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && ![tileGeoBase, poolGeo, firGeo, unitBoxGeo].includes(o.geometry)) o.geometry.dispose();
      if (o.material && o.userData.ownMaterial) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
}

export function buildBoard() {
  const { cols, rows } = grid;
  N = cols * rows;
  board.w = cols * TILE;
  board.d = rows * TILE;
  board.radius = 0.5 * Math.hypot(board.w, board.d);

  disposeChildren(boardGroup);
  disposeChildren(labelGroup);

  // Dark slab under the tile columns; the gaps between tiles read as grid lines.
  slab = new THREE.Mesh(new THREE.BoxGeometry(board.w + 0.4, 0.3, board.d + 0.4), slabMat);
  slab.position.y = -BASE - 0.15;
  slab.receiveShadow = true;
  boardGroup.add(slab);

  // Forest floor level with the town. Near the board it is finely divided so
  // it follows the elevation; further out a coarse ring runs into the fog.
  // Both are hidden over what they surround (sunken water shows through).
  const hw = board.w / 2 + 0.2, hd = board.d / 2 + 0.2;
  groundHole.value.set(hw, hd);
  const innerW = board.w + 64, innerD = board.d + 64;
  outerHole.value.set(innerW / 2 - 0.5, innerD / 2 - 0.5);
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(innerW, innerD, Math.ceil(innerW * 2), Math.ceil(innerD * 2)).rotateX(-Math.PI / 2),
    innerGroundMat,
  );
  ground.receiveShadow = true;
  boardGroup.add(ground);
  const outerSize = 2 * (board.radius + 260);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(outerSize, outerSize, 140, 140).rotateX(-Math.PI / 2), outerGroundMat);
  outer.position.y = -0.04;
  outer.receiveShadow = true;
  boardGroup.add(outer);

  // Water surface + its per-cell textures.
  water.resize(cols, rows);
  water.mesh.position.y = WATER_Y;

  // Bridge decks: one per cell (hidden unless that cell is a bridge).
  const deckGeo = new THREE.BoxGeometry(TILE, DECK_T, TILE).translate(0, -DECK_T / 2, 0);
  deckGlow = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  deckGeo.setAttribute('aGlow', deckGlow);
  decks = new THREE.InstancedMesh(deckGeo, deckMat, N);
  decks.castShadow = true;
  decks.customDepthMaterial = bridgeDepthMat;
  decks.receiveShadow = true;
  deckVisible = new Uint8Array(N);
  boardGroup.add(decks);

  // Railings along bridge edges that face open water (up to 4 per cell).
  // Pipe railing: top and mid rails on posts.
  const railGeo = mergeGeometries([
    new THREE.BoxGeometry(TILE, 0.025, 0.025).translate(0, RAIL_H, 0),
    new THREE.BoxGeometry(TILE, 0.02, 0.02).translate(0, RAIL_H * 0.5, 0),
    ...[-0.375, -0.125, 0.125, 0.375].map((x) => new THREE.BoxGeometry(0.02, RAIL_H, 0.02).translate(x, RAIL_H / 2, 0)),
  ]);
  rails = new THREE.InstancedMesh(railGeo, railMat, N * 4);
  rails.userData.ownMaterial = true;
  rails.castShadow = true;
  rails.customDepthMaterial = bridgeDepthMat;
  rails.raycast = () => {};
  rails.count = 0;
  boardGroup.add(rails);

  // Cell props: each surface's walkable / blocked look.
  props?.clear();
  props = createProps(boardGroup, { firGeo, firMat });
  bridges?.clear();
  bridges = createBridges(boardGroup);
  streets?.clear();
  streets = createStreets(boardGroup);
  clocktowers?.clear();
  clocktowers = createClocktowers(boardGroup);
  landmarks?.clear();
  landmarks = createLandmarks(boardGroup, { terrainify, flickerize });
  dress?.clear();
  dress = createBuildingDress(boardGroup);

  // Walls and doors on cell edges (a door = two short wall pieces, an
  // optional lintel, and an open door leaf).
  const maxEdges = 2 * N + cols + rows;
  // Walls get their own box geometry with a per-instance texture index.
  const wallGeo = unitBoxGeo.clone();
  const wallN = maxEdges * 3;
  wallGeo.setAttribute('aWallTex', new THREE.InstancedBufferAttribute(new Float32Array(wallN), 1));
  wallGeo.setAttribute('aPosTex', new THREE.InstancedBufferAttribute(new Float32Array(wallN), 1));
  wallGeo.setAttribute('aNegColor', new THREE.InstancedBufferAttribute(new Float32Array(wallN * 3), 3));
  wallGeo.setAttribute('aPosColor', new THREE.InstancedBufferAttribute(new Float32Array(wallN * 3), 3));
  walls = new THREE.InstancedMesh(wallGeo, wallMat, wallN);
  doorLeaves = new THREE.InstancedMesh(unitBoxGeo, doorMat, maxEdges * 2);
  frames = new THREE.InstancedMesh(unitBoxGeo, frameMat, maxEdges * 9);
  foundations = new THREE.InstancedMesh(unitBoxGeo, foundationMat, maxEdges);
  glassDark = new THREE.InstancedMesh(unitBoxGeo, glassDarkMat, maxEdges);
  glassLit = new THREE.InstancedMesh(unitBoxGeo, glassLitMat, maxEdges);
  glassDark.renderOrder = glassLit.renderOrder = 3;
  for (const mesh of [walls, doorLeaves, frames, glassDark, glassLit, foundations]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.raycast = () => {};
    mesh.count = 0;
    boardGroup.add(mesh);
  }

  // Tiles: one instanced mesh, per-instance colour + per-instance "glow" (lit).
  const tileGeo = tileGeoBase.clone();
  glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  tileGeo.setAttribute('aGlow', glowAttr);
  tiles = new THREE.InstancedMesh(tileGeo, tileMat, N);
  tiles.castShadow = true;
  tiles.receiveShadow = true;
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  boardGroup.add(tiles);

  pools = new THREE.InstancedMesh(poolGeo, poolMat, N);
  pools.raycast = () => {};
  pools.renderOrder = 2;
  boardGroup.add(pools);

  heights = new Float32Array(N);
  targetHeights = new Float32Array(N);
  jitter = new Float32Array(N);
  const rnd = rand32(1337);
  for (let i = 0; i < N; i++) jitter[i] = (rnd() - 0.5) * 0.12;

  // Coordinate labels (A.. across, 1.. down) on all four sides.
  for (let x = 0; x < cols; x++) {
    for (const zEdge of [-1, rows]) {
      const l = makeLabel(colLabel(x));
      l.position.copy(cellToWorld(x, zEdge)).setY(0.02);
      labelGroup.add(l);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (const xEdge of [-1, cols]) {
      const l = makeLabel(String(y + 1));
      l.position.copy(cellToWorld(xEdge, y)).setY(0.02);
      labelGroup.add(l);
    }
  }

  // Moon shadows: at most the board plus the nearest ring of trees, and
  // usually just the part around the view (see fitShadows in scene.js).
  resetShadowWindow(board.radius + 14);

  buildSurroundings();
  buildRain();
  refreshAll(true);
  tiles.computeBoundingBox();
}

// Water mask, river flow, bridge decks and railings depend on neighbours, so
// they are refreshed for the whole board after any change (cheap: <= 3600 cells).
export function refreshWaterAndBridges() {
  updateOverrides(grid);
  water.update(grid, grid.riverFlow());
  water.mesh.visible = ui.view === 'all' || ui.view === 'area';
  water.setFlat(ui.view === 'area');

  const showDecks = ui.view !== 'light';
  let r = 0;
  const railAt = (pos, rotY) => {
    tmpMatrix.compose(pos, tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY), tmpScale.set(1, 1, 1));
    rails.setMatrixAt(r++, tmpMatrix);
  };
  const openWater = (x, y) => grid.isWater(x, y) && !grid.cells[grid.index(x, y)].bridge;
  for (let i = 0; i < N; i++) {
    const c = grid.cells[i];
    const { x, y } = grid.coords(i);
    const on = showDecks && c.bridge;
    deckVisible[i] = on ? 1 : 0;
    if (on) {
      tmpPos.copy(cellToWorld(x, y)).setY(DECK_TOP);
      tmpMatrix.compose(tmpPos, tmpQuat.identity(), tmpScale.set(1, 1, 1));
      decks.setMatrixAt(i, tmpMatrix);
      const look = deckLook(c, i);
      decks.setColorAt(i, tmpColor.set(look.color));
      deckGlow.array[i] = look.glow;
      if (ui.view === 'all') {
        const p = cellToWorld(x, y).setY(DECK_TOP);
        const e = 0.5 * TILE - 0.15; // just inside the truss
        if (openWater(x, y - 1)) railAt(p.clone().add(tmpScale.set(0, 0, -e)), 0);
        if (openWater(x, y + 1)) railAt(p.clone().add(tmpScale.set(0, 0, e)), 0);
        if (openWater(x - 1, y)) railAt(p.clone().add(tmpScale.set(-e, 0, 0)), Math.PI / 2);
        if (openWater(x + 1, y)) railAt(p.clone().add(tmpScale.set(e, 0, 0)), Math.PI / 2);
      }
    } else {
      // Parked far below and tiny rather than zero-scaled, so raycasts stay sane.
      tmpMatrix.compose(tmpPos.set(0, -1000, 0), tmpQuat.identity(), tmpScale.set(1e-4, 1e-4, 1e-4));
      decks.setMatrixAt(i, tmpMatrix);
      decks.setColorAt(i, tmpColor.set(0x000000));
    }
  }
  rails.count = r;
  rails.instanceMatrix.needsUpdate = true;
  decks.instanceMatrix.needsUpdate = true;
  decks.instanceColor.needsUpdate = true;
  deckGlow.needsUpdate = true;
  decks.computeBoundingSphere();
  bridges.update(grid, { visible: ui.view === 'all', deckTop: DECK_TOP, bedY: BED_H });
  streets.update(grid, { visible: ui.view === 'all', cellToWorld, surfaceY: SUB_LOOK.street.h + STREET_LIFT, lightLevels, lampsOn });
  refreshPropsAndWalls();
  refreshMarkers();
  for (const mat of bridges.materials) terrainify(mat, { bridge: true });
  scene.traverse((o) => { for (const mat of [].concat(o.material ?? [])) terrainify(mat); });
}
// Markers the play demo has collected or used (set once the demo exists).
export let markerUsed = () => false;
export let markerHidden = () => false; // objectives stay hidden in play until midnight
export function refreshMarkers() {
  const list = [];
  grid.cells.forEach((c, i) => {
    if (!c.marker || markerHidden(i)) return;
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    list.push({ type: c.marker, x: p.x, y: Math.max(visibleTop(i), WATER_Y) + terrainHeight(p.x, p.z, { bridge: c.bridge }), z: p.z, dim: !c.walkable, faded: markerUsed(i) });
  });
  markers.update(list);
  markers.setVisible(ui.showMarkers);
  refreshKeyHighlight();
}
export function refreshKeyHighlight() {
  let n = 0;
  if (hoverIndex >= 0 && hoverIndex < N && grid.cells[hoverIndex].marker === 'key' && ui.showMarkers) {
    const h = (ui.lowWalls ? WALL_LOW : WALL_FULL) + 0.05;
    for (const k of grid.keyDoors(hoverIndex).slice(0, 256)) {
      const { o, x, y } = parseEdgeKey(k);
      const vertical = o === 'v';
      const cx = vertical ? x - grid.cols / 2 : x - grid.cols / 2 + 0.5;
      const cz = vertical ? y - grid.rows / 2 + 0.5 : y - grid.rows / 2;
      tmpMatrix.compose(tmpPos.set(cx, FLOOR_H + edgeBase(o, x, y).base, cz), tmpQuat.identity(),
        vertical ? tmpScale.set(0.2, h, 0.6) : tmpScale.set(0.6, h, 0.2));
      keyHighlight.setMatrixAt(n++, tmpMatrix);
    }
  }
  keyHighlight.count = n;
  keyHighlight.instanceMatrix.needsUpdate = true;
}

// Streets are lifted STREET_LIFT above their tile (street.js); visibleTop
// includes it, so pawns, decals and markers sit on the asphalt.
const onStreet = (c) => ui.view === 'all' && (c.sub === 'street' || c.sub === 'start');

// Props on cells (main view only) and walls/doors on edges (every view).
export function refreshPropsAndWalls() {
  clocktowers.update({
    visible: ui.view === 'all',
    anchors: grid.clocktowers().map((i) => {
      const { x, y } = grid.coords(i);
      const p = cellToWorld(x, y);
      return { x: p.x + TILE / 2, y: targetHeights[i], z: p.z + TILE / 2 };
    }),
  });
  landmarks.update(grid, {
    visible: ui.view === 'all',
    cellToWorld,
    baseY: (i) => targetHeights[i],
    deckY: WATER_Y,
  });
  props.update(grid, {
    visible: ui.view === 'all',
    cellToWorld,
    // Props stand on whatever the cell's surface is: deck, water or floor.
    baseY: (i) => {
      const c = grid.cells[i];
      if (c.bridge) return DECK_TOP;
      if (c.area === 'water') return WATER_Y;
      return targetHeights[i] + (onStreet(c) ? STREET_LIFT : 0);   // the van and anything else on the asphalt
    },
  });

  // Walls and doors.
  const H = ui.lowWalls ? WALL_LOW : WALL_FULL;
  let nw = 0, nd = 0;
  // Each edge takes the style of the building it belongs to (the indoor cell
  // on either side); edges with no building beside them use their own hash.
  const seeds = buildingSeeds();
  // A typed building (src/core/buildings.js) always wears its type's finishes.
  const types = buildingTypes(grid);
  const outside = (s) => {
    const t = BUILDING_TYPES[types.get(s)];
    const st = buildingStyle(s);
    const f = t && BUILDING_STYLES.find((b) => b.name === t.exterior);
    return f ? { ...st, colour: f.colour, tex: f.tex } : st;
  };
  const inside = (s) => {
    const t = BUILDING_TYPES[types.get(s)];
    return (t && INTERIOR_STYLES.find((b) => b.name === t.interior)) || interiorStyle(s);
  };
  const wa = walls.geometry.attributes;
  // The two faces of the current edge, and its building's style (windows).
  let style = BUILDING_STYLES[0];
  let faceNeg = style, facePos = style;
  const seedOf = (c) => (grid.inBounds(c.x, c.y) ? seeds[grid.index(c.x, c.y)] : -1);
  // A face looking into a building shows that building's interior; a face
  // looking outdoors shows the exterior of the building it belongs to.
  const edgeFaces = (o, x, y) => {
    const [ca, cb] = grid.edgeCells(o, x, y);
    const sa = seedOf(ca), sb = seedOf(cb);
    const own = sa >= 0 ? sa : sb >= 0 ? sb : 100000 + (o === 'v' ? 1 : 2) * 7919 + x * 131 + y;
    style = outside(own);
    faceNeg = sa >= 0 ? inside(sa) : sb >= 0 ? outside(sb) : style;
    facePos = sb >= 0 ? inside(sb) : sa >= 0 ? outside(sa) : style;
  };
  let EY = 0, DROP = 0; // current edge: floor level, and how far the ground falls below it
  const piece = (cx, cz, along, len, base, height, vertical) => {
    // `along` is the offset along the edge from its centre. Pieces standing
    // on the floor reach down to the lowest ground under the edge.
    const px = vertical ? cx : cx + along;
    const pz = vertical ? cz + along : cz;
    const extra = base <= FLOOR_H + 1e-6 ? DROP : 0;
    tmpMatrix.compose(
      tmpPos.set(px, base + EY - extra, pz),
      tmpQuat.identity(),
      vertical ? tmpScale.set(WALL_T, height + extra, len) : tmpScale.set(len, height + extra, WALL_T),
    );
    walls.setMatrixAt(nw, tmpMatrix);
    tmpColor.set(faceNeg.colour).toArray(wa.aNegColor.array, nw * 3);
    tmpColor.set(facePos.colour).toArray(wa.aPosColor.array, nw * 3);
    wa.aWallTex.array[nw] = faceNeg.tex;
    wa.aPosTex.array[nw++] = facePos.tex;
  };
  let nf = 0, ngd = 0, ngl = 0;
  // A box along the edge into any instanced mesh (`colour` for frames).
  const strip = (mesh, n, cx, cz, along, len, y0, y1, thick, vertical, colour) => {
    const px = vertical ? cx : cx + along;
    const pz = vertical ? cz + along : cz;
    tmpMatrix.compose(
      tmpPos.set(px, y0 + EY, pz), tmpQuat.identity(),
      vertical ? tmpScale.set(thick, y1 - y0, len) : tmpScale.set(len, y1 - y0, thick),
    );
    mesh.setMatrixAt(n, tmpMatrix);
    if (colour) mesh.setColorAt(n, tmpColor.set(colour));
  };
  // Boards nailed across an opening, as a box in the wall plane rotated by
  // `tilt` (radians, about the wall's normal).
  const board = (cx, cz, along, yMid, len, h, thick, vertical, tilt, colour) => {
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, vertical ? Math.PI / 2 : 0)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
    tmpMatrix.compose(
      tmpPos.set(vertical ? cx : cx + along, yMid + EY - h / 2 * 0, vertical ? cz + along : cz),
      q, tmpScale.set(len, h, thick),
    );
    // unitBoxGeo has its base at y = 0: shift so the board is centred.
    tmpMatrix.multiply(new THREE.Matrix4().makeTranslation(0, -0.5, 0));
    frames.setMatrixAt(nf, tmpMatrix);
    frames.setColorAt(nf++, tmpColor.set(colour));
  };
  const PLY = '#a08660', PLANK = '#6e5638';
  // A door a monster has been bashing (`frac` 0..1 of its health gone): pale
  // splintered gashes across it, more the worse it is, and splinters on the floor either
  // side. Placed from the edge key so they don't jump between redraws.
  const damage = (k, cx, cz, vertical, open, y0, y1, frac) => {
    let seed = [...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const room = frames.instanceMatrix.count - nf;
    const cracks = Math.min(room, Math.ceil(frac * 3));
    for (let c = 0; c < cracks; c++) {
      // Short enough, and near enough the middle, to stay on the door.
      const along = (rnd() - 0.5) * open * 0.3;
      const mid = FLOOR_H + y0 + (y1 - y0) * (0.3 + rnd() * 0.45);
      board(cx, cz, along, mid, open * (0.3 + rnd() * 0.2), m(0.045), WALL_T * 1.6, vertical, (rnd() - 0.5) * 2, '#c9a476'); // raw, pale wood where it split
    }
    const chips = Math.min(frames.instanceMatrix.count - nf, Math.ceil(frac * 6));
    for (let c = 0; c < chips; c++) {
      const side = c % 2 ? 1 : -1, out = m(0.25) + rnd() * m(0.5), along = (rnd() - 0.5) * open * 0.9;
      tmpMatrix.compose(
        tmpPos.set(cx + (vertical ? side * out : along), FLOOR_H + EY + 0.004, cz + (vertical ? along : side * out)),
        tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * Math.PI),
        tmpScale.set(m(0.12 + rnd() * 0.25), m(0.03), m(0.05 + rnd() * 0.05)),
      );
      frames.setMatrixAt(nf, tmpMatrix);
      frames.setColorAt(nf++, tmpColor.set(rnd() < 0.5 ? '#7a5a3a' : '#5e4630'));
    }
  };
  const bashed = ui.tool === 'play' && typeof play !== 'undefined' ? play.doorDamage() : new Map();
  // In the play demo, doors whose key has been collected are drawn unlocked.
  const unlockedNow = ui.tool === 'play' && typeof play !== 'undefined' ? play.unlockedEdges() : new Set();
  // ...and doors the game nailed, chained or breached (src/game/doors.js).
  const doorLooks = ui.tool === 'play' && typeof play !== 'undefined' ? play.doorLooks() : new Map();
  for (const [k, type1] of grid.allEdges()) {
    const look = anyDoor(type1) ? doorLooks.get(k) : null;
    // Blocked: boarded over with planks, like a condemned door.
    const type0 = look === 'blocked' ? 'boardedDoor' : look === 'breached' ? 'breachedDoor' : type1;
    const unlockedDoor = unlockedNow.has(k) && (type0 === 'lockedDoor' || type0.startsWith('oneWayDoor'));
    const type = unlockedDoor ? 'door' : type0;
    const { o, x, y } = parseEdgeKey(k);
    const vertical = o === 'v';
    const cx = vertical ? x - grid.cols / 2 : x - grid.cols / 2 + 0.5;
    const cz = vertical ? y - grid.rows / 2 + 0.5 : y - grid.rows / 2;
    ({ base: EY, drop: DROP } = edgeBase(o, x, y));
    edgeFaces(o, x, y);
    if (type === 'wall') {
      piece(cx, cz, 0, TILE + WALL_T, FLOOR_H, H, vertical);
      continue;
    }
    if (type === 'window') {
      // Storefront: masonry piers at the ends, a painted wooden bulkhead
      // under a big glass pane, mullions/transom by variant, a header above.
      // One window design and frame colour per building.
      const variant = style.windowVariant;
      const colour = style.frame;
      const pier = m(0.35);
      const sill = ui.lowWalls ? m(0.3) : m(0.6);
      const head = m(2.8);
      const top = Math.min(head, H);
      const inner = TILE - 2 * pier;
      piece(cx, cz, -(TILE / 2 - pier / 2), pier + WALL_T, FLOOR_H, H, vertical);
      piece(cx, cz, TILE / 2 - pier / 2, pier + WALL_T, FLOOR_H, H, vertical);
      if (H > head) piece(cx, cz, 0, inner, FLOOR_H + head, H, vertical);
      strip(frames, nf++, cx, cz, 0, inner, FLOOR_H, FLOOR_H + sill, WALL_T, vertical, colour); // bulkhead
      // Glass: lit if light reaches either side of the window.
      const [ca, cb] = grid.edgeCells(o, x, y);
      const lvl = (c) => (grid.inBounds(c.x, c.y) ? lightLevels[grid.index(c.x, c.y)] : 0);
      const lit = Math.max(lvl(ca), lvl(cb)) > 0.2;
      strip(lit ? glassLit : glassDark, lit ? ngl++ : ngd++, cx, cz, 0, inner, FLOOR_H + sill, FLOOR_H + top, WALL_T * 0.35, vertical);
      // Frame: sill and head rails, mullions, transom.
      const rail = m(0.12), bar = m(0.1);
      strip(frames, nf++, cx, cz, 0, inner, FLOOR_H + sill, FLOOR_H + sill + rail, WALL_T * 0.9, vertical, colour);
      if (H > head) strip(frames, nf++, cx, cz, 0, inner, FLOOR_H + head - rail, FLOOR_H + head, WALL_T * 0.9, vertical, colour);
      const transom = m(2.15);
      const panes = [2, 3, 1, 4][variant];
      const hasTransom = variant === 0 || variant === 2;
      const mullionTop = hasTransom ? Math.min(transom, top) : top;
      for (let i = 1; i < panes; i++) {
        strip(frames, nf++, cx, cz, -inner / 2 + (inner * i) / panes, bar, FLOOR_H + sill, FLOOR_H + mullionTop, WALL_T * 0.8, vertical, colour);
      }
      if (hasTransom && top > transom) {
        strip(frames, nf++, cx, cz, 0, inner, FLOOR_H + transom, FLOOR_H + transom + bar, WALL_T * 0.8, vertical, colour);
        // Small transom lights above a single big pane.
        if (variant === 2) {
          for (let i = 1; i < 3; i++) strip(frames, nf++, cx, cz, -inner / 2 + (inner * i) / 3, bar, FLOOR_H + transom, FLOOR_H + top, WALL_T * 0.8, vertical, colour);
        }
      }
      continue;
    }
    if (type === 'boardedWindow' || type === 'boardedDoor') {
      // Condemned: the opening is sheeted with weathered plywood and nailed
      // across with planks.
      const door = type === 'boardedDoor';
      const open = door ? DOOR_W : TILE - 2 * m(0.35);
      const side = (TILE - open) / 2;
      const y0 = door ? 0 : (ui.lowWalls ? m(0.3) : m(0.6));
      const y1 = Math.min(door ? DOOR_H : m(2.8), H);
      piece(cx, cz, -(open / 2 + side / 2), side + WALL_T, FLOOR_H, H, vertical);
      piece(cx, cz, open / 2 + side / 2, side + WALL_T, FLOOR_H, H, vertical);
      if (y0 > 0) piece(cx, cz, 0, open, FLOOR_H, y0, vertical);
      if (H > y1) piece(cx, cz, 0, open, FLOOR_H + y1, H - y1, vertical);
      strip(frames, nf++, cx, cz, 0, open, FLOOR_H + y0, FLOOR_H + y1, WALL_T * 0.9, vertical, PLY);
      const hgt = y1 - y0, mid = FLOOR_H + (y0 + y1) / 2;
      const diag = Math.hypot(open, hgt) * 0.86;
      const ang = Math.atan2(hgt, open);
      board(cx, cz, 0, mid, diag, m(0.16), WALL_T * 1.25, vertical, ang, PLANK);
      board(cx, cz, 0, mid, diag, m(0.16), WALL_T * 1.25, vertical, -ang, PLANK);
      board(cx, cz, 0, FLOOR_H + y0 + hgt * 0.78, open * 0.96, m(0.16), WALL_T * 1.3, vertical, 0.04, PLANK);
      if (door && bashed.has(k)) damage(k, cx, cz, vertical, open, y0, y1, bashed.get(k));
      continue;
    }
    // Door: wall either side of a centred opening.
    const side = (TILE - DOOR_W) / 2;
    piece(cx, cz, -(DOOR_W / 2 + side / 2), side + WALL_T, FLOOR_H, H, vertical);
    piece(cx, cz, DOOR_W / 2 + side / 2, side + WALL_T, FLOOR_H, H, vertical);
    if (H > DOOR_H) piece(cx, cz, 0, DOOR_W, FLOOR_H + DOOR_H, H - DOOR_H, vertical);
    if (type === 'breachedDoor') {
      // Breached: an empty doorway, the smashed leaf flat on the floor inside
      // and a splintered stub left on the hinge side.
      const leafH = Math.min(DOOR_H, H) * 0.98;
      // Tipped over (the box stands on its base: a quarter turn about x lays
      // it along +z), then turned to fall into the east/south cell, a bit askew.
      const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      // It falls inward: into the building (the east/south cell if that's
      // the indoor one, else the west/north one).
      const far = grid.inBounds(x, y) ? grid.cells[grid.index(x, y)] : null;
      const sign = far?.area === 'indoor' ? 1 : -1;
      const yaw = (vertical ? Math.PI / 2 : 0) + (sign < 0 ? Math.PI : 0) + 0.22;
      tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).multiply(flat);
      tmpMatrix.compose(
        tmpPos.set(cx + (vertical ? 0.08 * sign : 0), FLOOR_H + EY + 0.028, cz + (vertical ? 0 : 0.08 * sign)),
        tmpQuat,
        tmpScale.set(DOOR_W * 0.92, leafH, 0.05),
      );
      doorLeaves.setMatrixAt(nd++, tmpMatrix);
      const along = -DOOR_W / 2 + 0.03;
      tmpMatrix.compose(
        tmpPos.set(cx + (vertical ? 0 : along), FLOOR_H + EY + leafH * 0.3, cz + (vertical ? along : 0)),
        tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, vertical ? Math.PI / 2 : 0),
        tmpScale.set(0.07, leafH * 0.6, 0.06),
      );
      frames.setMatrixAt(nf, tmpMatrix);
      frames.setColorAt(nf++, tmpColor.set('#5a4030'));
      continue;
    }
    // Leaf hinged on one jamb. Unlocked doors stand open (~70 degrees);
    // locked doors are shut; one-way doors stand ajar toward the side they
    // open to. Positive swing opens into the east/south cell.
    const oneWay = type.startsWith('oneWayDoor');
    const sign = type.endsWith('-') ? -1 : 1;
    // An unlocked door is thrown wide open (further than a plain door).
    // A one-way door a monster is bashing (from its closed side) is drawn shut.
    const underAttack = bashed.has(k) && (type === 'lockedDoor' || oneWay);
    const swing = unlockedDoor ? 1.45 : type === 'door' ? 1.2 : oneWay && !underAttack ? 0.5 * sign : 0;
    const leafH = Math.min(DOOR_H, H) * 0.98;
    const hingeAlong = -DOOR_W / 2;
    const hx = vertical ? cx : cx + hingeAlong;
    const hz = vertical ? cz + hingeAlong : cz;
    const angle = vertical ? -Math.PI / 2 + swing : -swing;
    const dir = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    tmpMatrix.compose(
      tmpPos.set(hx + dir.x * DOOR_W / 2, FLOOR_H + EY, hz + dir.z * DOOR_W / 2),
      tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle),
      tmpScale.set(DOOR_W, leafH, 0.05),
    );
    if (unlockedDoor) {
      // Unlocked: the leaf is drawn in pale green (frames mesh takes a colour).
      frames.setMatrixAt(nf, tmpMatrix);
      frames.setColorAt(nf++, tmpColor.set('#7fcf8f'));
    } else {
      doorLeaves.setMatrixAt(nd++, tmpMatrix);
    }
    // Rotated marker box into the frames mesh (instance colour).
    const mark = (px, py, pz, sx, sy, sz, rot, colour) => {
      tmpMatrix.compose(tmpPos.set(px, py + EY, pz), tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot), tmpScale.set(sx, sy, sz));
      frames.setMatrixAt(nf, tmpMatrix);
      frames.setColorAt(nf++, tmpColor.set(colour));
    };
    const edgeRot = vertical ? Math.PI / 2 : 0; // a box's x axis along the edge
    if (unlockedDoor) {
      // Bright green threshold and an open padlock hanging on the jamb.
      mark(cx, FLOOR_H, cz, DOOR_W, 0.018, 0.32, edgeRot, '#3fd06a');
      const jx = vertical ? cx : cx + DOOR_W / 2, jz = vertical ? cz + DOOR_W / 2 : cz;
      mark(jx, FLOOR_H + leafH * 0.45, jz, m(0.16), m(0.14), m(0.07), edgeRot, '#c9a23a');
      mark(jx, FLOOR_H + leafH * 0.45 + m(0.14), jz + (vertical ? 0 : 0), m(0.04), m(0.12), m(0.04), edgeRot, '#c9a23a');
    } else if (type === 'lockedDoor') {
      // Red lock plate through the leaf (shows on both faces), a brass lock,
      // and a red threshold.
      mark(cx, FLOOR_H + leafH * 0.4, cz, DOOR_W * 0.55, Math.max(leafH * 0.18, 0.01), 0.054, edgeRot, '#b8322a');
      mark(cx + (vertical ? 0 : DOOR_W * 0.32), FLOOR_H + leafH * 0.48, cz + (vertical ? DOOR_W * 0.32 : 0),
        m(0.18), Math.max(leafH * 0.12, 0.008), 0.054, edgeRot, '#c9a23a');
      mark(cx, FLOOR_H, cz, DOOR_W, 0.016, 0.3, edgeRot, '#9a2a22');
    } else if (oneWay) {
      // Green arrow on the floor through the doorway, pointing the way you
      // can go.
      const nx = vertical ? sign : 0, nz = vertical ? 0 : sign;
      const phi = Math.atan2(-nz, nx);
      const len = 0.38;
      mark(cx, FLOOR_H, cz, len, 0.014, 0.05, phi, '#5fcf6a');
      const tipX = cx + nx * len / 2, tipZ = cz + nz * len / 2;
      for (const off of [0.75 * Math.PI, -0.75 * Math.PI]) {
        const a2 = phi + off;
        const arm = 0.14;
        mark(tipX + Math.cos(a2) * arm / 2, FLOOR_H, tipZ - Math.sin(a2) * arm / 2, arm, 0.014, 0.05, a2, '#5fcf6a');
      }
    }
    // Only a shut door shows it (an open or ajar one is never bashed).
    if (underAttack) damage(k, cx, cz, vertical, DOOR_W, 0, Math.min(DOOR_H, H), bashed.get(k));
    if (!unlockedDoor && type !== 'lockedDoor' && !oneWay) {
      // Threshold plate across the opening so doors read from any angle.
      tmpMatrix.compose(
        tmpPos.set(cx, FLOOR_H + EY, cz),
        tmpQuat.identity(),
        vertical ? tmpScale.set(0.3, 0.015, DOOR_W) : tmpScale.set(DOOR_W, 0.015, 0.3),
      );
      doorLeaves.setMatrixAt(nd++, tmpMatrix);
    }
  }
  // Levelled buildings on slopes: stone foundation where the ground outside
  // is lower, retaining wall where it is higher (the building is dug in).
  let nfd = 0;
  if (!isFlat()) {
    for (let i = 0; i < N; i++) {
      const kind = (c) => (c.area === 'indoor' ? 'indoor' : c.area === 'outdoor' && isLandmark(c.sub) ? `tower:${c.sub}` : null);
      const k0 = kind(grid.cells[i]);
      if (!k0) continue;
      const { x, y } = grid.coords(i);
      const level = cellLevel(x, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (grid.inBounds(nx, ny) && kind(grid.cells[grid.index(nx, ny)]) === k0) continue;
        const out = cellLevel(nx, ny);
        const diff = out - level;
        if (Math.abs(diff) < 0.004) continue;
        const vertical = dx !== 0;
        const c = cellToWorld(x, y);
        const ex = c.x + dx * 0.5, ez = c.z + dy * 0.5;
        const y0 = level + Math.min(diff, 0) - 0.03, y1 = level + Math.max(diff, 0) + FLOOR_H;
        tmpMatrix.compose(tmpPos.set(ex, y0, ez), tmpQuat.identity(),
          // A little thicker than walls, so where both meet the stone wraps the
          // wall's base instead of flickering in the same plane.
          vertical ? tmpScale.set(WALL_T * 1.5, y1 - y0, TILE + WALL_T * 1.5) : tmpScale.set(TILE + WALL_T * 1.5, y1 - y0, WALL_T * 1.5));
        foundations.setMatrixAt(nfd++, tmpMatrix);
      }
    }
  }
  foundations.count = nfd;
  foundations.instanceMatrix.needsUpdate = true;
  foundations.computeBoundingSphere();
  walls.count = nw;
  for (const k of ['aWallTex', 'aPosTex', 'aNegColor', 'aPosColor']) wa[k].needsUpdate = true;
  doorLeaves.count = nd;
  frames.count = nf;
  glassDark.count = ngd;
  glassLit.count = ngl;
  for (const mesh of [walls, doorLeaves, frames, glassDark, glassLit]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  // Typed buildings: a sign (and a shop's awning) over the front door.
  const signs = [];
  const byBuilding = new Map();
  seeds.forEach((b, i) => { if (b >= 0 && types.has(b)) (byBuilding.get(b) ?? byBuilding.set(b, []).get(b)).push(i); });
  for (const [b, cells] of byBuilding) {
    const door = frontDoor(grid, cells);
    if (!door) continue;
    const { o, x, y } = parseEdgeKey(door.edge);
    const cx = o === 'v' ? x - grid.cols / 2 : x - grid.cols / 2 + 0.5;
    const cz = o === 'v' ? y - grid.rows / 2 + 0.5 : y - grid.rows / 2;
    signs.push({ type: types.get(b), cx, cz, y: edgeBase(o, x, y).base + FLOOR_H, out: door.out, off: WALL_T / 2 + 0.006 });
  }
  dress.update(signs, { visible: ui.view === 'all' && !ui.lowWalls });
}

export function deckLook(c, i) {
  if (ui.view === 'area') return { color: PALETTE.areaDeck, glow: 0.15 };
  if (ui.view === 'walk') return { color: c.walkable ? PALETTE.walkOk : PALETTE.walkNo, glow: 0.2 };
  const lvl = lightLevels[i] ?? 0;
  return { color: mixHex(PALETTE.deck.unlit, PALETTE.deck.lit, lvl), glow: 0.18 * lvl };
}

// Top of what you see in a cell: deck, water surface, or tile.
export function visibleTop(i) {
  const c = grid.cells[i];
  if (deckVisible[i]) return DECK_TOP;
  if (c.area === 'water' && water.mesh.visible) return WATER_Y;
  return heights[i] + (onStreet(c) ? STREET_LIFT : 0);   // the asphalt, not the tile under it
}

// Triangles the board draws with everything in view (instances counted, the
// forest ring and figures left out): what Ready to play? holds against the
// map budget.
export function boardTriangles() {
  let tris = 0;
  boardGroup.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    for (let p = o.parent; p; p = p.parent) if (!p.visible) return;
    const g = o.geometry;
    const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += per * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(tris);
}
