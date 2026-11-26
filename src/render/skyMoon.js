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
  // Mottling and a few faint craters (soft, no outlines).
  for (let k = 0; k < 60; k++) {
    const x = 20 + rnd() * 216, y = 20 + rnd() * 216, r = 3 + rnd() * 14;
    if ((x - 128) ** 2 + (y - 128) ** 2 > 110 ** 2) continue;
    blot(x, y, r, 0.08 + rnd() * 0.1);
  }
  for (let k = 0; k < 9; k++) {
    const x = 40 + rnd() * 176, y = 40 + rnd() * 176, r = 3 + rnd() * 5;
    if ((x - 128) ** 2 + (y - 128) ** 2 > 100 ** 2) continue;
    blot(x + 1.5, y + 1.5, r, 0.22);
    const hi = g.createRadialGradient(x - 1, y - 1, 0, x - 1, y - 1, r * 0.8);
    hi.addColorStop(0, 'rgba(255, 252, 240, 0.35)'); hi.addColorStop(1, 'rgba(255, 252, 240, 0)');
    g.fillStyle = hi; g.beginPath(); g.arc(x - 1, y - 1, r * 0.8, 0, Math.PI * 2); g.fill();
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

// A wisp of cloud: a few soft, stretched puffs, pale blue-grey, see-through.
function cloudTexture(seed0) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  let seed = seed0;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 22; k++) {
    const x = 70 + rnd() * 372, y = 64 + (rnd() - 0.5) * 40;
    const rx = 45 + rnd() * 80, ry = 14 + rnd() * 22;
    g.save();
    g.translate(x, y);
    g.scale(rx / ry, 1);
    const b = g.createRadialGradient(0, 0, 0, 0, 0, ry);
    b.addColorStop(0, `rgba(150, 160, 185, ${0.16 + rnd() * 0.14})`);
    b.addColorStop(1, 'rgba(150, 160, 185, 0)');
    g.fillStyle = b;
    g.beginPath(); g.arc(0, 0, ry, 0, Math.PI * 2); g.fill();
    g.restore();
  }
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

  // Two wisps of cloud that drift across in front of it, left to right, and come
  // round again a moment after they've left the screen.
  const clouds = [0, 1].map((k) => {
    const m = new THREE.SpriteMaterial({ map: cloudTexture(11 + k * 97), transparent: true, opacity: 0.95, depthWrite: false, fog: false, toneMapped: false });
    const s = new THREE.Sprite(m);
    s.renderOrder = 0;
    s.raycast = () => {};
    scene.add(s);
    s.visible = false;
    return { s, k, t0: null };
  });
  const right = new THREE.Vector3(), up = new THREE.Vector3(), centre = new THREE.Vector3();
  let span = 0, cloudW = 0;

  // The night sky's stars: a dome of small points around the camera (no fog),
  // only while the moon is up.
  const STARS = 900;
  const starPos = new Float32Array(STARS * 3), starCol = new Float32Array(STARS * 3);
  let sseed = 3;
  const srnd = () => ((sseed = (sseed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < STARS; k++) {
    const u = srnd() * Math.PI * 2, v = Math.asin(srnd() * 1.1 - 0.1);   // mostly above the horizon
    starPos.set([Math.cos(v) * Math.cos(u) * 700, Math.sin(v) * 700, Math.cos(v) * Math.sin(u) * 700], k * 3);
    const b = 0.45 + srnd() * 0.55;
    starCol.set([b * (0.85 + srnd() * 0.15), b * (0.88 + srnd() * 0.12), b], k * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
  stars.renderOrder = -10;
  stars.frustumCulled = false;
  stars.visible = false;
  stars.raycast = () => {};
  scene.add(stars);

  const sphere = new THREE.Sphere(new THREE.Vector3(), R * 3.5);
  const frustum = new THREE.Frustum();
  const m4 = new THREE.Matrix4();

  // Hang it dead ahead of the camera (centred on the screen), `size` times its
  // usual size; the clouds drift across in front of it.
  function placeAhead(camera, size = 1) {
    camera.updateMatrixWorld();
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    group.position.copy(camera.position).addScaledVector(fwd, DIST);
    group.scale.setScalar(size);
    group.visible = true;
    stars.visible = true;
    stars.position.copy(camera.position);
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    // The clouds pass a little in front of the moon; they cross the whole screen.
    const d = DIST * 0.8;
    centre.copy(camera.position).addScaledVector(fwd, d);
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * d;
    cloudW = R * size * 3.4;
    span = halfH * camera.aspect + cloudW / 2;
    for (const c of clouds) {
      c.s.scale.set(cloudW * (c.k ? 0.8 : 1), cloudW * 0.32 * (c.k ? 0.8 : 1), 1);
      c.s.visible = true;
      c.t0 = null;
    }
  }
  const CROSS = 26, PAUSE = 4;   // s to cross the screen; s off-screen before coming round again
  function tick(t, camera) {
    if (stars.visible) stars.position.copy(camera.position);   // the dome goes where the camera goes
    if (!group.visible) { for (const c of clouds) c.s.visible = false; return; }
    for (const c of clouds) {
      // The second wisp follows the first, lower and a little faster, half a crossing behind.
      const cross = c.k ? CROSS * 0.85 : CROSS;
      c.t0 ??= t - (c.k ? -cross * 0.45 : cross * 0.12);
      const p = ((t - c.t0) % (cross + PAUSE) + (cross + PAUSE)) % (cross + PAUSE);
      const x = -span + (2 * span) * (p / cross);
      const y = (c.k ? -0.42 : 0.18) * R * group.scale.x;
      c.s.position.copy(centre).addScaledVector(right, p < cross ? x : span * 3).addScaledVector(up, y);
    }
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
    placeAhead, tick, inView,
    hide() { group.visible = false; stars.visible = false; for (const c of clouds) c.s.visible = false; },
    // The moon and its clouds only (the stars stay for the rest of the camera move).
    hideMoon() { group.visible = false; for (const c of clouds) c.s.visible = false; },
    get starsUp() { return stars.visible; },
    // Everything in the sky (not to be moved with the land).
    parts: () => [group, stars, ...clouds.map((c) => c.s)],
    get visible() { return group.visible; },
  };
}
