// Playtests: whole games played by a simple bot, headless, on a built-in map,
// for every monster and team size, to find what breaks and how often the
// investigators win.
//
//   node tools/playtest.mjs [games per setup = 8] [monster ids, comma-separated] [team sizes = 1,2,3,4]
//
// The bot: before midnight it investigates the nearest markers; once the
// monster is known it follows the monster's objective script (collect,
// deliver, upgrade, cleanse, escape, hold, destroy) or hunts it; it uses any
// skill the Skills menu calls "Use now" on a monster (and heals when hurt),
// crafts heals from Obols, slots its best die to Defense when it is in danger,
// and says yes to investigating, reactions and sacrifices.
//
// Checks while it plays (anomalies): an exception; an action the bot expected
// to work failing over and over; no progress for many actions; a player or
// monster off the board, NaN health, health above its maximum.
import { readFileSync } from 'fs';
import { gridFromMap } from '../src/core/mapFormat.js';
import { parseEdgeKey } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction, unlockedFn } from '../src/game/rules.js';
import { MONSTER_CARDS, MONSTER_BY_ID } from '../src/game/cards/monsters.js';
import { skillStatus } from '../src/game/skills.js';
import { RECIPES, blocked as craftBlocked } from '../src/game/obolcraft.js';
import { choicesFor, doorOverride } from '../src/game/eventPlay.js';
import { scriptOf, mapSites, knownMonster } from '../src/game/objectives/scripts.js';
import { RANGE, cellRange } from '../src/game/cards/injuries.js';
import { sixToSpend, memorialCells } from '../src/game/objectives/verbs.js';
import { matchesEvidence } from '../src/game/mystery.js';
import { toughnessOf, targetsFor } from '../src/game/equipmentPlay.js';
import { checkRequirement } from '../src/game/cards/requirements.js';

// TUNE='{"werewolf":{"toughness":3}}': try card changes in this run only (hp,
// toughness, badge...), to see what a balance change would do before making it.
if (process.env.TUNE) {
  const { MONSTER_BY_ID: CARDS } = await import('../src/game/cards/monsters.js');
  for (const [id, change] of Object.entries(JSON.parse(process.env.TUNE))) Object.assign(CARDS[id], change);
}
const MAP = JSON.parse(readFileSync(new URL('../src/maps/hawthorn-bend.json', import.meta.url)));
const GAMES = Number(process.argv[2] ?? 8);
const ONLY = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : null;
const SIZES = (process.argv[4] ?? '1,2,3,4').split(',').map(Number);
const MAX_ROUNDS = 60;
const TRACE = process.env.TRACE === '1';   // print every log line of each game
// BOT=expert: a team that knows every rule and plays to it (but not which monster was drawn).
const EXPERT = process.env.BOT === 'expert';

