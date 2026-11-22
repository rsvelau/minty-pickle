import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, TILE_CATEGORIES, LANDMARK_SUBS, GridState, isLandmark, footprintOf, defaultWalkable } from '../src/core/state.js';

test('every tile belongs to a known menu category', () => {
  const cats = new Set(TILE_CATEGORIES.map((c) => c.id));
  for (const [area, def] of Object.entries(AREAS)) {
    for (const [sub, s] of Object.entries(def.subs)) assert.ok(cats.has(s.cat), `${area}:${sub} has category ${s.cat}`);
  }
});

test('landmarks are blocked, sized and listed as landmarks', () => {
  assert.equal(Object.keys(LANDMARK_SUBS).length, 26); // plus the fishing dock, under Water
  for (const [sub, d] of Object.entries(LANDMARK_SUBS)) {
    assert.equal(defaultWalkable('outdoor', sub), false, sub);
    assert.ok(isLandmark(sub), sub);
    const fp = footprintOf('outdoor', sub);
    assert.ok(fp === 'fill' || (Array.isArray(fp) && fp.every((n) => n >= 1 && n <= 4)), `${sub} footprint`);
    assert.match(d.ground, /^#[0-9a-f]{6}$/);
  }
  assert.ok(isLandmark('clocktower') && isLandmark('dock'));
  assert.deepEqual(footprintOf('outdoor', 'clocktower'), [2, 2]);
  assert.equal(footprintOf('water', 'dock'), 'fill');
  assert.equal(isLandmark('forest'), false);
});

test('blocks() finds whole w x h blocks only', () => {
  const g = new GridState(10, 10);
  const paint = (x, y, w, h) => { for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) g.cells[g.index(x + dx, y + dy)].sub = 'lumberMill'; };
  paint(1, 1, 3, 4);   // one mill
  paint(5, 1, 3, 4);   // a second, separate one
  paint(5, 6, 2, 2);   // a fragment too small to be a mill
  assert.deepEqual(g.blocks('lumberMill', 3, 4), [g.index(1, 1), g.index(5, 1)]);
  paint(1, 5, 3, 4);   // stacked directly below the first: still two whole mills
  assert.deepEqual(g.blocks('lumberMill', 3, 4), [g.index(1, 1), g.index(5, 1), g.index(1, 5)]);
});

test('a turned building swaps its footprint and keeps its facing and flip', async () => {
  const { landmarkDims, normalizeCell } = await import('../src/core/state.js');
  assert.deepEqual(landmarkDims('diner', null), [2, 3]);   // as listed (older boards)
  assert.deepEqual(landmarkDims('diner', 2), [3, 2]);      // facing south: long side along x
  assert.deepEqual(landmarkDims('diner', 1), [2, 3]);      // facing east
  const g = new GridState(10, 10);
  for (let y = 1; y < 3; y++) for (let x = 1; x < 4; x++) Object.assign(g.cells[g.index(x, y)], { sub: 'diner', facing: 2, flip: true });
  const [b] = g.landmarkBlocks('diner');
  assert.deepEqual({ x: b.x, y: b.y, w: b.w, h: b.h, face: b.face, flip: b.flip }, { x: 1, y: 1, w: 3, h: 2, face: 2, flip: true });
  assert.equal(g.landmarkAt(g.index(3, 2)).anchor, g.index(1, 1));
  // Facing and flip survive a save; ordinary cells drop them.
  assert.deepEqual([normalizeCell({ area: 'outdoor', sub: 'diner', facing: 2, flip: true }).facing, normalizeCell({ area: 'outdoor', sub: 'diner', facing: 2, flip: true }).flip], [2, true]);
  assert.deepEqual([normalizeCell({ area: 'outdoor', sub: 'forest', facing: 2, flip: true }).facing, normalizeCell({ area: 'outdoor', sub: 'forest', flip: true }).flip], [null, false]);
});
