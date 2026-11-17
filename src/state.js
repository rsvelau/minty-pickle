// Grid data model: cell attributes, strokes with undo/redo, and (de)serialization.

export const COLS = 20;
export const ROWS = 26;
export const FORMAT_VERSION = 1;
export const MIN_SIZE = 4;
export const MAX_SIZE = 60;
const clampSize = (n, fallback) => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, v)) : fallback;
};

export const defaultCell = () => ({ indoor: false, lit: false, walkable: true });

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

  // Apply a patch ({indoor?, lit?, walkable?}) to one cell. Records undo info
  // when inside a stroke. Returns true if anything changed.
  apply(i, patch, { silent = false } = {}) {
    const cell = this.cells[i];
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
      if (before.indoor !== after.indoor || before.lit !== after.lit || before.walkable !== after.walkable) {
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
    const n = { indoor: 0, outdoor: 0, lit: 0, unlit: 0, walkable: 0, blocked: 0 };
    for (const c of this.cells) {
      c.indoor ? n.indoor++ : n.outdoor++;
      c.lit ? n.lit++ : n.unlit++;
      c.walkable ? n.walkable++ : n.blocked++;
    }
    return n;
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
        return { x, y, id: cellLabel(x, y), indoor: c.indoor, lit: c.lit, walkable: c.walkable };
      }),
    };
  }

  // Parse saved data into { cols, rows, cells } (does not mutate state).
  // Files without dimensions are read as the default 20 x 26 board.
  parse(data) {
    if (!data || !Array.isArray(data.cells)) throw new Error('Not a grid file: missing "cells".');
    const cols = clampSize(data.cols ?? COLS, COLS);
    const rows = clampSize(data.rows ?? ROWS, ROWS);
    const cells = Array.from({ length: cols * rows }, defaultCell);
    data.cells.forEach((c, n) => {
      const x = Number.isInteger(c.x) ? c.x : n % cols;
      const y = Number.isInteger(c.y) ? c.y : Math.floor(n / cols);
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      cells[y * cols + x] = { indoor: !!c.indoor, lit: !!c.lit, walkable: c.walkable !== false };
    });
    return { cols, rows, cells };
  }

  // Load parsed data without touching undo history (used at startup).
  load({ cols, rows, cells }) {
    this.#restore({ cols, rows, cells });
  }
}
