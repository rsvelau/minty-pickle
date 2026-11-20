// Playable demo: up to four players take turns. Each starts on the Start
// space, rolls a black die and moves that many spaces, choosing a direction
// at every fork. Players are small stylised 90s figures (to scale) that each
// stand in their own quarter of a cell, with a name tag that shows where they
// are on the map (it fades out when you zoom in close).
//
// Movement uses the board's rules (GridState.canStep): walkable cells only;
// walls, windows and locked doors block; one-way doors go one way; walking
// over a Key unlocks the locked and one-way doors of its building. The pawn
// keeps going while there is only one way forward (it never turns back
// unless it hits a dead end) and stops to ask at forks and at the start of
// each move.
import * as THREE from 'three';
import { MARKERS, streetMask, edgeKey } from './state.js';
import { m, METERS_PER_CELL } from './scale.js';
import { dreadUniforms, flickerAt } from './dread.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The four players: name tag colour (also their jacket), hair, extras.
export const PLAYERS = [
  { name: 'P1', colour: '#18b7a6', accent: '#f2e9d0', hair: '#2a1a10', cap: false, pack: 'schoolbag', torch: '#1c1c1e' },
  { name: 'P2', colour: '#e0407e', accent: '#2b2b6e', hair: '#d9b25a', cap: false, pack: 'neon', torch: '#e8c22a' },
  { name: 'P3', colour: '#f0b52a', accent: '#5a2a8a', hair: '#1a1410', cap: true, pack: 'daypack', torch: '#b8252a' },
  { name: 'P4', colour: '#7a54e8', accent: '#2fd0c0', hair: '#7a3a1c', cap: false, pack: 'hiker', torch: '#5a5f66' },
];
// Where each player stands inside a cell (cell units from its centre).
const SLOTS = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];

const DIRS = [[0, -1, 'north', 1], [1, 0, 'east', 2], [0, 1, 'south', 4], [-1, 0, 'west', 8]];
// Players jog: ~2.7 m/s, so one 7 m cell takes about 2.6 s. Holding the
// screen fast-forwards to FAST_STEP per cell.
const JOG_SPEED = 2.7;                        // metres per second
const STEP_TIME = (TILE_M) => TILE_M / JOG_SPEED;
const FAST_STEP = 0.32;                       // seconds per cell when fast-forwarding
const STRIDES_PER_M = 0.78;                   // running cadence: leg cycles per metre
const ROLL_TIME = 0.7;    // die tumble before it lands
// Game configuration: the adjustable mechanics (Game settings in the UI).
// - Dice: everyone starts with `startBlack` black dice (renew each turn);
//   `moveSlots` movement slots, or `litSlots` when the turn starts in a cell
//   lit at least `litThreshold` (0..1).
// - Clock: each turn (every player moving once) is `turnMinutes`; midnight
//   comes after `turnsToMidnight` turns (11 PM with the defaults). Objective
//   markers stay hidden until midnight.
// - Markers: `stopAtMarkers` stops the runner on every marker to choose a
//   way on; `askInvestigate` asks "Investigate?" on Investigation spaces.
// - Obols: the bag investigators draw from, by type.
export const DEFAULT_CONFIG = Object.freeze({
  players: 4,          // characters in play, 1 (solo) to 4
  startBlack: 2,
  moveSlots: 2,
  litSlots: 3,
  litThreshold: 0.5,
  turnMinutes: 5,
  turnsToMidnight: 12,
  stopAtMarkers: true,
  askInvestigate: true,
  obols: Object.freeze({ attack: 7, event: 7, equipment: 7, evidence: 7 }),
});
export const defaultConfig = () => ({ ...DEFAULT_CONFIG, obols: { ...DEFAULT_CONFIG.obols } });

// Obols: coins drawn at random when investigating.
export const OBOLS = {
  attack: { label: 'Attack', note: 'bloody red' },
  event: { label: 'Event', note: 'misty blue' },
  equipment: { label: 'Equipment', note: 'shiny green' },
  evidence: { label: 'Evidence', note: 'glowing yellow' },
};
export const OBOL_TYPES = Object.keys(OBOLS);
// How many of each Obol a player holds.
export const obolCounts = (pl) => Object.fromEntries(
  OBOL_TYPES.map((t) => [t, pl?.inventory?.obolcraft.filter((o) => o.type === t).length ?? 0]));
