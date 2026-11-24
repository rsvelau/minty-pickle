// Editor → File → Stress test: how heavy is a tile, a premade building, or
// this map, on this device?
//
// Fills a board (up to the largest, 60 x 60) with one subject, or takes the
// map as it is, then measures two views for a few seconds each at full frame
// rate: the whole board (the most there can ever be on screen) and a close-up
// (what play usually looks like). Reports frames per second (average and the
// slowest 10% of frames), triangles and draw calls per frame (shadow pass
// included) and how long the board took to build. "Copy results" puts the
// numbers on the clipboard to paste into a chat.
//
// The editor's board is set aside while a filled board is shown (like a
// game: autosave is off) and comes back when the panel closes.
import * as THREE from 'three';
import { MAX_SIZE, TILE_CATEGORIES } from '../core/state.js';
import { filledBoard, subjects } from '../core/stressBoard.js';
import { grid, ui } from '../app/config.js';
import { $ } from '../app/dom.js';
import { toast } from '../app/files.js';
import { borrowBoard, editorBoardShown, returnBoard } from '../app/gameShell.js';
import { minimizePanel } from '../app/shell.js';
import { autoRes, setDreadOverride, shadowFrame } from '../app/loop.js';
import { __set_camTween, camera, controls, qualityName, renderer, resScale, setCamera, setResScale, wake } from '../render/scene.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIZES = [[26, 20, 'Hawthorn Bend size'], [40, 40, ''], [MAX_SIZE, MAX_SIZE, 'largest']];
const SETTLE_MS = 1500;   // shaders compile, the camera settles
const MEASURE_MS = 4000;  // per view

let opts = { subject: 'map', size: 2, midnight: true, rooms: true };
let borrowed = false;
let running = false;
let last = null; // the last results

const panel = () => $('#stressPanel');

export function openStressTest() {
  if (ui.mode !== 'editor' || running) return;
  minimizePanel();
  document.body.classList.add('stress-on');
  showSetup();
}

