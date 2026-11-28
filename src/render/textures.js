// Small generated textures.

import * as THREE from 'three';
import { ui } from '../app/config.js';
import { applyControlBindings } from '../app/controls.js';
import { updateCounts, updateUndoButtons } from '../app/shell.js';
import { setEdgeBrush } from '../editor/moveCheck.js';
import { setBrush, setShape } from '../editor/toolbar.js';
import { applyAtmosphere } from './surroundings.js';

// Run once at startup (called from src/main.js, in order).
export function init() {
  setBrush(ui.brush);
  setEdgeBrush(ui.edgeBrush);
  setShape(ui.shape);
  updateUndoButtons();
  updateCounts();
  applyControlBindings();
  applyAtmosphere();
}

export function makeRadialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
