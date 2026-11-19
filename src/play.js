// Playable demo: one character starts on the Start space, rolls a black die
// and moves that many spaces, choosing a direction at every fork.
//
// Movement uses the board's rules (GridState.canStep): walkable cells only;
// walls, windows and locked doors block; one-way doors go one way; walking
// over a Key unlocks the locked and one-way doors of its building. The pawn
// keeps going while there is only one way forward (it never turns back
// unless it hits a dead end) and stops to ask at forks and at the start of
// each move.
import * as THREE from 'three';
import { MARKERS, streetMask, edgeKey } from './state.js';

const DIRS = [[0, -1, 'north', 1], [1, 0, 'east', 2], [0, 1, 'south', 4], [-1, 0, 'west', 8]];
const STEP_TIME = 0.32;   // seconds per hop
const ROLL_TIME = 0.7;    // die tumble before it lands

export function createPlay({
  grid, scene, camera, controls, cellToWorld, cellTop, terrainify, cellLabel, onChange,
  onUsed = () => {}, onCollect = () => {},
}) {
  const st = {
    pos: -1,           // cell index of the pawn
    prev: -1,          // cell it came from this move (no doubling back)
    steps: 0,          // steps left this move
    roll: 0,           // last roll
    phase: 'idle',     // idle | rolling | moving | choosing | done
    options: [],       // [{ i, dx, dy, name }]
    turn: 0,
    keys: 0,           // carried key groups (bitmask over grid.keyGroups())
    keyGroups: null,
    used: new Set(),   // marker cells already collected / used
    white: 0,
    black: 0,
    log: [],
    follow: true,
    followStreets: true, // on roads, only move where the road goes (or through a door)
    anim: null,        // { from, to, t }
    rollT: 0,
    rollFace: 1,
  };

  // --- pawn -----------------------------------------------------------------
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const pawnMat = new THREE.MeshLambertMaterial({ color: '#f0c040', emissive: '#4a3208' });
  const pawnPts = [[0, 0], [0.16, 0], [0.16, 0.03], [0.12, 0.06], [0.07, 0.1], [0.055, 0.22], [0.09, 0.25], [0.05, 0.28], [0, 0.28]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const pawn = new THREE.Mesh(new THREE.LatheGeometry(pawnPts, 20), pawnMat);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12).translate(0, 0.34, 0), pawnMat);
  // Halo ring so the pawn reads from far away.
  const haloMat = new THREE.MeshBasicMaterial({ color: '#ffd760', transparent: true, opacity: 0.8, depthWrite: false });
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.27, 32).rotateX(-Math.PI / 2).translate(0, 0.012, 0), haloMat);
  for (const o of [pawn, head]) { o.castShadow = true; o.raycast = () => {}; }
  halo.raycast = () => {};
  halo.renderOrder = 6;
  group.add(pawn, head, halo);
  pawn.scale.setScalar(1.5);
  head.scale.setScalar(1.5);
  halo.scale.setScalar(1.3);

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
  for (const mat of [pawnMat, haloMat, optMat, arrowMat]) terrainify(mat, { bridge: true });

  // --- helpers --------------------------------------------------------------
  const label = (i) => { const c = grid.coords(i); return cellLabel(c.x, c.y); };
  const startCell = () => grid.cells.findIndex((c) => c.sub === 'start');

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

  function placePawn(i, hop = 0) {
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    group.position.set(p.x, cellTop(i) + hop, p.z);
  }

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
      text = '+1 White Die';
      msg = `Collected a single-use White Die at ${label(i)}.`;
    } else if (m === 'blackDice') {
      st.black++;
      text = 'Black Die attuned';
      msg = `Attuned a Black Die at ${label(i)}.`;
    } else if (m === 'research') {
      text = 'Evidence uncovered';
      msg = `Research at ${label(i)}: a piece of evidence uncovered for free.`;
    } else if (m === 'investigation') {
      text = 'Investigate here';
      msg = `Investigation spot at ${label(i)}: you can investigate here for clues.`;
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
      msg = `Picked up a key at ${label(i)}: ${n} door${n === 1 ? '' : 's'} in its building unlocked.`;
    }
    st.stopReason = MARKERS[m].label;
    log(msg);
    onCollect(i, m, text);
    onUsed();
  }

  // Landing at the end of a move.
  function land(i) {
    log(`Turn ${st.turn} ends on ${label(i)}.`);
  }

  // --- turn flow ------------------------------------------------------------
  function reset() {
    const s = startCell();
    Object.assign(st, {
      pos: s, prev: -1, steps: 0, roll: 0, phase: s >= 0 ? 'idle' : 'nostart', options: [],
      turn: 0, keys: 0, keyGroups: grid.keyGroups(), white: 0, black: 0, anim: null,
    });
    st.used = new Set();
    st.stopAt = -1;
    st.stopReason = '';
    onUsed();
    st.log = s >= 0 ? [`Ready on the Start space (${label(s)}). Roll the black die.`] : [];
    if (s >= 0) { placePawn(s); enter(s); }
    showOptions();
    onChange();
  }

  function roll() {
    if (st.phase === 'nostart') return;
    if (st.phase !== 'idle' && st.phase !== 'done') return;
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
      st.phase = 'done';
      land(st.pos);
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
    for (const m of optionMeshes) if (m.g.visible) m.arrow.position.y = 0.01 + 0.02 * (1 + Math.sin(t * 5));
    if (st.phase === 'rolling') {
      st.rollT += dt;
      const face = 1 + Math.floor((st.rollT * 14) % 6);
      if (face !== st.rollFace) { st.rollFace = face; onChange(); }
      if (st.rollT >= ROLL_TIME) {
        st.rollFace = st.roll;
        st.steps = st.roll;
        st.prev = -1;
        log(`Turn ${st.turn}: rolled a ${st.roll}.`);
        advance();
      }
    }
    if (st.anim) {
      const a = st.anim;
      a.t = Math.min(1, a.t + dt / STEP_TIME);
      const k = a.t * a.t * (3 - 2 * a.t);
      const pa = grid.coords(a.from), pb = grid.coords(a.to);
      const wa = cellToWorld(pa.x, pa.y), wb = cellToWorld(pb.x, pb.y);
      const ya = cellTop(a.from), yb = cellTop(a.to);
      group.position.set(wa.x + (wb.x - wa.x) * k, ya + (yb - ya) * k + Math.sin(Math.PI * a.t) * 0.18, wa.z + (wb.z - wa.z) * k);
      if (a.t >= 1) {
        st.anim = null;
        st.prev = a.from;
        st.pos = a.to;
        st.steps--;
        enter(st.pos);
        advance();
      }
    }
    // Camera follows the pawn gently (keeps the same viewing angle).
    if (st.follow && (st.anim || st.phase === 'rolling')) {
      tmp.set(group.position.x, 0, group.position.z).sub(controls.target);
      tmp.y = 0;
      tmp.multiplyScalar(Math.min(1, dt * 3));
      controls.target.add(tmp);
      camera.position.add(tmp);
    }
  }

  function setActive(on) {
    group.visible = on && st.pos >= 0;
    if (on && (st.pos < 0 || st.pos >= grid.cells.length || st.phase === 'nostart')) reset();
    group.visible = on && st.pos >= 0;
    showOptions();
  }

  // The board changed: keep playing if the pawn's cell still exists.
  function boardChanged() {
    if (st.pos >= grid.cells.length || (st.phase === 'nostart' && startCell() >= 0)) reset();
    else if (st.pos >= 0) { placePawn(st.pos); showOptions(); }
  }

  return {
    state: st, roll, reset, choose, chooseByKey, tick, setActive, boardChanged,
    isOption: (i) => st.phase === 'choosing' && st.options.some((o) => o.i === i),
  };
}
