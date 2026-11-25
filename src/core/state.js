// Grid data model: cell attributes, strokes with undo/redo, and (de)serialization.

import { SITES } from './sites.js';
export const COLS = 20;
export const ROWS = 26;
export const FORMAT_VERSION = 3;
export const MIN_SIZE = 4;
// The editor makes boards up to MAX_SIZE a side: bigger maps cost too much on
// phones (docs/ASSET_BUDGET.md). Maps saved before the limit (up to 60) still
// open, so no one loses work; Ready to play? flags them.
export const MAX_SIZE = 35;
export const MAX_LOAD_SIZE = 60;
const clampSize = (n, fallback, max = MAX_SIZE) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(MIN_SIZE, v)) : fallback;
};

// Ready-made landmarks: blocked, fully dressed tiles. `footprint` [w, h]
// (columns x rows) paints a whole block at once; 'fill' dresses whatever
// area you paint, cell by cell (motel rows, trailer parks, junkyards...).
// `cat` is the tile menu category; `ground` the surface colour under them.
const L = (label, cat, footprint, ground) => ({ label, walkable: false, cat, footprint, ground, landmark: true });
export const LANDMARK_SUBS = {
  // 90s town
  videoStore: L('Video rental store', 'town', [2, 2], '#2c2f33'),
  diner: L('Shuttered diner', 'town', [2, 3], '#2c2f33'),
  gasStation: L('Gas station', 'town', [2, 3], '#2a2c2f'),
  laundromat: L('Laundromat', 'town', [1, 2], '#2c2f33'),
  arcade: L('Arcade', 'town', [2, 2], '#2c2f33'),
  motel: L('Motel strip', 'town', 'fill', '#2e3134'),
  payphone: L('Payphone & news boxes', 'town', [1, 1], '#3a3d40'),
  // Pacific Northwest
  lumberMill: L('Lumber mill', 'pnw', [3, 4], '#3a3126'),
  logDeck: L('Log deck', 'pnw', 'fill', '#3e3428'),
  lookout: L('Fire lookout tower', 'pnw', [1, 1], '#2f3a2e'),
  grange: L('Grange hall', 'pnw', [2, 3], '#33402f'),
  cairn: L('Driftwood & cairns', 'pnw', [1, 1], '#3a3d36'),
  clearCut: L('Clear-cut', 'pnw', 'fill', '#4a3c2c'),
  cedarGrove: L('Cedar grove & nurse log', 'pnw', [2, 2], '#1e2a20'),
  // Unsettling
  rectory: L('Abandoned rectory', 'unsettling', [2, 2], '#2e2f2a'),
  burnedHouse: L('Burned house', 'unsettling', [2, 2], '#26231f'),
  schoolBus: L('Overturned school bus', 'unsettling', [1, 3], '#33362f'),
  wreckedCar: L('Wrecked car in a ditch', 'unsettling', [1, 1], '#2e3329'),
  playground: L('Empty playground', 'unsettling', [2, 2], '#4a3f30'),
  radioTower: L('Radio tower', 'unsettling', [1, 1], '#2f3530'),
  quarantine: L('Quarantine fence', 'unsettling', 'fill', '#3a3a34'),
  memorial: L('Missing-person memorial', 'unsettling', [1, 1], '#3a3d40'),
  // Rural
  farm: L('Farmhouse & barn', 'rural', [3, 3], '#3a3a26'),
  trailerPark: L('Trailer park', 'rural', 'fill', '#3d3a2e'),
  waterTower: L('Water tower', 'rural', [2, 2], '#353a33'),
  junkyard: L('Junkyard', 'rural', 'fill', '#3a342c'),
};

// Tile menu categories, in order. Every subcategory names its `cat`.
export const TILE_CATEGORIES = [
  { id: 'roads', label: 'Ground & roads' },
  { id: 'nature', label: 'Nature' },
  { id: 'cemetery', label: 'Cemetery' },
  { id: 'water', label: 'Water' },
  { id: 'interiors', label: 'Buildings & interiors' },
  { id: 'town', label: '90s town' },
  { id: 'pnw', label: 'Pacific Northwest' },
  { id: 'unsettling', label: 'Unsettling' },
  { id: 'rural', label: 'Rural' },
];

// Space categories and their subcategories. Add a subcategory here and it is
// accepted everywhere: painting, saving, importing. The first subcategory is
// the category's default. `walkable: false` marks subcategories that start
// out blocked when painted (the Walkable brush can still override a cell).
export const AREAS = {
  outdoor: {
    label: 'Outdoor',
    subs: {
      ground: { label: 'Ground', cat: 'roads' },
      // Two-lane street with sidewalks; lines and curbs follow its neighbours.
      street: { label: 'Street', cat: 'roads' },
      // Where every player starts: a street cell with the players' van.
      // Two-cell start: the van sits on this cell facing along the road; the
      // players start on the cell in front of it, in the headlights.
      start: { label: 'Start space', walkable: false, cat: 'roads' },
      // Old Clocktower: a 2x2 landmark whose dials show the game time. The
      // brush paints a 2x2 block; each complete 2x2 of these cells is a tower.
      clocktower: { label: 'Old Clocktower', walkable: false, cat: 'town', footprint: [2, 2] },
      path: { label: 'Path', cat: 'roads' },
      cemetery: { label: 'Cemetery', cat: 'cemetery' },
      cemeteryPath: { label: 'Cemetery path', cat: 'cemetery' },
      forestCemetery: { label: 'Forest cemetery', walkable: false, cat: 'cemetery' },
      forest: { label: 'Forest', walkable: false, cat: 'nature' },
      brambles: { label: 'Brambles', walkable: false, cat: 'nature' },
      ...LANDMARK_SUBS,
    },
  },
  indoor: {
    label: 'Indoor',
    subs: {
      hardwood: { label: 'Hardwood', cat: 'interiors' },
      carpet: { label: 'Carpet', cat: 'interiors' },
      // Church: walkable cells hold a pew facing the pulpit; a blocked church
      // cell is the pulpit (a raised dais with lectern, altar and cross).
      church: { label: 'Church floor', cat: 'interiors' },
      // Condemned building: walls go up automatically round the outside of
      // the shape, with boarded-up doors and windows on the street side.
      // Hospital: pale linoleum; a blocked cell is a ward bay (beds, screen).
      hospital: { label: 'Hospital floor', cat: 'interiors' },
      condemned: { label: 'Condemned', walkable: false, cat: 'interiors' },
    },
  },
  water: {
    label: 'Water',
    walkable: false,
    subs: {
      lake: { label: 'Lake', cat: 'water' },
      river: { label: 'River', cat: 'water' },
      // Fishing dock & boathouse: pilings, planks, crab pots and nets over the
      // water (paint any area).
      dock: { label: 'Fishing dock & boathouse', cat: 'water', footprint: 'fill', landmark: true },
    },
  },
};
// Subcategories painted as whole blocks or dressed areas (landmarks and the clocktower).
export const isLandmark = (sub) => !!(LANDMARK_SUBS[sub] || sub === 'clocktower' || sub === 'dock');
export const footprintOf = (area, sub) => AREAS[area]?.subs[sub]?.footprint ?? null;
// Premade buildings: a fixed footprint (the clocktower, a 3x4 mill...).
const fixedFootprint = (sub) => (sub === 'clocktower' ? [2, 2] : Array.isArray(LANDMARK_SUBS[sub]?.footprint) ? LANDMARK_SUBS[sub].footprint : null);
export const hasFixedFootprint = (sub) => !!fixedFootprint(sub);
// Cells a premade building covers when it faces `face` (0..3 = N E S W):
// its long side is the front, so facing north or south it lies along x.
// `face` null keeps the footprint as listed (older boards, auto-facing).
export function landmarkDims(sub, face) {
  const fp = fixedFootprint(sub);
  if (!fp) return null;
  if (face === null || face === undefined) return [fp[0], fp[1]];
  const long = Math.max(...fp), short = Math.min(...fp);
  return face % 2 === 0 ? [long, short] : [short, long];
}

