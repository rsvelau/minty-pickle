// The play demo's panels: evidence and cards, Casebook and Field Guide,
// injuries and the monster's intent, Obolcraft and the inventory.

import { cellLabel } from '../core/state.js';
import { OBOLS, monsterDef, obolCounts, OBOL_TYPES, INVENTORY_TABS } from './play.js';
import { evidenceLabel, ATTACK_TYPES, LAIRS, OBSERVATIONS } from '../game/cards/evidence.js';
import { INJURY_TRACKS } from '../game/cards/injuries.js';
import { RECIPE_BY_ID, RECIPES, blocked as craftBlocked, ANY, payFits, autoPay } from '../game/obolcraft.js';
import { MONSTER_BY_ID, DAMAGE_KINDS } from '../game/cards/monsters.js';
import { matchesEvidence } from '../game/mystery.js';
import { grid, ui } from '../app/config.js';
import { $ } from '../app/dom.js';
import { dieHTML, play } from './playView.js';
import { __set_camTween, camera, cellToWorld, controls } from '../render/scene.js';

// Module state: assigned by init() below, in the same order as before the split.
export let OBOL_GLYPHS, DMG_SVG, ATTACK_GLYPH, cardQueue, caseUI, craftUI;
export let inv;

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
  $('#hudCase').addEventListener('click', () => openCasebook());
  $('#caseClose').addEventListener('click', closeCasebook);
  $('#casebook').addEventListener('click', (e) => { if (e.target === $('#casebook')) closeCasebook(); });
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
  inv = { player: 0, tab: 'obolcraft' };
  $('#hudInv').addEventListener('click', () => openInventory());
  $('#invClose').addEventListener('click', closeInventory);
  $('#inventory').addEventListener('click', (e) => { if (e.target === $('#inventory')) closeInventory(); });
  $('#playBoard').addEventListener('click', (e) => {
    const row = e.target instanceof Element && e.target.closest('[data-inv]');
    if (row) openInventory(Number(row.dataset.inv));
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
  $('#askSub').innerHTML = `<b style="color:${cur.colour}">${cur.name}</b> at ${cellLabel(x, y)} · ` +
    `${s.bag.length ? `draw an Obol (${s.bag.length} in the bag)` : 'the Obol bag is empty'}`;
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
  $('#askDefTotal').textContent = s.defSlots.reduce((a, n) => a + (s.pool[n]?.v ?? 0), 0);
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
      `<div class="pc-title">${e.outcome === 'blocked' ? 'Blocked!' : e.outcome === 'killed' ? `${esc(e.player?.name ?? '')} is dead` : esc(INJURY_TRACKS[e.attack].tiers[e.tier - 1].name)}</div>` +
      `<div class="pc-sub">${esc(hitText(e))}</div>`;
  } else if (c.kind === 'npc') {
    const e = c.e;
    const saved = e.outcome === 'saved';
    card.classList.add('hurt');
    card.style.setProperty('--atk', saved ? '#3fae5a' : '#7a1a10');
    html = `<div class="pc-kind">The swarm falls on a townsperson</div><div class="pc-glyph">${saved ? '🛡' : '☠'}</div>` +
      `<div class="pc-title">${esc(e.npc?.name ?? 'A victim')} ${saved ? 'is saved' : 'dies'}</div>` +
      `<div class="pc-sub">${saved ? `${esc(e.defenderPlayer?.name ?? '')}'s defense ${e.defense} holds against ${e.amount}.`
        : `${e.amount} damage${e.defenderPlayer ? ` against ${esc(e.defenderPlayer.name)}'s defense ${e.defense}` : ', and no one was close enough to defend them'}. Every player suffers its rage.`}</div>`;
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
    html = `<div class="pc-kind" style="text-align:center">Midnight · it's here</div><div class="pc-title">The ${esc(m.name)}</div>` +
      `<div class="pc-sub" style="text-align:center">${esc(m.traits.join(', '))}${c.correct ? ' · you named it right' : ''}</div>` +
      guideDetails(m, currentFound(), true);
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
  $('#casebook').hidden = false;
}
export function closeCasebook() { $('#casebook').hidden = true; }

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
    `<div class="case-actions"><button type="button" class="ink" id="openGuide">Open the Field Guide</button></div>`;
}

