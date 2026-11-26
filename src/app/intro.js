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
import { __set_camTween, camera, controls, fitPreset, wake } from '../render/scene.js';
import { play } from '../play/playView.js';
import * as THREE from 'three';

// (window.__introSlow stretches it, for checking the stages one by one.)
const slow = () => (typeof window !== 'undefined' && window.__introSlow) || 1;
const PAN = 2.2;       // s: from the sky down to the town
const ZOOM = 1.8;      // s: down to the player
const FADE = 700;      // ms: menus and markers fade in

let running = null;    // the intro in progress: { cancel }
let watchMoon = 0;

// The title screen's camera: high over the town (where the game's camera move
// starts) but tilted up at the sky, so no town shows; the full moon big in the
// middle of the screen, wisps of cloud drifting across it.
const TILT = 32;       // degrees above the horizon
const MOON_SIZE = 2.3;
let titleLook = null;  // where the title camera looks (the moon)
export function showTitleView() {
  stopIntro();
  __set_camTween(null);
  const over = fitPreset('persp');
  camera.position.copy(over.pos);
  // Facing the same way as the town view below, tilted up into the sky.
  const flat = over.target.clone().sub(over.pos).setY(0).normalize();
  const t = THREE.MathUtils.degToRad(TILT);
  const dir = flat.multiplyScalar(Math.cos(t)).setY(Math.sin(t));
  titleLook = camera.position.clone().addScaledVector(dir, 400);
  ui.freeCamera = true;
  controls.enabled = false;
  camera.lookAt(titleLook);
  skyMoon.placeAhead(camera, MOON_SIZE);
  ui.hideMarkers = true;
  markers.setVisible(false);
  labelGroup.visible = false;
}
// A resized window on the title: frame it again.
if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (ui.mode === 'title' && skyMoon.visible) showTitleView(); });

// Leaving the title for the editor: everything back.
export function leaveTitleView() {
  stopIntro();
  skyMoon.hide();
  ui.freeCamera = false;
  controls.enabled = true;
  ui.hideMarkers = false;
  markers.setVisible(ui.showMarkers);
  markers.setOpacity(1);
  labelGroup.visible = ui.labels;
}

// The game-start camera move. Call after the game is on the board (setTool('play')).
export function playIntro() {
  stopIntro();
  __set_camTween(null);   // (starting play queues its own glide: this move replaces it)
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
  // 1. Down from the sky over the whole town: from the title, the camera stays
  //    where it is and tilts down from the moon; otherwise it glides there.
  const over = fitPreset('persp');
  const zoomIn = () => {
    if (cancelled) return;
    ui.freeCamera = false;
    // 2. In to the player who is up.
    const pose = aheadPose() ?? over;
    __set_camTween({
      t: 0, dur: ZOOM * slow(), ease: 'inOut',
      fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: pose.pos, toTarget: pose.target,
      done: () => { if (!cancelled) finish(); },
    });
  };
  if (ui.freeCamera && titleLook) {
    const from = titleLook.clone(), pos = camera.position.clone(), look = new THREE.Vector3();
    const t0 = performance.now();
    const tilt = () => {
      if (cancelled) return;
      const k = Math.min(1, (performance.now() - t0) / (PAN * slow() * 1000));
      const e = k < 0.5 ? 4 * k ** 3 : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(pos, over.pos, e);
      camera.lookAt(look.lerpVectors(from, over.target, e));
      wake(200);
      if (k < 1) { requestAnimationFrame(tilt); return; }
      controls.target.copy(over.target);
      zoomIn();
    };
    requestAnimationFrame(tilt);
  } else {
    __set_camTween({
      t: 0, dur: PAN * slow(), ease: 'inOut',
      fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: over.pos, toTarget: over.target,
      done: zoomIn,
    });
  }
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
  ui.freeCamera = false;
  cancelAnimationFrame(watchMoon);
  document.body.classList.remove('intro');
  play.holdCamera(false);
  controls.enabled = true;
  ui.hideMarkers = false;
  markers.setOpacity(1);
}
export const introRunning = () => !!running;