export const CELL_KEYS = ['area', 'sub', 'lit', 'radius', 'walkable', 'bridge', 'lamp', 'marker', 'site', 'facing', 'flip'];

// Directions as [dx, dy], indexed 0..3 = north, east, south, west.
export const FACINGS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const FACING_NAMES = ['north', 'east', 'south', 'west'];
// Van headlights: light on the van's own cell, the player start cell in
// front of it, and the cell beyond.
export const HEADLIGHTS = [0.35, 0.9, 0.5];

// Whether a freshly painted area/subcategory is walkable.
export const defaultWalkable = (area, sub) =>
  (AREAS[area]?.walkable ?? true) && (AREAS[area]?.subs[sub]?.walkable ?? true);

// bridge: a walkable deck over a water cell (only valid when area is water).
// lamp:   the cell's street lamp is switched on ("Lit lamp"). Only street
//         cells with a lamp post (junctions, and posts spaced along the
//         streets: streetLampCells) can have one; it lights the cell fully
//         and spills dimmer light onto its neighbours.
// lit:    the cell holds a light source of the given `radius` (in cells).
// marker: an optional gameplay marker on a walkable cell (see MARKERS). It
//         sits on top of the cell and never changes the cell itself.
export const defaultCell = () => ({
  area: 'outdoor', sub: 'ground', lit: false, radius: 0, walkable: true, bridge: false, lamp: false, marker: null,
  site: null,   // Objective marker: the site it stands for (src/core/sites.js), null = from its floor, or none
  facing: null, // start space / premade building: which way it faces (index into FACINGS); null = automatic
  flip: false,  // premade building: mirrored left to right
});

// Gameplay markers, placed on walkable cells.
export const MARKERS = {
  investigation: { label: 'Investigation', note: 'Can be investigated to look for clues' },
  objective: { label: 'Objective', note: 'Objectives appear here once the monster reveals itself' },
  whiteDice: { label: 'White Dice', note: 'Single-use white dice to collect' },
  blackDice: { label: 'Black Dice', note: 'Black dice to attune (renew every turn)' },
  key: { label: 'Key', note: 'Touching it unlocks every locked and one-way door in its building' },
  research: { label: 'Research', note: 'Single use: uncovers a piece of evidence without investigating' },
};

// --- light ---------------------------------------------------------------------
// A light source lights cells within its radius (cell-centre distance) that it
// can see: walls block light; windows and (open) doors let it through.
// Brightness falls off linearly from the centre to 1 / (radius + 1) of it at
// the edge, and the centre is brighter for bigger lights, so a radius under 1
// is a candle or dim bulb lighting only its own cell, and radius 3+ a floodlight.
export const MAX_RADIUS = 6;
// Distinct key groups the movement check tracks at once (2^n search states).
export const MAX_KEY_GROUPS = 8;
export const centreBrightness = (r) => Math.min(1, 0.45 + 0.2 * r);
export const lightAt = (r, d) => (d > r + 1e-6 ? 0 : centreBrightness(r) * (1 - d / (r + 1)));
// What a radius is like, for the panel.
export function lightKind(r) {
  if (r < 1) return 'Candle / dim bulb';
  if (r < 2) return 'Porch light / lamp';
  if (r < 3) return 'Bright room / shop light';
  if (r < 4) return 'Floodlight';
  return 'Stadium / searchlight';
}
// A switched-on street lamp is a source like any other.
export const LAMP_SOURCE = { radius: 1.5, brightness: 1 };

// Street layout: which sides continue the road (street or bridge
// neighbours), as a N=1, E=2, S=4, W=8 bitmask. Off the board, a side counts
// as open when the road runs straight through from the opposite side.
export function streetMask(grid, x, y) {
  const N = 1, E = 2, S = 4, W = 8;
  const conn = (nx, ny) => {
    if (!grid.inBounds(nx, ny)) return null; // decided below
    const c = grid.cells[grid.index(nx, ny)];
    return c.sub === 'street' || c.sub === 'start' || c.bridge;
  };
  const sides = [[N, 0, -1, S], [E, 1, 0, W], [S, 0, 1, N], [W, -1, 0, E]];
  const open = {};
  for (const [bit, dx, dy] of sides) open[bit] = conn(x + dx, y + dy);
  let mask = 0;
  for (const [bit, , , opp] of sides) {
    if (open[bit] === true) mask |= bit;
    else if (open[bit] === null && open[opp] === true) mask |= bit;
  }
  return mask;
}

// Street lamps: one at every intersection (a street cell open on 3 or 4
// sides), and posts along the streets between them (streetLampCells).
const openSides = (mask) => { let n = 0; while (mask) { n += mask & 1; mask >>= 1; } return n; };
export function isJunction(grid, x, y) {
  return grid.inBounds(x, y) && grid.cells[grid.index(x, y)].sub === 'street' && openSides(streetMask(grid, x, y)) >= 3;
}
export function hasStreetLamp(grid, x, y) {
  if (!grid.inBounds(x, y)) return false;
  return grid.streetLamps ? grid.streetLamps().has(grid.index(x, y)) : isJunction(grid, x, y);
}

