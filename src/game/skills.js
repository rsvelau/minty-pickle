// Which Equipment skills a player can use right now, and why not the others.
// The Skills menu lists these (Ready first: Use now, Almost, Not now,
// Automatic) and the dock's Skills icon counts the ones ready to use.
//
// skillStatus(state, board, pl) -> one entry per skill on each card carried:
//   { item, ability, name, card, status, why, action, manual }
//   status  'now'     every condition is met: `action` is a ready-made 'use'
//                     action (the dice that work, lowest first, and a target)
//           'almost'  one thing is missing that this turn could still fix
//                     (roll first, a free die, an Obol, a target in range)
//           'not'     not this turn (used up, someone else's turn, mid-move,
//                     no monster on the board, no door beside you)
//           'auto'    always on, or comes up by itself (Lunge, Sacrifice)
//   why     a short reason for anything but 'now'
//   manual  the effect is resolved at the table for now (✋): the check only
//           knows it can be paid for
//
// The final word is the rules' own: a candidate action is tried on a copy of
// the state with applyAction, so this never says "now" for something the
// game would refuse.
import { EQUIPMENT_BY_ID } from './cards/equipment.js';
import { MONSTER_BY_ID, DAMAGE_KINDS } from './cards/monsters.js';
import { checkRequirement } from './cards/requirements.js';
import { abilityReady, targetsFor, actionRoll } from './equipmentPlay.js';
import { applyAction } from './rules.js';
import { RANGE, cellRange } from './cards/injuries.js';

const USE_PHASES = ['idle', 'slotting', 'choosing', 'asking'];
const RANGE_WORD = { close: 'Close', mid: 'Mid', long: 'Long', self: 'Self', all: 'All' };

// Every way to pick k of the list (k is 1-3, the list a handful of dice).
function combos(list, k) {
  if (k === 0) return [[]];
  const out = [];
  const walk = (start, pick) => {
    if (pick.length === k) { out.push(pick); return; }
    for (let i = start; i < list.length; i++) walk(i + 1, [...pick, list[i]]);
  };
  walk(0, []);
  return out;
}

export function skillStatus(state, board, pl) {
  const out = [];
  if (!pl) return out;
  const mine = state.players[state.cur] === pl;
  const free = (state.pool ?? []).map((d, n) => ({ ...d, n }))
    .filter((d) => !d.spent && !(state.defSlots ?? []).includes(d.n) && !(state.slots ?? []).includes(d.n));
  pl.inventory.equipment.forEach((item, i) => {
    const card = EQUIPMENT_BY_ID[item.id];
    if (!card) return;
    card.abilities.forEach((a, k) => {
      const fx = a.fx ?? { manual: true };
      const e = { item: i, ability: k, name: a.name, card, status: 'not', why: '', action: null, manual: !!fx.manual };
      out.push(e);
      const set = (status, why = '') => { e.status = status; e.why = why; };
      if (fx.passive) return set('auto', `Always on while you carry the ${card.name}`);
      if (fx.sacrifice) return set('auto', 'Comes up by itself when someone would die');
      if (!abilityReady(item, k)) return set('not', 'Used up until refreshed');
      if (pl.dead) return set('not', `${pl.name} is dead`);
      if (!mine) return set('not', `On ${pl.name}’s turn`);
      if (state.phase === 'over') return set('not', 'The game is over');
      if (state.reactions?.length) return set('not', 'Answer the discard first');
      if (!USE_PHASES.includes(state.phase)) return set('not', state.phase === 'moving' ? 'Finish moving first' : 'Not right now');
      if (fx.lucky && state.lucky) return set('not', 'Lucky is already in play this turn');

      // Targets that can't turn up this turn.
      const targeted = fx.target === 'monster' || fx.target === 'ally' || fx.target === 'either' || fx.lure || fx.door;
      const options = targeted ? targetsFor(state, board, pl, a) : [];
      if (targeted && !options.length) {
        if ((fx.target === 'monster' || fx.lure) && !state.monsters.length) return set('not', 'No monster on the board');
        if (fx.door && state.phase !== 'idle') return set('not', 'No door next to you');
      }

      // Nothing rolled yet: dice skills wait for the roll.
      if (a.dice && state.phase === 'idle' && !(state.pool ?? []).length) return set('almost', `Roll first: needs ${a.dice === 1 ? 'a die' : `${a.dice} dice`}${a.req ? ` [${a.req}]` : ''}`);

      // A monster immune to the skill's element: nothing would happen.
      if (a.kind && fx.target === 'monster') {
        const hurtable = options.filter((o) => !MONSTER_BY_ID[state.monsters.find((m) => m.id === o.monster)?.kind]?.immune.includes(a.kind));
        if (options.length && !hurtable.length) {
          const name = MONSTER_BY_ID[state.monsters.find((m) => m.id === options[0].monster)?.kind]?.name ?? 'monster';
          return set('not', `The ${name} is immune to ${DAMAGE_KINDS[a.kind]?.label ?? a.kind}`);
        }
        options.splice(0, options.length, ...hurtable);
      }

      if (targeted && !options.length) {
        if (fx.door) return set('not', 'No door next to you');
        const reach = RANGE_WORD[a.range] ?? 'Close';
        return set('almost', fx.target === 'monster' ? `No monster in ${reach} range` : `No one in ${reach} range`);
      }

      // Dice: the free ones that meet the requirement, lowest total first
      // (keeps the high dice for moving).
      let dice = [];
      let target = null;
      const tpay = (t) => (t.monster !== undefined ? { monster: t.monster } : t.swarm !== undefined ? { swarm: t.swarm } : t.edge !== undefined ? { edge: t.edge } : t.cell !== undefined ? { cell: t.cell } : { seat: t.seat });
      const tryTargets = fx.target === 'ally' ? [options.find((o) => o.seat === pl.seat) ?? options[0]] : options.length ? options.slice(0, 8) : [null];
      if (a.dice) {
        if (free.length < a.dice) {
          return set('almost', `Needs ${a.dice === 1 ? 'a free die' : `${a.dice} free dice`}: unslot one`);
        }
        const picks = combos(free, a.dice).sort((x, y) => x.reduce((s, d) => s + d.v, 0) - y.reduce((s, d) => s + d.v, 0));
        let found = null;
        for (const t of tryTargets) {
          const mon = t?.monster !== undefined ? state.monsters.find((m) => m.id === t.monster) : null;
          const fit = picks.find((p) => checkRequirement(a.req, p.map((d) => d.v), { targetDie: mon ? actionRoll(mon) : null }));
          if (fit) { found = { fit, t }; break; }
        }
        if (!found) return set('almost', `Your free dice don’t make [${a.req}]`);
        dice = found.fit.map((d) => d.n);
        target = found.t ? tpay(found.t) : null;
      } else if (tryTargets[0]) target = tpay(tryTargets[0]);

      if (a.obols && pl.inventory.obolcraft.length < a.obols) {
        const short = a.obols - pl.inventory.obolcraft.length;
        return set('almost', `${short} more Obol${short === 1 ? '' : 's'} needed`);
      }

      // The rules have the last word: try it on a copy.
      const action = { type: 'use', seat: state.cur, item: i, ability: k, dice, ...(target ? { target } : {}) };
      const r = applyAction(structuredClone(state), board, action);
      if (!r.ok) return set('not', r.error ? r.error[0].toUpperCase() + r.error.slice(1) : 'Not right now');
      e.action = action;
      set('now');
    });
  });
  // The Blessed Cosor (Strigoi objective): Strike, listed with the skills.
  if ((pl.carry ?? []).some((c) => c.item === 'cosor' && c.blessed)) out.push(cosorStrike(state, board, pl, mine, free));
  return out;
}

