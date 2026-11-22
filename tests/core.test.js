// Tests for the core file formats: maps, saved games, storage and the
// "Ready to play?" check. Plain Node, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { readMap, writeMap, gridFromMap, normalizeMeta, MAP_VERSION } from '../src/core/mapFormat.js';
import { makeSave, readSave, assertPlain, SAVE_FORMAT } from '../src/core/saveFormat.js';
import { createStorage, memoryBackend, PLANNER_BOARD_KEY } from '../src/core/storage.js';
import { checkMap } from '../src/core/mapCheck.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction, RULES_VERSION } from '../src/game/rules.js';

// A small playable town: a street, a van, four investigation spots, three
// objectives in three separate buildings.
function town() {
  const g = new GridState(20, 26);
  const paint = (x, y, patch) => g.apply(g.index(x, y), patch, { silent: true });
  for (let x = 0; x < 20; x++) paint(x, 12, { area: 'outdoor', sub: 'street' });
  paint(19, 12, { area: 'outdoor', sub: 'start', walkable: false, facing: 3 });
  for (const x of [3, 7, 11, 15]) paint(x, 12, { marker: 'investigation' });
  for (const bx of [2, 8, 14]) {
    for (let y = 9; y < 12; y++) for (let x = bx; x < bx + 2; x++) paint(x, y, { area: 'indoor', sub: 'hardwood' });
    paint(bx, 10, { marker: 'objective' });
  }
  return g;
}

test('a map round-trips through its file, with details', () => {
  const g = town();
  const file = writeMap(g, { name: '  Hawthorn Bend  ', description: 'Main street' });
  assert.equal(file.version, MAP_VERSION);
  assert.equal(file.meta.name, 'Hawthorn Bend');
  const { grid, meta } = gridFromMap(JSON.stringify(file));
  assert.deepEqual(grid.toJSON(), g.toJSON());
  assert.equal(meta.description, 'Main street');
  assert.match(meta.id, /^map-/);
});

test('plain planner exports (no details) still read', () => {
  const { meta, data } = readMap(town().toJSON());
  assert.equal(meta, null);
  assert.equal(data.cols, 20);
});

test('unreadable or wrong files are refused with a clear message', () => {
  assert.throws(() => readMap('not json'), /not valid JSON/);
  assert.throws(() => readMap({ ...town().toJSON(), version: MAP_VERSION + 1 }), /newer version/);
  assert.throws(() => readMap({ format: 'something-else', cells: [] }), /Unknown file format/);
  assert.throws(() => readMap({ format: SAVE_FORMAT }), /saved game, not a map/);
});

test('map details are cleaned up', () => {
  const m = normalizeMeta({ name: '', extra: 1, description: 5 });
  assert.equal(m.name, 'Untitled map');
  assert.equal(m.description, '');
  assert.equal('extra' in m, false);
});

test('a saved game continues exactly where it left off', () => {
  const grid = town();
  const board = createBoard(grid);
  const { state } = newGame(board, { seed: 42, config: { players: 2 } });
  const play = (st, b, n) => {
    for (let k = 0; k < n; k++) {
      if (st.phase === 'idle') applyAction(st, b, { type: 'roll' });
      else if (st.phase === 'slotting') { applyAction(st, b, { type: 'slot', die: 0, to: 'move' }); applyAction(st, b, { type: 'move' }); }
      else if (st.phase === 'choosing') applyAction(st, b, { type: 'choose', cell: st.options[0].i });
      else if (st.phase === 'asking') applyAction(st, b, { type: 'investigate', yes: true });
      else applyAction(st, b, { type: 'end' });
    }
  };
  play(state, board, 12);
  const text = JSON.stringify(makeSave({ map: grid, state, name: 'Before midnight', mapMeta: { name: 'Town' } }));

  const loaded = readSave(text, { rulesVersion: RULES_VERSION });
  assert.equal(loaded.name, 'Before midnight');
  assert.equal(loaded.map.meta.name, 'Town');
  const g2 = new GridState(loaded.map.data.cols, loaded.map.data.rows);
  g2.load(loaded.map.data);
  const board2 = createBoard(g2);
  assert.deepEqual(loaded.state, JSON.parse(JSON.stringify(state)));

  // Same moves from here on: same game (the random-number state is saved too).
  play(state, board, 30);
  play(loaded.state, board2, 30);
  assert.deepEqual(loaded.state, JSON.parse(JSON.stringify(state)));
});