// Lamp posts along the streets. Each run of plain street cells between two
// ends (a junction, the van, a bridge or a dead end) gets posts spread evenly
// about every LAMP_SPACING cells, measured from the ends, so the gaps are
// even. A post never stands within one cell of another lamp (a junction's,
// or one on a parallel street): those are left out, so lamps never cluster.
export const LAMP_SPACING = 4;
export function streetLampCells(grid) {
  const out = new Set();
  const street = (i) => grid.cells[i]?.sub === 'street';
  const N = 1, E = 2, S = 4, W = 8;
  const step = { [N]: [0, -1], [E]: [1, 0], [S]: [0, 1], [W]: [-1, 0] };
  // Junctions first.
  grid.cells.forEach((c, i) => { const { x, y } = grid.coords(i); if (isJunction(grid, x, y)) out.add(i); });
  const near = (i) => {
    const { x, y } = grid.coords(i);
    for (const j of out) { const q = grid.coords(j); if (Math.max(Math.abs(q.x - x), Math.abs(q.y - y)) <= 1) return true; }
    return false;
  };
  // A run: plain street cells (open on 1 or 2 sides) joined along the road.
  const inRun = (i) => { const { x, y } = grid.coords(i); return street(i) && openSides(streetMask(grid, x, y)) <= 2; };
  const next = (i) => {
    const { x, y } = grid.coords(i);
    const mask = streetMask(grid, x, y);
    const out2 = [];
    for (const b of [N, E, S, W]) {
      if (!(mask & b)) continue;
      const [dx, dy] = step[b];
      if (grid.inBounds(x + dx, y + dy)) out2.push(grid.index(x + dx, y + dy));
    }
    return out2;
  };
  const seen = new Set();
  grid.cells.forEach((_, i) => {
    if (seen.has(i) || !inRun(i)) return;
    // Walk to one end of the run, then collect it in order.
    let a = i, prev = -1;
    for (let guard = 0; guard < grid.cells.length; guard++) {
      const on = next(a).filter((j) => j !== prev && inRun(j));
      if (!on.length || on[0] === i) break;
      prev = a; a = on[0];
    }
    const run = [];
    prev = -1;
    for (let c = a; c >= 0 && !seen.has(c);) {
      seen.add(c); run.push(c);
      const on = next(c).filter((j) => j !== prev && inRun(j) && !seen.has(j));
      prev = c; c = on.length ? on[0] : -1;
    }
    // Even posts between the ends (at -1 and run.length).
    const n = run.length;
    const k = Math.max(0, Math.round((n + 1) / LAMP_SPACING) - 1);
    for (let j = 1; j <= k; j++) {
      const at = run[Math.round((j * (n + 1)) / (k + 1)) - 1];
      if (at !== undefined && !near(at)) out.add(at);
    }
  });
  return out;
}

// Walls and doors live on the edges between cells, not in cells.
//  'v' edge (x, y): the vertical line on the west side of cell (x, y), x in 0..cols
//  'h' edge (x, y): the horizontal line on the north side of cell (x, y), y in 0..rows
// Edge pieces:
//   wall           blocks movement and light
//   door           unlocked: drawn open; passable, lets light through
//   lockedDoor     shut and locked: blocks movement and light
//   oneWayDoor+/-  shut, opens one way: passable only toward + (from the
//                  west/north cell to the east/south cell) or - (the other
//                  way); blocks light
//   window         storefront glass: blocks movement, lets light through
//   boardedDoor    boarded-up door / window (condemned buildings, placed
//   boardedWindow  automatically): block movement and light
export const EDGE_TYPES = ['wall', 'door', 'lockedDoor', 'oneWayDoor+', 'oneWayDoor-', 'window', 'boardedDoor', 'boardedWindow'];
export const isDoor = (t) => t === 'door' || t === 'lockedDoor' || t?.startsWith('oneWayDoor');
export const blocksLight = (t) => t === 'wall' || t === 'lockedDoor' || t === 'boardedDoor' || t === 'boardedWindow'
  || !!t?.startsWith('oneWayDoor');
// Which kind of piece a type is, for counts and export.
export const edgeKind = (t) => (t?.startsWith('oneWayDoor') ? 'oneWayDoor' : t);
export const edgeKey = (o, x, y) => `${o}${x},${y}`;
export function parseEdgeKey(k) {
  const [x, y] = k.slice(1).split(',').map(Number);
  return { o: k[0], x, y };
}

// Retired subcategories and what they became.
const SUB_ALIASES = { road: 'street', sidewalk: 'street' };

// Normalise any saved cell (format v1 used `indoor: bool`) into the current shape.
export function normalizeCell(c = {}) {
  let area = typeof c.area === 'string' && AREAS[c.area] ? c.area : (c.indoor ? 'indoor' : 'outdoor');
  const subs = Object.keys(AREAS[area].subs);
  const wanted = SUB_ALIASES[c.sub] ?? c.sub;
  let sub = subs.includes(wanted) ? wanted : (subs[0] ?? null);
  const water = area === 'water';
  return {
    area,
    sub,
    lit: !!c.lit,
    // Older saves had lit cells with no radius: they become small bulbs.
    radius: c.lit ? clampRadius(c.radius ?? 0.5) : 0,
    walkable: sub === 'start' ? false
      : c.walkable === undefined ? defaultWalkable(area, sub) || (water && !!c.bridge) : !!c.walkable,
    bridge: water && !!c.bridge,
    lamp: !!c.lamp,
    marker: MARKERS[c.marker] ? c.marker : null,
    site: c.marker === 'objective' && SITES[c.site] ? c.site : null,
    facing: (sub === 'start' || hasFixedFootprint(sub)) && Number.isInteger(c.facing) && c.facing >= 0 && c.facing < 4 ? c.facing : null,
    flip: hasFixedFootprint(sub) && !!c.flip,
  };
}

const clampRadius = (r) => {
  const v = Math.round(Number(r) * 2) / 2;
  return Number.isFinite(v) ? Math.min(MAX_RADIUS, Math.max(0, v)) : 0.5;
};

export const areaLabel = (c) => {
  const a = AREAS[c.area];
  return c.sub ? a.subs[c.sub].label : a.label;
};

