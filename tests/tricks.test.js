// Dice and injury tricks (equipment): Lucky, Rally, Toss, Drink, Sacrifice,
// Lunge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { armMonster, targetsFor } from '../src/game/equipmentPlay.js';
import { applyDamage, defenseLeft, turnLimits } from '../src/game/combat.js';
import { EQUIPMENT_BY_ID } from '../src/game/cards/equipment.js';

// A street along row 5, the van at the east end; P1 at (10,5), P2 at (11,5),
// P3 far off at (2,5); a werewolf at (13,5).
function setup({ players = 3 } = {}) {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 5, config: { players, monster: 'none' } });
  const [pl, mate, far] = state.players;
  pl.pos = g.index(10, 5);
  if (mate) mate.pos = g.index(11, 5);
  if (far) far.pos = g.index(2, 5);
  const monster = { id: 'm1', kind: 'werewolf', pos: g.index(13, 5), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const act = (a, seat = state.cur) => applyAction(state, board, { ...a, seat });
  const give = (p, items, obols = 0) => {
    p.inventory.equipment = items.map((id) => ({ id }));
    p.inventory.obolcraft = Array.from({ length: obols }, () => ({ type: 'event' }));
  };
  const ready = (items, { dice = [3, 3, 3], obols = 0 } = {}) => {
    assert.ok(act({ type: 'roll' }).ok);
    give(pl, items, obols);
    state.pool = dice.map((v) => ({ kind: 'black', v }));
    state.slots = []; state.defSlots = [];
  };
  const hit = (who, amount, type = 'P') => applyDamage(state, board, who, type, amount, { log: () => {}, source: 'A claw' }, []);
  return { g, board, state, pl, mate, far, monster, act, give, ready, hit };
}

test('Lucky: set any of your dice this turn, then it is over', () => {
  const s = setup();
  s.ready(['good-luck-charm'], { dice: [1, 2, 3] });
  assert.match(s.act({ type: 'setDie', die: 0, v: 6 }).error, /only with Lucky/);
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [] }).ok);
  assert.equal(s.pl.inventory.equipment.length, 0, 'the charm breaks');
  assert.ok(s.act({ type: 'setDie', die: 0, v: 6 }).ok);
  assert.ok(s.act({ type: 'setDie', die: 2, v: 5 }).ok);
  assert.deepEqual(s.state.pool.map((d) => d.v), [6, 2, 5]);
  assert.match(s.act({ type: 'setDie', die: 1, v: 7 }).error, /1 to 6/);
  assert.ok(s.act({ type: 'end' }).ok);
  assert.equal(s.state.lucky, false, 'just this turn');
});

test('Rally: one die, and you and teammates within Mid get +4 Mental through the monster’s turn', () => {
  const s = setup();
  s.ready(['compact-boombox'], { dice: [2, 3] });
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0] }).ok);
  assert.equal(defenseLeft(s.pl, 'M'), 4);
  assert.equal(defenseLeft(s.mate, 'M'), 4, 'the teammate next to you');
  assert.equal(defenseLeft(s.mate, 'P'), 0, 'Mental only');
  assert.equal(defenseLeft(s.far, 'M'), 0, 'too far away');
  // The teammate's own turn (later this round) keeps it.
  assert.ok(s.act({ type: 'end' }).ok);
  assert.equal(s.state.cur, 1);
  assert.ok(s.act({ type: 'roll' }).ok);
  assert.equal(defenseLeft(s.mate, 'M'), 4, 'still up on their own turn');
  assert.equal(s.hit(s.mate, 3, 'M'), 'blocked');
  // After the monster's turn (end of the round) it's gone.
  assert.ok(s.act({ type: 'end' }).ok);
  assert.ok(s.act({ type: 'roll' }).ok);
  assert.ok(s.act({ type: 'end' }).ok);
  assert.equal(s.state.round, 2);
  assert.equal(defenseLeft(s.mate, 'M'), 0);
});

test('Toss: injuries’ effects are held off until the next injury; tiers stay; a blocked hit doesn’t end it', () => {
  const s = setup({ players: 1 });
  s.pl.injuries = { P: 2, M: 1, S: 0 };                  // Sprained + Hobbled, Paranoid
  const was = turnLimits(s.state, s.board, s.pl);
  s.ready(['worry-stone'], { obols: 1 });
  s.state.maxSlots = was.move; s.state.maxDefense = was.defense;
  s.state.pool = [{ kind: 'black', v: 3 }];
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [] }).ok);
  assert.ok(s.pl.tossed);
  assert.deepEqual(s.pl.injuries, { P: 2, M: 1, S: 0 }, 'the tiers are still marked');
  const now = turnLimits(s.state, s.board, s.pl);
  assert.equal(now.dice, was.dice + 1, 'the Sprained die is back');
  assert.equal(s.state.pool.length, 2, '...and rolled at once');
  assert.equal(s.state.maxSlots, was.move + 1, 'Hobbled lifted');
  assert.equal(s.state.maxDefense, was.defense + 1, 'Paranoid lifted');
  s.pl.defense = [{ v: 5 }];
  assert.equal(s.hit(s.pl, 4), 'blocked');
  assert.ok(s.pl.tossed, 'blocked: still holding');
  assert.equal(s.hit(s.pl, 9), 'injured');
  assert.ok(!s.pl.tossed, 'injured: over');
});

