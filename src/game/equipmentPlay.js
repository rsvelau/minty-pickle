// Using Equipment (any time during your turn), and the monster's side of it:
// health, toughness, its weakness track, immunities and the "this turn"
// effects equipment puts on it.
//
// The action:
//   { type: 'use', item, ability, dice: [pool indices], target?: { monster: id } | { seat }, raise?: [pool indices] }
// - item: index into your Equipment; ability: index into its abilities.
// - dice: exactly the ability's dice count, from your rolled dice that aren't
//   spent or slotted; their total must meet its requirement (cards/requirements.js).
// - Obol costs are paid from your Obolcraft, any colour (most plentiful first).
// - Range is measured from you to the target (Close 1, Mid 2, Long any).
//
// Each ability's `fx` (cards/equipment.js) says what happens. Abilities marked
// `manual` are paid for and logged, and resolved at the table for now.
//
// Monster state (set at spawn): hp (null = ∞), tough (base toughness),
// toughLost (from its weakness track), weakHits, trackDone, diceLost,
// disabled { abilityName: rounds | true }, and `mods` for this turn:
//   toughDown, toughZero, moveDown, immobile, halve, blind, capDie, bonusNext
// mods last until the monster has acted at the end of the round.
import { EQUIPMENT_BY_ID } from './cards/equipment.js';
import { MONSTER_BY_ID, DAMAGE_KINDS } from './cards/monsters.js';
import { checkRequirement } from './cards/requirements.js';
import { RANGE, cellRange, INJURY_TRACKS } from './cards/injuries.js';
import { injuries } from './combat.js';
import { doorsAround } from './doors.js';
import { strikeNow } from './monsterTurn.js';

const REACH = { close: RANGE.close, mid: RANGE.mid, long: Infinity, self: 0, all: Infinity };
// Long only reaches 3 spaces or more (not Close or Mid).
const MIN_REACH = { long: RANGE.mid + 1 };

// Give a newly spawned card monster its fighting state.
export function armMonster(monster) {
  const card = MONSTER_BY_ID[monster.kind];
  if (!card) return;
  monster.hp = card.hp ?? null;
  monster.maxHp = card.hp ?? null;
  monster.tough = card.toughness ?? null;     // null = ∞ (nothing gets through)
  monster.toughLost = 0;
  monster.weakHits = 0;
  monster.trackDone = [];
  monster.diceLost = 0;
  monster.disabled = {};
  monster.mods = {};
}

// Effective toughness right now.
export function toughnessOf(monster) {
  if (monster.mods?.toughZero) return 0;
  if (monster.tough === null || monster.tough === undefined) return Infinity;
  return Math.max(0, monster.tough - (monster.toughLost ?? 0) - (monster.mods?.toughDown ?? 0));
}

// The target monster's action roll this turn (all its dice added), for Choke.
export const actionRoll = (monster) => (monster.intents ?? []).reduce((a, i) => a + (i.roll ?? 0), 0);

// Is the item's ability available (not spent by 1️⃣)?
export const abilityReady = (item, k) => !(item.spent ?? []).includes(k);

// What the UI needs to offer an ability: which targets are in range.
// Lunge (Fencing Shoes), always on while carried: Close-range attacks reach Mid.
export const lunges = (pl, ability) => ability.range === 'close' && ability.fx?.dmg !== undefined
  && pl.inventory.equipment.some((it) => it.id === 'fencing-shoes');

