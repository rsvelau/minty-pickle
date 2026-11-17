# Board Grid Planner

A 3D planning board for a night-time, 90s Pacific Northwest board game.
It's a 20 × 26 grid (columns **A–T**, rows **1–26**) where every cell has three attributes:

| Attribute | Values | How it shows |
|-----------|--------|--------------|
| Area | Outdoor / Indoor | Mossy blue-grey vs. warm wood brown |
| Light | Unlit / Lit | Lit cells glow and spill a soft light pool onto neighbours (mercury-vapour green outside, incandescent amber inside) |
| Movement | Walkable / Blocked | Blocked cells rise as solid blocks (buildings, dense brush) |

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (works from any sub-path, e.g. GitHub Pages)
```

## Controls

| Action | Input |
|--------|-------|
| Paint with the current brush | Left-drag |
| Paint a rectangle | Shift + left-drag, or the **Rectangle** toggle (`R`) |
| Choose a brush | `1` Outdoor · `2` Indoor · `3` Unlit · `4` Lit · `5` Walkable · `6` Blocked · `0` Reset |
| Orbit camera | Right-drag, or hold `Space` and left-drag, or **Orbit mode** |
| Pan / zoom | Middle-drag / mouse wheel |
| Camera presets | `A` angled · `T` top-down |
| Undo / redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (or `Ctrl+Y`) |
| Touch | One finger paints, two fingers orbit/zoom |

The **View** buttons isolate one layer at a time (Area, Light, Move) when the combined view gets busy.

## Saving

The board autosaves to your browser's local storage. **Export JSON** / **Import JSON** move layouts between
machines; **Save PNG** grabs the current view. The JSON is deliberately plain so future tools can read it:

```json
{
  "format": "minty-pickle-grid",
  "version": 1,
  "cols": 20,
  "rows": 26,
  "cells": [
    { "x": 0, "y": 0, "id": "A1", "indoor": false, "lit": false, "walkable": true }
  ]
}
```

## Code layout

- `src/state.js` — grid data model, strokes, undo/redo, JSON (de)serialization. No rendering.
- `src/main.js` — three.js scene, tile rendering, painting, UI wiring.
- `src/style.css` — panel styling.

Tiles are a single `InstancedMesh`; each cell's look comes from `cellLook()` in `main.js`. That's the place
to swap flat colours for textures (road, hardwood, etc.) later. GLTF buildings and props (cars, streetlights)
can be added to the scene with three's `GLTFLoader` and positioned with `cellToWorld(x, y)`.
