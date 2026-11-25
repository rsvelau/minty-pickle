// Objective sites and monster objective scripts (step 1 of the objective
// system): what a marker stands for, which monsters a map can host, and which
// markers a revealed monster uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { siteOf, siteByNumber } from '../src/core/sites.js';
import { createBoard } from '../src/game/board.js';
import { newGame } from '../src/game/rules.js';
import { monsterAvailability, objectiveCells, objectiveProblems, objectiveLive, mapSites } from '../src/game/objectives/scripts.js';

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
  const full = monsterAvailability(map(['church', 'hotel', 'bar', 'hospital']));
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
  const state = { mystery: { monster: null, initiative: false } };
  assert.equal(objectiveLive(state, g, at('church')), false, 'not known yet');
  state.mystery.monster = 'hellhounds';
  assert.equal(objectiveLive(state, g, at('church')), true);
  assert.equal(objectiveLive(state, g, at('hotel')), false);
  assert.equal(objectiveLive({ mystery: null }, g, at('hotel')), true, 'no mystery: all of them');
});
