# Midnight Shift: game and Board Grid Planner

A 3D planning board for a night-time, 90s Pacific Northwest board game, and the start of the game itself.

## Title screen and game modes

The app opens on the **title screen** (`src/app/gameShell.js`):

**The moon and the opening camera move** (`src/app/intro.js`, `src/render/skyMoon.js`): behind the title the
camera hangs far out beyond the forest, tilted up into a starry night sky (no town in view): a big full moon in
the middle of the screen, a faint red glow breathing behind it, and two wisps of cloud drifting across it left to
right, coming round again a few seconds after they've left the screen. The menu is a small dark panel near the
bottom (buttons two to a row). Starting a game (new, Continue or Load) hides and locks the play display for one
continuous 5-second camera move that starts slow, picks up speed and eases in on the player who is up: it tips
down from the moon through the stars until the treeline comes into view, then the town far off (out of the
night's fog), and sweeps in over the town to the over-the-shoulder view (the Start space for a new game). Then
the menus and the map markers fade in. The moon and clouds are switched off once they've left the view; the
stars fade out on the way down.

- **Continue**: the most recent game, from its autosave.
- **New game**: pick a map (the built-in **Hawthorn Bend**, any of **My maps**, or whatever is in the map
  editor now), 1 to 4 investigators and **how many of them you play** (the rest are bots), the monster
  (random from a pool, or a specific one) and an 11 PM or Midnight start. The map is checked as you pick it, the same check as **Ready to play?**: a map with
  errors can't be started, and the list says what to fix.
- **Bots** (`src/game/bot.js`, driven by `src/play/bots.js`): play a team of up to 4 with you playing 1 to 3
  of them; the last seats are played by the expert bot (the same one the playtests use, marked 🤖). It plays
  everything a player does (scouting, investigating, naming the monster from the evidence, the objective's
  steps, skills and Obolcraft, defense, discards and the Fetish when they're its to decide, the truck)
  quickly, a turn in about 4 to 6 seconds: it doesn't wait for the board to finish moving, so its pawn is
  still walking to its destination (outlined in its colour, pulsing) when the next turn starts. A banner under
  the clock shows its turn: the dice it rolled and what it did. While it plays the dock says so and the play
  controls wait. It only sees what the players see (never the hidden monster). Saved games keep who's a bot.
- **Load game**: the autosave and 3 save slots.
- **Map editor**: the planner described below, exactly as before (⌂ in its panel goes back to the title).
- **Game settings**: the rules settings (Obols, slots, turn length...), the defaults for new games.

**Scouting** (the start of every new game; Game settings → Start → Scouting turns it off): someone got
here first, and what they gathered was left at the edge of town. How it went depends on the night's monster's
**difficulty**, 1 to 5 stars on its card (`stars` in `src/game/cards/monsters.js`; the Adze is 2 stars,
the Shadow People 3, every other monster 1 for now). Difficulty isn't evidence: the stars only show when the monster's identity comes out (on its card,
with its name), and in the card list under Game settings. The Scouting screen shows only the story
(`SCOUTING_STORY` in rules.js): 1 ★ whoever called us left supplies; 2 ★ somebody left in a hurry; 3 ★ a
scouting team found this much before things got too hot; 4 ★ paid for in blood; 5 ★ a slaughter, the
equipment pulled out by remote arcane manipulation. Players + 1 Equipment cards are drawn from
the deck, dealt face down and turned over; the investigators take turns in seat order, each tapping a card
and **Take**-ing it into their Skills (marked "From Scouting"). Once everyone has chosen, the card left over
is shuffled back into the deck and P1's first turn begins. Rules: `newGame(board, { scout: true })` starts the
phase (`state.scouting`: the offer, the order, who took what) and the `scout` action takes a card.

In a game the editor's tools are hidden and everything you press is in the **dock** along the bottom
(`src/play/sheets.js`, `panels.js`): a status line, four menus and the big action button.

- **Team**: everyone's place, white dice, injury pips, Obols and conditions, plus the log. Tap a player for their
  injuries in full (and a shortcut to their Skills).
- **Skills** (`I`): the Equipment skills and Obolcraft, in two tabs. Its badge counts the skills the current
  player can use **right now**. The Skills tab has two views: **Ready first** groups every skill into **Use now**
  (with the dice that work already picked: lowest first, so the high ones stay for moving), **Almost** (one thing
  missing: roll first, a monster out of range, an Obol short...), **Not now** (used up, someone else's turn, no
  monster on the board) and **Automatic** (Lunge, Sacrifice); **By item** is card by card, each skill with the
  same reason under it. Obolcraft lists the recipes you can craft first. The check is `src/game/skills.js`
  (`skillStatus`): it picks dice and a target, then tries the action on a copy of the game with the rules
  themselves, so it never offers something the rules would refuse. ✋ skills (resolved at the table) can only
  be checked for dice and Obols.
- **Case** (`C`): the Casebook and the Field Guide. A dot means new evidence.
- **More** (Esc opens the full game menu): Quick / Tactical movement, Follow camera, Follow streets, the view
  controls (layer, camera, labels, quality), **Game settings, Save game** (3 slots), **Load game, Restart this
  map, Quit to title**.
- **The action button** does what comes next: **Roll**, then **Move** (the dice slotted), then **End turn**.

**Messages** (`src/play/feed.js`): every line the game logs is kept, but only what stands out pops up
over the board, above the dock: a marker touched (key, dice, Research, Investigation, Obols, evidence), an
attack on a player, an attack on a monster, a death (or a fall the Sacrificial Fetish could undo), skills
used, Obolcraft, objective steps and midnight. Rolls, moves and turn changes stay quiet. Every player reads
the same lines: they come from the game's shared log, not from whoever's device or turn it is. Colours:
white on dark red a death, red the monster's actions, purple damage to a monster, gold objectives, teal evidence and
Obols, green skills and Obolcraft, violet the night. Each fades after a few seconds. The 💬 button in the dock's status line
opens the recent history (every line, quiet ones too); tapping it again closes the history and turns the
pop-ups off, and once more turns them back on. The full log is under Team.

**Monster health**: a ring at the monster's feet, the bright arc its health left (green, amber, then red)
and the dim red arc what it has lost, with "6/10" beside it; each hit floats its damage up from the monster.
Monsters with ∞ health have no ring.

Each menu opens as a sheet over the board just above the dock, one at a time: tap its button again, ✕, or drag
its top edge down to close it. A phone held sideways gets the dock as a strip down the right edge, with sheets
beside it.
The game **autosaves at the start of every turn**. A save holds the whole game state (including the dice's
random-number state, so it continues exactly) and a copy of the map, so it still loads after the map is
edited or deleted.

**Your editor board is never touched by a game.** A game's map is loaded onto the board only while you play;
the editor's own board is set aside (it is autosaved in this browser as always) and comes back when you
return to the map editor. The editor's **Play demo** still test-plays the editor's board directly.

**My maps** (File section of the editor): name the current board and save it; saved maps appear in New game.
**Open** puts a saved map on the editor's board (Undo puts your previous board back).
**Copy** saves a duplicate of one of your maps ("Name (copy)"). Under **Built-in maps**, **Open a copy** puts
Hawthorn Bend on the board without touching the built-in one; the name field then reads "Hawthorn Bend (copy)",
so saving never overwrites anything. To change the built-in map, tweak the copy and send its **Export JSON**.

The built-in map is the designer's own board: `maps-src/hawthorn-bend.export.json` is the file exported from
the editor (File → Export JSON). To update it, export the board again, replace that file, and run
`node tools/import-hawthorn-bend.mjs` (or pass the exported file's path); it writes `src/maps/hawthorn-bend.json`
with the built-in name and prints the Ready to play? report.

## Cards

All the cards from the card PDF are in the game as data (`src/game/cards/`): **44 Equipment** cards
(`equipment.js`: each ability's range, damage kind, dice cost, requirement and 1️⃣ / 🔗 limit, word for word),
**37 Event** cards in six categories (Event, Decision, Cursed Object, Hazard, Opportunity, Global) and
**6 Mindsets** (`events.js`). `requirements.js` reads the bracketed die requirements ([4+], [12], [11-],
[1,2], [2-3], [2, 5+], [Any], [2x Target's 🎲]).

**Decks** (`src/game/decks.js`): each new game shuffles an Equipment and an Event deck with the game's seeded
dice; they are part of the saved game. An **Equipment Obol** draws an Equipment card into the investigator's
inventory, and the Obolcraft "Draw an Equipment card" recipe draws from the same deck. An **Event Obol** draws
an Event card, shown and logged; a **Global** event becomes the one in effect (shown beside the clock) until
another Global replaces it. **Mindsets** are shuffled into the Event deck: drawing one gives it to that
investigator (shown in the title of their Skills sheet), replacing any Mindset they had.

**Events in play** (`src/game/eventPlay.js`). The card pops up; if it needs a choice (Decisions, optional "Can"
Opportunities and Cursed Objects), the turn pauses until **the drawing character** chooses (alone):
- **Survivors** (Injured, Huddled, Insane Survivor): Live or Die must be chosen (a Live you can't pay for is
  greyed out). The team's choices are tallied (Casebook); **Police Patrol** advances the clock ⏳, or ⏳⏳ once
  any survivor has died.
- **The clock** moves forward or back (Police Patrol, Bumped Shelf's Hide, Enigmatic Hourglass, Message Cypher,
  Wooden Boards); never from midnight on. **Chalk-Scrawled Narrative** reveals all evidence and ends the turn on
  the last turn before midnight.
- **Hazards** appear on the space where they were found (a token on the board) and affect players and monsters,
  but not the player who found them until they move off: **Sinkhole** (entering costs 5 moves), **Flooded Out**
  (moves cost double within 1), **Overgrown Brambles** (entering ends your movement), **Flickering Lights**
  (Physical damage within 4 ignores your lowest defense die), **Consecrated Ash** (eases a player's Spiritual
  injury; stuns Incorporeal and Semi-Corporeal monsters).
- **Traps** laid by players only affect monsters crossing them: Coil of Razor Wire, Rusty Bear Trap (optional;
  Corporeal immobilized a turn, Fae two), Deadfall Trap, Bonfire (🔥), Summoning Circle (pulls a Demon in and
  binds it). Monster damage goes through toughness and counts weakness hits.
- **Doors**: Nailed Shut blocks the building's doors; Roof Collapse blocks the nearest (take 💥 [P] to get
  through it this turn); **Lockdown** locks every door until the drawer's next turn, and touching any Key space
  meanwhile unlocks every door for good.
- **Globals** (one at a time, shown beside the clock): **Power Outage** turns every light off, the clocktower
  included (vehicle headlights stay on; the board goes dark, and lit slots follow); Bright Moon (Mental and
  Physical rolls −1; +2 Physical against a Beast); Strong Winds (starting outside: heads doubles your movement,
  tails costs a movement slot); Lightning Storm (ending your turn outside: tails, 💥 [P]).
- Others: Spirit Board, Insane Survivor and Message Cypher reveal Evidence; Ominous VHS and Injured Survivor
  expose what Investigation spots hold (investigating there takes it); Tarot Cards play three more events then an
  Evidence card; Haunted Portrait clears your injuries but shuffles in a curse that kills whoever draws it; Fall
  Through, Huddled Survivors and Wooden Boards investigate again; Distant Gunshots negates Attack cards and
  Distant Screams avoids attacks for the rest of the turn.
- 💥 [P]/[M]/[S] on a card is one die of that type, defended as usual.
- **Mindsets**: Reckless and Mighty double your equipment damage (Mighty: a weapon breaks after one use);
  Reckless can't slot defense; Rushed doubles movement and counts defense dice at most 3; Meticulous can
  investigate a spot twice and counts movement dice at most 4; Protective lends your defense to a teammate in
  Close range. Curious: once an Event drawn while investigating is resolved, "Keep investigating?" asks
  (when you have a Defense die and the bag isn't empty); yes spends your lowest Defense die and draws another
  Obol at the same spot (another Event asks again).
- **After midnight** the clock has stopped, so the clock cards switch to their midnight versions (shown on the
  card and in Cards in the game): **Message Cypher** spends two rolled dice to trigger one of the monster's
  weakness effects; **Wooden Boards** ends your turn and boards up the doors (the monster can't use a door within
  3 spaces this round); **Bumped Shelf**'s Hide ends your turn and the monster can't target you this round;
  **Enigmatic Hourglass** heads cancels the monster's next declared action; **Police Patrol** lures the monster's
  next move to its spot (unless a survivor has died: then it doesn't come); **Chalk-Scrawled Narrative** triggers
  two weakness effects, but you skip your next turn. Trap durations (⏳) count rounds and work as before.
- Still played at the table: Hidden Passage, Peculiar Mirror, Decrepit Truck, Hiding Spot (travel).

**Using equipment** (`src/game/equipmentPlay.js`): any time during your turn, open **Skills** in the dock
and tap **Use** on a skill (Ready first lists the ones you can use now, with their dice already picked). Pick its dice from your free rolled dice (their total must meet the bracket), and a
target if it needs one (monsters within the skill's range: Close 1, Mid up to 2, Long 3 or more only;
teammates in your space for heals like the Medical Kit). Obol costs (◉) take any colour.
- Damage: the slotted die, the dice added, or a fixed number, minus the monster's **toughness** (unless the skill
  ignores it); the rest comes off its **health**. A monster immune to the skill's element is not affected at all.
- **Weakness track**: every hit with one of the monster's weakness elements counts; at each number on its card
  the effect happens once. The game plays −toughness, −die, −HP, Disable [ability], Interrupt, **Reset
  Curseblood Ritual** (Skinwalker: the ritual count back to 0) and **Trigger Regret** (White Lady: Regret
  strikes at once, after the skill that set it off); Banshee's Grounded until next Perch is announced (it
  waits for Perch).
- **Monster abilities added with them**: the Skinwalker's **Curseblood Ritual** counts (shown on its row as
  Ritual n/3); the 3rd sets off a Global Attack (10) and the count starts over. The White Lady's **Regret**
  is an Area Attack on every player inside her building (outside a building: everyone indoors); its Unblock
  waits for Infatuation's Block. The Banshee's **Swoop** lands beside the nearest player before it attacks.
- Effects on the monster last until it has acted at the end of the round: toughness down, Bind / Gaffe
  (−5 movement), Choke (immobilized; needs twice its action roll), Seal (attack halved), Blind (next attack
  rolls 1), Powerful Flashlight (damage dice above 3 count as 3), Stock Strike (+3 to the next attack on it).
- On yourself: healing, bonus defense (typed, until your next turn), refreshed dice (back with a new value,
  ready to slot), raising other dice, +movement, Purity Seal.
- **1️⃣** once until refreshed (Retrieval refreshes Piercing Tip); **🔗 breaks**: the card is discarded.
- **Objective sites**: each Objective marker stands for a site: the type of the building it is in (Buildings
  tool), or one picked in Markers → Objective → Site. A site type always has the same fixtures (the Church: a Votive Candle Stand and a Holy Water
  Basin). Each monster's objective script (`src/game/objectives/scripts.js`) names the sites it needs: a map
  missing one has that monster disabled (the Markers panel and Ready to play? list which and why; it's never
  drawn there). When the monster is known (midnight, or named early), only its own sites appear on the board
  and stop the pawn (none for a plain Kill), and the Casebook lists its objective's steps and where each site
  is. The Adze's victims lie at the Hotel, the Bar and the Hospital. Finding all five pieces of evidence
  (three Observations, the Lair, the Attack card) identifies the monster before midnight: its objectives
  appear and work on them can start. The New game screen greys out monsters the chosen map can't host.
  Sites: Hotel {1}, Boutique {3}, Bar {5}, Curio shop {7}, Church {9}, Funeral parlor {11}, Hospital {13},
  Outdoor store.
- **Objectives the game plays** (`src/game/objectives/verbs.js`; the others still use the Casebook's
  Objective achieved): **Shadow People**: step on the Church to take a lit candle (one each at a time), carry
  it to the Lair; one candle per investigator wins (1 to 4). Ending your turn in the dark with a lit candle
  flips a coin; tails, it goes out (Discard Fire & keep candle lit is offered then); relight it at the Church.
  Candles never go out inside the Church, and starting or ending a turn on the stand relights one. A lit
  candle gives its carrier +1 Defense. Umbral Stab strikes at most once a move (the first lit space entered).
  The Missing-person memorial landmarks become optional objectives (a pale blue flag with a candle, not the red
  one) where a candle that went out can be relit for an Obol (the kind you hold most of): stepping onto a space
  sharing a side with one asks (once per memorial a move), and on your turn beside one (before rolling, or
  stopped) Skills offers "Relight the candle".
  **Barghest**: each investigator steps on the Church to be cleansed; the uncleansed can't step onto a
  bridge; a cleansed investigator reaching the Start space escapes (out of the turn order, out of the
  monster's reach). The first escape wins for the team; play goes on until everyone has escaped or fallen.
  **Hellhounds**: holy water from the Church to the Lair disrupts the ritual: until then a destroyed pack
  rises again at the Lair; after, destroying it wins. **Poltergeist**: stopping on an Objective marker with
  a rolled 6 asks "Destroy the anchor?" (the 6 is spent, from Defense if need be); after 4, the last anchor
  is at the Lair, and destroying it wins. **Strigoi**: the Cosor lies at the Lair (one only); sharpen it at the
  Outdoor Store {12}, bless it at the Church; then **Strike** (listed in Skills, or **Strike ✝** in the dice
  tray), with the Strigoi in Close range and once a turn: pick one of your rolled dice and its value comes
  off the Strigoi's health, toughness ignored (the highest free die is picked for you). Its attacks
  (reworked): **Drain** (1-3) targets the Cosor holder wherever they are, one die of damage, then exhausts
  their strongest slotted defense die; **Charm** (4-5) is an Area Attack of 4 within 8 spaces, and everyone
  it hurts is pulled 4 spaces toward it and loses every slotted defense die; **Unholy Burn** (6) hits the
  Cosor holder for 4 and the Cosor drops on their space (a gold-lit knife on the board): they can't move or
  pick it up on their next turn; anyone else can, and after that so can they (standing on it, at the start
  of their turn). With no one holding the Cosor, Drain and Unholy Burn strike whoever is in Close range.
  From afar, the strike shows as shadows rising around the holder. **White Lady**: the Gown (Boutique {3}), Ring (Curio Shop {7}) and Finger Bone (Funeral
  Parlor {11}) to the Church; then each round ending with someone inside the Church counts (nobody there,
  it waits): after 3, her soul is set free.
  Carried items, Cleansed, Escaped and Pinned show in the player list; the Casebook shows the progress.
- **Monster abilities played with them**: **Pin (n)**: an attack of n; if it injures, that player can't move
  on their next turn (dice still go to Defense, equipment still works). **Target**: the action goes to the
  player it names, wherever they are (Heave: nearest the Lair; Wrath: the least injured inside her
  building). **Demonic Fire**: the hounds ignore your lowest defense die. **Torment** hits everyone in the
  occupied building nearest the Lair. **Infatuation**: the White Lady appears inside the occupied building
  nearest the Church and shuts every door of it; **Regret** opens them; with no one inside her building,
  Wrath and Regret become Infatuation. **Drop (Cosor)**: see the Strigoi.
- **Winning is the monster's objective.** "Kill": destroy it. Any other objective (Escape, Disrupt Ritual,
  Destroy Anchors…) is played at the table and marked in the Casebook (**Objective achieved**); until then,
  destroying the monster only sends it back to its Lair at full health. Once achieved, a monster with health
  must still be destroyed one more time; one with ∞ health is beaten by the objective alone.
- **Discard weaknesses** (the purple ∞ on some monster cards): three are offered **at the moment**: when a
  Banshee's Swoop hurts you (Silver), a Strigoi's Exhaust takes a die (Holy) or a Shadow People attack hurts
  you (Fire), and you carry Equipment with a skill of that element, the game waits for you: **Discard it** and
  that hit is undone (injuries, a death, the exhausted die, the defense it wore), or **Keep it**. A hit that
  would kill leaves you down until you answer. Moving when it happens, you stop and pick a way on after. The
  rest are discarded from Skills → By item any time on your turn: **Discard Crystal & no light for ⌛** (Shadow
  People) keeps lit spaces safe from Umbral Stab until your next turn; **keep candle lit** is resolved at the
  table. One limit: Drain exhausts your defense die before it attacks, so undoing the Exhaust gives the die
  back but not to that attack.
- **Defense wears down**: each attack subtracts from your slotted defense, so a second attack faces what's left
  (slot a 6, block a 3, and a 4 then hits the 3 that's left), until your next turn. Defending a townsperson
  wears it down the same way. The dice tray and the Investigate? prompt show what's left ("3/6").
- Doubling (Bless) applies before toughness.
- **Doors** (Breach: Dragon's Breath Shotgun, Fireman's Axe, Crowbar; Nail Shut: Cut Spike; Lock: Iron Chain,
  Heavy Silver Chain): pick a door on a side of your space in the Use sheet. **Breach** smashes any door in
  (plain, locked, one-way, boarded, nailed or chained): an open doorway for good, for everyone; the leaf lies
  on the floor inside. **Nail Shut** and **Lock** work the same: the door is boarded over, a wall to everyone,
  the monster included, until someone Breaches it; the spike and the chain are left on the door (the card is
  lost). Doors the Nailed Shut and Roof Collapse events block also stop the monster now, and are drawn boarded.
  A breached doorway can't be shut again (Lockdown and Nailed Shut pass it by). `src/game/doors.js`.
  **Forcing a door**: anyone beside a blocked door can spend a rolled 6 (not slotted or spent) to break it
  open for good (breached), so no one stays trapped; it shows under Skills as "Force the door" while you
  stand beside one (the `force` action).
- **Holding the monster back** (each lasts through the monster's next turn, at the end of the round):
  **Salt Circle** (Salt Lick, Glowing Salt Lamp) pours a ring of salt on your space: no monster, ghosts
  included, can enter or cross it, though one can still come up beside it and strike whoever is inside.
  **Distract** (Compact Boombox): pick a space within Mid range (2) on the board (the reachable spaces light
  amber, the dice tray steps aside); every move the monster makes on its turn heads there. **Camouflage**
  (Viper Hood): the monster won't come for you or strike you up close (Area and Global attacks still can),
  and you can't move the rest of your turn. **Brace** (Ice Axe): you can't be moved; nothing moves players
  yet, so it waits for the monster abilities that will (Drag, Seize...). The salt and the boombox show on
  the board; Camouflaged and Braced players are tagged in the player list.
- **Spiritual damage tricks** (through the monster's next turn; each Spiritual hit is caught whole, before
  your defense is touched): **Weeping Barrier** (Mourning Veil) heals a Spiritual tier per hit instead;
  **Wrathful Penance** (Blessed Scapular) throws the hit back at the nearest monster as Holy damage (through
  toughness; a Holy weakness counts a hit); **Spiritual Backlash** (Bronze Skull Lantern) sends it to a
  monster you pick (untyped, through toughness) or a teammate (a Spiritual hit on them, their defense
  applies). Players with one up are tagged Veiled, Penance or Backlash.
- **Dice and injury tricks**: **Lucky** (Good Luck Charm) lets you set any of your dice this turn: a Lucky row
  in the dice tray, tap a die then its new value. **Rally** (Compact Boombox) costs one die: you and every
  teammate within Mid range get +4 Mental defense through the monster's next turn (tagged Rallied).
  **Toss** (Worry Stone) holds off the effects of all your injuries, Death's Door included, until you are
  injured again (a blocked hit doesn't end it; the tiers stay marked, and a hit that gets through at Death's
  Door still kills; tagged Steadied). **Drink** (Questionable Stimulant): movement doubled and Physical
  injuries ignored for the rest of your turn (tagged Stimulated). Used mid-turn, Toss and Drink give back
  the slots and dice the injuries took; a lost die is rolled at once. **Lunge** (Fencing Shoes) is always on
  while you carry them: your Close damage skills reach Mid. **Sacrifice** (Sacrificial Fetish) isn't used
  from the card: when you or a teammate would die and the carrier holds an Obol, the player falls (out of
  the fight, nothing more can hurt them) and the game waits for the carrier: spend the Fetish and an Obol
  and they get up with every injury healed, or let them die.

**The clock stops at midnight**: from then on it shows 12:00 AM · Midnight, and ⏳ effects do nothing.

**The night has 24 turns** (`src/game/carePackage.js`): counted from midnight, the clock shows how many turns
are left to dawn (red for the last 5). At 19 a warning; when the 24th turn ends and the monster still stands, the
team is **Lost in the night** and everyone loses.

**Care Packages**: every 6 turns after midnight (6, 12 and 18) a purple portal opens over a random Investigation
marker (investigated or not) and a military crate falls onto it; every camera turns to watch, and the feed says
where. The crate replaces the marker and holds 5 Equipment cards from the deck. Stopping on it (the pawn always
stops there) opens it: take what you need, the rest stays for the others (📦 in the dock reopens it while you
stand there). An empty crate is gone.

**Dropped on death**: an investigator who dies drops what they carried (the White Lady's relics, the Cosor, the
heirloom, holy water, a candle...) where they fell, drawn on the ground; anyone stepping there picks it up.

**Travel events** (`src/game/travel.js`): **Hidden Passage** (the finder taps an Investigation space within 10
for the far end; anyone on either hole can go through for 5 movement, offered as a way at the stop; monsters
can't), **Peculiar Mirror** (the twin on any Investigation space; anyone steps through free, then flips a
coin: tails, an Obol is lost), **Hiding Spot** (once in the game, anyone on it hides from Skills: the turn ends,
immune to new attacks for up to 2 rounds; roll to come out, or 🫥 Stay hidden) and **Decrepit Truck** (on the
nearest road; get in from Skills within a space; after everyone's turn, before the monster's, its finder drives
it up to 25 spaces of road with the arrows, riders aboard, and Parks to stop; hitting the monster deals 🎲🎲🎲
through its toughness and Stuns it; the truck is wrecked when the drive ends). Lockdown's doors are drawn locked.

**Skills don't offer pointless healing**: a heal with no matching injury (yours, or a teammate's in range) is
"Not now: No Physical injury to heal".

**Cards in the game** (Game settings → Cards → Choose…): pick which Equipment, Events and Mindsets new games
use, 0-3 copies of each, and which Monsters the random mystery can be. Search, All in / All out. Saved with the
game settings (`deckCounts`: only the changes from one copy each).

**Glossary** (Cards in the game → Glossary): the card shorthand as the designer defined it (`cards/keywords.js`).

Saved games from older versions still load: `migrateState` in `src/game/rules.js` gives them decks (minus
equipment already held) and arms their monsters. Rules version 5.

## The board
The board is a whole town: a 20 × 26 grid by default (columns **A–T**, rows **1–26**), resizable from 4 to 35
cells per side (bigger maps cost too much on phones: see [`docs/ASSET_BUDGET.md`](docs/ASSET_BUDGET.md); maps
saved bigger, up to 60, still open, and Ready to play? flags them). Every cell has an area (category + subcategory), light and movement; walls and doors sit on
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
| Indoor | Hardwood (default), Carpet, Condemned\* (then the Buildings tool says what a building is) |
| Water | Lake, River (always start blocked), Fishing dock & boathouse\* |
| Outdoor landmarks | 26 ready-made blocked landmarks (see **Landmarks** below) |

The tile menu sorts every subcategory into collapsible sections (Ground & roads, Nature, Cemetery, Water,
Buildings & interiors, 90s town, Pacific Northwest, Unsettling, Rural) with a **Find a tile** search box on
top. Each button shows its size (`2×3`, or `area` for ones you paint in any shape). Which sections are open
is remembered on that device. Categories are the `cat` on each subcategory in `src/core/state.js` (`TILE_CATEGORIES`).

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
cells become Street when loaded. The street surface lives in `src/render/street.js`.

**Intersections** (T-junctions and crossings) get street furniture:

- **Stop signs**: a faded red octagon on a post, on the corner to the right of each approach that has to stop,
  facing oncoming traffic. Crossings are all-way stops (four signs); at a T only the side street stops.
- **An antique street lamp**: the town is a late-1800s logging town kept historic, so lamps are cast-iron posts
  in old dark-green paint (flared base, fluted shaft, ladder bar) with an acorn glass globe, cap and finial,
  about 4.4 m tall. At a T it stands on the sidewalk opposite the side street; at a crossing, on a corner.
- **Lamp posts along the streets**: each run of street between two ends (junctions, the van, a bridge or a
  dead end) gets the same post spaced evenly about every 4 cells (~28 m), measured from its ends: on the
  south sidewalk of east-west streets, the east one of north-south streets, the outer corner of a bend. A
  post is never placed within one cell of another lamp (a junction's, or one on a parallel street), so they
  never bunch up. All start dark (`streetLampCells` in `src/core/state.js`).
  Posts mid-sidewalk (along a street, at a T, at a dead end) stand ~2 m along it from the middle, so
  they never block a door centred on the cell's side.

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

### Building types

Lay every building out the same way, with plain **Hardwood** or **Carpet** floor, walkable and blocked cells,
walls, windows and doors. Then the **Buildings** tool (`B`) says what it is: pick a type and tap the building.
A building is floor joined by open floor or doors; a wall or window between two floors splits buildings, so a
row of shops sharing walls is several. One type per building, stored on its cells (so repainting keeps it, and
new floor painted into a typed building takes its type). **Generic** clears it. The panel counts the map's
buildings and what they are; hovering an indoor cell names its type.

Types: **Church, Hotel, Apartments, Boutique, Market, Bar, Library, Curio Shop, Florist, Cafe, Outdoor
Store, Funeral Parlor, Hospital, Pharmacy** (`src/core/buildings.js`). Each one sets:

- **Furniture** (`src/render/props.js` BUILDING_VARIANTS): **blocked** cells hold the heavy pieces, **walkable**
  cells get ordinary things: chairs, armchairs, small tables, a dresser, a floor lamp, an old TV set,
  plants, boxes, book stacks, papers, bottles, candles (each type has its own mix; Hospital has wheelchairs
  and drip stands). About 1 in 10 of them is knocked over or broken instead (a tipped chair, a toppled
  lamp, a smashed TV, a broken doll, a stain) so the ones you see stand out (`BROKEN_CHANCE`, `UPRIGHT`
  in props.js). Condemned floor stays wrecked throughout (planks, tipped furniture). Clutter sits only in a cell's four corners and,
  where the cell has a real wall, along that wall: the four pawn spots (a quarter cell in from the centre),
  the lines between them and the centre (where monsters walk) stay clear, so nobody clips through it.
  Untyped indoor floor gets the same household clutter. Cemetery walkable cells: grave markers in two or
  three corners and often a bouquet, a grave lantern, an urn or a stone angel; now and then a tipped
  headstone, a fallen urn, a dropped shovel or a broken angel. Pieces back onto a wall or window
  of their own cell (never a door), so shelves, counters and beds face into the room. Church: walkable cells
  are four short pews facing the pulpit, a pair each side of an aisle, in the cell's corners (the pawn
  lanes stay clear), blocked cells the pulpit (as the old Church floor). Hospital: ward bays and the
  odd wheelchair or drip stand (as the old Hospital floor). Library: bookcases, reading tables; Bar: back bar,
  counter, stools; Market and Pharmacy: gondola shelving, produce, the pharmacy counter; Boutique: clothes
  rails and mannequins; Curio Shop: glass cabinets, a grandfather clock; Florist: tiered flower stands and
  buckets; Cafe: counter, round tables and chairs; Outdoor Store: gear racks, tents, a canoe; Funeral Parlor:
  caskets, wreaths, rows of chairs.
- **Hotel and Apartments** tell rooms apart: a small room (up to 6 cells) behind a single door from the
  building's own floor is a private unit (a bed, nightstand and dresser; in a flat, sometimes a kitchenette),
  everything else is common area (the hotel's front desk and lounge chairs; the apartments' mailboxes).
- **Outside**: its exterior and interior wall finishes (brick for the Hotel and Library, plaster for the
  Hospital...), and a **sign** over its front door (the door onto a street first), lit for the Hotel, Bar, Cafe,
  Hospital, Pharmacy and the Church's cross (they flicker at midnight). Shops (Boutique, Market, Florist,
  Cafe) get a striped **awning**. Signs hide with Low walls.
- **Floor**: the Church keeps its worn oak boards, the Hospital, Market and Pharmacy pale linoleum; the others
  show the floor you painted.
- **Objective site**: an Objective marker inside is that site with no tagging (Hotel {1}, Boutique {3}, Bar {5},
  Curio Shop {7}, Church {9}, Funeral Parlor {11}, Outdoor Store {12}, Hospital {13}).

Old maps: Church floor and Hospital floor cells load as Hardwood in a Church or Hospital.

### Old Clocktower

A **2×2** landmark: a late-1800s stone tower with a weathered clapboard clock stage, four backlit dials, an
open belfry and a steep spire. The brush paints a whole 2×2 block with the cell you click as its north-west
corner (Rectangle mode tiles towers 2×2 at a time). The ground under it is levelled like a building. Its
dials show **11:00 PM** while planning and the **game time** in the play demo; the minute hand sweeps
forward each turn. Model: `src/render/clocktower.js`.

### Landmarks

Blocked tiles that arrive fully dressed (models in `src/render/landmarks.js`; lights are decorative glows, not game
light sources, and they flicker at midnight).

**Placing a premade building** (any fixed-size landmark, the clocktower included) works the same on a phone
and a computer: with its brush selected, **tap the board** and the building appears as a **preview** with a
pulsing outline and an arrow at its front. Nothing is painted yet. A bar under it offers **⟳ Rotate** (a
quarter turn clockwise), **⇋ Flip** (mirror the layout left to right; signs stay readable), **✓ Place** and
**✕**. Drag the preview with one finger to move it, or tap somewhere else to jump it there. A long building
turned a quarter takes the swapped footprint (a 2×3 diner facing south covers 3×2 cells), and only when you
press **Place**. The outline turns red, and Place is disabled, where it would cover another landmark. The
first preview faces the most road around the spot you tapped. **Tap a placed building with its own brush**
to pick it up as a preview: turn it, flip it or move it, then Place (it leaves plain ground behind; Undo puts
it back). Keys: `R` rotate, `F` flip, `Enter` place, `Esc` cancel while a preview is open. **Rectangle** shape
still tiles buildings straight onto the board, facing their roads. The direction and flip are saved with
the board (`facing`, `faces`, `flip` on its cells); boards from before keep facing their road.

**Area** landmarks (motel strip, trailer park, junkyard...) dress whatever shape you paint, cell by cell,
with fences running round the outside and signs on the first cell.

| Section | Landmark (size) |
|---------|-----------------|
| 90s town | Video rental store 2×2 (neon VIDEO, posters, returns slot, a TV of static), Shuttered diner 2×3 (railcar, CLOSED, one lit booth), Gas station 2×3 (canopy, 2 pumps, ice machine, payphone with the handset hanging), Laundromat 1×2 (one dryer turning), Arcade 2×2 (blacked-out windows, GAME OVER), Motel strip *area* (numbered doors, VAC NCY sign), Payphone & news boxes 1×1 (LOCAL TEEN STILL MISSING), Old Clocktower 2×2 |
| Pacific Northwest | Lumber mill 3×4 (corrugated sheds, log stacks, conveyor, rusted saw blade, steam stack), Log deck *area*, Fire lookout tower 1×1, Grange hall 2×3 (board of MISSING flyers), Driftwood & cairns 1×1, Clear-cut *area* (stumps, slash, dead snags), Cedar grove & nurse log 2×2, Fishing dock & boathouse *area, on water* |
| Unsettling | Abandoned rectory 2×2 (boarded windows, crooked steeple, swaying bell rope), Burned house 2×2 (swing still moving), Overturned school bus 1×3 (blinking hazard light), Wrecked car in a ditch 1×1 (door open, headlights on), Empty playground 2×2 (merry-go-round turning on its own), Radio tower 1×1 (red light that skips a beat), Quarantine fence *area*, Missing-person memorial 1×1 (candles, photo, ribbon, teddy bear) |
| Rural | Farmhouse & barn 3×3 (rusted tractor, porch light), Trailer park *area* (dog chain, no dog), Water tower 2×2 (HAWTHORN BEND, and something red near the top), Junkyard *area* (stacked cars, crane) |

To add one: an entry in `LANDMARK_SUBS` (`src/core/state.js`) with its section, footprint and ground colour, and a
builder of the same name in `B` (fixed) or `F` (area) in `src/render/landmarks.js`.

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
  on the cell beyond (`HEADLIGHTS` in `src/core/state.js`). Walls block them, like any light.
- The headlights are warm sealed-beam / early-halogen white (about 3,200 K, as on 80s–90s cars), with soft
  beams in the air that fade out over about 13 m as well as the glow on the road. The van is parked very
  slightly askew, beams and all; over 15 m that swings the beams ~1.2 m to one side, so the van sits that far
  to the other side of its cell, keeping the beams between the sides of the cells they shine into (inside a
  bridge's railings rather than through its truss).
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

**Lit lamp** (`L`) switches on a street lamp: at a junction, or one of the posts along a street (it does nothing elsewhere).
A street lamp is a light source of radius 1.5 at full brightness.

Light levels are data: hovering a cell shows its light (`Light 50 %`, `Light source r 3 (Floodlight)`), the
**Light** view shows the levels as a gradient, storefront glass glows when light reaches either side, and
exported JSON gives every cell a `light` level from 0 to 1 (plus `lit`/`radius` on sources and `"lamp": true`
on lit lamps). The rules live in `src/core/state.js` (`centreBrightness`, `lightAt`, `lightReaches`). Saves from
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

The variants live in `VARIANTS` in `src/render/props.js`: one entry per subcategory, each returning the props
for its walkable and blocked look. Props are built to scale (1 cell = 7 m).

Everything is defined once in `AREAS` in `src/core/state.js` (label, default walkability). The brush buttons are
generated from it, so a new subcategory added there shows up in the panel, saves and imports. Give it a
colour in `SUB_LOOK` in `src/app/config.js`.

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
markers** in View hides them. Marker art lives in `src/render/markers.js`; the list of markers is `MARKERS` in
`src/core/state.js`.

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
  more) at the start of your turn, a 3rd slot opens** (`LIT_THRESHOLD`, `LIT_SLOTS` in `src/play/play.js`).
- **Black dice are shared:** when anyone attunes a Black Dice marker, every player rolls one more black die
  from then on (each marker works once).
- **White dice are personal and kept in reserve, unrolled.** Each player keeps the White Dice they collect.
  During slotting, tap a die in the tray's **Reserve** row to roll it. A rolled white die can only be used
  that turn: it's discarded when you move (or stay put), whether you slotted it or not.
- **Game clock.** The night starts at **11:00 PM**; each turn (every player moving once) is
  **5 minutes**, so 12 turns run to **midnight**. A small counter at the top of the screen shows the time
  and turn (`11:05 PM · Turn 2/12`). Constants: `GAME_START_MIN`, `TURN_MINUTES`, `TURNS_TO_MIDNIGHT` in
  `src/play/play.js`.
- **Objectives are hidden until midnight:** in the play demo, Objective markers don't show and can't be
  touched until the clock strikes twelve (which ones appear will depend on the monster, coming later).
- **Midnight turns menacing.** When the clock strikes twelve (play demo only), over a few seconds: every
  light source (players' flashlights included) flickers on its own uneasy rhythm, with its whole pool of light dipping together (lit cells,
  street surface, lamp globes, van headlights, lit windows, the porch light). Dips are slow and partial,
  never a strobe (at most ~1.4 dips a second per light). The clocktower's dials sputter and go out, the rain turns blood red, doubles and drives in on the wind, the
  firs sway, the cold blue night shifts to a muted red, and the night closes in a little (dimmer sky light, nearer fog). Code: `src/render/dread.js`.
- **Midnight demo.** The second play button starts the game at midnight: objectives out, the town already
  menacing. **Play demo** (or `Y`) starts the standard 11 PM game.
- **Investigating.** When a runner reaches an unused Investigation space, a prompt asks **Investigate?** It also
  offers a last chance to brace: tap unused rolled dice (or roll a white die from reserve) to slot them into Defense
  before answering, since an Attack Obol strikes at once.
  (Yes / No; on a keyboard Enter or Y = yes, Escape or N = no). **No** runs on through the space and leaves
  it for later. **Yes** draws a random **Obol** from a shared bag for that player, shown in a short reveal and
  on the scoreboard.
- **Skills.** Each player has their own Skills sheet with two tabs, **Skills** (their Equipment) and
  **Obolcraft** (every Obol they draw). Open it from the dock (or `I`) for the current player; the player chips
  at its top switch to anyone else.
- **Obolcraft** (Obolcraft tab of the Skills sheet): trade Obols for effects, from the Player Mat. Obol colours
  share the damage-type theme (Attack red = Physical, Event blue = Mental, Equipment green = Spiritual, plus
  yellow Evidence); a black slot takes any colour. Recipes: red + any → reduce Physical injury by a tier; blue +
  any → Mental; green + any → Spiritual; yellow + any → your next white die is **Resonant** (it returns to your
  reserve after use); any three → draw an Equipment card; red + blue + green + yellow + any three → **resurrect** a
  dead player at your location (unhurt). Tap **Craft**, check or swap which Obols pay (the game suggests a
  payment that keeps your rarer colours), and confirm. On your own turn, before or between moves.
- **Obols** come in four kinds: **Attack** (bloody red), **Event** (misty blue), **Equipment** (shiny green)
  and **Evidence** (glowing yellow). The bag holds 7 of each (28) by default; when it's empty, investigating
  finds nothing.
- **Game settings** (the ⚙ button under the play buttons) adjust the mechanics: number of characters
  (1 to 4; 1 plays solo, and the clock moves on after each of your turns), starting black dice,
  movement slots, Quick or Tactical movement, slots when starting in light, the light level that counts as lit, minutes per turn, turns
  until midnight, stopping on every marker, asking before investigating, and the number of each Obol. They're
  saved on this device (`DEFAULT_CONFIG` in `src/play/play.js`), and changing them restarts a game in progress.
- **Running and the camera.** Runners jog at ~3.2 m/s, flashlights held steady and sweeping slowly, (hold the board to fast-forward), and the camera
  drifts ahead toward the next place the runner stops for a decision.
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
- **Two movement modes** (chosen on the New game screen, or Game settings → Movement):
  - **Quick** (the default): the pawn runs on by itself while there's only one way forward, and stops at a
    fork, a marker, the start of every move, and when its moves run out.
  - **Tactical**: it stops at **every step** and asks which way to go.
  - Switch any time during a game under **More → Movement** in the dock; the change applies from the next step and becomes the default for
    new games.
- **Every stop is a stop.** Stopped anywhere (out of moves, at a fork or marker, at each step in Tactical, at
  the Investigate? prompt), the player can roll white dice, slot dice into Movement or Defense, use equipment
  and Obolcraft. Movement dice slotted mid-move join the move when a direction is picked ("+2 joins your 3
  moves"). Stopped, **every reachable way is offered, back the way it came included**; only Quick movement's
  running between stops keeps going forward. Big round arrow buttons sit on the cells it can go to: tap or
  click one (a tap near one on the board works too), or use the **arrow keys** (relative to the camera).
  At a stop mid-move the dice tray folds down to one line so the board and every arrow stay in view; **Dice**
  opens it. **Stop here & end turn** gives up the moves left (it asks first).
- **Minimize the dice tray** with its **–** button for a clear view of the board: it tucks into a small
  **🎲 Dice** pill (tap to bring it back). A new roll opens it again, so you always see what you rolled.
- **Starting a game** turns on **Orbit mode** (one finger turns the camera; the editor keeps its own setting)
  and frames the board from behind the players, slanted, looking a few cells ahead of them: out of the van,
  or the way they last moved (`frameAhead` in `src/app/pointer.js`).
- **When the moves run out** the turn waits for **End turn** while there's anything left to use (dice, white
  dice, equipment or Obols); with nothing left, it ends by itself.
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

The demo never changes the board. Its logic is in `src/play/play.js`.

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
tracked at once (`MAX_KEY_GROUPS`). The rules live in `src/core/state.js` (`canCross`, `canStep`, `keyGroups`, `moveField`, `route`) so game code can
reuse them.

### Condemned buildings

**Condemned** (an Indoor subcategory, blocked by default) builds itself: paint any shape and walls go up
automatically round its outside edge. Edges that face a street, start space or bridge become the frontage:
**boarded-up windows**, with one **boarded-up door** in the middle of each straight run of frontage (so a
corner building gets one on each street). Sides that don't face a street are plain walls. The openings are
sheeted with weathered plywood and nailed across with planks, and the inside is full of rubble and junk.

- The walls follow the shape as you paint or erase, so you never draw them by hand. They aren't stored;
  they're rebuilt from the cells (`autoEdges` in `src/core/state.js`).
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
  Avenue D bridge), old and rain-soaked rather than freshly painted: Warren trusses with inclined end posts
  and verticals and overhead struts with X bracing, in a dark, wet rust brown with a soft sheen; an asphalt
  deck with worn centre-line paint, a concrete edge girder and pipe railings; and round concrete piers with
  cap beams in the water at each end and every two cells. The concrete is darkened by the weather, damper
  toward the water, with faint rust staining under the deck. The colouring is drawn in the shader from
  world position (`weather()` in `src/render/bridge.js`), so it stays the same scale on every beam and pier.
  On slopes every bridge part takes the deck level from the bridge cell it sits on or overhangs (within
  half a cell), and the road cells at each end are held at that level, so road, deck and frame line up. Connected bridge cells form one bridge, so a
  line of three bridge cells is one two-lane, three-cell span (`src/render/bridge.js`).
- **Bridge** only applies to water cells and makes them walkable. Each bridge cell knows which way it spans
  (`bridgeAxis()` in `src/core/state.js`, and `bridgeAxis` in exported JSON): toward land or other bridge cells
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
surrounding forest. Each preset is one height formula in `TERRAIN_PRESETS` (`src/render/terrain.js`), written so
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
- **Roads** (streets, start spaces and paths) are smoothed. Each road cell gets its own level, pulled toward
  the road cells beside it, so bumps and kinks even out while the road still climbs a hill. A road cell
  touching a building or premade landmark is pulled firmly to that building's floor, so the street in front
  of a shop runs level with it. Between road cells the surface is blended along the road only, never
  across it, so a road is level from kerb to kerb instead of tilting with the hillside.
- **Bridges** keep the height of the road on their banks; their piers stretch down to the lowered riverbed.

These levels are per-cell overrides (`updateOverrides` in `src/render/terrain.js`) read by every shader through a
small texture, and they're what the exported `elevation` reports. On the Flat preset nothing changes.

## Scale

One cell is about **7 m (23 ft)**: the width of a narrow two-lane street with small sidewalks. The default
board is roughly 140 × 182 m. Everything is built in metres and converted through `METERS_PER_CELL` in
`src/core/scale.js`:

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
  many trees ring the town, how much rain falls, and the idle frame rate. After midnight the town never keeps
  still (monster, danger rings, flicker, swaying trees, downpour), so it rests at a smoother midnight rate:

  | | Resolution | Shadows | Trees | Rain | Idle fps | After midnight |
  |---|---|---|---|---|---|---|
  | Low | 1× | off | 35% | 35% | 12 | 30 |
  | Medium | up to 1.5× | 1024 | 65% | 60% | 20 | 30 |
  | High | up to 2× | 2048 | 100% | 100% | 30 | full rate |

  Phones start on Medium, computers on High. `QUALITY` in `src/render/scene.js`.
- **FPS** (View menu) shows the real frame rate, whether it's in active, idle or midnight mode, and the
  resolution when automatic resolution has lowered it: handy when trying the game on a phone.
- **Auto resolution** (View menu, on by default, remembered per device). When frames that should run at full
  rate drop below about 28 fps for a second, the game draws fewer pixels, a step at a time (85%, 70%, 60%,
  50% of the quality's resolution, never below 0.75×); after 4 s at 50 fps or better it steps back up.
  Changing quality starts again at full resolution. `autoResolution` in `src/app/loop.js`.
- **Shadows on demand.** The moon's shadow map is redrawn only when something that casts a shadow may have
  changed: the board was edited, tiles are easing, figures or dice are moving, or a shadow-casting part of
  a building moved near the view (the playground's swing and merry-go-round, the burned house's swing; at
  most 4 a second). Otherwise only a safety redraw every 2 s. Buildings report their own moving parts
  (`movedCasters` in `src/render/landmarks.js`), so new animated models are covered automatically. Orbiting or panning the camera never redraws it. Before this, every frame
  drew the whole board twice (once for the view, once for its shadows).
- **Shadow window.** The shadows cover only the ground in view plus a margin (30% each side), worked out in
  moonlight space so everything casting into the view is included; a view taking in most of the board gets
  the whole board. The window moves, and shadows are redrawn, only when the view leaves it or zooms well in.
  On a 60 × 60 forest a close-up's shadow redraw fell from 3.4M to 1.0M triangles, and shadows near the
  camera are sharper. `fitShadows` in `src/render/scene.js`.
- **Culling chunks.** Heavy props (anything with 20k+ triangles on the board, such as forest firs) are drawn
  in batches of 6 × 6 spaces, and the forest ring around the town in square sectors, so the renderer skips
  batches that are off screen; forest sectors wholly beyond the fog are skipped too. Light props stay one
  batch each, to keep draw calls down. On Hawthorn Bend a close-up now draws about 260k triangles instead
  of 630k, and on a 60 × 60 forest about 0.8 million instead of 3.8 million.
- **Asset budget**: what a tile, building or character may cost, measured on a Pixel 10a:
  [`docs/ASSET_BUDGET.md`](docs/ASSET_BUDGET.md).
- **Stress test** (editor: File → Stress test). Fills a board (26 × 20, or the largest, 35 × 35)
  with any tile, walkable or blocked, or any premade building, or takes the map as it is, then measures
  the whole board and a close-up, 6 s each: frames per second (average and the slowest 10%), triangles
  and draw calls per frame, the extra triangles in a shadow redraw, and the **frame cost**: for the last 2 s
  every frame waits for the GPU to finish, so its time covers CPU and GPU end to end. Frame rate stops at the
  screen's refresh rate (often 60), frame cost doesn't, so **headroom** (how many times the slowest 10% of
  frames fit in 33 ms, i.e. 30 fps) shows how much is left: from the frame rate ("at least", when it sits at the
  refresh rate) or the frame cost (which errs high: the wait itself adds time on some phone GPUs), whichever shows more. Where the browser has GPU timers, GPU time is
  reported too. Counts include the shadow pass (three.js would reset them between the two). Midnight effects can be on or off; indoor
  floors are split into 4 × 4 rooms. The editor's board is set aside (autosave off) and comes back when the
  panel closes; automatic resolution is paused so the quality is measured as set. **Copy results** puts the
  numbers on the clipboard. `src/editor/stressTest.js`, boards from `src/core/stressBoard.js`.

## View menu

The cell info box (hovered cell and board counts) has a **–** button that folds it down to a small
**ⓘ Cell info** chip; tap the chip to bring it back. The choice is remembered on that device.

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
machines (the file carries the board size); **Save PNG** grabs the current view. Inside the published claude.ai page, downloads go through claude.ai's save
prompt (you confirm each file); everywhere else they download directly. **Copy JSON** always works too. The JSON is deliberately plain so
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

A map file may also carry details: `"meta": { "id", "name", "description", "created", "updated" }`
(`src/core/mapFormat.js`). Files from a newer version of the app are refused with a message rather than
half-loaded, and a saved game pasted into Import is recognised and turned away.

**Ready to play?** (under the file buttons) checks the board against what the game needs
(`src/core/mapCheck.js`): a Start space whose front cell is open (errors stop play), Investigation spots
(4 or more, one per evidence card), Objective markers in 3 separate buildings for monsters that hunt
townspeople, markers on blocked cells, and markers players can't reach from the start (doors, locks and
keys counted), maps over 35 × 35, and (in the editor, where the board is drawn) the board's triangle count
against the phone budget of 1.1M, warning when it's over. The future game will run the same check before
letting a custom map be played.

**Saved games** (`src/core/saveFormat.js`, used by the game build to come) hold the rules state, which is
plain JSON including the seeded random-number state, so a loaded game continues exactly as it would have,
plus a full copy of the map, so editing or deleting the map later never breaks a save. Saves from a newer
version are refused; older ones pass through `upgradeState()`, where each future rules change adds a step.

**Storage** (`src/core/storage.js`) is one interface for the planner's board, a library of maps, saved games
and preferences, over a swappable backend: browser storage today, a folder of files in a desktop build later,
memory in tests. Blocked or full storage never crashes the app. The planner's board keeps the key it has
always used, so existing boards carry over.

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
- **View** (`src/play/play.js`): figures, animation, camera, name tags, the dice tumble, monster figures. It sends
  actions to the session and animates the events that come back; it never changes the game itself.
- **Tests** (`tests/rules.test.js`, `npm test`): whole games played headless by a bot, determinism, JSON
  round-trips, rejected moves, Obols, midnight, monsters stalking and attacking, the board travelling as
  JSON, and a host with two phones staying in sync with seats enforced.

### Monster rules played (Nov 26 answers)

Barghest: can't enter buildings; Death Gaze at the end of its turn hits everyone in line of sight (straight
lines; walls, doors and buildings block it, windows don't) for 10; Shadow Trap springs at once where it lands
(🎲🎲 to everyone beside it). Skinwalker: Bear Maul drags whoever it hurts up to 5 spaces into the nearest
building; once a game the first investigator at its Lair stuns it (skips its next turn, toughness 0 till
then). Wendigo: Feed lures everyone within 4 by the same die, then Consumes everyone in Close range and
heals all that got through; Regeneration heals 4 at the end of its turn, off until a Consume lands (or for
good). Ushi-Oni: Abduct's 🎲🎲 attack Seizes whoever it hurts (Death's Door, can't move; damage through its
toughness or a weakness hit frees them); at the end of its turn it heads 10 toward its Lair through walls
(salt stops it), carrying them, and kills them there at the end of the round. Banshee: Perch at the end of
her turn, to the rooftop (a building floor or a premade building, not fences, wrecks or towers) nearest the
player closest to the heirloom; on a roof she's out of Close range; Keen only reaches outdoor spaces; the
heirloom (a signed ring) is picked up at the Funeral Parlor and set down from Team (Set down); brought to
the Unmarked Grave (any Objective marker on a cemetery space, or one set to that site), it defeats her at once. Adze: its
the Nest has toughness 2 and isn't immune to Iron (Iron weapons hurt it); its
victims come out as soon as the team knows it's the Adze (all its evidence, or named right), or at midnight;
the turn it rises its swarms only gather; then each swarm flies from the Lair 6 spaces a turn toward its
victim (walls and windows stop it, doors don't, locked or not; with no way through it scatters; one swarm per victim at a time, so a second one goes after another
victim), shown as a ghastly green cloud on the board; it settles right beside its victim and strikes on the
Adze's next turn (on the nearest living victim if its own has died); each swarm has 5 health that any Fire
attack wears down (Skills lists swarms in range as targets): at 0 it's alight, flaming orange, and it flies
back to the hive and burns the Nest for 3 piercing damage; a defender's Defense die is exhausted only when a
strike gets past them (a block costs nothing for good), and each swarm a defender beats off costs the Nest 2
health, through its toughness; one victim per investigator (all three with three or more), and playing solo
all three wait together in the Hospital, only one swarm is on the map at a time (2 health instead of 5), a
failed block exhausts nothing and the Nest has no toughness (0); a victim survives the first hit
that gets through (wounded) and dies to the second; a victim's death costs everyone one die × the dead. Redcap: toughness-ignoring (Piercing) hits can't kill it.
Monster heals now really heal.

### Monster cards as players read them

`src/game/cards/monsterText.js` holds each card's player-facing wording: short constant rules, what each
ability does, each weakness-track step, and the objective, in plain words with icons (👣 moves, 🎲 a die of
damage, ◎ everyone in reach, ✚ heals, ⛓ exhaust, ⌛ a round, numbered site badges). The rules still read the
card text in `monsters.js`, so rewording a card there never changes how it plays. The Field Guide and the
reveal card draw it the same way (`guideDetails` in panels.js): health, toughness and action dice up top;
traits, weak to, immune to; the rules; each ability with the die faces that call it and its damage type in
colour; the weakness track as numbered steps; the objective; and the evidence (Field Guide only).

### The mystery (evidence, Casebook, Field Guide)

Each game secretly draws one monster from the chosen **monster pool** (Game settings → Monster: Mystery,
pools: all, flesh and blood, spirits and shadows, old-world folklore). Its 13 cards live in
`src/game/cards/monsters.js` (transcribed from the physical cards), the evidence names and board looks in
`src/game/cards/evidence.js`, and the rules in `src/game/mystery.js`.

- **Research markers** work like an Evidence Obol: stepping on one lets you choose a face-down Evidence card to
  reveal (once per marker).
- **Evidence Obol:** the investigator chooses one of the remaining face-down Evidence cards (3 Observations +
  1 Lair). It flips for everyone, and the cell they're standing on changes to show it (frost, claw marks,
  blood, howl rings...). A **Lair** transforms its cell for good: an opened grave, a cave mouth, a scorched
  transformation site, a ritual circle, a ruin, a wrecked room, a pit of darkness, each with its own glow
  (`src/render/discoveries.js`).
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
- **Injuries** (tiers add up; tracks are separate; scoreboard pips, and in full under Team):
  Physical: Sprained (one black die disabled, shown crossed out in the tray), Hobbled (−1 movement slot). Mental: Paranoid (−1 defense slot),
  Terrified (teammates within Mid range lose a defense slot). Spiritual: Doomed (defense 6s count as
  1), Hexed (shown; applies once items exist). Tier 3 on any track is **Death's Door**: one die per turn, and any
  unblocked damage **kills**. Dead players leave the board and are skipped; if everyone dies the night wins.
- **Exhaust** (e.g. "Exhaust (Defensive die)"): a slotted die of that type — the one the attack was aimed at, or
  the defender's — disappears for the rest of the game. A black die exhausted this way means that player rolls
  one fewer from then on.
- **The monster's turn.** At the start of each round the monster rolls its **action dice** (the number in the
  top right of its card: Hellhounds 4, Werewolf 3, Shadow People 0...); each die picks an ability, and they
  play **in order** at the end of the round. The banner lists them compactly (tap for the card text and to look
  at the monster) and players in danger get a pulsing red ring
  and an "In danger" tag. The danger updates live as players move. At the end of the round the monster moves
  and rolls its damage. Pursue, Outflank, Retreat, Teleport, Attack, Area Attack, Global Attack and Heal are
  played from the card text (`src/game/monsterTurn.js`); other effects (Seize, Lure, Pin, Drag, Trap, Exhaust,
  Block doors...) are named in the log and come with each monster's own rules.
