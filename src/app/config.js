// App configuration and shared UI state: tile colours, brushes, keyboard
// brush shortcuts, the `ui` object (current tool, brush, view...) and the grid.

import { installTerrain } from '../render/terrain.js';
import { m } from '../core/scale.js';
import { LANDMARK_SUBS, defaultCell, GridState, COLS, ROWS, defaultWalkable, hasStreetLamp, AREAS, FACINGS } from '../core/state.js';
import { createStorage } from '../core/storage.js';
import { readMap } from '../core/mapFormat.js';

// Module state: assigned by init() below, in the same order as before the split.
export let BASE, WATER_Y, BED_H, DECK_TOP, DECK_T, RAIL_H;
export let WALL_FULL, WALL_LOW, DOOR_W, DOOR_H, SUB_LOOK, PALETTE;
export let BRUSHES, BRUSH_KEYS, grid, ui;

export function __set_hoverIndex(v) { hoverIndex = v; return v; }

// Run once at startup (called from src/main.js, in order).
export function init() {
  // Elevation is applied to every material on the GPU; patch three's shader
  // chunks before anything compiles.
  installTerrain();         // top of a land tile (ground level ~ 0)
  BASE = m(4.5);          // tiles are columns reaching down this far
  WATER_Y = -m(2);        // water surface sits ~2 m below the street (bridge piers show)
  BED_H = -m(3.6);        // river/lake bed
  DECK_TOP = FLOOR_H + 0.03; // bridge decks sit just above street level
  DECK_T = m(0.5);        // deck thickness
  RAIL_H = m(1.1);        // railing height
  WALL_FULL = m(2.6);     // interior wall height
  WALL_LOW = m(0.8);          // wall thickness (thin enough to rise with a levelled building)
  DOOR_W = m(1.2);        // door opening, centred on its edge
  DOOR_H = m(2.1);        // door height (lintel above when walls are full height)

  // Per-subcategory surface colours (night) and tile heights. Street cells are
  // drawn by src/street.js on top of a tile just below street level.
  SUB_LOOK = {
    ground: { unlit: '#4a6158', lit: '#9fbf8f', area: '#3e6b5a' },
    street: { unlit: '#34383b', lit: '#8a9599', area: '#4a5058', h: FLOOR_H - 0.01 },
    start: { unlit: '#34383b', lit: '#8a9599', area: '#e0b030', h: FLOOR_H - 0.01 },
    path: { unlit: '#544537', lit: '#b5946f', area: '#8c6a45' },
    cemetery: { unlit: '#33463a', lit: '#86a487', area: '#5b7f5f' },
    cemeteryPath: { unlit: '#5a564c', lit: '#b3ab92', area: '#a39a80' },
    forestCemetery: { unlit: '#24312a', lit: '#6f8f74', area: '#3f5a44' },
    forest: { unlit: '#1e2c24', lit: '#5f8566', area: '#24503a' },
    brambles: { unlit: '#2e2926', lit: '#7a6a5c', area: '#6b4a5e' },
    hardwood: { unlit: '#7a5338', lit: '#f0a85a', area: '#9a6a3e' },
    carpet: { unlit: '#58303a', lit: '#c4727c', area: '#8a3f52' },
    church: { unlit: '#5a4a3c', lit: '#d9a46c', area: '#6c5a8c' }, // worn oak boards
    hospital: { unlit: '#4e5a56', lit: '#c9d6c4', area: '#5f9a94' }, // pale linoleum under fluorescents
    condemned: { unlit: '#3a3430', lit: '#8a7a68', area: '#6a4a3e' },
    clocktower: { unlit: '#46443f', lit: '#a39d8e', area: '#b08850' }, // cobbled plaza
    dock: { unlit: '#2a3a44', lit: '#6a8a94', area: '#6a5a44' },
    // Landmarks: the lot / yard under each ready-made building.
    ...Object.fromEntries(Object.entries(LANDMARK_SUBS).map(([sub, d]) => [sub, { unlit: d.ground, lit: mixHexEarly(d.ground, '#c8c0a8', 0.45), area: mixHexEarly(d.ground, '#d0a060', 0.5) }])),
  };

  // Night-time PNW palette. "Lit" outdoor reads as old mercury-vapor streetlight
  // (sickly green-white); lit indoor reads as warm incandescent.
  PALETTE = {
    outdoor: { unlit: '#4a6158', lit: '#9fbf8f' },
    indoor: { unlit: '#7a5338', lit: '#f0a85a' },
    bed: '#1b231f',
    deck: { unlit: '#3a3f44', lit: '#9aa0a4' }, // asphalt road deck
    rail: '#8a8e92',                             // galvanized pipe railing
    areaWater: '#24506a',
    areaDeck: '#b39a72',
    blockedShade: 0.88,
    glowOutdoor: '#c6e0c0',
    glowLamp: '#ffd38a',       // warm incandescent glow of an antique street lamp
    lightLamp: '#fff0c4',      // Light view: the lamp cell itself
    spillWarm: '#b89a62',      // surfaces near a lit lamp
    glowIndoor: '#ffbe73',
    // single-layer views
    areaOutdoor: '#34574c',
    areaIndoor: '#8a5a36',
    lightOff: '#2a3036',
    lightOn: '#f3cf7a',
    walkOk: '#4c5654',
    walkNo: '#a2392f',
  };
  BRUSHES = {
    bridge: (c) => (c.area === 'water' ? { bridge: true, walkable: true } : null),
    unbridge: (c) => (c.bridge ? { bridge: false, walkable: false } : null),
    unlit: { lit: false, radius: 0, lamp: false },
    // Light source with the radius set in the panel.
    lit: () => ({ lit: true, radius: ui.lightRadius }),
    // Switch on the street lamp: only where one stands (T-junctions, crossings).
    lamp: (c, i, g) => {
      const { x, y } = g.coords(i);
      return hasStreetLamp(g, x, y) ? { lamp: true, lit: true } : null;
    },
    walkable: { walkable: true },
    blocked: { walkable: false },
    reset: defaultCell(),
  };
  for (const area in AREAS) {
    for (const sub in AREAS[area].subs) BRUSHES[`${area}:${sub}`] = paintArea(area, sub);
  }
  // Start space: paints the van's cell (facing chosen automatically). Using the
  // brush on an existing start space turns the van to face the next way.
  BRUSHES['outdoor:start'] = (c, i, g) => {
    if (c.sub === 'start') {
      const { x, y } = g.coords(i);
      const cur = g.startFacing(i);
      for (let k = 1; k <= 4; k++) {
        const f = (cur + k) % 4;
        if (g.inBounds(x + FACINGS[f][0], y + FACINGS[f][1])) return { facing: f };
      }
      return null;
    }
    return { area: 'outdoor', sub: 'start', bridge: false, walkable: false, facing: null };
  };
  BRUSH_KEYS = {
    1: 'outdoor:ground', 2: 'indoor:hardwood', 3: 'unlit', 4: 'lit', 5: 'walkable', 6: 'blocked',
    7: 'water:lake', 8: 'water:river', 9: 'bridge', 0: 'reset', l: 'lamp', L: 'lamp',
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  grid = new GridState(COLS, ROWS);
  ui = {
    brush: 'indoor:hardwood',
    mode: 'title',       // 'title' | 'editor' | 'game' (src/app/gameShell.js)
    tool: 'cells',       // 'cells' | 'walls'
    edgeBrush: 'wall',   // 'wall' | 'door' | 'erase'
    lowWalls: false,  // full-height walls by default; Low walls in the view menu cuts them away
    lightRadius: 1,      // radius for the Light source brush (cells)
    markerBrush: 'investigation', // marker the Markers tool places ('erase' removes)
    showMarkers: true,
    shape: 'brush',      // 'brush' | 'rect'
    view: 'all',         // 'all' | 'area' | 'light' | 'walk'
    orbitMode: false,    // toggle: left-drag orbits
    spaceHeld: false,
    labels: true,
    atmosphere: true,
    ghost: false,        // small-home footprint follows the cursor
  };

  try {
    const saved = storage.plannerBoard.get();
    if (saved) grid.load(readMap(saved).data);
  } catch { /* storage unavailable or corrupt: start fresh */ }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Maps, saves and preferences (src/core/storage.js). The planner's board keeps
// its old key, so existing boards carry over.
export const storage = createStorage();

// Real-world scale lives in src/scale.js: one cell is a narrow two-lane street
// with small sidewalks (~7 m). Everything built in metres converts through m().

export const TILE = 1;               // world units per cell
export const INSET = 0.94;           // tile size inside its cell (gap = grid lines)
export const FLOOR_H = 0.06;      // cutaway wall height (default, keeps rooms visible)
export const WALL_T = 0.05;
export function mixHexEarly(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  const ch = (sh) => Math.round(((A >> sh) & 255) * (1 - t) + ((B >> sh) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

// A brush is a patch, or a function of the current cell returning a patch
// (or null to leave the cell alone).
// - Painting water makes land unwalkable; painting land over water makes it
//   walkable again and removes any bridge.
// - Bridges only go on water and are walkable.
// - Subcategories that start blocked (forest, brambles...) block the cell;
//   painting something ordinary over a default-blocked cell unblocks it.
//   Otherwise the cell keeps whatever walkability it had.
export const paintArea = (area, sub) => (c) => {
  if (area === 'water' && c.area === 'water') return { sub }; // keep bridge + walkability
  const patch = { area, sub, bridge: false };
  // A premade building's direction stays with the building, not the ground.
  if (c.sub !== sub && (c.facing !== null || c.flip)) { patch.facing = null; patch.flip = false; }
  if (!defaultWalkable(area, sub)) patch.walkable = false;
  else if (!defaultWalkable(c.area, c.sub) && !c.bridge) patch.walkable = true;
  return patch;
};

export let hoverIndex = -1; // cell under the pointer (-1 = none)

export const rand32 = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
