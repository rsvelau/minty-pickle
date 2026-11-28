// Care Packages and the night's end (after midnight).
//
// The night: 24 turns after midnight. At 19 a warning (5 left); when the 24th
// is over and the monster still stands, the team is Lost in the night and
// everyone loses.
//
// Care Packages: every 6 turns after midnight (6, 12, 18) a military crate
// falls from a purple portal onto a random Investigation marker (investigated
// or not); the marker is a crate from then on. It holds 5 Equipment cards from
// the deck, at least one with a skill in the monster's weakness elements
// (guaranteeWeakness); whoever stands on it takes what they want ('crate' action), and
// what they leave stays for the others. An empty crate is gone.
//   state.crates = [{ cell, items: [equipment id] }]
//   state.midnightRound: the round midnight struck
import { EQUIPMENT_BY_ID } from './cards/equipment.js';
import { drawCard } from './decks.js';
import { MONSTER_BY_ID } from './cards/monsters.js';

export const NIGHT_TURNS = 24;
export const NIGHT_WARNING = 19;
export const CRATE_EVERY = 6;
export const CRATE_ITEMS = 5;

// Turns since midnight (0 the turn it strikes), or null before it.
export const turnsAfterMidnight = (state) => (state.midnightRound === undefined || state.midnightRound === null ? null : state.round - state.midnightRound);
export const turnsLeftInNight = (state) => { const n = turnsAfterMidnight(state); return n === null ? null : Math.max(0, NIGHT_TURNS - n); };

export const crateAt = (state, cell) => (state.crates ?? []).find((c) => c.cell === cell) ?? null;

// A new turn after midnight has begun (endRound, after the round count moved on).
export function nightTurn(state, board, ctx, events) {
  const n = turnsAfterMidnight(state);
  if (n === null || state.phase === 'over' || state.won) return;   // a won game is over for the night too
  if (n >= NIGHT_TURNS) {
    state.phase = 'over';
    state.lostInNight = true;
    ctx.log(state, `Dawn never comes. ${NIGHT_TURNS} turns after midnight the monster still stands: the team is Lost in the night, and everyone loses.`);
    events.push({ type: 'gameOver', lostInNight: true });
    return;
  }
  if (n === NIGHT_WARNING) {
    ctx.log(state, `The night is closing in: ${NIGHT_TURNS - n} turns left. Finish the monster before the night swallows the team.`);
    events.push({ type: 'nightWarning', left: NIGHT_TURNS - n });
  }
  if (n > 0 && n % CRATE_EVERY === 0) dropCrate(state, board, ctx, events);
}

// A crate falls on a random Investigation marker that doesn't hold one yet.
// Every Care Package holds at least one card with a skill in one of the
// monster's weakness elements (one that deals damage, if the deck has one). If
// none was drawn, one is swapped in from further down the Equipment deck: the
// card it replaces goes back where that one was. With none left in the deck
// (all in hands or spent), the package stays as drawn.
export function weakCard(id, weak) {
  return (EQUIPMENT_BY_ID[id]?.abilities ?? []).some((a) => a.kind && weak.includes(a.kind));
}
function guaranteeWeakness(state, items, ctx) {
  const m = state.monsters?.[0];
  const weak = (m && MONSTER_BY_ID[m.kind]?.weakness) ?? [];
  const deck = state.decks?.equipment;
  if (!weak.length || !items.length || !deck || items.some((id) => weakCard(id, weak))) return;
  const hits = (id) => (EQUIPMENT_BY_ID[id]?.abilities ?? []).some((a) => a.kind && weak.includes(a.kind) && a.fx?.dmg !== undefined);
  const candidates = deck.map((id, i) => i).filter((i) => weakCard(deck[i], weak));
  if (!candidates.length) return;
  const striking = candidates.filter((i) => hits(deck[i]));
  const pool = striking.length ? striking : candidates;
  const at = pool[ctx.randInt(state, pool.length)];
  const slot = ctx.randInt(state, items.length);
  [deck[at], items[slot]] = [items[slot], deck[at]];
}

export function dropCrate(state, board, ctx, events) {
  const g = board.grid;
  const spots = g.cells.map((c, i) => (c.marker === 'investigation' && !crateAt(state, i) ? i : -1)).filter((i) => i >= 0);
  if (!spots.length) return null;
  const cell = spots[ctx.randInt(state, spots.length)];
  const items = [];
  for (let k = 0; k < CRATE_ITEMS; k++) { const id = drawCard(state, 'equipment'); if (id) items.push(id); }
  guaranteeWeakness(state, items, ctx);
  if (!items.length) { ctx.log(state, 'A purple portal opens in the sky, but the Care Package it drops is empty: the Equipment deck has run out.'); return null; }
  (state.crates ??= []).push({ cell, items });
  const { x, y } = g.coords(cell);
  ctx.log(state, `A Care Package falls from a purple portal at ${String.fromCharCode(65 + x)}${y + 1}: ${items.length} pieces of Equipment inside. Stand on it to take what you need.`);
  events.push({ type: 'carePackage', cell, items: items.length });
  return cell;
}

// Take item `k` from the crate under the current player.
export function takeFromCrate(state, pl, k, ctx, events) {
  const crate = crateAt(state, pl.pos);
  if (!crate) return 'no Care Package here';
  const id = crate.items[k];
  if (!id) return 'not in the crate';
  crate.items.splice(k, 1);
  const card = EQUIPMENT_BY_ID[id];
  pl.inventory.equipment.push({ id, label: card?.name ?? id, from: 'Care Package' });
  ctx.log(state, `${pl.name} takes the ${card?.name ?? id} from the Care Package${crate.items.length ? ` (${crate.items.length} left)` : ': it is empty'}.`);
  events.push({ type: 'crateTake', seat: pl.seat, cell: crate.cell, item: id, left: crate.items.length });
  if (!crate.items.length) state.crates = state.crates.filter((c) => c !== crate);
  return null;
}
