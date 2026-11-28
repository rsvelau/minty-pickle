// Equipment cards, transcribed from midnight_shift_cards.pdf (pages 5-10), with
// the designer's clarifications (rules walkthrough, round 1) folded in.
//
// Each card has 1-3 abilities, printed as
//   <range> <damage icon> Name | <cost> [requirement] effect <limit>
//
//   range   'close' | 'mid' | 'long' | 'self' | 'all' (distances: cards/injuries.js RANGE)
//   kind    damage kind from DAMAGE_KINDS (cards/monsters.js): silver ☾, salt ⛰, holy ✺,
//           crystal ◆, iron ⚔ (the crossed tools), fire 🔥; null = the plain circle (untyped)
//   dice    how many rolled dice you slot into it (0 = free)
//   obols   Obols it costs, any colour (printed as 🪙 [n] on the card)
//   req     the bracket: the slotted dice ADDED TOGETHER must equal it ('12'), reach it
//           ('4+', '11-'), fall in it ('2-3', '1,2'), or ('2, 5+') one die each; see
//           cards/requirements.js. '2x Target’s': twice the target's action roll this turn.
//   limit   'reload' (bullet icon): firearms and crossbows. Firing turns the skill into
//           "Reload <skill>" (an empty-cartridge icon): one die [4+] reloads it, ready on
//           your next turn; a 6 is a quick reload, ready to fire again at once
//           (equipmentPlay.js abilityAt / reload).
//           'once' 1️⃣: one use until something refreshes it
//           'breaks' 🔗: the card is discarded after this skill is used (out of ammo, snapped)
//   text    the effect (reworded only where the designer clarified it)
//   fx      what the game plays (cards/../equipmentPlay.js); `manual` = shown and paid
//           for, but resolved at the table for now. `door`: 'breach' destroys an
//           adjacent door (an open doorway for good), 'block' nails or chains it
//           shut (a wall to everyone, monsters too, until breached): game/doors.js
//
// Damage: 'die' = the slotted die, 'sum' = the slotted dice added, or a number.
// It is reduced by the monster's toughness (unless ignoreToughness) and the rest
// comes off its health. An immune kind does nothing at all to that monster.
const A = (range, kind, name, dice, req, text, fx, limit = null, obols = 0) => ({ range, kind, name, dice, req, text, fx, limit, obols });
const HIT = (dmg, more = {}) => ({ target: 'monster', dmg, ...more });

