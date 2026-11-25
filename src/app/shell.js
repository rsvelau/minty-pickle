// The app shell: panel minimise, tap-off-to-close, keyboard shortcuts,
// undo buttons, the cell info box, board counts and autosave.

import { cellLabel, AREAS, areaLabel, FACING_NAMES, hasFixedFootprint, blocksLight, MARKERS, lightKind } from '../core/state.js';
import { BRUSH_KEYS, grid, hoverIndex, storage, ui } from './config.js';
import { applyControlBindings } from './controls.js';
import { closeDialog, dlg } from './files.js';
import { setViewMenu } from './panelControls.js';
import { setTool } from './pointer.js';
import { clearMove, setEdgeBrush } from '../editor/moveCheck.js';
import { cancelPlacing, confirmPlacing, flipPlacing, placing, rotatePlacing } from '../editor/placing.js';
import { setBrush, setShape } from '../editor/toolbar.js';
import { $ } from './dom.js';
import { hoverEdge } from '../editor/walls.js';
import { closeSettings, requestEndTurn } from '../play/gameSettings.js';
import { closeCasebook, closeInventory, hideCard, openCasebook, openInventory } from '../play/panels.js';
import { hideSheet } from '../play/sheets.js';
import { play } from '../play/playView.js';
import { markerHidden, markerUsed } from '../render/board.js';
import { siteOf, siteLabel } from '../core/sites.js';
import { BUILDING_TYPES, typeAt } from '../core/buildings.js';
import { buildingSeeds, buildingStyle, focusHovered, interiorStyle, renderer, setCamera } from '../render/scene.js';
import { lampsOn, lightLevels } from '../render/tileLook.js';
import { editorBoardShown } from './gameShell.js';

// Run once at startup (called from src/main.js, in order).
export function init() {
  $('#collapse').addEventListener('click', minimizePanel);
  $('#expand').addEventListener('click', () => { $('#panel').hidden = false; $('#expand').hidden = true; });

  // Click or tap off an open window (the side panel or the view menu) to
  // minimise it. A press on the board that only closes a window is swallowed,
  // so it never paints a tile, places a wall or moves the camera.
  window.addEventListener('pointerdown', (ev) => {
    const panelOpen = !$('#panel').hidden;
    const viewOpen = !$('#viewList').hidden && $('#viewList').parentElement === $('#viewMenu');
    if (!panelOpen && !viewOpen) return;
    const t = ev.target;
    const inside = (sel) => t instanceof Element && !!t.closest(sel);
    if (ui.mode === 'title' || inside('#screen') || inside('#gameMenuBtn')) return; // the game shell's screens
    if (inside('#dialog') || inside('#settings') || inside('#inventory') || inside('#playHud') || inside('#playChoices') || inside('#playTray')
      || inside('#teamSheet') || inside('#moreSheet') || inside('#askCard') || inside('#obolReveal') || inside('#revealSheet') || inside('#cardPop') || inside('#casebook') || inside('#intentBanner') || inside('#endConfirm')) return;
    let closed = false;
    if (panelOpen && !inside('#panel') && !inside('#expand')) { minimizePanel(); closed = true; }
    if (viewOpen && !inside('#viewMenu')) { setViewMenu(false); closed = true; }
    if (closed && t === renderer.domElement) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    }
  }, true);
  if (window.innerWidth < 700) { $('#panel').hidden = true; $('#expand').hidden = false; }

  window.addEventListener('keydown', (e) => {
    if (!dlg.root.hidden) { if (e.key === 'Escape') closeDialog(); return; }
    if (!$('#settings').hidden) { if (e.key === 'Escape') closeSettings(); return; }
    if (!$('#inventory').hidden) { if (e.key === 'Escape' || e.key.toLowerCase() === 'i') closeInventory(); return; }
    if (!$('#casebook').hidden) { if (e.key === 'Escape' || e.key.toLowerCase() === 'c') closeCasebook(); return; }
    for (const id of ['teamSheet', 'moreSheet']) if (!$(`#${id}`).hidden && e.key === 'Escape') { hideSheet(id); return; }
    if (!$('#cardPop').hidden && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); hideCard(); return; }
    if (ui.tool === 'play' && play.state.phase === 'revealing' && /^[1-4]$/.test(e.key)) {
      const faceDown = (play.state.mystery?.deck ?? []).map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
      const n = faceDown[Number(e.key) - 1];
      if (n !== undefined) play.revealCard(n);
      return;
    }
    if (ui.tool === 'play' && e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey
      && !(e.target instanceof HTMLInputElement)) { openCasebook(); return; }
    if (ui.tool === 'play' && e.key.toLowerCase() === 'i' && !e.ctrlKey && !e.metaKey
      && !(e.target instanceof HTMLInputElement)) { openInventory(); return; }
    // "Investigate?": Enter or Y = yes, Escape or N = no.
    if (ui.tool === 'play' && play.state.phase === 'asking') {
      const k = e.key.toLowerCase();
      if (k === 'enter' || k === 'y') { e.preventDefault(); play.answerInvestigate(true); return; }
      if (k === 'escape' || k === 'n') { e.preventDefault(); play.answerInvestigate(false); return; }
    }
    if (placing) {
      // A building preview: R turns it, F flips it, Enter places it, Esc cancels.
      const k = e.key.toLowerCase();
      if (k === 'escape') { cancelPlacing(); return; }
      if (k === 'enter') { confirmPlacing(); return; }
      if (k === 'r') { rotatePlacing(); return; }
      if (k === 'f') { flipPlacing(); return; }
    }
    if (e.key === 'Escape' && ui.tool === 'move') { clearMove(); return; }
    if (ui.tool === 'play' && e.key === 'Enter') {
      e.preventDefault();
      if (!$('#endConfirm').hidden) { $('#endConfirm').hidden = true; play.endTurn(); return; }
      if (play.state.phase === 'slotting') { if (play.slotTotal()) play.confirmMove(); else requestEndTurn(); } else play.roll();
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const mod = e.ctrlKey || e.metaKey;
    // Outside the editor, only camera and view keys (no tools, brushes or undo).
    if (ui.mode !== 'editor' && (mod || !['v', 't', 'a', ' '].includes(e.key.toLowerCase()))) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? grid.redo() : grid.undo();
      updateUndoButtons();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); grid.redo(); updateUndoButtons(); return; }
    if (mod) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!ui.spaceHeld) { ui.spaceHeld = true; applyControlBindings(); }
      return;
    }
    const key = e.key.toLowerCase();
    if (BRUSH_KEYS[e.key]) { setTool('cells'); setBrush(BRUSH_KEYS[e.key]); }
    else if (key === 'm') setTool('move');
    else if (key === 'p') setTool('markers');
    else if (key === 'b') setTool('buildings');
    else if (key === 'v') setViewMenu($('#viewList').hidden);
    else if (key === 'y') setTool('play', 'standard');
    else if (['w', 'd', 'k', 'o', 'x', 'g'].includes(key)) {
      setTool('walls');
      setEdgeBrush({ w: 'wall', d: 'door', k: 'lockedDoor', o: 'oneWayDoor', x: 'erase', g: 'window' }[key]);
    }
    else if (e.key === 'r' || e.key === 'R') setShape(ui.shape === 'rect' ? 'brush' : 'rect');
    else if (e.key === 't' || e.key === 'T') setCamera('top');
    else if (e.key === 'a' || e.key === 'A') setCamera('angled');
    else if (key === 'f') focusHovered();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { ui.spaceHeld = false; applyControlBindings(); }
  });
  window.addEventListener('blur', () => { ui.spaceHeld = false; applyControlBindings(); });
}

