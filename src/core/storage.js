// Where maps, saved games and preferences live. One interface over a simple
// key-value backend, so the same code runs:
//   - in the browser (localStorage; what the planner uses today),
//   - in a desktop build (a file backend writing to a folder such as
//     Documents/Midnight Shift; to be added with the desktop app),
//   - in tests (memoryBackend).
//
// A backend is { get(key) -> string|null, set(key, string), remove(key), keys() -> string[] }.
// Every call is wrapped: storage that is blocked or full never crashes the
// app; writes report false instead.
import { normalizeMeta, newId } from './mapFormat.js';

const NS = 'minty-pickle';
// The planner's own board (autosaved on every change). Kept at the key it has
// always used so existing boards carry over.
export const PLANNER_BOARD_KEY = 'minty-pickle.grid.v1';

export function memoryBackend(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: (k) => (m.has(k) ? m.get(k) : null),
    set: (k, v) => { m.set(k, String(v)); },
    remove: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

export function browserBackend(ls = globalThis.localStorage) {
  return {
    get: (k) => ls.getItem(k),
    set: (k, v) => ls.setItem(k, v),
    remove: (k) => ls.removeItem(k),
    keys: () => Array.from({ length: ls.length }, (_, i) => ls.key(i)),
  };
}

export function createStorage(backend = safeDefaultBackend()) {
  const get = (k) => { try { return backend.get(k); } catch { return null; } };
  const set = (k, v) => { try { backend.set(k, v); return true; } catch { return false; } };
  const remove = (k) => { try { backend.remove(k); return true; } catch { return false; } };
  const getJSON = (k, fallback = null) => { try { const s = get(k); return s === null ? fallback : JSON.parse(s); } catch { return fallback; } };
  const setJSON = (k, v) => set(k, JSON.stringify(v));

  // A library of records (maps or saves): an index of summaries plus one key
  // per record, so listing never has to read every record.
  function library(kind, summarize) {
    const indexKey = `${NS}.${kind}.index`;
    const itemKey = (id) => `${NS}.${kind}.${id}`;
    const index = () => getJSON(indexKey, []).filter((e) => e && typeof e.id === 'string');
    return {
      // Summaries, newest first.
      list: () => index().sort((a, b) => String(b.updated).localeCompare(String(a.updated))),
      get: (id) => getJSON(itemKey(id)),
      // Store a record; returns its id (or null if storage refused it).
      put(record, id = record?.meta?.id ?? newId(kind.slice(0, -1))) {
        if (!setJSON(itemKey(id), record)) return null;
        const entry = { id, ...summarize(record), updated: new Date().toISOString() };
        setJSON(indexKey, [...index().filter((e) => e.id !== id), entry]);
        return id;
      },
      remove(id) {
        remove(itemKey(id));
        setJSON(indexKey, index().filter((e) => e.id !== id));
      },
    };
  }

  return {
    // User-made maps (map files with meta).
    maps: library('maps', (map) => {
      const meta = normalizeMeta(map?.meta ?? {});
      return { name: meta.name, cols: map?.cols, rows: map?.rows };
    }),
    // Saved games (save files).
    saves: library('saves', (save) => ({ name: save?.name || 'Saved game', savedAt: save?.savedAt ?? null })),
    // The planner's working board.
    plannerBoard: {
      get: () => get(PLANNER_BOARD_KEY),
      set: (json) => set(PLANNER_BOARD_KEY, typeof json === 'string' ? json : JSON.stringify(json)),
    },
    // Small preferences (namespaced).
    prefs: {
      get: (key, fallback = null) => getJSON(`${NS}.pref.${key}`, fallback),
      set: (key, value) => setJSON(`${NS}.pref.${key}`, value),
    },
  };
}

function safeDefaultBackend() {
  try {
    const ls = globalThis.localStorage;
    if (ls) { ls.getItem('__probe__'); return browserBackend(ls); }
  } catch { /* blocked (private mode, sandbox): fall back to memory */ }
  return memoryBackend();
}
