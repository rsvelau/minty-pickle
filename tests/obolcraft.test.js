import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { RECIPES, RECIPE_BY_ID, autoPay, payFits } from '../src/game/obolcraft.js';

const setup = (players = 2) => {
  const g = new GridState(20, 26);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 12), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 12), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 2, config: { players } });
  const give = (pl, ...types) => { for (const type of types) pl.inventory.obolcraft.push({ type }); };
  return { board, state, give, act: (a) => applyAction(state, board, { ...a, seat: state.cur }) };
};

test('recipes match the Player Mat', () => {
  assert.equal(RECIPES.length, 6);
  assert.deepEqual(RECIPE_BY_ID.resurrect.cost.filter((c) => c === 'any').length, 3);
});

test('black slots take any colour; named slots need their colour', () => {
  const r = RECIPE_BY_ID['heal-P'];
  assert.ok(payFits(r, [{ type: 'attack' }, { type: 'evidence' }], [0, 1]));
  assert.ok(!payFits(r, [{ type: 'event' }, { type: 'evidence' }], [0, 1]));
  assert.deepEqual(autoPay(r, [{ type: 'evidence' }, { type: 'attack' }, { type: 'event' }, { type: 'event' }]), [1, 2]);
});

test('healing a tier spends the Obols', () => {
  const { state, give, act } = setup(1);
  const pl = state.players[0];
  pl.injuries.P = 2;
  give(pl, 'attack', 'event');
  assert.ok(act({ type: 'craft', recipe: 'heal-P' }).ok);
  assert.equal(pl.injuries.P, 1);
  assert.equal(pl.inventory.obolcraft.length, 0);
  assert.equal(act({ type: 'craft', recipe: 'heal-P' }).ok, false);
});

test('can\'t heal what isn\'t hurt, or pay with the wrong colours', () => {
  const { state, give, act } = setup(1);
  const pl = state.players[0];
  give(pl, 'event', 'event');
  pl.injuries.P = 1;
  assert.equal(act({ type: 'craft', recipe: 'heal-M' }).ok, false);
  assert.equal(act({ type: 'craft', recipe: 'heal-P' }).ok, false);
});

test('draw Equipment, and resonant white dice come back', () => {
  const { state, give, act } = setup(1);
  const pl = state.players[0];
  give(pl, 'attack', 'attack', 'event', 'evidence', 'equipment');
  assert.ok(act({ type: 'craft', recipe: 'equipment' }).ok);
  assert.equal(pl.inventory.equipment.length, 1);
  assert.ok(act({ type: 'craft', recipe: 'resonant' }).ok);
  pl.white = 1;
  act({ type: 'roll' });
  act({ type: 'rollWhite' });
  assert.equal(pl.white, 0);
  act({ type: 'end' });
  assert.equal(pl.white, 1, 'the resonant die returned to the reserve');
});

test('resurrect a dead player at your location', () => {
  const { state, give, act } = setup(2);
  const [a, b] = state.players;
  b.dead = true; b.injuries = { P: 3, M: 0, S: 0 }; b.pos = 0;
  give(a, 'attack', 'event', 'equipment', 'evidence', 'attack', 'attack', 'evidence');
  const r = act({ type: 'craft', recipe: 'resurrect', target: 1 });
  assert.ok(r.ok, r.error);
  assert.equal(b.dead, false);
  assert.equal(b.pos, a.pos);
  assert.deepEqual(b.injuries, { P: 0, M: 0, S: 0 });
});
