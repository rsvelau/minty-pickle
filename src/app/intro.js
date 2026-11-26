// The title screen's view and the camera move that starts a game.
//
// Title: the town in the foreground, low and looking north, with the full moon
// (render/skyMoon.js) hanging centred above it. No markers or axis labels; the
// camera can't be moved.
//
// Starting a game (new, or loaded): the play display is hidden and locked
// (body.intro: see style.css) while the camera
//   1. pans down from the sky to show the whole town,
//   2. then moves in to the over-the-shoulder view of the player who is up,
// and then the menus and the map markers fade in. The moon is switched off as
// soon as it has left the view.
import { ui } from './config.js';
import { aheadPose } from './pointer.js';
import { skyMoon } from './loop.js';
import { markers, labelGroup, refreshMarkers } from '../render/board.js';
import { __set_camTween, camera, controls, fitPreset } from '../render/scene.js';
import { play } from '../play/playView.js';
import * as THREE from 'three';

// (window.__introSlow stretches it, for checking the stages one by one.)
const slow = () => (typeof window !== 'undefined' && window.__introSlow) || 1;
const PAN = 2.2;       // s: from the sky down to the town
const ZOOM = 1.8;      // s: down to the player
const FADE = 700;      // ms: menus and markers fade in

let running = null;    // the intro in progress: { cancel }
let watchMoon = 0;

// The title screen's camera: low over the south edge, looking across the town,
// the moon centred above it.
export function showTitleView() {
  stopIntro();
  const fit = fitPreset('persp');
  // Look across the board from beyond its south side, from a little above the roofs.
  const target = new THREE.Vector3(0, 2, -fit.pos.z * 0.15);
  const pos = new THREE.Vector3(0, 7.5, Math.abs(fit.pos.z) * 0.62 + 4);
  __set_camTween(null);
  camera.position.copy(pos);
  controls.target.copy(target);
  controls.enabled = false;
  controls.update();
  skyMoon.placeFrom(camera, target, 17);   // high enough to clear the menu card
  ui.hideMarkers = true;
  markers.setVisible(false);
  labelGroup.visible = false;
}

// Leaving the title for the editor: everything back.
export function leaveTitleView() {
  stopIntro();
  skyMoon.hide();
  controls.enabled = true;
  ui.hideMarkers = false;
  markers.setVisible(ui.showMarkers);
  markers.setOpacity(1);
  labelGroup.visible = ui.labels;
}

// The game-start camera move. Call after the game is on the board (setTool('play')).
export function playIntro() {
  stopIntro();
  document.body.classList.add('intro');
  controls.enabled = false;
  play.holdCamera(true);
  ui.hideMarkers = true;
  markers.setVisible(false);
  labelGroup.visible = false;
  let cancelled = false;
  running = { cancel: () => { cancelled = true; } };
  // Keep checking: once the moon is out of view it goes.
  cancelAnimationFrame(watchMoon);
  const watch = () => {
    if (!skyMoon.visible) return;
    if (!skyMoon.inView(camera)) { skyMoon.hide(); return; }
    watchMoon = requestAnimationFrame(watch);
  };
  watch();
  // 1. Down from the sky over the whole town.
  const over = fitPreset('persp');
  __set_camTween({
    t: 0, dur: PAN * slow(), ease: 'inOut',
    fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: over.pos, toTarget: over.target,
    done: () => {
      if (cancelled) return;
      // 2. In to the player who is up.
      const pose = aheadPose() ?? over;
      __set_camTween({
        t: 0, dur: ZOOM * slow(), ease: 'inOut',
        fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: pose.pos, toTarget: pose.target,
        done: () => { if (!cancelled) finish(); },
      });
    },
  });
}
// 3. The menus and the markers fade in; the camera is the player's again.
function finish() {
  running = null;
  skyMoon.hide();
  controls.enabled = true;
  play.holdCamera(false);
  document.body.classList.remove('intro');
  labelGroup.visible = ui.labels;
  ui.hideMarkers = false;
  refreshMarkers();
  markers.setOpacity(0);
  markers.setVisible(ui.showMarkers);
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / FADE);
    markers.setOpacity(k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// Skip the rest of it (leaving the game, or starting another).
export function stopIntro() {
  if (!running) return;
  running.cancel();
  running = null;
  __set_camTween(null);
  cancelAnimationFrame(watchMoon);
  document.body.classList.remove('intro');
  play.holdCamera(false);
  controls.enabled = true;
  ui.hideMarkers = false;
  markers.setOpacity(1);
}
export const introRunning = () => !!running;
