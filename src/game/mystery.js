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
import { MONSTER_BY_ID, MONSTER_POOLS } from './cards/monsters.js';
import { ATTACK_TYPES, evidenceLabel } from './cards/evidence.js';

// Monsters consistent with the evidence found so far.
export function matchesEvidence(card, found) {
  const ev = card.evidence;
  if (found.attack && found.attack !== ev.attack) return false;
  for (const f of found.cards) {
    if (f.kind === 'lair' ? f.code !== ev.lair : !ev.observations.includes(f.code)) return false;
  }
  return true;
}

export function setupMystery(state, board, { random, randInt, farthestCell }) {
  const pool = (MONSTER_POOLS[state.config.monsterPool] ?? MONSTER_POOLS.all).ids.filter((id) => MONSTER_BY_ID[id]);
  const id = pool[randInt(state, pool.length)];
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
    spawnCell: farthestCell(),
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
    if (!m.revealed) m.monster = null;
    m.deck = m.deck.map((c, i) => (m.flipped.includes(i) ? c : null));
    if (!m.initiative && !m.revealed) m.spawnCell = -1;
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
  ctx.log(state, `${pl.name} found evidence at ${label(board, cell, ctx.cellLabel)}: ${evidenceLabel(card.kind, card.code)}` +
    `${card.kind === 'lair' ? ' (the Lair)' : ''}.`);
  events.push({ type: 'evidence', seat: pl.seat, cell, kind: card.kind, code: card.code, index });
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
  pl.damage ??= { P: 0, M: 0, S: 0 };
  pl.damage[type] += amount;
  const first = !m.attack;
  if (first) {
    m.attack = { code: type, cell, seat: pl.seat, time: ctx.time() };
    m.found.push({ kind: 'attack', code: type, cell, seat: pl.seat, time: ctx.time() });
  }
  ctx.log(state, `Something attacks ${pl.name} at ${label(board, cell, ctx.cellLabel)}: ${amount} ${ATTACK_TYPES[type].label} damage` +
    `${first ? `. The Attack card is revealed: ${ATTACK_TYPES[type].label}.` : '.'}`);
  events.push({ type: 'attacked', seat: pl.seat, cell, attack: type, amount, first });
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
    ? `${pl.name} names it: the ${name}. Correct. Initiative! Its spawn point and the objectives are marked.`
    : `${pl.name} names it: the ${name}. The signs don't fit. No Initiative this time.`);
  events.push({ type: 'named', seat: pl.seat, monster: id, correct, spawnCell: correct ? m.spawnCell : -1 });
  return null;
}

// Midnight: the monster is revealed.
export function revealMonster(state, ctx, events) {
  const m = state.mystery;
  if (!m || m.revealed) return;
  m.revealed = true;
  const card = MONSTER_BY_ID[m.monster];
  ctx.log(state, `It's the ${card.name}.`);
  events.push({ type: 'monsterRevealed', monster: m.monster, correct: !!m.guess?.correct });
}
