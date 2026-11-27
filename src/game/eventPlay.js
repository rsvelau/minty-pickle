// Playing Event cards (src/game/cards/events.js).
//
// When an Event Obol is drawn, the card is resolved here:
// - cards that need a choice (Decisions, optional "Can" Opportunities and
//   Cursed Objects) set state.pendingEvent and the turn pauses in phase
//   'eventing' until the drawing character answers with
//   { type: 'event', choice, item? } (they choose alone);
// - the rest happen at once.
// A card can queue more (Tarot Cards: three events, then an Evidence card).
//
// The lasting parts live in the state:
//   hazards   [{ id, cell, by: 'found' | 'player', seat, waitFor, used }]
//             discovered Hazards affect players and monsters (but not the
//             discovering player until they move off); player traps only monsters
//   doors     { edgeKey: 'blocked' | 'open' } and lockdown { seat, until } / allDoorsOpen
//   clockShift  turns the clock was moved (ignored from midnight on: the clock stops)
//   survivors { live, die }: the team's Live / Die choices (Police Patrol reads it)
//   exposed   { cell: obolType }: what an Investigation spot holds, exposed early
//   flags     this round's effects: negateAttackCards, avoidAttacks
//
// 💥 [P]/[M]/[S] damage on a card is one die of that type, defended as usual.
// The travel cards (Hidden Passage, Peculiar Mirror, Decrepit Truck, Hiding
// Spot) are played in travel.js.
import { EVENT_BY_ID } from './cards/events.js';
import { MONSTER_BY_ID } from './cards/monsters.js';
import { EQUIPMENT_BY_ID } from './cards/equipment.js';
import { applyDamage, alive, killPlayer } from './combat.js';
import { triggerWeakness } from './equipmentPlay.js';
import { exhaust } from './monsterTurn.js';
import { cellRange } from './cards/injuries.js';
import { blockDoor } from './doors.js';
import { farEndCells, placeLink, placeHidingSpot, hide, placeTruck } from './travel.js';

export const PORTRAIT_CURSE = 'portrait-curse'; // shuffled in by Haunted Portrait

// What each card asks: choices offered to the drawing character.
const CHOICES = {
  'roof-collapse': [['pass', 'Take 💥 [P] to get through it this turn'], ['stay', 'Stay on this side']],
  'bumped-shelf': [['hide', 'Hide (Advance ⏳)'], ['leave', 'Try to leave (flip 🪙: tails, attacked)']],
  'injured-survivor': [['live', 'Live: pay 3 ◉ Obols to expose 2 ❓'], ['die', 'Die: do nothing']],
  'huddled-survivors': [['live', 'Live: discard a weapon and a white die, investigate twice'], ['die', 'Die: do nothing']],
  'insane-survivor': [['live', 'Live: take 💥 [P] and reveal an Evidence card'], ['die', 'Die: do nothing']],
};
// Optional cards: use it or not.
const OPTIONAL = new Set(['enigmatic-hourglass', 'spirit-board', 'ominous-vhs', 'tarot-cards', 'haunted-portrait',
  'chalk-scrawled-narrative', 'message-cypher', 'wooden-boards', 'rusty-bear-trap']);
// Not built yet: played at the table.
export const TABLE_ONLY = new Set();
// Hazards placed where the card was found (found = affect players and monsters).
const FOUND_HAZARDS = new Set(['flooded-out', 'flickering-lights', 'sinkhole', 'overgrown-brambles', 'consecrated-ash']);
// Traps laid by the player (only affect monsters).
const PLAYER_TRAPS = new Set(['coil-of-razor-wire', 'rusty-bear-trap', 'deadfall-trap', 'bonfire', 'summoning-circle']);

// From midnight on, cards built on the clock play their afterMidnight text.
export const pastMidnight = (state) => state.round + (state.clockShift ?? 0) > state.config.turnsToMidnight;
const AFTER_CHOICES = {
  'bumped-shelf': [['hide', 'Hide (the monster can’t target you this round; your turn ends)'], ['leave', 'Try to leave (flip 🪙: tails, attacked)']],
};
const freeDice = (state) => state.pool.map((d, n) => ({ d, n })).filter(({ d, n }) => !d.spent && !state.slots.includes(n) && !state.defSlots.includes(n));

