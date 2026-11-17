// Grid data model: cell attributes, strokes with undo/redo, and (de)serialization.

export const COLS = 20;
export const ROWS = 26;
export const FORMAT_VERSION = 2;
export const MIN_SIZE = 4;
export const MAX_SIZE = 60;
const clampSize = (n, fallback) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : fallback;
};

// Space categories and their subcategories. Add a subcategory here (e.g.
// outdoor: road / grass, indoor: hardwood) and it is accepted everywhere:
// painting, saving, importing. `sub` is null for categories without one.
export const AREAS = {
  outdoor: { label: 'Outdoor', subs: {} },
  indoor: { label: 'Indoor', subs: {} },
  water: { label: 'Water', subs: { lake: { label: 'Lake' }, river: { label: 'River' } } },
};
export const CELL_KEYS = ['area', 'sub', 'lit', 'walkable', 'bridge'];

// bridge: a walkable deck over a water cell (only valid when area is water).
export const defaultCell = () => ({ area: 'outdoor', sub: null, lit: false, walkable: true, bridge: false });

// Normalise any saved cell (format v1 used `indoor: bool`) into the current shape.
export function normalizeCell(c = {}) {
  let area = typeof c.area === 'string' && AREAS[c.area] ? c.area : (c.indoor ? 'indoor' : 'outdoor');
  const subs = Object.keys(AREAS[area].subs);
  let sub = subs.includes(c.sub) ? c.sub : (subs[0] ?? null);
  const water = area === 'water';
  return {
    area,
    sub,
    lit: !!c.lit,
    walkable: c.walkable === undefined ? !water || !!c.bridge : !!c.walkable,
    bridge: water && !!c.bridge,
  };
}

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
    this.stroke = null; // Map<index, cellSnapshotBeforeStroke>
    this.listeners = new Set();
  }

  index(x, y) { return y * this.cols + x; }
  coords(i) { return { x: i % this.cols, y: Math.floor(i / this.cols) }; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // `resized` tells listeners the board dimensions changed (rebuild needed).
  emit(indices, resized = false) { for (const fn of this.listeners) fn(indices, resized); }

  // --- strokes -------------------------------------------------------------

  beginStroke() { this.stroke = new Map(); }

  // Apply a patch (any of CELL_KEYS) to one cell, or a function
  // (cell) => patch|null. Records undo info when inside a stroke.
  // Returns true if anything changed.
  apply(i, patch, { silent = false } = {}) {
    const cell = this.cells[i];
    if (typeof patch === 'function') patch = patch(cell);
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
    if (touched.length) this.emit(touched);
  }

  endStroke() {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke || stroke.size === 0) return;
    const entries = [];
    for (const [i, before] of stroke) {
      const after = { ...this.cells[i] };
      if (CELL_KEYS.some((k) => before[k] !== after[k])) {
        entries.push({ i, before, after });
      }
    }
    if (!entries.length) return;
    this.undoStack.push(entries);
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
    for (const e of entries) Object.assign(this.cells[e.i], e[which]);
    this.emit(entries.map((e) => e.i));
    return true;
  }

  #snapshot() {
    return { cols: this.cols, rows: this.rows, cells: this.cells.map((c) => ({ ...c })) };
  }

  #restore(snap) {
    const resized = snap.cols !== this.cols || snap.rows !== this.rows;
    this.cols = snap.cols;
    this.rows = snap.rows;
    this.cells = snap.cells.map((c) => ({ ...c }));
    this.emit(this.cells.map((_, i) => i), resized);
  }

  // Replace the whole board (optionally with new dimensions) as one undoable step.
  replaceAll(cols, rows, cells) {
    const before = this.#snapshot();
    const after = { cols, rows, cells: cells.map((c) => ({ ...c })) };
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

  counts() {
    const n = { outdoor: 0, indoor: 0, lake: 0, river: 0, bridge: 0, lit: 0, unlit: 0, walkable: 0, blocked: 0 };
    for (const c of this.cells) {
      n[c.sub ?? c.area]++;
      if (c.bridge) n.bridge++;
      c.lit ? n.lit++ : n.unlit++;
      c.walkable ? n.walkable++ : n.blocked++;
    }
    return n;
  }

  isWater(x, y) { return this.inBounds(x, y) && this.cells[this.index(x, y)].area === 'water'; }

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
          area: c.area, sub: c.sub, lit: c.lit, walkable: c.walkable, bridge: c.bridge,
          ...(c.bridge ? { bridgeAxis: this.bridgeAxis(x, y) } : {}),
        };
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
    return { cols, rows, cells };
  }

  // Load parsed data without touching undo history (used at startup).
  load({ cols, rows, cells }) {
    this.#restore({ cols, rows, cells });
  }
}
