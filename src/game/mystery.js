// The mystery: which monster is out there, and the evidence that gives it away.
//
// At the start of a game one monster is drawn (seeded) from the chosen pool and
// kept secret. Its four Evidence cards (3 Observations + 1 Lair) are shuffled
// face down; its Attack card is separate.
//   - Evidence Obol: the investigator chooses one of the face-down cards; it
//     flips for everyone, and the cell they stand on changes to show it.
//   - Attack Obol: the monster strikes the investigator for one die of
//     damage; the first time, its Attack card (Physical / Mental / Spiritual)
//     flips for everyone.
//   - Before midnight the team may name the monster once (Field Guide). A
//     correct name earns Initiative: the spawn cell is marked and the
//     objective markers show early.
//   - At midnight the monster is revealed and appears at its spawn cell.
//
// Everything secret lives in state.mystery; publicState() strips it, so a
// multiplayer host can send each phone only what the players know.
import { monsterAvailability } from './objectives/scripts.js';
import { MONSTER_BY_ID, MONSTER_POOLS } from './cards/monsters.js';
import { ATTACK_TYPES, evidenceLabel } from './cards/evidence.js';
import { applyDamage } from './combat.js';

// Monsters consistent with the evidence found so far.
export function matchesEvidence(card, found) {
  const ev = card.evidence;
  if (found.attack && found.attack !== ev.attack) return false;
  for (const f of found.cards) {
    if (f.kind === 'lair' ? f.code !== ev.lair : !ev.observations.includes(f.code)) return false;
  }
  return true;
}

// Investigation spots nobody has used yet (on walkable cells).
function openSpots(state, board) {
  const out = [];
  board.grid.cells.forEach((c, i) => {
    if (c.marker === 'investigation' && c.walkable && !state.used?.includes(i)) out.push(i);
  });
  return out;
}
// Keep `current` if it's still an open spot, else draw one at random.
function lairSpot(state, board, randInt, current) {
  const spots = openSpots(state, board);
  if (!spots.length) return null;
  return spots.includes(current) ? current : spots[randInt(state, spots.length)];
}