export function targetsFor(state, board, pl, ability) {
  const fx = ability.fx ?? {};
  const reach = lunges(pl, ability) ? RANGE.mid : REACH[ability.range] ?? RANGE.close;
  if (fx.target === 'monster') {
    const min = MIN_REACH[ability.range] ?? 0;
    return state.monsters.filter((m) => {
      // Banshee on a rooftop: out of Close range.
      const d = Math.max(cellRange(board.grid, pl.pos, m.pos), m.perched ? RANGE.close + 1 : 0);
      return MONSTER_BY_ID[m.kind] && d <= reach && d >= min;
    })
      .map((m) => ({ monster: m.id, name: MONSTER_BY_ID[m.kind].name }));
  }
  if (fx.target === 'ally') {
    return state.players.filter((p) => !p.dead && (p === pl || cellRange(board.grid, pl.pos, p.pos) <= Math.max(reach, 0)))
      .map((p) => ({ seat: p.seat, name: p.name }));
  }
  if (fx.target === 'either') {
    // Spiritual Backlash: a monster or a teammate (not yourself) in reach.
    const mons = state.monsters.filter((m) => MONSTER_BY_ID[m.kind] && cellRange(board.grid, pl.pos, m.pos) <= reach)
      .map((m) => ({ monster: m.id, name: MONSTER_BY_ID[m.kind].name }));
    const mates = state.players.filter((p) => !p.dead && p !== pl && cellRange(board.grid, pl.pos, p.pos) <= reach)
      .map((p) => ({ seat: p.seat, name: p.name }));
    return [...mons, ...mates];
  }
  if (fx.lure) {
    // Distract: any walkable space within the skill's range (Mid: 3).
    const g = board.grid;
    const out = [];
    g.cells.forEach((c, i) => { if (c.walkable && cellRange(g, pl.pos, i) <= reach) out.push({ cell: i, name: `space ${i}` }); });
    return out;
  }
  if (fx.door) {
    // The doors on your own cell's sides. Breach: any not already breached;
    // block: any not breached (a doorway has nothing to close) or blocked.
    return doorsAround(state, board, pl.pos)
      .filter((d) => d.status !== 'breached' && !(fx.door === 'block' && d.status === 'blocked'))
      .map((d) => ({ edge: d.edge, side: d.side, name: `${d.side} door${d.status === 'blocked' ? ' (blocked)' : d.type === 'lockedDoor' ? ' (locked)' : d.type === 'boardedDoor' ? ' (boarded up)' : ''}` }));
  }
  return [];
}

