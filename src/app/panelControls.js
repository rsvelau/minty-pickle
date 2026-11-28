// Side panel controls: view menu, elevation presets, marker brushes,
// light radius, board size, undo/redo/clear.

import { MAX_RADIUS, MARKERS, centreBrightness, lightKind, MIN_SIZE, MAX_SIZE, defaultCell } from '../core/state.js';
import { setTerrain, terrainId, TERRAIN_PRESETS } from '../render/terrain.js';
import { drawMarkerIcon } from '../render/markers.js';
import { SITES, FIXTURES } from '../core/sites.js';
import { BUILDING_TYPES, BUILDING_ORDER, buildingIds, buildingTypes } from '../core/buildings.js';
import { monsterAvailability } from '../game/objectives/scripts.js';
import { METERS_PER_CELL } from '../core/scale.js';
import { grid, ui } from './config.js';
import { toast } from './files.js';
import { setTool } from './pointer.js';
import { scheduleSave, updateUndoButtons, minimizePanel } from './shell.js';
import { setBrush } from '../editor/toolbar.js';
import { $ } from './dom.js';
import { N, labelGroup, refreshMarkers, refreshPropsAndWalls, refreshWaterAndBridges } from '../render/board.js';
import { scene } from '../render/scene.js';
import { applyAtmosphere } from '../render/surroundings.js';

// Run once at startup (called from src/main.js, in order).
export function init() {
  $('#viewToggle').addEventListener('click', () => setViewMenu($('#viewList').hidden));
  {
    let open = window.innerWidth >= 700;
    try { const v = localStorage.getItem('minty-pickle.viewMenu'); if (v !== null) open = v === '1'; } catch { /* ignore */ }
    setViewMenu(open);
  }

  $('#optLabels').addEventListener('change', (e) => { ui.labels = e.target.checked; labelGroup.visible = ui.labels; });
  $('#optAtmos').addEventListener('change', (e) => { ui.atmosphere = e.target.checked; applyAtmosphere(); });
  $('#optGhost').addEventListener('change', (e) => { ui.ghost = e.target.checked; });
  $('#optLowWalls').addEventListener('change', (e) => { ui.lowWalls = e.target.checked; refreshPropsAndWalls(); });
  $('#optMarkers').addEventListener('change', (e) => { ui.showMarkers = e.target.checked; refreshMarkers(); });
  {
    const host = $('#terrainPresets');
    for (const [id, t] of Object.entries(TERRAIN_PRESETS)) {
      const b = document.createElement('button');
      b.dataset.terrain = id;
      b.textContent = t.label;
      b.title = t.note;
      b.addEventListener('click', () => { applyTerrain(id); scheduleSave(); });
      host.appendChild(b);
    }
    applyTerrain(grid.terrain);
  }
  document.querySelectorAll('[data-marker]').forEach((b) => {
    const t = b.dataset.marker;
    if (MARKERS[t]) {
      const icon = b.querySelector('.marker-icon');
      if (icon) icon.style.backgroundImage = `url(${drawMarkerIcon(t, 64).toDataURL()})`;
      b.title = MARKERS[t].note;
    }
    b.addEventListener('click', () => { setTool('markers'); setMarkerBrush(t); });
  });
  // Objective sites: the picker, and what the map's sites let it host.
  $('#siteBrush').innerHTML = '<option value="">From its building (Buildings tool)</option>' +
    Object.entries(SITES).map(([id, s]) => `<option value="${id}">${s.label}${s.number ? ` {${s.number}}` : ''}</option>`).join('');
  $('#siteBrush').value = ui.siteBrush;
  $('#siteBrush').addEventListener('change', (e) => { ui.siteBrush = e.target.value; renderSiteNote(); });
  // Buildings tool: one button per type, and Generic to clear.
  $('#buildingTypes').innerHTML = [['', 'Generic'], ...BUILDING_ORDER.map((t) => [t, BUILDING_TYPES[t].label])]
    .map(([t, label]) => `<button class="brush" data-btype="${t}">${label}</button>`).join('');
  document.querySelectorAll('[data-btype]').forEach((b) => b.addEventListener('click', () => {
    setTool('buildings');
    setBuildingBrush(b.dataset.btype);
    // On a phone the panel covers the board: get it out of the way so the next tap tags a building.
    if (window.innerWidth < 700) {
      minimizePanel();
      toast(`Tap a building to make it ${b.dataset.btype ? `a ${BUILDING_TYPES[b.dataset.btype].label}` : 'generic'}.`);
    }
  }));
  setBuildingBrush(ui.buildingBrush);
  let availTimer = 0;
  grid.onChange(() => { clearTimeout(availTimer); availTimer = setTimeout(() => { renderSiteAvail(); renderBuildingList(); }, 250); });
  renderBuildingList();
  renderSiteAvail();
  setMarkerBrush(ui.markerBrush);
  $('#lightRadius').max = MAX_RADIUS;
  $('#lightRadius').addEventListener('input', (e) => {
    ui.lightRadius = Number(e.target.value);
    syncRadius();
    setTool('cells');
    setBrush('lit');
  });
  syncRadius();
  for (const id of ['#sizeCols', '#sizeRows']) {
    Object.assign($(id), { min: MIN_SIZE, max: MAX_SIZE });
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') applySize(); });
  }
  $('#sizeApply').addEventListener('click', applySize);
  syncSizeInputs();

  $('#undo').addEventListener('click', () => { grid.undo(); updateUndoButtons(); });
  $('#redo').addEventListener('click', () => { grid.redo(); updateUndoButtons(); });
  $('#clear').addEventListener('click', () => {
    grid.replaceAll(grid.cols, grid.rows, Array.from({ length: N }, defaultCell), new Map());
    updateUndoButtons();
    toast('Board cleared. Undo (Ctrl/Cmd+Z) brings it back.');
  });
}

