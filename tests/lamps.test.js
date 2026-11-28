// Street lamp posts: one at every junction, and posts spaced evenly along the
// streets between them, never clustered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState, streetLampCells, LAMP_SPACING, isJunction } from '../src/core/state.js';

const street = (g, cells) => { for (const [x, y] of cells) g.apply(g.index(x, y), { area: 'outdoor', sub: 'street' }, { silent: true }); };
const row = (y, x0, x1) => Array.from({ length: x1 - x0 + 1 }, (_, k) => [x0 + k, y]);
const col = (x, y0, y1) => Array.from({ length: y1 - y0 + 1 }, (_, k) => [x, y0 + k]);
const xy = (g, set) => [...set].map((i) => Object.values(g.coords(i)));
const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

test('a straight street between two crossings gets evenly spaced posts', () => {
  const g = new GridState(30, 12);
  street(g, row(5, 0, 29));
  street(g, col(4, 0, 11));
  street(g, col(25, 0, 11));
  const lamps = xy(g, streetLampCells(g)).filter(([, y]) => y === 5).map(([x]) => x).sort((a, b) => a - b);
  assert.ok(lamps.includes(4) && lamps.includes(25), 'the crossings');
  const between = lamps.filter((x) => x > 4 && x < 25);
  assert.ok(between.length >= 3, 'posts along the street');
  const gaps = [4, ...between, 25].slice(1).map((x, k, a) => x - [4, ...between][k]);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `even gaps: ${gaps}`);
  assert.ok(gaps.every((d) => d >= LAMP_SPACING - 1 && d <= LAMP_SPACING + 1));
});

test('no post stands within one cell of another lamp (parallel streets, stubs, junctions)', () => {
  const g = new GridState(30, 16);
  street(g, row(5, 0, 29));
  street(g, row(7, 0, 29));                       // a parallel street two cells away
  street(g, col(10, 0, 4));                       // a stub into a junction
  street(g, col(20, 8, 15));
  const lamps = xy(g, streetLampCells(g));
  const posts = lamps.filter(([x, y]) => !isJunction(g, x, y));
  assert.ok(posts.length >= 6, 'posts along all of them');
  for (const p of posts) {
    const close = lamps.filter((o) => o !== p && cheb(o, p) <= 1);
    assert.deepEqual(close, [], `post at ${p} has a lamp next to it`);
  }
});

test('a short run gets no post; a loop of street gets posts too', () => {
  const g = new GridState(20, 20);
  street(g, row(5, 0, 19));
  street(g, col(6, 0, 19));
  street(g, col(8, 0, 19));                       // the run between x 6 and 8 is one cell: no post
  const lamps = xy(g, streetLampCells(g));
  assert.ok(!lamps.some(([x, y]) => x === 7 && y === 5));
  const h = new GridState(12, 12);
  street(h, [...row(1, 1, 10), ...row(10, 1, 10), ...col(1, 2, 9), ...col(10, 2, 9)]);
  assert.ok(streetLampCells(h).size >= 4, 'a ring road');
});

test('posts start off, and switch on like any lamp', () => {
  const g = new GridState(30, 12);
  street(g, row(5, 0, 29));
  const post = [...g.streetLamps()][0];
  assert.ok(post !== undefined);
  assert.equal(g.lampOn(post), false, 'off until switched on');
  g.apply(post, { lamp: true, lit: true });
  assert.equal(g.lampOn(post), true);
  assert.ok(g.lightLevels()[post] > 0.9);
});
