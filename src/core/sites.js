// Objective sites: what an Objective marker stands for on the map. The map
// author picks one per marker (Markers → Objective → Site); monster objective
// scripts (src/game/objectives/scripts.js) ask for sites by id, never for
// cells, so any map that has a Church can host every monster that needs one.
//
//   label     shown in the editor, the hover card and the Casebook
//   number    the {n} it had on the original board ({9} = the Church): the
//             monster cards still print these
//   fixtures  what is always there, by id (FIXTURES): a site type keeps the
//             same fixtures on every map. The objective art may be general
//             (one tile holding several things, an antique chest that could
//             hold anything); the fixtures say what the rules use.
//   floors    indoor floors that make a marker this site when the author
//             hasn't picked one (a marker on a Church floor is the Church)
//
import { BUILDING_TYPES, typeAt } from './buildings.js';

// The Lair (where the monster rises) and the Start space (the van) are sites
// on every map without a marker: see IMPLICIT_SITES.
export const SITES = {
  hotel: { label: 'Hotel', number: 1, fixtures: ['bed'] },
  bar: { label: 'Bar', number: 5, fixtures: ['bed'] },
  church: { label: 'Church', number: 9, fixtures: ['votive-candle-stand', 'holy-water-basin'], floors: ['church'] },
  hospital: { label: 'Hospital', number: 13, fixtures: ['bed'], floors: ['hospital'] },
  boutique: { label: 'Boutique', number: 3, fixtures: ['wedding-gown'] },
  curio: { label: 'Curio Shop', number: 7, fixtures: ['antique-chest'] },
  funeral: { label: 'Funeral Parlor', number: 11, fixtures: ['finger-bone', 'heirloom'] },
  outdoor: { label: 'Outdoor Store', number: 12, fixtures: ['whetstone'] },
};

// Fixtures: the things at a site the objectives use.
export const FIXTURES = {
  'votive-candle-stand': { label: 'Votive Candle Stand', note: 'Candles to carry (Shadow People)' },
  'holy-water-basin': { label: 'Holy Water Basin', note: 'Holy water to carry or cleanse with (Hellhounds, Barghest)' },
  bed: { label: 'A townsperson lies here', note: 'An unconscious victim to defend (Adze)' },
  'antique-chest': { label: 'Antique chest', note: 'Could hold anything: the Tarnished Wedding Ring (White Lady)' },
  'wedding-gown': { label: 'Decayed Wedding Gown', note: 'For the White Lady’s wedding ritual' },
  'finger-bone': { label: 'Desiccated Finger Bone', note: 'For the White Lady’s wedding ritual' },
  whetstone: { label: 'Whetstone', note: 'Sharpens the Cosor (Strigoi)' },
  heirloom: { label: 'Heirloom', note: 'A signed ring: the Banshee perches nearest whoever is closest to it' },
};

export const IMPLICIT_SITES = {
  lair: { label: 'the Lair' },
  start: { label: 'the Start space' },
};

export const siteLabel = (id) => SITES[id]?.label ?? IMPLICIT_SITES[id]?.label ?? 'Objective';
export const siteByNumber = (n) => Object.keys(SITES).find((id) => SITES[id].number === n) ?? null;

// The site a cell's Objective marker stands for: the author's pick, else its
// building's (a marker in the Hotel is the Hotel: src/core/buildings.js),
// else null (an untyped objective: it still counts where a monster wants
// "any objective", like the Poltergeist's anchors). `grid` and `i` let it
// see the building; without them, an old Church / Hospital floor still counts.
export function siteOf(cell, grid = null, i = -1) {
  if (cell?.marker !== 'objective') return null;
  if (SITES[cell.site]) return cell.site;
  const type = grid && i >= 0 ? typeAt(grid, i) : cell.use ?? null;
  if (type && SITES[BUILDING_TYPES[type]?.site]) return BUILDING_TYPES[type].site;
  return Object.keys(SITES).find((id) => SITES[id].floors?.includes(cell.sub)) ?? null;
}
