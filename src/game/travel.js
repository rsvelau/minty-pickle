// The travel Events (src/game/cards/events.js), played by the game:
//
//   Hidden Passage  A hole here, and another on an Investigation space within
//                   10 spaces that the finder picks. For the rest of the game
//                   anyone standing on either hole can go through to the other
//                   for 5 movement (not with less). Monsters can't use it.
//   Peculiar Mirror A mirror here, and another on any Investigation space the
//                   finder picks. Anyone can step through, free; then flip a
//                   coin: tails, they lose an Obol (any colour).
//   Hiding Spot     Where it was found. Once in the game, anyone on it can hide
//                   there (the finder at once, or anyone later): immobile, and
//                   immune to new attacks for up to two rounds (injuries they
//                   already have stay). On their turn they come out by rolling,
//                   or stay hidden (Stay hidden ends the turn).
//   Decrepit Truck  An old truck on the road space nearest the finder.
//                   Anyone within 1 space can get in on their turn. After the
//                   players' turns and before the monster's, if the finder is
//                   aboard, the truck takes its turn: the finder drives it up
//                   to 25 road or bridge spaces, one at a time, everyone aboard
//                   with it. Driving into the monster: 🎲🎲🎲 added, through
//                   its toughness, and it's Stunned (it loses every action it
//                   has queued). The drive ends there, or whenever the driver
//                   parks, and the truck is wrecked for good.
//
// On the state: travel = { passages: [{ a, b }], mirrors: [{ a, b }],
// hiding: [{ cell, used }], truck: { cell, owner, aboard: [seat], heading } | null },
// a player's `hiding` { until } and the 'driving' phase's state.drive { steps }.
import { cellRange } from './cards/injuries.js';
import { strikeMonster } from './equipmentPlay.js';
import { MONSTER_BY_ID } from './cards/monsters.js';

export const PASSAGE_RANGE = 10;
export const PASSAGE_COST = 5;
export const HIDE_ROUNDS = 2;
export const TRUCK_DRIVE = 25;
const SIDES = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];

export const travelOf = (state) => (state.travel ??= { passages: [], mirrors: [], hiding: [], truck: null });
const where = (board, i) => { const { x, y } = board.grid.coords(i); return `${String.fromCharCode(65 + x)}${y + 1}`; };

// --- picking the far end (Hidden Passage, Peculiar Mirror) --------------------------
// Investigation spaces the far end can go on.
export function farEndCells(state, board, id, from) {
  const g = board.grid;
  const max = id === 'hidden-passage' ? PASSAGE_RANGE : Infinity;
  const t = travelOf(state);
  const taken = new Set([...t.passages, ...t.mirrors].flatMap((l) => [l.a, l.b]));
  return g.cells.map((c, i) => (c.marker === 'investigation' && i !== from && !taken.has(i) && cellRange(g, from, i) <= max ? i : -1)).filter((i) => i >= 0);
}
// The finder picked the far end: the link is made.
export function placeLink(state, board, id, from, to, ctx, events) {
  const t = travelOf(state);
  const passage = id === 'hidden-passage';
  (passage ? t.passages : t.mirrors).push({ a: from, b: to });
  ctx.log(state, passage
    ? `A hole opens in the floor at ${where(board, from)}, and another at ${where(board, to)}: going through costs ${PASSAGE_COST} movement.`
    : `A blue-glowing mirror stands at ${where(board, from)}, and its twin at ${where(board, to)}: step through, free (then flip a coin: tails, lose an Obol).`);
  events.push({ type: 'travel', kind: passage ? 'passage' : 'mirror', a: from, b: to });
}

