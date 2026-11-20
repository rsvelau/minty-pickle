// Monsters: the framework for adding them.
//
// A monster is plain data in game state:
//   { id, kind, pos, prev, revealed }
// and a definition in MONSTERS (below) giving its rules:
//   label, note        shown in Game settings
//   speed              cells it may move per monster turn
//   spawn(ctx)         -> cell index where it appears at midnight
//   act(ctx, monster)  -> a plan: { path: [cells...], attack: seat | null, say?: text }
//                         path = the cells it walks through, in order (each
//                         must be one legal step from the last; the rules
//                         check and stop at the first bad one). attack = the
//                         seat of a player in its cell or next to it.
//   onAttack(ctx, monster, player)  optional: what an attack does (wounds,
//                         dropped items...). Without it an attack is logged
//                         and animated only.
//   look               which 3D model the view uses (see play.js monsterLooks)
//
// Monsters act once at the end of every turn (after the last player moves)
// from midnight on. Everything is decided here, in the rules, using the
// game's seeded random numbers (ctx.random), so a server can run monsters
// for everyone. The view only animates the events:
//   { type: 'monsterSpawn', id, kind, cell }
//   { type: 'monsterStep',  id, from, to }
//   { type: 'monsterAttack', id, seat, cell }
//
// Helpers for writing AI are exported below: distances and paths over the
// board's movement rules, the nearest player, light levels.
import { cellLabel } from '../state.js';

// --- AI helpers ---------------------------------------------------------------

// Breadth-first distances from a cell over legal steps (walls, windows and
// locked doors block; monsters don't carry keys). Returns { dist, path(i) }.
export function reach(board, from) {
  const { x, y } = board.grid.coords(from);
  return board.grid.moveField(x, y, { keys: false });
}

// The nearest player by walking distance: { player, dist, path } or null.
export function nearestPlayer(ctx, from) {
  const field = reach(ctx.board, from);
  let best = null;
  for (const pl of ctx.state.players) {
    const d = field.dist[pl.pos];
    if (d < 0) continue;
    if (!best || d < best.dist || (d === best.dist && ctx.random() < 0.5)) best = { player: pl, dist: d, path: field.path(pl.pos) };
  }
  return best;
}

// Players in a cell or orthogonally next to it (and reachable in one step).
export function playersInReach(ctx, cell) {
  const field = reach(ctx.board, cell);
  return ctx.state.players.filter((pl) => pl.pos === cell || field.dist[pl.pos] === 1);
}

export const lightAt = (ctx, cell) => ctx.board.light[cell] ?? 0;

// A walkable cell as far as possible (by walking) from every player.
export function farthestFromPlayers(ctx) {
  const n = ctx.board.grid.cells.length;
  const minDist = new Int32Array(n).fill(1 << 30);
  for (const pl of ctx.state.players) {
    const f = reach(ctx.board, pl.pos);
    for (let i = 0; i < n; i++) if (f.dist[i] >= 0) minDist[i] = Math.min(minDist[i], f.dist[i]);
  }
  let best = -1, bestD = -1;
  for (let i = 0; i < n; i++) {
    if (minDist[i] === 1 << 30) continue;
    if (minDist[i] > bestD || (minDist[i] === bestD && ctx.random() < 0.3)) { best = i; bestD = minDist[i]; }
  }
  return best;
}

// --- monster definitions --------------------------------------------------------

export const MONSTERS = {
  // A test monster to exercise the framework: it appears as far from the
  // players as it can, stalks the nearest one through the dark, won't step
  // into a well-lit cell, and lunges at anyone it reaches.
  stalker: {
    label: 'Test stalker',
    note: 'Framework test: hunts the nearest player through the dark and lunges when it reaches them.',
    speed: 3,
    look: 'shade',
    spawn: (ctx) => farthestFromPlayers(ctx),
    act(ctx, monster) {
      const target = nearestPlayer(ctx, monster.pos);
      if (!target) return { path: [], attack: null };
      const path = [];
      // path(target) starts at the monster's own cell.
      for (const cell of target.path.slice(1, 1 + this.speed)) {
        if (cell === target.player.pos) break;          // stop next to them
        if (lightAt(ctx, cell) >= 0.5) break;           // afraid of the light
        path.push(cell);
      }
      const end = path.length ? path[path.length - 1] : monster.pos;
      const victims = playersInReach(ctx, end);
      return { path, attack: victims.length ? victims[Math.floor(ctx.random() * victims.length)].seat : null };
    },
  },
};

// --- called by the rules -----------------------------------------------------------

function context(state, board, random) {
  return { state, board, random: () => random(state) };
}
const label = (board, i) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };

// Bring in the configured monster at midnight (once).
export function spawnMonsters(state, board, events, random, log) {
  const def = MONSTERS[state.config.monster];
  if (!def || state.monsters.length) return;
  const ctx = context(state, board, random);
  const cell = def.spawn(ctx);
  if (cell < 0) return;
  const monster = { id: `m${state.monsters.length + 1}`, kind: state.config.monster, pos: cell, prev: -1, revealed: true };
  state.monsters.push(monster);
  log(state, `Something stirs at ${label(board, cell)}.`);
  events.push({ type: 'monsterSpawn', id: monster.id, kind: monster.kind, cell });
}

// Every monster takes its turn.
export function monstersAct(state, board, events, random, log) {
  const ctx = context(state, board, random);
  for (const monster of state.monsters) {
    const def = MONSTERS[monster.kind];
    if (!def) continue;
    const plan = def.act(ctx, monster) ?? {};
    // Walk the planned path, checking every step against the board.
    let moved = 0;
    for (const cell of (plan.path ?? []).slice(0, def.speed ?? 1)) {
      const a = board.grid.coords(monster.pos), b = board.grid.coords(cell);
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1 || !board.grid.canStep(a.x, a.y, dx, dy)) break;
      events.push({ type: 'monsterStep', id: monster.id, from: monster.pos, to: cell });
      monster.prev = monster.pos;
      monster.pos = cell;
      moved++;
    }
    if (moved) log(state, `The ${def.label.toLowerCase()} moves to ${label(board, monster.pos)}.`);
    const victim = state.players.find((pl) => pl.seat === plan.attack);
    if (victim && playersInReach(ctx, monster.pos).includes(victim)) {
      log(state, plan.say ?? `The ${def.label.toLowerCase()} lunges at ${victim.name}!`);
      events.push({ type: 'monsterAttack', id: monster.id, seat: victim.seat, cell: victim.pos });
      def.onAttack?.(ctx, monster, victim);
    }
  }
}
