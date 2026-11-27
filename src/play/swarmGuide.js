// The Adze's swarms, made readable on the board:
//
//   colours     each victim has a colour (a ring at their feet); the swarm
//               after them, its flight line and their badge share it.
//   flight line dots on the ground from each swarm to its victim; the stretch
//               it flies on the Adze's next turn is solid, ending in a
//               "lands here" marker. A burning swarm's line runs home to the
//               Nest, orange.
//   badges      over each victim a swarm is after: how many Adze turns until
//               it strikes ("Strikes next turn", pulsing, once it has settled
//               beside them), whether anyone stands guard, and the swarm's
//               health (orange once Fire has singed it).
//   new swarms  a swarm just sent out: a fading trail from the Lair to where
//               it got to, its flight line drawing itself out, and "New swarm"
//               on the badge for a few seconds.
//
// Drawn over the scenery (like the map markers), so roofs and trees don't hide
// it. It only reads the state; play.js calls sync() after every update and tick()
// every frame.
import * as THREE from 'three';
import { m } from '../core/scale.js';
import { swarmRouteTo, SWARM_SPEED, SWARM_HP } from '../game/monsterTurn.js';
import { cellRange, RANGE } from '../game/cards/injuries.js';

// Victim colours, in the order they appear (Hotel, Bar, Hospital...).
export const VICTIM_COLOURS = ['#4aa8ff', '#ffb03a', '#e070ff', '#7dffb0'];
const BURNING = '#ff7a1a';
const LIFT = 0.05;   // above the ground
const W = 640, H = 156, BADGE = 0.2;
const NEW_FOR = 5000;   // ms a new swarm is called new
const GROW = 1400;     // ms its line takes to draw out
const TRAIL = 3500;    // ms its trail from the Lair takes to fade   // badge canvas, and its width (a share of the view's height)

