// A card monster's turn, played from its card's abilities.
//
//   1. Declare: at the start of a round the monster rolls its action dice (the
//      number in the top right of its card) and each die picks an ability
//      ("Vicious Pursuit: Pursue (8) and Attack (4)"). The game shows them and
//      highlights players in danger.
//   2. Players take their turns; the danger is recomputed after every action
//      (refreshThreat), so stepping out of reach clears it.
//   3. Execute: at the end of the round the actions play in order, each
//      moving then rolling its damage, and the next round's dice are rolled.
//
// Ability text is read into operations: Pursue (n), Outflank (n), Retreat
// (n), Teleport (Lair / nearest light), Attack (n | die | k dice), Area
// Attack (dmg, Rad n / Rn), Global Attack (n), Heal (n). Anything else on the
// card (Seize, Lure, Pin, Drag, Trap, Exhaust, Block doors...) is shown and
// logged but not played yet; those come with each monster's own rules.
import { MONSTER_BY_ID } from './cards/monsters.js';
import { cellLabel } from '../core/state.js';
import { applyDamage, alive, defenseValue } from './combat.js';
import { RANGE, cellRange } from './cards/injuries.js';
import { buildingOf } from '../core/mapCheck.js'; // the same grouping the map check uses

const KIND_TO_TYPE = { physical: 'P', mental: 'M', spiritual: 'S' };

// "1-3" -> [1,3]; "6" -> [6,6]; "Persistent" -> null.
function rollRange(roll) {
  const m = /^(\d)(?:-(\d))?$/.exec(String(roll).trim());
  return m ? [Number(m[1]), Number(m[2] ?? m[1])] : null;
}
// Damage spec: "4", "die", "2 dice", "die, R4"...
function damageSpec(spec) {
  // "({1}, die)": a target location first ({n} = a numbered spot on the map,
  // not on the board yet), then the damage.
  const t = String(spec).trim().replace(/^\{[^}]*\}\s*,\s*/, '');
  const n = /^(\d+)\s*dice/.exec(t);
  if (n) return { dice: Number(n[1]) };
  if (/^die/.test(t)) return { dice: 1 };
  const f = /^(\d+)/.exec(t);
  return f ? { fixed: Number(f[1]) } : null;
}
export function parseAbility(text) {
  const ops = [];
  const unknown = [];
  const re = /(Area Attack|Global Attack|LoS Attack|Attack|Exhaust|Pursue|Outflank|Retreat|Heal|Teleport)\s*(?:\(([^)]*)\)|\[(\d+)\]|to (Lair))?/g;
  let m;
  while ((m = re.exec(text))) {
    const [, word, paren, bracket, toLair] = m;
    const arg = paren ?? bracket ?? toLair ?? '';
    if (word === 'Exhaust') {
      // Exhaust (Defensive die | Movement die | All slotted dice).
      ops.push({ op: 'exhaust', what: /all/i.test(arg) ? 'all' : /move/i.test(arg) ? 'movement' : 'defense' });
      continue;
    }
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
      const target = /^\{(\d+)\}/.exec(String(arg).trim());
      if (d) ops.push({ op: 'attack', dmg: d, ...(target ? { target: Number(target[1]) } : {}) });
    }
  }
  for (const w of ['Seize', 'Lure', 'Consume', 'Pin', 'Drag', 'Trap', 'Block', 'Unblock', 'Trample', 'Drop', 'Target', 'ritual']) {
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
    if (v < state.config.litThreshold || !board.grid.cells[i].walkable) return;
    const b = board.grid.coords(i);
    const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
const gridDist = (board, a, b) => cellRange(board.grid, a, b);
// Players a melee Attack can reach: Close range (adjacent, diagonals too).
const inClose = (state, board, pos) => alive(state).filter((pl) => cellRange(board.grid, pos, pl.pos) <= RANGE.close);

// A fly swarm's route from `from` to the nearest living player: over any
// terrain, but walls, windows and locked doors stop it. Returns cells or null.
export function swarmRoute(state, board, from) {
  return swarmRouteTo(board, from, new Set(alive(state).map((pl) => pl.pos)));
}
export function swarmRouteTo(board, from, targets) {
  const grid = board.grid;
  const n = grid.cells.length;
  const prev = new Int32Array(n).fill(-2);
  prev[from] = -1;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (targets.has(i)) {
      const path = [];
      for (let c = i; c >= 0; c = prev[c]) path.unshift(c);
      return path;
    }
    const { x, y } = grid.coords(i);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!grid.inBounds(x + dx, y + dy) || !grid.canCross(x, y, dx, dy)) continue;
      const j = grid.index(x + dx, y + dy);
      if (prev[j] === -2) { prev[j] = i; queue.push(j); }
    }
  }
  return null;
}
const swarmVictim = (state, path) => (path ? alive(state).find((pl) => pl.pos === path[path.length - 1]) : null);

