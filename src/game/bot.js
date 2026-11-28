// The bot: plays an investigator's seat. Used by the in-game bots (play/bots.js:
// you control some seats, bots the rest) and by the headless playtests
// (tools/playtest.mjs).
//
// Before midnight it investigates the nearest markers; once the monster is
// known it follows the monster's objective script (collect, deliver, upgrade,
// cleanse, escape, hold, destroy) or hunts it; it uses any skill the Skills
// menu calls "Use now" on a monster (and heals when hurt), crafts heals from
// Obols, slots its best die to Defense when it is in danger, and says yes to
// investigating, reactions and sacrifices. `expert`: a team that knows every
// rule and plays to it (but not which monster was drawn): names the monster
// from the evidence, picks the best attack, guards the Adze's victims a swarm is flying at (only once the Nest has risen; one bot stays on the Nest), arms
// itself, and so on.
//
//   const bot = makeBot(board, { expert: true });
//   const action = bot.act(state);   // the next action for whoever must act (or null: end the turn)
// It only reads the state it's given (the players' view is enough: it never
// needs the hidden monster).
import { parseEdgeKey } from '../core/state.js';
import { unlockedFn, roadSides, DIRS } from './rules.js';
import { MONSTER_BY_ID } from './cards/monsters.js';
import { skillStatus } from './skills.js';
import { EQUIPMENT_BY_ID } from './cards/equipment.js';
import { RECIPES, blocked as craftBlocked } from './obolcraft.js';
import { choicesFor, doorOverride } from './eventPlay.js';
import { scriptOf, mapSites, knownMonster } from './objectives/scripts.js';
import { RANGE, cellRange, DEATHS_DOOR } from './cards/injuries.js';
import { sixToSpend, memorialCells, wayOutOpen, graveOpen } from './objectives/verbs.js';
import { matchesEvidence } from './mystery.js';
import { toughnessOf, targetsFor } from './equipmentPlay.js';
import { wouldHit } from './monsterTurn.js';
import { checkRequirement } from './cards/requirements.js';

