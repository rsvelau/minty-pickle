// The side panel's tool, brush, shape and view selectors, and the tile menu.

import { TILE_CATEGORIES, AREAS, defaultWalkable } from '../core/state.js';
import { BRUSH_KEYS, SUB_LOOK, ui } from '../app/config.js';
import { applyControlBindings } from '../app/controls.js';
import { setTool } from '../app/pointer.js';
import { move, refreshMoveOverlay } from './moveCheck.js';
import { cancelPlacing, confirmPlacing, flipPlacing, placing, rotatePlacing } from './placing.js';
import { refreshAll } from '../render/tileLook.js';
import { $, $$ } from '../app/dom.js';

// Run once at startup (called from src/main.js, in order).
export function init() {
  // Area brushes are generated from AREAS so new subcategories show up here,
  // sorted into TILE_CATEGORIES (collapsible), with a search box on top.
  {
    const keyFor = Object.fromEntries(Object.entries(BRUSH_KEYS).map(([k, v]) => [v, k]));
    const host = $('#areaBrushes');
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'tile-search';
    search.placeholder = 'Find a tile… (e.g. motel, forest)';
    host.appendChild(search);
    let openCats = new Set(['roads', 'nature', 'interiors']);
    try { const saved = JSON.parse(localStorage.getItem('tileCatsOpen')); if (Array.isArray(saved)) openCats = new Set(saved); } catch { /* fine */ }
    const sections = [];
    for (const cat of TILE_CATEGORIES) {
      const sec = document.createElement('details');
      sec.className = 'tile-cat';
      sec.dataset.cat = cat.id;
      sec.open = openCats.has(cat.id);
      sec.innerHTML = `<summary><span>${cat.label}</span><em></em></summary><div class="area-grid"></div>`;
      sec.addEventListener('toggle', () => {
        if (search.value) return;
        if (sec.open) openCats.add(cat.id); else openCats.delete(cat.id);
        try { localStorage.setItem('tileCatsOpen', JSON.stringify([...openCats])); } catch { /* fine */ }
      });
      let n = 0;
      for (const [area, def] of Object.entries(AREAS)) {
        for (const [sub, sdef] of Object.entries(def.subs)) {
          if ((sdef.cat ?? 'roads') !== cat.id) continue;
          const id = `${area}:${sub}`;
          const look = SUB_LOOK[sub];
          const blocked = !defaultWalkable(area, sub);
          const fp = sdef.footprint;
          const size = Array.isArray(fp) ? `${fp[0]}×${fp[1]}` : fp === 'fill' ? 'area' : '';
          const b = document.createElement('button');
          b.className = 'brush';
          b.dataset.brush = id;
          b.dataset.find = `${sdef.label} ${def.label} ${cat.label} ${sub}`.toLowerCase();
          b.title = `${def.label}: ${sdef.label}${blocked ? ' (blocked)' : ''}${size === 'area' ? ' (paint any area)' : size ? ` (${size} cells)` : ''}`;
          const sw = look ? `<i class="sw" style="background:${look.unlit}"></i>` : `<i class="sw sw-${sub}"></i>`;
          b.innerHTML = `${sw}<span>${sdef.label}</span>${size ? `<b class="fp">${size}</b>` : ''}${keyFor[id] ? `<kbd>${keyFor[id]}</kbd>` : ''}`;
          sec.querySelector('.area-grid').appendChild(b);
          n++;
        }
      }
      if (!n) continue;
      sec.querySelector('summary em').textContent = n;
      host.appendChild(sec);
      sections.push(sec);
    }
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      for (const sec of sections) {
        let hits = 0;
        for (const b of sec.querySelectorAll('.brush')) {
          const hit = !q || q.split(/\s+/).every((w) => b.dataset.find.includes(w));
          b.hidden = !hit;
          hits += hit;
        }
        sec.hidden = !hits;
        sec.open = q ? true : openCats.has(sec.dataset.cat);
      }
    });
  }
  $$('.brush[data-brush]').forEach((b) => b.addEventListener('click', () => setBrush(b.dataset.brush)));
  $('#placeRotate').addEventListener('click', rotatePlacing);
  $('#placeFlip').addEventListener('click', flipPlacing);
  $('#placeOk').addEventListener('click', confirmPlacing);
  $('#placeCancel').addEventListener('click', cancelPlacing);
  $$('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool, b.dataset.start)));
  $('#moveRange').addEventListener('input', (e) => {
    move.range = Number(e.target.value);
    $('#moveRangeOut').textContent = move.range ? `${move.range}` : 'off';
    refreshMoveOverlay();
  });
  $('#moveDiagonal').addEventListener('change', (e) => { move.diagonal = e.target.checked; refreshMoveOverlay(); });
  $('#moveKeys').addEventListener('change', (e) => { move.keys = e.target.checked; refreshMoveOverlay(); });
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------


export function setBrush(name) {
  if (placing && placing.brush !== name) cancelPlacing();
  ui.brush = name;
  $$('.brush[data-brush]').forEach((b) => b.classList.toggle('on', b.dataset.brush === name));
}
export function setShape(name) {
  if (name === 'rect') cancelPlacing();
  ui.shape = name;
  $$('[data-shape]').forEach((b) => b.classList.toggle('on', b.dataset.shape === name));
}
export function setView(name) {
  ui.view = name;
  $$('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
  $('#viewCurrent').textContent = { all: 'All', area: 'Area', light: 'Light', walk: 'Move' }[name];
  refreshAll();
}
export function setOrbitMode(on) {
  ui.orbitMode = on;
  $('#camMode').classList.toggle('on', on);
  applyControlBindings();
}