export function minimizePanel() { $('#panel').hidden = true; $('#expand').hidden = false; }

export function updateUndoButtons() {
  $('#undo').disabled = grid.undoStack.length === 0;
  $('#redo').disabled = grid.redoStack.length === 0;
}

export function updateHoverInfo() {
  const el = $('#hover');
  if (hoverEdge && hoverIndex < 0) {
    const { o, x, y } = hoverEdge;
    const type = grid.edgeAt(`${o}${x},${y}`);
    const names = grid.edgeCells(o, x, y).map((c) => (grid.inBounds(c.x, c.y) ? cellLabel(c.x, c.y) : 'edge'));
    el.innerHTML = `<span class="id">${names.join(' | ')}</span>` +
      `<span class="tag">${edgeLabel(o, x, y, type)}</span>` +
      (type ? `<span class="tag">${blocksLight(type) ? 'Blocks light' : 'Light passes'}</span>` : '');
    return;
  }
  if (hoverIndex < 0) { el.textContent = 'Hover a cell'; return; }
  const { x, y } = grid.coords(hoverIndex);
  const c = grid.cells[hoverIndex];
  el.innerHTML =
    `<span class="id">${cellLabel(x, y)}</span>` +
    `<span class="tag">${AREAS[c.area].label} · ${areaLabel(c)}${c.sub === 'start' ? ` (van facing ${FACING_NAMES[grid.startFacing(hoverIndex)]})` : hasFixedFootprint(c.sub) && c.facing !== null ? ` (faces ${FACING_NAMES[c.facing]}${c.flip ? ', flipped' : ''})` : ''}</span>` +
    (c.area === 'indoor' ? (() => {
      const seed = buildingSeeds()[hoverIndex];
      const t = BUILDING_TYPES[typeAt(grid, hoverIndex)];
      return (t ? `<span class="tag marker-tag">${t.label}</span><span class="tag">Outside: ${t.exterior}</span><span class="tag">Inside: ${t.interior}</span>`
        : `<span class="tag">Outside: ${buildingStyle(seed).name}</span><span class="tag">Inside: ${interiorStyle(seed).name}</span>`);
    })() : '') +
    (grid.cells.some((s, j) => s.sub === 'start' && grid.startFront(j) === hoverIndex) ? '<span class="tag marker-tag">Player start</span>' : '') +
    (c.bridge ? `<span class="tag">Bridge (spans ${grid.bridgeAxis(x, y) === 'x' ? 'E–W' : 'N–S'})</span>` : '') +
    `<span class="tag">${lightLabel(c, hoverIndex)}</span>` +
    `<span class="tag">${c.walkable ? 'Walkable' : 'Blocked'}</span>` +
    (c.marker && !markerHidden(hoverIndex) ? `<span class="tag marker-tag">${markerLabel(c, hoverIndex)}</span>` : '');
}

