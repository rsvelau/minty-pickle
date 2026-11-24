// Doors in play: Breach, Nail Shut and Lock (equipment), and what they mean
// for players' and monsters' movement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState, edgeKey } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction, nextOptions } from '../src/game/rules.js';
import { gameDoorOverride, doorsAround } from '../src/game/doors.js';
import { resolveEvent } from '../src/game/eventPlay.js';

// A street along row 5 (van at the east end) and a small building (x 5-7,
// y 2-4) whose only door is on the street side, at (6,4)|(6,5).
function setup(doorType = 'door') {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (let y = 2; y < 5; y++) for (let x = 5; x < 8; x++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  for (let x = 5; x < 8; x++) { g.setEdge('h', x, 2, 'wall'); g.setEdge('h', x, 5, x === 6 ? doorType : 'wall'); }
  for (let y = 2; y < 5; y++) { g.setEdge('v', 5, y, 'wall'); g.setEdge('v', 8, y, 'wall'); }
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 3, config: { players: 1, monster: 'none' } });
  const pl = state.players[0];
  pl.pos = g.index(6, 5);                                  // on the street, in front of the door
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  const door = edgeKey('h', 6, 5);
  // Roll, give the player `items`, and set the dice.
  const ready = (items, dice = [3, 3, 3, 3]) => {
    assert.ok(act({ type: 'roll' }).ok);
    pl.inventory.equipment = items.map((id) => ({ id }));
    state.pool = dice.map((v) => ({ kind: 'black', v }));
    state.slots = []; state.defSlots = [];
  };
  return { g, board, state, pl, act, door, ready };
}
// Can you walk from the street into the building (no keys)?
const canEnter = (s) => {
  const { x, y } = s.g.coords(s.pl.pos);
  s.board.grid.edgeOverride = gameDoorOverride(s.state);
  const ok = s.g.moveField(x, y, { keys: false }).dist[s.g.index(6, 3)] >= 0;
  s.board.grid.edgeOverride = null;
  return ok;
};

test('the door next to you is found; nothing to target without one', () => {
  const s = setup();
  assert.deepEqual(doorsAround(s.state, s.board, s.pl.pos).map((d) => d.side), ['north']);
  s.ready(['crowbar']);
  s.pl.pos = s.g.index(12, 5);                             // no door here
  assert.match(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).error, /no door next to you/);
});

test('Nail Shut blocks the door for everyone, monsters too; the Cut Spike breaks', () => {
  const s = setup();
  assert.ok(canEnter(s));
  s.ready(['cut-spike']);
  const r = s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] });
  assert.ok(r.ok, r.error);
  assert.equal(s.state.doors[s.door], 'blocked');
  assert.equal(s.pl.inventory.equipment.length, 0, 'the spike is used up');
  assert.ok(r.events.some((e) => e.type === 'doors'));
  assert.equal(canEnter(s), false, 'a wall to everyone (this is what monsters walk by too)');
});

test('Lock works the same, and the chain is left on the door', () => {
  const s = setup();
  s.ready(['iron-chain']);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);
  assert.equal(s.state.doors[s.door], 'blocked');
  assert.equal(s.pl.inventory.equipment.length, 0, 'the chain is lost');
  assert.equal(canEnter(s), false);
});

test('Breach opens any door for good: a locked one, or one nailed shut', () => {
  const s = setup('lockedDoor');
  assert.equal(canEnter(s), false, 'locked, and no key');
  s.ready(['crowbar', 'cut-spike']);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);   // Breach
  assert.equal(s.state.doors[s.door], 'breached');
  assert.ok(canEnter(s), 'an open doorway');
  // Nothing left to nail: the Cut Spike has no door to shut.
  assert.match(s.act({ type: 'use', item: 1, ability: 1, dice: [2, 3] }).error, /no door next to you/);

  const t = setup();
  t.ready(['cut-spike', 'firemans-axe']);
  assert.ok(t.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);   // nailed shut
  assert.ok(t.act({ type: 'use', item: 0, ability: 1, dice: [2, 3] }).ok);   // the axe breaches it
  assert.equal(t.state.doors[t.door], 'breached');
  assert.ok(canEnter(t));
});

test('a breached doorway stays open: the Nailed Shut event and Lockdown pass it by', () => {
  const s = setup();
  s.ready(['crowbar']);
  assert.ok(s.act({ type: 'use', item: 0, ability: 1, dice: [0, 1] }).ok);
  const ctx = { log: () => {}, randInt: () => 0, curPlayer: (st) => st.players[st.cur], isMidnight: () => false, label: () => '' };
  resolveEvent(s.state, s.board, 'nailed-shut', s.pl.pos, ctx, []);
  assert.equal(s.state.doors[s.door], 'breached');
  s.state.lockdown = { seat: 0, turn: s.state.turn };
  s.board.grid.edgeOverride = null;
  s.state.steps = 3;                                     // moves to spend
  assert.ok(nextOptions(s.state, s.board, { back: true }).some((o) => o.i === s.g.index(6, 4)), 'players walk through in Lockdown');
});

