// The bot plays from the players' view (as the in-game bots do): it must cope with what's hidden there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gridFromMap } from '../src/core/mapFormat.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { makeBot } from '../src/game/bot.js';
import { publicState } from '../src/game/mystery.js';

const MAP = JSON.parse(readFileSync(new URL('../src/maps/hawthorn-bend.json', import.meta.url)));

test('the bot turns over a face-down evidence card from the players’ view (Research, an Evidence Obol)', () => {
  const { grid } = gridFromMap(MAP);
  const board = createBoard(grid);
  const { state } = newGame(board, { seed: 3, followStreets: true, config: { players: 2, monsterPick: 'werewolf' } });
  state.mystery.flipped = [0];                 // one already face up
  state.mystery.pendingReveal = { cell: state.players[0].pos };
  state.phase = 'revealing';
  const view = publicState(state);
  assert.equal(view.mystery.deck[1], null, 'face-down cards are blank in the view');
  const a = makeBot(board, { expert: true }).act(view);
  assert.equal(a.type, 'reveal');
  assert.notEqual(a.card, 0, 'not the one already turned over');
  assert.ok(applyAction(state, board, a).ok);
});

test('a whole bot game from the players’ view runs without errors', () => {
  const { grid } = gridFromMap(MAP);
  const board = createBoard(grid);
  const { state } = newGame(board, { seed: 1123, scout: true, followStreets: true, config: { players: 3, monsterPick: 'hellhounds' } });
  const bot = makeBot(board, { expert: true });
  for (let n = 0; n < 4000 && state.phase !== 'over' && state.round < 40; n++) {
    const a = bot.act(publicState(state)) ?? { type: 'end', seat: state.cur };
    const r = applyAction(state, board, a);
    if (!r.ok) applyAction(state, board, { type: 'end', seat: state.cur });
  }
  assert.ok(state.round > 12, 'past midnight');
});