// The player a melee Attack goes for: in Close range, nearest first.
function closeTarget(state, board, pos) {
  const near = inClose(state, board, pos);
  if (!near.length) return null;
  const t = nearestTarget(state, board, pos);
  return near.find((pl) => pl === t?.pl) ?? near[0];
}

// One action from one die: the card ability whose roll range includes it.
function actionFor(card, roll) {
  const idx = card.abilities.findIndex((a) => { const r = rollRange(a.roll); return r && roll >= r[0] && roll <= r[1]; });
  if (idx < 0) return { roll, ability: -1, name: 'Waits', text: 'Nothing on its card for this roll', ops: [], unknown: [] };
  const a = card.abilities[idx];
  const { ops, unknown } = parseAbility(a.text);
  return { roll, ability: idx, name: a.name, kind: a.kind, text: a.text, ops, unknown };
}

// Who the declared actions would hit if the round ended now: the actions
// play in order, each starting where the last one left the monster.
function predictVictims(state, board, monster, intents) {
  const seats = new Set();
  const types = {};
  let pos = monster.pos;
  const card = MONSTER_BY_ID[monster.kind];
  for (const intent of intents) {
    const type = KIND_TO_TYPE[intent.kind] ?? card?.evidence.attack;
    const before = new Set(seats);
    pos = planMovement(state, board, { pos }, intent.ops, null).pos;
    const swarm = MONSTER_BY_ID[monster.kind]?.actsBy === 'swarm';
    for (const o of intent.ops) {
      if (o.op === 'attack' && swarm && o.target !== undefined) {
        if (!livingVictims(state).length) for (const pl of alive(state)) seats.add(pl.seat);
      } else if (o.op === 'attack' && swarm) {
        const v = swarmVictim(state, swarmRoute(state, board, pos));
        if (v) seats.add(v.seat);
      } else if (o.op === 'attack') {
        const t = closeTarget(state, board, pos);
        if (t) seats.add(t.seat);
      } else if (o.op === 'area') {
        for (const pl of alive(state)) if (gridDist(board, pos, pl.pos) <= o.radius) seats.add(pl.seat);
      } else if (o.op === 'global') {
        for (const pl of alive(state)) seats.add(pl.seat);
      }
    }
    for (const seat of seats) if (!before.has(seat)) (types[seat] ??= []).push(type);
  }
  monster.dangerTypes = types; // seat -> damage types threatening them (P/M/S)
  return [...seats];
}

// Start of a round: roll the monster's action dice (the number in the top
// right of its card) and declare every action, in order.
export function declareIntent(state, board, monster, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  if (!card) return;
  const n = Math.max(0, card.badge | 0);
  monster.intents = Array.from({ length: n }, () => actionFor(card, rollDie(ctx)));
  monster.danger = predictVictims(state, board, monster, monster.intents);
  const list = monster.intents.map((i) => `${i.roll}: ${i.name}${i.ability >= 0 ? ` (${i.text})` : ''}`).join('; then ');
  ctx.log(state, n
    ? `The ${card.name} rolls ${n === 1 ? 'its die' : `${n} dice`}: ${list}.` +
      (monster.danger.length ? ` In danger: ${monster.danger.map((s) => state.players[s].name).join(', ')}.` : '')
    : `The ${card.name} rolls no dice; only its constant effects apply.`);
  events.push({ type: 'monsterIntent', id: monster.id, rolls: monster.intents.map((i) => i.roll), danger: [...monster.danger] });
}

// After any action: who's in danger now.
export function refreshThreat(state, board) {
  for (const monster of state.monsters) {
    if (monster.intents) monster.danger = predictVictims(state, board, monster, monster.intents);
  }
}

// --- Exhaust ---------------------------------------------------------------------
// A slotted die of the named type disappears for the rest of the game (a
// black die too: that player rolls one fewer from now on).
export function exhaust(state, pl, what, ctx, events) {
  const takeFrom = what === 'movement' ? ['lastMove'] : what === 'all' ? ['defense', 'lastMove'] : ['defense'];
  const gone = [];
  for (const key of takeFrom) {
    const list = pl[key] ?? [];
    if (!list.length) continue;
    if (what === 'all') { gone.push(...list.splice(0)); continue; }
    // One die: the strongest.
    let best = 0;
    list.forEach((d, k) => { if (d.v > list[best].v) best = k; });
    gone.push(...list.splice(best, 1));
  }
  if (!gone.length) return;
  const black = gone.filter((d) => d.kind === 'black').length;
  pl.lostBlack = (pl.lostBlack ?? 0) + black;
  ctx.log(state, `${pl.name}'s ${gone.map((d) => `${d.kind} ${d.v}`).join(' + ')} ${gone.length === 1 ? 'is' : 'are'} exhausted for the rest of the game` +
    `${black ? ` (${pl.name} now rolls ${black} fewer black ${black === 1 ? 'die' : 'dice'})` : ''}.`);
  events.push({ type: 'exhausted', seat: pl.seat, dice: gone.map((d) => ({ ...d })), what });
}

