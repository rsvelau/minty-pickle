// Defense, injuries, death, and telegraphed monster actions.
import { test } from 'node:test';
import * as MT from '../src/game/monsterTurn.js';
import { EQUIPMENT_BY_ID } from '../src/game/cards/equipment.js';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { applyDamage, turnLimits, defenseValue } from '../src/game/combat.js';
import { parseAbility } from '../src/game/monsterTurn.js';
import { MONSTER_CARDS } from '../src/game/cards/monsters.js';
import { OBSERVATIONS, LAIRS } from '../src/game/cards/evidence.js';

// Objective sites a monster may need (src/core/sites.js), on row 0, away from the street.
function withSites(g) {
  ['church', 'hotel', 'bar', 'hospital', 'boutique', 'curio', 'funeral', 'outdoor'].forEach((site, k) => g.apply(g.index(k * 2, 0), { marker: 'objective', site }, { silent: true }));
  return g;
}
function street() {
  const g = new GridState(20, 26);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 12), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 12), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  withSites(g);
  return g;
}
const quiet = { log: () => {} };

test('evidence names match the Monster Ref Sheet', () => {
  const name = (id) => MONSTER_CARDS.find((c) => c.id === id);
  const names = (id) => name(id).evidence.observations.map((o) => OBSERVATIONS[o].label).sort();
  assert.deepEqual(names('werewolf'), ['Claw Marks', 'Mangled Window', 'Strange Howl']);
  assert.deepEqual(names('wendigo'), ['Claw Marks', 'Inhuman Shriek', 'Signs of Distress']);
  assert.deepEqual(names('adze'), ['Feeling of Being Watched', 'Severe Lethargy', 'Unexplained Illness']);
  assert.equal(LAIRS[name('redcap').evidence.lair].label, 'Bloodstained Room');
  assert.equal(LAIRS[name('barghest').evidence.lair].label, 'Unnaturally Dark Room');
});

test('defense at least the damage blocks; less gives one tier; tiers stack per track', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 1, config: { players: 1 } });
  const pl = state.players[0];
  const ev = [];
  pl.defense = [{ kind: 'black', v: 4 }];
  assert.equal(applyDamage(state, board, pl, 'P', 4, quiet, ev), 'blocked');
  assert.equal(applyDamage(state, board, pl, 'P', 5, quiet, ev), 'injured');
  assert.equal(applyDamage(state, board, pl, 'M', 6, quiet, ev), 'injured');
  assert.deepEqual(pl.injuries, { P: 1, M: 1, S: 0 });
  applyDamage(state, board, pl, 'P', 9, quiet, ev);
  applyDamage(state, board, pl, 'P', 9, quiet, ev);
  assert.equal(pl.injuries.P, 3); // Death's Door
  assert.equal(applyDamage(state, board, pl, 'S', 9, quiet, ev), 'killed');
  assert.ok(pl.dead);
});

test('injuries change what a player can use', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 1, config: { players: 2 } });
  const [a, b] = state.players;
  const base = turnLimits(state, board, a);
  a.injuries = { P: 2, M: 1, S: 0 };      // Sprained + Hobbled, Paranoid
  const hurt = turnLimits(state, board, a);
  assert.equal(hurt.move, base.move - 1);
  assert.equal(hurt.defense, base.defense - 1);
  assert.equal(hurt.dice, base.dice - 1);
  b.injuries = { P: 0, M: 2, S: 0 };      // Terrified, standing with a
  assert.equal(turnLimits(state, board, a).defense, Math.max(0, base.defense - 2));
  a.injuries = { P: 0, M: 0, S: 3 };      // Death's Door
  assert.equal(turnLimits(state, board, a).dice, 1);
  a.injuries = { P: 0, M: 0, S: 1 };      // Doomed
  a.defense = [{ v: 6 }, { v: 3 }];
  assert.equal(defenseValue(a), 4);
});