export function setupMystery(state, board, { random, randInt, farthestCell }) {
  // The pool, minus monsters taken out in Settings → Cards in the game (if any are left).
  // Monsters whose objectives need sites this map lacks are disabled here.
  const { available } = monsterAvailability(board.grid);
  const all = (MONSTER_POOLS[state.config.monsterPool] ?? MONSTER_POOLS.all).ids.filter((id) => MONSTER_BY_ID[id]);
  const base = all.filter((id) => available.includes(id)).length ? all.filter((id) => available.includes(id)) : available;
  const kept = base.filter((id) => state.config.deckCounts?.[`monsters:${id}`] !== 0);
  const pool = kept.length ? kept : base;
  // A specific monster (Game settings, for testing), else a random one from the pool.
  const pick = MONSTER_BY_ID[state.config.monsterPick] && available.includes(state.config.monsterPick) ? state.config.monsterPick : null;
  const id = pick ?? pool[randInt(state, pool.length)];
  if (pick && !pool.includes(pick)) pool.push(pick);
  const card = MONSTER_BY_ID[id];
  const deck = [...card.evidence.observations.map((code) => ({ kind: 'observation', code })), { kind: 'lair', code: card.evidence.lair }];
  for (let i = deck.length - 1; i > 0; i--) { const j = randInt(state, i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  state.mystery = {
    monster: id,          // secret until midnight
    pool,                 // the monsters it could be (the Field Guide's list)
    deck,                 // face-down evidence, in a fixed (shuffled) order
    flipped: [],          // indices of deck cards turned over
    found: [],            // [{ kind, code, cell, seat, time }] in order found
    attack: null,         // { code, cell, seat, time } once the Attack card shows
    // Where it will rise: the Lair once found; until then, the undiscovered
    // investigation spot that would become the Lair at midnight.
    spawnCell: lairSpot(state, board, randInt, -1) ?? farthestCell(),
    guess: null,          // { id, seat, correct }
    initiative: false,
    revealed: false,      // midnight has come: the monster is known
    pendingReveal: null,  // { cell } while an investigator chooses a card
  };
  void random;
}

// What everyone may see (secrets hidden until they're found).
export function publicState(state) {
  const s = structuredClone(state);
  s.rng = 0; // the dice generator would let a phone predict draws
  const m = s.mystery;
  if (m) {
    if (!m.revealed && !m.identified) m.monster = null;
    m.deck = m.deck.map((c, i) => (m.flipped.includes(i) ? c : null));
    if (!m.initiative && !m.revealed && !m.identified) m.spawnCell = -1;
  }
  return s;
}

const label = (board, i, cellLabel) => { const { x, y } = board.grid.coords(i); return cellLabel(x, y); };

// The investigator drew an Evidence Obol: ask them to choose a card.
export function evidenceObol(state, board, cell, ctx) {
  const m = state.mystery;
  if (!m) return false;
  if (m.flipped.length >= m.deck.length) {
    ctx.log(state, 'Every piece of evidence has already been found.');
    return false;
  }
  m.pendingReveal = { cell };
  return true;
}

// Turn over face-down card `index` for the current player.
export function revealEvidence(state, board, index, ctx, events) {
  const m = state.mystery;
  const cell = m.pendingReveal.cell;
  const card = m.deck[index];
  m.flipped.push(index);
  m.pendingReveal = null;
  const pl = state.players[state.cur];
  const entry = { kind: card.kind, code: card.code, cell, seat: pl.seat, time: ctx.time() };
  m.found.push(entry);
  if (card.kind === 'lair') m.spawnCell = cell; // it will rise here
  ctx.log(state, `${pl.name} found evidence at ${label(board, cell, ctx.cellLabel)}: ${evidenceLabel(card.kind, card.code)}` +
    `${card.kind === 'lair' ? ' (the Lair)' : ''}.`);
  events.push({ type: 'evidence', seat: pl.seat, cell, kind: card.kind, code: card.code, index });
  identify(state, ctx, events);
}

// All five pieces of evidence (the three Observations, the Lair and the
// Attack card) identify the monster before midnight: its objectives appear
// and work can start on them (objectives/scripts.js knownMonster).
function identify(state, ctx, events) {
  const m = state.mystery;
  if (!m || m.revealed || m.identified || m.flipped.length < m.deck.length || !m.attack) return;
  m.identified = true;
  ctx.log(state, `All the evidence is in: it's the ${MONSTER_BY_ID[m.monster].name}. Its objectives are marked.`);
  events.push({ type: 'identified', monster: m.monster });
}

// The monster strikes an investigator (Attack Obol): one die of damage of
// its Attack type, and the Attack card flips the first time.
export function attackObol(state, board, cell, ctx, events) {
  const m = state.mystery;
  if (!m) return;
  const card = MONSTER_BY_ID[m.monster];
  const type = card.evidence.attack;
  const pl = state.players[state.cur];
  const amount = 1 + ctx.randInt(state, 6);
  const first = !m.attack;
  if (first) {
    m.attack = { code: type, cell, seat: pl.seat, time: ctx.time() };
    m.found.push({ kind: 'attack', code: type, cell, seat: pl.seat, time: ctx.time() });
  }
  if (first) ctx.log(state, `Something attacks ${pl.name} at ${label(board, cell, ctx.cellLabel)}. The Attack card is revealed: ${ATTACK_TYPES[type].label}.`);
  // One die of damage against their slotted defense.
  const outcome = applyDamage(state, board, pl, type, amount, { log: ctx.log, source: 'Something unseen' }, events);
  events.push({ type: 'attacked', seat: pl.seat, cell, attack: type, amount, first, outcome, defense: events.at(-1)?.defense ?? 0 });
  if (first) identify(state, ctx, events);
}

// The team names the monster (once, before midnight).
export function nameMonster(state, id, ctx, events) {
  const m = state.mystery;
  if (!m || m.revealed) return 'too late';
  if (m.guess) return 'already named';
  if (!m.pool.includes(id)) return 'not in the field guide';
  const pl = state.players[state.cur];
  const correct = id === m.monster;
  m.guess = { id, seat: pl.seat, correct };
  m.initiative = correct;
  const name = MONSTER_BY_ID[id].name;
  ctx.log(state, correct
    ? `${pl.name} names it: the ${name}. Correct. Initiative! Its spawn point is marked (its objectives appear with all the evidence, or at midnight).`
    : `${pl.name} names it: the ${name}. The signs don't fit. No Initiative this time.`);
  events.push({ type: 'named', seat: pl.seat, monster: id, correct, spawnCell: correct ? m.spawnCell : -1 });
  return null;
}

// Midnight: the monster is revealed.
export function revealMonster(state, board, ctx, events) {
  const m = state.mystery;
  if (!m || m.revealed) return;
  // The Lair: where it was found; if still hidden, an undiscovered
  // investigation spot becomes the Lair (its card turns over there).
  const lair = m.found.find((f) => f.kind === 'lair');
  if (lair) m.spawnCell = lair.cell;
  else {
    const spot = lairSpot(state, board, ctx.randInt, m.spawnCell);
    const index = m.deck.findIndex((c) => c.kind === 'lair');
    if (spot !== null && index >= 0) {
      m.spawnCell = spot;
      m.flipped.push(index);
      state.used.push(spot);
      const code = m.deck[index].code;
      m.found.push({ kind: 'lair', code, cell: spot, seat: null, time: ctx.time() });
      ctx.log(state, `The Lair reveals itself at ${label(board, spot, ctx.cellLabel)}: ${evidenceLabel('lair', code)}.`);
      events.push({ type: 'evidence', seat: null, cell: spot, kind: 'lair', code, index, midnight: true });
    }
  }
  m.revealed = true;
  const card = MONSTER_BY_ID[m.monster];
  if (!card) return;   // a dry run on the players' view (the monster is hidden there): nothing to say
  ctx.log(state, `It's the ${card.name}.`);
  events.push({ type: 'monsterRevealed', monster: m.monster, correct: !!m.guess?.correct });
}
