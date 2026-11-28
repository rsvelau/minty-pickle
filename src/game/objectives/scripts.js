// Monster objective scripts: what each fight asks of the investigators, as
// steps over sites (src/core/sites.js). Data only; the verbs are played by
// src/game/objectives/verbs.js (coming next), one handler each, shared.
//
//   needs     the sites a map must have (by id; 'lair' and 'start' are on
//             every map). Missing one, the monster is disabled on that map.
//   anyCount  needs this many Objective markers of any kind (Poltergeist).
//   pending   the card's numbered sites aren't all named yet: no check, and
//             every Objective marker shows, as before.
//   played    the game plays every step and decides the win (verbs.js);
//             otherwise the Casebook's "Objective achieved" is still used.
//   steps     { do, at, fixture?, item?, who?, text } in order. `do` is the
//             verb: collect, deliver, cleanse, escape, defend, destroy,
//             perform. `text` is what the Casebook shows.
// Monsters whose objective is plain Kill have no script.
import { MONSTER_BY_ID } from '../cards/monsters.js';
import { SITES, siteOf, siteLabel } from '../../core/sites.js';

export const OBJECTIVES = {
  barghest: {
    needs: ['church'],
    played: true,
    steps: [
      { do: 'cleanse', at: 'church', fixture: 'holy-water-basin', who: 'each', text: 'Each investigator cleanses at the Church’s Holy Water Basin (the uncleansed can’t cross the river)' },
      { do: 'escape', at: 'start', requires: 'cleanse', opens: 'midnight', text: 'Escape at the Start space (the way out opens 3 rounds after midnight): one escape wins for the team, and play goes on until everyone has escaped or died' },
    ],
  },
  hellhounds: {
    needs: ['church'],
    played: true,
    steps: [
      { do: 'collect', at: 'church', fixture: 'holy-water-basin', item: 'holy-water', text: 'Collect holy water at the Church’s Holy Water Basin' },
      { do: 'deliver', at: 'lair', item: 'holy-water', text: 'Bring it to the Lair: the ritual is disrupted and the pack stops coming back' },
      { do: 'kill', at: 'lair', text: 'Then destroy the pack (until then, a destroyed pack rises again at the Lair)' },
    ],
  },
  'shadow-people': {
    needs: ['church'],
    played: true,
    steps: [
      { do: 'collect', at: 'church', fixture: 'votive-candle-stand', item: 'candle', text: 'Take a lit candle from the Church’s Votive Candle Stand (each investigator can carry one)' },
      { do: 'deliver', at: 'lair', item: 'candle', times: 4, perPlayer: true, text: 'Carry it, still lit, to the Lair: one candle per investigator lights the Dark Room' },
    ],
  },
  poltergeist: {
    anyCount: 4,
    played: true,
    steps: [
      { do: 'destroy', at: 'any', count: 4, text: 'Stop on Objective markers and spend a 6 to destroy the spiritual anchor there: 4 of them' },
      { do: 'destroy', at: 'lair', after: 4, text: 'Then destroy the last anchor at the Lair (another 6): it’s gone' },
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
    needs: ['outdoor', 'church'],
    played: true,
    steps: [
      { do: 'collect', at: 'lair', item: 'cosor', unique: true, text: 'Find the Cosor (a Romanian knife) at the Lair: the Strigoi’s Drain and Unholy Burn reach whoever holds it, anywhere' },
      { do: 'upgrade', at: 'outdoor', item: 'cosor', set: 'sharp', text: 'Sharpen it at the Outdoor Store {12}' },
      { do: 'upgrade', at: 'church', item: 'cosor', set: 'blessed', requires: 'sharp', completes: true, text: 'Bless it at the Church {9}' },
      { do: 'kill', at: 'lair', text: 'Strike the Strigoi with the Blessed Cosor (Close range, once a turn: one of your rolled dice as damage, ignoring its toughness) until it falls' },
    ],
  },
  // Banshee: the heirloom only steers where she perches; killing her wins.
  banshee: {
    steps: [
      { do: 'collect', at: 'funeral', item: 'heirloom', unique: true, text: 'The heirloom, a signed ring, lies at the Funeral Parlor {11}. She perches on the rooftop nearest whoever is closest to it. Carry it, or set it down, to draw her where you want her' },
      { do: 'deliver', at: 'grave', item: 'heirloom', banish: true, text: 'Side objective: from 3 rounds after she rises, bring the heirloom to the Unmarked Grave in the cemetery and she is defeated at once' },
      { do: 'kill', at: 'lair', text: 'Or kill her: wear her health down to 0' },
    ],
  },
  'white-lady': {
    needs: ['boutique', 'curio', 'funeral', 'church'],
    played: true,
    steps: [
      { do: 'collect', at: 'boutique', item: 'gown', unique: true, text: 'Pick up the Decayed Wedding Gown at the Boutique {3}' },
      { do: 'collect', at: 'curio', item: 'ring', unique: true, text: 'Pick up the Tarnished Wedding Ring at the Curio Shop {7}' },
      { do: 'collect', at: 'funeral', item: 'finger-bone', unique: true, text: 'Pick up the Desiccated Finger Bone at the Funeral Parlor {11}' },
      { do: 'deliver', at: 'church', item: 'gown', completes: false, text: 'Bring the gown to the Church {9}' },
      { do: 'deliver', at: 'church', item: 'ring', completes: false, text: 'Bring the ring to the Church' },
      { do: 'deliver', at: 'church', item: 'finger-bone', completes: false, text: 'Bring the finger bone to the Church' },
      { do: 'hold', at: 'church', rounds: 3, after: ['gown', 'ring', 'finger-bone'], text: 'With all three there, keep someone inside the Church for 3 ⏳ while she rages: her soul is set free' },
    ],
  },
};

export const scriptOf = (id) => OBJECTIVES[id] ?? null;

// The sites (cell indices) of a map, by site id; `all` = every Objective marker.
export function mapSites(grid) {
  const out = { all: [] };
  grid.cells.forEach((c, i) => {
    if (c.marker !== 'objective' || !c.walkable) return;
    out.all.push(i);
    const s = siteOf(c, grid, i);
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
// (All five pieces of evidence found identify it too: mystery.js.)
export function knownMonster(state) {
  const m = state.mystery;
  if (!m || !(m.revealed || m.identified || m.initiative)) return null;
  return m.monster ?? m.guess?.id ?? null;
}

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
