// Ready-made landmarks: blocked tiles that arrive fully dressed.
//
// - Fixed footprints (LANDMARK_SUBS[sub].footprint = [w, h]) are built once per
//   whole block of cells, facing the nearest road.
// - 'fill' landmarks (motel strip, trailer park, junkyard, clear-cut, log
//   deck, quarantine fence, fishing dock) dress every painted cell, aware of
//   their neighbours (fences run round the outside, a sign on the first cell).
//
// Everything is built in metres (m() converts to cells), low-poly with vertex
// colours, plus a few glowing bits (signs, lit windows, warning lights) that
// flicker at midnight, and small idle animations.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { m, METERS_PER_CELL } from './scale.js';
import { LANDMARK_SUBS, AREAS } from './state.js';

const CELL = METERS_PER_CELL;
const FACES = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W
const ROAD = (c) => c && (c.sub === 'street' || c.sub === 'path' || c.sub === 'start' || c.bridge);

// Flat decals (windows, posters, signs) are pulled slightly toward the camera
// when drawn, so a decal never flickers against the wall it is mounted on.
// Models also keep every decal at least ~8 cm off its wall and every trim
// strictly larger than what it wraps: no two surfaces share a plane.
const DECAL = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };

export function createLandmarks(parent, { terrainify, flickerize }) {
  const root = new THREE.Group();
  root.name = 'landmarks';
  parent.add(root);

  const solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const sheet = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  terrainify(solid, { instance: true });
  terrainify(sheet, { instance: true });
  const glowMats = {};
  const glow = (hex, flick = true) => {
    const k = `${hex}${flick}`;
    if (!glowMats[k]) {
      const mat = new THREE.MeshBasicMaterial({ color: hex, fog: false, ...DECAL });
      terrainify(mat, { instance: true });
      if (flick) flickerize(mat);
      glowMats[k] = mat;
    }
    return glowMats[k];
  };
  const spriteTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const halo = (hex, size, opacity = 0.6) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteTex, color: hex, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.scale.setScalar(m(size));
    s.raycast = () => {};
    return s;
  };
  // A sign / poster / headline drawn on a canvas, as a flat plane (metres).
  const texCache = {};
  function signTex(text, { fg = '#ffffff', bg = 'rgba(0,0,0,0)', font = '700 64px system-ui, sans-serif', w = 512, h = 128, glowCol = null } = {}) {
    const key = [text, fg, bg, font, w, h, glowCol].join('|');
    if (texCache[key]) return texCache[key];
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (glowCol) { x.shadowColor = glowCol; x.shadowBlur = 18; }
    x.fillStyle = fg;
    x.fillText(text, w / 2, h / 2 + 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    texCache[key] = t;
    return t;
  }
  function plane(tex, w, h, { lit = true, flick = false } = {}) {
    const mat = lit ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, fog: false, side: THREE.DoubleSide, ...DECAL })
      : new THREE.MeshLambertMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, ...DECAL });
    terrainify(mat, { instance: true });
    if (flick) flickerize(mat);
    const o = new THREE.Mesh(new THREE.PlaneGeometry(m(w), m(h)), mat);
    o.raycast = () => {};
    o.userData.text = true; // un-mirrored when the building is flipped
    return o;
  }

  // A bag of coloured parts in metres, merged into one mesh.
  function parts() {
    const list = [];
    const add = (geo, hex) => {
      geo = geo.index ? geo.toNonIndexed() : geo;
      if (geo.attributes.uv) geo.deleteAttribute('uv');
      const c = new THREE.Color(hex);
      const col = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      list.push(geo);
      return geo;
    };
    const place = (geo, [x, y, z], [rx, ry, rz] = [0, 0, 0]) => geo.rotateX(rx).rotateY(ry).rotateZ(rz).translate(m(x), m(y), m(z));
    const api = {
      // Box sitting on y (base at y), centred on x, z.
      box: (w, h, d, [x, y, z], hex, rot) => add(place(new THREE.BoxGeometry(m(w), m(h), m(d)).translate(0, m(h) / 2, 0), [x, y, z], rot), hex),
      cyl: (r1, r2, h, [x, y, z], hex, rot, seg = 8) => add(place(new THREE.CylinderGeometry(m(r1), m(r2), m(h), seg).translate(0, m(h) / 2, 0), [x, y, z], rot), hex),
      ball: (r, [x, y, z], hex, [sx, sy, sz] = [1, 1, 1]) => add(place(new THREE.SphereGeometry(m(r), 8, 6).scale(sx, sy, sz), [x, y, z]), hex),
      cone: (r, h, [x, y, z], hex, rot, seg = 8) => add(place(new THREE.ConeGeometry(m(r), m(h), seg).translate(0, m(h) / 2, 0), [x, y, z], rot), hex),
      // Hipped roof over a w x d footprint starting at height y.
      roof: (w, d, h, [x, y, z], hex) => add(new THREE.ConeGeometry(Math.SQRT1_2 * m(Math.max(w, d)), m(h), 4).rotateY(Math.PI / 4)
        .scale(w >= d ? 1 : w / d, 1, w >= d ? d / w : 1).translate(m(x), m(y + h / 2), m(z)), hex),
      // Gable roof along x (ridge parallel to x).
      gable: (w, d, h, [x, y, z], hex) => {
        const sh = new THREE.Shape([new THREE.Vector2(-m(d / 2), 0), new THREE.Vector2(m(d / 2), 0), new THREE.Vector2(0, m(h))]);
        const g = new THREE.ExtrudeGeometry(sh, { depth: m(w), bevelEnabled: false }).translate(0, 0, -m(w) / 2).rotateY(Math.PI / 2);
        return add(g.translate(m(x), m(y), m(z)), hex);
      },
      // The top half of a cylinder lying along x, flat side down at y (railcar roofs).
      halfBarrel: (r, len, [x, y, z], hex) => add(new THREE.CylinderGeometry(m(r), m(r), m(len), 14, 1, false, Math.PI, Math.PI)
        .rotateZ(-Math.PI / 2).translate(m(x), m(y), m(z)), hex),
      // A beam from a to b (metres).
      beam: (a, b, r, hex) => {
        const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
        const g = new THREE.CylinderGeometry(m(r), m(r), m(A.distanceTo(B)), 6);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
        const mid = A.add(B).multiplyScalar(0.5);
        return add(g.translate(m(mid.x), m(mid.y), m(mid.z)), hex);
      },
      mesh: (mat = solid) => {
        if (!list.length) return new THREE.Group();
        const o = new THREE.Mesh(mergeGeometries(list), mat);
        o.castShadow = o.receiveShadow = mat === solid;
        o.raycast = () => {};
        return o;
      },
    };
    return api;
  }
  // A glowing panel (window, sign face) in metres; `face` 'z' faces +z, 'x' faces +x.
  function lightPanel(w, h, [x, y, z], hex, { face = 'z', flick = true } = {}) {
    const g = face === 'z' ? new THREE.PlaneGeometry(m(w), m(h)) : new THREE.PlaneGeometry(m(w), m(h)).rotateY(Math.PI / 2);
    const o = new THREE.Mesh(g, glow(hex, flick));
    o.position.set(m(x), m(y), m(z));
    o.raycast = () => {};
    return o;
  }
  const rng = (seed) => { let s = (seed * 2654435761) >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296); };

  // A 90s car body (metres, along x), used by several landmarks.
  function car(p, [x, y, z], hex, rot = [0, 0, 0]) {
    const q = new THREE.Group();
    void q;
    const pp = parts();
    pp.box(4.4, 0.8, 1.8, [0, 0.35, 0], hex);
    pp.box(2.4, 0.65, 1.7, [-0.2, 1.15, 0], hex);
    pp.box(2.3, 0.5, 1.82, [-0.2, 1.2, 0], '#1c2328');
    for (const [wx, wz] of [[1.4, 0.9], [1.4, -0.9], [-1.4, 0.9], [-1.4, -0.9]]) pp.cyl(0.36, 0.36, 0.26, [wx, 0.36, wz - (wz > 0 ? 0.13 : -0.13) * 0], '#141414', [Math.PI / 2, 0, 0], 10);
    const mesh = pp.mesh();
    mesh.position.set(m(x), m(y), m(z));
    mesh.rotation.set(...rot);
    return mesh;
  }

  // --- the fixed-footprint landmarks: build(w, d) in metres, front at +z ---------------
  const B = {};
  const lot = (p, w, d, hex = '#2a2c2e') => p.box(w, 0.15, d, [0, 0, 0], hex);

  B.videoStore = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d);
    const bw = w * 0.78, bd = d * 0.6, bz = -d * 0.12;
    p.box(bw, 4.2, bd, [0, 0, bz], '#5a4a5e');
    p.box(bw + 0.3, 0.9, bd + 0.3, [0, 4.2, bz], '#3a2e3e');               // parapet
    p.box(bw * 0.9, 0.08, 0.1, [0, 2.6, bz + bd / 2 + 0.05], '#20181f');
    p.box(0.8, 0.5, 0.4, [bw * 0.38, 0.9, bz + bd / 2 + 0.2], '#30302e');    // returns slot
    g.add(p.mesh());
    g.add(lightPanel(bw * 0.8, 2.2, [0, 1.4, bz + bd / 2 + 0.08], '#1c2440'));   // dark glass
    const posters = ['#d04040', '#40a0d0', '#e0c040', '#60c060'];
    posters.forEach((c, k) => g.add(lightPanel(0.9, 1.3, [-bw * 0.32 + k * 1.3, 1.5, bz + bd / 2 + 0.16], c, { flick: false })));
    const stat = lightPanel(1.2, 0.9, [bw * 0.25, 1.4, bz + bd / 2 + 0.16], '#c8c8d0');
    g.add(stat);
    const sign = plane(signTex('VIDEO', { fg: '#ff4fd0', glowCol: '#ff4fd0', font: '800 92px system-ui' }), bw * 0.7, 1.6, { flick: true });
    sign.position.set(0, m(5.2), m(bz + bd / 2 + 0.25));
    const sh = halo('#ff40c0', 7, 0.35);
    sh.position.set(0, m(5.2), m(bz + bd / 2 + 0.8));
    g.add(sign, sh);
    ticks.push((t) => { stat.visible = Math.sin(t * 9) > -0.3; stat.material.color.setScalar(0.5 + 0.5 * Math.random()); sign.material.opacity = Math.sin(t * 13) > 0.92 ? 0.3 : 1; });
    return { g, ticks };
  };

  B.diner = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d);
    const bw = w * 0.82, bd = d * 0.45;
    p.box(bw, 3.2, bd, [0, 0.5, 0], '#b8bcc0');                          // railcar body
    p.box(bw + 0.12, 0.35, bd + 0.16, [0, 1.4, 0], '#a02020');            // red stripe, wrapping the body
    p.halfBarrel(bd / 2 + 0.15, bw + 0.2, [0, 3.7, 0], '#9aa0a4');  // barrel roof sitting on top, slight overhang
    p.box(bw - 0.4, 0.5, bd - 0.4, [0, 0, 0], '#4a4c4e');                  // skirt, tucked under
    p.box(2.2, 0.3, 1.6, [bw * 0.3, 0, bd / 2 + 0.8], '#6a6a66');          // steps
    g.add(p.mesh());
    for (let k = 0; k < 6; k++) g.add(lightPanel(1.4, 1.1, [-bw / 2 + 1.6 + k * (bw - 3) / 5, 2.4, bd / 2 + 0.09], k === 4 ? '#ffd890' : '#1a2228', { flick: k === 4 }));
    const sign = plane(signTex('DINER', { fg: '#40e0ff', glowCol: '#40e0ff', font: '800 96px Georgia, serif' }), 5, 1.4, { flick: true });
    sign.position.set(-bw * 0.2, m(4.9), m(0.2));
    const closed = plane(signTex('CLOSED', { fg: '#ff4040', bg: '#200a0a', font: '800 60px system-ui', w: 256, h: 96 }), 1.2, 0.45);
    closed.position.set(bw * 0.3, m(2.3), m(bd / 2 + 0.16));
    g.add(sign, closed);
    ticks.push((t) => { sign.material.opacity = Math.sin(t * 2.3) > 0.97 ? 0.15 : 1; });
    return { g, ticks };
  };

  B.gasStation = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d, '#28292b');
    const cw = w * 0.55, cd = d * 0.42, cz = d * 0.12;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.box(0.35, 4.6, 0.35, [sx * cw * 0.4, 0, cz + sz * cd * 0.35], '#d0d0cc');
    p.box(cw, 0.7, cd, [0, 4.6, cz], '#d8d8d2');                          // canopy
    p.box(cw + 0.2, 0.35, cd + 0.2, [0, 4.9, cz], '#c03028');              // canopy stripe
    for (const sx of [-1, 1]) { p.box(0.9, 1.7, 0.6, [sx * cw * 0.18, 0, cz], '#c8c0a8'); p.box(0.7, 0.4, 0.72, [sx * cw * 0.18, 1.2, cz], '#20201e'); }
    p.box(w * 0.3, 3.2, d * 0.22, [-w * 0.18, 0, -d * 0.33], '#8a8070');  // kiosk
    p.box(1.2, 1.6, 0.9, [w * 0.1, 0, -d * 0.36], '#d8dce0');             // ice machine
    p.box(0.15, 2, 0.15, [w * 0.3, 0, -d * 0.2], '#4a4c4e');               // payphone post
    p.box(0.6, 0.8, 0.4, [w * 0.3, 1.4, -d * 0.2], '#3a5aa0');
    p.box(0.12, 0.3, 0.1, [w * 0.3 + 0.3, 0.6, -d * 0.2 + 0.25], '#101010');  // hanging handset
    p.box(0.2, 6, 0.2, [w * 0.4, 0, d * 0.42], '#4a4c4e');                 // price sign pole
    p.box(2.2, 1.6, 0.25, [w * 0.4, 6, d * 0.42], '#e8e4d8');
    g.add(p.mesh());
    const under = lightPanel(cw * 0.9, cd * 0.9, [0, 4.52, cz], '#e8f0ff');
    under.rotation.x = Math.PI / 2;
    const kiosk = lightPanel(w * 0.2, 1.6, [-w * 0.18, 1.6, -d * 0.33 + d * 0.11 + 0.09], '#f0e8c0');
    const price = plane(signTex('1.19⁹', { fg: '#101010', bg: '#e8e4d8', font: '800 80px system-ui', w: 256, h: 128 }), 2, 1.2, { lit: false });
    price.position.set(m(w * 0.4), m(6.8), m(d * 0.42 + 0.22));
    g.add(under, kiosk, price);
    ticks.push((t) => { under.material.color.setScalar(Math.sin(t * 40) > 0.85 && Math.sin(t * 1.7) > 0.6 ? 0.4 : 1); });
    return { g, ticks };
  };

  B.laundromat = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d);
    const bw = w * 0.85, bd = d * 0.7;
    p.box(bw, 3.6, bd, [0, 0, -d * 0.05], '#7a7a70');
    p.box(bw + 0.2, 0.5, bd + 0.2, [0, 3.6, -d * 0.05], '#4a4a44');
    for (let k = 0; k < 5; k++) p.box(0.9, 1.0, 0.8, [-bw / 2 + 1.2 + k * (bw - 2.4) / 4, 0, -d * 0.05 + bd / 2 - 1.2], '#e0e0dc');
    g.add(p.mesh());
    const front = lightPanel(bw * 0.85, 2.2, [0, 1.6, -d * 0.05 + bd / 2 + 0.08], '#d8f0e0');
    front.material = front.material.clone();
    front.material.transparent = true; front.material.opacity = 0.45;
    g.add(front);
    const drum = new THREE.Mesh(new THREE.CircleGeometry(m(0.35), 10), glow('#9ab0c0', false));
    drum.position.set(m(-bw / 2 + 1.2 + 2 * (bw - 2.4) / 4), m(0.55), m(-d * 0.05 + bd / 2 - 0.74));
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(m(0.5), m(0.1)), glow('#303840', false));
    slot.position.z = m(0.04);
    drum.add(slot);
    g.add(drum);
    const sign = plane(signTex('LAUNDROMAT', { fg: '#e8ffe8', glowCol: '#80ff90', font: '700 70px system-ui' }), bw * 0.6, 0.8, { flick: true });
    sign.position.set(0, m(3.0), m(-d * 0.05 + bd / 2 + 0.16));
    g.add(sign);
    ticks.push((t) => { slot.rotation.z = t * 4; front.material.opacity = Math.sin(t * 50) > 0.9 ? 0.2 : 0.45; });
    return { g, ticks };
  };

  B.arcade = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d);
    const bw = w * 0.8, bd = d * 0.62, bz = -d * 0.1;
    p.box(bw, 5, bd, [0, 0, bz], '#2a2630');
    p.box(bw * 0.9, 2.6, 0.1, [0, 0.6, bz + bd / 2 + 0.05], '#08080a');    // blacked-out windows
    g.add(p.mesh());
    const door = lightPanel(1.6, 2.2, [bw * 0.3, 1.1, bz + bd / 2 + 0.18], '#ff40ff');
    door.material = door.material.clone();
    const sign = plane(signTex('ARCADE', { fg: '#ffe040', glowCol: '#ff8020', font: '900 96px system-ui' }), bw * 0.6, 1.4, { flick: true });
    sign.position.set(0, m(4.0), m(bz + bd / 2 + 0.12));
    const over = plane(signTex('GAME OVER', { fg: '#ff3030', glowCol: '#ff3030', font: '800 64px monospace' }), 3, 0.6);
    over.position.set(-bw * 0.25, m(2), m(bz + bd / 2 + 0.18));
    g.add(door, sign, over);
    ticks.push((t) => { door.material.color.setHSL((t * 0.15) % 1, 0.9, 0.55); over.visible = Math.sin(t * 3) > 0; });
    return { g, ticks };
  };

  B.payphone = (w, d) => {
    const p = parts(), g = new THREE.Group();
    p.box(w * 0.7, 0.12, d * 0.5, [0, 0, 0], '#5a5c5e');                   // slab
    p.box(0.15, 2.2, 0.15, [-1, 0, 0], '#4a4c4e');
    p.box(0.7, 0.9, 0.45, [-1, 1.3, 0.1], '#3a5aa0');
    p.box(0.12, 0.3, 0.1, [-0.75, 0.55, 0.45], '#101010');                  // dangling handset
    p.beam([-0.75, 1.3, 0.35], [-0.75, 0.7, 0.45], 0.02, '#202020');        // cord
    for (const [x, c] of [[0.5, '#c02020'], [1.2, '#2050a0'], [1.9, '#d0b020']]) p.box(0.55, 1.1, 0.5, [x, 0, 0.05], c);
    g.add(p.mesh());
    const head = plane(signTex('LOCAL TEEN STILL MISSING', { fg: '#101010', bg: '#e8e4d8', font: '800 34px Georgia, serif', w: 512, h: 96 }), 0.48, 0.12, { lit: false });
    head.position.set(m(0.5), m(0.95), m(0.37));
    g.add(head);
    return { g, ticks: [] };
  };

  B.lumberMill = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d, '#3a3126');
    const sw = w * 0.55, sd = d * 0.45;
    for (let k = 0; k < 9; k++) p.box(sw / 9, 7, sd, [-w * 0.18 - sw / 2 + (k + 0.5) * sw / 9, 0, -d * 0.18], k % 2 ? '#6a6e70' : '#5a5e60'); // corrugated shed
    p.gable(sw, sd, 2.5, [-w * 0.18, 7, -d * 0.18], '#4a3a30');
    p.box(w * 0.28, 4.5, d * 0.3, [w * 0.3, 0, -d * 0.3], '#5e5444');
    p.box(1.2, 0.4, 9, [w * 0.12, 3, d * 0.05], '#4a4440', [0.35, 0, 0]);  // conveyor
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6 - r; k++) p.cyl(0.45, 0.45, 8, [-w * 0.15 - 3 + k * 0.95 + r * 0.47, 0.45 + r * 0.82, d * 0.3], k % 2 ? '#6a4a2c' : '#7a5634', [0, 0, Math.PI / 2], 8);
    p.cyl(1.6, 1.6, 0.15, [w * 0.33, 1.7, d * 0.15], '#7a3a1c', [Math.PI / 2, 0, 0], 16); // rusted saw blade
    p.cyl(0.8, 0.9, 14, [w * 0.35, 0, -d * 0.38], '#4a3e34');               // stack
    g.add(p.mesh());
    g.add(lightPanel(2.2, 1.2, [-w * 0.18, 3.5, -d * 0.18 + sd / 2 + 0.1], '#e0c080'));
    const steam = [0, 1, 2].map((k) => { const s = halo('#9a9aa0', 5, 0.35); s.material = s.material.clone(); s.material.blending = THREE.NormalBlending; g.add(s); return s; });
    ticks.push((t) => steam.forEach((s, k) => { const ph = (t * 0.25 + k / 3) % 1; s.position.set(m(w * 0.35 + ph * 3), m(14 + ph * 8), m(-d * 0.38)); s.scale.setScalar(m(3 + ph * 6)); s.material.opacity = 0.4 * (1 - ph); }));
    return { g, ticks };
  };

  B.lookout = (w, d) => {
    const p = parts(), g = new THREE.Group();
    const H = 15, a = 2.6, top = 1.6;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.beam([sx * a, 0, sz * a], [sx * top, H, sz * top], 0.16, '#5a4632');
    for (let k = 1; k < 4; k++) {
      const y = (H * k) / 4, r = a - (a - top) * (k / 4);
      for (const [x1, z1, x2, z2] of [[-r, -r, r, r], [r, -r, -r, r]]) p.beam([x1, y - 3.7, z1], [x2, y, z2], 0.06, '#4a3a28');
      p.box(r * 2, 0.12, 0.12, [0, y, r], '#4a3a28'); p.box(r * 2, 0.12, 0.12, [0, y, -r], '#4a3a28');
    }
    p.box(4, 0.3, 4, [0, H, 0], '#5a4632');
    p.box(3.6, 2.4, 3.6, [0, H + 0.3, 0], '#7a6a50');
    p.roof(4.4, 4.4, 1.6, [0, H + 2.7, 0], '#2c2a26');
    p.beam([1.6, 0.2, 2.4], [1.6, H, 1.8], 0.05, '#3a2e22');                  // stair stringer
    g.add(p.mesh());
    g.add(lightPanel(1.2, 0.8, [0, H + 1.7, 1.9], '#ffd080'));
    return { g, ticks: [] };
  };

  B.grange = (w, d) => {
    const p = parts(), g = new THREE.Group();
    lot(p, w, d, '#33402f');
    const bw = w * 0.8, bd = d * 0.55;
    p.box(bw, 4, bd, [0, 0.4, -d * 0.05], '#dcdad0');
    for (let k = 0; k < 14; k++) p.box(bw + 0.12, 0.05, bd + 0.12, [0, 0.6 + k * 0.27, -d * 0.05], '#b8b6ac');
    p.gable(bw + 0.6, bd + 0.6, 3, [0, 4.4, -d * 0.05], '#3a3a40');
    p.box(2.4, 0.4, 1.6, [0, 0, -d * 0.05 + bd / 2 + 0.6], '#8a8a84');       // steps
    p.box(1.6, 2.6, 0.14, [0, 0.4, -d * 0.05 + bd / 2 + 0.07], '#5a2a1c');    // door
    p.box(2.4, 1.6, 0.14, [-bw * 0.3, 1.2, -d * 0.05 + bd / 2 + 0.11], '#5a4632'); // bulletin board
    g.add(p.mesh());
    const flyers = document.createElement('canvas');
    flyers.width = 256; flyers.height = 160;
    const fx = flyers.getContext('2d');
    fx.fillStyle = '#5a4632'; fx.fillRect(0, 0, 256, 160);
    for (let k = 0; k < 7; k++) {
      const x = 10 + (k % 4) * 60 + (k * 13) % 9, y = 10 + Math.floor(k / 4) * 76;
      fx.fillStyle = '#ece6d4'; fx.fillRect(x, y, 52, 66);
      fx.fillStyle = '#101010'; fx.font = '700 12px system-ui'; fx.fillText('MISSING', x + 3, y + 14);
      fx.fillStyle = '#7a7a70'; fx.fillRect(x + 12, y + 20, 28, 28);
    }
    const t = new THREE.CanvasTexture(flyers); t.colorSpace = THREE.SRGBColorSpace;
    const board = plane(t, 2.2, 1.4, { lit: false });
    board.position.set(m(-bw * 0.3), m(2.0), m(-d * 0.05 + bd / 2 + 0.24));
    g.add(board);
    g.add(lightPanel(0.3, 0.3, [1.2, 3.4, -d * 0.05 + bd / 2 + 0.14], '#ffc070'));
    return { g, ticks: [] };
  };

  B.cairn = (w, d) => {
    const p = parts(), g = new THREE.Group();
    const r = rng(7);
    for (const [cx, cz, n] of [[-1.2, 0.4, 6], [1.1, -0.8, 4], [0.3, 1.5, 3]]) {
      let y = 0;
      for (let k = 0; k < n; k++) { const s = 0.5 - k * 0.06; p.ball(s, [cx + (r() - 0.5) * 0.1, y + s * 0.6, cz], k % 2 ? '#8a8a84' : '#6e6e6a', [1.2, 0.6, 1]); y += s * 1.1; }
    }
    for (let k = 0; k < 5; k++) { const a = k * 1.25; p.beam([Math.cos(a) * 1.8, 0, Math.sin(a) * 1.8], [Math.cos(a) * 0.4, 3.2 + r() * 0.8, Math.sin(a) * 0.4], 0.1, '#c8bca4'); }
    g.add(p.mesh());
    return { g, ticks: [] };
  };

  // Tall cedars, ferns and a mossy nurse log.
  B.cedarGrove = (w, d) => {
    const p = parts(), g = new THREE.Group(), r = rng(31);
    for (let k = 0; k < 6; k++) {
      const x = (r() - 0.5) * w * 0.8, z = (r() - 0.5) * d * 0.8, h = 15 + r() * 7;
      p.cyl(0.9, 1.3, h * 0.5, [x, 0, z], '#4a3426', [0, 0, 0], 8);
      for (let t = 0; t < 4; t++) p.cone(3.4 - t * 0.7, 4.5, [x, h * 0.3 + t * h * 0.15, z], t % 2 ? '#1a3322' : '#16301e', [0, 0, 0], 8);
    }
    for (let k = 0; k < 18; k++) p.cone(0.8, 0.9, [(r() - 0.5) * w * 0.9, 0, (r() - 0.5) * d * 0.9], '#2a5a32', [0, 0, 0], 6);
    p.cyl(0.8, 0.8, 9, [-3, 0.8, 2], '#3a4a2a', [0, 0.6, Math.PI / 2], 8);   // mossy nurse log
    for (let k = 0; k < 4; k++) p.cone(0.25, 1.6, [-5 + k * 2.2, 1.4, 2 + k * 0.9], '#24402a');
    g.add(p.mesh());
    return { g, ticks: [] };
  };

  B.rectory = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d, '#2e2f2a');
    const bw = w * 0.62, bd = d * 0.55;
    p.box(bw, 5, bd, [0, 0.3, -d * 0.08], '#8a8476');
    p.gable(bw + 0.6, bd + 0.6, 3.2, [0, 5.3, -d * 0.08], '#2a2624');
    for (const x of [-bw * 0.3, bw * 0.3]) for (const y of [1.2, 3.4]) {
      p.box(1.2, 1.3, 0.06, [x, y, -d * 0.08 + bd / 2 + 0.03], '#151515');
      p.box(1.4, 0.16, 0.1, [x, y + 0.4, -d * 0.08 + bd / 2 + 0.08], '#8a7a5a', [0, 0, 0.3]);
      p.box(1.4, 0.16, 0.1, [x, y + 0.8, -d * 0.08 + bd / 2 + 0.08], '#8a7a5a', [0, 0, -0.25]);
    }
    p.box(1.8, 6, 1.8, [bw * 0.38, 0, -d * 0.08 - bd * 0.1], '#7a7468', [0, 0, -0.08]);   // crooked steeple
    p.cone(1.5, 4, [bw * 0.38 + 0.5, 6.1, -d * 0.08 - bd * 0.1], '#2a2624', [0, 0, -0.12], 4);
    g.add(p.mesh());
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(m(0.03), m(0.03), m(3.5), 5).translate(0, -m(1.75), 0), solid);
    rope.position.set(m(bw * 0.38 - 0.4), m(5.6), m(-d * 0.08 - bd * 0.1 + 0.95));
    g.add(rope);
    ticks.push((t) => { rope.rotation.z = 0.08 * Math.sin(t * 0.9); });
    return { g, ticks };
  };

  B.burnedHouse = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d, '#1e1b18');
    const bw = w * 0.55, bd = d * 0.5, bx = -w * 0.12;
    p.box(bw, 0.6, bd, [bx, 0, -d * 0.1], '#3a3530');                     // foundation
    for (const [x, z, h] of [[-1, -1, 3.2], [1, -1, 1.8], [-1, 1, 2.4], [1, 1, 0.9], [0, -1, 2.6]]) p.box(0.25, h, 0.25, [bx + x * bw * 0.45, 0.6, -d * 0.1 + z * bd * 0.45], '#111010');
    p.beam([bx - bw * 0.45, 3.6, -d * 0.1 - bd * 0.45], [bx + bw * 0.1, 1.2, -d * 0.1], 0.12, '#141210');
    p.box(1.4, 8, 1.2, [bx + bw * 0.35, 0, -d * 0.1 - bd * 0.3], '#6a3a2a'); // chimney
    // Swing set beside it.
    const sx = w * 0.32, sz = d * 0.15;
    p.beam([sx - 1.6, 0, sz - 0.8], [sx - 1.6, 2.6, sz], 0.06, '#6a6a68'); p.beam([sx - 1.6, 0, sz + 0.8], [sx - 1.6, 2.6, sz], 0.06, '#6a6a68');
    p.beam([sx + 1.6, 0, sz - 0.8], [sx + 1.6, 2.6, sz], 0.06, '#6a6a68'); p.beam([sx + 1.6, 0, sz + 0.8], [sx + 1.6, 2.6, sz], 0.06, '#6a6a68');
    p.box(3.4, 0.08, 0.08, [sx, 2.6, sz], '#6a6a68');
    g.add(p.mesh());
    const swing = new THREE.Group();
    const sp = parts(); sp.beam([-0.3, 0, 0], [-0.3, -1.9, 0], 0.015, '#3a3a38'); sp.beam([0.3, 0, 0], [0.3, -1.9, 0], 0.015, '#3a3a38'); sp.box(0.7, 0.06, 0.3, [0, -1.95, 0], '#2a2a28');
    swing.add(sp.mesh()); swing.position.set(m(sx - 0.6), m(2.6), m(sz)); g.add(swing);
    ticks.push((t) => { swing.rotation.x = 0.25 * Math.sin(t * 1.4); });
    return { g, ticks };
  };

  B.schoolBus = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    // The footprint's long side is the frontage: the bus lies along x, on its side.
    p.box(w * 0.9, 0.15, d * 0.9, [0, 0, 0], '#33362f');
    const L = Math.min(11, w * 0.8);
    p.box(L, 2.5, 3.0, [0, 0, 0], '#e0a818');                              // body, on its side (height = width)
    p.box(L + 0.12, 0.25, 3.12, [0, 1.1, 0], '#1a1a1a');                   // black stripe, wrapping the body
    for (let k = 0; k < 8; k++) p.box(0.9, 0.08, 1.4, [-L / 2 + 1 + k * 1.2, 2.5, 0.4], '#5a6468'); // fogged windows (facing up)
    for (const x of [-L * 0.35, L * 0.35]) p.cyl(0.55, 0.55, 0.35, [x, 0.6, -1.6], '#141414', [Math.PI / 2, 0, 0], 10);
    g.add(p.mesh());
    const hz = new THREE.Mesh(new THREE.SphereGeometry(m(0.18), 8, 6), glow('#ff9a20', false));
    hz.position.set(m(L / 2 + 0.05), m(2.0), m(1.2));
    const hh = halo('#ff9a20', 2.5, 0.7); hh.position.copy(hz.position);
    g.add(hz, hh);
    ticks.push((t) => { const on = Math.sin(t * 5.5) > 0; hz.visible = hh.visible = on; });
    return { g, ticks };
  };

  B.wreckedCar = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    p.box(w * 0.8, 0.1, d * 0.5, [0, -0.2, 0], '#24291f');                // ditch
    g.add(p.mesh());
    const c = car(p, [0, -0.1, 0], '#6a2a24', [0, 0.4, 0.22]);
    g.add(c);
    const door = new THREE.Mesh(new THREE.BoxGeometry(m(1.1), m(0.9), m(0.06)), solid);
    door.position.set(m(-0.4), m(0.9), m(1.3));
    door.rotation.y = 0.9;
    g.add(door);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#ffe0a0', transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    terrainify(beamMat, { instance: true });
    flickerize(beamMat);
    for (const s of [-0.6, 0.6]) {
      // Headlights still on: a faint cone from each lamp, along the ground.
      const b = new THREE.Mesh(new THREE.ConeGeometry(m(0.9), m(4.5), 10, 1, true).rotateZ(Math.PI / 2).translate(m(2.25), 0, 0), beamMat);
      b.position.set(m(2.2), m(0.6), m(s));
      b.rotation.z = -0.06;
      b.raycast = () => {};
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(m(0.12), 6, 4), glow('#fff0c0'));
      lamp.position.set(m(2.22), m(0.6), m(s));
      c.add(b, lamp);
    }
    return { g, ticks };
  };

  B.playground = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    lot(p, w, d, '#4a3f30');
    p.box(3, 0.3, 3, [w * 0.25, 0, -d * 0.25], '#c8b080');                 // sandbox
    p.beam([-w * 0.3, 0, d * 0.25], [-w * 0.3 + 3, 2.2, d * 0.25], 0.25, '#a0a4a8');  // slide
    p.box(0.8, 2.4, 0.8, [-w * 0.3 + 3.3, 0, d * 0.25], '#c04030');
    const sx = w * 0.25, sz = d * 0.25;
    for (const ex of [-1.6, 1.6]) { p.beam([sx + ex, 0, sz - 0.8], [sx + ex, 2.6, sz], 0.06, '#6a7a8a'); p.beam([sx + ex, 0, sz + 0.8], [sx + ex, 2.6, sz], 0.06, '#6a7a8a'); }
    p.box(3.4, 0.08, 0.08, [sx, 2.6, sz], '#6a7a8a');
    g.add(p.mesh());
    const mg = new THREE.Group();
    const mp = parts(); mp.cyl(1.6, 1.6, 0.15, [0, 0.4, 0], '#3a6aa0', [0, 0, 0], 16);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; mp.beam([Math.cos(a) * 1.4, 0.55, Math.sin(a) * 1.4], [Math.cos(a) * 0.2, 1.4, Math.sin(a) * 0.2], 0.04, '#d0c040'); }
    mg.add(mp.mesh()); mg.position.set(m(-w * 0.2), 0, m(-d * 0.2)); g.add(mg);
    const swing = new THREE.Group();
    const sp = parts(); sp.beam([-0.3, 0, 0], [-0.3, -1.9, 0], 0.015, '#3a3a38'); sp.beam([0.3, 0, 0], [0.3, -1.9, 0], 0.015, '#3a3a38'); sp.box(0.7, 0.06, 0.3, [0, -1.95, 0], '#2a2a28');
    swing.add(sp.mesh()); swing.position.set(m(sx + 0.7), m(2.6), m(sz)); g.add(swing);
    ticks.push((t) => { mg.rotation.y = t * 0.35; swing.rotation.x = 0.3 * Math.sin(t * 1.25); });
    return { g, ticks };
  };

  B.radioTower = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    p.box(3, 0.5, 3, [0, 0, 0], '#6a6a66');
    const H = 40, r0 = 1.2, r1 = 0.3;
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; p.beam([Math.cos(a) * r0, 0.5, Math.sin(a) * r0], [Math.cos(a) * r1, H, Math.sin(a) * r1], 0.07, k % 2 ? '#c04030' : '#d8d8d0'); }
    for (let y = 2; y < H; y += 2.5) {
      const r = r0 - (r0 - r1) * (y / H);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2, b = ((k + 1) / 3) * Math.PI * 2; p.beam([Math.cos(a) * r, y, Math.sin(a) * r], [Math.cos(b) * r, y + 2.5, Math.sin(b) * r], 0.025, '#9a9a94'); }
    }
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.5; p.beam([Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2], [0, H * 0.6, 0], 0.02, '#5a5a58'); }  // guy wires
    g.add(p.mesh());
    const light = new THREE.Mesh(new THREE.SphereGeometry(m(0.35), 8, 6), glow('#ff2020', false));
    light.position.y = m(H + 0.3);
    const lh = halo('#ff2020', 6, 0.8); lh.position.copy(light.position);
    g.add(light, lh);
    ticks.push((t) => { const beat = Math.floor(t / 1.5); const skip = (beat * 7) % 11 === 0; const on = !skip && (t % 1.5) < 0.5; light.visible = lh.visible = on; });
    return { g, ticks };
  };

  B.memorial = (w, d) => {
    const p = parts(), g = new THREE.Group(), ticks = [];
    p.box(0.1, 1.4, 0.1, [0, 0, -0.4], '#5a4632');                         // post
    p.box(0.6, 0.75, 0.05, [0, 1.0, -0.33], '#e8e4d8');                    // photo
    p.box(0.45, 0.5, 0.06, [0, 1.1, -0.3], '#6a6460');
    p.box(0.08, 0.5, 0.04, [0.15, 1.35, -0.22], '#e0d040', [0, 0, 0.6]);    // ribbon
    p.ball(0.25, [0.6, 0.25, 0.2], '#8a5a3a', [1, 1.1, 0.9]);               // teddy bear
    p.ball(0.16, [0.6, 0.6, 0.22], '#8a5a3a');
    p.box(1.6, 0.12, 0.4, [0, 0, 0.2], '#3a2a1a');
    for (let k = 0; k < 6; k++) p.cyl(0.05, 0.05, 0.18, [-0.6 + k * 0.24, 0, 0.3 + (k % 2) * 0.15], '#e8e0c8');
    g.add(p.mesh());
    const flames = [];
    for (let k = 0; k < 6; k++) { const f = halo('#ffb040', 0.6, 0.9); f.position.set(m(-0.6 + k * 0.24), m(0.25), m(0.3 + (k % 2) * 0.15)); g.add(f); flames.push(f); }
    ticks.push((t) => flames.forEach((f, k) => f.scale.setScalar(m(0.45 + 0.15 * Math.sin(t * 9 + k * 2)))));
    return { g, ticks };
  };

  B.farm = (w, d) => {
    const p = parts(), g = new THREE.Group();
    lot(p, w, d, '#3a3a26');
    // Barn (sagging roof), farmhouse, rusted tractor.
    p.box(9, 6, 11, [-w * 0.2, 0, -d * 0.15], '#7a2a20');
    p.gable(9.6, 11.6, 4, [-w * 0.2, 6, -d * 0.15], '#3a3430');
    p.box(3.6, 4.4, 0.1, [-w * 0.2, 0, -d * 0.15 + 5.55], '#5a1c16');
    p.box(8, 3.4, 6, [w * 0.22, 0, d * 0.12], '#bcb4a0');
    p.roof(8.6, 6.6, 2.4, [w * 0.22, 3.4, d * 0.12], '#2a2826');
    p.box(8, 0.2, 2, [w * 0.22, 2.6, d * 0.12 + 4], '#5a5048');            // porch roof
    for (const x of [-3.6, 3.6]) p.box(0.15, 2.6, 0.15, [w * 0.22 + x, 0, d * 0.12 + 4.8], '#8a8070');
    p.box(2.6, 1.4, 1.6, [w * 0.1, 0.5, -d * 0.32], '#6a3a1c');           // tractor
    p.cyl(0.9, 0.9, 0.5, [w * 0.1 - 1, 0.9, -d * 0.32 + 0.9], '#1a1a1a', [Math.PI / 2, 0, 0], 10);
    p.cyl(0.9, 0.9, 0.5, [w * 0.1 - 1, 0.9, -d * 0.32 - 0.9 - 0.5], '#1a1a1a', [Math.PI / 2, 0, 0], 10);
    g.add(p.mesh());
    const porch = new THREE.Mesh(new THREE.SphereGeometry(m(0.15), 8, 6), glow('#ffd080'));
    porch.position.set(m(w * 0.22 + 1.2), m(2.4), m(d * 0.12 + 3.2));
    const ph = halo('#ffc060', 3.5, 0.7); ph.position.copy(porch.position);
    g.add(porch, ph, lightPanel(1.2, 1, [w * 0.22 - 2, 1.8, d * 0.12 + 3.09], '#ffcf80'));
    return { g, ticks: [] };
  };

  B.waterTower = (w, d) => {
    const p = parts(), g = new THREE.Group();
    const H = 14, r = 4;
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; p.beam([Math.cos(a) * r * 1.1, 0, Math.sin(a) * r * 1.1], [Math.cos(a) * r * 0.8, H, Math.sin(a) * r * 0.8], 0.25, '#6a6c68'); }
    for (const y of [4, 9]) for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4, b = a + Math.PI / 2; const rr = r * (1.1 - 0.3 * y / H); p.beam([Math.cos(a) * rr, y, Math.sin(a) * rr], [Math.cos(b) * rr, y, Math.sin(b) * rr], 0.08, '#5a5c58'); }
    p.cyl(r, r, 6, [0, H, 0], '#8a9a98', [0, 0, 0], 18);
    p.cone(r * 1.05, 2.2, [0, H + 6, 0], '#5a6a68', [0, 0, 0], 18);
    p.box(0.1, H + 6, 0.1, [r + 0.2, 0, 0], '#3a3a38');                      // ladder
    g.add(p.mesh());
    const name = plane(signTex('HAWTHORN BEND', { fg: '#1a2a2a', font: '900 58px Georgia, serif', w: 512, h: 128 }), 5.8, 1.45, { lit: false });
    name.position.set(0, m(H + 3.4), m(r + 0.12));
    const scrawl = plane(signTex('SHE SEES YOU', { fg: '#8a0a0a', font: 'italic 700 46px Georgia, serif', w: 512, h: 96 }), 4, 0.8, { lit: false });
    scrawl.position.set(m(1.2), m(H + 5.3), m(r - 0.1));
    scrawl.rotation.set(0, 0.25, 0.08);
    g.add(name, scrawl);
    return { g, ticks: [] };
  };

  // --- 'fill' landmarks: one cell (7 m), knowing its neighbours ---------------------------
  // ctx: { n, e, s, w (same-landmark neighbours), first (first cell of its area), face (0..3), rnd }
  const F = {};
  const fence = (p, ctx, hex = '#8a8e90', h = 2.2) => {
    const H = CELL / 2 - 0.2;
    const sides = [[!ctx.n, [0, -H], 0], [!ctx.s, [0, H], 0], [!ctx.w, [-H, 0], Math.PI / 2], [!ctx.e, [H, 0], Math.PI / 2]];
    for (const [on, [x, z], ry] of sides) {
      if (!on) continue;
      p.box(CELL, 0.06, 0.06, [x, h, z], hex, [0, ry, 0]);
      for (let k = -3; k <= 3; k++) p.box(0.08, h, 0.08, ry ? [x, 0, z + k] : [x + k, 0, z], hex);
      p.box(CELL, h * 0.95, 0.02, [x, 0.05, z], '#6a7072', [0, ry, 0]);
    }
  };

  F.motel = (ctx) => {
    const p = parts(), g = new THREE.Group();
    p.box(CELL, 3.4, 4.5, [0, 0, -1.2], '#a89a80');
    p.box(CELL, 0.25, 6.4, [0, 3.4, -0.6], '#5a4a3a');                    // roof / overhang
    p.box(CELL, 0.12, 1.8, [0, 0, 1.9], '#5a5856');                        // walkway
    for (const x of [-3.3, 3.3]) p.box(0.12, 3.4, 0.12, [x, 0, 2.5], '#6a6050');
    p.box(1.1, 2.2, 0.12, [-1.6, 0, 1.1], ['#3a5a6a', '#6a3a3a', '#4a5a3a'][ctx.k % 3]);
    p.box(2.2, 1.3, 0.12, [1.2, 1.1, 1.1], '#141a1e');
    g.add(p.mesh());
    const num = plane(signTex(String(100 + ctx.k + 1), { fg: '#e8d8a0', font: '700 90px system-ui', w: 256, h: 128 }), 0.5, 0.25, { lit: false });
    num.position.set(m(-1.6), m(2.4), m(1.14));
    g.add(num);
    if (ctx.rnd() < 0.25) g.add(lightPanel(2.0, 1.1, [1.2, 1.75, 1.24], '#ffcf80'));
    if (ctx.first) {
      const pole = parts(); pole.box(0.25, 6, 0.25, [2.6, 0, 3.0], '#4a4a48'); g.add(pole.mesh());
      const sign = plane(signTex('MOTEL', { fg: '#ff5040', glowCol: '#ff5040', font: '900 90px Georgia, serif' }), 3.2, 1, { flick: true });
      sign.position.set(m(2.6), m(6.4), m(3.15));
      const vac = plane(signTex('VAC NCY', { fg: '#60ff80', glowCol: '#60ff80', font: '800 70px system-ui' }), 2.4, 0.6, { flick: true });
      vac.position.set(m(2.6), m(5.5), m(3.15));
      g.add(sign, vac);
    }
    return { g, ticks: [] };
  };

  F.trailerPark = (ctx) => {
    const p = parts(), g = new THREE.Group(), r = ctx.rnd;
    const col = ['#d8d4c4', '#c8d0b8', '#d8c8a8', '#b8c4c8'][Math.floor(r() * 4)];
    p.box(5.8, 2.8, 2.6, [0, 0.4, -0.6], col);
    p.box(5.92, 0.35, 2.72, [0, 1.6, -0.6], ['#8a3a2a', '#2a5a8a', '#5a6a2a'][Math.floor(r() * 3)]);
    p.box(5.5, 0.4, 2.3, [0, 0, -0.6], '#3a3a38');                       // skirt, tucked under
    p.box(1.2, 0.5, 0.8, [1.6, 0, 1.2], '#7a7468');                       // steps
    p.box(0.5, 0.5, 0.5, [-2, 0, 2.0], '#3a6a8a'); p.box(0.56, 0.06, 0.56, [-2, 0.5, 2.0], '#3a6a8a'); // lawn chair
    p.cyl(0.05, 0.05, 0.6, [2.6, 0, 2.6], '#5a5a58');                     // dog stake
    p.beam([2.6, 0.5, 2.6], [1.0, 0.05, 2.9], 0.015, '#8a8a88');           // chain, no dog
    g.add(p.mesh());
    if (r() < 0.4) g.add(lightPanel(0.9, 0.6, [-1.2, 1.8, 0.79], '#ffd590'));
    return { g, ticks: [] };
  };

  F.junkyard = (ctx) => {
    const p = parts(), g = new THREE.Group(), r = ctx.rnd;
    fence(p, ctx);
    for (let k = 0; k < 3; k++) {
      const x = (r() - 0.5) * 3, z = (r() - 0.5) * 3, c = ['#6a3a2a', '#4a5a6a', '#7a6a3a', '#5a5a58'][Math.floor(r() * 4)];
      p.box(3.6, 1.2, 1.7, [x, k * 1.2, z], c, [0, r() * 3, (r() - 0.5) * 0.15]);
    }
    for (let k = 0; k < 4; k++) p.cyl(0.5, 0.5, 0.3, [(r() - 0.5) * 5, k * 0.3, (r() - 0.5) * 5], '#141414', [0, 0, 0], 10);
    if (ctx.first) {
      p.box(0.5, 9, 0.5, [-2, 0, -2], '#c89a20');
      p.beam([-2, 9, -2], [2.5, 6.5, 1], 0.2, '#c89a20');
      p.beam([2.5, 6.5, 1], [2.5, 3.5, 1], 0.03, '#3a3a38');
      p.cyl(0.8, 0.8, 0.2, [2.5, 3.3, 1], '#4a4a48', [0, 0, 0], 12);
    }
    g.add(p.mesh());
    return { g, ticks: [] };
  };

  F.clearCut = (ctx) => {
    const p = parts(), g = new THREE.Group(), r = ctx.rnd;
    for (let k = 0; k < 6; k++) { const s = 0.4 + r() * 0.4; p.cyl(s, s * 1.15, 0.5 + r() * 0.4, [(r() - 0.5) * 5.5, 0, (r() - 0.5) * 5.5], '#7a5a3a', [0, 0, 0], 7); }
    for (let k = 0; k < 2; k++) { const x = (r() - 0.5) * 4, z = (r() - 0.5) * 4; for (let j = 0; j < 6; j++) p.beam([x + (r() - 0.5) * 2, 0.1, z + (r() - 0.5) * 2], [x + (r() - 0.5) * 2, 0.6 + r() * 0.5, z + (r() - 0.5) * 2], 0.06, '#5a4630'); }
    if (r() < 0.3) { const x = (r() - 0.5) * 4, z = (r() - 0.5) * 4; p.cyl(0.35, 0.5, 9 + r() * 5, [x, 0, z], '#8a8a84', [0, 0, (r() - 0.5) * 0.15], 6); }
    g.add(p.mesh());
    return { g, ticks: [] };
  };

  F.logDeck = (ctx) => {
    const p = parts(), g = new THREE.Group(), r = ctx.rnd;
    const along = ctx.e || ctx.w ? 0 : Math.PI / 2;
    for (let row = 0; row < 3; row++) for (let k = 0; k < 6 - row; k++) {
      const off = -2.6 + k * 1.0 + row * 0.5;
      const pos = along ? [off, 0.5 + row * 0.86, 0] : [0, 0.5 + row * 0.86, off];
      p.cyl(0.5, 0.5, CELL * 0.95, [pos[0] + (along ? 0 : -CELL * 0.475), pos[1], pos[2] + (along ? -CELL * 0.475 : 0)], k % 2 ? '#7a5634' : '#6a4a2c', along ? [Math.PI / 2, 0, 0] : [0, 0, -Math.PI / 2], 8);
    }
    p.box(0.1, 0.1, CELL * 0.9, [0, 2.9, 0], '#3a3a38', [0, along ? 0 : Math.PI / 2, 0]);  // chain over the stack
    if (r() < 0.3) p.cyl(0.5, 0.5, 6, [-2.5, 0.5, 2.5], '#7a5634', [0, r() * 3, Math.PI / 2], 8);
    g.add(p.mesh());
    return { g, ticks: [] };
  };

  F.quarantine = (ctx) => {
    const p = parts(), g = new THREE.Group(), r = ctx.rnd;
    fence(p, ctx, '#9a9e9e', 2.4);
    g.add(p.mesh());
    const tent = parts();
    tent.box(3.4, 0.12, 3.4, [0, 0, 0], '#d8dcd8');
    tent.cone(2.6, 3, [0, 0, 0], '#e0e4e0', [0, r() * 3, 0], 4);
    g.add(tent.mesh(sheet));
    if (ctx.first) {
      const sign = plane(signTex('⚠ BIOHAZARD · KEEP OUT', { fg: '#101010', bg: '#f0c820', font: '800 40px system-ui', w: 512, h: 96 }), 2.4, 0.45, { lit: false });
      sign.position.set(0, m(1.5), m(CELL / 2 - 0.1));
      g.add(sign);
    }
    if (r() < 0.5) g.add(lightPanel(0.8, 0.8, [0, 1.2, 0.2], '#e8f0d0'));
    return { g, ticks: [] };
  };

  F.dock = (ctx) => {
    const p = parts(), g = new THREE.Group(), r = ctx.rnd;
    const top = 0.9;
    p.box(CELL, 0.25, CELL * 0.6, [0, top, 0], '#6a5a44', [0, ctx.e || ctx.w ? 0 : Math.PI / 2, 0]);   // planks
    for (const [x, z] of [[-3, -1.8], [3, -1.8], [-3, 1.8], [3, 1.8], [0, -1.8], [0, 1.8]]) p.cyl(0.18, 0.2, top + 3, [ctx.e || ctx.w ? x : z, -3, ctx.e || ctx.w ? z : x], '#4a3a2a', [0, 0, 0], 6);
    for (let k = 0; k < 2; k++) p.box(0.8, 0.6, 0.8, [(r() - 0.5) * 4, top + 0.25, (r() - 0.5) * 2], '#7a7a70');   // crab pots
    if (ctx.first) {
      p.box(5, 3.5, 4.5, [0, top + 0.25, -1], '#5a5444');                    // boathouse
      p.gable(5.4, 5, 1.6, [0, top + 3.75, -1], '#2a2a28');
      p.box(3.4, 0.6, 1.2, [2.6, -0.2, 2.6], '#6a5a44', [0.35, 0.4, 0.2]);   // sunk skiff
    }
    g.add(p.mesh());
    const net = parts(); net.box(2.6, 1.6, 0.02, [-2, top + 1.2, 1.9], '#8a9a90'); g.add(net.mesh(sheet));
    return { g, ticks: [] };
  };

  // --- placing them -----------------------------------------------------------------------
  let items = new Map(); // key -> { group, ticks }
  const footprints = Object.entries({ ...LANDMARK_SUBS }).filter(([, d]) => Array.isArray(d.footprint));
  const fills = [...Object.entries(LANDMARK_SUBS).filter(([, d]) => d.footprint === 'fill').map(([s]) => s), 'dock'];

  // Older boards (no stored facing): face the side with the most road along it
  // (long sides only for oblongs), south on a tie.
  function autoFace(grid, x, y, w, h) {
    const sides = [0, 1, 2, 3].filter((f) => w === h || (w > h ? f % 2 === 0 : f % 2 === 1));
    let face = sides.includes(2) ? 2 : sides[0], best = -1;
    for (const f of sides) {
      const n = grid.roadsAlong(x, y, w, h, f);
      if (n > best || (n === best && f === 2)) { best = n; face = f; }
    }
    return face;
  }
  // One premade building on its w x h block (NW cell x, y), front to `face`.
  function placeFixed(sub, x, y, w, h, face, flip, baseY, ctx) {
    const front = face % 2 ? h : w, depth = face % 2 ? w : h;
    const built = B[sub](front * CELL * 0.92, depth * CELL * 0.92);
    const c = ctx.cellToWorld(x, y);
    built.g.position.set(c.x + (w - 1) / 2, baseY, c.z + (h - 1) / 2);
    built.g.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][face];
    if (flip) {
      built.g.scale.x = -1; // mirror the layout left to right...
      built.g.traverse((o) => { if (o.userData.text) o.scale.x *= -1; }); // ...but keep signs readable
    }
    return built;
  }

  // --- the placement preview: a building you are still turning, not yet laid -------------
  // p: { sub, x, y, w, h, face, flip, valid, hide (anchor of a building picked up) } or null.
  let preview = null, previewItem = null, lastGrid = null, lastCtx = null;
  const outlineMats = {
    ok: new THREE.MeshBasicMaterial({ color: '#7fe08a', transparent: true, opacity: 0.95, depthTest: false, fog: false }),
    bad: new THREE.MeshBasicMaterial({ color: '#ff5a4a', transparent: true, opacity: 0.95, depthTest: false, fog: false }),
  };
  for (const mat of Object.values(outlineMats)) terrainify(mat, { none: true });
  function previewOutline(p, ctx) {
    const g = new THREE.Group();
    const mat = p.valid ? outlineMats.ok : outlineMats.bad;
    const c = ctx.cellToWorld(p.x, p.y);
    const x0 = c.x - 0.5, z0 = c.z - 0.5, y = ctx.baseY(p.anchor) + 0.03, t = 0.05;
    const bar = (w, d, x, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), mat); o.position.set(x, y, z); o.renderOrder = 999; g.add(o); };
    bar(p.w, t, x0 + p.w / 2, z0); bar(p.w, t, x0 + p.w / 2, z0 + p.h);
    bar(t, p.h, x0, z0 + p.h / 2); bar(t, p.h, x0 + p.w, z0 + p.h / 2);
    // An arrow just outside the front edge.
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3).rotateX(Math.PI / 2), mat);
    arrow.renderOrder = 999;
    const [dx, dz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][p.face];
    arrow.position.set(x0 + p.w / 2 + dx * (p.w / 2 + 0.3), y, z0 + p.h / 2 + dz * (p.h / 2 + 0.3));
    arrow.rotation.y = Math.atan2(dx, dz);
    g.add(arrow);
    g.traverse((o) => { o.raycast = () => {}; });
    return g;
  }
  function showPreview() {
    if (previewItem) { root.remove(previewItem.group); previewItem = null; }
    if (!preview || !lastCtx) return;
    const group = new THREE.Group();
    let ticks = [];
    if (B[preview.sub]) {
      try {
        const built = placeFixed(preview.sub, preview.x, preview.y, preview.w, preview.h, preview.face, preview.flip, lastCtx.baseY(preview.anchor), lastCtx);
        built.g.traverse((o) => { o.raycast = () => {}; });
        group.add(built.g);
        ticks = built.ticks ?? [];
      } catch (e) { console.error('landmark preview', e); }
    }
    group.add(previewOutline(preview, lastCtx));
    root.add(group);
    previewItem = { group, ticks };
  }
  function setPreview(p) {
    const hideChanged = (preview?.hide ?? -1) !== (p?.hide ?? -1);
    preview = p;
    if (hideChanged && lastGrid) update(lastGrid, lastCtx); // show/hide the building being moved
    showPreview();
  }

  // ctx: { visible, cellToWorld, baseY(i), deckY }
  function update(grid, ctx) {
    lastGrid = grid; lastCtx = ctx;
    const want = new Map();
    if (ctx.visible) {
      for (const [sub] of footprints) {
        if (!B[sub]) continue;
        for (const blk of grid.landmarkBlocks(sub)) {
          if (preview?.hide === blk.anchor && preview.sub === sub) continue; // picked up: shown as the preview
          const face = blk.face ?? autoFace(grid, blk.x, blk.y, blk.w, blk.h);
          want.set(`${sub}:${blk.anchor}:${blk.w}x${blk.h}:${face}:${+blk.flip}`, () => placeFixed(sub, blk.x, blk.y, blk.w, blk.h, face, blk.flip, ctx.baseY(blk.anchor), ctx));
        }
      }
      // Fill landmarks, cell by cell.
      const regionFirst = new Map();
      grid.cells.forEach((c, i) => {
        if (!fills.includes(c.sub)) return;
        const { x, y } = grid.coords(i);
        const same = (dx, dy) => grid.inBounds(x + dx, y + dy) && grid.cells[grid.index(x + dx, y + dy)].sub === c.sub;
        const nb = { n: same(0, -1), e: same(1, 0), s: same(0, 1), w: same(-1, 0) };
        // First cell of its connected area (lowest index) carries the signs.
        if (!regionFirst.has(i)) {
          const seen = [i], set = new Set([i]);
          for (let q = 0; q < seen.length; q++) {
            const p = grid.coords(seen[q]);
            for (const [dx, dy] of FACES) {
              const nx = p.x + dx, ny = p.y + dy;
              if (!grid.inBounds(nx, ny)) continue;
              const j = grid.index(nx, ny);
              if (!set.has(j) && grid.cells[j].sub === c.sub) { set.add(j); seen.push(j); }
            }
          }
          const first = Math.min(...seen);
          for (const j of seen) regionFirst.set(j, first);
        }
        // Face the road, or away from the rest of the area.
        let face = 2;
        for (const f of [2, 0, 1, 3]) { const [dx, dy] = FACES[f]; if (grid.inBounds(x + dx, y + dy) && ROAD(grid.cells[grid.index(x + dx, y + dy)])) { face = f; break; } }
        if (face === 2 && nb.s && c.sub === 'motel') face = !nb.n ? 0 : 2;
        const key = `${c.sub}:${i}:${face}:${+nb.n}${+nb.e}${+nb.s}${+nb.w}:${regionFirst.get(i) === i ? 1 : 0}`;
        want.set(key, () => {
          const built = F[c.sub]({ ...nb, first: regionFirst.get(i) === i, face, k: i, rnd: rng(i + 17) });
          const p = ctx.cellToWorld(x, y);
          built.g.position.set(p.x, c.sub === 'dock' ? ctx.deckY : ctx.baseY(i), p.z);
          // Fences and stacks use the grid's sides; buildings turn to their face.
          if (!['junkyard', 'quarantine', 'logDeck', 'clearCut', 'dock'].includes(c.sub)) built.g.rotation.y = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][face];
          return built;
        });
      });
    }
    for (const [key, it] of items) if (!want.has(key)) { root.remove(it.group); items.delete(key); }
    for (const [key, make] of want) {
      if (items.has(key)) continue;
      let built;
      try { built = make(); } catch (e) { console.error('landmark', key, e); continue; }
      built.g.traverse((o) => { o.raycast = () => {}; });
      root.add(built.g);
      items.set(key, { group: built.g, ticks: built.ticks ?? [] });
    }
  }

  function tick(t) {
    for (const [, it] of items) for (const f of it.ticks) f(t);
    if (previewItem) {
      for (const f of previewItem.ticks) f(t);
      const k = 0.6 + 0.4 * Math.sin(t * 5);
      outlineMats.ok.opacity = outlineMats.bad.opacity = k;
    }
  }
  function clear() { parent.remove(root); }
  return { update, tick, clear, setPreview, setVisible: (v) => { root.visible = v; } };
}

export const LANDMARK_GROUND = Object.fromEntries(Object.entries(LANDMARK_SUBS).map(([s, d]) => [s, d.ground]));
void AREAS;
