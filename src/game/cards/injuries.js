// Injuries, from the Player Mat (Monsters_and_Injuries spreadsheet).
//
// Three tracks: Physical, Mental, Spiritual. Each has three tiers; tiers are
// additive (tier 2 keeps tier 1's effect), and a player can carry tiers on
// several tracks at once. Tier 3 on any track is Death's Door: only one die
// per turn, and any unblocked damage kills.
export const INJURY_TRACKS = {
  P: {
    label: 'Physical',
    tiers: [
      { name: 'Sprained', text: 'Place one Attunement die in reserve', colour: '#f0c030' },
      { name: 'Hobbled', text: 'Lose use of one movement slot', colour: '#f07a20' },
      { name: 'Death’s Door', text: 'Can only roll one die per turn. Any unblocked damage will kill you', colour: '#d0202a' },
    ],
  },
  M: {
    label: 'Mental',
    tiers: [
      { name: 'Paranoid', text: 'Lose use of one Defense slot', colour: '#f0c030' },
      { name: 'Terrified', text: 'Teammates within Mid range lose use of one Defense slot', colour: '#f07a20' },
      { name: 'Death’s Door', text: 'Can only roll one die per turn. Any unblocked damage will kill you', colour: '#d0202a' },
    ],
  },
  S: {
    label: 'Spiritual',
    tiers: [
      { name: 'Doomed', text: 'Defense dice showing 6 count as 1', colour: '#f0c030' },
      { name: 'Hexed', text: 'Slotting a die of 4 or less into an item breaks it', colour: '#f07a20' },
      { name: 'Death’s Door', text: 'Can only roll one die per turn. Any unblocked damage will kill you', colour: '#d0202a' },
    ],
  },
};
export const DEATHS_DOOR = 3;
// Range bands in cells (walking distance). Close is the same or a next cell.
export const RANGE = { close: 1, mid: 3, long: 6 };
