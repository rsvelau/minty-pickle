# Backlog: effects the game doesn't play yet

Everything here is **in the game as data** (shown, logged, paid for) but its **effect does not happen**.
Grouped by the mechanic each needs, so they can be built one mechanic at a time, with the designer
confirming the rules for each group before it's built. Keep this file up to date: tick items off and
delete them when they work.

Current state (2026-11-22): rules version 5, 95 tests. Equipment, Events (most), Mindsets (most),
monster weaknesses/immunities/health, objectives (Kill automatic, others marked by hand) all work.

---

## 1. Doors (equipment)  ·  reuses the door system from Lockdown / Nailed Shut (`doorOverride`)
- [ ] **Breach** — Destroy an adjacent door. *Dragon’s Breath Shotgun (1️⃣), Fireman’s Axe, Crowbar*
- [ ] **Nail Shut** — Block an adjacent door. *Cut Spike (🔗)*
- [ ] **Lock** — Lock an adjacent door. *Iron Chain, Heavy Silver Chain*
- Needs: choosing which adjacent door (tap it); doors shown differently on the board when blocked,
  locked or destroyed (also missing for Lockdown / Nailed Shut / Roof Collapse today); whether
  monsters respect locked and blocked doors (today monster movement ignores door changes).
- Questions: can monsters break or pass locked/blocked doors? Does a destroyed door become an open
  doorway or a gap in the wall?

## 2. Holding the monster back (equipment)
- [ ] **Salt Circle** — Prevent Monster from crossing this space for 1 turn. *Salt Lick, Glowing Salt Lamp (both 🔗)*
- [ ] **Distract** — The Monster must use movement to approach a selected space this turn. *Compact Boombox (🔗)*
  (the Police Patrol lure after midnight already does something similar: reuse it)
- [ ] **Camouflage** — Cannot be approached this turn. Cannot move. *Viper Hood*
  (Bumped Shelf's after-midnight Hide already makes a player untargetable: reuse it)
- [ ] **Brace** — Immune to being moved this turn. *Ice Axe* (only matters once monsters can move players: see 7)
- Needs: picking a space on the map (Distract).

## 3. Spiritual damage tricks (equipment)
- [ ] **Spiritual Backlash** — The target (a monster or a teammate) takes the Spiritual damage you would have taken this turn instead (untyped to monsters). *Bronze Skull Lantern*
- [ ] **Wrathful Penance** — Spiritual damage you would take this turn is reflected back at the monster as ✺ Holy damage. *Blessed Scapular (2 Obols)*
- [ ] **Weeping Barrier** — Spiritual damage heals you this turn. *Mourning Veil (1 Obol)*
- Needs: a hook in `applyDamage` for Spiritual damage (redirect / reflect / heal); Holy damage to the
  monster counts as a weakness hit where Holy is a weakness.
- Question: "heals you": by how much: one Spiritual tier, or tiers equal to the damage?

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
1 → 2 → 3 → 4 (equipment: today you can pay for these and get nothing) · 9 and 8 (small, per monster) ·
6 · 5 (new movement) · 7 and 10 together, one monster at a time.

Until group 1-4 are built, consider disabling the ✋ skills so they can't be spent by mistake.