// Apply a 'use' action. Returns an error string, or null.
export function useEquipment(state, board, pl, action, ctx, events) {
  const item = pl.inventory.equipment[action.item | 0];
  const card = item && EQUIPMENT_BY_ID[item.id];
  if (!card) return 'no such equipment';
  const k = action.ability | 0;
  const a = card.abilities[k];
  if (!a) return 'no such skill';
  if (!abilityReady(item, k)) return `${a.name} is used up until it is refreshed`;
  const fx = a.fx ?? { manual: true };
  if (fx.passive) return `${a.name} is always on while you carry the ${card.name}`;
  if (fx.sacrifice) return `the ${card.name} is used the moment you or a teammate would die`;
  if (fx.lucky && state.lucky) return 'Lucky is already in play this turn';

  // Dice.
  const dice = [...new Set(action.dice ?? [])];
  if (dice.length !== a.dice) return `${a.name} needs ${a.dice === 1 ? 'one die' : `${a.dice} dice`}`;
  for (const n of dice) {
    const d = state.pool[n];
    if (!d || d.spent || state.defSlots.includes(n) || state.slots.includes(n)) return 'use rolled dice that are not slotted or spent';
  }
  const values = dice.map((n) => state.pool[n].v);

  // Target.
  let monster = null, ally = null, door = null, spot = -1, onto = null;
  if (fx.target === 'monster') {
    const options = targetsFor(state, board, pl, a);
    const pick = options.find((o) => o.monster === action.target?.monster) ?? (options.length === 1 ? options[0] : null);
    if (!pick) return options.length ? 'choose a target' : 'no monster in range';
    monster = state.monsters.find((m) => m.id === pick.monster);
  } else if (fx.target === 'ally') {
    const options = targetsFor(state, board, pl, a);
    const pick = options.find((o) => o.seat === action.target?.seat) ?? options.find((o) => o.seat === pl.seat);
    if (!pick) return 'no one in range';
    ally = state.players[pick.seat];
  } else if (fx.target === 'either') {
    const options = targetsFor(state, board, pl, a);
    onto = options.find((o) => (o.monster !== undefined && o.monster === action.target?.monster) || (o.seat !== undefined && o.seat === action.target?.seat))
      ?? (options.length === 1 ? options[0] : null);
    if (!onto) return options.length ? 'choose a target' : 'no monster or teammate in range';
  } else if (fx.lure) {
    if (!state.monsters.length) return 'there is no monster to distract';
    spot = targetsFor(state, board, pl, a).find((o) => o.cell === action.target?.cell)?.cell ?? -1;
    if (spot < 0) return 'choose a space within reach';
  } else if (fx.door) {
    const options = targetsFor(state, board, pl, a);
    door = options.find((o) => o.edge === action.target?.edge) ?? (options.length === 1 ? options[0] : null);
    if (!door) return options.length ? 'choose a door' : fx.door === 'breach' ? 'no door next to you to breach' : 'no door next to you to shut';
  }
  if (!checkRequirement(a.req, values, { targetDie: monster ? actionRoll(monster) : null })) {
    return `the dice don't meet [${a.req}]${a.req?.startsWith('2x') && monster ? ` (twice ${actionRoll(monster)})` : ''}`;
  }

  // Obols (any colour; take from what you have most of).
  if (a.obols) {
    const bag = pl.inventory.obolcraft;
    if (bag.length < a.obols) return `${a.name} costs ${a.obols} Obol${a.obols === 1 ? '' : 's'}`;
    for (let j = 0; j < a.obols; j++) {
      const counts = {};
      for (const o of bag) counts[o.type] = (counts[o.type] ?? 0) + 1;
      const most = Object.entries(counts).sort((x, y) => y[1] - x[1])[0][0];
      bag.splice(bag.findIndex((o) => o.type === most), 1);
    }
  }
  // Raise other dice (Torchlight, Illuminate): pick them before paying.
  const raise = fx.raise ? [...new Set(action.raise ?? [])].filter((n) => !dice.includes(n) && state.pool[n] && !state.pool[n].spent).slice(0, fx.raise) : [];

  // What a weakness hit sets off (Trigger Regret) happens after the skill itself.
  const later = [];
  // Pay the dice.
  for (const n of dice) { state.pool[n].spent = true; state.pool[n].usedFor = card.name; }

  const who = pl.name;
  const parts = [];
  const kind = a.kind ? DAMAGE_KINDS[a.kind] : null;
  if (monster) {
    const mcard = MONSTER_BY_ID[monster.kind];
    if (a.kind && mcard.immune.includes(a.kind)) {
      parts.push(`the ${mcard.name} is immune to ${kind.label}: nothing happens`);
    } else {
      monster.mods ??= {};
      // Effects before damage.
      if (fx.toughDown) { monster.mods.toughDown = (monster.mods.toughDown ?? 0) + fx.toughDown; parts.push(`toughness −${fx.toughDown} this turn`); }
      if (fx.demonToughnessZero) {
        if (mcard.traits.includes('Demon')) { monster.mods.toughZero = true; parts.push('toughness 0 this turn'); } else parts.push(`no effect: the ${mcard.name} is not a Demon`);
      }
      if (fx.dmg !== undefined) parts.push(damageMonster(state, monster, mcard, fx, a, values, pl));
      if (fx.moveDown) { monster.mods.moveDown = (monster.mods.moveDown ?? 0) + fx.moveDown; parts.push(`movement −${fx.moveDown} this turn`); }
      if (fx.immobile) { monster.mods.immobile = true; parts.push('immobilized this turn'); }
      if (fx.halve) { monster.mods.halve = true; parts.push('its attack damage is halved this turn'); }
      if (fx.blind) { monster.mods.blind = true; parts.push('Blind: its next attack rolls 1'); }
      if (fx.capDie) { monster.mods.capDie = fx.capDie; parts.push(`its damage dice above ${fx.capDie} count as ${fx.capDie} this turn`); }
      if (fx.bonusNext) { monster.mods.bonusNext = (monster.mods.bonusNext ?? 0) + fx.bonusNext; parts.push(`the next attack on it deals ${fx.bonusNext} more`); }
      // A weakness element counts up its weakness track.
      if (a.kind && mcard.weakness.includes(a.kind)) parts.push(...weaknessHit(state, board, monster, mcard, ctx, events, later));
      checkDefeat(state, board, monster, mcard, ctx, events);
    }
  }
  if (ally) {
    if (fx.doubleAttack) { ally.mods = { ...(ally.mods ?? {}), doubleAttack: true }; parts.push(`${ally.name}'s attacks deal double this turn`); }
    if (fx.heal) parts.push(heal(ally, fx.heal));
  }
  if (fx.target === 'self') {
    if (fx.heal) parts.push(heal(pl, fx.heal));
    if (fx.setInjury) {
      const inj = injuries(pl);
      for (const [t, v] of Object.entries(fx.setInjury)) inj[t] = v;
      parts.push(Object.entries(fx.setInjury).map(([t, v]) => `${INJURY_TRACKS[t].label} injury set to tier ${v}`).join(', '));
    }
    if (fx.healAround) {
      const near = state.players.filter((p) => !p.dead && (p === pl || cellRange(board.grid, pl.pos, p.pos) <= REACH[a.range]));
      for (const p of near) heal(p, fx.healAround);
      parts.push(`${Object.keys(fx.healAround).map((t) => INJURY_TRACKS[t].label).join(', ')} injury −1 tier for ${near.map((p) => p.name).join(', ')}`);
    }
    if (fx.bonusDefense) {
      (pl.bonusDefense ??= []).push({ ...fx.bonusDefense });
      parts.push(`+${fx.bonusDefense.v} ${fx.bonusDefense.type ? `${INJURY_TRACKS[fx.bonusDefense.type].label} ` : ''}defense until your next turn`);
    }
    if (fx.noDefense) { pl.mods = { ...(pl.mods ?? {}), noDefense: fx.noDefense }; parts.push(`no defense against ${INJURY_TRACKS[fx.noDefense].label} damage this turn`); }
    if (fx.negateAll) { pl.mods = { ...(pl.mods ?? {}), negateAll: true }; parts.push('all damage negated until your next turn'); }
    if (fx.move) { state.moveBonus = (state.moveBonus ?? 0) + fx.move; parts.push(`+${fx.move} movement on your next move this turn`); }
    if (fx.refreshAs !== undefined) {
      // The paid die comes back with a new value, ready to slot again.
      for (const n of dice) {
        const d = state.pool[n];
        d.v = fx.refreshAs === 'double' ? d.v * 2 : fx.refreshAs;
        d.spent = false;
        delete d.usedFor;
      }
      parts.push(`${dice.length === 1 ? 'the die is' : 'the dice are'} refreshed as ${dice.map((n) => state.pool[n].v).join(' and ')}`);
    }
    if (fx.refresh) {
      const kAt = card.abilities.findIndex((b) => b.name === fx.refresh);
      item.spent = (item.spent ?? []).filter((x) => x !== kAt);
      parts.push(`${fx.refresh} is ready again`);
    }
  }
  if (fx.raise) {
    for (const n of raise) state.pool[n].v = fx.to;
    parts.push(raise.length ? `${raise.length === 1 ? 'a die' : `${raise.length} dice`} raised to ${fx.to}` : 'no other die to raise');
  }
  if (door) {
    state.doors ??= {};
    if (fx.door === 'breach') {
      state.doors[door.edge] = 'breached';
      if (state.doorHp) delete state.doorHp[door.edge];
      parts.push(`the ${door.side} door is smashed in: an open doorway for good, for everyone`);
    } else {
      state.doors[door.edge] = 'blocked';
      if (fx.hp) { (state.doorHp ??= {})[door.edge] = fx.hp; (state.doorMax ??= {})[door.edge] = fx.hp; } // a chained door takes more to bash in
      parts.push(`the ${door.side} door is ${fx.how ?? 'blocked'}: no one gets through, the monster included, until it is breached`);
    }
    events.push({ type: 'doors', edge: door.edge, change: fx.door });
  }
  // Holding the monster back: each lasts through the monster's next turn
  // (it acts at the end of this round: `round` marks it).
  if (fx.salt) {
    state.saltCircles = [...(state.saltCircles ?? []).filter((c) => c.round === state.round), { cell: pl.pos, round: state.round }];
    parts.push('a ring of salt: no monster can enter or cross this space through its next turn');
  }
  if (spot >= 0) {
    for (const m of state.monsters) m.lure = { cell: spot, round: state.round };
    parts.push('the monster has to head for that space with its movement on its next turn');
  }
  if (fx.camouflage) {
    pl.camoRound = state.round;
    state.noMove = true;   // can't move the rest of this turn
    state.steps = 0;
    parts.push('camouflaged: the monster won’t come for you or strike you up close through its next turn (Area and Global attacks still can); you can’t move this turn');
  }
  // Spiritual damage tricks: the next Spiritual hits on you (through the
  // monster's next turn) are turned aside (combat.js applyDamage).
  if (fx.spirit) {
    pl.spiritWard = { kind: fx.spirit, round: state.round, onto: onto ? (onto.monster !== undefined ? { monster: onto.monster } : { seat: onto.seat }) : null };
    parts.push(fx.spirit === 'heal' ? 'Spiritual damage heals you instead (one tier a hit) through the monster’s next turn'
      : fx.spirit === 'reflect' ? 'Spiritual damage aimed at you is thrown back at the monster as Holy damage through its next turn'
        : `Spiritual damage aimed at you goes to ${onto.name} instead through the monster’s next turn`);
  }
  if (fx.brace) {
    pl.bracedRound = state.round;
    parts.push('braced: nothing can move you through the monster’s next turn');
  }
  // Rally: you, and every teammate within reach, +4 Mental defense through
  // the monster's next turn (it carries the round: see rules.js roll / endRound).
  if (fx.rally) {
    const near = state.players.filter((p) => !p.dead && !p.dying && (p === pl || cellRange(board.grid, pl.pos, p.pos) <= REACH[a.range]));
    for (const p of near) (p.bonusDefense ??= []).push({ type: 'M', v: fx.rally, round: state.round });
    parts.push(`+${fx.rally} Mental defense for ${near.map((p) => p.name).join(', ')} through the monster’s next turn`);
  }
  if (fx.toss) {
    pl.tossed = true;
    parts.push('every injury’s effect is held off until you are injured again (the tiers stay)');
  }
  if (fx.drink) {
    pl.drinking = true;
    parts.push('movement doubled and Physical injuries ignored for the rest of this turn');
  }
  if (fx.lucky) {
    state.lucky = true;
    parts.push('choose the value of each of your dice this turn');
  }
  if (fx.manual) parts.push(`resolve at the table: ${a.text}`);

  // Limits: 1️⃣ until refreshed; 🔗 the card breaks.
  if (a.limit === 'once') item.spent = [...new Set([...(item.spent ?? []), k])];
  let broke = false;
  // 🔗 breaks; Mighty: any weapon breaks after a single use.
  if (a.limit === 'breaks' || (pl.mindset === 'mighty' && fx.dmg !== undefined)) { pl.inventory.equipment.splice(action.item | 0, 1); broke = true; }

  const text = `${who} uses ${card.name}: ${a.name}${values.length ? ` (${values.join(' + ')})` : ''}${monster ? ` on the ${MONSTER_BY_ID[monster.kind].name}` : ''}${ally && ally !== pl ? ` on ${ally.name}` : ''}. ${parts.filter(Boolean).join('; ')}.${broke ? ` The ${card.name} is spent and discarded.` : ''}`;
  ctx.log(state, text);
  events.push({ type: 'equipUse', seat: pl.seat, item: card.id, ability: a.name, monster: monster?.id ?? null, text, hp: monster?.hp ?? null, broke });
  for (const f of later) f();
  return null;
}