function showSetup() {
  const el = panel();
  const subs = subjects();
  const groups = TILE_CATEGORIES.map((c) => {
    const list = subs.filter((s) => s.cat === c.id);
    return list.length ? `<optgroup label="${esc(c.label)}">${list.map((s) => `<option value="${s.id}" ${opts.subject === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  el.innerHTML = `
    <div class="sp-head"><b>Stress test</b><button class="sp-x" data-close aria-label="Close">✕</button></div>
    <label class="sp-field">Fill the board with
      <select id="spSubject"><option value="map" ${opts.subject === 'map' ? 'selected' : ''}>Nothing: measure this map as it is</option>${groups}</select>
    </label>
    <div class="sp-sizes" id="spSize" ${opts.subject === 'map' ? 'hidden' : ''}>${SIZES.map(([c, r, note], k) => `<button data-size="${k}" class="${opts.size === k ? 'on' : ''}">${c} × ${r}${note ? `<small>${esc(note)}</small>` : ''}</button>`).join('')}</div>
    <label class="sp-check"><input type="checkbox" id="spMid" ${opts.midnight ? 'checked' : ''} /> Midnight effects (downpour, flicker, swaying trees)</label>
    <label class="sp-check" id="spRoomsRow" ${opts.subject === 'map' ? 'hidden' : ''}><input type="checkbox" id="spRooms" ${opts.rooms ? 'checked' : ''} /> Indoor floors: split into 4 × 4 rooms</label>
    <p class="sp-note">Runs at the current quality (<b>${esc(qualityName)}</b>). ${opts.subject === 'map' ? '' : 'Your board is set aside and comes back when you close this. Its undo history is cleared.'}</p>
    <div class="sp-btns"><button class="sp-go" id="spRun">Run (about 12 s)</button></div>`;
  el.hidden = false;
  el.querySelector('[data-close]').onclick = closeStressTest;
  el.querySelector('#spSubject').onchange = (e) => { opts.subject = e.target.value; showSetup(); };
  el.querySelectorAll('[data-size]').forEach((b) => { b.onclick = () => { opts.size = Number(b.dataset.size); showSetup(); }; });
  el.querySelector('#spMid').onchange = (e) => { opts.midnight = e.target.checked; };
  el.querySelector('#spRooms').onchange = (e) => { opts.rooms = e.target.checked; };
  el.querySelector('#spRun').onclick = () => run().catch((e) => { console.error(e); running = false; autoRes.paused = false; toast(`Stress test failed: ${e.message}`); showSetup(); });
}

function status(text) {
  panel().innerHTML = `<div class="sp-head"><b>Stress test</b></div><p class="sp-status">${esc(text)}</p>`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Measure the current view: every rendered frame for MEASURE_MS at full rate.
function measure() {
  return new Promise((resolve) => {
    const times = [];
    let lastFrame = renderer.info.render.frame;
    // The view (camera pass) and the shadow redraws are counted apart: the
    // shadow map is only redrawn now and then (src/app/loop.js).
    let tris = 0, calls = 0, samples = 0, shTris = 0, shCalls = 0, shadows = 0;
    const t0 = performance.now();
    const step = (now) => {
      wake(300);
      const f = renderer.info.render.frame;
      if (f !== lastFrame) {
        lastFrame = f;
        times.push(now);
        if (shadowFrame) { shTris += renderer.info.render.triangles; shCalls += renderer.info.render.calls; shadows++; } else {
          tris += renderer.info.render.triangles;
          calls += renderer.info.render.calls;
          samples++;
        }
      }
      if (now - t0 < MEASURE_MS) { requestAnimationFrame(step); return; }
      const gaps = times.slice(1).map((t, k) => t - times[k]).sort((a, b) => a - b);
      const span = times.length > 1 ? times[times.length - 1] - times[0] : MEASURE_MS;
      const p90 = gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))] : MEASURE_MS;
      const view = samples ? { tris: tris / samples, calls: calls / samples } : null;
      const withShadow = shadows ? { tris: shTris / shadows, calls: shCalls / shadows } : null;
      resolve({
        fps: times.length > 1 ? ((times.length - 1) * 1000) / span : 0,
        low: 1000 / p90,
        // Without a frame that skipped the shadows (a very slow device), the
        // view can't be told apart: report the whole frame.
        tris: Math.round((view ?? withShadow ?? { tris: 0 }).tris),
        calls: Math.round((view ?? withShadow ?? { calls: 0 }).calls),
        shadowTris: view && withShadow ? Math.max(0, Math.round(withShadow.tris - view.tris)) : null,
        shadowsPerSec: (shadows * 1000) / Math.max(1, performance.now() - t0),
      });
    };
    requestAnimationFrame(step);
  });
}

function closeUp() {
  // Straight down onto the middle of the board at the angled view's slant,
  // about 9 cells away: roughly what a turn of play looks like.
  const dir = new THREE.Vector3(0, 27, 29).normalize();
  controls.target.set(0, 0, 0);
  camera.position.copy(dir.multiplyScalar(9));
  controls.update();
}

async function run() {
  running = true;
  const subject = subjects().find((s) => s.id === opts.subject) ?? null;
  const [cols, rows] = subject ? SIZES[opts.size] : [grid.cols, grid.rows];
  status('Building the board…');
  await sleep(30);
  const t0 = performance.now();
  if (subject) {
    borrowBoard(filledBoard(subject, cols, rows, { rooms: opts.rooms, terrain: grid.terrain }));
    borrowed = true;
  }
  const buildMs = Math.round(performance.now() - t0);
  setDreadOverride(opts.midnight ? 1 : 0);
  // Measure the quality as set: automatic resolution waits till we're done.
  autoRes.paused = true;
  if (resScale !== 1) setResScale(1);
  const views = [];
  for (const [name, frame] of [['Whole board', () => setCamera('angled', true)], ['Close up', closeUp]]) {
    __set_camTween(null); // a glide still running (a resize starts one) would move the camera away
    frame();
    status(`Measuring: ${name.toLowerCase()}…`);
    const settleEnd = performance.now() + SETTLE_MS + (opts.midnight ? 2500 : 0); // midnight eases in over ~4 s
    while (performance.now() < settleEnd) { wake(300); await sleep(100); }
    views.push({ name, ...(await measure()) });
  }
  setCamera('angled', true);
  autoRes.paused = false;
  running = false;
  last = {
    subject: subject ? subject.label : (editorBoardShown() ? 'This map' : 'The map on the board'),
    size: `${cols} × ${rows}`, cells: cols * rows, buildMs, views,
    quality: qualityName, midnight: opts.midnight,
    screen: `${window.innerWidth} × ${window.innerHeight} at ${renderer.getPixelRatio().toFixed(2)}×`,
    device: navigator.userAgent,
  };
  showResults();
}

export function resultsText(r = last) {
  const k = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));
  return [
    `Stress test: ${r.subject}, ${r.size} (${r.cells} spaces), quality ${r.quality}${r.midnight ? ', midnight' : ''}`,
    ...r.views.map((v) => `${v.name}: ${v.fps.toFixed(0)} fps (slowest 10%: ${v.low.toFixed(0)}), ${k(v.tris)} triangles, ${v.calls} draw calls, shadow redraw ${v.shadowTris === null ? 'n/a' : `${k(v.shadowTris)} triangles`} (${v.shadowsPerSec.toFixed(1)}/s)`),
    `Board built in ${r.buildMs} ms. Screen ${r.screen}.`,
    r.device,
  ].join('\n');
}

