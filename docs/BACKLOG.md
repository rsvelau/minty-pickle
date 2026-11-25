# Backlog: effects the game doesn't play yet

Everything here is **in the game as data** (shown, logged, paid for) but its **effect does not happen**.
Grouped by the mechanic each needs, so they can be built one mechanic at a time, with the designer
confirming the rules for each group before it's built. Keep this file up to date: tick items off and
delete them when they work.

Current state (2026-11-22): rules version 5, 95 tests. Equipment, Events (most), Mindsets (most),
monster weaknesses/immunities/health, objectives (Kill automatic, others marked by hand) all work.

---

## ~~1. Doors (equipment)~~ — done (2026-11-24)
Breach, Nail Shut and Lock are played (`src/game/doors.js`): Breach makes an open doorway for good, for
everyone; Nail Shut and Lock both block a door for everyone, monsters too, until breached, and the spike or
chain is lost. Event-blocked doors (Nailed Shut, Roof Collapse) now stop monsters and are drawn boarded over.
Still not drawn: Lockdown's locked doors (they work, but look as before).

## ~~2. Holding the monster back (equipment)~~ — done (2026-11-24)
Salt Circle, Distract, Camouflage and Brace are played; each lasts through the monster's next turn. Salt
stops every monster (ghosts too) entering or crossing the space; Distract picks a space within Mid range (2)
on the board; Camouflage hides you from pursuit and Close attacks (not Area/Global) and stops your
movement; Brace is recorded (`bracedRound`) for when monsters can move players (group 7).

## ~~3. Spiritual damage tricks (equipment)~~ — done (2026-11-24)
Weeping Barrier (one Spiritual tier healed per hit), Wrathful Penance (reflected at the nearest monster as
Holy, through toughness, a weakness hit where Holy is one) and Spiritual Backlash (onto a chosen monster,
untyped through toughness, or a teammate, their defense applies) are played, through the monster's next
turn, on the whole hit before defense (`turnAside` in `src/game/combat.js`).

