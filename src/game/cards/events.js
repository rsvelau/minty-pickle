// Event cards and Mindsets, transcribed from midnight_shift_cards.pdf (pages 1-5).
//
// The category is the word printed sideways on the card's left edge. Text is
// as printed, reworded where the designer clarified it (rules walkthrough,
// round 1). Icons (see KEYWORDS in cards/keywords.js):
//   ⏳ one turn on the clock   🪙 a coin flip   ◉ an Obol (any colour)   ❓ an Investigation space
//   🎲 a die   💥 [P]/[M]/[S] damage of that type (defended as usual)   R[n] radius in spaces
//
// Categories behave differently:
// - Global: affects the whole map and every player until another Global
//   replaces it (only one at a time), or for as long as its text says.
// - Cursed Object: the drawing player reads it, then chooses to use it or not.
// - Hazard: lasting change to a space. Hazards laid by players (traps) only
//   affect monsters; discovered Hazards affect players and monsters.
// ⏳ effects (moving the clock forward or back) do nothing from midnight on:
// the clock stops at midnight.
//
// `lasting` marks cards whose effect stays after they resolve. Playing the
// effects comes later; for now a drawn card is shown and logged, and a drawn
// Global becomes the one in effect.
export const EVENT_CATEGORIES = {
  event: { label: 'Event', note: 'Happens at once' },
  decision: { label: 'Decision', note: 'Choose one' },
  cursedObject: { label: 'Cursed Object', note: 'A choice with a price' },
  hazard: { label: 'Hazard', note: 'Changes the map' },
  opportunity: { label: 'Opportunity', note: 'Can be used' },
  global: { label: 'Global', note: 'Affects everyone' },
};

const E = (id, name, category, text, extra = {}) => ({ id, name, category, text, ...extra });

