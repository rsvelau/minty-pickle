// Playtests: whole games played by a simple bot, headless, on a built-in map,
// for every monster and team size, to find what breaks and how often the
// investigators win.
//
//   node tools/playtest.mjs [games per setup = 8] [monster ids, comma-separated] [team sizes = 1,2,3,4]
//   Follow streets is on, as in the game (STREETS=0 turns it off).
//
// The bot: before midnight it investigates the nearest markers; once the
// monster is known it follows the monster's objective script (collect,
// deliver, upgrade, cleanse, escape, hold, destroy) or hunts it; it uses any
// skill the Skills menu calls "Use now" on a monster (and heals when hurt),
// crafts heals from Obols, slots its best die to Defense when it is in danger,
// and says yes to investigating, reactions and sacrifices.
//
// Checks while it plays (anomalies): an exception; an action the bot expected
// to work failing over and over; no progress for many actions; a player or
// monster off the board, NaN health, health above its maximum.
import { readFileSync } from 'fs';
import { makeBot } from '../src/game/bot.js';
import { gridFromMap } from '../src/core/mapFormat.js';
import { createBoard } from '../src/game/board.js';
import { newGame, applyAction } from '../src/game/rules.js';
import { MONSTER_CARDS, MONSTER_BY_ID } from '../src/game/cards/monsters.js';
import { knownMonster } from '../src/game/objectives/scripts.js';

// TUNE='{"werewolf":{"toughness":3}}': try card changes in this run only (hp,
// toughness, badge...), to see what a balance change would do before making it.
if (process.env.TUNE) {
  const { MONSTER_BY_ID: CARDS } = await import('../src/game/cards/monsters.js');
  for (const [id, change] of Object.entries(JSON.parse(process.env.TUNE))) Object.assign(CARDS[id], change);
}
const MAP = JSON.parse(readFileSync(new URL('../src/maps/hawthorn-bend.json', import.meta.url)));
const GAMES = Number(process.argv[2] ?? 8);
const ONLY = process.argv[3] && process.argv[3] !== 'all' ? process.argv[3].split(',') : null;
const SIZES = (process.argv[4] ?? '1,2,3,4').split(',').map(Number);
const MAX_ROUNDS = 60;
const TRACE = process.env.TRACE === '1';   // print every log line of each game
// BOT=expert: a team that knows every rule and plays to it (but not which monster was drawn).
const EXPERT = process.env.BOT === 'expert';

// --- the bot: src/game/bot.js ------------------------------------------------------

