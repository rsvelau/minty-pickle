// Weakness effects (groups 8 and 9): Skinwalker's Curseblood Ritual and its
// reset, White Lady's Trigger Regret, and the discards offered at the moment:
// Banshee (Silver, Swoop), Strigoi (Holy, Exhaust), Shadow People (Fire, any
// attack; Crystal, no light).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { armMonster } from '../src/game/equipmentPlay.js';
import { executeIntent, parseAbility, onPlayerEnters } from '../src/game/monsterTurn.js';
import { MONSTER_BY_ID } from '../src/game/cards/monsters.js';

// A street along row 5 (van at the east end) and a building (x 5-7, y 2-4)
// with a door at (6,4)|(6,5). P1 at (10,5), P2 at (12,5).
function setup(kind, { players = 2 } = {}) {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (let y = 2; y < 5; y++) for (let x = 5; x < 8; x++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  for (let x = 5; x < 8; x++) { g.setEdge('h', x, 2, 'wall'); g.setEdge('h', x, 5, x === 6 ? 'door' : 'wall'); }
  for (let y = 2; y < 5; y++) { g.setEdge('v', 5, y, 'wall'); g.setEdge('v', 8, y, 'wall'); }
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 4, config: { players, monster: 'none' } });
  const [pl, mate] = state.players;
  pl.pos = g.index(10, 5);
  if (mate) mate.pos = g.index(12, 5);
  const monster = { id: 'm1', kind, pos: g.index(2, 5), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const log = [];
  const ctx = { state, log: (s, m) => log.push(m), randInt: () => 3 }; // every die rolls 4
  const act = (a, seat = state.cur) => applyAction(state, board, { ...a, seat });
  // The monster's turn: the named abilities from its card, in order.
  const turn = (...names) => {
    const card = MONSTER_BY_ID[kind];
    monster.intents = names.map((n) => {
      const a = card.abilities.find((x) => x.name === n);
      return { roll: 1, ability: 0, name: a.name, kind: a.kind, text: a.text, ...parseAbility(a.text) };
    });
    const events = [];
    executeIntent(state, board, monster, ctx, events);
    return events;
  };
  const give = (p, items) => { p.inventory.equipment = items.map((id) => ({ id })); };
  return { g, board, state, pl, mate, monster, act, turn, give, log, ctx };
}

test('Curseblood Ritual: counted each time; the 3rd sets off a Global Attack (10) and the count starts over', () => {
  const s = setup('skinwalker');
  s.pl.defense = [{ v: 6 }];
  s.turn('Curseblood Ritual');
  s.turn('Curseblood Ritual');
  assert.equal(s.monster.rituals, 2);
  assert.deepEqual(s.pl.injuries, { P: 0, M: 0, S: 0 });
  const ev = s.turn('Curseblood Ritual');
  assert.equal(ev.filter((e) => e.type === 'damage').length, 2, 'both players');
  assert.equal(s.pl.injuries.S, 1, '10 against defense 6');
  assert.equal(s.monster.rituals, 0);
});

test('Reset Curseblood Ritual (Skinwalker’s first weakness mark): a Crystal hit sets the count back to 0', () => {
  const s = setup('skinwalker');
  s.monster.rituals = 2;
  s.monster.pos = s.g.index(9, 5);
  assert.ok(s.act({ type: 'roll' }).ok);
  s.give(s.pl, ['crystal-talisman']);
  s.state.pool = [{ kind: 'black', v: 5 }, { kind: 'black', v: 5 }];
  s.state.slots = []; s.state.defSlots = [];
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);   // Bind, Crystal
  assert.equal(s.monster.rituals, 0);
});

test('Trigger Regret (White Lady): a Salt hit sets off Regret at once, on every player inside her building', () => {
  const s = setup('white-lady');
  s.monster.pos = s.g.index(6, 3);
  s.pl.pos = s.g.index(6, 4);                                  // inside, next to her
  s.mate.pos = s.g.index(12, 5);                               // out on the street
  assert.ok(s.act({ type: 'roll' }).ok);
  s.give(s.pl, ['rock-salt-shotgun']);
  s.state.pool = [{ kind: 'black', v: 6 }, { kind: 'black', v: 6 }];
  s.state.slots = []; s.state.defSlots = [];
  const r = s.act({ type: 'use', item: 0, ability: 0, dice: [0, 1] });   // Salt Shot
  assert.ok(r.ok, r.error);
  const hits = r.events.filter((e) => e.type === 'damage');
  assert.deepEqual(hits.map((e) => e.seat), [0], 'only the player inside');
  assert.equal(s.pl.injuries.M, 1);
  assert.ok(r.events.findIndex((e) => e.type === 'equipUse') < r.events.findIndex((e) => e.type === 'damage'), 'after the shot itself');
});

