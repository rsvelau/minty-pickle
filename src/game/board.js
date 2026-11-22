import { GridState } from '../core/state.js';

// The board as the rules see it: a GridState plus derived data (light
// levels, key groups) computed on demand and cached until the board changes.
//
// GridState is plain data with no browser or three.js parts, so the same
// adapter works on a server: rebuild the grid from the saved board JSON
// (GridState.parse / fromJSON) and wrap it here.
export function createBoard(grid) {
  let light = null;
  let keyGroups = null;
  return {
    grid,
    // Light level per cell (0..1).
    get light() { return (light ??= grid.lightLevels()); },
    keyGroups() { return (keyGroups ??= grid.keyGroups()); },
    // Players start on the cell in front of the van (-1: no Start space).
    startCell() {
      const s = grid.cells.findIndex((c) => c.sub === 'start');
      return s < 0 ? -1 : grid.startFront(s);
    },
    // Call after the board is edited.
    invalidate() { light = null; keyGroups = null; },
  };
}

// A board from saved board JSON (grid.toJSON()), e.g. on a server.
export function boardFromJSON(json) {
  const grid = new GridState();
  grid.load(grid.parse(typeof json === 'string' ? JSON.parse(json) : json));
  return createBoard(grid);
}
