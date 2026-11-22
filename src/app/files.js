// Files: export/import JSON, snapshot PNG, the in-page dialog and toasts,
// and saving a file (through claude.ai's downloads prompt when available).

import { grid, hoverIndex } from './config.js';
import { applyTerrain } from './panelControls.js';
import { updateUndoButtons } from './shell.js';
import { $ } from './dom.js';
import { camera, renderer, scene } from '../render/scene.js';
import { hoverBox } from '../render/tileLook.js';
import { readMap } from '../core/mapFormat.js';
import { checkMap } from '../core/mapCheck.js';

// Module state: assigned by init() below, in the same order as before the split.
export let dlg, claudeDownloads;

// Run once at startup (called from src/main.js, in order).
export function init() {
  // In-page dialog for export / import / PNG. Works even where native
  // alert()/confirm() and file downloads are blocked (e.g. sandboxed embeds).
  dlg = {
    root: $('#dialog'), title: $('#dlgTitle'), text: $('#dlgText'),
    area: $('#dlgArea'), img: $('#dlgImg'), actions: $('#dlgActions'),
  };
  dlg.root.addEventListener('click', (e) => { if (e.target === dlg.root) closeDialog(); });

  $('#export').addEventListener('click', () => {
    const json = JSON.stringify(grid.toJSON(), null, 2);
    openDialog({
      title: 'Export layout',
      text: 'Copy this JSON somewhere safe, or download it as a file. Import accepts either.',
      area: json,
      actions: [
        ['Copy JSON', async () => {
          try { await navigator.clipboard.writeText(json); toast('JSON copied.'); } catch { dlg.area.select(); dialogError('Copy was blocked here. The text is selected; press Ctrl/Cmd+C.'); }
        }, true],
        ['Download .json', () => download(new Blob([json], { type: 'application/json' }), `board-grid-${stamp()}.json`)],
      ],
    });
  });
  $('#import').addEventListener('click', () => {
    openDialog({
      title: 'Import layout',
      text: 'Paste exported JSON below, or choose a .json file. This replaces the board (undo restores it).',
      area: '',
      readonly: false,
      actions: [
        ['Load pasted JSON', () => importText(dlg.area.value), true],
        ['Choose file…', () => $('#importFile').click()],
      ],
    });
    dlg.area.placeholder = '{ "format": "minty-pickle-grid", ... }';
  });
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importText(await file.text());
  });
  $('#checkMap').addEventListener('click', showMapCheck);
  $('#png').addEventListener('click', () => {
    hoverBox.visible = false;
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    hoverBox.visible = hoverIndex >= 0;
    openDialog({
      title: 'Snapshot',
      text: 'Right-click (or long-press) the image to save or copy it.',
      img: url,
      actions: [['Download .png', () => renderer.domElement.toBlob((b) => b && download(b, `board-grid-${stamp()}.png`)), true]],
    });
  });
}

// Run once at startup (called from src/main.js, in order).
export function init2() {
  // Saving a file. Inside a claude.ai artifact the page can't download by itself,
  // so it asks the viewer through the "downloads" capability (they confirm each
  // save). Anywhere else (dev server, a plain web host) it uses a normal link.
  claudeDownloads = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
}

export function openDialog({ title, text = '', area = null, readonly = true, img = null, actions = [] }) {
  dlg.title.textContent = title;
  dlg.text.textContent = text;
  dlg.text.classList.remove('error');
  dlg.area.hidden = area === null;
  if (area !== null) { dlg.area.value = area; dlg.area.readOnly = readonly; }
  dlg.img.hidden = !img;
  if (img) dlg.img.src = img;
  dlg.actions.replaceChildren(...actions.map(([label, fn, primary]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.classList.add('on');
    b.addEventListener('click', fn);
    return b;
  }), Object.assign(document.createElement('button'), { textContent: 'Close', onclick: closeDialog }));
  dlg.root.hidden = false;
  (area !== null && !readonly ? dlg.area : dlg.actions.firstElementChild)?.focus();
}
export function closeDialog() { dlg.root.hidden = true; dlg.img.removeAttribute('src'); }
export function dialogError(msg) { dlg.text.textContent = msg; dlg.text.classList.add('error'); }

export function importText(text) {
  try {
    const { data } = readMap(text);
    applyTerrain(data.terrain);
    grid.replaceAll(data.cols, data.rows, data.cells, data.edges);
    updateUndoButtons();
    closeDialog();
    toast('Layout imported. Undo restores the previous board.');
  } catch (err) {
    dialogError(`That isn't a map this app can read: ${err.message} Paste the JSON from Export, or choose a .json file.`);
  }
}

export let toastTimer = 0;
export function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}
export async function download(blob, name) {
  const saver = await claudeDownloads;
  if (!saver) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  try {
    await saver.save({ filename: name, data: blob });
    toast(`Saved ${name}.`);
  } catch (err) {
    const code = err?.code;
    if (code === 'declined') return; // they said no: nothing to do
    if (code === 'rate_limited') dialogError('A save is already waiting for you to confirm. Answer that one, then try again.');
    else if (code === 'too_large') dialogError('That file is too large to save here.');
    else dialogError(name.endsWith('.png')
      ? 'Saving files is not available in this view. Long-press or right-click the image to save it instead.'
      : 'Saving files is not available in this view. Use Copy JSON and keep the text somewhere safe instead.');
  }
}
export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// "Ready to play?": what the game needs from this map (src/core/mapCheck.js).
export function showMapCheck() {
  const { ok, problems } = checkMap(grid);
  const errors = problems.filter((p) => p.level === 'error');
  const warnings = problems.filter((p) => p.level === 'warning');
  const text = !problems.length ? 'Yes: this map has everything the game needs.'
    : ok ? `Playable, with ${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth a look.`
      : `Not yet: ${errors.length} thing${errors.length === 1 ? '' : 's'} must be fixed before it can be played.`;
  openDialog({
    title: 'Ready to play?',
    text,
    area: problems.length ? [...errors.map((p) => `✕  ${p.text}`), ...warnings.map((p) => `!  ${p.text}`)].join('\n\n') : null,
  });
}