// Inventory tabs.
export const INVENTORY_TABS = {
  equipment: { label: 'Equipment', empty: 'No equipment yet. Anything you find to use will be kept here.' },
  obolcraft: { label: 'Obolcraft', empty: 'No Obols yet. Investigate to find them.' },
};
export const MIDNIGHT = 24 * 60;
// "11:05 PM", "12:00 AM".
export function formatClock(min) {
  const h24 = Math.floor(min / 60) % 24, mm = min % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function createPlay({
  grid, scene, camera, controls, cellToWorld, cellTop, terrainify, cellLabel, onChange,
  onUsed = () => {}, onCollect = () => {}, lightAt = () => 0, onObol = () => {},
  config = defaultConfig(),
}) {
  const cfg = config; // live: Game settings edits this object
  const st = {
    cfg,
    players: [],       // [{ name, colour, pos, prev, white, black, figure, tag }]
    count: Math.max(1, Math.min(4, cfg.players | 0 || 4)), // how many players (1-4; 1 = solo)
    startMode: 'standard', // 'standard' (11 PM) or 'midnight' (starts at midnight, objectives out)
    cur: 0,            // whose turn
    get pos() { return this.players[this.cur]?.pos ?? -1; },
    set pos(v) { if (this.players[this.cur]) this.players[this.cur].pos = v; },
    get prev() { return this.players[this.cur]?.prev ?? -1; },
    set prev(v) { if (this.players[this.cur]) this.players[this.cur].prev = v; },
    get white() { return this.players[this.cur]?.white ?? 0; },
    set white(v) { if (this.players[this.cur]) this.players[this.cur].white = v; },
    get black() { return this.players[this.cur]?.black ?? 0; },
    set black(v) { if (this.players[this.cur]) this.players[this.cur].black = v; },
    steps: 0,          // steps left this move
    roll: 0,           // last roll
    phase: 'idle',     // idle | rolling | moving | choosing | done
    options: [],       // [{ i, dx, dy, name }]
    turn: 0,           // turns taken (all players)
    keys: 0,           // key groups picked up by anyone: their doors are unlocked for all
    keyGroups: null,
    used: new Set(),   // marker cells already collected / used (game logic)
    shownUsed: new Set(), // ...and those a runner has visibly reached
    log: [],
    follow: true,
    fast: false,       // fast-forward held
    followStreets: true, // on roads, only move where the road goes (or through a door)
    anim: null,        // { from, to, t }
    rollT: 0,
    rollFace: 1,
  };

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
    beam.rotation.x = 0.28; // aimed a little down at the ground ahead
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
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 28).rotateX(-Math.PI / 2).translate(0, 0.012, 0), haloMat);
  halo.raycast = () => {};
  halo.renderOrder = 6;
  group.add(halo);

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

  // --- helpers --------------------------------------------------------------
  const label = (i) => { const c = grid.coords(i); return cellLabel(c.x, c.y); };
  // Players start on the cell in front of the van.
  const startCell = () => {
    const s = grid.cells.findIndex((c) => c.sub === 'start');
    return s < 0 ? -1 : grid.startFront(s);
  };

  function unlocked() {
    if (!st.keys || !st.keyGroups) return undefined;
    const mask = st.keys;
    return (k) => ((st.keyGroups.edgeMask.get(k) ?? 0) & mask) !== 0;
  }

  // Cells the pawn can step to next (not back where it came from, unless
  // that's the only way).
  // On a street, start space or bridge (with Follow streets on), the pawn
  // keeps to the road: only the sides the road continues on, plus any side
  // with a door in it (stepping off the road into a building).
  function roadSides(x, y) {
    const c = grid.cells[grid.index(x, y)];
    if (!st.followStreets || !(c.sub === 'street' || c.sub === 'start' || c.bridge)) return null;
    let mask = streetMask(grid, x, y);
    for (const [dx, dy, , bit] of DIRS) {
      const k = dx ? edgeKey('v', dx > 0 ? x + 1 : x, y) : edgeKey('h', x, dy > 0 ? y + 1 : y);
      const t = grid.edges.get(k);
      if (t === 'door' || t === 'lockedDoor' || t?.startsWith('oneWayDoor')) mask |= bit;
    }
    return mask || null; // a lone road cell with no connections: move freely
  }

  function nextOptions() {
    const { x, y } = grid.coords(st.pos);
    const sides = roadSides(x, y);
    const all = [];
    for (const [dx, dy, name, bit] of DIRS) {
      if (sides !== null && !(sides & bit)) continue;
      if (!grid.canStep(x, y, dx, dy, unlocked())) continue;
      all.push({ i: grid.index(x + dx, y + dy), dx, dy, name });
    }
    const forward = all.filter((o) => o.i !== st.prev);
    return forward.length ? forward : all;
  }

  // Where player k stands in cell i (its own quarter of the cell).
  function standAt(k, i) {
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    return new THREE.Vector3(p.x + SLOTS[k][0], cellTop(i), p.z + SLOTS[k][1]);
  }
  function placeAll() {
    st.players.forEach((pl, k) => {
      if (pl.pos < 0 || pl.pos >= grid.cells.length) return;
      if (pl.anim || pl.queue.length) return; // still running there
      pl.at = standAt(k, pl.pos);
      pl.vis = pl.pos;
    });
  }
  const running = (pl) => !!(pl.anim || pl.queue.length);

  const who = () => st.players[st.cur]?.name ?? '';
  function log(msg) {
    st.log.unshift(msg);
    st.log.length = Math.min(st.log.length, 6);
  }

  // Entering a cell: touching a marker collects / uses it straight away (a
  // burst and a floating label on the board), and the pawn stops there to
  // ask which way to go next.
  // Returns the visual effect to play when the runner reaches the cell.
  function enter(i) {
    const c = grid.cells[i];
    const m = c.marker;
    if (!m || !MARKERS[m]) return null;
    if (m === 'objective' && !midnight()) return null; // not there yet
    if (cfg.stopAtMarkers) st.stopAt = i;
    if (st.used.has(i)) {
      st.stopReason = `${MARKERS[m].label} (already collected)`;
      return null;
    }
    // Investigation: ask first ("Investigate?"); the answer comes back
    // through answerInvestigate().
    if (m === 'investigation' && cfg.askInvestigate) {
      st.ask = { i };
      st.stopReason = 'Investigation';
      return null;
    }
    if (m === 'investigation') return investigate(i);
    st.used.add(i);
    let text, msg;
    if (m === 'whiteDice') {
      st.white++;
      text = 'White Dice';
      msg = `${who()} collected a single-use White Die at ${label(i)} (now has ${st.white}).`;
    } else if (m === 'blackDice') {
      st.blackCount++;
      text = 'Black Dice';
      msg = `${who()} attuned a Black Die at ${label(i)}: every player now rolls ${st.blackCount} black dice.`;
    } else if (m === 'research') {
      text = 'Research';
      msg = `${who()} used Research at ${label(i)}: a piece of evidence uncovered for free.`;
    } else if (m === 'investigation') {
      text = 'Investigation';
      msg = `${who()} found an investigation spot at ${label(i)}.`;
    } else if (m === 'objective') {
      text = 'Objective';
      msg = `Objective marker at ${label(i)} (active once the monster reveals itself).`;
    } else if (m === 'key') {
      let n = 0;
      var unlocks = -1;
      const gi = st.keyGroups?.cellGroup.get(i);
      if (gi !== undefined && !(st.keys & (1 << gi))) {
        st.keys |= 1 << gi;
        unlocks = gi;
        n = st.keyGroups.groups[gi].doors.size;
      }
      text = 'Key';
      msg = `${who()} picked up a key at ${label(i)}: ${n} door${n === 1 ? '' : 's'} in its building unlocked for everyone.`;
    }
    st.stopReason = MARKERS[m].label;
    log(msg);
    const opened = m === 'key' ? unlocks : -1;
    return () => {
      st.shownUsed.add(i);
      // The building's doors visibly unlock when the runner reaches the key.
      if (opened >= 0) st.shownKeys |= 1 << opened;
      onCollect(i, m, text);
      onUsed();
    };
  }

  // Investigate a spot: draw a random Obol from the bag for the current
  // player. Returns the board effect to play when the runner gets there.
  function investigate(i) {
    st.used.add(i);
    const pl = st.players[st.cur];
    let type = null;
    if (st.bag.length) {
      type = st.bag.splice(Math.floor(Math.random() * st.bag.length), 1)[0];
      // Into the player's own inventory (Obolcraft tab).
      pl.inventory.obolcraft.push({ type, at: label(i), time: formatClock(clockMinutes()), turn: st.round });
      log(`${who()} investigated ${label(i)} and drew an ${OBOLS[type].label} Obol (${st.bag.length} left in the bag).`);
    } else {
      log(`${who()} investigated ${label(i)}, but the Obol bag is empty.`);
    }
    st.stopReason = 'Investigation';
    onObol({ player: pl, type, left: st.bag.length });
    return () => {
      st.shownUsed.add(i);
      onCollect(i, 'investigation', type ? `${OBOLS[type].label} Obol` : 'Investigation');
      onUsed();
    };
  }

  // The answer to "Investigate?". Yes draws an Obol; No runs on through the
  // space, leaving it for later.
  function answerInvestigate(yes) {
    if (st.phase !== 'asking' || !st.ask) return;
    const { i } = st.ask;
    st.ask = null;
    if (yes) {
      const fx = investigate(i);
      // Play the effect when the runner reaches the spot (or now, if there).
      const pl = st.players[st.cur];
      const q = pl.queue.find((e) => e.to === i && !e.fx);
      if (q) q.fx = fx;
      else if (pl.anim && pl.anim.to === i && !pl.anim.fx) pl.anim.fx = fx;
      else fx();
    } else {
      log(`${who()} passes the investigation spot at ${label(i)}.`);
      st.stopAt = -1;
      st.stopReason = '';
    }
    st.phase = 'moving';
    advance();
  }

  // Landing at the end of a move.
  function land(i) {
    log(`${who()} ends on ${label(i)}.`);
  }

  // --- turn flow ------------------------------------------------------------
  function reset() {
    const s = startCell();
    st.count = Math.max(1, Math.min(4, cfg.players | 0 || 4));
    st.players = PLAYERS.slice(0, st.count).map((p) => ({
      ...p, pos: s, prev: -1, white: 0, black: 0, at: null, face: 0, vis: s, queue: [], anim: null,
      // Each player's own inventory, by tab: Equipment (nothing yet) and
      // Obolcraft (the Obols they've drawn, in order).
      inventory: { equipment: [], obolcraft: [] },
    }));
    Object.assign(st, {
      cur: 0, steps: 0, roll: 0, phase: s >= 0 ? 'idle' : 'nostart', options: [],
      turn: 0, round: st.startMode === 'midnight' ? cfg.turnsToMidnight + 1 : 1, keys: 0, keyGroups: grid.keyGroups(), pan: true,
      blackCount: cfg.startBlack, pool: [], slots: [], maxSlots: cfg.moveSlots, ask: null,
      // The Obol bag, shuffled as it's drawn from.
      bag: OBOL_TYPES.flatMap((t) => Array(Math.max(0, cfg.obols[t] | 0)).fill(t)),
    });
    st.used = new Set();
    st.shownUsed = new Set();
    st.shownKeys = 0;
    st.stopAt = -1;
    st.stopReason = '';
    onUsed();
    st.log = s >= 0
      ? [(st.startMode === 'midnight' ? 'Midnight. The town is waiting, and the objectives are out. ' : '') + `${st.count === 1 ? 'Playing solo: P1 is' : `${st.count} players`} ready on the Start space (${label(s)}), in the van's headlights: starting light ${Math.round(lightAt(s) * 100)}%. ${who()} rolls first.`]
      : [];
    if (s >= 0) { placeAll(); enter(s)?.(); st.ask = null; }
    applyVisibility();
    showOptions();
    onChange();
  }

  function roll() {
    if (st.phase === 'nostart') return;
    if (st.phase !== 'idle' && st.phase !== 'done') return;
    if (st.phase === 'done') nextPlayer();
    st.keyGroups = grid.keyGroups(); // pick up board edits since last turn
    const d6 = () => 1 + Math.floor(Math.random() * 6);
    // Roll every black die (shared count, renews each turn). White dice stay
    // in the player's reserve, unrolled, until they choose to roll one.
    st.pool = Array.from({ length: st.blackCount }, () => ({ kind: 'black', v: d6() }));
    st.slots = [];
    st.lit = lightAt(st.pos) >= cfg.litThreshold;
    st.maxSlots = st.lit ? Math.max(cfg.litSlots, cfg.moveSlots) : cfg.moveSlots;
    st.roll = 0;
    st.phase = 'rolling';
    st.rollT = 0;
    st.turn++;
    onChange();
  }

  // Decide the next step: move on, ask, or finish.
  function advance() {
    // Standing on an Investigation space: ask before anything else.
    if (st.ask) {
      st.phase = 'asking';
      st.options = [];
      showOptions();
      onChange();
      return;
    }
    if (st.steps <= 0) {
      st.stopAt = -1;
      st.stopReason = '';
      land(st.pos);
      nextPlayer();
      showOptions();
      onChange();
      return;
    }
    const opts = nextOptions();
    if (!opts.length) {
      log(`Stuck at ${label(st.pos)} with ${st.steps} move${st.steps === 1 ? '' : 's'} left.`);
      st.steps = 0;
      advance();
      return;
    }
    // Stop on every marker the pawn steps onto: always ask, even with one way on.
    const markerStop = st.stopAt === st.pos;
    st.stopAt = -1;
    if (opts.length === 1 && !markerStop) {
      step(opts[0]);
      return;
    }
    if (!markerStop) st.stopReason = '';
    st.phase = 'choosing';
    st.options = opts;
    showOptions();
    onChange();
  }

  // Hand the turn to the next player: the camera pans to them straight away,
  // even if the last player is still running into place.
  // Slotting: tap a rolled die to put it in the next empty movement slot, or
  // tap a slotted die to take it back out.
  function toggleSlot(n) {
    if (st.phase !== 'slotting' || !st.pool[n]) return;
    const at = st.slots.indexOf(n);
    if (at >= 0) st.slots.splice(at, 1);
    else if (st.slots.length < st.maxSlots) st.slots.push(n);
    onChange();
  }
  // Take one white die out of reserve and roll it. It can only be used this
  // turn: rolled white dice are discarded when the turn ends, slotted or not.
  function rollWhite() {
    if (st.phase !== 'slotting' || st.white <= 0) return;
    st.white--;
    const v = 1 + Math.floor(Math.random() * 6);
    st.pool.push({ kind: 'white', v, fresh: true });
    log(`${who()} rolled a white die from reserve: ${v} (${st.white} left in reserve).`);
    onChange();
  }
  const slotTotal = () => st.slots.reduce((a, n) => a + st.pool[n].v, 0);

  // Lock in the slotted dice and move that many cells (0 = stay put).
  function confirmMove() {
    if (st.phase !== 'slotting') return;
    const used = st.slots.map((n) => st.pool[n]);
    const rolledWhite = st.pool.filter((d) => d.kind === 'white').length;
    const discarded = rolledWhite - used.filter((d) => d.kind === 'white').length;
    st.roll = slotTotal();
    st.steps = st.roll;
    st.prev = -1;
    st.pool = [];
    st.slots = [];
    if (discarded) log(`${who()} discards ${discarded} unused white ${discarded === 1 ? 'die' : 'dice'}.`);
    if (!st.roll) {
      log(`${who()} stays put.`);
      nextPlayer();
      onChange();
      return;
    }
    log(`${who()} moves ${st.roll} (${used.map((d) => `${d.kind} ${d.v}`).join(' + ')}).`);
    st.phase = 'moving';
    advance();
  }

  // Game time: the night starts turnsToMidnight turns before midnight, and
  // turn N starts (N - 1) turns of turnMinutes later.
  function startMinutes() { return MIDNIGHT - cfg.turnMinutes * cfg.turnsToMidnight; }
  function clockMinutes() { return startMinutes() + ((st.round ?? 1) - 1) * cfg.turnMinutes; }
  function midnight() { return (st.round ?? 1) > cfg.turnsToMidnight; }

  function nextPlayer() {
    st.cur = (st.cur + 1) % st.players.length;
    if (st.cur === 0) {
      // Everyone has moved: the clock moves on one turn.
      const wasMidnight = midnight();
      st.round++;
      if (midnight() && !wasMidnight) {
        log('Midnight. The clocktower strikes twelve, and the objectives appear.');
        onUsed(); // reveal objective markers
      }
    }
    st.pan = true;
    st.phase = 'idle';
    st.stopAt = -1;
    st.stopReason = '';
    if (st.players.length > 1) log(`${who()}'s turn.`);
  }

  // Take one step in the game straight away; the figure runs it afterwards.
  function step(o) {
    st.options = [];
    showOptions();
    const pl = st.players[st.cur];
    const from = pl.pos;
    pl.prev = from;
    pl.pos = o.i;
    st.steps--;
    const fx = enter(o.i);
    pl.queue.push({ from, to: o.i, fx });
    advance();
  }

  function choose(i) {
    if (st.phase !== 'choosing') return false;
    const o = st.options.find((p) => p.i === i);
    if (!o) return false;
    step(o);
    return true;
  }

  // Arrow keys: pick the option closest to the camera-relative direction.
  function chooseByKey(key) {
    if (st.phase !== 'choosing') return false;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const want = { ArrowUp: fwd, ArrowDown: fwd.clone().negate(), ArrowRight: right, ArrowLeft: right.clone().negate() }[key];
    if (!want) return false;
    let best = null, bestDot = 0.3;
    for (const o of st.options) {
      const d = o.dx * want.x + o.dy * want.z;
      if (d > bestDot) { bestDot = d; best = o; }
    }
    if (best) step(best);
    return true;
  }

  function showOptions() {
    optionMeshes.forEach((m, n) => {
      const o = st.options[n];
      m.g.visible = !!o && group.visible;
      if (!o) return;
      const { x, y } = grid.coords(o.i);
      const p = cellToWorld(x, y);
      m.g.position.set(p.x, cellTop(o.i) + 0.03, p.z);
      m.arrow.rotation.y = Math.atan2(-o.dx, -o.dy);
    });
  }

  // --- per frame --------------------------------------------------------------
  const tmp = new THREE.Vector3();
  let last = performance.now();
  function tick(_dt, t) {
    // Wall-clock timing so rolls and hops take the same time on slow machines.
    const now = performance.now();
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (!group.visible) return;
    halo.material.opacity = 0.55 + 0.3 * Math.sin(t * 3);
    halo.material.color.set(st.players[st.cur]?.colour ?? '#fff');
    for (const m of optionMeshes) if (m.g.visible) m.arrow.position.y = 0.01 + 0.02 * (1 + Math.sin(t * 5));
    if (st.phase === 'rolling') {
      st.rollT += dt;
      const face = 1 + Math.floor((st.rollT * 14) % 6);
      if (face !== st.rollFace) { st.rollFace = face; onChange(); }
      if (st.rollT >= ROLL_TIME) {
        st.phase = 'slotting';
        const b = st.pool.map((d) => d.v);
        log(`${who()} rolled black ${b.join(', ')}.` +
          ` ${st.maxSlots} movement slots${st.lit ? ' (standing in light)' : ''}.`);
        onChange();
      }
    }
    // Every player runs their own queued path (several can run at once).
    const stepTime = st.fast ? FAST_STEP : STEP_TIME(METERS_PER_CELL);
    st.players.forEach((pl, k) => {
      if (!pl.anim && pl.queue.length) pl.anim = { ...pl.queue.shift(), t: 0 };
      const a = pl.anim;
      if (!a) return;
      a.t = Math.min(1, a.t + dt / stepTime);
      pl.at = standAt(k, a.from).lerp(standAt(k, a.to), a.t); // steady jog, no stop between cells
      figures[k].fig.userData.phase += (METERS_PER_CELL * dt / stepTime) * STRIDES_PER_M * Math.PI * 2;
      const da = grid.coords(a.from), db = grid.coords(a.to);
      pl.face = Math.atan2(db.x - da.x, db.y - da.y);
      if (a.t >= 1) {
        pl.anim = null;
        pl.vis = a.to;
        pl.at = standAt(k, a.to);
        try { a.fx?.(); } catch (e) { console.error(e); } // marker burst when they actually get there
        if (!running(pl)) onChange(); // arrived: refresh the status
      }
    });
    // Figures, the turn ring and name tags.
    figures.forEach(({ fig, tag }, k) => {
      const pl = st.players[k];
      const on = !!pl && pl.at;
      fig.visible = tag.visible = !!on;
      if (!on) return;
      fig.position.copy(pl.at);
      // Midnight: the flashlight flickers too, each on its own rhythm.
      const fl = flickerAt(0.13 + 0.21 * k, dreadUniforms.uDreadTime.value, dreadUniforms.uDread.value);
      fig.userData.lensMat.color.copy(LENS_COLOUR).multiplyScalar(fl);
      fig.userData.beamMat.opacity = BEAM_OPACITY * fl;
      // Run pose: blend in while moving, out when stopped.
      const u = fig.userData;
      const target = pl.anim ? 1 : 0;
      u.run += (target - u.run) * Math.min(1, dt * 8);
      const sw = Math.sin(u.phase) * u.run;
      u.limbs.legL.rotation.x = sw * 0.75;
      u.limbs.legR.rotation.x = -sw * 0.75;
      u.limbs.armL.rotation.x = -sw * 0.7;
      u.limbs.armR.rotation.x = sw * 0.7;
      u.torso.position.y = Math.abs(Math.cos(u.phase)) * m(0.06) * u.run;
      u.torso.rotation.x = 0.12 * u.run; // lean into the run
      fig.rotation.y += (((pl.face - fig.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10);
      // Tag: stays a readable size on screen, and fades out when zoomed in
      // close (where the figures themselves are easy to see).
      const d = camera.position.distanceTo(pl.at);
      const size = Math.max(0.14, d * 0.035);
      // Players sharing a cell stack their tags so they don't cover each other.
      const sameCell = pl.anim ? 0 : st.players.filter((q, j) => j < k && !q.anim && q.vis === pl.vis).length;
      const fade = THREE.MathUtils.smoothstep(d, 2.5, 7);
      // (Only stack when zoomed out; up close each tag sits over its own figure.)
      tag.position.set(pl.at.x, pl.at.y + m(2.1) + sameCell * size * 0.8 * fade, pl.at.z);
      tag.scale.set(size, size * 0.75, 1);
      const pulse = k === st.cur ? 0.15 * Math.sin(t * 4) : 0;
      tag.material.opacity = Math.min(1, 0.12 + 0.88 * fade + pulse);
    });
    const curPl = st.players[st.cur];
    if (curPl?.at) halo.position.copy(curPl.at);
    halo.visible = !!curPl?.at;

    // Camera follows the current player gently (keeps the same viewing
    // angle): while they run, and to pan over when the turn changes.
    if (st.follow && (running(curPl ?? {}) || st.pan) && curPl?.at) {
      tmp.set(curPl.at.x, 0, curPl.at.z).sub(controls.target);
      tmp.y = 0;
      if (!running(curPl) && tmp.length() < 0.05) st.pan = false;
      tmp.multiplyScalar(Math.min(1, dt * 3));
      controls.target.add(tmp);
      camera.position.add(tmp);
    }
  }

  let active = false;
  function applyVisibility() { group.visible = active && st.pos >= 0; }
  function setActive(on) {
    active = on;
    if (on && (st.pos < 0 || st.pos >= grid.cells.length || st.phase === 'nostart')) reset();
    applyVisibility();
    showOptions();
  }

  // Standard game (11 PM) or the midnight demo (restarts the game).
  function setStartMode(mode) {
    st.startMode = mode === 'midnight' ? 'midnight' : 'standard';
    reset();
  }

  // Change the number of players (restarts the game).
  function setPlayers(n) {
    cfg.players = Math.max(1, Math.min(4, n | 0 || 1));
    reset();
  }

  // The board changed: keep playing if the pawn's cell still exists.
  function boardChanged() {
    if (st.pos >= grid.cells.length || (st.phase === 'nostart' && startCell() >= 0)) reset();
    else if (st.pos >= 0) { placeAll(); showOptions(); }
  }

  return {
    state: st, roll, reset, clockMinutes, startMinutes, midnight, setStartMode, answerInvestigate, choose, chooseByKey, tick, setActive, boardChanged, setPlayers,
    setFast: (on) => { st.fast = !!on; },
    toggleSlot, confirmMove, slotTotal, rollWhite,
    // Doors visibly unlocked by keys the runners have reached (edge keys).
    unlockedEdges: () => {
      const out = new Set();
      if (!st.shownKeys || !st.keyGroups) return out;
      st.keyGroups.groups.forEach((g, gi) => { if (st.shownKeys & (1 << gi)) for (const k of g.doors) out.add(k); });
      return out;
    },
    // Is anyone still running into place?
    anyRunning: () => st.players.some(running),
    isOption: (i) => st.phase === 'choosing' && st.options.some((o) => o.i === i),
  };
}
