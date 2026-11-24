// Combat: defense, damage and injuries (Player Mat rules).
//
// - Each turn a player slots rolled dice into Movement and Defense slots.
//   Defense slots: 1, +1 when the turn starts in light. Defense dice stay
//   committed until that player's next turn, so they protect against the
//   monster's action at the end of the round and anything mid-turn.
// - Damage (from a monster's attack, an Attack Obol, an Event...) is compared
//   with the slotted defense that is left: at least the damage → blocked, and
//   the damage is subtracted from the defense (a second attack faces what's
//   left); less → one tier of injury on that damage type's track, and the
//   defense is used up.
// - Tiers are additive; tracks are independent. Tier 3 on any track is
//   Death's Door: one die per turn, and unblocked damage kills.
import { INJURY_TRACKS, DEATHS_DOOR, RANGE, cellRange } from './cards/injuries.js';
import { cellLabel } from '../core/state.js';
import { MONSTER_BY_ID } from './cards/monsters.js';
import { flickeringNear } from './eventPlay.js';
import { hurtMonster } from './equipmentPlay.js';

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
    && cellRange(board.grid, o.pos, pl.pos) <= RANGE.mid);
  if (terrifiedNear) defense--;
  let dice = state.blackCount - (pl.lostBlack ?? 0);           // black dice exhausted for good
  if (inj.P >= 1) dice--;                                   // Sprained: one die in reserve
  const deathsDoor = atDeathsDoor(pl);
  if (deathsDoor) dice = 1;                                 // one die per turn
  return {
    lit, move: Math.max(0, move), defense: Math.max(0, defense), dice: Math.max(1, dice), deathsDoor, terrifiedNear,
  };
}

// The total a player's committed defense dice block (Doomed: 6s count as 1),
// plus equipment's bonus defense for that damage type (or any type).
export function defenseValue(pl, type = null) {
  if (type && pl.mods?.noDefense === type) return 0;       // Ominous Illumination
  const doomed = injuries(pl).S >= 1;
  const rushed = pl.mindset === 'rushed';                  // Rushed: defense dice count at most 3
  const dice = (pl.defense ?? []).reduce((a, d) => a + Math.min(rushed ? 3 : 99, doomed && d.v === 6 ? 1 : d.v), 0);
  const bonus = (pl.bonusDefense ?? []).filter((b) => !b.type || !type || b.type === type).reduce((a, b) => a + b.v, 0);
  return dice + bonus;
}

// Defense still standing this turn: the total less what attacks wore off it.
export const defenseLeft = (pl, type = null) => Math.max(0, defenseValue(pl, type) - (pl.defenseUsed ?? 0));

const where = (board, i) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };

