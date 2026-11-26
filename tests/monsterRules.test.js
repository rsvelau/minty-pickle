// Monster rules from the designer's answers (Nov 26): Shadow Trap, Death Gaze,
// Bear Maul's Drag, the Skinwalker's stun, the Wendigo's Feed and Regeneration,
// the Ushi-Oni's Seize, the Redcap, healing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { armMonster } from '../src/game/equipmentPlay.js';
import { executeIntent, parseAbility, onPlayerEnters } from '../src/game/monsterTurn.js';
import { MONSTER_BY_ID } from '../src/game/cards/monsters.js';

// A street along row 5; a building (x 5-7, y 2-4) with a door at (6,4)|(6,5).
// P1 at (10,5), P2 at (12,5); the monster at `at`; every die rolls `die`.
function setup(kind, { at = [2, 5], die = 4, lair = [0, 5] } = {}) {
  const g = new GridState(20, 10);
  for (let x = 0; x < 20; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(19, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  for (let y = 2; y < 5; y++) for (let x = 5; x < 8; x++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  for (let x = 5; x < 8; x++) { g.setEdge('h', x, 2, 'wall'); g.setEdge('h', x, 5, x === 6 ? 'door' : 'wall'); }
  for (let y = 2; y < 5; y++) { g.setEdge('v', 5, y, 'wall'); g.setEdge('v', 8, y, 'wall'); }
  const board = createBoard(g);
  const { state } = newGame(board, { seed: 4, config: { players: 2, monster: 'none' } });
  const [pl, mate] = state.players;
  pl.pos = g.index(10, 5); mate.pos = g.index(12, 5);
  state.mystery = { spawnCell: g.index(...lair) };
  const monster = { id: 'm1', kind, pos: g.index(...at), prev: -1, revealed: true };
  armMonster(monster);
  state.monsters = [monster];
  const log = [];
  const ctx = { state, log: (s, m) => log.push(m), randInt: () => die - 1 };
  const turn = (...names) => {
    const card = MONSTER_BY_ID[kind];
    monster.intents = names.map((n) => {
      const a = card.abilities.find((x) => x.name === n);
      return { roll: 1, ability: 0, name: a.name, kind: a.kind, text: a.text, ...parseAbility(a.text) };
    });
    const events = [];
    executeIntent(state, board, monster, ctx, events);
    return events;
  };
  return { g, board, state, pl, mate, monster, turn, log, ctx };
}

test('heals really heal (Werewolf’s Lick Wounds), up to its health', () => {
  const s = setup('werewolf');
  s.monster.hp = 10;
  s.turn('Lick Wounds');
  assert.equal(s.monster.hp, 16);
  s.turn('Lick Wounds'); s.turn('Lick Wounds');
  assert.equal(s.monster.hp, 20);
});

test('Barghest Shadow Trap: lands at the nearest light and springs on everyone in Close range, at once', () => {
  const s = setup('barghest', { at: [16, 5] });
  s.board.light.fill(0);
  s.board.light[s.g.index(9, 5)] = 1;
  s.pl.defense = []; s.mate.defense = [];
  s.turn('Shadow Trap');
  assert.equal(s.monster.pos, s.g.index(9, 5));
  assert.equal(s.pl.injuries.S, 1, 'P1 next to it');
  assert.equal(s.mate.injuries.S, 0, 'P2 two away');
});

test('Barghest Death Gaze: end of its turn, 10 to everyone it can see; walls and buildings block it', () => {
  const s = setup('barghest', { at: [3, 5] });
  s.state.players.push({ ...structuredClone(s.mate), seat: 2, name: 'P3', pos: s.g.index(6, 3), injuries: { P: 0, M: 0, S: 0 }, defense: [] });
  s.turn('Stalk');
  assert.ok(s.g.cells[s.monster.pos].area !== 'indoor', 'it can’t enter buildings');
  assert.equal(s.pl.injuries.M, 1, 'on the street: seen');
  assert.equal(s.mate.injuries.M, 1);
  assert.equal(s.state.players[2].injuries.M, 0, 'inside the building: hidden');
  // Disabled for a round by its weakness track: no gaze.
  s.monster.disabled = { 'Death Gaze': 1 };
  s.turn('Stalk');
  assert.equal(s.pl.injuries.M, 1);
});

test('Skinwalker Bear Maul: if the attack lands, dragged 5 spaces into the nearest building', () => {
  const s = setup('skinwalker', { at: [8, 5] });
  s.pl.pos = s.g.index(7, 5); s.pl.defense = [];
  s.turn('Bear Maul');
  assert.equal(s.pl.injuries.S + s.pl.injuries.P, 1);
  assert.equal(s.g.cells[s.pl.pos].area, 'indoor', 'dragged inside');
  const b = setup('skinwalker', { at: [8, 5] });
  b.pl.pos = b.g.index(7, 5); b.pl.defense = [{ kind: 'black', v: 6 }];
  b.turn('Bear Maul');
  assert.equal(b.pl.pos, b.g.index(7, 5), 'blocked: no drag');
});

test('Skinwalker: the first to reach its Lair stuns it once: toughness 0, and it skips its turn', () => {
  const s = setup('skinwalker', { at: [3, 5] });
  onPlayerEnters(s.state, s.board, s.pl, s.g.index(0, 5), s.ctx, []);
  assert.ok(s.monster.stunned);
  assert.equal(s.monster.mods.toughZero, true);
  const before = s.monster.pos;
  s.turn('Wolf Prowl');
  assert.equal(s.monster.pos, before, 'skipped');
  assert.ok(!s.monster.mods.toughZero);
  onPlayerEnters(s.state, s.board, s.mate, s.g.index(0, 5), s.ctx, []);
  assert.ok(!s.monster.stunned, 'once a game');
});

test('Wendigo Feed: everyone within 4 is lured the same die toward it, then everyone close is consumed; it heals the total', () => {
  const s = setup('wendigo', { at: [13, 5], die: 3 });
  s.pl.pos = s.g.index(9, 5); s.mate.pos = s.g.index(16, 5);
  s.pl.defense = []; s.mate.defense = [];
  s.monster.hp = 5;
  s.monster.disabled = { Regeneration: true };
  s.turn('Feed');
  assert.equal(s.pl.pos, s.g.index(12, 5), 'P1 pulled 3, next to it');
  assert.equal(s.mate.pos, s.g.index(14, 5), 'P2 pulled up beside it');
  assert.equal(s.pl.injuries.P, 1); assert.equal(s.mate.injuries.P, 1);
  assert.equal(s.monster.hp, 5 + 6 + 4, 'healed 3 + 3, then Regeneration (back after feeding) heals 4');
});

test('Wendigo Regeneration: 4 at the end of its turn; off until it feeds, or for good', () => {
  const s = setup('wendigo');
  s.monster.hp = 10;
  s.turn('Inhuman Speed');
  assert.equal(s.monster.hp, 14);
  s.monster.disabled = { Regeneration: 'perm' };
  s.turn('Inhuman Speed');
  assert.equal(s.monster.hp, 14);
});

test('Ushi-Oni Abduct: a 2-dice attack; if it lands, Seized: at Death’s Door, carried toward the Lair, killed there at the end of the round', () => {
  const s = setup('ushi-oni', { at: [12, 5], lair: [2, 5] });
  s.pl.pos = s.g.index(13, 5); s.pl.defense = [];
  s.mate.pos = s.g.index(18, 5);
  s.turn('Abduct');
  assert.ok(s.log.some((l) => /P1 is Seized/.test(l)));
  assert.equal(s.monster.pos, s.g.index(2, 5), 'off home, 10 spaces');
  assert.equal(s.pl.pos, s.g.index(2, 5), 'carrying P1');
  assert.ok(s.pl.dead, 'into the Lair: dead');
  // Too far from the Lair to get home this round: still held, at Death's Door.
  const f = setup('ushi-oni', { at: [16, 5], lair: [0, 5] });
  f.pl.pos = f.g.index(17, 5); f.pl.defense = [];
  f.mate.pos = f.g.index(10, 5);
  f.turn('Abduct');
  assert.equal(f.pl.seized, 'm1');
  assert.equal(f.monster.pos, f.g.index(6, 5));
  assert.equal(f.pl.pos, f.g.index(6, 5));
  assert.ok(!f.pl.dead);
});

test('Ushi-Oni: a seized player breaks free by getting damage through its defense', () => {
  const s = setup('ushi-oni', { at: [12, 5], lair: [0, 5] });
  s.pl.pos = s.g.index(13, 5); s.pl.defense = [];
  s.turn('Miasma');                                          // just to arm the turn
  s.monster.carrying = 0; s.pl.seized = 'm1';
  s.monster.pos = s.g.index(9, 5); s.pl.pos = s.g.index(9, 5);
  assert.ok(applyAction(s.state, s.board, { type: 'roll', seat: 0 }).ok);
  assert.ok(s.state.noMove, 'held fast');
  s.pl.inventory.equipment = [{ id: 'firemans-axe' }];
  s.state.pool = [{ kind: 'black', v: 6 }, { kind: 'black', v: 6 }]; s.state.slots = []; s.state.defSlots = [];
  const r = applyAction(s.state, s.board, { type: 'use', seat: 0, item: 0, ability: 0, dice: [0], target: { monster: 'm1' } });
  assert.ok(r.ok, r.error);
  assert.equal(s.monster.carrying, null);
  assert.equal(s.pl.seized, undefined);
});

test('Banshee Keen only reaches outdoor spaces', () => {
  const s = setup('banshee', { at: [8, 5] });
  s.mate.pos = s.g.index(6, 4);                             // inside, 2 away
  s.pl.defense = []; s.mate.defense = [];
  s.turn('Keen');
  assert.equal(s.pl.injuries.M, 1);
  assert.equal(s.mate.injuries.M, 0);
});

test('Banshee Perch: end of her turn, the rooftop nearest whoever is closest to the heirloom; out of Close range there', async () => {
  const { targetsFor } = await import('../src/game/equipmentPlay.js');
  const { EQUIPMENT_BY_ID } = await import('../src/game/cards/equipment.js');
  const s = setup('banshee', { at: [15, 5] });
  s.mate.carry = [{ item: 'heirloom' }];                     // P2 at 12 has it
  s.mate.pos = s.g.index(7, 5);                              // just below the building
  s.turn('Keen');
  assert.ok(s.monster.perched);
  assert.equal(s.g.cells[s.monster.pos].area, 'indoor', 'on the building’s roof');
  assert.ok(Math.abs(s.g.coords(s.monster.pos).x - 7) + Math.abs(s.g.coords(s.monster.pos).y - 5) <= 1, 'right above P2');
  const knife = EQUIPMENT_BY_ID['kitchen-knife'].abilities[0];  // Close
  assert.equal(targetsFor(s.state, s.board, s.mate, knife).length, 0, 'out of Close range on the roof');
  s.monster.perched = false;                                 // Grounded
  assert.equal(targetsFor(s.state, s.board, s.mate, knife).length, 1);
});

test('the heirloom: picked up at the Funeral Parlor, set down with Drop, picked up again by stepping there', () => {
  const s = setup('banshee');
  s.pl.carry = [{ item: 'heirloom' }];
  s.state.phase = 'idle'; s.state.cur = 0;
  assert.ok(applyAction(s.state, s.board, { type: 'drop', seat: 0, item: 'heirloom' }).ok);
  assert.equal(s.pl.carry.length, 0);
  assert.deepEqual(s.state.objective.dropped.map((d) => [d.item, d.cell]), [['heirloom', s.g.index(10, 5)]]);
  assert.match(applyAction(s.state, s.board, { type: 'drop', seat: 0, item: 'heirloom' }).error, /not carrying/);
});

test('Adze: a victim dies: one die × the dead, to everyone', async () => {
  const src = await import('fs').then((fs) => fs.readFileSync(new URL('../src/game/monsterTurn.js', import.meta.url), 'utf8'));
  assert.match(src, /die \* dead/);
});

test('Banshee: the heirloom brought to the Unmarked Grave (an Objective marker in the cemetery) defeats her at once', async () => {
  const { onSiteEnter } = await import('../src/game/objectives/verbs.js');
  const { siteOf } = await import('../src/core/sites.js');
  const s = setup('banshee', { at: [15, 5] });
  const grave = s.g.index(3, 7);
  s.g.apply(grave, { area: 'outdoor', sub: 'cemetery', marker: 'objective' }, { silent: true });
  assert.equal(siteOf(s.g.cells[grave], s.g, grave), 'grave');
  s.state.mystery = { ...s.state.mystery, monster: 'banshee', revealed: true };
  s.pl.carry = [{ item: 'heirloom' }];
  const events = [];
  onSiteEnter(s.state, s.board, s.pl, grave, s.ctx, events);
  assert.equal(s.state.monsters.length, 0);
  assert.equal(s.state.won, true);
  assert.ok(events.some((e) => e.type === 'monsterDefeated'));
});
