// Doors in play: Breach, Nail Shut and Lock (equipment), and what they mean
// for players' and monsters' movement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState, edgeKey } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction, nextOptions } from '../src/game/rules.js';
import { gameDoorOverride, doorsAround } from '../src/game/doors.js';
import { resolveEvent } from '../src/game/eventPlay.js';

// A street along row 5 (van at the east end) and a small building (x 5-7,
// y 2-4) whose only door is on the street side, at (6,4)|(6,5).
function setup(doorType = 'door') {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (let y = 2; y < 5; y++) for (let x = 5; x < 8; x++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  for (let x = 5; x < 8; x++) { g.setEdge('h', x, 2, 'wall'); g.setEdge('h', x, 5, x === 6 ? doorType : 'wall'); }
  for (let y = 2; y < 5; y++) { g.setEdge('v', 5, y, 'wall'); g.setEdge('v', 8, y, 'wall'); }
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 3, config: { players: 1, monster: 'none' } });
  const pl = state.players[0];
  pl.pos = g.index(6, 5);                                  // on the street, in front of the door
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  const door = edgeKey('h', 6, 5);
  // Roll, give the player `items`, and set the dice.
  const ready = (items, dice = [3, 3, 3, 3]) => {
    assert.ok(act({ type: 'roll' }).ok);
    pl.inventory.equipment = items.map((id) => ({ id }));
    state.pool = dice.map((v) => ({ kind: 'black', v }));
    state.slots = []; state.defSlots = [];
  };
  return { g, board, state, pl, act, door, ready };
}
// Can you walk from the street into the building (no keys)?
const canEnter = (s) => {
  const { x, y } = s.g.coords(s.pl.pos);
  s.board.grid.edgeOverride = gameDoorOverride(s.state);
  const ok = s.g.moveField(x, y, { keys: false }).dist[s.g.index(6, 3)] >= 0;
  s.board.grid.edgeOverride = null;
  return ok;
};

test('the door next to you is found; nothing to target without one', () => {
  const s = setup();
  assert.deepEqual(doorsAround(s.state, s.board, s.pl.pos).map((d) => d.side), ['north']);
  s.ready(['crowbar']);
  s.pl.pos = s.g.index(12, 5);                             // no door here
  assert.match(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).error, /no door next to you/);
});

test('Nail Shut blocks the door for everyone, monsters too; the Cut Spike breaks', () => {
  const s = setup();
  assert.ok(canEnter(s));
  s.ready(['cut-spike']);
  const r = s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] });
  assert.ok(r.ok, r.error);
  assert.equal(s.state.doors[s.door], 'blocked');
  assert.equal(s.pl.inventory.equipment.length, 0, 'the spike is used up');
  assert.ok(r.events.some((e) => e.type === 'doors'));
  assert.equal(canEnter(s), false, 'a wall to everyone (this is what monsters walk by too)');
});

test('Lock works the same, and the chain is left on the door', () => {
  const s = setup();
  s.ready(['iron-chain']);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);
  assert.equal(s.state.doors[s.door], 'blocked');
  assert.equal(s.pl.inventory.equipment.length, 0, 'the chain is lost');
  assert.equal(canEnter(s), false);
});

test('Breach opens any door for good: a locked one, or one nailed shut', () => {
  const s = setup('lockedDoor');
  assert.equal(canEnter(s), false, 'locked, and no key');
  s.ready(['crowbar', 'cut-spike']);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);   // Breach
  assert.equal(s.state.doors[s.door], 'breached');
  assert.ok(canEnter(s), 'an open doorway');
  // Nothing left to nail: the Cut Spike has no door to shut.
  assert.match(s.act({ type: 'use', item: 1, ability: 1, dice: [2, 3] }).error, /no door next to you/);

  const t = setup();
  t.ready(['cut-spike', 'firemans-axe']);
  assert.ok(t.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);   // nailed shut
  assert.ok(t.act({ type: 'use', item: 0, ability: 1, dice: [2, 3] }).ok);   // the axe breaches it
  assert.equal(t.state.doors[t.door], 'breached');
  assert.ok(canEnter(t));
});

test('a breached doorway stays open: the Nailed Shut event and Lockdown pass it by', () => {
  const s = setup();
  s.ready(['crowbar']);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);
  const ctx = { log: () => {}, randInt: () => 0, curPlayer: (st) => st.players[st.cur], isMidnight: () => false, label: () => '' };
  resolveEvent(s.state, s.board, 'nailed-shut', s.pl.pos, ctx, []);
  assert.equal(s.state.doors[s.door], 'breached');
  s.state.lockdown = { seat: 0, turn: s.state.turn };
  s.board.grid.edgeOverride = null;
  s.state.steps = 3;                                     // moves to spend
  assert.ok(nextOptions(s.state, s.board, { back: true }).some((o) => o.i === s.g.index(6, 4)), 'players walk through in Lockdown');
});
