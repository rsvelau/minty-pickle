// Combat: defense, damage and injuries (Player Mat rules).
//
// - Each turn a player slots rolled dice into Movement and Defense slots.
//   Defense slots: 1, +1 when the turn starts in light. Defense dice stay
//   committed until that player's next turn, so they protect against the
//   monster's action at the end of the round and anything mid-turn.
// - Damage (from a monster's attack, an Attack Obol, an Event...) is compared
//   with the total of the slotted defense dice: at least the damage → blocked;
//   less → one tier of injury on that damage type's track.
// - Tiers are additive; tracks are independent. Tier 3 on any track is
//   Death's Door: one die per turn, and unblocked damage kills.
import { INJURY_TRACKS, DEATHS_DOOR, RANGE } from './cards/injuries.js';
import { cellLabel } from '../state.js';

export const injuries = (pl) => (pl.injuries ??= { P: 0, M: 0, S: 0 });
export const atDeathsDoor = (pl) => Object.values(injuries(pl)).some((t) => t >= DEATHS_DOOR);
export const alive = (state) => state.players.filter((pl) => !pl.dead);

// Walking distance between two cells (no keys), or Infinity.
export function walkDistance(board, a, b, max = 30) {
  if (a === b) return 0;
  const { x, y } = board.grid.coords(a);
  const d = board.grid.moveField(x, y, { keys: false, maxSteps: max }).dist[b];
  return d < 0 ? Infinity : d;
}

// What the current player may use this turn, after injuries.
export function turnLimits(state, board, pl) {
  const inj = injuries(pl);
  const lit = (board.light[pl.pos] ?? 0) >= state.config.litThreshold;
  const cfg = state.config;
  let move = lit ? Math.max(cfg.litSlots, cfg.moveSlots) : cfg.moveSlots;
  if (inj.P >= 2) move--;                                   // Hobbled
  let defense = (cfg.defenseSlots ?? 1) + (lit ? 1 : 0);
  if (inj.M >= 1) defense--;                                // Paranoid
  // Terrified teammates nearby cost one defense slot.
  const terrifiedNear = state.players.some((o) => o !== pl && !o.dead && injuries(o).M >= 2
    && walkDistance(board, o.pos, pl.pos, RANGE.mid) <= RANGE.mid);
  if (terrifiedNear) defense--;
  let dice = state.blackCount;
  if (inj.P >= 1) dice--;                                   // Sprained: one die in reserve
  const deathsDoor = atDeathsDoor(pl);
  if (deathsDoor) dice = 1;                                 // one die per turn
  return {
    lit, move: Math.max(0, move), defense: Math.max(0, defense), dice: Math.max(1, dice), deathsDoor, terrifiedNear,
  };
}

// The total a player's committed defense dice block (Doomed: 6s count as 1).
export function defenseValue(pl) {
  const doomed = injuries(pl).S >= 1;
  return (pl.defense ?? []).reduce((a, d) => a + (doomed && d.v === 6 ? 1 : d.v), 0);
}

const where = (board, i) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };

// Deal `amount` damage of `type` (P/M/S) to a player. Returns the outcome.
export function applyDamage(state, board, pl, type, amount, { log, source = 'An attack' }, events) {
  if (pl.dead) return 'dead';
  const block = defenseValue(pl);
  const track = INJURY_TRACKS[type];
  const base = { type: 'damage', seat: pl.seat, cell: pl.pos, attack: type, amount, defense: block, source };
  if (block >= amount) {
    log(state, `${source} hits ${pl.name} for ${amount} ${track.label}: blocked by defense ${block}.`);
    events.push({ ...base, outcome: 'blocked' });
    return 'blocked';
  }
  if (atDeathsDoor(pl)) {
    pl.dead = true;
    log(state, `${source} hits ${pl.name} for ${amount} ${track.label} (defense ${block}). ${pl.name} was at Death's Door, and dies at ${where(board, pl.pos)}.`);
    events.push({ ...base, outcome: 'killed' });
    return 'killed';
  }
  const inj = injuries(pl);
  inj[type] = Math.min(DEATHS_DOOR, inj[type] + 1);
  const tier = track.tiers[inj[type] - 1];
  log(state, `${source} hits ${pl.name} for ${amount} ${track.label} (defense ${block}): ${tier.name}. ${tier.text}.`);
  events.push({ ...base, outcome: 'injured', tier: inj[type] });
  return 'injured';
}
