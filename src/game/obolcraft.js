// Obolcraft: trade Obols for effects (recipes from the Player Mat).
//
// Obol colours share the damage-type theme: Attack = red (Physical), Event =
// blue (Mental), Equipment = green (Spiritual), plus yellow Evidence. A black
// slot in a recipe takes an Obol of any colour.
//
// Crafting is an action on your own turn (before or after rolling):
//   { type: 'craft', recipe, pay: [indices into your Obolcraft], target? }
// `pay` must fill the recipe exactly; autoPay() suggests a payment that keeps
// your rarer colours.
import { INJURY_TRACKS } from './cards/injuries.js';
import { EQUIPMENT_NAMES } from './cards/equipment.js';

export const ANY = 'any';
export const RECIPES = [
  { id: 'heal-P', cost: ['attack', ANY], text: 'Reduce Physical injury tier by 1', heal: 'P' },
  { id: 'heal-M', cost: ['event', ANY], text: 'Reduce Mental injury tier by 1', heal: 'M' },
  { id: 'heal-S', cost: ['equipment', ANY], text: 'Reduce Spiritual injury tier by 1', heal: 'S' },
  { id: 'resonant', cost: ['evidence', ANY], text: 'Use a Resonant die without losing it', resonant: true },
  { id: 'equipment', cost: [ANY, ANY, ANY], text: 'Draw an Equipment card', draw: true },
  { id: 'resurrect', cost: ['attack', 'event', 'equipment', 'evidence', ANY, ANY, ANY], text: 'Resurrect a player at your location', resurrect: true },
];
export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// Does `pay` (Obol indices) fill the recipe's cost exactly?
export function payFits(recipe, obols, pay) {
  if (new Set(pay).size !== pay.length || pay.length !== recipe.cost.length) return false;
  const types = pay.map((i) => obols[i]?.type);
  if (types.some((t) => !t)) return false;
  const need = recipe.cost.filter((c) => c !== ANY);
  const left = [...types];
  for (const t of need) {
    const k = left.indexOf(t);
    if (k < 0) return false;
    left.splice(k, 1);
  }
  return true; // the rest fill the black (any-colour) slots
}

// A suggested payment: the named colours first, then the black slots from
// whatever you have most of. Returns indices, or null if you can't afford it.
export function autoPay(recipe, obols) {
  const free = obols.map((o, i) => ({ type: o.type, i }));
  const pay = [];
  for (const c of recipe.cost.filter((x) => x !== ANY)) {
    const k = free.findIndex((o) => o.type === c);
    if (k < 0) return null;
    pay.push(free.splice(k, 1)[0].i);
  }
  for (let n = recipe.cost.filter((x) => x === ANY).length; n > 0; n--) {
    if (!free.length) return null;
    const counts = {};
    for (const o of free) counts[o.type] = (counts[o.type] ?? 0) + 1;
    const most = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const k = free.findIndex((o) => o.type === most);
    pay.push(free.splice(k, 1)[0].i);
  }
  return pay;
}

// Why the recipe can't be used right now (null if it can).
export function blocked(state, pl, recipe) {
  if (recipe.heal && !(pl.injuries?.[recipe.heal] > 0)) return `No ${INJURY_TRACKS[recipe.heal].label} injury to heal`;
  if (recipe.resurrect && !state.players.some((p) => p.dead)) return 'No one has died';
  if (!autoPay(recipe, pl.inventory.obolcraft)) return 'Not enough Obols';
  return null;
}

// Apply a craft. Returns an error string, or null on success.
export function craft(state, pl, action, ctx, events) {
  const recipe = RECIPE_BY_ID[action.recipe];
  if (!recipe) return 'no such recipe';
  const why = blocked(state, pl, recipe);
  if (why) return why.toLowerCase();
  const obols = pl.inventory.obolcraft;
  const pay = action.pay ?? autoPay(recipe, obols);
  if (!payFits(recipe, obols, pay)) return "those Obols don't fit the recipe";
  let target = null;
  if (recipe.resurrect) {
    target = state.players.find((p) => p.dead && (action.target === undefined || p.seat === action.target));
    if (!target) return 'choose who to bring back';
  }
  const spent = pay.map((i) => obols[i].type);
  pl.inventory.obolcraft = obols.filter((_, i) => !pay.includes(i));
  let msg = '';
  if (recipe.heal) {
    pl.injuries[recipe.heal]--;
    const now = pl.injuries[recipe.heal];
    msg = `${pl.name}'s ${INJURY_TRACKS[recipe.heal].label} injury eases to ${now ? INJURY_TRACKS[recipe.heal].tiers[now - 1].name : 'unhurt'}`;
  } else if (recipe.resonant) {
    pl.resonance = (pl.resonance ?? 0) + 1;
    msg = `${pl.name}'s next white die will return to their reserve after use`;
  } else if (recipe.draw) {
    const name = EQUIPMENT_NAMES[ctx.randInt(state, EQUIPMENT_NAMES.length)];
    pl.inventory.equipment.push({ label: name, from: 'Obolcraft' });
    msg = `${pl.name} draws an Equipment card: ${name}`;
  } else if (recipe.resurrect) {
    target.dead = false;
    target.injuries = { P: 0, M: 0, S: 0 };
    target.defense = [];
    target.pos = pl.pos;
    target.prev = -1;
    msg = `${target.name} is brought back from the dead, beside ${pl.name}`;
  }
  ctx.log(state, `Obolcraft: ${msg} (spent ${spent.join(', ')}).`);
  events.push({ type: 'crafted', seat: pl.seat, recipe: recipe.id, spent, target: target?.seat ?? null, text: msg });
  return null;
}