test('dice go into movement or defense slots and defense is committed on Move', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 2, config: { players: 1 } });
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  assert.ok(state.maxDefense >= 1);
  assert.ok(act({ type: 'slot', die: 0, to: 'defense' }).ok);
  assert.ok(act({ type: 'slot', die: 1, to: 'move' }).ok);
  assert.ok(act({ type: 'slot', die: 0, to: 'move' }).ok); // moves it across
  assert.deepEqual(state.defSlots, []);
  act({ type: 'slot', die: 0, to: 'defense' });
  const v = state.pool[0].v;
  act({ type: 'move' });
  assert.deepEqual(state.players[0].defense.map((d) => d.v), [v]);
});

test('ability text is read into moves and attacks', () => {
  const p = parseAbility('Pursue (8) and Attack (4)');
  assert.deepEqual(p.ops.map((o) => o.op), ['pursue', 'attack']);
  assert.equal(p.ops[1].dmg.fixed, 4);
  const area = parseAbility('Area Attack (2 dice, R5). Only affects outdoor spaces');
  assert.deepEqual(area.ops[0], { op: 'area', dmg: { dice: 2 }, radius: 5, outdoor: true });
  assert.deepEqual(parseAbility('Pursue (10) and Seize player').ops.map((o) => o.op), ['pursue', 'seize']);
});

test('a card monster declares its action, shows who is in danger, then carries it out', () => {
  const board = createBoard(street());
  const { state, events } = newGame(board, { seed: 6, startMode: 'midnight', config: { players: 1, monsterPick: 'redcap' } });
  const mo = state.monsters[0];
  assert.ok(events.some((e) => e.type === 'monsterIntent'));
  assert.equal(mo.intents.length, 1, 'the Redcap rolls one die (its card number)');
  // Move the Redcap next to the player: Chase / Route both Attack → danger.
  const pl = state.players[0];
  const { x, y } = board.grid.coords(pl.pos);
  mo.pos = board.grid.index(x - 1, y);
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  assert.deepEqual(mo.danger, [0], 'danger updates live');
  const r = act({ type: 'move' });             // stay put: the round ends
  assert.ok(r.events.some((e) => e.type === 'damage'), 'it struck');
  assert.ok(r.events.some((e) => e.type === 'monsterIntent'), 'and declared its next move');
});

test('a turn carries on after moving: slot more, adjust defense, move again, then end', async () => {
  const { unusedDice } = await import('../src/game/rules.js');
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 2, config: { players: 1, startBlack: 3 } });
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  state.pool = [{ kind: 'black', v: 1 }, { kind: 'black', v: 1 }, { kind: 'black', v: 5 }];
  act({ type: 'slot', die: 0, to: 'move' });
  assert.ok(act({ type: 'move' }).ok);
  if (state.phase === 'choosing') act({ type: 'choose', cell: state.options[0].i });
  assert.equal(state.phase, 'slotting', 'turn carries on');
  assert.equal(act({ type: 'slot', die: 0, to: 'defense' }).ok, false, 'spent dice stay spent');
  act({ type: 'slot', die: 2, to: 'defense' });
  assert.equal(state.players[0].defense[0].v, 5, 'defense is live');
  act({ type: 'slot', die: 1, to: 'move' });
  act({ type: 'move' });
  if (state.phase === 'choosing') act({ type: 'choose', cell: state.options[0].i });
  // All dice used now: the turn ends by itself; defense stays up.
  assert.equal(state.phase, 'idle');
  assert.equal(state.players[0].defense[0].v, 5);
  assert.equal(unusedDice(state).length, 0);
});

test('Close range includes diagonals; Adze abilities cover every roll', async () => {
  const { cellRange, rangeBand } = await import('../src/game/cards/injuries.js');
  const g = street();
  assert.equal(rangeBand(cellRange(g, g.index(5, 5), g.index(6, 6))), 'close');
  assert.equal(rangeBand(cellRange(g, g.index(5, 5), g.index(7, 6))), 'mid');
  assert.equal(rangeBand(cellRange(g, g.index(5, 5), g.index(8, 5))), 'long');
  const adze = MONSTER_CARDS.find((c) => c.id === 'adze');
  assert.deepEqual(adze.abilities.map((a) => a.roll), ['1-2', '3-4', '5-6']);
});

