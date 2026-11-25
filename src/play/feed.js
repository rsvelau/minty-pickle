// The message feed: what just happened, in a few colour-coded lines over the
// board just above the dock (and the dice tray). Each line fades after a few
// seconds; the 💬 button in the dock's status line turns the feed on or off,
// and tapping the feed opens the recent history (it stays until tapped again).
// The full log is under Team.
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
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let seen = null;            // state.logN when we last looked
let queue = [];
let timer = 0;
let on = true;
let open = false;
let lastState = null;

export function initFeed() {
  try { on = localStorage.getItem(KEY) !== 'off'; } catch { /* ignore */ }
  $('#feedToggle').addEventListener('click', () => setOn(!on));
  $('#feed').addEventListener('click', () => { open = !open; render(); });
  sync();
}
function setOn(v) {
  on = v;
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  if (!on) { queue = []; open = false; $('#feedLines').innerHTML = ''; }
  sync();
}
function sync() {
  const b = $('#feedToggle');
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? 'Messages on: tap to turn them off' : 'Messages off: tap to turn them on';
  $('#feed').hidden = !on;
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
  queue.push(...state.log.slice(0, fresh).reverse());
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
  const f = $('#feed');
  f.classList.toggle('open', open);
  const host = $('#feedLines');
  if (!open) { host.innerHTML = ''; return; }
  const lines = (lastState?.log ?? []).slice(0, 12).reverse();
  host.innerHTML = lines.map((t) => `<div class="feed-line fk-${kindOf(t)}">${esc(t)}</div>`).join('') || '<div class="feed-line">Nothing yet.</div>';
  host.scrollTop = host.scrollHeight;
}
