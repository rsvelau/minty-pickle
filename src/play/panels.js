// The play demo's panels: evidence and cards, Casebook and Field Guide,
// injuries and the monster's intent, Obolcraft and the inventory.

import { cellLabel } from '../core/state.js';
import { OBOLS, monsterDef, obolCounts, OBOL_TYPES, INVENTORY_TABS } from './play.js';
import { evidenceLabel, ATTACK_TYPES, LAIRS, OBSERVATIONS } from '../game/cards/evidence.js';
import { INJURY_TRACKS } from '../game/cards/injuries.js';
import { RECIPE_BY_ID, RECIPES, blocked as craftBlocked, ANY, payFits, autoPay } from '../game/obolcraft.js';
import { MONSTER_BY_ID, DAMAGE_KINDS, starsText } from '../game/cards/monsters.js';
import { matchesEvidence } from '../game/mystery.js';
import { grid, ui } from '../app/config.js';
import { $ } from '../app/dom.js';
import { toast } from '../app/files.js';
import { defenseTotal, dieHTML, endCellPick, play, startCellPick } from './playView.js';
import { __set_camTween, camera, cellToWorld, controls } from '../render/scene.js';
import { EQUIPMENT_BY_ID } from '../game/cards/equipment.js';
import { EVENT_CATEGORIES } from '../game/cards/events.js';
import { targetsFor, actionRoll, abilityReady, killObjective, discardOptions } from '../game/equipmentPlay.js';
import { checkRequirement } from '../game/cards/requirements.js';
import { eventCard } from '../game/decks.js';
import { choicesFor } from '../game/eventPlay.js';
import { sacrificeSeat, SCOUTING_STORY } from '../game/rules.js';
import { scriptOf, mapSites, knownMonster } from '../game/objectives/scripts.js';
import { progressLines, describeItem } from '../game/objectives/verbs.js';
import { skillStatus, COSOR_CARD } from '../game/skills.js';
import { MONSTER_TEXT } from '../game/cards/monsterText.js';
import { showSheet, hideSheet, sheetOpen, dragToClose } from './sheets.js';
import { initFeed } from './feed.js';

// Module state: assigned by init() below, in the same order as before the split.
export let OBOL_GLYPHS, DMG_SVG, ATTACK_GLYPH, cardQueue, caseUI, craftUI;
export let inv, teamUI;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // --- Investigating and Obols ------------------------------------------------------
  OBOL_GLYPHS = {
    attack: '<path d="M7 4.5 10.5 19.5M11.5 4 14 18.5M16 5 17.5 15.5"/>',
    event: '<path d="M4 9.5c3-3 6 2.5 9 0s5-1.5 7 0M4 14.5c3-3 6 2.5 9 0s5-1.5 7 0"/>',
    equipment: '<circle cx="8" cy="12" r="3.6"/><path d="M11.6 12H20M17 12v3.2M19.6 12v2.2"/>',
    evidence: '<path d="M3 12c4-6.5 14-6.5 18 0-4 6.5-14 6.5-18 0z"/><circle cx="12" cy="12" r="2.6"/>',
  };
  $('#askYes').addEventListener('click', () => play.answerInvestigate(true));
  $('#askNo').addEventListener('click', () => play.answerInvestigate(false));
  $('#obolReveal').addEventListener('click', () => { $('#obolReveal').hidden = true; });

  // --- The mystery: choosing evidence, cards turning over, Casebook, Field Guide -------
  // Damage-type icons, as on the monster cards: claws (Physical, red), a brain
  // (Mental, blue), a skull (Spiritual, green).
  DMG_SVG = {
    P: '<path d="M6 3.5 9.5 20M11.5 3 13.5 19.5M17 4.5 17.5 17"/>',
    M: '<path d="M9 5a3.2 3.2 0 0 0-5 3 3 3 0 0 0 0 5 3.2 3.2 0 0 0 5 4.5V5zM15 5a3.2 3.2 0 0 1 5 3 3 3 0 0 1 0 5 3.2 3.2 0 0 1-5 4.5V5z"/><path d="M9 9.5H7M15 9.5h2M9 14H6.5M15 14h2.5"/>',
    S: '<path d="M12 3a7 7 0 0 0-7 7c0 2.6 1.3 4.3 3 5.3V19h8v-3.7c1.7-1 3-2.7 3-5.3a7 7 0 0 0-7-7z"/><circle cx="9.2" cy="10.5" r="1.6"/><circle cx="14.8" cy="10.5" r="1.6"/><path d="M10.5 19v2M13.5 19v2"/>',
  };
  ATTACK_GLYPH = { P: dmgIcon('P'), M: dmgIcon('M'), S: dmgIcon('S') };
  // Cards queue up: a new one waits until the one showing is dismissed (or
  // times out), so nothing is missed when several things happen at once.
  cardQueue = [];
  $('#cardPop').addEventListener('click', hideCard);
  caseUI = { tab: 'case', showAll: false, seen: 0 };
  $('#caseClose').addEventListener('click', closeCasebook);
  document.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => { caseUI.tab = b.dataset.ctab; renderCasebook(); }));
  $('#intentBanner').addEventListener('click', () => {
    const mo = play.state.monsters.find((m) => m.intents);
    if (!mo) return;
    intentOpen = !intentOpen;
    renderIntent();
    if (!intentOpen) return;
    const { x, y } = grid.coords(mo.pos);
    const p = cellToWorld(x, y);
    const offset = camera.position.clone().sub(controls.target);
    __set_camTween({ t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: p.clone().add(offset), toTarget: p });
  });

  // --- Obolcraft: trade Obols for effects ---------------------------------------------------
  // A black slot takes any colour. Choose a recipe, check (or change) which
  // Obols pay for it, then Craft. Only on your own turn, before moving.
  craftUI = { recipe: null, pay: [], target: null };

  // --- Inventory -----------------------------------------------------------------------
  // Each player's own inventory, in tabs. Opens on the current player (the bag
  // button on the play bar, or I), or on whoever you tap in the scoreboard.
  inv = { player: 0, tab: 'skills', view: 'ready' };
  try { inv.view = localStorage.getItem('minty-pickle.skillsView') === 'items' ? 'items' : 'ready'; } catch { /* ignore */ }
  $('#invClose').addEventListener('click', closeInventory);

  // --- The dock: Team, Skills, Case, More (sheets.js keeps one open at a time). ---------
  // A dock button opens its sheet, or closes it if it's the one open.
  const openers = { teamSheet: () => openTeam(), inventory: () => openInventory(), casebook: () => openCasebook(), moreSheet: () => showSheet('moreSheet') };
  const closers = { teamSheet: () => hideSheet('teamSheet'), inventory: closeInventory, casebook: closeCasebook, moreSheet: () => hideSheet('moreSheet') };
  document.querySelectorAll('.dock-btn[data-sheet]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.sheet;
    if (sheetOpen(id)) closers[id](); else openers[id]();
  }));
  for (const id of Object.keys(closers)) {
    $(`#${id}`).querySelector('[data-close]')?.addEventListener('click', closers[id]);
    dragToClose(id, closers[id]);
  }
  // Sheets and the things above the dock sit on its measured height.
  // Phones held sideways get the dock as a strip down the right edge (CSS:
  // .dock-rail), so the board keeps its height.
  const rail = matchMedia('(orientation: landscape) and (max-height: 540px)');
  const measure = () => {
    const d = $('#playHud'), root = document.documentElement.style;
    if (!d.offsetHeight) return;
    root.setProperty('--dock-h', rail.matches ? '0px' : `${d.offsetHeight}px`);
    root.setProperty('--dock-w', rail.matches ? `${d.offsetWidth}px` : '0px');
  };
  new ResizeObserver(measure).observe($('#playHud'));
  // The message feed sits above the dice tray when it's up.
  new ResizeObserver(() => {
    const t = $('#playTray');
    document.documentElement.style.setProperty('--tray-h', t.hidden || !t.offsetHeight ? '0px' : `${t.offsetHeight + 8}px`);
  }).observe($('#playTray'));
  initFeed();
  rail.addEventListener('change', measure);
  // Team: tap someone to see their injuries in full (and their skills).
  teamUI = { player: null };
  $('#playBoard').addEventListener('click', (e) => {
    const row = e.target instanceof Element && e.target.closest('[data-inv]');
    if (row) { teamUI.player = Number(row.dataset.inv); renderTeam(); }
  });
}

