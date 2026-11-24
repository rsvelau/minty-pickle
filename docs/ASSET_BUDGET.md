# Asset budget

What a 3D asset (a tile's props, a premade building, a character) may cost, so every map stays playable on
phones. The limits come from measurements, not guesses: re-measure and update this file when the renderer,
the map size limit or the reference phone changes.

**Reference device:** Google Pixel 10a, in the Claude app (Android WebView, Chrome 157), screen 411 × 741 at
1.5×, quality **Medium**, midnight effects on.
**Target:** 30 fps or better in the slowest 10% of frames, with **1.5× headroom** (frames take at most
~22 ms), measured with automatic resolution off. The headroom covers weaker phones, heat over a long game, and
what a real game adds (figures, dice, markers, panels). Automatic resolution is the safety net, not part of
the budget.
**Largest map: 35 × 35** (1,225 spaces). The editor stops there; maps saved bigger (up to 60) still open, and
Ready to play? flags them. Capping the size is what lets the whole board be in view without far versions.

## How the renderer spends its time (why the budget looks like this)

- **The whole board can be in view.** Zoomed out, everything is drawn. With maps capped at 35 × 35 that worst
  case fits the frame budget, so the budget is set **per map** (what the whole board draws) and per asset
  (what one tile may cost where it's used).
- **Culling chunks.** Heavy props are drawn in batches of 6 × 6 spaces; batches off screen aren't drawn, so a
  close-up costs a fraction of the whole board.
- **Shadows on demand.** The shadow map is redrawn only while something moves (figures, dice, tiles easing),
  up to 4 a second while a building's shadow-casting part moves near the view (a swing, a merry-go-round),
  and otherwise only every 2 s as a safety net; never for camera moves. During a move it's redrawn every
  frame, so its cost counts then.
- **Shadow window.** Shadows cover only the ground in view plus a margin, so a shadow redraw costs about what
  the view does; zoomed out, that's the whole board.
- **Automatic resolution** lowers the pixel count when frames are slow. It helps with pixel-heavy work
  (transparency, overdraw), not with triangles or draw calls: those are what this budget limits.

## Measurements (Pixel 10a, Medium, midnight)

| Board | View | fps (slowest 10%) | Triangles in view | Draw calls | Shadow redraw | Headroom |
|---|---|---|---|---|---|---|
| Hawthorn Bend 26 × 20 | whole board | 60 (58) | 418k | 642 | +347k | ≥ 1.9× |
| Hawthorn Bend 26 × 20 | close-up | 60 (58) | 234k | 162 | +372k | ≥ 1.9× |
| Forest (blocked) 60 × 60 | whole board | 24 (19) | 3,379k | 450 | +3,181k | 0.6× |
| Forest (blocked) 60 × 60 | close-up | 60 (58) | 853k | 41 | +3,438k* | ≥ 1.9× |
| Forest (blocked) 35 × 35 | whole board | 55 (43) | 1,281k | 233 | +1,180k | 1.4× |
| Forest (blocked) 35 × 35 | close-up | 60 (59) | 682k | 41 | +904k | ≥ 2.0× |

\* Before the shadow window: the same view's shadow redraw is now about 1.0M triangles (counted in the
browser; the 35 × 35 close-up's +904k on the phone confirms it). The 60 × 60 rows predate the size cap;
they're kept because they found the ceiling.

**The 35 × 35 forest whole board** averages 55 fps (~18 ms, ~1.8×) but its slowest 10% is 43 fps (1.4×): the
slow frames were the shadow safety refresh (every 250 ms, +1.18M triangles), which ran even when nothing on
screen moved. It now runs every 2 s, or 4 a second only near a moving swing or merry-go-round, which should
bring this board to ~1.8×. **To measure:** this board again.

What follows from it:

- **About 12 ns per triangle** (3.4M triangles at ~42 ms a frame): ~80M triangles a second. 33 ms holds
  ~2.7M triangles; with 1.5× headroom, **~1.5M triangles a frame** in view.
- **Draw calls are cheap on this phone**: 642 held 60 fps. Keep under ~650 until a test shows more is fine.
- **Frame rate stops at 60** (the screen), so at 60 fps the stress test reports headroom as "at least".
  Its synced "frame cost" (waiting for the GPU each frame) errs high on this phone: it said 36 ms for a board
  running at 58 fps. Use it only as a worst case.
- **Fixed costs**: the forest ring round the town, ~250k triangles at Medium, less where the fog hides it.

## The budget

### Per frame (on the reference phone)

| | Limit |
|---|---|
| Triangles in view | ≤ 1.5M |
| Triangles in a shadow redraw | ≤ 1.25M |
| Draw calls | ≤ 650 |

### Per map: what the board draws, seen whole

**≤ 1.25M triangles**: everything on the board (tiles, ground, walls, streets, props, buildings), not the
forest ring. 1.25M plus the ring is the 1.5M frame budget. **Ready to play?** in the editor shows the board's
count against it and warns when a map goes over.

| Map | Board triangles |
|---|---|
| Hawthorn Bend (26 × 20) | 0.24M |
| Blocked forest, all 35 × 35 | 1.22M (just inside) |
| Hospital ward bays, all 35 × 35 | 1.84M (over: fine in a building, not a whole map) |

So a full-size map averages up to **~1,000 triangles a space**, and a map can mix a few heavy showpieces with
lighter ground. Zoomed out while something moves, the shadow redraw covers the whole board too: that frame
can dip to around 30 fps for the moment it lasts. Far versions would fix that if it ever matters.

### Per asset

| Asset | Limit | Shadow-casting part |
|---|---|---|
| Tile you can paint anywhere | ≤ 2,000 triangles per space | ≤ half its triangles |
| Premade building | ≤ 2,500 per space of footprint | ≤ half |
| Investigator | ≤ 2,500, one material | a ~500-triangle stand-in, or the body only |
| Monster | ≤ 6,000, ≤ ~30 bones, one material | a ~500-triangle stand-in, or the body only |

Why these numbers: 2,000 a space is what one tile filling a close-up can cost (a close-up takes in a few
hundred to ~1,000 spaces), and maps mix heavy and light tiles, so the per-map limit is what really binds.
Buildings come few to a map, so they may be denser. Figures move, so their shadows are redrawn every frame
while they do: keep the shadow-casting part small.

For comparison (measured in the browser, per space): a blocked hospital ward bay 1,384; a blocked forest
space 872 (nine firs at 88 plus a shrub); a blocked cemetery 452; a cluttered living room (blocked carpet)
168; a church pew 120; a walkable hospital floor 69 on average (most are empty).

## Rules for every asset

1. **One mesh, one material, colours in the vertices** (or one shared palette texture). This is what lets an
   asset join the batched, chunked drawing. An asset in many pieces is drawn piece by piece, once per copy,
   and undoes the chunking.
2. **At most one extra material**, and only for things that glow.
3. **No transparency** except glows and light beams. Glass is a dark solid colour.
4. **Delete hidden faces**: undersides, backs against walls, the insides of overlapping parts.
5. **No coplanar faces**: keep surfaces at least 1 cm apart (the diner trim and bridge girders flickered).
6. **Small details don't cast shadows**: handles, cables, IV lines, hymnals. **Moving parts that cast
   shadows** (a swing, a fan) cost a shadow redraw up to 4 times a second while they're near the view: use
   them sparingly, or let them not cast.
7. **Real-world metres** (1 space = 7 m), origin at the base centre, front facing +X, all modifiers applied.
8. **Compressed .glb, ≤ ~150 KB**, so the page stays quick to load.
9. **Flat, low-poly look**: no subdivision; bevels only where they show.

Simple props (crates, boxes) can stay as code-built geometry in `src/render/props.js`: cheaper to adjust.

## Checking an asset

1. **In Blender**: report the triangle count, materials, the shadow-casting share and the file size. Over
   budget: simplify before exporting.
2. **In the game**: editor → File → **Stress test** → the asset, **35 × 35**, Medium, midnight on. Run it on the
   reference phone and **Copy results**.
3. **Pass**: the close-up keeps **≥ 1.5× headroom** in the slowest 10% of frames. The whole board should too if
   the asset is one a map could be covered in (ground, forest, floors); a building only has to fit its map.
4. **Log it** below, with the date.

## Asset log

| Date | Asset | Triangles | Close-up headroom | Whole board headroom | Notes |
|---|---|---|---|---|---|
| 2026-11-24 | Forest (blocked), code-built | 872 per space | ≥ 2.0× (35 × 35) | 1.4× (35 × 35) | slowest frames are shadow safety refreshes |
| 2026-11-24 | Hawthorn Bend (map) | 0.24M on the board | ≥ 1.9× | ≥ 1.9× | reference map |

## Later, if needed

- **Far versions (LOD)**: simpler stand-ins for far chunks. No longer needed to fit the budget at 35 × 35;
  worth it if models get richer, or to keep the zoomed-out view smooth while things move.
