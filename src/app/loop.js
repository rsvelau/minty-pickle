// The frame loop: camera tweens, height easing, effects, midnight dread,
// render on demand and the FPS counter.

import * as THREE from 'three';
import { terrainHeight } from '../render/terrain.js';
import { dreadUniforms, swayUniforms, flickerAt } from '../render/dread.js';
import { BRUSHES, FLOOR_H, TILE, grid, hoverIndex, ui } from './config.js';
import { positionPlaceBar } from '../editor/placing.js';
import { $ } from './dom.js';
import { play, positionChoices } from '../play/playView.js';
import { N, clocktowers, heights, landmarks, markers, props, targetHeights, tiles, visibleTop, water } from '../render/board.js';
import { FOG, QUALITY_KEY, RES_STEPS, applyResolution, fitShadows, inShadowWindow, SKY, __clearShadowsDirty, resScale, setResScale, __set_camTween, applyQuality, markShadows, shadowsDirty, camTween, camera, cellToWorld, clampTarget, controls, hemi, moon, quality, qualityName, renderer, scene, wake, wakeUntil } from '../render/scene.js';
import { HOUSE_D, HOUSE_W, atmos, cullForest, ghostHouse, houseWindow, porchLight, updateRain, updateTreeFade } from '../render/surroundings.js';
import { hoverBox, tmpPos, writeTileMatrix } from '../render/tileLook.js';
import { powerOut } from '../render/tileLook.js';
import { createSkyMoon } from '../render/skyMoon.js';

// Module state: assigned by init() below, in the same order as before the split.
export let TINT, clock, fpsMeter, skyMoon;
// Something that moves the camera itself, once per frame, just before the frame
// is drawn (the game-start camera move): fn(now). Set to null when done.
let cameraDriver = null;
export function driveCamera(fn) { cameraDriver = fn; }

