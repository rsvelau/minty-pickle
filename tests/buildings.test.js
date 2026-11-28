// Building types: what a building is, rooms and private units, the front
// door, old Church / Hospital floors, and objective sites from the building.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GridState } from '../src/core/state.js';
import { buildingIds, buildingCells, typeAt, unitRooms, roomIds, frontDoor, BUILDING_TYPES, BUILDING_ORDER } from '../src/core/buildings.js';
import { siteOf } from '../src/core/sites.js';
import { gridFromMap } from '../src/core/mapFormat.js';
import { mapSites } from '../src/game/objectives/scripts.js';

// A street on row 6; two buildings side by side sharing a wall at x = 5:
// A (x 2-4, y 2-5) and B (x 5-7, y 2-5), each with a door onto the street.
function town() {
  const g = new GridState(12, 8);
  for (let x = 0; x < 12; x++) g.apply(g.index(x, 6), { area: 'outdoor', sub: 'street' }, { silent: true });
  for (let y = 2; y < 6; y++) for (let x = 2; x < 8; x++) g.apply(g.index(x, y), { area: 'indoor', sub: 'hardwood' }, { silent: true });
  for (let x = 2; x < 8; x++) { g.setEdge('h', x, 2, 'wall', { silent: true }); g.setEdge('h', x, 6, x === 3 || x === 6 ? 'door' : 'wall', { silent: true }); }
  for (let y = 2; y < 6; y++) { g.setEdge('v', 2, y, 'wall', { silent: true }); g.setEdge('v', 5, y, 'wall', { silent: true }); g.setEdge('v', 8, y, 'wall', { silent: true }); }
  return g;
}
const tag = (g, i, use) => { for (const j of buildingCells(g, i)) g.apply(j, { use }); };

test('a wall between floors splits buildings; doors and open floor join them', () => {
  const g = town();
  const ids = buildingIds(g);
  assert.notEqual(ids[g.index(3, 3)], ids[g.index(6, 3)], 'two buildings');
  assert.equal(buildingCells(g, g.index(3, 3)).length, 12);
  g.setEdge('v', 5, 4, 'door');                           // a door through the shared wall
  assert.equal(buildingIds(g)[g.index(3, 3)], buildingIds(g)[g.index(6, 3)], 'now one');
});

test('a building has one type: the one most of its cells carry; new floor takes it', () => {
  const g = town();
  tag(g, g.index(3, 3), 'library');
  assert.equal(typeAt(g, g.index(4, 5)), 'library');
  assert.equal(typeAt(g, g.index(6, 3)), null, 'the shop next door is untouched');
  g.apply(g.index(4, 5), { use: null });                  // one cell painted afresh
  assert.equal(typeAt(g, g.index(4, 5)), 'library');
});

test('Hotel / Apartments: small rooms behind a single door are units; halls are common', () => {
  const g = town();
  // Building A: a hall at y 5, two rooms (x 2 and x 3-4, y 2-4) each behind one door.
  for (let x = 2; x < 5; x++) g.setEdge('h', x, 5, x === 2 || x === 4 ? 'door' : 'wall');
  for (let y = 2; y < 5; y++) g.setEdge('v', 3, y, 'wall');
  const rooms = roomIds(g), units = unitRooms(g);
  assert.ok(units.has(rooms[g.index(2, 3)]), 'a one-cell-wide room');
  assert.ok(units.has(rooms[g.index(4, 3)]), 'the bigger room');
  assert.ok(!units.has(rooms[g.index(3, 5)]), 'the hall has the street door: common');
});

test('the front door is the one onto the street', () => {
  const g = town();
  g.setEdge('h', 6, 2, 'door');                           // a back door onto nothing in particular
  const d = frontDoor(g, buildingCells(g, g.index(6, 3)));
  assert.equal(d.edge, 'h6,6');
  assert.deepEqual(d.out, [0, 1]);
});

test('old Church and Hospital floors load as hardwood in a building of that type', () => {
  const g = town();
  const json = g.toJSON();
  for (const c of json.cells) if (c.area === 'indoor' && c.x < 5) c.sub = 'church';
  const { grid: back } = gridFromMap(json);
  assert.equal(back.cells[back.index(3, 3)].sub, 'hardwood');
  assert.equal(typeAt(back, back.index(3, 3)), 'church');
  assert.ok(back.toJSON().cells.some((c) => c.use === 'church'), 'saved as a type');
});

test('an Objective marker inside a typed building is that site, unless it says otherwise', () => {
  const g = town();
  tag(g, g.index(3, 3), 'hotel');
  const i = g.index(3, 4);
  g.apply(i, { marker: 'objective' });
  assert.equal(siteOf(g.cells[i], g, i), 'hotel');
  assert.deepEqual(mapSites(g).hotel, [i]);
  g.apply(i, { site: 'bar' });
  assert.equal(siteOf(g.cells[i], g, i), 'bar', 'an explicit pick wins');
  tag(g, g.index(6, 3), 'pharmacy');
  const j = g.index(6, 4);
  g.apply(j, { marker: 'objective' });
  assert.equal(siteOf(g.cells[j], g, j), null, 'a Pharmacy is not an objective site');
});

test('every type has a sign and finishes; the editor lists them all', () => {
  assert.equal(BUILDING_ORDER.length, Object.keys(BUILDING_TYPES).length);
  for (const t of BUILDING_ORDER) {
    const d = BUILDING_TYPES[t];
    assert.ok(d.label && d.sign?.text && d.exterior && d.interior, t);
  }
});
