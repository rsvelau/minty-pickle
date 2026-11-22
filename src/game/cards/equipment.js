// Equipment cards, transcribed from midnight_shift_cards.pdf (pages 5-10).
//
// Each card has 1-3 abilities, printed as
//   <range> <damage icon> Name | <cost> [requirement] effect <limit>
//
//   range   'close' | 'mid' | 'long' | 'self' | 'all' (src/game/cards/injuries.js has the distances)
//   kind    damage kind from DAMAGE_KINDS (cards/monsters.js): silver ☾, salt ⛰, holy ✺,
//           crystal ◆, iron ⚔ (the crossed tools), fire 🔥; null = the plain circle (untyped)
//   dice    how many rolled dice you slot into it (0 = free)
//   coins   how many 🪙 it costs instead (Weeping Barrier, Wrathful Penance, Sacrifice, Toss)
//   req     the bracket, as printed: '4+', '12', '11-', '1,2', '2-3', '2, 5+', 'Any', '2x Target's'.
//           checkRequirement() (cards/requirements.js) reads it.
//   limit   'once' for 1️⃣ (one use, until something refreshes it), 'chain' for 🔗, or null
//   text    the effect, word for word
//
// These are data only so far: drawing a card puts it in your inventory and its
// abilities are listed there. Playing them comes after the rules walkthrough.
const A = (range, kind, name, dice, req, text, limit = null, coins = 0) => ({ range, kind, name, dice, req, text, limit, coins });

