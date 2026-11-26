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
//   rules       constant rules, one short line each
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
      'It never leaves its Lair: fly swarms do its attacks, only at the townspeople (victims).',
      'The victims show as soon as you know it’s the Adze (or at midnight). The turn it rises, its swarms only gather.',
      'Its swarms fly {move} 6 a turn (walls stop them, nothing else), one per victim at a time. A swarm settles beside its victim and strikes on the Adze’s next turn.',
      'A Fire attack of 5+ on a swarm sets it alight: it flies back to the hive and burns the Nest for 3, through its toughness.',
      'A victim survives the first hit that gets through (wounded); the second kills them. Stand beside one to Defend them.',
      'A victim dies: everyone takes 🎲 × the number of dead victims. No victims left: every attack hits everyone.',
    ],
    goal: 'Kill the Nest at its Lair, while defending the victims at the Hotel {1}, the Bar {5} and the Hospital {13}.',
    says: {
      'Hotel Victim': 'A swarm sets out for the Hotel {1} victim (or another no swarm is after); settled beside them, it attacks for 🎲 the next turn. Whoever defends them: {exhaust} a Defense die.',
      'Bar Victim': 'A swarm sets out for the Bar {5} victim (or another no swarm is after); settled beside them, it attacks for 🎲 the next turn. Whoever defends them: {exhaust} a Defense die.',
      'Infirmary Victim': 'A swarm sets out for the Hospital {13} victim (or another no swarm is after); settled beside them, it attacks for 🎲 the next turn. Whoever defends them: {exhaust} a Defense die.',
    },
    track: ['−1 toughness', '−1 toughness', 'One fewer action die'],
  },
  'shadow-people': {
    rules: [
      'No single body: it fills all the darkness on the map.',
      'Every Defense die is exhausted once it is used.',
    ],
    goal: 'Light the Dark Room: carry lit candles from the Church {9} to the Lair. 4 candles (2 with one or two players).',
    says: {
      'Umbral Stab': 'Attacks for 🎲 whenever a player steps into a lit space.',
      'Suffocating Darkness': 'A player with a lit candle who stops in the dark flips a coin. Tails: it goes out.',
    },
    track: ['Discard Fire: avoid one attack', 'Discard Fire: keep a candle lit', 'Discard Crystal: lit spaces are safe until your next turn'],
  },
};
