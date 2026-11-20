// Discoveries: how a cell changes when evidence is found there.
//
// Observations and Attack cards leave a mark painted onto the cell (frost,
// claw gouges, pooled blood, howl rings...). A Lair transforms its cell
// for good: an opened grave, a cave mouth, a scorched transformation site, a
// ritual circle, a ruin, a wrecked room, a pit of darkness, each with a
// coloured glow. The Initiative spawn marker lives here too.
//
// update(list): list = [{ cell, visual, lair }] (the evidence found so far).
// Each visual is drawn once into a canvas texture and shared.
import * as THREE from 'three';
import { m } from './scale.js';

const S = 256; // decal texture size

// --- decal painters (canvas 2D, centre = cell centre) ---------------------------
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9 >>> 0) / 4294967296); }
const PAINT = {
  frost(g, r) {
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 120);
    gr.addColorStop(0, 'rgba(210,235,255,0.75)'); gr.addColorStop(1, 'rgba(160,200,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(235,248,255,0.85)'; g.lineWidth = 1.5;
    for (let k = 0; k < 26; k++) { // frost ferns
      let x = 128 + (r() - 0.5) * 180, y = 128 + (r() - 0.5) * 180, a = r() * 6.3;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 6; s++) { a += (r() - 0.5); x += Math.cos(a) * 8; y += Math.sin(a) * 8; g.lineTo(x, y); }
      g.stroke();
    }
  },
  howl(g) {
    g.strokeStyle = 'rgba(200,190,255,0.7)';
    for (let k = 1; k <= 4; k++) { g.lineWidth = 5 - k; g.beginPath(); g.arc(128, 128, k * 28, 0, Math.PI * 2); g.stroke(); }
  },
  claws(g, r) {
    g.strokeStyle = 'rgba(25,12,8,0.9)'; g.lineCap = 'round';
    for (const off of [-30, 0, 30]) {
      g.lineWidth = 9; g.beginPath(); g.moveTo(70 + off, 50); g.quadraticCurveTo(120 + off, 128, 160 + off + r() * 10, 210); g.stroke();
      g.strokeStyle = 'rgba(120,70,50,0.6)'; g.lineWidth = 3; g.stroke(); g.strokeStyle = 'rgba(25,12,8,0.9)';
    }
  },
  carcass(g, r) { PAINT.blood(g, r, 0.7); PAINT.bones(g, r); },
  tracks(g, r) {
    g.fillStyle = 'rgba(20,16,14,0.85)';
    for (let k = 0; k < 6; k++) {
      const x = 60 + k * 28 + (k % 2) * 8, y = 210 - k * 32;
      g.beginPath(); g.ellipse(x, y, 9, 13, 0.4, 0, Math.PI * 2); g.fill();
      for (let t = 0; t < 4; t++) { g.beginPath(); g.arc(x - 9 + t * 6, y - 17, 3.5, 0, Math.PI * 2); g.fill(); }
    }
    void r;
  },
  sulfur(g, r) {
    const gr = g.createRadialGradient(128, 128, 5, 128, 128, 125);
    gr.addColorStop(0, 'rgba(220,200,60,0.7)'); gr.addColorStop(0.6, 'rgba(120,100,20,0.4)'); gr.addColorStop(1, 'rgba(60,50,10,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(30,25,10,0.8)';
    for (let k = 0; k < 40; k++) { g.beginPath(); g.arc(30 + r() * 196, 30 + r() * 196, 2 + r() * 4, 0, 7); g.fill(); }
  },
  scattered(g, r) {
    // Dropped belongings: a shoe, a torn bag, papers.
    g.fillStyle = 'rgba(230,225,210,0.8)';
    for (let k = 0; k < 6; k++) { g.save(); g.translate(40 + r() * 170, 40 + r() * 170); g.rotate(r() * 6); g.fillRect(-10, -14, 20, 28); g.restore(); }
    g.fillStyle = 'rgba(60,40,30,0.9)'; g.beginPath(); g.ellipse(160, 90, 22, 10, 0.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(40,60,90,0.9)'; g.fillRect(80, 150, 40, 30);
  },
  withered(g, r) {
    g.strokeStyle = 'rgba(70,55,40,0.9)'; g.lineWidth = 3;
    for (let k = 0; k < 14; k++) {
      const x = 30 + r() * 196, y = 30 + r() * 196;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 40, y + (r() - 0.5) * 40); g.stroke();
    }
    g.fillStyle = 'rgba(90,20,30,0.85)';
    for (let k = 0; k < 8; k++) { g.beginPath(); g.arc(30 + r() * 196, 30 + r() * 196, 4 + r() * 4, 0, 7); g.fill(); }
  },
  bones(g, r) {
    g.fillStyle = 'rgba(230,222,200,0.95)';
    for (let k = 0; k < 7; k++) {
      g.save(); g.translate(50 + r() * 156, 50 + r() * 156); g.rotate(r() * 6.3);
      g.fillRect(-20, -3, 40, 6);
      for (const e of [-20, 20]) { g.beginPath(); g.arc(e, -3, 5, 0, 7); g.arc(e, 3, 5, 0, 7); g.fill(); }
      g.restore();
    }
  },
  sparks(g, r) {
    PAINT.scattered(g, r);
    g.strokeStyle = 'rgba(255,240,180,0.9)'; g.lineWidth = 2;
    for (let k = 0; k < 10; k++) { const x = 128 + (r() - 0.5) * 120, y = 128 + (r() - 0.5) * 120; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); g.stroke(); }
  },
  static(g, r) {
    for (let y = 40; y < 216; y += 4) {
      g.fillStyle = `rgba(${150 + r() * 100},${150 + r() * 100},${170 + r() * 80},${0.15 + r() * 0.35})`;
      g.fillRect(40 + r() * 30, y, 120 + r() * 60, 2);
    }
  },
  cracks(g, r) {
    g.strokeStyle = 'rgba(10,8,6,0.95)'; g.lineWidth = 3;
    for (let k = 0; k < 5; k++) {
      let x = 128, y = 128, a = (k / 5) * 6.3 + r();
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 8; s++) { a += (r() - 0.5) * 0.9; x += Math.cos(a) * 15; y += Math.sin(a) * 15; g.lineTo(x, y); }
      g.stroke();
    }
  },
  puddles(g, r) {
    g.fillStyle = 'rgba(40,70,90,0.65)';
    for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(50 + r() * 156, 50 + r() * 156, 18 + r() * 22, 10 + r() * 12, r() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(180,210,230,0.5)'; g.lineWidth = 2;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(60 + r() * 136, 60 + r() * 136, 12, 6, 0, 0, 7); g.stroke(); }
  },
  whispers(g, r) {
    g.fillStyle = 'rgba(200,210,255,0.55)';
    g.font = 'italic 22px Georgia, serif';
    const words = ['help', 'stay', 'below', 'listen', 'go', 'mine'];
    for (let k = 0; k < 7; k++) { g.save(); g.translate(30 + r() * 180, 40 + r() * 180); g.rotate((r() - 0.5) * 1.2); g.fillText(words[k % words.length], 0, 0); g.restore(); }
  },
  blood(g, r, a = 0.9) {
    g.fillStyle = `rgba(110,8,14,${a})`;
    g.beginPath(); g.ellipse(128, 128, 60, 42, r(), 0, 7); g.fill();
    for (let k = 0; k < 16; k++) { g.beginPath(); g.arc(128 + (r() - 0.5) * 200, 128 + (r() - 0.5) * 200, 3 + r() * 9, 0, 7); g.fill(); }
  },
  sickness(g, r) {
    g.fillStyle = 'rgba(150,170,60,0.55)';
    for (let k = 0; k < 6; k++) { g.beginPath(); g.ellipse(50 + r() * 156, 50 + r() * 156, 20, 12, r() * 3, 0, 7); g.fill(); }
    PAINT.scattered(g, r);
  },
  motes(g, r) {
    for (let k = 0; k < 30; k++) {
      const x = 30 + r() * 196, y = 30 + r() * 196;
      const gr = g.createRadialGradient(x, y, 0, x, y, 9);
      gr.addColorStop(0, 'rgba(255,240,140,1)'); gr.addColorStop(1, 'rgba(255,200,60,0)');
      g.fillStyle = gr; g.fillRect(x - 9, y - 9, 18, 18);
    }
  },
  shadow(g, r) {
    const gr = g.createRadialGradient(128, 128, 20, 128, 128, 126);
    gr.addColorStop(0, 'rgba(0,0,0,0.95)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(0,0,0,0.9)';
    for (let k = 0; k < 6; k++) { g.save(); g.translate(128, 128); g.rotate(k + r()); g.beginPath(); g.ellipse(70, 0, 50, 8, 0, 0, 7); g.fill(); g.restore(); }
  },
  struggle(g, r) {
    PAINT.blood(g, r, 0.6);
    g.strokeStyle = 'rgba(40,20,15,0.8)'; g.lineWidth = 6; g.lineCap = 'round';
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(60 + r() * 40, 60 + r() * 140); g.lineTo(150 + r() * 60, 60 + r() * 140); g.stroke(); }
  },
  psychic(g) {
    g.strokeStyle = 'rgba(120,150,255,0.75)';
    for (let k = 0; k < 7; k++) { g.lineWidth = 3; g.beginPath(); g.arc(128, 128, 14 + k * 16, k * 0.7, k * 0.7 + 4.2); g.stroke(); }
  },
  ectoplasm(g, r) {
    g.fillStyle = 'rgba(120,255,160,0.55)';
    g.beginPath(); g.ellipse(128, 128, 70, 45, r(), 0, 7); g.fill();
    for (let k = 0; k < 10; k++) { g.beginPath(); g.arc(128 + (r() - 0.5) * 190, 128 + (r() - 0.5) * 190, 5 + r() * 10, 0, 7); g.fill(); }
  },
  // --- lairs (painted under their 3D pieces) ---
  scorched(g, r) {
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, 'rgba(5,3,2,0.97)'); gr.addColorStop(0.7, 'rgba(25,15,8,0.85)'); gr.addColorStop(1, 'rgba(25,15,8,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    PAINT.bones(g, r);
    g.fillStyle = 'rgba(90,60,40,0.9)';
    for (let k = 0; k < 5; k++) { g.save(); g.translate(60 + r() * 136, 60 + r() * 136); g.rotate(r() * 6); g.fillRect(-16, -5, 32, 10); g.restore(); }
  },
  grave(g, r) {
    g.fillStyle = 'rgba(60,42,28,0.95)';
    g.beginPath(); g.ellipse(128, 128, 110, 80, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(5,4,3,1)'; g.fillRect(88, 70, 80, 120);
    void r;
  },
  cave(g, r) {
    g.fillStyle = 'rgba(40,60,40,0.85)';
    for (let k = 0; k < 14; k++) { g.beginPath(); g.arc(30 + r() * 196, 30 + r() * 196, 10 + r() * 22, 0, 7); g.fill(); }
    PAINT.puddles(g, r);
  },
  ritual(g) {
    g.strokeStyle = 'rgba(255,60,40,0.95)'; g.lineWidth = 5;
    g.beginPath(); g.arc(128, 128, 104, 0, 7); g.stroke();
    g.beginPath(); g.arc(128, 128, 84, 0, 7); g.stroke();
    g.beginPath();
    for (let k = 0; k <= 5; k++) { const a = -Math.PI / 2 + (k * 2 * 2 * Math.PI) / 5; const x = 128 + Math.cos(a) * 84, y = 128 + Math.sin(a) * 84; k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  },
  ruin(g, r) { PAINT.blood(g, r, 0.8); PAINT.cracks(g, r); },
  room(g, r) { PAINT.scattered(g, r); PAINT.cracks(g, r); PAINT.whispers(g, r); },
  pit(g) {
    const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.92)'); gr.addColorStop(1, 'rgba(10,0,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  },
  // Initiative: where the monster will rise.
  spawn(g) {
    g.strokeStyle = 'rgba(255,40,30,1)'; g.lineWidth = 7;
    g.beginPath(); g.arc(128, 128, 110, 0, 7); g.stroke();
    g.setLineDash([14, 10]); g.lineWidth = 4; g.beginPath(); g.arc(128, 128, 88, 0, 7); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(255,60,40,0.95)'; g.font = 'bold 84px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('☠', 128, 132);
  },
  sigil(g) { PAINT.ritual(g); },
};
// Which looks glow (additive, unlit) rather than stain the ground.
const GLOWS = new Set(['frost', 'howl', 'motes', 'psychic', 'ectoplasm', 'whispers', 'static', 'ritual', 'spawn', 'sparks']);
// Lair glow colours.
const LAIR_GLOW = { scorched: '#ff6a20', grave: '#7aff9a', cave: '#4ab0ff', ritual: '#ff2a1a', ruin: '#c01020', room: '#b080ff', pit: '#6a20c0' };

export function createDiscoveries(parent, { cellToWorld, cellTop, terrainify }) {
  const root = new THREE.Group();
  root.name = 'discoveries';
  parent.add(root);
  const textures = {};
  const texFor = (visual) => {
    if (!textures[visual]) {
      const c = document.createElement('canvas');
      c.width = c.height = S;
      (PAINT[visual] ?? PAINT.sigil)(c.getContext('2d'), rng(visual.length * 7919 + visual.charCodeAt(0)));
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      textures[visual] = t;
    }
    return textures[visual];
  };
  const decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const lit = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const mats = {
    dirt: lit('#4a3524'), stone: lit('#7c7d78'), rock: lit('#4e554c'), wood: lit('#4a2f1c'), wax: new THREE.MeshBasicMaterial({ color: '#efe6cc' }),
    flame: new THREE.MeshBasicMaterial({ color: '#ffb040' }), black: new THREE.MeshBasicMaterial({ color: '#030303' }),
  };
  for (const mat of Object.values(mats)) terrainify(mat, { instance: true });
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  let items = []; // { key, group, anim? }
  const box = (mat, w, h, d, x, y, z, ry = 0, rz = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(m(w), m(h), m(d)), mat);
    o.position.set(m(x), m(y) + m(h) / 2, m(z)); o.rotation.set(0, ry, rz);
    o.castShadow = true; o.raycast = () => {};
    return o;
  };
  // The 3D pieces a Lair adds on top of its painted ground.
  const LAIR_PROPS = {
    grave: (g) => {
      g.add(box(mats.dirt, 1.6, 0.7, 2.4, 2.2, 0, 0.2, 0.2));        // heaped earth
      g.add(box(mats.stone, 0.9, 1.1, 0.25, -1.9, 0, -1.8, 0.3, 1.2)); // toppled headstone
      g.add(box(mats.wood, 0.7, 0.12, 2.0, -0.2, 0.05, 2.3, 0.7));    // splintered coffin lid
    },
    cave: (g) => {
      const mound = new THREE.Mesh(new THREE.DodecahedronGeometry(m(2.6), 0), mats.rock);
      mound.scale.set(1.2, 0.75, 1); mound.position.set(0, m(0.6), m(-0.8)); mound.castShadow = true; mound.raycast = () => {};
      g.add(mound);
      const mouth = new THREE.Mesh(new THREE.CircleGeometry(m(1.1), 16, 0, Math.PI), mats.black);
      mouth.position.set(0, m(0.02), m(1.15)); mouth.raycast = () => {};
      g.add(mouth);
    },
    scorched: (g) => {
      for (let k = 0; k < 5; k++) g.add(box(mats.wood, 0.15, 1.6 - k * 0.2, 0.15, Math.cos(k * 1.3) * 2.2, 0, Math.sin(k * 1.3) * 2.2, 0, (k - 2) * 0.3));
    },
    ritual: (g) => {
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
        const x = Math.cos(a) * 2.4, z = Math.sin(a) * 2.4;
        g.add(box(mats.wax, 0.12, 0.35, 0.12, x, 0, z));
        const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffa040', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        f.position.set(m(x), m(0.48), m(z)); f.scale.setScalar(m(0.45)); f.raycast = () => {};
        g.add(f);
      }
    },
    ruin: (g) => {
      g.add(box(mats.stone, 1.4, 1.6, 0.5, -2.0, 0, -1.6, 0.2));
      g.add(box(mats.stone, 0.9, 0.9, 0.9, 1.8, 0, 1.4, 0.7, 0.3));
      g.add(box(mats.stone, 2.2, 0.4, 0.6, 0.6, 0, -2.4, -0.3));
    },
    room: (g) => {
      g.add(box(mats.wood, 0.6, 0.45, 0.6, -1.6, 0, 1.2, 0.4, 1.4));   // overturned chair
      g.add(box(mats.wood, 1.6, 0.08, 0.9, 1.4, 0, -1.0, -0.6, 0.5));  // tipped table top
    },
    pit: () => {},
  };

  function build(d) {
    const g = new THREE.Group();
    const lair = d.lair;
    const size = lair ? 1.25 : d.visual === 'spawn' ? 0.95 : 0.9;
    const glow = GLOWS.has(d.visual);
    const mat = new THREE.MeshBasicMaterial({
      map: texFor(d.visual), transparent: true, depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    if (!glow) mat.color.setScalar(0.75); // stains sit in the night's dimness
    terrainify(mat, { centre: true });
    const decal = new THREE.Mesh(decalGeo, mat);
    decal.scale.setScalar(size);
    decal.position.y = 0.012 + (lair ? 0.002 : 0);
    decal.renderOrder = 2;
    decal.raycast = () => {};
    g.add(decal);
    const anim = { decal, visual: d.visual, phase: (d.cell * 1.37) % 6.28 };
    if (lair) {
      LAIR_PROPS[d.visual]?.(g);
      // A lasting glow over the lair, in its colour.
      const halo = new THREE.Mesh(decalGeo, new THREE.MeshBasicMaterial({
        map: glowTex, color: LAIR_GLOW[d.visual] ?? '#ff4030', transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      terrainify(halo.material, { centre: true });
      halo.scale.setScalar(2.1);
      halo.position.y = 0.02;
      halo.renderOrder = 3;
      halo.raycast = () => {};
      g.add(halo);
      anim.halo = halo;
    }
    return { group: g, anim };
  }

  function update(list) {
    const want = new Map(list.map((d) => [`${d.cell}:${d.visual}:${d.lair ? 1 : 0}`, d]));
    items = items.filter((it) => {
      if (want.has(it.key)) return true;
      root.remove(it.group);
      return false;
    });
    const have = new Set(items.map((it) => it.key));
    for (const [key, d] of want) {
      if (have.has(key)) continue;
      const { group, anim } = build(d);
      items.push({ key, group, anim, cell: d.cell });
    }
    // Several finds on one cell sit side by side, slightly apart.
    const perCell = new Map();
    for (const it of items) {
      const n = perCell.get(it.cell) ?? 0;
      perCell.set(it.cell, n + 1);
      const p = cellToWorld(...cellXY(it.cell));
      const off = n ? [[0.18, 0.18], [-0.18, 0.18], [0.18, -0.18]][(n - 1) % 3] : [0, 0];
      it.group.position.set(p.x + off[0], cellTop(it.cell), p.z + off[1]);
      if (!it.group.parent) root.add(it.group);
    }
  }
  let cellXY = () => [0, 0];
  function setGrid(grid) { cellXY = (i) => { const c = grid.coords(i); return [c.x, c.y]; }; }

  function tick(t) {
    for (const { anim } of items) {
      const a = anim.phase + t;
      if (anim.visual === 'howl' || anim.visual === 'psychic') anim.decal.scale.setScalar(0.9 * (0.85 + 0.15 * Math.sin(a * 1.5)));
      else if (anim.visual === 'spawn') { anim.decal.material.opacity = 0.6 + 0.4 * Math.sin(a * 3); anim.decal.rotation.y = t * 0.4; }
      else if (anim.visual === 'motes' || anim.visual === 'sparks') anim.decal.material.opacity = 0.6 + 0.4 * Math.sin(a * 4.3);
      if (anim.halo) anim.halo.material.opacity = 0.42 + 0.15 * Math.sin(a * 1.2);
    }
  }
  return { update, tick, setGrid, setVisible: (v) => { root.visible = v; } };
}
