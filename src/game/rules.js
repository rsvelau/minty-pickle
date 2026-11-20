// Game rules: the whole game as plain data, with no three.js, DOM or timing.
//
// - State is a JSON-serialisable object (newGame). It can be saved, sent over
//   the network or run on a server unchanged.
// - Players change it only through actions (applyAction), plain objects like
//   { type: 'roll', seat: 0 }. Actions carrying a `seat` that isn't the
//   current player are rejected, so a server can trust clients this way.
// - All randomness (dice, Obol draws, monster choices) comes from a seeded
//   generator stored in the state, so whoever applies an action (one host or
//   server) decides every roll, and a replay of the same actions from the
//   same seed gives the same game.
// - applyAction returns `events` describing what happened in order (steps,
//   pickups, rolls, midnight, monster moves...). The 3D view animates them;
//   the rules never wait for animation.
//
// The board is read through a small adapter (see board.js) over GridState,
// which is plain data too, so a server can rebuild it from the saved board.
import { MARKERS, streetMask, edgeKey, cellLabel } from '../state.js';
import { MONSTERS, spawnMonsters, monstersAct } from './monsters.js';

export const RULES_VERSION = 1;

// Seats: name and colour (also used by the 3D figures).
export const SEATS = [
  { name: 'P1', colour: '#18b7a6' },
  { name: 'P2', colour: '#e0407e' },
  { name: 'P3', colour: '#f0b52a' },
  { name: 'P4', colour: '#7a54e8' },
];

// Game configuration: the adjustable mechanics (Game settings in the UI).
// - players: 1 (solo) to 4.
// - Dice: everyone starts with `startBlack` black dice (renew each turn);
//   `moveSlots` movement slots, or `litSlots` when the turn starts in a cell
//   lit at least `litThreshold` (0..1).
// - Clock: each turn (every player moving once) is `turnMinutes`; midnight
//   comes after `turnsToMidnight` turns (11 PM with the defaults). Objective
//   markers stay hidden until midnight.
// - Markers: `stopAtMarkers` stops the runner on every marker to choose a
//   way on; `askInvestigate` asks "Investigate?" on Investigation spaces.
// - Obols: the bag investigators draw from, by type.
// - monster: which monster appears at midnight ('none' or a MONSTERS id).
export const DEFAULT_CONFIG = Object.freeze({
  players: 4,
  startBlack: 2,
  moveSlots: 2,
  litSlots: 3,
  litThreshold: 0.5,
  turnMinutes: 5,
  turnsToMidnight: 12,
  stopAtMarkers: true,
  askInvestigate: true,
  obols: Object.freeze({ attack: 7, event: 7, equipment: 7, evidence: 7 }),
  monster: 'none',
});
export const defaultConfig = () => ({ ...DEFAULT_CONFIG, obols: { ...DEFAULT_CONFIG.obols } });

// Obols: coins drawn at random when investigating.
export const OBOLS = {
  attack: { label: 'Attack', note: 'bloody red' },
  event: { label: 'Event', note: 'misty blue' },
  equipment: { label: 'Equipment', note: 'shiny green' },
  evidence: { label: 'Evidence', note: 'glowing yellow' },
};
export const OBOL_TYPES = Object.keys(OBOLS);
export const obolCounts = (pl) => Object.fromEntries(
  OBOL_TYPES.map((t) => [t, pl?.inventory?.obolcraft.filter((o) => o.type === t).length ?? 0]));
export const INVENTORY_TABS = {
  equipment: { label: 'Equipment', empty: 'No equipment yet. Anything you find to use will be kept here.' },
  obolcraft: { label: 'Obolcraft', empty: 'No Obols yet. Investigate to find them.' },
};

export const MIDNIGHT = 24 * 60;
// "11:05 PM", "12:00 AM".
export function formatClock(min) {
  const h24 = Math.floor(min / 60) % 24, mm = min % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}
export const startMinutes = (state) => MIDNIGHT - state.config.turnMinutes * state.config.turnsToMidnight;
export const clockMinutes = (state) => startMinutes(state) + (state.round - 1) * state.config.turnMinutes;
export const isMidnight = (state) => state.round > state.config.turnsToMidnight;