// View menu: open/closed is remembered per browser.
export function setViewMenu(open) {
  $('#viewList').hidden = !open;
  $('#viewToggle').setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('view-open', open);
  try { localStorage.setItem('minty-pickle.viewMenu', open ? '1' : '0'); } catch { /* ignore */ }
}

// Elevation presets: switch the height formula, then rebuild every shader.
export function applyTerrain(id) {
  setTerrain(id);
  grid.terrain = terrainId();
  refreshWaterAndBridges();
  scene.traverse((o) => {
    for (const mat of [].concat(o.material ?? [])) mat.needsUpdate = true;
  });
  document.querySelectorAll('[data-terrain]').forEach((b) => b.classList.toggle('on', b.dataset.terrain === grid.terrain));
  $('#terrainNote').textContent = TERRAIN_PRESETS[grid.terrain].note;
  refreshMarkers();
}

// Marker brushes: icons drawn from the same art as the board badges.
export function setMarkerBrush(name) {
  ui.markerBrush = name;
  document.querySelectorAll('[data-marker]').forEach((b) => b.classList.toggle('on', b.dataset.marker === name));
  $('#siteRow').hidden = name !== 'objective';
  renderSiteNote();
}
export function setBuildingBrush(t) {
  ui.buildingBrush = t;
  document.querySelectorAll('[data-btype]').forEach((b) => b.classList.toggle('on', b.dataset.btype === t));
}
// The buildings on this map and what they are.
function renderBuildingList() {
  const ids = buildingIds(grid), types = buildingTypes(grid);
  const all = new Set([...ids].filter((b) => b >= 0));
  const named = [...types.values()].reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {});
  $('#buildingList').innerHTML = all.size
    ? `<b>${all.size} building${all.size === 1 ? '' : 's'}</b>, ${types.size} given a type${types.size ? `: ${Object.entries(named).map(([t, n]) => `${BUILDING_TYPES[t].label}${n > 1 ? ` ×${n}` : ''}`).join(', ')}` : ''}.`
    : 'No buildings yet: paint indoor floor and walls first.';
}
// What the chosen site always holds.
function renderSiteNote() {
  const s = SITES[ui.siteBrush];
  $('#siteNote').hidden = ui.markerBrush !== 'objective';
  $('#siteNote').textContent = s ? `${s.label}: ${s.fixtures.map((f) => FIXTURES[f]?.label ?? f).join(', ')}.`
    : 'A marker inside a building given a type (Buildings tool) is that site; elsewhere it is a plain objective (still an anchor for the Poltergeist).';
}
// Which monsters this map can host: the rest are disabled (their objectives need sites it lacks).
export function renderSiteAvail() {
  const { available, disabled } = monsterAvailability(grid);
  $('#siteAvail').innerHTML = disabled.length
    ? `<b>${available.length} of ${available.length + disabled.length} monsters</b> can be played on this map. Disabled: ${disabled.map((d) => `${d.name} (needs ${d.missing.join(', ')})`).join('; ')}.`
    : `All ${available.length} monsters can be played on this map.`;
}

// Light source radius: the centre brightness follows the size of the light.
export function syncRadius() {
  const r = ui.lightRadius;
  $('#lightRadiusOut').textContent = `${r} · ${Math.round(centreBrightness(r) * 100)}%`;
  $('#lightRadiusNote').textContent =
    `${lightKind(r)}: centre ${Math.round(centreBrightness(r) * 100)}% bright` +
    (r < 1 ? ', lights only its own cell.' : `, reaches ${r} cell${r === 1 ? '' : 's'} out. Walls block it; windows and doors let it through.`);
}

// Board size
export function syncSizeInputs() {
  $('#sizeCols').value = grid.cols;
  $('#sizeRows').value = grid.rows;
  $('#sizeReadout').textContent =
    `${grid.cols} × ${grid.rows} cells ≈ ${grid.cols * METERS_PER_CELL} × ${grid.rows * METERS_PER_CELL} m ` +
    `(${Math.round(grid.cols * METERS_PER_CELL * 3.281)} × ${Math.round(grid.rows * METERS_PER_CELL * 3.281)} ft)`;
}
export function applySize() {
  const cols = Number($('#sizeCols').value);
  const rows = Number($('#sizeRows').value);
  const shrinking = cols < grid.cols || rows < grid.rows;
  if (grid.resize(cols, rows)) {
    updateUndoButtons();
    toast(shrinking ? 'Board resized. Cells past the new edge were removed; undo restores them.' : 'Board resized.');
  }
  syncSizeInputs(); // shows clamped values
}
