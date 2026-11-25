// Building types. Every building is laid out with plain indoor floor
// (hardwood or carpet), walkable and blocked cells, walls, windows and doors;
// then the map author tells the editor what it is (Buildings tool), and the
// game dresses it: furniture by type (blocked cells hold the heavy pieces,
// walkable ones stay clear enough to walk), its outside finish and a sign by
// its front door, and its Objective markers become that site.
//
// A building is indoor floor joined by open floor or doors; a wall or window
// between two floors splits them (a row of shops sharing walls is several
// buildings). Its type is stored on its cells (`use`), so it survives
// repainting; cells painted into a typed building take its type.
//
//   label     the name in the editor
//   site      the objective site it is (src/core/sites.js), if any
//   sign      the sign over its front door: text, ink, board colours; `glow`
//             lights it (neon, a lit cross)
//   exterior  the outside finish it always gets (a BUILDING_STYLES name)
//   interior  the inside finish (an INTERIOR_STYLES name)
//   floor     a special floor look over what was painted (a SUB_LOOK key:
//             church boards, linoleum); otherwise hardwood or carpet as painted
//   awning    a striped awning over the front door (shops)
//   rooms     small rooms behind one door are private units (Hotel rooms,
//             Apartments); the rest are common areas (lobby, halls)
import { edgeKey } from './state.js';

export const BUILDING_TYPES = {
  church: { label: 'Church', site: 'church', sign: { text: '✝', fg: '#f3e3b0', bg: '#3a2a1c', glow: true, w: 0.9 }, exterior: 'Old cream clapboard', interior: 'Oak wainscot and cream plaster', floor: 'church' },
  hotel: { label: 'Hotel', site: 'hotel', sign: { text: 'HOTEL', fg: '#ffd27a', bg: '#3a1418', glow: true }, exterior: 'Red-brown brick', interior: 'Faded rose striped wallpaper', rooms: true },
  apartments: { label: 'Apartments', site: null, sign: { text: 'APARTMENTS', fg: '#e8e0c8', bg: '#2a2e33' }, exterior: 'Soot-dark brick', interior: 'Nicotine-stained plaster', rooms: true },
  boutique: { label: 'Boutique', site: 'boutique', sign: { text: 'BOUTIQUE', fg: '#f2d6e0', bg: '#4a2a3a' }, exterior: 'Slate-blue clapboard', interior: 'Faded rose striped wallpaper', awning: '#7a3a52' },
  market: { label: 'Market', site: null, sign: { text: 'MARKET', fg: '#fff2c8', bg: '#2a4a2a' }, exterior: 'Weathered olive clapboard', interior: 'Grey-green plaster', floor: 'hospital', awning: '#3a6a3a' },
  bar: { label: 'Bar', site: 'bar', sign: { text: 'BAR', fg: '#ff5a7a', bg: '#140a10', glow: true }, exterior: 'Soot-dark brick', interior: 'Dark walnut panelling' },
  library: { label: 'Library', site: null, sign: { text: 'PUBLIC LIBRARY', fg: '#efe6cc', bg: '#2a3a4a' }, exterior: 'Red-brown brick', interior: 'Oak wainscot and cream plaster' },
  curio: { label: 'Curio Shop', site: 'curio', sign: { text: 'CURIOS', fg: '#e8cf8a', bg: '#2a1e14' }, exterior: 'Cedar shingle', interior: 'Dark walnut panelling' },
  florist: { label: 'Florist', site: null, sign: { text: 'FLOWERS', fg: '#fbe6ee', bg: '#3a5a3a' }, exterior: 'Sage board-and-batten', interior: 'Mint beadboard', awning: '#b05a78' },
  cafe: { label: 'Cafe', site: null, sign: { text: 'CAFE', fg: '#fff0d8', bg: '#5a2e1e', glow: true }, exterior: 'Dusty mustard clapboard', interior: 'Yellowed floral wallpaper', awning: '#a8402e' },
  outdoor: { label: 'Outdoor Store', site: 'outdoor', sign: { text: 'OUTFITTERS', fg: '#f0e2b8', bg: '#2e3a24' }, exterior: 'Grey-brown board-and-batten', interior: 'Grey-green plaster' },
  funeral: { label: 'Funeral Parlor', site: 'funeral', sign: { text: 'FUNERAL HOME', fg: '#d8d4c8', bg: '#16161a' }, exterior: 'Old cream clapboard', interior: 'Dark walnut panelling' },
  hospital: { label: 'Hospital', site: 'hospital', sign: { text: '✚ HOSPITAL', fg: '#ffffff', bg: '#a3201c', glow: true }, exterior: 'Worn plaster', interior: 'Grey-green plaster', floor: 'hospital' },
  pharmacy: { label: 'Pharmacy', site: null, sign: { text: '✚ PHARMACY', fg: '#e8fff0', bg: '#1e6a3a', glow: true }, exterior: 'Worn plaster', interior: 'Mint beadboard', floor: 'hospital' },
};
export const BUILDING_ORDER = ['church', 'hotel', 'apartments', 'boutique', 'market', 'bar', 'library', 'curio', 'florist', 'cafe', 'outdoor', 'funeral', 'hospital', 'pharmacy'];
export const buildingLabel = (t) => BUILDING_TYPES[t]?.label ?? 'Building';

// Old maps painted special floors; they become plain hardwood in a building of
// that type (normalizeCell).
export const FLOOR_TYPES = { church: 'church', hospital: 'hospital' };