// --- the bot ------------------------------------------------------------------------
export function makeBot(board, { expert = true, trace = false, controls = () => true } = {}) {
  // controls(seat): is that seat a bot's? (In-game, humans play some seats: the bots don't count on them to guard.)
  let state = null;   // the game as the bot sees it: set on every act(state)
  const memo = { crates: new Map(), waits: new Map() };   // its own notes (never written into the game)
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
    const k = `${goal}:${state.keys ?? 0}:${lit}:${state.followStreets ? 'r' : ''}:${ov ? JSON.stringify([state.doors, state.lockdown, state.allDoorsOpen, state.doorPass]) : ''}`;
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
            // Follow streets (on in the game): on a road the pawn keeps to it,
            // leaving only through a door, so the routes do too.
            if (state.followStreets) {
              const sides = roadSides(state, board, x + dx, y + dy);
              if (sides !== null && !(sides & DIRS.find(([ddx, ddy]) => ddx === -dx && ddy === -dy)[3])) continue;
            }
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
  // Set by goals(): the goal is the monster itself (stop beside it to fight), not a
  // place it happens to stand on (a Lair to deliver to).
  let fighting = false;
  // Can this investigator hurt the monster at all (a damaging skill it isn't immune to)?
  // What a piece of Equipment is worth against this monster (expert): the
  // damage it can expect to get through the toughness, more for a weakness hit
  // (it advances the track), nothing for an element the monster is immune to.
  const itemValue = (id, m) => {
    const mc = MONSTER_BY_ID[m?.kind];
    if (!mc) return 0;
    const tough = m.tough ?? mc.toughness ?? 0;
    let best = 0;
    for (const a of EQUIPMENT_BY_ID[id]?.abilities ?? []) {
      const fx = a.fx ?? {};
      if (fx.dmg === undefined || mc.immune.includes(a.kind)) continue;
      const raw = fx.dmg === 'die' ? 3.5 : fx.dmg === 'sum' ? 3.5 * a.dice : fx.dmg;
      const through = fx.ignoreToughness ? raw : Math.max(0, raw - (tough === null ? Infinity : tough) + (fx.toughDown ?? 0));
      best = Math.max(best, (Number.isFinite(through) ? through : 0) + (a.kind && mc.weakness.includes(a.kind) ? 4 : 0));
    }
    return best;
  };
  // How much this player's attack skills want a die showing v (to keep it for them).
  const dieUse = (pl, v) => {
    let n = 0;
    for (const it of pl.inventory.equipment) for (const a of EQUIPMENT_BY_ID[it.id]?.abilities ?? []) {
      if (a.fx?.dmg === undefined || !a.dice || !a.req) continue;
      const r = String(a.req);
      if (a.dice === 1) { if (checkRequirement(r, [v], {})) n++; continue; }
      // Several dice against a total: does this die leave room (low for 'N-', high for 'N+')?
      const m = /^(\d+)([+\-])$/.exec(r);
      if (m) n += m[2] === '-' ? (v <= Math.floor(+m[1] / a.dice) ? 1 : 0) : (v >= Math.ceil(+m[1] / a.dice) ? 1 : 0);
      else if (r.includes(',') && checkRequirement(r.split(',')[0].trim(), [v], {})) n++;   // a spell's face
    }
    return n;
  };
  const armed = (pl) => {
    const m = state.monsters[0];
    if (expert && m && m.hp !== null) return pl.inventory.equipment.some((it) => itemValue(it.id, m) >= 2);
    const immune = MONSTER_BY_ID[m?.kind]?.immune ?? [];
    return pl.inventory.equipment.some((it) => (EQUIPMENT_BY_ID[it.id]?.abilities ?? []).some((a) => a.fx?.dmg !== undefined && !immune.includes(a.kind)));
  };
  // Survival (expert): when the monster's declared hits could kill me (each hit
  // is one injury tier of its type; one past Death's Door is death), the spaces
  // within reach (this turn's dice) where they wouldn't land. Empty when there's
  // nowhere safe, or no need.
  const safeMemo = new Map();
  const lethal = (pl, m) => {
    const hits = {};
    for (const t of m.dangerTypes?.[pl.seat] ?? []) hits[t] = (hits[t] ?? 0) + 1;
    return Object.entries(hits).some(([t, n]) => (pl.injuries?.[t] ?? 0) + n > DEATHS_DOOR) || (state.deathsDoor && Object.keys(hits).length > 0);
  };
  function safeSpots(pl) {
    if (!expert || state.cur !== pl.seat) return [];
    const m = state.monsters.find((x) => (x.danger ?? []).includes(pl.seat));
    if (!m || !lethal(pl, m)) return [];
    const reach = state.pool.filter((d, n) => !d.spent && !state.defSlots.includes(n)).reduce((t, d) => t + d.v, 0)
      + state.slots.filter((n) => !state.pool[n].spent).reduce((t, n) => t + state.pool[n].v, 0) + (state.steps ?? 0);
    if (!reach) return [];
    const k = `${state.turn}:${pl.seat}:${pl.pos}:${reach}`;
    if (safeMemo.has(k)) return safeMemo.get(k);
    const from = distTo(pl.pos);
    const out = [];
    g.cells.forEach((c, i) => { if (c.walkable && from[i] > 0 && from[i] <= reach && !wouldHit(state, board, m, pl.seat, i)) out.push(i); });
    safeMemo.set(k, out);
    return out;
  }
  function goals(pl) {
    fighting = false;
    // At Death's Door with the monster's blow coming: get out of its way first.
    const safe = safeSpots(pl);
    if (safe.length) return safe;
    // Nothing that can hurt the monster, and a Care Package is out: go and get something.
    if (state.crates?.length && state.monsters.length && !armed(pl)) return state.crates.map((c) => c.cell);
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
        } else if (st.do === 'deliver' && carrying(pl, st.item) && at.length && (!st.banish || graveOpen(state))) {   // (the grave opens 3 rounds after she rises)
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
          // Adze. Before the Nest rises there are no swarms: nothing to guard
          // yet, so carry on investigating (the step below). Once it has risen,
          // guard only a victim a swarm is actually flying at: the nearest free
          // bot goes and stands with them (a victim with a human beside them is
          // covered already); everyone else hunts the Nest.
          if (!monster) continue;
          // Solo: one guard can't cover three victims; the Nest has no toughness, so go and kill it.
          if (state.players.length === 1) { fighting = true; return [monster.pos]; }
          const victims = (state.npcs ?? []).filter((v) => v.alive);
          const coming = (state.swarms ?? []).filter((sw) => !sw.burning);
          const near = (p, v) => cellRange(g, p.pos, v.cell) <= RANGE.close;
          const threatened = victims
            .filter((v) => coming.some((sw) => sw.victim === v.id))
            .filter((v) => !state.players.some((p) => !p.dead && !controls(p.seat) && near(p, v)))
            .map((v) => ({ v, eta: Math.min(...coming.filter((sw) => sw.victim === v.id).map((sw) => cellRange(g, sw.pos, v.cell))) }))
            .sort((a, b) => a.eta - b.eta || a.v.id.localeCompare(b.v.id));
          const free = state.players.filter((p) => !p.dead && controls(p.seat));
          // Keep one bot on the Nest when there are enough of them.
          const spare = Math.max(0, free.length - 1);
          for (const { v } of threatened.slice(0, spare || free.length)) {
            let best = null;
            for (const p of free) {
              const d = distTo(v.cell)[p.pos];
              const dd = d < 0 ? 1e6 : d;
              if (!best || dd < best.d || (dd === best.d && p.seat < best.p.seat)) best = { p, d: dd };
            }
            if (!best) break;
            if (best.p === pl) return [v.cell];
            free.splice(free.indexOf(best.p), 1);
          }
          fighting = true; return [monster.pos];
        }
        else if (st.do === 'upgrade') {
          const it = carrying(pl, st.item);
          if (it && !it[st.set] && (!st.requires || it[st.requires]) && at.length) return at;
        } else if (st.do === 'cleanse' && !pl.status?.cleanse && at.length) return at;
        else if (st.do === 'escape' && pl.status?.cleanse && (st.opens !== 'midnight' || wayOutOpen(state))) return at;   // (before midnight the way out is shut: go on investigating)
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
    if (monster && monster.hp !== null) { fighting = true; return [monster.pos]; }
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
          if (expert && late && fits.length === 2 && !named.size) { named.add(fits[0]); return { type: 'name', monster: fits[0], seat: state.cur }; }
        }
        return { type: 'roll', seat: state.cur };
      }
      case 'asking': return { type: 'investigate', yes: state.ask?.anchor ? !!sixToSpend(state) : true, seat: state.cur };
      case 'revealing': {
        const m = state.mystery;
        // (Face-down cards are blank in the players' view: any one not turned over yet.)
        const k = (m?.deck ?? []).findIndex((c, i) => !m.flipped.includes(i));
        return { type: 'reveal', card: Math.max(0, k), seat: state.cur };
      }
      case 'eventing': {
        const pe = state.pendingEvent;
        const opts = pe ? choicesFor(pe.id, state, pl) : null;
        // (A Hiding Spot is kept for later; a passage or mirror's far end: the first space offered.)
        const pick = opts?.find((o) => o.ok && o.value !== 'hide') ?? opts?.find((o) => o.ok);
        return { type: 'event', choice: pick?.value, ...(pick?.pick ? { cell: pick.pick[0] } : {}), seat: state.cur };
      }
      // The truck's turn (travel.js): the bot parks it straight away.
      case 'driving': return { type: 'park', seat: state.cur };
      case 'slotting':
      case 'choosing': {
        // Skills first: anything ready that hurts a monster, or heals me.
        const injured = Object.values(pl.injuries ?? {}).some((v) => v > 0);
        const ready = skillStatus(state, board, pl).filter((e) => e.status === 'now' && e.action && !e.manual);
        // On a Care Package: take what can hurt the monster first, then a couple more (leave the rest).
        const crate = (state.crates ?? []).find((c) => c.cell === pl.pos);
        const ck = `${pl.seat}:${crate?.cell}`;
        if (crate && (memo.crates.get(ck) ?? 0) < 3) {
          const immune = MONSTER_BY_ID[state.monsters[0]?.kind]?.immune ?? [];
          const hurts = (id) => (EQUIPMENT_BY_ID[id]?.abilities ?? []).some((a) => a.fx?.dmg !== undefined && !immune.includes(a.kind));
          const m0 = state.monsters[0];
          // Expert: the piece worth most against this monster (through its toughness, its weaknesses).
          const k = expert && m0 && m0.hp !== null
            ? crate.items.map((id, i) => ({ i, v: itemValue(id, m0) })).sort((x, y) => y.v - x.v)[0]?.i ?? 0
            : Math.max(0, crate.items.findIndex(hurts));
          memo.crates.set(ck, (memo.crates.get(ck) ?? 0) + 1);
          return { type: 'crate', item: k, seat: state.cur };
        }
        // Beside a memorial with the candle out: relight it for an Obol.
        const relight = ready.find((e) => e.item === 'relight');
        if (relight) return relight.action;
        // Shut in (a blocked door between me and where I'm going): force it with a 6.
        const force = ready.find((e) => e.item === 'force');
        if (force && !nearest(pl.pos, goals(pl))) return force.action;
        // A fired gun or crossbow: with a free 6 and something to shoot at, a quick reload (it fires next).
        const reloads = ready.filter((e) => (e.a ?? e.card.abilities[e.ability]).fx?.reload);
        const six = state.pool.findIndex((d, n) => !d.spent && d.v >= 6 && !state.slots.includes(n) && !state.defSlots.includes(n));
        if (expert && six >= 0 && !(sc6(pl))) {
          const quick = reloads.find((e) => { const of = e.a.of; return of.fx?.dmg !== undefined && targetsFor(state, board, pl, of).length > 0; });
          if (quick) return { ...quick.action, dice: [six] };
        }
        if (expert) {
          // At Death's Door with somewhere safe to run: only an attack that finishes the monster beats running.
          const best = bestAttack(pl, ready, safeSpots(pl).length > 0);
          if (best) return best;
          const heal = injured && ready.find((e) => { const fx = (e.a ?? e.card.abilities[e.ability]).fx ?? {}; return (fx.heal && Object.keys(fx.heal).some((k) => (pl.injuries?.[k] ?? 0) > 0)) || fx.healAround; });
          if (heal) return heal.action;
        } else {
          for (const e of ready) {
            const fx = (e.a ?? e.card.abilities[e.ability]).fx ?? {};
            const useful = e.item === 'cosor' || fx.dmg !== undefined || (injured && ((fx.heal && Object.keys(fx.heal).some((k) => (pl.injuries?.[k] ?? 0) > 0)) || fx.healAround))
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
        const hunting = monster && fighting && gl.length === 1 && gl[0] === monster.pos;
        const near = nearest(pl.pos, gl);
        const need = !near ? 0 : hunting ? Math.max(0, near.d - 1) : near.d;
        // Trace: why a bot that isn't going anywhere waits (once a turn).
        if (trace && need === 0 && state.fullLog && memo.waits.get(pl.seat) !== state.turn) {
          memo.waits.set(pl.seat, state.turn);
          const lab = (i) => { const { x, y } = g.coords(i); return `${String.fromCharCode(65 + x)}${y + 1}`; };
          state.fullLog.push(`[bot] ${pl.name} at ${lab(pl.pos)} waits: goals ${gl.slice(0, 4).map(lab).join(',')}${gl.length > 4 ? '…' : ''} ${near ? `reached (d ${near.d})` : 'UNREACHABLE'}${hunting ? ' (hunting)' : ''}${state.noMove ? ' noMove' : ''}`);
        }
        const canDef = state.defSlots.length < state.maxDefense;
        const threat = monster && (monster.danger ?? []).includes(pl.seat);
        // (Running for a safe space at Death's Door: the die goes on moving, not a Defense that can't hold.)
        const fleeing = expert && safeSpots(pl).length > 0;
        // Carrying an objective item to where it's needed (the Strigoi's Cosor: its Drain
        // reaches the holder anywhere, so they are always in danger): the run comes first,
        // Defense gets what's left once this turn's movement is slotted.
        const carrying = expert && (pl.carry ?? []).length > 0 && near && near.d > 0 && pending < need && !state.noMove;
        if (expert && !fleeing && !carrying) {
          const plan = expertDefense(pl, free, hunting && near && near.d <= 1);
          if (plan) return plan;
        }
        // Shadow People: Umbral Stab strikes whoever steps into a lit space (not a declared
        // action, so not in the danger list): set one die to Defense before walking.
        if (expert && avoidLit() && need > 0 && !state.defSlots.length && canDef && free.length >= 2 && !fleeing) {
          return { type: 'slot', die: free[1].n, to: 'defense', seat: state.cur };
        }
        const guard = free.filter((d) => !(sc6(pl) && d.v === 6));
        const adjacent = hunting && near && near.d <= 1;
        if (guard.length && threat && canDef && !fleeing && !carrying && !(adjacent && guard.length === 1)) return { type: 'slot', die: guard[0].n, to: 'defense', seat: state.cur };
        if (free.length && !state.noMove && pending < need && state.slots.length < state.maxSlots) {
          const short = need - pending;
          // Poltergeist: keep a 6 back to destroy an anchor with.
          const keepSix = sc6(pl) ? free.find((d) => d.v === 6) : null;
          const movers = free.filter((d) => d !== keepSix);
          if (!movers.length) { if (pending > 0 && !state.noMove) return { type: 'move', seat: state.cur }; return null; }
          // The die that covers the walk; expert: of those, the one its weapons need least
          // (precision skills want low dice, strength skills high ones).
          const covering = movers.filter((d) => d.v >= short);
          const fit = expert && covering.length > 1
            ? [...covering].sort((x, y) => dieUse(pl, x.v) - dieUse(pl, y.v) || x.v - y.v)[0]
            : [...movers].reverse().find((d) => d.v >= short) ?? movers[0];
          // Keep one die back from a long walk when a monster is about (Defense).
          if (!(monster && free.length === 1 && state.slots.length && canDef && !hunting)) return { type: 'slot', die: fit.n, to: 'move', seat: state.cur };
        }
        if (pending > 0 && !state.noMove) return { type: 'move', seat: state.cur };
        // Done moving: reload a fired gun with the lowest die that will do (unless the monster is about to strike: Defense first).
        if (!threat) {
          const reload = skillStatus(state, board, pl).find((e) => e.status === 'now' && e.action && e.a?.fx?.reload);
          if (reload) return reload.action;
        }
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
  function bestAttack(pl, ready, onlyKills = false) {
    let best = null;
    // Adze: burn the swarms with Fire (4 health; alight, they turn back and burn the Nest).
    for (const e of ready) {
      const a = (e.a ?? e.card.abilities[e.ability]);
      if (e.item === 'cosor' || a.kind !== 'fire' || a.fx?.dmg === undefined) continue;
      const sw = targetsFor(state, board, pl, a).find((t) => t.swarm !== undefined);
      if (!sw) continue;
      const free = state.pool.map((d, i) => ({ ...d, i })).filter((d) => !d.spent && !state.slots.includes(d.i) && !state.defSlots.includes(d.i)).sort((x, y) => y.v - x.v);
      const dice = free.slice(0, a.dice).map((d) => d.i);
      if (dice.length < a.dice || !checkRequirement(a.req, dice.map((n) => state.pool[n].v), {})) continue;
      const vals = dice.map((n) => state.pool[n].v);
      const raw = a.fx.dmg === 'die' ? vals[0] : a.fx.dmg === 'sum' ? vals.reduce((x, y) => x + y, 0) : a.fx.dmg;
      if (raw > 0) return { ...e.action, dice, target: { swarm: sw.swarm } };   // every bit of Fire counts (4 health)
    }
    for (const e of ready) {
      const a = (e.a ?? e.card.abilities[e.ability]);
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
      let through = tough === Infinity ? 0 : Math.max(0, raw - tough);
      // Redcap: a piercing blow can't land the killing blow; it stops at 1 (worth nothing once it's there).
      if (fx.ignoreToughness && mc.id === 'redcap' && m.hp !== null) through = Math.min(through, Math.max(0, m.hp - 1));
      const weak = a.kind && mc.weakness.includes(a.kind) ? 4 : 0;
      const support = fx.toughDown || fx.immobile || fx.halve || fx.blind ? 2 : 0;
      const score = through + weak + support - (a.limit === 'breaks' && through < 6 ? 3 : 0);
      if (onlyKills && !(m.hp !== null && through >= m.hp)) continue;
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
      if (expert && !heals && state.monsters.length && (pl.inventory.obolcraft.length < 5)) continue;
      if (!craftBlocked(state, pl, r)) return { type: 'craft', recipe: r.id, seat: pl.seat };
    }
    return null;
  }
  const named = new Set();
  return { act: (s) => { state = s; return act(); } };
}
