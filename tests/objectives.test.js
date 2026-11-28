// Objective sites and monster objective scripts (step 1 of the objective
// system): what a marker stands for, which monsters a map can host, and which
// markers a revealed monster uses.
import { test } from 'node:test';
import { skillStatus } from '../src/game/skills.js';
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

test('Shadow People: a lit candle from the Church, carried to the Lair; one per investigator wins (one each at a time)', () => {
  const s = fight('shadow-people');
  const [a, b, c] = s.state.players;
  s.at(a, 0, 0);
  assert.deepEqual(a.carry, [{ item: 'candle', lit: true }]);
  s.at(a, 0, 0);
  assert.equal(a.carry.length, 1, 'one at a time');
  for (const p of [a, b]) { s.at(p, 0, 0); s.at(p, 6, 0); }
  assert.equal(s.state.objective.delivered.candle, 2);
  assert.ok(!s.state.won);
  s.at(c, 0, 0); s.at(c, 6, 0);
  assert.ok(s.state.won, '3 candles for 3 investigators: the Dark Room is lit');
});

test('Shadow People: candles needed = team size (1 solo, 2 with two)', () => {
  const two = fight('shadow-people', { players: 2 });
  for (const p of two.state.players) { two.at(p, 0, 0); two.at(p, 6, 0); }
  assert.ok(two.state.won);
  const solo = fight('shadow-people', { players: 1 });
  solo.at(solo.state.players[0], 0, 0); solo.at(solo.state.players[0], 6, 0);
  assert.ok(solo.state.won);
});