export const EQUIPMENT_CARDS = [
  { id: 'witch-hunters-sword', name: 'Witch Hunter’s Sword', abilities: [
    A('close', 'holy', 'Smite', 1, '4+', 'Deal 🎲 damage'),
    A('mid', 'crystal', 'Bind', 2, '10', 'Reduce target’s movement by 5 this turn'),
    A('mid', 'holy', 'Bless', 2, '7', 'Double target’s attack this turn'),
  ] },
  { id: 'rock-salt-shotgun', name: 'Rock Salt Shotgun', abilities: [
    A('close', 'salt', 'Salt Shot', 2, '12', 'Deal 6 damage and Blind', 'once'),
    A('close', null, 'Bludgeon', 1, '3+', 'Deal 🎲 damage'),
  ] },
  { id: 'heavy-silver-crucifix', name: 'Heavy Silver Crucifix', abilities: [
    A('close', 'holy', 'Smite', 1, '4+', 'Deal 🎲 damage'),
    A('close', 'silver', 'Seal', 2, '2', 'Halve target’s attack damage this turn (round down)'),
  ] },
  { id: 'cursebreaker-dagger', name: 'Cursebreaker Dagger', abilities: [
    A('close', 'silver', 'Pierce', 1, '4+', 'Deal 🎲 damage'),
    A('close', 'silver', 'Seal', 2, '2', 'Halve target’s attack damage this turn (round down)'),
    A('mid', 'crystal', 'Bind', 2, '10', 'Reduce target’s movement by 5 this turn'),
  ] },
  { id: 'dragons-breath-shotgun', name: 'Dragon’s Breath Shotgun', abilities: [
    A('close', 'fire', 'Incendiary Shot', 2, '8+', 'Deal 6 damage, ignore toughness.', 'once'),
    A('close', null, 'Stock Strike', 1, '2', 'Add 3 damage to another attack this turn'),
    A('close', null, 'Breach', 2, '2+', 'Destroy an adjacent door.', 'once'),
  ] },
  { id: 'cut-spike', name: 'Cut Spike', abilities: [
    A('close', 'iron', 'Pierce', 1, '4+', 'Deal 🎲 damage'),
    A('close', null, 'Nail Shut', 2, '2+', 'Block an adjacent door.', 'chain'),
  ] },
  { id: 'compact-revolver', name: 'Compact Revolver', abilities: [
    A('mid', null, 'Controlled Shots', 3, '12+', 'Deal 🎲 damage', 'chain'),
    A('mid', null, 'Hip Fire', 3, '11-', 'Deal 8 damage.', 'chain'),
  ] },
  { id: 'hunting-rifle', name: 'Hunting Rifle', abilities: [
    A('long', null, 'Sniper Shots', 3, '18', 'Deal 18 damage ignore toughness.', 'chain'),
    A('mid', null, 'Center Shots', 3, '12+', 'A deal 🎲 damage.', 'chain'),
  ] },
  { id: 'eccentric-crossbow', name: 'Eccentric Crossbow', abilities: [
    A('mid', null, 'Piercing Tip', 2, '10', 'Deal 5 damage, ignore toughness.', 'once'),
    A('self', null, 'Retrieval', 1, '3+', 'Refresh Piercing Tip'),
  ] },
  { id: 'firemans-axe', name: 'Fireman’s Axe', abilities: [
    A('close', null, 'Chop', 1, '4+', 'Deal 🎲 damage and reduce target’s toughness by 1 this turn'),
    A('close', null, 'Breach', 2, '2+', 'Destroy an adjacent door'),
  ] },
  { id: 'flare-gun', name: 'Flare Gun', abilities: [
    A('mid', 'fire', 'Direct Impact', 2, '7', 'Reduce target’s toughness by 2 this turn, then deal 7 damage.', 'chain'),
    A('self', null, 'Illuminate', 1, 'Any', 'Increase two 🎲 to 6.', 'chain'),
  ] },
  { id: 'weathered-machete', name: 'Weathered Machete', abilities: [
    A('close', null, 'Chop', 1, '4+', 'Deal 🎲 damage and reduce target’s toughness by 1 this turn'),
  ] },
  { id: 'salt-lick', name: 'Salt Lick', abilities: [
    A('close', 'salt', 'Bludgeon', 1, '3+', 'Deal 🎲 damage'),
    A('self', 'salt', 'Salt Circle', 1, 'Any', 'Prevent Monster from crossing this space for 1 turn.', 'chain'),
  ] },
  { id: 'improvised-spear', name: 'Improvised Spear', abilities: [
    A('close', 'iron', 'Pierce', 1, '4+', 'Deal 🎲 damage'),
    A('mid', 'iron', 'Javelin', 2, '7', 'Deal 10 damage.', 'chain'),
  ] },
  { id: 'molotov-cocktail', name: 'Molotov Cocktail', abilities: [
    A('mid', 'fire', 'Immolate', 2, '6', 'Reduce target’s toughness by 3 this turn, then deal 3 damage.', 'chain'),
  ] },
  { id: 'makeshift-torch', name: 'Makeshift Torch', abilities: [
    A('close', 'fire', 'Bludgeon', 1, '3+', 'Deal 🎲 damage'),
    A('self', null, 'Torchlight', 1, 'Any', 'Increase one 🎲 to 6.'),
  ] },
  { id: 'iron-chain', name: 'Iron Chain', abilities: [
    A('close', 'iron', 'Choke', 2, '2x Target’s', 'Immobilize target. Deal 3 damage ignoring toughness'),
    A('close', null, 'Lock', 2, 'Any', 'Lock an adjacent door.'),
  ] },
  { id: 'heavy-silver-chain', name: 'Heavy Silver Chain', abilities: [
    A('close', 'silver', 'Choke', 2, '2x Target’s', 'Immobilize target. Deal 3 damage ignoring toughness'),
    A(null, null, 'Lock', 2, 'Any', 'Lock an adjacent door.'), // no range printed on the card
  ] },
  { id: 'railroad-hammer', name: 'Railroad Hammer', abilities: [
    A('close', 'iron', 'Bludgeon', 1, '3+', 'Deal 🎲 damage'),
  ] },
  { id: 'baseball-bat', name: 'Baseball Bat', abilities: [
    A('close', null, 'Bludgeon', 1, '3+', 'Deal 🎲 damage'),
    A('close', null, 'Shatter', 1, '6', 'Deal 10 damage', 'chain'),
  ] },
  { id: 'crowbar', name: 'Crowbar', abilities: [
    A('close', 'iron', 'Bludgeon', 1, '3+', 'Deal 🎲 damage'),
    A('close', null, 'Breach', 2, '2+', 'Destroy an adjacent door'),
  ] },
  { id: 'kitchen-knife', name: 'Kitchen Knife', abilities: [
    A('close', null, 'Pierce', 1, '4+', 'Deal 🎲 damage'),
  ] },
  { id: 'powerful-flashlight', name: 'Powerful Flashlight', abilities: [
    A('self', null, 'Illuminate', 1, 'Any', 'Change this 🎲 to 6 and refresh it'),
    A('close', null, 'Blind', 1, '6', 'Target’s damage 🎲 in excess of 3 are reduced to 3 this turn'),
  ] },
  { id: 'singing-bowl', name: 'Singing Bowl', abilities: [
    A('self', null, 'Pacifying Song', 1, '1,2', 'Change this 🎲 to 6 and set as bonus Mental defense this turn'),
    A('mid', null, 'Ethereal Tap', 2, '2', 'Reduce Mental ailment tier by 1 for self and allies'),
  ] },
  { id: 'ornamental-crucifix', name: 'Ornamental Crucifix', abilities: [
    A('self', null, 'Invoke', 1, '1,2', 'Change this 🎲 to 6 and set as bonus Spiritual defense this turn'),
    A('close', null, 'Attach', 1, '6', 'Reduce a Demon’s toughness to 0 this turn.', 'chain'),
  ] },
  { id: 'medical-kit', name: 'Medical Kit', abilities: [
    A('self', null, 'Dress Wound', 1, 'Any', 'Reduce Physical injury tier for target and recover 🎲 HP'),
  ] },
  { id: 'compact-boombox', name: 'Compact Boombox', abilities: [
    A('mid', null, 'Distract', 1, 'Any', 'The Monster must use movement to approach a selected space this turn', 'chain'),
    A('mid', null, 'Rally', 1, 'Any', 'You and all allies can turn a 🎲 into a 4 bonus mental defense this turn'),
  ] },
  { id: 'bronze-skull-lantern', name: 'Bronze Skull Lantern', abilities: [
    A('self', null, 'Ominous Illumination', 1, 'Any', 'Double this 🎲 and refresh. Cannot defend against Spiritual damage this turn'),
    A('mid', null, 'Spiritual Backlash', 1, '6', 'Redirect all incoming Spiritual damage to a target'),
  ] },
  { id: 'mourning-veil', name: 'Mourning Veil', abilities: [
    A('self', null, 'Weeping Barrier', 0, '1', 'Spiritual damage heals you this turn', null, 1),
  ] },
  { id: 'blessed-scapular', name: 'Blessed Scapular', abilities: [
    A('mid', 'holy', 'Wrathful Penance', 0, '2', 'Reflect Spiritual damage as ✺ this turn', null, 1),
    A('self', null, 'Protective Faith', 1, '2-', 'Change this 🎲 to 6 and set as bonus Spiritual defense this turn'),
  ] },
  { id: 'mala-beads', name: 'Mala Beads', abilities: [
    A('self', null, 'Fervent Prayer', 2, 'Any', 'Change this 🎲 to 6 and set as bonus Spiritual defense this turn'),
  ] },
  { id: 'glowing-salt-lamp', name: 'Glowing Salt Lamp', abilities: [
    A('self', null, 'Illuminate', 2, 'Any', 'Change both 🎲 to 4s and refresh'),
    A('close', 'salt', 'Salt Circle', 1, 'Any', 'Prevent Monster from crossing this space for 1 turn', 'chain'),
  ] },
  { id: 'purity-seal', name: 'Purity Seal', abilities: [
    A('self', null, 'Sacrificial Seal', 0, null, 'Completely negate all damage taken this turn', 'chain'),
  ] },
  { id: 'calming-tonic', name: 'Calming Tonic', abilities: [
    A('self', null, 'Sip', 0, null, 'Reduce Mental injury tier by 1', 'chain'),
    A('self', null, 'Overdose', 0, null, 'Set Mental injury tier to 0 and Physical injury tier to 1', 'chain'),
  ] },
  { id: 'marlin-spike', name: 'Marlin Spike', abilities: [
    A('close', null, 'Bludgeon', 1, '3+', 'Deal 🎲 damage'),
    A('close', null, 'Pierce', 1, '2-3', 'Deal 5 damage'),
  ] },
  { id: 'log-peavey', name: 'Log Peavey', abilities: [
    A('close', null, 'Gaffe', 2, '2, 5+', 'Deal 5 damage and reduce monster movement by 5'),
  ] },
  { id: 'ice-axe', name: 'Ice Axe', abilities: [
    A('close', null, 'Chop', 1, '4+', 'Deal 🎲 damage and reduce target’s toughness by 1 this turn'),
    A('self', null, 'Brace', 1, '4+', 'Immune to being moved this turn'),
  ] },
  { id: 'sacrificial-fetish', name: 'Sacrificial Fetish', abilities: [
    A('all', null, 'Sacrifice', 0, '1', 'When you or a teammate is killed, instead remove all injuries from that player', 'chain', 1),
  ] },
  { id: 'viper-hood', name: 'Viper Hood', abilities: [
    A('self', null, 'Camouflage', 1, '2-', 'Cannot be approached this turn. Cannot move'),
  ] },
  { id: 'good-luck-charm', name: 'Good Luck Charm', abilities: [
    A('self', null, 'Lucky', 0, null, 'Select values for all of your 🎲 this turn', 'chain'),
  ] },
  { id: 'worry-stone', name: 'Worry Stone', abilities: [
    A('self', null, 'Rub', 1, '1', 'Reduce Mental injury tier by 1'),
    A('self', null, 'Toss', 0, '1', 'Suppress the effects of all injuries until damaged', 'chain', 1),
  ] },
  { id: 'crystal-talisman', name: 'Crystal Talisman', abilities: [
    A('self', null, 'Barrier', 1, '1', 'Gain 6 additional defense this turn'),
    A('mid', 'crystal', 'Bind', 2, '10', 'Reduce monster movement by 5 this turn'),
  ] },
  { id: 'questionable-stimulant', name: 'Questionable Stimulant', abilities: [
    A('self', null, 'Drink', 0, null, 'Double movement and ignore physical injuries this turn.', 'chain'),
  ] },
  { id: 'fencing-shoes', name: 'Fencing Shoes', abilities: [
    A('self', null, 'Lunge', 0, null, 'Close range melee attacks can hit from Mid range.'),
    A('self', null, 'Close Gap', 1, 'Any', 'Gain 4 additional movement this turn.'),
  ] },
];

export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT_CARDS.map((c) => [c.id, c]));
// Kept for anything that still wants just the names.
export const EQUIPMENT_NAMES = EQUIPMENT_CARDS.map((c) => c.name);

// One line per ability, as printed (for logs, lists and tooltips).
export function abilityLine(a) {
  const cost = a.coins ? `${'🪙'.repeat(a.coins)}` : '🎲'.repeat(a.dice);
  const req = a.req ? ` [${a.req}]` : '';
  const limit = a.limit === 'once' ? ' 1️⃣' : a.limit === 'chain' ? ' 🔗' : '';
  return `${a.name}${cost || req ? ` | ${cost}${req}` : ''} ${a.text}${limit}`;
}