function damageMonster(state, monster, mcard, fx, a, values, pl) {
  let dmg = fx.dmg === 'die' ? values[0] ?? 0 : fx.dmg === 'sum' ? values.reduce((x, y) => x + y, 0) : fx.dmg;
  if (monster.mods.bonusNext) { dmg += monster.mods.bonusNext; monster.mods.bonusNext = 0; }
  if (pl.mods?.doubleAttack) dmg *= 2;                                  // Bless
  if (pl.mindset === 'reckless' || pl.mindset === 'mighty') dmg *= 2;    // Mindsets: double attacking damage
  const tough = fx.ignoreToughness ? 0 : toughnessOf(monster);
  const through = tough === Infinity ? 0 : Math.max(0, dmg - tough);
  // Seized (Ushi-Oni): any damage through its defense frees the one it holds.
  const freed = through > 0 && monster.carrying === pl.seat ? release(state, monster) : null;
  const tail = freed ? `; ${pl.name} breaks free` : '';
  if (monster.hp === null) return `${dmg} damage, but the ${mcard.name} cannot be worn down by damage${tail}`;
  monster.hp = Math.max(0, monster.hp - through);
  // Redcap: Piercing attacks (the ones that ignore toughness) can't land the killing blow.
  const spared = mcard.id === 'redcap' && fx.ignoreToughness && monster.hp === 0 && through > 0;
  if (spared) monster.hp = 1;
  return `${dmg} damage${fx.ignoreToughness ? ' (ignoring toughness)' : tough ? ` − toughness ${tough}` : ''}: ${through} gets through (${monster.hp}/${monster.maxHp} health left)` +
    `${spared ? '. A Piercing blow can’t kill the Redcap: it clings on at 1' : ''}${tail}`;
}

