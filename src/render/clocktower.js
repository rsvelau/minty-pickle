// "Old Clocktower": a 2x2-cell landmark. A late-1800s stone tower with a
// weathered clapboard clock stage, four backlit dials, an open belfry and a
// steep shingled spire. The hands show the game time (see setTime).
//
// Towers sit on the north-west cell of each 2x2 block of clocktower cells
// (grid.clocktowers()). Geometry is built in metres and converted with m().
import * as THREE from 'three';
import { m } from '../core/scale.js';

const STONE = '#77726a';
const STONE_DARK = '#5c5750';
const TRIM = '#3a3631';
const CLAPBOARD = '#a8a594';
const ROOF = '#2b2a2c';
const HAND = '#141210';

// Heights (metres above the plaza).
const PLINTH_H = 1.2;
const SHAFT_TOP = 17;
const STAGE_TOP = 24;
const BELFRY_TOP = 28.5;
const ROOF_H = 9;
const SHAFT_W = 8.4;
const STAGE_W = 9.4;
const DIAL_R = 2.7;      // dial radius
const DIAL_Y = (SHAFT_TOP + STAGE_TOP) / 2;

function dialTexture() {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = S / 2;
  // Old opal glass, lit from behind: warm and a little sickly.
  const grad = g.createRadialGradient(c, c, S * 0.05, c, c, S * 0.5);
  grad.addColorStop(0, '#fff6d2');
  grad.addColorStop(0.75, '#e9d9a0');
  grad.addColorStop(1, '#b9a46a');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, S * 0.49, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2a2420';
  g.lineWidth = S * 0.025;
  g.beginPath(); g.arc(c, c, S * 0.47, 0, Math.PI * 2); g.stroke();
  g.lineWidth = S * 0.006;
  g.beginPath(); g.arc(c, c, S * 0.34, 0, Math.PI * 2); g.stroke();
  // Minute ticks.
  for (let k = 0; k < 60; k++) {
    const a = (k / 60) * Math.PI * 2;
    const r0 = k % 5 ? S * 0.43 : S * 0.40, r1 = S * 0.455;
    g.lineWidth = k % 5 ? S * 0.005 : S * 0.012;
    g.beginPath();
    g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0);
    g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1);
    g.stroke();
  }
  // Roman numerals (IIII on the old dial, as many tower clocks have).
  const NUM = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.fillStyle = '#2a2420';
  g.font = `600 ${Math.round(S * 0.075)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  NUM.forEach((t, k) => {
    const a = (k / 12) * Math.PI * 2;
    g.save();
    g.translate(c + Math.sin(a) * S * 0.375, c - Math.cos(a) * S * 0.375);
    g.rotate(a);
    g.fillText(t, 0, 0);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createClocktowers(parent) {
  const root = new THREE.Group();
  root.name = 'clocktowers';
  parent.add(root);

  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // base at y = 0
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...extra });
  const mats = {
    stone: mat(STONE), stoneDark: mat(STONE_DARK), trim: mat(TRIM), clap: mat(CLAPBOARD),
    roof: mat(ROOF, { flatShading: true }), hand: mat(HAND, { roughness: 0.6, metalness: 0.4 }),
    door: mat('#1d1712'), void: new THREE.MeshBasicMaterial({ color: '#0b0a0c' }),
    dial: new THREE.MeshBasicMaterial({ map: dialTexture(), color: '#f2e2a8' }),
    vane: mat('#3b3a36', { metalness: 0.6, roughness: 0.5 }),
  };
  const roofGeo = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0);
  const dialGeo = new THREE.CircleGeometry(1, 48);
  const ringGeo = new THREE.TorusGeometry(1, 0.06, 6, 48);
  const hourGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

  const towers = [];     // { group, hands: [{ hour, minute }] }
  let target = 23 * 60;  // minutes since midnight shown by the hands
  let shown = target;

  const part = (g, geo, material, x, y, z, sx, sy, sz) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.raycast = () => {};
    g.add(mesh);
    return mesh;
  };

  function build() {
    const g = new THREE.Group();
    const s = (v) => m(v);
    // Stepped stone plinth (reaches below the plaza to hide any gaps).
    part(g, box, mats.stoneDark, 0, s(-1), 0, s(12.6), s(PLINTH_H + 1), s(12.6));
    part(g, box, mats.stone, 0, s(-1), 0, s(11), s(PLINTH_H + 1.6), s(11));
    // Shaft with corner buttresses and string courses.
    part(g, box, mats.stone, 0, 0, 0, s(SHAFT_W), s(SHAFT_TOP), s(SHAFT_W));
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      part(g, box, mats.stoneDark, cx * s(SHAFT_W / 2), 0, cz * s(SHAFT_W / 2), s(1.5), s(SHAFT_TOP - 0.6), s(1.5));
    }
    for (const yb of [5.5, 11.5]) part(g, box, mats.trim, 0, s(yb), 0, s(SHAFT_W + 0.35), s(0.35), s(SHAFT_W + 0.35));
    part(g, box, mats.trim, 0, s(SHAFT_TOP - 0.7), 0, s(STAGE_W + 0.6), s(0.7), s(STAGE_W + 0.6));
    // Arched door and narrow slit windows on every side.
    for (let side = 0; side < 4; side++) {
      const a = (side * Math.PI) / 2;
      const nx = Math.sin(a), nz = Math.cos(a);
      const off = s(SHAFT_W / 2 + 0.02);
      const rot = new THREE.Euler(0, a, 0);
      if (side === 0) {
        const d = part(g, box, mats.door, nx * off, 0, nz * off, s(2.2), s(3.6), s(0.1));
        d.rotation.copy(rot);
        const arch = part(g, new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2),
          mats.door, nx * off, s(3.6), nz * off, s(1.1), s(0.1), s(1.1));
        arch.rotation.copy(rot);
      }
      for (const yw of [7.5, 13.2]) {
        const w = part(g, box, mats.void, nx * off, s(yw), nz * off, s(0.7), s(2.4), s(0.08));
        w.rotation.copy(rot);
      }
    }
    // Clock stage: weathered clapboard with corner boards.
    part(g, box, mats.clap, 0, s(SHAFT_TOP), 0, s(STAGE_W), s(STAGE_TOP - SHAFT_TOP), s(STAGE_W));
    for (let k = 1; k < 14; k++) {
      const y = SHAFT_TOP + (k / 14) * (STAGE_TOP - SHAFT_TOP);
      part(g, box, mats.stoneDark, 0, s(y), 0, s(STAGE_W + 0.1), s(0.05), s(STAGE_W + 0.1));
    }
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      part(g, box, mats.trim, cx * s(STAGE_W / 2), s(SHAFT_TOP), cz * s(STAGE_W / 2), s(0.45), s(STAGE_TOP - SHAFT_TOP), s(0.45));
    }
    part(g, box, mats.trim, 0, s(STAGE_TOP), 0, s(STAGE_W + 0.9), s(0.6), s(STAGE_W + 0.9));
    // Four dials with hands.
    const hands = [];
    for (let side = 0; side < 4; side++) {
      const a = (side * Math.PI) / 2;
      const face = new THREE.Group();
      face.rotation.y = a;
      // Dials stand well clear of the clapboard boards (no shared planes, no flicker).
      face.position.set(Math.sin(a) * s(STAGE_W / 2 + 0.14), s(DIAL_Y), Math.cos(a) * s(STAGE_W / 2 + 0.14));
      const dial = new THREE.Mesh(dialGeo, mats.dial);
      dial.scale.setScalar(s(DIAL_R));
      dial.raycast = () => {};
      face.add(dial);
      const ring = new THREE.Mesh(ringGeo, mats.trim);
      ring.scale.setScalar(s(DIAL_R));
      ring.raycast = () => {};
      face.add(ring);
      const hour = new THREE.Mesh(hourGeo, mats.hand);
      hour.scale.set(s(0.32), s(DIAL_R * 0.55), s(0.08));
      hour.position.z = s(0.08);
      const minute = new THREE.Mesh(hourGeo, mats.hand);
      minute.scale.set(s(0.2), s(DIAL_R * 0.85), s(0.08));
      minute.position.z = s(0.14);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 12).rotateX(Math.PI / 2), mats.hand);
      hub.scale.set(s(0.25), s(0.25), s(0.3));
      hub.position.z = s(0.14);
      for (const o of [hour, minute, hub]) { o.raycast = () => {}; o.castShadow = true; face.add(o); }
      g.add(face);
      hands.push({ hour, minute });
    }
    // Open belfry: corner posts, a dark interior with a bell, louvred rails.
    const BW = 7.2;
    part(g, box, mats.void, 0, s(STAGE_TOP + 0.6), 0, s(BW - 1.2), s(BELFRY_TOP - STAGE_TOP - 0.6), s(BW - 1.2));
    for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      part(g, box, mats.clap, cx * s(BW / 2 - 0.4), s(STAGE_TOP + 0.6), cz * s(BW / 2 - 0.4), s(0.8), s(BELFRY_TOP - STAGE_TOP - 0.6), s(0.8));
    }
    for (let k = 0; k < 4; k++) {
      const y = STAGE_TOP + 1 + k * 0.7;
      part(g, box, mats.trim, 0, s(y), 0, s(BW - 0.4), s(0.12), s(BW - 0.4)).material = mats.trim;
    }
    const bell = new THREE.Mesh(new THREE.CylinderGeometry(s(0.6), s(1.1), s(1.6), 16), mats.vane);
    bell.position.y = s(BELFRY_TOP - 1.6);
    g.add(bell);
    part(g, box, mats.trim, 0, s(BELFRY_TOP), 0, s(BW + 0.6), s(0.5), s(BW + 0.6));
    // Steep shingled spire, finial and weather vane.
    part(g, roofGeo, mats.roof, 0, s(BELFRY_TOP + 0.5), 0, s(BW * 0.78), s(ROOF_H), s(BW * 0.78));
    const top = BELFRY_TOP + 0.5 + ROOF_H;
    part(g, box, mats.vane, 0, s(top - 0.3), 0, s(0.12), s(2.4), s(0.12));
    part(g, box, mats.vane, 0, s(top + 1.4), 0, s(1.8), s(0.08), s(0.08));
    const arrow = part(g, roofGeo, mats.vane, s(0.9), s(top + 1.44), 0, s(0.25), s(0.6), s(0.08));
    arrow.rotation.z = -Math.PI / 2;
    return { group: g, hands };
  }

  // ctx: { visible, anchors: [{ x, z, y }] } world positions of each tower's
  // centre (the shared corner of its 2x2 cells) and plaza height.
  function update(ctx) {
    while (towers.length > ctx.anchors.length) root.remove(towers.pop().group);
    while (towers.length < ctx.anchors.length) {
      const t = build();
      root.add(t.group);
      towers.push(t);
    }
    ctx.anchors.forEach((a, n) => towers[n].group.position.set(a.x, a.y, a.z));
    root.visible = ctx.visible;
    pose();
  }

  function pose() {
    const h = (shown / 60) % 12;
    const mins = shown % 60;
    for (const t of towers) {
      for (const { hour, minute } of t.hands) {
        hour.rotation.z = -(h / 12) * Math.PI * 2;
        minute.rotation.z = -(mins / 60) * Math.PI * 2;
      }
    }
  }

  // Dial backlight, 1 = lit, 0 = out (it dies at midnight).
  const DIAL_ON = new THREE.Color('#f2e2a8'), DIAL_OFF = new THREE.Color('#2a2720');
  let glow = 1;
  function setGlow(v) {
    if (v === glow) return;
    glow = v;
    mats.dial.color.copy(DIAL_OFF).lerp(DIAL_ON, v);
  }

  // Minutes since midnight (23 * 60 = 11 PM; 24 * 60 = midnight).
  function setTime(minutes) { target = minutes; }

  // The minute hand sweeps forward to a new time rather than jumping.
  function tick(dt) {
    if (shown === target || !towers.length) { shown = target; return; }
    const d = target - shown;
    const stepMin = Math.max(Math.abs(d) * Math.min(1, dt * 2.5), dt * 4);
    shown = Math.abs(d) <= stepMin ? target : shown + Math.sign(d) * stepMin;
    pose();
  }

  function clear() { parent.remove(root); }

  return { update, setTime, setGlow, tick, clear, busy: () => shown !== target && towers.length > 0, materials: Object.values(mats) };
}
