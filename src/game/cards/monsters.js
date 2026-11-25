// Monster cards, transcribed from the physical game (midnight_shift_cards.pdf).
//
// Evidence and attack types are checked against the Monster Ref Sheet
// (Monsters_and_Injuries_11-20-2026.xlsx).
//
// Each card:
//   id, name, hp, toughness (null = ∞), badge (the number in the top-right
//   corner), traits, note (the rules text under the name), objective,
//   weakness / immune (damage kinds, see DAMAGE_KINDS), weaknessTrack (the
//   arrows on the art: after `hits` attacks with a weapon of a weakness element,
//   that effect happens, once; hits null = the purple ∞, an effect that can
//   happen any number of times, usually by discarding that kind of item; `react`:
//   offered at the moment it happens: 'exhaust', 'attack', or an ability name), abilities
//   (the rows at the bottom: kind = physical | mental | spiritual | none,
//   roll = which die faces trigger it), and evidence:
//     attack: 'P' | 'M' | 'S'   the Attack card (Physical, Mental, Spiritual)
//     observations: [3 codes]   the Observation cards (see evidence.js)
//     lair: code                the Lair card
//
// Phase A uses the evidence and the descriptive text (Casebook, Field Guide).
// The abilities and wounds are here as data so later phases can play them.

export const DAMAGE_KINDS = {
  silver: { label: 'Silver', icon: '☾' },
  salt: { label: 'Salt', icon: '⛰' },
  holy: { label: 'Holy', icon: '✺' },
  crystal: { label: 'Crystal', icon: '◆' },
  iron: { label: 'Iron', icon: '⚔' },
  fire: { label: 'Fire', icon: '🔥' },
};

const A = (kind, name, roll, text, tags = {}) => ({ kind, name, roll, text, ...tags });