// Seized (Ushi-Oni): let go of whoever the monster holds. Returns them, or null.
export function release(state, monster) {
  const pl = monster.carrying !== undefined && monster.carrying !== null ? state.players[monster.carrying] : null;
  monster.carrying = null;
  if (pl) delete pl.seized;
  return pl;
}

function heal(p, spec) {
  const inj = injuries(p);
  const out = [];
  for (const [t, n] of Object.entries(spec)) {
    const before = inj[t];
    inj[t] = n === 'all' ? 0 : Math.max(0, inj[t] - n);
    if (before !== inj[t]) out.push(`${INJURY_TRACKS[t].label} ${before} → ${inj[t]}`);
  }
  return out.length ? `${p.name}: ${out.join(', ')}` : `${p.name} had no such injury`;
}

// A hit with a weakness element: count it, and trigger any track marks reached.
function weaknessHit(state, board, monster, mcard, ctx, events, later = null) {
  monster.weakHits = (monster.weakHits ?? 0) + 1;
  const out = [`weakness hit ${monster.weakHits}`];
  mcard.weaknessTrack.forEach((w, idx) => {
    if (w.hits === null || monster.trackDone.includes(idx) || monster.weakHits < w.hits) return;
    monster.trackDone.push(idx);
    out.push(`weakness: ${w.text}`);
    const strike = applyTrackEffect(monster, mcard, w.text, state);
    events.push({ type: 'weakness', id: monster.id, text: w.text, hits: w.hits });
    if (strike) {
      const f = () => { ctx.log(state, `The ${mcard.name}'s weakness triggers ${strike}.`); strikeNow(state, board, monster, strike, ctx, events); };
      if (later) later.push(f); else f();
    }
  });
  return out;
}