// --- Victims (Adze): townspeople its swarms prey on ------------------------------------
// At midnight each {n} target on the card becomes a victim placed at an
// Objective marker, each in a different building where the map allows.
export function setupVictims(state, board, monster, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  const targets = [];
  for (const a of card?.abilities ?? []) {
    const t = /\{(\d+)\}/.exec(a.text);
    if (t && !targets.some((v) => v.target === Number(t[1]))) targets.push({ target: Number(t[1]), name: a.name });
  }
  if (!targets.length) return;
  // Objective markers grouped by building; one per building first.
  const byBuilding = new Map();
  board.grid.cells.forEach((c, i) => {
    if (c.marker !== 'objective') return;
    const b = buildingOf(board.grid, i);
    if (!byBuilding.has(b)) byBuilding.set(b, []);
    byBuilding.get(b).push(i);
  });
  const groups = [...byBuilding.values()];
  for (let i = groups.length - 1; i > 0; i--) { const j = ctx.randInt(state, i + 1); [groups[i], groups[j]] = [groups[j], groups[i]]; }
  const picks = groups.map((g) => g[ctx.randInt(state, g.length)]);
  // Not enough buildings: fall back to more markers in the same ones.
  for (const g of groups) for (const c of g) if (picks.length < targets.length && !picks.includes(c)) picks.push(c);
  state.npcs = targets.slice(0, picks.length).map((t, k) => ({
    id: `v${t.target}`, target: t.target, name: t.name, cell: picks[k], alive: true,
  }));
  for (const v of state.npcs) ctx.log(state, `${v.name}: a townsperson at ${label(board, v.cell)} is in the ${card.name}'s sights.`);
  events.push({ type: 'npcs', npcs: state.npcs.map((v) => ({ ...v })) });
}
const livingVictims = (state) => (state.npcs ?? []).filter((v) => v.alive);

