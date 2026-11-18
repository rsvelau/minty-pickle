# Board Grid Planner

A 3D planning board for a night-time, 90s Pacific Northwest board game.
The board is a whole town: a 20 × 26 grid by default (columns **A–T**, rows **1–26**), resizable from 4 to 60
cells per side. Every cell has an area (category + subcategory), light and movement; walls and doors sit on
the edges between cells.

| Attribute | Values | How it shows |
|-----------|--------|--------------|
| Area | Outdoor / Indoor / Water, each with subcategories (below) | A surface colour per subcategory; water is sunken |
| Bridge | On water cells only | A wooden deck at street level with railings along open water |
| Light | Unlit / Lit | Lit cells glow and spill a soft light pool onto neighbours (mercury-vapour green outside, incandescent amber inside) |
| Movement | Walkable / Blocked | Every surface has a walkable and a blocked version (below) |

### Areas and subcategories

| Category | Subcategories |
|----------|---------------|
| Outdoor | Ground (default), Street, Path, Cemetery, Cemetery path, Forest cemetery\*, Forest\*, Brambles\* |
| Indoor | Hardwood (default), Carpet |
| Water | Lake, River (always start blocked) |

\* Starts out **blocked** when painted. Painting an ordinary subcategory over a default-blocked cell unblocks
it; otherwise painting keeps the cell's walkability, and the Walkable/Blocked brushes always win.

### Streets

**Street** is a narrow small-town two-lane road with a small sidewalk each side, all in one cell (2.5 m lanes,
1 m sidewalks). Each street cell looks at its four neighbours (street or bridge cells connect) and lays
itself out to match:

| Connections | Layout |
|-------------|--------|
| Two opposite sides | Straight: dashed centre line (one 3 m dash per cell, so runs line up), sidewalks on the closed sides |
| Two adjacent sides | Corner: the centre line curves round; sidewalks on the outer edges and a square on the inner corner |
| Three sides | T: the through road keeps its centre line; a crosswalk runs across the side street |
| Four sides | Crossing: corner sidewalk squares and crosswalks on every approach |
| One side | Dead end: the line stops short and the sidewalk wraps around the end |

A street running straight to the board edge continues off it rather than dead-ending, and streets carry on
across bridges (the deck has the same centre line). Paint is faded and chipped, the asphalt cracked and
patched, and the sidewalks are jointed concrete with moss and raised curbs. Old **Road** and **Sidewalk**
cells become Street when loaded. The street surface lives in `src/street.js`.

**Intersections** (T-junctions and crossings) get street furniture:

- **Stop signs**: a faded red octagon on a post, on the corner to the right of each approach that has to stop,
  facing oncoming traffic. Crossings are all-way stops (four signs); at a T only the side street stops.
- **An antique street lamp**: the town is a late-1800s logging town kept historic, so lamps are cast-iron posts
  in old dark-green paint (flared base, fluted shaft, ladder bar) with an acorn glass globe, cap and finial,
  about 4.4 m tall. At a T it stands on the sidewalk opposite the side street; at a crossing, on a corner.

### Light

Light comes from **light sources**. Place one with **Light source** (`4`) at the radius set by the slider
(0–6 cells, in half steps); **No light** (`3`) removes it. The centre brightness follows the size of the
light, so a small radius is a small light:

| Radius | Like | Centre brightness |
|--------|------|-------------------|
| 0–0.5 | Candle / dim bulb (lights only its own cell) | 45–55 % |
| 1–1.5 | Porch light / lamp | 65–75 % |
| 2–2.5 | Bright room / shop light | 85–95 % |
| 3+ | Floodlight and up | 100 % |

Brightness falls off with distance to `centre / (radius + 1)` at the edge of the radius. Overlapping lights
add up. **Light travels in straight lines: walls and closed (locked or one-way) doors block it, while
windows and open (unlocked) doors let it through**,
so a lit shop spills light onto the street through its storefront but not through its side walls.

