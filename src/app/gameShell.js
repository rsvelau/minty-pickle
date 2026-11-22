// The game shell: title screen, New Game, Continue / Load / Save, the in-game
// menu, autosave, and the editor's "My maps".
//
// Three modes (ui.mode, and a class on <body>):
//   'title'  the title screen over the dimmed board
//   'editor' the map planner, exactly as before (its board autosaves on its own)
//   'game'   a game on a chosen map: the play view with the editor tools hidden
// A game's map is loaded into the same board the editor uses, so the editor's
// own board is set aside first and put back when you return to the editor;
// a game never overwrites it.
import { MONSTER_CARDS, MONSTER_POOLS } from '../game/cards/monsters.js';
import { RULES_VERSION, clockMinutes, formatClock, migrateState } from '../game/rules.js';
import { readMap, writeMap, normalizeMeta } from '../core/mapFormat.js';
import { makeSave, readSave } from '../core/saveFormat.js';
import { checkMap } from '../core/mapCheck.js';
import builtinHawthorn from '../maps/hawthorn-bend.json';
import { grid, storage, ui } from './config.js';
import { $ } from './dom.js';
import { toast } from './files.js';
import { applyTerrain } from './panelControls.js';
import { setTool } from './pointer.js';
import { updateUndoButtons } from './shell.js';
import { gameConfig, play, renderPlay, saveConfig } from '../play/playView.js';
import { openSettings } from '../play/gameSettings.js';

export const BUILTIN_MAPS = [builtinHawthorn];
const SLOTS = ['slot1', 'slot2', 'slot3'];
const AUTOSAVE = 'autosave';

// What the board currently holds, and the game in progress.
let boardHolds = 'editor';   // 'editor' | 'game'
let game = null;             // { map: <map file>, name } while a game is loaded
let autosaveTimer = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// --- modes ------------------------------------------------------------------------
function setMode(mode) {
  ui.mode = mode;
  for (const m of ['title', 'editor', 'game']) document.body.classList.toggle(`mode-${m}`, mode === m);
  $('#gameMenuBtn').hidden = mode !== 'game';
  $('#panelTitle').textContent = mode === 'game' ? (game?.name ?? 'Midnight Shift') : 'Grid Planner';
  $('#expand').textContent = mode === 'game' ? 'Investigators ☰' : 'Grid Planner ☰';
}

// Put the editor's board back on the board (after a game used it).
function restoreEditorBoard() {
  if (boardHolds === 'editor') return;
  let data = null;
  try { const saved = storage.plannerBoard.get(); if (saved) data = readMap(saved).data; } catch { /* corrupt: start empty */ }
  if (data) { applyTerrain(data.terrain ?? 'flat'); grid.load(data); }
  grid.clearHistory();
  updateUndoButtons();
  boardHolds = 'editor';
}

// Put a map on the board for a game (the editor's board is safe in storage).
function loadGameBoard(mapFile) {
  const { data } = readMap(mapFile);
  if (boardHolds === 'editor') storage.plannerBoard.set(grid.toJSON()); // flush the editor's latest
  boardHolds = 'game'; // before loading: from here on the editor's autosave stays off
  applyTerrain(data.terrain ?? 'flat');
  grid.load(data);
  grid.clearHistory();
  updateUndoButtons();
}

// Is the editor's own board the one on screen (so the editor may autosave it)?
export const editorBoardShown = () => boardHolds === 'editor';

export function enterEditor() {
  closeScreen();
  restoreEditorBoard();
  game = null;
  setMode('editor');
  setTool('cells');
}

// --- screens (one overlay, re-rendered per screen) ----------------------------------
function openScreen(html, wire) {
  const el = $('#screen');
  el.innerHTML = `<div class="screen-card">${html}</div>`;
  el.hidden = false;
  wire?.(el);
  el.querySelector('[data-focus]')?.focus();
}
export function closeScreen() { $('#screen').hidden = true; $('#screen').innerHTML = ''; }
const back = (fn) => `<button class="screen-back" data-back>‹ Back</button>${fn ? '' : ''}`;