export const EQUIPMENT_CARDS = [
  { id: 'witch-hunters-sword', name: 'Witch Hunter’s Sword', abilities: [
    A('close', 'holy', 'Smite', 1, '4+', 'Deal 🎲 damage', HIT('die')),
    A('mid', 'crystal', 'Bind', 2, '10', 'Reduce target’s movement by 5 this turn', { target: 'monster', moveDown: 5 }),
    A('mid', 'holy', 'Bless', 2, '7', 'Double target’s attack this turn', { target: 'ally', doubleAttack: true }),
  ] },
  { id: 'rock-salt-shotgun', name: 'Rock Salt Shotgun', abilities: [
    A('close', 'salt', 'Salt Shot', 2, '12', 'Deal 6 damage and Blind (its next attack rolls 1)', HIT(6, { blind: true }), 'reload'),
    A('close', null, 'Bludgeon', 1, '3+', 'Deal 🎲 damage', HIT('die')),
  ] },
  { id: 'heavy-silver-crucifix', name: 'Heavy Silver Crucifix', abilities: [
    A('close', 'holy', 'Smite', 1, '4+', 'Deal 🎲 damage', HIT('die')),
    A('close', 'silver', 'Seal', 2, '2', 'Halve target’s attack damage this turn (round down)', { target: 'monster', halve: true }),
  ] },
  { id: 'cursebreaker-dagger', name: 'Cursebreaker Dagger', abilities: [
    A('close', 'silver', 'Pierce', 1, '4+', 'Deal 🎲 damage', HIT('die')),
    A('close', 'silver', 'Seal', 2, '2', 'Halve target’s attack damage this turn (round down)', { target: 'monster', halve: true }),
    A('mid', 'crystal', 'Bind', 2, '10', 'Reduce target’s movement by 5 this turn', { target: 'monster', moveDown: 5 }),
  ] },
  { id: 'dragons-breath-shotgun', name: 'Dragon’s Breath Shotgun', abilities: [
    A('close', 'fire', 'Incendiary Shot', 2, '8+', 'Deal 6 damage, ignore toughness.', HIT(6, { ignoreToughness: true }), 'reload'),
    A('close', null, 'Stock Strike', 1, '2', 'The next attack against the target this turn deals 3 more damage', { target: 'monster', bonusNext: 3 }),
    A('close', null, 'Breach', 2, '2+', 'Destroy an adjacent door.', { door: 'breach' }, 'reload'),
  ] },
  { id: 'cut-spike', name: 'Cut Spike', abilities: [
    A('close', 'iron', 'Pierce', 1, '4+', 'Deal 🎲 damage', HIT('die')),
    A('close', null, 'Nail Shut', 2, '2+', 'Block an adjacent door.', { door: 'block', how: 'nailed shut' }, 'breaks'),
  ] },
  { id: 'compact-revolver', name: 'Compact Revolver', abilities: [
    A('mid', null, 'Controlled Shots', 3, '12+', 'Deal 🎲 damage (the three dice added)', HIT('sum'), 'reload'),
    A('mid', null, 'Hip Fire', 3, '11-', 'Deal 8 damage.', HIT(8), 'reload'),
  ] },
  { id: 'hunting-rifle', name: 'Hunting Rifle', abilities: [
    A('long', null, 'Sniper Shots', 3, '18', 'Deal 18 damage, ignore toughness.', HIT(18, { ignoreToughness: true }), 'reload'),
    A('mid', null, 'Center Shots', 3, '12+', 'Deal 🎲 damage (the three dice added)', HIT('sum'), 'reload'),
  ] },
  { id: 'eccentric-crossbow', name: 'Eccentric Crossbow', abilities: [
    A('mid', null, 'Piercing Tip', 2, '10', 'Deal 5 damage, ignore toughness.', HIT(5, { ignoreToughness: true }), 'reload'),
    A('long', null, 'Flighted Bolt', 1, '3+', 'Deal 🎲 damage', HIT('die'), 'reload'),
  ] },
  { id: 'firemans-axe', name: 'Fireman’s Axe', abilities: [
    A('close', null, 'Chop', 1, '4+', 'Reduce target’s toughness by 1 this turn, then deal 🎲 damage', HIT('die', { toughDown: 1 })),
    A('close', null, 'Breach', 2, '2+', 'Destroy an adjacent door', { door: 'breach' }),
  ] },
  { id: 'flare-gun', name: 'Flare Gun', abilities: [
    A('mid', 'fire', 'Direct Impact', 2, '7', 'Reduce target’s toughness by 2 this turn, then deal 7 damage.', HIT(7, { toughDown: 2 }), 'reload'),
    A('self', null, 'Illuminate', 1, 'Any', 'Increase two other 🎲 to 6.', { target: 'dice', raise: 2, to: 6 }, 'reload'),
  ] },
  { id: 'weathered-machete', name: 'Weathered Machete', abilities: [
    A('close', null, 'Chop', 1, '4+', 'Reduce target’s toughness by 1 this turn, then deal 🎲 damage', HIT('die', { toughDown: 1 })),
  ] },
  { id: 'salt-lick', name: 'Salt Lick', abilities: [
    A('close', 'salt', 'Bludgeon', 1, '3+', 'Deal 🎲 damage', HIT('die')),
    A('self', 'salt', 'Salt Circle', 1, 'Any', 'Prevent Monster from crossing this space for 1 turn.', { salt: true }, 'breaks'),
  ] },
  { id: 'improvised-spear', name: 'Improvised Spear', abilities: [
    A('close', 'iron', 'Pierce', 1, '4+', 'Deal 🎲 damage', HIT('die')),
    A('mid', 'iron', 'Javelin', 2, '7', 'Deal 10 damage.', HIT(10), 'breaks'),
  ] },
  { id: 'molotov-cocktail', name: 'Molotov Cocktail', abilities: [
    A('mid', 'fire', 'Immolate', 2, '6', 'Reduce target’s toughness by 3 this turn, then deal 3 damage.', HIT(3, { toughDown: 3 }), 'breaks'),
  ] },
  { id: 'makeshift-torch', name: 'Makeshift Torch', abilities: [
    A('close', 'fire', 'Bludgeon', 1, '3+', 'Deal 🎲 damage', HIT('die')),
    A('self', null, 'Torchlight', 1, 'Any', 'Increase one other 🎲 to 6.', { target: 'dice', raise: 1, to: 6 }),
  ] },
  { id: 'iron-chain', name: 'Iron Chain', abilities: [
    A('close', 'iron', 'Choke', 2, '2x Target’s', 'Immobilize target. Deal 3 damage ignoring toughness', HIT(3, { ignoreToughness: true, immobile: true })),
    A('close', null, 'Lock', 2, 'Any', 'Lock an adjacent door. The chain stays on it: the card is lost.', { door: 'block', how: 'chained shut', hp: 12 }, 'breaks'),
  ] },
  { id: 'heavy-silver-chain', name: 'Heavy Silver Chain', abilities: [
    A('close', 'silver', 'Choke', 2, '2x Target’s', 'Immobilize target. Deal 3 damage ignoring toughness', HIT(3, { ignoreToughness: true, immobile: true })),
    A('close', null, 'Lock', 2, 'Any', 'Lock an adjacent door. The chain stays on it: the card is lost.', { door: 'block', how: 'chained shut', hp: 12 }, 'breaks'),
  ] },
  { id: 'railroad-hammer', name: 'Railroad Hammer', abilities: [
    A('close', 'iron', 'Bludgeon', 1, '3+', 'Deal 🎲 damage', HIT('die')),
  ] },
  { id: 'baseball-bat', name: 'Baseball Bat', abilities: [
    A('close', null, 'Bludgeon', 1, '3+', 'Deal 🎲 damage', HIT('die')),
    A('close', null, 'Shatter', 1, '6', 'Deal 10 damage', HIT(10), 'breaks'),
  ] },
  { id: 'crowbar', name: 'Crowbar', abilities: [
    A('close', 'iron', 'Bludgeon', 1, '3+', 'Deal 🎲 damage', HIT('die')),
    A('close', null, 'Breach', 2, '2+', 'Destroy an adjacent door', { door: 'breach' }),
  ] },
  { id: 'kitchen-knife', name: 'Kitchen Knife', abilities: [
    A('close', null, 'Pierce', 1, '4+', 'Deal 🎲 damage', HIT('die')),
  ] },
  { id: 'powerful-flashlight', name: 'Powerful Flashlight', abilities: [
    A('self', null, 'Illuminate', 1, 'Any', 'Change this 🎲 to 6 and refresh it', { target: 'self', refreshAs: 6 }),
    A('close', null, 'Blind', 1, '6', 'Target’s damage 🎲 in excess of 3 are reduced to 3 this turn', { target: 'monster', capDie: 3 }),
  ] },
  { id: 'singing-bowl', name: 'Singing Bowl', abilities: [
    A('self', null, 'Pacifying Song', 1, '1,2', 'Change this 🎲 to 6 and set as bonus Mental defense this turn', { target: 'self', bonusDefense: { type: 'M', v: 6 } }),
    A('mid', null, 'Ethereal Tap', 2, '2', 'Reduce Mental injury tier by 1 for self and allies', { target: 'self', healAround: { M: 1 } }),
  ] },
  { id: 'ornamental-crucifix', name: 'Ornamental Crucifix', abilities: [
    A('self', null, 'Invoke', 1, '1,2', 'Change this 🎲 to 6 and set as bonus Spiritual defense this turn', { target: 'self', bonusDefense: { type: 'S', v: 6 } }),
    A('close', null, 'Attach', 1, '6', 'Reduce a Demon’s toughness to 0 this turn.', { target: 'monster', demonToughnessZero: true }, 'breaks'),
  ] },
  { id: 'medical-kit', name: 'Medical Kit', abilities: [
    A('self', null, 'Dress Wound', 1, 'Any', 'Heal all Physical injury tiers (yours, or a teammate’s in your space)', { target: 'ally', heal: { P: 'all' } }),
  ] },
  { id: 'compact-boombox', name: 'Compact Boombox', abilities: [
    A('mid', null, 'Distract', 1, 'Any', 'The Monster must use movement to approach a selected space this turn', { lure: true }, 'breaks'),
    A('mid', null, 'Rally', 1, 'Any', 'You and all allies in range gain 4 bonus Mental defense this turn', { rally: 4 }),
  ] },
  { id: 'bronze-skull-lantern', name: 'Bronze Skull Lantern', abilities: [
    A('self', null, 'Ominous Illumination', 1, 'Any', 'Double this 🎲 and refresh. Cannot defend against Spiritual damage this turn', { target: 'self', refreshAs: 'double', noDefense: 'S' }),
    A('mid', null, 'Spiritual Backlash', 1, '6', 'The target (a monster or a teammate) takes the Spiritual damage you would have taken this turn instead (untyped to monsters)', { spirit: 'backlash', target: 'either' }),
  ] },
  { id: 'mourning-veil', name: 'Mourning Veil', abilities: [
    A('self', null, 'Weeping Barrier', 0, null, 'Spiritual damage heals you this turn', { spirit: 'heal' }, null, 1),
  ] },
  { id: 'blessed-scapular', name: 'Blessed Scapular', abilities: [
    A('mid', 'holy', 'Wrathful Penance', 0, null, 'Spiritual damage you would take this turn is reflected back at the monster as ✺ Holy damage', { spirit: 'reflect' }, null, 2),
    A('self', null, 'Protective Faith', 1, '2-', 'Change this 🎲 to 6 and set as bonus Spiritual defense this turn', { target: 'self', bonusDefense: { type: 'S', v: 6 } }),
  ] },
  { id: 'mala-beads', name: 'Mala Beads', abilities: [
    A('self', null, 'Fervent Prayer', 2, 'Any', 'Change this 🎲 to 6 and set as bonus Spiritual defense this turn', { target: 'self', bonusDefense: { type: 'S', v: 6 } }),
  ] },
  { id: 'glowing-salt-lamp', name: 'Glowing Salt Lamp', abilities: [
    A('self', null, 'Illuminate', 2, 'Any', 'Change both 🎲 to 4s and refresh', { target: 'self', refreshAs: 4 }),
    A('close', 'salt', 'Salt Circle', 1, 'Any', 'Prevent Monster from crossing this space for 1 turn', { salt: true }, 'breaks'),
  ] },
  { id: 'purity-seal', name: 'Purity Seal', abilities: [
    A('self', null, 'Sacrificial Seal', 0, null, 'Completely negate all damage taken this turn', { target: 'self', negateAll: true }, 'breaks'),
  ] },
  { id: 'calming-tonic', name: 'Calming Tonic', abilities: [
    A('self', null, 'Sip', 0, null, 'Reduce Mental injury tier by 1', { target: 'self', heal: { M: 1 } }, 'breaks'),
    A('self', null, 'Overdose', 0, null, 'Set Mental injury tier to 0 and Physical injury tier to 1', { target: 'self', setInjury: { M: 0, P: 1 } }, 'breaks'),
  ] },
  { id: 'marlin-spike', name: 'Marlin Spike', abilities: [
    A('close', null, 'Bludgeon', 1, '3+', 'Deal 🎲 damage', HIT('die')),
    A('close', null, 'Pierce', 1, '2-3', 'Deal 5 damage', HIT(5)),
  ] },
  { id: 'log-peavey', name: 'Log Peavey', abilities: [
    A('close', null, 'Gaffe', 2, '2, 5+', 'Deal 5 damage and reduce monster movement by 5', HIT(5, { moveDown: 5 })),
  ] },
  { id: 'ice-axe', name: 'Ice Axe', abilities: [
    A('close', null, 'Chop', 1, '4+', 'Reduce target’s toughness by 1 this turn, then deal 🎲 damage', HIT('die', { toughDown: 1 })),
    A('self', null, 'Brace', 1, '4+', 'Immune to being moved this turn', { brace: true }),
  ] },
  { id: 'sacrificial-fetish', name: 'Sacrificial Fetish', abilities: [
    A('all', null, 'Sacrifice', 0, null, 'When you or a teammate is killed, instead remove all injuries from that player', { sacrifice: true }, 'breaks', 1),
  ] },
  { id: 'viper-hood', name: 'Viper Hood', abilities: [
    A('self', null, 'Camouflage', 1, '2-', 'Cannot be approached this turn. Cannot move', { camouflage: true }),
  ] },
  { id: 'good-luck-charm', name: 'Good Luck Charm', abilities: [
    A('self', null, 'Lucky', 0, null, 'Select values for all of your 🎲 this turn', { lucky: true }, 'breaks'),
  ] },
  { id: 'worry-stone', name: 'Worry Stone', abilities: [
    A('self', null, 'Rub', 1, '1', 'Reduce Mental injury tier by 1', { target: 'self', heal: { M: 1 } }),
    A('self', null, 'Toss', 0, null, 'Suppress the effects of all injuries until damaged', { toss: true }, 'breaks', 1),
  ] },
  { id: 'crystal-talisman', name: 'Crystal Talisman', abilities: [
    A('self', null, 'Barrier', 1, '1', 'Gain 6 additional defense this turn', { target: 'self', bonusDefense: { type: null, v: 6 } }),
    A('mid', 'crystal', 'Bind', 2, '10', 'Reduce monster movement by 5 this turn', { target: 'monster', moveDown: 5 }),
  ] },
  { id: 'questionable-stimulant', name: 'Questionable Stimulant', abilities: [
    A('self', null, 'Drink', 0, null, 'Double movement and ignore physical injuries this turn.', { drink: true }, 'breaks'),
  ] },
  { id: 'fencing-shoes', name: 'Fencing Shoes', abilities: [
    A('self', null, 'Lunge', 0, null, 'Close range melee attacks can hit from Mid range.', { passive: 'lunge' }),
    A('self', null, 'Close Gap', 1, 'Any', 'Gain 4 additional movement this turn.', { target: 'self', move: 4 }),
  ] },
];

export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT_CARDS.map((c) => [c.id, c]));
// Kept for anything that still wants just the names.
export const EQUIPMENT_NAMES = EQUIPMENT_CARDS.map((c) => c.name);

// The cost as shown: dice, or Obols (◉, any colour; 🪙 stays for coin flips).
export const OBOL_COST = '◉';
export function costText(a) {
  return a.obols ? `${a.obols} Obol${a.obols === 1 ? '' : 's'}` : '🎲'.repeat(a.dice);
}