// --- moving ---------------------------------------------------------------------------
// The ways through from where the pawn stands (extra movement options).
export function travelOptions(state, pl) {
  const t = state.travel;
  if (!t) return [];
  const out = [];
  for (const l of t.passages) {
    const to = l.a === pl.pos ? l.b : l.b === pl.pos ? l.a : -1;
    if (to >= 0 && state.steps >= PASSAGE_COST) out.push({ i: to, dx: 0, dy: 0, name: 'through the Hidden Passage', travel: 'passage', cost: PASSAGE_COST });
  }
  for (const l of t.mirrors) {
    const to = l.a === pl.pos ? l.b : l.b === pl.pos ? l.a : -1;
    if (to >= 0) out.push({ i: to, dx: 0, dy: 0, name: 'through the mirror', travel: 'mirror', cost: 0 });
  }
  return out;
}
export const isTravelEnd = (state, i) => !!state.travel && [...state.travel.passages, ...state.travel.mirrors].some((l) => l.a === i || l.b === i);
// After going through: the passage logs; the mirror flips its coin.
export function afterTravel(state, board, pl, o, ctx, events) {
  if (o.travel === 'passage') { ctx.log(state, `${pl.name} goes through the Hidden Passage to ${where(board, o.i)}.`); return; }
  const heads = ctx.randInt(state, 2) === 0;
  events.push({ type: 'coin', heads });
  const obols = pl.inventory.obolcraft;
  if (heads || !obols.length) {
    ctx.log(state, `${pl.name} steps through the mirror to ${where(board, o.i)}${heads ? ' (heads).' : ' (tails, but no Obol to lose).'}`);
    return;
  }
  const count = {};
  for (const ob of obols) count[ob.type] = (count[ob.type] ?? 0) + 1;
  const type = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  obols.splice(obols.findIndex((ob) => ob.type === type), 1);
  ctx.log(state, `${pl.name} steps through the mirror to ${where(board, o.i)}. Tails: the mirror keeps an Obol (${type}).`);
}

// --- hiding -----------------------------------------------------------------------------
export const hidingSpotAt = (state, i) => state.travel?.hiding.find((h) => h.cell === i && !h.used) ?? null;
export const isHiding = (pl) => !!pl?.hiding;
export function placeHidingSpot(state, board, cell, ctx, events) {
  travelOf(state).hiding.push({ cell, used: false });
  events.push({ type: 'travel', kind: 'hiding', a: cell });
  ctx.log(state, `A hiding spot at ${where(board, cell)}: once in the game, anyone on it can hide there for up to ${HIDE_ROUNDS} rounds.`);
}
// Hide (the spot is used up): immobile and out of reach until coming out.
export function hide(state, board, pl, ctx, events) {
  const spot = hidingSpotAt(state, pl.pos);
  if (!spot) return 'no hiding spot here';
  spot.used = true;
  pl.hiding = { until: state.round + HIDE_ROUNDS };
  ctx.log(state, `${pl.name} hides at ${where(board, pl.pos)}: out of reach for up to ${HIDE_ROUNDS} rounds (their injuries stay).`);
  events.push({ type: 'hide', seat: pl.seat, cell: pl.pos, on: true });
  return null;
}
export function comeOut(state, pl, ctx, events, why = '') {
  if (!pl.hiding) return;
  delete pl.hiding;
  ctx.log(state, `${pl.name} comes out of hiding${why}.`);
  events.push({ type: 'hide', seat: pl.seat, cell: pl.pos, on: false });
}

