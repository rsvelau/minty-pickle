// The travel Events: Hidden Passage, Peculiar Mirror, Hiding Spot, Decrepit Truck (src/game/travel.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction, nextOptions } from '../src/game/rules.js';
import { farEndCells, placeLink, travelOptions, afterTravel, placeHidingSpot, hide, placeTruck, travelOf } from '../src/game/travel.js';
import { applyDamage } from '../src/game/combat.js';
import { armMonster } from '../src/game/equipmentPlay.js';

// A 30 x 5 street, Investigation spaces along it; the Start at the east end.
function setup(players = 1) {
  const g = new GridState(30, 5);
  for (let x = 0; x < 30; x++) g.apply(g.index(x, 2), { area: 'outdoor', sub: 'street' }, { silent: true });
  for (let x = 0; x < 30; x++) g.apply(g.index(x, 3), { area: 'outdoor', sub: 'grass' }, { silent: true });
  g.apply(g.index(29, 2), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (const x of [2, 8, 14, 20, 26]) g.apply(g.index(x, 3), { marker: 'investigation' }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 5, startMode: 'midnight', config: { players, monster: 'none' } });
  const log = [];
  const ctx = { state, log: (s, m) => log.push(m), randInt: () => 1 };   // coins: tails
  return { g, board, state, ctx, log, act: (a) => applyAction(state, board, { seat: state.cur, ...a }) };
}

test('Hidden Passage: the far end on an Investigation space within 10; through it for 5 movement', () => {
  const { g, board, state, ctx } = setup();
  const from = g.index(14, 3);
  const cells = farEndCells(state, board, 'hidden-passage', from);
  assert.deepEqual(cells.map((i) => g.coords(i).x).sort((a, b) => a - b), [8, 20], 'Investigation spaces within 10 only');
  placeLink(state, board, 'hidden-passage', from, g.index(20, 3), ctx, []);
  const pl = state.players[0];
  pl.pos = from;
  state.steps = 4;
  assert.equal(travelOptions(state, pl).length, 0, 'not with less than 5');
  state.steps = 6;
  const o = travelOptions(state, pl)[0];
  assert.equal(o.i, g.index(20, 3));
  assert.equal(o.cost, 5);
});

test('Peculiar Mirror: any Investigation space, free to step through; tails costs an Obol', () => {
  const { g, board, state, ctx, log } = setup();
  const from = g.index(2, 3);
  assert.ok(farEndCells(state, board, 'peculiar-mirror', from).includes(g.index(26, 3)), 'any distance');
  placeLink(state, board, 'peculiar-mirror', from, g.index(26, 3), ctx, []);
  const pl = state.players[0];
  pl.pos = from;
  state.steps = 1;
  const o = travelOptions(state, pl)[0];
  assert.equal(o.cost, 0);
  pl.inventory.obolcraft = [{ type: 'bone' }, { type: 'ash' }, { type: 'bone' }];
  afterTravel(state, board, pl, o, ctx, []);
  assert.equal(pl.inventory.obolcraft.length, 2, 'tails: an Obol lost');
  assert.ok(log.some((m) => /Tails/.test(m)));
});

test('Moving: a passage end stops the pawn and offers the way through, which costs 5 and lands on the far end', () => {
  const { g, board, state, ctx, act } = setup();
  placeLink(state, board, 'hidden-passage', g.index(14, 3), g.index(20, 3), ctx, []);
  const pl = state.players[0];
  pl.pos = g.index(14, 3);
  state.phase = 'choosing';
  state.steps = 7;
  state.options = nextOptions(state, board, { back: true });
  const via = state.options.find((o) => o.travel === 'passage');
  assert.ok(via, 'offered at the fork');
  assert.ok(act({ type: 'choose', cell: via.i }).ok);
  assert.equal(pl.pos, g.index(20, 3));
  assert.ok(state.steps <= 2, '5 spent');
});

