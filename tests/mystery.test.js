// The mystery: secret monster, choosing evidence, attacks, naming, secrecy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { publicState, matchesEvidence } from '../src/game/mystery.js';
import { MONSTER_CARDS, MONSTER_BY_ID, MONSTER_POOLS } from '../src/game/cards/monsters.js';
import { OBSERVATIONS, LAIRS, ATTACK_TYPES } from '../src/game/cards/evidence.js';

// Objective sites a monster may need (src/core/sites.js), on row 0, away from the street.
function withSites(g) {
  ['church', 'hotel', 'bar', 'hospital', 'boutique', 'curio', 'funeral', 'outdoor'].forEach((site, k) => g.apply(g.index(k * 2, 0), { marker: 'objective', site }, { silent: true }));
  return g;
}
function street() {
  const g = new GridState(20, 26);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 12), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 12), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  withSites(g);
  for (let x = 10; x < 18; x++) g.apply(g.index(x, 12), { marker: 'investigation' }, { silent: true });
  return g;
}
const setup = (extra = {}) => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 3, config: { players: 1, ...extra } });
  const act = (a) => applyAction(state, board, { ...a, seat: state.cur });
  return { board, state, act };
};
// Move one cell west onto the next Investigation space and say yes.
function investigateNext(state, act, obol, board = null) {
  if (state.phase === 'slotting') act({ type: 'end' });
  state.bag = [obol];
  act({ type: 'roll' });
  state.pool = [{ kind: 'black', v: 1 }];
  act({ type: 'slot', die: 0 });
  act({ type: 'move' });
  if (state.phase === 'choosing') {
    const west = state.options.reduce((a, o) => (o.i < a.i ? o : a));
    act({ type: 'choose', cell: west.i });
  }
  if (state.phase === 'asking') return act({ type: 'investigate', yes: true });
  return null;
}

test('every monster card has 1 attack, 3 observations and 1 lair, all named', () => {
  assert.equal(MONSTER_CARDS.length, 13);
  for (const c of MONSTER_CARDS) {
    assert.ok(ATTACK_TYPES[c.evidence.attack], `${c.name} attack`);
    assert.equal(c.evidence.observations.length, 3, `${c.name} observations`);
    for (const o of c.evidence.observations) assert.ok(OBSERVATIONS[o], `${c.name} ${o}`);
    assert.ok(LAIRS[c.evidence.lair], `${c.name} lair`);
  }
  for (const p of Object.values(MONSTER_POOLS)) for (const id of p.ids) assert.ok(MONSTER_BY_ID[id]);
});

test('a secret monster and its four face-down evidence cards', () => {
  const { state } = setup();
  const m = state.mystery;
  const card = MONSTER_BY_ID[m.monster];
  assert.ok(card);
  assert.equal(m.deck.length, 4);
  assert.deepEqual(m.deck.filter((c) => c.kind === 'observation').map((c) => c.code).sort(), [...card.evidence.observations].sort());
  assert.equal(m.deck.find((c) => c.kind === 'lair').code, card.evidence.lair);
});

test('the public view hides the monster, unturned cards, spawn and dice', () => {
  const { state } = setup();
  const pub = publicState(state);
  assert.equal(pub.mystery.monster, null);
  assert.deepEqual(pub.mystery.deck, [null, null, null, null]);
  assert.equal(pub.mystery.spawnCell, -1);
  assert.equal(pub.rng, 0);
  assert.ok(!JSON.stringify(pub.mystery.deck).includes('code'));
});

test('an Evidence Obol lets the investigator choose a card; it flips and marks the cell', () => {
  const { state, act } = setup();
  investigateNext(state, act, 'evidence');
  assert.equal(state.phase, 'revealing');
  assert.equal(act({ type: 'reveal', card: 9 }).ok, false);
  const r = act({ type: 'reveal', card: 2 });
  assert.ok(r.ok);
  const ev = r.events.find((e) => e.type === 'evidence');
  assert.equal(ev.code, state.mystery.deck[2].code);
  assert.equal(ev.cell, state.players[0].pos);
  assert.deepEqual(publicState(state).mystery.deck[2], state.mystery.deck[2]);
  assert.equal(publicState(state).mystery.deck[0], null);
  // The same card can't be turned twice.
  investigateNext(state, act, 'evidence');
  assert.equal(act({ type: 'reveal', card: 2 }).ok, false);
});

test('an Attack Obol deals one die and reveals the Attack card the first time', () => {
  const { state, act } = setup();
  const type = MONSTER_BY_ID[state.mystery.monster].evidence.attack;
  const r1 = investigateNext(state, act, 'attack');
  const a1 = r1.events.find((e) => e.type === 'attacked');
  assert.ok(a1.first && a1.amount >= 1 && a1.amount <= 6 && a1.attack === type);
  assert.equal(publicState(state).mystery.attack.code, type);
  const r2 = investigateNext(state, act, 'attack');
  const a2 = r2.events.find((e) => e.type === 'attacked');
  assert.equal(a2.first, false);
  // No defense slotted: each hit is one tier on the attack's track.
  assert.equal(state.players[0].injuries[type], 2);
});

test('the evidence narrows the field guide to the right monster', () => {
  const { state } = setup();
  const card = MONSTER_BY_ID[state.mystery.monster];
  const found = { attack: card.evidence.attack, cards: state.mystery.deck };
  const left = MONSTER_CARDS.filter((c) => matchesEvidence(c, found));
  assert.deepEqual(left.map((c) => c.id), [card.id]);
});