export function obolHTML(type, big = false) {
  return `<span class="obol obol-${type}${big ? ' big' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24">${OBOL_GLYPHS[type]}</svg></span>`;
}
// "Investigate?" while the runner stands on an Investigation space.
export function renderAsk() {
  const s = play.state;
  const show = ui.tool === 'play' && s.phase === 'asking' && !!s.ask;
  $('#askCard').hidden = !show;
  if (!show) return;
  const cur = s.players[s.cur];
  const { x, y } = grid.coords(s.ask.i);
  const curious = !!s.ask.curious;
  if (s.ask.relight) {
    // Shadow People: relight the candle at a Missing-person memorial for an Obol.
    const n = cur.inventory?.obolcraft?.length ?? 0;
    $('#askTitle').textContent = 'Relight your candle?';
    $('#askSub').innerHTML = `<b style="color:${cur.colour}">${cur.name}</b> passes the memorial at ${cellLabel(x, y)} · costs 1 Obol (you have ${n})`;
    $('#askDefense').hidden = true;
    return;
  }
  if (s.ask.anchor) {
    // Poltergeist: spend a 6 to destroy the spiritual anchor here.
    $('#askTitle').textContent = 'Destroy the anchor?';
    $('#askSub').innerHTML = `<b style="color:${cur.colour}">${cur.name}</b> at ${cellLabel(x, y)} · spend a 6 to break the Poltergeist's hold here`;
    $('#askDefense').hidden = true;
    return;
  }
  $('#askTitle').textContent = curious ? 'Keep investigating?' : 'Investigate?';
  const low = curious ? Math.min(...s.defSlots.map((n) => s.pool[n].v)) : 0;
  $('#askSub').innerHTML = `<b style="color:${cur.colour}">${cur.name}</b> at ${cellLabel(x, y)} · ` +
    (curious ? `Curious: another Obol here for your Defense ${low}` : '') +
    (curious ? '' : `${s.bag.length ? `draw an Obol (${s.bag.length} in the bag)` : 'the Obol bag is empty'}`);
  if (curious) { $('#askDefense').hidden = true; return; }
  // Last chance to brace before drawing: unused rolled dice and white dice
  // in reserve can go into Defense (an Attack Obol strikes at once).
  const free = s.pool.map((d, n) => ({ d, n })).filter(({ d, n }) => !d.spent && !s.slots.includes(n) && !s.defSlots.includes(n));
  const show2 = free.length || s.white > 0 || s.defSlots.length;
  $('#askDefense').hidden = !show2;
  if (!show2) return;
  $('#askPool').innerHTML = free.map(({ d }) => dieHTML(d)).join('') +
    Array.from({ length: s.white }, () => '<button class="tdie white reserve" title="Roll a white die from reserve">roll</button>').join('');
  [...$('#askPool').querySelectorAll('.tdie:not(.reserve)')].forEach((b, k) => { b.onclick = () => play.toggleSlot(free[k].n, 'defense'); });
  [...$('#askPool').querySelectorAll('.reserve')].forEach((b) => { b.onclick = () => play.rollWhite(); });
  const defs = s.defSlots.map((n) => dieHTML(s.pool[n], 'in-def'));
  for (let k = s.defSlots.length; k < s.maxDefense; k++) defs.push('<span class="tdie slot def"></span>');
  $('#askDef').innerHTML = defs.join('');
  [...$('#askDef').querySelectorAll('.in-def')].forEach((b, k) => { b.onclick = () => play.toggleSlot(s.defSlots[k], 'defense'); });
  defenseTotal($('#askDefTotal'), cur);
  $('#askDefHint').textContent = s.defSlots.length >= s.maxDefense ? 'Defense slots full' :
    'Last chance: brace before you investigate (tap a die to slot it into Defense)';
}
// The Obol just drawn, shown for a moment (tap to dismiss).
export let obolTimer = 0;
export function showObol({ player, type, left }) {
  const el = $('#obolReveal');
  $('#obolCoin').innerHTML = type ? obolHTML(type, true) : '';
  $('#obolTitle').textContent = type ? `${OBOLS[type].label} Obol` : 'Nothing found';
  $('#obolSub').innerHTML = type
    ? `<b style="color:${player.colour}">${player.name}</b> drew it · ${left} left in the bag`
    : `<b style="color:${player.colour}">${player.name}</b>: the Obol bag is empty`;
  el.hidden = false;
  clearTimeout(obolTimer);
  obolTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
export const dmgIcon = (t) => `<span class="dmg-icon dmg-${t}" aria-hidden="true"><svg viewBox="0 0 24 24">${DMG_SVG[t] ?? ''}</svg></span>`;
export const kindType = (kind) => ({ physical: 'P', mental: 'M', spiritual: 'S' })[kind];
export const OBS_GLYPH = '👁', LAIR_GLYPH = '⚰';
export const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const placeLabel = (cell) => { const { x, y } = grid.coords(cell); return cellLabel(x, y); };

// Evidence Obol: the remaining face-down cards, to tap.
export function renderRevealSheet() {
  const s = play.state;
  const deck = s.mystery?.deck ?? [];
  const show = ui.tool === 'play' && s.phase === 'revealing';
  $('#revealSheet').hidden = !show;
  if (!show) return;
  const cur = s.players[s.cur];
  const left = deck.filter((c) => !c).length;
  const at = s.mystery?.pendingReveal?.cell;
  $('#revealTitle').textContent = at !== undefined && grid.cells[at]?.marker === 'research' ? 'Research: reveal a piece of evidence' : 'Evidence found';
  $('#revealSub').innerHTML = `<b style="color:${cur.colour}">${cur.name}</b>: choose 1 of ${left} face-down cards to turn over`;
  const host = $('#revealCards');
  const key = deck.map((c) => (c ? 1 : 0)).join('');
  if (host.dataset.key === key) return;
  host.dataset.key = key;
  let n = 0;
  host.innerHTML = deck.map((c, i) => (c ? '<span class="card-back gone"></span>'
    : `<button type="button" class="card-back" data-card="${i}" aria-label="Face-down evidence card ${++n}">?</button>`)).join('');
  host.querySelectorAll('[data-card]').forEach((b) => b.addEventListener('click', () => play.revealCard(Number(b.dataset.card))));
}

// A card turning over, big and centred (tap to dismiss).
export let cardTimer = 0;
export function showCard(c) {
  if (!$('#cardPop').hidden) { cardQueue.push(c); return; }
  showCardNow(c);
}
export function showCardNow(c) {
  const card = $('#cardPopCard');
  card.className = 'paper-card paper';
  let html = '';
  let stay = false;
  if (c.kind === 'observation' || c.kind === 'lair') {
    const lair = c.kind === 'lair';
    if (lair) card.classList.add('lair');
    html = `<div class="pc-kind">${lair ? 'Evidence · the Lair' : 'Evidence · Observation'}</div>` +
      `<div class="pc-glyph">${lair ? LAIR_GLYPH : OBS_GLYPH}</div>` +
      `<div class="pc-title">${esc(evidenceLabel(c.kind, c.code))}</div><div class="pc-sub">${esc(c.sub)}</div>`;
  } else if (c.kind === 'attack') {
    card.classList.add('attack');
    card.style.setProperty('--atk', ATTACK_TYPES[c.code].colour);
    html = `<div class="pc-kind">${c.first ? 'Attacked! The Attack card' : 'Attacked again'}</div>` +
      `<div class="pc-glyph">${ATTACK_GLYPH[c.code]}</div>` +
      `<div class="pc-title">${ATTACK_TYPES[c.code].label}</div><div class="pc-sub">${esc(c.sub)}</div>`;
  } else if (c.kind === 'hurt') {
    const e = c.e;
    card.classList.add('hurt');
    card.style.setProperty('--atk', ATTACK_TYPES[e.attack].colour);
    html = `<div class="pc-kind">${esc(e.source)}</div><div class="pc-glyph">${ATTACK_GLYPH[e.attack]}</div>` +
      `<div class="pc-title">${e.outcome === 'blocked' ? 'Blocked!' : e.outcome === 'killed' ? `${esc(e.player?.name ?? '')} is dead` : e.outcome === 'dying' ? `${esc(e.player?.name ?? '')} falls`
        : e.outcome === 'healed' ? 'Healed instead' : e.outcome === 'reflected' ? 'Reflected!' : e.outcome === 'redirected' ? 'Turned aside'
          : esc(INJURY_TRACKS[e.attack].tiers[e.tier - 1].name)}</div>` +
      `<div class="pc-sub">${esc(hitText(e))}</div>`;
  } else if (c.kind === 'npc') {
    const e = c.e;
    const saved = e.outcome === 'saved';
    const wounded = e.outcome === 'wounded';
    card.classList.add('hurt');
    card.style.setProperty('--atk', saved ? '#3fae5a' : '#7a1a10');
    html = `<div class="pc-kind">The swarm falls on a townsperson</div><div class="pc-glyph">${saved ? '🛡' : '☠'}</div>` +
      `<div class="pc-title">${esc(e.npc?.name ?? 'A victim')} ${saved ? 'is saved' : wounded ? 'is wounded' : 'dies'}</div>` +
      `<div class="pc-sub">${saved ? `${esc(e.defenderPlayer?.name ?? '')}'s defense ${e.defense} holds against ${e.amount}.`
        : `${e.amount} damage${e.defenderPlayer ? ` against ${esc(e.defenderPlayer.name)}'s defense ${e.defense}` : ', and no one was close enough to defend them'}. ${wounded ? 'They survive this once: one more hit will kill them.' : 'Every player suffers its rage.'}`}</div>`;
  } else if (c.kind === 'sacrifice' && c.e.reacted) {
    const e = c.e;
    card.classList.add('hurt');
    card.style.setProperty('--atk', '#3fae5a');
    html = `<div class="pc-kind">${esc(e.player?.name ?? '')} discards ${esc(EQUIPMENT_BY_ID[e.item]?.name ?? '')}</div><div class="pc-glyph">✦</div>` +
      `<div class="pc-title">Undone</div><div class="pc-sub">${esc(e.text)}.</div>`;
  } else if (c.kind === 'sacrifice') {
    const e = c.e;
    card.classList.add('hurt');
    card.style.setProperty('--atk', e.saved ? '#3fae5a' : '#7a1a10');
    html = `<div class="pc-kind">The Sacrificial Fetish</div><div class="pc-glyph">${e.saved ? '✦' : '☠'}</div>` +
      `<div class="pc-title">${esc(e.player?.name ?? '')} ${e.saved ? 'rises again' : 'is dead'}</div>` +
      `<div class="pc-sub">${e.saved ? `${esc(e.carrierPlayer?.name ?? '')} paid an Obol and the Fetish crumbled. Every injury is gone.` : 'The Fetish was kept.'}</div>`;
  } else if (c.kind === 'exhaust') {
    const e = c.e;
    html = `<div class="pc-kind">Exhausted</div><div class="pc-glyph">🎲</div>` +
      `<div class="pc-title">${esc(e.player?.name ?? '')} loses ${e.dice.length === 1 ? 'a die' : `${e.dice.length} dice`}</div>` +
      `<div class="pc-sub">${e.dice.map((d) => `${d.kind} ${d.v}`).join(', ')}: gone for the rest of the game` +
      `${e.dice.some((d) => d.kind === 'black') ? '. One fewer black die from now on.' : '.'}</div>`;
  } else if (c.kind === 'craft') {
    const e = c.e;
    html = `<div class="pc-kind">Obolcraft</div><div class="pc-glyph obol-row" style="justify-content:center">${e.spent.map((t) => obolHTML(t)).join('')}</div>` +
      `<div class="pc-title">${esc(RECIPE_BY_ID[e.recipe]?.text ?? '')}</div><div class="pc-sub">${esc(e.text)}.</div>`;
  } else if (c.kind === 'equipment') {
    const card = EQUIPMENT_BY_ID[c.e.id];
    html = `<div class="pc-kind">${esc(c.e.player?.name ?? '')} found equipment</div><div class="pc-title">${esc(card?.name ?? '')}</div>` +
      (card ? abilitiesHTML(card) : '');
    stay = true;
  } else if (c.kind === 'event') {
    const card = eventCard(c.e.id);
    const mindset = card?.category === 'mindset';
    html = `<div class="pc-kind">${mindset ? `${esc(c.e.player?.name ?? '')}'s new Mindset` : `Event · ${esc(EVENT_CATEGORIES[card?.category]?.label ?? '')}`}</div><div class="pc-title">${esc(card?.name ?? '')}</div>` +
      `<div class="pc-sub">${esc(play.midnight() && card?.afterMidnight ? card.afterMidnight : card?.text ?? '')}</div>` +
      `<div class="pc-note">${play.midnight() && card?.afterMidnight ? 'After midnight: the clock has stopped, so this is the card’s midnight version. ' : ''}${mindset ? 'Yours until another Mindset replaces it. Its effect is played at the table for now.' : 'Event effects are played at the table for now.'}</div>`;
    stay = true;
  } else if (c.kind === 'equipUse') {
    html = `<div class="pc-kind">${esc(c.e.player?.name ?? '')} uses ${esc(EQUIPMENT_BY_ID[c.e.item]?.name ?? '')}</div><div class="pc-title">${esc(c.e.ability)}</div>` +
      `<div class="pc-sub">${esc(c.e.text.replace(/^[^:]*: [^.(]*(\([^)]*\))?( on [^.]*)?\. /, ''))}</div>`;
  } else if (c.kind === 'escaped') {
    const e = c.e;
    html = `<div class="pc-kind">Escaped</div><div class="pc-glyph">🚐</div><div class="pc-title">${esc(e.player?.name ?? '')} is out</div>` +
      `<div class="pc-sub">${e.first ? 'The team has won. Play on until everyone has escaped or fallen.' : 'Safe across the river.'}</div>`;
  } else if (c.kind === 'won') {
    const st = play.session.state;
    const escaped = st?.players.filter((p) => p.escaped) ?? [];
    html = escaped.length
      ? `<div class="pc-kind">Dawn, at last</div><div class="pc-glyph">☀</div><div class="pc-title">They got away</div><div class="pc-sub">${esc(escaped.map((p) => p.name).join(', '))} escaped. The investigators win.</div>`
      : '<div class="pc-kind">Dawn, at last</div><div class="pc-glyph">☀</div><div class="pc-title">The objective is achieved</div><div class="pc-sub">The investigators survive the night.</div>';
    stay = true;
  } else if (c.kind === 'over') {
    html = '<div class="pc-kind">The night wins</div><div class="pc-glyph">☠</div><div class="pc-title">Everyone is dead</div>' +
      '<div class="pc-sub">Restart to try again.</div>';
    stay = true;
  } else if (c.kind === 'named') {
    const name = MONSTER_BY_ID[c.monster]?.name ?? '';
    html = c.correct
      ? `<div class="pc-kind">Initiative!</div><div class="pc-glyph">☠</div><div class="pc-title">The ${esc(name)}</div>` +
        `<div class="pc-sub">The signs fit. Where it will rise is marked on the map, and the objectives are showing.</div>`
      : `<div class="pc-kind">Named: the ${esc(name)}</div><div class="pc-glyph">✗</div><div class="pc-title">The signs don't fit</div>` +
        `<div class="pc-sub">No Initiative this time. Keep gathering evidence: you'll know at midnight.</div>`;
    stay = true;
  } else if (c.kind === 'monster') {
    const m = MONSTER_BY_ID[c.monster];
    card.classList.add('monster');
    html = `<div class="pc-kind" style="text-align:center">${c.identified ? 'All the evidence is in · its objectives are marked' : 'Midnight · it\'s here'}</div><div class="pc-title">The ${esc(m.name)}</div>` +
      `<div class="pc-stars" title="Difficulty ${m.stars ?? 1} of 5">${starsText(m.stars ?? 1)}</div>` +
      (c.correct ? '<div class="pc-sub" style="text-align:center">You named it right</div>' : '') +
      guideDetails(m, currentFound(), true, { reveal: true });
    stay = true;
  }
  card.innerHTML = html;
  $('#cardPop').hidden = false;
  clearTimeout(cardTimer);
  if (!stay) cardTimer = setTimeout(hideCard, cardQueue.length ? 2600 : 4200);
  const casebook = c.kind === 'observation' || c.kind === 'lair' || (c.kind === 'attack' && c.first);
  $('#cardPopHint').textContent = (casebook && !stay ? 'Tap to continue · added to the Casebook' : 'Tap to continue') +
    (cardQueue.length ? ` · ${cardQueue.length} more` : '');
}
export function hideCard() {
  $('#cardPop').hidden = true;
  clearTimeout(cardTimer);
  if (cardQueue.length) setTimeout(() => showCardNow(cardQueue.shift()), 120);
  else { renderEventChoice(); renderSacrifice(); } // a pending choice comes up once its card is read
}

// What's been found, in the shape matchesEvidence wants.
export function currentFound() {
  const my = play.state.mystery;
  return { attack: my?.attack?.code ?? null, cards: (my?.found ?? []).filter((f) => f.kind !== 'attack') };
}
export function markCaseNew() { $('#caseBadge').hidden = !$('#casebook').hidden ? true : false; }
export function openCasebook(tab) {
  if (tab) caseUI.tab = tab;
  $('#caseBadge').hidden = true;
  renderCasebook();
  showSheet('casebook');
}
export function closeCasebook() { hideSheet('casebook'); }

export function renderCasebook() {
  document.querySelectorAll('[data-ctab]').forEach((b) => b.classList.toggle('on', b.dataset.ctab === caseUI.tab));
  $('#caseTitle').textContent = caseUI.tab === 'case' ? 'Casebook' : 'Field Guide';
  const body = $('#caseBody');
  const my = play.state.mystery;
  if (!my) {
    body.innerHTML = '<p class="case-note">No mystery in this game. Choose <b>Mystery</b> under Game settings → Monster.</p>';
    return;
  }
  const scroll = body.scrollTop;
  body.innerHTML = caseUI.tab === 'case' ? casebookHTML(my) : fieldGuideHTML(my);
  body.scrollTop = scroll;
  body.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => {
    closeCasebook();
    const i = Number(el.dataset.goto);
    const { x, y } = grid.coords(i);
    const p = cellToWorld(x, y);
    const offset = camera.position.clone().sub(controls.target);
    play.state.follow = false;
    $('#playFollow').checked = false;
    __set_camTween({ t: 0, fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos: p.clone().add(offset), toTarget: p });
  }));
  body.querySelector('#openGuide')?.addEventListener('click', () => { caseUI.tab = 'guide'; renderCasebook(); });
  body.querySelector('#objDone')?.addEventListener('click', (ev) => {
    if (!ev.currentTarget.dataset.confirm) { ev.currentTarget.dataset.confirm = '1'; ev.currentTarget.textContent = 'Tap again to confirm'; return; }
    play.session.dispatch({ type: 'objective', seat: play.state.cur });
    renderCasebook();
  });
  body.querySelector('#guideAll')?.addEventListener('change', (e) => { caseUI.showAll = e.target.checked; renderCasebook(); });
  body.querySelectorAll('[data-name]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    const id = b.dataset.name;
    if (!confirmName(id)) return;
    if (play.nameMonster(id)) closeCasebook();
  }));
}
export function confirmName(id) {
  return window.confirm(`Name the ${MONSTER_BY_ID[id].name}?\n\nThe team gets one try before midnight. If you're right, you earn Initiative.`);
}

