// The boards the stress test (src/editor/stressTest.js) measures: what can
// fill one, and a board filled with it. Pure: no rendering, so it's tested.
import { AREAS, GridState, hasFixedFootprint, isLandmark } from './state.js';
import { BUILDING_TYPES, BUILDING_ORDER } from './buildings.js';

// Everything that can fill a board: every subcategory, walkable and blocked
// (premade buildings only come blocked).
export function subjects() {
  const out = [];
  for (const [area, def] of Object.entries(AREAS)) {
    for (const [sub, s] of Object.entries(def.subs)) {
      if (sub === 'start') continue;
      const base = { area, sub, cat: s.cat, label: s.label };
      if (isLandmark(sub)) out.push({ ...base, id: `${area}:${sub}:blocked`, walkable: false });
      else {
        out.push({ ...base, id: `${area}:${sub}:walkable`, walkable: true, label: `${s.label} (walkable)` });
        out.push({ ...base, id: `${area}:${sub}:blocked`, walkable: false, label: `${s.label} (blocked)` });
      }
    }
  }
  // Every building type, on plain floor (its furniture is what costs).
  for (const t of BUILDING_ORDER) {
    const base = { area: 'indoor', sub: 'hardwood', use: t, cat: 'buildings', label: BUILDING_TYPES[t].label };
    out.push({ ...base, id: `building:${t}:walkable`, walkable: true, label: `${base.label} (walkable)` });
    out.push({ ...base, id: `building:${t}:blocked`, walkable: false, label: `${base.label} (blocked)` });
  }
  return out;
}

// A cols x rows board covered in `subject`. Premade buildings repeat as whole
// blocks facing south; indoor floors are split into 4 x 4 rooms with a door
// in each wall (walls cost too), unless `rooms` is off.
export function filledBoard(subject, cols, rows, { rooms = true, terrain = 'flat' } = {}) {
  const g = new GridState(cols, rows);
  g.terrain = terrain;
  const fixed = hasFixedFootprint(subject.sub);
  for (const c of g.cells) {
    Object.assign(c, { area: subject.area, sub: subject.sub, walkable: subject.walkable, bridge: false, use: subject.use ?? null });
    if (fixed) Object.assign(c, { facing: 2, flip: false });
  }
  if (subject.area === 'indoor' && rooms) {
    for (let y = 0; y <= rows; y += 4) for (let x = 0; x < cols; x++) g.setEdge('h', x, y, x % 4 === 2 && y > 0 && y < rows ? 'door' : 'wall', { silent: true });
    for (let x = 0; x <= cols; x += 4) for (let y = 0; y < rows; y++) g.setEdge('v', x, y, y % 4 === 2 && x > 0 && x < cols ? 'door' : 'wall', { silent: true });
  }
  return { cols, rows, cells: g.cells, edges: g.edges, terrain };
}
