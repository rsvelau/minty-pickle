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
| Outdoor | Ground (default), Street, Start space, Old Clocktower\*, Path, Cemetery, Cemetery path, Forest cemetery\*, Forest\*, Brambles\* |
| Indoor | Hardwood (default), Carpet, Church floor, Condemned\* |
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

### Building finishes

Every building gets **one exterior finish** and **one interior finish**, chosen separately, so all of its
outside walls match each other and all of its inside walls match each other, but inside and outside don't
have to match. It also gets **one** storefront window design and frame colour.

- **Exterior:** faded barn-red, weathered olive, dusty mustard, old cream and slate-blue **clapboard**;
  red-brown and soot-dark **brick**; sage and grey-brown **board-and-batten**; **worn plaster**; **cedar shingle**.
- **Interior:** faded rose and sage **striped wallpaper**; yellowed and dusty blue **floral wallpaper**;
  **oak wainscot** with a chair rail under cream plaster; **mint beadboard**; **nicotine-stained** and
  **grey-green plaster**; **dark walnut panelling**.

Each wall has two faces: a face looking into a building shows that building's interior, a face looking
outdoors shows its exterior. Partition walls inside a building show its interior on both sides; a wall
shared by two buildings shows each one's interior on its own side. Textures are drawn to scale in the wall
shader. A building is indoor floor joined by open floor or doors (walls and windows between floors split
buildings), and its finishes come from its first cell, so they stay put while you paint. Hovering an indoor
cell names both finishes.

### Church floor

An indoor tile for churches. **Walkable** church cells each hold a dark oak **pew** (with hymnals and a
kneeler) facing the pulpit; a **blocked** church cell (use the Blocked brush) is the **pulpit**: a raised
dais with a red runner and front step, a carved octagonal pulpit with an open Bible, an altar with
candlesticks, and a tall wooden cross. The pulpit faces its congregation, and every pew in the same church
faces back along that line like a nave, so pews beside the pulpit still face the front.

### Old Clocktower

A **2×2** landmark: a late-1800s stone tower with a weathered clapboard clock stage, four backlit dials, an
open belfry and a steep spire. The brush paints a whole 2×2 block with the cell you click as its north-west
corner (Rectangle mode tiles towers 2×2 at a time). The ground under it is levelled like a building. Its
dials show **11:00 PM** while planning and the **game time** in the play demo; the minute hand sweeps
forward each turn. Model: `src/clocktower.js`.

### Start space

The **Start space** takes two cells. Paint it on the cell where the players' van parks: a used early-80s van
(two-tone cream and brown, orange stripe, rust, chrome bumpers, roof rack, spare tyre) that sits facing
along the road with its hazards blinking. **Players start on the road cell in front of the van**, marked by
a pulsing yellow painted box and amber glow, and lit by the headlights.

- The van faces the road automatically (toward a street or bridge, preferring one where the road carries
  on). Use the Start space brush on the van again to turn it to face the next way. Hover shows
  `van facing west` and the front cell shows `Player start`.
- The van's cell is blocked; the player start cell keeps its own surface (normally street).
- **The headlights are a real light source**: 35 % on the van's cell, 90 % on the player start cell and 50 %
  on the cell beyond (`HEADLIGHTS` in `src/state.js`). Walls block them, like any light.
- The headlights are warm sealed-beam / early-halogen white (about 3,200 K, as on 80s–90s cars), with soft
  beams in the air that fade out over about 13 m as well as the glow on the road.
