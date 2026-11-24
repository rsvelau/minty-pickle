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
import { FOG, QUALITY_KEY, SKY, __set_camTween, applyQuality, camTween, camera, cellToWorld, clampTarget, controls, hemi, moon, quality, qualityName, renderer, scene, wake, wakeUntil } from '../render/scene.js';
import { HOUSE_D, HOUSE_W, atmos, ghostHouse, houseWindow, porchLight, updateRain, updateTreeFade } from '../render/surroundings.js';
import { hoverBox, tmpPos, writeTileMatrix } from '../render/tileLook.js';
import { powerOut } from '../render/tileLook.js';

// Module state: assigned by init() below, in the same order as before the split.
export let TINT, clock, fpsMeter;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  TINT = {
    sky: new THREE.Color('#56627a'), skyRed: new THREE.Color('#7c4650'),
    ground: new THREE.Color('#181a18'), groundRed: new THREE.Color('#241516'),
    moon: new THREE.Color('#a9bcff'), moonRed: new THREE.Color('#dc9196'),
    bg: new THREE.Color('#070a10'), bgRed: new THREE.Color('#0e0709'),
  };

  clock = new THREE.Clock();
  fpsMeter = { frames: 0, since: performance.now(), show: false, active: false };
  renderer.setAnimationLoop(() => {
    // Full rate while anything moves; the idle rate otherwise (see wake()).
    const now = performance.now();
    const active = now < wakeUntil || !!camTween || heightsEasing || play.busy() || markers.busy()
      || clocktowers.busy() || (dread > 0 && dread < 1) || (towerOut > 0 && towerOut < 1);
    // After midnight things move all the time: a smoother rate than idle.
    const restFps = dread > 0 ? quality.midnightFps : quality.idleFps;
    if (!active && now - lastFrame < 1000 / restFps - 2) return;
    lastFrame = now;
    fpsMeter.active = active ? 'active' : dread > 0 ? 'midnight' : 'idle';
    const dt = Math.min(clock.getDelta(), 0.1);

    if (camTween) {
      camTween.t = Math.min(1, camTween.t + dt / 0.6);
      const k = 1 - Math.pow(1 - camTween.t, 3);
      camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
      controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
      if (camTween.t >= 1) __set_camTween(null);
    }
    // Zoom-to-cursor re-derives the target from the camera's facing after a
    // wheel zoom; switch it off while we animate the camera ourselves.
    controls.zoomToCursor = !camTween;
    controls.update();
    clampTarget();

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
    // A bug in game code must never stop the render loop (the board would
    // freeze and stop taking input): log it and keep going.
    try { play.tick(dt, clock.elapsedTime); } catch (e) { console.error(e); }
    // Clocktower dials: the game time while playing, 11 PM (the start) otherwise.
    clocktowers.setTime(ui.tool === 'play' ? play.clockMinutes() : play.startMinutes());
    clocktowers.tick(dt);
    updateDread(dt);
    try { positionChoices(); positionPlaceBar(); } catch (e) { console.error(e); }
    updateTreeFade();
    if (atmos.visible) updateRain(dt);
    renderer.render(scene, camera);
    // FPS readout (View → FPS).
    fpsMeter.frames++;
    if (now - fpsMeter.since >= 1000) {
      if (fpsMeter.show) {
        const fps = Math.round((fpsMeter.frames * 1000) / (now - fpsMeter.since));
        $('#fps').textContent = `${fps} fps · ${fpsMeter.active} · ${qualityName}`;
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
  grid.onChange(() => wake());
  applyQuality(qualityName);
  document.querySelectorAll('[data-quality]').forEach((b) => b.addEventListener('click', () => {
    applyQuality(b.dataset.quality);
    try { localStorage.setItem(QUALITY_KEY, qualityName); } catch { /* ignore */ }
  }));
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
  window.gridPlanner = { grid, scene, camera, controls, cellToWorld, brushes: BRUSHES, terrainHeight, play, dread: () => dread };
}

// Midnight dread (play demo, from midnight on): lights flicker, the
// clocktower's dials die, the rain comes down harder, the forest sways and
// the night closes in a little. Eases in over a few seconds.
export let dread = 0;
export let towerOut = 0; // 0..1 progress of the clock dials dying
export let dreadT = 0;
export function updateDread(dt) {
  const want = ui.tool === 'play' && play.midnight() ? 1 : 0;
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
export let heightsEasing = false;
export let lastFrame = 0;
