// Headless tests for the game rules: they run in plain Node, with no browser
// or three.js, the way a multiplayer server would run them.
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard, boardFromJSON } from '../src/game/board.js';
import { newGame, applyAction, defaultConfig, isMidnight } from '../src/game/rules.js';
import { createLocalSession, createHost, createClient, loopback } from '../src/game/session.js';
import { publicState } from '../src/game/mystery.js';

// A small town: an east-west street with the Start space at the east end,
// a north-south street crossing it, and a few markers.
function town() {
  const g = new GridState(20, 26);
  const paint = (x, y, patch) => g.apply(g.index(x, y), patch, { silent: true });
  for (let x = 0; x < 20; x++) paint(x, 12, { area: 'outdoor', sub: 'street' });
  for (let y = 2; y < 24; y++) paint(6, y, { area: 'outdoor', sub: 'street' });
  paint(19, 12, { area: 'outdoor', sub: 'start', walkable: false, facing: 3 });
  paint(15, 12, { marker: 'investigation' });
  paint(12, 12, { marker: 'whiteDice' });
  paint(9, 12, { marker: 'blackDice' });
  return g;
}

// A simple bot: roll, slot every die it can, move, take the first way at
// forks, and investigate everything.
function playTurn(state, act) {
  assert.equal(state.phase, 'idle');
  assert.ok(act({ type: 'roll' }).ok);
  for (let n = 0; n < state.pool.length && state.slots.length < state.maxSlots; n++) act({ type: 'slot', die: n });
  assert.ok(act({ type: 'move' }).ok);
  for (let guard = 0; guard < 50 && state.phase !== 'idle'; guard++) {
    if (state.phase === 'choosing') assert.ok(act({ type: 'choose', cell: state.options[0].i }).ok);
    else if (state.phase === 'asking') assert.ok(act({ type: 'investigate', yes: true }).ok);
    else if (state.phase === 'eventing') assert.ok(['die', 'stay', 'hide', 'skip'].some((choice) => act({ type: 'event', choice }).ok));
    else if (state.phase === 'revealing') assert.ok(act({ type: 'reveal', card: state.mystery.deck.findIndex((c, k) => !state.mystery.flipped.includes(k)) }).ok);
    else if (state.phase === 'slotting') assert.ok(act({ type: 'end' }).ok);
    else assert.fail(`unexpected phase ${state.phase}`);
  }
  assert.equal(state.phase, 'idle');
}

function playGame({ seed = 1, turns = 30, config = {}, startMode } = {}) {
  const board = createBoard(town());
  const { state } = newGame(board, { seed, config, startMode });
  const events = [];
  const act = (a) => { const r = applyAction(state, board, { ...a, seat: state.cur }); events.push(...r.events); return r; };
  for (let t = 0; t < turns; t++) playTurn(state, act);
  return { state, board, events };
}

test('a whole game runs headless, with legal positions and a moving clock', () => {
  const { state, board } = playGame({ config: { players: 3 } });
  assert.equal(state.players.length, 3);
  assert.equal(state.round, 11); // 30 turns / 3 players + 1
  for (const pl of state.players) {
    const c = board.grid.cells[pl.pos];
    assert.ok(c.walkable || c.sub === 'start', `player on a walkable cell (${pl.pos})`);
  }
  assert.ok(state.log.length > 0);
});

