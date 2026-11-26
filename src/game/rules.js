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
import { MARKERS, streetMask, edgeKey, cellLabel } from '../core/state.js';
import { gameDoorOverride, doorsAround } from './doors.js';
import { MONSTERS, spawnMonsters, monstersAct, farthestFromPlayers } from './monsters.js';
import { turnLimits, injuries, applyDamage, sacrificeCarrier, killPlayer, dropCarried } from './combat.js';
import { answer as answerReaction } from './reactions.js';
import { RANGE, cellRange } from './cards/injuries.js';
import { objectiveLive, knownMonster } from './objectives/scripts.js';
import { onSiteEnter, crossingBlocked, suffocate, relightHere, memorialPass, relightForObol, canRelightAtMemorial, destroyAnchor, holdRound, pickUpHere, itemLabel } from './objectives/verbs.js';
import { siteOf, siteLabel } from '../core/sites.js';
import { craft } from './obolcraft.js';
import { nightTurn, crateAt, takeFromCrate } from './carePackage.js';
import { refreshThreat, onPlayerEnters, setupVictims } from './monsterTurn.js';
import { setupMystery, evidenceObol, revealEvidence, attackObol, nameMonster, revealMonster } from './mystery.js';
import { setupDecks, drawEquipment, drawCard, eventCard, isMindset } from './decks.js';
import { EQUIPMENT_BY_ID } from './cards/equipment.js';
import { MONSTER_BY_ID } from './cards/monsters.js';
import { useEquipment, armMonster, achieveObjective, discardForWeakness, strikeMonster } from './equipmentPlay.js';
import { EVENT_CATEGORIES } from './cards/events.js';
import {
  resolveEvent, answerEvent, runQueue, doorOverride, startOfTurn, keyTouched, playerStepCost, playerEnters, summon,
} from './eventPlay.js';

// 2: card decks (state.decks; Equipment and Event Obols draw cards).
// 3: equipment in play (monster health/toughness/weakness track, 'use').
// 4: Mindsets in the Event deck; objectives decide the win.
// 5: Events in play (choices, hazards, doors, the clock moving, survivors).
export const RULES_VERSION = 5;

// Bring a saved state from an older version up to date (saveFormat.readSave
// calls this). One step per version.
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
export function migrateState(state) {
  let v = Number.isInteger(state.version) ? state.version : 1;
  if (v < 2) {
    // Decks didn't exist: build them, leaving out equipment already held.
    state.config.deckCounts ??= {};
    const owned = state.players.flatMap((p) => p.inventory.equipment.map((e) => e.id).filter(Boolean));
    setupDecks(state, randInt, owned);
    v = 2;
  }
  if (v < 3) {
    for (const m of state.monsters ?? []) if (m.hp === undefined) armMonster(m);
    state.global ??= null;
    v = 3;
  }
  if (v < 4) {
    // Mindsets join what's left of the Event deck.
    const have = new Set([...state.decks.events, ...state.decks.eventDiscard]);
    state.decks.events.push(...['reckless', 'rushed', 'meticulous', 'protective', 'curious', 'mighty']
      .filter((id) => !have.has(id) && state.config.deckCounts?.[`mindsets:${id}`] !== 0));
    for (let i = state.decks.events.length - 1; i > 0; i--) { const j = randInt(state, i + 1); [state.decks.events[i], state.decks.events[j]] = [state.decks.events[j], state.decks.events[i]]; }
    state.objectiveDone ??= false;
    v = 4;
  }
  if (v < 5) {
    Object.assign(state, { hazards: [], doors: {}, lockdown: null, allDoorsOpen: false, clockShift: 0, survivors: { live: 0, die: 0 },
      exposed: {}, flags: {}, pendingEvent: null, eventQueue: [], ...pick(state, ['hazards', 'doors', 'survivors']) });
    state.midnightDone = isMidnight(state);
    v = 5;
  }
  state.version = v;
  return state;
}

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
// - movement: 'quick' runs the pawn on its own until a fork, a marker or the
//   end of its moves; 'tactical' asks for a direction at every step.
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
  movement: 'quick',
  obols: Object.freeze({ attack: 7, event: 7, equipment: 7, evidence: 7 }),
  monster: 'mystery',
  monsterPool: 'all',
  defenseSlots: 1,       // Defense slots (+1 when the turn starts in light)
  monsterPick: 'random', // or a monster id: always fight that one (testing)
  deckCounts: Object.freeze({}), // cards in the game: changes from 1 copy each (decks.js)
  scouting: true,        // a Scouting phase before the first turn (newGame with setup.scout)
});
export const defaultConfig = () => ({ ...DEFAULT_CONFIG, obols: { ...DEFAULT_CONFIG.obols }, deckCounts: {} });

// Obols: coins drawn at random when investigating.
// Colours match the damage types: Attack = Physical red, Event = Mental
// blue, Equipment = Spiritual green; Evidence is yellow.
export const OBOLS = {
  attack: { label: 'Attack', note: 'bloody red', colour: '#d42a2a', theme: 'P' },
  event: { label: 'Event', note: 'misty blue', colour: '#3a7ae0', theme: 'M' },
  equipment: { label: 'Equipment', note: 'shiny green', colour: '#2fb04a', theme: 'S' },
  evidence: { label: 'Evidence', note: 'glowing yellow', colour: '#e0b020' },
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
// The turn the clock shows: the round, moved by cards (Police Patrol, the
// Enigmatic Hourglass...). The clock stops at midnight: after it, the fight
// happens outside time.
export const clockTurn = (state) => state.round + (state.clockShift ?? 0);
export const clockMinutes = (state) => Math.min(MIDNIGHT, startMinutes(state) + (clockTurn(state) - 1) * state.config.turnMinutes);
export const isMidnight = (state) => clockTurn(state) > state.config.turnsToMidnight;

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
    npcs: [],               // townspeople a monster preys on (the Adze's victims)
    global: null,           // the Global event in effect: { id, since }
    // Events in play (eventPlay.js)
    hazards: [], doors: {}, lockdown: null, allDoorsOpen: false, clockShift: 0,
    survivors: { live: 0, die: 0 }, exposed: {}, flags: {}, pendingEvent: null, eventQueue: [], midnightDone: false,
    log: [],
  };
  if (state.startMode === 'midnight') { state.round = config.turnsToMidnight + 1; state.midnightDone = true; state.midnightRound = state.round; }
  setupDecks(state, randInt);
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
    if (setup.scout && config.scouting !== false) startScouting(state, events);
  }
  return { state, events };
}

