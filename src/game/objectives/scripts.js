// Monster objective scripts: what each fight asks of the investigators, as
// steps over sites (src/core/sites.js). Data only; the verbs are played by
// src/game/objectives/verbs.js (coming next), one handler each, shared.
//
//   needs     the sites a map must have (by id; 'lair' and 'start' are on
//             every map). Missing one, the monster is disabled on that map.
//   anyCount  needs this many Objective markers of any kind (Poltergeist).
//   pending   the card's numbered sites aren't all named yet: no check, and
//             every Objective marker shows, as before.
//   steps     { do, at, fixture?, item?, who?, text } in order. `do` is the
//             verb: collect, deliver, cleanse, escape, defend, destroy,
//             perform. `text` is what the Casebook shows.
// Monsters whose objective is plain Kill have no script.
import { MONSTER_BY_ID } from '../cards/monsters.js';
import { SITES, siteOf, siteLabel } from '../../core/sites.js';

export const OBJECTIVES = {
  barghest: {
    needs: ['church'],
    steps: [
      { do: 'cleanse', at: 'church', fixture: 'holy-water-basin', who: 'each', text: 'Each investigator cleanses at the Church’s Holy Water Basin (the uncleansed can’t cross the river)' },
      { do: 'escape', at: 'start', requires: 'cleanse', text: 'Escape at the Start space: one escape wins for the team, and play goes on until everyone has escaped or died' },
    ],
  },
  hellhounds: {
    needs: ['church'],
    steps: [
      { do: 'collect', at: 'church', fixture: 'holy-water-basin', item: 'holy-water', text: 'Collect holy water at the Church’s Holy Water Basin' },
      { do: 'deliver', at: 'lair', item: 'holy-water', text: 'Bring it to the Lair to cleanse the ritual' },
    ],
  },
  'shadow-people': {
    needs: ['church'],
    steps: [
      { do: 'collect', at: 'church', fixture: 'votive-candle-stand', item: 'candle', text: 'Take a candle from the Church’s Votive Candle Stand' },
      { do: 'deliver', at: 'lair', item: 'candle', times: 4, text: 'Carry it, still lit, to the Lair (4 candles light the Dark Room)' },
    ],
  },
  poltergeist: {
    anyCount: 4,
    steps: [
      { do: 'destroy', at: 'any', count: 4, req: '6', text: 'Destroy 4 spiritual anchors at Objective markers: slot a 6 at each' },
      { do: 'destroy', at: 'lair', req: '6', text: 'Destroy the anchor at the Lair' },
    ],
  },
  adze: {
    needs: ['hotel', 'bar', 'hospital'],
    steps: [
      { do: 'defend', at: 'hotel', fixture: 'bed', text: 'Defend the victim at the Hotel' },
      { do: 'defend', at: 'bar', fixture: 'bed', text: 'Defend the victim at the Bar' },
      { do: 'defend', at: 'hospital', fixture: 'bed', text: 'Defend the victim at the Hospital' },
      { do: 'kill', at: 'lair', text: 'Destroy the nest at the Lair' },
    ],
  },
  strigoi: {
    needs: ['hospital', 'church'],
    steps: [
      { do: 'perform', at: 'lair', text: 'The Lair' },
      { do: 'perform', at: 'hospital', text: 'Then the Hospital' },
      { do: 'perform', at: 'church', text: 'Then the Church' },
      { do: 'kill', at: 'lair', text: 'Back at the Lair: kill the Strigoi with the Blessed Cosor' },
    ],
  },
  // Perform Ceremony ({3}, {7}, Lair → {9} + 3 ⌛): sites {3} and {7} still to be named.
  'white-lady': { pending: true, needs: ['church'], steps: [{ do: 'perform', at: 'church', text: 'Perform the Ceremony ({3}, {7}, the Lair, then the Church for 3 ⌛): played at the table for now' }] },
};

export const scriptOf = (id) => OBJECTIVES[id] ?? null;

// The sites (cell indices) of a map, by site id; `all` = every Objective marker.
export function mapSites(grid) {
  const out = { all: [] };
  grid.cells.forEach((c, i) => {
    if (c.marker !== 'objective' || !c.walkable) return;
    out.all.push(i);
    const s = siteOf(c);
    if (s) (out[s] ??= []).push(i);
  });
  return out;
}

// What the map lacks for a monster's objective: [] when it can be played.
export function missingFor(id, sites) {
  const sc = scriptOf(id);
  if (!sc) return [];
  const miss = (sc.needs ?? []).filter((s) => SITES[s] && !sites[s]?.length).map(siteLabel);
  if (sc.anyCount && sites.all.length < sc.anyCount) miss.push(`${sc.anyCount} Objective markers (has ${sites.all.length})`);
  return miss;
}

// Every monster on this map: { available: [id], disabled: [{ id, name, missing }] }.
export function monsterAvailability(grid, ids = Object.keys(MONSTER_BY_ID)) {
  const sites = mapSites(grid);
  const available = [], disabled = [];
  for (const id of ids) {
    const missing = missingFor(id, sites);
    if (missing.length) disabled.push({ id, name: MONSTER_BY_ID[id]?.name ?? id, missing });
    else available.push(id);
  }
  return { available, disabled };
}

// Map check additions (the editor's "Ready to play?"): one warning naming the
// monsters this map can't host, and why.
export function objectiveProblems(grid) {
  const { disabled } = monsterAvailability(grid);
  if (!disabled.length) return [];
  return [{
    level: 'warning', code: 'monsters-disabled', cells: [],
    text: `Disabled on this map (their objectives need sites it doesn't have): ${disabled.map((d) => `${d.name} (needs ${d.missing.join(', ')})`).join('; ')}. Give Objective markers a site under Markers → Objective.`,
  }];
}

// The monster the players know: revealed, or named correctly early (initiative).
export const knownMonster = (state) => state.mystery?.monster ?? (state.mystery?.initiative ? state.mystery.guess?.id : null) ?? null;

// Is the Objective marker in `cell` in play? Once the monster is known: only
// its own sites. Without a mystery (no monster, or one placed by hand): all.
export function objectiveLive(state, grid, cell) {
  if (!state.mystery) return true;
  const id = knownMonster(state);
  return !!id && objectiveCells(grid, id).includes(cell);
}

// The Objective markers a revealed monster uses (cells): its sites, or every
// marker for 'any' steps and pending scripts; [] for a plain Kill.
export function objectiveCells(grid, id) {
  const sc = scriptOf(id);
  if (!sc) return [];
  const sites = mapSites(grid);
  if (sc.pending || sc.steps.some((st) => st.at === 'any')) return sites.all;
  return [...new Set(sc.steps.flatMap((st) => sites[st.at] ?? []))];
}
