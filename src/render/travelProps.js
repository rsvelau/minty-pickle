// Board props for the travel Events (src/game/travel.js): the holes of a Hidden
// Passage, a Peculiar Mirror's pair of mirrors, a Hiding Spot, and the Decrepit
// Truck. Small, low-poly, and sized to one cell (1 unit across).
import * as THREE from 'three';

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const add = (group, geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.raycast = () => {};
  m.castShadow = true;
  group.add(m);
  return m;
};

// A ragged hole in the floor: a dark pit with a rim of broken boards and earth.
export function makeHole() {
  const g = new THREE.Group();
  const pit = add(g, new THREE.CircleGeometry(0.34, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x050403 }), 0, 0.012, 0);
  pit.castShadow = false;
  const rim = add(g, new THREE.TorusGeometry(0.35, 0.05, 5, 18).rotateX(Math.PI / 2), lambert(0x6a5038), 0, 0.02, 0);
  rim.scale.set(1, 1, 0.6);
  // Splintered boards around it.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const b = add(g, new THREE.BoxGeometry(0.18, 0.02, 0.05), lambert(k % 2 ? 0x5e4630 : 0x7a5a3a), Math.cos(a) * 0.4, 0.025, Math.sin(a) * 0.4);
    b.rotation.y = -a + (k % 2 ? 0.4 : -0.3);
    b.rotation.z = k % 3 ? 0.25 : -0.15;
  }
  return g;
}

// A tall standing mirror in a dark wooden frame; its glass glows blue.
export function makeMirror() {
  const g = new THREE.Group();
  const wood = lambert(0x2e2118);
  for (const [w, h, x, y] of [[0.36, 0.05, 0, 0.71], [0.36, 0.05, 0, 0.13], [0.05, 0.62, -0.165, 0.42], [0.05, 0.62, 0.165, 0.42]]) add(g, new THREE.BoxGeometry(w, h, 0.06), wood, x, y, 0);   // the frame
  const glass = add(g, new THREE.BoxGeometry(0.27, 0.54, 0.05), new THREE.MeshBasicMaterial({ color: 0x6fb8ff, transparent: true, opacity: 0.9 }), 0, 0.42, 0);   // glass on both faces
  glass.castShadow = false;
  // Feet, and a soft blue glow on the floor.
  add(g, new THREE.BoxGeometry(0.4, 0.04, 0.16), wood, 0, 0.1, 0);
  const glow = add(g, new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4a90ff, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.015, 0.1);
  glow.castShadow = false;
  const light = new THREE.PointLight(0x5aa0ff, 0.9, 2.2);
  light.position.set(0, 0.45, 0.25);
  g.add(light);
  g.userData.glass = glass;
  return g;
}

// A Hiding Spot: a pile of crates with a grey tarp thrown over. When someone is
// hiding there the tarp is pulled right down over them.
export function makeHideSpot() {
  const g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.28, 0.22, 0.24), lambert(0x6b5136), -0.16, 0.11, -0.12);
  add(g, new THREE.BoxGeometry(0.22, 0.18, 0.2), lambert(0x5a432c), 0.18, 0.09, -0.16);
  const tarp = add(g, new THREE.SphereGeometry(0.34, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), lambert(0x4e5560, { side: THREE.DoubleSide }), 0, 0.02, -0.06);
  tarp.scale.set(1.15, 0.75, 0.9);
  g.userData.tarp = tarp;
  return g;
}
export function setHiding(spot, on) {
  const tarp = spot.userData.tarp;
  if (!tarp) return;
  tarp.scale.set(on ? 1.3 : 1.15, on ? 1.05 : 0.75, on ? 1.15 : 0.9);
  tarp.material.color.set(on ? 0x3e444d : 0x4e5560);
}

// The Decrepit Truck: an old brown pickup, rusted and broken down (but not crumpled):
// faded paint, rust patches, a cracked lamp, mismatched wheels. Faces +z.
export function makeTruck() {
  const g = new THREE.Group();
  const paint = lambert(0x6a4a2e), rust = lambert(0x7a3e1c), dark = lambert(0x1c1a18), glassM = lambert(0x2b3640), chrome = lambert(0x8a8a84);
  add(g, new THREE.BoxGeometry(0.46, 0.14, 0.86), paint, 0, 0.17, 0);                    // body
  add(g, new THREE.BoxGeometry(0.44, 0.16, 0.3), paint, 0, 0.32, 0.06);                   // cab
  add(g, new THREE.BoxGeometry(0.42, 0.11, 0.02), glassM, 0, 0.33, 0.215);                // windscreen
  add(g, new THREE.BoxGeometry(0.47, 0.15, 0.2), paint, 0, 0.17, 0.36);                   // bonnet
  add(g, new THREE.BoxGeometry(0.42, 0.06, 0.34), dark, 0, 0.25, -0.24);                  // empty bed
  add(g, new THREE.BoxGeometry(0.47, 0.05, 0.04), chrome, 0, 0.13, 0.46);                 // bumper
  // Rust patches.
  for (const [x, y, z, w, h] of [[0.235, 0.17, -0.2, 0.004, 0.08], [-0.235, 0.2, 0.25, 0.004, 0.06], [0.1, 0.245, 0.4, 0.12, 0.004]]) {
    add(g, new THREE.BoxGeometry(w || 0.12, h || 0.05, w ? 0.14 : 0.1), rust, x, y, z);
  }
  // Headlamps: one working (dim), one cracked and dark.
  add(g, new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xc9b46a }), 0.15, 0.19, 0.465);
  add(g, new THREE.CylinderGeometry(0.035, 0.035, 0.02, 10).rotateX(Math.PI / 2), dark, -0.15, 0.19, 0.465);
  // Wheels (one a mismatched spare).
  for (const [x, z, spare] of [[0.22, 0.3, false], [-0.22, 0.3, false], [0.22, -0.28, true], [-0.22, -0.28, false]]) {
    add(g, new THREE.CylinderGeometry(0.085, 0.085, 0.07, 12).rotateZ(Math.PI / 2), spare ? lambert(0x3a3632) : dark, x, 0.085, z);
  }
  return g;
}
