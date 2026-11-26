// Objective verbs: what happens when an investigator reaches a site of the
// known monster's objective script (scripts.js). One handler per verb,
// shared by every monster that uses it.
//
//   collect  take the step's item (one of each at a time; a candle comes lit)
//   deliver  hand the item in at the site; enough of them wins (Shadow People:
//            4 candles, 2 with one or two players)
//   cleanse  this investigator gains the step's status ('cleanse')
//   escape   with the required status, the investigator leaves the board: the
//            first escape is a team win, and play goes on until everyone has
//            escaped or died (Barghest)
//   upgrade  the carried item gains a mark (`set`), maybe needing another
//            first (`requires`); `completes` achieves the objective (the
//            Strigoi's Cosor: sharpened, then blessed)
//   destroy  with a 6 to spend, asks "Destroy the anchor?" (the 'investigate'
//            answer in rules.js); `count` of them at any Objective marker,
//            then the one `after` them (Poltergeist)
//   hold     once the `after` items are all delivered, someone inside the
//            site's building at the end of each round counts down `rounds`
//            (holdRound, from rules.js endRound; the White Lady's ceremony)
// `unique` items exist once: taken, they're gone from the site. Dropped items
// (Drop) lie where they fell: stepping there picks them up again.
// Defend and kill are the monster's own rules (victims, its health).
//
// On a player: carry [{ item, lit?, sharp?, blessed? }], status { cleanse }, escaped.
// On the state: objective { delivered: { item: n }, taken: { item }, dropped:
// [{ item, cell, ... }], anchors: [cells], ceremony: { held } }.
import { scriptOf, mapSites, knownMonster } from './scripts.js';
import { siteLabel } from '../../core/sites.js';
import { achieveObjective, banishMonster } from '../equipmentPlay.js';
import { watch, offer } from '../reactions.js';
import { buildingOf } from '../../core/mapCheck.js';

export const ITEMS = {
  candle: { label: 'Candle', lit: true },
  'holy-water': { label: 'Holy water' },
  gown: { label: 'Decayed Wedding Gown' },
  ring: { label: 'Tarnished Wedding Ring' },
  'finger-bone': { label: 'Desiccated Finger Bone' },
  cosor: { label: 'Cosor' },
  heirloom: { label: 'Heirloom (a signed ring)' },
};
export const itemLabel = (id) => ITEMS[id]?.label ?? id;
// An item with its marks: "Cosor (sharpened, blessed)", "Candle (out)".
export const describeItem = (c) => {
  const marks = [c.lit === false && 'out', c.sharp && 'sharpened', c.blessed && 'blessed'].filter(Boolean);
  return `${c.blessed ? 'Blessed ' : ''}${itemLabel(c.item)}${marks.length && !c.blessed ? ` (${marks.join(', ')})` : c.lit === false ? ' (out)' : ''}`;
};

// How many deliveries a step needs: `times`, halved (Shadow People: 2) with one or two players.
export function deliveriesNeeded(state, step) {
  const n = step.times ?? 1;
  return step.fewer && state.players.length <= 2 ? step.fewer : n;
}

// The cells of a step's site on this board.
function siteCells(state, board, at) {
  if (at === 'lair') return state.mystery?.spawnCell >= 0 ? [state.mystery.spawnCell] : [];
  if (at === 'start') { const s = board.startCell(); return s >= 0 ? [s] : []; }
  const sites = mapSites(board.grid);
  return at === 'any' ? sites.all : sites[at] ?? [];
}

