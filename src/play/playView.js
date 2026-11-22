// The play demo on the board: HUD, dice tray, clock, direction choices,
// and the Investigate prompt.

import * as THREE from 'three';
import { createPlay, obolCounts, OBOL_TYPES, OBOLS, monsterDef, defaultConfig, formatClock } from './play.js';
import { terrainify, terrainHeight } from '../render/terrain.js';
import { cellLabel } from '../core/state.js';
import { WATER_Y, grid, ui } from '../app/config.js';
import { toast } from '../app/files.js';
import { $ } from '../app/dom.js';
import { craftUI, dmgIcon, hitText, injuryPips, markCaseNew, obolHTML, renderAsk, renderCasebook, renderIntent, renderInventory, renderRevealSheet, showCard, showObol } from './panels.js';
import { __set_markerHidden, __set_markerUsed, markers, refreshMarkers, refreshPropsAndWalls, visibleTop } from '../render/board.js';
import { camera, cellToWorld, controls, scene, wake } from '../render/scene.js';
import { lightLevels } from '../render/tileLook.js';

// Module state: assigned by init() below, in the same order as before the split.
export let PIPS, choiceButtons, projTmp, gameConfig, play;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // --- Play demo -------------------------------------------------------------------
  PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  $('#playDie').innerHTML = '<i></i>'.repeat(9);
  $('#hudDie').innerHTML = '<i></i>'.repeat(9);

  // Round tap targets over each option, pointing the way you'd go.
  choiceButtons = [];
  projTmp = new THREE.Vector3();
  gameConfig = loadConfig();

  play = createPlay({
    config: gameConfig,
    onObol: (draw) => showObol(draw),
    // A monster appears: say so (the camera goes to look at it).
    onMonster: ({ kind, cell }) => {
      const { x, y } = grid.coords(cell);
      toast(`The ${monsterDef(kind)?.label ?? 'monster'} has appeared at ${cellLabel(x, y)}.`);
    },
    onEvidence: (e) => {
      showCard({ kind: e.kind, code: e.code, sub: e.midnight ? 'At midnight the Lair reveals itself · added to the Casebook' : `Found by ${e.player?.name ?? ''} · added to the Casebook` });
      markCaseNew();
    },
    onAttacked: (e) => {
      showCard({ kind: 'attack', code: e.attack, amount: e.amount, first: e.first, sub: hitText({ ...e, source: 'Something unseen' }) });
      if (e.first) markCaseNew();
    },
    onNamed: (e) => showCard({ kind: 'named', monster: e.monster, correct: e.correct }),
    onDamage: (e) => showCard({ kind: 'hurt', code: e.attack, e }),
    onIntent: () => renderIntent(),
    onGameOver: () => showCard({ kind: 'over' }),
    onNpc: (e) => showCard({ kind: 'npc', e }),
    onExhaust: (e) => showCard({ kind: 'exhaust', e }),
    onCraft: (e) => { craftUI.recipe = null; showCard({ kind: 'craft', e }); },
    onMonsterRevealed: (e) => showCard({ kind: 'monster', monster: e.monster, correct: e.correct }),
    // A monster strikes: a brief, soft flash at the screen edges, in the colour
    // of its damage type (red, blue or green).
    onAttack: (e = {}) => {
      const el = $('#attackFlash');
      const rgb = { P: '170, 16, 20', M: '30, 80, 190', S: '20, 140, 50' }[e.attack] ?? '150, 10, 20';
      el.style.setProperty('--flash', `rgba(${rgb}, 0.55)`);
      el.classList.remove('on');
      void el.offsetWidth; // restart the fade
      el.classList.add('on');
    },
    grid, scene, camera, controls, cellToWorld, terrainify, cellLabel,
    cellTop: (i) => Math.max(visibleTop(i), WATER_Y) + 0.01,
    onChange: () => { wake(); renderPlay(); },
    onUsed: () => { refreshMarkers(); refreshPropsAndWalls(); },
    onCollect: (i, type, text) => {
      const { x, y } = grid.coords(i);
      const p = cellToWorld(x, y);
      const fy = Math.max(visibleTop(i), WATER_Y) + terrainHeight(p.x, p.z, { bridge: grid.cells[i].bridge });
      markers.burst(type, p.x, fy, p.z, text);
    },
  });
  __set_markerUsed((i) => ui.tool === 'play' && play.state.shownUsed.has(i));
  __set_markerHidden((i) => ui.tool === 'play' && grid.cells[i].marker === 'objective' && !play.midnight() && !play.state.mystery?.initiative);
  $('#playRoll').addEventListener('click', () => play.roll());
  document.querySelectorAll('#trayTarget [data-to]').forEach((b) => b.addEventListener('click', () => { trayTarget = b.dataset.to; renderTray(); }));
}