// Run once at startup (called from src/main.js, in order).
export function init() {
  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyResolution();
  });
  TINT = {
    sky: new THREE.Color('#56627a'), skyRed: new THREE.Color('#7c4650'),
    ground: new THREE.Color('#181a18'), groundRed: new THREE.Color('#241516'),
    moon: new THREE.Color('#a9bcff'), moonRed: new THREE.Color('#dc9196'),
    bg: new THREE.Color('#070a10'), bgRed: new THREE.Color('#0e0709'),
  };

  clock = new THREE.Clock();
  skyMoon = createSkyMoon(scene);   // the title screen's full moon (src/render/skyMoon.js)
  fpsMeter = { frames: 0, since: performance.now(), show: false, active: false };
  renderer.setAnimationLoop(() => {
    // Full rate while anything moves; the idle rate otherwise (see wake()).
    const now = performance.now();
    const active = now < wakeUntil || !!camTween || !!cameraDriver || heightsEasing || play.busy() || markers.busy()
      || clocktowers.busy() || (dread > 0 && dread < 1) || (towerOut > 0 && towerOut < 1);
    // After midnight things move all the time: a smoother rate than idle.
    const restFps = dread > 0 || skyMoon.visible ? quality.midnightFps : quality.idleFps;   // the moon's red glow breathes
    if (!active && now - lastFrame < 1000 / restFps - 2) return;
    autoResolution(now, active);
    lastFrame = now;
    fpsMeter.active = active ? 'active' : dread > 0 ? 'midnight' : 'idle';
    const dt = Math.min(clock.getDelta(), 0.1);

    if (camTween) {
      // A glide: 0.6 s ease-out by default; the game-start camera move sets its
      // own duration, an ease-in-out and what to do when it gets there.
      const tw = camTween;
      // Timed by the wall clock when it has its own duration, so a slow frame
      // rate doesn't stretch the game-start camera move.
      if (tw.dur) { tw.start ??= now; tw.t = Math.min(1, (now - tw.start) / (tw.dur * 1000)); } else tw.t = Math.min(1, tw.t + dt / 0.6);
      const k = tw.ease === 'inOut' ? (tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - Math.pow(-2 * tw.t + 2, 3) / 2) : 1 - Math.pow(1 - tw.t, 3);
      camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) { __set_camTween(null); tw.done?.(); }
    }
    // Zoom-to-cursor re-derives the target from the camera's facing after a
    // wheel zoom; switch it off while we animate the camera ourselves.
    controls.zoomToCursor = !camTween;
    if (cameraDriver) { try { cameraDriver(now); } catch (e) { console.error(e); cameraDriver = null; } }
    // The title (and the start of the game's camera move) points the camera up
    // at the moon, which the orbit controls can't do: they keep their hands off.
    if (!ui.freeCamera) {
      controls.update();
      clampTarget();
    }

    // Ease tile heights toward their targets.
    let moved = false;
    const ease = 1 - Math.exp(-dt * 18);
    for (let i = 0; i < N; i++) {
      const d = targetHeights[i] - heights[i];
      if (Math.abs(d) > 1e-4) {
        heights[i] += d * ease;
        if (Math.abs(targetHeights[i] - heights[i]) < 1e-3) heights[i] = targetHeights[i];
        writeTileMatrix(i);
        moved = true;
      }
    }
    if (moved) { tiles.instanceMatrix.needsUpdate = true; tiles.computeBoundingSphere(); }
    heightsEasing = moved;

    if (hoverIndex >= 0) {
      const { x, y } = grid.coords(hoverIndex);
      const top = visibleTop(hoverIndex);
      hoverBox.position.copy(cellToWorld(x, y));
      if (top < 0) {
        hoverBox.position.y = top - 0.01;
        hoverBox.scale.set(1, 0.03, 1);
      } else {
        hoverBox.scale.set(1, top + 0.02, 1);
      }
      // Ghost home covers the hovered cell and the cells right/below it.
      // Ghost home's north-west corner sits on the hovered cell's corner.
      ghostHouse.position.copy(cellToWorld(x, y)).add(tmpPos.set(HOUSE_W / 2 - 0.5 * TILE, FLOOR_H, HOUSE_D / 2 - 0.5 * TILE));
    }
    ghostHouse.visible = ui.ghost && hoverIndex >= 0;

    water.tick(clock.elapsedTime);
    props?.tick(clock.elapsedTime);
    landmarks?.tick(clock.elapsedTime);
    markers.tick(clock.elapsedTime, camera);
    skyMoon.tick(clock.elapsedTime, camera);
    // A bug in game code must never stop the render loop (the board would
    // freeze and stop taking input): log it and keep going.
    try { play.tick(dt, clock.elapsedTime); } catch (e) { console.error(e); }
    // Clocktower dials: the game time while playing, 11 PM (the start) otherwise.
    clocktowers.setTime(ui.tool === 'play' ? play.clockMinutes() : play.startMinutes());
    clocktowers.tick(dt);
    updateDread(dt);
    try { positionChoices(); positionPlaceBar(); } catch (e) { console.error(e); }
    updateTreeFade();
    cullForest();
    if (atmos.visible) updateRain(dt);
    fitShadows();
    // Shadows on demand: redraw the shadow map when the board changed, tiles
    // are easing, figures or dice are moving, a swing or merry-go-round in
    // the shadow window moved (at most every MOVER_SHADOW_MS), or, as a
    // safety net for anything that didn't ask, every SAFETY_SHADOW_MS.
    // Orbiting the camera alone never redraws it, nor does a still board.
    const mover = (landmarks?.movedCasters() ?? []).some((p) => inShadowWindow(p.x, p.z));
    if (renderer.shadowMap.enabled && (shadowsDirty || heightsEasing || play.busy()
      || (mover && now - lastShadow > MOVER_SHADOW_MS) || now - lastShadow > SAFETY_SHADOW_MS)) {
      renderer.shadowMap.needsUpdate = true;
      lastShadow = now;
      __clearShadowsDirty();
      shadowFrame = true;
    } else shadowFrame = false;
    // Count the whole frame, shadow pass included (three.js would reset its
    // counters between the shadow pass and the view).
    renderer.info.autoReset = false;
    renderer.info.reset();
    const query = frameLog.recording ? gpuBegin() : null;
    renderer.render(scene, camera);
    if (query) gpuEnd(query);
    if (frameLog.recording) {
      const cpu = performance.now() - now;
      // Synced: wait for the GPU to finish the frame (reading back one pixel
      // does), so the time covers CPU and GPU work end to end.
      if (frameLog.sync) { const gl = renderer.getContext(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel); }
      frameLog.frames.push({ t: now, cpu, total: performance.now() - now, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, shadow: shadowFrame, cam: [camera.position.x, camera.position.y, camera.position.z], q: camera.quaternion.toArray(), res: resScale });
      gpuPoll();
    }
    // FPS readout (View → FPS).
    fpsMeter.frames++;
    if (now - fpsMeter.since >= 1000) {
      if (fpsMeter.show) {
        const fps = Math.round((fpsMeter.frames * 1000) / (now - fpsMeter.since));
        $('#fps').textContent = `${fps} fps · ${fpsMeter.active} · ${qualityName}${resScale < 1 ? ` · res ${Math.round(resScale * 100)}%` : ''}`;
      }
      fpsMeter.frames = 0;
      fpsMeter.since = now;
    }
  });

  // Anything the player does wakes the renderer to full rate.
  for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'touchmove']) {
    window.addEventListener(type, () => wake(), { passive: true, capture: true });
  }
  controls.addEventListener('change', () => wake(400));
  grid.onChange(() => { wake(); markShadows(); });
  applyQuality(qualityName);
  document.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => {
    applyQuality(b.dataset.quality);
    try { localStorage.setItem(QUALITY_KEY, qualityName); } catch { /* ignore */ }
  }));
  try { autoRes.on = localStorage.getItem(AUTO_RES_KEY) !== '0'; } catch { /* default on */ }
  $('#optAutoRes').checked = autoRes.on;
  $('#optAutoRes').addEventListener('change', (e) => setAutoRes(e.target.checked));
  $('#optFps').addEventListener('change', (e) => {
    fpsMeter.show = e.target.checked;
    $('#fps').hidden = !fpsMeter.show;
    $('#fps').textContent = '…';
  });

  // Handy for debugging / future tooling from the console.
  // The cell info box folds down to a small chip (remembered on this device).
  {
    const box = $('#info'), btn = $('#infoToggle');
    const set = (collapsed) => {
      box.classList.toggle('collapsed', collapsed);
      btn.textContent = collapsed ? 'ⓘ Cell info' : '–';
      btn.title = collapsed ? 'Show cell info' : 'Hide cell info';
      btn.setAttribute('aria-expanded', String(!collapsed));
    };
    let saved = false;
    try { saved = localStorage.getItem('infoCollapsed') === '1'; } catch { /* fine */ }
    set(saved);
    btn.addEventListener('click', () => {
      const c = !box.classList.contains('collapsed');
      set(c);
      try { localStorage.setItem('infoCollapsed', c ? '1' : '0'); } catch { /* fine */ }
    });
  }
  window.gridPlanner = { grid, scene, camera, controls, cellToWorld, brushes: BRUSHES, terrainHeight, play, dread: () => dread, frameLog, stopCameraGlide: () => __set_camTween(null) };
}