// --- the bot ------------------------------------------------------------------------
function makeBot(state, board) {
  const g = board.grid;
  const fields = new Map();
  // Walking distance to `goal` from every cell (keys and doors as the board has them).
  // Walking cost to `goal` from every cell: a step costs 1, and while the
  // Shadow People hunt, a lit space costs 4 (Umbral Stab strikes there).
  // Doors the team has unlocked count as open. Cached per goal, key set and mode.
  const avoidLit = () => state.monsters.some((m) => MONSTER_BY_ID[m.kind]?.onEnterLit) && !state.flags?.noLight;
  const distTo = (goal) => {
    const lit = avoidLit();
    const ov = doorOverride(state);
    const k = `${goal}:${state.keys ?? 0}:${lit}:${ov ? JSON.stringify([state.doors, state.lockdown, state.allDoorsOpen, state.doorPass]) : ''}`;
    if (!fields.has(k)) {
      const open = unlockedFn(state, board);
      const n = g.cells.length;
      const dist = new Int32Array(n).fill(-1);
      const best = new Float64Array(n).fill(Infinity);
      best[goal] = 0;
      // Small Dijkstra with a bucket queue (costs are small integers).
      const buckets = [[goal]];
      for (let c = 0; c < buckets.length; c++) {
        for (const i of buckets[c] ?? []) {
          if (best[i] !== c || dist[i] >= 0) continue;
          dist[i] = c;
          const { x, y } = g.coords(i);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!g.inBounds(x + dx, y + dy)) continue;
            // From the neighbour back to here: walking toward the goal.
            if (!g.canStep(x + dx, y + dy, -dx, -dy, open, ov)) continue;
            const j = g.index(x + dx, y + dy);
            const cost = c + 1 + (lit && (board.light[i] ?? 0) >= state.config.litThreshold ? 3 : 0);
            if (cost < best[j]) { best[j] = cost; (buckets[cost] ??= []).push(j); }
          }
        }
      }
      fields.set(k, dist);
    }
    return fields.get(k);
  };
  const sites = mapSites(g);
  const siteCells = (at) => (at === 'lair' ? [state.mystery?.spawnCell ?? -1] : at === 'start' ? [board.startCell()] : at === 'any' ? sites.all : sites[at] ?? []).filter((c) => c >= 0);
  const carrying = (pl, item) => (pl.carry ?? []).find((c) => c.item === item);
  const teamHas = (item) => state.players.some((p) => !p.dead && carrying(p, item));

  // Where this investigator wants to go now: a list of cells (the nearest wins).
  function goals(pl) {
    const ob = state.objective ?? {};
    const id = knownMonster(state);
    const sc = scriptOf(id);
    const monster = state.monsters[0];
    const dropped = (ob.dropped ?? []).filter((d) => !(d.banned === pl.seat && state.round <= d.until));
    if (id && sc) {
      for (const st of sc.steps) {
        const at = siteCells(st.at);
        if (st.do === 'collect') {
          const done = (ob.delivered?.[st.item] ?? 0) > 0 || teamHas(st.item);
          const lying = dropped.filter((d) => d.item === st.item).map((d) => d.cell);
          if (lying.length) return lying;
          if (!done && !(st.unique && ob.taken?.[st.item]) && at.length) return at;
          if (st.item === 'candle' && !carrying(pl, 'candle') && at.length) return at; // candles: everyone carries
        } else if (st.do === 'deliver' && carrying(pl, st.item) && at.length) {
          // A candle that went out: relight it where it came from first.
          const it = carrying(pl, st.item);
          if (it.lit === false) {
            const from = siteCells(sc.steps.find((x) => x.do === 'collect' && x.item === st.item).at);
            // Shadow People: the memorials relight too (the spaces beside them), whichever is nearer.
            if (st.item === 'candle' && pl.inventory.obolcraft.length) {
              const shrines = memorialCells(board).flatMap((m) => { const { x, y } = g.coords(m); return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => g.inBounds(x + dx, y + dy) && g.cells[g.index(x + dx, y + dy)].walkable).map(([dx, dy]) => g.index(x + dx, y + dy)); });
              from.push(...shrines);
            }
            // Relighting happens on stepping onto the stand: standing on it already, step off first.
            if (from.includes(pl.pos)) { const { x, y } = g.coords(pl.pos); return [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => g.inBounds(x + dx, y + dy) && g.cells[g.index(x + dx, y + dy)].walkable).map(([dx, dy]) => g.index(x + dx, y + dy)); }
            return from;
          }
          return at;
        } else if (st.do === 'defend') {
          // Adze: stand with a victim (each investigator its own, in seat order).
          // One guard per victim; anyone left over goes for the Nest.
          const victims = (state.npcs ?? []).filter((v) => v.alive);
          const guards = state.players.filter((p) => !p.dead).sort((a, b) => a.seat - b.seat);
          const k = guards.indexOf(pl);
          // More victims than guards (solo: all three in the Hospital): a
          // space beside as many of them as possible, if the last guard.
          if (victims.length > guards.length && k === guards.length - 1) {
            const rest = victims.slice(k);
            let most = 0; let spots = [];
            g.cells.forEach((c, i) => {
              if (!c.walkable) return;
              const n = rest.filter((v) => cellRange(g, i, v.cell) <= RANGE.close).length;
              if (n > most) { most = n; spots = [i]; } else if (n === most && n) spots.push(i);
            });
            if (most > 1) return spots;
          }
          if (victims.length && k >= 0 && k < victims.length && (guards.length > victims.length || k < guards.length - 1 || guards.length === 1)) return [victims[k].cell];
          if (monster) return [monster.pos];
        }
        else if (st.do === 'upgrade') {
          const it = carrying(pl, st.item);
          if (it && !it[st.set] && (!st.requires || it[st.requires]) && at.length) return at;
        } else if (st.do === 'cleanse' && !pl.status?.cleanse && at.length) return at;
        else if (st.do === 'escape' && pl.status?.cleanse) return at;
        else if (st.do === 'hold' && ob.ceremony && at.length) return at;
        else if (st.do === 'destroy') {
          // An anchor is broken by stepping onto its marker with a 6: not the one underfoot.
          const left = at.filter((c) => !(ob.anchors ?? []).includes(c) && c !== pl.pos);
          if (st.count && (ob.anchors ?? []).filter((c) => c !== state.mystery?.spawnCell).length >= st.count) continue;
          if (left.length) return left;
        }
      }
    }
    // Before the monster is known: the nearest unused marker.
    if (!id || !state.monsters.length) {
      const used = new Set(state.used ?? []);
      const marks = g.cells.map((c, i) => (['investigation', 'research', 'whiteDice', 'blackDice', 'key'].includes(c.marker) && !used.has(i) ? i : -1)).filter((i) => i >= 0);
      if (marks.length) return marks;
    }
    // A monster to fight.
    if (monster && monster.hp !== null) return [monster.pos];
    return [board.startCell()];
  }
  const nearest = (from, cells) => {
    let best = null;
    for (const c of cells) { const d = distTo(c)[from]; if (d >= 0 && (best === null || d < best.d)) best = { c, d }; }
    return best;
  };

  // Does this fight want 6s kept for something (the Poltergeist's anchors)?
  const sc6 = () => scriptOf(knownMonster(state))?.steps.some((st) => st.do === 'destroy');
  // Goals it can't reach yet (behind a locked door): fetch a key first.
  const reachable = (pl) => {
    const gl = goals(pl);
    if (nearest(pl.pos, gl)) return gl;
    const used = new Set(state.used ?? []);
    const keys = g.cells.map((c, i) => (c.marker === 'key' && !used.has(i) ? i : -1)).filter((i) => i >= 0);
    if (keys.length && nearest(pl.pos, keys)) return keys;
    // Shut in by a blocked door (Nailed Shut): go and stand beside it to force it with a 6.
    const beside = Object.entries(state.doors ?? {}).filter(([, v]) => v === 'blocked').flatMap(([k]) => {
      const { o, x, y } = parseEdgeKey(k);
      return (o === 'v' ? [[x - 1, y], [x, y]] : [[x, y - 1], [x, y]]).filter(([a, b]) => g.inBounds(a, b)).map(([a, b]) => g.index(a, b));
    });
    return beside.length && nearest(pl.pos, beside) ? beside : gl;
  };

  // One bot action for whoever must act. Returns the action (or null: end turn).
  function act() {
    const pl = state.players[state.cur];
    if (state.reactions?.length) return { type: 'react', yes: true, seat: state.reactions[0].seat };
    if (state.sacrifice?.length) return { type: 'sacrifice', yes: true };
    switch (state.phase) {
      case 'scouting': return { type: 'scout', card: 0, seat: state.cur };
      case 'idle': {
        const c = craftHeal(pl);
        if (c) return c;
        // Name the monster once the evidence fits only one (Initiative).
        const my = state.mystery;
        if (my && !my.guess && !my.revealed) {
          const found = { attack: my.attack?.code ?? null, cards: (my.found ?? []).filter((f) => f.kind !== 'attack') };
          const fits = (my.pool ?? []).filter((id) => matchesEvidence(MONSTER_BY_ID[id], found));
          if (fits.length === 1 && !named.has(fits[0])) { named.add(fits[0]); return { type: 'name', monster: fits[0], seat: state.cur }; }
          const late = state.round >= state.config.turnsToMidnight - 1;
          if (EXPERT && late && fits.length === 2 && !named.size) { named.add(fits[0]); return { type: 'name', monster: fits[0], seat: state.cur }; }
        }
        return { type: 'roll', seat: state.cur };
      }
      case 'asking': return { type: 'investigate', yes: state.ask?.anchor ? !!sixToSpend(state) : true, seat: state.cur };
      case 'revealing': {
        const m = state.mystery;
        const k = (m?.deck ?? []).findIndex((c, i) => c && !m.flipped.includes(i));
        return { type: 'reveal', card: Math.max(0, k), seat: state.cur };
      }
      case 'eventing': {
        const pe = state.pendingEvent;
        const opts = pe ? choicesFor(pe.id, state, pl) : null;
        const pick = opts?.find((o) => o.ok);
        return { type: 'event', choice: pick?.value, seat: state.cur };
      }
      case 'slotting':
      case 'choosing': {
        // Skills first: anything ready that hurts a monster, or heals me.
        const injured = Object.values(pl.injuries ?? {}).some((v) => v > 0);
        const ready = skillStatus(state, board, pl).filter((e) => e.status === 'now' && e.action && !e.manual);
        // Beside a memorial with the candle out: relight it for an Obol.
        const relight = ready.find((e) => e.item === 'relight');
        if (relight) return relight.action;
        // Shut in (a blocked door between me and where I'm going): force it with a 6.
        const force = ready.find((e) => e.item === 'force');
        if (force && !nearest(pl.pos, goals(pl))) return force.action;
        if (EXPERT) {
          const best = bestAttack(pl, ready);
          if (best) return best;
          const heal = injured && ready.find((e) => { const fx = e.card.abilities[e.ability].fx ?? {}; return fx.heal || fx.healAround; });
          if (heal) return heal.action;
        } else {
          for (const e of ready) {
            const fx = e.card.abilities[e.ability].fx ?? {};
            const useful = e.item === 'cosor' || fx.dmg !== undefined || (injured && (fx.heal || fx.healAround))
              || (fx.target === 'monster' && (fx.toughDown || fx.immobile || fx.halve));
            if (useful) return e.action;
          }
        }
        if (state.phase === 'choosing') {
          // At a fork: the way nearest the goal.
          const gl = reachable(pl);
          let best = null;
          for (const o of state.options) {
            const n = nearest(o.i, gl);
            const d = n ? n.d : 999;
            if (!best || d < best.d) best = { o, d };
          }
          return best ? { type: 'choose', cell: best.o.i, seat: state.cur } : null;
        }
        // Slot dice. Only the movement needed: next to a monster it hunts,
        // or on to its goal; the rest stays for attacks, then Defense.
        const free = state.pool.map((d, n) => ({ ...d, n })).filter((d) => !d.spent && !state.slots.includes(d.n) && !state.defSlots.includes(d.n))
          .sort((a, b) => b.v - a.v);
        const pending = state.slots.filter((n) => !state.pool[n].spent).reduce((t, n) => t + state.pool[n].v, 0);
        const monster = state.monsters[0];
        const night = monster || knownMonster(state);   // a monster about (the Poltergeist has no body)
        const gl = reachable(pl);
        const hunting = monster && gl.length === 1 && gl[0] === monster.pos;
        const near = nearest(pl.pos, gl);
        const need = !near ? 0 : hunting ? Math.max(0, near.d - 1) : near.d;
        const canDef = state.defSlots.length < state.maxDefense;
        const threat = monster && (monster.danger ?? []).includes(pl.seat);
        if (EXPERT) {
          const plan = expertDefense(pl, free, hunting && near && near.d <= 1);
          if (plan) return plan;
        }
        const guard = free.filter((d) => !(sc6(pl) && d.v === 6));
        const adjacent = hunting && near && near.d <= 1;
        if (guard.length && threat && canDef && !(adjacent && guard.length === 1)) return { type: 'slot', die: guard[0].n, to: 'defense', seat: state.cur };
        if (free.length && !state.noMove && pending < need && state.slots.length < state.maxSlots) {
          const short = need - pending;
          // Poltergeist: keep a 6 back to destroy an anchor with.
          const keepSix = sc6(pl) ? free.find((d) => d.v === 6) : null;
          const movers = free.filter((d) => d !== keepSix);
          if (!movers.length) { if (pending > 0 && !state.noMove) return { type: 'move', seat: state.cur }; return null; }
          const fit = [...movers].reverse().find((d) => d.v >= short) ?? movers[0];
          // Keep one die back from a long walk when a monster is about (Defense).
          if (!(monster && free.length === 1 && state.slots.length && canDef && !hunting)) return { type: 'slot', die: fit.n, to: 'move', seat: state.cur };
        }
        if (pending > 0 && !state.noMove) return { type: 'move', seat: state.cur };
        const forDef = free.filter((d) => !(sc6(pl) && d.v === 6));
        if (forDef.length && canDef && night) return { type: 'slot', die: forDef[0].n, to: 'defense', seat: state.cur };
        if (free.length && !state.noMove && state.slots.length < state.maxSlots && !night && need > 0) return { type: 'slot', die: free[0].n, to: 'move', seat: state.cur };
        return null;
      }
      default: return null;
    }
  }
  // --- expert play ------------------------------------------------------------------
  // The attack that does the most: damage through toughness, a weakness hit
  // worth extra (it advances the weakness track), one-die weapons with the highest die.
  function bestAttack(pl, ready) {
    let best = null;
    // Adze: burn the swarms with Fire (5 health; alight, they turn back and burn the Nest).
    for (const e of ready) {
      const a = e.card.abilities[e.ability];
      if (e.item === 'cosor' || a.kind !== 'fire' || a.fx?.dmg === undefined) continue;
      const sw = targetsFor(state, board, pl, a).find((t) => t.swarm !== undefined);
      if (!sw) continue;
      const free = state.pool.map((d, i) => ({ ...d, i })).filter((d) => !d.spent && !state.slots.includes(d.i) && !state.defSlots.includes(d.i)).sort((x, y) => y.v - x.v);
      const dice = free.slice(0, a.dice).map((d) => d.i);
      if (dice.length < a.dice || !checkRequirement(a.req, dice.map((n) => state.pool[n].v), {})) continue;
      const vals = dice.map((n) => state.pool[n].v);
      const raw = a.fx.dmg === 'die' ? vals[0] : a.fx.dmg === 'sum' ? vals.reduce((x, y) => x + y, 0) : a.fx.dmg;
      if (raw > 0) return { ...e.action, dice, target: { swarm: sw.swarm } };   // every bit of Fire counts (5 health)
    }
    for (const e of ready) {
      const a = e.card.abilities[e.ability];
      const fx = a.fx ?? {};
      if (e.item === 'cosor') {
        const n = state.pool.map((d, i) => ({ ...d, i })).filter((d) => !d.spent && !state.slots.includes(d.i) && !state.defSlots.includes(d.i)).sort((x, y) => y.v - x.v)[0];
        if (n) return { ...e.action, die: n.i };
        continue;
      }
      if (fx.dmg === undefined && !(fx.target === 'monster' && (fx.toughDown || fx.immobile || fx.halve || fx.blind))) continue;
      const m = state.monsters.find((x) => x.id === e.action.target?.monster) ?? state.monsters[0];
      if (!m) continue;
      const mc = MONSTER_BY_ID[m.kind];
      let action = e.action;
      // One die of damage: the highest free die that meets the requirement.
      if (fx.dmg === 'die' && a.dice === 1) {
        const free = state.pool.map((d, i) => ({ ...d, i })).filter((d) => !d.spent && !state.slots.includes(d.i) && !state.defSlots.includes(d.i)).sort((x, y) => y.v - x.v);
        const fit = free.find((d) => checkRequirement(a.req, [d.v], { targetDie: null }));
        if (fit) action = { ...action, dice: [fit.i] };
      }
      const vals = action.dice.map((n) => state.pool[n].v);
      const raw = fx.dmg === 'die' ? vals[0] ?? 0 : fx.dmg === 'sum' ? vals.reduce((x, y) => x + y, 0) : typeof fx.dmg === 'number' ? fx.dmg : 0;
      const tough = fx.ignoreToughness ? 0 : toughnessOf(m);
      const through = tough === Infinity ? 0 : Math.max(0, raw - tough);
      const weak = a.kind && mc.weakness.includes(a.kind) ? 4 : 0;
      const support = fx.toughDown || fx.immobile || fx.halve || fx.blind ? 2 : 0;
      const score = through + weak + support - (a.limit === 'breaks' && through < 6 ? 3 : 0);
      if (score > 0 && (!best || score > best.score)) best = { score, action };
    }
    return best?.action ?? null;
  }
  // How much damage the monster's declared actions could throw at this player.
  function threatOn(pl) {
    let worst = 0;
    for (const m of state.monsters) {
      if (!(m.danger ?? []).includes(pl.seat)) continue;
      for (const it of m.intents ?? []) for (const o of it.ops ?? []) {
        if (!o.dmg) continue;
        const d = (o.dmg.fixed ?? 0) + (o.dmg.dice ?? 0) * 4;
        worst = Math.max(worst, d);
      }
    }
    return worst;
  }
  // Defense sized to the threat (white dice from reserve if short); keep a die
  // to attack with when beside the monster.
  function expertDefense(pl, free, adjacent) {
    const need = threatOn(pl);
    if (!need) return null;
    const have = state.defSlots.reduce((t, n) => t + (state.pool[n]?.v ?? 0), 0);
    if (have >= need) return null;
    if (state.defSlots.length < state.maxDefense) {
      const pick = free.filter((d) => !(sc6(pl) && d.v === 6));
      if (pick.length > (adjacent ? 1 : 0)) return { type: 'slot', die: pick[0].n, to: 'defense', seat: state.cur };
    }
    if (pl.white > 0 && !state.deathsDoor && state.phase !== 'idle') return { type: 'rollWhite', seat: state.cur };
    return null;
  }
  function craftHeal(pl) {
    const inj = pl.injuries ?? {};
    for (const r of RECIPES) {
      const heals = /reduce (\w+) injury/i.exec(r.text);
      if (heals && !(inj[{ Physical: 'P', Mental: 'M', Spiritual: 'S' }[heals[1]]] > 0)) continue;
      if (!heals && !/Equipment card/.test(r.text)) continue;
      // Expert: arm up with spare Obols (keep two for heals once the monster is out).
      if (EXPERT && !heals && state.monsters.length && (pl.inventory.obolcraft.length < 5)) continue;
      if (!craftBlocked(state, pl, r)) return { type: 'craft', recipe: r.id, seat: pl.seat };
    }
    return null;
  }
  const named = new Set();
  return { act };
}