export function createSwarmGuide({ group, centreOf, board, getState }) {
  const g = board.grid;
  const root = new THREE.Group();
  root.name = 'swarmGuide';
  group.add(root);
  const mats = new Map();
  const mat = (colour, opacity) => {
    const k = `${colour}|${opacity}`;
    if (!mats.has(k)) mats.set(k, new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, depthTest: false, fog: false }));
    return mats.get(k);
  };
  const noRay = (o) => { o.raycast = () => {}; o.renderOrder = 7; return o; };
  const dotGeo = new THREE.CircleGeometry(0.085, 12).rotateX(-Math.PI / 2);
  const segGeo = new THREE.BoxGeometry(1, 0.02, 0.09);
  const startGeo = new THREE.CircleGeometry(0.2, 24).rotateX(-Math.PI / 2);
  const landGeo = new THREE.RingGeometry(0.2, 0.28, 28).rotateX(-Math.PI / 2);
  const victimRingGeo = new THREE.RingGeometry(0.26, 0.32, 32).rotateX(-Math.PI / 2);

  const colourOf = (state, npcId) => {
    const k = (state?.npcs ?? []).findIndex((v) => v.id === npcId);
    return VICTIM_COLOURS[(k < 0 ? 0 : k) % VICTIM_COLOURS.length];
  };
  const at = (i) => { const p = centreOf(i); return new THREE.Vector3(p.x, p.y + LIFT, p.z); };

  // --- new swarms -------------------------------------------------------------
  let known = null;                 // swarm ids seen so far (null: nothing yet, so nothing is "new")
  const born = new Map();           // swarm id -> when it was first seen (ms)
  const trails = [];                // { obj, mat, t0 }: a new swarm's way out from the Lair, fading
  function reset() { known = null; born.clear(); }
  function noteBirths(state, swarms) {
    const now = performance.now();
    const ids = new Set(swarms.map((sw) => sw.id));
    if (known) for (const sw of swarms) if (!known.has(sw.id) && !sw.burning) { born.set(sw.id, now); trailFor(state, sw); }
    known = ids;
    for (const id of born.keys()) if (!ids.has(id)) born.delete(id);
  }
  // Dots from the Lair to where the new swarm got to this turn.
  function trailFor(state, sw) {
    const nest = state.monsters?.[0]?.pos;
    if (nest === undefined || nest === sw.pos) return;
    const route = swarmRouteTo(board, nest, new Set([sw.pos]));
    if (!route) return;
    const m2 = new THREE.MeshBasicMaterial({ color: colourOf(state, sw.victim), transparent: true, opacity: 0.9, depthWrite: false, depthTest: false, fog: false });
    const obj = new THREE.Group();
    for (let k = 0; k < route.length - 1; k++) {
      const a = at(route[k]), b = at(route[k + 1]);
      for (const f of [0.5, 1]) { const d = noRay(new THREE.Mesh(dotGeo, m2)); d.position.copy(a).lerp(b, f); obj.add(d); }
    }
    root.add(obj);
    trails.push({ obj, mat: m2, t0: performance.now() });
  }

  // --- flight lines (rebuilt when something they show changes) -------------
  let lines = new THREE.Group(); root.add(lines);
  let lineSig = '';
  function routeOf(state, sw) {
    if (sw.burning) {
      const nest = state.monsters?.[0]?.pos;
      return nest === undefined ? null : swarmRouteTo(board, sw.pos, new Set([nest]));
    }
    const v = (state.npcs ?? []).find((x) => x.id === sw.victim && x.alive);
    return v ? swarmRouteTo(board, sw.pos, new Set([v.cell])) : null;
  }
  function buildLines(state, routes) {
    root.remove(lines);
    lines.traverse((o) => { if (o.geometry && ![dotGeo, segGeo, landGeo, startGeo].includes(o.geometry)) o.geometry.dispose(); });
    lines = new THREE.Group();
    root.add(lines);
    for (const { sw, route } of routes) {
      if (!route || route.length < 2) continue;
      // Each piece numbered from the swarm outward, so a new swarm's line can draw itself out.
      const own = new THREE.Group();
      own.userData.id = sw.id;
      lines.add(own);
      let order = 0;
      const put = (o) => { o.userData.order = order++; own.add(o); };
      const colour = sw.burning ? BURNING : colourOf(state, sw.victim);
      // It stops beside its victim (not on them); a burning one flies right into the Nest.
      const stop = sw.burning ? route.length - 1 : route.length - 2;
      if (stop <= 0) continue;          // settled already: the badge says so
      const leg = Math.min(SWARM_SPEED, stop);
      // Where the swarm is now: a disc in its colour under the cloud.
      const here = noRay(new THREE.Mesh(startGeo, mat(colour, 0.55)));
      here.position.copy(at(route[0]));
      put(here);
      // Next turn's stretch: solid.
      for (let k = 0; k < leg; k++) {
        const a = at(route[k]), b = at(route[k + 1]);
        const s = noRay(new THREE.Mesh(segGeo, mat(colour, 0.85)));
        s.position.copy(a).lerp(b, 0.5);
        s.scale.x = a.distanceTo(b);
        s.lookAt(b.x, s.position.y, b.z); s.rotateY(Math.PI / 2);
        put(s);
      }
      // Where it lands.
      const land = noRay(new THREE.Mesh(landGeo, mat(colour, 0.9)));
      land.position.copy(at(route[leg]));
      land.userData.pulse = true;
      put(land);
      // The rest of the way: dots (one per cell, and between).
      for (let k = leg; k < stop; k++) {
        const a = at(route[k]), b = at(route[k + 1]);
        for (const f of [0.5, 1]) {
          const d = noRay(new THREE.Mesh(dotGeo, mat(colour, 0.85)));
          d.position.copy(a).lerp(b, f);
          put(d);
        }
      }
      own.userData.count = order;
    }
  }

  // --- victims: a colour ring, and a badge when a swarm is coming -----------
  const victims = new Map();   // npc id -> { ring, badge, canvas, tex, text }
  function victimView(id) {
    let v = victims.get(id);
    if (v) return v;
    const ring = noRay(new THREE.Mesh(victimRingGeo, mat('#ffffff', 0.85)));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false, sizeAttenuation: false }));   // the same size on screen however far away
    badge.raycast = () => {};
    badge.renderOrder = 26;
    badge.center.set(0.5, 0);
    badge.scale.set(BADGE, BADGE * H / W, 1);
    root.add(ring, badge);
    v = { ring, badge, canvas, tex, text: '' };
    victims.set(id, v);
    return v;
  }
  // l2: [text, colour] pieces, side by side.
  function drawBadge(v, colour, l1, l2, warn) {
    const key = `${colour}|${l1}|${JSON.stringify(l2)}|${warn}`;
    if (v.text === key) return;
    v.text = key;
    const x = v.canvas.getContext('2d');
    x.clearRect(0, 0, W, H);
    x.fillStyle = warn ? 'rgba(90, 8, 8, 0.92)' : 'rgba(12, 14, 20, 0.85)';
    x.strokeStyle = colour; x.lineWidth = 8;
    x.beginPath(); x.roundRect(8, 8, W - 16, H - 16, 30); x.fill(); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '800 46px system-ui, -apple-system, "Segoe UI", sans-serif';
    x.fillStyle = warn ? '#ffd0c8' : colour;
    x.fillText(l1, W / 2, 54);
    x.font = '600 34px system-ui, -apple-system, "Segoe UI", sans-serif';
    const sep = '  ·  ';
    const parts = l2.flatMap((pc, k) => (k ? [[sep, '#8a8578'], pc] : [pc]));
    const width = parts.reduce((n, [t]) => n + x.measureText(t).width, 0);
    let cx = W / 2 - width / 2;
    x.textAlign = 'left';
    for (const [t, c] of parts) { x.fillStyle = c; x.fillText(t, cx, 112); cx += x.measureText(t).width; }
    v.tex.needsUpdate = true;
  }

  function sync() {
    const state = getState();
    const swarms = (state?.swarms ?? []).filter((sw) => sw.pos >= 0 && sw.pos < g.cells.length);
    noteBirths(state, swarms);
    const routes = swarms.map((sw) => ({ sw, route: routeOf(state, sw) }));
    const sig = JSON.stringify(routes.map(({ sw, route }) => [sw.id, sw.victim, !!sw.burning, route])) + JSON.stringify((state?.npcs ?? []).map((v) => v.id));
    if (sig !== lineSig) { lineSig = sig; buildLines(state, routes); }
    const seen = new Set();
    for (const npc of state?.npcs ?? []) {
      const v = victimView(npc.id);
      seen.add(npc.id);
      const colour = colourOf(state, npc.id);
      const p = centreOf(npc.cell);
      v.ring.material = mat(colour, npc.alive ? 0.85 : 0.25);
      // (Where play.js stands the townsperson: a little off the cell's centre.)
      v.ring.position.set(p.x - 0.18, p.y + 0.012, p.z + 0.18);
      v.badge.position.set(p.x - 0.18, p.y + m(2.3), p.z + 0.18);
      // Who is coming for them (the nearest swarm, if several).
      const coming = npc.alive ? routes.filter(({ sw }) => !sw.burning && sw.victim === npc.id) : [];
      v.warn = false;
      if (!coming.length) { v.badge.visible = false; continue; }
      const turns = Math.min(...coming.map(({ sw, route }) => {
        if (sw.ready) return 1;                                       // settled: strikes on the next Adze turn
        const d = route ? Math.max(0, route.length - 2) : 0;          // spaces to fly before it settles
        return Math.max(1, Math.ceil(d / SWARM_SPEED)) + 1;           // settles, then strikes the turn after
      }));
      const guarded = state.players.some((pl) => !pl.dead && !pl.hiding && cellRange(g, pl.pos, npc.cell) <= RANGE.close);
      const now = performance.now();
      const fresh = coming.some(({ sw }) => born.has(sw.id) && now - born.get(sw.id) < NEW_FOR);
      const when = turns <= 1 ? 'strikes next turn' : `strikes in ${turns} turns`;
      const l1 = fresh ? `New swarm: ${when}` : turns <= 1 ? '⚠ Strikes next turn' : `Swarm: ${when}`;
      // Its health: orange once Fire has singed it.
      const sw0 = coming[0].sw;
      const max = sw0.maxHp ?? SWARM_HP, hp = sw0.hp ?? max;
      const l2 = [guarded ? ['🛡 Defended', '#9fe8a8'] : ['No one guarding', '#ffb0a0'], hp < max ? [`🔥 singed ${hp}/${max}`, '#ffa040'] : [`health ${hp}/${max}`, '#c8c2b4']];
      v.fresh = fresh;
      v.freshUntil = fresh ? Math.max(...coming.filter(({ sw }) => born.has(sw.id)).map(({ sw }) => born.get(sw.id))) + NEW_FOR : 0;
      v.warn = turns <= 1;
      drawBadge(v, colour, l1, l2, v.warn);
      v.badge.visible = true;
    }
    for (const [id, v] of victims) if (!seen.has(id)) { root.remove(v.ring, v.badge); v.tex.dispose(); v.badge.material.dispose(); victims.delete(id); }
  }

  function tick(t) {
    const pulse = 0.5 + 0.5 * Math.sin(t * 5);
    for (const [, v] of victims) {
      if (!v.badge.visible) continue;
      v.badge.material.opacity = v.warn ? 0.7 + 0.3 * pulse : 1;
      const s = v.warn ? BADGE * (1 + 0.06 * pulse) : BADGE;
      v.badge.scale.set(s, s * H / W, 1);
    }
    lines.traverse((o) => { if (o.userData.pulse) o.scale.setScalar(0.9 + 0.2 * pulse); });
    // A new swarm's line draws out from it, piece by piece.
    const now = performance.now();
    for (const own of lines.children) {
      const b = born.get(own.userData.id);
      const shown = b === undefined ? Infinity : ((now - b) / GROW) * own.userData.count;
      for (const o of own.children) o.visible = o.userData.order <= shown;
    }
    // Trails from the Lair fade away.
    for (let k = trails.length - 1; k >= 0; k--) {
      const tr = trails[k], f = (now - tr.t0) / TRAIL;
      tr.mat.opacity = 0.9 * Math.max(0, 1 - f);
      if (f >= 1) { root.remove(tr.obj); tr.mat.dispose(); trails.splice(k, 1); }
    }
    // "New swarm" runs out: redraw the badges.
    if ([...victims.values()].some((v) => v.fresh && v.badge.visible && now >= v.freshUntil)) sync();
  }
  // Still animating (so the renderer keeps drawing)?
  const busy = () => trails.length > 0 || [...born.values()].some((b) => performance.now() - b < NEW_FOR);

  // The swarm's colour (for the cloud itself).
  const swarmColour = (sw) => (sw.burning ? null : colourOf(getState(), sw.victim));
  return { sync, tick, reset, busy, swarmColour, colourOf: (id) => colourOf(getState(), id) };
}
