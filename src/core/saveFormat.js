// Saved games. A save holds the rules state (src/game/rules.js: plain JSON,
// including the seeded random-number state, so a loaded game continues
// exactly as it would have) and a full copy of the map it is played on, so
// editing or deleting that map later never breaks the save.
//
//   { format: 'midnight-shift-save', version: 1, savedAt, name,
//     map: <map file>, state: <rules state>, view?: <optional UI extras> }
//
// The rules state is the complete truth, secrets included (the hidden monster,
// the face-down evidence). That is fine for a local single-player save; a
// multiplayer host keeps saves to itself and sends players publicState().
import { readMap, writeMap } from './mapFormat.js';

export const SAVE_FORMAT = 'midnight-shift-save';
export const SAVE_VERSION = 1;

// Throws if `value` can't survive JSON (Map, Set, functions, NaN...): a save
// must load back exactly as it was written.
export function assertPlain(value, path = 'state') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} is ${value}, which a save can't store.`);
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => assertPlain(v, `${path}[${i}]`)); return; }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [k, v] of Object.entries(value)) if (v !== undefined) assertPlain(v, `${path}.${k}`);
    return;
  }
  if (value === undefined) return;
  throw new Error(`${path} is a ${value?.constructor?.name ?? typeof value}, which a save can't store.`);
}

// Build a save. `map` is a GridState or a map file object.
export function makeSave({ map, state, name = '', view = null, savedAt = new Date().toISOString(), mapMeta = null }) {
  assertPlain(state);
  if (view) assertPlain(view, 'view');
  const mapJson = typeof map?.toJSON === 'function' ? writeMap(map, mapMeta ?? undefined) : map;
  if (!mapJson || !Array.isArray(mapJson.cells)) throw new Error('A save needs the map it is played on.');
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt,
    name: String(name || '').slice(0, 80),
    map: mapJson,
    state: structuredCloneJSON(state),
    ...(view ? { view: structuredCloneJSON(view) } : {}),
  };
}

// Read a save (object or JSON text). Returns { map: { data, meta }, state,
// view, name, savedAt }. `rulesVersion` is the engine's RULES_VERSION: a save
// from a newer engine is refused; older ones go through upgradeState().
export function readSave(input, { rulesVersion, migrate } = {}) {
  let json = input;
  if (typeof input === 'string') {
    try { json = JSON.parse(input); } catch { throw new Error('This file is not valid JSON.'); }
  }
  if (!json || json.format !== SAVE_FORMAT) throw new Error('This is not a saved game.');
  if (!Number.isInteger(json.version) || json.version > SAVE_VERSION) {
    throw new Error(`This save was made with a newer version (save format ${json.version}).`);
  }
  if (!json.state || typeof json.state !== 'object') throw new Error('This save has no game in it.');
  const map = readMap(json.map);
  const state = upgradeState(structuredCloneJSON(json.state), rulesVersion, migrate);
  return { map, state, view: json.view ?? null, name: json.name ?? '', savedAt: json.savedAt ?? null };
}

// Bring an older rules state up to date: refuse a newer one, and pass older
// ones through the engine's `migrate` (rules.js migrateState), which has one
// step per rules version so old saves keep loading.
export function upgradeState(state, rulesVersion, migrate) {
  const v = Number.isInteger(state.version) ? state.version : 1;
  if (rulesVersion !== undefined && v > rulesVersion) {
    throw new Error(`This save comes from a newer version of the game rules (${v}); this app knows up to ${rulesVersion}.`);
  }
  return migrate && v < (rulesVersion ?? v) ? migrate(state) : state;
}

const structuredCloneJSON = (v) => JSON.parse(JSON.stringify(v));
