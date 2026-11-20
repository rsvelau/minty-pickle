// Evidence: the codes printed on the monster cards, what they're called, and
// which board transformation each one leaves on the cell where it's found.
//
// `provisional: true` marks a name guessed from the code alone; confirm or
// correct it here and every screen updates.
//
// visual: the look painted onto the cell (src/discoveries.js). Lairs change
// their cell permanently and much more strongly.

export const ATTACK_TYPES = {
  P: { label: 'Physical', colour: '#c4141f', visual: 'struggle' },
  M: { label: 'Mental', colour: '#4a7ad8', visual: 'psychic' },
  S: { label: 'Spiritual', colour: '#3fae5a', visual: 'ectoplasm' },
};

export const OBSERVATIONS = {
  CS: { label: 'Cold Spots', visual: 'frost' },
  SH: { label: 'Strange Howls', visual: 'howl' },
  CM: { label: 'Claw Marks', visual: 'claws' },
  MW: { label: 'Mutilated Wildlife', visual: 'carcass', provisional: true },
  DT: { label: 'Dark Tracks', visual: 'tracks', provisional: true },
  SS: { label: 'Sulfur Smell', visual: 'sulfur', provisional: true },
  SD: { label: 'Strange Disappearances', visual: 'scattered', provisional: true },
  ES: { label: 'Eerie Silence', visual: 'withered', provisional: true },
  HS: { label: 'Hunger Signs', visual: 'bones', provisional: true },
  LT: { label: 'Lights Tampered', visual: 'sparks', provisional: true },
  IS: { label: 'Insomnia', visual: 'static', provisional: true },
  OT: { label: 'Odd Tremors', visual: 'cracks', provisional: true },
  WT: { label: 'Wet Trails', visual: 'puddles', provisional: true },
  FW: { label: 'Faint Whispers', visual: 'whispers', provisional: true },
  PB: { label: 'Pooled Blood', visual: 'blood', provisional: true },
  EV: { label: 'EVP Voices', visual: 'static', provisional: true },
  WR: { label: 'Withered Roses', visual: 'withered', provisional: true },
  UI: { label: 'Unexplained Illness', visual: 'sickness', provisional: true },
  SL: { label: 'Swarming Lights', visual: 'motes', provisional: true },
  US: { label: 'Unnatural Shadows', visual: 'shadow', provisional: true },
};

export const LAIRS = {
  TS: { label: 'Transformation Site', visual: 'scorched' },
  UG: { label: 'Uncovered Grave', visual: 'grave' },
  HC: { label: 'Hidden Cave', visual: 'cave', provisional: true },
  OR: { label: 'Occult Ritual Site', visual: 'ritual', provisional: true },
  BR: { label: 'Blood-Soaked Ruin', visual: 'ruin', provisional: true },
  UR: { label: 'Unsettled Room', visual: 'room', provisional: true },
  UD: { label: 'Unlit Depths', visual: 'pit', provisional: true },
};

export const evidenceLabel = (kind, code) =>
  (kind === 'lair' ? LAIRS[code]?.label : kind === 'attack' ? ATTACK_TYPES[code]?.label : OBSERVATIONS[code]?.label) ?? code;
export const evidenceVisual = (kind, code) =>
  (kind === 'lair' ? LAIRS[code]?.visual : kind === 'attack' ? ATTACK_TYPES[code]?.visual : OBSERVATIONS[code]?.visual) ?? 'sigil';