export function casebookHTML(my) {
  const slot = (kind, f, label, wide = false) => (f
    ? `<button type="button" class="case-slot filled${wide ? ' wide' : ''}${kind === 'attack' ? ` attack-${f.code}` : ''}" data-goto="${f.cell}" title="Show where it was found">` +
      `<span class="cs-kind">${label}</span><span class="cs-name${kind === 'attack' ? ` dmg-${f.code}` : ''}">${kind === 'attack' ? `${dmgIcon(f.code)} ` : ''}${esc(evidenceLabel(kind, f.code))}</span>` +
      `<span class="cs-where">${esc(f.seat === null ? 'Revealed at midnight' : play.state.players[f.seat]?.name ?? '')} · ${placeLabel(f.cell)} · ${esc(f.time)}</span></button>`
    : `<div class="case-slot empty${wide ? ' wide' : ''}"><span class="cs-kind">${label}</span><span class="cs-name">?</span>` +
      `<span class="cs-where">${kind === 'attack' ? 'Revealed when it attacks someone' : 'Turn over an Evidence card'}</span></div>`);
  const obs = my.found.filter((f) => f.kind === 'observation');
  const lair = my.found.find((f) => f.kind === 'lair');
  const pool = my.pool.map((id) => MONSTER_BY_ID[id]);
  const fits = pool.filter((c) => matchesEvidence(c, currentFound()));
  const guess = my.guess ? MONSTER_BY_ID[my.guess.id]?.name : null;
  const status = my.revealed
    ? `It's the <b>${esc(MONSTER_BY_ID[my.monster]?.name ?? '')}</b>.${guess ? ` You named the ${esc(guess)}${my.guess.correct ? ', and you were right.' : '.'}` : ''}`
    : guess
      ? (my.guess.correct ? `You named the <b>${esc(guess)}</b>. <b>Initiative:</b> its spawn point is marked ☠.` : `You named the <b>${esc(guess)}</b>, but the signs didn't fit.`)
      : 'Name the monster from the Field Guide before midnight to earn <b>Initiative</b> (one try).';
  return `<div class="case-slots">` +
    slot('attack', my.attack, 'Attack', true) +
    [0, 1, 2].map((k) => slot('observation', obs[k], `Observation ${k + 1}`)).join('') +
    slot('lair', lair, 'Lair') +
    `</div>` +
    `<p class="case-note">${fits.length === 1 ? 'Only <b>one</b> monster fits' : `<b>${fits.length}</b> of ${pool.length} monsters fit`} the evidence so far.</p>` +
    `<p class="case-note">${status}</p>` +
    objectiveHTML(my) +
    mapEffectsHTML() +
    `<div class="case-actions"><button type="button" class="ink" id="openGuide">Open the Field Guide</button></div>`;
}

