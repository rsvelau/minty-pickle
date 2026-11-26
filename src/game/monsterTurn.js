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
import { applyDamage, alive, defenseValue, killPlayer } from './combat.js';
import { RANGE, cellRange } from './cards/injuries.js';
import { buildingOf } from '../core/mapCheck.js'; // the same grouping the map check uses
import { buildingCells } from '../core/buildings.js';
import { endMonsterTurn, hurtMonster, strikeMonster } from './equipmentPlay.js';
import { monsterEnters, monsterDoorBanned } from './eventPlay.js';
import { anyDoor, blockDoor, buildingDoors } from './doors.js';
import { edgeKey } from '../core/state.js';
import { watch, offer } from './reactions.js';
import { mapSites } from './objectives/scripts.js';
import { siteByNumber } from '../core/sites.js';

// --- Bodies: how a monster gets past walls and doors ------------------------------
// Corporeal: stopped by locked, nailed, chained, boarded and one-way doors, but
//   plans its route as if they'd give way; stuck at one that is the next step
//   toward its prey, it trades any attack with no one in reach for a Bash
//   (one die of Physical damage to the door). Doors have DOOR_HP (a chained one
//   CHAIN_HP); at 0 the door is breached: an open doorway for good.
// Incorporeal: phases through everything when it moves: walls, doors, blocked
//   spaces.
// Semi-Corporeal: as Corporeal, but it won't bother with a door when a later
//   action this round teleports it (teleports ignore walls anyway).
export const DOOR_HP = 10, CHAIN_HP = 12;
export function bodyOf(kind) {
  const t = MONSTER_BY_ID[kind]?.traits ?? [];
  return t.includes('Incorporeal') ? 'incorporeal' : t.includes('Semi-Corporeal') ? 'semi' : 'corporeal';
}
// Every cell, through anything: a ghost's walking field.
function phaseField(grid, from, blocked = new Set()) {
  const n = grid.cells.length;
  const dist = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const { x, y } = grid.coords(q[h]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!grid.inBounds(x + dx, y + dy)) continue;
      const j = grid.index(x + dx, y + dy);
      if (dist[j] >= 0 || blocked.has(j)) continue;
      dist[j] = dist[q[h]] + 1; prev[j] = q[h]; q.push(j);
    }
  }
  const path = (i) => { if (dist[i] < 0) return null; const p = []; for (let c = i; c >= 0; c = prev[c]) p.unshift(c); return p; };
  return { dist, path };
}
// Where a monster would walk from `from`: Incorporeal through anything; the
// others as if every door (locked, nailed, chained...) would give way.
function monsterField(state, board, monster, from) {
  const g = board.grid;
  // Salt Circles can't be entered or crossed (a player standing in one can
  // still be walked up to: the walk stops next to them).
  let salt = saltedCells(state).filter((i) => !state.players.some((pl) => !pl.dead && pl.pos === i));
  // Outdoors only (the Barghest): building floors are as good as walls.
  if (MONSTER_BY_ID[monster.kind]?.outdoorsOnly) g.cells.forEach((c, i) => { if (c.area === 'indoor') salt.push(i); });
  salt = [...new Set(salt)];
  if (bodyOf(monster.kind) === 'incorporeal') return phaseField(g, from, new Set(salt));
  const { x, y } = g.coords(from);
  const real = g.edgeOverride;
  const was = salt.map((i) => g.cells[i].walkable);
  g.edgeOverride = (k, t) => (anyDoor(t) ? 'door' : real ? real(k, t) : t);
  for (const i of salt) g.cells[i].walkable = false;
  try { return g.moveField(x, y, { keys: false }); } finally {
    g.edgeOverride = real;
    salt.forEach((i, n) => { g.cells[i].walkable = was[n]; });
  }
}
// Salt Circles in effect (they last through the monster's turn that round).
export const saltedCells = (state) => (state.saltCircles ?? []).filter((c) => c.round === state.round).map((c) => c.cell);
// The edge between two neighbouring cells.
function edgeBetween(grid, a, b) {
  const p = grid.coords(a), q = grid.coords(b);
  const dx = q.x - p.x, dy = q.y - p.y;
  return dx ? edgeKey('v', dx > 0 ? p.x + 1 : p.x, p.y) : edgeKey('h', p.x, dy > 0 ? p.y + 1 : p.y);
}
// Can the monster really step from a to b (its neighbour)? Ghosts always can.
function canWalk(board, monster, a, b, state = null) {
  if (state && saltedCells(state).includes(b)) return false;   // salt stops every body
  if (MONSTER_BY_ID[monster.kind]?.outdoorsOnly && board.grid.cells[b]?.area === 'indoor') return false;
  if (bodyOf(monster.kind) === 'incorporeal') return true;
  const p = board.grid.coords(a), q = board.grid.coords(b);
  return board.grid.canStep(p.x, p.y, q.x - p.x, q.y - p.y);
}
// The door the monster is stuck at: its next step toward its prey crosses a
// door it can't pass. null if none (or a ghost).
export function doorInPath(state, board, monster) {
  if (bodyOf(monster.kind) === 'incorporeal') return null;
  const t = nearestTarget(state, board, monster.pos, monster);
  const next = t?.path?.[1];
  if (next === undefined || canWalk(board, monster, monster.pos, next)) return null;
  const k = edgeBetween(board.grid, monster.pos, next);
  return anyDoor(board.grid.edgeAt(k)) ? k : null;
}

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
  // Curseblood Ritual: "+1 ritual. At 3 ritual: Global Attack (10)": the
  // count goes up each time; at the mark the Global Attack, and it starts over.
  // Swoop: "Immediately land adjacent to the nearest player": a teleport.
  if (/land adjacent to the nearest player/i.test(text)) ops.push({ op: 'teleport', to: 'player' });
  const rit = /\+1 ritual\.?\s*At (\d+) ritual:\s*Global Attack \(([^)]*)\)/i.exec(text);
  if (rit) text = text.replace(rit[0], '');
  const re = /(Area Attack|Global Attack|LoS Attack|Attack|Exhaust|Pursue|Outflank|Retreat|Heal|Teleport)(?!\s*&)\s*(?:\(([^)]*)\)|\[(\d+)\]|to (Lair))?/g;
  let m;
  const push = (o) => ops.push({ ...o, _at: m.index });   // in the card's order (see below)
  while ((m = re.exec(text))) {
    const [, word, paren, bracket, toLair] = m;
    const arg = paren ?? bracket ?? toLair ?? '';
    if (word === 'Exhaust') {
      // Exhaust (Defensive die | Movement die | All slotted dice).
      push({ op: 'exhaust', what: /all defens/i.test(arg) ? 'allDefense' : /all/i.test(arg) ? 'all' : /move/i.test(arg) ? 'movement' : 'defense' });
      continue;
    }
    if (word === 'Pursue' || word === 'Outflank') push({ op: 'pursue', n: parseInt(arg, 10) || 0, word });
    else if (word === 'Retreat') push({ op: 'retreat', n: parseInt(arg, 10) || 0 });
    else if (word === 'Heal') push({ op: 'heal', n: parseInt(arg, 10) || 0 });
    else if (word === 'Teleport') push({ op: 'teleport', to: /light/i.test(arg) ? 'light' : 'lair' });
    else if (word === 'Area Attack') {
      const [dmg, rad] = arg.split(',');
      const r = /(\d+)/.exec(rad ?? '');
      // "all players inside": everyone in the monster's building (White Lady's Regret).
      if (/inside/i.test(rad ?? '')) push({ op: 'area', dmg: damageSpec(dmg), inside: true });
      // "nearest occupied building to Lair": everyone in that building (Poltergeist's Torment).
      else if (/occupied building/i.test(rad ?? '')) push({ op: 'area', dmg: damageSpec(dmg), building: 'nearLair' });
      // "Only affects outdoor spaces" (Banshee's Keen).
      else push({ op: 'area', dmg: damageSpec(dmg), radius: r ? Number(r[1]) : 2, ...(/outdoor/i.test(text) ? { outdoor: true } : {}) });
    } else if (word === 'Global Attack') push({ op: 'global', dmg: damageSpec(arg) });
    else if (word === 'LoS Attack') push({ op: 'los', dmg: damageSpec(arg) });
    else if (word === 'Attack') {
      const d = damageSpec(arg);
      const target = /^\{(\d+)\}/.exec(String(arg).trim());
      if (d) push({ op: 'attack', dmg: d, ...(target ? { target: Number(target[1]) } : {}) });
    }
  }
  if (rit) ops.push({ op: 'ritual', at: Number(rit[1]), dmg: damageSpec(rit[2]), _at: text.length });
  // Trample (dmg, n): a charge of n spaces at the nearest player, through them
  // and on in a straight line; everyone on a space it charges through takes
  // the damage (Ushi-Oni's Run Down).
  const tr = /Trample \(([^,)]*),\s*(\d+)\)/.exec(text);
  if (tr) {
    ops.push({ op: 'pursue', n: Number(tr[2]), word: 'Trample', _at: tr.index });
    ops.push({ op: 'trample', dmg: damageSpec(tr[1]), _at: tr.index + 1 });
    text = text.replace(tr[0], '');
  }
  // Target, Pin, Drop, appear, Block / Unblock (group 7, for the objective monsters).
  const more = /(Target & appear inside \(occupied building nearest \{(\d+)\}\)|Target \(([^)]*)\)|Pin \((\d+)\)|Drop \(([^)]*)\)|Pull \((\d+)\)|Unblock \(all doors\)|Block \(all doors\))/g;
  let k;
  while ((k = more.exec(text))) {
    const [all, , near, who, pin, drop, pull] = k;
    if (near) ops.push({ op: 'appear', near: Number(near), _at: k.index });
    else if (pull) ops.push({ op: 'pull', n: Number(pull), _at: k.index });
    else if (who !== undefined) ops.push({ op: 'target', who: /least injured/i.test(who) ? 'leastInjuredInside' : /lair/i.test(who) ? 'nearestLair' : /cosor/i.test(who) ? 'cosor' : 'nearest', _at: k.index });
    else if (pin) ops.push({ op: 'pin', dmg: { fixed: Number(pin) }, _at: k.index });
    else if (drop !== undefined) ops.push({ op: 'drop', item: drop.trim().toLowerCase(), _at: k.index });
    else if (/^Unblock/.test(all)) ops.push({ op: 'unblock', _at: k.index });
    else ops.push({ op: 'block', _at: k.index });
  }
  ops.sort((a, b) => (a._at ?? -1) - (b._at ?? -1));
  for (const o of ops) delete o._at;
  // Trap (2 dice): sprung at once where it lands (Barghest's Shadow Trap).
  // Drag (die, 5M into nearest building): an attack; if it lands, they are
  //   dragged up to 5 spaces into the nearest building (Skinwalker's Bear Maul).
  // Lure (die, R4): everyone within 4 is pulled one die's worth of spaces toward it.
  // Consume (die): everyone in Close range after that; it heals what it deals (Wendigo's Feed).
  // Seize player: a 2-dice attack; if it lands, the player is Seized (Ushi-Oni's Abduct).
  const late = [
    [/Trap \(([^)]*)\)/, (m) => ({ op: 'trap', dmg: damageSpec(m[1]) })],
    [/Drag \(([^,)]*),\s*(\d+)/, (m) => ({ op: 'drag', dmg: damageSpec(m[1]), n: Number(m[2]) })],
    [/Lure \(([^,)]*),\s*R(\d+)\)/, (m) => ({ op: 'lure', dmg: damageSpec(m[1]), radius: Number(m[2]) })],
    [/Consume \(([^)]*)\)/, (m) => ({ op: 'consume', dmg: damageSpec(m[1]) })],
    [/Seize player/, () => ({ op: 'seize', dmg: { dice: 2 } })],
  ];
  for (const [re, make] of late) {
    const mm = re.exec(text);
    if (mm) { ops.push({ ...make(mm), _at: mm.index }); text = text.replace(mm[0], ''); }
  }
  ops.sort((a, b) => (a._at ?? -1) - (b._at ?? -1));
  for (const o of ops) delete o._at;
  for (const w of ['Seize', 'Lure', 'Consume', 'Drag', 'Trap', 'Trample']) {
    if (new RegExp(`\\b${w}\\b`).test(text)) unknown.push(w);
  }
  return { ops, unknown };
}

