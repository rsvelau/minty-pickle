// "Ready to play?": checks a map for what the game needs before it can be
// played (or played well). Pure: works on a GridState, no graphics.
//
// Returns { ok, problems: [{ level: 'error'|'warning', code, text, cells: [index] }] }.
// `ok` is false only when there are errors: the game can't start. Warnings
// are things that make for a poor game (unreachable markers, too few spots).
import { MAX_SIZE, cellLabel } from './state.js';

export const EVIDENCE_CARDS = 4;     // 3 observations + the lair (src/game/mystery.js)

// Triangles the board itself may draw (everything on it, not the forest
// ring): the whole board in view must still hold 30 fps with 1.5x headroom on
// the reference phone (a 1.22M-triangle board measured 1.4x on a Pixel 10a).
// See docs/ASSET_BUDGET.md.
export const MAP_TRIANGLE_BUDGET = 1_100_000;

// `triangles`: what the board draws, when the caller has it rendered (the
// editor does); adds a warning over MAP_TRIANGLE_BUDGET.
export function checkMap(grid, { triangles = null } = {}) {
  const problems = [];
  const add = (level, code, text, cells = []) => problems.push({ level, code, text, cells });
  if (grid.cols > MAX_SIZE || grid.rows > MAX_SIZE) {
    add('warning', 'too-big', `This map is ${grid.cols} × ${grid.rows}; maps are meant to be at most ${MAX_SIZE} × ${MAX_SIZE}, so it may run slowly on phones. Shrink it under Board size.`);
  }
  if (triangles !== null && triangles > MAP_TRIANGLE_BUDGET) {
    const k = (n) => `${(n / 1e6).toFixed(2)}M`;
    add('warning', 'too-heavy', `The board draws ${k(triangles)} triangles, over the ${k(MAP_TRIANGLE_BUDGET)} budget: seen whole it may drop below 30 fps on phones. Use lighter tiles (blocked forest and ward bays are the heaviest) or a smaller board.`);
  }
  const label = (i) => { const { x, y } = grid.coords(i); return cellLabel(x, y); };
  const list = (cells) => cells.slice(0, 6).map(label).join(', ') + (cells.length > 6 ? ` and ${cells.length - 6} more` : '');

  // Where the investigators start: the cell in front of the van.
  const vans = [];
  grid.cells.forEach((c, i) => { if (c.sub === 'start') vans.push(i); });
  let start = -1;
  if (!vans.length) {
    add('error', 'no-start', 'There is no Start space (the van). Paint one on a street; players start in front of it.');
  } else {
    if (vans.length > 1) add('warning', 'many-starts', `There are ${vans.length} Start spaces; the game uses the first (${label(vans[0])}).`, vans);
    start = grid.startFront(vans[0]);
    if (start < 0) {
      add('error', 'start-off-board', `The van at ${label(vans[0])} faces off the board, so there is nowhere to start.`, [vans[0]]);
    } else if (!grid.cells[start].walkable) {
      add('error', 'start-blocked', `The van at ${label(vans[0])} faces a blocked cell (${label(start)}). Turn the van or clear that cell.`, [vans[0], start]);
      start = -1;
    }
  }

  // Markers.
  const byMarker = {};
  grid.cells.forEach((c, i) => { if (c.marker) (byMarker[c.marker] ??= []).push(i); });
  const blockedMarkers = Object.values(byMarker).flat().filter((i) => !grid.cells[i].walkable);
  if (blockedMarkers.length) add('warning', 'marker-blocked', `Markers on blocked cells are ignored in play: ${list(blockedMarkers)}.`, blockedMarkers);

  const spots = (byMarker.investigation ?? []).filter((i) => grid.cells[i].walkable);
  if (!spots.length) {
    add('error', 'no-investigation', `There are no Investigation spots. The mystery needs them to hide its evidence (${EVIDENCE_CARDS} or more is best).`);
  } else if (spots.length < EVIDENCE_CARDS) {
    add('warning', 'few-investigation', `Only ${spots.length} Investigation spot${spots.length === 1 ? '' : 's'}; the evidence deck has ${EVIDENCE_CARDS} cards, so some can never be found.`, spots);
  }

  const objectives = (byMarker.objective ?? []).filter((i) => grid.cells[i].walkable);
  // Which monsters the map's objective sites can host is checked by the
  // objective scripts (src/game/objectives/scripts.js objectiveProblems).
  if (!objectives.length) {
    add('warning', 'no-objectives', 'There are no Objective markers. They appear when the monster is revealed; most monsters need them.');
  }

  // Can every marker be reached from the start (doors, locks and keys included)?
  if (start >= 0) {
    const { x, y } = grid.coords(start);
    const field = grid.moveField(x, y, { keys: true });
    const reachable = (i) => field.dist[i] >= 0;
    const walkableMarkers = Object.values(byMarker).flat().filter((i) => grid.cells[i].walkable);
    const stranded = walkableMarkers.filter((i) => !reachable(i));
    if (stranded.length) add('warning', 'unreachable', `Players can't reach these markers from the start: ${list(stranded)}.`, stranded);
  }

  return { ok: !problems.some((p) => p.level === 'error'), problems };
}

// The building a cell belongs to (connected indoor cells), or the cell itself
// outdoors. Same grouping as the monster rules use for targets.
export function buildingOf(grid, cell) {
  if (grid.cells[cell].area !== 'indoor') return `cell${cell}`;
  const seen = new Set([cell]);
  const queue = [cell];
  for (let q = 0; q < queue.length; q++) {
    const { x, y } = grid.coords(queue[q]);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!grid.inBounds(x + dx, y + dy)) continue;
      const k = grid.index(x + dx, y + dy);
      if (!seen.has(k) && grid.cells[k].area === 'indoor') { seen.add(k); queue.push(k); }
    }
  }
  return `b${Math.min(...seen)}`;
}