// Something dropped on `cell` is picked up again, as it was; except by the
// player it was burnt out of the hands of (Unholy Burn), until their next
// turn is over (`banned` seat, `until` round).
// `burntOnly`: only what was burnt out of someone's hands (picked up at the
// start of a turn spent standing on it), not what someone set down.
export function pickUpHere(state, pl, cell, say, { burntOnly = false } = {}) {
  const ob = state.objective;
  const mayTake = (d) => d.cell === cell && !(d.banned === pl.seat && state.round <= d.until) && (!burntOnly || d.banned !== undefined);
  const here = (ob?.dropped ?? []).filter(mayTake);
  if (!here.length) return;
  ob.dropped = ob.dropped.filter((d) => !mayTake(d));
  for (const { cell: _c, banned: _b, until: _u, ...thing } of here) { (pl.carry ??= []).push(thing); say(`${pl.name} picks up the ${itemLabel(thing.item)}.`); }
}

// A player has stepped onto `cell`: play any objective step there.
export function onSiteEnter(state, board, pl, cell, ctx, events) {
  const id = knownMonster(state);
  const sc = scriptOf(id);
  if (!sc || pl.dead || pl.dying || pl.escaped || state.phase === 'over') return;
  const say = (text) => { ctx.log(state, text); events.push({ type: 'objStep', seat: pl.seat, cell, text }); };
  const ob = (state.objective ??= { delivered: {} });
  pickUpHere(state, pl, cell, say);
  for (const step of sc.steps) {
    if (!siteCells(state, board, step.at).includes(cell)) continue;
    const where = siteLabel(step.at);
    if (step.do === 'collect') {
      pl.carry ??= [];
      if (step.unique && ob.taken?.[step.item]) continue;                  // only one of it, already taken
      const have = pl.carry.find((c) => c.item === step.item);
      if (have && (!ITEMS[step.item]?.lit || have.lit)) continue;           // one at a time
      if (have) have.lit = true;                                          // a candle that went out is lit again
      else pl.carry.push({ item: step.item, ...(ITEMS[step.item]?.lit ? { lit: true } : {}) });
      if (step.unique) (ob.taken ??= {})[step.item] = true;
      say(`${pl.name} takes ${ITEMS[step.item]?.lit ? 'a lit ' : ''}${itemLabel(step.item).toLowerCase()} at ${where}.`);
    } else if (step.do === 'deliver') {
      const k = (pl.carry ?? []).findIndex((c) => c.item === step.item && (!ITEMS[step.item]?.lit || c.lit));
      if (k < 0) continue;
      pl.carry.splice(k, 1);
      state.objective ??= { delivered: {} };
      const n = state.objective.delivered[step.item] = (state.objective.delivered[step.item] ?? 0) + 1;
      const need = deliveriesNeeded(state, step);
      say(`${pl.name} brings the ${itemLabel(step.item).toLowerCase()} to ${where}${need > 1 ? `: ${Math.min(n, need)} of ${need}` : ''}.`);
      // A side objective that ends the monster outright (the Banshee's heirloom at the Unmarked Grave).
      if (step.banish && n >= need) { banishMonster(state, ctx, events); continue; }
      if (n >= need && step.completes !== false && !state.objectiveDone) achieveObjective(state, ctx, events);
      // Everything a hold waits for is in: the ceremony starts.
      const hold = sc.steps.find((x) => x.do === 'hold');
      if (hold && !ob.ceremony && hold.after.every((it) => ob.delivered[it])) {
        ob.ceremony = { held: 0 };
        say(`Everything is at ${siteLabel(hold.at)}: the ceremony begins. Keep someone inside for ${hold.rounds} rounds.`);
      }
    } else if (step.do === 'upgrade') {
      const thing = (pl.carry ?? []).find((c) => c.item === step.item);
      if (!thing || thing[step.set] || (step.requires && !thing[step.requires])) {
        if (thing && step.requires && !thing[step.requires]) say(`The ${itemLabel(step.item).toLowerCase()} must be ${step.requires === 'sharp' ? 'sharpened' : step.requires} first.`);
        continue;
      }
      thing[step.set] = true;
      say(`${pl.name}'s ${itemLabel(step.item).toLowerCase()} is ${step.set === 'sharp' ? 'sharpened' : step.set} at ${where}.`);
      if (step.completes && !state.objectiveDone) achieveObjective(state, ctx, events);
    } else if (step.do === 'destroy') {
      ob.anchors ??= [];
      if (ob.anchors.includes(cell) || state.ask) continue;
      if (step.count && ob.anchors.filter((c) => c !== lairOf(state)).length >= step.count) continue;
      if (step.after && ob.anchors.length < step.after) { say(`The anchor at ${where} holds until ${step.after} others are destroyed.`); continue; }
      if (!sixToSpend(state)) { say(`${pl.name} needs a 6 to destroy the anchor at ${where}.`); continue; }
      state.ask = { i: cell, anchor: true };
    } else if (step.do === 'cleanse') {
      if (pl.status?.cleanse) continue;
      (pl.status ??= {}).cleanse = true;
      say(`${pl.name} is cleansed at ${where}.`);
    } else if (step.do === 'escape') {
      if (step.requires && !pl.status?.[step.requires]) {
        say(`${pl.name} reaches ${where}, but can't leave without being cleansed.`);
        continue;
      }
      escape(state, pl, ctx, events, where);
    }
  }
}