const rollDie = (ctx) => 1 + ctx.randInt(ctx.state, 6);
const rollDamage = (ctx, dmg) => (dmg?.fixed ?? 0) + Array.from({ length: dmg?.dice ?? 0 }, () => rollDie(ctx)).reduce((a, b) => a + b, 0);
const describeDamage = (dmg) => (!dmg ? '?' : dmg.fixed !== undefined ? `${dmg.fixed}` : dmg.dice === 1 ? '1 die' : `${dmg.dice} dice`);
const label = (board, i) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };

// The living player nearest the monster by walking (ties: lowest seat).
// Bumped Shelf (after midnight): a hidden player can't be targeted this round.
const targetable = (state) => alive(state).filter((pl) => pl.hiddenRound !== state.round);
// Who it will come for (and strike up close): not the camouflaged (Viper Hood).
const chaseable = (state) => targetable(state).filter((pl) => pl.camoRound !== state.round);
// The Strigoi always targets the Cosor holder (while someone holds it).
function prey(state, monster) {
  const all = chaseable(state);
  if (monster?.kind !== 'strigoi') return all;
  const holder = all.find((pl) => (pl.carry ?? []).some((c) => c.item === 'cosor'));
  return holder ? [holder] : all;
}
function nearestTarget(state, board, from, monster = null) {
  const { x, y } = board.grid.coords(from);
  const field = monster ? monsterField(state, board, monster, from) : board.grid.moveField(x, y, { keys: false });
  let best = null;
  for (const pl of prey(state, monster)) {
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
    if (o.op === 'pursue' && monster.lure) {
      // Police Patrol (after midnight): this move heads for the sirens.
      const path = monsterField(state, board, monster, pos).path(monster.lure.cell) ?? [];
      for (const cell of path.slice(1, 1 + o.n)) {
        if (!canWalk(board, monster, pos, cell, state)) break;   // a door or salt in the way
        steps.push(cell); pos = cell;
      }
      continue;
    }
    if (o.op === 'pursue') {
      const t = nearestTarget(state, board, pos, monster);
      if (!t) continue;
      // Walk toward them, stopping next to them, or at a door it can't pass
      // (it may Bash it: see doorInPath).
      if (o.word === 'Trample') {
        // A charge: through the player it charges at and on, straight ahead,
        // for all n spaces (or until something stops it).
        let left = o.n;
        for (const cell of t.path.slice(1)) {
          if (!left || !canWalk(board, monster, pos, cell, state)) { left = left ? -1 : 0; break; }
          steps.push(cell); pos = cell; left--;
        }
        const n = steps.length;
        if (left > 0 && n) {
          const a = board.grid.coords(n > 1 ? steps[n - 2] : monster.pos), b = board.grid.coords(pos);
          const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
          for (; left > 0; left--) {
            const c = board.grid.coords(pos);
            if (!board.grid.inBounds(c.x + dx, c.y + dy)) break;
            const cell = board.grid.index(c.x + dx, c.y + dy);
            if (!canWalk(board, monster, pos, cell, state)) break;
            steps.push(cell); pos = cell;
          }
        }
        continue;
      }
      for (const cell of t.path.slice(1, 1 + o.n)) {
        if (cell === t.pl.pos) break;
        if (!canWalk(board, monster, pos, cell, state)) break;
        steps.push(cell);
        pos = cell;
      }
    } else if (o.op === 'retreat') {
      for (let k = 0; k < o.n; k++) {
        const { x, y } = board.grid.coords(pos);
        let best = null;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!board.grid.inBounds(x + dx, y + dy)) continue;
          const c = board.grid.index(x + dx, y + dy);
          if (!canWalk(board, monster, pos, c, state)) continue;
          const t = nearestTarget(state, board, c, monster);
          const d = t ? t.d : 99;
          if (!best || d > best.d) best = { c, d };
        }
        if (!best) break;
        steps.push(best.c);
        pos = best.c;
      }
    } else if (o.op === 'teleport') {
      const target = o.to === 'lair' ? lairCell(state) : o.to === 'player' ? besideNearest(state, board, pos) : nearestLight(state, board, pos);
      if (target >= 0) { steps.push({ teleport: target }); pos = target; }
    }
  }
  void ctx;
  return { pos, steps };
}
// A free walkable space next to the nearest player (as the crow flies).
function besideNearest(state, board, from) {
  const g = board.grid;
  const pl = [...chaseable(state)].sort((a, b) => gridDist(board, from, a.pos) - gridDist(board, from, b.pos))[0];
  if (!pl) return -1;
  const { x, y } = g.coords(pl.pos);
  const taken = new Set(state.players.filter((p) => !p.dead).map((p) => p.pos));
  let best = -1, bd = Infinity;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!g.inBounds(x + dx, y + dy)) continue;
    const c = g.index(x + dx, y + dy);
    if (!g.cells[c].walkable || taken.has(c)) continue;
    const d = gridDist(board, from, c);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
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
// terrain and through any door, but walls and windows stop it. Returns cells or null.
export function swarmRoute(state, board, from) {
  return swarmRouteTo(board, from, new Set(chaseable(state).map((pl) => pl.pos)));
}
// Flies get through any door (locked, nailed, boarded: through the gaps);
// walls and windows stop them.
const flyOverride = (k, t) => (t && t !== 'wall' && t !== 'window' ? 'door' : t);
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
      if (!grid.inBounds(x + dx, y + dy) || !grid.canCross(x, y, dx, dy, () => true, flyOverride)) continue;
      const j = grid.index(x + dx, y + dy);
      if (prev[j] === -2) { prev[j] = i; queue.push(j); }
    }
  }
  return null;
}
const swarmVictim = (state, path) => (path ? alive(state).find((pl) => pl.pos === path[path.length - 1]) : null);

