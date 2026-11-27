// Game settings (players, monster, Obols...) and the play controls'
// buttons and keys.

import { MONSTERS, OBOL_TYPES, OBOLS, formatClock, defaultConfig } from './play.js';
import { MONSTER_POOLS, MONSTER_CARDS } from '../game/cards/monsters.js';
import { ui } from '../app/config.js';
import { dlg, toast } from '../app/files.js';
import { setEdgeBrush } from '../editor/moveCheck.js';
import { setOrbitMode, setShape, setView } from '../editor/toolbar.js';
import { $, $$ } from '../app/dom.js';
import { obolHTML } from './panels.js';
import { gameConfig, play, renderPlay, saveConfig, setTrayMin, toggleTrayOpen } from './playView.js';
import { setCamera } from '../render/scene.js';
import { openDecks } from './deckBuilder.js';
import { deckList } from '../game/decks.js';

// Module state: assigned by init() below, in the same order as before the split.
export let SETTINGS;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // --- Game settings -------------------------------------------------------------------
  SETTINGS = [
    { section: 'Players' },
    { key: 'players', label: 'Characters', note: 'Play solo with 1, or take turns with up to 4', min: 1, max: 4,
      fmt: (v) => (v === 1 ? '1 · solo' : `${v}`) },
    { section: 'Dice & movement' },
    { key: 'startBlack', label: 'Starting black dice', note: 'Everyone; renew each turn', min: 1, max: 6 },
    { key: 'moveSlots', label: 'Movement slots', min: 1, max: 4 },
    { key: 'litSlots', label: 'Slots when starting in light', min: 1, max: 5 },
    { key: 'movement', label: 'Movement', note: 'Quick: run on to the next fork or marker. Tactical: choose every step',
      choice: [['quick', 'Quick'], ['tactical', 'Tactical']] },
    { key: 'litThreshold', label: 'Light that counts as lit', min: 0.1, max: 1, step: 0.1, fmt: (v) => `${Math.round(v * 100)}%` },
    { section: 'Clock' },
    { key: 'turnMinutes', label: 'Minutes per turn', min: 1, max: 15, fmt: (v) => `${v} min` },
    { key: 'turnsToMidnight', label: 'Turns until midnight', note: 'start', min: 1, max: 24 },
    { section: 'Start' },
    { key: 'scouting', label: 'Scouting', note: 'Before the first turn, each investigator takes one of the Equipment cards left at the edge of town (players + 1)', bool: true },
    { section: 'Markers' },
    { key: 'stopAtMarkers', label: 'Stop on every marker', note: 'Choose a way on at each marker', bool: true },
    { key: 'askInvestigate', label: 'Ask before investigating', note: '"Investigate?" on Investigation spaces', bool: true },
    { section: 'Monster' },
    { key: 'monster', label: 'Monster', note: 'Mystery: a secret monster you uncover through evidence',
      choice: [['mystery', 'Mystery'], ...Object.entries(MONSTERS).map(([id, d]) => [id, d.label]), ['none', 'None']] },
    { key: 'monsterPool', label: 'Monster pool', note: 'Which monsters the mystery can be', when: () => gameConfig.monster === 'mystery',
      select: Object.entries(MONSTER_POOLS).map(([id, p]) => [id, `${p.label} (${p.ids.length})`]) },
    { key: 'monsterPick', label: 'Specific monster', note: 'For testing: always fight this one', when: () => gameConfig.monster === 'mystery',
      select: [['random', 'Random from the pool'], ...[...MONSTER_CARDS].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.id, c.name])] },
    { section: 'Cards' },
    { cards: true, label: 'Cards in the game', note: 'Choose the Equipment, Events, Mindsets and Monsters new games use' },
    { section: 'Obol bag' },
    ...OBOL_TYPES.map((t) => ({ obol: t, label: `${OBOLS[t].label} Obols`, note: OBOLS[t].note, min: 0, max: 20 })),
  ];
  $('#openSettings').addEventListener('click', openSettings);
  $('#setDone').addEventListener('click', closeSettings);
  $('#settings').addEventListener('click', (e) => { if (e.target === $('#settings')) closeSettings(); });
  $('#setDefaults').addEventListener('click', () => {
    const d = defaultConfig();
    Object.assign(gameConfig, d);
    gameConfig.obols = d.obols;
    settingsDirty = true;
    saveConfig();
    renderSettings();
  });
  $('#trayMove').addEventListener('click', () => play.confirmMove());
  $('#trayEnd').addEventListener('click', requestEndTurn);
  $('#trayDice').addEventListener('click', toggleTrayOpen);
  $('#moveModeBtn').addEventListener('click', () => {
    play.state.movement = play.state.movement === 'tactical' ? 'quick' : 'tactical';
    saveConfig(); // the default for the next game too
    renderPlay(); // the button itself shows the mode: no pop-up
  });
  // The same switch in the dock's More sheet.
  document.querySelectorAll('[data-movemode]').forEach((m) => m.addEventListener('click', () => {
    play.state.movement = m.dataset.movemode;
    saveConfig();
    renderPlay();
  }));
  $('#trayMin').addEventListener('click', () => setTrayMin(true));
  $('#trayPill').addEventListener('click', () => setTrayMin(false));
  $('#endNo').addEventListener('click', () => { $('#endConfirm').hidden = true; });
  $('#endYes').addEventListener('click', () => { $('#endConfirm').hidden = true; play.endTurn(); });
  $('#stayBtn').addEventListener('click', () => play.session.dispatch({ type: 'stay', seat: play.session.state.cur }));
  $('#hudRoll').addEventListener('click', (e) => {
    const act = e.currentTarget.dataset.act;
    if (act === 'move') play.confirmMove(); else if (act === 'end') requestEndTurn();
    else if (act === 'park') play.session.dispatch({ type: 'park', seat: play.session.state.cur });
    else play.roll();
  });
  $('#playStreets').addEventListener('change', (e) => { play.state.followStreets = e.target.checked; });
  $('#playReset').addEventListener('click', () => play.reset());
  syncPlayerButtons();
  document.querySelectorAll('[data-players]').forEach((b) => b.addEventListener('click', () => {
    play.setPlayers(Number(b.dataset.players));
    saveConfig();
    syncPlayerButtons();
  }));
  $('#playFollow').addEventListener('change', (e) => { play.state.follow = e.target.checked; });
  // Arrow keys choose a direction at a fork (before the camera can pan).
  window.addEventListener('keydown', (e) => {
    if (ui.tool !== 'play' || !dlg.root.hidden) return;
    if (e.key.startsWith('Arrow') && play.chooseByKey(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  $$('[data-edge]').forEach((b) => b.addEventListener('click', () => setEdgeBrush(b.dataset.edge)));
  $$('[data-shape]').forEach((b) => b.addEventListener('click', () => setShape(b.dataset.shape)));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $$('[data-cam]').forEach((b) => b.addEventListener('click', () => setCamera(b.dataset.cam)));
  $('#camMode').addEventListener('click', () => setOrbitMode(!ui.orbitMode));
}

export let settingsDirty = false;
export function renderSettings() {
  const body = $('#settingsBody');
  body.replaceChildren();
  const startNote = () => `Night starts at ${formatClock(24 * 60 - gameConfig.turnMinutes * gameConfig.turnsToMidnight)}`;
  for (const f of SETTINGS) {
    if (f.section) {
      const h = document.createElement('div');
      h.className = 'set-section';
      h.textContent = f.section;
      body.appendChild(h);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'set-row';
    if (f.cards) {
      const n = ['equipment', 'events', 'mindsets'].map((d) => deckList(gameConfig, d).length);
      row.innerHTML = `<label>${f.label}<small>${n[0]} Equipment · ${n[1]} Events · ${n[2]} Mindsets</small></label><button type="button" class="set-cards">Choose…</button>`;
      row.querySelector('button').onclick = openDecks;
      body.appendChild(row);
      continue;
    }
    const id = `set-${f.key ?? f.obol}`;
    const note = f.note === 'start' ? startNote() : f.note;
    row.innerHTML = `${f.obol ? obolHTML(f.obol) : ''}<label for="${id}">${f.label}${note ? `<small>${note}</small>` : ''}</label>`;
    const get = () => (f.obol ? gameConfig.obols[f.obol] : gameConfig[f.key]);
    const set = (v) => {
      if (f.obol) gameConfig.obols[f.obol] = v; else gameConfig[f.key] = v;
      // Keep the lit slots at least the normal slots.
      if (f.key === 'moveSlots' && gameConfig.litSlots < v) gameConfig.litSlots = v;
      if (f.key === 'litSlots' && gameConfig.moveSlots > v) gameConfig.moveSlots = v;
      settingsDirty = true;
      saveConfig();
      renderSettings();
    };
    if (f.when && !f.when()) continue;
    if (f.select) {
      row.classList.add('stack');
      const sel = document.createElement('select');
      sel.id = id;
      sel.className = 'set-select';
      for (const [value, text] of f.select) sel.add(new Option(text, value, false, get() === value));
      sel.addEventListener('change', () => set(sel.value));
      row.appendChild(sel);
    } else if (f.choice) {
      row.classList.add('stack');
      const wrap = document.createElement('div');
      wrap.className = 'seg set-choice';
      for (const [value, text] of f.choice) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        b.classList.toggle('on', get() === value);
        b.addEventListener('click', () => set(value));
        wrap.appendChild(b);
      }
      row.appendChild(wrap);
    } else if (f.bool) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.checked = get();
      cb.addEventListener('change', () => set(cb.checked));
      row.appendChild(cb);
    } else {
      const step = f.step ?? 1;
      const wrap = document.createElement('div');
      wrap.className = 'stepper';
      const v = get();
      wrap.innerHTML = `<button type="button" aria-label="Less">−</button><output id="${id}">${f.fmt ? f.fmt(v) : v}</output><button type="button" aria-label="More">+</button>`;
      const [less, more] = wrap.querySelectorAll('button');
      const nudge = (d) => set(Math.round(Math.min(f.max, Math.max(f.min, get() + d * step)) * 100) / 100);
      less.disabled = v <= f.min;
      more.disabled = v >= f.max;
      less.addEventListener('click', () => nudge(-1));
      more.addEventListener('click', () => nudge(1));
      row.appendChild(wrap);
    }
    body.appendChild(row);
  }
  const total = OBOL_TYPES.reduce((a, t) => a + gameConfig.obols[t], 0);
  const tot = document.createElement('div');
  tot.className = 'set-total';
  tot.textContent = `${total} Obols in the bag`;
  body.appendChild(tot);
}
export function markSettingsDirty() { settingsDirty = true; }
export function openSettings() {
  settingsDirty = false;
  renderSettings();
  $('#settings').hidden = false;
}
export function closeSettings() {
  $('#settings').hidden = true;
  syncPlayerButtons();
  if (settingsDirty && ui.tool === 'play') {
    play.reset();
    toast('Game restarted with the new settings.');
  } else if (settingsDirty) {
    play.invalidate(); // the next Play / Midnight demo starts fresh with them
  }
  settingsDirty = false;
}
// Ending the turn with rolled dice unused asks first.
export function requestEndTurn() {
  const n = play.unusedCount();
  const left = play.state.phase === 'choosing' ? play.state.steps : 0;
  if (!n && !left) { play.endTurn(); return; }
  $('#endSub').textContent = [
    left ? `You have ${left} move${left === 1 ? '' : 's'} left; stopping here gives ${left === 1 ? 'it' : 'them'} up.` : '',
    n ? `You have ${n} rolled ${n === 1 ? 'die' : 'dice'} not slotted into Movement or Defense. Unused dice are lost.` : '',
  ].filter(Boolean).join(' ');
  $('#endConfirm').hidden = false;
}
// The panel's player buttons and Game settings share one setting.
export function syncPlayerButtons() {
  document.querySelectorAll('[data-players]').forEach((o) => o.classList.toggle('on', Number(o.dataset.players) === gameConfig.players));
}