// Midnight dread (play demo, from midnight on): lights flicker, the
// clocktower's dials die, the rain comes down harder, the forest sways and
// the night closes in a little. Eases in over a few seconds.
export let dread = 0;
export let towerOut = 0; // 0..1 progress of the clock dials dying
export let dreadT = 0;
// The stress test can force midnight on (1) or off (0); null = follow the game.
export let dreadOverride = null;
export function setDreadOverride(v) { dreadOverride = v; }
export function updateDread(dt) {
  const want = dreadOverride ?? (ui.tool === 'play' && play.midnight() ? 1 : 0);
  dread += Math.sign(want - dread) * Math.min(Math.abs(want - dread), dt / 4);
  towerOut += Math.sign(want - towerOut) * Math.min(Math.abs(want - towerOut), dt / 2.5);
  dreadT += dt;
  dreadUniforms.uDread.value = dread;
  dreadUniforms.uDreadTime.value = dreadT;
  swayUniforms.uSway.value = dread;
  swayUniforms.uSwayTime.value = dreadT;
  // The dials sputter two or three times as they die, then stay dark.
  const p = towerOut;
  const sputter = p > 0 && p < 0.85 ? (Math.sin(p * Math.PI * 7) > 0.2 ? 1 : 0.35) : 1;
  clocktowers.setGlow(powerOut ? 0 : Math.max(0, 1 - p) * sputter); // Power Outage: the clocktower goes dark too
  // Darker, closer night, and the cold blue turns a muted, bloody red.
  hemi.intensity = 2.4 - 0.5 * dread;
  hemi.color.copy(TINT.sky).lerp(TINT.skyRed, dread);
  hemi.groundColor.copy(TINT.ground).lerp(TINT.groundRed, dread);
  moon.color.copy(TINT.moon).lerp(TINT.moonRed, dread);
  SKY.copy(TINT.bg).lerp(TINT.bgRed, dread);
  FOG.color.copy(SKY);
  FOG.near = 38 - 10 * dread;
  FOG.far = 95 - 18 * dread;
  if (porchLight) porchLight.intensity = porchLight.userData.baseIntensity * flickerAt(0.71, dreadT, dread);
  if (houseWindow) houseWindow.material.color.set('#e9a85c').multiplyScalar(flickerAt(0.71, dreadT, dread));
}
// --- Frame log (the stress test) ----------------------------------------------------
// While `recording`, every rendered frame logs its start time, CPU time (this
// loop's work plus handing the frame to the GPU), triangles and draw calls
// (shadow pass included) and whether it redrew the shadows. Where the browser
// offers GPU timers (EXT_disjoint_timer_query_webgl2), `gpu` gets each frame's
// GPU time in ms: unlike fps, frame times aren't capped by the screen's
// refresh rate, so they show the headroom left.
// With `sync`, each frame also waits for the GPU to finish (`total`): the
// full cost of a frame, on any browser, at the price of a lower frame rate
// while it's on.
export const frameLog = { recording: false, sync: false, frames: [], gpu: [], gpuSupported: null };
const syncPixel = new Uint8Array(4);
let gpuExt = null;
const gpuPending = [];
function gpuBegin() {
  const gl = renderer.getContext();
  if (frameLog.gpuSupported === null) {
    gpuExt = gl.getExtension?.('EXT_disjoint_timer_query_webgl2') ?? null;
    frameLog.gpuSupported = !!gpuExt && typeof gl.createQuery === 'function';
  }
  if (!frameLog.gpuSupported || gpuPending.length > 8) return null;
  const q = gl.createQuery();
  gl.beginQuery(gpuExt.TIME_ELAPSED_EXT, q);
  return q;
}
function gpuEnd(q) {
  renderer.getContext().endQuery(gpuExt.TIME_ELAPSED_EXT);
  gpuPending.push(q);
}
function gpuPoll() {
  const gl = renderer.getContext();
  while (gpuPending.length) {
    const q = gpuPending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
    const disjoint = gl.getParameter(gpuExt.GPU_DISJOINT_EXT);
    gl.deleteQuery(q);
    gpuPending.shift();
    if (!disjoint) frameLog.gpu.push(ns / 1e6);
  }
}