test('naming the monster: once, before midnight; correct gives Initiative', () => {
  const { state, act } = setup();
  const right = state.mystery.monster;
  const wrong = MONSTER_CARDS.find((c) => c.id !== right).id;
  const r = act({ type: 'name', monster: right });
  assert.ok(r.ok);
  assert.ok(state.mystery.initiative);
  assert.ok(publicState(state).mystery.spawnCell >= 0, 'spawn cell shown with Initiative');
  assert.equal(act({ type: 'name', monster: wrong }).error, 'already named');
  const b = setup();
  b.act({ type: 'name', monster: MONSTER_CARDS.find((c) => c.id !== b.state.mystery.monster).id });
  assert.equal(b.state.mystery.initiative, false);
});

test('at midnight the monster is revealed and appears at its spawn cell', () => {
  const board = createBoard(street());
  const { state, events } = newGame(board, { seed: 8, startMode: 'midnight', config: { players: 1 } });
  assert.ok(state.mystery.revealed);
  assert.equal(publicState(state).mystery.monster, state.mystery.monster);
  assert.equal(state.monsters[0].kind, state.mystery.monster);
  assert.equal(state.monsters[0].pos, state.mystery.spawnCell);
  assert.ok(events.some((e) => e.type === 'monsterRevealed'));
});

test('monster pools limit which monster can be drawn', () => {
  for (let seed = 1; seed < 30; seed++) {
    const board = createBoard(street());
    const { state } = newGame(board, { seed, config: { monsterPool: 'spirits' } });
    assert.ok(MONSTER_POOLS.spirits.ids.includes(state.mystery.monster));
  }
});

test('a specific monster can be chosen (testing)', () => {
  for (const id of ['wendigo', 'shadow-people']) {
    const board = createBoard(street());
    const { state } = newGame(board, { seed: 4, config: { monsterPick: id, monsterPool: 'folklore' } });
    assert.equal(state.mystery.monster, id);
    assert.ok(state.mystery.pool.includes(id));
  }
});

test('at midnight a found Lair is where the monster rises', () => {
  const board = createBoard(street());
  const { state } = newGame(board, { seed: 12, config: { players: 1, turnsToMidnight: 1 } });
  const act = (a) => applyAction(state, board, { ...a, seat: state.cur });
  investigateNext(state, act, 'evidence');
  const lairIdx = state.mystery.deck.findIndex((c) => c.kind === 'lair');
  act({ type: 'reveal', card: lairIdx });
  const lairCell = state.players[0].pos;
  if (state.phase === 'slotting') act({ type: 'end' });
  // The round ends: midnight.
  assert.ok(state.mystery.revealed);
  assert.equal(state.monsters[0].pos, lairCell);
});

test('at midnight a hidden Lair takes over an undiscovered investigation spot', () => {
  const board = createBoard(street());
  const { state, events } = newGame(board, { seed: 13, startMode: 'midnight', config: { players: 1 } });
  const lair = state.mystery.found.find((f) => f.kind === 'lair');
  assert.ok(lair, 'the lair card turned over');
  assert.equal(board.grid.cells[lair.cell].marker, 'investigation');
  assert.ok(state.used.includes(lair.cell));
  assert.equal(state.monsters[0].pos, lair.cell);
  assert.ok(events.some((e) => e.type === 'evidence' && e.kind === 'lair' && e.midnight));
});

test('monsters only walk on walkable cells', () => {
  const g = street();
  // A blocked row between the monster and the player.
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 13), { area: 'outdoor', sub: 'forest', walkable: false }, { silent: true });
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 14), { area: 'outdoor', sub: 'street' }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 3, startMode: 'midnight', config: { players: 1, monsterPick: 'werewolf' } });
  const mo = state.monsters[0];
  mo.pos = g.index(10, 14);
  mo.intents = [{ roll: 1, ability: 0, name: 'Vicious Pursuit', kind: 'physical', text: 'Pursue (8) and Attack (4)', ops: [{ op: 'pursue', n: 8 }, { op: 'attack', dmg: { fixed: 4 } }], unknown: [] }];
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  const r = act({ type: 'end' });
  for (const e of r.events.filter((ev) => ev.type === 'monsterStep')) assert.ok(g.cells[e.to].walkable, `stepped onto ${e.to}`);
  assert.ok(g.cells[mo.pos].walkable);
});

test('a Research marker lets the player choose a piece of evidence to reveal', () => {
  const g = street();
  g.apply(g.index(17, 12), { marker: 'research' }, { silent: true });
  g.apply(g.index(17, 12), { marker: 'research' }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 3, config: { players: 1 } });
  const act = (a) => applyAction(state, board, { ...a, seat: 0 });
  act({ type: 'roll' });
  state.pool = [{ kind: 'black', v: 1 }];
  act({ type: 'slot', die: 0 });
  act({ type: 'move' });
  if (state.phase === 'choosing') act({ type: 'choose', cell: g.index(17, 12) });
  assert.equal(state.phase, 'revealing');
  const r = act({ type: 'reveal', card: 1 });
  assert.ok(r.ok);
  assert.equal(state.mystery.found.length, 1);
  assert.equal(state.mystery.found[0].cell, g.index(17, 12));
});