- The play demo starts the pawn on the player start cell, and the headlights are its starting light (the
  panel and play bar show the light on the pawn's cell, `Light 90% (van headlights)`). Exported start cells carry `facing`, `faces` and
  `playerStart` (the start cell's label).

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

### Play demo

**Play demo** (`Y`) plays one character on the board you've built:

- **1–4 players** (choose in the Play panel; 4 by default) take turns. Each is a small stylised 90s figure at
  real scale (about 1.75 m): a colour-blocked windbreaker in their colour, stonewashed jeans and white
  sneakers, with different hair (P3 wears a backwards cap). Each stands in its own quarter of a cell, so all
  four fit on one tile, and turns to face the way it walks.
- Players **jog** from cell to cell at a human jogging pace (about 2.7 m/s, so roughly 2.6 s per 7 m
  cell), legs and arms swinging in step with the ground covered. **Press and hold anywhere on the board**
  (finger or mouse) to fast-forward a move (about 0.3 s per cell); let go to return to a jog.
- **Dice and movement.** Everyone starts with **2 black dice**, which renew every turn. A turn starts by
  rolling **all your black dice**; then a dice tray opens with your rolled dice and **2 movement slots**.
  Tap dice to put them in slots (tap again to take one out) and press **Move N**: you move the total of the
  slotted dice. Slots can be left empty (**Stay put** with none). If your cell is **lit (light 50 % or
  more) at the start of your turn, a 3rd slot opens** (`LIT_THRESHOLD`, `LIT_SLOTS` in `src/play.js`).
- **Black dice are shared:** when anyone attunes a Black Dice marker, every player rolls one more black die
  from then on (each marker works once).
- **White dice are personal and kept in reserve, unrolled.** Each player keeps the White Dice they collect.
  During slotting, tap a die in the tray's **Reserve** row to roll it. A rolled white die can only be used
  that turn: it's discarded when you move (or stay put), whether you slotted it or not.
- **Game clock.** The night starts at **11:00 PM**; each turn (every player moving once) is
  **5 minutes**, so 12 turns run to **midnight**. A small counter at the top of the screen shows the time
  and turn (`11:05 PM · Turn 2/12`). Constants: `GAME_START_MIN`, `TURN_MINUTES`, `TURNS_TO_MIDNIGHT` in
  `src/play.js`.
- **Objectives are hidden until midnight:** in the play demo, Objective markers don't show and can't be
  touched until the clock strikes twelve (which ones appear will depend on the monster, coming later).
- **Midnight turns menacing.** When the clock strikes twelve (play demo only), over a few seconds: every
  light source (players' flashlights included) flickers on its own uneasy rhythm, with its whole pool of light dipping together (lit cells,
  street surface, lamp globes, van headlights, lit windows, the porch light). Dips are slow and partial,
  never a strobe (at most ~1.4 dips a second per light). The clocktower's dials sputter and go out, the rain turns blood red, doubles and drives in on the wind, the
  firs sway, the cold blue night shifts to a muted red, and the night closes in a little (dimmer sky light, nearer fog). Code: `src/dread.js`.
- **Midnight demo.** The second play button starts the game at midnight: objectives out, the town already
  menacing. **Play demo** (or `Y`) starts the standard 11 PM game.
- **Investigating.** When a runner reaches an unused Investigation space, a prompt asks **Investigate?**
  (Yes / No; on a keyboard Enter or Y = yes, Escape or N = no). **No** runs on through the space and leaves
  it for later. **Yes** draws a random **Obol** from a shared bag for that player, shown in a short reveal and
  on the scoreboard.
- **Inventory.** Each player has their own inventory with two tabs, **Equipment** (empty for now) and
  **Obolcraft**, where every Obol they draw is kept, with where and when it was found. Open it with the bag
  button on the play bar (or `I`) for the current player, or tap a player in the scoreboard.
- **Obols** come in four kinds: **Attack** (bloody red), **Event** (misty blue), **Equipment** (shiny green)
  and **Evidence** (glowing yellow). The bag holds 7 of each (28) by default; when it's empty, investigating
  finds nothing.
- **Game settings** (the ⚙ button under the play buttons) adjust the mechanics: number of characters
  (1 to 4; 1 plays solo, and the clock moves on after each of your turns), starting black dice,
  movement slots, slots when starting in light, the light level that counts as lit, minutes per turn, turns
  until midnight, stopping on every marker, asking before investigating, and the number of each Obol. They're
  saved on this device (`DEFAULT_CONFIG` in `src/play.js`), and changing them restarts a game in progress.
- **Turns don't wait for running.** A move is worked out the moment the player gives their input. As soon
  as they've made their last choice (or none is needed), the turn passes and the camera pans to the next
  player while the last figure is still jogging into place. Several players can be running at once; marker
  bursts and fading happen when a runner actually reaches the marker. Holding the board fast-forwards
  everyone who is still running.
- **Unlocked doors look unlocked.** When a runner reaches a Key, every locked and one-way door in its
  building changes to an unlocked door: thrown wide open in pale green, with a bright green threshold and
  an open padlock on the jamb (and from then on they pass both ways). This only shows while playing;
  Restart locks them again.
- **Kit:** every figure carries a dim incandescent flashlight (a warm lens and a faint beam, swinging with
  the arm; it's for looks and doesn't change the lighting rules) and a backpack: P1 a navy 90s school pack,
  P2 a neon colour-block pack, P3 a canvas daypack with a rolled blanket, P4 an external-frame hiking pack
  with a bedroll.
- **Name tags** (P1–P4, in the player's colour) float over each figure and show through buildings so you
  can always find everyone; they stay readable when zoomed out (stacking when players share a cell) and
  fade to nearly transparent when you zoom in close. The current player's tag pulses and a ring in their
  colour marks them.
- After a move the turn passes to the next player. Dice counts are per player (scoreboard in the panel);
  markers are shared: a die or research collected by one player is gone for everyone, and a key unlocks its
  building's doors for everyone.
- The pawn starts on the **Start space** (paint one first).
- **Roll black die** (or `Enter`) rolls a d6; the pawn then moves one cell per pip with a little hop.
- It keeps going while there's only one way forward, and never doubles back unless it hits a dead end.
  At a fork, and at the start of every move, it stops and puts big round arrow buttons on the cells it can
  go to: tap or click one (a tap near one on the board works too), or use the **arrow keys** (relative to
  the camera).
- **Follow streets** (on by default): on a street, the start space or a bridge, the pawn only goes where the
  road goes (two ways on a straight street, three at a T, and so on), plus through any door beside it.
- **Phones:** a floating bar at the bottom holds the die, the status and a big **Roll** button, so the panel
  can stay folded away; starting the demo on a phone folds the panel and zooms in on the pawn.
- Movement follows the board rules: walkable cells only; walls, windows, locked doors and one-way doors
  (against their arrow) stop it; walking over a **Key** unlocks its building's locked and one-way doors for
  the rest of the game.
- **Touching a marker** (passing over it or landing on it) collects it straight away: the badge pops with a
  coloured flash and a label floats up with the marker's name (`White Dice`, `Black Dice`, `Research`,
  `Key`, `Investigation`, `Objective`). The pawn **stops on every marker** and asks
  which way to go next, even if there's only one way on. Each marker works once; the panel counts White Dice
  collected and Black Dice attuned.
- Collected markers turn into a smaller greyscale badge with a green check mark, and hover says
  `(collected)` / `(attuned)` / `(picked up)` / `(visited)` / `(used)`. This only shows while playing; the board itself is unchanged.
- **Follow** keeps the camera on the pawn; **Restart** puts it back on the Start space and brings faded markers back.

The demo never changes the board. Its logic is in `src/play.js`.

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

### Condemned buildings

**Condemned** (an Indoor subcategory, blocked by default) builds itself: paint any shape and walls go up
automatically round its outside edge. Edges that face a street, start space or bridge become the frontage:
**boarded-up windows**, with one **boarded-up door** in the middle of each straight run of frontage (so a
corner building gets one on each street). Sides that don't face a street are plain walls. The openings are
sheeted with weathered plywood and nailed across with planks, and the inside is full of rubble and junk.

- The walls follow the shape as you paint or erase, so you never draw them by hand. They aren't stored;
  they're rebuilt from the cells (`autoEdges` in `src/state.js`).
- Boarded doors and windows block movement and light, like walls.
- A wall, door or window you draw yourself on the same edge replaces the automatic piece (for example, a
  door to make one way in). The Erase tool can't remove automatic pieces; change the cells instead.
- Hover says `Boarded-up door (condemned)`; the info box counts boarded doors and windows; exported edges
  include the automatic ones with `"auto": true`.

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
- Walls are **full height (2.6 m)** by default. Tick **Low walls (cutaway view)** in the View menu to cut them
  down so you can see into rooms.
- Props never poke through walls: outdoors, next to a building, a wall or the clocktower, trees and other props
  stay inside their own cell on that side (big ones shrink to fit), and every upright prop (trees, headstones,
  posts, furniture) rises with the ground as one rigid piece, so on hills it can't stretch or lean into a
  levelled building next door.

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

## Elevation

**Elevation** in the View section picks a board-wide preset. All are mild; nothing changes how cells, walls,
light or movement work.

| Preset | Shape |
|--------|-------|
| Flat | Level ground (the default, exactly as before) |
| Gentle hillside | Rises about 4 % from the bottom row to the top (≈7 m over the default board), with soft left-to-right undulations |
| Rolling hills | Soft hills and dips across the whole board, up to about 3 m either way |
| Hill and hollow | A rounded rise toward the top right (≈5 m), a damp hollow toward the bottom left, a low ridge between |

Everything follows the ground: tiles, streets, water, walls, props, bridges, lamps, markers and the
surrounding forest. Each preset is one height formula in `TERRAIN_PRESETS` (`src/terrain.js`), written so
the same text runs on the GPU (lifting every vertex) and in JavaScript (picking cells under the pointer).
The preset is saved with the board, and exported cells carry their ground `elevation` in metres when the
board isn't flat.

Some cells level the ground instead of following it (each connected group is handled together):

- **Lakes** sit level at the height of their lowest cell, so the banks rise around them.
- **Rivers** are flattened and lowered to their lowest point, wherever they run.
- **Buildings** (connected indoor cells) are levelled at their average ground height. A stone foundation
  shows where the ground outside falls away, and a retaining wall where the building is dug into the slope.
- **Walls, doors and windows** always stand upright. On the edge of a building they stand on its level
  floor and reach straight down to the ground outside; a wall across open sloping ground steps down the
  slope in upright sections. (They're placed at their final height in `refreshPropsAndWalls`, not bent by
  the terrain shader.)
- **Bridges** keep the height of the road on their banks; their piers stretch down to the lowered riverbed.

These levels are per-cell overrides (`updateOverrides` in `src/terrain.js`) read by every shader through a
small texture, and they're what the exported `elevation` reports. On the Flat preset nothing changes.

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
npm test           # headless rules tests (plain Node: no browser, no three.js)
```

## Performance on phones

- **Render on demand.** The scene redraws at full rate only while something is happening (a finger or the
  camera moving, a runner jogging, dice tumbling, a marker burst, a monster stalking, midnight setting in).
  Otherwise it ticks over at an idle rate, so rain, water and flicker keep moving but the phone stays cool.
- **Quality** (View menu: Low / Medium / High, remembered per device). Sets render resolution, shadows, how
  many trees ring the town, how much rain falls, and the idle frame rate:

  | | Resolution | Shadows | Trees | Rain | Idle fps |
  |---|---|---|---|---|---|
  | Low | 1× | off | 35% | 35% | 12 |
  | Medium | up to 1.5× | 1024 | 65% | 60% | 20 |
  | High | up to 2× | 2048 | 100% | 100% | 30 |

  Phones start on Medium, computers on High. `QUALITY` in `src/main.js`.
- **FPS** (View menu) shows the real frame rate and whether it's in active or idle mode: handy when trying
  the game on a phone.

## View menu

The round **eye button** in the top-right corner opens a compact column of view controls (`V` toggles it):
**Layer** (All / Area / Light / Move), **Camera** (Angled / Top / Orbit mode) and **Show** toggles (Labels,
Atmosphere, Low walls, Markers, FPS) and **Quality** (Low / Medium / High). The button shows the current layer even when the menu is closed. Buttons
are at least 40 px tall for fingers. The menu starts open on wide screens and closed on phones, and
remembers how you left it.

**Tap or click off an open window to minimise it**: with the side panel or the view menu open, a press
anywhere outside it closes it. If that press lands on the board it only closes the window; it doesn't paint,
draw a wall or move the camera. On phones the side panel stops short of the view button, so its minimise
button is always reachable. Elevation presets stay in the side panel (they're saved with the board).

## Controls

| Action | Input |
|--------|-------|
| Paint with the current brush | Left-drag |
| Paint a rectangle | Shift + left-drag, or the **Rectangle** toggle (`R`) |
| Choose a brush | `1` Ground · `2` Hardwood · `7` Lake · `8` River · `9` Bridge · `3` No light · `4` Light source · `L` Lit lamp · `5` Walkable · `6` Blocked · `0` Reset (other subcategories: click) |
| Play demo | `Y`, then `Enter` to roll, click or arrow keys to choose at forks |
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

## Game architecture (rules, view, sessions)

The game is split so the same rules can run on one phone today and on a server for multiplayer later:

- **Rules** (`src/game/rules.js`, `src/game/monsters.js`): the whole game as **plain JSON state** and pure
  functions. `newGame(board, setup)` makes a game; `applyAction(state, board, action)` applies one action
  (`roll`, `slot`, `rollWhite`, `move`, `choose`, `investigate`) and returns `events` (step, collect, obol,
  rolled, turn, midnight, monsterSpawn, monsterStep, monsterAttack). No three.js, no DOM, no timers.
  **All randomness** (dice, Obol draws, monster choices) comes from a seeded generator kept *in the state*,
  so whoever applies the actions decides every roll, and replaying the same actions from the same seed gives
  the same game. Actions carry a `seat`; one for a seat that isn't the current player is rejected.
- **Board** (`src/game/board.js`): the rules read the map through `createBoard(grid)` (light levels, key
  groups, start cell, cached until the board changes). `boardFromJSON(saved)` rebuilds it from a saved board,
  e.g. on a server.
- **Sessions** (`src/game/session.js`): the only thing the view talks to. `createLocalSession` is today's
  hot-seat game on one device. `createHost` / `createClient` are the multiplayer shape (below).
- **View** (`src/play.js`): figures, animation, camera, name tags, the dice tumble, monster figures. It sends
  actions to the session and animates the events that come back; it never changes the game itself.
- **Tests** (`tests/rules.test.js`, `npm test`): whole games played headless by a bot, determinism, JSON
  round-trips, rejected moves, Obols, midnight, monsters stalking and attacking, the board travelling as
  JSON, and a host with two phones staying in sync with seats enforced.

### The mystery (evidence, Casebook, Field Guide)

Each game secretly draws one monster from the chosen **monster pool** (Game settings → Monster: Mystery,
pools: all, flesh and blood, spirits and shadows, old-world folklore). Its 13 cards live in
`src/game/cards/monsters.js` (transcribed from the physical cards), the evidence names and board looks in
`src/game/cards/evidence.js`, and the rules in `src/game/mystery.js`.

- **Evidence Obol:** the investigator chooses one of the remaining face-down Evidence cards (3 Observations +
  1 Lair). It flips for everyone, and the cell they're standing on changes to show it (frost, claw marks,
  blood, howl rings...). A **Lair** transforms its cell for good: an opened grave, a cave mouth, a scorched
  transformation site, a ritual circle, a ruin, a wrecked room, a pit of darkness, each with its own glow
  (`src/discoveries.js`).
- **Attack Obol:** the monster strikes for one die of damage of its type; the first time, its **Attack card**
  (Physical / Mental / Spiritual) is revealed. Damage is tallied per type until injuries arrive.
- **Casebook** (book button on the play bar, or `C`): the five evidence slots, who found each and where (tap
  to fly there), and how many monsters still fit.
- **Field Guide**: every monster in the pool, narrowed automatically by the evidence (ruled-out entries fold
  away), with health, toughness, weaknesses, immunities, objective and abilities. The team may **name the
  monster once before midnight**; a correct name earns **Initiative**: its spawn point is marked ☠ on the map
  and the objective markers show early.
- **Midnight**: the monster is revealed (its full entry) and rises from its **Lair**: where the Lair card was
  found, or, if it's still hidden, a random undiscovered Investigation spot becomes the Lair (its card turns over
  and the cell transforms) and it rises there. With Initiative, that spot is the one marked ☠. Monsters only
  walk on walkable cells unless their own rules say otherwise. Until each monster's
  own abilities are written it hunts like the test stalker.
- **Secrets stay secret**: the monster, the face-down cards, the spawn point and the dice generator are
  stripped by `publicState()` before anything reaches the screen or another phone.

### Defense, injuries and the monster's turn

From the Player Mat and Monster Ref Sheet (`Monsters_and_Injuries` spreadsheet):

- **Slotting through the turn.** The dice tray has a **Slot to Move / Slot to Defense** switch. Defense has 1
  slot, +1 when the turn starts in light. Slot dice whenever the tray is open: move, come back, slot more dice
  or change your defense, move again, then **End turn**. Dice used to move are spent; defense counts the moment
  it's slotted and stays up until your next turn (so it covers Attack Obols mid-turn and the monster's action).
  Ending a turn with rolled dice unused asks first. A turn ends by itself once every rolled die is used.
- **Ranges** count diagonals: **Close** = adjacent cells, **Mid** = up to 2 cells, **Long** = 3 or more. A
  monster's melee Attack reaches Close range.
- **Damage.** An attack's damage is compared with the total of the slotted defense dice: at least the damage is
  **blocked**; less gives **one tier** on that attack's track (Physical, Mental, Spiritual).
- **Injuries** (tiers add up; tracks are separate; scoreboard pips and an Injuries tab in the inventory):
  Physical: Sprained (one black die disabled, shown crossed out in the tray), Hobbled (−1 movement slot). Mental: Paranoid (−1 defense slot),
  Terrified (teammates within Mid range lose a defense slot). Spiritual: Doomed (defense 6s count as
  1), Hexed (shown; applies once items exist). Tier 3 on any track is **Death's Door**: one die per turn, and any
  unblocked damage **kills**. Dead players leave the board and are skipped; if everyone dies the night wins.
- **The monster's turn.** At the start of each round the monster rolls its **action dice** (the number in the
  top right of its card: Hellhounds 4, Werewolf 3, Shadow People 0...); each die picks an ability, and they
  play **in order** at the end of the round. The banner lists them compactly (tap for the card text and to look
  at the monster) and players in danger get a pulsing red ring
  and an "In danger" tag. The danger updates live as players move. At the end of the round the monster moves
  and rolls its damage. Pursue, Outflank, Retreat, Teleport, Attack, Area Attack, Global Attack and Heal are
  played from the card text (`src/game/monsterTurn.js`); other effects (Seize, Lure, Pin, Drag, Trap, Exhaust,
  Block doors...) are named in the log and come with each monster's own rules.

### Monster figures

Every card monster has its own low-poly figure (`src/monsterModels.js`), to scale with the players, with idle
motion: a hunched Werewolf; a smoky black Barghest dragging a chain; a loose pack of fiery Hellhounds, one per
action die; a pelt-draped Skinwalker in an animal skull; a 3 m Wendigo with antlers and ribs; a floating, wailing
Banshee; the ox-headed, spider-legged Ushi-Oni; a knee-high Redcap with its red cap, iron boots and pikestaff;
the Poltergeist as furniture and crockery whirling in a cold haze; the glowing, veiled White Lady; a hunched,
bald Strigoi in a burial shroud; the Adze as a firefly swarm that gathers into a shape; and Shadow People as
three flickering silhouettes.

### Adding a monster

Add an entry to `MONSTERS` in `src/game/monsters.js`:

- `label`, `note`: shown in Game settings (Monster at midnight).
- `speed`: cells per monster turn.
- `spawn(ctx)`: the cell where it appears at midnight.
- `act(ctx, monster)`: its turn, returning `{ path: [cells...], attack: seat | null, say?: text }`. The rules
  check every step against the board's walls and doors and stop at the first illegal one, and only allow an
  attack on a player in or next to its cell.
- `onAttack(ctx, monster, player)` (optional): what an attack does. Without it an attack is logged and
  animated.
- `look`: which 3D figure to use (`monsterLooks` in `src/play.js`; `shade` is the stooped figure with ember
  eyes).

Helpers for AI: `reach` (walking distances and paths over the real movement rules), `nearestPlayer`,
`playersInReach`, `lightAt`, `farthestFromPlayers`. Use `ctx.random()` for any randomness so a server makes
the same choices. Monsters act once at the end of every turn from midnight on. The **Test stalker** shows the
pattern: it appears as far from the players as it can, hunts the nearest one through the dark, won't step
into a well-lit cell, and lunges (with a soft red flash at the screen edges) when it reaches them. It is on by
default (Game settings → Monster at midnight → None turns it off). When it appears, a message says where and
the camera glides over to look at it (and again whenever it moves), then back to the players; its ember eyes
and a faint red glow on the ground make it easy to spot, and it is listed in the scoreboard. Changing Game settings outside a game makes the next game start fresh.

### Multiplayer (planned: a hosted realtime service)

Exactly one **host** owns the state and applies every action; phones are **clients** that send actions and
mirror the host. The host can be a small server or a cloud function next to the realtime service (or one
player's device). They talk through a **transport** with two methods (`send(message)`,
`onMessage(handler)`), so any realtime service fits behind it (Firebase, Supabase Realtime, PartyKit,
Cloudflare Durable Objects...). Messages are plain JSON:

- client → host: `join`, `claim` (a seat), `action`
- host → clients: `update` (`seq`, the whole state, the events, who holds which seat), `reject`

Every update carries the whole state (it's small), so a phone that drops off (iPhones pause pages when
locked) catches up from the next update or by sending `join`. To switch the app over: build a transport on
the chosen service, run `createHost` with `boardFromJSON(savedBoard)` where the rules should live, and give
`play.js` a `createClient` session instead of the local one; the view needs no other changes. `loopback()`
is an in-memory transport used by the tests and is a template for a real one.

## Code layout

- `src/state.js` — grid data model, strokes, undo/redo, JSON (de)serialization. No rendering.
- `src/game/` — the game rules, board adapter, monsters and sessions (see above). No rendering.
- `src/main.js` — three.js scene, tile rendering, bridges, painting, UI wiring, quality and render loop.
- `src/water.js` — water surface shader (flow-mapped river currents, still lakes).
- `src/props.js` — walkable/blocked props for every surface (`VARIANTS`).
- `src/play.js` — the play demo's view: figures, animation, camera, monster looks.
- `src/clocktower.js` — the Old Clocktower model and its hands.
- `src/dread.js` — midnight flicker and tree sway.
- `src/markers.js` — gameplay marker badges and icons.
- `src/bridge.js` — steel truss bridge structures built from connected bridge cells.
- `src/street.js` — street surfaces: lane lines, crosswalks, sidewalks, chosen from neighbouring cells.
- `src/terrain.js` — elevation presets (one height formula each, shared by GPU and picking).
- `src/scale.js` — metres per cell and the street cross-section.
- `src/style.css` — panel styling.

Tiles are a single `InstancedMesh`; each cell's look comes from `cellLook()` in `main.js`. That's the place
to swap flat colours for textures (road, hardwood, etc.) later. GLTF buildings and props (cars, streetlights)
can be added to the scene with three's `GLTFLoader` and positioned with `cellToWorld(x, y)`.
Bridge assets belong with the decks in `refreshWaterAndBridges()`: for each bridge cell, `grid.bridgeAxis(x, y)`
gives the span direction, the deck top is at `DECK_TOP`, and the water surface and bed are at `WATER_Y` and
`BED_H`, which is where pylons would stand.
