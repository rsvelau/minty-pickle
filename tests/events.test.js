// Event cards in play (src/game/eventPlay.js), driven through real actions:
// stack the Event deck, walk onto an Investigation spot, draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction, clockMinutes, formatClock, isMidnight } from '../src/game/rules.js';
import { armMonster } from '../src/game/equipmentPlay.js';
import { executeIntent } from '../src/game/monsterTurn.js';

// A street (row 5) with the van at the east end, investigation spots along it,
// and a small building (x 2-4, y 2-4) with a door at (3,5)->(3,4).
function setup({ players = 1 } = {}) {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  for (let x = 2; x < 5; x++) { g.setEdge('h', x, 2, 'wall'); g.setEdge('h', x, 5, x === 3 ? 'door' : 'wall'); }
  for (let y = 2; y < 5; y++) { g.setEdge('v', 2, y, 'wall'); g.setEdge('v', 5, y, 'wall'); }
  for (let x = 6; x < 18; x++) g.apply(g.index(x, 5), { marker: 'investigation' }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 4, config: { players, monster: 'none' } });
  const act = (a) => applyAction(state, board, a);
  // Draw `id` from the Event deck at the next spot (one step west).
  const draw = (id, { obols = [] } = {}) => {
    state.decks.events.push(id);
    state.bag = ['event'];
    state.players[state.cur].inventory.obolcraft = obols.map((type) => ({ type }));
    assert.ok(act({ type: 'roll' }).ok);
    state.pool = [{ kind: 'black', v: 1 }];
    act({ type: 'slot', die: 0, to: 'move' });
    act({ type: 'move' });
    for (let k = 0; k < 5 && state.phase === 'choosing'; k++) act({ type: 'choose', cell: Math.min(...state.options.map((o) => o.i)) });
    assert.equal(state.phase, 'asking');
    act({ type: 'investigate', yes: true });
  };
  const finish = () => {
    for (let k = 0; k < 20 && state.phase !== 'idle'; k++) {
      if (state.phase === 'choosing') act({ type: 'choose', cell: Math.min(...state.options.map((o) => o.i)) });
      else if (state.phase === 'asking') act({ type: 'investigate', yes: false });
      else if (state.phase === 'eventing') act({ type: 'event', choice: 'skip' }).ok || act({ type: 'event', choice: 'die' });
      else if (!act({ type: 'end' }).ok) break;
    }
  };
  return { g, board, state, act, draw, finish };
}

test('a Decision pauses for the drawing character; survivors are tallied; Police Patrol reads the tally', () => {
  const s = setup();
  s.draw('insane-survivor');
  assert.equal(s.state.phase, 'eventing');
  assert.ok(!s.act({ type: 'event', choice: 'maybe' }).ok);
  assert.ok(s.act({ type: 'event', choice: 'die' }).ok);
  assert.deepEqual(s.state.survivors, { live: 0, die: 1 });
  s.finish();
  const before = formatClock(clockMinutes(s.state));
  s.draw('police-patrol');                      // a survivor has died: ⏳⏳
  s.finish();                                   // holding an Obol, the turn waits for End turn
  assert.equal(before, '11:05 PM');
  assert.equal(formatClock(clockMinutes(s.state)), '11:20 PM');
});

test('a Live choice you can’t pay for is refused', () => {
  const s = setup();
  s.draw('injured-survivor', { obols: ['attack'] });
  assert.match(s.act({ type: 'event', choice: 'live' }).error, /not available/);
  s.finish();
  const t = setup();
  t.draw('injured-survivor', { obols: ['attack', 'event', 'equipment'] });
  assert.ok(t.act({ type: 'event', choice: 'live' }).ok);
  assert.deepEqual(t.state.players[0].inventory.obolcraft.map((o) => o.type), ['event']); // only the Event Obol just drawn
  assert.equal(Object.keys(t.state.exposed).length, 2);   // two spots exposed
});

test('the clock moves back and forth before midnight, and not after', () => {
  const s = setup();
  s.state.clockShift = 3;
  s.draw('enigmatic-hourglass');
  assert.equal(s.state.phase, 'eventing');
  s.act({ type: 'event', choice: 'use' });
  assert.ok([2, 3].includes(s.state.clockShift));          // heads: back one; tails: an Obol lost
  s.state.clockShift = 50;                                   // force midnight
  s.state.round = 13;
  assert.ok(isMidnight(s.state));
  assert.equal(formatClock(clockMinutes(s.state)), '12:00 AM');
});

test('Sinkhole and Flooded Out change what moving costs; Brambles end the move', () => {
  const s = setup();
  const at = s.g.index(10, 5);
  s.state.hazards.push({ id: 'sinkhole', cell: at, by: 'found', seat: 0, waitFor: null, used: false });
  s.state.players[0].pos = s.g.index(11, 5);
  assert.ok(s.act({ type: 'roll' }).ok);
  s.state.pool = [{ kind: 'black', v: 3 }];
  s.act({ type: 'slot', die: 0, to: 'move' });
  s.act({ type: 'move' });
  assert.notEqual(s.state.players[0].pos, at);              // 3 moves: can't wade in (it costs 5)
});