// Spreadsheet-style column letters: A..T for a 20-wide board.
export function colLabel(x) {
  let s = '';
  let n = x + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export const cellLabel = (x, y) => `${colLabel(x)}${y + 1}`;

export class GridState {
  constructor(cols = COLS, rows = ROWS) {
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: cols * rows }, defaultCell);
    this.undoStack = [];
    this.redoStack = [];
    this.edges = new Map(); // edgeKey -> 'wall' | 'door'
    this.edgeOverride = null; // the game's door changes, while the rules run (src/game/doors.js)
    // Board-wide elevation preset (see src/terrain.js) and, optionally, a
    // function giving a cell's ground elevation in metres (for export).
    this.terrain = 'flat';
    this.elevationAt = null;
    this.stroke = null; // Map<index, cellSnapshotBeforeStroke>
    this.strokeEdges = null; // Map<edgeKey, typeBeforeStroke>
    this.listeners = new Set();
  }

  index(x, y) { return y * this.cols + x; }
  coords(i) { return { x: i % this.cols, y: Math.floor(i / this.cols) }; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // `resized` tells listeners the board dimensions changed (rebuild needed).
  emit(indices, resized = false) {
    this._auto = null;
    this._lamps = null;
    for (const fn of this.listeners) fn(indices, resized);
  }

  // --- condemned buildings -----------------------------------------------------
  // Walls placed automatically round every condemned shape (not stored; they
  // follow the shape as you paint). Edges facing a street, start space or
  // bridge are the frontage: boarded-up windows, with one boarded-up door in
  // the middle of each straight run. Walls, doors and windows you draw
  // yourself on the same edge win.
  autoEdges() {
    if (this._auto) return this._auto;
    const out = new Map();
    const cond = (x, y) => this.inBounds(x, y) && this.cells[this.index(x, y)].sub === 'condemned';
    const road = (x, y) => {
      if (!this.inBounds(x, y)) return false;
      const c = this.cells[this.index(x, y)];
      return c.sub === 'street' || c.sub === 'start' || c.bridge;
    };
    const runs = new Map(); // frontage line -> [{ pos, k }]
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (!cond(x, y)) continue;
        for (const [dx, dy, o, ex, ey, side] of [
          [0, -1, 'h', x, y, 'N'], [0, 1, 'h', x, y + 1, 'S'], [-1, 0, 'v', x, y, 'W'], [1, 0, 'v', x + 1, y, 'E']]) {
          if (cond(x + dx, y + dy)) continue;
          const k = edgeKey(o, ex, ey);
          if (road(x + dx, y + dy)) {
            const line = `${side}${o === 'h' ? ey : ex}`;
            if (!runs.has(line)) runs.set(line, []);
            runs.get(line).push({ pos: o === 'h' ? ex : ey, k });
          } else {
            out.set(k, 'wall');
          }
        }
      }
    }
    for (const list of runs.values()) {
      list.sort((a, b) => a.pos - b.pos);
      let start = 0;
      for (let n = 1; n <= list.length; n++) {
        if (n < list.length && list[n].pos === list[n - 1].pos + 1) continue;
        const run = list.slice(start, n);
        const door = Math.floor((run.length - 1) / 2);
        run.forEach((e, j) => out.set(e.k, j === door ? 'boardedDoor' : 'boardedWindow'));
        start = n;
      }
    }
    this._auto = out;
    return out;
  }

  // The piece on an edge: one you drew, else an automatic condemned wall.
  edgeAt(k) { return this.edges.get(k) ?? this.autoEdges().get(k); }

  // Every edge piece (drawn ones win over automatic ones).
  allEdges() { return new Map([...this.autoEdges(), ...this.edges]); }

  // --- strokes -------------------------------------------------------------

  beginStroke() { this.stroke = new Map(); this.strokeEdges = new Map(); }

  edgeInBounds(o, x, y) {
    return o === 'v'
      ? x >= 0 && x <= this.cols && y >= 0 && y < this.rows
      : x >= 0 && x < this.cols && y >= 0 && y <= this.rows;
  }

  // Labels of the two cells an edge separates on a board of the given size.
  edgeCellsLabels(o, x, y, cols = this.cols, rows = this.rows) {
    return this.edgeCells(o, x, y).map((c) => (c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows ? cellLabel(c.x, c.y) : null));
  }

  // The two cells an edge separates (either may be off the board).
  edgeCells(o, x, y) {
    return o === 'v' ? [{ x: x - 1, y }, { x, y }] : [{ x, y: y - 1 }, { x, y }];
  }

  // Set or clear (type = null) a wall/door. Returns true if it changed.
  setEdge(o, x, y, type, { silent = false } = {}) {
    if (!this.edgeInBounds(o, x, y)) return false;
    const k = edgeKey(o, x, y);
    const before = this.edges.get(k) ?? null;
    if (before === type) return false;
    if (this.strokeEdges && !this.strokeEdges.has(k)) this.strokeEdges.set(k, before);
    if (type) this.edges.set(k, type); else this.edges.delete(k);
    if (!silent) this.emit([]);
    return true;
  }

  // Apply a patch (any of CELL_KEYS) to one cell, or a function
  // (cell) => patch|null. Records undo info when inside a stroke.
  // Returns true if anything changed.
  apply(i, patch, { silent = false } = {}) {
    const cell = this.cells[i];
    if (typeof patch === 'function') patch = patch(cell, i, this);
    this._auto = null;
    this._lamps = null;
    if (!patch) return false;
    let changed = false;
    for (const k in patch) if (cell[k] !== patch[k]) { changed = true; break; }
    if (!changed) return false;
    if (this.stroke && !this.stroke.has(i)) this.stroke.set(i, { ...cell });
    Object.assign(cell, patch);
    if (!silent) this.emit([i]);
    return true;
  }

  // Undo everything done so far in the current stroke (used for live
  // rectangle previews) while keeping the stroke open.
  revertStroke() {
    if (!this.stroke) return;
    const touched = [];
    for (const [i, before] of this.stroke) {
      Object.assign(this.cells[i], before);
      touched.push(i);
    }
    this.stroke.clear();
    const edgesTouched = this.strokeEdges.size > 0;
    for (const [k, before] of this.strokeEdges) {
      if (before) this.edges.set(k, before); else this.edges.delete(k);
    }
    this.strokeEdges.clear();
    if (touched.length || edgesTouched) this.emit(touched);
  }

  endStroke() {
    const stroke = this.stroke;
    const strokeEdges = this.strokeEdges;
    this.stroke = null;
    this.strokeEdges = null;
    if (!stroke) return;
    const cells = [];
    for (const [i, before] of stroke) {
      const after = { ...this.cells[i] };
      if (CELL_KEYS.some((k) => before[k] !== after[k])) cells.push({ i, before, after });
    }
    const edges = [];
    for (const [k, before] of strokeEdges) {
      const after = this.edges.get(k) ?? null;
      if (before !== after) edges.push({ k, before, after });
    }
    if (!cells.length && !edges.length) return;
    this.undoStack.push({ cells, edges });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  // Forget undo/redo (when a different board is loaded: a game's map, or the
  // editor's board coming back).
  clearHistory() { this.undoStack.length = 0; this.redoStack.length = 0; }

  undo() { return this.#replay(this.undoStack, this.redoStack, 'before'); }
  redo() { return this.#replay(this.redoStack, this.undoStack, 'after'); }

  #replay(from, to, which) {
    const entries = from.pop();
    if (!entries) return false;
    to.push(entries);
    if (entries.snapshot) {
      this.#restore(entries.snapshot[which]);
      return true;
    }
    for (const e of entries.cells) Object.assign(this.cells[e.i], e[which]);
    for (const e of entries.edges) {
      if (e[which]) this.edges.set(e.k, e[which]); else this.edges.delete(e.k);
    }
    this.emit(entries.cells.map((e) => e.i));
    return true;
  }

  #snapshot() {
    return {
      cols: this.cols, rows: this.rows,
      cells: this.cells.map((c) => ({ ...c })),
      edges: new Map(this.edges),
    };
  }

  #restore(snap) {
    const resized = snap.cols !== this.cols || snap.rows !== this.rows;
    this.cols = snap.cols;
    this.rows = snap.rows;
    this.cells = snap.cells.map((c) => ({ ...c }));
    this.edges = new Map(snap.edges);
    this.emit(this.cells.map((_, i) => i), resized);
  }

  // Replace the whole board (optionally with new dimensions) as one undoable
  // step. `edges` defaults to the current walls/doors that still fit.
  replaceAll(cols, rows, cells, edges = null) {
    const before = this.#snapshot();
    if (!edges) {
      edges = new Map();
      for (const [k, t] of this.edges) {
        const { o, x, y } = parseEdgeKey(k);
        const fits = o === 'v' ? x <= cols && y < rows : x < cols && y <= rows;
        if (fits) edges.set(k, t);
      }
    }
    const after = { cols, rows, cells: cells.map((c) => ({ ...c })), edges: new Map(edges) };
    this.undoStack.push({ snapshot: { before, after } });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.#restore(after);
  }

  // Change board dimensions, keeping every cell that still fits (anchored at A1).
  resize(cols, rows) {
    cols = clampSize(cols, this.cols);
    rows = clampSize(rows, this.rows);
    if (cols === this.cols && rows === this.rows) return false;
    const cells = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        cells.push(x < this.cols && y < this.rows ? { ...this.cells[this.index(x, y)] } : defaultCell());
      }
    }
    this.replaceAll(cols, rows, cells);
    return true;
  }

  // Totals per category, per subcategory (`subs`), and for bridges, light,
  // movement, walls and doors.
  counts() {
    const n = { bridge: 0, lit: 0, unlit: 0, walkable: 0, blocked: 0, wall: 0, door: 0, window: 0, lamp: 0, subs: {}, markers: {} };
    for (const a in AREAS) n[a] = 0;
    for (const c of this.cells) {
      n[c.area]++;
      if (c.sub) n.subs[c.sub] = (n.subs[c.sub] ?? 0) + 1;
      if (c.bridge) n.bridge++;
      if (c.marker) n.markers[c.marker] = (n.markers[c.marker] ?? 0) + 1;
      c.lit ? n.lit++ : n.unlit++;
      c.walkable ? n.walkable++ : n.blocked++;
    }
    n.lockedDoor = 0;
    n.oneWayDoor = 0;
    for (const t of this.edges.values()) n[edgeKind(t)]++;
    n.boardedDoor = 0;
    n.boardedWindow = 0;
    for (const [k, t] of this.autoEdges()) if (!this.edges.has(k) && t !== 'wall') n[t]++;
    this.cells.forEach((_, i) => { if (this.lampOn(i)) n.lamp++; });
    return n;
  }

  isWater(x, y) { return this.inBounds(x, y) && this.cells[this.index(x, y)].area === 'water'; }

  // Is this cell's street lamp switched on? (A lamp flag left on a cell that
  // is no longer an intersection does nothing.)
  // Every cell with a street lamp post (cached until the board changes).
  streetLamps() { return (this._lamps ??= streetLampCells(this)); }
  lampOn(i) {
    if (!this.cells[i].lamp) return false;
    const { x, y } = this.coords(i);
    return hasStreetLamp(this, x, y);
  }

  // Light level per cell, 0..1, from every light source (lit cells and
  // switched-on street lamps). Overlapping lights add up like real light
  // (1 - (1-a)(1-b)), and walls block it.
  // `src` (optional Int32Array, one per cell) receives the cell index of the
  // strongest light source reaching each cell (-1 for none), so a light's
  // whole pool can be animated together (the midnight flicker).
  // `powerOut` (Power Outage): every light is off except vehicle headlights.
  lightLevels(src = null, { powerOut = false } = {}) {
    const out = new Float32Array(this.cells.length);
    const best = src ? new Float32Array(this.cells.length) : null;
    if (src) src.fill(-1);
    let from = -1;
    const add = (j, v) => {
      out[j] = 1 - (1 - out[j]) * (1 - v);
      if (src && v > best[j]) { best[j] = v; src[j] = from; }
    };
    this.cells.forEach((c, i) => {
      const lamp = this.lampOn(i);
      if ((!c.lit && !lamp) || powerOut) return;
      from = i;
      const r = lamp ? Math.max(LAMP_SOURCE.radius, c.lit ? c.radius : 0) : c.radius;
      const bright = (d) => (lamp
        ? Math.max(LAMP_SOURCE.brightness * (d > LAMP_SOURCE.radius ? 0 : 1 - d / (LAMP_SOURCE.radius + 1)), c.lit ? lightAt(c.radius, d) : 0)
        : lightAt(r, d));
      const { x: sx, y: sy } = this.coords(i);
      const reach = Math.floor(r);
      for (let y = sy - reach; y <= sy + reach; y++) {
        for (let x = sx - reach; x <= sx + reach; x++) {
          if (!this.inBounds(x, y)) continue;
          const d = Math.hypot(x - sx, y - sy);
          const v = bright(d);
          if (v <= 0 || !this.lightReaches(sx, sy, x, y)) continue;
          add(this.index(x, y), v);
        }
      }
    });
    // Van headlights shine forward from each start space (walls block them).
    this.cells.forEach((c, i) => {
      if (c.sub !== 'start') return;
      from = i;
      const [dx, dy] = FACINGS[this.startFacing(i)];
      const { x, y } = this.coords(i);
      HEADLIGHTS.forEach((v, k) => {
        const nx = x + dx * k, ny = y + dy * k;
        if (!this.inBounds(nx, ny) || !this.lightReaches(x, y, nx, ny)) return;
        add(this.index(nx, ny), v);
      });
    });
    return out;
  }

  // --- start space ----------------------------------------------------------------

  // Which way a start space's van faces: its stored facing, or automatically
  // toward the road (a neighbouring street or bridge, preferring one where
  // the road carries on).
  startFacing(i) {
    const c = this.cells[i];
    const { x, y } = this.coords(i);
    if (Number.isInteger(c.facing) && this.inBounds(x + FACINGS[c.facing][0], y + FACINGS[c.facing][1])) return c.facing;
    const road = (nx, ny) => this.inBounds(nx, ny) && (this.cells[this.index(nx, ny)].sub === 'street' || this.cells[this.index(nx, ny)].bridge);
    let best = -1, score = -1;
    FACINGS.forEach(([dx, dy], f) => {
      if (!this.inBounds(x + dx, y + dy)) return;
      const s = (road(x + dx, y + dy) ? 2 : 0) + (road(x + 2 * dx, y + 2 * dy) ? 1 : 0)
        + (this.cells[this.index(x + dx, y + dy)].walkable ? 0.5 : 0);
      if (s > score) { score = s; best = f; }
    });
    return best < 0 ? 1 : best;
  }

  // The cell in front of the van, where players start (-1 off the board).
  startFront(i) {
    const [dx, dy] = FACINGS[this.startFacing(i)];
    const { x, y } = this.coords(i);
    return this.inBounds(x + dx, y + dy) ? this.index(x + dx, y + dy) : -1;
  }

  // --- clocktowers and landmarks -----------------------------------------------
  // North-west cells of each whole w x h block of `sub` cells, scanning row by
  // row (leftover cells are just its yard).
  blocks(sub, w, h) {
    const used = new Uint8Array(this.cells.length);
    const is = (x, y) => this.inBounds(x, y) && !used[this.index(x, y)] && this.cells[this.index(x, y)].sub === sub;
    const out = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        let ok = true;
        for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w && ok; dx++) ok = is(x + dx, y + dy);
        if (!ok) continue;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) used[this.index(x + dx, y + dy)] = 1;
        out.push(this.index(x, y));
      }
    }
    return out;
  }
  clocktowers() { return this.blocks('clocktower', 2, 2); }

  // Every placed premade building of `sub`: whole blocks of its cells that
  // share a facing, scanning row by row. Each is { anchor, x, y, w, h, face, flip }.
  landmarkBlocks(sub) {
    const used = new Uint8Array(this.cells.length);
    const out = [];
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (used[i] || c.sub !== sub) continue;
      const [w, h] = landmarkDims(sub, c.facing);
      const { x, y } = this.coords(i);
      let ok = true;
      for (let dy = 0; dy < h && ok; dy++) for (let dx = 0; dx < w && ok; dx++) {
        const j = this.inBounds(x + dx, y + dy) ? this.index(x + dx, y + dy) : -1;
        ok = j >= 0 && !used[j] && this.cells[j].sub === sub && this.cells[j].facing === c.facing && this.cells[j].flip === c.flip;
      }
      if (!ok) continue;
      const cells = [];
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) { const j = this.index(x + dx, y + dy); used[j] = 1; cells.push(j); }
      out.push({ anchor: i, x, y, w, h, face: c.facing, flip: !!c.flip, cells });
    }
    return out;
  }
  // The placed building of `sub` covering cell i, or null.
  landmarkAt(i) {
    const sub = this.cells[i]?.sub;
    if (!hasFixedFootprint(sub)) return null;
    return this.landmarkBlocks(sub).find((b) => b.cells.includes(i)) ?? null;
  }
  // How many street, path, start or bridge cells run along side `face` of a w x h block.
  roadsAlong(x, y, w, h, face) {
    let n = 0;
    const len = face % 2 ? h : w;
    for (let k = 0; k < len; k++) {
      const cx = face === 1 ? x + w : face === 3 ? x - 1 : x + k;
      const cy = face === 0 ? y - 1 : face === 2 ? y + h : y + k;
      if (!this.inBounds(cx, cy)) continue;
      const c = this.cells[this.index(cx, cy)];
      if (c.sub === 'street' || c.sub === 'path' || c.sub === 'start' || c.bridge) n++;
    }
    return n;
  }

  // --- markers ----------------------------------------------------------------

  // The building a key marker belongs to: the connected indoor cells (any
  // walls inside don't split it) containing the key, or, for a key just
  // outside, every building touching its cell. Returns a Set of cell indices.
  keyBuilding(i) {
    const indoor = (j) => this.cells[j].area === 'indoor';
    const seeds = [];
    const { x, y } = this.coords(i);
    if (indoor(i)) seeds.push(i);
    else {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (this.inBounds(x + dx, y + dy) && indoor(this.index(x + dx, y + dy))) seeds.push(this.index(x + dx, y + dy));
      }
    }
    const out = new Set(seeds);
    const queue = [...seeds];
    while (queue.length) {
      const j = queue.pop();
      const c = this.coords(j);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.inBounds(c.x + dx, c.y + dy)) continue;
        const k = this.index(c.x + dx, c.y + dy);
        if (!out.has(k) && indoor(k)) { out.add(k); queue.push(k); }
      }
    }
    return out;
  }

  // Locked and one-way doors a key marker in cell i would unlock: those on
  // any edge of its building. Returns edge keys.
  keyDoors(i) {
    const building = this.keyBuilding(i);
    const doors = new Set();
    for (const j of building) {
      const { x, y } = this.coords(j);
      for (const [o, ex, ey] of [['v', x, y], ['v', x + 1, y], ['h', x, y], ['h', x, y + 1]]) {
        const k = edgeKey(o, ex, ey);
        const t = this.edges.get(k);
        if (t === 'lockedDoor' || t?.startsWith('oneWayDoor')) doors.add(k);
      }
    }
    return [...doors];
  }

  // --- movement ---------------------------------------------------------------
  // Movement rules: you can only enter walkable cells; walls, windows and
  // locked doors can't be crossed; unlocked doors can be crossed both ways;
  // one-way doors only in their direction ('+' = toward east/south).

  // Can you cross the edge between (x, y) and the orthogonal neighbour
  // (x + dx, y + dy)?
  // `unlocked(edgeKey)` (optional) says whether a key you carry has
  // unlocked that edge's door: unlocked locked/one-way doors pass both ways.
  // `override(edgeKey, type)` (optional) changes what a door is during a game
  // (blocked, locked down, opened: src/game/eventPlay.js doorOverride).
  canCross(x, y, dx, dy, unlocked, override) {
    const [o, ex, ey] = dx ? ['v', dx > 0 ? x + 1 : x, y] : ['h', x, dy > 0 ? y + 1 : y];
    const k = edgeKey(o, ex, ey);
    // `override`: the caller's door changes; otherwise the game's own
    // (edgeOverride, set by the rules while they run: nailed and breached doors).
    const ov = override ?? this.edgeOverride;
    const t = ov ? ov(k, this.edgeAt(k)) : this.edgeAt(k);
    if (!t || t === 'door') return true;
    if ((t === 'lockedDoor' || t.startsWith('oneWayDoor')) && unlocked?.(k)) return true;
    if (t === 'oneWayDoor+') return dx > 0 || dy > 0;
    if (t === 'oneWayDoor-') return dx < 0 || dy < 0;
    return false; // wall, window, locked door
  }

  canEnter(x, y) { return this.inBounds(x, y) && this.cells[this.index(x, y)].walkable; }

  // One move from (x, y) by (dx, dy). Diagonal moves need both ways round
  // the corner to be clear, so you can't squeeze between two walls.
  canStep(x, y, dx, dy, unlocked, override) {
    const nx = x + dx, ny = y + dy;
    if (!this.canEnter(nx, ny)) return false;
    if (!dx || !dy) return this.canCross(x, y, dx, dy, unlocked, override);
    const viaX = this.canEnter(x + dx, y) && this.canCross(x, y, dx, 0, unlocked, override) && this.canCross(x + dx, y, 0, dy, unlocked, override);
    const viaY = this.canEnter(x, y + dy) && this.canCross(x, y, 0, dy, unlocked, override) && this.canCross(x, y + dy, dx, 0, unlocked, override);
    return viaX && viaY;
  }

  // Key groups for movement: keys whose buildings unlock the same doors act
  // as one key. Returns { groups: [{ cells: [i], doors: Set<edgeKey> }],
  // cellGroup: Map<cell, groupIndex>, edgeMask: Map<edgeKey, bitmask> }.
  // At most MAX_KEY_GROUPS groups are tracked (the rest are ignored).
  keyGroups() {
    const groups = [];
    const bySig = new Map();
    this.cells.forEach((c, i) => {
      if (c.marker !== 'key' || !c.walkable) return;
      const doors = this.keyDoors(i);
      if (!doors.length) return;
      const sig = [...doors].sort().join('|');
      if (!bySig.has(sig)) {
        if (groups.length >= MAX_KEY_GROUPS) return;
        bySig.set(sig, groups.length);
        groups.push({ cells: [], doors: new Set(doors) });
      }
      groups[bySig.get(sig)].cells.push(i);
    });
    const cellGroup = new Map();
    const edgeMask = new Map();
    groups.forEach((g, gi) => {
      for (const i of g.cells) cellGroup.set(i, gi);
      for (const k of g.doors) edgeMask.set(k, (edgeMask.get(k) ?? 0) | (1 << gi));
    });
    return { groups, cellGroup, edgeMask };
  }

  // Breadth-first moves from a cell. With `keys` (default on), walking onto a
  // key marker picks it up, and from then on the locked and one-way doors of
  // its building pass both ways; the search tracks which keys you carry, so
  // routes detour to fetch a key when that's needed or shorter.
  // Returns { dist: Int32Array per cell (-1 = unreachable), path(i) -> cell
  // indices from the start, keysOn(i) -> key cells picked up on that path }.
  moveField(sx, sy, { diagonal = false, maxSteps = Infinity, keys = true } = {}) {
    const n = this.cells.length;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (diagonal) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    const kg = keys ? this.keyGroups() : { groups: [], cellGroup: new Map(), edgeMask: new Map() };
    const M = 1 << kg.groups.length;           // key-carrying states
    const pick = (i, mask) => (kg.cellGroup.has(i) ? mask | (1 << kg.cellGroup.get(i)) : mask);
    const sdist = new Int32Array(n * M).fill(-1);
    const sprev = new Int32Array(n * M).fill(-1);
    const start = this.index(sx, sy);
    const s0 = start * M + pick(start, 0);
    sdist[s0] = 0;
    const queue = [s0];
    for (let q = 0; q < queue.length; q++) {
      const st = queue[q];
      if (sdist[st] >= maxSteps) continue;
      const i = Math.floor(st / M), mask = st % M;
      const unlocked = mask ? (k) => ((kg.edgeMask.get(k) ?? 0) & mask) !== 0 : undefined;
      const { x, y } = this.coords(i);
      for (const [dx, dy] of dirs) {
        if (!this.canStep(x, y, dx, dy, unlocked)) continue;
        const j = this.index(x + dx, y + dy);
        const sj = j * M + pick(j, mask);
        if (sdist[sj] >= 0) continue;
        sdist[sj] = sdist[st] + 1;
        sprev[sj] = st;
        queue.push(sj);
      }
    }
    // Best state per cell.
    const dist = new Int32Array(n).fill(-1);
    const best = new Int32Array(n).fill(-1);
    for (let st = 0; st < n * M; st++) {
      const d = sdist[st];
      if (d < 0) continue;
      const i = Math.floor(st / M);
      if (dist[i] < 0 || d < dist[i]) { dist[i] = d; best[i] = st; }
    }
    const statePath = (i) => {
      if (dist[i] < 0) return null;
      const out = [];
      for (let st = best[i]; st >= 0; st = sprev[st]) out.push(st);
      return out.reverse();
    };
    return {
      dist,
      path: (i) => statePath(i)?.map((st) => Math.floor(st / M)) ?? null,
      // Key cells where the route picks up a new key.
      keysOn: (i) => {
        const sp = statePath(i);
        if (!sp) return [];
        const out = [];
        for (let k = 0; k < sp.length; k++) {
          const prevMask = k ? sp[k - 1] % M : 0;
          if ((sp[k] % M) & ~prevMask) out.push(Math.floor(sp[k] / M));
        }
        return out;
      },
      keyGroups: kg.groups.length,
    };
  }

  // Shortest route between two cells as a list of cell indices (start
  // first), or null if there is none. Options as for moveField.
  route(sx, sy, tx, ty, opts = {}) {
    return this.moveField(sx, sy, opts).path(this.index(tx, ty));
  }

  // Can light travel in a straight line from the centre of cell (ax, ay) to
  // the centre of (bx, by)? Walks the grid cells along the line and checks
  // each edge it crosses: a wall blocks; doors and windows don't. Passing
  // exactly through a grid corner is clear if either way round is clear.
  lightReaches(ax, ay, bx, by) {
    const blocks = (o, x, y) => blocksLight(this.edgeAt(edgeKey(o, x, y)));
    let x = ax, y = ay;
    const dx = bx - ax, dy = by - ay;
    const stepX = Math.sign(dx), stepY = Math.sign(dy);
    // Ray from (ax+.5, ay+.5); distance (in t) to the next vertical/horizontal line.
    const tDeltaX = dx ? 1 / Math.abs(dx) : Infinity;
    const tDeltaY = dy ? 1 / Math.abs(dy) : Infinity;
    let tMaxX = dx ? 0.5 * tDeltaX : Infinity;
    let tMaxY = dy ? 0.5 * tDeltaY : Infinity;
    // Edge crossed when stepping from (x, y) in x or y.
    const vEdge = (cx, cy) => ['v', stepX > 0 ? cx + 1 : cx, cy];
    const hEdge = (cx, cy) => ['h', cx, stepY > 0 ? cy + 1 : cy];
    while (x !== bx || y !== by) {
      if (Math.abs(tMaxX - tMaxY) < 1e-9) {
        // Through a corner: clear if x-then-y or y-then-x is clear.
        const viaX = !blocks(...vEdge(x, y)) && !blocks(...hEdge(x + stepX, y));
        const viaY = !blocks(...hEdge(x, y)) && !blocks(...vEdge(x, y + stepY));
        if (!viaX && !viaY) return false;
        x += stepX; y += stepY;
        tMaxX += tDeltaX; tMaxY += tDeltaY;
      } else if (tMaxX < tMaxY) {
        if (blocks(...vEdge(x, y))) return false;
        x += stepX; tMaxX += tDeltaX;
      } else {
        if (blocks(...hEdge(x, y))) return false;
        y += stepY; tMaxY += tDeltaY;
      }
    }
    return true;
  }

  // River flow: for each cell, a unit (dx, dy) in grid space (+x = right,
  // +y = down the rows); zero for non-river cells. Water enters at the
  // right-most cells of each connected river and runs along the painted path
  // to the left: we take the walking distance from those entry cells and
  // point each cell toward its downstream neighbours, then smooth.
  riverFlow() {
    const { cols, rows, cells } = this;
    const n = cols * rows;
    const isRiver = (i) => cells[i].area === 'water' && cells[i].sub === 'river';
    const dist = new Float32Array(n).fill(-1);
    const comp = new Int32Array(n).fill(-1);
    const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // 1. Connected components; seed each from its right-most column.
    let compId = 0;
    const queue = [];
    for (let i = 0; i < n; i++) {
      if (!isRiver(i) || comp[i] >= 0) continue;
      const members = [i];
      comp[i] = compId;
      for (let k = 0; k < members.length; k++) {
        const { x, y } = this.coords(members[k]);
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const j = this.index(nx, ny);
          if (isRiver(j) && comp[j] < 0) { comp[j] = compId; members.push(j); }
        }
      }
      const maxX = Math.max(...members.map((j) => j % cols));
      for (const j of members) if (j % cols === maxX) { dist[j] = 0; queue.push(j); }
      compId++;
    }
    // 2. Breadth-first walking distance downstream.
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      const { x, y } = this.coords(i);
      for (const [dx, dy] of N4) {
        const nx = x + dx, ny = y + dy;
        if (!this.inBounds(nx, ny)) continue;
        const j = this.index(nx, ny);
        if (isRiver(j) && dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
      }
    }
    // 3. Direction = toward neighbours further downstream (8-neighbourhood).
    let flow = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      if (!isRiver(i)) continue;
      const { x, y } = this.coords(i);
      let fx = 0, fy = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || !this.inBounds(x + dx, y + dy)) continue;
          const j = this.index(x + dx, y + dy);
          if (!isRiver(j)) continue;
          const w = (dist[j] - dist[i]) / Math.hypot(dx, dy);
          fx += dx * w; fy += dy * w;
        }
      }
      if (fx === 0 && fy === 0) fx = -1; // isolated cell or pool: drift left
      const len = Math.hypot(fx, fy);
      flow[i * 2] = fx / len; flow[i * 2 + 1] = fy / len;
    }
    // 4. Two smoothing passes so bends turn gradually.
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        if (!isRiver(i)) continue;
        const { x, y } = this.coords(i);
        let fx = flow[i * 2] * 2, fy = flow[i * 2 + 1] * 2;
        for (const [dx, dy] of N4) {
          if (!this.inBounds(x + dx, y + dy)) continue;
          const j = this.index(x + dx, y + dy);
          if (comp[j] === comp[i]) { fx += flow[j * 2]; fy += flow[j * 2 + 1]; }
        }
        const len = Math.hypot(fx, fy) || 1;
        next[i * 2] = fx / len; next[i * 2 + 1] = fy / len;
      }
      flow = next;
    }
    return flow;
  }

  // Which way a bridge cell spans: 'x' (east-west) or 'y' (north-south).
  // A bridge runs toward land or other bridge cells and across the water.
  // Intended for placing bridge assets and pylons later.
  bridgeAxis(x, y) {
    const solid = (nx, ny) => this.inBounds(nx, ny) && (!this.isWater(nx, ny) || this.cells[this.index(nx, ny)].bridge);
    const ew = solid(x - 1, y) + solid(x + 1, y);
    const ns = solid(x, y - 1) + solid(x, y + 1);
    if (ew !== ns) return ew > ns ? 'x' : 'y';
    // Tie: span across the water's flow (rivers) or the shorter water run.
    const waterEW = this.isWater(x - 1, y) + this.isWater(x + 1, y);
    const waterNS = this.isWater(x, y - 1) + this.isWater(x, y + 1);
    return waterEW > waterNS ? 'y' : 'x';
  }

  // --- serialization -----------------------------------------------------------

  toJSON() {
    const levels = this.lightLevels();
    return {
      format: 'minty-pickle-grid',
      version: FORMAT_VERSION,
      cols: this.cols,
      rows: this.rows,
      terrain: this.terrain, // elevation preset
      // Row-major, y = row (1..26 on the board), x = column (A..T).
      cells: this.cells.map((c, i) => {
        const { x, y } = this.coords(i);
        return {
          x, y, id: cellLabel(x, y),
          area: c.area, sub: c.sub, walkable: c.walkable, bridge: c.bridge,
          lit: c.lit, // light source here
          ...(c.lit ? { radius: c.radius } : {}),
          lamp: this.lampOn(i),
          marker: c.marker,
          ...(c.marker === 'objective' && c.site ? { site: c.site } : {}),
          ...(hasFixedFootprint(c.sub) && c.facing !== null ? { facing: c.facing, faces: FACING_NAMES[c.facing], flip: !!c.flip } : {}),
          ...(c.sub === 'start' ? (() => {
            const f = this.startFacing(i);
            const front = this.startFront(i);
            const fc = front >= 0 ? this.coords(front) : null;
            return { facing: f, faces: FACING_NAMES[f], playerStart: fc ? cellLabel(fc.x, fc.y) : null };
          })() : {}),
          ...(this.elevationAt && this.terrain !== 'flat' ? { elevation: Math.round(this.elevationAt(x, y) * 10) / 10 } : {}),
          ...(c.marker === 'key' ? {
            unlocks: this.keyDoors(i).map((k) => {
              const e = parseEdgeKey(k);
              return { edge: e.o, x: e.x, y: e.y, between: this.edgeCellsLabels(e.o, e.x, e.y) };
            }),
          } : {}),
          light: Math.round(levels[i] * 100) / 100, // 0..1 incl. lamp spill
          ...(c.bridge ? { bridgeAxis: this.bridgeAxis(x, y) } : {}),
        };
      }),
      // Walls and doors on cell edges. "v" = west side of cell (x, y);
      // "h" = north side of cell (x, y). `between` names the two cells
      // (an off-board cell is null). Doors sit centred on their edge.
      // Automatic condemned-building pieces are included with "auto": true
      // (they're rebuilt from the cells on import).
      edges: [...this.allEdges()].map(([k, type]) => {
        const { o, x, y } = parseEdgeKey(k);
        const between = this.edgeCells(o, x, y).map((c) => (this.inBounds(c.x, c.y) ? cellLabel(c.x, c.y) : null));
        const out = { edge: o, x, y, type: edgeKind(type), between, ...(this.edges.has(k) ? {} : { auto: true }) };
        // One-way doors: you can go from `passFrom` to `passTo` only.
        if (type.startsWith('oneWayDoor')) {
          const [a, b] = type.endsWith('+') ? between : [...between].reverse();
          out.passFrom = a;
          out.passTo = b;
        }
        return out;
      }),
    };
  }

  // Parse saved data into { cols, rows, cells } (does not mutate state).
  // Files without dimensions are read as the default 20 x 26 board; format v1
  // files (indoor: true/false) are converted to areas.
  parse(data) {
    if (!data || !Array.isArray(data.cells)) throw new Error('Not a grid file: missing "cells".');
    const cols = clampSize(data.cols ?? COLS, COLS, MAX_LOAD_SIZE);
    const rows = clampSize(data.rows ?? ROWS, ROWS, MAX_LOAD_SIZE);
    const cells = Array.from({ length: cols * rows }, defaultCell);
    data.cells.forEach((c, n) => {
      const x = Number.isInteger(c.x) ? c.x : n % cols;
      const y = Number.isInteger(c.y) ? c.y : Math.floor(n / cols);
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      cells[y * cols + x] = normalizeCell(c);
    });
    const edges = new Map();
    for (const e of Array.isArray(data.edges) ? data.edges : []) {
      // One-way doors are exported as type oneWayDoor + passFrom/passTo.
      let type = e.type;
      if (type === 'oneWayDoor') {
        const [, b] = this.edgeCellsLabels(e.edge, e.x, e.y, cols, rows);
        type = e.passTo && e.passTo === b ? 'oneWayDoor+' : e.passFrom === b ? 'oneWayDoor-' : 'oneWayDoor+';
      }
      if (e.auto) continue;
      if (!['v', 'h'].includes(e.edge) || !EDGE_TYPES.includes(type)) continue;
      const fits = e.edge === 'v' ? e.x >= 0 && e.x <= cols && e.y >= 0 && e.y < rows : e.x >= 0 && e.x < cols && e.y >= 0 && e.y <= rows;
      if (Number.isInteger(e.x) && Number.isInteger(e.y) && fits) edges.set(edgeKey(e.edge, e.x, e.y), type);
    }
    const terrain = typeof data.terrain === 'string' ? data.terrain : 'flat';
    return { cols, rows, cells, edges, terrain };
  }

  // Load parsed data without touching undo history (used at startup).
  load({ cols, rows, cells, edges, terrain }) {
    if (terrain) this.terrain = terrain;
    this.#restore({ cols, rows, cells, edges: edges ?? new Map() });
  }
}
