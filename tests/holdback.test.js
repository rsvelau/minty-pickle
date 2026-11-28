// Holding the monster back (equipment): Salt Circle, Distract, Camouflage,
// Brace. Each lasts through the monster's next turn (the end of this round).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { armMonster } from '../src/game/equipmentPlay.js';
import { executeIntent } from '../src/game/monsterTurn.js';
import { gameDoorOverride } from '../src/game/doors.js';

// Three streets (rows 4, 5, 6) with the van at the east end; the player at
// (10,5) and a monster of `kind` at (4,5).
function setup(kind = 'werewolf') {
  const g = new GridState(20, 10);
  for (let y = 4; y <= 6; y++) for (let x = 0; x < 20; x++) g.apply(g.index(x, y), { area: 'outdoor', sub: 'ground' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 3, config: { players: 1, monster: 'none' } });
  const pl = state.players[0];
  pl.pos = g.index(10, 5);
  const monster = { id: 'm1', kind, pos: g.index(4, 5), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  state.midnightRound = state.round - 3;   // risen 3 rounds ago: its objective can finish it (FINISH_AFTER)
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  // Roll, hand over `items`, set the dice.
  const ready = (items, dice = [3, 3, 3]) => {
    assert.ok(act({ type: 'roll' }).ok);
    pl.inventory.equipment = items.map((id) => ({ id }));
    state.pool = dice.map((v) => ({ kind: 'black', v }));
    state.slots = []; state.defSlots = [];
  };
  // The monster's turn: Pursue (n) then Attack (4).
  const monsterTurn = (n = 8) => {
    monster.intents = [{ roll: 1, ability: 0, name: 'Hunt', kind: 'physical', text: '', ops: [{ op: 'pursue', n }, { op: 'attack', dmg: { fixed: 4 } }], unknown: [] }];
    const events = [];
    board.grid.edgeOverride = gameDoorOverride(state, board);
    executeIntent(state, board, monster, { state, log: () => {}, randInt: () => 0 }, events);
    board.grid.edgeOverride = null;
    return events;
  };
  return { g, board, state, pl, monster, act, ready, monsterTurn };
}

test('Salt Circle: no monster enters or crosses the space; the salt breaks after one use', () => {
  const s = setup();
  s.ready(['salt-lick']);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0] }).ok);
  assert.equal(s.pl.inventory.equipment.length, 0);
  assert.deepEqual(s.state.saltCircles.map((c) => c.cell), [s.pl.pos]);
  // Make (10,5) the only way through: the rest of column 10 is blocked.
  for (let y = 0; y < 10; y++) if (y !== 5) s.g.cells[s.g.index(10, y)].walkable = false;
  s.state.players[0].pos = s.g.index(14, 5);              // the prey is beyond the salt
  s.state.saltCircles = [{ cell: s.g.index(10, 5), round: s.state.round }];
  s.monsterTurn(10);
  assert.ok(s.g.coords(s.monster.pos).x < 10, 'it can’t get past the salt');
});

test('Salt Circle: a monster can still come up to the space and strike whoever stands in it', () => {
  const s = setup();
  s.state.saltCircles = [{ cell: s.pl.pos, round: s.state.round }];
  const ev = s.monsterTurn(8);
  assert.notEqual(s.monster.pos, s.pl.pos);
  assert.ok(ev.some((e) => e.type === 'damage'), 'attacked from next to the circle');
});

test('Salt Circle stops ghosts too, and it is gone after the monster’s turn', () => {
  const s = setup('poltergeist');
  s.pl.pos = s.g.index(14, 5);
  s.state.saltCircles = [{ cell: s.g.index(10, 5), round: s.state.round }];
  // A ghost goes through walls, but not salt: ring the prey with salt.
  const { x: px, y: py } = s.g.coords(s.pl.pos);
  s.state.saltCircles = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ cell: s.g.index(px + dx, py + dy), round: s.state.round }));
  s.monsterTurn(12);
  assert.ok(!s.state.saltCircles.some((c) => c.cell === s.monster.pos), 'never on a salted space');
  assert.ok(Math.abs(s.g.coords(s.monster.pos).x - px) + Math.abs(s.g.coords(s.monster.pos).y - py) > 1, 'kept off the four sides');
  s.state.round++;                                         // the next round: the salt has blown away
  s.monsterTurn(12);
  assert.equal(Math.abs(s.g.coords(s.monster.pos).x - px) + Math.abs(s.g.coords(s.monster.pos).y - py), 1, 'right up to them now');
});

test('Distract: the monster spends its movement heading for the chosen space, for the whole turn', () => {
  const s = setup();
  s.ready(['compact-boombox']);
  const spot = s.g.index(8, 6);                          // 2 away: Mid range
  assert.match(s.act({ type: 'use', item: 0, ability: 0, dice: [0], target: { cell: s.g.index(17, 5) } }).error, /within reach/);
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [0], target: { cell: spot } }).ok);
  assert.deepEqual(s.monster.lure, { cell: spot, round: s.state.round });
  s.monster.intents = [
    { roll: 1, ability: 0, name: 'A', kind: 'none', text: '', ops: [{ op: 'pursue', n: 2 }], unknown: [] },
    { roll: 1, ability: 0, name: 'B', kind: 'none', text: '', ops: [{ op: 'pursue', n: 5 }], unknown: [] },
  ];
  s.board.grid.edgeOverride = gameDoorOverride(s.state, s.board);
  executeIntent(s.state, s.board, s.monster, { state: s.state, log: () => {}, randInt: () => 0 }, []);
  s.board.grid.edgeOverride = null;
  assert.equal(s.monster.pos, spot, 'both moves went to the boombox, not the player');
  assert.equal(s.monster.lure, undefined, 'over after its turn');
});

test('Camouflage: not chased or struck up close (Area still hits), and no more moving this turn', () => {
  const s = setup();
  s.ready(['viper-hood'], [1, 3]);
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [0] }).ok);
  assert.equal(s.pl.camoRound, s.state.round);
  assert.ok(s.act({ type: 'slot', die: 1, to: 'move' }).ok);
  assert.match(s.act({ type: 'move' }).error, /can’t move/);
  s.monster.pos = s.g.index(9, 5);                          // right next to them
  const ev = s.monsterTurn(4);
  assert.ok(!ev.some((e) => e.type === 'damage'), 'the Close attack finds no one');
  s.monster.intents = [{ roll: 1, ability: 0, name: 'Howl', kind: 'mental', text: '', ops: [{ op: 'area', dmg: { fixed: 4 }, radius: 3 }], unknown: [] }];
  const ev2 = [];
  executeIntent(s.state, s.board, s.monster, { state: s.state, log: () => {}, randInt: () => 0 }, ev2);
  assert.ok(ev2.some((e) => e.type === 'damage'), 'an Area attack still lands');
});

test('Brace: marked as immune to being moved through the monster’s next turn', () => {
  const s = setup();
  s.ready(['ice-axe'], [5]);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0] }).ok);
  assert.equal(s.pl.bracedRound, s.state.round);
});