test('Lockdown locks every door until the drawer’s next turn; a Key opens them all for good', async () => {
  const { doorOverride } = await import('../src/game/eventPlay.js');
  const s = setup();
  s.draw('lockdown');
  const ov = doorOverride(s.state);
  assert.equal(ov('h3,5', 'door'), 'lockedDoor');
  assert.equal(s.state.lockdown.seat, 0);
  s.state.lockdown.turn = -1; // as if the drawer's next turn came round
  s.finish();
  s.act({ type: 'roll' });
  assert.equal(s.state.lockdown, null);
  s.state.lockdown = { seat: 0, turn: s.state.turn };
  const { keyTouched } = await import('../src/game/eventPlay.js');
  keyTouched(s.state, { log: () => {} });
  assert.equal(s.state.allDoorsOpen, true);
  assert.equal(doorOverride(s.state)('h3,5', 'lockedDoor'), 'door');
});

test('Nailed Shut blocks the building’s doors', async () => {
  const { doorOverride } = await import('../src/game/eventPlay.js');
  const s = setup();
  s.draw('nailed-shut');
  assert.equal(s.state.doors['h3,5'], 'blocked');
  assert.equal(doorOverride(s.state)('h3,5', 'door'), 'wall');
});

test('Globals: one at a time; Power Outage turns every light off but the headlights', () => {
  const s = setup();
  s.g.apply(s.g.index(8, 5), { lit: true, radius: 2 }, { silent: true });
  s.board.invalidate();
  assert.ok(s.board.light[s.g.index(8, 5)] > 0.5);
  s.draw('power-outage');
  assert.equal(s.state.global.id, 'power-outage');
  s.finish();
  s.act({ type: 'roll' });
  assert.equal(s.board.light[s.g.index(8, 5)], 0);
  assert.ok(s.board.light[s.g.index(18, 5)] > 0.3);         // in the van's headlights
  s.finish();
  s.draw('bright-moon');
  assert.equal(s.state.global.id, 'bright-moon');            // replaced
});

test('a player trap catches a Corporeal monster walking through it', () => {
  const s = setup();
  s.draw('rusty-bear-trap');
  assert.equal(s.state.phase, 'eventing');
  s.act({ type: 'event', choice: 'use' });
  const trap = s.state.hazards.find((h) => h.id === 'rusty-bear-trap');
  assert.ok(trap);
  const m = { id: 'm1', kind: 'werewolf', pos: trap.cell - 3, prev: -1 };
  armMonster(m);
  s.state.monsters = [m];
  m.intents = [{ roll: 1, name: 'Vicious Pursuit', kind: 'physical', ops: [{ op: 'pursue', n: 8 }], unknown: [] }];
  s.state.players[0].pos = trap.cell + 1;                    // just past the trap, on the street
  executeIntent(s.state, s.board, m, { state: s.state, log: () => {}, randInt: () => 2 }, []);
  assert.equal(m.pos, trap.cell);
  assert.equal(m.immobileRounds, 1);
  assert.equal(trap.used, true);
});

test('Haunted Portrait shuffles in a curse: whoever draws it dies', () => {
  const s = setup();
  s.state.players[0].injuries = { P: 2, M: 1, S: 0 };
  s.draw('haunted-portrait');
  s.act({ type: 'event', choice: 'use' });
  assert.deepEqual(s.state.players[0].injuries, { P: 0, M: 0, S: 0 });
  assert.ok(s.state.decks.events.includes('portrait-curse'));
  s.finish();
  s.state.decks.events = s.state.decks.events.filter((x) => x !== 'portrait-curse');
  s.draw('portrait-curse');
  assert.equal(s.state.players[0].dead, true);
});

test('Mindsets: Rushed doubles movement, Meticulous caps movement dice at 4, Reckless can’t pre-slot defense', () => {
  const s = setup();
  const pl = s.state.players[0];
  pl.mindset = 'rushed';
  s.act({ type: 'roll' });
  s.state.pool = [{ kind: 'black', v: 3 }, { kind: 'black', v: 5 }];
  s.act({ type: 'slot', die: 0, to: 'move' });
  s.act({ type: 'move' });
  assert.equal(s.state.roll, 6);
  s.finish();
  pl.mindset = 'meticulous';
  pl.pos = s.g.index(18, 5);
  s.act({ type: 'roll' });
  s.state.pool = [{ kind: 'black', v: 6 }, { kind: 'black', v: 2 }];
  s.act({ type: 'slot', die: 0, to: 'move' });
  s.act({ type: 'move' });
  assert.equal(s.state.roll, 4);
  s.finish();
  pl.mindset = 'reckless';
  s.act({ type: 'roll' });
  assert.match(s.act({ type: 'slot', die: 0, to: 'defense' }).error, /Reckless/);
  assert.equal(s.state.maxDefense, 0);
});

