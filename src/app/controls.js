// Camera control bindings (mouse buttons and touch gestures).

import * as THREE from 'three';
import { ui } from './config.js';
import { controls, renderer } from '../render/scene.js';

// ---------------------------------------------------------------------------
// Camera bindings
// ---------------------------------------------------------------------------

export function applyControlBindings() {
  const orbitLeft = ui.orbitMode || ui.spaceHeld;
  controls.mouseButtons = {
    LEFT: orbitLeft ? THREE.MOUSE.ROTATE : null,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  controls.touches = {
    ONE: orbitLeft ? THREE.TOUCH.ROTATE : null,
    TWO: THREE.TOUCH.DOLLY_PAN, // pinch zooms toward the fingers, drag pans
  };
  if (renderer) renderer.domElement.style.cursor = orbitLeft ? 'grab' : 'crosshair';
}
