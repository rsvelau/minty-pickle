// Card data and the dice requirements printed on Equipment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT_CARDS } from '../src/game/cards/equipment.js';
import { EVENT_CARDS, MINDSET_CARDS, EVENT_CATEGORIES } from '../src/game/cards/events.js';
import { DAMAGE_KINDS } from '../src/game/cards/monsters.js';
import { checkRequirement } from '../src/game/cards/requirements.js';

test('the card list matches the PDF', () => {
  assert.equal(EQUIPMENT_CARDS.length, 44);
  assert.equal(EVENT_CARDS.length, 37);
  assert.equal(MINDSET_CARDS.length, 6);
  const ids = [...EQUIPMENT_CARDS, ...EVENT_CARDS, ...MINDSET_CARDS].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const c of EVENT_CARDS) assert.ok(EVENT_CATEGORIES[c.category], `${c.name}: ${c.category}`);
  for (const c of EQUIPMENT_CARDS) {
    assert.ok(c.abilities.length >= 1 && c.abilities.length <= 3, c.name);
    for (const a of c.abilities) {
      assert.ok(a.kind === null || DAMAGE_KINDS[a.kind], `${c.name} ${a.name}: kind ${a.kind}`);
      assert.ok([null, 'close', 'mid', 'long', 'self', 'all'].includes(a.range), `${c.name} ${a.name}: range`);
      assert.ok([null, 'once', 'chain'].includes(a.limit));
    }
  }
});

test('dice requirements', () => {
  const ok = (req, v, o) => checkRequirement(req, v, o);
  assert.equal(ok('4+', [4]), true);
  assert.equal(ok('4+', [3]), false);
  assert.equal(ok('12', [6, 6]), true);           // Salt Shot
  assert.equal(ok('12', [6, 5]), false);
  assert.equal(ok('12+', [5, 4, 3]), true);       // Controlled Shots
  assert.equal(ok('11-', [5, 4, 3]), false);      // Hip Fire
  assert.equal(ok('11-', [5, 4, 2]), true);
  assert.equal(ok('18', [6, 6, 6]), true);        // Sniper Shots
  assert.equal(ok('1,2', [2]), true);             // Pacifying Song
  assert.equal(ok('1,2', [3]), false);
  assert.equal(ok('2-3', [3]), true);             // Marlin Spike Pierce
  assert.equal(ok('2-3', [4]), false);
  assert.equal(ok('2-', [2]), true);              // Protective Faith
  assert.equal(ok('2-', [3]), false);
  assert.equal(ok('2, 5+', [6, 2]), true);        // Gaffe, either order
  assert.equal(ok('2, 5+', [2, 4]), false);
  assert.equal(ok('Any', [1]), true);
  assert.equal(ok('2x Target’s', [5, 3], { targetDie: 4 }), true); // Choke
  assert.equal(ok('2x Target’s', [4, 3], { targetDie: 4 }), false);
  assert.equal(ok(null, []), true);               // Sip: free
});

test('decks: dealt from the settings, drawn without repeats, saved with the game', async () => {
  const { GridState } = await import('../src/core/state.js');
  const { createBoard } = await import('../src/game/board.js');
  const { newGame, migrateState, RULES_VERSION } = await import('../src/game/rules.js');
  const { drawEquipment, deckList } = await import('../src/game/decks.js');
  const g = new GridState(10, 10);
  for (let x = 0; x < 10; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(9, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  g.apply(g.index(2, 5), { marker: 'investigation' }, { silent: true });
  const board = createBoard(g);

  const config = { deckCounts: { 'equipment:crowbar': 0, 'equipment:kitchen-knife': 3, 'events:sinkhole': 0 } };
  const { state } = newGame(board, { seed: 5, config });
  assert.equal(state.version, RULES_VERSION);
  assert.equal(state.decks.equipment.length, 44 - 1 + 2);
  assert.ok(!state.decks.equipment.includes('crowbar'));
  assert.equal(state.decks.equipment.filter((id) => id === 'kitchen-knife').length, 3);
  assert.equal(state.decks.events.length, 36);
  assert.equal(deckList({}, 'mindsets').length, 6);

  // Drawing empties the deck: every card once (well, 3 knives), then nothing.
  const pl = state.players[0];
  const seen = [];
  for (let k = 0; k < 50; k++) { const c = drawEquipment(state, pl, 'test'); if (c) seen.push(c.id); }
  assert.equal(seen.length, 45);
  assert.equal(new Set(seen).size, 43);
  assert.equal(pl.inventory.equipment.length, 45);

  // A version-1 save (no decks) gets them, minus what players already hold.
  const old = JSON.parse(JSON.stringify(newGame(board, { seed: 6 }).state));
  delete old.decks; delete old.config.deckCounts; old.version = 1;
  old.players[0].inventory.equipment.push({ id: 'crowbar', label: 'Crowbar' });
  migrateState(old);
  assert.equal(old.version, 2);
  assert.equal(old.decks.equipment.length, 43);
  assert.ok(!old.decks.equipment.includes('crowbar'));
});

test('monsters taken out of the game leave the random pool', async () => {
  const { GridState } = await import('../src/core/state.js');
  const { createBoard } = await import('../src/game/board.js');
  const { newGame } = await import('../src/game/rules.js');
  const { MONSTER_CARDS } = await import('../src/game/cards/monsters.js');
  const g = new GridState(10, 10);
  for (let x = 0; x < 10; x++) g.apply(g.index(x, 5), { area: 'outdoor', sub: 'street' }, { silent: true });
  g.apply(g.index(9, 5), { area: 'outdoor', sub: 'start', walkable: false, facing: 3 }, { silent: true });
  g.apply(g.index(2, 5), { marker: 'investigation' }, { silent: true });
  const deckCounts = Object.fromEntries(MONSTER_CARDS.filter((c) => c.id !== 'wendigo').map((c) => [`monsters:${c.id}`, 0]));
  for (let seed = 1; seed < 6; seed++) {
    const { state } = newGame(createBoard(g), { seed, config: { deckCounts } });
    assert.equal(state.mystery.monster, 'wendigo');
    assert.deepEqual(state.mystery.pool, ['wendigo']);
  }
});