test('Regret on her own turn: an Area Attack on everyone inside her building', () => {
  const s = setup('white-lady');
  s.monster.pos = s.g.index(6, 3);
  s.pl.pos = s.g.index(6, 4);
  const ev = s.turn('Regret');
  assert.deepEqual(ev.filter((e) => e.type === 'damage').map((e) => e.seat), [0]);
});

test('Swoop lands beside the nearest player; holding Silver, they may discard it and the damage is undone', () => {
  const s = setup('banshee');
  s.give(s.pl, ['heavy-silver-chain']);
  s.turn('Swoop');
  assert.equal(Math.abs(s.g.coords(s.monster.pos).x - 10) + Math.abs(s.g.coords(s.monster.pos).y - 5), 1, 'landed next to P1');
  assert.equal(s.pl.injuries.P, 1);
  assert.equal(s.state.reactions.length, 1);
  assert.match(s.act({ type: 'roll' }).error, /waiting for P1/);
  assert.match(s.act({ type: 'react', yes: true }, 1).error, /P1 decides/);
  assert.ok(s.act({ type: 'react', yes: true }, 0).ok);
  assert.deepEqual(s.pl.injuries, { P: 0, M: 0, S: 0 });
  assert.equal(s.pl.inventory.equipment.length, 0);
  assert.ok(s.act({ type: 'roll' }).ok, 'play goes on');
});

test('a Swoop that would kill: down until they answer; keeping the item, they die', () => {
  const s = setup('banshee');
  s.give(s.pl, ['heavy-silver-chain']);
  s.pl.injuries = { P: 3, M: 0, S: 0 };
  s.turn('Swoop');
  assert.ok(s.pl.dying && !s.pl.dead);
  assert.ok(s.act({ type: 'react', yes: false }, 0).ok);
  assert.ok(s.pl.dead);
  assert.equal(s.pl.inventory.equipment.length, 1);
});

test('no Silver, or a blocked Swoop: nothing to ask', () => {
  const s = setup('banshee');
  s.turn('Swoop');
  assert.ok(!s.state.reactions?.length);
  const t = setup('banshee');
  t.give(t.pl, ['heavy-silver-chain']);
  t.pl.defense = [{ v: 6 }];
  t.turn('Swoop');
  assert.ok(!t.state.reactions?.length);
});

test('Strigoi: discard Holy and the Exhaust is undone (the die is back)', () => {
  const s = setup('strigoi');
  s.monster.pos = s.g.index(9, 5);
  s.give(s.pl, ['heavy-silver-crucifix']);                    // Smite is Holy
  s.pl.defense = [{ kind: 'black', v: 2 }];
  s.turn('Charm');                                            // Exhaust (movement die) and Attack (6)
  s.pl.lastMove = [{ kind: 'black', v: 5 }];
  s.state.reactions = [];
  s.pl.injuries = { P: 0, M: 0, S: 0 };
  s.turn('Drain');                                            // Exhaust (defensive die) and Attack (die)
  assert.equal(s.pl.lostBlack, 1);
  const r = s.state.reactions.find((x) => x.what === 'exhaust');
  assert.ok(r, 'offered for the Exhaust');
  s.state.reactions = [r];
  assert.ok(s.act({ type: 'react', yes: true }, 0).ok);
  assert.equal(s.pl.lostBlack ?? 0, 0);
  assert.deepEqual(s.pl.defense, [{ kind: 'black', v: 2 }]);
});

test('Shadow People: Fire undoes an Umbral Stab; Crystal keeps lit spaces safe until your next turn', () => {
  const s = setup('shadow-people');
  s.give(s.pl, ['dragons-breath-shotgun']);                   // Fire
  const lit = s.pl.pos;
  s.board.light[lit] = 1;
  onPlayerEnters(s.state, s.board, s.pl, lit, s.ctx, []);
  assert.equal(s.pl.injuries.P, 1);
  assert.ok(s.act({ type: 'react', yes: true }, 0).ok);
  assert.equal(s.pl.injuries.P, 0);
  s.state.flags.noLight = { seat: 0, round: s.state.round };
  const ev = [];
  onPlayerEnters(s.state, s.board, s.pl, lit, s.ctx, ev);
  assert.ok(!ev.some((e) => e.type === 'damage'), 'safe');
});