// What the game can play of a weakness-track effect; the rest is announced.
// Returns the name of an ability it sets off at once (Trigger Regret), if any.
function applyTrackEffect(monster, mcard, text, state) {
  const t = /−(\d+) toughness/.exec(text);
  if (t) monster.toughLost += Number(t[1]);
  const d = /([−+])(\d+) die/.exec(text);
  if (d) monster.diceLost += (d[1] === '−' ? 1 : -1) * Number(d[2]);
  const hp = /−(\d+) HP/.exec(text);
  if (hp && monster.hp !== null) { monster.maxHp = Math.max(0, monster.maxHp - Number(hp[1])); monster.hp = Math.min(monster.hp, monster.maxHp); }
  const dis = /Disable ([A-Z][\w ]+?)(?: for ⌛| until| permanently|$|,)/.exec(text);
  if (dis) {
    const name = dis[1].trim();
    // For a round (1), until something restarts it (true: Wendigo's Regeneration
    // comes back when a Consume lands), or for good ('perm').
    if (mcard.abilities.some((ab) => ab.name === name)) monster.disabled[name] = /for ⌛/.test(text) ? 1 : /permanently/.test(text) ? 'perm' : true;
  }
  if (/drop player/.test(text)) release(state, monster);                // Ushi-Oni lets go
  if (/Interrupt this turn/.test(text)) monster.mods.interrupted = true;
  if (/Grounded/.test(text)) monster.perched = false;                   // Banshee: down off the roof until her next Perch
  if (/Reset Curseblood Ritual/.test(text)) monster.rituals = 0;      // the count starts over
  const trig = /Trigger ([A-Z][\w ]+?)(?:,|$)/.exec(text);
  return trig && mcard.abilities.some((ab) => ab.name === trig[1].trim()) ? trig[1].trim() : null;
}

// The Blessed Cosor (Strigoi): `dmg` straight off its health, ignoring
// toughness; a Holy hit counts on its weakness track. Returns the health lost.
export function strikeMonster(state, board, monster, dmg, kind, ctx, events) {
  const mcard = MONSTER_BY_ID[monster.kind];
  if (!mcard || monster.hp === null || monster.hp === undefined) return 0;
  const before = monster.hp;
  monster.hp = Math.max(0, monster.hp - dmg);
  ctx.log(state, `The ${mcard.name} takes ${dmg}, its toughness no help (${monster.hp}/${monster.maxHp}).`);
  events.push({ type: 'monsterHurt', id: monster.id, amount: before - monster.hp, hp: monster.hp });
  if (kind && mcard.weakness.includes(kind)) weaknessHit(state, board, monster, mcard, ctx, events);
  checkDefeat(state, board, monster, mcard, ctx, events);
  return before - monster.hp;
}