test('Toss covers Death’s Door (all your dice), but a hit that gets through still kills', () => {
  const s = setup({ players: 2 });
  s.pl.injuries = { P: 3, M: 0, S: 0 };
  s.pl.tossed = true;
  const lim = turnLimits(s.state, s.board, s.pl);
  assert.equal(lim.deathsDoor, false);
  assert.ok(lim.dice > 1);
  assert.equal(s.hit(s.pl, 9), 'killed');
});

test('Drink: Physical injuries ignored and movement doubled, this turn only', () => {
  const s = setup({ players: 1 });
  s.pl.injuries = { P: 1, M: 0, S: 0 };                  // Sprained: a die in reserve
  s.ready(['questionable-stimulant'], { dice: [3] });
  s.state.disabledDice = 1;
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [] }).ok);
  assert.equal(s.state.pool.length, 2, 'the Sprained die is rolled');
  assert.equal(s.state.disabledDice, 0);
  s.state.pool = [{ kind: 'black', v: 3 }, { kind: 'black', v: 1 }];
  assert.ok(s.act({ type: 'slot', die: 0, to: 'move' }).ok);
  const from = s.pl.pos;
  assert.ok(s.act({ type: 'move' }).ok);
  if (s.state.phase === 'choosing') assert.ok(s.act({ type: 'choose', cell: s.pl.pos - 1 }).ok); // west
  assert.equal(Math.abs(s.g.coords(s.pl.pos).x - s.g.coords(from).x), 6, '3 doubled');
  if (s.state.phase !== 'idle') assert.ok(s.act({ type: 'end' }).ok);
  assert.ok(!s.pl.drinking, 'worn off');
  assert.equal(turnLimits(s.state, s.board, s.pl).dice, s.state.blackCount - 1, 'Sprained again');
});

test('Sacrifice: the carrier decides; yes heals every injury, pays an Obol and the Fetish crumbles', () => {
  const s = setup();
  s.give(s.mate, ['sacrificial-fetish'], 1);
  s.pl.injuries = { P: 3, M: 1, S: 0 };
  assert.equal(s.hit(s.pl, 9), 'dying');
  assert.ok(s.pl.dying && !s.pl.dead);
  assert.equal(s.hit(s.pl, 9), 'dead', 'nothing more can hurt them');
  assert.match(s.act({ type: 'roll' }).error, /waiting for P2/);
  assert.match(s.act({ type: 'sacrifice', yes: true }, 0).error, /P2 decides/);
  assert.ok(s.act({ type: 'sacrifice', yes: true }, 1).ok);
  assert.deepEqual(s.pl.injuries, { P: 0, M: 0, S: 0 });
  assert.ok(!s.pl.dying && !s.pl.dead);
  assert.equal(s.mate.inventory.equipment.length, 0);
  assert.equal(s.mate.inventory.obolcraft.length, 0);
  assert.ok(s.act({ type: 'roll' }).ok, 'play goes on');
});

test('Sacrifice: no lets them die, and the turn moves on; no Obol, no Sacrifice', () => {
  const s = setup();
  s.give(s.pl, ['sacrificial-fetish'], 1);
  assert.ok(s.act({ type: 'roll' }).ok);
  s.pl.injuries = { P: 0, M: 0, S: 3 };
  assert.equal(s.hit(s.pl, 9, 'S'), 'dying');
  assert.ok(s.act({ type: 'sacrifice', yes: false }, 0).ok);
  assert.ok(s.pl.dead);
  assert.equal(s.state.cur, 1, 'their turn ended');
  assert.equal(s.state.phase, 'idle');

  const t = setup();
  t.give(t.mate, ['sacrificial-fetish'], 0);
  t.pl.injuries = { P: 3, M: 0, S: 0 };
  assert.equal(t.hit(t.pl, 9), 'killed');
  assert.match(t.act({ type: 'use', item: 0, ability: 0, dice: [] }, 1).error ?? '', /not your turn|used the moment/);
});

test('Lunge: carrying the Fencing Shoes, Close attacks reach Mid (and Lunge itself is not “used”)', () => {
  const s = setup({ players: 1 });
  s.monster.pos = s.g.index(12, 5);                       // 2 away: Mid
  const smite = EQUIPMENT_BY_ID['witch-hunters-sword'].abilities[0];
  s.give(s.pl, ['witch-hunters-sword']);
  assert.equal(targetsFor(s.state, s.board, s.pl, smite).length, 0, 'Close only');
  s.give(s.pl, ['witch-hunters-sword', 'fencing-shoes']);
  assert.equal(targetsFor(s.state, s.board, s.pl, smite).length, 1, 'Lunge: Mid');
  const seal = EQUIPMENT_BY_ID['heavy-silver-crucifix'].abilities[1];
  assert.equal(targetsFor(s.state, s.board, s.pl, seal).length, 0, 'not a damage skill');
  s.ready(['witch-hunters-sword', 'fencing-shoes'], { dice: [5] });
  assert.ok(s.act({ type: 'use', item: 0, ability: 0, dice: [0] }).ok);
  assert.equal(s.monster.hp, 19, '5 − toughness 4');
  assert.match(s.act({ type: 'use', item: 1, ability: 0, dice: [] }).error, /always on/);
});
