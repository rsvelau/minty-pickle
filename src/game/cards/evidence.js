// Evidence: the codes printed on the monster cards, what they're called, and
// which board transformation each one leaves on the cell where it's found.
//
// Names from the Monster Ref Sheet (Monsters_and_Injuries spreadsheet).
//
// visual: the look painted onto the cell (src/discoveries.js). Lairs change
// their cell permanently and much more strongly.

export const ATTACK_TYPES = {
  P: { label: 'Physical', colour: '#c4141f', visual: 'struggle' },
  M: { label: 'Mental', colour: '#4a7ad8', visual: 'psychic' },
  S: { label: 'Spiritual', colour: '#3fae5a', visual: 'ectoplasm' },
};

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