export function choicesFor(id, state, pl) {
  // Hidden Passage, Peculiar Mirror: pick where the far end goes (an Investigation space).
  if ((id === 'hidden-passage' || id === 'peculiar-mirror') && state.pendingEvent?.cells) {
    return [{ value: 'place', label: id === 'hidden-passage' ? 'Choose where it comes out (an Investigation space within 10)' : 'Choose where its twin stands (any Investigation space)', ok: true, pick: state.pendingEvent.cells }];
  }
  if (id === 'hiding-spot') return [{ value: 'hide', label: 'Hide here now (up to 2 rounds)', ok: true }, { value: 'later', label: 'Leave it for later (anyone can use it, once)', ok: true }];
  const late = pastMidnight(state);
  if (late && AFTER_CHOICES[id]) return AFTER_CHOICES[id].map(([value, label]) => ({ value, label, ok: true }));
  if (late && id === 'message-cypher') return [{ value: 'use', label: 'Spend two rolled dice: trigger a weakness', ok: freeDice(state).length >= 2 && state.monsters.length > 0 }, { value: 'skip', label: 'Leave it', ok: true }];
  if (CHOICES[id]) {
    return CHOICES[id].map(([value, label]) => ({ value, label, ok: choiceAllowed(id, value, state, pl) }));
  }
  if (OPTIONAL.has(id)) return [{ value: 'use', label: 'Use it', ok: true }, { value: 'skip', label: 'Leave it', ok: true }];
  return null;
}
function choiceAllowed(id, value, state, pl) {
  if (id === 'injured-survivor' && value === 'live') return pl.inventory.obolcraft.length >= 3;
  if (id === 'huddled-survivors' && value === 'live') return pl.white > 0 && pl.inventory.equipment.some((e) => isWeapon(e.id));
  return true;
}
const isWeapon = (id) => EQUIPMENT_BY_ID[id]?.abilities.some((a) => a.fx?.dmg !== undefined);

// --- clock -------------------------------------------------------------------------
// Move the clock by n turns (negative = back). Does nothing from midnight on.
export function shiftClock(state, n, ctx) {
  if (ctx.isMidnight(state)) { ctx.log(state, 'The clock has stopped: it does not move.'); return 0; }
  const min = 1 - state.round;                                // never before the start
  const max = state.config.turnsToMidnight + 1 - state.round;  // at most to midnight
  const was = state.clockShift ?? 0;
  state.clockShift = Math.max(min, Math.min(max, was + n));
  const moved = state.clockShift - was;
  if (moved) ctx.log(state, moved > 0 ? `The clock jumps forward ${moved === 1 ? 'a turn' : `${moved} turns`}.` : `The clock turns back ${-moved === 1 ? 'a turn' : `${-moved} turns`}.`);
  return moved;
}

// --- drawing and resolving ---------------------------------------------------------------
// Resolve a drawn Event card (Mindsets and Globals are handled by the caller).
export function resolveEvent(state, board, id, cell, ctx, events) {
  const pl = ctx.curPlayer(state);
  if (id === PORTRAIT_CURSE) {
    const out = killPlayer(state, pl, { log: ctx.log, text: `${pl.name} draws the Haunted Portrait's curse` });
    events.push({ type: 'damage', seat: pl.seat, cell: pl.pos, attack: 'S', amount: 0, defense: 0, source: 'The Haunted Portrait', outcome: out });
    return;
  }
  const card = EVENT_BY_ID[id];
  if (!card || card.category === 'global') return;
  if (TABLE_ONLY.has(id)) { ctx.log(state, `(${card.name}: play this one at the table for now.)`); return; }
  // The travel cards (travel.js).
  if (id === 'hidden-passage' || id === 'peculiar-mirror') {
    const cells = farEndCells(state, board, id, cell);
    if (!cells.length) { ctx.log(state, `${card.name}: there's no Investigation space for the other end${id === 'hidden-passage' ? ' within 10 spaces' : ''}, so nothing comes of it.`); return; }
    state.pendingEvent = { id, seat: state.cur, cell, cells };
    return;
  }
  if (id === 'decrepit-truck') { placeTruck(state, board, pl, ctx, events); return; }
  if (id === 'hiding-spot') placeHidingSpot(state, board, cell, ctx, events);
  if (choicesFor(id, state, pl)) {
    state.pendingEvent = { id, seat: state.cur, cell };
    return;
  }
  runEvent(state, board, id, null, cell, ctx, events);
}

