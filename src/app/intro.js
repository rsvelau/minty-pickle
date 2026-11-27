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
import { skyMoon, driveCamera, autoRes } from './loop.js';
import { markers, labelGroup, refreshMarkers } from '../render/board.js';
import { __set_camTween, camera, controls, fitPreset, wake, renderer, scene, holdShadowsWhole } from '../render/scene.js';
import { play } from '../play/playView.js';
import * as THREE from 'three';

// (window.__introSlow stretches it, for checking the stages one by one.)
const slow = () => (typeof window !== 'undefined' && window.__introSlow) || 1;
const MOVE = 5;        // s: from the moon down to the player
const FADE = 700;      // ms: menus and markers fade in

let running = null;    // the intro in progress: { cancel }

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
  camera.position.copy(farPoint(over));
  // Facing the town, tilted up into the sky.
  const flat = over.target.clone().sub(camera.position).setY(0).normalize();
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
// Where the title camera hangs: far out beyond the forest, on the same side as
// the usual town view, a little above the treetops.
function farPoint(over) {
  const back = over.pos.clone().sub(over.target).setY(0);
  const d = back.length();
  return over.target.clone().addScaledVector(back.normalize(), d * 2.6).setY(Math.max(9, over.pos.y * 0.45));
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
// One continuous move of MOVE seconds: it starts slow, picks up speed and eases
// in on the player who is up. Coming from the title (far out beyond the
// forest, looking up at the moon) the camera tips down through the stars until
// the treeline comes into view, then the town far off (out of the night's
// fog), and flies in over the town to the player.
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
  running = { cancel: () => { cancelled = true; } };

  const over = fitPreset('persp');                 // the whole-town view (and the fog fitted to it)
  const pose = aheadPose() ?? over;
  const p0 = camera.position.clone();
  const sky = fromSky ? titleLook.clone() : null;
  // The path: from where the camera is, sweeping in by way of the whole-town
  // view, down to the player (a smooth curve, no corners).
  const via = over.pos.clone();
  const at = new THREE.Vector3();
  const curve = (e) => at.set(0, 0, 0)
    .addScaledVector(p0, (1 - e) ** 2).addScaledVector(via, 2 * (1 - e) * e).addScaledVector(pose.pos, e * e);
  const look = new THREE.PerspectiveCamera();
  const facing = (from, to) => { look.position.copy(from); look.up.set(0, 1, 0); look.lookAt(to); return look.quaternion.clone(); };
  const qStart = camera.quaternion.clone();
  const smooth = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const SPLIT = 0.42;    // by here the camera faces the town; after it, it turns to the player
  // Smooth running: no resolution changes and no shadow refits mid-move, and
  // everything the flight will show drawn once beforehand, out of sight, so no
  // shader is compiled or texture uploaded the moment the town comes into view.
  autoRes.paused = true;
  holdShadowsWhole(true);
  warmUp([[over.pos, over.target], [pose.pos, pose.target]]);
  let t0 = null;         // the clock starts on the first frame drawn after all that
  driveCamera((now) => {
    if (cancelled) { driveCamera(null); return; }
    t0 ??= now;
    const k = Math.min(1, (now - t0) / (MOVE * slow() * 1000));
    // Slow start, speeding up, then easing in to the player (cubic in-out).
    const e = k < 0.5 ? 4 * k ** 3 : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const pos = curve(e);
    camera.position.copy(pos);
    const qTown = facing(pos, over.target);
    if (e < SPLIT) {
      // Down from the sky (the moon, the stars) to the town far ahead.
      const q0 = sky ? facing(pos, sky) : qStart;
      camera.quaternion.slerpQuaternions(q0, qTown, smooth(0, SPLIT, e));
    } else {
      camera.quaternion.slerpQuaternions(qTown, facing(pos, pose.target), smooth(SPLIT, 1, e));
    }
    if (fromSky) {
      skyMoon.starsOpacity(1 - smooth(0.35, 0.8, e));
      if (skyMoon.visible && !skyMoon.inView(camera)) skyMoon.hideMoon();
    }
    if (k < 1) return;
    driveCamera(null);
    camera.position.copy(pose.pos);
    controls.target.copy(pose.target);
    ui.freeCamera = false;
    controls.update();
    finish();
  });
}
// Draw the scene once from each of these [pos, target] views into a tiny
// off-screen target: it compiles every shader and uploads every texture the
// flight will need, now, while the screen still shows the sky.
function warmUp(views) {
  const probe = camera.clone();
  const rt = new THREE.WebGLRenderTarget(64, 64);
  const before = renderer.getRenderTarget();
  try {
    for (const [pos, target] of views) {
      probe.position.copy(pos);
      probe.lookAt(target);
      probe.updateMatrixWorld();
      renderer.compile(scene, probe);
      renderer.setRenderTarget(rt);
      renderer.render(scene, probe);
    }
  } catch (e) { console.error(e); }
  renderer.setRenderTarget(before);
  rt.dispose();
}
// 3. The menus and the markers fade in; the camera is the player's again.
function finish() {
  running = null;
  autoRes.paused = false;
  holdShadowsWhole(false);
  skyMoon.hide();
  controls.enabled = true;
  play.holdCamera(false);
  document.body.classList.remove('intro');
  window.dispatchEvent(new Event('intro-done'));   // what waited for the move can show now (botWatch.js)
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
  driveCamera(null);
  autoRes.paused = false;
  holdShadowsWhole(false);
  __set_camTween(null);
  ui.freeCamera = false;
  document.body.classList.remove('intro');
  play.holdCamera(false);
  controls.enabled = true;
  ui.hideMarkers = false;
  markers.setOpacity(1);
}
export const introRunning = () => !!running;