// Deal `amount` damage of `type` (P/M/S) to a player. Returns the outcome.
export function applyDamage(state, board, pl, type, amount, { log, source = 'An attack' }, events) {
  if (pl.dead) return 'dead';
  if (pl.mods?.negateAll) {                                // Purity Seal
    log(state, `${source} hits ${pl.name} for ${amount}, but the Purity Seal negates it.`);
    events.push({ type: 'damage', seat: pl.seat, cell: pl.pos, attack: type, amount, defense: amount, source, outcome: 'blocked' });
    return 'blocked';
  }
  // Distant Screams: attacks are avoided for the rest of the turn.
  if (state.flags?.avoidAttacks === state.round && !/Distant Screams/.test(source)) {
    log(state, `${source} would hit ${pl.name}, but the attack is avoided (Distant Screams).`);
    events.push({ type: 'damage', seat: pl.seat, cell: pl.pos, attack: type, amount, defense: amount, source, outcome: 'blocked' });
    return 'blocked';
  }
  // Spiritual damage tricks (Mourning Veil, Blessed Scapular, Bronze Skull
  // Lantern), through the monster's next turn: the whole hit, before defense.
  const ward = type === 'S' && pl.spiritWard?.round === state.round ? pl.spiritWard : null;
  if (ward) return turnAside(state, board, pl, ward, amount, { log, source }, events);
  // Bright Moon (Global): Mental and Physical rolls −1; against a Beast, Physical +2.
  if (state.global?.id === 'bright-moon' && (type === 'P' || type === 'M')) {
    const beast = state.monsters?.some((m) => MONSTER_BY_ID[m.kind]?.traits.includes('Beast'));
    amount = Math.max(0, amount + (type === 'P' && beast ? 2 : -1));
  }
  let own = Math.max(0, defenseValue(pl, type) - (pl.defenseUsed ?? 0));
  // Flickering Lights (Hazard): Physical damage within 4 ignores the lowest defense die.
  if (type === 'P' && board && flickeringNear(state, board, pl) && pl.defense?.length) own = Math.max(0, own - Math.min(...pl.defense.map((d) => d.v)));
  // Protective: a teammate in Close range can lend their defense.
  const guard = board && state.players.find((o) => o !== pl && !o.dead && o.mindset === 'protective'
    && cellRange(board.grid, o.pos, pl.pos) <= RANGE.close && Math.max(0, defenseValue(o, type) - (o.defenseUsed ?? 0)) > own);
  const block = guard ? Math.max(0, defenseValue(guard, type) - (guard.defenseUsed ?? 0)) : own;
  const user = guard ?? pl;
  const track = INJURY_TRACKS[type];
  const base = { type: 'damage', seat: pl.seat, cell: pl.pos, attack: type, amount, defense: block, source };
  user.defenseUsed = (user.defenseUsed ?? 0) + Math.min(block, amount); // attacks wear the defense down
  if (block >= amount) {
    log(state, `${source} hits ${pl.name} for ${amount} ${track.label}: blocked by ${guard ? `${guard.name}'s defense (Protective)` : 'defense'} ${block} (${block - amount} left).`);
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

// A Spiritual hit on a warded player, turned aside (see applyDamage):
//   heal     Weeping Barrier: one Spiritual tier healed instead of taken.
//   reflect  Wrathful Penance: the amount back at the monster as Holy damage
//            (through toughness; a Holy weakness counts a hit).
//   backlash Spiritual Backlash: the amount goes to the chosen monster
//            (untyped, through toughness) or teammate (a Spiritual hit on them,
//            their defense applies).
function turnAside(state, board, pl, ward, amount, { log, source }, events) {
  const base = { type: 'damage', seat: pl.seat, cell: pl.pos, attack: 'S', amount, defense: 0, source };
  if (ward.kind === 'heal') {
    const inj = injuries(pl);
    const had = inj.S;
    inj.S = Math.max(0, inj.S - 1);
    log(state, `${source} hits ${pl.name} for ${amount} Spiritual, but the Weeping Barrier turns it to healing: ${had ? `Spiritual injury down to tier ${inj.S}` : 'nothing to heal'}.`);
    events.push({ ...base, outcome: 'healed' });
    return 'healed';
  }
  const ctx = { log };
  const toMonster = (m, kind, what) => {
    if (!m) { log(state, `${source} hits ${pl.name} for ${amount} Spiritual, turned aside by the ${what}, but there is no monster to take it.`); return; }
    log(state, `${source} hits ${pl.name} for ${amount} Spiritual: the ${what} turns it on the ${MONSTER_BY_ID[m.kind]?.name ?? 'monster'}${kind ? ' as Holy damage' : ''}.`);
    hurtMonster(state, board, m, 1, kind, () => amount, ctx, events);
  };
  if (ward.kind === 'reflect') {
    // At the monster: the nearest one to you.
    const m = [...(state.monsters ?? [])].sort((a, b) => cellRange(board.grid, pl.pos, a.pos) - cellRange(board.grid, pl.pos, b.pos))[0];
    toMonster(m, 'holy', 'Wrathful Penance');
    events.push({ ...base, outcome: 'reflected' });
    return 'reflected';
  }
  // Backlash.
  const mate = ward.onto?.seat !== undefined ? state.players[ward.onto.seat] : null;
  if (mate && !mate.dead) {
    log(state, `${source} hits ${pl.name} for ${amount} Spiritual: the Spiritual Backlash sends it to ${mate.name}.`);
    events.push({ ...base, outcome: 'redirected' });
    applyDamage(state, board, mate, 'S', amount, { log, source: `${source} (Spiritual Backlash)` }, events);
    return 'redirected';
  }
  toMonster((state.monsters ?? []).find((m) => m.id === ward.onto?.monster), null, 'Spiritual Backlash');
  events.push({ ...base, outcome: 'redirected' });
  return 'redirected';
}
