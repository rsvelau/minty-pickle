// Grid data model: cell attributes, strokes with undo/redo, and (de)serialization.

export const COLS = 20;
export const ROWS = 26;
export const FORMAT_VERSION = 3;
export const MIN_SIZE = 4;
export const MAX_SIZE = 60;
const clampSize = (n, fallback) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : fallback;
};

// Space categories and their subcategories. Add a subcategory here and it is
// accepted everywhere: painting, saving, importing. The first subcategory is
// the category's default. `walkable: false` marks subcategories that start
// out blocked when painted (the Walkable brush can still override a cell).
export const AREAS = {
  outdoor: {
    label: 'Outdoor',
    subs: {
      ground: { label: 'Ground' },
      // Two-lane street with sidewalks; lines and curbs follow its neighbours.
      street: { label: 'Street' },
      path: { label: 'Path' },
      cemetery: { label: 'Cemetery' },
      cemeteryPath: { label: 'Cemetery path' },
      forestCemetery: { label: 'Forest cemetery', walkable: false },
      forest: { label: 'Forest', walkable: false },
      brambles: { label: 'Brambles', walkable: false },
    },
  },
  indoor: {
    label: 'Indoor',
    subs: { hardwood: { label: 'Hardwood' }, carpet: { label: 'Carpet' } },
  },
  water: {
    label: 'Water',
    walkable: false,
    subs: { lake: { label: 'Lake' }, river: { label: 'River' } },
  },
};
export const CELL_KEYS = ['area', 'sub', 'lit', 'radius', 'walkable', 'bridge', 'lamp'];

// Whether a freshly painted area/subcategory is walkable.
export const defaultWalkable = (area, sub) =>
  (AREAS[area]?.walkable ?? true) && (AREAS[area]?.subs[sub]?.walkable ?? true);

// bridge: a walkable deck over a water cell (only valid when area is water).
// lamp:   the cell's street lamp is switched on ("Lit lamp"). Only street
//         cells with a lamp (T-junctions and crossings) can have one; it
//         lights the cell fully and spills dimmer light onto its neighbours.
// lit:    the cell holds a light source of the given `radius` (in cells).
export const defaultCell = () => ({
  area: 'outdoor', sub: 'ground', lit: false, radius: 0, walkable: true, bridge: false, lamp: false,
});

// --- light ---------------------------------------------------------------------
// A light source lights cells within its radius (cell-centre distance) that it
// can see: walls block light; windows and (open) doors let it through.
// Brightness falls off linearly from the centre to 1 / (radius + 1) of it at
// the edge, and the centre is brighter for bigger lights, so a radius under 1
// is a candle or dim bulb lighting only its own cell, and radius 3+ a floodlight.
export const MAX_RADIUS = 6;
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
    return c.sub === 'street' || c.bridge;
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

