// Builds the built-in map "Hawthorn Bend" (src/maps/hawthorn-bend.json).
//   node tools/build-hawthorn-bend.mjs
// Edit here and re-run rather than editing the JSON by hand. The script
// fails if the map doesn't pass the Ready to play? check without problems.
import fs from 'node:fs';
import { GridState, defaultWalkable } from '../src/core/state.js';
import { writeMap } from '../src/core/mapFormat.js';
import { checkMap } from '../src/core/mapCheck.js';

const g = new GridState(20, 26);
g.terrain = 'hillside';
const cell = (x, y, patch) => g.apply(g.index(x, y), patch, { silent: true });
const area = (a, sub) => ({ area: a, sub, walkable: defaultWalkable(a, sub), bridge: false });
const rect = (x0, y0, x1, y1, patch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cell(x, y, patch); };
// A building: indoor floor plus walls round it, with doors/windows on given edges.
function building(x0, y0, x1, y1, sub, openings = {}) {
  rect(x0, y0, x1, y1, area('indoor', sub));
  const set = (o, x, y, def) => g.setEdge(o, x, y, openings[`${o}${x},${y}`] ?? def);
  for (let x = x0; x <= x1; x++) { set('h', x, y0, 'wall'); set('h', x, y1 + 1, 'wall'); }
  for (let y = y0; y <= y1; y++) { set('v', x0, y, 'wall'); set('v', x1 + 1, y, 'wall'); }
}
const landmark = (sub, x, y, w, h, facing) => rect(x, y, x + w - 1, y + h - 1, { ...area('outdoor', sub), facing, flip: false });

// Ground cover: forest to the north-west and along the river, a cemetery to the south-west.
rect(0, 0, 4, 5, area('outdoor', 'forest'));
rect(5, 0, 5, 2, area('outdoor', 'forest'));
rect(14, 0, 15, 4, area('outdoor', 'forest'));
rect(0, 19, 4, 25, area('outdoor', 'cemetery'));
rect(2, 19, 2, 25, area('outdoor', 'cemeteryPath'));
rect(0, 25, 4, 25, area('outdoor', 'forestCemetery'));
rect(10, 22, 15, 25, area('outdoor', 'forest'));
rect(5, 3, 5, 8, area('outdoor', 'path'));

// The river along the east edge, with a bridge carrying Main Street.
rect(17, 0, 18, 25, area('water', 'river'));
cell(17, 12, { bridge: true, walkable: true });
cell(18, 12, { bridge: true, walkable: true });

// Streets: Main Street (row 12) and Mill Road (column 6), and a lane (column 13, south).
rect(0, 12, 19, 12, area('outdoor', 'street'));
rect(17, 12, 18, 12, { bridge: true });
rect(6, 3, 6, 25, area('outdoor', 'street'));
rect(13, 13, 13, 21, area('outdoor', 'street'));
// The van, at the west end of Main Street, facing east.
cell(0, 12, { area: 'outdoor', sub: 'start', walkable: false, bridge: false, facing: 1 });

// Buildings.
building(7, 4, 11, 8, 'church', { 'h9,9': 'door', 'v7,6': 'window' });                 // St. Brigid's, door onto Main Street side
building(1, 8, 4, 10, 'hardwood', { 'h2,11': 'door', 'v5,9': 'window' });              // the Kessler house
building(8, 15, 11, 18, 'hardwood', { 'h9,15': 'lockedDoor', 'v8,17': 'door' });       // Hollis Hardware (locked front, side door)
g.setEdge('v', 10, 15, 'wall'); g.setEdge('v', 10, 16, 'door');                       // back room
building(14, 14, 16, 17, 'carpet', { 'v14,15': 'door' });                              // the Pruitt place, by the river
building(1, 14, 4, 16, 'condemned', { 'h2,14': 'door' });                              // the old boarding house

// Premade landmarks.
landmark('clocktower', 7, 10, 2, 2, 2);
landmark('diner', 9, 10, 3, 2, 2);
landmark('gasStation', 14, 10, 3, 2, 2);
landmark('payphone', 12, 11, 1, 1, 2);
landmark('memorial', 5, 13, 1, 1, 1);

// Light: lamps inside, the clocktower plaza, the diner's booth.
for (const [x, y, r] of [[9, 6, 1.5], [3, 9, 1], [9, 16, 1], [15, 16, 1], [12, 13, 1.5], [6, 12, 2]]) cell(x, y, { lit: true, radius: r });

// Markers.
const mark = (x, y, marker) => cell(x, y, { marker });
mark(9, 5, 'investigation');      // church nave
mark(2, 9, 'investigation');      // Kessler house
mark(10, 17, 'investigation');    // hardware back room
mark(15, 15, 'investigation');    // Pruitt place
mark(3, 21, 'investigation');     // cemetery
mark(5, 5, 'investigation');      // forest path
mark(13, 20, 'investigation');    // end of the lane
mark(11, 7, 'objective');         // church
mark(1, 10, 'objective');         // Kessler house
mark(9, 18, 'objective');         // hardware
mark(16, 14, 'objective');        // Pruitt place
mark(12, 13, 'key');              // the hardware key, dropped outside
mark(4, 12, 'whiteDice');
mark(13, 12, 'whiteDice');
mark(6, 18, 'blackDice');
mark(2, 13, 'research');          // papers blown out of the boarding house
mark(6, 8, 'whiteDice');

// Every premade building must form a whole block (right size for its facing).
for (const sub of ['clocktower', 'diner', 'gasStation', 'payphone', 'memorial']) {
  const cells = g.cells.filter((c) => c.sub === sub).length;
  const blocks = g.landmarkBlocks(sub);
  if (!blocks.length || blocks.reduce((n, b) => n + b.w * b.h, 0) !== cells) { console.error(`${sub} does not form whole blocks`); process.exit(1); }
}
const report = checkMap(g);
if (report.problems.length) {
  console.error(report.problems.map((p) => `${p.level}: ${p.text}`).join('\n'));
  process.exit(1);
}
const file = writeMap(g, {
  id: 'builtin-hawthorn-bend',
  name: 'Hawthorn Bend',
  description: 'Main Street at night: the church, the hardware store, the river bridge and the old cemetery.',
  created: '2026-11-22T00:00:00.000Z',
  updated: '2026-11-22T00:00:00.000Z',
});
fs.mkdirSync(new URL('../src/maps/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../src/maps/hawthorn-bend.json', import.meta.url), JSON.stringify(file));
console.log('wrote src/maps/hawthorn-bend.json:', report.ok ? 'ready to play' : 'NOT ready');