// --- one game -------------------------------------------------------------------------
function play(monster, players, seed) {
  const { grid } = gridFromMap(MAP);
  const board = createBoard(grid);
  // Follow streets off: the bot's walking distances don't know the road's lanes.
  const { state } = newGame(board, { seed, scout: true, followStreets: process.env.STREETS !== "0", config: { players, monsterPick: monster } });
  const bot = makeBot(board, { expert: EXPERT, trace: TRACE });
  state.fullLog = [];
  let seenN = state.logN ?? 0;
  const anomalies = [];
  let actions = 0, lastRound = state.round, sinceRound = 0, fails = 0;
  const note = (kind, text) => { if (anomalies.length < 6) anomalies.push({ kind, text, round: state.round, log: state.log.slice(0, 3) }); };
  try {
    while (state.phase !== 'over' && state.round <= MAX_ROUNDS && actions < 20000) {
      actions++;
      let a = bot.act(state);
      if (!a) a = { type: 'end', seat: state.cur };
      if (process.env.ACTS === '1' && actions < 400) console.log('ACT', state.phase, state.players[state.cur].pos, JSON.stringify(a), state.options?.map((o) => o.i).join(','));
      let r = applyAction(state, board, a);
      if (!r.ok && a.type !== 'end') {
        fails++;
        if (fails > 40) { note('stuck', `${a.type} keeps failing: ${r.error}`); fails = 0; }
        r = applyAction(state, board, { type: 'end', seat: state.cur });
        if (!r.ok) {
          // Something waits that the bot can't answer.
          note('blocked', `${state.phase}: can't end the turn (${r.error})`);
          break;
        }
      } else fails = 0;
      if (TRACE) { const n = state.logN ?? 0; state.fullLog.push(...state.log.slice(0, Math.min(n - seenN, state.log.length)).reverse()); seenN = n; }
      // Invariants.
      for (const p of state.players) if (!(p.pos >= 0 && p.pos < grid.cells.length)) note('position', `${p.name} at ${p.pos}`);
      for (const m of state.monsters) {
        if (!(m.pos >= 0 && m.pos < grid.cells.length)) note('position', `${m.kind} at ${m.pos}`);
        if (m.hp !== null && m.hp !== undefined && (Number.isNaN(m.hp) || m.hp > (m.maxHp ?? Infinity))) note('health', `${m.kind} hp ${m.hp}/${m.maxHp}`);
      }
      if (state.round !== lastRound) { lastRound = state.round; sinceRound = 0; } else if (++sinceRound > 3000) { note('no progress', `phase ${state.phase} for 3000 actions`); break; }
    }
  } catch (err) {
    note('crash', String(err.stack ?? err).split('\n').slice(0, 3).join(' | '));
  }
  if (TRACE) console.log(state.fullLog.join('\n') + `\n=== END ${state.won ? 'win' : state.phase === 'over' ? 'loss' : 'undecided'} players=${state.players.length} round=${state.round} lair=${state.mystery?.spawnCell}`);
  const won = !!state.won;
  const escaped = state.players.filter((p) => p.escaped).length;
  return {
    result: won || escaped ? 'win' : state.phase === 'over' ? 'loss' : 'undecided',
    rounds: state.round, dead: state.players.filter((p) => p.dead).length,
    identified: !!state.mystery?.revealed || !!knownMonster(state),
    objective: !!state.objectiveDone,
    lostInNight: !!state.lostInNight,
    monsterHp: state.monsters[0] ? `${state.monsters[0].hp ?? '∞'}/${state.monsters[0].maxHp ?? '∞'}` : 'gone',
    anomalies,
  };
}

// --- all of them ---------------------------------------------------------------------
const ids = MONSTER_CARDS.map((c) => c.id).filter((id) => !ONLY || ONLY.includes(id));
const rows = [];
const problems = [];
const t0 = Date.now();
for (const id of ids) {
  for (const n of SIZES) {
    const games = Array.from({ length: GAMES }, (_, k) => play(id, n, 1000 + k * 7919 + n * 31));
    const tally = (f) => games.filter(f).length;
    rows.push({
      monster: MONSTER_BY_ID[id].name, players: n,
      win: tally((x) => x.result === 'win'), loss: tally((x) => x.result === 'loss'), undecided: tally((x) => x.result === 'undecided'),
      rounds: (games.reduce((s, x) => s + x.rounds, 0) / games.length).toFixed(1),
      dead: (games.reduce((s, x) => s + x.dead, 0) / games.length).toFixed(1),
      objective: tally((x) => x.objective),
      night: tally((x) => x.lostInNight),
    });
    games.forEach((x, k) => x.anomalies.forEach((an) => problems.push({ monster: id, players: n, game: k, ...an })));
  }
}
console.log(`| Monster | Team | Win | Loss | Lost in the night | Undecided | Avg rounds | Avg dead | Objective done |`);
console.log(`|---|---|---|---|---|---|---|---|---|`);
for (const r of rows) console.log(`| ${r.monster} | ${r.players} | ${r.win} | ${r.loss} | ${r.night} | ${r.undecided} | ${r.rounds} | ${r.dead} | ${r.objective} |`);
console.log(`\n${problems.length} anomalies in ${rows.length * GAMES} games (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
const seen = new Set();
for (const p of problems) {
  const key = `${p.kind}:${p.text.slice(0, 60)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  console.log(`- [${p.kind}] ${p.monster} ×${p.players} game ${p.game}, round ${p.round}: ${p.text}\n    last log: ${p.log.join(' / ').slice(0, 300)}`);
}
