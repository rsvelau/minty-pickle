// A card monster's turn, played from its card's abilities.
//
//   1. Declare: at the start of a round the monster rolls its action die and
//      the matching ability becomes its intent ("Vicious Pursuit: Pursue (8)
//      and Attack (4)"). The game shows it and highlights players in danger.
//   2. Players take their turns; the danger is recomputed after every action
//      (refreshThreat), so stepping out of reach clears it.
//   3. Execute: at the end of the round the monster carries the intent out
//      (moves, then rolls its damage), and a new intent is declared.
//
// Ability text is read into operations: Pursue (n), Outflank (n), Retreat
// (n), Teleport (Lair / nearest light), Attack (n | die | k dice), Area
// Attack (dmg, Rad n / Rn), Global Attack (n), Heal (n). Anything else on the
// card (Seize, Lure, Pin, Drag, Trap, Exhaust, Block doors...) is shown and
// logged but not played yet; those come with each monster's own rules.
import { MONSTER_BY_ID } from './cards/monsters.js';
import { cellLabel } from '../state.js';
import { applyDamage, alive } from './combat.js';
import { RANGE, cellRange } from './cards/injuries.js';

const KIND_TO_TYPE = { physical: 'P', mental: 'M', spiritual: 'S' };

// "1-3" -> [1,3]; "6" -> [6,6]; "Persistent" -> null.
function rollRange(roll) {
  const m = /^(\d)(?:-(\d))?$/.exec(String(roll).trim());
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}
// Damage spec: "4", "die", "2 dice", "die, R4"...
function damageSpec(spec) {
  const t = String(spec).trim();
  const n = /^(\d+)\s*dice/.exec(t);
  if (n) return { dice: Number(n[1]) };
  if (/^die/.test(t)) return { dice: 1 };
  const f = /^(\d+)/.exec(t);
  return f ? { fixed: Number(f[1]) } : null;
}
export function parseAbility(text) {
  const ops = [];
  const unknown = [];
  const re = /(Area Attack|Global Attack|LoS Attack|Attack|Pursue|Outflank|Retreat|Heal|Teleport)\s*(?:\(([^)]*)\)|\[(\d+)\]|to (Lair))?/g;
  let m;
  while ((m = re.exec(text))) {
    const [, word, paren, bracket, toLair] = m;
    const arg = paren ?? bracket ?? toLair ?? '';
    if (word === 'Pursue' || word === 'Outflank') ops.push({ op: 'pursue', n: parseInt(arg, 10) || 0, word });
    else if (word === 'Retreat') ops.push({ op: 'retreat', n: parseInt(arg, 10) || 0 });
    else if (word === 'Heal') ops.push({ op: 'heal', n: parseInt(arg, 10) || 0 });
    else if (word === 'Teleport') ops.push({ op: 'teleport', to: /light/i.test(arg) ? 'light' : 'lair' });
    else if (word === 'Area Attack') {
      const [dmg, rad] = arg.split(',');
      const r = /(\d+)/.exec(rad ?? '');
      ops.push({ op: 'area', dmg: damageSpec(dmg), radius: r ? Number(r[1]) : 2 });
    } else if (word === 'Global Attack') ops.push({ op: 'global', dmg: damageSpec(arg) });
    else if (word === 'LoS Attack') unknown.push('LoS Attack');
    else if (word === 'Attack') {
      const d = damageSpec(arg);
      if (d) ops.push({ op: 'attack', dmg: d });
    }
  }
  for (const w of ['Seize', 'Lure', 'Consume', 'Pin', 'Drag', 'Trap', 'Exhaust', 'Block', 'Unblock', 'Trample', 'Drop', 'Target', 'ritual']) {
    if (new RegExp(`\\b${w}\\b`).test(text)) unknown.push(w);
  }
  return { ops, unknown };
}

const rollDie = (ctx) => 1 + ctx.randInt(ctx.state, 6);
const rollDamage = (ctx, dmg) => (dmg?.fixed ?? 0) + Array.from({ length: dmg?.dice ?? 0 }, () => rollDie(ctx)).reduce((a, b) => a + b, 0);
const describeDamage = (dmg) => (!dmg ? '?' : dmg.fixed !== undefined ? `${dmg.fixed}` : dmg.dice === 1 ? '1 die' : `${dmg.dice} dice`);
const label = (board, i) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };

// The living player nearest the monster by walking (ties: lowest seat).
function nearestTarget(state, board, from) {
  const { x, y } = board.grid.coords(from);
  const field = board.grid.moveField(x, y, { keys: false });
  let best = null;
  for (const pl of alive(state)) {
    const d = pl.pos === from ? 0 : field.dist[pl.pos];
    if (d < 0) continue;
    if (!best || d < best.d) best = { pl, d, path: field.path(pl.pos) };
  }
  return best;
}