test('monsters roll as many action dice as their card number, and act in order', () => {
  const board = createBoard(street());
  for (const [id, n] of [['hellhounds', 4], ['werewolf', 3], ['shadow-people', 0]]) {
    const { state } = newGame(board, { seed: 9, startMode: 'midnight', config: { players: 1, monsterPick: id } });
    assert.equal(state.monsters[0].intents.length, n, id);
  }
});

test('the Adze stays in its cocoon and sends swarms over any terrain, not through walls', () => {
  const g = street();
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 11), { area: 'outdoor', sub: 'forest', walkable: false }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 5, startMode: 'midnight', config: { players: 1, monsterPick: 'adze' } });
  const mo = state.monsters[0];
  delete mo.gathering; state.swarmSpeed = 99;   // (no warning round, instant swarms: the old rules)
  mo.pos = g.index(10, 9);                       // across a blocked forest row
  const home = mo.pos;
  mo.intents = [{ roll: 1, ability: 0, name: 'Hotel Victim', kind: 'spiritual', text: '', ops: [{ op: 'attack', dmg: { fixed: 9 } }], unknown: [] }];
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  const r = act({ type: 'end' });
  const swarm = r.events.find((e) => e.type === 'monsterSwarm');
  assert.ok(swarm, 'a swarm flew over the forest');
  assert.equal(mo.pos, home, 'the cocoon stays put');
  // A wall all round the player stops it.
  const g2 = street();
  const board2 = createBoard(g2);
  const s2 = newGame(board2, { seed: 5, startMode: 'midnight', config: { players: 1, monsterPick: 'adze' } }).state;
  const { x, y } = g2.coords(s2.players[0].pos);
  for (const [o, ex, ey] of [['v', x, y], ['v', x + 1, y], ['h', x, y], ['h', x, y + 1]]) g2.setEdge(o, ex, ey, 'wall', { silent: true });
  board2.invalidate();
  delete s2.monsters[0].gathering; s2.swarmSpeed = 99;
  s2.monsters[0].intents = [{ roll: 1, ability: 0, name: 'Hotel Victim', kind: 'spiritual', text: '', ops: [{ op: 'attack', dmg: { fixed: 9 } }], unknown: [] }];
  applyAction(s2, board2, { type: 'roll', seat: 0 });
  const r2 = applyAction(s2, board2, { type: 'end', seat: 0 });
  assert.ok(!r2.events.some((e) => e.type === 'monsterSwarm'));
});

test('Shadow People strike a player who enters a lit space, not a dark one', async () => {
  const { onPlayerEnters } = await import('../src/game/monsterTurn.js');
  const g = street();
  g.apply(g.index(5, 12), { lit: true, radius: 1 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 5, startMode: 'midnight', config: { players: 1, monsterPick: 'shadow-people' } });
  const pl = state.players[0];
  const ctx = { state, log: () => {}, randInt: (s, n) => Math.floor(Math.random() * n) };
  const dark = [];
  onPlayerEnters(state, board, pl, g.index(12, 12), ctx, dark);
  assert.equal(dark.length, 0, 'nothing in the dark');
  const lit = [];
  onPlayerEnters(state, board, pl, g.index(5, 12), ctx, lit);
  assert.ok(lit.some((e) => e.type === 'monsterAttack' && e.grab));
  assert.ok(lit.some((e) => e.type === 'damage'));
});

test('Adze attacks name a target spot and a damage die', () => {
  const p = parseAbility('Attack ({1}, die) and Exhaust (defensive die)');
  assert.equal(p.ops[0].op, 'attack');
  assert.deepEqual(p.ops[0].dmg, { dice: 1 });
});

