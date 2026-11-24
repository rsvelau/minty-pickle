// Play demo: the 3D view and controls for a game. The game itself (turns,
// dice, movement rules, markers, Obols, the clock, monsters) lives in
// src/game/ as plain data and pure functions; this file only shows it.
//
// - It talks to a session (src/game/session.js): actions go in with
//   session.dispatch, and every change comes back as (state, events). Today
//   the session is local (everyone on one device); a multiplayer session
//   plugs in the same way.
// - Events are animated: players jog cell to cell (~2.7 m/s; hold the board
//   to fast-forward), markers burst when the runner actually reaches them,
//   doors visibly unlock when the key is reached, dice tumble, monsters
//   stalk and lunge.
// - Players are small stylised 90s figures (to scale) that each stand in
//   their own quarter of a cell, with a name tag (it fades when zoomed in).
import * as THREE from 'three';
import { m, METERS_PER_CELL } from '../core/scale.js';
import { dreadUniforms, flickerAt } from '../render/dread.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  DIRS, startMinutes as rulesStartMinutes, clockMinutes as rulesClockMinutes, isMidnight, defaultConfig, sacrificeSeat,
} from '../game/rules.js';
import { createBoard } from '../game/board.js';
import { createLocalSession } from '../game/session.js';
import { createDiscoveries, PAINT } from '../render/discoveries.js';
import { createMonsterModels } from '../render/monsterModels.js';
import { MONSTER_BY_ID } from '../game/cards/monsters.js';
import { evidenceVisual, ATTACK_TYPES } from '../game/cards/evidence.js';

export {
  DEFAULT_CONFIG, defaultConfig, OBOLS, OBOL_TYPES, obolCounts, INVENTORY_TABS, formatClock, MIDNIGHT,
} from '../game/rules.js';
import { MONSTERS, monsterDef } from '../game/monsters.js';
import { DOOR_HP } from '../game/monsterTurn.js';
export { MONSTERS, monsterDef };

// The four players' looks: jacket colour (also the name tag), hair, extras.
export const PLAYERS = [
  { name: 'P1', colour: '#18b7a6', accent: '#f2e9d0', hair: '#2a1a10', cap: false, pack: 'schoolbag', torch: '#1c1c1e' },
  { name: 'P2', colour: '#e0407e', accent: '#2b2b6e', hair: '#d9b25a', cap: false, pack: 'neon', torch: '#e8c22a' },
  { name: 'P3', colour: '#f0b52a', accent: '#5a2a8a', hair: '#1a1410', cap: true, pack: 'daypack', torch: '#b8252a' },
  { name: 'P4', colour: '#7a54e8', accent: '#2fd0c0', hair: '#7a3a1c', cap: false, pack: 'hiker', torch: '#5a5f66' },
];
// Where each player stands inside a cell (cell units from its centre).
const SLOTS = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];

// Players jog: ~2.7 m/s, so one 7 m cell takes about 2.6 s. Holding the
// screen fast-forwards to FAST_STEP per cell. Monsters stalk a bit slower.
const JOG_SPEED = 3.2;                        // metres per second (a jog, a little brisk)
const STEP_TIME = (TILE_M) => TILE_M / JOG_SPEED;
const FAST_STEP = 0.32;                       // seconds per cell when fast-forwarding
const MONSTER_STEP = 1.4;                     // seconds per cell for a stalking monster
const STRIDES_PER_M = 0.78;                   // running cadence: leg cycles per metre
const ROLL_TIME = 0.7;    // die tumble before it lands
const LUNGE_TIME = 0.7;   // a monster's attack lunge