// The Blessed Cosor's Strike, shaped like an Equipment skill (item 'cosor').
export const COSOR_CARD = {
  name: 'Blessed Cosor',
  abilities: [{ range: 'close', kind: 'holy', name: 'Strike', dice: 1, req: 'Any', limit: null,
    text: 'Deal the die’s value to the Strigoi, ignoring its toughness. Once a turn.', fx: { target: 'monster' } }],
};
function cosorStrike(state, board, pl, mine, free) {
  const e = { item: 'cosor', ability: 0, name: 'Strike', card: COSOR_CARD, status: 'not', why: '', action: null, manual: false };
  const set = (status, why = '') => { e.status = status; e.why = why; return e; };
  const strigoi = state.monsters.find((m) => m.kind === 'strigoi');
  if (pl.dead) return set('not', `${pl.name} is dead`);
  if (!mine) return set('not', `On ${pl.name}’s turn`);
  if (state.struck === state.turn) return set('not', 'Once a turn: struck already');
  if (!USE_PHASES.includes(state.phase)) return set('not', state.phase === 'moving' ? 'Finish moving first' : 'Not right now');
  if (!strigoi) return set('not', 'The Strigoi is not on the board');
  if (state.phase === 'idle' && !(state.pool ?? []).length) return set('almost', 'Roll first: strike with one of your dice');
  if (cellRange(board.grid, pl.pos, strigoi.pos) > RANGE.close) return set('almost', 'The Strigoi is not in Close range');
  if (!free.length) return set('almost', 'Needs a free die: unslot one');
  // The highest free die: the most damage.
  const best = free.reduce((a, d) => (d.v > a.v ? d : a));
  const action = { type: 'strike', seat: state.cur, die: best.n };
  const r = applyAction(structuredClone(state), board, action);
  if (!r.ok) return set('not', r.error ? r.error[0].toUpperCase() + r.error.slice(1) : 'Not right now');
  e.action = action;
  return set('now');
}

// How many skills the player could use this moment (the dock's badge).
export const readyCount = (state, board, pl) => skillStatus(state, board, pl).filter((s) => s.status === 'now').length;