// Three buildings along the street, each with an Objective marker.
function townWithBuildings() {
  const g = street();
  for (const [x0, site] of [[2, 'hotel'], [7, 'bar'], [12, 'hospital']]) {
    for (let x = x0; x < x0 + 3; x++) for (let y = 9; y < 12; y++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
    g.apply(g.index(x0 + 1, 10), { marker: 'objective', site }, { silent: true });
  }
  // (street()'s row-0 sites stand aside: these are the victims' buildings.)
  for (let x = 0; x < 16; x++) g.apply(g.index(x, 0), { marker: null, site: null }, { silent: true });
  return g;
}
const adzeGame = (seed = 4) => {
  const g = townWithBuildings();
  const board = createBoard(g);
  const { state } = newGame(board, { seed, startMode: 'midnight', config: { players: 3, monsterPick: 'adze' } });
  state.players = [state.players[0]];          // three victims (three players), then one player plays
  // These check one strike: no warning round, and swarms that arrive at once.
  delete state.monsters[0].gathering;
  state.swarmSpeed = 99;
  return { g, board, state, act: (a) => applyAction(state, board, { ...a, seat: 0 }) };
};
const victimAction = (n, ops) => ({ roll: n, ability: 0, name: 'Hotel Victim', kind: 'spiritual', text: '', ops, unknown: [] });
// A swarm already settled beside victim `v`: it strikes on the Adze's next turn.
const settled = (state, g, v, dmg, { exhaust = false, n = 1 } = {}) => {
  const { x, y } = g.coords(v.cell);
  state.swarms = [...(state.swarms ?? []), ...Array.from({ length: n }, (_, k) => ({ id: `t${k}`, victim: v.id, pos: g.index(x, y - 1), dmg: { fixed: dmg }, type: 'S', exhaust, ready: true }))];
  state.monsters[0].intents = [];
};

test('the Adze’s three victims lie at the Hotel, the Bar and the Hospital', () => {
  const { g, state } = adzeGame();
  assert.equal(state.npcs.length, 3);
  assert.deepEqual(state.npcs.map((v) => v.target).sort((a, b) => a - b), [1, 5, 13]);
  const xs = state.npcs.map((v) => g.coords(v.cell).x).sort((a, b) => a - b);
  assert.deepEqual(xs, [3, 8, 13], 'one per building');
  for (const v of state.npcs) assert.equal(g.cells[v.cell].marker, 'objective');
});

test('an undefended victim dies and every player suffers a Global Attack', () => {
  const { g, state, act } = adzeGame();
  const v = state.npcs.find((x) => x.target === 1);
  v.wounded = true;                                          // already hurt once
  settled(state, g, v, 4);
  act({ type: 'roll' });
  const r = act({ type: 'end' });
  const hit = r.events.find((e) => e.type === 'npcAttacked');
  assert.equal(hit.outcome, 'killed');
  assert.equal(v.alive, false);
  assert.ok(r.events.some((e) => e.type === 'damage' && e.seat === 0), 'global attack on the players');
});

test('a player in Close range with enough defense saves the victim, and keeps the die; a strike that gets past them exhausts it', () => {
  const { g, state, act } = adzeGame();
  const v = state.npcs.find((x) => x.target === 1);
  const pl = state.players[0];
  settled(state, g, v, 3, { exhaust: true });
  act({ type: 'roll' });
  const { x, y } = g.coords(v.cell);
  pl.pos = g.index(x + 1, y + 1);              // diagonal: Close range
  state.pool = [{ kind: 'black', v: 5 }];
  state.maxDefense = 1;
  act({ type: 'slot', die: 0, to: 'defense' });
  act({ type: 'end' });
  assert.ok(v.alive && !v.wounded, 'saved');
  assert.ok(!pl.lostBlack, 'a block costs nothing for good');
  // The same, but the swarm hits harder than the defense: wounded, and the die is gone.
  const b = adzeGame();
  const v2 = b.state.npcs.find((x) => x.target === 1);
  const p2 = b.state.players[0];
  settled(b.state, b.g, v2, 9, { exhaust: true });
  const { x: x2, y: y2 } = b.g.coords(v2.cell);
  p2.pos = b.g.index(x2 + 1, y2 + 1);
  p2.defense = [{ kind: 'black', v: 5 }];
  const ev = [];
  const { executeIntent } = MT;
  b.state.monsters[0].intents = [];
  executeIntent(b.state, b.board, b.state.monsters[0], { state: b.state, log: () => {}, randInt: () => 0 }, ev);
  assert.ok(v2.wounded);
  assert.equal(p2.lostBlack, 1, 'got past them: the die is exhausted');
});

test('with every victim dead, the Adze attacks everyone', () => {
  const { state, act } = adzeGame();
  for (const v of state.npcs) v.alive = false;
  state.monsters[0].intents = [victimAction(1, [{ op: 'attack', dmg: { fixed: 9 }, target: 1 }])];
  act({ type: 'roll' });
  const r = act({ type: 'end' });
  assert.ok(r.events.some((e) => e.type === 'damage' && e.seat === 0));
});

test('Exhaust (Movement die) takes a die the player moved with', async () => {
  const { exhaust } = await import('../src/game/monsterTurn.js');
  const pl = { name: 'P1', seat: 0, lastMove: [{ kind: 'black', v: 2 }, { kind: 'white', v: 6 }], defense: [] };
  const ev = [];
  exhaust({}, pl, 'movement', { log: () => {} }, ev);
  assert.equal(pl.lastMove.length, 1);
  assert.equal(ev[0].dice[0].kind, 'white');
  assert.equal(pl.lostBlack ?? 0, 0, 'a white die is simply gone');
  assert.deepEqual(parseAbility('Exhaust (Defensive die) and Attack (die)').ops.map((o) => o.op), ['exhaust', 'attack']);
});

test('each action carries the damage type of its icon colour on the card (red P, blue M, green S, grey none)', () => {
  // Read off the monster cards: the symbol left of each action.
  const icons = {
    werewolf: ['P', 'M', '-'], barghest: ['M', '-', 'S'], hellhounds: ['-', 'P', 'P'], skinwalker: ['P', 'P', 'S'],
    wendigo: ['-', 'P', 'P'], banshee: ['-', 'M', 'P'], 'ushi-oni': ['P', 'P', 'S'], redcap: ['P', 'P'],
    poltergeist: ['M', 'P'], 'white-lady': ['-', 'P', 'M'], strigoi: ['S', 'S', 'P'], adze: ['S', 'S', 'S'],
    'shadow-people': ['P', '-'],
  };
  const code = { physical: 'P', mental: 'M', spiritual: 'S', none: '-' };
  for (const c of MONSTER_CARDS) assert.deepEqual(c.abilities.map((a) => code[a.kind]), icons[c.id], c.name);
});

test('danger records the damage type threatening each player', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 6, startMode: 'midnight', config: { players: 1, monsterPick: 'redcap' } });
  const mo = state.monsters[0];
  const { x, y } = board.grid.coords(state.players[0].pos);
  mo.pos = board.grid.index(x - 1, y);
  applyAction(state, board, { type: 'roll', seat: 0 });
  assert.deepEqual(mo.dangerTypes[0], ['P']);
});