**Lit lamp** (`L`) switches on the street lamp at a street T-junction or crossing (it does nothing elsewhere).
A street lamp is a light source of radius 1.5 at full brightness.

Light levels are data: hovering a cell shows its light (`Light 50 %`, `Light source r 3 (Floodlight)`), the
**Light** view shows the levels as a gradient, storefront glass glows when light reaches either side, and
exported JSON gives every cell a `light` level from 0 to 1 (plus `lit`/`radius` on sources and `"lamp": true`
on lit lamps). The rules live in `src/state.js` (`centreBrightness`, `lightAt`, `lightReaches`). Saves from
before light sources had a radius load their lit cells as radius-½ bulbs.

### Walkable and blocked versions

Blocked cells stay flat; props show what's in the way. Barricades, gates, logs and stepping stones turn to fit
the cells around them (across a road, along a path).

| Surface | Walkable | Blocked |
|---------|----------|---------|
| Ground | Open grass | Boulders and shrubs |
| Street | Open road | Two sawhorse barricades across both lanes, cones on the curbs |
| Path | Clear | Fallen log across the path, rocks |
| Cemetery | Sparse grave markers (2–3 per cell) | Dense rows of markers with one or two large monuments (obelisks, family monuments) |
| Cemetery path | Clear gravel | Wrought-iron gate across the path |
| Forest cemetery | One fir and a headstone | Dense firs and headstones |
| Forest | A clearing with one young fir | Dense young firs |
| Brambles | Trampled, a couple of low mounds | Thick thorn mounds |
| Hardwood | Clear floor | Wardrobe and stacked crates |
| Carpet | Clear floor | 90s sofa, armchair and coffee table |
| Lake / River | Stepping stones (a ford) | Open water |
| Bridge | Open deck | Barricade on the deck |

The variants live in `VARIANTS` in `src/props.js`: one entry per subcategory, each returning the props
for its walkable and blocked look. Props are built to scale (1 cell = 7 m).

Everything is defined once in `AREAS` in `src/state.js` (label, default walkability). The brush buttons are
generated from it, so a new subcategory added there shows up in the panel, saves and imports. Give it a
colour in `SUB_LOOK` in `src/main.js`.

### Gameplay markers

The **Markers** tool (`P`) places gameplay markers on **walkable** cells (blocked cells are skipped). A marker
sits on top of its cell and never changes the cell's area, light, walkability or walls. Each shows as a large
icon badge floating over the cell (it faces the camera and never shrinks below an easy-to-see size when you
zoom out) with a coloured ring on the floor.

| Marker | Icon | Meaning |
|--------|------|---------|
| Investigation | Magnifying glass (amber) | Can be investigated to look for clues |
| Objective | Flag (red) | Objectives appear here once the monster reveals itself |
| White Dice | White die | Single-use white dice to collect |
| Black Dice | Black die | Black dice to attune (renew every turn) |
| Key | Skeleton key (gold) | Touching it unlocks every locked and one-way door in its building |
| Research | Open book (violet) | Single use: uncovers a piece of evidence without investigating |