- **Monsters and doors** (by the body on the card):
  - **Corporeal** monsters are stopped by locked, nailed, chained, boarded and one-way doors, but plan their
    route as if those would give way. Stuck at a door that is the next step toward their prey, they trade any
    queued attack with no one in reach for a **Bash**: one die of Physical damage to the door. Doors have
    **10** health (**12** when chained); at 0 the door is breached, an open doorway for good, for everyone.
    A bashed door shows it: pale splintered gashes across it and splinters on the floor, more the worse it
    gets (1-3 gashes, 2-6 splinters). A locked or one-way door whose Key the investigators have found
    stands open for monsters too (they carry no keys, but the door is unlocked).
  - **Incorporeal** monsters (Poltergeist, White Lady, Shadow People) phase through walls, doors and blocked
    spaces whenever they move.
  - **Semi-Corporeal** monsters (the Barghest) act as Corporeal, but leave a door alone when a later action
    that round teleports them (teleports ignore walls anyway).

### Damage-type colours

Everything tied to a damage type uses one colour and the icon from the monster cards: **Physical red** (claws),
**Mental blue** (brain), **Spiritual green** (skull). That covers the monster's announced actions, the danger
rings under threatened players (cycling colours if several types are coming), the scoreboard "In danger" tag,
injury pips and the Injuries tab, hit pop-ups, the screen-edge flash when something strikes, the Casebook's
Attack card, Field Guide chips and abilities, and the marks Attack cards leave on the board. Each action's type
is the colour of its icon on the card (grey icons have no damage type); a test pins this to the cards.