test('at the Investigate? prompt you can still brace: slot dice and roll white dice into Defense', () => {
  const g = street();
  g.apply(g.index(17, 12), { marker: 'investigation' }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 3, config: { players: 1 } });
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  const pl = state.players[0];
  pl.white = 1;
  act({ type: 'roll' });
  state.pool = [{ kind: 'black', v: 1 }, { kind: 'black', v: 4 }];
  state.maxDefense = 2;
  act({ type: 'slot', die: 0, to: 'move' });
  act({ type: 'move' });
  if (state.phase === 'choosing') act({ type: 'choose', cell: g.index(17, 12) });
  assert.equal(state.phase, 'asking');
  assert.ok(act({ type: 'slot', die: 1, to: 'defense' }).ok);
  assert.ok(act({ type: 'rollWhite' }).ok);
  assert.ok(act({ type: 'slot', die: 2, to: 'defense' }).ok);
  assert.equal(pl.defense.length, 2, 'defense is live before the draw');
  // Stopped at the prompt, a die can go into Movement too: it joins the move
  // when a direction is picked.
  assert.ok(act({ type: 'slot', die: 1, to: 'defense' }).ok, 'take it back out of Defense');
  assert.ok(act({ type: 'slot', die: 1, to: 'move' }).ok, 'movement can be slotted at a stop');
});

