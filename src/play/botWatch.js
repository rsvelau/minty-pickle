// Following the bots (and everyone else): what each investigator gains and
// loses, shown so a human can keep up with a table of fast bots. Each part can
// be switched off in Game settings → Following the bots (gameConfig, live):
//
//   botReceipts  a card per bot turn, stacked at the side until the next round:
//                its dice, where it went, what it gained (tap: the camera looks)
//   botFly       what a bot gains (Obols, cards, evidence, keys...) pops off its
//                pawn and flies to its chip on the team strip
//   teamStrip    everyone's Obols, cards and injuries, always on screen; the
//                chip that just changed glows
//   roundSummary when the turn comes back to you: what the others did since
//                your last turn (tap to keep it up)
//   botTrails    a fading line of where each bot just walked (play.showTrail)
//   botSpeed     fast / normal / watch (play/bots.js)
//
// It works from the game's state alone: after every update it compares each
// investigator with how they were the last time (Obols by colour, Equipment,
// carried items, injuries, white dice, keys, evidence found, alive) and turns
// the differences into small "changes".
import { OBOLS } from './play.js';
import { EQUIPMENT_BY_ID } from '../game/cards/equipment.js';
import { evidenceLabel } from '../game/cards/evidence.js';
import { itemLabel } from '../game/objectives/verbs.js';
import { INJURY_TRACKS } from '../game/cards/injuries.js';
import { obolHTML } from './panels.js';
import { gameConfig, screenOf } from './playView.js';
import { __set_camTween, camera, cellToWorld, controls } from '../render/scene.js';
import { grid } from '../app/config.js';

let play = null;
let last = null;            // the last snapshot: { seats: [...], found, keys, round }
let receipts = [];          // { seat, round, dice, from, to, gains: [] }
let summary = [];           // changes since a human last had the turn
let lastCur = -1;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const on = (k) => gameConfig?.[k] !== false;
const $ = (sel) => document.querySelector(sel);

export function initBotWatch(p) {
  play = p;
  window.addEventListener('watch-settings', () => render(play.session?.state));
  window.addEventListener('intro-done', () => render(play.session?.state));
  // First tap keeps it up; the next tap puts it away.
  $('#roundSummary')?.addEventListener('click', () => {
    const el = $('#roundSummary');
    if (el.classList.contains('pinned')) { el.classList.remove('pinned'); el.hidden = true; return; }
    el.classList.add('pinned');
    const hint = el.querySelector('.rs-hint');
    if (hint) hint.textContent = 'Tap again to close';
  });
}
export function watchReset() {
  last = null; receipts = []; summary = []; lastCur = -1;
  const rs = $('#roundSummary');
  if (rs) { rs.hidden = true; rs.classList.remove('pinned'); }
  render(play?.session?.state);
}

// --- what changed -------------------------------------------------------------------------
function snapshot(s) {
  return {
    round: s.round, keys: s.keys ?? 0, found: (s.mystery?.found ?? []).length,
    seats: s.players.map((p) => ({
      obols: Object.fromEntries(Object.keys(OBOLS).map((t) => [t, p.inventory.obolcraft.filter((o) => o.type === t).length])),
      eq: p.inventory.equipment.map((e) => e.id),
      carry: (p.carry ?? []).map((c) => c.item),
      inj: { ...(p.injuries ?? {}) }, white: p.white ?? 0, dead: !!p.dead, pos: p.pos,
    })),
  };
}
const countBy = (list) => list.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map());
// A change: { seat, gain: bool, html (icon), text }
function diff(a, b, s) {
  const out = [];
  b.seats.forEach((n, seat) => {
    const o = a.seats[seat];
    if (!o) return;
    for (const t of Object.keys(OBOLS)) {
      const d = n.obols[t] - o.obols[t];
      if (d > 0) out.push({ seat, gain: true, html: obolHTML(t), text: `+${d} ${OBOLS[t].label} Obol${d > 1 ? 's' : ''}` });
      if (d < 0) out.push({ seat, gain: false, html: obolHTML(t), text: `−${-d} ${OBOLS[t].label} Obol${d < -1 ? 's' : ''}` });
    }
    const before = countBy(o.eq), now = countBy(n.eq);
    for (const [id, c] of now) for (let k = before.get(id) ?? 0; k < c; k++) out.push({ seat, gain: true, html: '🎒', text: EQUIPMENT_BY_ID[id]?.name ?? id });
    for (const [id, c] of before) for (let k = now.get(id) ?? 0; k < c; k++) out.push({ seat, gain: false, html: '🗑', text: `${EQUIPMENT_BY_ID[id]?.name ?? id} gone` });
    const cb = countBy(o.carry), cn = countBy(n.carry);
    for (const [it, c] of cn) for (let k = cb.get(it) ?? 0; k < c; k++) out.push({ seat, gain: true, html: '✋', text: itemLabel(it) });
    for (const [it, c] of cb) for (let k = cn.get(it) ?? 0; k < c; k++) out.push({ seat, gain: false, html: '✋', text: `${itemLabel(it)} handed on` });
    for (const k of ['P', 'M', 'S']) {
      const d = (n.inj[k] ?? 0) - (o.inj[k] ?? 0);
      if (d > 0) out.push({ seat, gain: false, html: `<span class="bw-inj bw-${k}">✚</span>`, text: `${INJURY_TRACKS[k]?.label ?? k} injury` });
      if (d < 0) out.push({ seat, gain: true, html: `<span class="bw-heal">♥</span>`, text: `${INJURY_TRACKS[k]?.label ?? k} healed` });
    }
    if (n.white > o.white) out.push({ seat, gain: true, html: '🎲', text: `+${n.white - o.white} white die` });
    if (n.dead && !o.dead) out.push({ seat, gain: false, html: '☠', text: 'fell' });
  });
  if (b.keys !== a.keys) out.push({ seat: s.cur, gain: true, html: '🗝', text: 'a key' });
  for (const f of (s.mystery?.found ?? []).slice(a.found)) {
    out.push({ seat: f.seat ?? s.cur, gain: true, html: '🔍', text: evidenceLabel(f.kind, f.code) });
  }
  return out.filter((c) => s.players[c.seat]);
}