// The answer to a pending event.
export function answerEvent(state, board, action, ctx, events) {
  const pe = state.pendingEvent;
  if (!pe) return 'no event to answer';
  const pl = ctx.curPlayer(state);
  const opts = choicesFor(pe.id, state, pl);
  const pick = opts?.find((o) => o.value === action.choice);
  if (!pick) return 'choose one of the options';
  if (!pick.ok) return 'that option is not available';
  if (pick.pick && !pick.pick.includes(action.cell)) return 'choose one of the marked spaces';
  state.pendingEvent = null;
  runEvent(state, board, pe.id, action.choice, pe.cell, ctx, events, action);
  return null;
}

function hit(state, board, pl, type, ctx, events, source, mod = 0) {
  const amount = Math.max(0, 1 + ctx.randInt(state, 6) + mod);
  return applyDamage(state, board, pl, type, amount, { log: ctx.log, source }, events);
}

function runEvent(state, board, id, choice, cell, ctx, events, action = {}) {
  const pl = ctx.curPlayer(state);
  const card = EVENT_BY_ID[id];
  const src = card.name;
  const tally = (s) => {
    state.survivors ??= { live: 0, die: 0 };
    state.survivors[s]++;
    ctx.log(state, `${pl.name} chooses ${s === 'live' ? 'Live' : 'Die'}: the survivor ${s === 'live' ? 'lives' : 'dies'}. (Team: ${state.survivors.live} lived, ${state.survivors.die} died.)`);
    events.push({ type: 'survivor', outcome: s, tally: { ...state.survivors } });
  };
  if (choice === 'skip') { ctx.log(state, `${pl.name} leaves the ${src} alone.`); return; }
  if (choice === 'place') { placeLink(state, board, id, cell, action.cell, ctx, events); return; }
  if (id === 'hiding-spot') {
    if (choice === 'hide' && !hide(state, board, pl, ctx, events)) { state.steps = 0; state.endTurnNow = true; }
    else ctx.log(state, `${pl.name} leaves the hiding spot for later.`);
    return;
  }
  if (pastMidnight(state) && card.afterMidnight && afterMidnight(state, board, id, choice, cell, pl, ctx, events)) return;
  switch (id) {
    case 'roof-collapse': {
      const k = nearestDoor(board, cell, state);
      if (k) { blockDoor(state, k); ctx.log(state, `${src}: the nearest door is blocked.`); events.push({ type: 'doors' }); }
      if (choice === 'pass' && k) {
        hit(state, board, pl, 'P', ctx, events, src);
        state.doorPass = { edge: k, seat: pl.seat, turn: state.turn };
        ctx.log(state, `${pl.name} can force through it this turn.`);
      }
      break;
    }
    case 'police-patrol': {
      const died = (state.survivors?.die ?? 0) > 0;
      ctx.log(state, `${src}: ${died ? 'survivors have died, and the questions take time' : 'the patrol slows everyone down'}.`);
      shiftClock(state, died ? 2 : 1, ctx);
      break;
    }
    case 'enigmatic-hourglass': {
      const heads = ctx.randInt(state, 2) === 0;
      events.push({ type: 'coin', heads });
      if (heads) { ctx.log(state, `${src}: heads.`); shiftClock(state, -1, ctx); } else {
        const bag = pl.inventory.obolcraft;
        if (bag.length) { const [o] = bag.splice(ctx.randInt(state, bag.length), 1); ctx.log(state, `${src}: tails. ${pl.name} loses an ${o.type} Obol.`); } else ctx.log(state, `${src}: tails, but ${pl.name} has no Obols to lose.`);
      }
      break;
    }
    case 'spirit-board':
      ctx.revealEvidence(state, board, cell);
      hit(state, board, pl, 'S', ctx, events, src);
      break;
    case 'fall-through':
      exhaust(state, pl, 'defense', ctx, events);
      ctx.log(state, `${src}: ${pl.name} falls through and investigates twice.`);
      ctx.investigateAgain(state, board, cell, events);
      ctx.investigateAgain(state, board, cell, events);
      break;
    case 'bumped-shelf':
      if (choice === 'hide') { ctx.log(state, `${pl.name} hides.`); shiftClock(state, 1, ctx); } else {
        const heads = ctx.randInt(state, 2) === 0;
        events.push({ type: 'coin', heads });
        ctx.log(state, `${pl.name} tries to leave: ${heads ? 'heads, they slip away' : 'tails'}.`);
        if (!heads) ctx.attack(state, board, cell, events);
      }
      break;
    case 'ominous-vhs': {
      const spots = exposeSpots(state, board, pl, 3, ctx);
      const attacks = spots.filter((s) => s.type === 'attack').length;
      ctx.log(state, `${src}: ${spots.length ? spots.map((s) => `${s.label} holds ${s.type ? `an ${s.type} Obol` : 'nothing'}`).join(', ') : 'no spots left to expose'}.`);
      events.push({ type: 'exposed', cells: spots.map((s) => s.cell) });
      for (let k = 0; k < attacks; k++) hit(state, board, pl, 'M', ctx, events, src);
      break;
    }
    case 'tarot-cards': {
      ctx.log(state, `${src}: ${pl.name} lives through three events, then reveals an Evidence card.`);
      state.eventQueue = [...(state.eventQueue ?? []), 'tarot-1', 'tarot-2', 'tarot-3', 'tarot-reveal'];
      break;
    }
    case 'injured-survivor':
      tally(choice);
      if (choice === 'live') {
        const paid = pl.inventory.obolcraft.splice(0, 3);
        ctx.log(state, `${pl.name} pays 3 Obols (${paid.map((o) => o.type).join(', ')}).`);
        const spots = exposeSpots(state, board, pl, 2, ctx);
        ctx.log(state, spots.length ? `Exposed: ${spots.map((s) => `${s.label} holds ${s.type ? `an ${s.type} Obol` : 'nothing'}`).join(', ')}.` : 'No spots left to expose.');
        events.push({ type: 'exposed', cells: spots.map((s) => s.cell) });
      }
      break;
    case 'huddled-survivors':
      tally(choice);
      if (choice === 'live') {
        const k = Number.isInteger(action.item) && isWeapon(pl.inventory.equipment[action.item]?.id) ? action.item : pl.inventory.equipment.findIndex((e) => isWeapon(e.id));
        const [gone] = pl.inventory.equipment.splice(k, 1);
        pl.white--;
        ctx.log(state, `${pl.name} gives up the ${EQUIPMENT_BY_ID[gone.id].name} and a white die, and investigates twice.`);
        ctx.investigateAgain(state, board, cell, events);
        ctx.investigateAgain(state, board, cell, events);
      }
      break;
    case 'insane-survivor':
      tally(choice);
      if (choice === 'live') { hit(state, board, pl, 'P', ctx, events, src); ctx.revealEvidence(state, board, cell); }
      break;
    case 'haunted-portrait': {
      pl.injuries = { P: 0, M: 0, S: 0 };
      state.decks.events.push(PORTRAIT_CURSE);
      const d = state.decks.events;
      for (let i = d.length - 1; i > 0; i--) { const j = ctx.randInt(state, i + 1); [d[i], d[j]] = [d[j], d[i]]; }
      ctx.log(state, `${src}: ${pl.name}'s injuries are gone. Something is shuffled into the Event deck; whoever draws it dies.`);
      break;
    }
    case 'nailed-shut': {
      // A breached doorway has no door left to nail.
      const doors = buildingDoors(board, nearestIndoor(board, cell)).filter((k) => blockDoor(state, k));
      ctx.log(state, `${src}: ${doors.length} door${doors.length === 1 ? '' : 's'} in the building ${doors.length === 1 ? 'is' : 'are'} blocked.`);
      events.push({ type: 'doors' });
      break;
    }
    case 'message-cypher':
      shiftClock(state, 2, ctx);
      ctx.revealEvidence(state, board, cell);
      break;
    case 'wooden-boards': {
      shiftClock(state, 1, ctx);
      const b = nearestIndoor(board, cell);
      const spots = [cell, ...buildingCells(board, b).filter((i) => i !== cell && board.grid.cells[i].marker === 'investigation' && board.grid.cells[i].walkable)];
      ctx.log(state, `${src}: ${pl.name} searches ${spots.length === 1 ? 'this space again' : `${spots.length} spaces in the building`}, ignoring attacks.`);
      state.flags = { ...(state.flags ?? {}), ignoreAttack: true };
      for (const i of spots) ctx.investigateAgain(state, board, i, events);
      state.flags.ignoreAttack = false;
      break;
    }
    case 'distant-gunshots':
      state.flags = { ...(state.flags ?? {}), negateAttackCards: state.round };
      ctx.log(state, `${src}: for the rest of this turn the team negates Attack cards.`);
      break;
    case 'distant-screams':
      for (const p of alive(state)) hit(state, board, p, 'M', ctx, events, src, -2);
      state.flags = { ...(state.flags ?? {}), avoidAttacks: state.round };
      ctx.log(state, `${src}: attacks are avoided for the rest of this turn.`);
      break;
    case 'lockdown':
      state.lockdown = { seat: pl.seat, turn: state.turn };
      ctx.log(state, `${src}: every door on the map is locked until ${pl.name}'s next turn. Touch any Key space to open every door for good.`);
      events.push({ type: 'doors' });
      break;
    case 'chalk-scrawled-narrative': {
      const m = state.mystery;
      if (m) for (let n = 0; n < m.deck.length; n++) if (!m.flipped.includes(n)) ctx.flipEvidence(state, board, n, cell, events);
      ctx.log(state, `${src}: every piece of evidence is revealed, and the night lurches to its last turn before midnight.`);
      state.clockShift = Math.max(state.clockShift ?? 0, state.config.turnsToMidnight - state.round);
      state.endTurnNow = true;
      break;
    }
    default:
      if (FOUND_HAZARDS.has(id) || PLAYER_TRAPS.has(id)) {
        const by = PLAYER_TRAPS.has(id) ? 'player' : 'found';
        (state.hazards ??= []).push({ id, cell, by, seat: pl.seat, waitFor: by === 'found' ? pl.seat : null, used: false });
        ctx.log(state, `${src} ${by === 'player' ? 'is set' : 'appears'} at ${ctx.label(board, cell)}${by === 'player' ? ' (it only affects monsters)' : ''}.`);
        events.push({ type: 'hazard', id, cell, by });
      }
  }
}