test('every attack wears down what defense is left: 6 blocks a 3, leaving 3, so a 4 hits', async () => {
  const { defenseLeft } = await import('../src/game/combat.js');
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 1, config: { players: 1 } });
  const pl = state.players[0];
  const ev = [];
  pl.defense = [{ kind: 'black', v: 6 }];
  assert.equal(applyDamage(state, board, pl, 'P', 3, quiet, ev), 'blocked');
  assert.equal(defenseLeft(pl), 3);
  assert.equal(applyDamage(state, board, pl, 'P', 4, quiet, ev), 'injured');
  assert.equal(ev.at(-1).defense, 3, 'the 4 met the 3 that was left');
  assert.equal(defenseLeft(pl), 0, 'used up');
});

test('defending a victim wears your defense down too', () => {
  const { g, state, act } = adzeGame();
  const v = state.npcs.find((x) => x.target === 1);
  const pl = state.players[0];
  v.wounded = true;
  settled(state, g, v, 3, { n: 2 });
  act({ type: 'roll' });
  const { x, y } = g.coords(v.cell);
  pl.pos = g.index(x + 1, y + 1);              // Close range
  state.pool = [{ kind: 'black', v: 5 }];
  state.maxDefense = 1;
  act({ type: 'slot', die: 0, to: 'defense' });
  const r = act({ type: 'end' });
  const hits = r.events.filter((e) => e.type === 'npcAttacked');
  assert.equal(hits[0].outcome, 'saved', '5 holds the first 3');
  assert.equal(hits[1].outcome, 'killed', 'only 2 left for the second 3');
  assert.equal(hits[1].defense, 2);
});

test('Adze: victims out when identified; a gathering turn; one swarm per victim, 6 a turn, settles beside, strikes next turn', async () => {
  const { SWARM_SPEED } = await import('../src/game/monsterTurn.js');
  assert.equal(SWARM_SPEED, 6);
  const g = townWithBuildings();
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 4, startMode: 'midnight', config: { players: 3, monsterPick: 'adze' } });
  state.players = [state.players[0]];
  const mo = state.monsters[0];
  assert.ok(mo.gathering, 'it rises gathering its swarms');
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  mo.intents = [victimAction(1, [{ op: 'attack', dmg: { fixed: 9 }, target: 13 }])];
  act({ type: 'roll' });
  let r = act({ type: 'end' });
  assert.ok(!r.events.some((e) => e.type === 'npcAttacked'), 'the first turn: no swarm');
  // Two swarms for the same victim: the second goes after another one.
  mo.pos = g.index(0, 9);
  mo.intents = [victimAction(5, [{ op: 'attack', dmg: { fixed: 9 }, target: 13 }]), victimAction(5, [{ op: 'attack', dmg: { fixed: 9 }, target: 13 }])];
  act({ type: 'roll' });
  r = act({ type: 'end' });
  assert.equal(state.swarms.length, 2);
  assert.notEqual(state.swarms[0].victim, state.swarms[1].victim, 'one swarm per victim');
  const far = state.swarms.find((sw) => sw.victim === 'v13');
  assert.equal(far.pos, g.index(6, 9), '6 spaces');
  // Fly on until it settles beside the victim; it strikes only on the turn after.
  let turns = 0;
  while (!far.ready && turns < 5) { mo.intents = []; act({ type: 'roll' }); act({ type: 'end' }); turns++; }
  const v = state.npcs.find((x) => x.id === 'v13');
  assert.ok(far.ready);
  assert.equal(Math.max(Math.abs(g.coords(far.pos).x - g.coords(v.cell).x), Math.abs(g.coords(far.pos).y - g.coords(v.cell).y)), 1, 'right beside');
  assert.ok(v.alive && !v.wounded, 'not yet');
  mo.intents = [];
  act({ type: 'roll' });
  r = act({ type: 'end' });
  assert.equal(r.events.find((e) => e.type === 'npcAttacked' && e.npc === 'v13')?.outcome, 'wounded', 'the next turn; survives the first hit');
  // Before midnight: identified by its evidence, its victims come out.
  const g2 = townWithBuildings();
  const b2 = createBoard(g2);
  const s2 = newGame(b2, { seed: 4, config: { players: 3, monsterPick: 'adze' } }).state;
  assert.equal(s2.npcs.length, 0, 'not yet');
  s2.mystery.identified = true;
  assert.ok(applyAction(s2, b2, { type: 'roll', seat: 0 }).ok);
  assert.equal(s2.npcs.length, 3, 'out as soon as the team knows');
});

