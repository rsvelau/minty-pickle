// Objective sites and monster objective scripts (step 1 of the objective
// system): what a marker stands for, which monsters a map can host, and which
// markers a revealed monster uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { siteOf, siteByNumber } from '../src/core/sites.js';
import { createBoard } from '../src/game/board.js';
import { newGame } from '../src/game/rules.js';
import { monsterAvailability, objectiveCells, objectiveProblems, objectiveLive, mapSites, knownMonster } from '../src/game/objectives/scripts.js';

// A street with the van, and Objective markers on row 0 with the given sites.
function map(sites = []) {
  const g = new GridState(20, 12);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  g.apply(g.index(10, 5), { marker: 'investigation' }, { silent: true });
  sites.forEach((site, k) => g.apply(g.index(k * 2, 0), { marker: 'objective', site }, { silent: true }));
  return g;
}

test('a marker’s site: the author’s pick, else its floor (Church, Hospital), else none', () => {
  assert.equal(siteOf({ marker: 'objective', site: 'hotel', sub: 'carpet' }), 'hotel');
  assert.equal(siteOf({ marker: 'objective', site: null, sub: 'church' }), 'church');
  assert.equal(siteOf({ marker: 'objective', site: null, sub: 'hospital' }), 'hospital');
  assert.equal(siteOf({ marker: 'objective', site: null, sub: 'carpet' }), null);
  assert.equal(siteOf({ marker: 'investigation', site: 'church' }), null);
  assert.equal(siteByNumber(9), 'church');
  assert.equal(siteByNumber(1), 'hotel');
  assert.equal(siteByNumber(13), 'hospital');
});

test('the site is saved with the map, and only on Objective markers', () => {
  const g = map(['church']);
  const json = g.toJSON();
  assert.equal(json.cells[g.index(0, 0)].site, 'church');
  const back = new GridState(20, 12);
  back.load(json);
  assert.equal(back.cells[g.index(0, 0)].site, 'church');
  g.apply(g.index(0, 0), { marker: 'key', site: null });
  assert.equal(g.toJSON().cells[g.index(0, 0)].site, undefined);
});

test('a monster whose objective needs a missing site is disabled on that map, and says why', () => {
  const bare = monsterAvailability(map());
  const adze = bare.disabled.find((d) => d.id === 'adze');
  assert.deepEqual(adze.missing, ['Hotel', 'Bar', 'Hospital']);
  assert.ok(bare.available.includes('werewolf'), 'a plain Kill needs nothing');
  assert.ok(bare.disabled.some((d) => d.id === 'poltergeist'), 'anchors need 4 Objective markers');
  const full = monsterAvailability(map(['church', 'hotel', 'bar', 'hospital', 'boutique', 'curio', 'funeral', 'outdoor']));
  assert.deepEqual(full.disabled, []);
  assert.match(objectiveProblems(map(['church']))[0].text, /Adze \(needs Hotel, Bar, Hospital\)/);
});

test('a disabled monster is never drawn on that map, even when picked', () => {
  for (let seed = 1; seed < 25; seed++) {
    const board = createBoard(map(['church']));
    const { state } = newGame(board, { seed, config: { players: 1, monsterPick: 'adze' } });
    assert.notEqual(state.mystery.monster, 'adze');
    assert.ok(!state.mystery.pool.includes('adze'));
  }
});

test('once revealed, only that monster’s sites are in play; a Kill monster has none', () => {
  const g = map(['church', 'hotel', 'bar', 'hospital']);
  const at = (site) => mapSites(g)[site][0];
  assert.deepEqual(objectiveCells(g, 'hellhounds'), [at('church')]);
  assert.deepEqual(objectiveCells(g, 'adze').sort(), [at('hotel'), at('bar'), at('hospital')].sort());
  assert.deepEqual(objectiveCells(g, 'werewolf'), []);
  assert.equal(objectiveCells(g, 'poltergeist').length, 4, 'every marker can be an anchor');
  const state = { mystery: { monster: 'hellhounds', initiative: false } };
  assert.equal(objectiveLive(state, g, at('church')), false, 'not known yet');
  state.mystery.identified = true;                     // all five pieces of evidence
  assert.equal(objectiveLive(state, g, at('church')), true);
  assert.equal(objectiveLive(state, g, at('hotel')), false);
  assert.equal(objectiveLive({ mystery: null }, g, at('hotel')), true, 'no mystery: all of them');
});

// --- Step 2: the verbs, played -------------------------------------------------------
import { applyAction } from '../src/game/rules.js';
import { onSiteEnter, suffocate, crossingBlocked } from '../src/game/objectives/verbs.js';
import { armMonster } from '../src/game/equipmentPlay.js';
import { revealEvidence } from '../src/game/mystery.js';