// Queued follow-ups (Tarot Cards). Returns true if something was started.
export function runQueue(state, board, ctx, events) {
  while (state.eventQueue?.length && !state.pendingEvent && !state.mystery?.pendingReveal) {
    const next = state.eventQueue.shift();
    if (next === 'tarot-reveal') { ctx.revealEvidence(state, board, ctx.curPlayer(state).pos); continue; }
    // A Tarot event: collect an Event Obol if the bag has one, then draw.
    const pl = ctx.curPlayer(state);
    const k = state.bag.indexOf('event');
    if (k >= 0) { state.bag.splice(k, 1); pl.inventory.obolcraft.push({ type: 'event', at: 'Tarot Cards', turn: state.round }); }
    ctx.drawEvent(state, board, pl.pos, events);
  }
}

// --- the map -------------------------------------------------------------------------
// The door override for movement: blocked doors are walls; during Lockdown
// every door is locked; after a Key in Lockdown every door is open.
export function doorOverride(state) {
  const doors = state.doors ?? {};
  const lock = state.lockdown;
  const pass = state.doorPass?.turn === state.turn && state.doorPass.seat === state.cur ? state.doorPass.edge : null;
  if (!Object.keys(doors).length && !lock && !state.allDoorsOpen && !pass) return undefined;
  return (k, t) => {
    if (!t || t === 'wall' || t === 'window' || t === 'boardedWindow') return t;
    if (k === pass) return 'door';
    if (doors[k] === 'breached') return 'door';   // an open doorway for good, Lockdown or not
    if (doors[k] === 'blocked') return 'wall';
    if (state.allDoorsOpen || doors[k] === 'open') return 'door';
    if (lock) return 'lockedDoor';
    return t;
  };
}
// Lockdown ends when the discovering player's turn comes round again.
export function startOfTurn(state, ctx) {
  if (state.lockdown && state.lockdown.seat === state.cur && state.turn > state.lockdown.turn) {
    state.lockdown = null;
    ctx.log(state, 'The Lockdown lifts.');
  }
  for (const h of state.hazards ?? []) if (h.waitFor !== null && state.players[h.waitFor]?.pos !== h.cell) h.waitFor = null;
}
// A player touches a Key during Lockdown: every door opens for good.
export function keyTouched(state, ctx) {
  if (!state.lockdown) return;
  state.lockdown = null;
  state.allDoorsOpen = true;
  ctx.log(state, 'The Key breaks the Lockdown: every door on the map is unlocked for good.');
}