test('Adze: Fire wears a swarm down (4 health); alight, it flies back and burns the Nest for 3, through its toughness', () => {
  const { g, board, state, act } = adzeGame();
  const pl = state.players[0];
  const mo = state.monsters[0];
  const v = state.npcs.find((x) => x.target === 13);
  state.swarms = [{ id: 'f1', victim: v.id, pos: g.index(5, 5), dmg: { fixed: 4 }, type: 'S', exhaust: true }];
  mo.pos = g.index(1, 5);
  pl.pos = g.index(5, 4);                     // Close range
  pl.inventory.equipment = [{ id: 'dragons-breath-shotgun' }];
  act({ type: 'roll' });
  state.pool = [{ kind: 'black', v: 6 }, { kind: 'black', v: 6 }]; state.slots = []; state.defSlots = [];
  const card = EQUIPMENT_BY_ID['dragons-breath-shotgun'];
  const k = card.abilities.findIndex((a) => a.kind === 'fire' && a.fx?.dmg !== undefined);
  const r = act({ type: 'use', item: 0, ability: k, dice: card.abilities[k].dice === 2 ? [0, 1] : [0], target: { swarm: 'f1' } });
  assert.ok(r.ok, r.error);
  assert.ok(state.swarms[0].burning);
  const hp = mo.hp;
  mo.intents = [];
  act({ type: 'end' });
  assert.equal(state.swarms.length, 0, 'back in the hive');
  assert.equal(mo.hp, hp - 3, '3 piercing');
  void board;
});

test('Adze: any Fire attack counts against a swarm’s 4 health (two Molotovs light it)', () => {
  const { g, state, act } = adzeGame();
  const pl = state.players[0];
  const v = state.npcs.find((x) => x.target === 13);
  state.swarms = [{ id: 'f2', victim: v.id, pos: g.index(5, 5), dmg: { fixed: 4 }, type: 'S', exhaust: true }];
  pl.pos = g.index(5, 3);
  pl.inventory.equipment = [{ id: 'molotov-cocktail' }, { id: 'molotov-cocktail' }];
  act({ type: 'roll' });
  state.pool = [3, 3, 3, 3].map((v2) => ({ kind: 'black', v: v2 }));   // Immolate: exactly 6 on two dice state.slots = []; state.defSlots = [];
  assert.ok(act({ type: 'use', item: 0, ability: 0, dice: [0, 1], target: { swarm: 'f2' } }).ok);
  assert.equal(state.swarms[0].hp, 1, '4 − 3: singed');
  assert.ok(!state.swarms[0].burning);
  assert.ok(act({ type: 'use', item: 0, ability: 0, dice: [2, 3], target: { swarm: 'f2' } }).ok);
  assert.ok(state.swarms[0].burning);
});

