// Bots at the table: the seats you don't play are played by the expert bot
// (src/game/bot.js), quickly: a whole turn takes a few seconds.
//
// Whoever must act right now (a weakness discard's player, a Sacrificial
// Fetish's carrier, or whoever's turn it is) is checked after every update; if
// that seat is a bot's (players[seat].bot, set when the game was made: New
// game → "You play"), the bot picks its next action and plays it after a short
// pause. It doesn't wait for the board to finish animating: the rules move on
// at once, and the pawn is still walking to its destination (highlighted in its
// colour) when the next turn starts. A banner at the top shows the bot's turn:
// the dice it rolled and what it did (the game's own log lines for it). While
// a bot plays, the play controls are locked (body.bot-turn) but the sheets
// stay open for a look.
import { makeBot } from '../game/bot.js';
import { sacrificeSeat } from '../game/rules.js';
import { botAction, botWillAct } from './botWatch.js';
import { gameConfig } from './playView.js';
// Bot speed (Game settings → Following the bots): pauses ×, and whether to wait for the board.
const SPEED = { fast: { k: 1, wait: false }, normal: { k: 1.8, wait: false }, watch: { k: 2.2, wait: true } };
const speed = () => SPEED[gameConfig?.botSpeed] ?? SPEED.fast;

const PAUSE = 400;        // ms between a bot's actions
const AFTER_ROLL = 1300;  // ms after a roll (to see the dice)
const AFTER_MOVE = 700;   // ms after it sets off (to see where to)
// A typical turn (roll, slot, move, a fork or two, end) takes about 4 to 6 s.
const CARD_WAIT = 700;    // ms to leave a card that popped up on screen
const BANNER_LINGER = 3200; // ms the banner stays after the bot's turn

let play = null, board = null, bot = null, timer = 0, fails = 0, lastAction = '';
let banner = null;        // { seat, dice: [], lines: [], hideAt }

export function initBots(p) { play = p; }

// The seat that must act now, or -1.
function actingSeat(s) {
  if (!s || s.phase === 'over' || s.phase === 'nostart') return -1;
  return sacrificeSeat(s);   // a discard's player, a Fetish's carrier, or whoever's turn it is
}
export const botActing = () => {
  const s = play?.session?.state;
  const seat = actingSeat(s);
  return seat >= 0 && !!s.players[seat]?.bot;
};

// After every update: if a bot must act, schedule its next action.
export function botUpdate() {
  document.body.classList.toggle('bot-turn', botActing());
  if (!botActing()) {
    clearTimeout(timer); timer = 0;
    if (banner && !banner.hideAt) { banner.hideAt = performance.now() + BANNER_LINGER; setTimeout(drawBanner, BANNER_LINGER + 50); }
    return;
  }
  if (timer) return;
  const wait = (lastAction === 'roll' ? AFTER_ROLL : lastAction === 'move' || lastAction === 'choose' ? AFTER_MOVE : PAUSE) * speed().k;
  timer = setTimeout(step, wait);
}

function step() {
  timer = 0;
  if (!botActing()) return;
  // Only the opening camera move holds it up (and, briefly, a card that just popped up).
  const cardUp = !document.getElementById('cardPop')?.hidden;
  if (document.body.classList.contains('intro') || (speed().wait && play.busy())) { timer = setTimeout(step, 250); return; }
  if (cardUp) {
    step.cardSince ??= performance.now();
    if (performance.now() - step.cardSince < CARD_WAIT) { timer = setTimeout(step, 120); return; }
  }
  step.cardSince = null;
  const s = play.session.state;
  if (play.board !== board) { board = play.board; bot = null; }
  bot ??= makeBot(board, { expert: true });
  const seat = actingSeat(s);
  let a = null;
  try { a = bot.act(s); } catch (e) { console.error(e); }
  if (!a) a = { type: 'end', seat: s.cur };
  const logN = s.logN ?? 0;
  botWillAct(seat, s);
  let r = play.session.dispatch(a);
  if (!r.ok) {
    // It thought that would work: try again, then pass rather than stall; if
    // even that won't go, roll; and if nothing goes, wait a while before retrying.
    if (++fails > 3) {
      r = play.session.dispatch({ type: 'end', seat: s.cur });
      if (!r.ok) r = play.session.dispatch({ type: 'roll', seat: s.cur });
      if (!r.ok) { fails = 0; timer = setTimeout(step, 2500); return; }
      fails = 0;
    }
  } else fails = 0;
  lastAction = a.type;
  if (r.ok) { record(seat, a, logN); botAction(seat, a, play.session.state, r.events); }
  botUpdate();
}

// --- what the bot did, shown -------------------------------------------------------------
const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const QUIET = /('s turn\.|rolled (black|a white)|braces: defense|^The scouting is done)/;
function record(seat, a, logN) {
  const s = play.session.state;
  const pl = s.players[seat];
  if (!pl) return;
  // One banner per bot turn (its last action, ending the turn, still belongs to it).
  if (!banner || banner.seat !== seat || banner.closed) banner = { seat, dice: [], lines: [], hideAt: 0, closed: false };
  if (a.type === 'roll') banner.dice = (s.pool ?? []).map((d) => ({ v: d.v, kind: d.kind }));
  // The game's own words for what just happened (new log lines, oldest first).
  const fresh = s.log.slice(0, Math.min((s.logN ?? 0) - logN, s.log.length)).reverse().filter((t) => !QUIET.test(t));
  banner.lines.push(...fresh);
  banner.lines = banner.lines.slice(-6);
  // The turn has passed: the next action of this seat starts a new banner.
  if (actingSeat(s) !== seat) banner.closed = true;
  // Where it's headed: the space the rules have it on now (the pawn walks there).
  if (['move', 'choose', 'drive', 'board'].includes(a.type)) play.showBotTarget?.(pl.pos, pl.colour, seat);
  drawBanner();
}
function drawBanner() {
  const el = document.getElementById('botBanner');
  if (!el) return;
  if (!banner || (banner.hideAt && performance.now() >= banner.hideAt)) { el.hidden = true; return; }
  const s = play.session.state;
  const pl = s.players[banner.seat];
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  el.hidden = false;
  el.innerHTML = `<div class="bb-head"><span class="bb-chip" style="background:${pl?.colour ?? '#888'}">${esc(pl?.name ?? '')} 🤖</span>` +
    (banner.dice.length ? `<span class="bb-dice">rolled ${banner.dice.map((d) => `<b class="bb-die ${d.kind}" title="${d.kind} ${d.v}">${FACE[d.v] ?? d.v}<i>${d.v}</i></b>`).join('')}</span>` : '') + '</div>' +
    `<ul>${banner.lines.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
}

// A new or loaded game: forget the last one's bot.
export function botsReset() {
  clearTimeout(timer); timer = 0; bot = null; fails = 0; lastAction = ''; banner = null;
  drawBanner();
  play?.showBotTarget?.(null);
}
