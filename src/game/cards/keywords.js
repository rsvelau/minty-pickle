// The card shorthand, as the designer defined it (rules walkthrough, round 1).
// Shown in Settings → Cards in the game → Glossary.
export const KEYWORDS = [
  { term: '🎲 [n]', text: 'Slot that many rolled dice. Added together, they must equal the bracket ([12]), reach it ([4+], [11-]) or fall in it ([2-3]). [2, 5+]: one die each. [Any]: any value.' },
  { term: '[2x Target’s 🎲]', text: 'At least twice the target monster’s action roll this turn (all its action dice added).' },
  { term: '1️⃣ Once', text: 'One use, until something refreshes it (the Crossbow’s Retrieval).' },
  { term: '🔗 Breaks', text: 'The card is discarded after this skill is used: out of ammo, snapped, spent.' },
  { term: '◉ Obol cost', text: 'Spend that many Obols, any colour. (🪙 on its own is a coin flip.)' },
  { term: 'Refresh a die', text: 'A die already slotted can be rolled again and slotted again.' },
  { term: '⏳ Turn', text: 'One turn on the clock. Cards move the clock forward or back; from midnight on they can’t: the clock stops at midnight.' },
  { term: '💥 [P] / [M] / [S]', text: 'Damage of that type. Defended as usual with slotted defense.' },
  { term: '[M/P −1], [+2]', text: 'Damage rolls of those types get −1 (easier to defend) or +2.' },
  { term: 'Darkness', text: 'A tag on monster damage (the Shadow People’s Umbral Stab).' },
  { term: 'R[n]', text: 'Radius of n spaces. Always whole spaces.' },
  { term: 'Range', text: 'Close: adjacent (diagonals too). Mid: within 2. Long: 3 or more. Self: you. All: everyone.' },
  { term: 'Toughness', text: 'Reduces each attack’s damage; the rest comes off the monster’s health.' },
  { term: 'Weakness', text: 'Hits with a weapon of that element count up the monster’s weakness track; at each number its effect happens (once, unless the card says otherwise).' },
  { term: 'Immune', text: 'Weapons of that element do nothing to the monster: no damage, no other effect.' },
  { term: 'Blind', text: 'The monster’s next attack rolls 1.' },
  { term: 'Global', text: 'Affects the whole map until another Global replaces it. One at a time.' },
  { term: 'Hazard', text: 'Player traps affect only monsters; discovered Hazards affect players and monsters.' },
  { term: 'Cursed Object', text: 'Read it, then choose whether to use it.' },
  { term: 'White 🎲 (Intel 🎲)', text: '“Intel die” is an older name for a white die.' },
];