// The player a melee Attack goes for: in Close range, nearest first.
function closeTarget(state, board, pos, monster = null) {
  const allowed = new Set(prey(state, monster));
  const near = inClose(state, board, pos).filter((pl) => pl.hiddenRound !== state.round && allowed.has(pl));
  if (!near.length) return null;
  const t = nearestTarget(state, board, pos, monster);
  return near.find((pl) => pl === t?.pl) ?? near[0];
}

// One action from one die: the card ability whose roll range includes it.
function actionFor(card, roll, monster = null) {
  const idx = card.abilities.findIndex((a) => { const r = rollRange(a.roll); return r && roll >= r[0] && roll <= r[1]; });
  if (idx < 0) return { roll, ability: -1, name: 'Waits', text: 'Nothing on its card for this roll', ops: [], unknown: [] };
  const a = card.abilities[idx];
  // Disabled by its weakness track.
  if (monster?.disabled?.[a.name]) return { roll, ability: -1, name: `${a.name} (disabled)`, text: 'Disabled by its weakness', ops: [], unknown: [] };
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
    const from = pos;
    const plan = planMovement(state, board, { pos, kind: monster.kind, lure: monster.lure }, intent.ops, null);
    pos = plan.pos;
    const swarm = MONSTER_BY_ID[monster.kind]?.actsBy === 'swarm';
    for (const o of intent.ops) {
      if (o.op === 'attack' && swarm && o.target !== undefined) {
        if (!livingVictims(state).length) for (const pl of alive(state)) seats.add(pl.seat);
      } else if (o.op === 'attack' && swarm) {
        const v = swarmVictim(state, swarmRoute(state, board, pos));
        if (v) seats.add(v.seat);
      } else if (o.op === 'attack') {
        const t = closeTarget(state, board, pos, monster);
        if (t) seats.add(t.seat);
      } else if (o.op === 'trample') {
        for (const pl of trampled(state, board, monster, from, plan.steps)) seats.add(pl.seat);
      } else if (o.op === 'drag' || o.op === 'seize') {
        const t = closeTarget(state, board, pos, monster);
        if (t) seats.add(t.seat);
      } else if (o.op === 'trap' || o.op === 'consume') {
        for (const pl of inClose(state, board, pos)) seats.add(pl.seat);
      } else if (o.op === 'los') {
        for (const pl of inSight(state, board, pos)) seats.add(pl.seat);
      } else if (o.op === 'target') {
        const t = pickTarget(state, board, { ...monster, pos }, o.who);
        if (t) seats.add(t.seat);
      } else if (o.op === 'area') {
        for (const pl of areaTargets(state, board, pos, o, alive(state))) seats.add(pl.seat);
      } else if (o.op === 'global' || (o.op === 'ritual' && (monster.rituals ?? 0) + 1 >= o.at)) {
        for (const pl of alive(state)) seats.add(pl.seat);
      }
    }
    for (const seat of seats) if (!before.has(seat)) (types[seat] ??= []).push(type);
  }
  monster.dangerTypes = types; // seat -> damage types threatening them (P/M/S)
  return [...seats];
}

// Trample: who a charge along `steps` (cells) runs over: anyone standing on a
// space it passes through or ends on.
function trampled(state, board, monster, from, steps) {
  const cells = new Set(steps.filter((st) => typeof st !== 'object'));
  return targetable(state).filter((pl) => cells.has(pl.pos));
}

// Who an Area Attack from `pos` reaches: within its radius, or (inside) every
// player in the monster's building; outside any building, everyone indoors.
function areaTargets(state, board, pos, o, players) {
  if (o.building === 'nearLair') {
    // Everyone in the occupied building nearest the Lair.
    const lair = lairCell(state);
    const g = board.grid;
    const inside = players.filter((pl) => g.cells[pl.pos]?.area === 'indoor');
    if (!inside.length || lair < 0) return [];
    const near = inside.reduce((a, pl) => (gridDist(board, lair, pl.pos) < gridDist(board, lair, a.pos) ? pl : a));
    const b = buildingOf(g, near.pos);
    return inside.filter((pl) => buildingOf(g, pl.pos) === b);
  }
  if (!o.inside) return players.filter((pl) => gridDist(board, pos, pl.pos) <= o.radius && !(o.outdoor && board.grid.cells[pl.pos]?.area === 'indoor'));
  const g = board.grid;
  const indoor = (i) => g.cells[i]?.area === 'indoor';
  if (!indoor(pos)) return players.filter((pl) => indoor(pl.pos));
  const b = buildingOf(g, pos);
  return players.filter((pl) => indoor(pl.pos) && buildingOf(g, pl.pos) === b);
}

// Target (…): the player an action is aimed at, wherever they are.
//   nearestLair         the player nearest the Lair (Poltergeist's Heave)
//   leastInjuredInside  the least injured player inside the monster's building (White Lady's Wrath)
function pickTarget(state, board, monster, who) {
  // The Strigoi's Drain and Unholy Burn: whoever holds the Cosor, wherever they are.
  if (who === 'cosor') return chaseable(state).find((pl) => (pl.carry ?? []).some((c) => c.item === 'cosor')) ?? null;
  const players = prey(state, monster);
  if (who === 'leastInjuredInside') {
    const inside = areaTargets(state, board, monster.pos, { inside: true }, players);
    const tiers = (pl) => Object.values(pl.injuries ?? {}).reduce((a, b) => a + b, 0);
    return inside.sort((a, b) => tiers(a) - tiers(b) || a.seat - b.seat)[0] ?? null;
  }
  const from = who === 'nearestLair' ? lairCell(state) : monster.pos;
  if (from < 0) return null;
  return [...players].sort((a, b) => gridDist(board, from, a.pos) - gridDist(board, from, b.pos) || a.seat - b.seat)[0] ?? null;
}

// Infatuation: a free space inside the occupied building nearest the site
// numbered `near` (the Church {9}); -1 if no building has anyone inside.
function appearCell(state, board, near) {
  const g = board.grid;
  const site = mapSites(g)[siteByNumber(near)]?.[0];
  const inside = alive(state).filter((pl) => g.cells[pl.pos]?.area === 'indoor');
  if (!inside.length) return -1;
  const from = site ?? inside[0].pos;
  const pl = inside.reduce((a, p) => (gridDist(board, from, p.pos) < gridDist(board, from, a.pos) ? p : a));
  const b = buildingOf(g, pl.pos);
  const taken = new Set(state.players.map((p) => p.pos));
  let best = -1, bd = Infinity;
  g.cells.forEach((c, i) => {
    if (c.area !== 'indoor' || !c.walkable || taken.has(i) || buildingOf(g, i) !== b) return;
    const d = gridDist(board, pl.pos, i);
    if (d < bd) { bd = d; best = i; }
  });
  return best >= 0 ? best : pl.pos;
}

// The White Lady: if no one is inside her building, Wrath and Regret give way
// to Infatuation (whatever the die).
function fallbackIntent(state, board, monster, card, intent, ctx) {
  if (card.id !== 'white-lady' || intent.name === 'Infatuation' || intent.ability < 0) return intent;
  if (areaTargets(state, board, monster.pos, { inside: true }, targetable(state)).length && board.grid.cells[monster.pos]?.area === 'indoor') return intent;
  const a = card.abilities.find((x) => x.name === 'Infatuation');
  ctx.log(state, `No one is inside with the ${card.name}: ${intent.name} becomes Infatuation.`);
  return { ...intent, name: a.name, kind: a.kind, text: a.text, ...parseAbility(a.text) };
}

// An ability carried out at once, outside the monster's turn (a weakness
// track's "Trigger Regret"): its attacks only, from where the monster stands.
export function strikeNow(state, board, monster, name, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  const a = card?.abilities.find((x) => x.name === name);
  if (!a) return;
  const type = KIND_TO_TYPE[a.kind] ?? card.evidence.attack;
  const source = `The ${card.name}'s ${a.name}`;
  for (const o of parseAbility(a.text).ops) {
    if (o.op !== 'area' && o.op !== 'global') continue;
    const targets = o.op === 'global' ? targetable(state) : areaTargets(state, board, monster.pos, o, targetable(state));
    if (!targets.length) { ctx.log(state, `${source} strikes at no one.`); continue; }
    events.push({ type: 'monsterAttack', id: monster.id, seat: targets[0].seat, cell: monster.pos, area: true, attack: type });
    for (const pl of targets) applyDamage(state, board, pl, type, rollDamage({ ...ctx, state }, o.dmg), { log: ctx.log, source }, events);
  }
}

