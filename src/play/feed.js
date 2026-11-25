// The message feed: everything the game logs is kept, but only what stands
// out pops up over the board (just above the dock and the dice tray): a
// marker touched, an attack on a player, an attack on a monster, an objective
// step, midnight. Rolls, moves and turn changes stay quiet. Each line fades
// after a few seconds; the 💬 button in the dock's status line turns the
// pop-ups on or off, and tapping it (or a line) opens the recent history,
// every line in colour. The full log is under Team.
//
// It reads the game's own log (rules.js log(): state.log, newest first, and
// state.logN, how many lines were ever logged) and shows the lines that are
// new since it last looked, one after another.
import { $ } from '../app/dom.js';

const KEY = 'minty-pickle.feed';
const SHOW = 5;            // lines on screen at once
const LIFE = 7000;         // ms before a line fades
const GAP = 420;           // ms between lines arriving together

// Colour by what the line is about.
const KINDS = [
  ['monster', /^The [^.]*?(’s|'s) |\b(singles out|is pulled|exhausted|pinned|drops the|strikes at|finds no one|is immune)\b|\bhits \w+ for\b/],
  ['hurt', /\b(takes \d+|damage|toughness|health left|falls|is destroyed|defeated|weakness)\b/i],
  ['objective', /\b(Cosor|sharpen|bless|deliver|cleanse|candle|escape|objective|picks up|Ring|Gown|Finger Bone|holy water|anchor)\w*/i],
  ['evidence', /\b(evidence|investigat\w*|Obol|Casebook|Lair|found)\b/i],
  ['skill', /\b(uses|Equipment|craft\w*|Lucky|Rally|refresh\w*|heal\w*)\b/i],
  ['night', /\b(midnight|round|monster appears|rises)\b/i],
];
const kindOf = (text) => KINDS.find(([, re]) => re.test(text))?.[0] ?? 'plain';
// What pops up: attacks either way, objectives, evidence and Obols, and the
// markers (keys, dice, research) and the night; not skills, crafting or plain lines.
const POPS = new Set(['monster', 'hurt', 'objective', 'evidence', 'night']);
const MARKER = /\b(picked up a key|collected a single-use White Die|attuned a Black Die|used Research|Objective marker|takes the)\b/;
const pops = (text) => POPS.has(kindOf(text)) || MARKER.test(text);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let seen = null;            // state.logN when we last looked
let queue = [];
let timer = 0;
let on = true;
let open = false;
let lastState = null;

export function initFeed() {
  try { on = localStorage.getItem(KEY) !== 'off'; } catch { /* ignore */ }
  // The button: pop-ups on → open the history → close it (pop-ups off) → back on.
  $('#feedToggle').addEventListener('click', () => {
    if (on && !open) { open = true; render(); } else if (open) { open = false; render(); setOn(false); } else setOn(true);
  });
  $('#feed').addEventListener('click', () => { open = !open; render(); });
  sync();
}
function setOn(v) {
  on = v;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (!on) { queue = []; $('#feedLines').innerHTML = ''; }
  sync();
}
function sync() {
  const b = $('#feedToggle');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('open', open);
  b.title = open ? 'Recent messages: tap to close and turn pop-ups off' : on ? 'Pop-ups on: tap for the recent messages' : 'Pop-ups off: tap to turn them on';
  $('#feed').hidden = !on && !open;
}

// Called after every game update: show the lines logged since last time.
export function feedUpdate(state) {
  if (!state?.log) return;
  lastState = state;
  const n = state.logN ?? 0;
  if (seen === null || n < seen) { seen = n; return; }   // a new or loaded game: no backlog
  const fresh = Math.min(n - seen, state.log.length);
  seen = n;
  if (!fresh || !on) { if (open) render(); return; }
  queue.push(...state.log.slice(0, fresh).reverse().filter(pops));
  if (open) { queue = []; render(); return; }
  pump();
}
// A new game or a loaded one: start from here.
export function feedReset() { seen = null; queue = []; $('#feedLines').innerHTML = ''; open = false; }

function pump() {
  if (timer || !queue.length) return;
  addLine(queue.shift());
  timer = setTimeout(() => { timer = 0; pump(); }, GAP);
}
function addLine(text) {
  const host = $('#feedLines');
  const el = document.createElement('div');
  el.className = `feed-line fk-${kindOf(text)}`;
  el.innerHTML = esc(text);
  host.append(el);
  while (host.children.length > SHOW) host.firstElementChild.remove();
  setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 700); }, LIFE);
}
// Open: the recent history (newest at the bottom), not fading.
function render() {
  sync();
  const f = $('#feed');
  f.classList.toggle('open', open);
  const host = $('#feedLines');
  if (!open) { host.innerHTML = ''; return; }
  const lines = (lastState?.log ?? []).slice(0, 12).reverse();
  host.innerHTML = lines.map((t) => `<div class="feed-line fk-${kindOf(t)}">${esc(t)}</div>`).join('') || '<div class="feed-line">Nothing yet.</div>';
  host.scrollTop = host.scrollHeight;
}
