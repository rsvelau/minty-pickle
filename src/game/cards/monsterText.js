// How each monster card reads in the game (Field Guide, the card when it is
// revealed): plain wording with icons. The rules read the card text in
// monsters.js (ability `text`, weakness track `text`, `objective`); this file
// is only what players see, so rewording here never changes how a monster
// plays.
//
// Tokens, drawn as icons (src/play/panels.js monsterCardHTML):
//   🎲         one die of damage (🎲🎲 two dice...)
//   {move}     movement (spaces)          {heal}  heals
//   {exhaust}  exhausted: the die is gone for the rest of the game
//   {area}     everyone within a radius   {round} one round (⌛)
//   {P} {M} {S} Physical, Mental, Spiritual damage
//   {9}        a numbered site on the map (the Church): shown with its name
//
//   rules       constant rules, one short line each; or { h, items } for a
//               labelled block of them
//   solo        extra rules when playing solo (a block of their own)
//   abilityNote one line under the abilities, for them all
//   abilityRows the abilities as one short row each (roll · name · says)
//   goal        the objective, as players read it
//   says        ability name -> what it does
//   track       one line per weakness-track step, in order

export const MONSTER_TEXT = {
  werewolf: {
    rules: ['Moves at half speed indoors.'],
    goal: 'Kill it: wear its health down to 0.',
    says: {
      'Vicious Pursuit': '{move} 8 toward the nearest player, then attacks for 4.',
      'Terrifying Howl': '{area} Everyone within 3 spaces takes 4.',
      'Lick Wounds': '{move} 5 away from everyone, then {heal} heals 6.',
    },
    track: ['−2 toughness', 'One fewer action die', 'Terrifying Howl is disabled'],
  },
  barghest: {
    rules: [
      'Starts at the town entrance and can’t enter buildings.',
      'Death Gaze sees in straight lines; walls, doors and buildings block it (windows don’t).',
      'At midnight every investigator is Corrupted: cleanse at the Church {9} before crossing the river.',
    ],
    goal: 'Escape: get cleansed at the Church {9}, then reach the Start space. One investigator escaping wins for the team.',
    says: {
      'Death Gaze': 'End of its turn: attacks for 10 everyone it can see.',
      Stalk: '{move} 5 toward the nearest player.',
      'Shadow Trap': 'Vanishes to the nearest light source and springs a trap there: everyone beside it takes 🎲🎲. Gone before the players act again.',
    },
    track: ['Death Gaze stops for {round}', 'Death Gaze stops for {round}', 'Shadow Trap is disabled'],
  },
  hellhounds: {
    rules: [
      'A pack: destroyed hounds rise again at the Lair until the ritual is disrupted.',
      'A Pinned player can’t move on their next turn.',
    ],
    goal: 'Disrupt the ritual: carry holy water from the Church {9} to the Lair, then destroy the pack.',
    says: {
      'Demonic Fire': 'Their attacks ignore your lowest Defense die.',
      Harrow: '{move} 5 toward the nearest player, then attacks for 3.',
      Pin: '{move} 5, then attacks for 5. If it gets through, that player is Pinned.',
    },
    track: ['One fewer action die', 'One fewer action die', 'One fewer action die'],
  },
  skinwalker: {
    rules: [
      'Steps around traps.',
      'Once a game, the first investigator to reach its Lair stuns it: it skips its next turn, toughness 0 until then.',
    ],
    goal: 'Kill it: wear its health down to 0.',
    says: {
      'Wolf Prowl': '{move} 15 around to the nearest player, then attacks for 🎲.',
      'Bear Maul': '{move} 5, then attacks for 🎲. If it gets through, they’re dragged up to 5 spaces into the nearest building.',
      'Curseblood Ritual': 'Returns to its Lair and marks a ritual. At the 3rd mark everyone takes 10, and the count starts over.',
    },
    track: ['The ritual count goes back to 0', '−2 toughness', 'Curseblood Ritual is disabled'],
  },
  wendigo: {
    rules: ['Steps around traps.', 'Consume heals it for all the damage that gets through.'],
    goal: 'Kill it: wear its health down to 0.',
    says: {
      Regeneration: 'End of its turn: {heal} heals 4.',
      'Inhuman Speed': '{move} 20 around to the nearest player, then attacks for 🎲.',
      Feed: 'Lures everyone within 4 spaces toward it, all by the same 🎲 spaces. Then everyone in Close range is Consumed for 🎲.',
    },
    track: ['Regeneration stops until a Consume lands', 'Regeneration stops until a Consume lands', 'Regeneration stops for good'],
  },
  banshee: {
    rules: [
      'On a rooftop (any real building) she is out of Close range.',
      'The heirloom, a signed ring, lies at the Funeral Parlor {11}: carry it or set it down to draw her where you want.',
    ],
    goal: 'Kill her: wear her health down to 0. Or bring the heirloom to the Unmarked Grave in the cemetery: she is defeated at once.',
    says: {
      Perch: 'End of her turn: flies to the rooftop nearest the player closest to the heirloom.',
      Keen: '{area} Everyone outdoors within 5 spaces takes 🎲🎲.',
      Swoop: 'Lands beside the nearest player and attacks for 5.',
    },
    track: ['Grounded until it Perches again', 'Grounded until it Perches again', 'Discard Silver: no damage from a Swoop'],
  },
  'ushi-oni': {
    rules: [
      'End of its turn: {move} 10 toward its Lair, straight through walls. Salt stops it.',
      'A Seized player is at Death’s Door and can’t move. Get damage through its defense to break free.',
      'Carried into its Lair, they die at the end of the round.',
    ],
    goal: 'Kill it: wear its health down to 0.',
    says: {
      Abduct: '{move} 10 toward the nearest player, then attacks for 🎲🎲. If it gets through, they’re Seized.',
      'Run Down': 'Charges {move} 5 at the nearest player, straight through them and on. Everyone in its path takes 🎲.',
      Miasma: '{area} Everyone within 3 spaces takes 4.',
    },
    track: ['−1 toughness; drops whoever it carries', '−1 toughness; drops whoever it carries', '−1 toughness; drops whoever it carries'],
  },
  redcap: {
    rules: ['Piercing attacks (the ones that ignore toughness) can hurt it, but can’t land the killing blow: it clings on at 1.'],
    goal: 'Kill it: wear its health down to 0.',
    says: {
      Chase: '{move} 6 toward the nearest player, then attacks for 10.',
      Route: '{move} 10 around to the nearest player, then attacks for 6.',
    },
    track: ['−3 health, but one more action die', '−3 health, but one more action die', '−3 health'],
  },
  poltergeist: {
    rules: [
      'No body: only its anchors can be destroyed.',
      'Discard Salt inside the building it targets to hit its weakness.',
    ],
    goal: 'Destroy the anchors: stop on 4 Objective markers with a 6 to break their anchors, then break the last one at the Lair.',
    says: {
      Torment: '{area} Everyone in the occupied building nearest its Lair takes 🎲.',
      Heave: 'Attacks the player nearest its Lair for 5. If it gets through, that player is Pinned.',
    },
    track: ['Its turn ends at once', 'Its turn ends at once', 'Its turn ends at once'],
  },
  'white-lady': {
    rules: ['If no one is inside her building, she uses Infatuation, whatever the die says.'],
    goal: 'Set her soul free: bring the Wedding Gown (Boutique {3}), the Ring (Curio Shop {7}) and the Finger Bone (Funeral Parlor {11}) to the Church {9}, then keep someone in the Church for 3 rounds.',
    says: {
      Infatuation: 'Appears inside the occupied building nearest the Church {9} and slams every door shut.',
      Wrath: 'Attacks the least injured player inside for 🎲🎲🎲.',
      Regret: 'Opens the doors she shut; everyone inside takes 🎲.',
    },
    track: ['Regret strikes at once', 'Regret strikes at once', 'Regret strikes at once; Wrath is disabled'],
  },
  strigoi: {
    rules: [
      'Only the Blessed Cosor hurts it: Strike from Close range, once a turn, for one of your dice. Toughness doesn’t count.',
      'Drain and Unholy Burn find the Cosor holder anywhere. With no holder, they hit whoever is beside it.',
    ],
    goal: 'Kill it with the Blessed Cosor: take the Cosor from its Lair, sharpen it at the Outdoor Store {12}, bless it at the Church {9}, then strike.',
    says: {
      Drain: 'Attacks the Cosor holder for 🎲, then {exhaust} their best Defense die.',
      Charm: '{area} Everyone within 8 spaces takes 4. Anyone hurt is pulled 4 spaces toward it and {exhaust} every Defense die.',
      'Unholy Burn': 'Attacks the Cosor holder for 4. They drop the Cosor, and can’t move or pick it up next turn.',
    },
    track: ['Discard Holy: cancel an Exhaust'],
  },
  adze: {
    rules: [
      'Never leaves its Nest at the Lair. Its fly swarms attack only the victims.',
      { h: 'Victims', items: [
        'Appear once you know it’s the Adze (or at midnight). One per investigator, up to 3.',
        'Stand beside one to Defend them.',
        '1st hit through: wounded. 2nd: dead.',
        'One dies: everyone takes 🎲 × dead victims. All dead: every attack hits everyone.',
      ] },
      { h: 'Swarms', items: [
        '{move} 6 a turn. Only walls stop them. One per victim.',
        'The turn the Adze rises, they only gather.',
        'Settles beside its victim → strikes for 🎲 on the next turn.',
        'Gets past the defender → {exhaust} their Defense die.',
      ] },
      { h: 'Hurting the Nest', items: [
        '🔥 Fire a swarm to 0 (5 health): it flies home alight. Nest takes 3.',
        '🛡 Block a swarm: Nest takes 2.',
        'Both ignore its toughness.',
      ] },
    ],
    solo: ['All 3 victims in the Hospital {13}.', 'One swarm at a time, 2 health.', 'A failed block exhausts nothing.', 'The Nest has no toughness.'],
    goal: 'Kill the Nest. Keep the victims at the Hotel {1}, Bar {5} and Hospital {13} alive.',
    says: { 'Hotel Victim': 'Hotel {1}', 'Bar Victim': 'Bar {5}', 'Infirmary Victim': 'Hospital {13}' },
    // The three abilities differ only in whom the swarm goes for: one short row each.
    abilityRows: true,
    abilityNote: 'A swarm sets out for that victim (dead or already hunted: another).',
    track: ['−1 toughness', '−1 toughness', 'One fewer action die'],
  },
  'shadow-people': {
    rules: [
      'No single body: it fills all the darkness on the map.',
      'Every Defense die is exhausted once it is used.',
      'A lit candle gives its carrier +1 Defense.',
      'Candles never go out inside the Church; starting or ending your turn on the candle stand relights yours.',
      'The Missing-person memorials (blue flags) relight a candle too, for an Obol: passing one, or on your turn beside one.',
    ],
    goal: 'Light the Dark Room: carry lit candles from the Church {9} to the Lair, one per investigator.',
    says: {
      'Umbral Stab': 'Attacks for 🎲 the first time a player steps into a lit space on each move.',
      'Suffocating Darkness': 'A player with a lit candle who ends their turn in the dark flips a coin. Tails: it goes out.',
    },
    track: ['Discard Fire: avoid one attack', 'Discard Fire: keep a candle lit', 'Discard Crystal: lit spaces are safe until your next turn'],
  },
};
