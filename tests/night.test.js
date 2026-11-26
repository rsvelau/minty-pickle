// The night after midnight: 24 turns, Care Packages every 6; dead investigators drop their items;
// the Skills menu doesn't offer healing with nothing to heal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { nightTurn, dropCrate, crateAt, NIGHT_TURNS, turnsLeftInNight } from '../src/game/carePackage.js';
import { killPlayer } from '../src/game/combat.js';
import { skillStatus } from '../src/game/skills.js';

function setup(players = 2) {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (const x of [3, 8, 12]) g.apply(g.index(x, 5), { marker: 'investigation' }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 4, startMode: 'midnight', config: { players, monster: 'none' } });
  const log = [];
  const ctx = { state, log: (s, m) => log.push(m), randInt: () => 0 };
  return { g, board, state, ctx, log };
}

test('the night: a warning 5 turns before the end, then Lost in the night', () => {
  const { board, state, ctx, log } = setup();
  assert.equal(turnsLeftInNight(state), NIGHT_TURNS);
  state.round = state.midnightRound + 19;
  nightTurn(state, board, ctx, []);
  assert.ok(log.some((m) => /5 turns left/.test(m)));
  assert.notEqual(state.phase, 'over');
  state.round = state.midnightRound + 24;
  const ev = [];
  nightTurn(state, board, ctx, ev);
  assert.equal(state.phase, 'over');
  assert.ok(state.lostInNight);
  assert.ok(ev.some((e) => e.type === 'gameOver' && e.lostInNight));
});

test('the night ends the game through play: turns run out', () => {
  const { board, state } = setup(1);
  state.round = state.midnightRound + 23;
  applyAction(state, board, { type: 'roll', seat: 0 });
  // End the turn: with one player, that ends the round.
  for (let k = 0; k < 10 && state.phase !== 'over'; k++) {
    if (state.phase === 'idle') applyAction(state, board, { type: 'roll', seat: 0 });
    else if (state.phase === 'slotting' || state.phase === 'choosing') applyAction(state, board, { type: 'end', seat: 0 });
    else break;
  }
  assert.equal(state.phase, 'over');
  assert.ok(state.lostInNight);
});

test('Care Packages: every 6 turns after midnight, on an Investigation marker, 5 pieces of Equipment to take', () => {
  const { g, board, state, ctx } = setup();
  const deck = state.decks.equipment.length;
  state.round = state.midnightRound + 5;
  nightTurn(state, board, ctx, []);
  assert.ok(!state.crates?.length, 'not yet');
  state.round = state.midnightRound + 6;
  const ev = [];
  nightTurn(state, board, ctx, ev);
  assert.equal(state.crates.length, 1);
  const crate = state.crates[0];
  assert.equal(g.cells[crate.cell].marker, 'investigation');
  assert.equal(crate.items.length, 5);
  assert.equal(state.decks.equipment.length, deck - 5);
  assert.ok(ev.some((e) => e.type === 'carePackage' && e.cell === crate.cell));
  // A second one goes elsewhere.
  dropCrate(state, board, ctx, []);
  assert.equal(new Set(state.crates.map((c) => c.cell)).size, 2);
  // Standing on it: take one, leave the rest.
  const pl = state.players[state.cur];
  pl.pos = crate.cell;
  state.phase = 'idle';
  const had = pl.inventory.equipment.length;
  const want = crate.items[2];
  assert.ok(applyAction(state, board, { type: 'crate', item: 2, seat: state.cur }).ok);
  assert.equal(pl.inventory.equipment.length, had + 1);
  assert.equal(pl.inventory.equipment.at(-1).id, want);
  assert.equal(crateAt(state, crate.cell).items.length, 4);
  for (let k = 0; k < 4; k++) assert.ok(applyAction(state, board, { type: 'crate', item: 0, seat: state.cur }).ok);
  assert.equal(crateAt(state, crate.cell), null, 'empty: gone');
  pl.pos = g.index(0, 5);
  assert.equal(applyAction(state, board, { type: 'crate', item: 0, seat: state.cur }).ok, false);
});

test('an investigator who dies drops what they carry where they fell', () => {
  const { state } = setup();
  const pl = state.players[0];
  pl.pos = 45;
  pl.carry = [{ item: 'gown' }, { item: 'ring' }];
  killPlayer(state, pl, { log: () => {}, text: 'test' });
  assert.equal(pl.dead, true);
  assert.deepEqual(pl.carry, []);
  assert.deepEqual(state.objective.dropped.map((d) => [d.item, d.cell]), [['gown', 45], ['ring', 45]]);
});

test('Skills: healing with nothing to heal is Not now', () => {
  const { board, state } = setup(1);
  const pl = state.players[0];
  pl.inventory.equipment = [{ id: 'medical-kit' }];
  applyAction(state, board, { type: 'roll', seat: 0 });
  const dress = () => skillStatus(state, board, pl).find((e) => e.name === 'Dress Wound');
  assert.equal(dress().status, 'not');
  assert.match(dress().why, /No Physical injury/);
  pl.injuries.P = 1;
  assert.notEqual(dress().status, 'not');
});

test('a team that has won is never Lost in the night', () => {
  const { board, state, ctx } = setup();
  state.won = true;
  state.round = state.midnightRound + 30;
  nightTurn(state, board, ctx, []);
  assert.ok(!state.lostInNight);
});