// --- randomness ----------------------------------------------------------------
// mulberry32: small, fast, good enough for dice; the state is one uint32.
export function random(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const randInt = (state, n) => Math.floor(random(state) * n);
const d6 = (state) => 1 + randInt(state, 6);

// --- directions --------------------------------------------------------------------
export const DIRS = [[0, -1, 'north', 1], [1, 0, 'east', 2], [0, 1, 'south', 4], [-1, 0, 'west', 8]];

// --- new game ---------------------------------------------------------------------
// setup: { config, startMode: 'standard' | 'midnight', seed, followStreets }
export function newGame(board, setup = {}) {
  const config = structuredClone({ ...defaultConfig(), ...(setup.config ?? {}) });
  config.players = Math.max(1, Math.min(4, config.players | 0 || 4));
  const start = board.startCell();
  const state = {
    version: RULES_VERSION,
    config,
    startMode: setup.startMode === 'midnight' ? 'midnight' : 'standard',
    followStreets: setup.followStreets ?? true,
    rng: (setup.seed ?? Date.now()) >>> 0,
    players: SEATS.slice(0, config.players).map((s, seat) => ({
      seat, name: s.name, colour: s.colour,
      pos: start, prev: -1,
      white: 0,                                 // white dice in reserve (unrolled)
      inventory: { equipment: [], obolcraft: [] },
    })),
    cur: 0,
    phase: start >= 0 ? 'idle' : 'nostart',   // idle | slotting | moving | choosing | asking | nostart
    steps: 0,
    roll: 0,
    options: [],
    turn: 0,
    round: 1,
    keys: 0,                // key groups picked up by anyone (bitmask)
    blackCount: config.startBlack,
    pool: [], slots: [], maxSlots: config.moveSlots, lit: false,
    ask: null,
    bag: OBOL_TYPES.flatMap((t) => Array(Math.max(0, config.obols[t] | 0)).fill(t)),
    used: [],               // marker cells used up (cell indices)
    stopAt: -1,
    stopReason: '',
    monsters: [],
    log: [],
  };
  if (state.startMode === 'midnight') state.round = config.turnsToMidnight + 1;
  const events = [{ type: 'start' }];
  if (start >= 0) {
    log(state, (state.startMode === 'midnight' ? 'Midnight. The town is waiting, and the objectives are out. ' : '') +
      `${config.players === 1 ? 'Playing solo: P1 is' : `${config.players} players`} ready on the Start space ` +
      `(${label(board, start)}), in the van's headlights: starting light ${Math.round(board.light[start] * 100)}%. ` +
      `${who(state)} rolls first.`);
    enter(state, board, start, events);
    state.ask = null;
    state.stopAt = -1;
    if (isMidnight(state)) spawnMonsters(state, board, events, random, log);
  }
  return { state, events };
}

// --- actions ------------------------------------------------------------------------
// Every action: { type, seat? }. Returns { ok, error?, events }.
export const ACTIONS = ['roll', 'slot', 'rollWhite', 'move', 'choose', 'investigate'];

export function applyAction(state, board, action) {
  const events = [];
  const fail = (error) => ({ ok: false, error, events: [] });
  if (!action || !ACTIONS.includes(action.type)) return fail('unknown action');
  if (action.seat !== undefined && action.seat !== state.cur) return fail('not your turn');
  switch (action.type) {
    case 'roll': {
      if (state.phase !== 'idle') return fail('cannot roll now');
      state.pool = Array.from({ length: state.blackCount }, () => ({ kind: 'black', v: d6(state) }));
      state.slots = [];
      state.lit = (board.light[curPlayer(state).pos] ?? 0) >= state.config.litThreshold;
      state.maxSlots = state.lit ? Math.max(state.config.litSlots, state.config.moveSlots) : state.config.moveSlots;
      state.roll = 0;
      state.phase = 'slotting';
      state.turn++;
      log(state, `${who(state)} rolled black ${state.pool.map((d) => d.v).join(', ')}. ` +
        `${state.maxSlots} movement slots${state.lit ? ' (standing in light)' : ''}.`);
      events.push({ type: 'rolled', seat: state.cur, pool: state.pool.map((d) => ({ ...d })) });
      break;
    }
    case 'slot': {
      // Toggle a rolled die (index into pool) in or out of the movement slots.
      const n = action.die | 0;
      if (state.phase !== 'slotting' || !state.pool[n]) return fail('no such die');
      const at = state.slots.indexOf(n);
      if (at >= 0) state.slots.splice(at, 1);
      else if (state.slots.length < state.maxSlots) state.slots.push(n);
      else return fail('slots full');
      break;
    }
    case 'rollWhite': {
      // Take a white die out of reserve and roll it: usable this turn only.
      const pl = curPlayer(state);
      if (state.phase !== 'slotting' || pl.white <= 0) return fail('no white dice');
      pl.white--;
      const v = d6(state);
      state.pool.push({ kind: 'white', v });
      log(state, `${who(state)} rolled a white die from reserve: ${v} (${pl.white} left in reserve).`);
      events.push({ type: 'rolledWhite', seat: state.cur, v });
      break;
    }
    case 'move': {
      // Lock in the slotted dice and move that many cells (0 = stay put).
      if (state.phase !== 'slotting') return fail('not slotting');
      const used = state.slots.map((n) => state.pool[n]);
      const rolledWhite = state.pool.filter((d) => d.kind === 'white').length;
      const discarded = rolledWhite - used.filter((d) => d.kind === 'white').length;
      state.roll = used.reduce((a, d) => a + d.v, 0);
      state.steps = state.roll;
      curPlayer(state).prev = -1;
      state.pool = [];
      state.slots = [];
      if (discarded) log(state, `${who(state)} discards ${discarded} unused white ${discarded === 1 ? 'die' : 'dice'}.`);
      if (!state.roll) {
        log(state, `${who(state)} stays put.`);
        nextPlayer(state, board, events);
        break;
      }
      log(state, `${who(state)} moves ${state.roll} (${used.map((d) => `${d.kind} ${d.v}`).join(' + ')}).`);
      state.phase = 'moving';
      advance(state, board, events);
      break;
    }
    case 'choose': {
      if (state.phase !== 'choosing') return fail('not choosing');
      const o = state.options.find((p) => p.i === action.cell);
      if (!o) return fail('not an option');
      step(state, board, o, events);
      break;
    }
    case 'investigate': {
      // The answer to "Investigate?": yes draws an Obol; no runs on through.
      if (state.phase !== 'asking' || !state.ask) return fail('nothing to investigate');
      const { i } = state.ask;
      state.ask = null;
      if (action.yes) investigate(state, board, i, events);
      else {
        log(state, `${who(state)} passes the investigation spot at ${label(board, i)}.`);
        state.stopAt = -1;
        state.stopReason = '';
      }
      state.phase = 'moving';
      advance(state, board, events);
      break;
    }
    default:
      return fail('unknown action');
  }
  return { ok: true, events };
}

// --- helpers -------------------------------------------------------------------------
export const curPlayer = (state) => state.players[state.cur];
const who = (state) => curPlayer(state)?.name ?? '';
const label = (board, i) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };
export function log(state, msg) {
  state.log.unshift(msg);
  state.log.length = Math.min(state.log.length, 6);
}
const isUsed = (state, i) => state.used.includes(i);