// Movement cost of entering a cell for a player: Sinkhole 5, Flooded Out ×2
// (within 1), Overgrown Brambles: entering ends your movement.
export function playerStepCost(state, board, i, seat) {
  let cost = 1;
  for (const h of state.hazards ?? []) {
    if (h.by !== 'found' || h.waitFor === seat) continue;
    if (h.id === 'sinkhole' && h.cell === i) cost = Math.max(cost, 5);
    if (h.id === 'flooded-out' && cellRange(board.grid, h.cell, i) <= 1) cost = Math.max(cost, 2);
    if (h.id === 'overgrown-brambles' && h.cell === i) cost = Infinity;
  }
  return cost;
}
// A player enters a cell: Consecrated Ash heals Spiritual injuries.
export function playerEnters(state, pl, i, ctx) {
  for (const h of state.hazards ?? []) {
    if (h.cell !== i || h.used || h.waitFor === pl.seat) continue;
    if (h.id === 'consecrated-ash' && (pl.injuries?.S ?? 0) > 0) {
      pl.injuries.S--;
      ctx.log(state, `The Consecrated Ash eases ${pl.name}'s Spiritual injury.`);
    }
  }
}
// Flickering Lights: Physical damage near it ignores the lowest defense die.
export function flickeringNear(state, board, pl) {
  return (state.hazards ?? []).some((h) => h.id === 'flickering-lights' && h.waitFor !== pl.seat && cellRange(board.grid, h.cell, pl.pos) <= 4);
}