export const MONSTER_CARDS = [
  {
    id: 'werewolf', name: 'Werewolf', hp: 20, toughness: 4, badge: 3,
    traits: ['Corporeal', 'Beast'],
    note: 'Half speed indoors.',
    objective: 'Kill',
    weakness: ['silver'], immune: [],
    weaknessTrack: [{ hits: 2, text: '−2 toughness' }, { hits: 4, text: '−1 die' }, { hits: 6, text: 'Disable Terrifying Howl' }],
    abilities: [
      A('physical', 'Vicious Pursuit', '1-3', 'Pursue (8) and Attack (4)'),
      A('mental', 'Terrifying Howl', '4-5', 'Area Attack (4, Rad 3)'),
      A('none', 'Lick Wounds', '6', 'Retreat (5) and Heal (6)'),
    ],
    evidence: { attack: 'P', observations: ['CM', 'MW', 'SH'], lair: 'TS' },
  },
  {
    id: 'barghest', name: 'Barghest', hp: null, toughness: null, badge: 2,
    traits: ['Semi-Corporeal', 'Dissipating'],
    note: 'Start: Town Entrance. Can’t enter buildings. Midnight: all players Corrupted. Cleanse at {9}.',
    objective: 'Escape (to the start point)',
    weakness: ['salt', 'holy'], immune: ['crystal', 'iron', 'fire', 'silver'],
    weaknessTrack: [{ hits: 1, text: 'Disable Death Gaze for ⌛' }, { hits: 2, text: 'Disable Death Gaze for ⌛' }, { hits: 4, text: 'Disable Shadow Trap' }],
    abilities: [
      A('mental', 'Death Gaze', 'Persistent', 'At end of turn, LoS Attack (10)'),
      A('none', 'Stalk', '1-4', 'Pursue (5)'),
      A('spiritual', 'Shadow Trap', '5-6', 'Teleport (nearest light source) and Trap (2 dice)'),
    ],
    evidence: { attack: 'M', observations: ['CS', 'DT', 'SH'], lair: 'UD' },
  },
  {
    id: 'hellhounds', name: 'Hellhounds', hp: 3, toughness: 2, badge: 4,
    // Later (monster health): killing a hound sends the whole pack back to the
    // Lair; the pack only shrinks through its weakness.
    pack: true,
    traits: ['Corporeal', 'Demon'],
    note: 'Respawns at Lair when killed. Pinned players cannot move.',
    objective: 'Disrupt Ritual ({9} → Lair)',
    weakness: ['holy', 'crystal'], immune: ['fire'],
    weaknessTrack: [{ hits: 1, text: '−1 die' }, { hits: 3, text: '−1 die' }, { hits: 5, text: '−1 die' }],
    abilities: [
      A('none', 'Demonic Fire', 'Persistent', 'Ignores lowest defensive die'),
      A('physical', 'Harrow', '1-4', 'Pursue (5) and Attack (3)'),
      A('physical', 'Pin', '5-6', 'Pursue (5) and Pin (5)'),
    ],
    evidence: { attack: 'P', observations: ['CM', 'SS', 'SH'], lair: 'OR' },
  },
  {
    id: 'skinwalker', name: 'Skinwalker', hp: 20, toughness: 4, badge: 2,
    traits: ['Corporeal', 'Intelligent', 'Cursed'],
    note: 'Avoids traps. When the first player reaches the Lair, stun Skinwalker and reduce its toughness to 0 for ⌛.',
    objective: 'Kill',
    weakness: ['crystal', 'holy'], immune: ['silver'],
    weaknessTrack: [{ hits: 1, text: 'Reset Curseblood Ritual' }, { hits: 3, text: '−2 toughness' }, { hits: 6, text: 'Disable Curseblood Ritual' }],
    abilities: [
      A('physical', 'Wolf Prowl', '1-3', 'Outflank (15) and Attack (die)'),
      A('physical', 'Bear Maul', '4-5', 'Pursue (5) and Drag (die, 5M into nearest building)'),
      A('spiritual', 'Curseblood Ritual', '6', 'Teleport to Lair, +1 ritual. At 3 ritual: Global Attack (10)'),
    ],
    evidence: { attack: 'S', observations: ['SD', 'SH', 'ES'], lair: 'TS' },
  },
  {
    id: 'wendigo', name: 'Wendigo', hp: 20, toughness: 1, badge: 2,
    traits: ['Corporeal', 'Intelligent', 'Regenerative'],
    note: 'Avoids traps. Consume heals equal to damage. Lure causes players to move towards Wendigo.',
    objective: 'Kill',
    weakness: ['fire'], immune: ['iron', 'silver'],
    weaknessTrack: [{ hits: 1, text: 'Disable Regeneration until Wendigo feeds' }, { hits: 3, text: 'Disable Regeneration until Wendigo feeds' }, { hits: 5, text: 'Disable Regeneration permanently' }],
    abilities: [
      A('none', 'Regeneration', 'Persistent', 'At end of turn Heal (4)'),
      A('physical', 'Inhuman Speed', '1-3', 'Outflank (20) Attack (die)'),
      A('physical', 'Feed', '4-6', 'Lure (die, R4), Consume (die)'),
    ],
    evidence: { attack: 'M', observations: ['CM', 'IS', 'SD'], lair: 'HC' }, // card prints HS; the ref sheet says Inhuman Shriek
  },
  {
    id: 'banshee', name: 'Banshee', hp: 15, toughness: 2, badge: 1,
    traits: ['Corporeal', 'Fae'],
    note: 'While on rooftops, Banshee is outside Close range.',
    objective: 'Kill',
    weakness: ['iron', 'silver'], immune: [],
    weaknessTrack: [{ hits: 1, text: 'Grounded until next Perch' }, { hits: 3, text: 'Grounded until next Perch' }, { hits: null, text: 'Discard Silver to avoid Swoop damage', react: 'Swoop' }],
    abilities: [
      A('none', 'Perch', 'Persistent', 'Move to the rooftop nearest the player closest to the heirloom'),
      A('mental', 'Keen', '1-4', 'Area Attack (2 dice, R5). Only affects outdoor spaces'),
      A('physical', 'Swoop', '5-6', 'Immediately land adjacent to the nearest player and Attack (5)'),
    ],
    evidence: { attack: 'M', observations: ['CS', 'LT', 'IS'], lair: 'UG' },
  },
  {
    id: 'ushi-oni', name: 'Ushi-Oni', hp: 30, toughness: 5, badge: 1,
    traits: ['Corporeal', 'Demon'],
    note: 'End of turn: Move (10) toward Lair. Ignores walls; can’t cross salt. Seized players are at Death’s Door. Carried to Lair = killed.',
    objective: 'Kill',
    weakness: ['salt', 'holy'], immune: [],
    weaknessTrack: [{ hits: 1, text: '−1 toughness and drop player' }, { hits: 2, text: '−1 toughness and drop player' }, { hits: 3, text: '−1 toughness and drop player' }],
    abilities: [
      A('physical', 'Abduct', '1-3', 'Pursue (10) and Seize player'),
      A('physical', 'Run Down', '4-5', 'Trample (die, 5)'),
      A('spiritual', 'Miasma', '6', 'Area Attack (4, Rad 3)'),
    ],
    evidence: { attack: 'P', observations: ['OT', 'LT', 'WT'], lair: 'HC' },
  },
  {
    id: 'redcap', name: 'Redcap', hp: 9, toughness: 10, badge: 1,
    traits: ['Corporeal', 'Fae'],
    note: 'Piercing attacks can damage Redcap, but can’t land the killing blow.',
    objective: 'Kill',
    weakness: ['iron', 'holy'], immune: [],
    weaknessTrack: [{ hits: 1, text: '−3 HP, +1 die' }, { hits: 4, text: '−3 HP, +1 die' }, { hits: 8, text: '−3 HP' }],
    abilities: [
      A('physical', 'Chase', '1-3', 'Pursue (6) Attack (10)'),
      A('physical', 'Route', '4-6', 'Outflank (10) Attack (6)'),
    ],
    evidence: { attack: 'P', observations: ['FW', 'PB', 'MW'], lair: 'BR' },
  },
  {
    id: 'poltergeist', name: 'Poltergeist', hp: null, toughness: null, badge: 1,
    traits: ['Incorporeal', 'Spirit'],
    note: 'Has no physical body. Discard salt items inside targeted buildings to trigger its weakness.',
    objective: 'Destroy Anchors (Lair + 4 POI, die [6])',
    weakness: ['salt', 'iron'], immune: [],
    weaknessTrack: [{ hits: 1, text: 'Interrupt this turn' }, { hits: 2, text: 'Interrupt this turn' }, { hits: 3, text: 'Interrupt this turn' }],
    abilities: [
      A('mental', 'Torment', '1-3', 'Area Attack (die, nearest occupied building to Lair)'),
      A('physical', 'Heave', '4-6', 'Target (nearest player to Lair) and Pin (5)'),
    ],
    evidence: { attack: 'M', observations: ['CS', 'FW', 'LT'], lair: 'UR' },
  },
  {
    id: 'white-lady', name: 'White Lady', hp: null, toughness: null, badge: 1,
    traits: ['Incorporeal', 'Spirit'],
    note: 'If no occupied building is targeted, uses Infatuation (ignore die).',
    objective: 'Perform Ceremony ({3}, {7}, Lair → {9} + 3 ⌛)',
    weakness: ['salt', 'fire'], immune: ['iron'],
    weaknessTrack: [{ hits: 1, text: 'Trigger Regret' }, { hits: 3, text: 'Trigger Regret' }, { hits: 6, text: 'Trigger Regret, disable Wrath' }],
    abilities: [
      A('none', 'Infatuation', '1-3', 'Target & appear inside (occupied building nearest {9}), Block (all doors)'),
      A('physical', 'Wrath', '4-5', 'Target (least injured player inside), Attack (3 dice)'),
      A('mental', 'Regret', '6', 'Unblock (all doors), Area Attack (die, all players inside)'),
    ],
    evidence: { attack: 'M', observations: ['CS', 'WT', 'EV'], lair: 'UG' },
  },
  {
    id: 'strigoi', name: 'Strigoi', hp: 10, toughness: null, badge: 1,
    traits: ['Corporeal', 'Revenant'],
    note: 'Only damaged by the Blessed Cosor (Piercing die). Always targets the Cosor holder.',
    objective: 'Kill with the Blessed Cosor (Lair → {13} → {9} → Lair)',
    weakness: ['holy'], immune: [],
    weaknessTrack: [{ hits: null, text: 'Discard Holy to prevent Exhaust', react: 'exhaust' }],
    abilities: [
      A('spiritual', 'Drain', '1-3', 'Exhaust (defensive die) and Attack (die)'),
      A('spiritual', 'Charm', '4-5', 'Exhaust (movement die) and Attack (6)'),
      A('physical', 'Unholy Burn', '6', 'Drop (Cosor), Exhaust (all slotted dice) and Attack (4)'),
    ],
    evidence: { attack: 'S', observations: ['WR', 'IS', 'PB'], lair: 'UG' },
  },
  {
    id: 'adze', name: 'Adze', hp: 30, toughness: 3, badge: 3,
    // It stays in its cocoon in the Lair; its actions are carried out by fly
    // swarms that cross any terrain but not walls.
    body: 'cocoon', actsBy: 'swarm',
    traits: ['Corporeal', 'Intelligent'],
    note: 'Attacks target only NPCs. NPCs are Frail and can be Defended. On NPC death: Global Attack (die × ☠). No NPCs left: attacks are Global.',
    objective: 'Kill Nest (Lair)',
    weakness: ['fire', 'holy'], immune: ['crystal', 'salt', 'iron', 'silver'],
    weaknessTrack: [{ hits: 1, text: '−1 toughness' }, { hits: 3, text: '−1 toughness' }, { hits: 5, text: '−1 die' }],
    abilities: [
      A('spiritual', 'Hotel Victim', '1-2', 'Attack ({1}, die) and Exhaust (defensive die)'),
      A('spiritual', 'Bar Victim', '3-4', 'Attack ({5}, die) and Exhaust (defensive die)'),
      A('spiritual', 'Infirmary Victim', '5-6', 'Attack ({13}, die) and Exhaust (defensive die)'),
    ],
    evidence: { attack: 'S', observations: ['UI', 'FW', 'SL'], lair: 'TS' },
  },
  {
    id: 'shadow-people', name: 'Shadow People', hp: null, toughness: null, badge: 0,
    // No body: the darkness around players ripples; it only takes shape to
    // strike (Umbral Stab, when a player enters a lit space).
    body: 'none', onEnterLit: { kind: 'physical', dmg: 'die' },
    traits: ['Incorporeal', 'Darkness'],
    note: 'Has no singular body. Attacks erupt from lit spaces. Dark spaces smother lit objects. All defensive dice are exhausted upon use.',
    objective: 'Light the Dark Room ({11} → Lair × 4)',
    weakness: ['fire', 'crystal'], immune: ['salt', 'holy', 'iron', 'silver'],
    weaknessTrack: [{ hits: null, text: 'Discard Fire & avoid 1 attack', react: 'attack' }, { hits: null, text: 'Discard Fire & keep candle lit', react: 'candle' }, { hits: null, text: 'Discard Crystal & no light for ⌛' }],
    abilities: [
      A('physical', 'Umbral Stab', 'Persistent', 'Attack (die) any player each time they enter a lit space', { darkness: true }),
      A('none', 'Suffocating Darkness', 'Persistent', 'A player with a lit candle who stops in the dark flips a coin. Tails: extinguish'),
    ],
    evidence: { attack: 'M', observations: ['CS', 'FW', 'US'], lair: 'UD' },
  },
];

export const MONSTER_BY_ID = Object.fromEntries(MONSTER_CARDS.map((c) => [c.id, c]));

// Premade monster pools (Game settings). Difficulty levels come later.
export const MONSTER_POOLS = {
  all: { label: 'All monsters', ids: MONSTER_CARDS.map((c) => c.id) },
  corporeal: { label: 'Flesh and blood', ids: MONSTER_CARDS.filter((c) => c.traits.includes('Corporeal')).map((c) => c.id) },
  spirits: { label: 'Spirits and shadows', ids: MONSTER_CARDS.filter((c) => !c.traits.includes('Corporeal')).map((c) => c.id) },
  folklore: { label: 'Old-world folklore', ids: ['banshee', 'redcap', 'ushi-oni', 'strigoi', 'adze', 'white-lady', 'barghest'] },
};
