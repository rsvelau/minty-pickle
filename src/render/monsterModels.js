// 3D figures for the card monsters, low-poly in the same style as the
// players (built in metres; a player is ~1.75 m tall). Each builder returns
// a Group facing +z with its feet at y = 0 and userData:
//   body   the part that stoops and lunges when it attacks
//   tick   optional (t, dt) idle animation (hovering, swirling, flicker)
//
// buildMonster(kind, { count }) picks the builder; Hellhounds come as a
// loose pack, one hound per action die.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { m } from '../core/scale.js';

export function createMonsterModels(terrainify) {
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const ghost = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false });
  const shadow = new THREE.MeshBasicMaterial({ color: '#050407', transparent: true, opacity: 0.88, depthWrite: false });
  const glowCache = {};
  const glowMat = (hex) => (glowCache[hex] ??= new THREE.MeshBasicMaterial({ color: hex, fog: false }));
  for (const mat of [solid, ghost, shadow]) terrainify(mat, { bridge: true });
  const spriteTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const spriteCache = {};
  const spriteMat = (hex, opacity = 1) => (spriteCache[`${hex}${opacity}`] ??= new THREE.SpriteMaterial({
    map: spriteTex, color: hex, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  const noRay = (o) => { o.raycast = () => {}; return o; };

  // A bag of coloured parts merged into one mesh (metres in, cells out).
  function parts() {
    const list = [];
    const add = (geo, hex) => {
      geo = geo.index ? geo.toNonIndexed() : geo;
      geo.deleteAttribute('uv');
      const c = new THREE.Color(hex);
      const col = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      list.push(geo);
      return geo;
    };
    const place = (geo, [x, y, z], [rx, ry, rz] = [0, 0, 0]) => geo.rotateX(rx).rotateY(ry).rotateZ(rz).translate(m(x), m(y), m(z));
    return {
      box: (w, h, d, at, hex, rot) => add(place(new THREE.BoxGeometry(m(w), m(h), m(d)), at, rot), hex),
      ball: (r, at, hex, [sx, sy, sz] = [1, 1, 1], rot) => add(place(new THREE.SphereGeometry(m(r), 10, 8).scale(sx, sy, sz), at, rot), hex),
      cyl: (r1, r2, h, at, hex, rot, seg = 8) => add(place(new THREE.CylinderGeometry(m(r1), m(r2), m(h), seg), at, rot), hex),
      cone: (r, h, at, hex, rot, seg = 8) => add(place(new THREE.ConeGeometry(m(r), m(h), seg), at, rot), hex),
      // A limb from a to b (metres), radius r1 at a, r2 at b.
      limb: (a, b, r1, r2, hex) => {
        const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
        const len = A.distanceTo(B);
        const g = new THREE.CylinderGeometry(m(r2), m(r1), m(len), 7);
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
        g.applyQuaternion(q);
        const mid = A.add(B).multiplyScalar(0.5);
        g.translate(m(mid.x), m(mid.y), m(mid.z));
        return add(g, hex);
      },
      mesh: (mat = solid) => {
        const o = noRay(new THREE.Mesh(mergeGeometries(list), mat));
        o.castShadow = mat === solid;
        return o;
      },
    };
  }
  const eyes = (g, [x, y, z], hex, r = 0.035, glow = 0.3) => {
    for (const s of [-1, 1]) {
      const e = noRay(new THREE.Mesh(new THREE.SphereGeometry(m(r), 8, 6), glowMat(hex)));
      e.position.set(m(s * x), m(y), m(z));
      g.add(e);
      if (glow) {
        const h = noRay(new THREE.Sprite(spriteMat(hex, 0.9)));
        h.position.copy(e.position);
        h.scale.setScalar(m(glow));
        g.add(h);
      }
    }
  };
  const rig = (body, tick) => {
    const root = new THREE.Group();
    root.add(body);
    root.userData = { body, tick };
    return root;
  };

  // --- the monsters ------------------------------------------------------------------
  const B = {};

  // A hulking, hunched wolf-man ~2.4 m, dark brindled fur, long clawed arms.
  B.werewolf = () => {
    const p = parts();
    const fur = '#3b2c22', dark = '#241a14', claw = '#d8cfb8';
    for (const s of [-1, 1]) {
      p.limb([s * 0.22, 0.95, -0.05], [s * 0.26, 0.5, 0.18], 0.13, 0.1, fur);   // thigh
      p.limb([s * 0.26, 0.5, 0.18], [s * 0.25, 0.12, -0.12], 0.09, 0.07, fur);  // shin (bent back)
      p.box(0.14, 0.08, 0.32, [s * 0.25, 0.04, -0.02], dark);                   // paw
      p.limb([s * 0.42, 1.7, 0.18], [s * 0.55, 1.15, 0.35], 0.11, 0.09, fur);   // upper arm
      p.limb([s * 0.55, 1.15, 0.35], [s * 0.5, 0.62, 0.5], 0.09, 0.07, fur);    // forearm
      for (let k = -1; k <= 1; k++) p.cone(0.025, 0.16, [s * 0.5 + k * 0.04, 0.52, 0.56], claw, [Math.PI * 0.8, 0, 0], 5);
      p.cone(0.07, 0.2, [s * 0.12, 2.32, 0.3], dark, [-0.2, 0, s * 0.2], 5);    // ears
    }
    p.ball(0.42, [0, 1.35, 0.05], fur, [1, 1.15, 0.85], [0.45, 0, 0]);          // barrel chest, leaning
    p.ball(0.3, [0, 0.98, -0.05], dark, [1, 0.9, 0.9]);                         // hips
    p.ball(0.2, [0, 2.08, 0.38], fur, [1, 0.95, 1.1]);                          // head
    p.box(0.16, 0.14, 0.3, [0, 2.0, 0.6], dark);                                // snout
    p.cone(0.09, 0.7, [0, 0.95, -0.45], dark, [-1.9, 0, 0], 6);                 // tail
    const body = new THREE.Group();
    body.add(p.mesh());
    eyes(body, [0.08, 2.12, 0.55], '#ffd040');
    return rig(body);
  };

  // A calf-sized black dog with a shaggy mane, dragging a chain; smoky, half there.
  B.barghest = () => {
    const p = parts();
    const coat = '#0d0b0e', mane = '#1a161c';
    p.ball(0.5, [0, 1.05, 0], coat, [0.9, 0.85, 1.7]);                          // body
    p.ball(0.3, [0, 1.38, 0.78], coat, [1, 1, 1.1]);                            // head
    p.box(0.22, 0.2, 0.38, [0, 1.3, 1.08], coat);                               // muzzle
    for (const [x, z] of [[-0.28, 0.55], [0.28, 0.55], [-0.28, -0.6], [0.28, -0.6]]) p.limb([x, 1.0, z], [x, 0.02, z + 0.05], 0.12, 0.08, coat);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      p.cone(0.08, 0.5, [Math.cos(a) * 0.36, 1.45 + Math.sin(a) * 0.18, 0.45 + Math.sin(a) * 0.1], mane, [Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2], 4);
    }
    for (const s of [-1, 1]) p.cone(0.08, 0.24, [s * 0.16, 1.66, 0.74], coat, [0, 0, s * 0.3], 5);
    p.cone(0.07, 0.8, [0, 1.2, -0.95], coat, [-1.8, 0, 0], 5);                  // tail
    const chain = parts();
    for (let k = 0; k < 8; k++) chain.box(0.12, 0.05, 0.18, [0.3 + k * 0.05, 0.15 + Math.max(0, 1.05 - k * 0.16), 0.6 - k * 0.12], '#5a5a60', [k * 0.9, 0, 0]);
    const body = new THREE.Group();
    body.add(p.mesh(ghost), chain.mesh());
    eyes(body, [0.11, 1.48, 1.02], '#ff2a1a', 0.045, 0.4);
    for (let k = 0; k < 4; k++) {
      const smoke = noRay(new THREE.Sprite(spriteMat('#40304a', 0.5)));
      smoke.position.set(m((k - 1.5) * 0.4), m(0.4), m((k % 2 ? 0.5 : -0.5)));
      smoke.scale.setScalar(m(1.6));
      body.add(smoke);
    }
    return rig(body);
  };

  // A wiry dog ~0.8 m at the shoulder, charred black with ember cracks and fire.
  function hellhound() {
    const p = parts();
    const coal = '#1c1210';
    p.ball(0.3, [0, 0.62, 0], coal, [0.75, 0.8, 1.6]);
    p.ball(0.17, [0, 0.82, 0.48], coal);
    p.box(0.13, 0.11, 0.2, [0, 0.77, 0.64], coal);
    for (const [x, z] of [[-0.14, 0.3], [0.14, 0.3], [-0.14, -0.32], [0.14, -0.32]]) p.limb([x, 0.6, z], [x, 0, z + 0.04], 0.07, 0.045, coal);
    for (const s of [-1, 1]) p.cone(0.05, 0.16, [s * 0.09, 0.98, 0.45], coal, [0, 0, s * 0.3], 4);
    p.cone(0.04, 0.45, [0, 0.72, -0.5], coal, [-2.0, 0, 0], 4);
    const g = new THREE.Group();
    g.add(p.mesh());
    // Ember cracks along the back and flames licking up.
    const ember = parts();
    for (let k = 0; k < 6; k++) ember.box(0.05, 0.02, 0.14, [(k % 2 ? 0.08 : -0.06), 0.86, -0.3 + k * 0.12], '#ff5a10', [0, k * 0.5, 0]);
    g.add(ember.mesh(glowMat('#ff6a18')));
    eyes(g, [0.06, 0.86, 0.62], '#ffb020', 0.028, 0.25);
    const flames = [];
    for (let k = 0; k < 3; k++) {
      const f = noRay(new THREE.Sprite(spriteMat(k ? '#ff6a10' : '#ffc040', 0.9)));
      f.position.set(0, m(1.0), m(-0.2 + k * 0.2));
      f.scale.setScalar(m(0.55));
      g.add(f);
      flames.push(f);
    }
    g.userData.flames = flames;
    return g;
  }
  B.hellhounds = ({ count = 4 } = {}) => {
    const body = new THREE.Group();
    const pack = [];
    for (let k = 0; k < Math.max(1, count); k++) {
      const h = hellhound();
      // A loose pack spread across the cell (cells are 7 m).
      const a = (k / count) * Math.PI * 2 + 0.6, r = count > 1 ? 1.9 : 0;
      h.position.set(m(Math.cos(a) * r), 0, m(Math.sin(a) * r));
      h.rotation.y = 0.5 * Math.sin(k * 2.3);
      h.userData.phase = k * 1.7;
      body.add(h);
      pack.push(h);
    }
    return rig(body, (t) => {
      for (const h of pack) {
        const ph = t * 5 + h.userData.phase;
        h.position.y = m(0.04) * Math.abs(Math.sin(ph));
        h.userData.flames.forEach((f, i) => { f.scale.setScalar(m(0.45 + 0.2 * Math.abs(Math.sin(ph * 1.7 + i)))); f.position.y = m(1.0 + 0.08 * Math.sin(ph * 2 + i)); });
      }
    });
  };

  // A gaunt figure under a coyote pelt, animal skull over its face, crouched low.
  B.skinwalker = () => {
    const p = parts();
    const skin = '#8f8270', pelt = '#6a5236', bone = '#ddd1b4';
    p.ball(0.3, [0, 1.15, 0.1], skin, [0.85, 1.25, 0.75], [0.7, 0, 0]);         // stooped torso
    p.ball(0.42, [0, 1.35, -0.05], pelt, [1.05, 0.55, 1.2], [0.5, 0, 0]);       // pelt over the back
    p.cone(0.18, 0.7, [0, 1.15, -0.62], pelt, [-1.7, 0, 0], 6);                 // pelt tail
    for (const s of [-1, 1]) {
      p.limb([s * 0.16, 0.85, -0.05], [s * 0.22, 0.45, 0.25], 0.08, 0.06, skin);
      p.limb([s * 0.22, 0.45, 0.25], [s * 0.2, 0.02, 0.0], 0.06, 0.04, skin);
      p.limb([s * 0.3, 1.4, 0.35], [s * 0.38, 0.75, 0.62], 0.06, 0.045, skin);  // long arms reaching down
      p.limb([s * 0.38, 0.75, 0.62], [s * 0.36, 0.05, 0.68], 0.045, 0.035, skin);
      p.cone(0.06, 0.2, [s * 0.1, 1.82, 0.5], pelt, [0, 0, s * 0.25], 4);       // coyote ears
    }
    p.ball(0.15, [0, 1.62, 0.52], bone, [0.85, 0.9, 1.25]);                     // skull
    p.box(0.12, 0.09, 0.22, [0, 1.56, 0.7], bone);                              // skull snout
    const body = new THREE.Group();
    body.add(p.mesh());
    eyes(body, [0.055, 1.66, 0.64], '#f0f0ff', 0.024, 0.18);
    return rig(body);
  };

  // A towering, emaciated thing ~3 m: ash-pale skin over ribs, a deer skull with antlers.
  B.wendigo = () => {
    const p = parts();
    const skin = '#b5afa3', bone = '#ddd3bb', rot = '#6a5f55';
    for (const s of [-1, 1]) {
      p.limb([s * 0.13, 1.35, 0], [s * 0.17, 0.7, 0.08], 0.07, 0.05, skin);
      p.limb([s * 0.17, 0.7, 0.08], [s * 0.15, 0.02, -0.02], 0.05, 0.035, skin);
      p.limb([s * 0.24, 2.45, 0.1], [s * 0.38, 1.7, 0.25], 0.05, 0.04, skin);
      p.limb([s * 0.38, 1.7, 0.25], [s * 0.35, 0.95, 0.38], 0.04, 0.03, skin);
      // Antlers: a main beam and tines.
      p.limb([s * 0.08, 2.95, 0.15], [s * 0.45, 3.45, 0.0], 0.03, 0.02, bone);
      p.limb([s * 0.3, 3.24, 0.08], [s * 0.42, 3.55, 0.25], 0.02, 0.012, bone);
      p.limb([s * 0.42, 3.4, 0.03], [s * 0.7, 3.6, -0.05], 0.02, 0.012, bone);
      p.limb([s * 0.2, 3.1, 0.12], [s * 0.18, 3.42, 0.28], 0.018, 0.01, bone);
    }
    p.ball(0.24, [0, 2.15, 0.05], skin, [1, 1.9, 0.75], [0.15, 0, 0]);          // narrow chest
    for (let k = 0; k < 5; k++) p.box(0.5 - k * 0.04, 0.025, 0.36, [0, 2.38 - k * 0.12, 0.08], rot);   // ribs
    p.ball(0.17, [0, 1.42, 0], rot, [1.1, 0.7, 0.9]);                            // hips
    p.ball(0.13, [0, 2.85, 0.2], bone, [0.85, 1, 1.3]);                          // deer skull
    p.box(0.1, 0.08, 0.26, [0, 2.78, 0.38], bone);
    const body = new THREE.Group();
    body.add(p.mesh());
    eyes(body, [0.05, 2.88, 0.31], '#a8e8ff', 0.02, 0.16);
    return rig(body);
  };

  // A wailing woman in a long grey, tattered gown, floating; white hair streaming.
  B.banshee = () => {
    const p = parts();
    const gown = '#9ea3a8', skin = '#d8dcdc', hair = '#eceff0';
    p.cone(0.5, 1.6, [0, 0.95, 0], gown, [0, 0, 0], 10);                       // gown
    p.ball(0.17, [0, 1.75, 0], gown, [1, 1.2, 0.8]);                            // bodice
    p.ball(0.12, [0, 2.0, 0.03], skin, [0.9, 1.1, 0.95]);                       // head
    p.cone(0.18, 0.9, [0, 1.65, -0.12], hair, [-0.25, 0, 0], 8);                // hair streaming down the back
    p.box(0.07, 0.07, 0.02, [0, 1.93, 0.13], '#101012');                        // open mouth
    for (const s of [-1, 1]) p.limb([s * 0.15, 1.82, 0], [s * 0.6, 1.95, 0.2], 0.035, 0.025, skin);   // arms flung out
    const body = new THREE.Group();
    body.add(p.mesh(ghost));
    eyes(body, [0.04, 2.03, 0.12], '#cfe8ff', 0.018, 0.2);
    const aura = noRay(new THREE.Sprite(spriteMat('#8090a0', 0.35)));
    aura.position.set(0, m(1.3), 0);
    aura.scale.setScalar(m(2.6));
    body.add(aura);
    return rig(body, (t) => { body.position.y = m(0.35 + 0.12 * Math.sin(t * 1.4)); });
  };

  // An ox-headed demon on a broad, crab-like shell: four splayed walking legs
  // and two heavy pincers, ~2.2 m high and wider than it is tall.
  B['ushi-oni'] = () => {
    const p = parts();
    const hide = '#3a1714', dark = '#1e0c0a', horn = '#d8ccb0', shell = '#4a1c16';
    p.ball(0.95, [0, 1.05, -0.35], shell, [1.35, 0.5, 1.05]);                  // broad, flat carapace
    p.ball(0.7, [0, 1.22, -0.35], hide, [1.2, 0.35, 0.9]);                      // ridge on top
    p.ball(0.36, [0, 1.25, 0.55], dark, [1.1, 0.8, 0.9]);                       // neck
    p.ball(0.34, [0, 1.5, 0.88], hide, [1, 1, 1.15]);                           // bull head
    p.box(0.34, 0.26, 0.3, [0, 1.4, 1.16], dark);                               // muzzle
    for (const s of [-1, 1]) {
      p.cone(0.07, 0.6, [s * 0.42, 1.85, 0.86], horn, [0, 0, -s * 1.1], 6);     // horns
      p.cone(0.04, 0.3, [s * 0.68, 2.1, 0.86], horn, [0, 0, -s * 0.1], 6);
      for (let k = 0; k < 2; k++) {                                              // walking legs, splayed sideways
        const z = -0.05 - k * 0.6;
        const knee = [s * 1.65, 1.55, z];
        p.limb([s * 0.95, 1.0, z], knee, 0.12, 0.09, dark);
        p.limb(knee, [s * 2.05, 0.02, z - 0.1], 0.09, 0.04, dark);
      }
      // A heavy pincer arm reaching forward.
      const elbow = [s * 1.15, 1.25, 0.75];
      p.limb([s * 0.85, 1.05, 0.35], elbow, 0.14, 0.12, shell);
      p.limb(elbow, [s * 0.95, 0.85, 1.35], 0.12, 0.1, shell);
      p.ball(0.24, [s * 0.92, 0.82, 1.45], shell, [0.9, 0.75, 1.3]);           // claw body
      p.cone(0.09, 0.5, [s * 0.98, 0.9, 1.82], horn, [Math.PI / 2 - 0.25, 0, 0], 5);   // upper finger
      p.cone(0.07, 0.42, [s * 0.86, 0.72, 1.78], dark, [Math.PI / 2 + 0.3, 0, 0], 5);  // lower finger
    }
    const body = new THREE.Group();
    body.add(p.mesh());
    eyes(body, [0.15, 1.62, 1.16], '#ff3020', 0.045, 0.35);
    return rig(body);
  };

  // A wizened, goblin-like old man ~1.2 m: blood-red cap, iron boots, a pikestaff.
  B.redcap = () => {
    const p = parts();
    const skin = '#9a8a70', coat = '#3c3024', iron = '#4a4c52', cap = '#8a0a12';
    for (const s of [-1, 1]) {
      p.limb([s * 0.1, 0.55, 0], [s * 0.12, 0.15, 0.03], 0.06, 0.05, coat);
      p.box(0.14, 0.18, 0.24, [s * 0.12, 0.09, 0.05], iron);                     // iron boots
      p.limb([s * 0.2, 0.95, 0.05], [s * 0.3, 0.55, 0.22], 0.045, 0.04, coat);
      p.cone(0.04, 0.12, [s * 0.18, 1.12, 0.05], skin, [0, 0, s * 1.4], 4);       // pointed ears
    }
    p.ball(0.25, [0, 0.8, 0], coat, [1, 1.1, 0.85], [0.3, 0, 0]);
    p.ball(0.15, [0, 1.1, 0.1], skin);                                          // head
    p.cone(0.13, 0.12, [0, 0.98, 0.24], '#d0c8b0', [Math.PI, 0, 0], 6);           // long teeth / beard
    p.cone(0.16, 0.42, [0.02, 1.37, 0.02], cap, [-0.35, 0, 0.1], 8);            // the red cap
    p.limb([0.32, 0.05, 0.3], [0.38, 1.7, 0.36], 0.025, 0.02, '#4a3826');        // pikestaff
    p.cone(0.06, 0.3, [0.39, 1.85, 0.37], iron, [0, 0, 0], 4);
    const body = new THREE.Group();
    body.add(p.mesh());
    eyes(body, [0.05, 1.13, 0.23], '#ff2a1a', 0.02, 0.16);
    return rig(body);
  };

  // No body at all: household things whirling in the air, and a cold haze.
  B.poltergeist = () => {
    const body = new THREE.Group();
    const swirl = new THREE.Group();
    body.add(swirl);
    const things = [];
    const thing = (build) => { const p = parts(); build(p); const o = p.mesh(); swirl.add(o); things.push(o); return o; };
    thing((p) => { p.box(0.45, 0.05, 0.45, [0, 0.45, 0], '#5a3a24'); for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) p.box(0.05, 0.45, 0.05, [x, 0.22, z], '#4a2e1c'); p.box(0.45, 0.5, 0.05, [0, 0.72, -0.2], '#5a3a24'); });
    thing((p) => { p.box(0.24, 0.05, 0.32, [0, 0, 0], '#3a2a5a'); p.box(0.22, 0.04, 0.3, [0, 0.03, 0], '#e8e0cc'); });
    thing((p) => { p.cyl(0.15, 0.15, 0.03, [0, 0, 0], '#dedad0', [0, 0, 0], 14); });
    thing((p) => { p.cyl(0.1, 0.14, 0.32, [0, 0, 0], '#7a6a4a', [0, 0, 0], 10); p.cone(0.22, 0.24, [0, 0.27, 0], '#c8b890', [0, 0, 0], 10); });
    thing((p) => { p.box(0.3, 0.4, 0.04, [0, 0, 0], '#6a4a2a'); p.box(0.24, 0.32, 0.02, [0, 0, 0.02], '#8a9aa8'); });
    things.forEach((o, k) => { o.userData = { a: (k / things.length) * Math.PI * 2, r: 0.9 + (k % 2) * 0.4, h: 0.8 + k * 0.3 }; });
    const haze = noRay(new THREE.Sprite(spriteMat('#a0b0c8', 0.3)));
    haze.position.y = m(1.3);
    haze.scale.setScalar(m(3.4));
    body.add(haze);
    return rig(body, (t) => {
      for (const o of things) {
        const u = o.userData, a = u.a + t * 0.9;
        o.position.set(m(Math.cos(a) * u.r), m(u.h + 0.25 * Math.sin(t * 1.7 + u.a)), m(Math.sin(a) * u.r));
        o.rotation.set(t * 0.7 + u.a, t * 0.5, t * 0.3 + u.a * 2);
      }
    });
  };

  // A woman in a long white gown and veil, faintly glowing, drifting above the ground.
  B['white-lady'] = () => {
    const p = parts();
    const white = '#eef2fb';
    p.cone(0.48, 1.65, [0, 0.95, 0], white, [0, 0, 0], 12);                    // gown
    p.ball(0.16, [0, 1.78, 0], white, [1, 1.25, 0.8]);
    p.ball(0.11, [0, 2.02, 0.02], '#f4f4f8');                                   // face
    p.cone(0.26, 1.0, [0, 1.6, -0.04], white, [0, 0, 0], 12);                   // veil
    for (const s of [-1, 1]) p.limb([s * 0.14, 1.8, 0.02], [s * 0.05, 1.5, 0.22], 0.03, 0.025, white);   // hands clasped
    const body = new THREE.Group();
    body.add(p.mesh(ghost));
    const glow = noRay(new THREE.Sprite(spriteMat('#dfe8ff', 0.55)));
    glow.position.y = m(1.3);
    glow.scale.setScalar(m(3.0));
    body.add(glow);
    return rig(body, (t) => { body.position.y = m(0.25 + 0.1 * Math.sin(t * 1.1)); });
  };

  // A hunched, bald revenant ~1.9 m in a rotting burial shroud, long nails, red eyes.
  B.strigoi = () => {
    const p = parts();
    const skin = '#c9c1b0', shroud = '#2b2226';
    p.cone(0.42, 1.3, [0, 0.66, 0], shroud, [0, 0, 0], 9);                     // shroud
    p.ball(0.25, [0, 1.42, 0.06], shroud, [1.1, 1, 0.85], [0.5, 0, 0]);         // hunched shoulders
    p.ball(0.14, [0, 1.66, 0.3], skin, [0.85, 1.1, 1]);                         // bald head, thrust forward
    for (const s of [-1, 1]) {
      p.cone(0.04, 0.16, [s * 0.13, 1.72, 0.27], skin, [0, 0, s * 1.2], 4);       // pointed ears
      p.limb([s * 0.26, 1.42, 0.1], [s * 0.32, 1.05, 0.4], 0.045, 0.035, skin);
      p.limb([s * 0.32, 1.05, 0.4], [s * 0.2, 1.0, 0.62], 0.035, 0.03, skin);
      for (let k = -1; k <= 1; k++) p.cone(0.012, 0.14, [s * 0.2 + k * 0.025, 0.98, 0.7], '#e0d8c0', [Math.PI / 2, 0, 0], 4);
    }
    const body = new THREE.Group();
    body.add(p.mesh());
    eyes(body, [0.045, 1.69, 0.42], '#ff1a1a', 0.022, 0.2);
    return rig(body);
  };

  // The Adze, mid-transformation: a great veined cocoon in its lair, lit from
  // within and pulsing, bound to the ground by threads, a few flies drifting.
  B.adze = () => {
    const p = parts();
    const husk = '#5a5236', vein = '#2e2818';
    p.ball(0.62, [0, 1.15, 0], husk, [0.85, 1.7, 0.8]);                         // the cocoon
    for (let k = 0; k < 7; k++) {                                               // veins wrapping it
      const a = (k / 7) * Math.PI * 2;
      p.limb([Math.cos(a) * 0.5, 0.25, Math.sin(a) * 0.46], [Math.cos(a + 0.8) * 0.18, 2.1, Math.sin(a + 0.8) * 0.16], 0.03, 0.02, vein);
      p.limb([Math.cos(a) * 0.5, 0.25, Math.sin(a) * 0.46], [Math.cos(a) * 1.0, 0.0, Math.sin(a) * 0.95], 0.025, 0.015, '#8a8468');  // threads to the ground
    }
    p.cyl(0.08, 0.04, 0.5, [0, 2.25, 0], vein);                                   // stalk at the top
    const body = new THREE.Group();
    const cocoon = p.mesh();
    body.add(cocoon);
    const inner = noRay(new THREE.Sprite(spriteMat('#e8ff80', 0.7)));
    inner.position.set(0, m(1.15), m(0.2));
    inner.scale.setScalar(m(1.6));
    body.add(inner);
    const flies = [];
    for (let k = 0; k < 10; k++) {
      const f = noRay(new THREE.Sprite(spriteMat('#d8ff70', 0.95)));
      f.scale.setScalar(m(0.18));
      f.userData = { a: k * 2.4, r: 0.8 + (k % 3) * 0.3, h: 0.6 + (k % 4) * 0.4 };
      body.add(f);
      flies.push(f);
    }
    return rig(body, (t) => {
      const beat = 0.5 + 0.5 * Math.sin(t * 2.2);
      cocoon.scale.set(1 + 0.03 * beat, 1 + 0.05 * beat, 1 + 0.03 * beat);
      inner.material.opacity = 0.35 + 0.45 * beat;
      for (const f of flies) {
        const u = f.userData, a = u.a + t * 1.3;
        f.position.set(m(Math.cos(a) * u.r), m(u.h + 0.2 * Math.sin(t * 3 + u.a)), m(Math.sin(a) * u.r));
      }
    });
  };

  // An Adze fly swarm flying out to strike: a cloud of glowing motes.
  function makeSwarm() {
    const g = new THREE.Group();
    const flies = [];
    for (let k = 0; k < 26; k++) {
      const f = noRay(new THREE.Sprite(spriteMat(k % 3 ? '#d8ff70' : '#fff0a0', 0.95)));
      f.scale.setScalar(m(0.16 + (k % 4) * 0.04));
      f.userData = { a: k * 2.39996, r: 0.25 + (k % 6) * 0.12, h: 0.6 + (k % 7) * 0.18, s: 2 + (k % 5) * 0.6 };
      g.add(f);
      flies.push(f);
    }
    g.userData.tick = (t) => {
      for (const f of flies) {
        const u = f.userData, a = u.a + t * u.s;
        f.position.set(m(Math.cos(a) * u.r), m(u.h + 0.25 * Math.sin(t * 5 + u.a)), m(Math.sin(a) * u.r));
      }
    };
    return g;
  }

  // The Shadow People have no body: nothing stands on the board. They only
  // take shape to strike (makeShadowGrab).
  B['shadow-people'] = () => rig(new THREE.Group());

  // Human silhouettes rising out of the ground around a player, reaching for
  // their shadow. grow(k) 0..1 raises them; the caller fades and removes it.
  function makeShadowGrab() {
    const g = new THREE.Group();
    const figs = [];
    for (let k = 0; k < 5; k++) {
      const p = parts();
      const h = 1.6 + (k % 3) * 0.3;
      p.cyl(0.12, 0.18, h * 0.6, [0, h * 0.3, 0], '#000000', [0, 0, 0], 7);
      p.ball(0.13, [0, h * 0.68, 0.02], '#000000', [0.9, 1.15, 0.9]);
      // Both arms stretched toward the middle, fingers spread.
      for (const s of [-1, 1]) {
        p.limb([s * 0.14, h * 0.55, 0], [s * 0.1, h * 0.62, 0.75], 0.035, 0.025, '#000000');
        for (let f = -1; f <= 1; f++) p.limb([s * 0.1, h * 0.62, 0.75], [s * 0.1 + f * 0.05, h * 0.6, 0.92], 0.012, 0.006, '#000000');
      }
      const o = p.mesh(shadow);
      const a = (k / 5) * Math.PI * 2;
      o.position.set(m(Math.cos(a) * 1.1), 0, m(Math.sin(a) * 1.1));
      o.lookAt(0, 0, 0);
      g.add(o);
      figs.push(o);
    }
    g.userData.grow = (k) => { for (const o of figs) { o.scale.set(1, Math.max(0.01, k), 1); } };
    return g;
  }

  // A townsperson the Adze preys on: sickly, slumped, in a drab coat; a
  // label names them. setDead() lays them down.
  function makeCivilian(name) {
    const p = parts();
    const coat = '#5a5a52', skin = '#b8b49a', pants = '#3a3c40';
    for (const s of [-1, 1]) {
      p.limb([s * 0.09, 0.85, 0], [s * 0.1, 0.05, 0.02], 0.065, 0.055, pants);
      p.limb([s * 0.22, 1.35, 0.02], [s * 0.2, 0.85, 0.12], 0.05, 0.045, coat);
    }
    p.ball(0.22, [0, 1.18, 0.02], coat, [1, 1.35, 0.75], [0.25, 0, 0]);      // slumped body
    p.ball(0.11, [0, 1.58, 0.12], skin);                                     // head, hanging forward
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.add(p.mesh());
    // A sickly green glow about them: the Adze's mark.
    const aura = noRay(new THREE.Sprite(spriteMat('#b8ff60', 0.45)));
    aura.position.y = m(1.1);
    aura.scale.setScalar(m(2.4));
    body.add(aura);
    body.scale.setScalar(1.15);
    g.add(body);
    // Name tag.
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(20,24,20,0.85)';
    x.beginPath(); x.roundRect(4, 6, 248, 52, 14); x.fill();
    x.fillStyle = '#e8f0c0'; x.font = '700 28px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name, 128, 33);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const tag = noRay(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false })));
    tag.position.y = m(2.3);
    tag.scale.set(m(2.8), m(0.7), 1);
    tag.renderOrder = 24;
    g.add(tag);
    g.userData = {
      body, tag,
      setDead(dead) {
        body.rotation.x = dead ? -Math.PI / 2 : 0;
        body.position.set(0, dead ? m(0.15) : 0, dead ? m(-0.7) : 0);
        tag.material.opacity = dead ? 0.45 : 1;
        aura.visible = !dead;
      },
      tick(t) { if (body.rotation.x === 0) body.rotation.z = 0.04 * Math.sin(t * 1.3); },
    };
    return g;
  }

  function buildMonster(kind, opts = {}) {
    return B[kind]?.(opts) ?? null;
  }
  return { buildMonster, makeSwarm, makeShadowGrab, makeCivilian, kinds: Object.keys(B) };
}