// A monster steps onto a cell. Returns { stop, cut } (stop moving; lose
// `cut` more steps), after applying the trap's effect.
export function monsterEnters(state, board, monster, i, ctx, events, hurt) {
  const card = MONSTER_BY_ID[monster.kind];
  const traits = card?.traits ?? [];
  const corporeal = traits.includes('Corporeal');
  let stop = false, cut = 0;
  for (const h of state.hazards ?? []) {
    if (h.cell !== i || h.used) continue;
    const name = EVENT_BY_ID[h.id]?.name ?? h.id;
    const say = (t) => { ctx.log(state, `${name}: ${t}`); events.push({ type: 'trap', id: h.id, cell: i, monster: monster.id }); };
    switch (h.id) {
      case 'coil-of-razor-wire':
        if (!corporeal) break;
        h.used = true; cut += 5; say(`the ${card.name} is tangled (−5 movement).`); hurt(1, null); break;
      case 'rusty-bear-trap':
        if (!corporeal) break;
        h.used = true; stop = true;
        monster.immobileRounds = traits.includes('Fae') ? 2 : 1;
        say(`the ${card.name} is caught, immobilized for ${monster.immobileRounds === 2 ? 'two turns' : 'a turn'}.`); break;
      case 'deadfall-trap':
        if (!corporeal) break;
        h.used = true; stop = true; monster.mods = { ...(monster.mods ?? {}), interrupted: true };
        say(`the ${card.name} is crushed and interrupted.`); hurt(1, null); break;
      case 'bonfire':
        say(`the ${card.name} walks through the fire.`); hurt(1, 'fire'); break;
      case 'consecrated-ash':
        if (traits.includes('Incorporeal') || traits.includes('Semi-Corporeal')) {
          h.used = true; stop = true; monster.immobileRounds = Math.max(monster.immobileRounds ?? 0, 1);
          monster.mods = { ...(monster.mods ?? {}), interrupted: true };
          say(`the ${card.name} is stunned.`);
        }
        break;
      case 'sinkhole': cut += 4; say(`the ${card.name} wades through the sinkhole.`); break;
      case 'flooded-out': cut += 1; break;
      default:
    }
  }
  return { stop, cut };
}

