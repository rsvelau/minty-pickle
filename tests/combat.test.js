// Defense, injuries, death, and telegraphed monster actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { applyDamage, turnLimits, defenseValue } from '../src/game/combat.js';
import { parseAbility } from '../src/game/monsterTurn.js';
import { MONSTER_CARDS } from '../src/game/cards/monsters.js';
import { OBSERVATIONS, LAIRS } from '../src/game/cards/evidence.js';

function street() {
  const g = new GridState(20, 26);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 12), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 12), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  return g;
}
const quiet = { log: () => {} };

test('evidence names match the Monster Ref Sheet', () => {
  const name = (id) => MONSTER_CARDS.find((c) => c.id === id);
  const names = (id) => name(id).evidence.observations.map((o) => OBSERVATIONS[o].label).sort();
  assert.deepEqual(names('werewolf'), ['Claw Marks', 'Mangled Window', 'Strange Howl']);
  assert.deepEqual(names('wendigo'), ['Claw Marks', 'Inhuman Shriek', 'Signs of Distress']);
  assert.deepEqual(names('adze'), ['Feeling of Being Watched', 'Severe Lethargy', 'Unexplained Illness']);
  assert.equal(LAIRS[name('redcap').evidence.lair].label, 'Bloodstained Room');
  assert.equal(LAIRS[name('barghest').evidence.lair].label, 'Unnaturally Dark Room');
});

test('defense at least the damage blocks; less gives one tier; tiers stack per track', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 1, config: { players: 1 } });
  const pl = state.players[0];
  const ev = [];
  pl.defense = [{ kind: 'black', v: 4 }];
  assert.equal(applyDamage(state, board, pl, 'P', 4, quiet, ev), 'blocked');
  assert.equal(applyDamage(state, board, pl, 'P', 5, quiet, ev), 'injured');
  assert.equal(applyDamage(state, board, pl, 'M', 6, quiet, ev), 'injured');
  assert.deepEqual(pl.injuries, { P: 1, M: 1, S: 0 });
  applyDamage(state, board, pl, 'P', 9, quiet, ev);
  applyDamage(state, board, pl, 'P', 9, quiet, ev);
  assert.equal(pl.injuries.P, 3); // Death's Door
  assert.equal(applyDamage(state, board, pl, 'S', 9, quiet, ev), 'killed');
  assert.ok(pl.dead);
});

test('injuries change what a player can use', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 1, config: { players: 2 } });
  const [a, b] = state.players;
  const base = turnLimits(state, board, a);
  a.injuries = { P: 2, M: 1, S: 0 };      // Sprained + Hobbled, Paranoid
  const hurt = turnLimits(state, board, a);
  assert.equal(hurt.move, base.move - 1);
  assert.equal(hurt.defense, base.defense - 1);
  assert.equal(hurt.dice, base.dice - 1);
  b.injuries = { P: 0, M: 2, S: 0 };      // Terrified, standing with a
  assert.equal(turnLimits(state, board, a).defense, Math.max(0, base.defense - 2));
  a.injuries = { P: 0, M: 0, S: 3 };      // Death's Door
  assert.equal(turnLimits(state, board, a).dice, 1);
  a.injuries = { P: 0, M: 0, S: 1 };      // Doomed
  a.defense = [{ v: 6 }, { v: 3 }];
  assert.equal(defenseValue(a), 4);
});

test('dice go into movement or defense slots and defense is committed on Move', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 2, config: { players: 1 } });
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  assert.ok(state.maxDefense >= 1);
  assert.ok(act({ type: 'slot', die: 0, to: 'defense' }).ok);
  assert.ok(act({ type: 'slot', die: 1, to: 'move' }).ok);
  assert.ok(act({ type: 'slot', die: 0, to: 'move' }).ok); // moves it across
  assert.deepEqual(state.defSlots, []);
  act({ type: 'slot', die: 0, to: 'defense' });
  const v = state.pool[0].v;
  act({ type: 'move' });
  assert.deepEqual(state.players[0].defense.map((d) => d.v), [v]);
});

test('ability text is read into moves and attacks', () => {
  const p = parseAbility('Pursue (8) and Attack (4)');
  assert.deepEqual(p.ops.map((o) => o.op), ['pursue', 'attack']);
  assert.equal(p.ops[1].dmg.fixed, 4);
  const area = parseAbility('Area Attack (2 dice, R5). Only affects outdoor spaces');
  assert.deepEqual(area.ops[0], { op: 'area', dmg: { dice: 2 }, radius: 5 });
  assert.ok(parseAbility('Pursue (10) and Seize player').unknown.includes('Seize'));
});

test('a card monster declares its action, shows who is in danger, then carries it out', () => {
  const board = createBoard(street());
  const { state, events } = newGame(board, { seed: 6, startMode: 'midnight', config: { players: 1, monsterPick: 'redcap' } });
  const mo = state.monsters[0];
  assert.ok(events.some((e) => e.type === 'monsterIntent'));
  assert.ok(mo.intent && mo.intent.name);
  // Move the Redcap next to the player: Chase / Route both Attack → danger.
  const pl = state.players[0];
  const { x, y } = board.grid.coords(pl.pos);
  mo.pos = board.grid.index(x - 1, y);
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  assert.deepEqual(mo.intent.danger, [0], 'danger updates live');
  const r = act({ type: 'move' });             // stay put: the round ends
  assert.ok(r.events.some((e) => e.type === 'damage'), 'it struck');
  assert.ok(r.events.some((e) => e.type === 'monsterIntent'), 'and declared its next move');
});

test('a turn carries on after moving: slot more, adjust defense, move again, then end', async () => {
  const { unusedDice } = await import('../src/game/rules.js');
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 2, config: { players: 1, startBlack: 3 } });
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  state.pool = [{ kind: 'black', v: 1 }, { kind: 'black', v: 1 }, { kind: 'black', v: 5 }];
  act({ type: 'slot', die: 0, to: 'move' });
  assert.ok(act({ type: 'move' }).ok);
  if (state.phase === 'choosing') act({ type: 'choose', cell: state.options[0].i });
  assert.equal(state.phase, 'slotting', 'turn carries on');
  assert.equal(act({ type: 'slot', die: 0, to: 'defense' }).ok, false, 'spent dice stay spent');
  act({ type: 'slot', die: 2, to: 'defense' });
  assert.equal(state.players[0].defense[0].v, 5, 'defense is live');
  act({ type: 'slot', die: 1, to: 'move' });
  act({ type: 'move' });
  if (state.phase === 'choosing') act({ type: 'choose', cell: state.options[0].i });
  // All dice used now: the turn ends by itself; defense stays up.
  assert.equal(state.phase, 'idle');
  assert.equal(state.players[0].defense[0].v, 5);
  assert.equal(unusedDice(state).length, 0);
});

test('Close range includes diagonals; Adze abilities cover every roll', async () => {
  const { cellRange, rangeBand } = await import('../src/game/cards/injuries.js');
  const g = street();
  assert.equal(rangeBand(cellRange(g, g.index(5, 5), g.index(6, 6))), 'close');
  assert.equal(rangeBand(cellRange(g, g.index(5, 5), g.index(7, 6))), 'mid');
  assert.equal(rangeBand(cellRange(g, g.index(5, 5), g.index(8, 5))), 'long');
  const adze = MONSTER_CARDS.find((c) => c.id === 'adze');
  assert.deepEqual(adze.abilities.map((a) => a.roll), ['1-2', '3-4', '5-6']);
});