export function showTitle() {
  if (ui.mode === 'game') autosaveNow();
  setMode('title');
  if (ui.tool === 'play') setTool('cells');
  const auto = storage.saves.list().find((s) => s.id === AUTOSAVE);
  const anySave = storage.saves.list().length > 0;
  openScreen(`
    <div class="title-block">
      <p class="title-kicker">A night in Hawthorn Bend</p>
      <h1 class="title-name">Midnight Shift</h1>
    </div>
    <div class="screen-menu">
      ${auto ? `<button class="primary" data-act="continue" data-focus>Continue<small>${esc(auto.name)}</small></button>` : ''}
      <button ${auto ? '' : 'class="primary" data-focus'} data-act="new">New game</button>
      <button data-act="load" ${anySave ? '' : 'disabled'}>Load game</button>
      <button data-act="editor">Map editor</button>
      <button data-act="settings">Game settings</button>
    </div>`, (el) => {
    el.querySelector('[data-act="continue"]')?.addEventListener('click', () => loadSlot(AUTOSAVE));
    el.querySelector('[data-act="new"]').addEventListener('click', showNewGame);
    el.querySelector('[data-act="load"]').addEventListener('click', () => showLoad(showTitle));
    el.querySelector('[data-act="editor"]').addEventListener('click', enterEditor);
    el.querySelector('[data-act="settings"]').addEventListener('click', openSettings);
  });
}

// --- New game ---------------------------------------------------------------------------
// Maps to choose from: built-in, your maps, and the editor's current board.
function mapChoices() {
  const out = BUILTIN_MAPS.map((m) => ({ key: `builtin:${m.meta.id}`, name: m.meta.name, note: 'Built-in', get: () => m }));
  for (const e of storage.maps.list()) out.push({ key: `mine:${e.id}`, name: e.name, note: `My map · ${when(e.updated)}`, get: () => storage.maps.get(e.id) });
  out.push({
    key: 'editor', name: 'The editor\'s board', note: 'Whatever is in the map editor now',
    get: () => {
      if (boardHolds === 'editor') return writeMap(grid, { name: 'Editor board' });
      const saved = storage.plannerBoard.get();
      return saved ? { ...JSON.parse(saved), meta: normalizeMeta({ name: 'Editor board' }) } : null;
    },
  });
  return out;
}