// The swarm strikes a victim. Players in Close range can defend them: the
// best slotted defense among them is compared with the damage; at least the
// damage saves them, otherwise the victim dies. Returns the defender (if any).
function attackVictim(state, board, monster, card, intent, o, ctx, events) {
  const victims = livingVictims(state);
  let v = victims.find((x) => x.target === o.target) ?? victims[0];
  const type = KIND_TO_TYPE[intent.kind] ?? card.evidence.attack;
  const path = swarmRouteTo(board, monster.pos, new Set([v.cell])) ?? [monster.pos, v.cell];
  events.push({ type: 'monsterSwarm', id: monster.id, path, npc: v.id, attack: type });
  const dmg = rollDamage(ctx, o.dmg);
  const guards = alive(state).filter((pl) => cellRange(board.grid, pl.pos, v.cell) <= RANGE.close);
  const best = guards.reduce((a, pl) => (!a || defenseValue(pl) > defenseValue(a) ? pl : a), null);
  const block = best ? defenseValue(best) : 0;
  if (best && block >= dmg) {
    ctx.log(state, `The ${card.name}'s swarm falls on the ${v.name} for ${dmg}: ${best.name} shields them (defense ${block}).`);
    events.push({ type: 'npcAttacked', npc: v.id, cell: v.cell, amount: dmg, defense: block, defender: best.seat, outcome: 'saved' });
    return best;
  }
  v.alive = false;
  const dead = (state.npcs ?? []).filter((x) => !x.alive).length;
  ctx.log(state, `The ${card.name}'s swarm falls on the ${v.name} for ${dmg}${best ? ` (defense ${block} wasn't enough)` : ' and no one defends them'}. They die.`);
  events.push({ type: 'npcAttacked', npc: v.id, cell: v.cell, amount: dmg, defense: block, defender: best?.seat ?? null, outcome: 'killed' });
  // On a victim's death: a Global Attack of one die per dead victim (die × ☠).
  const source = `The ${card.name} (a victim dies)`;
  for (const pl of alive(state)) {
    const amount = Array.from({ length: dead }, () => rollDie(ctx)).reduce((a, b) => a + b, 0);
    applyDamage(state, board, pl, type, amount, { log: ctx.log, source }, events);
  }
  return best;
}

// End of the round: carry out each declared action in order.
export function executeIntent(state, board, monster, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  if (!card || !monster.intents) return;
  for (const intent of monster.intents) {
    if (!alive(state).length) break;
    const type = KIND_TO_TYPE[intent.kind] ?? card.evidence.attack;
    const source = `The ${card.name}'s ${intent.name}`;
    // Move first.
    const move = planMovement(state, board, monster, intent.ops, ctx);
    for (const st of move.steps) {
      if (typeof st === 'object') {
        events.push({ type: 'monsterTeleport', id: monster.id, from: monster.pos, to: st.teleport });
        monster.pos = st.teleport;
      } else {
        events.push({ type: 'monsterStep', id: monster.id, from: monster.pos, to: st });
        monster.prev = monster.pos;
        monster.pos = st;
      }
    }
    if (move.steps.length) ctx.log(state, `The ${card.name} moves to ${label(board, monster.pos)}.`);
    // Then the rest in card order; `hit` = who the action is aimed at (for Exhaust).
    let hit = [];
    for (const o of intent.ops) {
      if (o.op === 'attack' && o.target !== undefined && card.actsBy === 'swarm' && livingVictims(state).length) {
        const defender = attackVictim(state, board, monster, card, intent, o, ctx, events);
        hit = defender ? [defender] : [];
        continue;
      }
      if (o.op === 'attack' && o.target !== undefined && card.actsBy === 'swarm') {
        // No victims left: its attacks are Global.
        ctx.log(state, `${source}: with no victims left, the swarms fall on everyone.`);
        events.push({ type: 'monsterAttack', id: monster.id, seat: alive(state)[0].seat, cell: monster.pos, area: true, attack: type });
        hit = alive(state);
        for (const pl of hit) applyDamage(state, board, pl, type, rollDamage(ctx, o.dmg), { log: ctx.log, source }, events);
        continue;
      }
      if (o.op === 'attack' && card.actsBy === 'swarm') {
        const path = swarmRoute(state, board, monster.pos);
        const v = swarmVictim(state, path);
        if (!v) { ctx.log(state, `${source}: the swarm finds no one.`); continue; }
        events.push({ type: 'monsterSwarm', id: monster.id, seat: v.seat, path, attack: type });
        hit = [v];
        applyDamage(state, board, v, type, rollDamage(ctx, o.dmg), { log: ctx.log, source: `${source} (fly swarm)` }, events);
        continue;
      }
      if (o.op === 'exhaust') {
        const targets = hit.length ? hit : [closeTarget(state, board, monster.pos)].filter(Boolean);
        for (const pl of targets) exhaust(state, pl, o.what, ctx, events);
        hit = targets;
        continue;
      }
      if (o.op === 'attack') {
        const t = closeTarget(state, board, monster.pos);
        if (!t) { ctx.log(state, `${source} finds no one in reach.`); continue; }
        hit = [t];
        events.push({ type: 'monsterAttack', id: monster.id, seat: t.seat, cell: t.pos, attack: type });
        applyDamage(state, board, t, type, rollDamage(ctx, o.dmg), { log: ctx.log, source }, events);
      } else if (o.op === 'area' || o.op === 'global') {
        const targets = alive(state).filter((pl) => o.op === 'global' || gridDist(board, monster.pos, pl.pos) <= o.radius);
        if (!targets.length) { ctx.log(state, `${source} strikes at nothing.`); continue; }
        hit = targets;
        events.push({ type: 'monsterAttack', id: monster.id, seat: targets[0].seat, cell: monster.pos, area: true, attack: type });
        for (const pl of targets) applyDamage(state, board, pl, type, rollDamage(ctx, o.dmg), { log: ctx.log, source }, events);
      } else if (o.op === 'heal') {
        ctx.log(state, `The ${card.name} heals ${o.n}.`);
      }
    }
    if (intent.unknown.length) ctx.log(state, `(${intent.name}: ${intent.unknown.join(', ')} not played yet.)`);
  }
  monster.intents = null;
  monster.danger = [];
}

// Constant effects that fire when a player steps onto a cell, e.g. the
// Shadow People's Umbral Stab (attack any player entering a lit space).
export function onPlayerEnters(state, board, pl, cell, ctx, events) {
  for (const monster of state.monsters) {
    const card = MONSTER_BY_ID[monster.kind];
    const rule = card?.onEnterLit;
    if (!rule || pl.dead) continue;
    if ((board.light[cell] ?? 0) < state.config.litThreshold) continue;
    const ability = card.abilities.find((a) => a.roll === 'Persistent' && KIND_TO_TYPE[a.kind]);
    const type = KIND_TO_TYPE[rule.kind] ?? card.evidence.attack;
    events.push({ type: 'monsterAttack', id: monster.id, seat: pl.seat, cell, grab: true, attack: type });
    applyDamage(state, board, pl, type, rollDamage(ctx, damageSpec(rule.dmg)), { log: ctx.log, source: `The ${card.name}'s ${ability?.name ?? 'attack'}` }, events);
  }
}

export { describeDamage };
