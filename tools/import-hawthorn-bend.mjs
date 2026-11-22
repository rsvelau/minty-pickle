// Installs the built-in map "Hawthorn Bend" (src/maps/hawthorn-bend.json)
// from a board exported from the editor (File → Export JSON):
//   node tools/import-hawthorn-bend.mjs [export.json]
// Defaults to maps-src/hawthorn-bend.export.json, the designer's latest export.
// The board is read and re-written through the normal map loader, so it opens
// exactly as it does in the editor; the Ready to play? report is printed.
import fs from 'node:fs';
import { gridFromMap, writeMap } from '../src/core/mapFormat.js';
import { checkMap } from '../src/core/mapCheck.js';

const src = process.argv[2] ?? new URL('../maps-src/hawthorn-bend.export.json', import.meta.url);
const { grid } = gridFromMap(JSON.parse(fs.readFileSync(src, 'utf8')));
const report = checkMap(grid);
for (const p of report.problems) console.log(`${p.level}: ${p.text}`);
const file = writeMap(grid, {
  id: 'builtin-hawthorn-bend',
  name: 'Hawthorn Bend',
  description: 'Hawthorn Bend at night: Main Street, the church, the hospital, the river and the old cemetery.',
  created: '2026-11-22T00:00:00.000Z',
  updated: new Date().toISOString(),
});
fs.writeFileSync(new URL('../src/maps/hawthorn-bend.json', import.meta.url), JSON.stringify(file));
console.log(`wrote src/maps/hawthorn-bend.json (${grid.cols}x${grid.rows}):`, report.ok ? 'ready to play' : 'NOT ready to play');