// After every update of the game.
export function watchUpdate(s) {
  if (!s?.players?.length || s.phase === 'nostart') return;
  const now = snapshot(s);
  if (!last || last.seats.length !== now.seats.length) { last = now; lastCur = s.cur; render(s); return; }
  const changes = diff(last, now, s);
  // A new round: last round's receipts go.
  if (now.round !== last.round) receipts = receipts.filter((r) => r.round >= now.round);
  last = now;
  for (const c of changes) {
    const pl = s.players[c.seat];
    const r = receipts.find((x) => x.seat === c.seat && x.open);
    if (r) r.gains.push(c);
    if (pl.bot && c.gain) fly(c, s);
    summary.push(c);
    flash(c.seat);
  }
  // The turn has come to a human: what the others did since then.
  if (s.cur !== lastCur) {
    for (const r of receipts) if (r.seat !== s.cur) r.open = false;
    const pl = s.players[s.cur];
    if (pl && !pl.bot && s.players.some((p) => p.bot)) {
      showSummary(s, summary.filter((c) => c.seat !== s.cur));
      summary = [];
    }
    lastCur = s.cur;
  }
  render(s);
}

// --- a bot's turn, from play/bots.js -----------------------------------------------------
// Just before each action it takes: open its receipt (so what the action brings lands on it).
export function botWillAct(seat, s) {
  const pl = s?.players?.[seat];
  if (!pl || receipts.some((x) => x.seat === seat && x.open)) return;
  receipts.push({ seat, round: s.round, dice: [], from: pl.pos, to: pl.pos, gains: [], open: true });
}
// Each action it took (and the events it caused): dice, route, trail.
export function botAction(seat, action, s, events) {
  const pl = s.players[seat];
  if (!pl) return;
  let r = receipts.find((x) => x.seat === seat && x.open);
  if (!r) { r = { seat, round: s.round, dice: [], from: pl.pos, to: pl.pos, gains: [], open: true }; receipts.push(r); }
  if (action.type === 'roll') r.dice = (s.pool ?? []).map((d) => ({ v: d.v, kind: d.kind }));
  const steps = (events ?? []).filter((e) => e.type === 'step' && e.seat === seat);
  if (steps.length) {
    r.to = steps[steps.length - 1].to;
    if (on('botTrails')) play.showTrail?.([steps[0].from, ...steps.map((e) => e.to)], pl.colour);
  }
  if (s.cur !== seat || s.phase === 'over') r.open = false;
  render(s);
}

