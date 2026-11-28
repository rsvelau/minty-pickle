// Spiritual damage tricks (equipment): Weeping Barrier, Wrathful Penance,
// Spiritual Backlash. Each catches Spiritual hits through the monster's next
// turn, the whole hit, before defense.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { armMonster } from '../src/game/equipmentPlay.js';
import { applyDamage } from '../src/game/combat.js';
import { MONSTER_CARDS } from '../src/game/cards/monsters.js';

function setup(kind = 'werewolf') {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 2, config: { players: 2, monster: 'none' } });
  const [pl, mate] = state.players;
  pl.pos = g.index(10, 5);
  mate.pos = g.index(11, 5);
  const monster = { id: 'm1', kind, pos: g.index(12, 5), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  state.midnightRound = state.round - 3;   // risen 3 rounds ago: its objective can finish it (FINISH_AFTER)
  const act = (a) => applyAction(state, board, { ...a, seat: state.cur });
  const ready = (items, { dice = [6], obols = 0 } = {}) => {
    assert.ok(act({ type: 'roll' }).ok);
    pl.inventory.equipment = items.map((id) => ({ id }));
    pl.inventory.obolcraft = Array.from({ length: obols }, () => ({ type: 'event' }));
    state.pool = dice.map((v) => ({ kind: 'black', v }));
    state.slots = []; state.defSlots = [];
  };
  const hit = (who, amount, type = 'S') => {
    const events = [];
    const out = applyDamage(state, board, who, type, amount, { log: () => {}, source: 'A wail' }, events);
    return { out, events };
  };
  return { g, board, state, pl, mate, monster, act, ready, hit };
}

test('Weeping Barrier: each Spiritual hit heals a tier instead; defense untouched; gone after the monster’s turn', () => {
  const s = setup();
  s.ready(['mourning-veil'], { obols: 1 });
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [] }).ok);
  assert.equal(s.pl.inventory.obolcraft.length, 0, 'costs an Obol');
  s.pl.injuries = { P: 0, M: 0, S: 2 };
  s.pl.defense = [{ v: 5 }];                             // (a 6 would count as 1: Doomed)
  assert.equal(s.hit(s.pl, 5).out, 'healed');
  assert.equal(s.pl.injuries.S, 1);
  assert.equal(s.pl.defenseUsed ?? 0, 0, 'defense not worn');
  assert.equal(s.hit(s.pl, 4, 'P').out, 'blocked', 'other damage meets defense as usual');
  s.state.round++;
  assert.equal(s.hit(s.pl, 9).out, 'injured', 'the next round it is over');
});

test('Wrathful Penance: the hit goes back at the monster as Holy damage, through toughness', () => {
  const s = setup('werewolf');                          // 20 health, toughness 4
  s.ready(['blessed-scapular'], { obols: 2 });
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [] }).ok);
  assert.equal(s.hit(s.pl, 9).out, 'reflected');
  assert.equal(s.monster.hp, 15);
  assert.deepEqual(s.pl.injuries, { P: 0, M: 0, S: 0 });
});

test('Wrathful Penance counts a weakness hit on a monster weak to Holy', () => {
  const weak = MONSTER_CARDS.find((c) => c.weakness.includes('holy') && c.hp);
  const s = setup(weak.id);
  s.ready(['blessed-scapular'], { obols: 2 });
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [] }).ok);
  s.hit(s.pl, 6);
  assert.equal(s.monster.weakHits, 1);
});

test('Spiritual Backlash: onto a teammate (their defense applies) or the monster (untyped, through toughness)', () => {
  const s = setup('werewolf');
  s.ready(['bronze-skull-lantern'], { dice: [6] });
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0], target: { seat: 1 } }).ok);
  s.mate.defense = [{ v: 3 }];
  assert.equal(s.hit(s.pl, 5).out, 'redirected');
  assert.deepEqual(s.pl.injuries, { P: 0, M: 0, S: 0 }, 'not you');
  assert.equal(s.mate.injuries.S, 1, '5 against the teammate’s 3: injured');

  const t = setup('werewolf');
  t.ready(['bronze-skull-lantern'], { dice: [6] });
  assert.match(t.act({ type: 'use', item: 0, ability: 1, dice: [0] }).error, /choose a target/, 'a monster and a teammate in reach: pick one');
  assert.ok(t.act({ type: 'use', item: 0, ability: 1, dice: [0], target: { monster: 'm1' } }).ok);
  t.hit(t.pl, 10);
  assert.equal(t.monster.hp, 14, '10 − toughness 4');
});