// Doors unlocked by the keys found so far (edge key -> true), for canStep.
export function unlockedFn(state, board) {
  if (!state.keys) return undefined;
  const kg = board.keyGroups();
  return (k) => ((kg.edgeMask.get(k) ?? 0) & state.keys) !== 0;
}

// On a street, start space or bridge (with Follow streets on), the pawn keeps
// to the road: only the sides the road continues on, plus any side with a
// door in it (stepping off the road into a building).
function roadSides(state, board, x, y) {
  const grid = board.grid;
  const c = grid.cells[grid.index(x, y)];
  if (!state.followStreets || !(c.sub === 'street' || c.sub === 'start' || c.bridge)) return null;
  let mask = streetMask(grid, x, y);
  for (const [dx, dy, , bit] of DIRS) {
    const k = dx ? edgeKey('v', dx > 0 ? x + 1 : x, y) : edgeKey('h', x, dy > 0 ? y + 1 : y);
    const t = grid.edges.get(k);
    if (t === 'door' || t === 'lockedDoor' || t?.startsWith('oneWayDoor')) mask |= bit;
  }
  return mask || null;
}

// Cells the pawn can step to next (not back where it came from, unless
// that's the only way).
export function nextOptions(state, board) {
  const grid = board.grid;
  const pl = curPlayer(state);
  const { x, y } = grid.coords(pl.pos);
  const sides = roadSides(state, board, x, y);
  const unlocked = unlockedFn(state, board);
  const all = [];
  for (const [dx, dy, name, bit] of DIRS) {
    if (sides !== null && !(sides & bit)) continue;
    if (!grid.canStep(x, y, dx, dy, unlocked)) continue;
    all.push({ i: grid.index(x + dx, y + dy), dx, dy, name });
  }
  const forward = all.filter((o) => o.i !== pl.prev);
  return forward.length ? forward : all;
}

