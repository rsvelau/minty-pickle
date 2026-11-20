// Evidence: the codes printed on the monster cards, what they're called, and
// which board transformation each one leaves on the cell where it's found.
//
// Names from the Monster Ref Sheet (Monsters_and_Injuries spreadsheet).
//
// visual: the look painted onto the cell (src/discoveries.js). Lairs change
// their cell permanently and much more strongly.

// Damage types and their theme: Physical is red, Mental blue, Spiritual
// green, everywhere (cards, banners, rings, injuries, flashes, board marks).
// The icons match the action symbols on the monster cards.
export const ATTACK_TYPES = {
  P: { label: 'Physical', colour: '#d42a2a', soft: '#ff8a7a', dark: '#5a0e10', visual: 'struggle', icon: 'claws' },
  M: { label: 'Mental', colour: '#3a7ae0', soft: '#8ab8ff', dark: '#0e2450', visual: 'psychic', icon: 'brain' },
  S: { label: 'Spiritual', colour: '#2fb04a', soft: '#8ae89a', dark: '#0c3a16', visual: 'ectoplasm', icon: 'skull' },
};
export const KIND_TO_TYPE = { physical: 'P', mental: 'M', spiritual: 'S' };

export const OBSERVATIONS = {
  CM: { label: 'Claw Marks', visual: 'claws' },
  MW: { label: 'Mangled Window', visual: 'glass' },
  SH: { label: 'Strange Howl', visual: 'howl' },
  SS: { label: 'Sulfurous Smell', visual: 'sulfur' },
  IS: { label: 'Inhuman Shriek', visual: 'shriek' },
  SD: { label: 'Signs of Distress', visual: 'scattered' },
  CS: { label: 'Cold Spot', visual: 'frost' },
  LT: { label: 'Lingering Terror', visual: 'terror' },
  ES: { label: 'Esoteric Symbols', visual: 'symbols' },
  DT: { label: 'Distant Thunder', visual: 'lightning' },
  OT: { label: 'Odd Tracks', visual: 'tracks' },
  WT: { label: 'Wet Trail', visual: 'puddles' },
  FW: { label: 'Feeling of Being Watched', visual: 'eyes' },
  UI: { label: 'Unexplained Illness', visual: 'sickness' },
  SL: { label: 'Severe Lethargy', visual: 'lethargy' },
  PB: { label: 'Pooling Blood', visual: 'blood' },
  US: { label: 'Uncanny Shadows', visual: 'shadow' },
  EV: { label: 'Echoing Voices', visual: 'whispers' },
  WR: { label: 'Withered Remains', visual: 'remains' },
};

export const LAIRS = {
  TS: { label: 'Transformation Site', visual: 'scorched' },
  OR: { label: 'Occult Ritual', visual: 'ritual' },
  HC: { label: 'Hidden Cavern', visual: 'cave' },
  UG: { label: 'Uncovered Grave', visual: 'grave' },
  UD: { label: 'Unnaturally Dark Room', visual: 'pit' },
  UR: { label: 'Unsettling Room', visual: 'room' },
  BR: { label: 'Bloodstained Room', visual: 'ruin' },
};

export const evidenceLabel = (kind, code) =>
  (kind === 'lair' ? LAIRS[code]?.label : kind === 'attack' ? ATTACK_TYPES[code]?.label : OBSERVATIONS[code]?.label) ?? code;
export const evidenceVisual = (kind, code) =>
  (kind === 'lair' ? LAIRS[code]?.visual : kind === 'attack' ? ATTACK_TYPES[code]?.visual : OBSERVATIONS[code]?.visual) ?? 'sigil';
