// Scouting: before the first turn, players + 1 Equipment cards are offered
// and each player takes one, in seat order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';

function setup(players = 3, scout = true) {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state, events } = newGame(board, { seed: 9, scout, config: { players, monster: 'none' } });
  return { board, state, events, act: (a) => applyAction(state, board, a) };
}

test('the offer: players + 1 cards from the Equipment deck, face up, before anyone rolls', () => {
  const s = setup(3);
  assert.equal(s.state.phase, 'scouting');
  assert.equal(s.state.scouting.offer.length, 4);
  assert.ok(s.events.some((e) => e.type === 'scouting'));
  assert.match(s.act({ type: 'roll', seat: 0 }).error, /cannot roll/);
});

test('each takes one in seat order; the rest go back under the deck; then P1 rolls', () => {
  const s = setup(3);
  const deck = s.state.decks.equipment.length;
  const offer = [...s.state.scouting.offer];
  assert.match(s.act({ type: 'scout', seat: 1, card: 0 }).error, /not your turn/);
  assert.ok(s.act({ type: 'scout', seat: 0, card: 1 }).ok);
  assert.deepEqual(s.state.players[0].inventory.equipment.map((e) => [e.id, e.from]), [[offer[1], 'Scouting']]);
  assert.equal(s.state.cur, 1);
  assert.ok(s.act({ type: 'scout', seat: 1, card: 0 }).ok);
  assert.equal(s.state.players[1].inventory.equipment[0].id, offer[0]);
  assert.ok(s.act({ type: 'scout', seat: 2, card: 1 }).ok);
  assert.equal(s.state.players[2].inventory.equipment[0].id, offer[3]);
  assert.equal(s.state.phase, 'idle');
  assert.equal(s.state.cur, 0);
  assert.equal(s.state.scouting, null);
  assert.equal(s.state.decks.equipment.length, deck + 1, 'the one left over is back');
  assert.equal(s.state.decks.equipment[0], offer[2], 'under the deck');
  assert.ok(s.act({ type: 'roll', seat: 0 }).ok);
});

test('solo: two cards, one choice; turned off, no scouting', () => {
  const s = setup(1);
  assert.equal(s.state.scouting.offer.length, 2);
  assert.ok(s.act({ type: 'scout', seat: 0, card: 0 }).ok);
  assert.equal(s.state.phase, 'idle');
  assert.equal(setup(2, false).state.phase, 'idle');
});
