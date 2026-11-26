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
import { createCloudBank } from '../render/skyMoon.js';
import { markers, labelGroup, refreshMarkers } from '../render/board.js';
import { __set_camTween, camera, controls, fitPreset, wake, scene, markShadows, moon as moonLight } from '../render/scene.js';
import { play } from '../play/playView.js';
import * as THREE from 'three';

// (window.__introSlow stretches it, for checking the stages one by one.)
const slow = () => (typeof window !== 'undefined' && window.__introSlow) || 1;
const MOVE = 3;        // s: from the moon down to the player
const DROP = 60;       // how far below the land waits while the sky shows
const FADE = 700;      // ms: menus and markers fade in

let running = null;    // the intro in progress: { cancel }
let cloudBank = null;  // the rain clouds the camera comes down through (made on first use)

// The title screen's camera: high over the town (where the game's camera move
// starts) but tilted up at the sky, so no town shows; the full moon big in the
// middle of the screen, wisps of cloud drifting across it.
const TILT = 32;       // degrees above the horizon
const MOON_SIZE = 3.1;
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
// One continuous move of MOVE seconds that starts slow, picks up speed and
// settles gently on the player who is up. Coming from the title, the camera
// tips down from the moon into an empty starry sky, and the land rises up into
// place beneath it (it waits far below, out of sight, while the sky shows).
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
  const fromSky = ui.freeCamera && skyMoon.visible;
  ui.freeCamera = true;
  // The land: everything but the lights and the sky.
  const sky = new Set(skyMoon.parts());
  const land = fromSky ? scene.children.filter((o) => !o.isLight && o !== moonLight.target && !sky.has(o)) : [];
  const base = land.map((o) => o.position.y);
  const setLand = (lift) => land.forEach((o, i) => { o.position.y = base[i] - DROP * (1 - lift); });
  setLand(0);
  if (fromSky) cloudBank ??= createCloudBank(scene);
  running = { cancel: () => { cancelled = true; setLand(1); cloudBank?.hide(); } };

  const pose = aheadPose() ?? fitPreset('persp');
  const p0 = camera.position.clone(), q0 = camera.quaternion.clone();
  const probe = new THREE.PerspectiveCamera();   // how the camera will face at the end
  probe.position.copy(pose.pos);
  probe.up.copy(camera.up);
  probe.lookAt(pose.target);
  const q1 = probe.quaternion.clone();
  const t0 = performance.now();
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const frame = () => {
    if (cancelled) return;
    const k = Math.min(1, (performance.now() - t0) / (MOVE * slow() * 1000));
    // Slow start, speeding up, then easing in to the player (cubic in-out).
    const e = k < 0.5 ? 4 * k ** 3 : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(p0, pose.pos, e);
    camera.quaternion.slerpQuaternions(q0, q1, e);
    if (fromSky) {
      // It's raining down there: the camera passes through thick cloud, and
      // the land finishes rising while the cloud hides it.
      const cloud = smooth(0.24, 0.42, k) * (1 - smooth(0.58, 0.76, k));
      cloudBank.set(camera, cloud, e * 9);
      setLand(smooth(0.12, 0.6, k));
      markShadows();
      if (skyMoon.visible && !skyMoon.inView(camera)) skyMoon.hideMoon();
    }
    wake(200);
    if (k < 1) { requestAnimationFrame(frame); return; }
    setLand(1);
    cloudBank?.hide();
    controls.target.copy(pose.target);
    ui.freeCamera = false;
    controls.update();
    finish();
  };
  requestAnimationFrame(frame);
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
  document.body.classList.remove('intro');
  play.holdCamera(false);
  controls.enabled = true;
  ui.hideMarkers = false;
  markers.setOpacity(1);
}
export const introRunning = () => !!running;