// A game against `kind`, known (revealed); the Church at (0,0); the Lair at (6,0).
function fight(kind, { players = 3 } = {}) {
  const g = map(['church']);
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 2, config: { players, monster: 'none' } });
  state.mystery = { monster: kind, revealed: true, spawnCell: g.index(6, 0), deck: [], flipped: [], found: [], pool: [kind] };
  const monster = { id: 'm1', kind, pos: g.index(19, 11), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const log = [];
  const ctx = { state, log: (s, m) => log.push(m), randInt: () => 1 };   // coins: tails
  const at = (pl, x, y) => { pl.pos = g.index(x, y); const ev = []; onSiteEnter(state, board, pl, pl.pos, ctx, ev); return ev; };
  return { g, board, state, monster, ctx, at, log };
}

test('Shadow People: a lit candle from the Church, carried to the Lair; 4 win (one each at a time)', () => {
  const s = fight('shadow-people');
  const [a, b, c] = s.state.players;
  s.at(a, 0, 0);
  assert.deepEqual(a.carry, [{ item: 'candle', lit: true }]);
  s.at(a, 0, 0);
  assert.equal(a.carry.length, 1, 'one at a time');
  for (const p of [a, b, c]) { s.at(p, 0, 0); s.at(p, 6, 0); }
  assert.equal(s.state.objective.delivered.candle, 3);
  assert.ok(!s.state.won);
  s.at(a, 0, 0); s.at(a, 6, 0);
  assert.ok(s.state.won, '4 candles: the Dark Room is lit');
});

test('Shadow People: two candles are enough with one or two players', () => {
  const s = fight('shadow-people', { players: 2 });
  for (const p of s.state.players) { s.at(p, 0, 0); s.at(p, 6, 0); }
  assert.ok(s.state.won);
});

test('Suffocating Darkness: ending the turn in the dark with a lit candle, tails puts it out; Fire keeps it lit', () => {
  const s = fight('shadow-people');
  const pl = s.state.players[0];
  s.at(pl, 0, 0);
  s.board.light[pl.pos] = 0;
  suffocate(s.state, s.board, pl, s.ctx, []);
  assert.equal(pl.carry[0].lit, false);
  s.at(pl, 6, 0);
  assert.equal(s.state.objective?.delivered?.candle ?? 0, 0, 'a dead candle doesn’t count');
  s.at(pl, 0, 0);
  assert.equal(pl.carry[0].lit, true, 'relit at the Church');
  pl.inventory.equipment = [{ id: 'dragons-breath-shotgun' }];
  pl.pos = s.g.index(3, 3);
  s.board.light[pl.pos] = 0;
  suffocate(s.state, s.board, pl, s.ctx, []);
  assert.equal(s.state.reactions.length, 1, 'Discard Fire & keep candle lit is offered');
  assert.ok(applyAction(s.state, s.board, { type: 'react', yes: true, seat: 0 }).ok);
  assert.equal(pl.carry[0].lit, true);
});

test('Barghest: cleanse at the Church; the uncleansed can’t step onto a bridge or leave; the first escape wins, play goes on', () => {
  const s = fight('barghest', { players: 2 });
  const [a, b] = s.state.players;
  s.g.cells[s.g.index(12, 5)].bridge = true;
  a.pos = s.g.index(13, 5);
  assert.ok(crossingBlocked(s.state, s.board, a, s.g.index(12, 5)));
  const start = s.board.startCell();
  s.at(a, ...Object.values(s.g.coords(start)));
  assert.ok(!a.escaped, 'not cleansed');
  s.at(a, 0, 0);
  assert.ok(a.status.cleanse);
  assert.ok(!crossingBlocked(s.state, s.board, a, s.g.index(12, 5)));
  s.at(a, ...Object.values(s.g.coords(start)));
  assert.ok(a.escaped && s.state.won);
  assert.notEqual(s.state.phase, 'over', 'play goes on for the others');
  // P2 falls on their turn: everyone is out, and the investigators have won.
  s.state.cur = 1;
  assert.ok(applyAction(s.state, s.board, { type: 'roll', seat: 1 }).ok);
  b.dead = true;
  const r = applyAction(s.state, s.board, { type: 'end', seat: 1 });
  assert.equal(s.state.phase, 'over');
  assert.ok(r.events.some((e) => e.type === 'won'));
});

test('all five pieces of evidence identify the monster before midnight: its objectives go live', () => {
  const board = createBoard(map(['church', 'hotel', 'bar', 'hospital', 'boutique', 'curio', 'funeral', 'outdoor']));
  const { state } = newGame(board, { seed: 3, config: { players: 1, monsterPick: 'hellhounds' } });
  const m = state.mystery;
  assert.equal(knownMonster(state), null);
  const ctx = { log: () => {}, cellLabel: () => '', time: () => '' };
  m.attack = { code: 'P' };
  for (let i = 0; i < m.deck.length; i++) {
    assert.equal(knownMonster(state), null, 'not until the last card');
    m.pendingReveal = { cell: 0 };
    revealEvidence(state, board, i, ctx, []);
  }
  assert.ok(m.identified);
  assert.equal(knownMonster(state), 'hellhounds');
  const church = mapSites(board.grid).church[0];
  assert.ok(objectiveLive(state, board.grid, church), 'its site is in play before midnight');
});