// --- the truck --------------------------------------------------------------------------
const isRoad = (c) => c && c.walkable !== false && (c.sub === 'street' || c.bridge);
export function placeTruck(state, board, pl, ctx, events) {
  const g = board.grid;
  // The road space nearest the finder (straight-line, then index for ties).
  let best = -1, bd = Infinity;
  g.cells.forEach((c, i) => {
    if (!isRoad(c)) return;
    const d = cellRange(g, pl.pos, i) * 1000 + Math.abs(g.coords(i).x - g.coords(pl.pos).x) + Math.abs(g.coords(i).y - g.coords(pl.pos).y);
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0) { ctx.log(state, 'An old truck would be here, but there is no road anywhere.'); return; }
  const t = travelOf(state);
  t.truck = { cell: best, owner: pl.seat, aboard: [], heading: 0 };
  ctx.log(state, `An old, broken-down truck sits on the road at ${where(board, best)}. Anyone within a space can get in; ${pl.name} drives it after everyone's turn (up to ${TRUCK_DRIVE} spaces of road, once).`);
  events.push({ type: 'truck', cell: best, heading: 0, placed: true });
}
export const canBoard = (state, board, pl) => {
  const tr = state.travel?.truck;
  return !!tr && !pl.dead && !tr.aboard.includes(pl.seat) && cellRange(board.grid, pl.pos, tr.cell) <= 1;
};
export function board_(state, board, pl, ctx, events) {
  const tr = state.travel?.truck;
  if (!canBoard(state, board, pl)) return 'the truck is not within a space of you';
  const from = pl.pos;
  pl.pos = tr.cell;
  tr.aboard.push(pl.seat);
  if (from !== tr.cell) events.push({ type: 'step', seat: pl.seat, from, to: tr.cell, teleport: true });
  ctx.log(state, `${pl.name} climbs into the truck.`);
  events.push({ type: 'truckBoard', seat: pl.seat });
  return null;
}
// Stepping off on foot leaves the truck.
export function leftTruck(state, pl) {
  const tr = state.travel?.truck;
  if (tr && tr.aboard.includes(pl.seat) && pl.pos !== tr.cell) tr.aboard = tr.aboard.filter((s) => s !== pl.seat);
}
// Does the truck take a turn now (its driver aboard and alive)?
export function truckDue(state) {
  const tr = state.travel?.truck;
  if (!tr || tr.droveRound === state.round) return false;
  const d = state.players[tr.owner];
  return !!d && !d.dead && tr.aboard.includes(tr.owner);
}
// The road spaces the truck can roll to next.
export function driveOptions(state, board) {
  const tr = state.travel?.truck;
  if (!tr || !state.drive || state.drive.steps <= 0) return [];
  const g = board.grid;
  const { x, y } = g.coords(tr.cell);
  const out = [];
  for (const [dx, dy, name] of SIDES) {
    if (!g.inBounds(x + dx, y + dy)) continue;
    const i = g.index(x + dx, y + dy);
    if (!isRoad(g.cells[i])) continue;
    if (!g.canStep(x, y, dx, dy, () => true)) continue;
    out.push({ i, dx, dy, name });
  }
  return out;
}
// One space along the road (everyone aboard with it). Returns true when the drive is over.
export function driveStep(state, board, cell, ctx, events) {
  const tr = state.travel.truck;
  const o = driveOptions(state, board).find((p) => p.i === cell);
  if (!o) return 'the truck can only go along the road';
  const from = tr.cell;
  tr.cell = cell;
  tr.heading = Math.atan2(o.dx, o.dy);
  state.drive.steps--;
  for (const s of tr.aboard) {
    const p = state.players[s];
    if (p && !p.dead) { events.push({ type: 'step', seat: s, from: p.pos, to: cell }); p.pos = cell; }
  }
  events.push({ type: 'truck', cell, from, heading: tr.heading });
  // Into the monster: damage and a Stun, and that's the drive.
  const m = state.monsters.find((mm) => mm.pos === cell && MONSTER_BY_ID[mm.kind]);
  if (m) {
    const dice = [0, 1, 2].map(() => 1 + ctx.randInt(state, 6));
    const dmg = dice.reduce((a, b) => a + b, 0);
    const name = MONSTER_BY_ID[m.kind].name;
    ctx.log(state, `The truck slams into the ${name}: ${dice.join(' + ')} = ${dmg} damage.`);
    strikeMonster(state, board, m, dmg, null, ctx, events);
    if (state.monsters.includes(m)) {
      m.intents = [];
      ctx.log(state, `The ${name} is Stunned: it loses every action it had queued this turn.`);
      events.push({ type: 'monsterStunned', id: m.id });
    }
    return true;
  }
  return state.drive.steps <= 0;
}
// The drive is over (parked, crashed or out of road): the truck is wrecked for good.
export function wreckTruck(state, board, ctx, events) {
  const tr = state.travel?.truck;
  if (!tr) return;
  ctx.log(state, `The truck shudders to a stop at ${where(board, tr.cell)} and dies for good.`);
  state.travel.truck = null;
  state.drive = null;
  events.push({ type: 'truck', gone: true, cell: tr.cell });
}