export function guideDetails(c, found, open) {
  const hitObs = new Set(found.cards.filter((f) => f.kind === 'observation').map((f) => f.code));
  const hitLair = found.cards.find((f) => f.kind === 'lair')?.code;
  const chip = (text, cls) => `<span class="ge-chip ${cls}">${esc(text)}</span>`;
  const ev = c.evidence;
  const evChips = [
    chip(`Attack: ${ATTACK_TYPES[ev.attack].label}`, `atk-${ev.attack}${found.attack === ev.attack ? ' hit' : ''}`),
    ...ev.observations.map((o) => chip(OBSERVATIONS[o].label, hitObs.has(o) ? 'hit' : '')),
    chip(`Lair: ${LAIRS[ev.lair].label}`, `lair${hitLair === ev.lair ? ' hit' : ''}`),
  ].join('');
  const stat = (v) => (v === null ? '∞' : v);
  const dmg = (list, cls, word) => (list.length ? `<div class="ge-chips">${list.map((k) => chip(`${word} ${DAMAGE_KINDS[k].icon} ${DAMAGE_KINDS[k].label}`, cls)).join('')}</div>` : '');
  return `<div class="ge-body"${open ? '' : ''}>` +
    `<p><b>Evidence:</b></p><div class="ge-chips">${evChips}</div>` +
    `<p>Health <b>${stat(c.hp)}</b> · Toughness <b>${stat(c.toughness)}</b></p>` +
    dmg(c.weakness, 'weak', 'Weak to') + dmg(c.immune, 'imm', 'Immune to') +
    `<p>${esc(c.note)}</p><p><b>Objective:</b> ${esc(c.objective)}</p>` +
    c.abilities.map((a) => `<p class="ge-abil ${a.kind}">${kindType(a.kind) ? dmgIcon(kindType(a.kind)) + ' ' : ''}<b>${esc(a.name)}</b> <i>[${esc(a.roll)}]</i> ${esc(a.text)}</p>`).join('') +
    (c.wounds.length ? `<p><b>When wounded:</b> ${c.wounds.map((w) => `${w.at === null ? '∞' : w.at}: ${esc(w.text)}`).join(' · ')}</p>` : '') +
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
  if (e.outcome === 'killed') return `${e.amount} ${type} damage against defense ${e.defense}. ${who} was at Death's Door.`;
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
  const canAct = mine && ['idle', 'slotting'].includes(s.phase);
  const summary = `<div class="inv-summary">${OBOL_TYPES.map((t) =>
    `<span class="obol-count${counts[t] ? '' : ' zero'}">${obolHTML(t)}${OBOLS[t].label} ${counts[t]}</span>`).join('')}</div>`;
  const recipes = RECIPES.map((r) => {
    const why = craftBlocked(s, pl, r);
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
export function renderInventory() {
  const s = play.state;
  const pl = s.players[inv.player] ?? s.players[0];
  if (!pl) return;
  $('#invTitle').textContent = `${pl.name}'s inventory`;
  const host = $('#invPlayers');
  host.innerHTML = s.players.map((p, k) =>
    `<button type="button" role="tab" data-k="${k}" class="${k === inv.player ? 'on' : ''}" aria-selected="${k === inv.player}">` +
    `<span class="chip" style="background:${p.colour}"></span>${p.name}</button>`).join('');
  host.querySelectorAll('button').forEach((b) => { b.onclick = () => { inv.player = Number(b.dataset.k); renderInventory(); }; });
  const tabs = $('#invTabs');
  tabs.innerHTML = Object.entries(INVENTORY_TABS).map(([id, t]) =>
    `<button type="button" role="tab" data-tab="${id}" class="${id === inv.tab ? 'on' : ''}" aria-selected="${id === inv.tab}">` +
    `${t.label}<span class="n">${id === 'injuries' ? Object.values(pl.injuries ?? {}).reduce((a, b) => a + b, 0) : pl.inventory[id].length}</span></button>`).join('');
  tabs.querySelectorAll('button').forEach((b) => { b.onclick = () => { inv.tab = b.dataset.tab; renderInventory(); }; });
  const body = $('#invBody');
  if (inv.tab === 'injuries') {
    const inj = pl.injuries ?? { P: 0, M: 0, S: 0 };
    body.innerHTML = `<div class="inj-list">${['P', 'M', 'S'].map((t) => `<div class="inj-track" style="--trk-soft:${ATTACK_TYPES[t].soft}"><b class="trk-head">${dmgIcon(t)} ${INJURY_TRACKS[t].label}</b>` +
      INJURY_TRACKS[t].tiers.map((tier, k) => `<div class="inj-tier${inj[t] > k ? ' has' : ''}"><span class="sw" style="background:${ATTACK_TYPES[t].colour};opacity:${[0.5, 0.75, 1][k]}"></span>` +
        `<span><b style="display:inline">${esc(tier.name)}</b> · ${esc(tier.text)}</span></div>`).join('') + '</div>').join('')}</div>` +
      `<p class="inv-empty" style="padding:12px 4px">${pl.dead ? `${esc(pl.name)} is dead.` : 'Tiers add up; each track is separate. Tier 3 on any track is Death’s Door.'}</p>`;
    return;
  }
  const items = pl.inventory[inv.tab];
  if (!items.length && inv.tab !== 'obolcraft') {
    body.innerHTML = `<p class="inv-empty">${INVENTORY_TABS[inv.tab].empty}</p>`;
    return;
  }
  if (inv.tab === 'obolcraft') {
    body.innerHTML = obolcraftHTML(pl);
    wireObolcraft(body, pl);
    return;
  } else {
    body.innerHTML = `<div class="inv-grid">${items.map((e) => `<div class="inv-item"><b>${e.label ?? 'Item'}</b></div>`).join('')}</div>`;
  }
}
export function openInventory(k = play.state.cur) {
  inv.player = k;
  renderInventory();
  $('#inventory').hidden = false;
}
export function closeInventory() { $('#inventory').hidden = true; }