// Summoning Circle: at the start of a round, a revealed Demonic monster is
// pulled to it and bound for two turns.
export function summon(state, ctx, events) {
  for (const h of state.hazards ?? []) {
    if (h.id !== 'summoning-circle' || h.used) continue;
    const m = state.monsters.find((x) => MONSTER_BY_ID[x.kind]?.traits.includes('Demon'));
    if (!m) continue;
    h.used = true;
    events.push({ type: 'monsterTeleport', id: m.id, from: m.pos, to: h.cell });
    m.pos = h.cell;
    m.immobileRounds = 2;
    ctx.log(state, `The Summoning Circle drags the ${MONSTER_BY_ID[m.kind].name} in and binds it for two turns.`);
  }
}

// --- helpers --------------------------------------------------------------------------
function exposeSpots(state, board, pl, n, ctx) {
  const used = new Set(state.used);
  const spots = [];
  board.grid.cells.forEach((c, i) => {
    if (c.marker === 'investigation' && c.walkable && !used.has(i) && state.exposed?.[i] === undefined) spots.push(i);
  });
  spots.sort((a, b) => cellRange(board.grid, pl.pos, a) - cellRange(board.grid, pl.pos, b));
  return spots.slice(0, n).map((cell) => {
    const type = state.bag.length ? state.bag.splice(ctx.randInt(state, state.bag.length), 1)[0] : null;
    (state.exposed ??= {})[cell] = type;
    return { cell, type, label: ctx.label(board, cell) };
  });
}
function nearestDoor(board, from, state) {
  const g = board.grid;
  const a = g.coords(from);
  let best = null, bd = Infinity;
  for (const [k, t] of g.edges) {
    if (!(t === 'door' || t === 'lockedDoor' || t.startsWith('oneWayDoor'))) continue;
    if (state?.doors?.[k] === 'breached') continue; // nothing left to block
    const [o, x, y] = [k[0], ...k.slice(1).split(',').map(Number)];
    const cx = o === 'v' ? x - 0.5 : x, cy = o === 'h' ? y - 0.5 : y;
    const d = Math.hypot(cx - a.x, cy - a.y);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}
function nearestIndoor(board, from) {
  const g = board.grid;
  if (g.cells[from].area === 'indoor') return from;
  let best = -1, bd = Infinity;
  g.cells.forEach((c, i) => { if (c.area === 'indoor') { const d = cellRange(g, from, i); if (d < bd) { bd = d; best = i; } } });
  return best;
}
function buildingCells(board, start) {
  const g = board.grid;
  if (start < 0) return [];
  const seen = new Set([start]);
  const q = [start];
  for (let n = 0; n < q.length; n++) {
    const { x, y } = g.coords(q[n]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!g.inBounds(x + dx, y + dy)) continue;
      const j = g.index(x + dx, y + dy);
      if (!seen.has(j) && g.cells[j].area === 'indoor') { seen.add(j); q.push(j); }
    }
  }
  return [...seen];
}
function buildingDoors(board, start) {
  const g = board.grid;
  const cells = new Set(buildingCells(board, start));
  const out = [];
  for (const [k, t] of g.edges) {
    if (!(t === 'door' || t === 'lockedDoor' || t.startsWith('oneWayDoor'))) continue;
    const [o, x, y] = [k[0], ...k.slice(1).split(',').map(Number)];
    const a = g.inBounds(x, y) ? g.index(x, y) : -1;
    const b = o === 'v' ? (g.inBounds(x - 1, y) ? g.index(x - 1, y) : -1) : (g.inBounds(x, y - 1) ? g.index(x, y - 1) : -1);
    if (cells.has(a) || cells.has(b)) out.push(k);
  }
  return out;
}