export function edgeLabel(o, x, y, type) {
  if (type?.startsWith('oneWayDoor')) {
    const [a, b] = grid.edgeCellsLabels(o, x, y).map((l) => l ?? 'edge');
    return type.endsWith('+') ? `One-way door ${a} → ${b}` : `One-way door ${b} → ${a}`;
  }
  const auto = type && !grid.edges.has(`${o}${x},${y}`) ? ' (condemned)' : '';
  return ({
    door: 'Unlocked door', lockedDoor: 'Locked door', wall: 'Wall', window: 'Window',
    boardedDoor: 'Boarded-up door', boardedWindow: 'Boarded-up window',
  }[type] ?? 'Open') + auto;
}

export function markerLabel(c, i) {
  const site = c.marker === 'objective' ? siteOf(c, grid, i) : null;
  const label = site ? `Objective: ${siteLabel(site)}` : `${MARKERS[c.marker].label} marker`;
  if (!c.walkable) return `${label} (cell is blocked)`;
  if (markerUsed(i)) return `${label} (${{ whiteDice: 'collected', blackDice: 'attuned', key: 'picked up', investigation: 'visited', objective: 'visited' }[c.marker] ?? 'used'})`;
  if (c.marker === 'key') {
    const n = grid.keyDoors(i).length;
    return `${label}: unlocks ${n} door${n === 1 ? '' : 's'}`;
  }
  return label;
}

export function lightLabel(c, i) {
  const pct = `${Math.round(lightLevels[i] * 100)}%`;
  if (lampsOn[i]) return `Lit lamp · ${pct}`;
  if (c.lit) return `Light source r ${c.radius} (${lightKind(c.radius)}) · ${pct}`;
  return lightLevels[i] > 0 ? `Light ${pct}` : 'Dark';
}

export function updateCounts() {
  const n = grid.counts();
  // Category totals, then every subcategory in use.
  const subs = [];
  for (const area in AREAS) {
    for (const sub in AREAS[area].subs) {
      if (n.subs[sub]) subs.push(`${AREAS[area].subs[sub].label} <b>${n.subs[sub]}</b>`);
    }
  }
  $('#counts').innerHTML =
    `Outdoor <b>${n.outdoor}</b> · Indoor <b>${n.indoor}</b> · Water <b>${n.water}</b><br>` +
    `<span class="sub-counts">${subs.join(' · ')}</span><br>` +
    `Bridges <b>${n.bridge}</b> · Walls <b>${n.wall}</b> · Windows <b>${n.window}</b> · Lit lamps <b>${n.lamp}</b><br>` +
    `Doors: unlocked <b>${n.door}</b> · locked <b>${n.lockedDoor}</b> · one-way <b>${n.oneWayDoor}</b><br>` +
    (n.boardedDoor + n.boardedWindow ? `Boarded up: doors <b>${n.boardedDoor}</b> · windows <b>${n.boardedWindow}</b><br>` : '') +
    `Light sources <b>${n.lit}</b> · Lit cells <b>${lightLevels.reduce((k, v) => k + (v > 0), 0)}</b><br>` +
    (Object.keys(n.markers).length
      ? `Markers: ${Object.keys(MARKERS).filter((t) => n.markers[t]).map((t) => `${MARKERS[t].label} <b>${n.markers[t]}</b>`).join(' · ')}<br>`
      : '') +
    `Walkable <b>${n.walkable}</b> · Blocked <b>${n.blocked}</b> · ${grid.cols}×${grid.rows}`;
}

export let saveTimer = 0;
export function scheduleSave() {
  if (!editorBoardShown()) return; // a game's map is on the board: never save it over the editor's
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!editorBoardShown()) return; // a game started meanwhile
    $('#saveNote').textContent = storage.plannerBoard.set(grid.toJSON())
      ? `Autosaved ${new Date().toLocaleTimeString()}.`
      : 'Autosave unavailable here — use Export JSON.';
  }, 300);
}
