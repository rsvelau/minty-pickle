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
// Other verbs (defend, destroy, perform, kill) are played by the monster's
// own rules or at the table for now.
//
// On a player: carry [{ item, lit? }], status { cleanse: true }, escaped.
// On the state: objective { delivered: { item: n } }.
import { scriptOf, mapSites, knownMonster } from './scripts.js';
import { siteLabel } from '../../core/sites.js';
import { achieveObjective } from '../equipmentPlay.js';
import { watch, offer } from '../reactions.js';

export const ITEMS = {
  candle: { label: 'Candle', lit: true },
  'holy-water': { label: 'Holy water' },
  gown: { label: 'Decayed Wedding Gown' },
  ring: { label: 'Tarnished Wedding Ring' },
  'finger-bone': { label: 'Desiccated Finger Bone' },
  cosor: { label: 'Cosor' },
};
export const itemLabel = (id) => ITEMS[id]?.label ?? id;

// How many deliveries a step needs: `times`, halved (Shadow People: 2) with one or two players.
export function deliveriesNeeded(state, step) {
  const n = step.times ?? 1;
  return step.fewer && state.players.length <= 2 ? step.fewer : n;
}

// The cells of a step's site on this board.
function siteCells(state, board, at) {
  if (at === 'lair') return state.mystery?.spawnCell >= 0 ? [state.mystery.spawnCell] : [];
  if (at === 'start') { const s = board.startCell(); return s >= 0 ? [s] : []; }
  return mapSites(board.grid)[at] ?? [];
}

// A player has stepped onto `cell`: play any objective step there.
export function onSiteEnter(state, board, pl, cell, ctx, events) {
  const id = knownMonster(state);
  const sc = scriptOf(id);
  if (!sc || pl.dead || pl.dying || pl.escaped || state.phase === 'over') return;
  const say = (text) => { ctx.log(state, text); events.push({ type: 'objStep', seat: pl.seat, cell, text }); };
  for (const step of sc.steps) {
    if (!siteCells(state, board, step.at).includes(cell)) continue;
    const where = siteLabel(step.at);
    if (step.do === 'collect') {
      pl.carry ??= [];
      const have = pl.carry.find((c) => c.item === step.item);
      if (have && (!ITEMS[step.item]?.lit || have.lit)) continue;           // one at a time
      if (have) have.lit = true;                                          // a candle that went out is lit again
      else pl.carry.push({ item: step.item, ...(ITEMS[step.item]?.lit ? { lit: true } : {}) });
      say(`${pl.name} takes ${ITEMS[step.item]?.lit ? 'a lit ' : ''}${itemLabel(step.item).toLowerCase()} at ${where}.`);
    } else if (step.do === 'deliver') {
      const k = (pl.carry ?? []).findIndex((c) => c.item === step.item && (!ITEMS[step.item]?.lit || c.lit));
      if (k < 0) continue;
      pl.carry.splice(k, 1);
      state.objective ??= { delivered: {} };
      const n = state.objective.delivered[step.item] = (state.objective.delivered[step.item] ?? 0) + 1;
      const need = deliveriesNeeded(state, step);
      say(`${pl.name} brings the ${itemLabel(step.item).toLowerCase()} to ${where}: ${Math.min(n, need)} of ${need}.`);
      if (n >= need && !state.objectiveDone) achieveObjective(state, ctx, events);
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
    if (step.do === 'deliver') out.push(`${itemLabel(step.item)}s brought: ${state.objective?.delivered?.[step.item] ?? 0} of ${deliveriesNeeded(state, step)}`);
    if (step.do === 'cleanse') out.push(`Cleansed: ${state.players.filter((p) => p.status?.cleanse).map((p) => p.name).join(', ') || 'no one yet'}`);
    if (step.do === 'escape') out.push(`Escaped: ${state.players.filter((p) => p.escaped).map((p) => p.name).join(', ') || 'no one yet'}`);
  }
  const carrying = state.players.filter((p) => p.carry?.length).map((p) => `${p.name}: ${p.carry.map((c) => `${itemLabel(c.item)}${c.lit === false ? ' (out)' : ''}`).join(', ')}`);
  if (carrying.length) out.push(`Carrying: ${carrying.join('; ')}`);
  return out;
}