// A monster card as players read it (Field Guide, and the card when it is
// revealed): health, toughness and action dice up top; traits, weak to,
// immune to; its constant rules; each ability with the die faces that call it
// and its damage type; the weakness track as steps; the objective; and (in the
// Field Guide) its evidence, lit where it matches. Wording and icons come from
// cards/monsterText.js. `reveal`: its difficulty stars show too.
const MI = {
  move: '<span class="mi mi-move" title="Moves (spaces)">👣</span>',
  heal: '<span class="mi mi-heal" title="Heals">✚</span>',
  exhaust: '<span class="mi mi-ex" title="Exhausted: gone for the rest of the game">⛓ exhaust</span>',
  area: '<span class="mi mi-area" title="Everyone within reach">◎</span>',
  round: '<span class="mi mi-round" title="One round">⌛ 1 round</span>',
};
export function monsterText(text) {
  const sites = [];
  // Sites first, as placeholders without digits (so numbers bolding skips them).
  let t = esc(text).replace(/\{(\d+)\}/g, (_, n) => { sites.push(n); return `\u0001${String.fromCharCode(97 + sites.length - 1)}\u0002`; });
  t = t.replace(/(−?\+?\d+)/g, '<b class="mn">$1</b>');
  t = t.replace(/\{(move|heal|exhaust|area|round)\}/g, (_, k) => MI[k]);
  t = t.replace(/\{([PMS])\}/g, (_, k) => dmgIcon(k));
  t = t.replace(/🎲/g, '<span class="mi mi-die" title="One die">🎲</span>');
  return t.replace(/\u0001([a-z])\u0002/g, (_, c) => { const n = sites[c.charCodeAt(0) - 97]; return `<span class="mi-site" title="Site {${n}} on the map">${n}</span>`; });
}
export function guideDetails(c, found, open, { reveal = false } = {}) {
  const tx = MONSTER_TEXT[c.id] ?? {};
  const hitObs = new Set(found.cards.filter((f) => f.kind === 'observation').map((f) => f.code));
  const hitLair = found.cards.find((f) => f.kind === 'lair')?.code;
  const chip = (text, cls, title = '') => `<span class="ge-chip ${cls}"${title ? ` title="${esc(title)}"` : ''}>${text}</span>`;
  const ev = c.evidence;
  const evChips = [
    chip(`${dmgIcon(ev.attack)} ${esc(ATTACK_TYPES[ev.attack].label)} attack`, `atk-${ev.attack}${found.attack === ev.attack ? ' hit' : ''}`),
    ...ev.observations.map((o) => chip(esc(OBSERVATIONS[o].label), hitObs.has(o) ? 'hit' : '')),
    chip(`⚰ ${esc(LAIRS[ev.lair].label)}`, `lair${hitLair === ev.lair ? ' hit' : ''}`),
  ].join('');
  const stat = (v) => (v === null || v === undefined ? '∞' : v);
  const kinds = (list, cls, word) => list.map((k) => chip(`${word} ${DAMAGE_KINDS[k].icon} ${esc(DAMAGE_KINDS[k].label)}`, cls)).join('');
  const roll = (r) => (r === 'Persistent' ? 'Always' : String(r).replace('-', '–'));
  const abil = c.abilities.map((a) => {
    const t = kindType(a.kind);
    return `<div class="mc-ab k-${t ?? 'none'}"><span class="mc-roll${a.roll === 'Persistent' ? ' always' : ''}" title="${a.roll === 'Persistent' ? 'Always in effect' : `Its action die rolls ${roll(a.roll)}`}">${roll(a.roll)}</span>` +
      `<div class="mc-ab-body"><b class="mc-ab-name">${t ? dmgIcon(t) : '<span class="mc-none">◇</span>'} ${esc(a.name)}</b>` +
      `<span class="mc-ab-text">${monsterText(tx.says?.[a.name] ?? a.text)}</span></div></div>`;
  }).join('');
  const weak = c.weakness.map((k) => `${DAMAGE_KINDS[k].icon} ${esc(DAMAGE_KINDS[k].label)}`).join(' or ');
  const track = c.weaknessTrack.length ? `<div class="mc-track"><span class="mc-label">Weakness track · hits with ${weak}</span><ol>${c.weaknessTrack.map((w, k) =>
    `<li><span class="mc-hits" title="${w.hits === null ? 'Any time' : `After ${w.hits} hit${w.hits === 1 ? '' : 's'}`}">${w.hits === null ? '∞' : w.hits}</span><span>${monsterText(tx.track?.[k] ?? w.text)}</span></li>`).join('')}</ol></div>` : '';
  const rules = (tx.rules ?? [c.note]).filter(Boolean);
  return `<div class="ge-body mc">` +
    `<div class="mc-stats">` +
      `<span class="mc-stat" title="Health"><i>♥</i>${stat(c.hp)}<small>health</small></span>` +
      `<span class="mc-stat" title="Toughness: damage up to this much doesn’t get through"><i>⛨</i>${stat(c.toughness)}<small>tough</small></span>` +
      `<span class="mc-stat" title="Action dice it rolls each round"><i>🎲</i>${c.badge}<small>actions</small></span>` +
      (reveal ? `<span class="mc-stat mc-stars" title="Difficulty ${c.stars ?? 1} of 5">${starsText(c.stars ?? 1)}<small>difficulty</small></span>` : '') +
    `</div>` +
    `<div class="ge-chips">${c.traits.map((t) => chip(esc(t), 'trait')).join('')}${kinds(c.weakness, 'weak', 'Weak:')}${kinds(c.immune, 'imm', 'Immune:')}</div>` +
    (rules.length ? `<ul class="mc-rules">${rules.map((r) => `<li>${monsterText(r)}</li>`).join('')}</ul>` : '') +
    `<div class="mc-abils">${abil}</div>` +
    track +
    `<p class="mc-goal"><span class="mc-label">Objective</span>${monsterText(tx.goal ?? c.objective)}</p>` +
    (reveal ? '' : `<div class="mc-ev"><span class="mc-label">Evidence</span><div class="ge-chips">${evChips}</div></div>`) +
    `</div>`;
}

export function fieldGuideHTML(my) {
  const found = currentFound();
  const pool = my.pool.map((id) => MONSTER_BY_ID[id]).sort((a, b) => a.name.localeCompare(b.name));
  const fits = pool.filter((c) => matchesEvidence(c, found));
  const out = pool.filter((c) => !fits.includes(c));
  const canName = !my.guess && !my.revealed && play.state.phase !== 'nostart';
  const nFound = found.cards.length + (found.attack ? 1 : 0);
  const entry = (c, ruledOut) => {
    const hits = (found.attack && c.evidence.attack === found.attack ? 1 : 0)
      + found.cards.filter((f) => (f.kind === 'lair' ? f.code === c.evidence.lair : c.evidence.observations.includes(f.code))).length;
    return `<details class="guide-entry${ruledOut ? ' out' : ''}"${fits.length <= 2 && !ruledOut ? ' open' : ''}>` +
      `<summary><span class="ge-name">${esc(c.name)}</span><span class="ge-traits">${esc(c.traits.join(', '))}</span>` +
      `<span class="ge-fit">${ruledOut ? 'ruled out' : nFound ? `fits ${hits}/${nFound}` : ''}</span></summary>` +
      guideDetails(c, found) +
      (!ruledOut && canName ? `<div class="case-actions"><button type="button" class="ink" data-name="${c.id}">Name the ${esc(c.name)}</button></div>` : '') +
      `</details>`;
  };
  return `<div class="guide-top"><span>${nFound ? `${fits.length} of ${pool.length} fit the evidence` : `${pool.length} monsters could be out there`}</span>` +
    `<label><input type="checkbox" id="guideAll"${caseUI.showAll ? ' checked' : ''} />Show ruled out</label></div>` +
    fits.map((c) => entry(c, false)).join('') +
    (out.length ? (caseUI.showAll ? `<p class="ge-out-head">Ruled out</p>${out.map((c) => entry(c, true)).join('')}`
      : `<p class="ge-out-head">${out.length} ruled out (tick “Show ruled out” to see them)</p>`) : '');
}