function showResults() {
  const r = last;
  const k = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());
  const tone = (fps) => (fps >= 50 ? 'good' : fps >= 28 ? 'ok' : 'bad');
  const el = panel();
  el.innerHTML = `
    <div class="sp-head"><b>${esc(r.subject)}</b><button class="sp-x" data-close aria-label="Close">✕</button></div>
    <p class="sp-note">${esc(r.size)} (${r.cells.toLocaleString()} spaces) · ${esc(r.quality)}${r.midnight ? ' · midnight' : ''}</p>
    <table class="sp-table">
      <tr><th></th><th>fps</th><th>slowest 10%</th><th>triangles</th><th>draws</th><th>shadows</th></tr>
      ${r.views.map((v) => `<tr><th>${esc(v.name)}</th><td class="${tone(v.fps)}">${v.fps.toFixed(0)}</td><td class="${tone(v.low)}">${v.low.toFixed(0)}</td><td>${k(v.tris)}</td><td>${v.calls}</td><td>${v.shadowTris === null ? '–' : k(v.shadowTris)}</td></tr>`).join('')}
    </table>
    <p class="sp-note">Board built in ${r.buildMs} ms. Triangles and draws are what the view draws each frame. Shadows: triangles in a shadow redraw, which happens only when something moves (at most 4 a second). Aim: 30 fps or more in the slowest 10%.</p>
    <div class="sp-btns"><button id="spCopy">Copy results</button><button id="spAgain">Another test</button><button class="sp-go" data-close>Done</button></div>`;
  el.querySelectorAll('[data-close]').forEach((b) => { b.onclick = closeStressTest; });
  el.querySelector('#spAgain').onclick = showSetup;
  el.querySelector('#spCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(resultsText()); toast('Results copied.'); } catch { toast('Copy was blocked here.'); }
  };
}

export function closeStressTest() {
  if (running) return;
  panel().hidden = true;
  panel().innerHTML = '';
  document.body.classList.remove('stress-on');
  setDreadOverride(null);
  if (borrowed) { returnBoard(); borrowed = false; }
  setCamera('angled');
}

export function init() {
  $('#stressTest').addEventListener('click', openStressTest);
}