const lairOf = (state) => state.mystery?.spawnCell ?? -1;
// A rolled 6 the current player can spend (not moved with): free first, else in Defense.
export function sixToSpend(state) {
  const free = state.pool.findIndex((d, n) => d.v === 6 && !d.spent && !state.slots.includes(n) && !state.defSlots.includes(n));
  if (free >= 0) return { n: free };
  const def = state.defSlots.find((n) => state.pool[n]?.v === 6 && !state.pool[n].spent);
  return def !== undefined ? { n: def, fromDefense: true } : null;
}
// The answer to "Destroy the anchor?": the 6 is spent. Returns true if done.
export function destroyAnchor(state, cell, ctx, events) {
  const six = sixToSpend(state);
  if (!six) return false;
  if (six.fromDefense) state.defSlots.splice(state.defSlots.indexOf(six.n), 1);
  state.pool[six.n].spent = true;
  state.pool[six.n].usedFor = 'Anchor';
  const ob = (state.objective ??= { delivered: {} });
  (ob.anchors ??= []).push(cell);
  const lair = cell === lairOf(state);
  const pl = state.players[state.cur];
  ctx.log(state, lair ? `${pl.name} destroys the last anchor, at the Lair.` : `${pl.name} destroys a spiritual anchor (${ob.anchors.length} of 4).`);
  events.push({ type: 'objStep', seat: pl.seat, cell, text: lair ? 'The last anchor breaks' : `Anchor destroyed (${ob.anchors.length} of 4)` });
  if (lair && !state.objectiveDone) achieveObjective(state, ctx, events);
  return true;
}

// End of a round: a ceremony in progress counts a round if someone is inside
// the site's building; nobody there, it waits (White Lady).
export function holdRound(state, board, ctx, events) {
  const ob = state.objective;
  const sc = scriptOf(knownMonster(state));
  const hold = sc?.steps.find((x) => x.do === 'hold');
  if (!hold || !ob?.ceremony || state.objectiveDone) return;
  const g = board.grid;
  const sites = siteCells(state, board, hold.at);
  const buildings = new Set(sites.map((c) => buildingOf(g, c)));
  const inside = state.players.filter((p) => !p.dead && !p.dying && !p.escaped && g.cells[p.pos]?.area === 'indoor' && buildings.has(buildingOf(g, p.pos)));
  if (!inside.length) { ctx.log(state, `No one is in ${siteLabel(hold.at)}: the ceremony waits.`); return; }
  ob.ceremony.held++;
  ctx.log(state, `The ceremony holds (${ob.ceremony.held} of ${hold.rounds}), ${inside.map((p) => p.name).join(' and ')} keeping vigil.`);
  events.push({ type: 'objStep', seat: inside[0].seat, cell: inside[0].pos, text: `Ceremony ${ob.ceremony.held} of ${hold.rounds}` });
  if (ob.ceremony.held >= hold.rounds) achieveObjective(state, ctx, events);
}