export const EVENT_CARDS = [
  // Page 1
  E('roof-collapse', 'Roof Collapse', 'decision', 'The nearest door becomes blocked. Take 💥 [P] to move to the opposite side this turn.'),
  E('police-patrol', 'Police Patrol', 'event', 'Advance ⏳. If any survivors have Died, advance ⏳⏳.'),
  E('enigmatic-hourglass', 'Enigmatic Hourglass', 'cursedObject', 'Flip 🪙. If heads, turn the clock back ⏳. If tails, lose an Obol at random.'),
  E('spirit-board', 'Spirit Board', 'cursedObject', 'Reveal an Evidence card and take 💥 [S].'),
  E('fall-through', 'Fall Through', 'event', 'Exhaust a defense 🎲 and investigate twice.'),
  E('bumped-shelf', 'Bumped Shelf', 'decision', 'Choose: Hide (Advance ⏳) / Try to leave (Flip a 🪙, if tails, you are attacked).'),
  E('ominous-vhs', 'Ominous VHS', 'cursedObject', 'Can expose what 3 ❓ on the map hold (players still go there to draw them), and take 💥 [M] for each Attack exposed.'),
  E('tarot-cards', 'Tarot Cards', 'cursedObject', 'Can experience 3 Event cards (collecting their Obols), then choose an Evidence card to reveal.'),
  E('injured-survivor', 'Injured Survivor', 'decision', 'Choose: Live (Pay 3 ◉ Obols to expose 2 ❓). Die (Do nothing).'),
  // Page 2
  E('haunted-portrait', 'Haunted Portrait', 'cursedObject', 'Can reset all of your injury tiers to 0. If you do, it is shuffled back into the Event deck; whoever draws it again dies instantly.'),
  E('nailed-shut', 'Nailed Shut', 'event', 'All doors in the building are now blocked.', { lasting: true }),
  E('flooded-out', 'Flooded Out', 'hazard', 'Movement cost doubled within R[1].', { lasting: true }),
  E('flickering-lights', 'Flickering Lights', 'hazard', '💥 [P] ignores lowest defense 🎲 within R[4].', { lasting: true }),
  E('message-cypher', 'Message Cypher', 'opportunity', 'Can advance ⏳⏳ to reveal one evidence card.'),
  E('wooden-boards', 'Wooden Boards', 'opportunity', 'Can spend ⏳ to investigate this space again and every other space in this building this turn, ignoring Attacks (their Obols are still collected).'),
  E('hidden-passage', 'Hidden Passage', 'event', 'A hole opens in the floor here, and another at a chosen spot on the map. For the rest of the game, travelling through costs 5 movement (not possible with less).', { lasting: true }),
  E('bright-moon', 'Bright Moon', 'global', 'Mental and Physical damage rolls −1 (easier to defend). If the monster is identified as a Beast, Physical damage rolls +2 instead.', { lasting: true }),
  E('strong-winds', 'Strong Winds', 'global', 'Flip 🪙 every turn. If outside: HEADS (2X a movement roll) TAILS (Exhaust lowest movement roll).', { lasting: true }),
  // Page 3
  E('distant-gunshots', 'Distant Gunshots', 'event', 'For the rest of this turn, the team negates Attack cards.'),
  E('power-outage', 'Power Outage', 'global', 'All lights on the map go out at once, the clocktower light included. Vehicle lights stay on (they have their own power).', { lasting: true }),
  E('distant-screams', 'Distant Screams', 'event', 'All players take 💥 [M] rolled with −2, and attacks are avoided for the rest of the turn.'),
  E('sinkhole', 'Sinkhole', 'hazard', 'This space costs 5 movement to cross for the rest of the game.', { lasting: true }),
  E('huddled-survivors', 'Huddled Survivors', 'decision', 'Choose: Live (Can discard 1 Weapon and 1 white 🎲 to investigate twice). Die (Do nothing).'),
  E('insane-survivor', 'Insane Survivor', 'decision', 'Choose: Live (Take 💥 [P] and reveal an evidence card). Die (Do nothing).'),
  E('overgrown-brambles', 'Overgrown Brambles', 'hazard', 'Crossing this space costs ⏳. Can be destroyed with 🔥 or specific weapons.', { lasting: true }),
  E('coil-of-razor-wire', 'Coil of Razor Wire', 'hazard', 'Create a hazard space which only affects corporeal monsters. Crossing it costs them 5 movement this turn and 🎲 damage. 1️⃣', { lasting: true }),
  E('rusty-bear-trap', 'Rusty Bear Trap', 'hazard', 'Create a hazard space which immobilizes corporeal monsters for ⏳ and Fae for ⏳⏳. 1️⃣', { lasting: true }),
  // Page 4
  E('summoning-circle', 'Summoning Circle', 'hazard', 'Create a hazard space which summons revealed Demonic monsters next turn and binds them for ⏳⏳. 1️⃣', { lasting: true }),
  E('deadfall-trap', 'Deadfall Trap', 'hazard', 'Create a hazard space which does 🎲 damage to corporeal monsters and interrupts them. 1️⃣', { lasting: true }),
  E('bonfire', 'Bonfire', 'hazard', 'Create a hazard which does 🎲 🔥 to any monster crossing this space.', { lasting: true }),
  E('lockdown', 'Lockdown', 'event', 'All doors on the map are locked until the end of next turn. Finding a key unlocks all doors on the map permanently.'),
  E('chalk-scrawled-narrative', 'Chalk-Scrawled Narrative', 'cursedObject', 'Can reveal all evidence cards but advance to turn 12.'),
  E('lightning-storm', 'Lightning Storm', 'global', 'If you end your turn outside, flip a coin. On tails, take 💥 [P].', { lasting: true }),
  E('decrepit-truck', 'Decrepit Truck', 'opportunity', 'Appears on nearest road space. Activate to move 25 spaces (on roads). If a monster is struck, it takes 🎲🎲🎲 and halts your movement. 1️⃣', { lasting: true }),
  E('consecrated-ash', 'Consecrated Ash', 'hazard', 'Incorporeal and semi-corporeal monsters are stunned for ⏳ when crossing this space. Players reduce spiritual injuries by 1 tier when crossing this space. 1️⃣', { lasting: true }),
  E('hiding-spot', 'Hiding Spot', 'opportunity', 'Can remain immobile and become immune from all interactions for up to ⏳⏳. Cannot assist teammates.'),
  // Page 5
  E('peculiar-mirror', 'Peculiar Mirror', 'cursedObject', 'A blue-glowing mirror appears. Link two spots: travelling between them costs no movement (other effects may still apply). Flip 🪙: if tails, lose it.', { lasting: true }),
];

// Mindsets (page 5): a lasting trait for an investigator.
export const MINDSET_CARDS = [
  { id: 'reckless', name: 'Reckless', text: 'Double your attacking damage. Cannot pre-slot defensive 🎲.' },
  { id: 'rushed', name: 'Rushed', text: 'Double your movement. Defensive 🎲 are rounded down to 3.' },
  { id: 'meticulous', name: 'Meticulous', text: 'Able to investigate ❓ spaces twice. Movement 🎲 are rounded down to 4.' },
  { id: 'protective', name: 'Protective', text: 'Your defensive 🎲 can be used on close range allies.' },
  { id: 'curious', name: 'Curious', text: 'Can continue investigating after resolving any event at the cost of a defensive 🎲.' },
  { id: 'mighty', name: 'Mighty', text: 'Double your attacking damage. Weapons 🔗 after a single use.' },
];

export const EVENT_BY_ID = Object.fromEntries(EVENT_CARDS.map((c) => [c.id, c]));
export const MINDSET_BY_ID = Object.fromEntries(MINDSET_CARDS.map((c) => [c.id, c]));
