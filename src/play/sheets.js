// The dock's menus open as sheets over the board, just above the dock: one at
// a time (opening one closes the others), and the dock button of the open one
// is lit. Team, Skills (#inventory), Case (#casebook) and More.
export const SHEETS = ['teamSheet', 'inventory', 'casebook', 'moreSheet', 'crateSheet'];
const el = (id) => document.getElementById(id);

function syncDock() {
  document.querySelectorAll('.dock-btn[data-sheet]').forEach((b) => {
    const open = !!el(b.dataset.sheet) && !el(b.dataset.sheet).hidden;
    b.classList.toggle('on', open);
    b.setAttribute('aria-expanded', String(open));
  });
}
export function showSheet(id) {
  for (const s of SHEETS) if (el(s)) el(s).hidden = s !== id;
  syncDock();
}
export function hideSheet(id) {
  if (el(id)) el(id).hidden = true;
  syncDock();
}
export const sheetOpen = (id) => !!el(id) && !el(id).hidden;
export const anySheetOpen = () => SHEETS.some(sheetOpen);
export function hideSheets() { for (const s of SHEETS) hideSheet(s); }

// Drag a sheet's header down to close it.
export function dragToClose(id, onClose) {
  const head = el(id)?.querySelector('.sheet-head');
  if (!head) return;
  let y0 = null;
  head.addEventListener('pointerdown', (e) => { if (!(e.target instanceof Element && e.target.closest('button'))) y0 = e.clientY; });
  window.addEventListener('pointerup', (e) => { if (y0 !== null && e.clientY - y0 > 50) onClose(); y0 = null; });
  window.addEventListener('pointercancel', () => { y0 = null; });
}
