// Doors changed during a game, on top of the map's own (state.doors):
//   'blocked'   nailed shut, chained, or blocked by an event (Nailed Shut, Roof
//               Collapse): a wall to everyone, players and monsters, until it
//               is Breached.
//   'breached'  destroyed (Breach): an open doorway for good, to everyone;
//               nothing can close it again.
//   'open'      (events) unlocked for players.
// Players' movement adds Lockdown and the like on top (eventPlay.doorOverride).
import { edgeKey, isDoor } from '../core/state.js';

// Any kind of door: plain, locked, one-way, or boarded up (condemned).
export const anyDoor = (t) => isDoor(t) || t === 'boardedDoor';

// What everyone (monsters included) sees: blocked doors are walls, breached
// ones open doorways, and locked or one-way doors whose key the investigators
// have found stand open (for monsters too: they carry no keys of their own).
// Read live, so a door changed mid-action counts at once.
export function gameDoorOverride(state, board = null) {
  return (k, t) => {
    if (!t || t === 'wall' || t === 'window' || t === 'boardedWindow') return t;
    const s = state.doors?.[k];
    if (s === 'breached') return 'door';
    if (s === 'blocked') return 'wall';
    if (state.keys && board && (t === 'lockedDoor' || t.startsWith('oneWayDoor'))
      && ((board.keyGroups().edgeMask.get(k) ?? 0) & state.keys)) return 'door';
    return t;
  };
}

// Block a door (nails, a chain, an event), unless it has been breached.
// Returns true if it is now blocked.
export function blockDoor(state, k) {
  state.doors ??= {};
  if (state.doors[k] === 'breached') return false;
  state.doors[k] = 'blocked';
  return true;
}

// Every door between a building (the indoor cells joined to `cell`) and the
// outside: edge keys. The White Lady's Block (all doors).
export function buildingDoors(board, cell) {
  const g = board.grid;
  if (g.cells[cell]?.area !== 'indoor') return [];
  const seen = new Set([cell]);
  const queue = [cell];
  const out = new Set();
  for (let q = 0; q < queue.length; q++) {
    const { x, y } = g.coords(queue[q]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = dx ? edgeKey('v', dx > 0 ? x + 1 : x, y) : edgeKey('h', x, dy > 0 ? y + 1 : y);
      const inB = g.inBounds(x + dx, y + dy) && g.cells[g.index(x + dx, y + dy)].area === 'indoor';
      if (anyDoor(g.edgeAt(k)) && !inB) out.add(k);
      if (inB) {
        const j = g.index(x + dx, y + dy);
        if (!seen.has(j)) { seen.add(j); queue.push(j); }
      }
    }
  }
  return [...out];
}

// The doors on the sides of a cell: [{ edge, side, type, status }] where side
// is north/east/south/west and status is the game's change (or null).
const SIDES = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];
export function doorsAround(state, board, cell) {
  const g = board.grid;
  const { x, y } = g.coords(cell);
  const out = [];
  for (const [dx, dy, side] of SIDES) {
    const k = dx ? edgeKey('v', dx > 0 ? x + 1 : x, y) : edgeKey('h', x, dy > 0 ? y + 1 : y);
    const t = g.edgeAt(k);
    if (!anyDoor(t)) continue;
    out.push({ edge: k, side, type: t, status: state.doors?.[k] ?? null });
  }
  return out;
}