test('Shadow People: a lit candle gives +1 Defense', async () => {
  const { defenseValue } = await import('../src/game/combat.js');
  const s = fight('shadow-people');
  const pl = s.state.players[0];
  const before = defenseValue(pl, 'P');
  s.at(pl, 0, 0);
  assert.equal(defenseValue(pl, 'P'), before + 1);
  pl.carry[0].lit = false;
  assert.equal(defenseValue(pl, 'P'), before);
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
  // The way out opens 3 rounds after midnight: cleansed, but before then they can't leave.
  const struck = s.state.midnightRound;
  s.state.midnightRound = null;
  s.at(a, ...Object.values(s.g.coords(start)));
  assert.ok(!a.escaped && !s.state.won, 'not before midnight');
  s.state.midnightRound = s.state.round - 2;
  s.at(a, 0, 0); s.at(a, ...Object.values(s.g.coords(start)));
  assert.ok(!a.escaped, 'two rounds after midnight: still shut');
  s.state.midnightRound = s.state.round - 3;
  void struck;
  s.at(a, 0, 0);
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

// --- Step 3: Hellhounds, Poltergeist, Strigoi, White Lady -----------------------------
import { executeIntent, parseAbility } from '../src/game/monsterTurn.js';
import { MONSTER_BY_ID } from '../src/game/cards/monsters.js';
import { holdRound } from '../src/game/objectives/verbs.js';

// Every site on row 0 (church at (0,0) ... outdoor at (14,0)); the Lair at (6,2).
function fight3(kind, { players = 2 } = {}) {
  const g = map(['church', 'hotel', 'bar', 'hospital', 'boutique', 'curio', 'funeral', 'outdoor']);
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 2, config: { players, monster: 'none' } });
  state.mystery = { monster: kind, revealed: true, spawnCell: g.index(6, 2), deck: [], flipped: [], found: [], pool: [kind] };
  const monster = { id: 'm1', kind, pos: g.index(19, 11), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const ctx = { state, log: () => {}, randInt: () => 3 };          // dice roll 4
  const at = (pl, x, y) => { pl.pos = g.index(x, y); const ev = []; onSiteEnter(state, board, pl, pl.pos, ctx, ev); return ev; };
  const turn = (...names) => {
    monster.intents = names.map((n) => { const a = MONSTER_BY_ID[kind].abilities.find((x) => x.name === n); return { roll: 1, ability: 0, name: a.name, kind: a.kind, text: a.text, ...parseAbility(a.text) }; });
    const ev = [];
    executeIntent(state, board, monster, ctx, ev);
    return ev;
  };
  return { g, board, state, monster, ctx, at, turn };
}
const site = (s, id) => mapSites(s.g)[id][0];
const xy = (s, i) => Object.values(s.g.coords(i));

test('Hellhounds: holy water to the Lair stops the pack coming back; then destroying it wins', () => {
  const s = fight3('hellhounds');
  const pl = s.state.players[0];
  s.monster.hp = 0;
  s.at(pl, ...xy(s, site(s, 'church')));
  assert.deepEqual(pl.carry, [{ item: 'holy-water' }]);
  s.at(pl, 6, 2);
  assert.ok(s.state.objectiveDone, 'the ritual is disrupted');
  assert.ok(!s.state.won, 'not yet: the pack must still be destroyed');
});

test('Pin: an attack of 5 that gets through pins; the pinned player can’t move on their next turn', () => {
  const s = fight3('hellhounds', { players: 1 });
  const pl = s.state.players[0];
  pl.pos = s.g.index(10, 5);
  s.monster.pos = s.g.index(11, 5);
  s.turn('Pin');
  assert.ok(pl.pinned);
  assert.ok(applyAction(s.state, s.board, { type: 'roll', seat: 0 }).ok);
  assert.ok(!pl.pinned && s.state.noMove);
  s.state.pool = [{ kind: 'black', v: 3 }];
  assert.ok(applyAction(s.state, s.board, { type: 'slot', die: 0, to: 'move', seat: 0 }).ok);
  assert.match(applyAction(s.state, s.board, { type: 'move', seat: 0 }).error, /can’t move/);
});

test('Demonic Fire: the hounds’ attacks ignore the lowest defense die', () => {
  const s = fight3('hellhounds', { players: 1 });
  const pl = s.state.players[0];
  pl.pos = s.g.index(10, 5);
  s.monster.pos = s.g.index(11, 5);
  pl.defense = [{ v: 1 }, { v: 3 }];                                 // 4, but 3 counts: Harrow's 3 is blocked
  s.turn('Harrow');
  assert.deepEqual(pl.injuries, { P: 0, M: 0, S: 0 });
  pl.defense = [{ v: 2 }, { v: 2 }]; pl.defenseUsed = 0;              // 4, but 2 counts
  s.turn('Harrow');
  assert.equal(pl.injuries.P, 1);
});

test('Poltergeist: spend a 6 at 4 Objective markers, then the Lair, to win', () => {
  const s = fight3('poltergeist', { players: 1 });
  const pl = s.state.players[0];
  assert.ok(applyAction(s.state, s.board, { type: 'roll', seat: 0 }).ok);
  const sites = mapSites(s.g).all;
  s.at(pl, 6, 2);
  assert.equal(s.state.ask, null, 'the Lair waits for the other four');
  for (const c of sites.slice(0, 4)) {
    s.state.pool = [{ kind: 'black', v: 6 }];
    s.state.slots = []; s.state.defSlots = [];
    s.at(pl, ...xy(s, c));
    assert.ok(s.state.ask?.anchor);
    s.state.phase = 'asking';
    assert.ok(applyAction(s.state, s.board, { type: 'investigate', yes: true, seat: 0 }).ok);
    if (s.state.phase !== 'slotting') s.state.phase = 'slotting';
  }
  assert.equal(s.state.objective.anchors.length, 4);
  s.state.pool = [{ kind: 'black', v: 5 }];
  s.at(pl, ...xy(s, sites[5]));
  assert.equal(s.state.ask, null, 'no 6: no asking');
  s.state.pool = [{ kind: 'black', v: 6 }];
  s.at(pl, 6, 2);
  s.state.phase = 'asking';
  assert.ok(applyAction(s.state, s.board, { type: 'investigate', yes: true, seat: 0 }).ok);
  assert.ok(s.state.won);
});

test('Heave: Target the player nearest the Lair, wherever they are, and Pin them', () => {
  const s = fight3('poltergeist');
  const [a, b] = s.state.players;
  a.pos = s.g.index(6, 5); b.pos = s.g.index(18, 5);
  s.turn('Heave');
  assert.ok(a.pinned && !b.pinned);
});

test('Strigoi: Cosor at the Lair (once), sharpened, then blessed; the strike ignores toughness; it hunts the holder', () => {
  const s = fight3('strigoi');
  const [a, b] = s.state.players;
  s.at(a, 6, 2);
  assert.deepEqual(a.carry, [{ item: 'cosor' }]);
  s.at(b, 6, 2);
  assert.ok(!b.carry?.length, 'only one Cosor');
  s.at(a, ...xy(s, site(s, 'church')));
  assert.ok(!a.carry[0].blessed, 'sharpen it first');
  s.at(a, ...xy(s, site(s, 'outdoor')));
  s.at(a, ...xy(s, site(s, 'church')));
  assert.ok(a.carry[0].blessed && s.state.objectiveDone);
  // The strike.
  a.pos = s.g.index(10, 5); s.monster.pos = s.g.index(11, 5);
  assert.ok(applyAction(s.state, s.board, { type: 'roll', seat: 0 }).ok);
  s.state.pool = [{ kind: 'black', v: 2 }, { kind: 'black', v: 5 }];
  s.state.slots = []; s.state.defSlots = [];
  const ready = skillStatus(s.state, s.board, a).find((e) => e.item === 'cosor');
  assert.equal(ready.status, 'now', 'listed with the skills');
  assert.deepEqual(ready.action.die, 1, 'the 5: the most damage');
  const r = applyAction(s.state, s.board, ready.action);
  assert.ok(r.ok, r.error);
  assert.equal(s.monster.hp, 5, 'the die’s value, toughness ignored');
  assert.ok(s.state.pool[1].spent, 'the die is used');
  assert.match(applyAction(s.state, s.board, { type: 'strike', seat: 0, die: 0 }).error, /once a turn/);
});

test('Unholy Burn drops the Cosor on the holder’s space; stepping there picks it up, still blessed', () => {
  const s = fight3('strigoi');
  const [a, b] = s.state.players;
  a.carry = [{ item: 'cosor', sharp: true, blessed: true }];
  a.pos = s.g.index(10, 5); b.pos = s.g.index(12, 5);
  s.monster.pos = s.g.index(9, 5);
  s.turn('Unholy Burn');
  assert.deepEqual(a.carry, []);
  s.at(b, 10, 5);
  assert.deepEqual(b.carry, [{ item: 'cosor', sharp: true, blessed: true }]);
});

test('White Lady: three items to the Church, then 3 rounds with someone inside sets her free', () => {
  const s = fight3('white-lady');
  const [a] = s.state.players;
  for (const id of ['boutique', 'curio', 'funeral']) s.at(a, ...xy(s, site(s, id)));
  assert.equal(a.carry.length, 3);
  s.at(a, ...xy(s, site(s, 'church')));
  assert.ok(s.state.objective.ceremony);
  a.pos = s.g.index(3, 9);                                       // outdoors: nobody inside the Church
  s.g.cells[site(s, 'church')].area = 'indoor';
  holdRound(s.state, s.board, s.ctx, []);
  assert.equal(s.state.objective.ceremony.held, 0, 'it waits');
  a.pos = site(s, 'church');
  for (let k = 0; k < 3; k++) holdRound(s.state, s.board, s.ctx, []);
  assert.ok(s.state.won);
});

test('White Lady’s Infatuation: she appears inside the occupied building and shuts every door; Regret opens them', () => {
  const g = new GridState(20, 12);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (let y = 2; y < 5; y++) for (let x = 5; x < 8; x++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  for (let x = 5; x < 8; x++) { g.setEdge('h', x, 2, 'wall'); g.setEdge('h', x, 5, x === 6 ? 'door' : 'wall'); }
  for (let y = 2; y < 5; y++) { g.setEdge('v', 5, y, 'wall'); g.setEdge('v', 8, y, 'wall'); }
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 2, config: { players: 1, monster: 'none' } });
  state.players[0].pos = g.index(6, 3);
  const monster = { id: 'm1', kind: 'white-lady', pos: g.index(15, 5), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const ctx = { state, log: () => {}, randInt: () => 0 };
  const act = (n) => { const a = MONSTER_BY_ID['white-lady'].abilities.find((x) => x.name === n); monster.intents = [{ roll: 1, ability: 1, name: a.name, kind: a.kind, text: a.text, ...parseAbility(a.text) }]; executeIntent(state, board, monster, ctx, []); };
  act('Wrath');                                                   // no one inside with her: Infatuation instead
  assert.equal(g.cells[monster.pos].area, 'indoor');
  assert.equal(Object.values(state.doors).filter((d) => d === 'blocked').length, 1, 'the door is shut');
  act('Regret');
  assert.equal(Object.values(state.doors).filter((d) => d === 'blocked').length, 0);
  assert.equal(state.players[0].injuries.M, 1, 'and Regret strikes inside');
});

test('Shadow People: candles never go out inside the Church, and the stand relights one', async () => {
  const { relightHere } = await import('../src/game/objectives/verbs.js');
  const s = fight('shadow-people');
  const pl = s.state.players[0];
  for (const x of [0, 1]) s.g.apply(s.g.index(x, 0), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  s.at(pl, 0, 0);
  pl.pos = s.g.index(1, 0);                  // inside the Church, off the stand, in the dark
  s.board.light[pl.pos] = 0;
  suffocate(s.state, s.board, pl, s.ctx, []);
  assert.equal(pl.carry[0].lit, true, 'safe in the Church');
  pl.carry[0].lit = false;
  pl.pos = s.g.index(0, 0);                  // standing on the stand
  relightHere(s.state, s.board, pl, s.ctx, []);
  assert.equal(pl.carry[0].lit, true, 'relit without stepping off and back on');
});

test('Umbral Stab: once a move, however many lit spaces it crosses', async () => {
  const { onPlayerEnters } = await import('../src/game/monsterTurn.js');
  const s = fight('shadow-people');
  const pl = s.state.players[0];
  const hits = () => s.log.filter((m) => /Umbral Stab/.test(m)).length;
  s.state.moveN = 1;
  for (const x of [3, 4, 5]) { const c = s.g.index(x, 3); s.board.light[c] = 1; onPlayerEnters(s.state, s.board, pl, c, s.ctx, []); }
  assert.equal(hits(), 1, 'one stab on this move');
  s.state.moveN = 2;
  onPlayerEnters(s.state, s.board, pl, s.g.index(5, 3), s.ctx, []);
  assert.equal(hits(), 2, 'a new move can be stabbed again');
});

test('Shadow People: a memorial relights a candle for an Obol: passing it, or on your turn beside it', async () => {
  const { relightHere, memorialPass } = await import('../src/game/objectives/verbs.js');
  const s = fight('shadow-people');
  const pl = s.state.players[0];
  const m = s.g.index(10, 5);
  s.g.apply(m, { area: 'outdoor', sub: 'memorial', walkable: false }, { silent: true });
  s.at(pl, 0, 0);
  pl.carry[0].lit = false;
  // Starting beside it is not free.
  pl.pos = s.g.index(11, 5);
  relightHere(s.state, s.board, pl, s.ctx, []);
  assert.equal(pl.carry[0].lit, false, 'no free relight');
  // On your turn beside it: Skills offers it, for an Obol.
  s.state.phase = 'idle'; s.state.cur = 0; s.state.pool = [];
  pl.inventory.obolcraft = [];
  let e = skillStatus(s.state, s.board, pl).find((x) => x.item === 'relight');
  assert.equal(e.status, 'almost', 'no Obol yet');
  pl.inventory.obolcraft = [{ type: 'bone' }];
  e = skillStatus(s.state, s.board, pl).find((x) => x.item === 'relight');
  assert.equal(e.status, 'now');
  assert.ok(applyAction(s.state, s.board, e.action).ok);
  assert.equal(pl.carry[0].lit, true);
  assert.equal(pl.inventory.obolcraft.length, 0);
  // Diagonal doesn't count.
  pl.carry[0].lit = false; pl.inventory.obolcraft = [{ type: 'ash' }];
  pl.pos = s.g.index(11, 6);
  assert.ok(!skillStatus(s.state, s.board, pl).some((x) => x.item === 'relight'));
  // Passing with the candle out: asked, for an Obol.
  pl.inventory.obolcraft = [];
  memorialPass(s.state, s.board, pl, s.g.index(10, 4));
  assert.equal(s.state.ask, null, 'no Obol, no offer');
  pl.inventory.obolcraft = [{ type: 'bone' }, { type: 'ash' }, { type: 'bone' }];
  memorialPass(s.state, s.board, pl, s.g.index(10, 4));
  assert.deepEqual(s.state.ask, { i: m, relight: true });
  s.state.phase = 'asking';
  s.state.steps = 0;
  assert.ok(applyAction(s.state, s.board, { type: 'investigate', yes: true, seat: 0 }).ok);
  assert.equal(pl.carry[0].lit, true);
  assert.deepEqual(pl.inventory.obolcraft.map((o) => o.type).sort(), ['ash', 'bone'], 'paid the kind held most');
});