export function renderPlay() {
  if (ui.tool !== 'play') return;
  const s = play.state;
  // One-die face for the legacy die widgets: only while rolling, or for a
  // total a single die can show (moves can add up to 7+ with several dice).
  const f0 = s.phase === 'rolling' ? s.rollFace : s.roll;
  const face = PIPS[f0] ? f0 : 0;
  [...$('#playDie').children].forEach((el, n) => el.classList.toggle('on', !!face && PIPS[face].includes(n)));
  const roll = $('#playRoll');
  roll.disabled = !['idle', 'done'].includes(s.phase);
  const here = s.pos >= 0 ? (() => { const c = grid.coords(s.pos); return cellLabel(c.x, c.y); })() : '';
  const cur = s.players[s.cur];
  const chip = cur ? `<span class="who-chip" style="background:${cur.colour}">${cur.name}</span> ` : '';
  $('#playStatus').innerHTML = chip + ({
    nostart: 'No Start space yet. Paint one (Spaces → Outdoor → Start space).',
    idle: `On <b>${here}</b>. Roll to move.`,
    rolling: 'Rolling…',
    slotting: `Slot dice into up to <b>${s.maxSlots}</b> movement slots${s.lit ? ' (in light: extra slot open)' : ''}, then Move.`,
    asking: `Investigation spot. Investigate? <b>${s.steps}</b> move${s.steps === 1 ? '' : 's'} left.`,
    revealing: 'Evidence! Choose a face-down card to turn over.',
    over: 'Everyone is dead. The night wins. Press Restart to play again.',
    moving: s.fast ? `Fast-forward ⏩ <b>${s.steps}</b> left` : `Running… <b>${s.steps}</b> left (press and hold the board to fast-forward)`,
    choosing: `${s.stopReason ? `Stopped at <b>${s.stopReason}</b>. ` : ''}Choose a direction: <b>${s.steps}</b> move${s.steps === 1 ? '' : 's'} left (${s.options.map((o) => o.name).join(', ')})`,
    done: `On <b>${here}</b>. Roll again.`,
  }[s.phase] ?? '');
  // The pawn's light: whatever lights its cell (at the start, the van's headlights).
  const inHeadlights = s.pos >= 0 && grid.cells.some((c, j) => c.sub === 'start' && grid.startFront(j) === s.pos);
  const lightHere = s.pos >= 0 ? `Light <b>${Math.round(lightLevels[s.pos] * 100)}%</b>${inHeadlights ? ' (van headlights)' : ''} · ` : '';
  $('#playStats').innerHTML = `${lightHere}Turn <b>${s.turn}</b> · Black dice <b>${s.blackCount}</b> (everyone)` +
    ` · Obol bag <b>${s.bag.length}</b>` +
    (s.keys ? ` · Keys found <b>${s.keys.toString(2).split('').filter((b) => b === '1').length}</b>` : '');
  // Scoreboard: each player's cell and dice.
  $('#playBoard').innerHTML = s.players.map((p, k) => {
    const c = p.pos >= 0 ? grid.coords(p.pos) : null;
    const counts = obolCounts(p);
    const inDanger = s.monsters.some((mo) => mo.danger?.includes(k));
    const dangerType = s.monsters.flatMap((mo) => mo.dangerTypes?.[k] ?? [])[0];
    return `<div class="pl${k === s.cur ? ' cur' : ''}${p.dead ? ' dead' : ''}${inDanger && !p.dead ? ` danger${dangerType ? ` danger-${dangerType}` : ''}` : ''}" data-inv="${k}" title="Open ${p.name}'s inventory"><span class="chip" style="background:${p.colour}">${p.name}</span>` +
      `<span>${c ? cellLabel(c.x, c.y) : '–'}</span><span>White dice ${p.white}</span>` +
      `<span class="inj-row">${injuryPips(p)}${p.dead ? ' <b>Dead</b>' : inDanger ? ` <b class="${dangerType ? `dmg-${dangerType}` : ''}" style="${dangerType ? '' : 'color:#ff6a50'}">${dangerType ? dmgIcon(dangerType) : ''}In danger</b>` : ''}</span>` +
      `<span class="obol-row">${OBOL_TYPES.map((t) => `<span class="obol-count${counts[t] ? '' : ' zero'}" title="${OBOLS[t].label} Obols">${obolHTML(t)}${counts[t]}</span>`).join('')}</span></div>`;
  }).join('');
  $('#playBoard').innerHTML += s.monsters.map((mo) => {
    const c = grid.coords(mo.pos);
    return `<div class="pl monster-row"><span class="chip" style="background:#6a0a12">!</span>` +
      `<span>${monsterDef(mo.kind)?.label ?? mo.kind}</span><span>${cellLabel(c.x, c.y)}</span></div>`;
  }).join('');
  $('#playLog').innerHTML = s.log.map((l) => `<li>${l}</li>`).join('');
  renderTray();
  renderClock();
  renderAsk();
  renderIntent();
  renderRevealSheet();
  if (!$('#casebook').hidden) renderCasebook();
  if (!$('#inventory').hidden) renderInventory();
  // Floating bar.
  [...$('#hudDie').children].forEach((el, n) => el.classList.toggle('on', !!face && PIPS[face].includes(n)));
  $('#hudRoll').disabled = roll.disabled;
  $('#hudStatus').innerHTML = chip + ({
    nostart: 'Paint a Start space first.',
    idle: `On <b>${here}</b>${s.pos >= 0 ? ` · light ${Math.round(lightLevels[s.pos] * 100)}%` : ''}. Roll.` +
      (play.anyRunning() ? (s.fast ? ' · ⏩' : ' · <span class="muted">hold board to fast-forward</span>') : ''),
    rolling: 'Rolling…',
    slotting: s.pool.some((d) => d.spent) ? 'Slot more, adjust defense, or end turn' : `Slot dice · move <b>${play.slotTotal()}</b>`,
    moving: s.fast ? `Fast-forward ⏩ <b>${s.steps}</b> left` : `Running… <b>${s.steps}</b> left · hold to fast-forward`,
    choosing: `${s.stopReason ? `<b>${s.stopReason}</b> · ` : ''}Tap an arrow · <b>${s.steps}</b> left`,
    asking: `Investigate? · <b>${s.steps}</b> left`,
    revealing: 'Evidence! Choose a card',
    over: 'Everyone is dead. Restart to play again.',
    done: `On <b>${here}</b>. Roll again.`,
  }[s.phase] ?? '');
  renderChoices();
}
export function renderChoices() {
  const host = $('#playChoices');
  const s = play.state;
  const opts = ui.tool === 'play' && s.phase === 'choosing' ? s.options : [];
  const key = opts.map((o) => o.i).join(',');
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  host.replaceChildren();
  choiceButtons = opts.map((o) => {
    const b = document.createElement('button');
    b.className = 'choice-btn';
    b.setAttribute('aria-label', `Move ${o.name}`);
    b.innerHTML = '<span>↑</span>';
    b.addEventListener('click', (e) => { e.stopPropagation(); play.choose(o.i); });
    host.appendChild(b);
    return { b, o };
  });
  positionChoices();
}
export function screenOf(i) {
  const { x, y } = grid.coords(i);
  const p = cellToWorld(x, y);
  const c = grid.cells[i];
  projTmp.set(p.x, Math.max(visibleTop(i), WATER_Y) + terrainHeight(p.x, p.z, { bridge: c.bridge }) + 0.05, p.z).project(camera);
  return { x: (projTmp.x + 1) / 2 * window.innerWidth, y: (1 - projTmp.y) / 2 * window.innerHeight, behind: projTmp.z > 1 };
}
export function positionChoices() {
  if (!choiceButtons.length) return;
  const from = screenOf(play.state.pos);
  for (const { b, o } of choiceButtons) {
    const to = screenOf(o.i);
    // Sit on the option cell, but at least 72 px out from the pawn so the
    // buttons never overlap when zoomed out.
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const r = Math.max(len, 72);
    b.style.left = `${from.x + (dx / len) * r}px`;
    b.style.top = `${from.y + (dy / len) * r}px`;
    b.style.visibility = to.behind ? 'hidden' : 'visible';
    const ang = Math.atan2(dx, -dy);
    b.firstChild.style.transform = `rotate(${ang}rad)`;
  }
}
// Game settings (the adjustable mechanics), saved on this device.
export const CONFIG_KEY = 'minty-pickle.gameConfig';
export function loadConfig() {
  const cfg = defaultConfig();
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(cfg)) {
        if (k === 'obols') {
          for (const t of OBOL_TYPES) if (Number.isFinite(saved.obols?.[t])) cfg.obols[t] = saved.obols[t];
        } else if (k === 'monster' && (saved.configVersion ?? 1) < 3) {
          // Saved before the monster setting mattered: use today's default.
        } else if (typeof saved[k] === typeof cfg[k]) cfg[k] = saved[k];
      }
    }
  } catch { /* defaults */ }
  return cfg;
}
export function saveConfig() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...gameConfig, configVersion: 3 })); } catch { /* ignore */ }
}