let newGameChoice = null;
function showNewGame() {
  const maps = mapChoices();
  if (!maps.some((m) => m.key === newGameChoice)) newGameChoice = maps[0].key;
  const monsterOptions = [
    ...Object.entries(MONSTER_POOLS).map(([id, p]) => `<option value="pool:${id}">Random: ${esc(p.label)}</option>`),
    '<option disabled>──────────</option>',
    ...MONSTER_CARDS.map((c) => `<option value="pick:${c.id}">${esc(c.name)}</option>`),
  ].join('');
  const picked = MONSTER_CARDS.some((c) => c.id === gameConfig.monsterPick);
  const current = picked ? `pick:${gameConfig.monsterPick}` : `pool:${MONSTER_POOLS[gameConfig.monsterPool] ? gameConfig.monsterPool : 'all'}`;
  openScreen(`
    ${back()}
    <h2 class="screen-title">New game</h2>
    <h3 class="screen-sub">Map</h3>
    <div class="map-list">${maps.map((m) => `
      <label class="map-pick"><input type="radio" name="map" value="${esc(m.key)}" ${m.key === newGameChoice ? 'checked' : ''} />
        <span><b>${esc(m.name)}</b><small>${esc(m.note)}</small></span></label>`).join('')}
    </div>
    <div class="map-check" id="ngCheck"></div>
    <h3 class="screen-sub">Investigators</h3>
    <div class="seg" id="ngPlayers">${[1, 2, 3, 4].map((n) => `<button data-n="${n}" class="${gameConfig.players === n ? 'on' : ''}">${n}</button>`).join('')}</div>
    <h3 class="screen-sub">Monster</h3>
    <select id="ngMonster" class="screen-select">${monsterOptions}</select>
    <h3 class="screen-sub">Start</h3>
    <div class="seg" id="ngStart">
      <button data-start="standard" class="on">11 PM</button>
      <button data-start="midnight">Midnight</button>
    </div>
    <button class="primary screen-go" id="ngGo">Start the night</button>`, (el) => {
    el.querySelector('[data-back]').addEventListener('click', showTitle);
    el.querySelector('#ngMonster').value = current;
    let players = gameConfig.players ?? 1;
    let startMode = 'standard';
    let chosen = null;
    const recheck = () => {
      newGameChoice = el.querySelector('input[name="map"]:checked')?.value;
      const pick = maps.find((m) => m.key === newGameChoice);
      chosen = null;
      let html;
      try {
        const file = pick?.get();
        if (!file) throw new Error('That map is empty.');
        const { data } = readMap(file);
        const probe = new grid.constructor(data.cols, data.rows);
        probe.load(data);
        const { ok, problems } = checkMap(probe);
        chosen = ok ? { file, name: pick.name } : null;
        html = !problems.length ? '<p class="ok">✓ Ready to play.</p>'
          : `<p class="${ok ? 'warn' : 'bad'}">${ok ? '✓ Playable, but:' : '✕ Not playable yet:'}</p><ul>${problems.map((p) => `<li class="${p.level}">${esc(p.text)}</li>`).join('')}</ul>`
            + (ok ? '' : '<p class="hint">Fix it in the Map editor (its "Ready to play?" button lists the same things).</p>');
      } catch (err) {
        html = `<p class="bad">✕ ${esc(err.message)}</p>`;
      }
      el.querySelector('#ngCheck').innerHTML = html;
      el.querySelector('#ngGo').disabled = !chosen;
    };
    el.querySelectorAll('input[name="map"]').forEach((r) => r.addEventListener('change', recheck));
    el.querySelectorAll('#ngPlayers button').forEach((b) => b.addEventListener('click', () => {
      players = Number(b.dataset.n);
      el.querySelectorAll('#ngPlayers button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelectorAll('#ngStart button').forEach((b) => b.addEventListener('click', () => {
      startMode = b.dataset.start;
      el.querySelectorAll('#ngStart button').forEach((x) => x.classList.toggle('on', x === b));
    }));
    el.querySelector('#ngGo').addEventListener('click', () => {
      if (!chosen) return;
      const [kind, id] = el.querySelector('#ngMonster').value.split(':');
      startGame({ map: chosen.file, name: chosen.name, players, startMode, monster: { kind, id } });
    });
    recheck();
  });
}

function startGame({ map, name, players, startMode, monster }) {
  // The choices also become the defaults for the play demo and next time.
  gameConfig.players = players;
  gameConfig.monster = 'mystery'; // the real game: a secret monster found out through evidence
  if (monster.kind === 'pick') gameConfig.monsterPick = monster.id;
  else { gameConfig.monsterPick = 'random'; gameConfig.monsterPool = monster.id; }
  saveConfig();
  loadGameBoard(map);
  game = { map: readMapFile(map), name };
  closeScreen();
  setMode('game');
  play.setStartMode(startMode); // a fresh game on this map with these settings
  setTool('play');
  renderPlay();
  autosaveNow();
  toast(`${name}: ${players === 1 ? 'one investigator' : `${players} investigators`}. Good luck.`);
}
// A map file object, always with its details.
const readMapFile = (file) => (typeof file === 'string' ? JSON.parse(file) : file);

// --- saving and loading ----------------------------------------------------------------
function currentSave(name) {
  const state = play.saveState();
  if (!state || !game) return null;
  return makeSave({ map: game.map, state, name: name ?? saveName(state) });
}
function menuNote() {
  const s = play.saveState();
  if (!s) return '';
  return `${formatClock(clockMinutes(s))} · round ${s.round} · ${s.players.length} investigator${s.players.length === 1 ? '' : 's'}`;
}
function saveName(state) {
  const time = formatClock(clockMinutes(state));
  return `${game?.name ?? 'Game'} · ${time} · ${state.players.length} investigator${state.players.length === 1 ? '' : 's'}`;
}

// Called whenever the game updates: autosave at the start of each turn.
export function onGameUpdate() {
  if (ui.mode !== 'game') return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => { if (play.state.phase === 'idle') autosaveNow(); }, 600);
}
function autosaveNow() {
  if (ui.mode !== 'game' || !game) return;
  const save = currentSave();
  if (save) storage.saves.put(save, AUTOSAVE);
}