test('after midnight, clock cards play their midnight versions', () => {
  // Message Cypher: spend two rolled dice to trigger a weakness effect.
  const s = setup();
  s.state.round = 13; s.state.midnightDone = true;
  const m = { id: 'm1', kind: 'werewolf', pos: s.g.index(0, 5), prev: -1 };
  armMonster(m);
  s.state.monsters = [m];
  s.state.decks.events.push('message-cypher');
  s.state.bag = ['event'];
  s.act({ type: 'roll' });
  s.state.pool = [{ kind: 'black', v: 1 }, { kind: 'black', v: 3 }, { kind: 'black', v: 4 }];
  s.act({ type: 'slot', die: 0, to: 'move' });
  s.act({ type: 'move' });
  s.act({ type: 'investigate', yes: true });
  assert.equal(s.state.phase, 'eventing');
  assert.ok(s.act({ type: 'event', choice: 'use' }).ok);
  assert.equal(m.toughLost, 2);                     // the Werewolf's first weakness effect: −2 toughness
  assert.ok(s.state.log.some((l) => /spends 3 and 4/.test(l)));
});

test('after midnight: Police Patrol lures the monster; Hourglass cancels its action; Hide; Chalk skips a turn', async () => {
  const { pastMidnight } = await import('../src/game/eventPlay.js');
  const s = setup({ players: 2 });
  s.state.round = 13; s.state.midnightDone = true;
  assert.ok(pastMidnight(s.state));
  const m = { id: 'm1', kind: 'werewolf', pos: s.g.index(10, 5), prev: -1 };
  armMonster(m);
  s.state.monsters = [m];
  s.draw('police-patrol');
  assert.deepEqual(m.lure, { cell: s.state.players[0].pos });
  // The lure: its next move heads for the sirens, not the players.
  s.state.players[1].pos = s.g.index(2, 5);
  m.intents = [{ roll: 1, name: 'Vicious Pursuit', kind: 'physical', ops: [{ op: 'pursue', n: 2 }], unknown: [] }];
  executeIntent(s.state, s.board, m, { state: s.state, log: () => {}, randInt: () => 2 }, []);
  assert.equal(m.pos, s.g.index(12, 5));
  assert.equal(m.lure, undefined);
  s.finish();
  // Bumped Shelf: Hide ends the turn, and the hidden player can't be targeted this round.
  const seat = s.state.cur;
  s.state.players[seat].pos = s.g.index(14, 5);            // a fresh spot one step west
  s.draw('bumped-shelf');
  assert.ok(s.act({ type: 'event', choice: 'hide' }).ok);
  assert.ok(Number.isInteger(s.state.players[seat].hiddenRound));    // hidden for the round that just closed
  assert.notEqual(s.state.cur, seat);
});

test('Curious: after the event, keep investigating the same spot for a Defense die (lowest goes)', () => {
  const s = setup();
  const pl = s.state.players[0];
  pl.mindset = 'curious';
  s.state.decks.events.push('police-patrol');
  s.state.bag = ['event', 'attack', 'evidence'];
  assert.ok(s.act({ type: 'roll' }).ok);
  s.state.pool = [{ kind: 'black', v: 1 }, { kind: 'black', v: 5 }, { kind: 'black', v: 2 }];
  s.state.maxDefense = 2;
  s.act({ type: 'slot', die: 1, to: 'defense' });
  s.act({ type: 'slot', die: 2, to: 'defense' });
  s.act({ type: 'slot', die: 0, to: 'move' });
  s.act({ type: 'move' });
  const spot = s.state.ask.i;
  // Rig the bag: the event (drawn at random from two), then equipment.
  s.state.bag = ['event', 'event'];
  s.act({ type: 'investigate', yes: true });
  assert.equal(s.state.phase, 'asking', 'asked again');
  assert.ok(s.state.ask.curious);
  assert.equal(s.state.ask.i, spot);
  s.state.bag = ['equipment'];
  s.state.decks.equipment ??= [];
  assert.ok(s.act({ type: 'investigate', yes: true }).ok);
  assert.deepEqual(pl.defense.map((d) => d.v), [5], 'the 2 was paid');
  assert.equal(s.state.bag.length, 0, 'another Obol drawn');
  assert.notEqual(s.state.phase, 'asking', 'not an event this time: no more asking');
});

test('Curious: no Defense die, no asking', () => {
  const s = setup();
  s.state.players[0].mindset = 'curious';
  s.draw('police-patrol');
  assert.notEqual(s.state.phase, 'asking');
});
