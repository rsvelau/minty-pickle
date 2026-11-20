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
import { MONSTERS, spawnMonsters, monstersAct, farthestFromPlayers } from './monsters.js';
import { turnLimits, injuries } from './combat.js';
import { refreshThreat } from './monsterTurn.js';
import { setupMystery, evidenceObol, revealEvidence, attackObol, nameMonster, revealMonster } from './mystery.js';

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
// - monster: 'mystery' (a secret monster from `monsterPool`, found out through
//   evidence; see mystery.js), 'stalker' (the test monster) or 'none'.
// - monsterPool: which premade set the mystery monster is drawn from.
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
  monster: 'mystery',
  monsterPool: 'all',
  defenseSlots: 1,       // Defense slots (+1 when the turn starts in light)
  monsterPick: 'random', // or a monster id: always fight that one (testing)
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
  injuries: { label: 'Injuries', empty: '' },
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
      injuries: { P: 0, M: 0, S: 0 },           // tiers per track (combat.js)
      defense: [],                              // defense dice committed this turn
      dead: false,
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
    defSlots: [], maxDefense: 1,
    ask: null,
    bag: OBOL_TYPES.flatMap((t) => Array(Math.max(0, config.obols[t] | 0)).fill(t)),
    used: [],               // marker cells used up (cell indices)
    stopAt: -1,
    stopReason: '',
    monsters: [],
    mystery: null,          // the secret monster and its evidence (mystery.js)
    log: [],
  };
  if (state.startMode === 'midnight') state.round = config.turnsToMidnight + 1;
  const events = [{ type: 'start' }];
  if (start >= 0) {
    if (config.monster === 'mystery') {
      setupMystery(state, board, {
        random, randInt,
        farthestCell: () => farthestFromPlayers({ state, board, random: () => random(state) }),
      });
    }
    log(state, (state.startMode === 'midnight' ? 'Midnight. The town is waiting, and the objectives are out. ' : '') +
      `${config.players === 1 ? 'Playing solo: P1 is' : `${config.players} players`} ready on the Start space ` +
      `(${label(board, start)}), in the van's headlights: starting light ${Math.round(board.light[start] * 100)}%. ` +
      `${who(state)} rolls first.`);
    enter(state, board, start, events);
    state.ask = null;
    state.stopAt = -1;
    if (isMidnight(state)) {
      revealMonster(state, board, mysteryCtx(state), events);
      spawnMonsters(state, board, events, random, log);
    }
  }
  return { state, events };
}

// --- actions ------------------------------------------------------------------------
// Every action: { type, seat? }. Returns { ok, error?, events }.
export const ACTIONS = ['roll', 'slot', 'rollWhite', 'move', 'end', 'choose', 'investigate', 'reveal', 'name'];

