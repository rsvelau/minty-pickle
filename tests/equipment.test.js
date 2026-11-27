// Using Equipment against monsters (src/game/equipmentPlay.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { armMonster, toughnessOf } from '../src/game/equipmentPlay.js';
import { executeIntent } from '../src/game/monsterTurn.js';
import { MONSTER_BY_ID } from '../src/game/cards/monsters.js';

// A street; the player at (10,5), a monster of `kind` right next to them.
function setup(kind, { items = [], pool = [], obols = [] } = {}) {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 1, config: { players: 2, monster: 'none' } });
  const pl = state.players[0];
  pl.pos = g.index(10, 5);
  state.players[1].pos = g.index(12, 5);
  pl.inventory.equipment = items.map((id) => ({ id, label: id }));
  pl.inventory.obolcraft = obols.map((type) => ({ type }));
  state.pool = pool.map((v) => ({ kind: 'black', v }));
  state.slots = []; state.defSlots = [];
  state.phase = 'slotting';
  const monster = { id: 'm1', kind, pos: g.index(11, 5), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const use = (item, ability, dice, more = {}) => applyAction(state, board, { type: 'use', item, ability, dice, ...more });
  return { state, board, pl, monster, use, g };
}

test('damage goes through toughness into health', () => {
  const { monster, use, state } = setup('werewolf', { items: ['kitchen-knife'], pool: [6] }); // hp 20, toughness 4
  const r = use(0, 0, [0]);
  assert.ok(r.ok, r.error);
  assert.equal(monster.hp, 18);                       // 6 − 4
  assert.equal(state.pool[0].spent, true);
});

test('requirements, range and immunity', () => {
  const s = setup('werewolf', { items: ['kitchen-knife', 'flare-gun'], pool: [3, 6] });
  assert.match(s.use(0, 0, [0]).error, /\[4\+\]/);    // 3 is not 4+
  s.monster.pos = s.g.index(14, 5);                   // 4 away: out of Close range
  assert.match(s.use(0, 0, [1]).error, /no monster in range/);
  const b = setup('barghest', { items: ['makeshift-torch'], pool: [5] }); // immune to fire
  assert.ok(b.use(0, 0, [0]).ok);
  assert.equal(b.monster.hp, null);
  assert.match(b.state.log[0], /immune to Fire/);
});

test('weakness hits count up the track and apply its effects', () => {
  const { monster, use, state } = setup('werewolf', { items: ['cursebreaker-dagger'], pool: [6, 6, 6, 6, 6, 6] }); // weak to silver
  // (Once a turn per card: a new turn between uses.)
  for (let k = 0; k < 2; k++) { assert.ok(use(0, 0, [k]).ok); state.turn++; }
  assert.equal(monster.weakHits, 2);
  assert.equal(monster.toughLost, 2);                 // track: at 2 hits, −2 toughness
  assert.equal(toughnessOf(monster), 2);
  for (let k = 2; k < 4; k++) { use(0, 0, [k]); state.turn++; }
  assert.equal(monster.diceLost, 1);                  // at 4: −1 die
  assert.match(state.log.join(' '), /weakness: −1 die/);
});

test('Choke needs twice the monster’s action roll; guns go empty after firing', () => {
  const s = setup('werewolf', { items: ['iron-chain', 'rock-salt-shotgun', 'eccentric-crossbow', 'sacrificial-fetish'], pool: [3, 4, 6, 6, 5, 5, 4], obols: ['attack', 'event'] });
  s.monster.intents = [{ roll: 4, ops: [], unknown: [] }];
  assert.match(s.use(0, 0, [0, 1]).error, /twice 4/); // 7 < 8
  assert.ok(s.use(0, 0, [2, 3]).ok);                  // 12 ≥ 8
  assert.equal(s.monster.mods.immobile, true);
  // Salt Shot [12]: fired, it's empty: the skill is now Reload Salt Shot (one die).
  s.state.pool.push({ kind: 'black', v: 6 }, { kind: 'black', v: 6 }, { kind: 'black', v: 6 }, { kind: 'black', v: 6 });
  assert.ok(s.use(1, 0, [7, 8]).ok);
  assert.equal(s.monster.mods.blind, true);
  assert.match(s.use(1, 0, [9, 10]).error, /Reload Salt Shot needs one die/);
  // Crossbow: Piercing Tip [10], then (empty) its Reload.
  assert.ok(s.use(2, 0, [4, 5]).ok);
  assert.deepEqual(s.pl.inventory.equipment[2].empty, [0]);
  // Sacrifice isn't used from the sheet: it comes up when someone would die (tricks.test.js).
  assert.match(s.use(3, 0, []).error, /the moment/);
});