### Monster figures

Every card monster has its own low-poly figure (`src/render/monsterModels.js`), to scale with the players, with idle
motion: a hunched Werewolf; a smoky black Barghest dragging a chain; a loose pack of fiery Hellhounds, one per
action die; a pelt-draped Skinwalker in an animal skull; a 3 m Wendigo with antlers and ribs; a floating, wailing
Banshee; the Ushi-Oni, an ox head on a broad crab-like shell with splayed legs and two pincers; a knee-high
Redcap with its red cap, iron boots and pikestaff; the Poltergeist as furniture and crockery whirling in a cold
haze; the glowing, veiled White Lady; and a hunched, bald Strigoi in a burial shroud.

- **Adze**: a pulsing cocoon fixed in its Lair, mid-transformation. Its attacks are carried out by **fly swarms**
  that cross any terrain (walls, windows and locked doors stop them). At midnight its three targets ({1}, {5},
  {13}: Hotel, Bar and Infirmary Victim) become **townspeople** placed at Objective markers, each in a different
  building where the map has them. Each Victim action sends a swarm at its townsperson: a player in Close range
  can **defend** them with their slotted defense (at least the damage saves them); otherwise the victim **dies**,
  and every player suffers a Global Attack of one die per dead victim. A dead victim's attacks fall on the next
  living one; with none left, the swarms attack **every player**. The banner lists each victim as guarded or
  unguarded, and targeted victims get red rings.