// --- Monsters at doors ---------------------------------------------------------------
import { armMonster } from '../src/game/equipmentPlay.js';
import { executeIntent, bodyOf, DOOR_HP } from '../src/game/monsterTurn.js';

// The player inside the building (6,3); a monster of `kind` on the street at
// (10,5). Its turn: `ops` (default Pursue 8 and Attack 4); every die rolls `die`.
function hunt(kind, { doorType = 'door', blocked = null, ops = null, die = 4 } = {}) {
  const s = setup(doorType);
  s.pl.pos = s.g.index(6, 3);
  if (blocked) { s.state.doors = { [s.door]: 'blocked' }; if (blocked === 'chain') s.state.doorHp = { [s.door]: 12 }; }
  const monster = { id: 'm1', kind, pos: s.g.index(10, 5), prev: -1, revealed: true };
  armMonster(monster);
  s.state.monsters = [monster];
  const intent = (o) => ({ roll: 1, ability: 0, name: 'Hunt', kind: 'physical', text: '', ops: o, unknown: [] });
  const round = (o = ops ?? [{ op: 'pursue', n: 8 }, { op: 'attack', dmg: { fixed: 4 } }], more = []) => {
    monster.intents = [intent(o), ...more.map(intent)];
    const events = [];
    s.board.grid.edgeOverride = gameDoorOverride(s.state);
    executeIntent(s.state, s.board, monster, { state: s.state, log: () => {}, randInt: () => die - 1 }, events);
    s.board.grid.edgeOverride = null;
    return events;
  };
  return { ...s, monster, round };
}

test('bodies come from the card: Corporeal, Incorporeal, Semi-Corporeal', () => {
  assert.equal(bodyOf('werewolf'), 'corporeal');
  assert.equal(bodyOf('poltergeist'), 'incorporeal');
  assert.equal(bodyOf('barghest'), 'semi');
});

test('a Corporeal monster stops at a nailed door in its path and bashes it down (10 health)', () => {
  const s = hunt('werewolf', { blocked: 'nail' });
  let ev = s.round();
  assert.equal(s.monster.pos, s.g.index(6, 5), 'it walks up to the door and stops');
  assert.ok(ev.some((e) => e.type === 'doorBash' && e.amount === 4 && e.hp === DOOR_HP - 4), 'its attack, with no one in reach, became a Bash');
  assert.equal(s.state.doors[s.door], 'blocked');
  s.round([{ op: 'attack', dmg: { fixed: 4 } }]);          // 10 − 4 − 4 = 2
  ev = s.round([{ op: 'attack', dmg: { fixed: 4 } }]);     // broken
  assert.equal(s.state.doors[s.door], 'breached');
  assert.ok(ev.some((e) => e.type === 'doors'));
  s.round([{ op: 'pursue', n: 8 }]);
  assert.equal(s.monster.pos, s.g.index(6, 4), 'through the doorway, next to the player');
});

test('a chained door takes 12; a map-locked door stops and gets bashed too', () => {
  const c = hunt('werewolf', { blocked: 'chain', die: 6 });
  c.round();
  assert.equal(c.state.doorHp[c.door], 6);
  c.round([{ op: 'attack', dmg: { fixed: 4 } }]);
  assert.equal(c.state.doors[c.door], 'breached');
  const l = hunt('werewolf', { doorType: 'lockedDoor' });
  l.round();
  assert.equal(l.monster.pos, l.g.index(6, 5));
  assert.equal(l.state.doorHp[l.door], 6);
});

test('no Bash when the door is not in the way, or someone is in reach', () => {
  const s = hunt('werewolf', { blocked: 'nail' });
  s.pl.pos = s.g.index(2, 5);                              // the player is out on the street
  const ev = s.round();
  assert.ok(!ev.some((e) => e.type === 'doorBash'));
});

test('an Incorporeal monster phases through walls and doors', () => {
  const s = hunt('poltergeist', { blocked: 'nail' });
  const ev = s.round([{ op: 'pursue', n: 8 }, { op: 'attack', dmg: { fixed: 4 } }]);
  assert.ok(!ev.some((e) => e.type === 'doorBash'));
  assert.ok(Math.abs(s.g.coords(s.monster.pos).x - 6) + Math.abs(s.g.coords(s.monster.pos).y - 3) === 1, 'right next to the player, inside');
  assert.ok(ev.some((e) => e.type === 'damage'), 'and attacks');
});

test('a Semi-Corporeal monster leaves the door alone when it will teleport later this round', () => {
  const s = hunt('barghest', { blocked: 'nail' });
  let ev = s.round(undefined, [[{ op: 'teleport', to: 'light' }]]);
  assert.ok(!ev.some((e) => e.type === 'doorBash'));
  const t = hunt('barghest', { blocked: 'nail' });
  ev = t.round();
  assert.ok(ev.some((e) => e.type === 'doorBash'), 'no teleport coming: it bashes like a Corporeal one');
});
