// Weakness discards played at the moment it happens (the ∞ entries on a
// monster's weakness track marked `react`): the Banshee's Swoop damage
// (Silver), the Strigoi's Exhaust (Holy), a Shadow People attack (Fire).
//
// The hit is played as usual, then, if it did something to the player and
// they carry an item of that element, the game waits for them to answer (the
// 'react' action in rules.js): discard it and the hit is undone (injuries,
// a death, exhausted dice, the defense it wore off), or keep the item.
// A hit that would kill leaves the player down ('dying') until they answer.
import { EQUIPMENT_BY_ID } from './cards/equipment.js';
import { MONSTER_BY_ID, DAMAGE_KINDS } from './cards/monsters.js';

const ELEMENTS = Object.fromEntries(Object.entries(DAMAGE_KINDS).map(([k, v]) => [v.label.toLowerCase(), k]));

// The monster's `react` entry for `what` ('exhaust', 'attack' or an ability
// name): { kind, text }, or null.
export function reactionFor(monster, what) {
  const card = MONSTER_BY_ID[monster?.kind];
  const w = card?.weaknessTrack.find((t) => t.hits === null && t.react === what);
  const kind = w && ELEMENTS[/Discard (\w+)/i.exec(w.text)?.[1]?.toLowerCase()];
  return kind ? { kind, text: w.text } : null;
}
// Indices of the player's Equipment with a skill of that element.
export const itemsOfKind = (pl, kind) => pl.inventory.equipment.map((it, i) => (EQUIPMENT_BY_ID[it.id]?.abilities.some((a) => a.kind === kind) ? i : -1)).filter((i) => i >= 0);

// What a hit can change on its player (and the defense teammates lent).
const FIELDS = ['injuries', 'defenseUsed', 'dead', 'dying', 'tossed', 'lostBlack', 'defense', 'lastMove'];
const pick = (pl) => structuredClone(Object.fromEntries(FIELDS.map((f) => [f, pl[f]])));
const same = (a, b) => JSON.stringify({ ...a, defenseUsed: 0 }) === JSON.stringify({ ...b, defenseUsed: 0 });

// Before the hit.
export function watch(state, pl) {
  return { seat: pl.seat, before: pick(pl), lent: state.players.map((p) => p.defenseUsed ?? 0) };
}
// After the hit: offer the discard if it did something and they can pay.
// Returns true if the game now waits for an answer.
export function offer(state, monster, what, snap, ctx) {
  const r = reactionFor(monster, what);
  const pl = state.players[snap.seat];
  if (!r || !itemsOfKind(pl, r.kind).length || same(snap.before, pick(pl))) return false;
  // Killed: down instead, until they answer (a Sacrifice comes after, if they keep the item).
  let fell = false;
  if (pl.dead) { pl.dead = false; pl.dying = true; fell = true; }
  const lent = state.players.map((p, k) => (k === pl.seat ? 0 : (p.defenseUsed ?? 0) - snap.lent[k]));
  (state.reactions ??= []).push({ seat: pl.seat, monster: monster.id, kind: r.kind, text: r.text, what, before: snap.before, lent, fell });
  ctx.log(state, `${pl.name} could discard ${DAMAGE_KINDS[r.kind].label} to undo that (${r.text}).`);
  return true;
}

// The answer. `item`: which of their items of that element (default the first).
// Returns { discarded } or an error string.
export function answer(state, yes, item, { log, killPlayer }) {
  const r = state.reactions.shift();
  const pl = state.players[r.seat];
  const mcard = MONSTER_BY_ID[state.monsters.find((m) => m.id === r.monster)?.kind];
  if (!yes) {
    if (r.fell && pl.dying && !(state.sacrifice ?? []).some((s) => s.seat === pl.seat)) {
      delete pl.dying;
      killPlayer(state, pl, { log, text: `${pl.name} keeps the item` });
    }
    return { discarded: null };
  }
  const options = itemsOfKind(pl, r.kind);
  const at = options.includes(item) ? item : options[0];
  const [gone] = pl.inventory.equipment.splice(at, 1);
  Object.assign(pl, structuredClone(r.before));
  for (const f of FIELDS) if (r.before[f] === undefined) delete pl[f];
  state.players.forEach((p, k) => { if (r.lent[k]) p.defenseUsed = Math.max(0, (p.defenseUsed ?? 0) - r.lent[k]); });
  if (state.sacrifice) state.sacrifice = state.sacrifice.filter((s) => s.seat !== pl.seat);
  log(state, `${pl.name} discards the ${EQUIPMENT_BY_ID[gone.id].name} against the ${mcard?.name ?? 'monster'}: ${r.text.replace(/^Discard \w+ (?:& |to )?/i, '')}. It is undone.`);
  return { discarded: gone.id };
}