// --- showing it -----------------------------------------------------------------------------
const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const where = (i) => { if (i === undefined || i < 0) return '–'; const { x, y } = grid.coords(i); return `${String.fromCharCode(65 + x)}${y + 1}`; };
function render(s) {
  const playing = !!s?.players?.length && document.body.classList.contains('playing') && !document.body.classList.contains('intro');
  // The team strip.
  const strip = $('#teamStrip');
  if (strip) {
    strip.hidden = !playing || !on('teamStrip');
    if (!strip.hidden) {
      strip.innerHTML = s.players.map((p, k) => {
        const counts = Object.keys(OBOLS).map((t) => [t, p.inventory.obolcraft.filter((o) => o.type === t).length]).filter(([, n]) => n);
        const inj = ['P', 'M', 'S'].map((t) => (p.injuries?.[t] ? `<span class="bw-inj bw-${t}">${p.injuries[t]}</span>` : '')).join('');
        return `<div class="ts-row${k === s.cur ? ' cur' : ''}${p.dead ? ' dead' : ''}" data-seat="${k}">` +
          `<span class="ts-chip" style="background:${p.colour}">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>` +
          `<span class="ts-obols">${counts.map(([t, n]) => `${obolHTML(t)}<b>${n}</b>`).join('') || '<i>no Obols</i>'}</span>` +
          `<span class="ts-eq" title="Equipment">🎒${p.inventory.equipment.length}</span>${p.carry?.length ? `<span title="Carrying">✋${p.carry.length}</span>` : ''}${inj}` +
          '</div>';
      }).join('');
    }
  }
  // The receipts.
  const box = $('#botReceipts');
  if (box) {
    // (A receipt with nothing on it yet, no dice, no move, no gains, isn't shown.)
    const list = receipts.filter((r) => s?.players?.[r.seat]?.bot && (r.dice.length || r.gains.length || r.from !== r.to));
    box.hidden = !playing || !on('botReceipts') || !list.length;
    if (!box.hidden) {
      box.innerHTML = list.map((r, n) => {
        const p = s.players[r.seat];
        return `<button type="button" class="rc${r.open ? ' open' : ''}" data-rc="${n}" style="--c:${p.colour}">` +
          `<span class="rc-head"><b>${esc(p.name)} 🤖</b>${r.dice.length ? `<span class="rc-dice">${r.dice.map((d) => `${FACE[d.v] ?? d.v}`).join('')}</span>` : ''}</span>` +
          (r.from !== r.to ? `<span class="rc-route">${where(r.from)} → ${where(r.to)}</span>` : '') +
          (r.gains.length ? `<span class="rc-gains">${r.gains.map((c) => `<span class="${c.gain ? 'g' : 'l'}" title="${esc(c.text)}">${c.html}<small>${esc(c.text)}</small></span>`).join('')}</span>` : '') +
          '</button>';
      }).join('');
      box.querySelectorAll('[data-rc]').forEach((b) => { b.onclick = () => { const r = list[Number(b.dataset.rc)]; lookAt(s.players[r.seat].pos); }; });
    }
  }
}
// A chip that just changed glows for a moment.
function flash(seat) {
  const row = document.querySelector(`#teamStrip .ts-row[data-seat="${seat}"]`);
  if (!row) return;
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}
// A gain pops off the pawn and flies to its chip on the strip.
function fly(c, s) {
  if (!on('botFly')) return;
  const pl = s.players[c.seat];
  const from = screenOf(pl.pos);
  if (from.behind) return;
  const row = document.querySelector(`#teamStrip .ts-row[data-seat="${c.seat}"]`);
  const to = row && !$('#teamStrip').hidden ? row.getBoundingClientRect() : null;
  const el = document.createElement('div');
  el.className = 'bw-fly';
  el.innerHTML = `${c.html}<small>${esc(c.text)}</small>`;
  el.style.left = `${from.x}px`;
  el.style.top = `${from.y - 30}px`;
  document.body.append(el);
  requestAnimationFrame(() => {
    el.classList.add('go');
    if (to) { el.style.left = `${to.left + 30}px`; el.style.top = `${to.top + to.height / 2}px`; } else el.style.top = `${from.y - 90}px`;
  });
  setTimeout(() => el.remove(), 1500);
}
// When it's your turn: what the others did since your last.
function showSummary(s, changes) {
  const el = $('#roundSummary');
  if (!el || !on('roundSummary') || !changes.length) return;
  const by = new Map();
  for (const c of changes) (by.get(c.seat) ?? by.set(c.seat, []).get(c.seat)).push(c);
  el.innerHTML = `<b class="rs-title">Since your last turn</b>` + [...by].map(([seat, list]) => {
    const p = s.players[seat];
    return `<div class="rs-row"><span class="ts-chip" style="background:${p.colour}">${esc(p.name)}${p.bot ? ' 🤖' : ''}</span>` +
      list.map((c) => `<span class="${c.gain ? 'g' : 'l'}">${c.html} ${esc(c.text)}</span>`).join('<span class="rs-sep">·</span>') + '</div>';
  }).join('') + '<small class="rs-hint">Tap to keep this up</small>';
  el.hidden = false;
  el.classList.remove('pinned');
  clearTimeout(showSummary.t);
  showSummary.t = setTimeout(() => { if (!el.classList.contains('pinned')) el.hidden = true; }, 7000);
}
// Tap a receipt: the camera swings over to that investigator.
function lookAt(i) {
  if (i === undefined || i < 0) return;
  const { x, y } = grid.coords(i);
  const target = cellToWorld(x, y);
  const back = camera.position.clone().sub(controls.target);
  __set_camTween({ t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: target.clone().add(back), toTarget: target });
}