// --- Automatic resolution -------------------------------------------------------
// Frames that should run at full rate (something is moving) but take longer
// than ~1/28 s for a second on end: draw fewer pixels (one RES_STEPS step).
// Back up a step after 4 s on end faster than ~1/50 s. Idle and midnight
// frames are held back on purpose, so only back-to-back full-rate frames
// count. The stress test pauses it, to measure the quality as set.
const AUTO_RES_KEY = 'minty-pickle.autoRes';
export const autoRes = { on: true, paused: false, ema: 0, slowFor: 0, fastFor: 0, wasActive: false, cooldown: 0 };
function autoResolution(now, active) {
  const dtMs = now - lastFrame;
  const counts = active && autoRes.wasActive && dtMs < 1000; // longer: the tab was hidden
  autoRes.wasActive = active;
  if (!counts || !autoRes.on || autoRes.paused) { autoRes.slowFor = autoRes.fastFor = 0; return; }
  autoRes.ema = autoRes.ema ? autoRes.ema * 0.9 + dtMs * 0.1 : dtMs;
  if (now < autoRes.cooldown) return; // let a change settle first
  autoRes.slowFor = autoRes.ema > 1000 / 28 ? autoRes.slowFor + dtMs : 0;
  autoRes.fastFor = autoRes.ema < 1000 / 50 ? autoRes.fastFor + dtMs : 0;
  const k = RES_STEPS.indexOf(resScale);
  let next = k;
  if (autoRes.slowFor > 1000 && k < RES_STEPS.length - 1) next = k + 1;
  else if (autoRes.fastFor > 4000 && k > 0) next = k - 1;
  if (next !== k) {
    setResScale(RES_STEPS[next]);
    autoRes.slowFor = autoRes.fastFor = 0;
    autoRes.ema = 0;
    autoRes.cooldown = now + 1500;
  }
}
export function setAutoRes(on) {
  autoRes.on = on;
  if (!on && resScale !== 1) setResScale(1);
  try { localStorage.setItem(AUTO_RES_KEY, on ? '1' : '0'); } catch { /* fine */ }
}

export let heightsEasing = false;
// A slow mover's shadow keeps up 4 times a second; a still board redraws
// only every 2 s (the Pixel 10a's slowest frames on a 35 x 35 forest were
// these redraws when they ran every 250 ms).
const MOVER_SHADOW_MS = 250;
const SAFETY_SHADOW_MS = 2000;
let lastShadow = 0;
let shadowFrame = false; // did this frame redraw the shadow map? (frame log)
export let lastFrame = 0;