// Entering a cell: touching a marker collects / uses it (event 'collect'),
// and the pawn stops there to choose a way on.
function enter(state, board, i, events) {
  const m = board.grid.cells[i].marker;
  if (!m || !MARKERS[m]) return;
  if (m === 'objective' && !isMidnight(state)) return; // not there yet
  if (state.config.stopAtMarkers) state.stopAt = i;
  if (isUsed(state, i)) {
    state.stopReason = `${MARKERS[m].label} (already collected)`;
    return;
  }
  if (m === 'investigation' && state.config.askInvestigate) {
    state.ask = { i };
    state.stopReason = 'Investigation';
    return;
  }
  if (m === 'investigation') { investigate(state, board, i, events); return; }
  state.used.push(i);
  const pl = curPlayer(state);
  let text = MARKERS[m].label, msg = '', keyGroup = -1;
  if (m === 'whiteDice') {
    pl.white++;
    text = 'White Dice';
    msg = `${who(state)} collected a single-use White Die at ${label(board, i)} (now has ${pl.white}).`;
  } else if (m === 'blackDice') {
    state.blackCount++;
    text = 'Black Dice';
    msg = `${who(state)} attuned a Black Die at ${label(board, i)}: every player now rolls ${state.blackCount} black dice.`;
  } else if (m === 'research') {
    msg = `${who(state)} used Research at ${label(board, i)}: a piece of evidence uncovered for free.`;
  } else if (m === 'objective') {
    msg = `Objective marker at ${label(board, i)} (active once the monster reveals itself).`;
  } else if (m === 'key') {
    const kg = board.keyGroups();
    const gi = kg.cellGroup.get(i);
    let n = 0;
    if (gi !== undefined && !(state.keys & (1 << gi))) {
      state.keys |= 1 << gi;
      keyGroup = gi;
      n = kg.groups[gi].doors.size;
    }
    msg = `${who(state)} picked up a key at ${label(board, i)}: ${n} door${n === 1 ? '' : 's'} in its building unlocked for everyone.`;
  }
  state.stopReason = MARKERS[m].label;
  log(state, msg);
  events.push({ type: 'collect', seat: state.cur, cell: i, marker: m, text, keyGroup });
}

// Investigate a spot: draw a random Obol from the bag for the current player.
function investigate(state, board, i, events) {
  state.used.push(i);
  const pl = curPlayer(state);
  let type = null;
  if (state.bag.length) {
    type = state.bag.splice(randInt(state, state.bag.length), 1)[0];
    pl.inventory.obolcraft.push({ type, at: label(board, i), time: formatClock(clockMinutes(state)), turn: state.round });
    log(state, `${who(state)} investigated ${label(board, i)} and drew an ${OBOLS[type].label} Obol (${state.bag.length} left in the bag).`);
  } else {
    log(state, `${who(state)} investigated ${label(board, i)}, but the Obol bag is empty.`);
  }
  state.stopReason = 'Investigation';
  events.push({ type: 'obol', seat: state.cur, cell: i, obol: type, left: state.bag.length });
  events.push({ type: 'collect', seat: state.cur, cell: i, marker: 'investigation', text: type ? `${OBOLS[type].label} Obol` : 'Investigation', keyGroup: -1 });
}

// Decide the next step: move on, ask, or finish.
function advance(state, board, events) {
  for (;;) {
    if (state.ask) { state.phase = 'asking'; state.options = []; return; }
    if (state.steps <= 0) {
      state.stopAt = -1;
      state.stopReason = '';
      log(state, `${who(state)} ends on ${label(board, curPlayer(state).pos)}.`);
      nextPlayer(state, board, events);
      return;
    }
    const opts = nextOptions(state, board);
    if (!opts.length) {
      log(state, `Stuck at ${label(board, curPlayer(state).pos)} with ${state.steps} move${state.steps === 1 ? '' : 's'} left.`);
      state.steps = 0;
      continue;
    }
    // Stop on every marker the pawn steps onto: always ask, even with one way on.
    const markerStop = state.stopAt === curPlayer(state).pos;
    state.stopAt = -1;
    if (opts.length === 1 && !markerStop) { takeStep(state, board, opts[0], events); continue; }
    if (!markerStop) state.stopReason = '';
    state.phase = 'choosing';
    state.options = opts;
    return;
  }
}

// One step (no follow-on decisions).
function takeStep(state, board, o, events) {
  state.options = [];
  const pl = curPlayer(state);
  const from = pl.pos;
  pl.prev = from;
  pl.pos = o.i;
  state.steps--;
  events.push({ type: 'step', seat: state.cur, from, to: o.i });
  enter(state, board, o.i, events);
}
function step(state, board, o, events) {
  takeStep(state, board, o, events);
  advance(state, board, events);
}

// Hand the turn to the next player. When everyone has moved, the clock moves
// on a turn; at midnight the objectives appear and the monster (if any)
// arrives; from then on monsters act at the end of every turn.
function nextPlayer(state, board, events) {
  state.cur = (state.cur + 1) % state.players.length;
  if (state.cur === 0) {
    const was = isMidnight(state);
    state.round++;
    if (isMidnight(state) && !was) {
      log(state, 'Midnight. The clocktower strikes twelve, and the objectives appear.');
      events.push({ type: 'midnight' });
      spawnMonsters(state, board, events, random, log);
    }
    if (isMidnight(state) && state.monsters.length) monstersAct(state, board, events, random, log);
  }
  state.phase = 'idle';
  state.stopAt = -1;
  state.stopReason = '';
  state.options = [];
  if (state.players.length > 1) log(state, `${who(state)}'s turn.`);
  events.push({ type: 'turn', cur: state.cur });
}

export { MONSTERS };