// --- Scouting ------------------------------------------------------------------------
// Before the first turn: someone left what they could gather at the edge of
// town (who, and how it went, is the SCOUTING_STORY for the monster's stars). Players + 1 Equipment
// cards are drawn and shown face up; the players take turns, in seat order,
// each taking one (the 'scout' action, { card: index into the offer }). Once
// everyone has chosen, what's left is shuffled back into the deck and the
// first turn begins.
//   state.scouting = { offer: [card ids], order: [seats], at: index into order, took: { seat: id } }
// What the investigators find depends on how deadly the night's monster is
// (its card's stars, 1-5): the Scouting screen tells this story.
export const SCOUTING_STORY = {
  1: 'Whoever called us must have left these supplies here. Help is always appreciated.',
  2: 'Somebody must have been leaving in a hurry. These supplies must have been slowing them down.',
  3: 'A scouting team was deployed here earlier tonight. Unfortunately, this is all they could find before things got too hot.',
  4: 'This equipment was paid for in blood. Some of the scouts didn’t make it back.',
  5: 'It was a slaughter. The scouts were torn apart before they even knew they were in danger. The equipment had to be exfiltrated by remote arcane manipulation.',
};
// The night's monster's stars: the mystery monster's card (or the one picked); 1 without one.
function nightStars(state) {
  const id = state.mystery?.monster ?? (MONSTER_BY_ID[state.config.monster] ? state.config.monster : null);
  return Math.max(1, Math.min(5, MONSTER_BY_ID[id]?.stars ?? 1));
}
function startScouting(state, events) {
  const offer = [];
  for (let k = 0; k <= state.players.length; k++) {
    const id = drawCard(state, 'equipment');
    if (id) offer.push(id);
  }
  if (!offer.length) return;
  const stars = nightStars(state);
  state.scouting = { offer, order: state.players.map((p) => p.seat), at: 0, took: {}, stars, story: SCOUTING_STORY[stars] };
  state.phase = 'scouting';
  state.cur = state.scouting.order[0];
  log(state, `Scouting: ${offer.length} item${offer.length === 1 ? '' : 's'} at the edge of town. ${SCOUTING_STORY[stars]} ` +
    `${state.players.length === 1 ? `${who(state)} takes one` : `Each investigator takes one, ${who(state)} first`}.`);
  events.push({ type: 'scouting', offer: [...offer] });
}
function scout(state, action, events) {
  const sc = state.scouting;
  const pl = state.players[sc.order[sc.at]];
  const k = action.card | 0;
  const id = sc.offer[k];
  if (!id) return 'choose one of the cards';
  const card = EQUIPMENT_BY_ID[id];
  sc.offer.splice(k, 1);
  pl.inventory.equipment.push({ id, label: card?.name ?? id, from: 'Scouting' });
  sc.took[pl.seat] = id;
  log(state, `${pl.name} takes the ${card?.name ?? id}.`);
  events.push({ type: 'scouted', seat: pl.seat, id });
  sc.at++;
  if (sc.at < sc.order.length && sc.offer.length) { state.cur = sc.order[sc.at]; return null; }
  // Everyone has chosen: the rest are shuffled back into the deck; the first turn begins.
  for (const left of sc.offer) state.decks.equipment.splice(randInt(state, state.decks.equipment.length + 1), 0, left);
  state.scouting = null;
  state.phase = 'idle';
  state.cur = 0;
  log(state, `The scouting is done. ${who(state)} rolls first.`);
  events.push({ type: 'scoutDone' });
  return null;
}

// --- actions ------------------------------------------------------------------------
// Stopped mid-turn: out of moves ('slotting'), at a fork or marker, or at every
// step in Tactical movement ('choosing'), or asked "Investigate?" ('asking').
// At every stop the player can roll white dice, slot dice (Movement dice
// slotted mid-move add to the move when a direction is picked), and use
// equipment and Obolcraft.
const STOPPED = ['slotting', 'choosing', 'asking'];
// Every action: { type, seat? }. Returns { ok, error?, events }.
export const ACTIONS = ['roll', 'slot', 'rollWhite', 'move', 'end', 'choose', 'investigate', 'reveal', 'name', 'craft', 'use', 'discard', 'objective', 'event', 'setting', 'sacrifice', 'setDie', 'react', 'strike', 'scout', 'drop', 'force', 'relight', 'crate'];

