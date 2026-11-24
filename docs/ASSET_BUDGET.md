# Asset budget

What a 3D asset (a tile's props, a premade building, a character) may cost, so maps of any size stay
playable on phones. The limits come from measurements, not guesses: re-measure and update this file when
the renderer or the reference phone changes.

**Reference device:** Google Pixel 10a, in the Claude app (Android WebView, Chrome 157), screen 411 × 741 at
1.5×, quality **Medium**, midnight effects on.
**Target:** 30 fps or better in the slowest 10% of frames, with **1.5× headroom** (frames take at most
~22 ms), measured with automatic resolution off. The headroom covers weaker phones, heat over a long game, and
what a real game adds (figures, dice, markers, panels). Automatic resolution is the safety net, not part of
the budget.

## How the renderer spends its time (why the budget looks like this)

- **Culling chunks.** Heavy props are drawn in batches of 6 × 6 spaces; batches off screen aren't drawn. So
  what costs is what is **in view**, not the whole map.
- **No far versions yet.** Zoomed out, the whole board is in view. Until assets have simpler far versions
  (planned, see below), a big map seen whole is the worst case.
- **Shadows on demand.** The shadow map is redrawn only while something moves (figures, dice, tiles easing)
  or every 250 ms, never for camera moves. During a move it's redrawn every frame, so its cost still counts.
- **Shadow window.** Shadows cover only the ground in view plus a margin, so a shadow redraw costs about as
  much as the view (a bit more), not the whole board.
- **Automatic resolution** lowers the pixel count when frames are slow. It helps with pixel-heavy work
  (transparency, overdraw) but not with triangles or draw calls: those are what this budget limits.

## Measurements (Pixel 10a, Medium, midnight)

| Board | View | fps (slowest 10%) | Triangles in view | Draw calls | Shadow redraw | Headroom |
|---|---|---|---|---|---|---|
| Hawthorn Bend 26 × 20 | whole board | 60 (58) | 418k | 642 | +347k | ≥ 1.9× |
| Hawthorn Bend 26 × 20 | close-up | 60 (58) | 234k | 162 | +372k | ≥ 1.9× |
| Forest (blocked) 60 × 60 | whole board | 24 (19) | 3,379k | 450 | +3,181k | 0.6× |
| Forest (blocked) 60 × 60 | close-up | 60 (58) | 853k | 41 | +3,438k* | ≥ 1.9× |

\* Before the shadow window. The same view's shadow redraw is now about 1.0M triangles (counted in the
browser; re-measure on the phone).

What follows from it:

- **About 12 ns per triangle** (3.4M triangles at ~42 ms a frame): ~80M triangles a second. 33 ms holds
  ~2.7M triangles; with 1.5× headroom, **~1.5M triangles a frame** in view.
- **Draw calls are cheap on this phone**: 642 held 60 fps. Keep under ~650 until a test shows more is fine.
- **Frame rate stops at 60** (the screen), so at 60 fps the stress test reports headroom as "at least".
  Its synced "frame cost" (waiting for the GPU each frame) errs high on this phone: it said 36 ms for a board
  running at 58 fps. Use it only as a worst case.
- **A close-up takes in ~900–1,000 spaces** (the chunks along its edges, and towards the horizon), not the
  ~200 a glance suggests.

## The budget

### Per frame (in view, on the reference phone)

| | Limit |
|---|---|
| Triangles in view | ≤ 1.5M |
| Triangles in a shadow redraw | ≤ 1M |
| Draw calls | ≤ 650 |

Fixed costs already in every view: the forest ring and ground (~150k triangles), walls, streets and
landmarks on a town map like Hawthorn Bend (~100k).

### Per asset

| Asset | Near version | Far version (when LOD exists) | Shadow-casting part |
|---|---|---|---|
| Tile you can paint anywhere | ≤ 1,500 triangles per space | ≤ 300 per space | ≤ half its triangles |
| Premade building | ≤ 2,000 per space of footprint | ≤ 300 per space of footprint | ≤ half |
| Investigator | ≤ 2,500, one material | – | a ~500-triangle stand-in or the body only |
| Monster | ≤ 6,000, ≤ ~30 bones, one material | – | a ~500-triangle stand-in or the body only |

Why these numbers: a close-up sees up to ~1,000 spaces, and ~1.5M triangles minus ~250k of fixed costs over
1,000 spaces is ~1,250 a space if the same asset filled the view; real maps mix heavy and light tiles, so 1,500
leaves room. A far version at 300 a space keeps a 60 × 60 board (3,600 spaces) at ~1.1M seen whole. Figures
move, so their shadows are redrawn every frame while they do: keep the shadow-casting part small.

For comparison (measured in the browser, per space): a blocked hospital ward bay 1,384 (just inside); a
blocked forest space 872 (nine firs at 88 plus a shrub); a blocked cemetery 452; a cluttered living room
(blocked carpet) 168; a church pew 120; a walkable hospital floor 69 on average (most are empty).

### Per map (until far versions exist)

The whole map's props should total **≤ 1.5M triangles**, so the worst case (the whole board in view)
still fits. Hawthorn Bend is at ~0.6M. *(Planned: the Ready to play? check adds this up and warns.)*

## Rules for every asset

1. **One mesh, one material, colours in the vertices** (or one shared palette texture). This is what lets an
   asset join the batched, chunked drawing. An asset in many pieces is drawn piece by piece, once per copy,
   and undoes the chunking.
2. **At most one extra material**, and only for things that glow.
3. **No transparency** except glows and light beams. Glass is a dark solid colour.
4. **Delete hidden faces**: undersides, backs against walls, the insides of overlapping parts.
5. **No coplanar faces**: keep surfaces at least 1 cm apart (the diner trim and bridge girders flickered).
6. **Small details don't cast shadows**: handles, cables, IV lines, hymnals.
7. **Real-world metres** (1 space = 7 m), origin at the base centre, front facing +X, all modifiers applied.
8. **Compressed .glb, ≤ ~150 KB**, so the page stays quick to load.
9. **Flat, low-poly look**: no subdivision; bevels only where they show.

Simple props (crates, boxes) can stay as code-built geometry in `src/render/props.js`: cheaper to adjust.

## Checking an asset

1. **In Blender**: report the near and far triangle counts, materials, the shadow-casting share and the file
   size. Over budget: simplify before exporting.
2. **In the game**: editor → File → **Stress test** → the asset, **60 × 60**, Medium, midnight on. Run it on the
   reference phone and **Copy results**.
3. **Pass**: the close-up keeps **≥ 1.5× headroom** in the slowest 10% of frames. Once far versions exist, the
   whole board must too.
4. **Log it** below, with the date.

## Asset log

| Date | Asset | Near / far triangles | Close-up headroom | Whole board headroom | Notes |
|---|---|---|---|---|---|
| 2026-11-24 | Forest (blocked), code-built | ~870 per space / – | ≥ 1.9× | 0.6× (24 fps) | the heaviest tile today; whole board needs LOD |
| 2026-11-24 | Hawthorn Bend (map) | ~0.6M total | ≥ 1.9× | ≥ 1.9× | reference map |

## Still to build

- **Far versions (LOD)**: swap each asset for its far version when its chunk is far from the camera or the
  view is zoomed out. Needed before big maps can be seen whole at 30 fps.
- **Map budget check** in Ready to play?: add up the map's triangles; warn over 1.5M.
- **Re-measure** the shadow redraw on the phone now the shadow window is in.