test('Hiding Spot: once; hidden players are out of reach; rolling brings them out; the time runs out', () => {
  const { g, board, state, ctx } = setup();
  const pl = state.players[0];
  pl.pos = g.index(8, 3);
  placeHidingSpot(state, board, pl.pos, ctx, []);
  assert.equal(hide(state, board, pl, ctx, []), null);
  assert.ok(pl.hiding);
  assert.equal(applyDamage(state, board, pl, 'P', 9, { log: () => {} }, []), 'blocked');
  assert.equal(pl.injuries.P, 0, 'no new injury');
  // Used once: no second hide there.
  delete pl.hiding;
  assert.notEqual(hide(state, board, pl, ctx, []), null);
  // Through play: hiding ends the turn; on the next one, roll to come out.
  const s2 = setup();
  const p2 = s2.state.players[0];
  p2.pos = s2.g.index(8, 3);
  placeHidingSpot(s2.state, s2.board, p2.pos, s2.ctx, []);
  s2.state.phase = 'idle';
  assert.ok(s2.act({ type: 'hide' }).ok);
  assert.ok(p2.hiding);
  assert.equal(s2.state.phase, 'idle', 'the turn passed (solo: their next turn)');
  assert.ok(s2.act({ type: 'stay' }).ok, 'stay hidden');
  assert.ok(p2.hiding);
  assert.ok(s2.act({ type: 'roll' }).ok);
  assert.ok(!p2.hiding, 'rolling: out of hiding');
});

test('Decrepit Truck: on the nearest road; get in within a space; its turn comes after the players; into the monster: damage and a Stun; then it is wrecked', () => {
  const { g, board, state, ctx, act } = setup();
  const pl = state.players[0];
  pl.pos = g.index(10, 3);
  placeTruck(state, board, pl, ctx, []);
  const tr = travelOf(state).truck;
  assert.equal(tr.cell, g.index(10, 2), 'the road beside them');
  // A monster down the road.
  const m = { id: 'm1', kind: 'werewolf', pos: g.index(13, 2), prev: -1, revealed: true };
  armMonster(m);
  m.intents = [{ name: 'x', ops: [] }];
  state.monsters = [m];
  state.phase = 'idle';
  assert.ok(act({ type: 'board' }).ok);
  assert.equal(pl.pos, tr.cell);
  assert.ok(tr.aboard.includes(0));
  // End the turn (roll, then end): the truck's turn comes before the monster's.
  act({ type: 'roll' });
  act({ type: 'end' });
  assert.equal(state.phase, 'driving');
  assert.ok(state.options.some((o) => o.i === g.index(11, 2)));
  const hp = m.hp;
  act({ type: 'drive', cell: g.index(11, 2) });
  act({ type: 'drive', cell: g.index(12, 2) });
  assert.equal(pl.pos, g.index(12, 2), 'riders go with it');
  const r = act({ type: 'drive', cell: g.index(13, 2) });
  assert.ok(r.ok);
  assert.ok(m.hp < hp || m.hp === hp, 'damage through its toughness');
  assert.equal(travelOf(state).truck, null, 'wrecked');
  assert.notEqual(state.phase, 'driving');
  assert.ok(r.events.some((e) => e.type === 'monsterStunned'));
});

test('Decrepit Truck: parking ends the drive and wrecks it', () => {
  const { g, board, state, ctx, act } = setup();
  const pl = state.players[0];
  pl.pos = g.index(10, 2);
  placeTruck(state, board, pl, ctx, []);
  state.phase = 'idle';
  act({ type: 'board' });
  act({ type: 'roll' });
  act({ type: 'end' });
  assert.equal(state.phase, 'driving');
  act({ type: 'drive', cell: g.index(9, 2) });
  assert.ok(act({ type: 'park' }).ok);
  assert.equal(travelOf(state).truck, null);
  assert.equal(pl.pos, g.index(9, 2));
  assert.equal(state.phase, 'idle', 'on to the next turn');
});
