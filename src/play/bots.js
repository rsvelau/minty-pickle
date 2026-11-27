// Bots at the table: the seats you don't play are played by the expert bot
// (src/game/bot.js), at a pace you can follow.
//
// Whoever must act right now (a weakness discard's player, a Sacrificial
// Fetish's carrier, or whoever's turn it is) is checked after every update; if
// that seat is a bot's (players[seat].bot, set when the game was made: New
// game → "You play"), the bot picks its next action and plays it after a short
// pause, once the board has finished animating and the opening camera move is
// over. While a bot plays, the play controls are locked (body.bot-turn) but the
// sheets stay open for a look.
import { makeBot } from '../game/bot.js';
import { sacrificeSeat } from '../game/rules.js';

const PAUSE = 650;        // ms between a bot's actions
const AFTER_ROLL = 1100;  // ms after a roll (to see the dice)
const CARD_WAIT = 1600;   // ms to leave a card that popped up on screen

let play = null, board = null, bot = null, timer = 0, fails = 0, lastAction = '';

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
  const s = play?.session?.state;
  document.body.classList.toggle('bot-turn', botActing());
  if (!botActing()) { clearTimeout(timer); timer = 0; return; }
  if (timer) return;
  const wait = lastAction === 'roll' ? AFTER_ROLL : PAUSE;
  timer = setTimeout(step, wait);
  void s;
}

function step() {
  timer = 0;
  if (!botActing()) return;
  // Let the board catch up (pawns walking, dice rolling, the opening camera move, a card on screen).
  const cardUp = !document.getElementById('cardPop')?.hidden;
  if (play.busy() || document.body.classList.contains('intro') || (cardUp && !step.cardSince)) {
    if (cardUp) step.cardSince ??= performance.now();
    timer = setTimeout(step, 250);
    return;
  }
  if (cardUp && performance.now() - step.cardSince < CARD_WAIT) { timer = setTimeout(step, 250); return; }
  step.cardSince = null;
  const s = play.session.state;
  if (play.board !== board) { board = play.board; bot = null; }
  bot ??= makeBot(board, { expert: true });
  let a = null;
  try { a = bot.act(s); } catch (e) { console.error(e); }
  if (!a) a = { type: 'end', seat: s.cur };
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
  botUpdate();
}

// A new or loaded game: forget the last one's bot.
export function botsReset() { clearTimeout(timer); timer = 0; bot = null; fails = 0; lastAction = ''; }
