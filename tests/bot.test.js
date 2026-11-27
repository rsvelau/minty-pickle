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

test('Adze: once it is named, the bots keep investigating till the Nest rises (they don’t park on the victims)', () => {
  const { grid } = gridFromMap(MAP);
  const board = createBoard(grid);
  for (const seed of [5, 7]) {
    const { state } = newGame(board, { seed, scout: true, followStreets: true, config: { players: 4, monsterPick: 'adze' } });
    // Seat 0 is a human's (it ends its turns where it stands); the bots mustn't count on it to guard.
    const bot = makeBot(board, { expert: true, controls: (s) => s !== 0 });
    const human = makeBot(board, { expert: true });
    const still = [0, 0, 0, 0];
    let last = state.players.map((p) => p.pos), round = state.round, worst = 0;
    for (let n = 0; n < 8000 && state.phase !== 'over' && !state.monsters.length; n++) {
      let r;
      if (!(state.cur === 0 && state.phase !== 'scouting' && (r = applyAction(state, board, { type: 'end', seat: 0 })).ok)) {
        r = applyAction(state, board, (state.cur === 0 ? human : bot).act(publicState(state)) ?? { type: 'end', seat: state.cur });
        if (!r.ok) applyAction(state, board, { type: 'end', seat: state.cur });
      }
      if (state.round !== round) {
        round = state.round;
        const named = state.npcs?.length && !state.monsters.length;
        state.players.forEach((p, k) => { if (k === 0 || p.dead) return; still[k] = named && p.pos === last[k] ? still[k] + 1 : 0; worst = Math.max(worst, still[k]); });
        last = state.players.map((p) => p.pos);
      }
    }
    assert.ok(worst < 3, `seed ${seed}: a bot stood still for ${worst} rounds before the Nest rose`);
  }
});