// --- Injuries and the monster's declared action -----------------------------------
export function injuryPips(p) {
  const inj = p.injuries ?? { P: 0, M: 0, S: 0 };
  return ['P', 'M', 'S'].map((t) => `<span class="inj" style="--trk:${ATTACK_TYPES[t].colour};--trk-soft:${ATTACK_TYPES[t].soft}" title="${INJURY_TRACKS[t].label}: ${inj[t] ? INJURY_TRACKS[t].tiers[inj[t] - 1].name : 'unhurt'}">` +
    `${dmgIcon(t)}${[1, 2, 3].map((k) => `<i class="${inj[t] >= k ? `on${k}` : ''}"></i>`).join('')}</span>`).join('');
}
export function hitText(e) {
  const who = e.player?.name ?? '';
  const type = ATTACK_TYPES[e.attack].label;
  if (e.outcome === 'blocked') return `${who} blocks ${e.amount} ${type} damage (defense ${e.defense}).`;
  if (e.outcome === 'dying') return `${e.amount} ${type} damage against defense ${e.defense}. ${who} was at Death's Door: the Sacrificial Fetish could save them.`;
  if (e.outcome === 'killed') return `${e.amount} ${type} damage against defense ${e.defense}. ${who} was at Death's Door.`;
  // Spiritual damage tricks (equipment).
  if (e.outcome === 'healed') return `${e.amount} ${type} damage heals ${who} instead (Weeping Barrier).`;
  if (e.outcome === 'reflected') return `${e.amount} ${type} damage thrown back at the monster as Holy damage (Wrathful Penance).`;
  if (e.outcome === 'redirected') return `${e.amount} ${type} damage sent on by ${who}'s Spiritual Backlash.`;
  const tier = INJURY_TRACKS[e.attack].tiers[(e.tier ?? 1) - 1];
  return `${who} takes ${e.amount} ${type} damage against defense ${e.defense}: ${tier?.name}. ${tier?.text}.`;
}
export function renderIntent() {
  const el = $('#intentBanner');
  const s = play.state;
  const mo = ui.tool === 'play' ? s.monsters.find((m) => m.intents) : null;
  el.hidden = !mo;
  if (!mo) return;
  const name = monsterDef(mo.kind)?.label ?? 'The monster';
  const danger = (mo.danger ?? []).map((k) => s.players[k]?.name).filter(Boolean);
  // Compact: just the action names; tap to expand into the card text.
  const acts = intentOpen
    ? mo.intents.map((i, n) => `<span class="act ${kindType(i.kind) ? `dmg-${kindType(i.kind)}` : ''}">${mo.intents.length > 1 ? `${n + 1}. ` : ''}🎲${i.roll} ${kindType(i.kind) ? dmgIcon(kindType(i.kind)) : ''}<b>${esc(i.name)}</b>` +
      `${i.ability >= 0 ? ` · ${esc(i.text)}` : ''}</span>`).join('')
    : ` <span class="acts">${mo.intents.map((i) => `<span class="${kindType(i.kind) ? `dmg-${kindType(i.kind)}` : ''}">🎲${i.roll} ${kindType(i.kind) ? dmgIcon(kindType(i.kind)) : ''}<b>${esc(i.name)}</b></span>`).join(' → ')}</span>`;
  if (!mo.intents.length) {
    // No action dice: say what it does all the time instead.
    const card = MONSTER_BY_ID[mo.kind];
    const constant = (card?.abilities ?? []).filter((a) => a.roll === 'Persistent').map((a) => `<b>${esc(a.name)}</b>: ${esc(a.text)}`).join('<br>');
    el.innerHTML = `<b>${esc(name)}</b> takes no actions; it is always at work.<br>${constant}`;
    return;
  }
  // The Adze: who its swarms are after, and whether anyone stands guard.
  const victims = (s.npcs ?? []).map((v) => {
    const { x, y } = grid.coords(v.cell);
    const guarded = s.players.some((p) => !p.dead && (() => { const c = grid.coords(p.pos); return Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) <= 1; })());
    return `${v.alive ? '' : '☠ '}${esc(v.name)} (${cellLabel(x, y)}${v.alive ? (guarded ? ', guarded' : ', <span class="danger">unguarded</span>') : ''})`;
  });
  const victimLine = victims.length ? `<br><span class="muted">Victims:</span> ${victims.join(' · ')}` : '';
  el.innerHTML = `<b>${esc(name)}</b> rolled ${mo.intents.length === 1 ? '1 die' : `${mo.intents.length} dice`}:${acts}${victimLine}<br>` +
    (danger.length ? `<span class="danger">⚠ In danger: ${danger.join(', ')}</span>` : '<span class="muted">No one in reach, for now</span>') +
    ` <span class="muted">· acts at the end of the round · tap for ${intentOpen ? 'less' : 'details'}</span>`;
}
export let intentOpen = false;
export const anyCoin = () => '<span class="obol obol-any" aria-label="any colour"><span>any</span></span>';
export function obolcraftHTML(pl) {
  const s = play.state;
  const obols = pl.inventory.obolcraft;
  const counts = obolCounts(pl);
  const mine = s.players[s.cur] === pl;
  const canAct = mine && ['idle', 'slotting', 'choosing', 'asking'].includes(s.phase); // before rolling or at any stop
  const summary = `<div class="inv-summary">${OBOL_TYPES.map((t) =>
    `<span class="obol-count${counts[t] ? '' : ' zero'}">${obolHTML(t)}${OBOLS[t].label} ${counts[t]}</span>`).join('')}</div>`;
  // Recipes you can craft now come first; the rest say what's missing.
  const whyOf = (r) => craftBlocked(play.session.state ?? s, pl, r); // the game state itself: it holds the decks
  const recipes = [...RECIPES].sort((x, y) => (whyOf(x) ? 1 : 0) - (whyOf(y) ? 1 : 0)).map((r) => {
    const why = whyOf(r);
    // Which named colours are short, to dim them.
    const have = { ...counts };
    const cost = r.cost.map((c) => {
      if (c === ANY) return anyCoin();
      const ok = (have[c] ?? 0) > 0;
      if (ok) have[c]--;
      return obolHTML(c).replace('class="obol ', `class="obol ${ok ? '' : 'short '}`);
    }).join('');
    const open = craftUI.recipe === r.id;
    return `<div class="recipe${why ? '' : ' ready'}"><div class="cost">${cost}</div>` +
      `<button type="button" data-recipe="${r.id}" ${why || !canAct ? 'disabled' : ''}>${open ? 'Cancel' : 'Craft'}</button>` +
      `<p>${esc(r.text)}</p>${why ? `<small>${esc(why)}</small>` : ''}</div>` + (open ? paySheetHTML(pl, r) : '');
  }).join('');
  const note = !mine ? `<p class="inv-empty" style="padding:8px 2px">Only ${esc(pl.name)} can craft with these, on their turn.</p>`
    : !canAct ? '<p class="inv-empty" style="padding:8px 2px">Craft on your turn, before or between moves.</p>' : '';
  const list = obols.length ? '' : `<p class="inv-empty" style="padding:8px 2px">${INVENTORY_TABS.obolcraft.empty}</p>`;
  return summary + list + `<div class="craft-head">Recipes · ⚫ = any colour</div>${note}<div class="craft-list">${recipes}</div>`;
}
export function paySheetHTML(pl, r) {
  const obols = pl.inventory.obolcraft;
  const fits = payFits(r, obols, craftUI.pay);
  const dead = play.state.players.filter((p) => p.dead);
  return `<div class="pay-sheet"><span class="lbl">Pay with (tap to swap which Obols fill the any-colour slots):</span>` +
    `<div class="row">${obols.map((o, i) => `<button type="button" class="obol obol-${o.type}${craftUI.pay.includes(i) ? ' picked' : ''}" data-pay="${i}" aria-label="${OBOLS[o.type].label} Obol">` +
      `<svg viewBox="0 0 24 24">${OBOL_GLYPHS[o.type]}</svg></button>`).join('')}</div>` +
    (r.resurrect ? `<span class="lbl">Bring back:</span><div class="row pay-target">${dead.map((p) =>
      `<button type="button" data-target="${p.seat}" class="${craftUI.target === p.seat ? 'on' : ''}"><span class="chip" style="background:${p.colour};display:inline-block;width:10px;height:10px;border-radius:50%"></span> ${esc(p.name)}</button>`).join('')}</div>` : '') +
    `<div class="pay-actions"><button type="button" class="on" data-confirm ${fits && (!r.resurrect || craftUI.target !== null) ? '' : 'disabled'}>` +
    `${fits ? `Spend ${r.cost.length} Obols` : `Pick ${r.cost.length} that fit`}</button></div></div>`;
}
export function wireObolcraft(body, pl) {
  body.querySelectorAll('[data-recipe]').forEach((b) => b.addEventListener('click', () => {
    const r = RECIPE_BY_ID[b.dataset.recipe];
    if (craftUI.recipe === r.id) { craftUI.recipe = null; renderInventory(); return; }
    craftUI.recipe = r.id;
    craftUI.pay = autoPay(r, pl.inventory.obolcraft) ?? [];
    const dead = play.state.players.filter((p) => p.dead);
    craftUI.target = dead.length === 1 ? dead[0].seat : null;
    renderInventory();
  }));
  body.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
    const i = Number(b.dataset.pay);
    const r = RECIPE_BY_ID[craftUI.recipe];
    const at = craftUI.pay.indexOf(i);
    if (at >= 0) craftUI.pay.splice(at, 1);
    else {
      if (craftUI.pay.length >= r.cost.length) craftUI.pay.pop(); // swap out the last pick
      craftUI.pay.push(i);
    }
    renderInventory();
  }));
  body.querySelectorAll('[data-target]').forEach((b) => b.addEventListener('click', () => { craftUI.target = Number(b.dataset.target); renderInventory(); }));
  body.querySelector('[data-confirm]')?.addEventListener('click', () => {
    play.craft(craftUI.recipe, [...craftUI.pay], craftUI.target ?? undefined);
  });
}
// The Skills sheet: a player's Equipment skills and their Obolcraft, in tabs.
const SKILL_TABS = { skills: 'Skills', obolcraft: 'Obolcraft' };
export function renderInventory() {
  const s = play.state;
  const pl = s.players[inv.player] ?? s.players[0];
  if (!pl) return;
  const ms = pl.mindset ? eventCard(pl.mindset) : null;
  $('#invTitle').textContent = `${s.players.length > 1 ? `${pl.name}’s skills` : 'Skills'}${ms ? ` · ${ms.name}` : ''}`;
  $('#invTitle').title = ms ? `Mindset: ${ms.text}` : '';
  const host = $('#invPlayers');
  host.hidden = s.players.length < 2;
  host.innerHTML = s.players.map((p, k) =>
    `<button type="button" role="tab" data-k="${k}" class="${k === inv.player ? 'on' : ''}" aria-selected="${k === inv.player}">` +
    `<span class="chip" style="background:${p.colour}"></span>${p.name}</button>`).join('');
  host.querySelectorAll('button').forEach((b) => { b.onclick = () => { inv.player = Number(b.dataset.k); useUI.item = null; renderInventory(); }; });
  if (!SKILL_TABS[inv.tab]) inv.tab = 'skills';
  const ready = skillStatus(play.session.state, play.board, play.session.state.players[pl.seat]).filter((e) => e.status === 'now').length;
  const tabs = $('#invTabs');
  tabs.innerHTML = Object.entries(SKILL_TABS).map(([id, label]) =>
    `<button type="button" role="tab" data-tab="${id}" class="${id === inv.tab ? 'on' : ''}" aria-selected="${id === inv.tab}">` +
    `${label}<span class="n${id === 'skills' && ready ? ' go' : ''}">${id === 'skills' ? (ready ? `${ready} ready` : pl.inventory.equipment.length) : pl.inventory.obolcraft.length}</span></button>`).join('');
  tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => { inv.tab = b.dataset.tab; useUI.item = null; renderInventory(); }; });
  renderInventoryTab(s, pl, $('#invBody'));
}
function renderInventoryTab(s, pl, body) {
  const items = pl.inventory.equipment;
  if (inv.tab === 'obolcraft') {
    body.innerHTML = obolcraftHTML(pl);
    wireObolcraft(body, pl);
    return;
  }
  const mine = inv.player === s.cur && ['idle', 'slotting', 'choosing', 'asking'].includes(s.phase); // before rolling or at any stop
  if (useUI.item === 'cosor' && mine) { renderStrikeSheet(body, pl); return; }
  if (useUI.item !== null && mine && items[useUI.item]) { renderUseSheet(body, pl, items); return; }
  useUI.item = null;
  const cosor = (pl.carry ?? []).some((c) => c.item === 'cosor' && c.blessed);
  if (!items.length && !cosor) { body.innerHTML = `<p class="inv-empty">${INVENTORY_TABS.equipment.empty}</p>`; return; }
  const viewSeg = `<div class="seg skill-view" role="group" aria-label="Order">` +
    `<button type="button" data-view="ready" class="${inv.view === 'ready' ? 'on' : ''}">Ready first</button>` +
    `<button type="button" data-view="items" class="${inv.view === 'items' ? 'on' : ''}">By item</button></div>`;
  if (inv.view === 'ready') body.innerHTML = viewSeg + readySkillsHTML(pl);
  else {
    const status = statusByKey(pl);
    body.innerHTML = viewSeg + `<div class="eq-list">${items.map((e, i) => {
      const card = EQUIPMENT_BY_ID[e.id];
      return `<div class="eq-card"><b>${esc(e.label ?? card?.name ?? 'Item')}</b>${card ? abilitiesHTML(card, mine ? { item: e, i, status } : null) : ''}` +
        `${e.from ? `<small class="eq-from">From ${esc(e.from)}</small>` : ''}</div>`;
    }).join('')}${cosor ? `<div class="eq-card"><b>Blessed Cosor</b>${abilitiesHTML(COSOR_CARD, mine ? { item: { spent: [] }, i: 'cosor', status } : null)}<small class="eq-from">The Strigoi’s bane: sharpened and blessed</small></div>` : ''}</div>` + (mine ? discardHTML(pl) : '') + (mine ? '' : `<p class="inv-empty" style="padding:8px 4px">${inv.player === s.cur ? 'Equipment can be used during your turn: roll first if a skill needs dice.' : 'Only usable on this investigator’s own turn.'}</p>`);
  }
  body.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => {
    inv.view = b.dataset.view;
    try { localStorage.setItem('minty-pickle.skillsView', inv.view); } catch { /* ignore */ }
    renderInventory();
  }; });
  body.querySelectorAll('[data-discard]').forEach((b) => { b.onclick = () => {
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Tap again to discard'; return; }
    const o = JSON.parse(b.dataset.discard);
    const r = play.session.dispatch({ type: 'discard', ...o, seat: s.cur });
    if (r.ok) closeInventory(); else { b.textContent = r.error; }
  }; });
  // Use: open the use sheet with the dice and target that work already picked.
  body.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => {
    const [i0, k0] = b.dataset.use.split(':');
    const st = statusByKey(pl).get(b.dataset.use);
    if (i0 === 'force') {
      // Forcing a blocked door: nothing to pick, the 6 is already chosen.
      const r = st?.action ? play.session.dispatch(st.action) : { ok: false, error: 'not right now' };
      if (r.ok) closeInventory(); else { b.textContent = r.error; }
      return;
    }
    if (i0 === 'cosor') {
      Object.assign(useUI, { item: 'cosor', ability: 0, dice: st?.action ? [st.action.die] : [], target: null, raise: [], error: '' });
      renderInventory();
      return;
    }
    const i = Number(i0), k = Number(k0);
    Object.assign(useUI, { item: i, ability: k, dice: [...(st?.action?.dice ?? [])], target: st?.action?.target ?? null, raise: [], error: '' });
    renderInventory();
  }; });
}
// Each skill's status (src/game/skills.js), by "item:ability".
function statusByKey(pl) {
  const st = play.session.state;
  return new Map(skillStatus(st, play.board, st.players[pl.seat]).map((e) => [`${e.item}:${e.ability}`, e]));
}
// Ready first: Use now, Almost, Not now, Automatic.
const GROUPS = [
  ['now', 'Use now'],
  ['almost', 'Almost'],
  ['not', 'Not now'],
  ['auto', 'Automatic'],
];
function readySkillsHTML(pl) {
  const st = play.session.state;
  const list = skillStatus(st, play.board, st.players[pl.seat]);
  return GROUPS.map(([g, label]) => {
    const rows = list.filter((e) => e.status === g);
    if (!rows.length) return '';
    return `<div class="sk-group sk-${g}"><b class="sk-head">${label}<span>${rows.length}</span></b><ul class="eq-abilities sk-list">${rows.map((e) => {
      const a = e.card.abilities[e.ability];
      const dice = e.action?.dice?.length ? ` · ${e.action.dice.map((n) => st.pool[n].v).join(' + ')}` : '';
      return abilityRow(a, `<small class="sk-from">${esc(e.card.name)}${g === 'now' ? dice : ''}</small>`,
        g === 'now' ? `<button type="button" class="eq-use go" data-use="${e.item}:${e.ability}">Use</button>` : '',
        e.why);
    }).join('')}</ul></div>`;
  }).join('') || `<p class="inv-empty">${INVENTORY_TABS.equipment.empty}</p>`;
}
export function openInventory(k = play.state.cur, tab = null) {
  if (k !== inv.player) useUI.item = null;
  inv.player = k;
  if (tab) inv.tab = tab;
  renderInventory();
  showSheet('inventory');
}
// The dock's Skills badge: how many skills the current player can use right now.
export function renderSkillBadge() {
  const st = play.session.state;
  const pl = st?.players?.[st.cur];
  const n = pl && play.state.phase !== 'nostart' ? skillStatus(st, play.board, pl).filter((e) => e.status === 'now').length : 0;
  const b = $('#skillBadge');
  b.hidden = !n;
  b.textContent = n ? String(n) : '';
  $('#hudInv').setAttribute('aria-label', n ? `Skills: ${n} ready to use` : 'Skills');
}
export function closeInventory() { useUI.item = null; hideSheet('inventory'); }

