// Decks: which cards are in a game, shuffled with the game's seeded dice.
//
// Game settings choose the cards (Settings → Cards in the game). The config
// holds only changes from the default of one copy each:
//   config.deckCounts = { 'equipment:crowbar': 0, 'events:sinkhole': 2, 'monsters:wendigo': 0, ... }
// Monsters set to 0 leave the random mystery pool (a specific monster chosen
// in New game is still played).
//
// In the game state:
//   state.decks = { equipment: [ids, top last], events: [...], eventDiscard: [...] }
// Drawing takes from the top; a card drawn is out of the deck (one copy = once
// per game), except where a card says it goes back (Haunted Portrait, later).
import { EQUIPMENT_CARDS, EQUIPMENT_BY_ID } from './cards/equipment.js';
import { EVENT_CARDS, EVENT_BY_ID, MINDSET_CARDS } from './cards/events.js';
import { MONSTER_CARDS } from './cards/monsters.js';

export const DECKS = {
  equipment: { label: 'Equipment', cards: EQUIPMENT_CARDS },
  events: { label: 'Events', cards: EVENT_CARDS },
  mindsets: { label: 'Mindsets', cards: MINDSET_CARDS },
  monsters: { label: 'Monsters', cards: MONSTER_CARDS, maxCopies: 1 },
};
export const MAX_COPIES = 3;

// How many copies of a card the config puts in the game.
export function copiesOf(config, deck, id) {
  const n = config?.deckCounts?.[`${deck}:${id}`];
  const max = DECKS[deck]?.maxCopies ?? MAX_COPIES;
  return Number.isInteger(n) ? Math.max(0, Math.min(max, n)) : 1;
}
// Card ids in a deck, one entry per copy (unshuffled).
export function deckList(config, deck) {
  return DECKS[deck].cards.flatMap((c) => Array(copiesOf(config, deck, c.id)).fill(c.id));
}

function shuffle(list, randInt, state) {
  for (let i = list.length - 1; i > 0; i--) { const j = randInt(state, i + 1); [list[i], list[j]] = [list[j], list[i]]; }
  return list;
}

// Build and shuffle the decks for a new game. `owned` equipment (from an older
// save) stays out of the deck.
export function setupDecks(state, randInt, owned = []) {
  const equipment = deckList(state.config, 'equipment');
  for (const id of owned) { const k = equipment.indexOf(id); if (k >= 0) equipment.splice(k, 1); }
  state.decks = {
    equipment: shuffle(equipment, randInt, state),
    events: shuffle(deckList(state.config, 'events'), randInt, state),
    eventDiscard: [],
  };
}

// Draw the top card; null when the deck is empty.
export function drawCard(state, deck) {
  const id = state.decks?.[deck]?.pop();
  if (!id) return null;
  if (deck === 'events') state.decks.eventDiscard.push(id);
  return id;
}

// Give the current player an Equipment card from the deck. Returns the card or null.
export function drawEquipment(state, pl, from) {
  const id = drawCard(state, 'equipment');
  if (!id) return null;
  const card = EQUIPMENT_BY_ID[id];
  pl.inventory.equipment.push({ id, label: card.name, from });
  return card;
}

export const eventCard = (id) => EVENT_BY_ID[id] ?? null;
