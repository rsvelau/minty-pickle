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
import { m } from './scale.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// The four players: name tag colour (also their jacket), hair, extras.
export const PLAYERS = [
  { name: 'P1', colour: '#18b7a6', accent: '#f2e9d0', hair: '#2a1a10', cap: false },
  { name: 'P2', colour: '#e0407e', accent: '#2b2b6e', hair: '#d9b25a', cap: false },
  { name: 'P3', colour: '#f0b52a', accent: '#5a2a8a', hair: '#1a1410', cap: true },
  { name: 'P4', colour: '#7a54e8', accent: '#2fd0c0', hair: '#7a3a1c', cap: false },
];
// Where each player stands inside a cell (cell units from its centre).
const SLOTS = [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];

const DIRS = [[0, -1, 'north', 1], [1, 0, 'east', 2], [0, 1, 'south', 4], [-1, 0, 'west', 8]];
const STEP_TIME = 0.32;   // seconds per hop
const ROLL_TIME = 0.7;    // die tumble before it lands

export function createPlay({
  grid, scene, camera, controls, cellToWorld, cellTop, terrainify, cellLabel, onChange,
  onUsed = () => {}, onCollect = () => {}, lightAt = () => 0,
}) {
  const st = {
    players: [],       // [{ name, colour, pos, prev, white, black, figure, tag }]
    count: 4,          // how many players (1-4)
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
    used: new Set(),   // marker cells already collected / used
    log: [],
    follow: true,
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

  function makeFigure(p) {
    // Built in metres, base at y = 0, facing +z. ~1.75 m tall.
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
    const box = (w, h, d, x, y, z, hex) => add(new THREE.BoxGeometry(m(w), m(h), m(d)).translate(m(x), m(y + h / 2), m(z)), hex);
    const skin = '#d8a27c';
    box(0.13, 0.1, 0.27, -0.09, 0, 0.03, '#f4f2ec'); box(0.13, 0.1, 0.27, 0.09, 0, 0.03, '#f4f2ec'); // sneakers
    box(0.14, 0.78, 0.16, -0.09, 0.08, 0, '#4f6f9e'); box(0.14, 0.78, 0.16, 0.09, 0.08, 0, '#4f6f9e'); // stonewashed jeans
    box(0.44, 0.58, 0.26, 0, 0.84, 0, p.colour);          // windbreaker
    box(0.45, 0.12, 0.27, 0, 1.08, 0, p.accent);          // colour-block stripe
    box(0.46, 0.06, 0.28, 0, 0.84, 0, p.accent);          // hem
    box(0.11, 0.56, 0.13, -0.28, 0.86, 0, p.colour);      // sleeves
    box(0.11, 0.56, 0.13, 0.28, 0.86, 0, p.colour);
    box(0.09, 0.1, 0.1, -0.28, 0.77, 0, skin); box(0.09, 0.1, 0.1, 0.28, 0.77, 0, skin); // hands
    box(0.1, 0.08, 0.1, 0, 1.42, 0, skin);                // neck
    add(new THREE.SphereGeometry(m(0.13), 12, 9).scale(1, 1.12, 1).translate(0, m(1.6), 0), skin); // head
    add(new THREE.SphereGeometry(m(0.135), 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.04, 1.1, 1.06)
      .translate(0, m(1.615), m(-0.01)), p.hair);       // hair
    if (p.cap) {
      add(new THREE.CylinderGeometry(m(0.14), m(0.14), m(0.07), 14).translate(0, m(1.72), 0), p.accent);
      box(0.18, 0.02, 0.14, 0, 1.69, -0.17, p.accent);   // backwards brim
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), figureMat);
    mesh.castShadow = true;
    mesh.raycast = () => {};
    return mesh;
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
      if (st.anim && k === st.cur) return;
      pl.at = standAt(k, pl.pos);
    });
  }

  const who = () => st.players[st.cur]?.name ?? '';
  function log(msg) {
    st.log.unshift(msg);
    st.log.length = Math.min(st.log.length, 6);
  }

  // Entering a cell: touching a marker collects / uses it straight away (a
  // burst and a floating label on the board), and the pawn stops there to
  // ask which way to go next.
  function enter(i) {
    const c = grid.cells[i];
    const m = c.marker;
    if (!m || !MARKERS[m]) return;
    st.stopAt = i;
    if (st.used.has(i)) {
      st.stopReason = `${MARKERS[m].label} (already collected)`;
      return;
    }
    st.used.add(i);
    let text, msg;
    if (m === 'whiteDice') {
      st.white++;
      text = `${who()} +1 White Die`;
      msg = `${who()} collected a single-use White Die at ${label(i)}.`;
    } else if (m === 'blackDice') {
      st.black++;
      text = `${who()}: Black Die attuned`;
      msg = `${who()} attuned a Black Die at ${label(i)}.`;
    } else if (m === 'research') {
      text = 'Evidence uncovered';
      msg = `${who()} used Research at ${label(i)}: a piece of evidence uncovered for free.`;
    } else if (m === 'investigation') {
      text = 'Investigate here';
      msg = `${who()} found an investigation spot at ${label(i)}.`;
    } else if (m === 'objective') {
      text = 'Objective spot';
      msg = `Objective marker at ${label(i)} (active once the monster reveals itself).`;
    } else if (m === 'key') {
      let n = 0;
      const gi = st.keyGroups?.cellGroup.get(i);
      if (gi !== undefined && !(st.keys & (1 << gi))) {
        st.keys |= 1 << gi;
        n = st.keyGroups.groups[gi].doors.size;
      }
      text = `Key: ${n} door${n === 1 ? '' : 's'} unlocked`;
      msg = `${who()} picked up a key at ${label(i)}: ${n} door${n === 1 ? '' : 's'} in its building unlocked for everyone.`;
    }
    st.stopReason = MARKERS[m].label;
    log(msg);
    onCollect(i, m, text);
    onUsed();
  }

  // Landing at the end of a move.
  function land(i) {
    log(`${who()} ends on ${label(i)}.`);
  }

  // --- turn flow ------------------------------------------------------------
  function reset() {
    const s = startCell();
    st.players = PLAYERS.slice(0, st.count).map((p) => ({ ...p, pos: s, prev: -1, white: 0, black: 0, at: null, face: 0 }));
    Object.assign(st, {
      cur: 0, steps: 0, roll: 0, phase: s >= 0 ? 'idle' : 'nostart', options: [],
      turn: 0, keys: 0, keyGroups: grid.keyGroups(), anim: null,
    });
    st.used = new Set();
    st.stopAt = -1;
    st.stopReason = '';
    onUsed();
    st.log = s >= 0
      ? [`${st.count} player${st.count === 1 ? '' : 's'} ready on the Start space (${label(s)}), in the van's headlights: starting light ${Math.round(lightAt(s) * 100)}%. ${who()} rolls first.`]
      : [];
    if (s >= 0) { placeAll(); enter(s); }
    applyVisibility();
    showOptions();
    onChange();
  }

  function roll() {
    if (st.phase === 'nostart') return;
    if (st.phase !== 'idle' && st.phase !== 'done') return;
    if (st.phase === 'done') nextPlayer();
    st.keyGroups = grid.keyGroups(); // pick up board edits since last turn
    st.roll = 1 + Math.floor(Math.random() * 6);
    st.phase = 'rolling';
    st.rollT = 0;
    st.turn++;
    onChange();
  }

  // Decide the next step: move on, ask, or finish.
  function advance() {
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

  // Hand the turn to the next player.
  function nextPlayer() {
    st.cur = (st.cur + 1) % st.players.length;
    st.phase = 'idle';
    st.stopAt = -1;
    st.stopReason = '';
    if (st.players.length > 1) log(`${who()}'s turn.`);
  }

  function step(o) {
    st.options = [];
    showOptions();
    st.phase = 'moving';
    st.anim = { from: st.pos, to: o.i, t: 0 };
    onChange();
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
        st.rollFace = st.roll;
        st.steps = st.roll;
        st.prev = -1;
        log(`${who()} rolled a ${st.roll}.`);
        advance();
      }
    }
    if (st.anim) {
      const a = st.anim;
      a.t = Math.min(1, a.t + dt / STEP_TIME);
      const k = a.t * a.t * (3 - 2 * a.t);
      const wa = standAt(st.cur, a.from), wb = standAt(st.cur, a.to);
      const pl = st.players[st.cur];
      pl.at = wa.lerp(wb, k);
      pl.at.y += Math.sin(Math.PI * a.t) * 0.08; // a little hop
      const da = grid.coords(a.from), db = grid.coords(a.to);
      pl.face = Math.atan2(db.x - da.x, db.y - da.y);
      if (a.t >= 1) {
        st.anim = null;
        st.prev = a.from;
        st.pos = a.to;
        st.players[st.cur].at = standAt(st.cur, a.to);
        st.steps--;
        enter(st.pos);
        advance();
      }
    }
    // Figures, the turn ring and name tags.
    figures.forEach(({ fig, tag }, k) => {
      const pl = st.players[k];
      const on = !!pl && pl.at;
      fig.visible = tag.visible = !!on;
      if (!on) return;
      fig.position.copy(pl.at);
      fig.rotation.y += (((pl.face - fig.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 10);
      // Tag: stays a readable size on screen, and fades out when zoomed in
      // close (where the figures themselves are easy to see).
      const d = camera.position.distanceTo(pl.at);
      const size = Math.max(0.14, d * 0.035);
      // Players sharing a cell stack their tags so they don't cover each other.
      const sameCell = st.players.filter((q, j) => j < k && q.pos === pl.pos && !(st.anim && j === st.cur)).length;
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

    // Camera follows the current player gently (keeps the same viewing angle).
    if (st.follow && (st.anim || st.phase === 'rolling') && curPl?.at) {
      tmp.set(curPl.at.x, 0, curPl.at.z).sub(controls.target);
      tmp.y = 0;
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

  // Change the number of players (restarts the game).
  function setPlayers(n) {
    st.count = Math.max(1, Math.min(4, n));
    reset();
  }

  // The board changed: keep playing if the pawn's cell still exists.
  function boardChanged() {
    if (st.pos >= grid.cells.length || (st.phase === 'nostart' && startCell() >= 0)) reset();
    else if (st.pos >= 0) { placeAll(); showOptions(); }
  }

  return {
    state: st, roll, reset, choose, chooseByKey, tick, setActive, boardChanged, setPlayers,
    isOption: (i) => st.phase === 'choosing' && st.options.some((o) => o.i === i),
  };
}
