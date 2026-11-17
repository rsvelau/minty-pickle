# Board Grid Planner

A 3D planning board for a night-time, 90s Pacific Northwest board game.
The board is a whole town: a 20 × 26 grid by default (columns **A–T**, rows **1–26**), resizable from 4 to 60
cells per side. Every cell has three attributes:

| Attribute | Values | How it shows |
|-----------|--------|--------------|
| Area | Outdoor / Indoor / Water (Lake, River) | Mossy blue-grey, warm wood brown, or sunken water |
| Bridge | On water cells only | A wooden deck at street level with railings along open water |
| Light | Unlit / Lit | Lit cells glow and spill a soft light pool onto neighbours (mercury-vapour green outside, incandescent amber inside) |
| Movement | Walkable / Blocked | Blocked cells rise as solid blocks (buildings, dense brush) |

### Areas and subcategories

Areas are categories with optional subcategories, defined once in `AREAS` in `src/state.js`. Water has
**Lake** and **River**; Outdoor and Indoor have none yet. Adding one there (e.g. `road`, `hardwood`) makes it
valid everywhere: painting, saving and importing.

### Water and bridges

- Water cells sit below the land: the surface is about 1.2 m under street level and the bed about 2.4 m down,
  so banks show around every lake and river.
- **Rivers flow from the right side of the board to the left, following the painted path.** Each connected
  river starts at its right-most cells; flow follows the walking distance from there, so a river that bends
  down and back across turns with it. Lakes are still water.
- Painting water makes a cell unwalkable; painting land over water makes it walkable again and removes any
  bridge.
- **Bridge** only applies to water cells and makes them walkable. Each bridge cell knows which way it spans
  (`bridgeAxis()` in `src/state.js`, and `bridgeAxis` in exported JSON): toward land or other bridge cells
  and across the water. That is what future bridge assets and pylons should use.

## Scale

One cell is about **4 m (13 ft)**, so a small home covers **2 × 2 cells** (about 8 m / 26 ft square) and the
default board is roughly 80 × 104 m. Everything outside the board is built to that scale
(`METERS_PER_CELL` in `src/main.js`):

- Douglas firs 16–44 m tall (4–11 cells), younger ones at the forest edge
- A small reference house (2 × 2 cells, 3 m walls) in the clearing beside the board
- Blocked cells rise one storey (3 m)
- **Show small-home footprint at cursor** draws a ghost 2 × 2 house where you hover

Trees between the camera and the board dissolve so they never hide cells.

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
| Choose a brush | `1` Outdoor · `2` Indoor · `7` Lake · `8` River · `9` Bridge · `3` Unlit · `4` Lit · `5` Walkable · `6` Blocked · `0` Reset |
| Orbit camera | Right-drag, or hold `Space` and left-drag, or **Orbit mode** |
| Pan / zoom | Middle-drag / mouse wheel |
| Camera presets | `A` angled · `T` top-down |
| Undo / redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` (or `Ctrl+Y`) |
| Touch | One finger paints, two fingers orbit/zoom |

**Board size** sets columns and rows. Cells are kept from the top-left (A1) corner; shrinking removes cells past
the new edge, and undo restores them.

The **View** buttons isolate one layer at a time (Area, Light, Move) when the combined view gets busy.

## Saving

The board autosaves to your browser's local storage. **Export JSON** / **Import JSON** move layouts between
machines (the file carries the board size); **Save PNG** grabs the current view. The JSON is deliberately plain so
future tools can read it:

```json
{
  "format": "minty-pickle-grid",
  "version": 2,
  "cols": 20,
  "rows": 26,
  "cells": [
    { "x": 0, "y": 0, "id": "A1", "area": "outdoor", "sub": null, "lit": false, "walkable": true, "bridge": false },
    { "x": 9, "y": 4, "id": "J5", "area": "water", "sub": "river", "lit": true, "walkable": true, "bridge": true, "bridgeAxis": "y" }
  ]
}
```

Version 1 files (`"indoor": true/false`) still import; they are converted on load.

## Code layout

- `src/state.js` — grid data model, strokes, undo/redo, JSON (de)serialization. No rendering.
- `src/main.js` — three.js scene, tile rendering, bridges, painting, UI wiring.
- `src/water.js` — water surface shader (flow-mapped river currents, still lakes).
- `src/style.css` — panel styling.

Tiles are a single `InstancedMesh`; each cell's look comes from `cellLook()` in `main.js`. That's the place
to swap flat colours for textures (road, hardwood, etc.) later. GLTF buildings and props (cars, streetlights)
can be added to the scene with three's `GLTFLoader` and positioned with `cellToWorld(x, y)`.
Bridge assets belong with the decks in `refreshWaterAndBridges()`: for each bridge cell, `grid.bridgeAxis(x, y)`
gives the span direction, the deck top is at `DECK_TOP`, and the water surface and bed are at `WATER_Y` and
`BED_H`, which is where pylons would stand.
