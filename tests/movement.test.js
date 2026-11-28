// Movement: what a player can do when stopped, doubling back, and the two
// movement modes (Quick and Tactical).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';

// A street along row 5 with the van at the east end (players start at 18,5),
// crossed by a north-south street at x = 10.
function setup(config = {}) {
  const g = new GridState(20, 12);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  for (let y = 0; y < 12; y++) g.apply(g.index(10, y), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 7, config: { players: 1, monster: 'none', ...config } });
  const act = (a) => applyAction(state, board, { ...a, seat: state.cur });
  const at = (x, y) => g.index(x, y);
  // Roll, then set the dice (so moves are known) and move by the first.
  const moveBy = (...values) => {
    assert.ok(act({ type: 'roll' }).ok);
    state.pool = values.map((v) => ({ kind: 'black', v }));
    state.maxSlots = 3;
    assert.ok(act({ type: 'slot', die: 0, to: 'move' }).ok);
    assert.ok(act({ type: 'move' }).ok);
  };
  return { g, board, state, act, at, moveBy, pl: state.players[0] };
}

test('Quick movement runs on by itself and stops at the fork, where every way is open, back included', () => {
  const { state, act, at, moveBy, pl } = setup();
  assert.equal(pl.pos, at(18, 5));
  moveBy(6, 3);                                   // 18 -> 12: out of moves before the fork
  assert.equal(state.phase, 'slotting');
  assert.equal(pl.pos, at(12, 5));
  assert.ok(act({ type: 'slot', die: 1, to: 'move' }).ok);
  assert.ok(act({ type: 'move' }).ok);
  // Moving off from a standstill, both ways along the street are open.
  assert.equal(state.phase, 'choosing');
  assert.deepEqual(state.options.map((o) => o.name).sort(), ['east', 'west']);
  assert.ok(act({ type: 'choose', cell: at(11, 5) }).ok); // west: runs on to the fork, 1 left
  assert.equal(state.phase, 'choosing');
  assert.equal(pl.pos, at(10, 5));
  assert.equal(state.steps, 1);
  assert.ok(state.options.some((o) => o.i === at(11, 5)), 'back east is offered');
});

test('at a fork: doubling back is offered, and the player can roll, slot, use and craft before choosing', () => {
  const { state, act, at, moveBy, pl } = setup();
  pl.white = 1;
  moveBy(9, 4);                                   // 18 -> 10 (the fork) with 1 move left
  assert.equal(state.phase, 'choosing');
  assert.equal(pl.pos, at(10, 5));
  assert.equal(state.steps, 1);
  const ways = state.options.map((o) => o.name).sort();
  assert.deepEqual(ways, ['east', 'north', 'south', 'west'], 'east is back the way it came');
  // Everything a stop allows:
  assert.ok(act({ type: 'rollWhite' }).ok, 'roll a white die');
  assert.ok(act({ type: 'slot', die: 2, to: 'defense' }).ok, 'slot it into Defense');
  assert.ok(act({ type: 'slot', die: 1, to: 'move' }).ok, 'slot the 4 into Movement');
  const craft = act({ type: 'craft', recipe: 'nothing' });
  assert.notEqual(craft.error, 'finish moving first', 'Obolcraft is open at a stop');
  const use = act({ type: 'use', item: 0, ability: 0 });
  assert.notEqual(use.error, 'finish moving first', 'equipment is open at a stop');
  // Doubling back with the new die: 1 + 4 moves east.
  assert.ok(act({ type: 'choose', cell: at(11, 5) }).ok);
  assert.equal(pl.pos, at(15, 5), 'went back east 5 spaces');
  assert.equal(state.phase, 'idle', 'nothing left to use: the turn ended');
  assert.equal(pl.defense.length, 1, 'the white die stays in Defense');
});

test('ending the turn at a stop gives up the moves left', () => {
  const { state, act, moveBy } = setup();
  moveBy(9);
  assert.equal(state.phase, 'choosing');
  assert.ok(act({ type: 'end' }).ok);
  assert.equal(state.phase, 'idle');
  assert.equal(state.steps, 0);
});

test('Tactical movement asks for a direction at every step, back included', () => {
  const { state, act, at, moveBy, pl } = setup({ movement: 'tactical' });
  moveBy(3);
  const prompts = [];
  for (let k = 0; k < 5 && state.phase === 'choosing'; k++) {
    prompts.push(state.options.map((o) => o.name).sort().join(','));
    assert.ok(act({ type: 'choose', cell: pl.pos - 1 }).ok);   // west each time
  }
  assert.equal(prompts.length, 3, 'one prompt per step');
  assert.deepEqual(prompts.slice(1), ['east,west', 'east,west'], 'on a plain street: on, or back');
  assert.equal(pl.pos, at(15, 5));
  assert.equal(state.phase, 'idle', 'nothing left to do: the turn ends');
});

test('out of moves: the turn waits for End turn while there is something left to use', () => {
  const { state, act, moveBy, pl } = setup();
  pl.inventory.obolcraft.push({ type: 'event' });
  moveBy(2);
  assert.equal(state.phase, 'slotting', 'holding an Obol: Obolcraft is still possible');
  assert.ok(act({ type: 'end' }).ok);
  pl.inventory.obolcraft = [];
  moveBy(2);
  if (state.phase === 'choosing') assert.ok(act({ type: 'choose', cell: pl.pos - 1 }).ok); // from a standstill: west
  assert.equal(state.phase, 'idle', 'no dice, white dice, equipment or Obols: the turn ends by itself');
});

test('movement mode and Follow streets can be switched mid-game, through the rules', () => {
  const { state, act, moveBy } = setup();
  assert.ok(act({ type: 'setting', key: 'movement', value: 'tactical' }).ok);
  assert.equal(state.config.movement, 'tactical');
  moveBy(3);
  assert.equal(state.phase, 'choosing', 'Tactical now: a prompt even with one way on');
  assert.ok(act({ type: 'setting', key: 'movement', value: 'quick' }).ok);
  assert.ok(act({ type: 'choose', cell: state.options[0].i }).ok);
  assert.equal(state.phase, 'idle', 'Quick again: ran the rest of the way, turn over');
  assert.ok(act({ type: 'setting', key: 'followStreets', value: false }).ok);
  assert.equal(state.followStreets, false);
  assert.equal(act({ type: 'setting', key: 'nope', value: 1 }).ok, false);
});