// Start of a round: roll the monster's action dice (the number in the top
// right of its card) and declare every action, in order.
export function declareIntent(state, board, monster, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  if (!card) return;
  const n = Math.max(0, (card.badge | 0) - (monster.diceLost ?? 0));
  monster.intents = Array.from({ length: n }, () => actionFor(card, rollDie(ctx), monster));
  // Enigmatic Hourglass (after midnight): the next declared action is cancelled.
  if (monster.cancelNext && monster.intents.length) { monster.cancelNext = false; const gone = monster.intents.shift(); ctx.log(state, `The Enigmatic Hourglass cancels the ${card.name}'s ${gone.name}.`); }
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
  const every = what === 'all' || what === 'allDefense';
  const gone = [];
  for (const key of takeFrom) {
    const list = pl[key] ?? [];
    if (!list.length) continue;
    if (every) { gone.push(...list.splice(0)); continue; }
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
// At midnight each {n} target on the card becomes a victim at that site's
// Objective marker ({1} the Hotel, {5} the Bar, {13} the Hospital: see
// src/core/sites.js); a map without them has the monster disabled.
// They come out as soon as the monster is known (all its evidence found, or
// named right for Initiative), or at midnight at the latest: the team gets to
// see whom to protect before the swarms come.
export function setupVictims(state, board, monster, ctx, events) {
  if (state.npcs?.length) return;                     // already out
  const card = MONSTER_BY_ID[monster.kind];
  const targets = [];
  for (const a of card?.abilities ?? []) {
    const t = /\{(\d+)\}/.exec(a.text);
    if (t && !targets.some((v) => v.target === Number(t[1]))) targets.push({ target: Number(t[1]), name: a.name });
  }
  if (!targets.length) return;
  // Fewer victims for a smaller team: one per investigator, up to all of them
  // (chosen at random). Swarms meant for a missing victim go after another.
  // Solo: all three, together in the Hospital.
  // Solo: all three, but together, inside the Hospital (the spaces nearest its marker).
  const sites = mapSites(board.grid);
  state.npcs = [];
  const hospital = sites.hospital?.[0];
  if (state.players.length === 1 && hospital !== undefined) {
    const g = board.grid;
    const room = buildingCells(g, hospital).filter((i) => g.cells[i].walkable)
      .sort((a, b) => gridDist(board, hospital, a) - gridDist(board, hospital, b) || a - b);
    targets.forEach((t, k) => state.npcs.push({ id: `v${t.target}`, target: t.target, name: t.name, cell: room[k] ?? hospital, alive: true }));
  } else {
    const keep = Math.min(targets.length, Math.max(1, state.players.length));
    while (targets.length > keep) targets.splice(ctx.randInt(state, targets.length), 1);
    for (const t of targets) {
      const cells = sites[siteByNumber(t.target)] ?? [];
      if (!cells.length) continue;
      state.npcs.push({ id: `v${t.target}`, target: t.target, name: t.name, cell: cells[ctx.randInt(state, cells.length)], alive: true });
    }
  }
  for (const v of state.npcs) ctx.log(state, `${v.name}: a townsperson at ${label(board, v.cell)} is in the ${card.name}'s sights.`);
  events.push({ type: 'npcs', npcs: state.npcs.map((v) => ({ ...v })) });
}
const livingVictims = (state) => (state.npcs ?? []).filter((v) => v.alive);

// The swarm strikes a victim. Players in Close range can defend them: the
// best defense left among them (attacks this turn wear it down, as for any
// attack) is compared with the damage; at least the damage saves them,
// otherwise the victim dies. Either way the defender's defense wears down by
// what it took. Returns the defender (if any).
// --- Swarms in flight (Adze) ---------------------------------------------------------
// A swarm leaves the Lair toward its victim and flies SWARM_SPEED spaces each
// monster turn (walls, windows and locked doors stop it; nothing else does).
// It settles right beside its victim and strikes on the Adze's next turn (if
// that victim is dead by then, it heads for the nearest living one). One swarm
// per victim at a time. Each swarm has SWARM_HP: Fire attacks wear it down
// (equipmentPlay.js) and at 0 it's alight: it flies back to the hive and, on
// arrival, burns the Nest for 3 piercing damage. The defender's Defense die is
// exhausted only when the strike gets through (a block costs nothing for good).
//   state.swarms = [{ id, victim, pos, dmg, type, exhaust, name, ready?, burning? }]
export const SWARM_SPEED = 6;
export const SWARM_BURN = 3;
export const SWARM_HP = 5;
export const SWARM_BLOCKED = 2;   // the Nest's loss each time a defender beats a swarm off        // Fire it takes to set it alight (any Fire attack counts)
function launchSwarm(state, board, monster, card, intent, o, ctx, events) {
  const victims = livingVictims(state);
  const hunted = new Set((state.swarms ?? []).filter((sw) => !sw.burning).map((sw) => sw.victim));
  // Its own victim if no swarm is after them already; else another one no swarm is after.
  const v = [victims.find((x) => x.target === o.target), ...victims].find((x) => x && !hunted.has(x.id));
  if (!v) return;                     // every victim already has a swarm coming: this one stays home
  const sw = {
    id: `s${(state.swarmCount = (state.swarmCount ?? 0) + 1)}`, victim: v.id, pos: monster.pos, dmg: o.dmg,
    type: KIND_TO_TYPE[intent.kind] ?? card.evidence.attack, exhaust: intent.ops.some((x) => x.op === 'exhaust'), name: intent.name,
  };
  (state.swarms ??= []).push(sw);
  ctx.log(state, `The ${card.name} sends a swarm after the ${v.name}.`);
  flySwarm(state, board, monster, card, sw, ctx, events);
}
// Move one swarm on (or, beside its victim since last turn, strike).
function flySwarm(state, board, monster, card, sw, ctx, events) {
  const drop = () => { state.swarms = state.swarms.filter((x) => x !== sw); events.push({ type: 'swarms' }); };
  if (sw.burning) {
    // Back to the hive, alight; there it burns the Nest.
    const route = swarmRouteTo(board, sw.pos, new Set([monster.pos])) ?? [sw.pos, monster.pos];
    const leg = route.slice(0, SWARM_SPEED + 1);
    sw.pos = leg[leg.length - 1];
    if (sw.pos !== monster.pos) { events.push({ type: 'swarms' }); return; }
    drop();
    ctx.log(state, `A burning swarm flies back into the hive.`);
    strikeMonster(state, board, monster, SWARM_BURN, null, ctx, events);
    return;
  }
  let v = (state.npcs ?? []).find((x) => x.id === sw.victim && x.alive);
  if (!v) {
    // Its victim is gone: the nearest living one no other swarm is after.
    const hunted = new Set(state.swarms.filter((x) => x !== sw && !x.burning).map((x) => x.victim));
    const open = livingVictims(state).filter((x) => !hunted.has(x.id));
    const route = swarmRouteTo(board, sw.pos, new Set(open.map((x) => x.cell)));
    v = route && open.find((x) => x.cell === route[route.length - 1]);
    if (!v) { drop(); ctx.log(state, `A swarm of the ${card.name}'s finds no one left to prey on and scatters.`); return; }
    sw.victim = v.id; sw.ready = false;
  }
  if (sw.ready && cellRange(board.grid, sw.pos, v.cell) <= 1) {
    // Settled beside its victim last turn: it strikes now.
    state.swarms = state.swarms.filter((x) => x !== sw);
    events.push({ type: 'monsterSwarm', id: monster.id, path: [sw.pos, v.cell], npc: v.id, attack: sw.type });
    const was = { alive: v.alive, wounded: !!v.wounded };
    const defender = attackVictim(state, board, monster, card, { kind: Object.keys(KIND_TO_TYPE).find((k) => KIND_TO_TYPE[k] === sw.type) }, { dmg: sw.dmg, victim: v }, ctx, events);
    const through = (was.alive && !v.alive) || (!was.wounded && v.wounded);
    if (defender && sw.exhaust && through) exhaust(state, defender, 'defense', ctx, events);
    return;
  }
  // Fly on, stopping right beside the victim. Walled in all round: it can't reach them.
  const route = swarmRouteTo(board, sw.pos, new Set([v.cell]));
  if (!route) { drop(); ctx.log(state, `A swarm can't find a way to the ${v.name} and scatters.`); return; }
  const leg = route.slice(0, Math.min(SWARM_SPEED, route.length - 2) + 1);
  sw.pos = leg[leg.length - 1];
  if (cellRange(board.grid, sw.pos, v.cell) <= 1) {
    sw.ready = true;
    ctx.log(state, `A swarm settles beside the ${v.name}: it strikes on the ${card.name}'s next turn.`);
  }
  events.push({ type: 'swarms' });
}
// The Adze's turn begins: swarms already out fly on, or strike.
function flyOn(state, board, monster, card, ctx, events) {
  for (const sw of [...(state.swarms ?? [])]) flySwarm(state, board, monster, card, sw, ctx, events);
}

function attackVictim(state, board, monster, card, intent, o, ctx, events) {
  const victims = livingVictims(state);
  let v = o.victim ?? victims.find((x) => x.target === o.target) ?? victims[0];
  const type = KIND_TO_TYPE[intent.kind] ?? card.evidence.attack;
  const dmg = rollDamage(ctx, o.dmg);
  const guards = alive(state).filter((pl) => cellRange(board.grid, pl.pos, v.cell) <= RANGE.close);
  const left = (pl) => Math.max(0, defenseValue(pl, type) - (pl.defenseUsed ?? 0));
  const best = guards.reduce((a, pl) => (!a || left(pl) > left(a) ? pl : a), null);
  const block = best ? left(best) : 0;
  if (best) best.defenseUsed = (best.defenseUsed ?? 0) + Math.min(block, dmg);
  if (best && block >= dmg) {
    ctx.log(state, `The ${card.name}'s swarm falls on the ${v.name} for ${dmg}: ${best.name} shields them (defense ${block}).`);
    events.push({ type: 'npcAttacked', npc: v.id, cell: v.cell, amount: dmg, defense: block, defender: best.seat, outcome: 'saved' });
    // A swarm beaten off is lost to the hive: the Nest takes SWARM_BLOCKED, through its toughness.
    if (card.actsBy === 'swarm' && state.monsters.includes(monster)) strikeMonster(state, board, monster, SWARM_BLOCKED, null, ctx, events);
    return best;
  }
  // Victims are hardy: the first hit that gets through wounds them; the second kills.
  if (!v.wounded) {
    v.wounded = true;
    ctx.log(state, `The ${card.name}'s swarm falls on the ${v.name} for ${dmg}${best ? ` (defense ${block} wasn't enough)` : ' and no one defends them'}. They're wounded: one more hit will kill them.`);
    events.push({ type: 'npcAttacked', npc: v.id, cell: v.cell, amount: dmg, defense: block, defender: best?.seat ?? null, outcome: 'wounded' });
    return best;
  }
  v.alive = false;
  const dead = (state.npcs ?? []).filter((x) => !x.alive).length;
  ctx.log(state, `The ${card.name}'s swarm falls on the wounded ${v.name} for ${dmg}${best ? ` (defense ${block} wasn't enough)` : ' and no one defends them'}. They die.`);
  events.push({ type: 'npcAttacked', npc: v.id, cell: v.cell, amount: dmg, defense: block, defender: best?.seat ?? null, outcome: 'killed' });
  // On a victim's death: a Global Attack of one die multiplied by the victims
  // dead so far (die × ☠), the same roll for everyone.
  const source = `The ${card.name} (a victim dies)`;
  const die = rollDie(ctx);
  ctx.log(state, `${source}: ${die} × ${dead} dead = ${die * dead} to everyone.`);
  for (const pl of alive(state)) applyDamage(state, board, pl, type, die * dead, { log: ctx.log, source }, events);
  return best;
}

// End of the round: carry out each declared action in order.
export function executeIntent(state, board, monster, ctx, events) {
  const card = MONSTER_BY_ID[monster.kind];
  if (!card || !monster.intents) return;
  const mods = monster.mods ?? {};
  // Equipment effects on the monster this turn (equipmentPlay.js).
  const roll = (dmg) => {
    let total = 0;
    for (let k = 0; k < (dmg?.dice ?? 0); k++) {
      let v = rollDie(ctx);
      if (mods.blind) v = 1;                       // Blind: its next attack rolls 1
      if (mods.capDie) v = Math.min(v, mods.capDie); // Powerful Flashlight
      total += v;
    }
    if (dmg?.dice && mods.blind) { mods.blind = false; ctx.log(state, `The ${card.name} is blinded: its attack rolls 1.`); }
    total += dmg?.fixed ?? 0;
    return mods.halve ? Math.floor(total / 2) : total;
  };
  // The Adze's first turn after it rises: its swarms gather; none set off yet.
  if (card.actsBy === 'swarm' && monster.gathering) {
    delete monster.gathering;
    ctx.log(state, `The ${card.name}'s swarms gather in the Lair. Next turn they set out for their victims.`);
    monster.intents = null; monster.danger = []; endMonsterTurn(monster);
    return;
  }
  if (card.actsBy === 'swarm') flyOn(state, board, monster, card, ctx, events);
  if (monster.stunned) {
    // Skinwalker, stunned at its Lair: it skips this turn (toughness 0 until it's over).
    delete monster.stunned;
    ctx.log(state, `The ${card.name} is stunned and does nothing this turn.`);
    monster.intents = null; monster.danger = []; endMonsterTurn(monster);
    return;
  }
  if (mods.interrupted) {
    ctx.log(state, `The ${card.name} is interrupted and does nothing this turn.`);
    monster.intents = null; monster.danger = []; endMonsterTurn(monster);
    return;
  }
  // Traps (Rusty Bear Trap, Summoning Circle...): immobilized for whole turns.
  if ((monster.immobileRounds ?? 0) > 0) { mods.immobile = true; monster.immobileRounds--; }
  if (mods.immobile) ctx.log(state, `The ${card.name} is held in place this turn.`);
  // Hellhounds' Demonic Fire: their attacks ignore the lowest defense die.
  const demonic = card.abilities.some((a) => a.name === 'Demonic Fire');
  for (const [at, declared] of monster.intents.entries()) {
    if (!alive(state).length) break;
    // White Lady: with no one inside her building, Wrath and Regret become Infatuation.
    const intent = fallbackIntent(state, board, monster, card, declared, ctx);
    const type = KIND_TO_TYPE[intent.kind] ?? card.evidence.attack;
    const source = `The ${card.name}'s ${intent.name}`;
    const opts = { log: ctx.log, source, ignoreLowest: demonic };
    // Move first (less if Bound, not at all if immobilized).
    const startPos = monster.pos;
    const move = planMovement(state, board, monster, intent.ops, ctx);
    if (mods.moveDown) {
      // Bind / Gaffe: this turn's movement is reduced by the total.
      const walk = move.steps.filter((st) => typeof st !== 'object').length;
      const allowed = Math.max(0, walk - (mods.moveDownLeft ?? mods.moveDown));
      mods.moveDownLeft = Math.max(0, (mods.moveDownLeft ?? mods.moveDown) - walk);
      let w = 0;
      move.steps = move.steps.filter((st) => (typeof st === 'object' ? true : ++w <= allowed));
    }
    if (mods.immobile) move.steps = [];
    let cut = 0;
    for (const st of move.steps) {
      monster.perched = false;               // any move brings her down off the roof
      if (typeof st === 'object') {
        events.push({ type: 'monsterTeleport', id: monster.id, from: monster.pos, to: st.teleport });
        monster.pos = st.teleport;
        continue;
      }
      if (cut > 0) { cut--; continue; }
      if (bodyOf(monster.kind) !== 'incorporeal' && monsterDoorBanned(state, board, monster.pos, st)) { ctx.log(state, `The ${card.name} finds the door boarded up.`); break; }
      events.push({ type: 'monsterStep', id: monster.id, from: monster.pos, to: st });
      monster.prev = monster.pos;
      monster.pos = st;
      // Traps and Hazards on the way.
      const trap = monsterEnters(state, board, monster, st, ctx, events,
        (dice, kind) => hurtMonster(state, board, monster, dice, kind, () => rollDie(ctx), ctx, events));
      if (!state.monsters.includes(monster)) return; // destroyed (or the night is won)
      if (trap.stop) break;
      cut += trap.cut;
    }
    if (move.steps.length) ctx.log(state, `The ${card.name} moves to ${label(board, monster.pos)}.`);
    // Police Patrol's sirens pull one move; Distract holds for the whole turn.
    if (monster.lure && monster.lure.round === undefined && move.steps.length) { delete monster.lure; }
    if (monster.mods?.interrupted) { ctx.log(state, `The ${card.name} is interrupted.`); break; }
    // Then the rest in card order; `hit` = who the action is aimed at (for
    // Exhaust); `aim` = the player a Target picked (attacks go to them).
    let hit = [];
    let aim = null;
    let attacked = false;   // after an attack, Exhaust / Pull fall on `hit` alone (even no one)
    let bashed = false;
    for (const o of intent.ops) {
      if (o.op === 'attack' && o.target !== undefined && card.actsBy === 'swarm' && livingVictims(state).length) {
        // A swarm sets off; its Exhaust lands with it, on whoever defends.
        launchSwarm(state, board, monster, card, intent, o, ctx, events);
        hit = []; attacked = true;
        continue;
      }
      if (o.op === 'attack' && o.target !== undefined && card.actsBy === 'swarm') {
        // No victims left: its attacks are Global.
        ctx.log(state, `${source}: with no victims left, the swarms fall on everyone.`);
        events.push({ type: 'monsterAttack', id: monster.id, seat: alive(state)[0].seat, cell: monster.pos, area: true, attack: type });
        hit = alive(state);
        for (const pl of hit) applyDamage(state, board, pl, type, roll(o.dmg), opts, events);
        continue;
      }
      if (o.op === 'attack' && card.actsBy === 'swarm') {
        const path = swarmRoute(state, board, monster.pos);
        const v = swarmVictim(state, path);
        if (!v) { ctx.log(state, `${source}: the swarm finds no one.`); continue; }
        events.push({ type: 'monsterSwarm', id: monster.id, seat: v.seat, path, attack: type });
        hit = [v];
        applyDamage(state, board, v, type, roll(o.dmg), { log: ctx.log, source: `${source} (fly swarm)` }, events);
        continue;
      }
      if (o.op === 'exhaust') {
        const targets = hit.length || attacked ? hit : [closeTarget(state, board, monster.pos, monster)].filter(Boolean);
        for (const pl of targets) struck(state, monster, 'exhaust', pl, ctx, () => exhaust(state, pl, o.what, ctx, events));
        hit = targets;
        continue;
      }
      if (o.op === 'target') {
        // Target: who the rest of the action is aimed at, wherever they are.
        aim = pickTarget(state, board, monster, o.who);
        if (aim) { hit = [aim]; ctx.log(state, `${source} singles out ${aim.name}${o.who === 'cosor' ? ', who holds the Cosor' : ''}.`); }
        else if (o.who !== 'cosor') ctx.log(state, `${source} finds no one to single out.`);   // no Cosor holder: it strikes up close
        continue;
      }
      if (o.op === 'trap') {
        // Shadow Trap: sprung at once where it lands, on everyone in Close range;
        // gone before the players act again.
        const caught = inClose(state, board, monster.pos).filter((pl) => targetable(state).includes(pl));
        if (!caught.length) { ctx.log(state, `${source}: the trap closes on no one.`); continue; }
        attacked = true;
        hit = caught;
        events.push({ type: 'monsterAttack', id: monster.id, seat: caught[0].seat, cell: monster.pos, area: true, attack: type });
        for (const pl of caught) struck(state, monster, intent.name, pl, ctx, () => applyDamage(state, board, pl, type, roll(o.dmg), opts, events));
        continue;
      }
      if (o.op === 'drag' || o.op === 'seize') {
        // Bear Maul / Abduct: an attack; if it lands, they're dragged into the
        // nearest building, or Seized.
        const t = aim ?? closeTarget(state, board, monster.pos, monster);
        if (!t) continue;                       // no one in reach (a door in the way: it bashes, below)
        attacked = true;
        hit = [t];
        events.push({ type: 'monsterAttack', id: monster.id, seat: t.seat, cell: t.pos, attack: type });
        let out = null;
        struck(state, monster, intent.name, t, ctx, () => { out = applyDamage(state, board, t, type, roll(o.dmg), opts, events); });
        if (out !== 'injured' || t.dead || t.dying) continue;
        if (o.op === 'drag') drag(state, board, t, o.n, ctx, events);
        else if (monster.carrying === null || monster.carrying === undefined) {
          monster.carrying = t.seat;
          t.seized = monster.id;
          ctx.log(state, `${source}: ${t.name} is Seized, at Death's Door while it holds them. Damage through its defense breaks them free.`);
          events.push({ type: 'seized', seat: t.seat, id: monster.id });
        }
        continue;
      }
      if (o.op === 'lure') {
        // Feed: everyone within the radius is pulled the same die of spaces toward it.
        const caught = targetable(state).filter((pl) => gridDist(board, monster.pos, pl.pos) <= o.radius);
        if (!caught.length) continue;
        const n = roll(o.dmg);
        ctx.log(state, `${source}: a lure of ${n}.`);
        for (const pl of caught) pull(state, board, pl, monster, n, ctx, events);
        continue;
      }
      if (o.op === 'consume') {
        // Feed: everyone now in Close range; it heals all the damage that got through.
        const caught = inClose(state, board, monster.pos).filter((pl) => targetable(state).includes(pl));
        if (!caught.length) { ctx.log(state, `${source}: no one close enough to consume.`); continue; }
        attacked = true;
        hit = caught;
        let fed = 0;
        events.push({ type: 'monsterAttack', id: monster.id, seat: caught[0].seat, cell: monster.pos, area: true, attack: type });
        for (const pl of caught) {
          const amount = roll(o.dmg);
          let out = null;
          struck(state, monster, intent.name, pl, ctx, () => { out = applyDamage(state, board, pl, type, amount, opts, events); });
          if (out && out !== 'blocked' && out !== 'dead') fed += amount;
        }
        if (fed) {
          healMonster(state, monster, card, fed, ctx, events);
          if (monster.disabled?.Regeneration === true) { delete monster.disabled.Regeneration; ctx.log(state, `The ${card.name} has fed: its Regeneration returns.`); }
        }
        continue;
      }
      if (o.op === 'los') {
        const seen = inSight(state, board, monster.pos);
        if (!seen.length) continue;
        attacked = true;
        hit = seen;
        events.push({ type: 'monsterAttack', id: monster.id, seat: seen[0].seat, cell: monster.pos, area: true, attack: type });
        for (const pl of seen) struck(state, monster, intent.name, pl, ctx, () => applyDamage(state, board, pl, type, roll(o.dmg), opts, events));
        continue;
      }
      if (o.op === 'trample') {
        // Run Down: everyone it charged through, and the one it charged at.
        const victims = trampled(state, board, monster, startPos, move.steps);
        if (!victims.length) continue;        // no one: stuck at a door, it bashes (below)
        attacked = true;
        hit = victims;
        for (const pl of victims) {
          events.push({ type: 'monsterAttack', id: monster.id, seat: pl.seat, cell: pl.pos, attack: type });
          struck(state, monster, intent.name, pl, ctx, () => applyDamage(state, board, pl, type, roll(o.dmg), opts, events));
        }
        ctx.log(state, `${source} tramples ${victims.map((p) => p.name).join(', ')}.`);
        continue;
      }
      if (o.op === 'pull') {
        // Pull (n): everyone just hurt is dragged up to n spaces toward the monster.
        for (const pl of hit) if (!pl.dead && !pl.dying) pull(state, board, pl, monster, o.n, ctx, events);
        continue;
      }
      if (o.op === 'pin') {
        // Pin (n): an attack of n; if it gets through, the player can't move on their next turn.
        const t = aim ?? closeTarget(state, board, monster.pos, monster);
        if (!t) { ctx.log(state, `${source} finds no one to pin.`); continue; }
        hit = [t];
        events.push({ type: 'monsterAttack', id: monster.id, seat: t.seat, cell: t.pos, attack: type });
        let out = null;
        struck(state, monster, intent.name, t, ctx, () => { out = applyDamage(state, board, t, type, roll(o.dmg), opts, events); });
        if (out === 'injured' && !t.dead) { t.pinned = true; ctx.log(state, `${t.name} is pinned: no moving on their next turn.`); events.push({ type: 'pinned', seat: t.seat }); }
        continue;
      }
      if (o.op === 'drop') {
        // Drop (Cosor): the holder loses it on their space; anyone can pick it up there.
        // Unholy Burn: they can't move or pick it back up on their next turn.
        const holder = state.players.find((p) => (p.carry ?? []).some((c) => c.item === o.item));
        if (!holder) continue;
        const k = holder.carry.findIndex((c) => c.item === o.item);
        const [thing] = holder.carry.splice(k, 1);
        const burnt = !holder.dead && !holder.dying;
        (state.objective ??= { delivered: {} }).dropped = [...(state.objective.dropped ?? []),
          { ...thing, cell: holder.pos, ...(burnt ? { banned: holder.seat, until: state.round + 1 } : {}) }];
        if (burnt) holder.pinned = true;
        const name = o.item[0].toUpperCase() + o.item.slice(1);
        ctx.log(state, `${source}: ${holder.name} drops the ${name} at ${label(board, holder.pos)}${burnt ? `, and can't move or pick it up on their next turn` : ''}.`);
        events.push({ type: 'objStep', seat: holder.seat, cell: holder.pos, text: `${name} dropped` });
        continue;
      }
      if (o.op === 'appear') {
        // Infatuation: she appears inside the occupied building nearest the site {near}.
        const cell = appearCell(state, board, o.near);
        if (cell < 0) { ctx.log(state, `${source}: no building has anyone inside.`); continue; }
        events.push({ type: 'monsterTeleport', id: monster.id, from: monster.pos, to: cell });
        monster.pos = cell;
        ctx.log(state, `${source}: she appears inside at ${label(board, cell)}.`);
        continue;
      }
      if (o.op === 'block' || o.op === 'unblock') {
        // Block / Unblock (all doors) of the building she is in.
        if (o.op === 'block') {
          const doors = buildingDoors(board, monster.pos).filter((k) => blockDoor(state, k));
          monster.blockedDoors = [...new Set([...(monster.blockedDoors ?? []), ...doors])];
          if (doors.length) { ctx.log(state, `${source}: every door of the building slams shut.`); for (const k of doors) events.push({ type: 'doors', edge: k, change: 'block' }); }
        } else {
          const doors = (monster.blockedDoors ?? []).filter((k) => state.doors?.[k] === 'blocked');
          for (const k of doors) { delete state.doors[k]; events.push({ type: 'doors', edge: k, change: 'unblock' }); }
          monster.blockedDoors = [];
          if (doors.length) ctx.log(state, `${source}: the doors she shut swing open.`);
        }
        continue;
      }
      if (o.op === 'attack') {
        const t = aim ?? closeTarget(state, board, monster.pos, monster);
        if (!t && bash(state, board, monster, card, monster.intents.slice(at + 1), roll, ctx, events)) { bashed = true; continue; }
        if (!t) { ctx.log(state, `${source} finds no one in reach.`); continue; }
        hit = [t];
        attacked = true;
        events.push({ type: 'monsterAttack', id: monster.id, seat: t.seat, cell: t.pos, attack: type, ranged: aim === t && cellRange(board.grid, monster.pos, t.pos) > RANGE.close });
        struck(state, monster, intent.name, t, ctx, () => applyDamage(state, board, t, type, roll(o.dmg), opts, events));
      } else if (o.op === 'area' || o.op === 'global') {
        const targets = o.op === 'global' ? targetable(state) : areaTargets(state, board, monster.pos, o, targetable(state));
        if (!targets.length && bash(state, board, monster, card, monster.intents.slice(at + 1), roll, ctx, events)) { bashed = true; continue; }
        if (!targets.length) { ctx.log(state, `${source} strikes at nothing.`); continue; }
        attacked = true;
        events.push({ type: 'monsterAttack', id: monster.id, seat: targets[0].seat, cell: monster.pos, area: true, attack: type });
        // What follows (Pull, Exhaust) falls on those it hurt: not the ones whose defense held.
        hit = [];
        for (const pl of targets) {
          let out = null;
          struck(state, monster, intent.name, pl, ctx, () => { out = applyDamage(state, board, pl, type, roll(o.dmg), opts, events); });
          if (out && out !== 'blocked' && out !== 'dead') hit.push(pl);
        }
      } else if (o.op === 'heal') {
        healMonster(state, monster, card, o.n, ctx, events);
      } else if (o.op === 'ritual') {
        // Curseblood Ritual: one more; at the mark, a Global Attack, and the count starts over.
        monster.rituals = (monster.rituals ?? 0) + 1;
        if (monster.rituals < o.at) { ctx.log(state, `${source}: ritual ${monster.rituals} of ${o.at}.`); continue; }
        monster.rituals = 0;
        const targets = targetable(state);
        ctx.log(state, `${source}: the ${o.at}${o.at === 3 ? 'rd' : 'th'} ritual is complete. The curse falls on everyone.`);
        if (!targets.length) continue;
        hit = targets;
        events.push({ type: 'monsterAttack', id: monster.id, seat: targets[0].seat, cell: monster.pos, area: true, attack: type });
        for (const pl of targets) applyDamage(state, board, pl, type, roll(o.dmg), opts, events);
      }
    }
    // An action that came for someone (it moved toward them, or does something
    // to them the game doesn't play yet: Seize, Trample, Drag...) but reached
    // no one and is stuck at a door: it bashes the door instead.
    if (!attacked && !bashed && !hit.length && (intent.ops.some((o) => o.op === 'pursue') || intent.unknown.length)) {
      bash(state, board, monster, card, monster.intents.slice(at + 1), roll, ctx, events);
    }
    if (intent.unknown.length) ctx.log(state, `(${intent.name}: ${intent.unknown.join(', ')} not played yet.)`);
  }
  if (state.monsters.includes(monster)) endOfTurn(state, board, monster, card, ctx, events, roll);
  monster.intents = null;
  monster.danger = [];
  if (monster.lure?.round !== undefined) delete monster.lure;   // Distract is over
  endMonsterTurn(monster);
}

// Constant effects that fire when a player steps onto a cell, e.g. the
// Shadow People's Umbral Stab (attack any player entering a lit space).
export function onPlayerEnters(state, board, pl, cell, ctx, events) {
  for (const monster of state.monsters) {
    const card = MONSTER_BY_ID[monster.kind];
    // Skinwalker: the first investigator to reach its Lair stuns it, once a game:
    // it skips its next turn, and its toughness is 0 until then.
    if (card?.id === 'skinwalker' && !monster.stunUsed && cell === lairCell(state) && !pl.dead) {
      monster.stunUsed = true;
      monster.stunned = true;
      (monster.mods ??= {}).toughZero = true;
      ctx.log(state, `${pl.name} reaches the ${card.name}'s Lair: it is stunned. It skips its next turn, and its toughness is 0 until then.`);
      events.push({ type: 'objStep', seat: pl.seat, cell, text: `The ${card.name} is stunned` });
    }
    const rule = card?.onEnterLit;
    if (!rule || pl.dead || pl.dying) continue;
    if ((board.light[cell] ?? 0) < state.config.litThreshold) continue;
    // Discard Crystal & no light for ⌛: lit spaces are safe for a round.
    if (state.flags?.noLight) { ctx.log(state, `${pl.name} steps into the light, but the ${card.name} can't reach them there for now.`); continue; }
    const ability = card.abilities.find((a) => a.roll === 'Persistent' && KIND_TO_TYPE[a.kind]);
    const type = KIND_TO_TYPE[rule.kind] ?? card.evidence.attack;
    events.push({ type: 'monsterAttack', id: monster.id, seat: pl.seat, cell, grab: true, attack: type });
    struck(state, monster, ability?.name, pl, ctx, () => applyDamage(state, board, pl, type, rollDamage(ctx, damageSpec(rule.dmg)), { log: ctx.log, source: `The ${card.name}'s ${ability?.name ?? 'attack'}` }, events));
  }
}

// A hit on a player that a weakness discard can undo at the moment
// (reactions.js): by the ability's name (Swoop), or any attack ('attack');
// Exhaust passes 'exhaust'.
function struck(state, monster, what, pl, ctx, hit) {
  const snap = watch(state, pl);
  hit();
  if (!offer(state, monster, what, snap, ctx) && what !== 'exhaust') offer(state, monster, 'attack', snap, ctx);
}

export { describeDamage };

// Heal a monster with health (Lick Wounds, Regeneration, Consume).
function healMonster(state, monster, card, n, ctx, events) {
  if (monster.hp === null || monster.hp === undefined || n <= 0) return;
  const before = monster.hp;
  monster.hp = Math.min(monster.maxHp ?? monster.hp + n, monster.hp + n);
  if (monster.hp === before) return;
  ctx.log(state, `The ${card.name} heals ${monster.hp - before} (${monster.hp}/${monster.maxHp}).`);
  events.push({ type: 'monsterHeal', id: monster.id, amount: monster.hp - before, hp: monster.hp });
}

// Line of sight (Barghest's Death Gaze): a straight line between the two
// spaces that no wall, door or blocked space (a building, the forest) cuts.
// Windows and water don't block it.
function seeThrough(g, a, b, target) {
  const t = g.edgeAt(edgeBetween(g, a, b));
  if (t && t !== 'window') return false;
  const c = g.cells[b];
  return b === target || c.walkable || c.area === 'water';
}
function lineOfSight(board, a, b) {
  const g = board.grid;
  const A = g.coords(a), B = g.coords(b);
  const n = Math.max(Math.abs(B.x - A.x), Math.abs(B.y - A.y)) * 4;
  let cur = a;
  for (let k = 1; k <= n; k++) {
    const x = Math.floor(A.x + 0.5 + ((B.x - A.x) * k) / n), y = Math.floor(A.y + 0.5 + ((B.y - A.y) * k) / n);
    const c = g.index(x, y);
    if (c === cur) continue;
    const p = g.coords(cur);
    const dx = x - p.x, dy = y - p.y;
    if (dx && dy) {
      // A diagonal step: clear if either way round the corner is clear.
      const m1 = g.index(p.x + dx, p.y), m2 = g.index(p.x, p.y + dy);
      const ok = (seeThrough(g, cur, m1, b) && seeThrough(g, m1, c, b)) || (seeThrough(g, cur, m2, b) && seeThrough(g, m2, c, b));
      if (!ok) return false;
    } else if (!seeThrough(g, cur, c, b)) return false;
    cur = c;
  }
  return true;
}
const inSight = (state, board, from) => targetable(state).filter((pl) => pl.pos === from || lineOfSight(board, from, pl.pos));

// Drag (Bear Maul): up to n spaces along their walk to the nearest building's floor.
function drag(state, board, pl, n, ctx, events) {
  const g = board.grid;
  if (g.cells[pl.pos]?.area === 'indoor') return;            // already inside
  const { x, y } = g.coords(pl.pos);
  const field = g.moveField(x, y, { keys: false });
  let best = -1;
  g.cells.forEach((c, i) => { if (c.area === 'indoor' && c.walkable && field.dist[i] > 0 && (best < 0 || field.dist[i] < field.dist[best])) best = i; });
  if (best < 0) return;
  const steps = field.path(best).slice(1, 1 + n);
  for (const to of steps) { events.push({ type: 'step', seat: pl.seat, from: pl.pos, to, pulled: true }); pl.pos = to; }
  if (steps.length) ctx.log(state, `${pl.name} is dragged ${steps.length} space${steps.length === 1 ? '' : 's'}, to ${label(board, pl.pos)}${g.cells[pl.pos].area === 'indoor' ? ', inside' : ''}.`);
}

// Rooftops (Banshee's Perch): any real building: a building's floor, or a
// premade building (the diner, the motel, the farmhouse...), not fences,
// wrecks, groves, towers or yards.
const ROOFED = new Set(['videoStore', 'diner', 'gasStation', 'laundromat', 'arcade', 'motel', 'lumberMill', 'lookout', 'grange',
  'rectory', 'burnedHouse', 'farm', 'trailerPark', 'clocktower']);
export const isRooftop = (cell) => !!cell && (cell.area === 'indoor' || ROOFED.has(cell.sub));
// Where the heirloom is: carried (its carrier's space), set down, or still at
// the Funeral Parlor. -1 if this map has none.
function heirloomCell(state, board) {
  const holder = alive(state).find((pl) => (pl.carry ?? []).some((c) => c.item === 'heirloom'));
  if (holder) return holder.pos;
  const down = (state.objective?.dropped ?? []).find((d) => d.item === 'heirloom');
  if (down) return down.cell;
  if (state.objective?.taken?.heirloom) return -1;
  return mapSites(board.grid).funeral?.[0] ?? -1;
}
// Perch: to the rooftop nearest the player closest to the heirloom (or, with
// no heirloom on the map, the player nearest her).
function perch(state, board, monster, card, ctx, events) {
  const g = board.grid;
  const players = targetable(state);
  if (!players.length) return;
  const h = heirloomCell(state, board);
  const from = h >= 0 ? h : monster.pos;
  const who = [...players].sort((a, b) => gridDist(board, from, a.pos) - gridDist(board, from, b.pos) || a.seat - b.seat)[0];
  let best = -1, bd = Infinity;
  g.cells.forEach((c, i) => {
    if (!isRooftop(c)) return;
    const d = gridDist(board, who.pos, i) * 1000 + gridDist(board, monster.pos, i);
    if (d < bd) { bd = d; best = i; }
  });
  if (best < 0) return;
  if (best !== monster.pos) events.push({ type: 'monsterTeleport', id: monster.id, from: monster.pos, to: best });
  monster.pos = best;
  monster.perched = true;
  ctx.log(state, `The ${card.name} perches on a rooftop at ${label(board, best)}, near ${who.name}${h >= 0 ? ', closest to the heirloom' : ''}.`);
}

// End of the monster's turn: its constant rules that act then.
//   Death Gaze (Barghest): an attack of 10 on everyone it can see.
//   Perch (Banshee): back up to a rooftop (out of Close range there).
//   Regeneration (Wendigo): it heals 4.
//   Ushi-Oni: moves 10 toward its Lair, through walls (salt stops it),
//     carrying whoever it has Seized; brought into the Lair, they die.
function endOfTurn(state, board, monster, card, ctx, events, roll) {
  const off = (name) => !!monster.disabled?.[name];
  const gaze = card.abilities.find((a) => a.name === 'Death Gaze');
  if (gaze && !off(gaze.name) && alive(state).length) {
    const o = parseAbility(gaze.text).ops.find((x) => x.op === 'los');
    const seen = inSight(state, board, monster.pos);
    const type = KIND_TO_TYPE[gaze.kind] ?? card.evidence.attack;
    if (o && seen.length) {
      events.push({ type: 'monsterAttack', id: monster.id, seat: seen[0].seat, cell: monster.pos, area: true, attack: type });
      for (const pl of seen) struck(state, monster, gaze.name, pl, ctx, () => applyDamage(state, board, pl, type, roll(o.dmg), { log: ctx.log, source: `The ${card.name}'s ${gaze.name}` }, events));
    }
  }
  const perchAb = card.abilities.find((a) => a.name === 'Perch');
  if (perchAb && !off(perchAb.name) && !monster.mods?.immobile) perch(state, board, monster, card, ctx, events);
  const regen = card.abilities.find((a) => a.name === 'Regeneration');
  if (regen && !off(regen.name)) {
    const o = parseAbility(regen.text).ops.find((x) => x.op === 'heal');
    if (o) healMonster(state, monster, card, o.n, ctx, events);
  }
  if (card.id === 'ushi-oni' && !monster.mods?.immobile) {
    const lair = lairCell(state);
    if (lair >= 0 && monster.pos !== lair) {
      const route = phaseField(board.grid, monster.pos, new Set(saltedCells(state))).path(lair) ?? [];
      const carried = monster.carrying !== null && monster.carrying !== undefined ? state.players[monster.carrying] : null;
      for (const to of route.slice(1, 11)) {
        events.push({ type: 'monsterStep', id: monster.id, from: monster.pos, to });
        monster.prev = monster.pos; monster.pos = to;
        if (carried) { events.push({ type: 'step', seat: carried.seat, from: carried.pos, to, pulled: true }); carried.pos = to; }
      }
      if (route.length > 1) ctx.log(state, `The ${card.name} heads for its Lair${carried ? `, carrying ${carried.name}` : ''}: ${label(board, monster.pos)}.`);
    }
    // End of the round, at the Lair: the one it carries dies.
    const held = monster.carrying !== null && monster.carrying !== undefined ? state.players[monster.carrying] : null;
    if (held && monster.pos === lair && !held.dead) {
      monster.carrying = null;
      delete held.seized;
      killPlayer(state, held, { log: ctx.log, text: `The ${card.name} carries ${held.name} into its Lair` });
      events.push({ type: 'objStep', seat: held.seat, cell: held.pos, text: `${held.name} is taken` });
    }
  }
}

// Pull (n): `pl` is dragged up to n spaces along their walking route toward
// the monster, stopping beside it (Charm). The view walks them there.
function pull(state, board, pl, monster, n, ctx, events) {
  const { x, y } = board.grid.coords(pl.pos);
  const field = board.grid.moveField(x, y, { keys: false });
  // To the monster's space, or (if no one can stand there) the nearest space beside it.
  let route = field.path(monster.pos);
  if (route) route = route.slice(0, -1);
  else {
    const { x: mx, y: my } = board.grid.coords(monster.pos);
    route = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => board.grid.inBounds(mx + dx, my + dy))
      .map(([dx, dy]) => field.path(board.grid.index(mx + dx, my + dy))).filter(Boolean).sort((a, b) => a.length - b.length)[0] ?? null;
  }
  if (!route || route.length < 2) return;             // unreachable, or already beside it
  const steps = route.slice(1).slice(0, n);
  for (const to of steps) { events.push({ type: 'step', seat: pl.seat, from: pl.pos, to, pulled: true }); pl.pos = to; }
  ctx.log(state, `${pl.name} is pulled ${steps.length} space${steps.length === 1 ? '' : 's'} toward the ${MONSTER_BY_ID[monster.kind].name}, to ${label(board, pl.pos)}.`);
}

// A queued attack with no one in reach becomes a Bash on the door in the
// monster's way (Corporeal and Semi-Corporeal). Returns true if it bashed.
function bash(state, board, monster, card, later, roll, ctx, events) {
  const body = bodyOf(monster.kind);
  if (body === 'incorporeal') return false;
  const k = doorInPath(state, board, monster);
  if (!k) return false;
  if (body === 'semi' && later.some((i) => i.ops.some((o) => o.op === 'teleport'))) {
    ctx.log(state, `The ${card.name} leaves the door alone: it is about to vanish elsewhere.`);
    return true;
  }
  state.doorHp ??= {};
  const before = state.doorHp[k] ?? DOOR_HP;
  const dmg = roll({ dice: 1 });
  const left = Math.max(0, before - dmg);
  events.push({ type: 'doorBash', id: monster.id, edge: k, amount: dmg, hp: left });
  if (left > 0) {
    state.doorHp[k] = left;
    ctx.log(state, `The ${card.name} bashes at the door for ${dmg}: it holds (${left} left).`);
    return true;
  }
  delete state.doorHp[k];
  (state.doors ??= {})[k] = 'breached';
  ctx.log(state, `The ${card.name} bashes the door in (${dmg}): an open doorway now.`);
  events.push({ type: 'doors', edge: k, change: 'breach' });
  return true;
}