function loadSlot(id) {
  let loaded;
  try {
    const raw = storage.saves.get(id);
    if (!raw) throw new Error('That save is empty.');
    loaded = readSave(raw, { rulesVersion: RULES_VERSION, migrate: migrateState });
  } catch (err) {
    toast(`Couldn't load: ${err.message}`);
    return;
  }
  const mapFile = writeMapFromData(loaded.map);
  loadGameBoard(mapFile);
  game = { map: mapFile, name: loaded.map.meta?.name ?? 'Saved map' };
  closeScreen();
  setMode('game');
  play.loadState(loaded.state);
  setTool('play');
  renderPlay();
  toast(`Loaded: ${loaded.name || 'saved game'}.`);
}
// The map from a save, as a map file again (data + details).
function writeMapFromData({ data, meta }) {
  const probe = new grid.constructor(data.cols, data.rows);
  probe.load(data);
  return writeMap(probe, meta ?? { name: 'Saved map' });
}

function slotRows(withEmpty) {
  const list = storage.saves.list();
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  const ids = [AUTOSAVE, ...SLOTS];
  return ids.filter((id) => withEmpty || byId[id]).map((id) => ({
    id, label: id === AUTOSAVE ? 'Autosave' : `Slot ${id.slice(4)}`, entry: byId[id] ?? null,
  }));
}

function showLoad(onBack) {
  const rows = slotRows(false);
  openScreen(`
    ${back()}
    <h2 class="screen-title">Load game</h2>
    ${rows.length ? `<div class="slot-list">${rows.map((r) => `
      <div class="slot">
        <div class="slot-info"><b>${esc(r.label)}</b><small>${esc(r.entry.name)}</small><small>${esc(when(r.entry.savedAt ?? r.entry.updated))}</small></div>
        <button class="primary" data-load="${r.id}">Load</button>
        ${r.id === AUTOSAVE ? '' : `<button class="ghost" data-del="${r.id}" aria-label="Delete ${esc(r.label)}">✕</button>`}
      </div>`).join('')}</div>` : '<p class="screen-note">No saved games yet.</p>'}`, (el) => {
    el.querySelector('[data-back]').addEventListener('click', onBack);
    el.querySelectorAll('[data-load]').forEach((b) => b.addEventListener('click', () => loadSlot(b.dataset.load)));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.confirm) { storage.saves.remove(b.dataset.del); showLoad(onBack); return; }
      b.dataset.confirm = '1'; b.textContent = 'Delete?'; b.classList.add('danger');
    }));
  });
}

function showSave() {
  const rows = slotRows(true).filter((r) => r.id !== AUTOSAVE);
  openScreen(`
    ${back()}
    <h2 class="screen-title">Save game</h2>
    <div class="slot-list">${rows.map((r) => `
      <div class="slot">
        <div class="slot-info"><b>${esc(r.label)}</b><small>${r.entry ? esc(r.entry.name) : 'Empty'}</small>${r.entry ? `<small>${esc(when(r.entry.savedAt ?? r.entry.updated))}</small>` : ''}</div>
        <button class="primary" data-save="${r.id}">${r.entry ? 'Overwrite' : 'Save here'}</button>
      </div>`).join('')}</div>
    <p class="screen-note">The game also autosaves at the start of every turn.</p>`, (el) => {
    el.querySelector('[data-back]').addEventListener('click', showPauseMenu);
    el.querySelectorAll('[data-save]').forEach((b) => b.addEventListener('click', () => {
      const save = currentSave();
      if (!save) return;
      if (storage.saves.put(save, b.dataset.save)) { toast(`Saved to ${b.dataset.save.replace('slot', 'slot ')}.`); closeScreen(); } else toast('Saving failed: storage is full or blocked here.');
    }));
  });
}