// Where the monster's movement ops would take it, and the steps (cells).
function planMovement(state, board, monster, ops, ctx) {
  let pos = monster.pos;
  const steps = [];
  for (const o of ops) {
    if (o.op === 'pursue') {
      const t = nearestTarget(state, board, pos);
      if (!t) continue;
      // Walk toward them, stopping next to them.
      for (const cell of t.path.slice(1, 1 + o.n)) {
        if (cell === t.pl.pos) break;
        steps.push(cell);
        pos = cell;
      }
    } else if (o.op === 'retreat') {
      for (let k = 0; k < o.n; k++) {
        const { x, y } = board.grid.coords(pos);
        let best = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!board.grid.canStep(x, y, dx, dy)) continue;
          const c = board.grid.index(x + dx, y + dy);
          const t = nearestTarget(state, board, c);
          const d = t ? t.d : 99;
          if (!best || d > best.d) best = { c, d };
        }
        if (!best) break;
        steps.push(best.c);
        pos = best.c;
      }
    } else if (o.op === 'teleport') {
      const target = o.to === 'lair' ? lairCell(state) : nearestLight(state, board, pos);
      if (target >= 0) { steps.push({ teleport: target }); pos = target; }
    }
  }
  void ctx;
  return { pos, steps };
}
function lairCell(state) {
  return state.mystery?.spawnCell ?? -1;
}
function nearestLight(state, board, from) {
  let best = -1, bd = Infinity;
  const a = board.grid.coords(from);
  board.light.forEach((v, i) => {
    if (v < state.config.litThreshold) return;
    const b = board.grid.coords(i);
    const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
const gridDist = (board, a, b) => cellRange(board.grid, a, b);
// Players a melee Attack can reach: Close range (adjacent, diagonals too).
const inClose = (state, board, pos) => alive(state).filter((pl) => cellRange(board.grid, pos, pl.pos) <= RANGE.close);

// The player a melee Attack goes for: in Close range, nearest first.
function closeTarget(state, board, pos) {
  const near = inClose(state, board, pos);
  if (!near.length) return null;
  const t = nearestTarget(state, board, pos);
  return near.find((pl) => pl === t?.pl) ?? near[0];
}

// Who the intent would hit if the round ended now.
function predictVictims(state, board, monster, intent) {
  const { pos } = planMovement(state, board, monster, intent.ops, null);
  const seats = new Set();
  for (const o of intent.ops) {
    if (o.op === 'attack') {
      const t = closeTarget(state, board, pos);
      if (t) seats.add(t.seat);
    } else if (o.op === 'area') {
      for (const pl of alive(state)) if (gridDist(board, pos, pl.pos) <= o.radius) seats.add(pl.seat);
    } else if (o.op === 'global') {
      for (const pl of alive(state)) seats.add(pl.seat);
    }
  }
  return [...seats];
}

// Roll the action die and declare the intent.
export function declareIntent(state, board, monster, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  if (!card) return;
  const roll = rollDie(ctx);
  const idx = card.abilities.findIndex((a) => { const r = rollRange(a.roll); return r && roll >= r[0] && roll <= r[1]; });
  if (idx < 0) {
    monster.intent = { roll, ability: -1, name: 'Waits', text: 'Nothing on its card for this roll', ops: [], unknown: [], danger: [] };
  } else {
    const a = card.abilities[idx];
    const { ops, unknown } = parseAbility(a.text);
    monster.intent = { roll, ability: idx, name: a.name, kind: a.kind, text: a.text, ops, unknown, danger: [] };
  }
  monster.intent.danger = predictVictims(state, board, monster, monster.intent);
  const i = monster.intent;
  ctx.log(state, `The ${card.name} rolls ${roll}: ${i.name}${i.ability >= 0 ? ` (${i.text})` : ''}.` +
    (i.danger.length ? ` In danger: ${i.danger.map((s) => state.players[s].name).join(', ')}.` : ''));
  events.push({ type: 'monsterIntent', id: monster.id, roll, name: i.name, danger: [...i.danger] });
}

// After any action: who's in danger now.
export function refreshThreat(state, board) {
  for (const monster of state.monsters) {
    if (monster.intent) monster.intent.danger = predictVictims(state, board, monster, monster.intent);
  }
}

// Carry out the intent at the end of the round.
export function executeIntent(state, board, monster, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  const intent = monster.intent;
  if (!card || !intent) return;
  const type = KIND_TO_TYPE[intent.kind] ?? card.evidence.attack;
  const source = `The ${card.name}'s ${intent.name}`;
  // Move first.
  const move = planMovement(state, board, monster, intent.ops, ctx);
  for (const s of move.steps) {
    if (typeof s === 'object') {
      events.push({ type: 'monsterTeleport', id: monster.id, from: monster.pos, to: s.teleport });
      monster.pos = s.teleport;
    } else {
      events.push({ type: 'monsterStep', id: monster.id, from: monster.pos, to: s });
      monster.prev = monster.pos;
      monster.pos = s;
    }
  }
  if (move.steps.length) ctx.log(state, `The ${card.name} moves to ${label(board, monster.pos)}.`);
  // Then attacks, rolling damage.
  for (const o of intent.ops) {
    if (o.op === 'attack') {
      const t = closeTarget(state, board, monster.pos);
      if (!t) { ctx.log(state, `${source} finds no one in reach.`); continue; }
      events.push({ type: 'monsterAttack', id: monster.id, seat: t.seat, cell: t.pos });
      applyDamage(state, board, t, type, rollDamage(ctx, o.dmg), { log: ctx.log, source }, events);
    } else if (o.op === 'area' || o.op === 'global') {
      const hit = alive(state).filter((pl) => o.op === 'global' || gridDist(board, monster.pos, pl.pos) <= o.radius);
      if (!hit.length) { ctx.log(state, `${source} strikes at nothing.`); continue; }
      events.push({ type: 'monsterAttack', id: monster.id, seat: hit[0].seat, cell: monster.pos, area: true });
      for (const pl of hit) applyDamage(state, board, pl, type, rollDamage(ctx, o.dmg), { log: ctx.log, source }, events);
    } else if (o.op === 'heal') {
      ctx.log(state, `The ${card.name} heals ${o.n}.`);
    }
  }
  if (intent.unknown.length) ctx.log(state, `(${intent.unknown.join(', ')}: not played yet.)`);
  monster.intent = null;
}

export { describeDamage };