// The afterMidnight versions (cards/events.js). Returns true if handled.
function afterMidnight(state, board, id, choice, cell, pl, ctx, events) {
  const card = EVENT_BY_ID[id];
  const monster = state.monsters[0] ?? null;
  ctx.log(state, `${card.name}, after midnight: ${card.afterMidnight}`);
  switch (id) {
    case 'police-patrol':
      if ((state.survivors?.die ?? 0) > 0) { ctx.log(state, 'Survivors have died: the patrol doesn’t come.'); return true; }
      for (const m of state.monsters) m.lure = { cell };
      ctx.log(state, `Sirens at ${ctx.label(board, cell)}: the monster's next move heads there.`);
      return true;
    case 'enigmatic-hourglass': {
      const heads = ctx.randInt(state, 2) === 0;
      events.push({ type: 'coin', heads });
      if (heads) {
        if (monster?.intents?.length) {
          const gone = monster.intents.shift();
          ctx.log(state, `Heads: the monster's ${gone.name} is cancelled.`);
        } else if (monster) { monster.cancelNext = true; ctx.log(state, "Heads: the monster's next action will be cancelled."); }
      } else {
        const bag = pl.inventory.obolcraft;
        if (bag.length) { const [o] = bag.splice(ctx.randInt(state, bag.length), 1); ctx.log(state, `Tails: ${pl.name} loses an ${o.type} Obol.`); } else ctx.log(state, `Tails, but ${pl.name} has no Obols to lose.`);
      }
      return true;
    }
    case 'bumped-shelf':
      if (choice !== 'hide') return false; // trying to leave is the same as before midnight
      pl.hiddenRound = state.round;
      state.endTurnNow = true;
      ctx.log(state, `${pl.name} hides: the monster can't target them this round.`);
      return true;
    case 'message-cypher': {
      const dice = freeDice(state).slice(0, 2);
      for (const { d } of dice) d.spent = true;
      ctx.log(state, `${pl.name} spends ${dice.map(({ d }) => d.v).join(' and ')}.`);
      if (monster) triggerWeakness(state, board, monster, 1, ctx, events);
      return true;
    }
    case 'wooden-boards':
      state.doorBan = { cell, round: state.round };
      state.endTurnNow = true;
      ctx.log(state, `${pl.name} boards up the doors: the monster can't use a door within 3 spaces of ${ctx.label(board, cell)} this round.`);
      events.push({ type: 'doors' });
      return true;
    case 'chalk-scrawled-narrative':
      if (monster) triggerWeakness(state, board, monster, 2, ctx, events);
      pl.skipTurns = (pl.skipTurns ?? 0) + 1;
      ctx.log(state, `${pl.name} will skip their next turn.`);
      return true;
    default:
      return false;
  }
}

// Wooden Boards (after midnight): may the monster cross the door on this edge?
export function monsterDoorBanned(state, board, from, to) {
  const ban = state.doorBan;
  if (!ban || ban.round !== state.round) return false;
  const g = board.grid;
  const a = g.coords(from), b = g.coords(to);
  if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) return false;
  const k = a.x !== b.x ? `v${Math.max(a.x, b.x)},${a.y}` : `h${a.x},${Math.max(a.y, b.y)}`;
  const t = g.edges.get(k);
  if (!(t === 'door' || t === 'lockedDoor' || t?.startsWith('oneWayDoor'))) return false;
  return cellRange(g, ban.cell, from) <= 3 || cellRange(g, ban.cell, to) <= 3;
}
