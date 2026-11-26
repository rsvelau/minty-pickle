// The full moon of the title screen: a bright disc with a soft halo, and a
// faint ominous red glow pulsing behind it. It hangs far off in the sky
// (no fog, past the town) and is only drawn while it can be seen: the title
// screen and the start of a game's camera move; once it leaves the view it is
// switched off for good (until the next title screen).
import * as THREE from 'three';

const R = 22;          // disc radius (it sits ~400 away: about 6° across)
const DIST = 400;

function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(110, 100, 20, 128, 128, 128);
  grad.addColorStop(0, '#fffdf4');
  grad.addColorStop(0.75, '#f1ecdc');
  grad.addColorStop(1, '#d9d2bd');
  g.fillStyle = grad;
  g.beginPath(); g.arc(128, 128, 127, 0, Math.PI * 2); g.fill();
  // Maria: soft grey seas, and a few craters.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blot = (x, y, r, a) => {
    const b = g.createRadialGradient(x, y, 0, x, y, r);
    b.addColorStop(0, `rgba(150, 146, 134, ${a})`);
    b.addColorStop(1, 'rgba(150, 146, 134, 0)');
    g.fillStyle = b;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  };
  for (const [x, y, r, a] of [[90, 90, 46, 0.45], [150, 80, 34, 0.38], [165, 140, 40, 0.32], [105, 160, 30, 0.3], [70, 130, 22, 0.28]]) blot(x, y, r, a);
  for (let k = 0; k < 26; k++) {
    const x = 30 + rnd() * 196, y = 30 + rnd() * 196, r = 2 + rnd() * 7;
    if ((x - 128) ** 2 + (y - 128) ** 2 > 112 ** 2) continue;
    g.strokeStyle = 'rgba(120, 116, 104, 0.35)'; g.lineWidth = 1.2;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    blot(x + 1, y + 1, r, 0.18);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.35)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSkyMoon(scene) {
  const group = new THREE.Group();
  group.visible = false;
  const sprite = (map, scale, opacity, order) => {
    const m = new THREE.SpriteMaterial({ map, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(scale);
    s.renderOrder = order;
    s.raycast = () => {};
    group.add(s);
    return s;
  };
  // Behind it all: the red glow that breathes; then the pale halo; then the disc.
  const red = sprite(glowTexture('rgba(190, 20, 30, 0.9)', 'rgba(120, 0, 10, 0)'), R * 7, 0.35, -3);
  const halo = sprite(glowTexture('rgba(220, 230, 255, 0.8)', 'rgba(150, 170, 220, 0)'), R * 3.8, 0.8, -2);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), new THREE.MeshBasicMaterial({ map: moonTexture(), fog: false, transparent: true, depthWrite: false, toneMapped: false }));
  disc.renderOrder = -1;
  disc.raycast = () => {};
  group.add(disc);
  scene.add(group);

  const sphere = new THREE.Sphere(new THREE.Vector3(), R * 3.5);
  const frustum = new THREE.Frustum();
  const m4 = new THREE.Matrix4();

  // Hang it in the sky ahead of the camera: centred left-right, `lift` degrees
  // above where the camera looks.
  function placeFrom(camera, target, lift = 13) {
    const fwd = target.clone().sub(camera.position).normalize();
    const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1)) + THREE.MathUtils.degToRad(lift);
    const dir = flat.multiplyScalar(Math.cos(pitch)).setY(Math.sin(pitch));
    group.position.copy(camera.position).addScaledVector(dir, DIST);
    group.visible = true;
  }
  function tick(t, camera) {
    if (!group.visible) return;
    disc.lookAt(camera.position);
    const beat = 0.5 + 0.5 * Math.sin(t * 1.7);      // a slow, uneasy pulse
    red.material.opacity = 0.3 + 0.3 * beat;
    red.scale.setScalar(R * (6.6 + 0.8 * beat));
  }
  // Is any of it on screen?
  function inView(camera) {
    camera.updateMatrixWorld();
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m4);
    sphere.center.copy(group.position);
    return frustum.intersectsSphere(sphere);
  }
  return {
    placeFrom, tick, inView,
    hide() { group.visible = false; },
    get visible() { return group.visible; },
  };
}