// A wall, window or boarded window splits floors; open floor and doors join them.
const joins = (t) => !t || t === 'door' || t === 'lockedDoor' || t === 'boardedDoor' || t.startsWith('oneWayDoor');
const edgeOf = (grid, x, y, dx, dy) => (dx ? edgeKey('v', dx > 0 ? x + 1 : x, y) : edgeKey('h', x, dy > 0 ? y + 1 : y));
const edgeType = (grid, auto, k) => grid.edges.get(k) ?? auto.get(k);

// Flood indoor floor through edges that `pass(type)` allows. Returns an
// Int32Array: each indoor cell's group id (its lowest cell index), -1 outdoors.
function flood(grid, pass) {
  const ids = new Int32Array(grid.cells.length).fill(-1);
  const auto = grid.autoEdges();
  for (let i = 0; i < grid.cells.length; i++) {
    if (ids[i] >= 0 || grid.cells[i].area !== 'indoor') continue;
    ids[i] = i;
    const queue = [i];
    while (queue.length) {
      const { x, y } = grid.coords(queue.pop());
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!grid.inBounds(x + dx, y + dy)) continue;
        const k = grid.index(x + dx, y + dy);
        if (ids[k] >= 0 || grid.cells[k].area !== 'indoor') continue;
        if (!pass(edgeType(grid, auto, edgeOf(grid, x, y, dx, dy)))) continue;
        ids[k] = i;
        queue.push(k);
      }
    }
  }
  return ids;
}
// Which building each cell is in (its lowest cell index; -1 outdoors).
export const buildingIds = (grid) => (grid._bids ??= flood(grid, joins));
// Which room: floor joined by open floor only (walls, windows and doors split rooms).
export const roomIds = (grid) => (grid._rooms ??= flood(grid, (t) => !t));

// The cells of the building cell i is in.
export function buildingCells(grid, i) {
  const ids = buildingIds(grid);
  if (ids[i] < 0) return [];
  const out = [];
  ids.forEach((b, k) => { if (b === ids[i]) out.push(k); });
  return out;
}

// Each building's type: the one most of its cells carry (so cells painted
// into a typed building take its type). Map: building id -> type or null.
export function buildingTypes(grid) {
  if (grid._btypes) return grid._btypes;
  const ids = buildingIds(grid);
  const votes = new Map();
  grid.cells.forEach((c, i) => {
    if (ids[i] < 0 || !BUILDING_TYPES[c.use]) return;
    const v = votes.get(ids[i]) ?? {};
    v[c.use] = (v[c.use] ?? 0) + 1;
    votes.set(ids[i], v);
  });
  const out = new Map();
  for (const [b, v] of votes) out.set(b, Object.entries(v).sort((a, z) => z[1] - a[1])[0][0]);
  return (grid._btypes = out);
}
// The type of the building cell i is in (null: generic, or outdoors).
export function typeAt(grid, i) {
  const b = buildingIds(grid)[i];
  return b >= 0 ? buildingTypes(grid).get(b) ?? null : null;
}

// Rooms of a building with private units (Hotel, Apartments): a small room
// (up to 6 cells) whose only ways in are doors from the building's own floor,
// a single one, is a unit (a guest room, a flat); everything else is common
// (lobby, hallway, stairs). Returns a Set of the unit rooms' ids.
export const UNIT_MAX = 6;
export function unitRooms(grid) {
  if (grid._units) return grid._units;
  const rooms = roomIds(grid);
  const auto = grid.autoEdges();
  const size = new Map(), doorsIn = new Map(), outside = new Set();
  grid.cells.forEach((c, i) => {
    const r = rooms[i];
    if (r < 0) return;
    size.set(r, (size.get(r) ?? 0) + 1);
    const { x, y } = grid.coords(i);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = edgeType(grid, auto, edgeOf(grid, x, y, dx, dy));
      if (!t || !joins(t)) continue;                       // walls, windows and open floor aren't doors
      const n = grid.inBounds(x + dx, y + dy) ? grid.index(x + dx, y + dy) : -1;
      if (n < 0 || grid.cells[n].area !== 'indoor') outside.add(r);
      else doorsIn.set(r, (doorsIn.get(r) ?? 0) + 1);
    }
  });
  const out = new Set();
  for (const [r, n] of size) if (n <= UNIT_MAX && !outside.has(r) && (doorsIn.get(r) ?? 0) === 1) out.add(r);
  return (grid._units = out);
}

// The building's front door: a door between its floor and outside, preferring
// one onto a street, start space or path. { edge, cell (indoor), out: [dx, dy] } or null.
export function frontDoor(grid, cells) {
  const auto = grid.autoEdges();
  let best = null, score = -1;
  for (const i of cells) {
    const { x, y } = grid.coords(i);
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const k = edgeOf(grid, x, y, dx, dy);
      const t = edgeType(grid, auto, k);
      if (!t || !joins(t)) continue;
      const inB = grid.inBounds(x + dx, y + dy);
      const n = inB ? grid.cells[grid.index(x + dx, y + dy)] : null;
      if (n && n.area === 'indoor') continue;
      const s = !n ? 0 : n.sub === 'street' || n.sub === 'start' ? 3 : n.sub === 'path' || n.sub === 'cemeteryPath' ? 2 : 1;
      if (s > score) { score = s; best = { edge: k, cell: i, out: [dx, dy] }; }
    }
  }
  return best;
}