// --- Team: everyone at a glance (playView renders the scoreboard and log into
// the sheet), and one player's injuries in full.
export function openTeam() {
  teamUI.player = play.state.cur;
  renderTeam();
  showSheet('teamSheet');
}
export function renderTeam() {
  const s = play.state;
  const k = teamUI.player ?? s.cur;
  const pl = s.players[k];
  document.querySelectorAll('#playBoard [data-inv]').forEach((r) => r.classList.toggle('picked', Number(r.dataset.inv) === k));
  if (!pl) { $('#teamDetail').innerHTML = ''; return; }
  const inj = pl.injuries ?? { P: 0, M: 0, S: 0 };
  $('#teamDetail').innerHTML = `<div class="team-who"><span class="chip" style="background:${pl.colour}"></span><b>${esc(pl.name)}</b>` +
    `<button type="button" class="team-skills">Skills ›</button></div>` +
    `<div class="inj-list">${['P', 'M', 'S'].map((t) => `<div class="inj-track" style="--trk-soft:${ATTACK_TYPES[t].soft}"><b class="trk-head">${dmgIcon(t)} ${INJURY_TRACKS[t].label}</b>` +
      INJURY_TRACKS[t].tiers.map((tier, n) => `<div class="inj-tier${inj[t] > n ? ' has' : ''}"><span class="sw" style="background:${ATTACK_TYPES[t].colour};opacity:${[0.5, 0.75, 1][n]}"></span>` +
        `<span><b style="display:inline">${esc(tier.name)}</b> · ${esc(tier.text)}</span></div>`).join('') + '</div>').join('')}</div>` +
    `<p class="inv-empty" style="padding:8px 4px">${pl.dead ? `${esc(pl.name)} is dead.` : 'Tiers add up; each track is separate. Tier 3 on any track is Death’s Door.'}</p>`;
  $('#teamDetail').querySelector('.team-skills').onclick = () => openInventory(k, 'skills');
  // What they carry; on their own turn, anything can be set down here (Drop).
  const carry = pl.carry ?? [];
  if (carry.length) {
    const mine = k === s.cur && ['idle', 'slotting', 'choosing', 'asking'].includes(s.phase);
    const box = document.createElement('div');
    box.className = 'team-carry';
    box.innerHTML = `<b class="sheet-sub">Carrying</b>` + carry.map((c) => `<div class="team-carry-row"><span>${esc(describeItem(c))}</span>` +
      (mine ? `<button type="button" data-drop="${esc(c.item)}">Set down</button>` : '') + '</div>').join('');
    $('#teamDetail').querySelector('.team-who').after(box);
    box.querySelectorAll('[data-drop]').forEach((b) => { b.onclick = () => {
      const r = play.session.dispatch({ type: 'drop', item: b.dataset.drop, seat: s.cur });
      if (!r.ok) toast(r.error ?? 'That can’t be set down now.');
    }; });
  }
}

// An Equipment card's abilities, as printed: range, damage kind, name, cost
// [requirement], effect, and its 1️⃣ / 🔗 limit.
const RANGE_LABEL = { close: 'Close', mid: 'Mid', long: 'Long', self: 'Self', all: 'All' };
// With `use` ({ item, i }): a Use button per ability that is ready.
// One printed skill as a row; `extra` (where it's from), a Use button, a reason.
function abilityRow(a, extra = '', button = '', why = '') {
  const kind = a.kind ? DAMAGE_KINDS[a.kind] : null;
  const cost = a.obols ? `${a.obols} ◉` : '🎲'.repeat(a.dice);
  const limit = a.limit === 'once' ? ' <span title="Once, until refreshed">1️⃣</span>' : a.limit === 'breaks' ? ' <span title="Breaks: the card is discarded after this skill">🔗</span>' : '';
  const manual = a.fx?.manual ? ' <span class="eq-manual" title="Played at the table for now">✋</span>' : '';
  return `<li><span class="eq-range">${RANGE_LABEL[a.range] ?? '—'}</span>` +
    `<span class="eq-kind" title="${kind ? esc(kind.label) : 'Untyped'}">${kind ? kind.icon : '◯'}</span>` +
    `<span><b>${esc(a.name)}</b>${cost || a.req ? ` · ${cost}${a.req ? ` [${esc(a.req)}]` : ''}` : ''} ${esc(a.text)}${limit}${manual}${extra}` +
    `${why ? `<small class="sk-why">${esc(why)}</small>` : ''}</span>${button}</li>`;
}
// With `use` ({ item, i, status }): a Use button per skill, lit when it can be
// used now; otherwise the reason it can't, under the skill.
export function abilitiesHTML(card, use = null) {
  return `<ul class="eq-abilities">${card.abilities.map((a, k) => {
    // Lunge is always on; Sacrifice comes up by itself when someone would die.
    const auto = a.fx?.passive ? 'Always on' : a.fx?.sacrifice ? 'When needed' : '';
    const st = use?.status?.get(`${use.i}:${k}`);
    const button = !use ? '' : auto ? `<span class="eq-auto">${auto}</span>`
      : `<button type="button" class="eq-use${st?.status === 'now' ? ' go' : ''}" data-use="${use.i}:${k}" ${abilityReady(use.item, k) ? '' : 'disabled title="Used up until refreshed"'}>Use</button>`;
    return abilityRow(a, '', button, use && !auto && st && st.status !== 'now' ? st.why : '');
  }).join('')}</ul>`;
}