export function showPauseMenu() {
  if (ui.mode !== 'game') return;
  openScreen(`
    <h2 class="screen-title">${esc(game?.name ?? 'Paused')}</h2>
    <p class="screen-note">${esc(menuNote())}</p>
    <div class="screen-menu">
      <button class="primary" data-act="resume" data-focus>Resume</button>
      <button data-act="save">Save game</button>
      <button data-act="load">Load game</button>
      <button data-act="restart">Restart this map</button>
      <button data-act="quit">Quit to title</button>
    </div>`, (el) => {
    el.querySelector('[data-act="resume"]').addEventListener('click', closeScreen);
    el.querySelector('[data-act="save"]').addEventListener('click', showSave);
    el.querySelector('[data-act="load"]').addEventListener('click', () => showLoad(showPauseMenu));
    el.querySelector('[data-act="restart"]').addEventListener('click', (ev) => {
      if (!ev.currentTarget.dataset.confirm) { ev.currentTarget.dataset.confirm = '1'; ev.currentTarget.textContent = 'Restart? Tap again'; return; }
      closeScreen(); play.reset(); renderPlay(); autosaveNow();
    });
    el.querySelector('[data-act="quit"]').addEventListener('click', showTitle);
  });
}

// --- My maps (editor) ----------------------------------------------------------------------
export function showMyMaps() {
  const maps = storage.maps.list();
  openScreen(`
    ${back()}
    <h2 class="screen-title">My maps</h2>
    <div class="save-map">
      <input type="text" id="mmName" class="screen-input" placeholder="Name this map" maxlength="80" />
      <button class="primary" id="mmSave">Save current board</button>
    </div>
    ${maps.length ? `<div class="slot-list">${maps.map((m) => `
      <div class="slot">
        <div class="slot-info"><b>${esc(m.name)}</b><small>${m.cols}×${m.rows} · ${esc(when(m.updated))}</small></div>
        <button data-open="${m.id}">Open</button>
        <button class="ghost" data-del="${m.id}" aria-label="Delete ${esc(m.name)}">✕</button>
      </div>`).join('')}</div>` : '<p class="screen-note">No saved maps yet. Saved maps appear in New game.</p>'}`, (el) => {
    el.querySelector('[data-back]').addEventListener('click', closeScreen);
    el.querySelector('#mmSave').addEventListener('click', () => {
      const name = el.querySelector('#mmName').value.trim() || 'Untitled map';
      const existing = maps.find((m) => m.name.toLowerCase() === name.toLowerCase());
      const file = writeMap(grid, { id: existing?.id, name, created: existing ? storage.maps.get(existing.id)?.meta?.created : undefined });
      if (storage.maps.put(file, file.meta.id)) { toast(`Saved "${name}" to My maps.`); showMyMaps(); } else toast('Saving failed: storage is full or blocked here.');
    });
    el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => {
      if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Replace board?'; return; }
      try {
        const { data } = readMap(storage.maps.get(b.dataset.open));
        applyTerrain(data.terrain ?? 'flat');
        grid.replaceAll(data.cols, data.rows, data.cells, data.edges); // undoable
        updateUndoButtons();
        closeScreen();
        toast('Map opened. Undo puts your previous board back.');
      } catch (err) { toast(`Couldn't open: ${err.message}`); }
    }));
    el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.confirm) { storage.maps.remove(b.dataset.del); showMyMaps(); return; }
      b.dataset.confirm = '1'; b.textContent = 'Delete?'; b.classList.add('danger');
    }));
  });
}

// Run once at startup (called from src/main.js, after everything else).
export function init() {
  $('#gameMenuBtn').addEventListener('click', showPauseMenu);
  $('#toTitle').addEventListener('click', showTitle);
  $('#myMaps').addEventListener('click', showMyMaps);
  window.addEventListener('keydown', (e) => {
    if (!$('#deckScreen').hidden) { if (e.key === 'Escape') { e.stopImmediatePropagation(); $('#deckScreen').hidden = true; } return; }
    if ($('#screen').hidden) {
      // Escape in a game opens the menu (unless something else wants it).
      const free = ['#dialog', '#settings', '#inventory', '#casebook', '#cardPop', '#revealSheet', '#endConfirm'].every((s) => $(s).hidden);
      if (e.key === 'Escape' && ui.mode === 'game' && free && play.state.phase !== 'asking') { e.stopImmediatePropagation(); showPauseMenu(); }
      return;
    }
    if (!$('#settings').hidden || !$('#dialog').hidden) return; // a dialog over the screen takes its own keys
    // A screen is open: keys belong to it (typing still works), not the board.
    e.stopImmediatePropagation();
    if (e.key === 'Escape' && ui.mode !== 'title') closeScreen();
  }, true);
  showTitle();
}