// --- one game -------------------------------------------------------------------------
function play(monster, players, seed) {
  const { grid } = gridFromMap(MAP);
  const board = createBoard(grid);
  // Follow streets off: the bot's walking distances don't know the road's lanes.
  const { state } = newGame(board, { seed, scout: true, followStreets: false, config: { players, monsterPick: monster } });
  const bot = makeBot(state, board);
  state.fullLog = [];
  let seenN = state.logN ?? 0;
  const anomalies = [];
  let actions = 0, lastRound = state.round, sinceRound = 0, fails = 0;
  const note = (kind, text) => { if (anomalies.length < 6) anomalies.push({ kind, text, round: state.round, log: state.log.slice(0, 3) }); };
  try {
    while (state.phase !== 'over' && state.round <= MAX_ROUNDS && actions < 20000) {
      actions++;
      let a = bot.act();
      if (!a) a = { type: 'end', seat: state.cur };
      if (process.env.ACTS === '1' && actions < 400) console.log('ACT', state.phase, state.players[state.cur].pos, JSON.stringify(a), state.options?.map((o) => o.i).join(','));
      let r = applyAction(state, board, a);
      if (!r.ok && a.type !== 'end') {
        fails++;
        if (fails > 40) { note('stuck', `${a.type} keeps failing: ${r.error}`); fails = 0; }
        r = applyAction(state, board, { type: 'end', seat: state.cur });
        if (!r.ok) {
          // Something waits that the bot can't answer.
          note('blocked', `${state.phase}: can't end the turn (${r.error})`);
          break;
        }
      } else fails = 0;
      if (TRACE) { const n = state.logN ?? 0; state.fullLog.push(...state.log.slice(0, Math.min(n - seenN, state.log.length)).reverse()); seenN = n; }
      // Invariants.
      for (const p of state.players) if (!(p.pos >= 0 && p.pos < grid.cells.length)) note('position', `${p.name} at ${p.pos}`);
      for (const m of state.monsters) {
        if (!(m.pos >= 0 && m.pos < grid.cells.length)) note('position', `${m.kind} at ${m.pos}`);
        if (m.hp !== null && m.hp !== undefined && (Number.isNaN(m.hp) || m.hp > (m.maxHp ?? Infinity))) note('health', `${m.kind} hp ${m.hp}/${m.maxHp}`);
      }
      if (state.round !== lastRound) { lastRound = state.round; sinceRound = 0; } else if (++sinceRound > 3000) { note('no progress', `phase ${state.phase} for 3000 actions`); break; }
    }
  } catch (err) {
    note('crash', String(err.stack ?? err).split('\n').slice(0, 3).join(' | '));
  }
  if (TRACE) console.log(state.fullLog.join('\n') + `\n=== END ${state.won ? 'win' : state.phase === 'over' ? 'loss' : 'undecided'} players=${state.players.length} round=${state.round} lair=${state.mystery?.spawnCell}`);
  const won = !!state.won;
  const escaped = state.players.filter((p) => p.escaped).length;
  return {
    result: won || escaped ? 'win' : state.phase === 'over' ? 'loss' : 'undecided',
    rounds: state.round, dead: state.players.filter((p) => p.dead).length,
    identified: !!state.mystery?.revealed || !!knownMonster(state),
    objective: !!state.objectiveDone,
    monsterHp: state.monsters[0] ? `${state.monsters[0].hp ?? '∞'}/${state.monsters[0].maxHp ?? '∞'}` : 'gone',
    anomalies,
  };
}