// --- Scouting: the cards left at the edge of town, one each, in seat order. -------------
// The cards are dealt face down and turn over one after another; tap one, then
// Take it. Taken cards stay in the row with the taker's colour.
const scoutUI = { key: null, cards: [], pick: null };
export function renderScouting() {
  const st = play.session.state;
  const sc = st?.scouting;
  const host = $('#scoutScreen');
  if (!sc || st.phase !== 'scouting') {
    if (!host.hidden) { host.classList.add('closing'); setTimeout(() => { host.hidden = true; host.classList.remove('closing'); }, 380); }
    scoutUI.key = null;
    return;
  }
  // The whole spread (taken ones first, in the order they went), built once.
  const taken = Object.entries(sc.took).map(([seat, id]) => ({ id, seat: Number(seat) }));
  const all = [...taken, ...sc.offer.map((id) => ({ id, seat: null }))];
  const key = all.map((c) => c.id).sort().join(',');
  const fresh = scoutUI.key !== key;
  if (fresh) {
    scoutUI.key = key;
    scoutUI.pick = null;
    // The story depends on how deadly tonight's monster is (its stars).
    $('#scoutStory').textContent = sc.story ?? SCOUTING_STORY[sc.stars ?? 1];
    $('#scoutCards').innerHTML = all.map((c, k) => {
      const card = EQUIPMENT_BY_ID[c.id];
      return `<button type="button" class="scout-card" data-k="${k}" style="--d:${0.25 + k * 0.18}s">` +
        `<span class="sc-face sc-back"><span class="sc-mark">✦</span><span class="sc-word">Equipment</span></span>` +
        `<span class="sc-face sc-front"><b class="sc-name">${esc(card?.name ?? c.id)}</b>${card ? abilitiesHTML(card) : ''}<span class="sc-taken"></span></span></button>`;
    }).join('');
    scoutUI.cards = all.map((c) => c.id);
    $('#scoutCards').querySelectorAll('.scout-card').forEach((b) => { b.onclick = () => {
      if (b.classList.contains('taken')) return;
      scoutUI.pick = Number(b.dataset.k);
      renderScouting();
    }; });
    host.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => host.querySelectorAll('.scout-card').forEach((b) => b.classList.add('up'))));
  }
  // Who has what.
  const takenBy = new Map();
  for (const [seat, id] of Object.entries(sc.took)) {
    const k = scoutUI.cards.findIndex((x, n) => x === id && !takenBy.has(n));
    if (k >= 0) takenBy.set(k, st.players[Number(seat)]);
  }
  host.querySelectorAll('.scout-card').forEach((b) => {
    const k = Number(b.dataset.k);
    const who = takenBy.get(k);
    b.classList.toggle('taken', !!who);
    b.classList.toggle('picked', scoutUI.pick === k && !who);
    b.disabled = !!who;
    b.querySelector('.sc-taken').innerHTML = who ? `<span class="who-chip" style="background:${who.colour}">${esc(who.name)}</span> took this` : '';
  });
  if (takenBy.has(scoutUI.pick)) scoutUI.pick = null;
  const pl = st.players[st.cur];
  $('#scoutWho').innerHTML = `<span class="who-chip" style="background:${pl.colour}">${esc(pl.name)}</span> ` +
    (st.players.length === 1 ? 'choose one to take with you' : `choose one · ${sc.order.length - sc.at} still to choose`);
  const btn = $('#scoutTake');
  const id = scoutUI.pick === null ? null : scoutUI.cards[scoutUI.pick];
  btn.disabled = !id;
  btn.textContent = id ? `Take the ${EQUIPMENT_BY_ID[id]?.name ?? id}` : 'Choose a card';
  btn.onclick = () => {
    if (!id) return;
    const r = play.scout(sc.offer.indexOf(id));
    if (!r?.ok) toast(r?.error ?? 'That can’t be taken now.');
    scoutUI.pick = null;
  };
}

// --- The Blessed Cosor's Strike: one of your dice, its value as damage. -----------
export function openStrike() {
  const st = play.session.state;
  const e = skillStatus(st, play.board, st.players[st.cur]).find((x) => x.item === 'cosor');
  Object.assign(useUI, { item: 'cosor', ability: 0, dice: e?.action ? [e.action.die] : [], target: null, raise: [], error: '' });
  openInventory(st.cur, 'skills');
}
function renderStrikeSheet(body, pl) {
  const s = play.state;
  const st = play.session.state;
  const free = s.pool.map((d, n) => ({ ...d, n })).filter((d) => !d.spent && !s.defSlots.includes(d.n) && !s.slots.includes(d.n));
  const status = skillStatus(st, play.board, st.players[pl.seat]).find((x) => x.item === 'cosor');
  const m = st.monsters.find((x) => x.kind === 'strigoi');
  const pick = useUI.dice[0];
  const ok = status?.status === 'now' && free.some((d) => d.n === pick);
  body.innerHTML = `<div class="use-sheet">
    <button type="button" class="screen-back use-back">‹ Skills</button>
    <b class="use-title">Blessed Cosor · Strike</b>
    ${abilitiesHTML(COSOR_CARD)}
    ${m ? `<p class="use-label">The Strigoi: <b>${m.hp}</b> of ${m.maxHp} health left.</p>` : ''}
    <p class="use-label">Strike with one die: its value is the damage.</p>
    <div class="use-dice">${free.map((d) => `<button type="button" class="use-die${d.n === pick ? ' on' : ''}" data-die="${d.n}">${d.v}<small>${d.kind === 'white' ? 'white' : ''}</small></button>`).join('') || '<span class="inv-empty">No free dice: roll first, or unslot one.</span>'}</div>
    <p class="use-status ${ok ? 'ok' : ''}">${useUI.error ? esc(useUI.error) : status && status.status !== 'now' ? esc(status.why) : ok ? `✓ ${s.pool[pick].v} damage` : 'Pick a die'}</p>
    <button type="button" class="use-go" ${ok ? '' : 'disabled'}>Strike${ok ? ` for ${s.pool[pick].v}` : ''}</button>
  </div>`;
  body.querySelector('.use-back').onclick = () => { useUI.item = null; renderInventory(); };
  body.querySelectorAll('[data-die]').forEach((b) => { b.onclick = () => { useUI.dice = [Number(b.dataset.die)]; useUI.error = ''; renderInventory(); }; });
  body.querySelector('.use-go').onclick = () => {
    const r = play.strike(pick);
    if (!r?.ok) { useUI.error = r?.error ? r.error[0].toUpperCase() + r.error.slice(1) + '.' : 'That can’t be done now.'; renderInventory(); return; }
    useUI.item = null;
    closeInventory();
  };
}

// --- Using equipment: choose dice (and a target), then Use. -----------------------------
export const useUI = { item: null, ability: 0, dice: [], target: null, raise: [], error: '' };
function renderUseSheet(body, pl, items) {
  const s = play.state;
  const item = items[useUI.item];
  const card = EQUIPMENT_BY_ID[item.id];
  const a = card.abilities[useUI.ability];
  const fx = a.fx ?? {};
  const free = s.pool.map((d, n) => ({ ...d, n })).filter((d) => !d.spent && !s.defSlots.includes(d.n) && !s.slots.includes(d.n));
  const targets = targetsFor(play.session.state, play.board, pl, a);
  const values = useUI.dice.map((n) => s.pool[n]?.v ?? 0);
  const mon = fx.target === 'monster' ? play.session.state.monsters.find((m) => m.id === (useUI.target?.monster ?? targets[0]?.monster)) : null;
  const reqOk = useUI.dice.length === a.dice && checkRequirement(a.req, values, { targetDie: mon ? actionRoll(mon) : null });
  const targeted = fx.target === 'monster' || fx.target === 'ally' || fx.target === 'either' || !!fx.door;
  // A target's id and what the rules expect for it.
  const tid = (t) => t.monster ?? t.swarm ?? t.seat ?? t.edge;
  const tpay = (t) => (t.monster ? { monster: t.monster } : t.swarm ? { swarm: t.swarm } : t.edge ? { edge: t.edge } : { seat: t.seat });
  const dieChip = (d, on, attr) => `<button type="button" class="use-die${on ? ' on' : ''}" ${attr}="${d.n}">${d.v}<small>${d.kind === 'white' ? 'white' : ''}</small></button>`;
  body.innerHTML = `<div class="use-sheet">
    <button type="button" class="screen-back use-back">‹ Skills</button>
    <b class="use-title">${esc(card.name)} · ${esc(a.name)}</b>
    ${abilitiesHTML({ abilities: [a] })}
    ${a.dice ? `<p class="use-label">Slot ${a.dice === 1 ? 'one die' : `${a.dice} dice`}${a.req ? ` · total [${esc(a.req)}]${mon && /2x/.test(a.req) ? ` = at least ${2 * actionRoll(mon)}` : ''}` : ''}</p>
      <div class="use-dice">${free.map((d) => dieChip(d, useUI.dice.includes(d.n), 'data-die')).join('') || '<span class="inv-empty">No free dice: roll first, or unslot one.</span>'}</div>` : ''}
    ${a.obols ? `<p class="use-label">Costs ${a.obols} Obol${a.obols === 1 ? '' : 's'} (any colour): you have ${pl.inventory.obolcraft.length}.</p>` : ''}
    ${fx.raise ? `<p class="use-label">Raise ${fx.raise === 1 ? 'one other die' : `${fx.raise} other dice`} to ${fx.to}</p>
      <div class="use-dice">${free.filter((d) => !useUI.dice.includes(d.n)).map((d) => dieChip(d, useUI.raise.includes(d.n), 'data-raise')).join('')}</div>` : ''}
    ${targeted ? `<p class="use-label">${fx.door ? 'Door' : 'Target'}</p>
      <div class="use-targets">${targets.map((t) => `<button type="button" class="${(useUI.target ? tid(t) === (useUI.target.monster ?? useUI.target.swarm ?? useUI.target.seat ?? useUI.target.edge) : t === targets[0]) ? 'on' : ''}" data-target='${JSON.stringify(tpay(t))}'>${esc(t.name)}</button>`).join('') || `<span class="inv-empty">${fx.door ? (fx.door === 'breach' ? 'No door next to you to breach.' : 'No door next to you to shut.') : fx.target === 'monster' ? `No monster in ${RANGE_LABEL[a.range]} range.` : 'No one in range.'}</span>`}</div>` : ''}
    ${fx.manual ? '<p class="use-label">✋ Paid for and logged here; resolve its effect at the table.</p>' : ''}
    <p class="use-status ${reqOk ? 'ok' : ''}">${useUI.error ? esc(useUI.error) : a.dice ? (reqOk ? '✓ Ready' : useUI.dice.length === a.dice ? '✕ These dice don’t meet the requirement' : '') : ''}</p>
    <button type="button" class="use-go" ${(a.dice && !reqOk) || (targeted && !targets.length) ? 'disabled' : ''}>Use ${esc(a.name)}</button>
  </div>`;
  body.querySelector('.use-back').onclick = () => { useUI.item = null; renderInventory(); };
  body.querySelectorAll('[data-die]').forEach((b) => { b.onclick = () => {
    const n = Number(b.dataset.die);
    useUI.dice = useUI.dice.includes(n) ? useUI.dice.filter((x) => x !== n) : [...useUI.dice, n].slice(-a.dice);
    useUI.raise = useUI.raise.filter((x) => !useUI.dice.includes(x));
    useUI.error = ''; renderInventory();
  }; });
  body.querySelectorAll('[data-raise]').forEach((b) => { b.onclick = () => {
    const n = Number(b.dataset.raise);
    useUI.raise = useUI.raise.includes(n) ? useUI.raise.filter((x) => x !== n) : [...useUI.raise, n].slice(-fx.raise);
    renderInventory();
  }; });
  body.querySelectorAll('[data-target]').forEach((b) => { b.onclick = () => { useUI.target = JSON.parse(b.dataset.target); renderInventory(); }; });
  body.querySelector('.use-go').onclick = () => {
    if (fx.lure) {
      // Distract: choose the space on the board.
      const pay = { item: useUI.item, ability: useUI.ability, dice: [...useUI.dice] };
      closeInventory();
      startCellPick({
        cells: targets.map((t) => t.cell),
        label: 'Tap a lit space for the boombox',
        onPick: (cell) => {
          endCellPick();
          const r = play.useEquipment({ ...pay, target: { cell } });
          if (!r.ok) toast(r.error ? r.error[0].toUpperCase() + r.error.slice(1) + '.' : 'That can’t be used now.');
          useUI.item = null;
        },
      });
      return;
    }
    const r = play.useEquipment({ item: useUI.item, ability: useUI.ability, dice: useUI.dice, target: useUI.target ?? (targets[0] ? tpay(targets[0]) : null), raise: useUI.raise });
    if (!r.ok) { useUI.error = r.error ? r.error[0].toUpperCase() + r.error.slice(1) + '.' : 'That can’t be used now.'; renderInventory(); return; }
    useUI.item = null;
    closeInventory();
  };
}