test('saves refuse what JSON would silently lose, and newer saves', () => {
  assert.throws(() => assertPlain({ seen: new Set([1]) }), /state\.seen is a Set/);
  assert.throws(() => assertPlain({ x: NaN }), /NaN/);
  const save = makeSave({ map: town(), state: { version: RULES_VERSION, phase: 'idle' } });
  assert.throws(() => readSave({ ...save, version: 99 }), /newer version/);
  assert.throws(() => readSave({ ...save, state: { version: RULES_VERSION + 1 } }, { rulesVersion: RULES_VERSION }), /newer version of the game rules/);
  assert.throws(() => readSave(town().toJSON()), /not a saved game/);
});

test('storage keeps a map library, saves and the planner board', () => {
  const backend = memoryBackend({ [PLANNER_BOARD_KEY]: '{"cells":[]}' });
  const store = createStorage(backend);
  assert.equal(store.plannerBoard.get(), '{"cells":[]}'); // existing boards carry over

  const id = store.maps.put(writeMap(town(), { name: 'Main street' }));
  const id2 = store.maps.put(writeMap(new GridState(8, 8), { name: 'Tiny' }));
  assert.deepEqual(store.maps.list().map((e) => e.name).sort(), ['Main street', 'Tiny']);
  assert.equal(store.maps.get(id).meta.name, 'Main street');
  store.maps.remove(id2);
  assert.deepEqual(store.maps.list().map((e) => e.id), [id]);

  const sid = store.saves.put(makeSave({ map: town(), state: { version: 1 }, name: 'Slot 1' }), 'slot1');
  assert.equal(sid, 'slot1');
  assert.equal(store.saves.list()[0].name, 'Slot 1');

  store.prefs.set('quality', 'low');
  assert.equal(store.prefs.get('quality'), 'low');
  assert.equal(store.prefs.get('missing', 'x'), 'x');
});

test('storage never throws when the browser blocks it', () => {
  const broken = { get() { throw new Error('blocked'); }, set() { throw new Error('full'); }, remove() { throw new Error('x'); }, keys: () => [] };
  const store = createStorage(broken);
  assert.equal(store.plannerBoard.get(), null);
  assert.equal(store.plannerBoard.set('{}'), false);
  assert.equal(store.maps.put(writeMap(town())), null);
  assert.deepEqual(store.maps.list(), []);
});

test('Ready to play: a good town passes', () => {
  const r = checkMap(town());
  assert.equal(r.ok, true, JSON.stringify(r.problems));
  assert.deepEqual(r.problems, []);
});

test('Ready to play: an empty board says what is missing', () => {
  const r = checkMap(new GridState(10, 10));
  assert.equal(r.ok, false);
  const codes = r.problems.map((p) => p.code);
  assert.ok(codes.includes('no-start'));
  assert.ok(codes.includes('no-investigation'));
  assert.ok(codes.includes('no-objectives'));
});

test('Ready to play: unreachable markers, too few spots, blocked start', () => {
  const g = town();
  // Wall the westmost building in completely: its objective is stranded.
  for (let y = 9; y < 12; y++) { g.setEdge('v', 2, y, 'wall'); g.setEdge('v', 4, y, 'wall'); }
  g.setEdge('h', 2, 9, 'wall'); g.setEdge('h', 3, 9, 'wall'); g.setEdge('h', 2, 12, 'wall'); g.setEdge('h', 3, 12, 'wall');
  g.apply(g.index(3, 12), { marker: null }, { silent: true });
  let r = checkMap(g);
  assert.equal(r.ok, true);
  const un = r.problems.find((p) => p.code === 'unreachable');
  assert.ok(un, JSON.stringify(r.problems));
  assert.deepEqual(un.cells, [g.index(2, 10)]);
  assert.ok(r.problems.some((p) => p.code === 'few-investigation'));

  g.apply(g.index(18, 12), { area: 'outdoor', sub: 'forest', walkable: false }, { silent: true });
  r = checkMap(g);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => p.code === 'start-blocked'));
});