export function createPlay({
  grid, scene, camera, controls, cellToWorld, cellTop, terrainify, cellLabel, onChange,
  onUsed = () => {}, onCollect = () => {}, onObol = () => {}, onAttack = () => {}, onMonster = () => {},
  onEvidence = () => {}, onAttacked = () => {}, onNamed = () => {}, onMonsterRevealed = () => {},
  onDamage = () => {}, onIntent = () => {}, onGameOver = () => {}, onNpc = () => {}, onExhaust = () => {}, onCraft = () => {}, onCard = () => {}, onEquip = () => {}, onSacrifice = () => {},
  config = defaultConfig(),
}) {
  const cfg = config; // live: Game settings edits this object; used at the next new game
  const board = createBoard(grid);
  // View-only state: animation, camera, what has visibly happened.
  const view = {
    startMode: 'standard',
    followStreets: true,
    follow: true,
    fast: false,             // fast-forward held
    pan: true,               // camera pans to the current player
    rollT: ROLL_TIME,        // die tumble timer (>= ROLL_TIME: landed)
    rollFace: 1,
    shownUsed: new Set(),    // marker cells a runner has visibly reached
    shownKeys: 0,            // key groups whose doors visibly unlocked
    actors: [],              // per seat: { at, face, vis, queue, anim }
    monsters: new Map(),     // id -> { fig, at, face, vis, queue, anim, lunge }
    watch: null,             // { id, until }: the camera visits a monster (when it appears or moves)
    shownFinds: 0,           // how many evidence finds have visibly happened (runner got there)
  };
  const session = createLocalSession({ board, onUpdate: (state, events) => handleEvents(state, events) });
  const g = () => session.state;

  // --- players ---------------------------------------------------------------
  const group = new THREE.Group(); // everything the demo shows
  group.visible = false;
  scene.add(group);
  const figureMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  terrainify(figureMat, { bridge: true });
  // Dim, warm 90s incandescent flashlight: a glowing lens and a faint cone.
  // Each figure gets its own pair so its flashlight can flicker on its own
  // at midnight.
  const LENS_COLOUR = new THREE.Color('#ffe2a8'), BEAM_OPACITY = 0.12;
  function flashlightMats() {
    const lensMat = new THREE.MeshBasicMaterial({ color: LENS_COLOUR.clone() });
    const beamMat = new THREE.MeshBasicMaterial({
      color: '#ffcf8a', transparent: true, opacity: BEAM_OPACITY, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    terrainify(lensMat, { bridge: true });
    terrainify(beamMat, { bridge: true });
    return { lensMat, beamMat };
  }
  // Cone along +z from the lens: ~3 m long, ~1.2 m wide at the far end.
  const beamGeo = new THREE.CylinderGeometry(m(0.6), m(0.04), m(3), 16, 1, true)
    .translate(0, m(1.5), 0).rotateX(Math.PI / 2);

  function makeFigure(p) {
    // Built in metres, base at y = 0, facing +z, ~1.75 m tall. Legs hinge at
    // the hips and arms at the shoulders so the figure can jog.
    const HIP = 0.86, SHOULDER = 1.38;
    const groups = { body: [], legL: [], legR: [], armL: [], armR: [] };
    const add = (part, geo, hex) => {
      geo = geo.index ? geo.toNonIndexed() : geo;
      geo.deleteAttribute('uv');
      const c = new THREE.Color(hex);
      const col = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      groups[part].push(geo);
    };
    // Box at (x, y..y+h, z) in metres, relative to a pivot height.
    const box = (part, w, h, d, x, y, z, hex, pivot = 0) =>
      add(part, new THREE.BoxGeometry(m(w), m(h), m(d)).translate(m(x), m(y + h / 2 - pivot), m(z)), hex);
    const skin = '#d8a27c';
    for (const [part, x] of [['legL', -0.09], ['legR', 0.09]]) {
      box(part, 0.13, 0.1, 0.27, x, 0, 0.03, '#f4f2ec', HIP);  // sneaker
      box(part, 0.14, 0.78, 0.16, x, 0.08, 0, '#4f6f9e', HIP); // stonewashed jeans
    }
    for (const [part, x] of [['armL', -0.28], ['armR', 0.28]]) {
      box(part, 0.11, 0.56, 0.13, x, 0.86, 0, p.colour, SHOULDER); // sleeve
      box(part, 0.09, 0.1, 0.1, x, 0.77, 0, skin, SHOULDER);       // hand
    }
    box('body', 0.44, 0.58, 0.26, 0, 0.84, 0, p.colour);          // windbreaker
    box('body', 0.45, 0.12, 0.27, 0, 1.08, 0, p.accent);          // colour-block stripe
    box('body', 0.46, 0.06, 0.28, 0, 0.84, 0, p.accent);          // hem
    box('body', 0.1, 0.08, 0.1, 0, 1.42, 0, skin);                // neck
    add('body', new THREE.SphereGeometry(m(0.13), 12, 9).scale(1, 1.12, 1).translate(0, m(1.6), 0), skin); // head
    add('body', new THREE.SphereGeometry(m(0.135), 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.04, 1.1, 1.06)
      .translate(0, m(1.615), m(-0.01)), p.hair);                 // hair
    if (p.cap) {
      add('body', new THREE.CylinderGeometry(m(0.14), m(0.14), m(0.07), 14).translate(0, m(1.72), 0), p.accent);
      box('body', 0.18, 0.02, 0.14, 0, 1.69, -0.17, p.accent);    // backwards brim
    }
    // Backpack (on the back, -z), a different kind for each player.
    const strap = (hex) => { box('body', 0.05, 0.46, 0.03, -0.12, 0.92, 0.135, hex); box('body', 0.05, 0.46, 0.03, 0.12, 0.92, 0.135, hex); };
    if (p.pack === 'schoolbag') {          // classic 90s school pack: navy, front pocket, leather patch
      box('body', 0.36, 0.42, 0.16, 0, 0.92, -0.21, '#2b3a6a');
      add('body', new THREE.CylinderGeometry(m(0.18), m(0.18), m(0.16), 12, 1, false, 0, Math.PI)
        .rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, m(1.34), m(-0.21)), '#2b3a6a');
      box('body', 0.28, 0.18, 0.06, 0, 0.95, -0.31, '#2b3a6a');
      box('body', 0.06, 0.06, 0.02, 0, 1.06, -0.345, '#7a4a26');
      strap('#1d2748');
    } else if (p.pack === 'neon') {        // neon colour-block pack
      box('body', 0.34, 0.2, 0.15, 0, 0.92, -0.2, '#2fd0c0');
      box('body', 0.34, 0.22, 0.15, 0, 1.12, -0.2, '#f04fa0');
      box('body', 0.35, 0.04, 0.16, 0, 1.11, -0.2, '#f2e830');
      box('body', 0.26, 0.14, 0.05, 0, 0.96, -0.29, '#2b2b6e');
      strap('#222');
    } else if (p.pack === 'daypack') {     // small canvas daypack with a rolled blanket
      box('body', 0.3, 0.32, 0.13, 0, 0.98, -0.2, '#6f6a3e');
      box('body', 0.31, 0.06, 0.14, 0, 1.24, -0.2, '#4a4528');
      add('body', new THREE.CylinderGeometry(m(0.07), m(0.07), m(0.4), 10).rotateZ(Math.PI / 2)
        .translate(0, m(0.92), m(-0.22)), '#8a3a2a');
      strap('#3a3720');
    } else {                               // tall external-frame hiking pack + bedroll
      box('body', 0.34, 0.6, 0.18, 0, 0.84, -0.22, '#a24a2a');
      box('body', 0.03, 0.78, 0.03, -0.19, 0.78, -0.15, '#9a9ca0');
      box('body', 0.03, 0.78, 0.03, 0.19, 0.78, -0.15, '#9a9ca0');
      add('body', new THREE.CylinderGeometry(m(0.09), m(0.09), m(0.44), 10).rotateZ(Math.PI / 2)
        .translate(0, m(1.52), m(-0.22)), '#2f5a3a');
      strap('#4a2a1a');
    }
    // Flashlight in the right hand, pointing forward.
    add('armR', new THREE.CylinderGeometry(m(0.028), m(0.024), m(0.24), 10).rotateX(Math.PI / 2)
      .translate(m(0.28), m(0.82 - SHOULDER), m(0.12)), p.torch);
    add('armR', new THREE.CylinderGeometry(m(0.04), m(0.03), m(0.05), 10).rotateX(Math.PI / 2)
      .translate(m(0.28), m(0.82 - SHOULDER), m(0.26)), p.torch);
    const root = new THREE.Group();   // placed on the ground, turned to face travel
    const torso = new THREE.Group();  // bobs and leans while running
    root.add(torso);
    const mesh = (geos) => {
      const o = new THREE.Mesh(mergeGeometries(geos), figureMat);
      o.castShadow = true;
      o.raycast = () => {};
      return o;
    };
    torso.add(mesh(groups.body));
    const limbs = {};
    for (const [part, pivot] of [['legL', HIP], ['legR', HIP], ['armL', SHOULDER], ['armR', SHOULDER]]) {
      const g = new THREE.Group();
      g.position.y = m(pivot);
      g.add(mesh(groups[part]));
      (part.startsWith('leg') ? root : torso).add(g);
      limbs[part] = g;
    }
    // The flashlight's lens and dim beam (unlit, warm, faint), on the arm.
    const { lensMat, beamMat } = flashlightMats();
    const lens = new THREE.Mesh(new THREE.CircleGeometry(m(0.035), 12).translate(0, 0, 0), lensMat);
    lens.position.set(m(0.28), m(0.82 - SHOULDER), m(0.29));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.copy(lens.position);
    beam.rotation.x = 0.62; // the arm is held up; aim the beam a little down at the ground ahead
    beam.renderOrder = 4;
    lens.raycast = beam.raycast = () => {};
    limbs.armR.add(lens, beam);
    root.userData = { torso, limbs, phase: 0, run: 0, lensMat, beamMat };
    return root;
  }

  // Name tag: a rounded label in the player's colour with a pointer.
  function makeTag(p) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = p.colour;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.lineWidth = 6;
    g.beginPath();
    g.roundRect(10, 6, 108, 62, 18);
    g.moveTo(52, 66); g.lineTo(64, 90); g.lineTo(76, 66);
    g.fill(); g.stroke();
    g.fillStyle = '#fff';
    g.font = '800 40px system-ui, -apple-system, "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeText(p.name, 64, 39);
    g.fillText(p.name, 64, 39);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
    sprite.center.set(0.5, 0);
    sprite.renderOrder = 25;
    sprite.raycast = () => {};
    return sprite;
  }

  // Ring under the player whose turn it is.
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, depthWrite: false });
  terrainify(haloMat, { bridge: true });
  // Red rings under players a monster's declared action would hit.
  const dangerMat = new THREE.MeshBasicMaterial({ color: '#ff2a1a', transparent: true, opacity: 0.8, depthWrite: false });
  terrainify(dangerMat, { bridge: true });
  // One per damage type: a ring shows in the colour of what's coming.
  const dangerMats = Object.fromEntries(Object.entries(ATTACK_TYPES).map(([k, t]) => {
    const mat = new THREE.MeshBasicMaterial({ color: t.colour, transparent: true, opacity: 0.8, depthWrite: false });
    terrainify(mat, { bridge: true });
    return [k, mat];
  }));
  const dangerRings = [0, 1, 2, 3].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 28).rotateX(-Math.PI / 2).translate(0, 0.014, 0), dangerMat);
    r.raycast = () => {};
    r.renderOrder = 6;
    r.visible = false;
    return r;
  });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 28).rotateX(-Math.PI / 2).translate(0, 0.012, 0), haloMat);
  halo.raycast = () => {};
  halo.renderOrder = 6;
  group.add(halo);
  for (const r of dangerRings) group.add(r);

  const figures = PLAYERS.map((p) => {
    const fig = makeFigure(p);
    const tag = makeTag(p);
    group.add(fig, tag);
    return { fig, tag };
  });

  // Choice arrows (up to 4): a plate on the option cell and an arrow.
  const optMat = new THREE.MeshBasicMaterial({ color: '#58e0a0', transparent: true, opacity: 0.55, depthWrite: false });
  const arrowMat = new THREE.MeshBasicMaterial({ color: '#c8ffe4' });
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(0, 0.28); arrowShape.lineTo(0.2, 0.02); arrowShape.lineTo(0.08, 0.02); arrowShape.lineTo(0.08, -0.22);
  arrowShape.lineTo(-0.08, -0.22); arrowShape.lineTo(-0.08, 0.02); arrowShape.lineTo(-0.2, 0.02); arrowShape.closePath();
  const optionMeshes = DIRS.map(() => {
    const g = new THREE.Group();
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2), optMat);
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape).rotateX(-Math.PI / 2), arrowMat);
    arrow.position.y = 0.01;
    plate.renderOrder = arrow.renderOrder = 7;
    plate.raycast = arrow.raycast = () => {};
    g.add(plate, arrow);
    g.visible = false;
    scene.add(g);
    return { g, arrow };
  });
  for (const mat of [optMat, arrowMat]) terrainify(mat, { bridge: true });

  // --- monsters (looks) ---------------------------------------------------------
  // Each monster definition names a `look`; build its figure here. New
  // monsters add a look (or reuse one). Figures face +z, base at y = 0.
  const monsterMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  terrainify(monsterMat, { bridge: true });
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#ff5a3a', fog: false });
  terrainify(eyeMat, { bridge: true });
  const glowTex = (() => {
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
  const eyeGlowMat = new THREE.SpriteMaterial({
    map: glowTex, color: '#ff3a1a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const groundGlowMat = new THREE.MeshBasicMaterial({
    map: glowTex, color: '#8a0a10', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  terrainify(groundGlowMat, { bridge: true });
  const monsterLooks = {
    // A gaunt, stooped shape about 2.4 m tall with long arms and ember eyes.
    shade() {
      const parts = [];
      const add = (geo, hex) => {
        geo = geo.index ? geo.toNonIndexed() : geo;
        geo.deleteAttribute('uv');
        const c = new THREE.Color(hex);
        const col = new Float32Array(geo.attributes.position.count * 3);
        for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        parts.push(geo);
      };
      const cloak = '#16141a', skin = '#3a3438';
      add(new THREE.ConeGeometry(m(0.55), m(1.9), 9, 1, true).translate(0, m(0.95), 0), cloak);      // ragged robe
      add(new THREE.CylinderGeometry(m(0.22), m(0.34), m(0.7), 9).translate(0, m(1.95), m(0.08)), cloak); // stooped chest
      add(new THREE.SphereGeometry(m(0.2), 10, 8).scale(0.9, 1.15, 1).translate(0, m(2.35), m(0.22)), skin); // head, thrust forward
      for (const s of [-1, 1]) {
        add(new THREE.CylinderGeometry(m(0.05), m(0.04), m(1.3), 6).rotateX(-0.35).translate(s * m(0.34), m(1.55), m(0.28)), skin); // long arm
        add(new THREE.BoxGeometry(m(0.16), m(0.04), m(0.28)).translate(s * m(0.36), m(0.95), m(0.5)), skin);                     // claw
      }
      const root = new THREE.Group();
      const body = new THREE.Group();
      root.add(body);
      const mesh = new THREE.Mesh(mergeGeometries(parts), monsterMat);
      mesh.castShadow = true;
      mesh.raycast = () => {};
      body.add(mesh);
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(m(0.05), 8, 6), eyeMat);
        eye.position.set(s * m(0.08), m(2.38), m(0.39));
        eye.raycast = () => {};
        body.add(eye);
        // A soft ember halo round each eye, visible from any side and far off.
        const halo = new THREE.Sprite(eyeGlowMat);
        halo.position.copy(eye.position);
        halo.scale.setScalar(m(0.55));
        halo.renderOrder = 8;
        halo.raycast = () => {};
        body.add(halo);
      }
      // A faint blood-red stain of light on the ground where it stands.
      const pool = new THREE.Mesh(new THREE.CircleGeometry(m(2.4), 24).rotateX(-Math.PI / 2), groundGlowMat);
      pool.position.y = m(0.06);
      pool.renderOrder = 3;
      pool.raycast = () => {};
      root.add(pool);
      root.userData = { body };
      return root;
    },
  };

  const MONSTER_LOOK = (kind) => monsterDef(kind)?.look ?? 'shade';
  // Card monsters have their own figures (src/monsterModels.js); anything
  // else uses a look from monsterLooks. Each stands on a faint red glow.
  const models = createMonsterModels(terrainify);
  function monsterFigure(kind) {
    const card = MONSTER_BY_ID[kind];
    const fig = card ? models.buildMonster(kind, { count: card.badge }) : null;
    if (!fig) return (monsterLooks[MONSTER_LOOK(kind)] ?? monsterLooks.shade)();
    if (card.body === 'none') return fig; // nothing stands on the board
    const pool = new THREE.Mesh(new THREE.CircleGeometry(m(2.4), 24).rotateX(-Math.PI / 2), groundGlowMat);
    pool.position.y = m(0.06);
    pool.renderOrder = 3;
    pool.raycast = () => {};
    fig.add(pool);
    return fig;
  }

  // --- placing figures -----------------------------------------------------------
  // Where player k stands in cell i (its own quarter of the cell).
  function standAt(k, i) {
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    return new THREE.Vector3(p.x + SLOTS[k][0], cellTop(i), p.z + SLOTS[k][1]);
  }
  function centreOf(i) {
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    return new THREE.Vector3(p.x, cellTop(i), p.z);
  }
  const running = (a) => !!(a && (a.anim || a.queue.length));
  const inBoard = (i) => i >= 0 && i < grid.cells.length;
  function placeAll(force = false) {
    const s = g();
    if (!s) return;
    s.players.forEach((pl, k) => {
      const a = (view.actors[k] ??= { at: null, face: 0, vis: pl.pos, queue: [], anim: null });
      if (!inBoard(pl.pos) || (!force && running(a))) return;
      if (force) { a.queue = []; a.anim = null; }
      a.at = standAt(k, pl.pos);
      a.vis = pl.pos;
    });
    view.actors.length = s.players.length;
    syncMonsters(force);
  }
  // Monster figures follow state.monsters (created / removed as needed).
  function syncMonsters(force = false) {
    const s = g();
    const ids = new Set((s?.monsters ?? []).map((mo) => mo.id));
    for (const [id, mv] of view.monsters) if (!ids.has(id)) { group.remove(mv.fig); view.monsters.delete(id); }
    for (const mo of s?.monsters ?? []) {
      let mv = view.monsters.get(mo.id);
      if (!mv) {
        mv = { fig: monsterFigure(mo.kind), at: null, face: 0, vis: mo.pos, queue: [], anim: null, lunge: 0, lungeDir: 0 };
        group.add(mv.fig);
        view.monsters.set(mo.id, mv);
        force = true;
      }
      if (inBoard(mo.pos) && (force || !running(mv))) { mv.at = centreOf(mo.pos); mv.vis = mo.pos; if (force) { mv.queue = []; mv.anim = null; } }
    }
  }

  // --- townspeople (the Adze's victims) ------------------------------------------------------
  view.npcs = new Map();
  function syncNpcs(reset = false) {
    if (reset) { for (const [, n] of view.npcs) group.remove(n.fig); view.npcs.clear(); }
    for (const v of g()?.npcs ?? []) {
      let n = view.npcs.get(v.id);
      if (!n) {
        n = { fig: models.makeCivilian(v.name) };
        group.add(n.fig);
        view.npcs.set(v.id, n);
      }
      const p = centreOf(v.cell);
      n.fig.position.set(p.x - 0.18, p.y, p.z + 0.18);
      n.fig.userData.setDead(!v.alive);
    }
  }
  // Red rings under victims targeted this round.
  const victimRings = [0, 1, 2].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 28).rotateX(-Math.PI / 2).translate(0, 0.014, 0), dangerMat);
    r.raycast = () => {};
    r.renderOrder = 6;
    r.visible = false;
    group.add(r);
    return r;
  });
  function tickNpcs(t, s) {
    const targeted = new Set((s.monsters ?? []).flatMap((mo) => (mo.intents ?? []).flatMap((i) => i.ops.filter((o) => o.target !== undefined).map((o) => o.target))));
    const living = (s.npcs ?? []).filter((v) => v.alive);
    let k = 0;
    for (const v of s.npcs ?? []) {
      const n = view.npcs.get(v.id);
      if (!n) continue;
      n.fig.userData.tick(t);
      // A dead victim's target falls to the next living one.
      const aimed = v.alive && (targeted.has(v.target) || (living.length && [...targeted].some((tg) => !living.some((x) => x.target === tg)) && v === living[0]));
      if (aimed && k < victimRings.length) { victimRings[k].position.copy(n.fig.position); victimRings[k++].visible = true; }
    }
    for (; k < victimRings.length; k++) victimRings[k].visible = false;
  }

  // --- strikes that aren't a lunge: swarms and shadow grabs ---------------------------------
  const SWARM_STEP = 0.16; // seconds per cell for an Adze swarm
  function runStrike(strike) {
    if (strike.done) return;
    strike.done = true;
    for (const f of strike.fx ?? []) { try { f(); } catch (err) { console.error(err); } }
  }
  const grabs = [];
  function startGrab(seat, strike, type) {
    const a = view.actors[seat];
    const fig = models.makeShadowGrab();
    fig.position.copy(a?.at ?? centreOf(g().players[seat].pos));
    fig.userData.grow(0.01);
    group.add(fig);
    grabs.push({ fig, t: 0, strike });
    onAttack({ seat, cell: g().players[seat].pos, attack: type });
  }
  function tickGrabs(dt) {
    for (let k = grabs.length - 1; k >= 0; k--) {
      const gb = grabs[k];
      gb.t += dt;
      gb.fig.userData.grow(gb.t < 0.5 ? gb.t / 0.5 : gb.t > 1.5 ? Math.max(0, 1 - (gb.t - 1.5) / 0.5) : 1);
      if (gb.t > 0.6) runStrike(gb.strike);
      if (gb.t > 2) { group.remove(gb.fig); grabs.splice(k, 1); }
    }
  }
  // Shadow People: the darkness around each player standing in an unlit cell
  // ripples and reaches unnaturally.
  const darkTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    let seed = 7;
    PAINT.shadow(c.getContext('2d'), () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    return new THREE.CanvasTexture(c);
  })();
  const darkness = [0, 1, 2, 3].map(() => {
    const mat = new THREE.MeshBasicMaterial({ map: darkTex, transparent: true, depthWrite: false, opacity: 0.7 });
    terrainify(mat, { bridge: true });
    const o = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    o.position.y = 0.02;
    o.renderOrder = 2;
    o.raycast = () => {};
    o.visible = false;
    group.add(o);
    return o;
  });
  function tickDarkness(t, s) {
    const on = (s.monsters ?? []).some((mo) => MONSTER_BY_ID[mo.kind]?.body === 'none');
    darkness.forEach((o, k) => {
      const pl = s.players[k], a = view.actors[k];
      o.visible = on && !!pl && !pl.dead && !!a?.at && (board.light[pl.pos] ?? 0) < (s.config?.litThreshold ?? 0.5);
      if (!o.visible) return;
      o.position.set(a.at.x, a.at.y + 0.004, a.at.z);
      o.rotation.y = 0.4 * Math.sin(t * 0.7 + k) + t * 0.15;
      const w = 0.75 + 0.12 * Math.sin(t * 1.9 + k * 2) + 0.06 * Math.sin(t * 4.3 + k);
      o.scale.set(w, 1, 0.75 + 0.12 * Math.cos(t * 1.6 + k));
      o.material.opacity = 0.55 + 0.25 * Math.sin(t * 2.6 + k * 1.3);
    });
  }

  // --- evidence on the board ----------------------------------------------------------
  const discoveries = createDiscoveries(group, { cellToWorld, cellTop, terrainify });
  discoveries.setGrid(grid);
  // Hazards and traps from Event cards: a token on the cell.
  const HAZARD_ICONS = {
    sinkhole: '🕳', 'flooded-out': '🌊', 'flickering-lights': '💡', 'overgrown-brambles': '🌿', 'consecrated-ash': '✝',
    'coil-of-razor-wire': '➰', 'rusty-bear-trap': '⚙', 'deadfall-trap': '🪵', bonfire: '🔥', 'summoning-circle': '⛧',
  };
  const hazardTokens = new Map(); // cell:id -> mesh
  const hazardTex = {};
  function hazardTexture(id, trap) {
    const key = `${id}${trap}`;
    if (hazardTex[key]) return hazardTex[key];
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = trap ? '#3a2f22' : '#3a1414';
    x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
    x.lineWidth = 8; x.strokeStyle = trap ? '#c8a060' : '#e05040'; x.stroke();
    x.font = '64px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(HAZARD_ICONS[id] ?? '!', 64, 70);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return (hazardTex[key] = t);
  }
  function syncHazards() {
    const want = new Map((g()?.hazards ?? []).filter((h) => !h.used).map((h) => [`${h.cell}:${h.id}`, h]));
    for (const [k, mesh] of hazardTokens) if (!want.has(k)) { group.remove(mesh); hazardTokens.delete(k); }
    for (const [k, h] of want) {
      if (hazardTokens.has(k) || !inBoard(h.cell)) continue;
      const mat = new THREE.MeshBasicMaterial({ map: hazardTexture(h.id, h.by === 'player'), transparent: true, depthWrite: false });
      terrainify(mat, { bridge: true });
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.28, 32).rotateX(-Math.PI / 2), mat);
      const at = centreOf(h.cell);
      mesh.position.set(at.x + 0.22, at.y + 0.02, at.z + 0.22);
      mesh.renderOrder = 3;
      group.add(mesh);
      hazardTokens.set(k, mesh);
    }
  }

  // Holding the monster back, on the board: a ring of salt on each Salt
  // Circle, and the boombox (with its sound) on a Distract space. They go when
  // the effect does (after the monster's turn).
  const wardTokens = new Map(); // kind:cell -> mesh
  const wardTex = {};
  function wardTexture(kind) {
    if (wardTex[kind]) return wardTex[kind];
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    if (kind === 'salt') {
      // Coarse white grains poured in a ring.
      for (let k = 0; k < 2600; k++) {
        const a = r() * Math.PI * 2, rad = 96 + (r() - 0.5) * 22 * (1 + r());
        x.fillStyle = `rgba(${235 + r() * 20},${235 + r() * 20},${230 + r() * 20},${0.55 + r() * 0.45})`;
        x.fillRect(128 + Math.cos(a) * rad, 128 + Math.sin(a) * rad, 1.5 + r() * 2.5, 1.5 + r() * 2.5);
      }
    } else {
      // Sound rings round a little boombox.
      x.strokeStyle = 'rgba(255,214,120,0.8)';
      for (let k = 1; k <= 3; k++) { x.lineWidth = 7 - k * 1.5; x.beginPath(); x.arc(128, 128, 40 + k * 26, -0.9, 0.9); x.stroke(); x.beginPath(); x.arc(128, 128, 40 + k * 26, Math.PI - 0.9, Math.PI + 0.9); x.stroke(); }
      x.fillStyle = '#26282c'; x.fillRect(80, 100, 96, 56);
      x.fillStyle = '#c9a23a'; x.fillRect(80, 94, 96, 8);
      x.fillStyle = '#9a9ea4';
      for (const cx of [104, 152]) { x.beginPath(); x.arc(cx, 128, 18, 0, Math.PI * 2); x.fill(); }
      x.fillStyle = '#26282c';
      for (const cx of [104, 152]) { x.beginPath(); x.arc(cx, 128, 7, 0, Math.PI * 2); x.fill(); }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return (wardTex[kind] = t);
  }
  function syncWards() {
    const s = g();
    const want = new Map();
    for (const c of s?.saltCircles ?? []) if (c.round === s.round) want.set(`salt:${c.cell}`, { kind: 'salt', cell: c.cell });
    for (const mo of s?.monsters ?? []) if (mo.lure?.round === s.round) want.set(`lure:${mo.lure.cell}`, { kind: 'lure', cell: mo.lure.cell });
    for (const [k, mesh] of wardTokens) if (!want.has(k)) { group.remove(mesh); wardTokens.delete(k); }
    for (const [k, w] of want) {
      if (wardTokens.has(k) || !inBoard(w.cell)) continue;
      const mat = new THREE.MeshBasicMaterial({ map: wardTexture(w.kind), transparent: true, depthWrite: false });
      terrainify(mat, { bridge: true });
      const size = w.kind === 'salt' ? 0.98 : 0.7;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), mat);
      const at = centreOf(w.cell);
      mesh.position.set(at.x, at.y + 0.025, at.z);
      mesh.renderOrder = 3;
      group.add(mesh);
      wardTokens.set(k, mesh);
    }
  }

  // Picking a space on the board (Distract): the spaces that can be chosen,
  // lit amber.
  const pickMat = new THREE.MeshBasicMaterial({ color: '#ffc04a', transparent: true, opacity: 0.32, depthWrite: false });
  terrainify(pickMat, { bridge: true });
  let pickMesh = null;
  function showPick(cells) {
    if (pickMesh) { group.remove(pickMesh); pickMesh.dispose(); pickMesh = null; }
    if (!cells?.length) return;
    pickMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.86, 0.86).rotateX(-Math.PI / 2), pickMat, cells.length);
    const m4 = new THREE.Matrix4();
    cells.forEach((cell, n) => { const at = centreOf(cell); m4.makeTranslation(at.x, at.y + 0.03, at.z); pickMesh.setMatrixAt(n, m4); });
    pickMesh.renderOrder = 4;
    pickMesh.raycast = () => {};
    group.add(pickMesh);
  }

  function refreshDiscoveries() {
    syncHazards();
    syncWards();
    const my = g()?.mystery;
    const list = (my?.found ?? []).slice(0, view.shownFinds).map((f) => ({
      cell: f.cell, visual: evidenceVisual(f.kind, f.code), lair: f.kind === 'lair',
    }));
    if (my && my.spawnCell >= 0 && !my.revealed) list.push({ cell: my.spawnCell, visual: 'spawn', lair: false });
    discoveries.update(list);
  }

  // --- events from the rules → animation -------------------------------------------
  function attachToArrival(a, cell, fx) {
    // Play `fx` when the runner reaches `cell` (or now, if already there).
    const q = a && [...a.queue].reverse().find((e) => e.to === cell && !e.fx);
    if (q) q.fx = fx;
    else if (a?.anim && a.anim.to === cell && !a.anim.fx) a.anim.fx = fx;
    else fx();
  }
  function handleEvents(state, events) {
    for (const e of events) {
      switch (e.type) {
        case 'loaded':
        case 'start':
          // A loaded game shows what had already happened: markers used,
          // doors unlocked, evidence found, monsters where they stood.
          view.shownUsed = new Set(e.type === 'loaded' ? state.used ?? [] : []);
          view.shownKeys = e.type === 'loaded' ? state.keys ?? 0 : 0;
          view.rollT = ROLL_TIME;
          view.pan = true;
          for (const [, mv] of view.monsters) group.remove(mv.fig);
          view.monsters.clear();
          view.shownFinds = state.mystery?.found.length ?? 0;
          syncNpcs(true);
          view.actors = [];
          placeAll(true);
          if (e.type === 'loaded') { syncMonsters(true); refreshDiscoveries(); }
          onUsed();
          break;
        case 'rolled':
          view.rollT = 0;
          break;
        case 'step': {
          const a = view.actors[e.seat];
          if (a) a.queue.push({ from: e.from, to: e.to, fx: null });
          break;
        }
        case 'collect':
          attachToArrival(view.actors[e.seat], e.cell, () => {
            view.shownUsed.add(e.cell);
            if (e.keyGroup >= 0) view.shownKeys |= 1 << e.keyGroup;
            onCollect(e.cell, e.marker, e.text);
            onUsed();
          });
          break;
        case 'obol':
          onObol({ player: state.players[e.seat], type: e.obol, left: e.left });
          break;
        case 'equipUse':
          onEquip({ ...e, player: state.players[e.seat] });
          break;
        case 'won':
          onGameOver({ won: true });
          break;
        case 'hazard':
        case 'trap':
          refreshDiscoveries();
          break;
        case 'doors':
          refreshDiscoveries();
          onUsed(); // redraw the walls: nailed, chained or breached doors
          break;
        case 'doorBash':
          onUsed(); // the door shows the damage
          break;
        case 'card':
          attachToArrival(view.actors[e.seat], e.cell, () => onCard({ ...e, player: state.players[e.seat] }));
          break;
        case 'turn':
          view.pan = true;
          break;
        case 'midnight':
          onUsed(); // objectives appear
          break;
        case 'evidence':
          attachToArrival(e.seat === null ? null : view.actors[e.seat], e.cell, () => {
            view.shownFinds = Math.max(view.shownFinds, (g()?.mystery?.found.findIndex((f) => f.cell === e.cell && f.code === e.code) ?? -1) + 1);
            refreshDiscoveries();
            onEvidence({ ...e, player: g()?.players[e.seat] });
          });
          break;
        case 'attacked':
          attachToArrival(view.actors[e.seat], e.cell, () => {
            view.shownFinds = Math.max(view.shownFinds, g()?.mystery?.found.length ?? 0);
            refreshDiscoveries();
            onAttack({ seat: e.seat, cell: e.cell, attack: e.attack });
            onAttacked({ ...e, player: g()?.players[e.seat] });
          });
          break;
        case 'named':
          onNamed(e);
          refreshDiscoveries();
          onUsed();
          break;
        case 'monsterRevealed':
          onMonsterRevealed(e);
          refreshDiscoveries();
          break;
        case 'monsterSpawn':
          syncMonsters(true);
          if (MONSTER_BY_ID[e.kind]?.body !== 'none') view.watch = { id: e.id, until: performance.now() + 3200 };
          onMonster({ kind: e.kind, cell: e.cell, appeared: true });
          break;
        case 'monsterStep': {
          syncMonsters();
          const mv = view.monsters.get(e.id);
          if (mv) mv.queue.push({ from: e.from, to: e.to });
          view.watch = { id: e.id, until: performance.now() + 1500 };
          break;
        }
        case 'monsterAttack': {
          if (e.grab) {
            // Shadow People: silhouettes rise around the player when they
            // visibly step into the light, reaching for their shadow.
            const strike = { fx: [] };
            view.lastStrike = strike;
            attachToArrival(view.actors[e.seat], e.cell, () => startGrab(e.seat, strike, e.attack));
            break;
          }
          const mv = view.monsters.get(e.id);
          const strike = { attack: e.seat, cell: e.cell, type: e.attack, fx: [] };
          view.lastStrike = strike;
          if (mv) mv.queue.push(strike);
          view.watch = { id: e.id, until: performance.now() + 1500 };
          break;
        }
        case 'crafted':
          if (e.target !== null) placeAll(true); // brought back: stand them up beside their rescuer
          onCraft({ ...e, player: state.players[e.seat], targetPlayer: e.target === null ? null : state.players[e.target] });
          break;
        case 'npcs':
          syncNpcs();
          break;
        case 'npcAttacked': {
          const fx = () => {
            const n = view.npcs.get(e.npc);
            if (n && e.outcome === 'killed') n.fig.userData.setDead(true);
            onNpc({ ...e, npc: g()?.npcs?.find((v) => v.id === e.npc), defenderPlayer: e.defender === null ? null : g()?.players[e.defender] });
          };
          if (view.lastStrike && !view.lastStrike.done) view.lastStrike.fx.push(fx); else fx();
          break;
        }
        case 'exhausted': {
          const fx = () => onExhaust({ ...e, player: g()?.players[e.seat] });
          if (view.lastStrike && !view.lastStrike.done) view.lastStrike.fx.push(fx); else fx();
          break;
        }
        case 'monsterSwarm': {
          // Adze: a fly swarm leaves the cocoon and flies to its victim.
          const mv = view.monsters.get(e.id);
          const strike = { swarm: e.path, type: e.attack, fx: [] };
          view.lastStrike = strike;
          if (mv) mv.queue.push(strike);
          break;
        }
        case 'monsterTeleport': {
          const mv = view.monsters.get(e.id);
          if (mv) mv.queue.push({ from: e.to, to: e.to });
          break;
        }
        case 'damage': {
          if (e.source === 'Something unseen') break; // shown with the Attack Obol
          const fx = () => onDamage({ ...e, player: g()?.players[e.seat] });
          // Monster strikes: show when the blow visibly lands (lunge, swarm, grab).
          if (view.lastStrike && !view.lastStrike.done) view.lastStrike.fx.push(fx); else fx();
          break;
        }
        case 'sacrifice':
          onSacrifice({ ...e, player: g()?.players[e.seat], carrierPlayer: g()?.players[e.carrier] });
          break;
        case 'reacted':
          if (e.item) onSacrifice({ ...e, reacted: true, player: g()?.players[e.seat] });
          break;
        case 'monsterIntent':
          onIntent(e);
          break;
        case 'gameOver':
          onGameOver();
          break;
        default:
      }
    }
    refreshDiscoveries();
    applyVisibility();
    showOptions();
    onChange();
  }

  // --- actions (everything goes through the session) ------------------------------
  const act = (action) => {
    const s = g();
    if (!s) return false;
    return session.dispatch({ ...action, seat: s.cur }).ok;
  };
  const rolling = () => view.rollT < ROLL_TIME;
  function roll() { return g()?.phase === 'idle' && act({ type: 'roll' }); }
  function toggleSlot(n, to = 'move') { if (!rolling()) act({ type: 'slot', die: n, to }); }
  function rollWhite() { if (!rolling()) act({ type: 'rollWhite' }); }
  function confirmMove() { if (!rolling()) act({ type: 'move' }); }
  function endTurn() { if (!rolling()) act({ type: 'end' }); }
  function answerInvestigate(yes) { act({ type: 'investigate', yes: !!yes }); }
  function choose(i) { return g()?.phase === 'choosing' && act({ type: 'choose', cell: i }); }
  function craft(recipe, pay, target) { return act({ type: 'craft', recipe, pay, target }); }
  // Equipment: returns { ok, error } so the sheet can say why not.
  function useEquipment(use) {
    const s = g();
    if (!s) return { ok: false, error: 'no game' };
    return session.dispatch({ type: 'use', ...use, seat: s.cur });
  }
  // Sacrifice: the Fetish's carrier answers, whoever's turn it is.
  function sacrifice(yes) {
    const s = g();
    return !!s && session.dispatch({ type: 'sacrifice', yes: !!yes, seat: sacrificeSeat(s) }).ok;
  }
  // A weakness discard offered at the moment: the player who was hit answers.
  function react(yes) {
    const s = g();
    return !!s && session.dispatch({ type: 'react', yes: !!yes, seat: sacrificeSeat(s) }).ok;
  }
  // Lucky: set a die's value.
  function setDie(n, v) { return act({ type: 'setDie', die: n, v }); }
  function revealCard(n) { return act({ type: 'reveal', card: n }); }
  function nameMonster(id) { return act({ type: 'name', monster: id }); }
  // Pips on dice slotted into Movement but not yet moved.
  const slotTotal = () => { const s = g(); return s ? s.slots.reduce((a, n) => a + (s.pool[n] && !s.pool[n].spent ? s.pool[n].v : 0), 0) : 0; };
  // Rolled dice not used for movement or defense (ending the turn wastes them).
  const unusedCount = () => { const s = g(); return s ? s.pool.filter((d, n) => !d.spent && !s.defSlots.includes(n)).length : 0; };

  // Arrow keys: pick the option closest to the camera-relative direction.
  function chooseByKey(key) {
    const s = g();
    if (s?.phase !== 'choosing') return false;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = { ArrowUp: fwd, ArrowDown: fwd.clone().negate(), ArrowRight: right, ArrowLeft: right.clone().negate() }[key];
    if (!want) return false;
    let best = null, bestDot = 0.3;
    for (const o of s.options) {
      const d = o.dx * want.x + o.dy * want.z;
      if (d > bestDot) { bestDot = d; best = o; }
    }
    if (best) choose(best.i);
    return true;
  }

  function showOptions() {
    const opts = g()?.phase === 'choosing' ? g().options : [];
    optionMeshes.forEach((mo, n) => {
      const o = opts[n];
      mo.g.visible = !!o && group.visible;
      if (!o) return;
      const { x, y } = grid.coords(o.i);
      const p = cellToWorld(x, y);
      mo.g.position.set(p.x, cellTop(o.i) + 0.03, p.z);
      mo.arrow.rotation.y = Math.atan2(-o.dx, -o.dy);
    });
  }

  // --- new games ------------------------------------------------------------------------
  function reset() {
    session.start({
      config: cfg,
      startMode: view.startMode,
      followStreets: view.followStreets,
      seed: (Math.random() * 2 ** 32) >>> 0,
    });
  }
  // Saved games: the full rules state out, and back in.
  function saveState() { return session.snapshot(); }
  function loadState(saved) {
    view.startMode = saved.startMode === 'midnight' ? 'midnight' : 'standard';
    view.followStreets = saved.followStreets ?? true;
    stale = false;
    session.load(saved);
  }
  function setStartMode(mode) {
    view.startMode = mode === 'midnight' ? 'midnight' : 'standard';
    reset();
  }
  function setPlayers(n) {
    cfg.players = Math.max(1, Math.min(4, n | 0 || 1));
    reset();
  }

  // --- per frame ---------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  let last = performance.now();
  // Is anything animating (so the renderer should run at full rate)?
  function busy() {
    return rolling() || !!view.watch || grabs.length > 0 || view.actors.some(running) || [...view.monsters.values()].some((mv) => running(mv) || mv.lunge > 0)
      || (view.pan && group.visible);
  }
  function tick(_dt, t) {
    // Wall-clock timing so rolls and hops take the same time on slow machines.
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!group.visible) return;
    const s = g();
    discoveries.tick(t);
    halo.material.opacity = 0.55 + 0.3 * Math.sin(t * 3);
    halo.material.color.set(s.players[s.cur]?.colour ?? '#fff');
    for (const mo of optionMeshes) if (mo.g.visible) mo.arrow.position.y = 0.01 + 0.02 * (1 + Math.sin(t * 5));
    if (rolling()) {
      view.rollT += dt;
      const face = 1 + Math.floor((view.rollT * 14) % 6);
      if (face !== view.rollFace || !rolling()) { view.rollFace = face; onChange(); }
    }
    // Every player runs their own queued path (several can run at once).
    const stepTime = view.fast ? FAST_STEP : STEP_TIME(METERS_PER_CELL);
    view.actors.forEach((a, k) => {
      if (!a.anim && a.queue.length) a.anim = { ...a.queue.shift(), t: 0 };
      const an = a.anim;
      if (!an) return;
      an.t = Math.min(1, an.t + dt / stepTime);
      a.at = standAt(k, an.from).lerp(standAt(k, an.to), an.t); // steady jog, no stop between cells
      figures[k].fig.userData.phase += (METERS_PER_CELL * dt / stepTime) * STRIDES_PER_M * Math.PI * 2;
      const da = grid.coords(an.from), db = grid.coords(an.to);
      a.face = Math.atan2(db.x - da.x, db.y - da.y);
      if (an.t >= 1) {
        a.anim = null;
        a.vis = an.to;
        a.at = standAt(k, an.to);
        try { an.fx?.(); } catch (e) { console.error(e); } // marker burst when they actually get there
        if (!running(a)) onChange(); // arrived: refresh the status
      }
    });
    // Monsters: stalk cell to cell, then lunge.
    const mStep = view.fast ? FAST_STEP : MONSTER_STEP;
    tickGrabs(dt);
    tickDarkness(t, s);
    tickNpcs(t, s);
    for (const [, mv] of view.monsters) {
      if (!mv.anim && mv.queue.length) mv.anim = Object.assign(mv.queue.shift(), { t: 0 });
      const an = mv.anim;
      if (an?.swarm) {
        // Fly the swarm along its route, strike, then let it scatter.
        if (!an.cloud) { an.cloud = models.makeSwarm(); group.add(an.cloud); }
        const n = an.swarm.length - 1;
        an.t = Math.min(n + 0.6, an.t + dt / SWARM_STEP);
        const k = Math.min(n, an.t), i = Math.floor(k);
        const a = centreOf(an.swarm[i]), b = centreOf(an.swarm[Math.min(n, i + 1)]);
        an.cloud.position.copy(a.lerp(b, k - i));
        an.cloud.userData.tick(t);
        an.cloud.scale.setScalar(an.t > n ? Math.max(0.05, 1 - (an.t - n) / 0.6) : 1);
        if (an.t >= n && !an.done) { onAttack({ attack: an.type }); runStrike(an); }
        if (an.t >= n + 0.6) { group.remove(an.cloud); mv.anim = null; }
      } else if (an?.attack !== undefined) {
        // Lunge toward the victim's cell, then recoil.
        if (an.t === 0) {
          const tc = grid.coords(an.cell), mc = grid.coords(mv.vis);
          if (an.cell !== mv.vis) mv.face = Math.atan2(tc.x - mc.x, tc.y - mc.y);
          onAttack({ seat: an.attack, cell: an.cell, attack: an.type });
        }
        an.t = Math.min(1, an.t + dt / LUNGE_TIME);
        mv.lunge = Math.sin(an.t * Math.PI);
        if (an.t >= 1) {
          mv.anim = null; mv.lunge = 0;
          runStrike(an);
        }
      } else if (an) {
        an.t = Math.min(1, an.t + dt / mStep);
        mv.at = centreOf(an.from).lerp(centreOf(an.to), an.t);
        const da = grid.coords(an.from), db = grid.coords(an.to);
        mv.face = Math.atan2(db.x - da.x, db.y - da.y);
        if (an.t >= 1) { mv.anim = null; mv.vis = an.to; mv.at = centreOf(an.to); }
      }
      if (!mv.at) continue;
      mv.fig.visible = true;
      mv.fig.position.copy(mv.at);
      mv.fig.rotation.y += (((mv.face - mv.fig.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 6);
      const body = mv.fig.userData.body;
      const idle = mv.fig.userData.tick;
      body.rotation.x = (idle ? 0 : 0.15) + 0.5 * mv.lunge + 0.04 * Math.sin(t * 1.3);   // (stoop), lunge forward
      body.position.z = m(0.9) * mv.lunge;
      if (idle) idle(t, dt);
      else body.position.y = m(0.04) * Math.sin(t * 2.1);                    // a slow, uneasy sway
    }
    // Figures, the turn ring and name tags.
    const danger = new Set((s.monsters ?? []).flatMap((mo) => mo.danger ?? []));
    dangerMat.opacity = 0.55 + 0.4 * Math.sin(t * 6);
    for (const mat of Object.values(dangerMats)) mat.opacity = dangerMat.opacity;
    dangerRings.forEach((r, k) => {
      const a = view.actors[k];
      r.visible = danger.has(k) && !!a?.at && !s.players[k]?.dead;
      if (!r.visible) return;
      r.position.copy(a.at);
      // Several threats of different types: the ring cycles through their colours.
      const types = [...new Set((s.monsters ?? []).flatMap((mo) => mo.dangerTypes?.[k] ?? []))];
      r.material = dangerMats[types[Math.floor(t * 1.2) % Math.max(1, types.length)]] ?? dangerMat;
    });
    figures.forEach(({ fig, tag }, k) => {
      const a = view.actors[k];
      const on = !!a && !!a.at && !s.players[k]?.dead;
      fig.visible = tag.visible = on;
      if (!on) return;
      fig.position.copy(a.at);
      // Midnight: the flashlight flickers too, each on its own rhythm.
      const fl = flickerAt(0.13 + 0.21 * k, dreadUniforms.uDreadTime.value, dreadUniforms.uDread.value);
      fig.userData.lensMat.color.copy(LENS_COLOUR).multiplyScalar(fl);
      fig.userData.beamMat.opacity = BEAM_OPACITY * fl;
      // Run pose: blend in while moving, out when stopped.
      const u = fig.userData;
      const target = a.anim ? 1 : 0;
      u.run += (target - u.run) * Math.min(1, dt * 8);
      const sw = Math.sin(u.phase) * u.run;
      u.limbs.legL.rotation.x = sw * 0.75;
      u.limbs.legR.rotation.x = -sw * 0.75;
      u.limbs.armL.rotation.x = -sw * 0.7;
      // The flashlight arm doesn't swing with the stride: it's held up and
      // steady, and deliberately points around, settling on a new spot every
      // few seconds (narrower while running, wider when standing still).
      const aim = (u.aim ??= { yaw: 0, pitch: 0, toYaw: 0, toPitch: 0, next: 0 });
      if (t >= aim.next) {
        const wide = a.anim ? 0.3 : 0.75;
        const r = Math.sin(t * 12.9898 + k * 78.233) * 43758.5453;
        const f = r - Math.floor(r);
        aim.toYaw = (f * 2 - 1) * wide;
        aim.toPitch = a.anim ? 0 : ((f * 7) % 1 - 0.5) * 0.25;
        aim.next = t + 1.8 + 2.5 * ((f * 13) % 1);
      }
      const ease = 1 - Math.exp(-dt * 2.2);   // smooth, unhurried turns
      aim.yaw += (aim.toYaw - aim.yaw) * ease;
      aim.pitch += (aim.toPitch - aim.pitch) * ease;
      u.limbs.armR.rotation.set(-0.34 + aim.pitch + 0.03 * sw, aim.yaw, 0);
      u.torso.position.y = Math.abs(Math.cos(u.phase)) * m(0.06) * u.run;
      u.torso.rotation.x = 0.12 * u.run; // lean into the run
      fig.rotation.y += (((a.face - fig.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10);
      // Tag: stays a readable size on screen, and fades out when zoomed in
      // close (where the figures themselves are easy to see).
      const d = camera.position.distanceTo(a.at);
      const size = Math.max(0.14, d * 0.035);
      // Players sharing a cell stack their tags so they don't cover each other.
      const sameCell = a.anim ? 0 : view.actors.filter((q, j) => j < k && q && !q.anim && q.vis === a.vis).length;
      const fade = THREE.MathUtils.smoothstep(d, 2.5, 7);
      tag.position.set(a.at.x, a.at.y + m(2.1) + sameCell * size * 0.8 * fade, a.at.z);
      tag.scale.set(size, size * 0.75, 1);
      const pulse = k === s.cur ? 0.15 * Math.sin(t * 4) : 0;
      tag.material.opacity = Math.min(1, 0.12 + 0.88 * fade + pulse);
    });
    const cur = view.actors[s.cur];
    if (cur?.at) halo.position.copy(cur.at);
    halo.visible = !!cur?.at;

    // Camera visits a monster when it appears or moves (and stays while it
    // stalks or lunges), then returns to the current player.
    const wmv = view.watch && view.monsters.get(view.watch.id);
    if (wmv && (running(wmv) || wmv.lunge > 0 || performance.now() < view.watch.until)) {
      if (view.follow && wmv.at) {
        tmp.set(wmv.at.x, 0, wmv.at.z).sub(controls.target);
        tmp.y = 0;
        tmp.multiplyScalar(Math.min(1, dt * 3));
        controls.target.add(tmp);
        camera.position.add(tmp);
      }
      view.pan = true; // come back to the player afterwards
      return;
    }
    view.watch = null;
    // Camera follows the current player gently (keeps the same viewing
    // angle): while they run, and to pan over when the turn changes.
    if (view.follow && (running(cur) || view.pan) && cur?.at) {
      // While running, drift ahead toward where the runner will next stop for
      // a decision (a fork, a marker, the end of the move): the rules have
      // already taken them there.
      const dest = running(cur) && inBoard(s.players[s.cur]?.pos ?? -1) ? centreOf(s.players[s.cur].pos) : cur.at;
      const lead = running(cur) ? 0.65 : 0;
      tmp.set(cur.at.x + (dest.x - cur.at.x) * lead, 0, cur.at.z + (dest.z - cur.at.z) * lead).sub(controls.target);
      tmp.y = 0;
      if (!running(cur) && tmp.length() < 0.05) view.pan = false;
      tmp.multiplyScalar(Math.min(1, dt * (running(cur) ? 1.6 : 3)));
      controls.target.add(tmp);
      camera.position.add(tmp);
    } else if (!running(cur)) view.pan = false;
  }

  let active = false;
  let stale = false; // settings changed since this game started: start afresh next time
  function applyVisibility() { group.visible = active && inBoard(g()?.players[g().cur]?.pos ?? -1); }
  function setActive(on) {
    active = on;
    const s = g();
    if (on && (stale || !s || !inBoard(s.players[s.cur]?.pos ?? -1) || s.phase === 'nostart')) { stale = false; reset(); }
    applyVisibility();
    showOptions();
  }

  // The board changed: keep playing if the pawn's cell still exists.
  function boardChanged() {
    board.invalidate();
    const s = g();
    if (!s) return;
    if (s.players.some((pl) => pl.pos >= grid.cells.length) || (s.phase === 'nostart' && board.startCell() >= 0)) reset();
    else { placeAll(); showOptions(); }
  }

  // What the rest of the app reads: the game state plus view details.
  const cp = () => g()?.players[g().cur];
  const state = {
    get phase() { return rolling() ? 'rolling' : g()?.phase ?? 'nostart'; },
    get players() { return g()?.players ?? []; },
    get cur() { return g()?.cur ?? 0; },
    get pos() { return cp()?.pos ?? -1; },
    get prev() { return cp()?.prev ?? -1; },
    get white() { return cp()?.white ?? 0; },
    get steps() { return g()?.steps ?? 0; },
    get roll() { return g()?.roll ?? 0; },
    get options() { return g()?.phase === 'choosing' ? g().options : []; },
    get stopReason() { return g()?.stopReason ?? ''; },
    get pool() { return g()?.pool ?? []; },
    get slots() { return g()?.slots ?? []; },
    get maxSlots() { return g()?.maxSlots ?? 0; },
    get defSlots() { return g()?.defSlots ?? []; },
    get maxDefense() { return g()?.maxDefense ?? 0; },
    get deathsDoor() { return !!g()?.deathsDoor; },
    get disabledDice() { return g()?.disabledDice ?? 0; },
    get lit() { return !!g()?.lit; },
    get bag() { return g()?.bag ?? []; },
    get decks() { return g()?.decks ?? null; }, // the card decks (Obolcraft's Draw an Equipment card reads them)
    get ask() { return g()?.ask ?? null; },
    get lucky() { return !!g()?.lucky; },              // Lucky: dice values can be chosen
    get sacrifice() { return g()?.sacrifice ?? []; },  // fallen players waiting on a Sacrifice
    get keys() { return g()?.keys ?? 0; },
    get turn() { return g()?.turn ?? 0; },
    get round() { return g()?.round ?? 1; },
    set round(v) { if (g()) g().round = v; },
    get log() { return g()?.log ?? []; },
    get blackCount() { return g()?.blackCount ?? 0; },
    get monsters() { return g()?.monsters ?? []; },
    get mystery() { return g()?.mystery ?? null; },
    get npcs() { return g()?.npcs ?? []; },
    get cfg() { return g()?.config ?? cfg; },
    get count() { return g()?.players.length ?? cfg.players; },
    get startMode() { return view.startMode; },
    get followStreets() { return view.followStreets; },
    set followStreets(v) { view.followStreets = !!v; if (g()) act({ type: 'setting', key: 'followStreets', value: !!v }); },
    // Quick or Tactical movement: switchable mid-game (the rules read it at
    // every step), and kept as the default for new games.
    get movement() { return (g()?.config ?? cfg).movement === 'tactical' ? 'tactical' : 'quick'; },
    set movement(v) {
      const m = v === 'tactical' ? 'tactical' : 'quick';
      cfg.movement = m;
      if (g()) act({ type: 'setting', key: 'movement', value: m });
    },
    get follow() { return view.follow; },
    set follow(v) { view.follow = !!v; },
    get fast() { return view.fast; },
    get rollFace() { return view.rollFace; },
    get shownUsed() { return view.shownUsed; },
  };

  return {
    // Game settings changed outside a game: the next game starts fresh with them.
    invalidate: () => { stale = true; },
    state, session, board, roll, reset, setStartMode, saveState, loadState, useEquipment, answerInvestigate, choose, chooseByKey, tick, setActive,
    boardChanged, setPlayers, toggleSlot, confirmMove, endTurn, unusedCount, slotTotal, rollWhite, busy, revealCard, nameMonster, craft, sacrifice, setDie, react,
    clockMinutes: () => (g() ? rulesClockMinutes(g()) : rulesStartMinutesFor(cfg)),
    startMinutes: () => (g() ? rulesStartMinutes(g()) : rulesStartMinutesFor(cfg)),
    midnight: () => (g() ? isMidnight(g()) : false),
    setFast: (on) => { view.fast = !!on; },
    // Doors visibly unlocked by keys the runners have reached (edge keys).
    unlockedEdges: () => {
      const out = new Set();
      if (!view.shownKeys) return out;
      board.keyGroups().groups.forEach((kg, gi) => { if (view.shownKeys & (1 << gi)) for (const k of kg.doors) out.add(k); });
      return out;
    },
    showPick,
    // Doors the game changed: edge key -> 'blocked' | 'breached' | 'open'.
    doorLooks: () => new Map(Object.entries(g()?.doors ?? {})),
    // Doors a monster has been bashing: edge key -> share of health gone (0..1).
    doorDamage: () => {
      const s = g();
      const out = new Map();
      for (const [k, hp] of Object.entries(s?.doorHp ?? {})) {
        const max = s.doorMax?.[k] ?? DOOR_HP;
        if (hp < max) out.set(k, Math.min(1, (max - hp) / max));
      }
      return out;
    },
    // Is anyone still running into place?
    anyRunning: () => view.actors.some(running),
    isOption: (i) => g()?.phase === 'choosing' && g().options.some((o) => o.i === i),
  };
}

const rulesStartMinutesFor = (cfg) => 24 * 60 - cfg.turnMinutes * cfg.turnsToMidnight;