export function applyAction(state, board, action) {
  // Doors the game changed (nailed, breached) count for every move made while
  // the rules run, monsters' included; then the board is left as drawn.
  board.grid.edgeOverride = gameDoorOverride(state, board);
  try { return applyActionNow(state, board, action); } finally { board.grid.edgeOverride = null; }
}
function applyActionNow(state, board, action) {
  board.setPowerOut?.(state.global?.id === 'power-outage');
  const events = [];
  const fail = (error) => ({ ok: false, error, events: [] });
  if (!action || !ACTIONS.includes(action.type)) return fail('unknown action');
  // A weakness discard to answer (reactions.js), first: the game waits for
  // the player who was hit (whoever's turn it is).
  const react = state.reactions?.[0];
  if (react) {
    if (action.type === 'react') {
      if (action.seat !== undefined && action.seat !== react.seat) return fail(`${state.players[react.seat].name} decides`);
    } else if (action.type !== 'setting') return fail(`waiting for ${state.players[react.seat].name} to decide on a discard`);
  } else if (action.type === 'react') return fail('nothing to decide');
  // Someone has fallen and the Sacrificial Fetish could save them: the game
  // waits for its carrier (whoever's turn it is).
  const sac = react ? null : pendingSacrifice(state);
  if (action.type === 'react') { /* answered below */ } else if (action.type === 'sacrifice') {
    if (!sac) return fail('nothing to decide');
    if (action.seat !== undefined && action.seat !== sac.carrier.seat) return fail(`${sac.carrier.name} decides`);
  } else {
    if (action.seat !== undefined && action.seat !== state.cur) return fail('not your turn');
    if (sac && action.type !== 'setting') return fail(`waiting for ${sac.carrier.name} to decide on the Sacrificial Fetish`);
  }
  switch (action.type) {
    case 'roll': {
      if (state.phase !== 'idle') return fail('cannot roll now');
      const pl = curPlayer(state);
      const lim = turnLimits(state, board, pl);
      pl.defense = [];                               // last turn's defense is spent
      // ...and equipment's "this turn" effects (a teammate's Rally this round
      // stays, through the monster's turn: its entries carry the round).
      pl.bonusDefense = (pl.bonusDefense ?? []).filter((b) => b.round === state.round);
      pl.defenseUsed = 0;                            // ...and what attacks wore off it
      pl.mods = {};
      state.moveBonus = 0;
      state.windDouble = false;
      state.noMove = false;                          // Camouflage: can't move the rest of that turn
      // Pinned (Hellhounds' and the Poltergeist's Pin): no moving this turn.
      if (pl.pinned) { delete pl.pinned; state.noMove = true; log(state, `${who(state)} is pinned: no moving this turn.`); }
      // Seized (Ushi-Oni): held fast; damage through its defense frees them.
      if (pl.seized) { state.noMove = true; log(state, `${who(state)} is held by the monster: no moving until they break free.`); }
      // Discard Crystal & no light for ⌛ (Shadow People): over when its player's turn comes round again.
      if (state.flags?.noLight && state.flags.noLight.seat === state.cur && state.flags.noLight.round !== state.round) delete state.flags.noLight;
      startOfTurn(state, eventCtx(state));
      // Standing on something dropped (the Cosor after Unholy Burn): pick it up, once allowed.
      pickUpHere(state, pl, pl.pos, (text) => { log(state, text); events.push({ type: 'objStep', seat: pl.seat, cell: pl.pos, text }); }, { burntOnly: true });
      relightHere(state, board, pl, { state, log, randInt }, events);   // Shadow People: starting on the candle stand
      state.pool = Array.from({ length: lim.dice }, () => ({ kind: 'black', v: d6(state) }));
      state.slots = [];
      state.defSlots = [];
      state.lit = lim.lit;
      state.maxSlots = lim.move;
      // Strong Winds (Global): starting outside, flip a coin.
      if (state.global?.id === 'strong-winds' && board.grid.cells[pl.pos]?.area !== 'indoor') {
        const heads = randInt(state, 2) === 0;
        events.push({ type: 'coin', heads });
        if (heads) { state.windDouble = true; log(state, `Strong Winds: heads, a Favorable Wind (${who(state)}'s slotted movement is doubled).`); }
        else { state.maxSlots = Math.max(0, state.maxSlots - 1); log(state, `Strong Winds: tails, an Unfavorable Wind (${who(state)} loses a movement slot).`); }
      }
      state.maxDefense = pl.mindset === 'reckless' ? 0 : lim.defense; // Reckless: no defense slots (equipment bonuses still count)
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
      const turnPhases = [...STOPPED, 'revealing'];
      if (!state.pool[n] || !turnPhases.includes(state.phase)) return fail('no such die');
      if (to === 'slots' && !STOPPED.includes(state.phase)) return fail('finish moving first');
      if (state.pool[n].spent) return fail('that die has been used to move');
      if (to === 'defSlots' && curPlayer(state).mindset === 'reckless' && state.defSlots.indexOf(n) < 0) return fail('Reckless: no defense slots (equipment defense bonuses still count)');
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
      // At any stop, the "Investigate?" prompt included (last chance to brace).
      if (!STOPPED.includes(state.phase) || pl.white <= 0) return fail('no white dice');
      if (state.deathsDoor) return fail("at Death's Door: one die only");
      pl.white--;
      const v = d6(state);
      // Resonance (Obolcraft): this die returns to the reserve after the turn.
      const resonant = (pl.resonance ?? 0) > 0;
      if (resonant) pl.resonance--;
      state.pool.push({ kind: 'white', v, ...(resonant ? { resonant: true } : {}) });
      log(state, `${who(state)} rolled a white die from reserve: ${v} (${pl.white} left in reserve).`);
      events.push({ type: 'rolledWhite', seat: state.cur, v });
      break;
    }
    case 'move': {
      // Move by the dice newly slotted into Movement (they're spent). The
      // turn carries on afterwards: slot more dice, adjust defense, move
      // again, or end it. With nothing new slotted, this ends the turn.
      if (state.phase !== 'slotting') return fail('not slotting');
      if (state.noMove && state.slots.some((n) => !state.pool[n].spent)) return fail('you can’t move this turn (camouflaged or pinned)');
      const fresh = commitFresh(state);
      if (!fresh) { endTurn(state, board, events); break; }
      state.roll = fresh.total;
      state.steps = state.roll;
      curPlayer(state).prev = -1;
      state.moveN = (state.moveN ?? 0) + 1;   // each move counts on its own (Umbral Stab: once a move)
      log(state, `${who(state)} moves ${state.roll} (${fresh.dice}).`);
      state.phase = 'moving';
      advance(state, board, events);
      break;
    }
    case 'end': {
      // Stopped with moves left, ending the turn gives them up.
      if (!['slotting', 'choosing'].includes(state.phase)) return fail('finish moving first');
      if (state.phase === 'choosing' && state.steps > 0) log(state, `${who(state)} stops with ${state.steps} move${state.steps === 1 ? '' : 's'} unused.`);
      state.steps = 0;
      state.options = [];
      endTurn(state, board, events);
      break;
    }
    case 'choose': {
      if (state.phase !== 'choosing') return fail('not choosing');
      const o = state.options.find((p) => p.i === action.cell);
      if (!o) return fail('not an option');
      // Movement dice slotted while stopped join the move now.
      const fresh = commitFresh(state);
      if (fresh) {
        state.steps += fresh.total;
        state.roll += fresh.total;
        log(state, `${who(state)} adds ${fresh.total} to the move (${fresh.dice}): ${state.steps} left.`);
      }
      step(state, board, o, events);
      break;
    }
    case 'investigate': {
      // The answer to "Investigate?": yes draws an Obol; no runs on through.
      if (state.phase !== 'asking' || !state.ask) return fail('nothing to investigate');
      const { i, curious, anchor, relight } = state.ask;
      state.ask = null;
      if (relight) {
        // Shadow People: relight a candle at a Missing-person memorial for an Obol.
        if (action.yes) relightForObol(state, curPlayer(state), { log, state }, events);
        else log(state, `${who(state)} passes the memorial with the candle still out.`);
      } else if (anchor) {
        // Poltergeist: spend a 6 to destroy the anchor here.
        if (action.yes) destroyAnchor(state, i, { log, randInt, state }, events);
        if (state.phase === 'over') break;
      } else if (curious) {
        // Curious: another Obol at the same spot, for a Defense die.
        if (action.yes) {
          const n = state.defSlots.reduce((a, k) => (a < 0 || state.pool[k].v < state.pool[a].v ? k : a), -1);
          if (n >= 0) {
            state.defSlots.splice(state.defSlots.indexOf(n), 1);
            state.pool[n].spent = true;
            state.pool[n].usedFor = 'Curious';
            syncDefense(state);
            log(state, `${who(state)} is Curious: a Defense die (${state.pool[n].v}) for another look at ${label(board, i)}.`);
            investigate(state, board, i, events, { again: true });
          }
        }
      } else if (action.yes) investigate(state, board, i, events);
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
    case 'craft': {
      // Obolcraft: on your own turn, before rolling or at any stop.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const err = craft(state, curPlayer(state), action, { log, randInt }, events);
      if (err) return fail(err);
      restop(state, board, events);
      break;
    }
    case 'use': {
      // Equipment: any time during your own turn.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const pl = curPlayer(state);
      const before = state.phase === 'idle' ? null : turnLimits(state, board, pl);
      const err = useEquipment(state, board, pl, action, { log, randInt, state }, events);
      if (err) return fail(err);
      // Toss or Drink mid-turn: injuries held off now give back what they took.
      if (before) relimit(state, board, pl, before, events);
      restop(state, board, events);
      break;
    }
    case 'drop': {
      // Set down something carried (the Banshee's heirloom...), on your own
      // space: anyone stepping there picks it up.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const pl = curPlayer(state);
      const k = (pl.carry ?? []).findIndex((c) => c.item === action.item);
      if (k < 0) return fail('you are not carrying that');
      const [thing] = pl.carry.splice(k, 1);
      (state.objective ??= { delivered: {} }).dropped = [...(state.objective.dropped ?? []), { ...thing, cell: pl.pos }];
      log(state, `${who(state)} sets down the ${itemLabel(thing.item)} at ${label(board, pl.pos)}.`);
      events.push({ type: 'objStep', seat: pl.seat, cell: pl.pos, text: `${itemLabel(thing.item)} set down` });
      break;
    }
    case 'scout': {
      if (state.phase !== 'scouting' || !state.scouting) return fail('not scouting');
      const err = scout(state, action, events);
      if (err) return fail(err);
      break;
    }
    case 'strike': {
      // The Blessed Cosor (Strigoi): once a turn, from Close range, one die
      // of Holy damage that ignores its toughness.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const pl = curPlayer(state);
      const cosor = (pl.carry ?? []).find((c) => c.item === 'cosor');
      if (!cosor?.blessed) return fail('only with the Blessed Cosor');
      if (state.struck === state.turn) return fail('once a turn');
      const m = state.monsters.find((x) => x.kind === 'strigoi' && cellRange(board.grid, pl.pos, x.pos) <= RANGE.close);
      if (!m) return fail('the Strigoi is not in Close range');
      // One of your rolled dice, not slotted or spent: its value is the damage.
      const n = action.die | 0;
      const die = state.pool[n];
      if (!state.pool.length) return fail('roll first, then strike with one of your dice');
      if (!die || die.spent || state.slots.includes(n) || state.defSlots.includes(n)) return fail('strike with a rolled die that is not slotted or spent');
      state.struck = state.turn;
      die.spent = true;
      die.usedFor = 'Blessed Cosor';
      const dmg = die.v;
      log(state, `${who(state)} strikes the Strigoi with the Blessed Cosor, a ${dmg}.`);
      strikeMonster(state, board, m, dmg, 'holy', { log, state, randInt }, events);
      events.push({ type: 'cosorStrike', seat: state.cur, id: m.id, amount: dmg });
      restop(state, board, events);
      break;
    }
    case 'crate': {
      // Take a piece of Equipment from the Care Package you stand on.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const err = takeFromCrate(state, curPlayer(state), action.item | 0, { log, state }, events);
      if (err) return fail(err);
      break;
    }
    case 'relight': {
      // Shadow People: beside a Missing-person memorial (start of the turn or
      // stopped there), relight a candle that went out for an Obol.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const pl = curPlayer(state);
      if (!canRelightAtMemorial(state, board, pl)) return fail('stand beside a memorial with a candle that went out and an Obol');
      relightForObol(state, pl, { log, state }, events);
      break;
    }
    case 'force': {
      // Force a door that is nailed shut or otherwise blocked: spend a rolled
      // 6 (not slotted or spent) to break it open for good (breached), so no
      // one is trapped for the rest of the game.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const pl = curPlayer(state);
      if (!state.pool.length) return fail('roll first: forcing a door takes a 6');
      const n = action.die | 0;
      const die = state.pool[n];
      if (!die || die.spent || state.slots.includes(n) || state.defSlots.includes(n)) return fail('force it with a rolled die that is not slotted or spent');
      if (die.v !== 6) return fail('forcing a door takes a 6');
      const door = doorsAround(state, board, pl.pos).find((d) => d.status === 'blocked' && (action.edge === undefined || d.edge === action.edge));
      if (!door) return fail('no blocked door next to you');
      die.spent = true;
      die.usedFor = 'Force the door';
      state.doors[door.edge] = 'breached';
      log(state, `${who(state)} forces the blocked ${door.side} door with a 6: it's broken open for good.`);
      events.push({ type: 'doors', edge: door.edge, change: 'breach' });
      restop(state, board, events);
      break;
    }
    case 'setDie': {
      // Lucky (Good Luck Charm): choose the value of any of your dice this turn.
      if (!state.lucky) return fail('only with Lucky');
      if (!STOPPED.includes(state.phase)) return fail('finish moving first');
      const d = state.pool[action.die | 0];
      const v = action.v | 0;
      if (!d || d.spent) return fail('choose a die you haven’t used');
      if (v < 1 || v > 6) return fail('a die shows 1 to 6');
      d.v = v;
      syncDefense(state);
      break;
    }
    case 'react': {
      // Discard the item of that element (undoing the hit), or keep it.
      const r = answerReaction(state, !!action.yes, action.item, { log, killPlayer });
      events.push({ type: 'reacted', seat: react.seat, item: r.discarded, text: react.text });
      afterSacrifice(state, board, events);
      break;
    }
    case 'sacrifice': {
      // The carrier's answer: spend the Fetish and an Obol to save the
      // fallen player (every injury healed), or let them die.
      const { pl, carrier } = sac;
      state.sacrifice.shift();
      delete pl.dying;
      if (action.yes) {
        payObols(carrier, 1);
        carrier.inventory.equipment.splice(carrier.inventory.equipment.findIndex((it) => it.id === 'sacrificial-fetish'), 1);
        pl.injuries = { P: 0, M: 0, S: 0 };
        delete pl.tossed;
        log(state, `${carrier.name} spends the Sacrificial Fetish${carrier === pl ? '' : ` on ${pl.name}`}: ${pl.name} rises again, every injury gone. The Fetish crumbles.`);
        events.push({ type: 'sacrifice', seat: pl.seat, carrier: carrier.seat, saved: true });
      } else {
        pl.dead = true;
        log(state, `${pl.name} dies.`);
        dropCarried(state, pl, log);
        events.push({ type: 'sacrifice', seat: pl.seat, carrier: carrier.seat, saved: false });
      }
      afterSacrifice(state, board, events);
      break;
    }
    case 'event': {
      // The drawing character answers an Event card (they choose alone).
      if (state.phase !== 'eventing') return fail('no event to answer');
      const err = answerEvent(state, board, action, eventCtx(state), events);
      if (err) return fail(err);
      state.phase = 'moving';
      advance(state, board, events);
      break;
    }
    case 'discard': {
      // Discard an item for a monster's ∞ weakness effect: any time on your turn.
      if (!['idle', ...STOPPED].includes(state.phase)) return fail('finish moving first');
      const err = discardForWeakness(state, curPlayer(state), action, { log }, events);
      if (err) return fail(err);
      restop(state, board, events);
      break;
    }
    case 'objective': {
      const err = achieveObjective(state, { log }, events);
      if (err) return fail(err);
      break;
    }
    case 'setting': {
      // Switched mid-game: Quick or Tactical movement, Follow streets. The
      // rules read both at every step, so the change applies from the next one.
      if (action.key === 'movement') {
        state.config.movement = action.value === 'tactical' ? 'tactical' : 'quick';
        log(state, state.config.movement === 'tactical' ? 'Tactical movement: a direction at every step.' : 'Quick movement: running on to the next fork or marker.');
        // Stopped at a single way on that Quick would have run through: keep the stop (a direction is still needed).
      } else if (action.key === 'followStreets') {
        state.followStreets = !!action.value;
        if (state.phase === 'choosing') state.options = nextOptions(state, board, { back: true });
      } else return fail('unknown setting');
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
  // The Adze's victims come out as soon as the team knows it's the Adze.
  const known = knownMonster(state);
  if (known && MONSTER_BY_ID[known]?.actsBy === 'swarm' && !state.npcs?.length) {
    setupVictims(state, board, { kind: known }, { state, log, randInt }, events);
  }
  refreshThreat(state, board);
  return { ok: true, events };
}

// --- helpers -------------------------------------------------------------------------
// The first player waiting on a Sacrifice, and who can pay for it. Anyone no
// longer savable (the Fetish or the Obols gone meanwhile) dies now.
function pendingSacrifice(state) {
  while (state.sacrifice?.length) {
    const pl = state.players[state.sacrifice[0].seat];
    const carrier = pl.dying && sacrificeCarrier(state, pl);
    if (carrier) return { pl, carrier };
    state.sacrifice.shift();
    if (pl.dying) { delete pl.dying; pl.dead = true; log(state, `${pl.name} dies.`); dropCarried(state, pl, log); }
  }
  return null;
}
// Who answers the next Sacrifice (for a host checking seats); else whose turn it is.
export function sacrificeSeat(state) {
  if (state.reactions?.length) return state.reactions[0].seat;   // a weakness discard first
  const first = state.sacrifice?.[0];
  const pl = first && state.players[first.seat];
  return (pl?.dying && sacrificeCarrier(state, pl)?.seat) ?? state.cur;
}
// Once no one is left waiting: the game ends if everyone is dead, and a turn
// whose player died moves on.
function afterSacrifice(state, board, events) {
  if (state.reactions?.length || pendingSacrifice(state)) return;
  if (state.players.every((p) => p.dead || p.escaped)) {
    state.phase = 'over';
    log(state, state.won ? 'Everyone still standing has escaped. The investigators win.' : 'Everyone is dead. The night wins.');
    events.push({ type: state.won ? 'won' : 'gameOver' });
    return;
  }
  if (curPlayer(state).dead && state.phase !== 'over') {
    state.ask = null;
    state.steps = 0;
    if (state.phase === 'idle') nextPlayer(state, board, events);
    else { state.phase = 'moving'; advance(state, board, events); }
  }
}
// Obols paid for equipment or a Sacrifice: any colour, most plentiful first.
function payObols(pl, n) {
  const bag = pl.inventory.obolcraft;
  for (let j = 0; j < n && bag.length; j++) {
    const counts = {};
    for (const o of bag) counts[o.type] = (counts[o.type] ?? 0) + 1;
    const most = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
    bag.splice(bag.findIndex((o) => o.type === most), 1);
  }
}
// The turn's limits changed mid-turn (Toss, Drink): slots and dice that the
// injuries took come back now (a lost die is rolled at once).
function relimit(state, board, pl, before, events) {
  const now = turnLimits(state, board, pl);
  state.maxSlots = Math.max(0, state.maxSlots + now.move - before.move);
  if (pl.mindset !== 'reckless') state.maxDefense = Math.max(0, state.maxDefense + now.defense - before.defense);
  state.deathsDoor = now.deathsDoor;
  const more = now.dice - before.dice;
  if (more > 0) {
    const rolled = Array.from({ length: more }, () => ({ kind: 'black', v: d6(state) }));
    state.pool.push(...rolled);
    state.disabledDice = Math.max(0, (state.disabledDice ?? 0) - more);
    log(state, `${who(state)} rolls ${more === 1 ? 'the black die' : `${more} black dice`} the injuries held back: ${rolled.map((d) => d.v).join(', ')}.`);
    events.push({ type: 'rolled', seat: state.cur, pool: state.pool.map((d) => ({ ...d })) });
  }
}
export const curPlayer = (state) => state.players[state.cur];
const mysteryCtx = (state) => ({ log, randInt, random, cellLabel, time: () => formatClock(clockMinutes(state)) });
// What the Event cards need from the rules (eventPlay.js).
const eventCtx = () => ({
  log, randInt, curPlayer, isMidnight, label,
  revealEvidence: (state, board, cell) => evidenceObol(state, board, cell, mysteryCtx(state)),
  flipEvidence: (state, board, n, cell, events) => { state.mystery.pendingReveal = { cell }; revealEvidence(state, board, n, mysteryCtx(state), events); },
  attack: (state, board, cell, events) => attackObol(state, board, cell, mysteryCtx(state), events),
  investigateAgain: (state, board, cell, events) => investigate(state, board, cell, events, { again: true }),
  drawEvent: (state, board, cell, events) => drawEventCard(state, board, curPlayer(state), cell, events),
});
const who = (state) => curPlayer(state)?.name ?? '';
const label = (board, i) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };
export function log(state, msg) {
  state.log.unshift(msg);
  state.log.length = Math.min(state.log.length, 40);
  state.logN = (state.logN ?? 0) + 1;      // lines ever logged: the message feed shows the new ones
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

// Cells the pawn can step to next. Running on, not back where it came from
// (unless that's the only way); stopped (`back`), every reachable side,
// doubling back included.
export function nextOptions(state, board, { back = false } = {}) {
  const grid = board.grid;
  const pl = curPlayer(state);
  const { x, y } = grid.coords(pl.pos);
  const sides = roadSides(state, board, x, y);
  const unlocked = unlockedFn(state, board);
  const override = doorOverride(state);
  const all = [];
  for (const [dx, dy, name, bit] of DIRS) {
    if (sides !== null && !(sides & bit)) continue;
    if (!grid.canStep(x, y, dx, dy, unlocked, override)) continue;
    const i = grid.index(x + dx, y + dy);
    if (crossingBlocked(state, board, pl, i)) continue;   // Barghest: not across the river uncleansed
    const cost = playerStepCost(state, board, i, state.cur);
    if (cost !== Infinity && cost > state.steps) continue; // a Sinkhole needs 5 moves left
    all.push({ i, dx, dy, name });
  }
  if (back) return all;
  const forward = all.filter((o) => o.i !== pl.prev);
  return forward.length ? forward : all;
}

// Movement dice slotted but not yet moved: spend them and say what they add.
// Meticulous: each counts at most 4. Rushed / Favorable Wind: doubled. Any
// equipment move bonus joins in.
function commitFresh(state) {
  const fresh = state.slots.filter((n) => !state.pool[n].spent).map((n) => state.pool[n]);
  if (!fresh.length) return null;
  for (const d of fresh) d.spent = true;
  const mind = curPlayer(state).mindset;
  let base = fresh.reduce((a, d) => a + (mind === 'meticulous' ? Math.min(4, d.v) : d.v), 0);
  if (mind === 'rushed') base *= 2;
  if (state.windDouble) base *= 2;
  if (curPlayer(state).drinking) base *= 2;      // Drink (Questionable Stimulant)
  const total = base + (state.moveBonus ?? 0);
  state.moveBonus = 0;
  return { total, dice: fresh.map((d) => `${d.kind} ${d.v}`).join(' + ') };
}

// After equipment, Obolcraft or a discard at a fork: the pawn may have moved,
// died or been told to stop, so look at the ways on again.
function restop(state, board, events) {
  if (state.phase !== 'choosing') return;
  if (curPlayer(state).dead || curPlayer(state).dying || state.endTurnNow || state.pendingEvent || state.mystery?.pendingReveal || state.ask) {
    state.phase = 'moving';
    advance(state, board, events);
    return;
  }
  state.options = nextOptions(state, board, { back: true });
  if (!state.options.length) { state.phase = 'moving'; advance(state, board, events); }
}

// Anything left to do once the moves run out? Then the turn waits for End
// turn; otherwise it ends by itself.
function canStillAct(state) {
  const pl = curPlayer(state);
  return unusedDice(state).length > 0 || pl.white > 0 || pl.inventory.equipment.length > 0 || pl.inventory.obolcraft.length > 0;
}

// Entering a cell: touching a marker collects / uses it (event 'collect'),
// and the pawn stops there to choose a way on.
function enter(state, board, i, events) {
  // A Care Package (on what was an Investigation marker): stop to look inside.
  if (crateAt(state, i)) {
    state.stopAt = i;
    state.stopReason = 'Care Package';
    events.push({ type: 'crateHere', seat: state.cur, cell: i });
    return;
  }
  const m = board.grid.cells[i].marker;
  if (!m || !MARKERS[m]) return;
  if (m === 'objective' && !objectiveLive(state, board.grid, i)) return; // the monster isn't known yet, or not its site
  if (m === 'key') keyTouched(state, eventCtx(state)); // Lockdown: any Key space opens every door
  if (state.config.stopAtMarkers) state.stopAt = i;
  // An objective site is never used up (candles, again and again): what
  // happens there is the objective's (objectives/verbs.js, from takeStep).
  if (m === 'objective') { state.stopReason = siteLabel(siteOf(board.grid.cells[i])); return; }
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
    // Research: choose a face-down Evidence card to turn over (no Obol needed).
    const open = state.mystery && evidenceObol(state, board, i, mysteryCtx(state));
    msg = open ? `${who(state)} used Research at ${label(board, i)}: choose a piece of evidence to reveal.`
      : `${who(state)} used Research at ${label(board, i)}, but there is no evidence left to find.`;
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
function investigate(state, board, i, events, { again = false } = {}) {
  const pl = curPlayer(state);
  // Meticulous: a spot can be investigated twice.
  if (!again) {
    if (pl.mindset === 'meticulous' && !(state.meticulous ??= []).includes(i)) state.meticulous.push(i);
    else state.used.push(i);
  }
  let type = null;
  const exposed = !again && state.exposed?.[i] !== undefined;
  if (exposed) {
    type = state.exposed[i];
    delete state.exposed[i];
    if (type) pl.inventory.obolcraft.push({ type, at: label(board, i), time: formatClock(clockMinutes(state)), turn: state.round });
    log(state, type ? `${who(state)} investigated ${label(board, i)} and took the exposed ${OBOLS[type].label} Obol.` : `${who(state)} investigated ${label(board, i)}: nothing, as exposed.`);
  } else if (state.bag.length) {
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
  if (type === 'attack') {
    if (state.flags?.ignoreAttack) log(state, 'The attack is ignored (Wooden Boards).');
    else if (state.flags?.negateAttackCards === state.round) log(state, 'The attack is negated (Distant Gunshots).');
    else attackObol(state, board, i, mysteryCtx(state), events);
  }
  if (type === 'equipment') {
    const card = drawEquipment(state, pl, 'Investigation');
    log(state, card ? `${who(state)} found equipment: ${card.name}.` : 'The Equipment deck is empty.');
    if (card) events.push({ type: 'card', deck: 'equipment', id: card.id, seat: state.cur, cell: i });
  }
  if (type === 'event') {
    drawEventCard(state, board, pl, i, events);
    if (pl.mindset === 'curious') state.curiousAt = i;   // offered once the event is resolved (advance)
  }
  events.push({ type: 'collect', seat: state.cur, cell: i, marker: 'investigation', text: type ? `${OBOLS[type].label} Obol` : 'Investigation', keyGroup: -1 });
}

// Draw the top Event card and resolve it (Mindsets and Globals included).
function drawEventCard(state, board, pl, i, events) {
  {
    const id = drawCard(state, 'events');
    const card = id && (eventCard(id) ?? (id === 'portrait-curse' ? { name: 'The Haunted Portrait’s curse', category: 'cursedObject', text: 'Whoever draws this dies.' } : null));
    log(state, card ? `${who(state)} drew an event: ${card.name} (${EVENT_CATEGORIES[card.category].label}). ${card.text}` : 'The Event deck is empty.');
    if (card) events.push({ type: 'card', deck: 'events', id, seat: state.cur, cell: i });
    // A Mindset is yours until another one replaces it (one at a time).
    if (card && isMindset(id)) {
      const old = pl.mindset && eventCard(pl.mindset);
      pl.mindset = id;
      log(state, old ? `${who(state)}'s ${card.name} Mindset replaces ${old.name}.` : `${who(state)} takes on the ${card.name} Mindset.`);
    }
    // A Global covers the whole map until the next Global replaces it.
    if (card?.category === 'global') {
      const old = state.global && eventCard(state.global.id);
      state.global = { id, since: state.round };
      board.setPowerOut?.(id === 'power-outage');
      log(state, old ? `${card.name} replaces ${old.name} as the Global event.` : `${card.name} is now in effect across the map.`);
      events.push({ type: 'global', id });
    }
    if (card && !isMindset(id)) resolveEvent(state, board, id, i, eventCtx(state), events);
  }
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
    // A discard to decide (reactions.js): stop here; any moves left wait at a stop.
    if (state.reactions?.length) {
      state.ask = null;
      state.options = state.steps > 0 ? nextOptions(state, board, { back: true }) : [];
      state.phase = state.options.length ? 'choosing' : 'slotting';
      return;
    }
    // Fallen mid-turn, waiting on a Sacrifice: everything stops here.
    if (curPlayer(state).dying) { state.ask = null; state.steps = 0; state.phase = 'slotting'; state.options = []; return; }
    if (state.ask) { state.phase = 'asking'; state.options = []; return; }
    if (state.pendingEvent) { state.phase = 'eventing'; state.options = []; return; }
    if (state.mystery?.pendingReveal) { state.phase = 'revealing'; state.options = []; return; }
    if (state.eventQueue?.length) { runQueue(state, board, eventCtx(state), events); if (state.pendingEvent || state.mystery?.pendingReveal || state.eventQueue.length) continue; }
    if (state.endTurnNow) { state.curiousAt = -1; state.endTurnNow = false; state.steps = 0; endTurn(state, board, events); return; }
    // Curious (Mindset): the investigation's Event is resolved; keep
    // investigating the same spot for a Defense die?
    if (state.curiousAt >= 0) {
      const i = state.curiousAt;
      state.curiousAt = -1;
      const pl = curPlayer(state);
      if (pl.mindset === 'curious' && !pl.dying && state.defSlots.length && state.bag.length) { state.ask = { i, curious: true }; continue; }
    }
    if (state.steps <= 0) {
      state.stopAt = -1;
      state.stopReason = '';
      log(state, `${who(state)} stops on ${label(board, curPlayer(state).pos)}.`);
      // Dice, equipment or Obols left to use? The turn waits for End turn.
      if (canStillAct(state)) { state.phase = 'slotting'; state.options = []; return; }
      endTurn(state, board, events);
      return;
    }
    const opts = nextOptions(state, board);
    const tactical = state.config.movement === 'tactical';
    if (!opts.length) {
      log(state, `Stuck at ${label(board, curPlayer(state).pos)} with ${state.steps} move${state.steps === 1 ? '' : 's'} left.`);
      state.steps = 0;
      continue;
    }
    // Stop on every marker the pawn steps onto: always ask, even with one way on.
    const markerStop = state.stopAt === curPlayer(state).pos;
    state.stopAt = -1;
    // Quick movement runs on where there's only one way; Tactical asks at every step.
    if (opts.length === 1 && !markerStop && !tactical) { takeStep(state, board, opts[0], events); continue; }
    if (!markerStop) state.stopReason = '';
    // Stopped: every way is open, back the way it came included.
    state.phase = 'choosing';
    state.options = nextOptions(state, board, { back: true });
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
  const cost = playerStepCost(state, board, o.i, state.cur);
  state.steps = cost === Infinity ? 0 : state.steps - cost;
  if (cost === Infinity) log(state, `${who(state)} is caught in the brambles: that's all the movement for this turn.`);
  events.push({ type: 'step', seat: state.cur, from, to: o.i });
  playerEnters(state, pl, o.i, eventCtx(state));
  enter(state, board, o.i, events);
  onSiteEnter(state, board, pl, o.i, { state, log, randInt }, events);
  if (state.monsters.length) onPlayerEnters(state, board, pl, o.i, { state, log, randInt }, events);
  if (!pl.dead) memorialPass(state, board, pl, o.i);   // Shadow People: relight at a memorial for an Obol?
}
function step(state, board, o, events) {
  takeStep(state, board, o, events);
  advance(state, board, events);
}

// Hand the turn to the next player. When everyone has moved, the clock moves
// on a turn; at midnight the objectives appear and the monster (if any)
// arrives; from then on monsters act at the end of every turn.
function nextPlayer(state, board, events) {
  delete curPlayer(state).drinking;              // Drink and Lucky last this turn only
  state.lucky = false;
  // Out of play: dead, or escaped (Barghest).
  const gone = (pl) => pl.dead || pl.escaped;
  for (let k = 0; k < state.players.length; k++) {
    state.cur = (state.cur + 1) % state.players.length;
    if (state.cur === 0) endRound(state, board, events);
    if (state.phase === 'over') return;          // Lost in the night
    if (state.players.every(gone)) break;
    // Chalk-Scrawled Narrative (after midnight): this player sits a turn out.
    if (!gone(curPlayer(state)) && curPlayer(state).skipTurns > 0) {
      curPlayer(state).skipTurns--;
      log(state, `${who(state)} skips this turn.`);
      continue;
    }
    if (!gone(curPlayer(state))) break;
  }
  state.stopAt = -1;
  state.stopReason = '';
  state.options = [];
  if (state.players.every(gone)) {
    state.phase = 'over';
    if (state.players.some((pl) => pl.escaped)) {
      log(state, `Everyone still standing has escaped (${state.players.filter((pl) => pl.escaped).map((pl) => pl.name).join(', ')}). The investigators win.`);
      events.push({ type: 'won' });
    } else {
      log(state, 'Everyone is dead. The night wins.');
      events.push({ type: 'gameOver' });
    }
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
  // Lightning Storm (Global): ending the turn outside, flip a coin; tails, 💥 [P].
  if (state.global?.id === 'lightning-storm' && !pl.dead && board.grid.cells[pl.pos]?.area !== 'indoor') {
    const heads = randInt(state, 2) === 0;
    events.push({ type: 'coin', heads });
    log(state, `Lightning Storm: ${who(state)} ends the turn outside and flips a coin: ${heads ? 'heads, the lightning misses' : 'tails'}.`);
    if (!heads) applyDamage(state, board, pl, 'P', 1 + randInt(state, 6), { log, source: 'The lightning' }, events);
  }
  relightHere(state, board, pl, { state, log, randInt }, events); // Shadow People: ending the turn on the stand
  suffocate(state, board, pl, { state, log, randInt }, events);   // Shadow People: a lit candle in the dark
  const left = unusedDice(state);
  pl.lastMove = state.pool.filter((d) => d.spent).map((d) => ({ ...d })); // for Exhaust (Movement die)
  const back = state.pool.filter((d) => d.resonant).length;
  if (back) { pl.white += back; log(state, `${who(state)}'s resonant white ${back === 1 ? 'die returns' : 'dice return'} to the reserve.`); }
  const whites = left.filter((d) => d.kind === 'white' && !d.resonant).length;
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
  holdRound(state, board, { state, log, randInt }, events);   // White Lady: the ceremony counts a round
  state.round++;
  // Rally's defense lasts through the monster's turn: gone now.
  for (const p of state.players) if (p.bonusDefense) p.bonusDefense = p.bonusDefense.filter((b) => b.round === undefined);
  summon(state, eventCtx(state), events);
  if (isMidnight(state) && !state.midnightDone) {
    state.midnightDone = true;
    state.midnightRound = state.round;   // the night's 24 turns count from here (carePackage.js)
    log(state, 'Midnight. The clocktower strikes twelve, and the objectives appear.');
    events.push({ type: 'midnight' });
    revealMonster(state, board, mysteryCtx(state), events);
    spawnMonsters(state, board, events, random, log);
  }
  nightTurn(state, board, { state, log, randInt }, events);   // Care Packages, and the night's end
}

export { MONSTERS };
