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

## 4. Dice and injury tricks (equipment)
- [ ] **Lucky** — Select values for all of your 🎲 this turn. *Good Luck Charm (🔗)*  (needs a die-value picker)
- [ ] **Rally** — You and all allies can turn a 🎲 into a 4 bonus Mental defense this turn. *Compact Boombox*
- [ ] **Toss** — Suppress the effects of all injuries until damaged. *Worry Stone (1 Obol, 🔗)*
- [ ] **Drink** — Double movement and ignore physical injuries this turn. *Questionable Stimulant (🔗)*
- [ ] **Sacrifice** — When you or a teammate is killed, instead remove all injuries from that player. *Sacrificial Fetish (1 Obol, 🔗)*
  (a reaction: it must be armed in advance or offered at the moment of death)
- [ ] **Lunge** — Close range melee attacks can hit from Mid range. *Fencing Shoes* (passive; which skills count as "melee"?)
- Questions: Rally: do allies spend one of their own rolled dice (on their own turn?), or does the user's
  die count for everyone? Sacrifice: armed when used, or played at the moment someone dies?

## 5. Travel (events)  ·  needs picking spots on the map and new ways to move
- [ ] **Hidden Passage** — A hole opens in the floor here, and another at a chosen spot on the map. For the rest of the game, travelling through costs 5 movement (not possible with less).
- [ ] **Peculiar Mirror** — A blue-glowing mirror appears. Link two spots: travelling between them costs no movement (other effects may still apply). Flip 🪙: if tails, lose it.
- [ ] **Decrepit Truck** — An old truck appears on the road space nearest this player. Walk to it to start it and drive up to 25 spaces (road and bridge spaces only). A monster driven into takes 🎲🎲🎲 (added) damage, and the drive stops. 1️⃣
- [ ] **Hiding Spot** — Can remain immobile and become immune from all interactions for up to ⏳⏳. Cannot assist teammates.
- Needs: 3D props (holes, mirror, truck); a "travel" option at forks; driving along roads.
- Questions: Hidden Passage: who chooses the far end, and how far away can it be? Mirror: "lose it":
  the mirror disappears, or you lose something else? Truck: can other players ride along? Is it
  reusable (1️⃣ says once)?

## 6. Mindset
- [ ] **Curious** — Can continue investigating after resolving any event at the cost of a defensive 🎲.
- Question: "continue investigating" = draw another Obol at the same spot? And "a defensive die" = one
  that's slotted in Defense (it's spent), or one exhausted for good?

## 7. Monster abilities not played yet (logged as "not played yet")
Keywords in the monster cards' abilities the monster turn doesn't do yet. Each monster's rules
need going through with the designer.
- [ ] **Pin** (Hellhounds: Pin (5); "Pinned players cannot move")
- [ ] **Seize / Drop / Carry** (Ushi-Oni: Abduct... Seize player; "Seized players are at Death's Door.
  Carried to Lair = killed"; weakness: "drop player")
- [ ] **Drag** (Skinwalker: Bear Maul, Drag (die, 5M into nearest building))
- [ ] **Lure** (Wendigo: "Lure causes players to move towards Wendigo")
- [ ] **Consume** (Wendigo: Feed, Consume (die); "Consume heals equal to damage")
- [ ] **Trap** (Barghest: Shadow Trap: Teleport (nearest lightsource) and Trap (🎲🎲))
- [ ] **Trample** (Ushi-Oni: Run Down, Trample (die, 5))
- [ ] **Block / Unblock (All Doors)** (White Lady: Infatuation, Regret)
- [ ] **Target** (White Lady: Wrath; Poltergeist: Heave)
- [ ] **LoS Attack** (Barghest: Death Gaze, line of sight)
- [ ] **Ritual** (Skinwalker: Curseblood Ritual, Teleport to Lair, +1 ritual; at 3 rituals: Global Attack (10))
- [ ] Persistent rules on cards: Banshee Perch (rooftops), Shadow People Suffocating Darkness
  (candle, coin flip), Redcap "piercing attacks can't land the killing blow", Strigoi "only damaged
  by the Blessed Cosor", Poltergeist "discard salt items inside targeted buildings"...

## 8. Weakness-track effects only announced
- [ ] Skinwalker 1: **Reset Curseblood Ritual** (needs the ritual counter, see 7)
- [ ] Banshee 1 and 3: **Grounded until next Perch** (needs Perch, see 7)
- [ ] White Lady 1, 3, 6: **Trigger Regret** (and 6: disable Wrath, which does work)

## 9. Discard weaknesses (∞): the discard works, the effect doesn't
- [ ] Banshee: **Discard Silver to avoid Swoop damage**
- [ ] Strigoi: **Discard Holy to prevent Exhaust**
- [ ] Shadow People: **Discard Fire & avoid 1 attack**, **Discard Fire & keep candle lit**, **Discard Crystal & no light for ⏳**
- Question: are these used in advance (armed for the next Swoop / Exhaust / attack), or at the moment
  it happens?

## 10. Objectives other than "Kill"  ·  marked by hand today (Casebook → Objective achieved)
- [ ] Barghest: **Escape (to the start point)**
- [ ] Hellhounds: **Disrupt Ritual ({9} → Lair)**
- [ ] Poltergeist: **Destroy Anchors (Lair + 4 POI, die [6])**
- [ ] White Lady: **Perform Ceremony ({3}, {7}, Lair → {9} + 3 ⏳)**
- [ ] Strigoi: **Kill with the Blessed Cosor (Lair → {13} → {9} → Lair)**
- [ ] Shadow People: **Light the Dark Room ({11} → Lair × 4)**
- [ ] (Adze: "Kill Nest (Lair)" is treated as Kill: confirm)
- Needs: what the numbered spots **{3} {7} {9} {11} {13}** are on the map (map markers the editor can
  place?), "POI", "die [6]", the Blessed Cosor item, the candle.

---

### Suggested order
~~1~~ → ~~2~~ → ~~3~~ → 4 (equipment: today you can pay for these and get nothing) · 9 and 8 (small, per monster) ·
6 · 5 (new movement) · 7 and 10 together, one monster at a time.

Until group 4 is built, consider disabling the ✋ skills so they can't be spent by mistake.