test('Adze: one victim per investigator (all three with three or more; solo, all three in the Hospital)', () => {
  for (const [n, want] of [[1, 3], [2, 2], [3, 3], [4, 3]]) {   // solo: all three, in the Hospital
    const g = townWithBuildings();
    const board = createBoard(g);
    const { state } = newGame(board, { seed: 4, startMode: 'midnight', config: { players: n, monsterPick: 'adze' } });
    assert.equal(state.npcs.length, want, `${n} players`);
  }
});

test('Adze: a swarm beaten off costs the Nest 2, through its toughness; solo, all three victims are in the Hospital', () => {
  const { g, state, act } = adzeGame();
  const v = state.npcs.find((x) => x.target === 1);
  const pl = state.players[0];
  const mo = state.monsters[0];
  settled(state, g, v, 3);
  act({ type: 'roll' });
  const { x, y } = g.coords(v.cell);
  pl.pos = g.index(x + 1, y + 1);
  state.pool = [{ kind: 'black', v: 5 }];
  state.maxDefense = 1;
  act({ type: 'slot', die: 0, to: 'defense' });
  const hp = mo.hp;
  act({ type: 'end' });
  assert.ok(v.alive && !v.wounded);
  assert.equal(mo.hp, hp - 2);
  // Solo: three victims, side by side in the Hospital.
  const g2 = townWithBuildings();
  const b2 = createBoard(g2);
  const s2 = newGame(b2, { seed: 4, startMode: 'midnight', config: { players: 1, monsterPick: 'adze' } }).state;
  assert.equal(s2.npcs.length, 3);
  for (const n of s2.npcs) assert.ok(g2.coords(n.cell).x >= 12 && g2.coords(n.cell).x < 15, 'inside the Hospital (x 12-14)');
  assert.equal(new Set(s2.npcs.map((n) => n.cell)).size, 3, 'each on its own space');
});

test('Adze solo: one swarm strikes per turn (the rest wait), and a failed block exhausts nothing', () => {
  const { g, state, act } = adzeGame();
  state.config.players = 1;                    // played solo
  const pl = state.players[0];
  const [a, b] = state.npcs;
  settled(state, g, a, 9, { exhaust: true });
  settled(state, g, b, 9, { exhaust: true });
  act({ type: 'roll' });
  const { x, y } = g.coords(a.cell);
  pl.pos = g.index(x + 1, y + 1);
  state.pool = [{ kind: 'black', v: 2 }];
  state.maxDefense = 1;
  act({ type: 'slot', die: 0, to: 'defense' });
  const r = act({ type: 'end' });
  const hits = r.events.filter((e) => e.type === 'npcAttacked');
  assert.equal(hits.length, 1, 'only one swarm strikes this turn');
  assert.ok(a.wounded, 'got past the defense');
  assert.ok(!pl.lostBlack, 'solo: no die exhausted');
  assert.equal(state.swarms.length, 1, 'the other swarm waits beside its victim');
  assert.ok(state.swarms[0].ready);
});

test('Adze solo: one swarm on the map at a time, 2 health, and the Nest has no toughness', () => {
  const g = townWithBuildings();
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 4, startMode: 'midnight', config: { players: 1, monsterPick: 'adze' } });
  const mo = state.monsters[0];
  assert.equal(mo.tough, 0, 'no toughness solo');
  delete mo.gathering;
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  mo.pos = g.index(0, 9);
  mo.intents = [victimAction(1, [{ op: 'attack', dmg: { fixed: 9 }, target: 1 }]), victimAction(5, [{ op: 'attack', dmg: { fixed: 9 }, target: 5 }])];
  act({ type: 'roll' });
  act({ type: 'end' });
  assert.equal(state.swarms.length, 1, 'one at a time');
  assert.equal(state.swarms[0].hp, 2);
  // While it's out, no other swarm leaves the hive.
  mo.intents = [victimAction(5, [{ op: 'attack', dmg: { fixed: 9 }, target: 5 }])];
  act({ type: 'roll' });
  act({ type: 'end' });
  assert.ok(state.swarms.length <= 1);
});