test('healing, bonus defense and refreshed dice', () => {
  const s = setup('werewolf', { items: ['medical-kit', 'singing-bowl', 'powerful-flashlight'], pool: [2, 1, 3] });
  s.pl.injuries = { P: 2, M: 0, S: 0 };
  assert.ok(s.use(0, 0, [0]).ok);
  assert.equal(s.pl.injuries.P, 0);                   // all Physical tiers
  assert.ok(s.use(1, 0, [1]).ok);                     // Pacifying Song [1,2] with a 1
  assert.deepEqual(s.pl.bonusDefense, [{ type: 'M', v: 6 }]);
  assert.ok(s.use(2, 0, [2]).ok);                     // Illuminate: die becomes a 6, ready again
  assert.equal(s.state.pool[2].v, 6);
  assert.equal(s.state.pool[2].spent, false);
});

test('Blind and Seal change the monster’s attack; immobilized monsters stay put', () => {
  const s = setup('werewolf');
  s.monster.mods = { blind: true, immobile: true };
  s.monster.intents = [{ roll: 1, name: 'Vicious Pursuit', kind: 'physical', ops: [{ op: 'pursue', n: 8 }, { op: 'attack', dmg: { dice: 3 } }], unknown: [] }];
  const at = s.monster.pos;
  const events = [];
  const logs = [];
  executeIntent(s.state, s.board, s.monster, { state: s.state, log: (_st, t) => logs.push(t), randInt: () => 5 }, events);
  assert.equal(s.monster.pos, at);
  const hit = events.find((e) => e.type === 'damage');
  assert.equal(hit.amount, 3);                        // three dice, all rolled as 1
  assert.deepEqual(s.monster.mods, {});              // this turn's effects are over
  void MONSTER_BY_ID;
});

test('attacks wear defense down', async () => {
  const { applyDamage } = await import('../src/game/combat.js');
  const s = setup('werewolf');
  s.pl.defense = [{ v: 6 }, { v: 4 }];               // 10 defense
  const ev = [];
  const log = () => {};
  assert.equal(applyDamage(s.state, s.board, s.pl, 'P', 6, { log }, ev), 'blocked');  // 4 left
  assert.equal(applyDamage(s.state, s.board, s.pl, 'P', 5, { log }, ev), 'injured');  // 5 > 4
  assert.equal(applyDamage(s.state, s.board, s.pl, 'M', 1, { log }, ev), 'injured');  // nothing left
});

test('Long only reaches 3+; Medical Kit heals a teammate in your space; Bless doubles before toughness', () => {
  const s = setup('werewolf', { items: ['hunting-rifle', 'medical-kit', 'witch-hunters-sword', 'kitchen-knife'], pool: [6, 6, 6, 1, 3, 4, 6] });
  assert.match(s.use(0, 0, [0, 1, 2]).error, /no monster in range/);   // adjacent: too close for Long
  s.state.players[1].pos = s.pl.pos;
  s.state.players[1].injuries = { P: 2, M: 0, S: 0 };
  assert.ok(s.use(1, 0, [3], { target: { seat: 1 } }).ok);
  assert.equal(s.state.players[1].injuries.P, 0);
  assert.ok(s.use(2, 2, [4, 5], { target: { seat: 0 } }).ok);         // Bless [7]: 3 + 4
  assert.ok(s.use(3, 0, [6]).ok);                                      // 6 doubled = 12, − toughness 4
  assert.equal(s.monster.hp, 12);
});

test('objectives decide the win', () => {
  // Kill: destroying wins.
  const k = setup('werewolf', { items: ['hunting-rifle'], pool: [6, 6, 6] });
  k.monster.pos = k.g.index(14, 5);
  k.monster.hp = 10;
  assert.ok(k.use(0, 0, [0, 1, 2]).ok);                                // 18 damage ignoring toughness
  assert.equal(k.state.won, true);
  // Redcap: a Piercing blow (one that ignores toughness) can't land the killing blow.
  const r = setup('redcap', { items: ['hunting-rifle'], pool: [6, 6, 6] });   // 9 health
  r.monster.pos = r.g.index(14, 5);
  assert.ok(r.use(0, 0, [0, 1, 2]).ok);
  assert.equal(r.monster.hp, 1);
  assert.equal(r.state.won, undefined);
  // Disrupt Ritual (Hellhounds): back to the Lair until the objective is done.
  const h = setup('hellhounds', { items: ['hunting-rifle', 'hunting-rifle'], pool: [6, 6, 6, 6, 6, 6] });
  h.state.mystery = { spawnCell: h.g.index(2, 5) };
  h.monster.pos = h.g.index(14, 5);
  assert.ok(h.use(0, 0, [0, 1, 2]).ok);
  assert.equal(h.state.won, undefined);
  assert.equal(h.monster.pos, h.g.index(2, 5));
  assert.equal(h.monster.hp, 3);
  assert.ok(applyAction(h.state, h.board, { type: 'objective' }).ok);
  h.monster.pos = h.g.index(14, 5);
  assert.ok(h.use(1, 0, [3, 4, 5]).ok);                                // the other rifle (the first is empty now)
  assert.equal(h.state.won, true);
  // ∞ health (Barghest, Escape): the objective alone wins.
  const b = setup('barghest');
  assert.ok(applyAction(b.state, b.board, { type: 'objective' }).ok);
  assert.equal(b.state.won, true);
});