One marker per cell; **Remove marker** clears it, and undo works as usual. A key's **building** is the
connected indoor area it sits in (interior walls don't split it), or, for a key just outside, the buildings
its cell touches. Hovering a key outlines the doors it unlocks in gold and the info box says how many.
Exported cells carry `"marker"`, and key cells also list the doors they unlock (`"unlocks"`). **Show
markers** in View hides them. Marker art lives in `src/markers.js`; the list of markers is `MARKERS` in
`src/state.js`.

### Movement check

The **Movement** tool (`M`) checks routes with the same rules your game will use:

- **Click a start cell**, then hover any cell: the shortest route is drawn and the info box gives the move
  count (`O11 → J11: 5 moves`) or says there is no route. Click a cell to pin it as the destination; click
  the start again (or press `Esc`) to clear.
- **Range** shades every cell reachable within N moves (brighter = closer) and counts them.
- **Allow diagonal moves** adds diagonal steps. A diagonal step needs both ways round the corner to be clear,
  so you can't squeeze between two walls or past a door's frame.

Rules: you can only enter **walkable** cells; **walls, windows and locked doors** can't be crossed;
**unlocked doors** can be crossed both ways; **one-way doors** only in their arrow's direction. Each move is
one cell.

**Keys** (on by default, **Keys unlock doors**): walking onto a Key marker picks it up (a key on the start
cell counts too), and from then on every locked and one-way door in that key's building passes both ways.
The search tracks which keys you carry, so a route detours to fetch a key when that's the only way in or
it's shorter; the info box says where (`Picks up a key at M10`) and the key gets a gold ring. Range shading
uses the same rule. Keys whose buildings unlock the same doors count as one; up to 8 distinct keys are
tracked at once (`MAX_KEY_GROUPS`). The rules live in `src/state.js` (`canCross`, `canStep`, `keyGroups`, `moveField`, `route`) so game code can
reuse them.

### Walls and doors

Walls, doors and windows are a separate tool (**Walls & doors** in the panel, or `W` / `D` / `K` / `O` / `G` / `X`) because they live
on the **edges between cells**, not in cells:

- **Drag along grid lines** to draw walls; the pointer snaps to grid corners.
- **Click an edge** to place a single piece; clicking the same piece again removes it.
- **Rectangle** (or Shift-drag) outlines a room. With **Erase**, it clears every wall and door inside the
  rectangle.
- **Doors are centred on their edge, between the two cells.** Each is drawn as a 1.2 m opening with an
  open door leaf, with wall on either side.
- **Three kinds of door**, all centred on their edge:

  | Door | Key | Looks | Movement | Light |
  |------|-----|-------|----------|-------|
  | Unlocked | `D` | Standing open | Both ways | Passes |
  | Locked | `K` | Shut, red lock plate and brass lock on both faces, red threshold | Blocked | Blocked |
  | One-way | `O` | Ajar toward the side it opens to, green arrow on the floor | Only the arrow's way | Blocked |

  For a one-way door, **click on the side people come from**; the arrow points through to the other cell.
  Clicking it again from the other side flips it; clicking from the same side removes it. Hover shows
  e.g. `One-way door L11 → M11`, and exported JSON gives `"type": "oneWayDoor"` with `passFrom` / `passTo`.
- **Windows** (`G`) are large storefront windows centred on their edge: masonry piers at the ends, a painted
  wooden bulkhead under a big glass pane, and mullions/transoms that vary from window to window (two panes
  with a transom, three panes, one big pane with transom lights, four narrow panes), in old painted-frame
  colours (dark green, oxblood, black, cream, navy). Glass glows warm when light reaches either side.
- **Light:** walls, locked doors and one-way doors block light; unlocked doors and windows let it through.
- **Low walls (cutaway view)** in View keeps walls short so you can see into rooms; untick for full 2.6 m walls.

### Water and bridges

- Water cells sit below the land: the surface is about 2 m under street level and the bed about 3.6 m down,
  so banks show around every lake and river.
- **Rivers flow from the right side of the board to the left, following the painted path.** Each connected
  river starts at its right-most cells; flow follows the walking distance from there, so a river that bends
  down and back across turns with it. Lakes are still water.
- Painting water makes a cell unwalkable; painting land over water makes it walkable again and removes any
  bridge.
- **Bridges are steel through-truss road bridges** in the Pacific Northwest style (loosely after Snohomish's
  Avenue D bridge): rust-red Warren trusses with inclined end posts and verticals, overhead struts with X
  bracing, an asphalt deck with a pale concrete edge girder and pipe railings, and round concrete piers
  with cap beams in the water at each end and every two cells. Connected bridge cells form one bridge, so a
  line of three bridge cells is one two-lane, three-cell span (`src/bridge.js`).
- **Bridge** only applies to water cells and makes them walkable. Each bridge cell knows which way it spans
  (`bridgeAxis()` in `src/state.js`, and `bridgeAxis` in exported JSON): toward land or other bridge cells
  and across the water. That is what future bridge assets and pylons should use.

## Scale

One cell is about **7 m (23 ft)**: the width of a narrow two-lane street with small sidewalks. The default
board is roughly 140 × 182 m. Everything is built in metres and converted through `METERS_PER_CELL` in
`src/scale.js`:

- Douglas firs 16–44 m tall (about 2–6 cells), younger ones at the forest edge
- A small reference house (9 × 8 m, about 1.3 × 1.1 cells, 3 m walls) in the clearing beside the board
- **Show small home at cursor** draws that house as a ghost where you hover
- Props, walls (2.6 m), doors (1.2 m), bridges and water depth all use real sizes

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
| Choose a brush | `1` Ground · `2` Hardwood · `7` Lake · `8` River · `9` Bridge · `3` No light · `4` Light source · `L` Lit lamp · `5` Walkable · `6` Blocked · `0` Reset (other subcategories: click) |
| Markers | `P` (pick a marker, click/drag on walkable cells) |
| Movement check | `M` (click start, hover/click destination, `Esc` clears) |
| Walls & doors | `W` wall · `D` unlocked door · `K` locked door · `O` one-way door · `G` window · `X` erase |
| Orbit camera | Right-drag, or hold `Space` and left-drag, or **Orbit mode** |
| Zoom | Mouse wheel or pinch; zooms toward the pointer, so you can zoom into any corner of the board |
| Pan | Middle-drag, Shift + right-drag (trackpads), arrow keys, or two-finger drag on touch |
| Focus a cell | `F` flies in close to the cell or edge under the pointer |
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
  "version": 3,
  "cols": 20,
  "rows": 26,
  "cells": [
    { "x": 0, "y": 0, "id": "A1", "area": "outdoor", "sub": null, "lit": false, "walkable": true, "bridge": false },
    { "x": 9, "y": 4, "id": "J5", "area": "water", "sub": "river", "lit": true, "walkable": true, "bridge": true, "bridgeAxis": "y" }
  ],
  "edges": [
    { "edge": "v", "x": 3, "y": 2, "type": "wall", "between": ["C3", "D3"] },
    { "edge": "h", "x": 5, "y": 9, "type": "door", "between": ["F9", "F10"] }
  ]
}
```

An edge `"v"` at (x, y) is the west side of cell (x, y); `"h"` is its north side. `between` names the two
cells it separates (`null` past the board edge).

Older files still import: version 1 (`"indoor": true/false`) and version 2 (no subcategories for
outdoor/indoor, no edges) are converted on load, outdoor to Ground and indoor to Hardwood.

## Code layout

- `src/state.js` — grid data model, strokes, undo/redo, JSON (de)serialization. No rendering.
- `src/main.js` — three.js scene, tile rendering, bridges, painting, UI wiring.
- `src/water.js` — water surface shader (flow-mapped river currents, still lakes).
- `src/props.js` — walkable/blocked props for every surface (`VARIANTS`).
- `src/markers.js` — gameplay marker badges and icons.
- `src/bridge.js` — steel truss bridge structures built from connected bridge cells.
- `src/street.js` — street surfaces: lane lines, crosswalks, sidewalks, chosen from neighbouring cells.
- `src/scale.js` — metres per cell and the street cross-section.
- `src/style.css` — panel styling.

Tiles are a single `InstancedMesh`; each cell's look comes from `cellLook()` in `main.js`. That's the place
to swap flat colours for textures (road, hardwood, etc.) later. GLTF buildings and props (cars, streetlights)
can be added to the scene with three's `GLTFLoader` and positioned with `cellToWorld(x, y)`.
Bridge assets belong with the decks in `refreshWaterAndBridges()`: for each bridge cell, `grid.bridgeAxis(x, y)`
gives the span direction, the deck top is at `DECK_TOP`, and the water surface and bed are at `WATER_Y` and
`BED_H`, which is where pylons would stand.