- **Shadow People**: no body on the board. The darkness around each player standing in an unlit cell ripples
  unnaturally; when a player steps into a lit space, **Umbral Stab** strikes (one die, Physical) and a ring of
  human silhouettes rises around them, reaching for their shadow, then sinks away.
- **Hellhounds** (for later, with monster health): killing a hound sends the whole pack back to the Lair; only
  its weakness reduces the number of hounds.

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
- `look`: which 3D figure to use (`monsterLooks` in `src/play/play.js`; `shade` is the stooped figure with ember
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

## Backlog

`docs/BACKLOG.md` lists every effect that is in the game as data but not played yet (✋ equipment skills,
travel events, monster ability keywords, the weakness effects waiting on Perch and the candle,
objectives other than Kill), grouped by mechanic with the open rules questions.

## Code layout

The code is grouped by job, so a future game build can reuse the map model, rules and 3D board with its own
menus (`src/main.js` explains the same at the top):

- `src/core/` — the map model and file formats. No rendering, runs in Node.
  - `state.js` — the grid: cells, edges, light, movement, landmarks, strokes, undo/redo, JSON.
  - `mapFormat.js` — map files (with optional details), version checks. `saveFormat.js` — saved games.
  - `storage.js` — maps, saves and preferences over a swappable backend. `mapCheck.js` — Ready to play?
  - `scale.js` — metres per cell and the street cross-section.
- `src/game/` — the rules engine: state, actions, monsters, mystery, combat, sessions. No rendering.
- `src/render/` — the 3D board.
  - `scene.js` — renderer, camera, lights, sky, quality presets, shared materials.
  - `board.js` — builds and refreshes the board from the grid. `tileLook.js` — each cell's look.
  - `surroundings.js` — the forest ring, reference house, rain, atmosphere.
  - `terrain.js` (elevation, road and bridge levels), `water.js`, `props.js`, `street.js`, `bridge.js`,
    `clocktower.js`, `landmarks.js`, `markers.js`, `dread.js` (midnight), `monsterModels.js`, `discoveries.js`.
- `src/editor/` — map-building tools: `painting.js`, `placing.js` (premade building preview), `walls.js`,
  `moveCheck.js`, `toolbar.js` (tools, brushes and the tile menu).
- `src/play/` — the play demo: `play.js` (figures, animation, camera), `playView.js` (HUD, dice, clock,
  choices), `panels.js` (evidence, Casebook, Field Guide, Team, Skills and Obolcraft, the dock), `sheets.js` (the dock's sheets),
  `gameSettings.js`.
- `src/app/` — the shell: `config.js` (colours, brushes, `ui` state, the grid, storage), `pointer.js` (mouse
  and touch), `controls.js`, `panelControls.js`, `files.js` (export/import, PNG, dialogs, Ready to play?),
  `shell.js` (shortcuts, info box, counts, autosave), `loop.js` (the frame loop), `dom.js`,
  `gameShell.js` (title screen, New game, save/load, the game menu, My maps; `ui.mode` is
  `'title' | 'editor' | 'game'`, mirrored as `mode-*` classes on `<body>`; `.editor-only` elements hide in
  a game).
- `src/maps/` — built-in maps (map files), made by scripts in `tools/`.
- `src/main.js` — the entry: imports the modules and runs their start-up code in order.
- `src/style.css` — panel styling.

Each module's start-up code sits in an exported `init()` that `src/main.js` calls in a fixed order, and a
module that sets another module's variable does it through a setter (`__set_camTween(...)` and so on), since
ES modules can't assign each other's variables. `npm run lint` (ESLint) flags any name that doesn't resolve,
which is the usual way a refactor like this breaks.

Tiles are a single `InstancedMesh`; each cell's look comes from `cellLook()` in `src/render/tileLook.js`. That's the place
to swap flat colours for textures (road, hardwood, etc.) later. GLTF buildings and props (cars, streetlights)
can be added to the scene with three's `GLTFLoader` and positioned with `cellToWorld(x, y)`.
Bridge assets belong with the decks in `refreshWaterAndBridges()` (`src/render/board.js`): for each bridge cell, `grid.bridgeAxis(x, y)`
gives the span direction, the deck top is at `DECK_TOP`, and the water surface and bed are at `WATER_Y` and
`BED_H`, which is where pylons would stand.
