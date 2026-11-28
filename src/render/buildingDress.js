// The outside of typed buildings (src/core/buildings.js): a sign board over
// the front door (lit ones glow and flicker at midnight) and, for shops, a
// striped awning above it. Drawn on the outside face of the door's wall,
// between the door's top (2.1 m) and the wall's (2.6 m); hidden with low walls.
import * as THREE from 'three';
import { m } from '../core/scale.js';
import { BUILDING_TYPES } from '../core/buildings.js';
import { flickerize } from './dread.js';
import { terrainify } from './terrain.js';

const texCache = new Map();
function signTexture(type) {
  if (texCache.has(type)) return texCache.get(type);
  const s = BUILDING_TYPES[type].sign;
  const c = document.createElement('canvas');
  const wide = s.text.length > 2;
  c.width = wide ? 512 : 128; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = s.bg; x.fillRect(0, 0, c.width, c.height);
  x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 8; x.strokeRect(4, 4, c.width - 8, c.height - 8);
  x.font = `800 ${wide ? 70 : 96}px Georgia, 'Times New Roman', serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (s.glow) { x.shadowColor = s.fg; x.shadowBlur = 16; }
  x.fillStyle = s.fg;
  // Squeeze long names to fit the board.
  const w = x.measureText(s.text).width, room = c.width - 40;
  if (w > room) { x.save(); x.scale(room / w, 1); x.fillText(s.text, (c.width / 2) * (w / room), c.height / 2 + 4); x.restore(); } else x.fillText(s.text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(type, t);
  return t;
}
// The board's width in metres: short marks (a cross) are small squares.
const signWidth = (type) => {
  const s = BUILDING_TYPES[type].sign;
  return s.w ?? Math.min(2.4, 0.9 + s.text.length * 0.15);
};

export function createBuildingDress(group) {
  const root = new THREE.Group();
  root.name = 'buildingDress';
  group.add(root);
  const mats = new Map();
  const signMat = (type) => {
    if (mats.has(type)) return mats.get(type);
    const s = BUILDING_TYPES[type].sign;
    const mat = s.glow
      ? new THREE.MeshBasicMaterial({ map: signTexture(type), fog: true })
      : new THREE.MeshLambertMaterial({ map: signTexture(type) });
    terrainify(mat, { none: true });            // placed at the wall's own level, like the walls
    if (s.glow) flickerize(mat);
    mats.set(type, mat);
    return mat;
  };
  const awningMats = new Map();
  const awningMat = (hex) => {
    if (awningMats.has(hex)) return awningMats.get(hex);
    // Stripes: the awning colour and cream, painted across.
    const c = document.createElement('canvas');
    c.width = 64; c.height = 8;
    const x = c.getContext('2d');
    for (let k = 0; k < 8; k++) { x.fillStyle = k % 2 ? '#e8dcc0' : hex; x.fillRect(k * 8, 0, 8, 8); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: t });
    terrainify(mat, { none: true });
    awningMats.set(hex, mat);
    return mat;
  };
  const awningGeo = new THREE.BoxGeometry(m(2.0), m(0.06), m(1.0));
  const valanceGeo = new THREE.BoxGeometry(m(2.0), m(0.25), m(0.02));

  // list: [{ type, cx, cz, y (wall base level, cell units), out: [dx, dy], off (wall face) }]
  function update(list, { visible }) {
    for (const o of [...root.children]) { root.remove(o); o.geometry?.dispose?.(); }
    root.visible = visible;
    if (!visible) return;
    for (const d of list) {
      const def = BUILDING_TYPES[d.type];
      const rot = Math.atan2(d.out[0], d.out[1]);   // +z of the sign faces out of the building
      const g = new THREE.Group();
      g.position.set(d.cx + d.out[0] * d.off, d.y, d.cz + d.out[1] * d.off);   // just outside the wall's face
      g.rotation.y = rot;
      const w = signWidth(d.type);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(m(w), m(0.42)), signMat(d.type));
      sign.position.set(0, m(2.36), 0);
      sign.raycast = () => {};
      g.add(sign);
      if (def.awning) {
        // A sloped awning over the door, below the sign, with a striped valance.
        const a = new THREE.Mesh(awningGeo, awningMat(def.awning));
        a.position.set(0, m(2.12), m(0.48));
        a.rotation.x = 0.38;
        const v = new THREE.Mesh(valanceGeo, awningMat(def.awning));
        v.position.set(0, m(1.88), m(0.95));
        a.castShadow = v.castShadow = true;
        a.raycast = v.raycast = () => {};
        g.add(a, v);
      }
      root.add(g);
    }
  }
  function clear() { update([], { visible: false }); group.remove(root); }
  return { update, clear };
}