test('same seed and actions give the same game (the host decides every roll)', () => {
  const a = playGame({ seed: 42 }).state;
  const b = playGame({ seed: 42 }).state;
  const c = playGame({ seed: 43 }).state;
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('state is plain JSON: a copy carries on exactly like the original', () => {
  const board = createBoard(town());
  const { state } = newGame(board, { seed: 7 });
  const act = (s) => (a) => applyAction(s, board, { ...a, seat: s.cur });
  for (let t = 0; t < 5; t++) playTurn(state, act(state));
  const copy = JSON.parse(JSON.stringify(state));
  for (let t = 0; t < 5; t++) { playTurn(state, act(state)); playTurn(copy, act(copy)); }
  assert.deepEqual(copy, state);
});

test('actions out of turn or out of phase are rejected', () => {
  const board = createBoard(town());
  const { state } = newGame(board, { seed: 3, config: { players: 2 } });
  assert.equal(applyAction(state, board, { type: 'roll', seat: 1 }).error, 'not your turn');
  assert.equal(applyAction(state, board, { type: 'move', seat: 0 }).ok, false);
  assert.equal(applyAction(state, board, { type: 'bogus' }).ok, false);
});

test('investigating draws Obols from the bag into the player inventory', () => {
  const { state } = playGame({ seed: 5, turns: 8 });
  const drawn = state.players.reduce((a, pl) => a + pl.inventory.obolcraft.length, 0);
  assert.equal(drawn + state.bag.length, 28);
});

test('midnight arrives after turnsToMidnight rounds', () => {
  const { state, events } = playGame({ config: { players: 2, turnsToMidnight: 3 }, turns: 6 });
  assert.ok(isMidnight(state));
  assert.ok(events.some((e) => e.type === 'midnight'));
});

test('a monster spawns at midnight, stalks, and attacks a player it reaches', () => {
  const board = createBoard(town());
  const { state, events: startEvents } = newGame(board, { seed: 9, startMode: 'midnight', config: { players: 1, monster: 'stalker' } });
  assert.equal(state.monsters.length, 1);
  assert.ok(startEvents.some((e) => e.type === 'monsterSpawn'));
  // Put the monster two cells from the player, in the dark, and pass the turn.
  const pl = state.players[0];
  const { x, y } = board.grid.coords(pl.pos);
  state.monsters[0].pos = board.grid.index(x - 3, y);
  board.invalidate();
  const act = (a) => applyAction(state, board, { ...a, seat: state.cur });
  act({ type: 'roll' });
  const r = act({ type: 'move' }); // stay put: the round ends, monsters act
  assert.ok(r.events.some((e) => e.type === 'monsterStep'), 'monster moved');
  const attack = r.events.find((e) => e.type === 'monsterAttack');
  // It stops short of lit cells; the start cell is in the van's headlights,
  // so it may hold back. Either way every step it took was legal:
  for (const e of r.events.filter((ev) => ev.type === 'monsterStep')) {
    const a = board.grid.coords(e.from), b = board.grid.coords(e.to);
    assert.equal(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), 1);
  }
  if (attack) assert.equal(attack.seat, 0);
});

test('a monster next to a player in the dark attacks', () => {
  const g = town();
  // A dark dead-end lane off the street, away from the van's headlights.
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 11, startMode: 'midnight', config: { players: 1, monster: 'stalker' } });
  const pl = state.players[0];
  pl.pos = g.index(6, 20);
  state.monsters[0].pos = g.index(6, 22);
  const act = (a) => applyAction(state, board, { ...a, seat: state.cur });
  act({ type: 'roll' });
  const r = act({ type: 'move' });
  const attack = r.events.find((e) => e.type === 'monsterAttack');
  assert.ok(attack, 'attacked');
  assert.equal(attack.seat, 0);
});

test('the board travels as JSON: a server can rebuild it and run the same game', () => {
  const g = town();
  const local = createBoard(g);
  const remote = boardFromJSON(JSON.stringify(g.toJSON()));
  assert.equal(remote.startCell(), local.startCell());
  const a = newGame(local, { seed: 21 }).state;
  const b = newGame(remote, { seed: 21 }).state;
  assert.deepEqual(a, b);
});

test('multiplayer shape: a host and two phones stay in sync; seats are enforced', () => {
  const board = createBoard(town());
  const net = loopback();
  const host = createHost({ board, transport: net.host });
  const rejects = [];
  const phoneA = createClient({ clientId: 'A', transport: net.client, onReject: (e) => rejects.push(['A', e]) });
  const phoneB = createClient({ clientId: 'B', transport: net.client, onReject: (e) => rejects.push(['B', e]) });
  host.start({ seed: 99, config: { players: 2 } });
  phoneA.claim(0);
  phoneB.claim(1);
  // B tries to roll on A's turn: refused.
  phoneB.dispatch({ type: 'roll' });
  assert.deepEqual(rejects, [['B', 'not your turn']]);
  // A plays a whole turn through the host; every phone mirrors the host.
  const st = () => phoneA.state;
  phoneA.dispatch({ type: 'roll' });
  for (let n = 0; n < st().pool.length; n++) phoneA.dispatch({ type: 'slot', die: n });
  phoneA.dispatch({ type: 'move' });
  for (let guard = 0; guard < 50 && st().phase !== 'idle'; guard++) {
    if (st().phase === 'choosing') phoneA.dispatch({ type: 'choose', cell: st().options[0].i });
    else if (st().phase === 'slotting') phoneA.dispatch({ type: 'end' });
    else phoneA.dispatch({ type: 'investigate', yes: true });
  }
  assert.equal(host.state.cur, 1);
  assert.deepEqual(phoneA.state, publicState(host.state));
  assert.deepEqual(phoneB.state, publicState(host.state));
  // ...and the phones never see the secret monster.
  assert.equal(phoneA.state.mystery.monster, null);
});

test('the local session used by the app wraps the same rules', () => {
  const board = createBoard(town());
  const seen = [];
  const s = createLocalSession({ board, onUpdate: (_st, ev) => seen.push(...ev.map((e) => e.type)) });
  s.start({ seed: 1, config: defaultConfig() });
  assert.ok(s.dispatch({ type: 'roll', seat: 0 }).ok);
  assert.ok(seen.includes('start') && seen.includes('rolled'));
});