// --- all of them ---------------------------------------------------------------------
const ids = MONSTER_CARDS.map((c) => c.id).filter((id) => !ONLY || ONLY.includes(id));
const rows = [];
const problems = [];
const t0 = Date.now();
for (const id of ids) {
  for (const n of SIZES) {
    const games = Array.from({ length: GAMES }, (_, k) => play(id, n, 1000 + k * 7919 + n * 31));
    const tally = (f) => games.filter(f).length;
    rows.push({
      monster: MONSTER_BY_ID[id].name, players: n,
      win: tally((x) => x.result === 'win'), loss: tally((x) => x.result === 'loss'), undecided: tally((x) => x.result === 'undecided'),
      rounds: (games.reduce((s, x) => s + x.rounds, 0) / games.length).toFixed(1),
      dead: (games.reduce((s, x) => s + x.dead, 0) / games.length).toFixed(1),
      objective: tally((x) => x.objective),
    });
    games.forEach((x, k) => x.anomalies.forEach((an) => problems.push({ monster: id, players: n, game: k, ...an })));
  }
}
console.log(`| Monster | Team | Win | Loss | Undecided | Avg rounds | Avg dead | Objective done |`);
console.log(`|---|---|---|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.monster} | ${r.players} | ${r.win} | ${r.loss} | ${r.undecided} | ${r.rounds} | ${r.dead} | ${r.objective} |`);
console.log(`\n${problems.length} anomalies in ${rows.length * GAMES} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const seen = new Set();
for (const p of problems) {
  const key = `${p.kind}:${p.text.slice(0, 60)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`- [${p.kind}] ${p.monster} ×${p.players} game ${p.game}, round ${p.round}: ${p.text}\n    last log: ${p.log.join(' / ').slice(0, 300)}`);
}
