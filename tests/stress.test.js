import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState, MAX_SIZE, isLandmark, landmarkDims } from '../src/core/state.js';
import { filledBoard, subjects } from '../src/core/stressBoard.js';

const load = (data) => { const g = new GridState(4, 4); g.load(data); return g; };

test('every tile can be stress tested: walkable and blocked, premade buildings blocked only', () => {
  const list = subjects();
  const ids = new Set(list.map((s) => s.id));
  assert.equal(ids.size, list.length, 'ids are unique');
  assert.ok(!list.some((s) => s.sub === 'start'), 'no start space');
  assert.ok(ids.has('indoor:hospital:walkable') && ids.has('indoor:hospital:blocked'));
  for (const s of list) if (isLandmark(s.sub)) assert.equal(s.walkable, false, s.id);
});

test('a filled board covers the largest map with the subject', () => {
  const forest = subjects().find((s) => s.id === 'outdoor:forest:blocked');
  const g = load(filledBoard(forest, MAX_SIZE, MAX_SIZE));
  assert.equal(g.cells.length, MAX_SIZE * MAX_SIZE);
  assert.ok(g.cells.every((c) => c.sub === 'forest' && !c.walkable));
  assert.equal(g.edges.size, 0, 'outdoors: no walls');
});

test('indoor floors are split into 4 x 4 rooms with doors, unless asked not to', () => {
  const ward = subjects().find((s) => s.id === 'indoor:hospital:blocked');
  const g = load(filledBoard(ward, 8, 8));
  assert.ok(g.edges.size > 0);
  assert.equal(g.edges.get('h2,4'), 'door');
  assert.equal(g.edges.get('h0,4'), 'wall');
  assert.equal(load(filledBoard(ward, 8, 8, { rooms: false })).edges.size, 0);
});

test('premade buildings repeat as whole blocks', () => {
  const diner = subjects().find((s) => s.sub === 'diner');
  const g = load(filledBoard(diner, 20, 20));
  const [w, h] = landmarkDims('diner', 2);
  assert.equal(g.landmarkBlocks('diner').length, Math.floor(20 / w) * Math.floor(20 / h));
});
