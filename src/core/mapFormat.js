// Map files: the board JSON the planner has always exported, plus optional
// details about the map (name, description, dates). One format for the
// planner, the future in-game editor, the map library and gameplay saves.
//
//   { format: 'minty-pickle-grid', version: 3, cols, rows, terrain, cells, edges,
//     meta?: { id, name, description, created, updated } }
//
// Older files (version 1 and 2) still load: GridState.parse upgrades them.
// A file from a newer version of the app is refused with a clear message
// rather than half-loaded.
import { GridState, FORMAT_VERSION } from './state.js';

export const MAP_FORMAT = 'minty-pickle-grid';
export const MAP_VERSION = FORMAT_VERSION;

// A short unique id for a map or a save.
export function newId(prefix = 'map') {
  const rand = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0');
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

// Clean map details (unknown fields dropped, sensible defaults).
export function normalizeMeta(meta = {}, now = new Date().toISOString()) {
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    id: text(meta.id, 80) || newId('map'),
    name: text(meta.name, 80) || 'Untitled map',
    description: text(meta.description, 2000),
    created: text(meta.created, 40) || now,
    updated: text(meta.updated, 40) || now,
  };
}

// A grid (GridState) as a map file object. `meta` is optional.
export function writeMap(grid, meta) {
  const json = grid.toJSON();
  return meta ? { ...json, meta: normalizeMeta(meta) } : json;
}

// Read a map file (object or JSON text). Returns { data, meta } where `data`
// is what GridState.load() takes and `meta` the map's details (or null).
// Throws an Error with a readable message if it isn't a usable map.
export function readMap(input) {
  let json = input;
  if (typeof input === 'string') {
    try { json = JSON.parse(input); } catch { throw new Error('This file is not valid JSON.'); }
  }
  if (!json || typeof json !== 'object') throw new Error('This is not a map file.');
  if (json.format === SAVE_FORMAT_HINT) throw new Error('This is a saved game, not a map. Load it from the game instead.');
  if (json.format !== undefined && json.format !== MAP_FORMAT) throw new Error(`Unknown file format "${json.format}".`);
  if (Number.isInteger(json.version) && json.version > MAP_VERSION) {
    throw new Error(`This map was made with a newer version (format ${json.version}); this app reads up to ${MAP_VERSION}.`);
  }
  const data = new GridState().parse(json);
  return { data, meta: json.meta ? normalizeMeta(json.meta) : null };
}

// A fresh GridState holding the map.
export function gridFromMap(input) {
  const { data, meta } = readMap(input);
  const grid = new GridState(data.cols, data.rows);
  grid.load(data);
  return { grid, meta };
}

// Saves name their format here so readMap can say what went wrong.
const SAVE_FORMAT_HINT = 'midnight-shift-save';