## ~~4. Dice and injury tricks (equipment)~~ — done (2026-11-24)
Lucky (set any of your dice this turn, from a picker in the dice tray), Rally (one die: you and teammates
within Mid get +4 Mental defense through the monster's next turn), Toss (injury effects held off until the
next injury; covers Death's Door, but a hit that gets through still kills), Drink (movement doubled and
Physical injuries ignored for the rest of the turn), Sacrifice (when someone would die, the game waits for
the Fetish's carrier to spend it, or not) and Lunge (always on: Close damage skills reach Mid) are played.
Toss and Drink used mid-turn give back the slots and dice the injuries took (a lost die is rolled at once).

## 5. Travel (events)  ·  needs picking spots on the map and new ways to move
- [ ] **Hidden Passage** — A hole opens in the floor here, and another at a chosen spot on the map. For the rest of the game, travelling through costs 5 movement (not possible with less).
- [ ] **Peculiar Mirror** — A blue-glowing mirror appears. Link two spots: travelling between them costs no movement (other effects may still apply). Flip 🪙: if tails, lose it.
- [ ] **Decrepit Truck** — An old truck appears on the road space nearest this player. Walk to it to start it and drive up to 25 spaces (road and bridge spaces only). A monster driven into takes 🎲🎲🎲 (added) damage, and the drive stops. 1️⃣
- [ ] **Hiding Spot** — Can remain immobile and become immune from all interactions for up to ⏳⏳. Cannot assist teammates.
- Needs: 3D props (holes, mirror, truck); a "travel" option at forks; driving along roads.
- Questions: Hidden Passage: who chooses the far end, and how far away can it be? Mirror: "lose it":
  the mirror disappears, or you lose something else? Truck: can other players ride along? Is it
  reusable (1️⃣ says once)?

## ~~6. Mindset~~ — done (2026-11-24)
Curious: after an Event drawn while investigating is resolved, the player is asked to keep investigating
(only with a die in Defense and Obols in the bag); yes spends the lowest Defense die and draws another Obol
at the same spot.

## 7. Monster abilities not played yet (logged as "not played yet")
Keywords in the monster cards' abilities the monster turn doesn't do yet. Each monster's rules
need going through with the designer.
- [x] **Pin** (an attack; if it injures, no moving next turn)
- [ ] **Seize / Drop / Carry** (Ushi-Oni: Abduct... Seize player; "Seized players are at Death's Door.
  Carried to Lair = killed"; weakness: "drop player")
- [ ] **Drag** (Skinwalker: Bear Maul, Drag (die, 5M into nearest building))
- [ ] **Lure** (Wendigo: "Lure causes players to move towards Wendigo")
- [ ] **Consume** (Wendigo: Feed, Consume (die); "Consume heals equal to damage")
- [ ] **Trap** (Barghest: Shadow Trap: Teleport (nearest lightsource) and Trap (🎲🎲))
- [ ] **Trample** (Ushi-Oni: Run Down, Trample (die, 5))
- [x] **Block / Unblock (All Doors)** (White Lady: Infatuation, Regret)
- [x] **Target** (White Lady: Wrath; Poltergeist: Heave)
- [ ] **LoS Attack** (Barghest: Death Gaze, line of sight)
- [ ] **Ritual** (Skinwalker: Curseblood Ritual, Teleport to Lair, +1 ritual; at 3 rituals: Global Attack (10))
- [ ] Persistent rules on cards: Banshee Perch (rooftops), Shadow People Suffocating Darkness
  (candle, coin flip), Redcap "piercing attacks can't land the killing blow", Strigoi "only damaged
  by the Blessed Cosor", Poltergeist "discard salt items inside targeted buildings"...

## 8. Weakness-track effects only announced — mostly done (2026-11-24)
- [x] Skinwalker 1: **Reset Curseblood Ritual** (with the ritual counter: the 3rd ritual sets off its
  Global Attack (10), then the count starts over)
- [ ] Banshee 1 and 3: **Grounded until next Perch** (waits for Perch, see 7: on hold until the objective
  marker rework, which decides what the "heirloom" is)
- [x] White Lady 1, 3, 6: **Trigger Regret** (Regret strikes at once: Area Attack on every player inside
  her building; its Unblock waits for Infatuation's Block, see 7)

## 9. Discard weaknesses (∞) — mostly done (2026-11-24)
- [x] Banshee: **Discard Silver to avoid Swoop damage** (offered when a Swoop hurts you; Swoop now lands
  beside the nearest player)
- [x] Strigoi: **Discard Holy to prevent Exhaust** (offered when an Exhaust takes a die)
- [x] Shadow People: **Discard Fire & avoid 1 attack** (offered when an attack hurts you),
  **Discard Crystal & no light for ⌛** (lit spaces safe from Umbral Stab until your next turn)
- [ ] Shadow People: **Discard Fire & keep candle lit** (waits for the candle: the objective rework)
- Played at the moment (`src/game/reactions.js`): the hit happens, then the game waits for the player;
  discarding undoes it. Known gap: an Exhaust undone after the same action's Attack doesn't change that
  Attack (Drain).

## 10. Objectives other than "Kill"  ·  in progress (the objective system)
Three layers: **sites** (what an Objective marker stands for, `src/core/sites.js`), **verbs** (collect,
deliver, cleanse, escape, defend, destroy, perform: shared handlers, next) and **monster scripts** (steps
over sites, `src/game/objectives/scripts.js`).
- [x] Step 1 (2026-11-25): site types on Objective markers (picked in Markers → Objective, or from a Church /
  Hospital floor), fixtures per site type, the map check and the Markers panel name the monsters a map can't
  host (they're never drawn there), only the revealed monster's sites appear and stop the pawn, the Adze's
  victims lie at the Hotel {1}, Bar {5} and Hospital {13}, the Casebook lists the steps and where they are.
- [x] Step 2 (2026-11-25): the verbs (collect, deliver, cleanse, escape) and carried items; Shadow People
  (candles, Suffocating Darkness, the Fire discard) and Barghest (cleanse, the river, escape) are played;
  all five pieces of evidence identify the monster early.
- [x] Step 3 (2026-11-25): Hellhounds (holy water stops the respawn), Poltergeist (anchors: a 6 at 4
  markers, then the Lair), Strigoi (Cosor: Lair → sharpen at the Outdoor Store {12} → bless at the Church;
  Close strike, one die ignoring toughness, once a turn; it hunts the holder; Drop), White Lady (gown, ring,
  finger bone to the Church, then hold it 3 rounds), with Pin, Target, Demonic Fire, Torment, Infatuation,
  Block / Unblock and Drop from group 7. The Adze already plays its objective (kill the nest, defend the
  victims). Left: Banshee Perch (what is the heirloom?).
- Sites named: Boutique {3} (the gown), Curio shop {7} (the ring), Funeral parlor {11} (the finger bone),
  Outdoor store (sharpens the Cosor; number to confirm). Monster cards still print the old objective
  lines (Shadow People's {11}, White Lady's "Lair + 3 ⏳", Strigoi's {13}): to update with the designer.
---

### Suggested order
~~1~~ → ~~2~~ → ~~3~~ → ~~4~~ · ~~9 and 8~~ (Perch and the candle wait for the objective rework) ·
~~6~~ · 5 (new movement) · 7 and 10 together, one monster at a time.

