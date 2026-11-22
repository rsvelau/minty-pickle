// Event cards and Mindsets, transcribed from midnight_shift_cards.pdf (pages 1-5).
//
// The category is the word printed sideways on the card's left edge. Text is
// word for word, with the card's icons kept:
//   ⏳ the clock (a turn)   🪙 a coin   ❓ an Investigation space   🎲 a die
//   💥 [P]/[M]/[S] an attack of that type   🔥 fire   1️⃣ once   🔗 chain
//
// `lasting` marks cards whose effect stays after they resolve (most Hazards
// change the map for the rest of the game). Playing the effects comes after the
// rules walkthrough; for now a drawn card is shown and logged.
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
  E('enigmatic-hourglass', 'Enigmatic Hourglass', 'cursedObject', 'Flip 🪙. If heads, reduce ⏳. If tails, lose 🪙.'),
  E('spirit-board', 'Spirit Board', 'cursedObject', 'Reveal an Evidence card and take 💥 [S].'),
  E('fall-through', 'Fall Through', 'event', 'Exhaust a defense 🎲 and investigate twice.'),
  E('bumped-shelf', 'Bumped Shelf', 'decision', 'Choose: Hide (Advance ⏳) / Try to leave (Flip a 🪙, if tails, you are attacked).'),
  E('ominous-vhs', 'Ominous VHS', 'cursedObject', 'Can reveal 3 ❓ on the map and take 💥 [M] for each Attack revealed.'),
  E('tarot-cards', 'Tarot Cards', 'cursedObject', 'Can draw 3 Event cards, Reveal 1 Evidence card.'),
  E('injured-survivor', 'Injured Survivor', 'decision', 'Choose: Live (Pay 3 🪙 to reveal 2 ❓). Die (Do nothing).'),
  // Page 2
  E('haunted-portrait', 'Haunted Portrait', 'cursedObject', 'Can heal all of your injuries. Shuffle back into event deck. If drawn again, the drawing player dies.'),
  E('nailed-shut', 'Nailed Shut', 'event', 'All doors in the building are now blocked.', { lasting: true }),
  E('flooded-out', 'Flooded Out', 'hazard', 'Movement cost doubled within R[1].', { lasting: true }),
  E('flickering-lights', 'Flickering Lights', 'hazard', '💥 [P] ignores lowest defense 🎲 within R[4].', { lasting: true }),
  E('message-cypher', 'Message Cypher', 'opportunity', 'Can advance ⏳⏳ to reveal one evidence card.'),
  E('wooden-boards', 'Wooden Boards', 'opportunity', 'Can exchange ⏳ to investigate. If an attack is drawn, ignore damage and reveal an evidence card instead.'),
  E('hidden-passage', 'Hidden Passage', 'event', 'Pick ❓ within 10 spaces. Enable travel between them for the rest of the game. Costs all remaining movement to use.', { lasting: true }),
  E('bright-moon', 'Bright Moon', 'global', '[M/P-1]. If target is identified as a beast [P+2] instead.', { lasting: true }),
  E('strong-winds', 'Strong Winds', 'global', 'Flip 🪙 every turn. If outside: HEADS (2X a movement roll) TAILS (Exhaust lowest movement roll).', { lasting: true }),
  // Page 3
  E('distant-gunshots', 'Distant Gunshots', 'event', 'For the rest of this turn, the team negates Attack cards.'),
  E('power-outage', 'Power Outage', 'global', 'No map light bonuses. Darkness [+2].', { lasting: true }),
  E('distant-screams', 'Distant Screams', 'event', 'All players roll 🎲 [M-2] and attacks are avoided for the remainder of the turn.'),
  E('sinkhole', 'Sinkhole', 'hazard', 'This space costs 5 movement to cross for the rest of the game.', { lasting: true }),
  E('huddled-survivors', 'Huddled Survivors', 'decision', 'Choose: Live (Can discard 1 Weapon and 1 Intel 🎲 to investigate twice). Die (Do nothing).'),
  E('insane-survivor', 'Insane Survivor', 'decision', 'Choose: Live (Take 💥 [P] and reveal an evidence card). Die (Do nothing).'),
  E('overgrown-brambles', 'Overgrown Brambles', 'hazard', 'Crossing this space costs ⏳. Can be destroyed with 🔥 or specific weapons.', { lasting: true }),
  E('coil-of-razor-wire', 'Coil of Razor Wire', 'hazard', 'Create a hazard space which only affects corporeal monsters. They lose 5M and take 🎲 damage when crossed. 1️⃣', { lasting: true }),
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
  E('peculiar-mirror', 'Peculiar Mirror', 'cursedObject', 'Choose any ❓. Can use the object to travel in between without losing movement. Flip a 🪙. If tails, lose it.', { lasting: true }),
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