// Street lamps stand at intersections: street cells open on 3 or 4 sides.
export function hasStreetLamp(grid, x, y) {
  if (!grid.inBounds(x, y) || grid.cells[grid.index(x, y)].sub !== 'street') return false;
  let mask = streetMask(grid, x, y), n = 0;
  while (mask) { n += mask & 1; mask >>= 1; }
  return n >= 3;
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
export const EDGE_TYPES = ['wall', 'door', 'lockedDoor', 'oneWayDoor+', 'oneWayDoor-', 'window'];
export const isDoor = (t) => t === 'door' || t === 'lockedDoor' || t?.startsWith('oneWayDoor');
export const blocksLight = (t) => t === 'wall' || t === 'lockedDoor' || !!t?.startsWith('oneWayDoor');
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
    walkable: c.walkable === undefined ? defaultWalkable(area, sub) || (water && !!c.bridge) : !!c.walkable,
    bridge: water && !!c.bridge,
    lamp: !!c.lamp,
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
    this.stroke = null; // Map<index, cellSnapshotBeforeStroke>
    this.strokeEdges = null; // Map<edgeKey, typeBeforeStroke>
    this.listeners = new Set();
  }

  index(x, y) { return y * this.cols + x; }
  coords(i) { return { x: i % this.cols, y: Math.floor(i / this.cols) }; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // `resized` tells listeners the board dimensions changed (rebuild needed).
  emit(indices, resized = false) { for (const fn of this.listeners) fn(indices, resized); }

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
    const n = { bridge: 0, lit: 0, unlit: 0, walkable: 0, blocked: 0, wall: 0, door: 0, window: 0, lamp: 0, subs: {} };
    for (const a in AREAS) n[a] = 0;
    for (const c of this.cells) {
      n[c.area]++;
      if (c.sub) n.subs[c.sub] = (n.subs[c.sub] ?? 0) + 1;
      if (c.bridge) n.bridge++;
      c.lit ? n.lit++ : n.unlit++;
      c.walkable ? n.walkable++ : n.blocked++;
    }
    n.lockedDoor = 0;
    n.oneWayDoor = 0;
    for (const t of this.edges.values()) n[edgeKind(t)]++;
    this.cells.forEach((_, i) => { if (this.lampOn(i)) n.lamp++; });
    return n;
  }

  isWater(x, y) { return this.inBounds(x, y) && this.cells[this.index(x, y)].area === 'water'; }

  // Is this cell's street lamp switched on? (A lamp flag left on a cell that
  // is no longer an intersection does nothing.)
  lampOn(i) {
    if (!this.cells[i].lamp) return false;
    const { x, y } = this.coords(i);
    return hasStreetLamp(this, x, y);
  }

  // Light level per cell, 0..1, from every light source (lit cells and
  // switched-on street lamps). Overlapping lights add up like real light
  // (1 - (1-a)(1-b)), and walls block it.
  lightLevels() {
    const out = new Float32Array(this.cells.length);
    const add = (j, v) => { out[j] = 1 - (1 - out[j]) * (1 - v); };
    this.cells.forEach((c, i) => {
      const lamp = this.lampOn(i);
      if (!c.lit && !lamp) return;
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
    return out;
  }

  // --- movement ---------------------------------------------------------------
  // Movement rules: you can only enter walkable cells; walls, windows and
  // locked doors can't be crossed; unlocked doors can be crossed both ways;
  // one-way doors only in their direction ('+' = toward east/south).

  // Can you cross the edge between (x, y) and the orthogonal neighbour
  // (x + dx, y + dy)?
  canCross(x, y, dx, dy) {
    const [o, ex, ey] = dx ? ['v', dx > 0 ? x + 1 : x, y] : ['h', x, dy > 0 ? y + 1 : y];
    const t = this.edges.get(edgeKey(o, ex, ey));
    if (!t || t === 'door') return true;
    if (t === 'oneWayDoor+') return dx > 0 || dy > 0;
    if (t === 'oneWayDoor-') return dx < 0 || dy < 0;
    return false; // wall, window, locked door
  }

  canEnter(x, y) { return this.inBounds(x, y) && this.cells[this.index(x, y)].walkable; }

  // One move from (x, y) by (dx, dy). Diagonal moves need both ways round
  // the corner to be clear, so you can't squeeze between two walls.
  canStep(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!this.canEnter(nx, ny)) return false;
    if (!dx || !dy) return this.canCross(x, y, dx, dy);
    const viaX = this.canEnter(x + dx, y) && this.canCross(x, y, dx, 0) && this.canCross(x + dx, y, 0, dy);
    const viaY = this.canEnter(x, y + dy) && this.canCross(x, y, 0, dy) && this.canCross(x, y + dy, dx, 0);
    return viaX && viaY;
  }

  // Breadth-first moves from a cell. Returns { dist: Int32Array (-1 =
  // unreachable), prev: Int32Array } over the board.
  moveField(sx, sy, { diagonal = false, maxSteps = Infinity } = {}) {
    const n = this.cells.length;
    const dist = new Int32Array(n).fill(-1);
    const prev = new Int32Array(n).fill(-1);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (diagonal) dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    const start = this.index(sx, sy);
    dist[start] = 0;
    const queue = [start];
    for (let k = 0; k < queue.length; k++) {
      const i = queue[k];
      if (dist[i] >= maxSteps) continue;
      const { x, y } = this.coords(i);
      for (const [dx, dy] of dirs) {
        if (!this.canStep(x, y, dx, dy)) continue;
        const j = this.index(x + dx, y + dy);
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1;
        prev[j] = i;
        queue.push(j);
      }
    }
    return { dist, prev };
  }

  // Shortest route between two cells as a list of cell indices (start
  // first), or null if there is none.
  route(sx, sy, tx, ty, opts = {}) {
    const { dist, prev } = this.moveField(sx, sy, opts);
    let i = this.index(tx, ty);
    if (dist[i] < 0) return null;
    const out = [];
    for (; i >= 0; i = prev[i]) out.push(i);
    return out.reverse();
  }

  // Can light travel in a straight line from the centre of cell (ax, ay) to
  // the centre of (bx, by)? Walks the grid cells along the line and checks
  // each edge it crosses: a wall blocks; doors and windows don't. Passing
  // exactly through a grid corner is clear if either way round is clear.
  lightReaches(ax, ay, bx, by) {
    const blocks = (o, x, y) => blocksLight(this.edges.get(edgeKey(o, x, y)));
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
      // Row-major, y = row (1..26 on the board), x = column (A..T).
      cells: this.cells.map((c, i) => {
        const { x, y } = this.coords(i);
        return {
          x, y, id: cellLabel(x, y),
          area: c.area, sub: c.sub, walkable: c.walkable, bridge: c.bridge,
          lit: c.lit, // light source here
          ...(c.lit ? { radius: c.radius } : {}),
          lamp: this.lampOn(i),
          light: Math.round(levels[i] * 100) / 100, // 0..1 incl. lamp spill
          ...(c.bridge ? { bridgeAxis: this.bridgeAxis(x, y) } : {}),
        };
      }),
      // Walls and doors on cell edges. "v" = west side of cell (x, y);
      // "h" = north side of cell (x, y). `between` names the two cells
      // (an off-board cell is null). Doors sit centred on their edge.
      edges: [...this.edges].map(([k, type]) => {
        const { o, x, y } = parseEdgeKey(k);
        const between = this.edgeCells(o, x, y).map((c) => (this.inBounds(c.x, c.y) ? cellLabel(c.x, c.y) : null));
        const out = { edge: o, x, y, type: edgeKind(type), between };
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
    const cols = clampSize(data.cols ?? COLS, COLS);
    const rows = clampSize(data.rows ?? ROWS, ROWS);
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
      if (!['v', 'h'].includes(e.edge) || !EDGE_TYPES.includes(type)) continue;
      const fits = e.edge === 'v' ? e.x >= 0 && e.x <= cols && e.y >= 0 && e.y < rows : e.x >= 0 && e.x < cols && e.y >= 0 && e.y <= rows;
      if (Number.isInteger(e.x) && Number.isInteger(e.y) && fits) edges.set(edgeKey(e.edge, e.x, e.y), type);
    }
    return { cols, rows, cells, edges };
  }

  // Load parsed data without touching undo history (used at startup).
  load({ cols, rows, cells, edges }) {
    this.#restore({ cols, rows, cells, edges: edges ?? new Map() });
  }
}
