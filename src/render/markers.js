// Gameplay markers: a big icon badge floating over the cell (always facing
// the camera, so it reads from the overhead view) plus a coloured ring on
// the floor. Markers sit on top of a cell and never change it.
import * as THREE from 'three';

// Badge colours and icon drawing per marker type.
export const MARKER_STYLE = {
  investigation: { ring: '#e8b04a', bg: '#2a2116', fg: '#f3c460' },
  objective: { ring: '#e0503f', bg: '#2a1412', fg: '#f06a55' },
  whiteDice: { ring: '#e8e4d8', bg: '#e8e4d8', fg: '#1b1b1d' },
  blackDice: { ring: '#9aa0a8', bg: '#121315', fg: '#f2f0ea' },
  key: { ring: '#e6c25a', bg: '#2a2410', fg: '#f2d070' },
  research: { ring: '#a98be0', bg: '#1e1830', fg: '#c6aef5' },
  // Optional objective (play only, never painted): a Missing-person memorial
  // where the Shadow People's candles can be relit. Pale blue, not the red flag.
  shrine: { ring: '#7fcfe6', bg: '#102028', fg: '#9fe0f2' },
};

const S = 256; // icon canvas size

// Draw one marker's badge into a canvas: a round badge with a bold icon.
export function drawMarkerIcon(type, size = S) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const st = MARKER_STYLE[type];
  const k = size / S;
  g.scale(k, k);
  // Badge with a dark outline so it reads on light and dark ground.
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.fillStyle = st.bg;
  g.fill();
  g.lineWidth = 14;
  g.strokeStyle = st.ring;
  g.stroke();
  g.beginPath();
  g.arc(128, 128, 122, 0, Math.PI * 2);
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.stroke();

  g.fillStyle = st.fg;
  g.strokeStyle = st.fg;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const pip = (x, y, r = 11) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  switch (type) {
    case 'investigation': // magnifying glass
      g.lineWidth = 16;
      g.beginPath(); g.arc(112, 110, 40, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 22;
      g.beginPath(); g.moveTo(142, 140); g.lineTo(180, 178); g.stroke();
      break;
    case 'objective': // flag on a pole
    case 'shrine':    // the same flag, with a small candle flame at its foot
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(90, 190); g.lineTo(90, 66); g.stroke();
      g.beginPath(); g.moveTo(96, 68); g.lineTo(182, 92); g.lineTo(96, 122); g.closePath(); g.fill();
      if (type === 'shrine') {
        g.beginPath(); g.moveTo(150, 132); g.quadraticCurveTo(170, 158, 150, 176); g.quadraticCurveTo(130, 158, 150, 132); g.fill();
        g.fillRect(140, 178, 20, 18);
      }
      break;
    case 'whiteDice':
    case 'blackDice': { // a die showing five
      const fill = type === 'whiteDice' ? '#ffffff' : '#26282c';
      const edge = type === 'whiteDice' ? '#1b1b1d' : '#d8d6cf';
      g.fillStyle = fill;
      g.strokeStyle = edge;
      g.lineWidth = 8;
      roundRect(g, 74, 74, 108, 108, 20);
      g.fill(); g.stroke();
      g.fillStyle = type === 'whiteDice' ? '#1b1b1d' : '#f2f0ea';
      for (const [x, y] of [[100, 100], [156, 100], [128, 128], [100, 156], [156, 156]]) pip(x, y);
      break;
    }
    case 'key': // old skeleton key
      g.lineWidth = 14;
      g.beginPath(); g.arc(92, 128, 26, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 16;
      g.beginPath(); g.moveTo(118, 128); g.lineTo(196, 128); g.stroke();
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(170, 128); g.lineTo(170, 156); g.moveTo(190, 128); g.lineTo(190, 150); g.stroke();
      break;
    case 'research': // open book
      g.lineWidth = 8;
      g.beginPath();
      g.moveTo(128, 92); g.quadraticCurveTo(100, 78, 66, 86); g.lineTo(66, 170); g.quadraticCurveTo(100, 162, 128, 176);
      g.quadraticCurveTo(156, 162, 190, 170); g.lineTo(190, 86); g.quadraticCurveTo(156, 78, 128, 92);
      g.closePath();
      g.globalAlpha = 0.25; g.fill(); g.globalAlpha = 1; g.stroke();
      g.beginPath(); g.moveTo(128, 92); g.lineTo(128, 176); g.stroke();
      g.lineWidth = 5;
      for (const y of [108, 124, 140]) {
        g.beginPath(); g.moveTo(80, y); g.lineTo(116, y + 2); g.moveTo(140, y + 2); g.lineTo(176, y); g.stroke();
      }
      break;
    default:
  }
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Greyscale, darkened version of a marker's badge with a green check.
function drawCollectedIcon(type) {
  const c = drawMarkerIcon(type);
  const g = c.getContext('2d');
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * 0.55;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
  g.beginPath();
  g.arc(190, 190, 50, 0, Math.PI * 2);
  g.fillStyle = '#2fae5f';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#0d1a12';
  g.stroke();
  g.beginPath();
  g.moveTo(166, 190); g.lineTo(184, 210); g.lineTo(216, 170);
  g.lineWidth = 14;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#ffffff';
  g.stroke();
  return c;
}

// Floating text label (e.g. "+1 White Die").
function drawLabel(text, colour) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  // Shrink long words to fit the label (the message feed has the whole line).
  let size = 58;
  const font = (px) => `700 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.font = font(size);
  while (size > 30 && g.measureText(text).width > 488) g.font = font(size -= 2);
  if (g.measureText(text).width > 488) {
    while (text.length > 4 && g.measureText(`${text}…`).width > 488) text = text.slice(0, -1);
    text = `${text.trimEnd()}…`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 12;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 256, 66);
  g.fillStyle = colour;
  g.fillText(text, 256, 66);
  return c;
}

function radialTexture(colour) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, colour);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createMarkers(group) {
  const spriteMats = {};
  const ringMats = {};
  const fadedSpriteMats = {};
  const fadedRingMats = {};
  for (const type of Object.keys(MARKER_STYLE)) {
    const tex = new THREE.CanvasTexture(drawMarkerIcon(type));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    spriteMats[type] = new THREE.SpriteMaterial({ map: tex, depthTest: true, fog: false });
    ringMats[type] = new THREE.MeshBasicMaterial({
      color: MARKER_STYLE[type].ring, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
    });
    // Collected / used markers: greyscale with a green check mark.
    const doneTex = new THREE.CanvasTexture(drawCollectedIcon(type));
    doneTex.colorSpace = THREE.SRGBColorSpace;
    fadedSpriteMats[type] = new THREE.SpriteMaterial({
      map: doneTex, depthTest: true, fog: false, transparent: true, opacity: 0.7,
    });
    fadedRingMats[type] = new THREE.MeshBasicMaterial({
      color: MARKER_STYLE[type].ring, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  const ringGeo = new THREE.RingGeometry(0.33, 0.44, 32).rotateX(-Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0);
  const stemMat = new THREE.MeshBasicMaterial({ color: '#d8d2c0', transparent: true, opacity: 0.6 });
  const items = []; // { sprite, ring, stem, baseY, phase }
  const root = new THREE.Group();
  group.add(root);
  const SIZE = 0.62;    // badge size in cells
  const LIFT = 0.55;    // badge height above the floor (cells)

  // list: [{ type, x, y, z (floor), dim, faded }]
  function update(list) {
    while (items.length > list.length) {
      const it = items.pop();
      root.remove(it.sprite, it.ring, it.stem);
    }
    while (items.length < list.length) {
      const it = {
        sprite: new THREE.Sprite(spriteMats.investigation),
        ring: new THREE.Mesh(ringGeo, ringMats.investigation),
        stem: new THREE.Mesh(stemGeo, stemMat),
        baseY: 0,
        phase: 0,
      };
      it.sprite.scale.set(SIZE, SIZE, 1);
      it.sprite.renderOrder = 20;
      it.ring.renderOrder = 4;
      it.sprite.raycast = it.ring.raycast = it.stem.raycast = () => {};
      root.add(it.sprite, it.ring, it.stem);
      items.push(it);
    }
    list.forEach((m, n) => {
      const it = items[n];
      it.sprite.material = (m.faded ? fadedSpriteMats : spriteMats)[m.type];
      it.ring.material = (m.faded ? fadedRingMats : ringMats)[m.type];
      it.baseY = m.y;
      it.phase = (m.x * 3.1 + m.z * 1.7) % (Math.PI * 2);
      it.ring.position.set(m.x, m.y + 0.015, m.z);
      it.stem.position.set(m.x, m.y, m.z);
      it.stem.scale.set(1, LIFT - SIZE / 2, 1);
      it.sprite.position.set(m.x, m.y + LIFT, m.z);
      it.sprite.visible = it.ring.visible = true;
      it.stem.visible = !m.faded;
      // Smaller badge: a marker left on a blocked cell, or one collected.
      it.dim = m.dim || m.faded;
      it.sprite.scale.set(it.dim ? SIZE * 0.7 : SIZE, it.dim ? SIZE * 0.7 : SIZE, 1);
    });
  }

  // Collect effect: the badge pops outward, a coloured ring flashes and a
  // label floats up. (x, y, z) is the marker's floor point (already lifted).
  const bursts = [];
  const ringTex = {};
  function burst(type, x, y, z, text) {
    ringTex[type] ??= radialTexture(MARKER_STYLE[type].ring);
    const pop = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteMats[type].map, transparent: true, depthTest: false, fog: false }));
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: ringTex[type], transparent: true, depthTest: false, fog: false, blending: THREE.AdditiveBlending,
    }));
    const labelTex = new THREE.CanvasTexture(drawLabel(text, MARKER_STYLE[type].fg === '#1b1b1d' ? '#ffffff' : MARKER_STYLE[type].fg));
    labelTex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false, fog: false }));
    for (const s of [pop, flash, label]) { s.renderOrder = 30; s.raycast = () => {}; root.add(s); }
    bursts.push({ pop, flash, label, x, y, z, age: 0 });
  }
  let lastT = null;
  function tickBursts(t, camera) {
    const dt = lastT === null ? 0 : Math.min(0.1, t - lastT);
    lastT = t;
    for (let k = bursts.length - 1; k >= 0; k--) {
      const b = bursts[k];
      b.age += dt;
      const d = camera ? camera.position.distanceTo(tmp.set(b.x, b.y, b.z)) : 10;
      const f = Math.max(1, (d * 0.03) / SIZE); // same minimum size as badges
      const a1 = Math.min(1, b.age / 0.8);
      b.pop.position.set(b.x, b.y + LIFT * f + a1 * 0.3 * f, b.z);
      b.pop.scale.setScalar(SIZE * f * (1 + a1 * 1.6));
      b.pop.material.opacity = 1 - a1;
      b.flash.position.set(b.x, b.y + LIFT * f, b.z);
      b.flash.scale.setScalar(SIZE * f * (0.8 + a1 * 3));
      b.flash.material.opacity = 1 - a1;
      const a2 = Math.min(1, b.age / 2.2);
      b.label.position.set(b.x, b.y + (LIFT + 0.45 + a2 * 0.9) * f, b.z);
      b.label.scale.set(1.8 * f, 0.45 * f, 1);
      b.label.material.opacity = a2 < 0.6 ? 1 : 1 - (a2 - 0.6) / 0.4;
      if (b.age >= 2.2) {
        for (const s of [b.pop, b.flash, b.label]) {
          root.remove(s);
          if (s === b.label) s.material.map.dispose();
          s.material.dispose();
        }
        bursts.splice(k, 1);
      }
    }
  }

  // Gentle bob so markers read as tokens, not scenery. Badges never get
  // smaller on screen than about 3% of the camera distance, so they stay
  // easy to spot when zoomed out; up close they're 0.62 cells across.
  const tmp = new THREE.Vector3();
  function tick(t, camera) {
    tickBursts(t, camera);
    for (const it of items) {
      it.sprite.position.y = it.baseY + LIFT + Math.sin(t * 1.6 + it.phase) * 0.025;
      if (camera) {
        const d = camera.position.distanceTo(tmp.copy(it.sprite.position));
        const size = Math.max(SIZE, d * 0.03) * (it.dim ? 0.7 : 1);
        it.sprite.scale.set(size, size, 1);
        // Lift big badges so they clear their ring and the cell.
        it.sprite.position.y += Math.max(0, size - SIZE) * 0.5;
      }
    }
  }

  function setVisible(v) { root.visible = v; }
  // Fade every badge and ring (0..1): the game-start camera move fades them in.
  function setOpacity(k) {
    root.traverse((o) => {
      for (const m of [].concat(o.material ?? [])) {
        m.userData.baseOpacity ??= m.transparent ? m.opacity : 1;
        if (k < 1) m.transparent = true;
        m.opacity = m.userData.baseOpacity * k;
      }
    });
  }

  return { update, tick, setVisible, setOpacity, burst, busy: () => bursts.length > 0 };
}