// Achieving the monster's objective wins. A plain "Kill" objective is achieved
// by destroying it. Any other objective (Escape, Disrupt Ritual, Destroy
// Anchors...) is marked achieved by the players (the 'objective' action); until
// then, destroying the monster only sends it back to its Lair at full health.
// Once achieved, a monster with health must still be destroyed one more time;
// one with ∞ health is beaten by the objective alone.
export const killObjective = (mcard) => /^kill\b/i.test(mcard.objective ?? '') && !/^kill with/i.test(mcard.objective ?? '');

function checkDefeat(state, board, monster, mcard, ctx, events) {
  if (monster.hp === null || monster.hp > 0) return;
  if (!killObjective(mcard) && !state.objectiveDone && state.mystery?.spawnCell >= 0) {
    monster.pos = state.mystery.spawnCell;
    monster.hp = monster.maxHp;
    monster.intents = null;
    ctx.log(state, `The ${mcard.name} falls, and rises again at its Lair. Its objective must be achieved before it can be finished: ${mcard.objective}`);
    events.push({ type: 'monsterTeleport', id: monster.id, to: monster.pos });
    return;
  }
  state.monsters = state.monsters.filter((m) => m !== monster);
  ctx.log(state, `The ${mcard.name} is destroyed!`);
  events.push({ type: 'monsterDefeated', id: monster.id, kind: monster.kind });
  if (!state.monsters.length) win(state, ctx, events);
}

function win(state, ctx, events) {
  state.won = true;
  state.phase = 'over';
  ctx.log(state, 'The objective is achieved and the night is survived. The investigators win.');
  events.push({ type: 'won' });
}

// The players mark the monster's objective achieved (objectives other than Kill
// are played at the table for now).
export function achieveObjective(state, ctx, events) {
  const m = state.monsters.find((x) => MONSTER_BY_ID[x.kind]);
  const mcard = m && MONSTER_BY_ID[m.kind];
  if (!mcard) return 'the monster has not appeared';
  if (killObjective(mcard)) return 'this monster’s objective is to destroy it';
  if (state.objectiveDone) return 'already achieved';
  state.objectiveDone = true;
  ctx.log(state, `Objective achieved: ${mcard.objective.replace(/\.$/, '')}.${m.hp === null ? '' : ` The ${mcard.name} can now be destroyed for good.`}`);
  events.push({ type: 'objective', kind: mcard.id });
  if (m.hp === null) { state.monsters = state.monsters.filter((x) => x !== m); win(state, ctx, events); }
  return null;
}

// Defeated at once, whatever its health (the Banshee laid to rest by her heirloom).
export function banishMonster(state, ctx, events) {
  const m = state.monsters.find((x) => MONSTER_BY_ID[x.kind]);
  if (!m) return;
  const mcard = MONSTER_BY_ID[m.kind];
  state.objectiveDone = true;
  state.monsters = state.monsters.filter((x) => x !== m);
  ctx.log(state, `The ${mcard.name} is laid to rest: defeated at once.`);
  events.push({ type: 'monsterDefeated', id: m.id, kind: m.kind });
  if (!state.monsters.length) win(state, ctx, events);
}

