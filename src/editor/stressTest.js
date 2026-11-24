// Editor → File → Stress test: how heavy is a tile, a premade building, or
// this map, on this device?
//
// Fills a board (up to the largest, 35 x 35) with one subject, or takes the
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
import { autoRes, frameLog, setDreadOverride } from '../app/loop.js';
import { __set_camTween, camera, controls, qualityName, renderer, resScale, setCamera, setResScale, wake } from '../render/scene.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIZES = [[26, 20, 'Hawthorn Bend size'], [MAX_SIZE, MAX_SIZE, 'largest']];
const SETTLE_MS = 1500;   // shaders compile, the camera settles
const MEASURE_MS = 4000;  // per view
const SYNC_MS = 2000;     // per view, waiting for the GPU every frame

let opts = { subject: 'map', size: 1, midnight: true, rooms: true };
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
    <div class="sp-btns"><button class="sp-go" id="spRun">Run (about 16 s)</button></div>`;
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

// Measure the current view: every rendered frame for MEASURE_MS at full
// rate, from the frame log (src/app/loop.js).
const pct = (list, q) => { if (!list.length) return null; const a = [...list].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * q))]; };
const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
async function measure() {
  frameLog.frames = [];
  frameLog.gpu = [];
  frameLog.recording = true;
  const t0 = performance.now();
  while (performance.now() - t0 < MEASURE_MS) { wake(300); await sleep(100); }
  frameLog.recording = false;
  await sleep(200); // late GPU timer results
  const frames = frameLog.frames;
  const gpuTimes = frameLog.gpu;
  // Then SYNC_MS with every frame waiting for the GPU: the full frame cost.
  frameLog.frames = [];
  frameLog.sync = frameLog.recording = true;
  const t1 = performance.now();
  while (performance.now() - t1 < SYNC_MS) { wake(300); await sleep(100); }
  frameLog.sync = frameLog.recording = false;
  const synced = frameLog.frames.slice(1); // the first may straddle the switch
  const syncPlain = synced.filter((f) => !f.shadow);
  const syncView = syncPlain.length ? syncPlain : synced;
  const syncShadow = synced.filter((f) => f.shadow);
  const gaps = frames.slice(1).map((f, k) => f.t - frames[k].t);
  const span = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : MEASURE_MS;
  const plain = frames.filter((f) => !f.shadow), shadowed = frames.filter((f) => f.shadow);
  const view = plain.length ? plain : shadowed; // a very slow device redraws shadows every frame
  const viewTris = mean(view.map((f) => f.tris)) ?? 0;
  return {
    fps: frames.length > 1 ? ((frames.length - 1) * 1000) / span : 0,
    low: gaps.length ? 1000 / pct(gaps, 0.9) : 0,
    tris: Math.round(viewTris),
    calls: Math.round(mean(view.map((f) => f.calls)) ?? 0),
    shadowTris: plain.length && shadowed.length ? Math.max(0, Math.round(mean(shadowed.map((f) => f.tris)) - viewTris)) : null,
    shadowsPerSec: (shadowed.length * 1000) / Math.max(1, span),
    cpu: pct(view.map((f) => f.cpu), 0.5), cpu90: pct(view.map((f) => f.cpu), 0.9),
    cpuShadow: pct(shadowed.map((f) => f.cpu), 0.5),
    gpu: pct(gpuTimes, 0.5), gpu90: pct(gpuTimes, 0.9),
    frame: pct(syncView.map((f) => f.total), 0.5), frame90: pct(syncView.map((f) => f.total), 0.9),
    frameShadow: pct(syncShadow.map((f) => f.total), 0.5),
  };
}
// How many times the slowest 10% of frames fit in the 30 fps budget (33 ms a
// frame), from the better-supported of two measures:
// - the frame rate: frames that come every N ms take at most N ms, so this is
//   a floor ("at least"); it can't show more than the screen's refresh rate.
// - the synced frame cost: waiting for the GPU every frame adds a stall of
//   its own (large on some phone GPUs), so it errs on the low side.
// Measured on a Pixel 10a: 58 fps on a board whose synced cost said 36 ms.
const BUDGET_MS = 1000 / 30;
export function headroom(v) {
  const fromFps = v.low ? v.low / 30 : 0;
  const fromCost = v.frame90 ? BUDGET_MS / v.frame90 : 0;
  if (!fromFps && !fromCost) return null;
  return fromFps >= fromCost ? { x: fromFps, atLeast: v.low >= 55 } : { x: fromCost, atLeast: false };
}
const headroomText = (h) => `${h.atLeast ? 'at least ' : ''}${h.x.toFixed(1)}×`;

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
  status('Building the board…');
  await sleep(30);
  const t0 = performance.now();
  if (subject) {
    const [cols, rows] = SIZES[opts.size];
    borrowBoard(filledBoard(subject, cols, rows, { rooms: opts.rooms, terrain: grid.terrain }));
    borrowed = true;
  } else if (borrowed) {
    // "This map" after another test: put the map back first (the last test's
    // board would otherwise be measured under this map's name).
    returnBoard();
    borrowed = false;
  }
  const buildMs = Math.round(performance.now() - t0);
  const [cols, rows] = [grid.cols, grid.rows];
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
    device: navigator.userAgent, gpuTiming: !!frameLog.gpuSupported,
  };
  showResults();
}

const ms = (v) => (v === null || v === undefined ? 'n/a' : `${v.toFixed(1)} ms`);
const kTris = (n) => (n >= 10000 ? `${Math.round(n / 1000)}k` : String(n));
const viewLine = (v) => {
  const h = headroom(v);
  return `${v.fps.toFixed(0)} fps (slowest 10%: ${v.low.toFixed(0)}), ${kTris(v.tris)} triangles, ${v.calls} draw calls; `
    + `frame cost ${ms(v.frame)} (slowest 10%: ${ms(v.frame90)}; with shadow redraw ${ms(v.frameShadow)}), CPU ${ms(v.cpu)}, GPU ${ms(v.gpu)}; `
    + `shadow redraw ${v.shadowTris === null ? 'n/a' : `+${kTris(v.shadowTris)} triangles, CPU ${ms(v.cpuShadow)}`} (${v.shadowsPerSec.toFixed(1)}/s)`
    + (h === null ? '' : `; headroom ${headroomText(h).replace('×', 'x')} for 30 fps`);
};

export function resultsText(r = last) {
  return [
    `Stress test: ${r.subject}, ${r.size} (${r.cells} spaces), quality ${r.quality}${r.midnight ? ', midnight' : ''}`,
    ...r.views.map((v) => `${v.name}: ${viewLine(v)}`),
    `Board built in ${r.buildMs} ms. Screen ${r.screen}. GPU timing ${r.gpuTiming ? 'on' : 'not available here'}.`,
    r.device,
  ].join('\n');
}

function showResults() {
  const r = last;
  const k = kTris;
  const tone = (fps) => (fps >= 50 ? 'good' : fps >= 28 ? 'ok' : 'bad');
  const el = panel();
  el.innerHTML = `
    <div class="sp-head"><b>${esc(r.subject)}</b><button class="sp-x" data-close aria-label="Close">✕</button></div>
    <p class="sp-note">${esc(r.size)} (${r.cells.toLocaleString()} spaces) · ${esc(r.quality)}${r.midnight ? ' · midnight' : ''}</p>
    ${r.views.map((v) => {
      const h = headroom(v);
      return `<div class="sp-view"><div class="sp-vhead"><b>${esc(v.name)}</b><span class="${tone(v.low)}">${v.fps.toFixed(0)} fps</span><small>slowest 10%: ${v.low.toFixed(0)}</small></div>
      <dl class="sp-dl">
        <dt>Drawn</dt><dd>${k(v.tris)} triangles · ${v.calls} draws</dd>
        <dt>Frame cost</dt><dd>${ms(v.frame)}<small> (slowest 10%: ${ms(v.frame90)})</small></dd>
        <dt>Shadow redraw</dt><dd>${v.shadowTris === null ? '–' : `+${k(v.shadowTris)} triangles${v.frameShadow ? ` · frame ${ms(v.frameShadow)}` : ''}`}</dd>
        <dt>Headroom</dt><dd class="${h === null ? '' : h.x >= 1.5 ? 'good' : h.x >= 1 ? 'ok' : 'bad'}">${h === null ? '–' : `${headroomText(h)} the 30 fps budget`}</dd>
      </dl></div>`;
    }).join('')}
    <p class="sp-note">Board built in ${r.buildMs} ms. Headroom: how many times the slowest 10% of frames fit in 33 ms (30 fps), from the frame rate or the frame cost, whichever shows more. Frame rate stops at the screen's refresh rate, so at 60 fps it reads "at least". Frame cost: each frame timed while waiting for the GPU to finish; that wait adds time of its own, so it errs high. A shadow redraw happens only while something moves.</p>
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
