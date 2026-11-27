// Settings → Cards in the game: choose which cards make the cut, and how many
// copies of each (0-3; monsters in or out). Saved with the other game
// settings as gameConfig.deckCounts (only the changes from 1 copy each); new
// games deal their decks from it (src/game/decks.js).
import { starsText } from '../game/cards/monsters.js';
import { DECKS, copiesOf, deckList, MAX_COPIES } from '../game/decks.js';
import { EVENT_CATEGORIES } from '../game/cards/events.js';
import { KEYWORDS } from '../game/cards/keywords.js';
import { $ } from '../app/dom.js';
import { gameConfig, saveConfig } from './playView.js';
import { markSettingsDirty } from './gameSettings.js';
import { abilitiesHTML, ammoIcon } from './panels.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let tab = 'equipment';
let query = '';

function setCount(deck, id, n) {
  const max = DECKS[deck].maxCopies ?? MAX_COPIES;
  n = Math.max(0, Math.min(max, n));
  const counts = { ...(gameConfig.deckCounts ?? {}) };
  if (n === 1) delete counts[`${deck}:${id}`]; else counts[`${deck}:${id}`] = n;
  gameConfig.deckCounts = counts;
  saveConfig();
  markSettingsDirty();
}

function cardDetail(deck, c) {
  if (deck === 'equipment') return abilitiesHTML(c);
  if (deck === 'events') return `<p class="dk-text"><span class="dk-cat">${esc(EVENT_CATEGORIES[c.category].label)}</span> ${esc(c.text)}</p>` +
    (c.afterMidnight ? `<p class="dk-text"><span class="dk-cat">After midnight</span> ${esc(c.afterMidnight)}</p>` : '');
  if (deck === 'mindsets') return `<p class="dk-text">${esc(c.text)}</p>`;
  return `<p class="dk-text"><span class="ge-stars" title="Difficulty ${c.stars ?? 1} of 5">${starsText(c.stars ?? 1)}</span> ${esc(c.traits.join(', '))}</p>`;
}

const tabsHTML = () => Object.entries(DECKS).map(([id, d]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${esc(d.label)}<small>${deckList(gameConfig, id).length}</small></button>`).join('')
  + `<button data-tab="glossary" class="${tab === 'glossary' ? 'on' : ''}">Glossary<small>${KEYWORDS.length}</small></button>`;

export function openDecks() {
  const el = $('#deckScreen');
  if (tab === 'glossary') {
    el.innerHTML = `<div class="screen-card dk-card">
      <button class="screen-back" data-back>‹ Back</button>
      <h2 class="screen-title">Cards in the game</h2>
      <div class="seg dk-tabs">${tabsHTML()}</div>
      <dl class="dk-glossary">${KEYWORDS.map((k) => `<dt>${k.icon === 'ammo' ? `${ammoIcon(true)} ` : ''}${esc(k.term)}</dt><dd>${esc(k.text)}</dd>`).join('')}</dl>
    </div>`;
    el.hidden = false;
    el.querySelector('[data-back]').onclick = () => { el.hidden = true; el.innerHTML = ''; };
    el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; query = ''; openDecks(); }; });
    return;
  }
  const deck = DECKS[tab];
  const max = deck.maxCopies ?? MAX_COPIES;
  const q = query.trim().toLowerCase();
  const cards = deck.cards.filter((c) => !q || `${c.name} ${c.text ?? ''} ${c.category ?? ''}`.toLowerCase().includes(q));
  el.innerHTML = `<div class="screen-card dk-card">
    <button class="screen-back" data-back>‹ Back</button>
    <h2 class="screen-title">Cards in the game</h2>
    <p class="screen-note">Choose which cards new games use${max > 1 ? ' and how many copies of each' : ''}. Games already started keep their decks.</p>
    <div class="seg dk-tabs">${tabsHTML()}</div>
    <div class="dk-tools">
      <input type="search" class="screen-input" id="dkFind" placeholder="Find a card" value="${esc(query)}" />
      <button data-all="1">All in</button><button data-all="0">All out</button>
    </div>
    <div class="dk-list">${cards.map((c) => {
      const n = copiesOf(gameConfig, tab, c.id);
      return `<div class="dk-row${n ? '' : ' out'}">
        <div class="dk-info"><b>${esc(c.name)}</b>${cardDetail(tab, c)}</div>
        ${max > 1
          ? `<div class="dk-step"><button data-id="${c.id}" data-d="-1" aria-label="Fewer">−</button><span>${n}</span><button data-id="${c.id}" data-d="1" aria-label="More">+</button></div>`
          : `<button class="dk-toggle ${n ? 'on' : ''}" data-id="${c.id}" data-set="${n ? 0 : 1}">${n ? 'In' : 'Out'}</button>`}
      </div>`;
    }).join('') || '<p class="screen-note">No cards match.</p>'}</div>
  </div>`;
  el.hidden = false;
  el.querySelector('[data-back]').onclick = () => { el.hidden = true; el.innerHTML = ''; };
  el.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; query = ''; openDecks(); }; });
  el.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { setCount(tab, b.dataset.id, copiesOf(gameConfig, tab, b.dataset.id) + Number(b.dataset.d)); openDecks(); }; });
  el.querySelectorAll('[data-set]').forEach((b) => { b.onclick = () => { setCount(tab, b.dataset.id, Number(b.dataset.set)); openDecks(); }; });
  el.querySelectorAll('[data-all]').forEach((b) => { b.onclick = () => { for (const c of cards) setCount(tab, c.id, Number(b.dataset.all)); openDecks(); }; });
  const find = el.querySelector('#dkFind');
  find.oninput = () => {
    query = find.value;
    const pos = find.selectionStart;
    openDecks();
    const f = $('#dkFind'); f.focus(); f.setSelectionRange(pos, pos);
  };
}
