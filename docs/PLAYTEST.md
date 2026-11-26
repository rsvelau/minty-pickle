# Playtests (bot games)

`node tools/playtest.mjs [games per setup] [monsters|all] [team sizes]` plays whole games headless on
Hawthorn Bend: Scouting, investigating, midnight, the monster's turns, objectives, to a win, a wipe, or
round 60 ("undecided"). It also watches for crashes, stuck games, players or monsters off the board and
impossible health. Add `TRACE=1` for every log line.

**The bot** plays like a cautious beginner: before midnight it walks to the nearest unused marker and
investigates; then it follows the monster's objective script (collect, deliver, upgrade, cleanse,
escape, hold, destroy, defend) or hunts the monster; it fetches a key when its goal is locked away;
it uses any "Use now" skill that hurts the monster (or heals it), crafts heals, keeps a die for Defense
near a monster, moves only as far as it needs, and says yes to investigating, reactions and sacrifices.
It doesn't name the monster early, split up on purpose, or plan around the monster's declared actions.
Follow streets is off for the bot (its routes don't know the road's lanes; every marker is reachable
either way). **Win rates measure this bot, not good players**: read them as relative difficulty.

## Results (2026-11-26, 12 games per monster and team size, 624 games, no anomalies)

| Monster | Team | Win | Loss | Undecided | Avg rounds | Avg dead | Objective done |
|---|---|---|---|---|---|---|---|
| Werewolf | 1 | 0 | 12 | 0 | 17.2 | 1.0 | 0 |
| Werewolf | 2 | 0 | 12 | 0 | 18.1 | 2.0 | 0 |
| Werewolf | 3 | 0 | 12 | 0 | 19.8 | 3.0 | 0 |
| Werewolf | 4 | 1 | 11 | 0 | 19.3 | 3.7 | 0 |
| Barghest | 1 | 1 | 11 | 0 | 22.5 | 0.9 | 1 |
| Barghest | 2 | 6 | 5 | 1 | 24.3 | 1.4 | 6 |
| Barghest | 3 | 12 | 0 | 0 | 21.7 | 1.1 | 12 |
| Barghest | 4 | 11 | 1 | 0 | 22.0 | 1.4 | 11 |
| Hellhounds | 1 | 0 | 12 | 0 | 15.3 | 1.0 | 0 |
| Hellhounds | 2 | 0 | 12 | 0 | 16.8 | 2.0 | 1 |
| Hellhounds | 3 | 0 | 11 | 1 | 24.8 | 2.8 | 0 |
| Hellhounds | 4 | 4 | 7 | 1 | 22.2 | 2.5 | 4 |
| Skinwalker | 1 | 0 | 12 | 0 | 18.3 | 1.0 | 0 |
| Skinwalker | 2 | 0 | 12 | 0 | 23.2 | 2.0 | 0 |
| Skinwalker | 3 | 1 | 11 | 0 | 25.7 | 2.9 | 0 |
| Skinwalker | 4 | 5 | 7 | 0 | 23.5 | 2.3 | 0 |
| Wendigo | 1 | 0 | 12 | 0 | 17.3 | 1.0 | 0 |
| Wendigo | 2 | 0 | 11 | 1 | 21.1 | 1.9 | 0 |
| Wendigo | 3 | 1 | 11 | 0 | 20.0 | 2.8 | 0 |
| Wendigo | 4 | 2 | 7 | 3 | 30.1 | 3.1 | 0 |
| Banshee | 1 | 0 | 12 | 0 | 20.3 | 1.0 | 0 |
| Banshee | 2 | 2 | 9 | 1 | 33.8 | 1.7 | 2 |
| Banshee | 3 | 3 | 9 | 0 | 38.6 | 2.4 | 3 |
| Banshee | 4 | 7 | 4 | 1 | 37.7 | 2.4 | 5 |
| Ushi-Oni | 1 | 0 | 11 | 1 | 26.3 | 0.9 | 0 |
| Ushi-Oni | 2 | 0 | 10 | 2 | 25.3 | 1.8 | 0 |
| Ushi-Oni | 3 | 0 | 7 | 5 | 37.7 | 2.5 | 0 |
| Ushi-Oni | 4 | 2 | 4 | 6 | 40.7 | 2.4 | 0 |
| Redcap | 1 | 0 | 12 | 0 | 18.8 | 1.0 | 0 |
| Redcap | 2 | 0 | 11 | 1 | 24.5 | 1.9 | 0 |
| Redcap | 3 | 1 | 10 | 1 | 26.8 | 2.8 | 0 |
| Redcap | 4 | 1 | 10 | 1 | 26.8 | 3.5 | 0 |
| Poltergeist | 1 | 0 | 12 | 0 | 22.3 | 1.0 | 0 |
| Poltergeist | 2 | 0 | 9 | 3 | 37.3 | 1.8 | 0 |
| Poltergeist | 3 | 0 | 10 | 2 | 42.5 | 2.8 | 0 |
| Poltergeist | 4 | 0 | 8 | 4 | 48.9 | 3.4 | 0 |
| White Lady | 1 | 1 | 11 | 0 | 27.3 | 0.9 | 1 |
| White Lady | 2 | 2 | 4 | 6 | 51.8 | 1.1 | 2 |
| White Lady | 3 | 3 | 1 | 8 | 59.8 | 1.3 | 3 |
| White Lady | 4 | 4 | 1 | 7 | 57.3 | 0.9 | 4 |
| Strigoi | 1 | 0 | 12 | 0 | 24.8 | 1.0 | 0 |
| Strigoi | 2 | 0 | 11 | 1 | 27.3 | 1.9 | 0 |
| Strigoi | 3 | 0 | 9 | 3 | 36.6 | 2.8 | 3 |
| Strigoi | 4 | 1 | 8 | 3 | 36.7 | 3.3 | 3 |
| Adze | 1 | 0 | 12 | 0 | 14.7 | 1.0 | 0 |
| Adze | 2 | 0 | 12 | 0 | 15.0 | 2.0 | 0 |
| Adze | 3 | 0 | 12 | 0 | 15.0 | 3.0 | 0 |
| Adze | 4 | 0 | 12 | 0 | 14.4 | 4.0 | 0 |
| Shadow People | 1 | 0 | 12 | 0 | 15.6 | 1.0 | 0 |
| Shadow People | 2 | 1 | 9 | 2 | 26.3 | 1.8 | 1 |
| Shadow People | 3 | 1 | 8 | 3 | 30.5 | 2.5 | 1 |
| Shadow People | 4 | 0 | 10 | 2 | 22.8 | 3.8 | 0 |

## What stood out
- No crashes, stuck turns, off-board positions or bad health values in 624 games.
- Team size matters a lot: 1% wins solo, 7% with 2, 14% with 3, 24% with 4.
- **Adze: 0%.** The victims only appear at midnight, scattered over the map, and the swarms strike that
  same round: two victims usually die before anyone can reach them, and each death hits everyone
  (die × dead). Wipes by round ~15.
- **Werewolf, Redcap: 2-4%.** Toughness 4 (and 10) against one-die weapons: most hits do 0-2.
- **Strigoi: 2%.** Drain finds the Cosor holder every round and exhausts their best defense die for good
  (a black one costs a die every turn after); the holder is ground down long before the Cosor is blessed.
- **Shadow People: 4%.** Umbral Stab strikes on every lit space entered: one walk down a lit street can
  be several attacks; Defense dice are exhausted once used; candles go out half the time in the dark.
- **Poltergeist: 0% (and 19% undecided).** Anchors need a 6 at each of 4 markers then the Lair.
- **Barghest 62%, White Lady 21% (44% undecided), Banshee 25%:** the objective-driven fights the bot can
  steer toward are the winnable ones. Many White Lady and Ushi-Oni games stall to round 60.