// Game clock: "11:05 PM · Turn 2/12"; from midnight on, just the time.
export function renderClock() {
  const el = $('#gameClock');
  el.hidden = ui.tool !== 'play' || play.state.phase === 'nostart';
  if (el.hidden) return;
  const r = play.state.round;
  const t = formatClock(play.clockMinutes());
  el.classList.toggle('midnight', play.midnight());
  const turns = play.state.cfg.turnsToMidnight;
  el.innerHTML = r <= turns
    ? `${t}<span class="sep">·</span><span class="turn-word">Turn </span>${r}/${turns}`
    : `${t}<span class="sep">·</span>${r === turns + 1 ? 'Midnight' : `Turn ${r}`}`;
}

// Dice tray: tap rolled dice into movement slots, then Move.
export function dieHTML(d, extra = '') {
  return `<button class="tdie ${d.kind} ${extra}" aria-label="${d.kind} ${d.v}">` +
    Array.from({ length: 9 }, (_, n) => `<i class="${PIPS[d.v].includes(n) ? 'on' : ''}"></i>`).join('') + '</button>';
}
export function renderTray() {
  const s = play.state;
  const show = ui.tool === 'play' && (s.phase === 'slotting' || s.phase === 'rolling');
  $('#playTray').hidden = !show;
  if (s.phase !== 'slotting') $('#endConfirm').hidden = true;
  if (!show) return;
  const rolling = s.phase === 'rolling';
  // While rolling, every die tumbles.
  $('#trayPool').innerHTML = s.pool.map((d, n) =>
    dieHTML(rolling ? { ...d, v: 1 + ((s.rollFace + n * 2) % 6) } : d, s.slots.includes(n) || s.defSlots.includes(n) ? 'used' : '')).join('') +
    // Sprained: a black die sits out, disabled.
    Array.from({ length: rolling ? 0 : s.disabledDice }, () => '<span class="tdie disabled" title="Sprained: one black die is disabled">✕</span>').join('');
  [...$('#trayPool').querySelectorAll('button.tdie')].forEach((b, n) => { b.onclick = () => play.toggleSlot(n, trayTarget); });
  document.querySelectorAll('#trayTarget [data-to]').forEach((b) => b.classList.toggle('on', b.dataset.to === trayTarget));
  // Defense slots (Defense ⬜ +💡⬜), after injuries.
  const defs = [];
  const dBase = s.cfg.defenseSlots ?? 1;
  for (let k = 0; k < Math.max(s.maxDefense, dBase + 1); k++) {
    const n = s.defSlots[k];
    if (n !== undefined) defs.push(dieHTML(s.pool[n], 'in-def'));
    else if (k < s.maxDefense) defs.push(`<span class="tdie slot def">${k >= dBase ? 'light' : ''}</span>`);
    else defs.push('<span class="tdie slot def" title="Needs light (or lost to an injury)" style="opacity:.35">—</span>');
  }
  $('#trayDefense').innerHTML = defs.join('');
  [...$('#trayDefense').querySelectorAll('.in-def')].forEach((b, k) => { b.onclick = () => play.toggleSlot(s.defSlots[k], 'defense'); });
  $('#trayDefTotal').textContent = s.defSlots.reduce((a, n) => a + (s.pool[n]?.v ?? 0), 0);
  const slots = [];
  const base = s.cfg.moveSlots, most = Math.max(base, s.cfg.litSlots);
  for (let k = 0; k < most; k++) {
    const n = s.slots[k];
    if (n !== undefined) slots.push(dieHTML(s.pool[n], s.pool[n].spent ? 'in-slot spent' : 'in-slot'));
    else if (k < s.maxSlots) slots.push(`<span class="tdie slot${k >= base ? ' lit' : ''}">${k >= base ? 'light' : ''}</span>`);
    else slots.push('<span class="tdie slot" title="Extra slots need a lit cell at the start of the turn" style="opacity:.35">dark</span>');
  }
  $('#traySlots').innerHTML = slots.join('');
  // Unrolled white dice in this player's reserve: tap one to roll it for this turn.
  $('#trayReserveRow').hidden = !s.white;
  $('#trayReserve').innerHTML = Array.from({ length: s.white }, () =>
    `<button class="tdie white reserve" ${rolling ? 'disabled' : ''} title="Roll this white die (usable this turn only)">roll</button>`).join('');
  [...$('#trayReserve').children].forEach((b) => { b.onclick = () => play.rollWhite(); });
  [...$('#traySlots').querySelectorAll('.in-slot')].forEach((b, k) => { b.onclick = () => play.toggleSlot(s.slots[k], 'move'); });
  const moved = s.pool.some((d) => d.spent);
  $('#trayTotal').textContent = rolling ? '…' : play.slotTotal();
  $('#trayMove').disabled = rolling;
  $('#trayMove').hidden = !play.slotTotal();
  $('#trayMove').textContent = `Move ${play.slotTotal()}`;
  $('#trayEnd').disabled = rolling;
  $('#trayEnd').textContent = moved || s.defSlots.length ? 'End turn' : 'Stay put & end turn';
  $('#trayHint').textContent = rolling ? 'Rolling…' : s.deathsDoor ? "Death's Door: one die only"
    : trayTarget === 'defense' ? 'Defense lasts until your next turn'
      : moved ? 'Slot more dice, adjust defense, or end your turn'
      : (s.pool.some((d) => d.kind === 'white') ? 'Rolled white dice are discarded after this turn' : 'Tap dice to slot them');
}
export let trayTarget = 'move';