export function applyAction(state, board, action) {
  const events = [];
  const fail = (error) => ({ ok: false, error, events: [] });
  if (!action || !ACTIONS.includes(action.type)) return fail('unknown action');
  if (action.seat !== undefined && action.seat !== state.cur) return fail('not your turn');
  switch (action.type) {
    case 'roll': {
      if (state.phase !== 'idle') return fail('cannot roll now');
      const pl = curPlayer(state);
      const lim = turnLimits(state, board, pl);
      pl.defense = [];                               // last turn's defense is spent
      state.pool = Array.from({ length: lim.dice }, () => ({ kind: 'black', v: d6(state) }));
      state.slots = [];
      state.defSlots = [];
      state.lit = lim.lit;
      state.maxSlots = lim.move;
      state.maxDefense = lim.defense;
      state.deathsDoor = lim.deathsDoor;
      state.disabledDice = Math.max(0, state.blackCount - lim.dice);
      state.roll = 0;
      state.phase = 'slotting';
      state.turn++;
      log(state, `${who(state)} rolled black ${state.pool.map((d) => d.v).join(', ')}. ` +
        `${state.maxSlots} movement and ${state.maxDefense} defense slot${state.maxDefense === 1 ? '' : 's'}${state.lit ? ' (standing in light)' : ''}` +
        `${lim.deathsDoor ? '. At Death\'s Door: one die only' : ''}.`);
      events.push({ type: 'rolled', seat: state.cur, pool: state.pool.map((d) => ({ ...d })) });
      break;
    }
    case 'slot': {
      // Put a rolled die (index into pool) into a Movement or Defense slot,
      // or take it out again (tap it where it is).
      const n = action.die | 0;
      const to = action.to === 'defense' ? 'defSlots' : 'slots';
      const turnPhases = ['slotting', 'choosing', 'asking', 'revealing'];
      if (!state.pool[n] || !turnPhases.includes(state.phase)) return fail('no such die');
      if (to === 'slots' && state.phase !== 'slotting') return fail('finish moving first');
      if (state.pool[n].spent) return fail('that die has been used to move');
      const other = to === 'slots' ? 'defSlots' : 'slots';
      const at = state[to].indexOf(n);
      if (at >= 0) { state[to].splice(at, 1); syncDefense(state); break; }
      const max = to === 'slots' ? state.maxSlots : state.maxDefense;
      if (state[to].length >= max) return fail('slots full');
      const o = state[other].indexOf(n);
      if (o >= 0) state[other].splice(o, 1);
      state[to].push(n);
      syncDefense(state);
      break;
    }
    case 'rollWhite': {
      // Take a white die out of reserve and roll it: usable this turn only.
      const pl = curPlayer(state);
      if (state.phase !== 'slotting' || pl.white <= 0) return fail('no white dice');
      if (state.deathsDoor) return fail("at Death's Door: one die only");
      pl.white--;
      const v = d6(state);
      state.pool.push({ kind: 'white', v });
      log(state, `${who(state)} rolled a white die from reserve: ${v} (${pl.white} left in reserve).`);
      events.push({ type: 'rolledWhite', seat: state.cur, v });
      break;
    }
    case 'move': {
      // Move by the dice newly slotted into Movement (they're spent). The
      // turn carries on afterwards: slot more dice, adjust defense, move
      // again, or end it. With nothing new slotted, this ends the turn.
      if (state.phase !== 'slotting') return fail('not slotting');
      const fresh = state.slots.filter((n) => !state.pool[n].spent).map((n) => state.pool[n]);
      if (!fresh.length) { endTurn(state, board, events); break; }
      for (const d of fresh) d.spent = true;
      state.roll = fresh.reduce((a, d) => a + d.v, 0);
      state.steps = state.roll;
      curPlayer(state).prev = -1;
      log(state, `${who(state)} moves ${state.roll} (${fresh.map((d) => `${d.kind} ${d.v}`).join(' + ')}).`);
      state.phase = 'moving';
      advance(state, board, events);
      break;
    }
    case 'end': {
      if (state.phase !== 'slotting') return fail('finish moving first');
      endTurn(state, board, events);
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
    case 'reveal': {
      // Choose which face-down Evidence card to turn over.
      const m = state.mystery;
      if (state.phase !== 'revealing' || !m?.pendingReveal) return fail('nothing to reveal');
      const n = action.card | 0;
      if (!m.deck[n] || m.flipped.includes(n)) return fail('choose a face-down card');
      revealEvidence(state, board, n, mysteryCtx(state), events);
      state.phase = 'moving';
      advance(state, board, events);
      break;
    }
    case 'name': {
      // Name the monster (Field Guide): any time on your turn before midnight.
      const err = nameMonster(state, action.monster, mysteryCtx(state), events);
      if (err) return fail(err);
      break;
    }
    default:
      return fail('unknown action');
  }
  refreshThreat(state, board);
  return { ok: true, events };
}

// --- helpers -------------------------------------------------------------------------
export const curPlayer = (state) => state.players[state.cur];
const mysteryCtx = (state) => ({ log, randInt, random, cellLabel, time: () => formatClock(clockMinutes(state)) });
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
  // The mystery: evidence to choose, or the monster strikes.
  if (type === 'evidence') evidenceObol(state, board, i, mysteryCtx(state));
  if (type === 'attack') attackObol(state, board, i, mysteryCtx(state), events);
  events.push({ type: 'collect', seat: state.cur, cell: i, marker: 'investigation', text: type ? `${OBOLS[type].label} Obol` : 'Investigation', keyGroup: -1 });
}