// An investigator gets away. The first one wins it for the team; the game
// goes on until everyone has escaped or died (rules.js nextPlayer).
function escape(state, pl, ctx, events, where) {
  pl.escaped = true;
  pl.carry = [];
  const first = !state.won;
  state.won = true;
  state.objectiveDone = true;
  ctx.log(state, `${pl.name} escapes at ${where}.${first ? ' The team has won! Play on until everyone is out or fallen.' : ''}`);
  events.push({ type: 'escaped', seat: pl.seat, first });
  if (pl.seat === state.cur) state.endTurnNow = true;
}

// Barghest: an investigator who isn't cleansed can't cross the river (onto a bridge).
export function crossingBlocked(state, board, pl, to) {
  if (knownMonster(state) !== 'barghest' || pl.status?.cleanse) return false;
  const g = board.grid;
  return !!g.cells[to]?.bridge && !g.cells[pl.pos]?.bridge;
}

// Shadow People, Suffocating Darkness: a player with a lit candle who ends
// the turn in the dark flips a coin; tails, it goes out (Discard Fire & keep
// candle lit is offered then: reactions.js).
export function suffocate(state, board, pl, ctx, events) {
  if (knownMonster(state) !== 'shadow-people') return;
  const candle = (pl.carry ?? []).find((c) => c.item === 'candle' && c.lit);
  if (!candle || pl.dead || (board.light[pl.pos] ?? 0) >= state.config.litThreshold) return;
  const heads = ctx.randInt(state, 2) === 0;
  events.push({ type: 'coin', heads });
  if (heads) { ctx.log(state, `${pl.name}'s candle gutters in the dark, but stays lit (heads).`); return; }
  const snap = watch(state, pl);
  candle.lit = false;
  ctx.log(state, `The darkness smothers ${pl.name}'s candle (tails). Relight it at the Church.`);
  events.push({ type: 'objStep', seat: pl.seat, cell: pl.pos, text: `${pl.name}'s candle goes out.` });
  const monster = state.monsters.find((m) => m.kind === 'shadow-people');
  if (monster) offer(state, monster, 'candle', snap, ctx);
}

// The Casebook's progress lines for the known monster.
export function progressLines(state) {
  const sc = scriptOf(knownMonster(state));
  if (!sc) return [];
  const out = [];
  for (const step of sc.steps) {
    if (step.do === 'deliver' && deliveriesNeeded(state, step) > 1) out.push(`${itemLabel(step.item)}s brought: ${state.objective?.delivered?.[step.item] ?? 0} of ${deliveriesNeeded(state, step)}`);
    if (step.do === 'deliver' && deliveriesNeeded(state, step) === 1) out.push(`${itemLabel(step.item)}: ${state.objective?.delivered?.[step.item] ? 'brought' : 'not yet'}`);
    if (step.do === 'destroy' && step.count) out.push(`Anchors destroyed: ${(state.objective?.anchors ?? []).length} of ${step.count + 1}`);
    if (step.do === 'hold' && state.objective?.ceremony) out.push(`Ceremony: ${state.objective.ceremony.held} of ${step.rounds} rounds`);
    if (step.do === 'cleanse') out.push(`Cleansed: ${state.players.filter((p) => p.status?.cleanse).map((p) => p.name).join(', ') || 'no one yet'}`);
    if (step.do === 'escape') out.push(`Escaped: ${state.players.filter((p) => p.escaped).map((p) => p.name).join(', ') || 'no one yet'}`);
  }
  const carrying = state.players.filter((p) => p.carry?.length).map((p) => `${p.name}: ${p.carry.map(describeItem).join(', ')}`);
  if (carrying.length) out.push(`Carrying: ${carrying.join('; ')}`);
  for (const d of state.objective?.dropped ?? []) out.push(`The ${describeItem(d)} lies where it was dropped`);
  return out;
}