// The monster's objective (from midnight): what wins the game.
function objectiveHTML(my) {
  const st = play.session.state;
  // Known: revealed at midnight, identified by all the evidence, or named right early.
  const card = MONSTER_BY_ID[st ? knownMonster(st) : null];
  if (!card) return '';
  void my;
  const kill = killObjective(card);
  const done = st?.objectiveDone;
  // The steps (src/game/objectives/scripts.js), with where each site is on this map.
  const sc = scriptOf(card.id);
  const sites = mapSites(grid);
  const where = (at) => (at === 'lair' || at === 'start' || at === 'any' ? '' : (sites[at] ?? []).map(placeLabel).join(', '));
  const steps = sc ? `<ol class="obj-steps">${sc.steps.map((stp) => `<li>${esc(stp.text)}${where(stp.at) ? ` <span class="obj-where">${where(stp.at)}</span>` : ''}</li>`).join('')}</ol>` : '';
  return `<p class="case-note"><b>Objective:</b> ${esc(card.objective.replace(/\.$/, ''))}. ` +
    (kill ? 'Destroy it to win.'
      : done ? `Achieved.${st.monsters.length ? ' Now destroy it one more time.' : ''}`
        : sc?.played ? 'The game tracks it: reach the sites below.' : 'Achieve it to win (play it at the table, then mark it here). Until then, destroying it only sends it back to its Lair.') + '</p>' +
    steps +
    // What the game is tracking (objectives/verbs.js).
    (sc?.played ? `<ul class="obj-progress">${progressLines(st).map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '') +
    // Played by the game: no hand marking.
    (!kill && !done && !st?.won && !sc?.played ? '<div class="case-actions"><button type="button" class="ink" id="objDone">Objective achieved</button></div>' : '');
}

// "Discard [element]" weakness effects the current monster offers.
function discardHTML(pl) {
  const opts = discardOptions(play.session.state, pl);
  if (!opts.length) return '';
  return `<div class="eq-discards"><p class="use-label">The monster’s weakness lets you discard:</p>${opts.map((o) =>
    `<button type="button" class="eq-discard" data-discard='${JSON.stringify({ item: o.item, track: o.track, monster: o.monster })}'>` +
    `${esc(EQUIPMENT_BY_ID[pl.inventory.equipment[o.item].id].name)} → ${esc(o.text)}</button>`).join('')}</div>`;
}

// --- Events that need a choice (the drawing character chooses alone) ---------------------
export function renderEventChoice() {
  const st = play.session.state;
  const pe = st?.pendingEvent;
  // Wait for the drawn card to be read (its card pops up first).
  const show = ui.tool === 'play' && play.state.phase === 'eventing' && !!pe && $('#cardPop').hidden;
  $('#eventChoice').hidden = !show;
  if (!show) return;
  const card = eventCard(pe.id);
  const pl = st.players[pe.seat];
  $('#evKind').textContent = `${EVENT_CATEGORIES[card.category]?.label ?? 'Event'} · ${pl.name} chooses`;
  $('#evTitle').textContent = card.name;
  $('#evText').textContent = play.midnight() && card.afterMidnight ? `After midnight: ${card.afterMidnight}` : card.text;
  const opts = choicesFor(pe.id, st, pl) ?? [];
  const host = $('#evActions');
  host.innerHTML = opts.map((o) => `<button type="button" data-ev="${o.value}" ${o.ok ? '' : 'disabled title="You can’t pay for this"'}>${esc(o.label)}</button>`).join('');
  host.querySelectorAll('[data-ev]').forEach((b) => { b.onclick = () => play.session.dispatch({ type: 'event', choice: b.dataset.ev, seat: st.cur }); });
}

// Someone has fallen and the Sacrificial Fetish could save them: its carrier
// decides (the game waits).
export function renderSacrifice() {
  const st = play.session.state;
  // A weakness discard comes first (reactions.js).
  const r = st?.reactions?.[0];
  if (r && ui.tool === 'play') {
    const show = $('#cardPop').hidden;
    $('#sacrificeAsk').hidden = !show;
    if (!show) return;
    const pl = st.players[r.seat];
    const mon = MONSTER_BY_ID[st.monsters.find((m) => m.id === r.monster)?.kind];
    const items = pl.inventory.equipment.filter((it) => EQUIPMENT_BY_ID[it.id]?.abilities.some((a) => a.kind === r.kind));
    $('#sacKind').textContent = `${mon?.name ?? 'The monster'}'s weakness`;
    $('#sacTitle').textContent = r.text;
    $('#sacText').innerHTML = `<b style="color:${pl.colour}">${esc(pl.name)}</b>: discard your ${esc(EQUIPMENT_BY_ID[items[0]?.id]?.name ?? DAMAGE_KINDS[r.kind].label)} to undo ${r.what === 'exhaust' ? 'the Exhaust' : 'that hit'}?`;
    $('#sacNo').textContent = 'Keep it';
    $('#sacYes').textContent = 'Discard it';
    $('#sacNo').onclick = () => play.react(false);
    $('#sacYes').onclick = () => play.react(true);
    return;
  }
  $('#sacKind').textContent = 'Sacrificial Fetish';
  $('#sacNo').textContent = 'Let them die';
  $('#sacYes').textContent = 'Spend it';
  const first = st?.sacrifice?.[0];
  const pl = first && st.players[first.seat];
  const carrier = pl && st.players[sacrificeSeat(st)];
  const show = ui.tool === 'play' && !!pl?.dying && !!carrier && $('#cardPop').hidden;
  $('#sacrificeAsk').hidden = !show;
  if (!show) return;
  $('#sacTitle').textContent = `${pl.name} has fallen`;
  $('#sacText').innerHTML = `<b style="color:${carrier.colour}">${esc(carrier.name)}</b>: spend the Sacrificial Fetish and 1 Obol to bring ${carrier === pl ? 'yourself' : esc(pl.name)} back, every injury healed? The Fetish crumbles.`;
  $('#sacNo').onclick = () => play.sacrifice(false);
  $('#sacYes').onclick = () => play.sacrifice(true);
}

// Events on the map and the survivors tally.
function mapEffectsHTML() {
  const st = play.session.state;
  if (!st) return '';
  const bits = [];
  const sv = st.survivors ?? { live: 0, die: 0 };
  if (sv.live || sv.die) bits.push(`Survivors: <b>${sv.live}</b> lived, <b>${sv.die}</b> died.`);
  if (st.global) bits.push(`Global: <b>${esc(eventCard(st.global.id)?.name ?? '')}</b>.`);
  const hz = (st.hazards ?? []).filter((h) => !h.used);
  if (hz.length) bits.push(`On the map: ${hz.map((h) => `${esc(eventCard(h.id)?.name ?? h.id)} at ${placeLabel(h.cell)}${h.by === 'player' ? ' (trap)' : ''}`).join(', ')}.`);
  const blocked = Object.values(st.doors ?? {}).filter((v) => v === 'blocked').length;
  if (blocked) bits.push(`${blocked} door${blocked === 1 ? '' : 's'} blocked.`);
  if (st.lockdown) bits.push('<b>Lockdown</b>: every door is locked. Touch a Key space to open them all for good.');
  if (st.allDoorsOpen) bits.push('Every door is unlocked for good.');
  return bits.length ? `<p class="case-note">${bits.join(' ')}</p>` : '';
}
