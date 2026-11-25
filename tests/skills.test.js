// The Skills menu's "can I use this now?": skillStatus (src/game/skills.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { armMonster } from '../src/game/equipmentPlay.js';
import { skillStatus, readyCount } from '../src/game/skills.js';

// A street on row 5; P1 at (10,5), P2 at (11,5); a werewolf at (13,5) (Mid range).
function setup() {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 5, config: { players: 2, monster: 'none' } });
  const [pl, mate] = state.players;
  pl.pos = g.index(10, 5); mate.pos = g.index(11, 5);
  const monster = { id: 'm1', kind: 'werewolf', pos: g.index(13, 5), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const give = (p, items, obols = 0) => {
    p.inventory.equipment = items.map((id) => ({ id }));
    p.inventory.obolcraft = Array.from({ length: obols }, () => ({ type: 'event' }));
  };
  const roll = (dice) => {
    assert.ok(applyAction(state, board, { type: 'roll', seat: state.cur }).ok);
    state.pool = dice.map((v) => ({ kind: 'black', v }));
    state.slots = []; state.defSlots = [];
  };
  const find = (p, name) => skillStatus(state, board, p).find((e) => e.name === name);
  return { g, board, state, pl, mate, monster, give, roll, find };
}

test('before rolling: dice skills say roll first; dice-free ones are ready', () => {
  const s = setup();
  s.give(s.pl, ['baseball-bat', 'good-luck-charm']);
  assert.equal(s.find(s.pl, 'Bludgeon').status, 'almost');
  assert.match(s.find(s.pl, 'Bludgeon').why, /Roll first/);
  assert.equal(s.find(s.pl, 'Lucky').status, 'now');
});

test('after rolling: the lowest dice that meet the requirement, and a monster in range', () => {
  const s = setup();
  s.give(s.pl, ['powerful-flashlight']);
  s.roll([2, 6, 4]);
  const ill = s.find(s.pl, 'Illuminate');
  assert.equal(ill.status, 'now');
  assert.deepEqual(ill.action.dice, [0], 'the 2: lowest that works');
  // Blind needs a 6 and a monster at Close: the werewolf is 3 away.
  const blind = s.find(s.pl, 'Blind');
  assert.equal(blind.status, 'almost');
  assert.match(blind.why, /No monster in Close range/);
  s.monster.pos = s.g.index(11, 5);
  assert.equal(s.find(s.pl, 'Blind').status, 'now');
  assert.deepEqual(s.find(s.pl, 'Blind').action.dice, [1]);
  // ...and the ready-made action really works.
  assert.ok(applyAction(s.state, s.board, s.find(s.pl, 'Blind').action).ok);
  assert.equal(s.find(s.pl, 'Blind').status, 'almost', 'the 6 is spent: the dice left can’t make it');
});

test('dice that can’t make it, Obols short, passive skills, someone else’s turn', () => {
  const s = setup();
  s.give(s.pl, ['baseball-bat', 'fencing-shoes']);
  s.monster.pos = s.g.index(11, 5);
  s.roll([1, 2, 5]);
  assert.equal(s.find(s.pl, 'Shatter').status, 'almost');
  assert.match(s.find(s.pl, 'Shatter').why, /don’t make \[6\]/);
  assert.equal(s.find(s.pl, 'Lunge').status, 'auto');
  assert.equal(s.find(s.pl, 'Close Gap').status, 'now');
  s.give(s.mate, ['baseball-bat']);
  assert.equal(s.find(s.mate, 'Bludgeon').status, 'not');
  assert.match(s.find(s.mate, 'Bludgeon').why, /turn/);
  assert.equal(readyCount(s.state, s.board, s.pl), 2, 'Bludgeon and Close Gap');
});

test('no monster at all: monster skills are Not now', () => {
  const s = setup();
  s.state.monsters = [];
  s.give(s.pl, ['kitchen-knife']);
  s.roll([5, 5, 5]);
  const e = s.find(s.pl, 'Pierce');
  assert.equal(e.status, 'not');
  assert.match(e.why, /No monster on the board/);
});