// ∞ weakness effects that discard an item: "Discard Silver to …". Any time on
// your turn, discard an Equipment card with a skill of that element. Those
// marked `react` are offered at the moment instead (reactions.js).
//   Discard Crystal & no light for ⌛: lit spaces are safe from the Shadow
//   People until your next turn. The rest are announced, played at the table.
const ELEMENT_WORDS = { silver: 'silver', holy: 'holy', fire: 'fire', crystal: 'crystal', salt: 'salt', iron: 'iron' };
export function discardOptions(state, pl) {
  const out = [];
  for (const m of state.monsters) {
    const mcard = MONSTER_BY_ID[m.kind];
    mcard?.weaknessTrack.forEach((w, t) => {
      if (w.hits !== null || w.react) return;
      const word = /Discard (\w+)/i.exec(w.text)?.[1]?.toLowerCase();
      const kind = ELEMENT_WORDS[word];
      if (!kind) return;
      pl.inventory.equipment.forEach((item, i) => {
        if (EQUIPMENT_BY_ID[item.id]?.abilities.some((a) => a.kind === kind)) out.push({ item: i, monster: m.id, track: t, text: w.text, kind });
      });
    });
  }
  return out;
}
export function discardForWeakness(state, pl, action, ctx, events) {
  const opt = discardOptions(state, pl).find((o) => o.item === (action.item | 0) && o.track === (action.track | 0) && o.monster === action.monster);
  if (!opt) return 'that card can’t be discarded for this';
  const [item] = pl.inventory.equipment.splice(opt.item, 1);
  const mcard = MONSTER_BY_ID[state.monsters.find((m) => m.id === opt.monster).kind];
  const played = /no light for ⌛/i.test(opt.text);
  if (played) (state.flags ??= {}).noLight = { seat: pl.seat, round: state.round };
  ctx.log(state, `${pl.name} discards the ${EQUIPMENT_BY_ID[item.id].name} against the ${mcard.name}: ${opt.text}.` +
    (played ? ' Lit spaces are safe from it until their next turn.' : ' (Resolve its effect at the table.)'));
  events.push({ type: 'weaknessDiscard', seat: pl.seat, item: item.id, text: opt.text });
  return null;
}

// After the monster acts: this turn's effects end; timed disables count down.
export function endMonsterTurn(monster) {
  monster.mods = {};
  for (const [name, v] of Object.entries(monster.disabled ?? {})) {
    if (typeof v !== 'number') continue;            // until restarted (true), or for good ('perm')
    if (v <= 1) delete monster.disabled[name]; else monster.disabled[name] = v - 1;
  }
}

// Damage to a monster from something other than equipment (traps, the
// Bonfire, the Decrepit Truck): `dice` dice of an element (or none), through
// toughness, counting a weakness hit. Returns the health lost.
export function hurtMonster(state, board, monster, dice, kind, rollDie, ctx, events) {
  const mcard = MONSTER_BY_ID[monster.kind];
  if (!mcard || monster.hp === undefined) return 0;
  if (kind && mcard.immune.includes(kind)) { ctx.log(state, `The ${mcard.name} is immune to ${DAMAGE_KINDS[kind].label}.`); return 0; }
  let dmg = 0;
  for (let k = 0; k < dice; k++) dmg += rollDie();
  const tough = toughnessOf(monster);
  const through = tough === Infinity ? 0 : Math.max(0, dmg - tough);
  if (monster.hp !== null) monster.hp = Math.max(0, monster.hp - through);
  ctx.log(state, `The ${mcard.name} takes ${dmg}${tough && tough !== Infinity ? ` − toughness ${tough}` : ''}: ${through} gets through${monster.hp === null ? '' : ` (${monster.hp}/${monster.maxHp})`}.`);
  if (kind && mcard.weakness.includes(kind)) weaknessHit(state, board, monster, mcard, ctx, events);
  checkDefeat(state, board, monster, mcard, ctx, events);
  return through;
}

// Trigger the monster's next weakness-track effects without hits (Message
// Cypher and Chalk-Scrawled Narrative after midnight): the next `n` numbered
// marks it hasn't reached, in order.
export function triggerWeakness(state, board, monster, n, ctx, events) {
  const mcard = MONSTER_BY_ID[monster.kind];
  if (!mcard) return [];
  const out = [];
  const strikes = [];
  mcard.weaknessTrack.forEach((w, idx) => {
    if (out.length >= n || w.hits === null || monster.trackDone.includes(idx)) return;
    monster.trackDone.push(idx);
    monster.mods ??= {};
    const strike = applyTrackEffect(monster, mcard, w.text, state);
    out.push(w.text);
    events.push({ type: 'weakness', id: monster.id, text: w.text, hits: w.hits });
    if (strike) strikes.push(strike);
  });
  ctx.log(state, out.length ? `The ${mcard.name}'s weakness: ${out.join('; ')}.` : `The ${mcard.name} has no weakness effects left to trigger.`);
  for (const s of strikes) strikeNow(state, board, monster, s, ctx, events);
  return out;
}