// Decide the next step: move on, ask, or finish.
function advance(state, board, events) {
  for (;;) {
    if (curPlayer(state).dead) {
      state.ask = null;
      if (state.mystery) state.mystery.pendingReveal = null;
      state.steps = 0;
      nextPlayer(state, board, events);
      return;
    }
    if (state.ask) { state.phase = 'asking'; state.options = []; return; }
    if (state.mystery?.pendingReveal) { state.phase = 'revealing'; state.options = []; return; }
    if (state.steps <= 0) {
      state.stopAt = -1;
      state.stopReason = '';
      log(state, `${who(state)} stops on ${label(board, curPlayer(state).pos)}.`);
      // Dice left to use (or white dice to roll)? The turn carries on.
      if (unusedDice(state).length || curPlayer(state).white > 0) { state.phase = 'slotting'; state.options = []; return; }
      endTurn(state, board, events);
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
  for (let k = 0; k < state.players.length; k++) {
    state.cur = (state.cur + 1) % state.players.length;
    if (state.cur === 0) endRound(state, board, events);
    if (state.players.every((pl) => pl.dead)) break;
    if (!curPlayer(state).dead) break;
  }
  state.stopAt = -1;
  state.stopReason = '';
  state.options = [];
  if (state.players.every((pl) => pl.dead)) {
    state.phase = 'over';
    log(state, 'Everyone is dead. The night wins.');
    events.push({ type: 'gameOver' });
    return;
  }
  state.phase = 'idle';
  if (state.players.length > 1) log(state, `${who(state)}'s turn.`);
  events.push({ type: 'turn', cur: state.cur });
}

// Defense is live: whatever sits in the Defense slots protects right now.
function syncDefense(state) {
  curPlayer(state).defense = state.defSlots.map((n) => ({ ...state.pool[n] }));
}
// Rolled dice not used for movement or defense this turn.
export function unusedDice(state) {
  return state.pool.map((d, n) => ({ ...d, n })).filter((d) => !d.spent && !state.defSlots.includes(d.n));
}
// End the current player's turn (their defense stays up until their next one).
function endTurn(state, board, events) {
  const pl = curPlayer(state);
  syncDefense(state);
  const left = unusedDice(state);
  const whites = left.filter((d) => d.kind === 'white').length;
  if (whites) log(state, `${who(state)} discards ${whites} unused white ${whites === 1 ? 'die' : 'dice'}.`);
  if (pl.defense.length) log(state, `${who(state)} braces: defense ${pl.defense.reduce((a, d) => a + d.v, 0)}.`);
  if (!state.pool.some((d) => d.spent)) log(state, `${who(state)} stays put.`);
  state.pool = [];
  state.slots = [];
  state.defSlots = [];
  state.disabledDice = 0;
  nextPlayer(state, board, events);
}

// Everyone has moved: the clock moves on; monsters act.
function endRound(state, board, events) {
  const was = isMidnight(state);
  // Monsters already out carry out the action they declared, and declare the next.
  if (was && state.monsters.length) monstersAct(state, board, events, random, log);
  state.round++;
  if (isMidnight(state) && !was) {
    log(state, 'Midnight. The clocktower strikes twelve, and the objectives appear.');
    events.push({ type: 'midnight' });
    revealMonster(state, board, mysteryCtx(state), events);
    spawnMonsters(state, board, events, random, log);
  }
}

export { MONSTERS };