test('discarding an item of the right element for an ∞ weakness effect', () => {
  const s = setup('shadow-people', { items: ['kitchen-knife', 'crystal-talisman'] }); // ∞: Discard Crystal & no light for ⌛
  assert.ok(!applyAction(s.state, s.board, { type: 'discard', item: 0, track: 2, monster: 'm1' }).ok); // not crystal
  const r = applyAction(s.state, s.board, { type: 'discard', item: 1, track: 2, monster: 'm1' });
  assert.ok(r.ok, r.error);
  assert.deepEqual(s.pl.inventory.equipment.map((e) => e.id), ['kitchen-knife']);
  assert.equal(s.state.flags.noLight.seat, s.pl.seat, 'lit spaces are safe for now');
  // The Banshee's Silver discard isn't offered here: it comes up when a Swoop lands (reactions.test.js).
  const b = setup('banshee', { items: ['heavy-silver-chain'] });
  assert.ok(!applyAction(b.state, b.board, { type: 'discard', item: 0, track: 2, monster: 'm1' }).ok);
});

test('each skill once a turn per card; a second copy of the card has its own', () => {
  const s = setup('werewolf', { items: ['cursebreaker-dagger', 'cursebreaker-dagger'], pool: [6, 6, 6, 6] });
  assert.ok(s.use(0, 0, [0]).ok);
  assert.match(s.use(0, 0, [1]).error, /used this turn/);
  assert.ok(s.use(1, 0, [1]).ok, 'the other copy');
  assert.match(s.use(1, 0, [2]).error, /used this turn/);
  s.state.turn++;
  assert.ok(s.use(0, 0, [2]).ok, 'a new turn');
});

test('Reload: a fired gun reloads with a 3+ (ready next turn), or a 6 (fire again now)', () => {
  const s = setup('werewolf', { items: ['compact-revolver'], pool: [6, 6, 1, 2, 4, 6, 6, 6, 3, 3, 3] });   // Hip Fire [11-]: 8 damage
  const gun = s.pl.inventory.equipment[0];
  const hp = s.monster.hp;
  assert.ok(s.use(0, 1, [2, 3, 4]).ok, 'Hip Fire with 1 + 2 + 4');
  assert.equal(s.monster.hp, hp - (8 - 4));
  assert.equal(s.pl.inventory.equipment.length, 1, 'the revolver no longer breaks');
  assert.deepEqual(gun.empty, [1]);
  // Empty: Reload Hip Fire takes one die [3+].
  s.state.pool[2].spent = false;
  assert.match(s.use(0, 1, [2]).error, /\[3\+\]/, 'a 1 won’t reload it');
  // A 3: reloaded, but it fires on the next turn.
  assert.ok(s.use(0, 1, [8]).ok, 'reload with a 3');
  assert.deepEqual(gun.empty, []);
  assert.match(s.use(0, 1, [9, 10, 2]).error, /next turn/);
  s.state.turn++;
  s.state.pool[2].spent = false; s.state.pool[3].spent = false;
  assert.ok(s.use(0, 1, [2, 3, 9]).ok, 'next turn it fires (1 + 2 + 3)');
  // A 6: quick reload, and it fires again this turn.
  assert.ok(s.use(0, 1, [0]).ok, 'quick reload with a 6');
  assert.deepEqual(gun.empty, []);
  s.state.pool[2].spent = false; s.state.pool[3].spent = false; s.state.pool[4].spent = false;
  assert.ok(s.use(0, 1, [2, 3, 4]).ok, 'fires again right away');
  assert.deepEqual(gun.empty, [1]);
  assert.match(s.state.log.join(' '), /quick reload/);
});

test('Reload: the skill shows as Reload <skill> in the Skills list; Flighted Bolt is Long range', async () => {
  const { skillStatus } = await import('../src/game/skills.js');
  const { EQUIPMENT_BY_ID } = await import('../src/game/cards/equipment.js');
  const s = setup('werewolf', { items: ['eccentric-crossbow'], pool: [5, 5, 4] });
  assert.ok(s.use(0, 0, [0, 1]).ok, 'Piercing Tip [10]');
  const list = skillStatus(s.state, s.board, s.pl);
  const e = list.find((x) => x.ability === 0);
  assert.equal(e.name, 'Reload Piercing Tip');
  assert.equal(e.status, 'now');
  const bolt = EQUIPMENT_BY_ID['eccentric-crossbow'].abilities[1];
  assert.equal(bolt.name, 'Flighted Bolt');
  assert.equal(bolt.range, 'long');
  assert.equal(bolt.limit, 'reload');
  // Every firearm and crossbow skill reloads.
  for (const id of ['rock-salt-shotgun', 'dragons-breath-shotgun', 'compact-revolver', 'hunting-rifle', 'eccentric-crossbow', 'flare-gun']) {
    const fired = EQUIPMENT_BY_ID[id].abilities.filter((a) => a.limit === 'reload');
    assert.ok(fired.length, id);
    assert.ok(!EQUIPMENT_BY_ID[id].abilities.some((a) => a.limit === 'breaks' || a.limit === 'once'), `${id}: no 🔗 or 1️⃣ left`);
  }
});
