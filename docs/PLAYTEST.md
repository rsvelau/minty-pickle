# Playtests (bot games)

`node tools/playtest.mjs [games per setup] [monsters|all] [team sizes]` plays whole games headless on
Hawthorn Bend: Scouting, investigating, midnight, the monster's turns, objectives, to a win, a wipe, or
round 60 ("undecided"). It also watches for crashes, stuck games, players or monsters off the board and
impossible health. Add `TRACE=1` for every log line.

`BOT=expert` plays a team that knows every rule (not which monster was drawn: that it still works out
from the evidence): it attacks with whatever does the most through toughness, favouring the monster's
weaknesses and the highest die; sizes its Defense to the damage the monster has declared (rolling white
dice from reserve when short); spends spare Obols on Equipment before midnight; and risks naming between
the last two suspects just before midnight. `TUNE='{"werewolf":{"toughness":3}}'` tries card changes for
that run only.

**The bot** (default) plays like a cautious beginner: before midnight it walks to the nearest unused marker and
investigates; then it follows the monster's objective script (collect, deliver, upgrade, cleanse,
escape, hold, destroy, defend) or hunts the monster; it fetches a key when its goal is locked away;
it uses any "Use now" skill that hurts the monster (or heals it), crafts heals, moves only as far as it
needs, fills its Defense slots when the monster's declared actions threaten it (keeping a die to attack
with when it's beside the monster), names the monster as soon as the evidence fits only one, keeps a 6
back for the Poltergeist's anchors, relights candles, stands with an Adze victim a swarm is flying at
(only once the Nest has risen, the nearest bot, never counting on a human seat; one stays on the Nest), and
avoids lit spaces while the Shadow People hunt. It doesn't plan around the monster's declared moves or
play its team as one.
Follow streets is off for the bot (its routes don't know the road's lanes; every marker is reachable
either way). **Win rates measure this bot, not good players**: read them as relative difficulty.

## Results (2026-11-26, improved bot, 12 games per monster and team size, 624 games, no anomalies)

Wins by team size: 18% solo, 41% with 2, 44% with 3, 55% with 4.

| Monster | Team | Win | Loss | Undecided | Avg rounds | Avg dead | Objective done |
|---|---|---|---|---|---|---|---|
| Werewolf | 1 | 0 | 12 | 0 | 17.2 | 1.0 | 0 |
| Werewolf | 2 | 2 | 10 | 0 | 17.2 | 1.8 | 0 |
| Werewolf | 3 | 4 | 8 | 0 | 17.1 | 2.3 | 0 |
| Werewolf | 4 | 6 | 6 | 0 | 17.8 | 2.0 | 0 |
| Barghest | 1 | 9 | 2 | 1 | 19.4 | 0.2 | 9 |
| Barghest | 2 | 12 | 0 | 0 | 21.6 | 0.1 | 12 |
| Barghest | 3 | 12 | 0 | 0 | 17.3 | 0.3 | 12 |
| Barghest | 4 | 12 | 0 | 0 | 13.2 | 0.3 | 12 |
| Hellhounds | 1 | 2 | 10 | 0 | 15.7 | 0.8 | 4 |
| Hellhounds | 2 | 7 | 5 | 0 | 14.5 | 0.8 | 11 |
| Hellhounds | 3 | 7 | 5 | 0 | 15.3 | 2.1 | 12 |
| Hellhounds | 4 | 11 | 1 | 0 | 13.7 | 1.0 | 12 |
| Skinwalker | 1 | 2 | 10 | 0 | 17.3 | 0.8 | 0 |
| Skinwalker | 2 | 5 | 7 | 0 | 19.4 | 1.3 | 0 |
| Skinwalker | 3 | 8 | 4 | 0 | 18.3 | 1.3 | 0 |
| Skinwalker | 4 | 9 | 3 | 0 | 17.5 | 1.5 | 0 |
| Wendigo | 1 | 2 | 10 | 0 | 15.8 | 0.8 | 0 |
| Wendigo | 2 | 6 | 5 | 1 | 20.2 | 1.1 | 0 |
| Wendigo | 3 | 7 | 5 | 0 | 17.8 | 1.3 | 0 |
| Wendigo | 4 | 7 | 4 | 1 | 18.6 | 1.7 | 0 |
| Banshee | 1 | 6 | 5 | 1 | 36.9 | 0.6 | 5 |
| Banshee | 2 | 11 | 1 | 0 | 42.5 | 0.3 | 7 |
| Banshee | 3 | 5 | 3 | 4 | 41.6 | 0.9 | 2 |
| Banshee | 4 | 6 | 3 | 3 | 41.4 | 1.9 | 3 |
| Ushi-Oni | 1 | 0 | 11 | 1 | 21.2 | 0.9 | 0 |
| Ushi-Oni | 2 | 1 | 10 | 1 | 21.6 | 1.8 | 0 |
| Ushi-Oni | 3 | 4 | 8 | 0 | 18.4 | 2.2 | 0 |
| Ushi-Oni | 4 | 7 | 3 | 2 | 25.9 | 2.0 | 0 |
| Redcap | 1 | 0 | 12 | 0 | 18.3 | 1.0 | 0 |
| Redcap | 2 | 2 | 8 | 2 | 26.1 | 1.5 | 0 |
| Redcap | 3 | 4 | 7 | 1 | 25.6 | 2.2 | 0 |
| Redcap | 4 | 6 | 6 | 0 | 20.3 | 2.2 | 0 |
| Poltergeist | 1 | 0 | 12 | 0 | 21.3 | 1.0 | 0 |
| Poltergeist | 2 | 0 | 11 | 1 | 29.8 | 1.9 | 0 |
| Poltergeist | 3 | 5 | 6 | 1 | 25.1 | 1.7 | 5 |
| Poltergeist | 4 | 6 | 6 | 0 | 21.9 | 2.0 | 6 |
| White Lady | 1 | 4 | 5 | 3 | 46.3 | 0.4 | 4 |
| White Lady | 2 | 10 | 0 | 2 | 61.0 | 0.3 | 10 |
| White Lady | 3 | 9 | 2 | 1 | 44.3 | 1.8 | 9 |
| White Lady | 4 | 8 | 2 | 2 | 46.2 | 1.8 | 8 |
| Strigoi | 1 | 0 | 12 | 0 | 20.1 | 1.0 | 5 |
| Strigoi | 2 | 4 | 7 | 1 | 22.4 | 1.3 | 8 |
| Strigoi | 3 | 2 | 9 | 1 | 24.7 | 2.4 | 10 |
| Strigoi | 4 | 4 | 6 | 2 | 29.4 | 2.6 | 11 |
| Adze | 1 | 0 | 12 | 0 | 14.3 | 1.0 | 0 |
| Adze | 2 | 0 | 12 | 0 | 15.1 | 2.0 | 0 |
| Adze | 3 | 0 | 12 | 0 | 14.4 | 3.0 | 0 |
| Adze | 4 | 0 | 12 | 0 | 13.9 | 4.0 | 0 |
| Shadow People | 1 | 3 | 5 | 4 | 41.6 | 0.4 | 3 |
| Shadow People | 2 | 4 | 3 | 5 | 49.3 | 0.9 | 4 |
| Shadow People | 3 | 1 | 3 | 8 | 48.9 | 1.5 | 1 |
| Shadow People | 4 | 4 | 5 | 3 | 38.4 | 2.7 | 4 |

## Bug found and fixed
- **An objective finished before midnight didn't count.** Once the evidence names the monster, its
  objective markers appear and can be done before it rises; finishing one then (holy water to the
  Hellhounds' Lair, a Poltergeist anchor...) was silently ignored, so the monster still rose and
  respawned as if nothing had been done. It now counts (and a monster nothing can wear down is beaten
  by its objective alone, even before it rises).

## What stands out (balance)
- **Adze: 0%.** The victims appear only at midnight, scattered over the map, and the swarms strike that
  same round; two usually die before anyone can reach them, and each death hits everyone (die × dead).
  Every game is a wipe by round ~14, even with someone sent to each victim.
- **Werewolf, Redcap, Ushi-Oni: ~25%.** High toughness against one-die weapons; most hits do 0-2.
- **Strigoi: 21%.** Drain finds the Cosor holder every round and exhausts their best defense die for good.
- **Shadow People: 25%, 42% undecided.** Candles go out half the time in the dark and lit streets are
  dangerous; many games run out the clock.
- **Barghest 94%, White Lady 65%, Banshee 58%, Hellhounds 56%:** the objective fights are the winnable
  ones once the objective can be worked on.

## Expert teams (BOT=expert, 2026-11-26, 12 games per monster and team size)

Overall by monster: Barghest 97%, Hellhounds 72%, Banshee 72%, White Lady 70%, Wendigo 66%, Skinwalker
62%, Redcap 50%, Ushi-Oni 47%, Werewolf 45%, Strigoi 43%, Poltergeist 41%, Shadow People 31%, Adze 0%.
Solo and two-player teams are far behind three and four.

| Monster | Team | Win | Loss | Undecided | Avg rounds | Avg dead | Objective done |
|---|---|---|---|---|---|---|---|
| Werewolf | 1 | 1 | 11 | 0 | 17.0 | 0.9 | 0 |
| Werewolf | 2 | 4 | 8 | 0 | 17.6 | 1.3 | 0 |
| Werewolf | 3 | 10 | 2 | 0 | 15.6 | 0.7 | 0 |
| Werewolf | 4 | 7 | 5 | 0 | 16.7 | 1.8 | 0 |
| Barghest | 1 | 11 | 0 | 1 | 19.1 | 0.0 | 11 |
| Barghest | 2 | 12 | 0 | 0 | 21.6 | 0.1 | 12 |
| Barghest | 3 | 12 | 0 | 0 | 17.4 | 0.3 | 12 |
| Barghest | 4 | 12 | 0 | 0 | 13.1 | 0.3 | 12 |
| Hellhounds | 1 | 3 | 9 | 0 | 15.4 | 0.8 | 4 |
| Hellhounds | 2 | 9 | 3 | 0 | 14.3 | 0.6 | 11 |
| Hellhounds | 3 | 11 | 1 | 0 | 14.1 | 0.9 | 12 |
| Hellhounds | 4 | 12 | 0 | 0 | 13.3 | 0.4 | 12 |
| Skinwalker | 1 | 2 | 10 | 0 | 16.4 | 0.8 | 0 |
| Skinwalker | 2 | 7 | 5 | 0 | 17.2 | 0.8 | 0 |
| Skinwalker | 3 | 10 | 2 | 0 | 15.0 | 0.6 | 0 |
| Skinwalker | 4 | 11 | 1 | 0 | 14.6 | 0.4 | 0 |
| Wendigo | 1 | 2 | 10 | 0 | 15.9 | 0.8 | 0 |
| Wendigo | 2 | 10 | 1 | 1 | 18.5 | 0.3 | 0 |
| Wendigo | 3 | 11 | 1 | 0 | 13.9 | 0.3 | 0 |
| Wendigo | 4 | 9 | 2 | 1 | 18.4 | 1.1 | 0 |
| Banshee | 1 | 8 | 4 | 0 | 39.3 | 0.6 | 7 |
| Banshee | 2 | 11 | 1 | 0 | 42.2 | 0.3 | 7 |
| Banshee | 3 | 9 | 1 | 2 | 33.4 | 0.8 | 3 |
| Banshee | 4 | 7 | 1 | 4 | 36.3 | 1.3 | 2 |
| Ushi-Oni | 1 | 1 | 10 | 1 | 21.8 | 0.8 | 0 |
| Ushi-Oni | 2 | 3 | 8 | 1 | 21.1 | 1.5 | 0 |
| Ushi-Oni | 3 | 10 | 2 | 0 | 16.5 | 0.9 | 0 |
| Ushi-Oni | 4 | 9 | 2 | 1 | 21.4 | 1.3 | 0 |
| Redcap | 1 | 0 | 12 | 0 | 18.0 | 1.0 | 0 |
| Redcap | 2 | 6 | 5 | 1 | 21.6 | 1.1 | 0 |
| Redcap | 3 | 9 | 3 | 0 | 20.4 | 1.3 | 0 |
| Redcap | 4 | 9 | 3 | 0 | 18.3 | 1.3 | 0 |
| Poltergeist | 1 | 0 | 12 | 0 | 21.7 | 1.0 | 0 |
| Poltergeist | 2 | 2 | 10 | 0 | 25.9 | 1.7 | 2 |
| Poltergeist | 3 | 8 | 4 | 0 | 19.3 | 1.0 | 8 |
| Poltergeist | 4 | 10 | 2 | 0 | 13.9 | 0.7 | 10 |
| White Lady | 1 | 6 | 6 | 0 | 42.8 | 0.5 | 6 |
| White Lady | 2 | 10 | 1 | 1 | 59.3 | 0.3 | 10 |
| White Lady | 3 | 9 | 1 | 2 | 45.5 | 1.8 | 9 |
| White Lady | 4 | 9 | 2 | 1 | 45.3 | 1.7 | 9 |
| Strigoi | 1 | 1 | 11 | 0 | 20.2 | 0.9 | 5 |
| Strigoi | 2 | 4 | 7 | 1 | 27.3 | 1.3 | 9 |
| Strigoi | 3 | 8 | 4 | 0 | 20.7 | 1.2 | 10 |
| Strigoi | 4 | 8 | 3 | 1 | 24.8 | 1.6 | 11 |
| Adze | 1 | 0 | 12 | 0 | 16.8 | 1.0 | 0 |
| Adze | 2 | 0 | 12 | 0 | 17.6 | 2.0 | 0 |
| Adze | 3 | 0 | 12 | 0 | 17.5 | 3.0 | 0 |
| Adze | 4 | 0 | 12 | 0 | 17.3 | 4.0 | 0 |
| Shadow People | 1 | 3 | 5 | 4 | 41.6 | 0.4 | 3 |
| Shadow People | 2 | 5 | 4 | 3 | 45.3 | 1.0 | 5 |
| Shadow People | 3 | 2 | 3 | 7 | 48.9 | 1.6 | 2 |
| Shadow People | 4 | 5 | 5 | 2 | 38.4 | 2.7 | 5 |

## Shadow People analysis (expert bot, 40 games per team size)

After fixing a bot stall (a candle snuffed while standing on the Votive Candle Stand: relighting
needs stepping onto the stand, so the bot now steps off first), wins: solo 8, 2p 18, 3p 9, 4p 16 of 40.

- Nearly every death (≈98%) is Umbral Stab. A move along lit streets often triggers 3-4+ stabs in one move;
  four landed stabs kill a healthy investigator outright. Standing in the dark gives 0 defense slots, and
  Defense dice are exhausted once used, so most stabs land at defense 0.
- About a third of all snuffed candles go out at the first stop after they were taken, often on the
  stand itself (the Church is dark).
- Only 28-46% of candles taken reach the Lair.
- 3 players need 4 candles but 2 players only 2: why 3p does worse than 2p.
- The Lair's walking distance from the Church decides most games: under 15 spaces 55% wins, 15-24
  16%, 25-34 20%.

### After the rework (once-a-move Umbral Stab, a safe Church and relighting on the stand, one candle per
### investigator, +1 Defense for a lit candle)

Wins of 40: solo 30, 2p 27, 3p 31, 4p 28 (was 8 / 18 / 9 / 16). Undecided games: 7 of 160 (was 38).
Snuffed at the first stop after taking a candle: ~4% of snuffs (was ~35%). Umbral Stab still causes ~90%
of deaths, now one stab a move. Church to Lair: under 15 spaces 87%, 15-24 79%, 25-34 48% (was 55 / 16 / 20).
The bot also learned to walk to a Nailed Shut door and force it with a 6.

### Memorials as relight points

The two Missing-person memorials (K9, U13) now relight candles (free when starting a turn beside one, or
for an Obol when passing). Wins of 40: solo 31, 2p 28, 3p 31, 4p 33. Free memorial relights: 51-217 per
40 games; paid: 11-40. Church to Lair 25-34 spaces: 61% (was 48%).
Then memorials always cost an Obol (no free relight when starting beside one; Skills offers "Relight the
candle" on your turn beside one). Wins of 40: solo 31, 2p 28, 3p 33, 4p 29. Paid relights: 11-36 per 40 games.

## Stalls (games still going at round 60), expert bot, 40 games × 4 team sizes × 13 monsters

First pass: 47 of 2,080 undecided. Two were bot bugs, now fixed: stopping one space short of a Lair the
monster stands on (holy water and candles never delivered), and spending dice on a Medical Kit with nothing
to heal. Second pass: 25 of 2,080.

| Cause | Stalls | Monsters |
|---|---|---|
| Survivors have nothing that can hurt the monster, and it can't kill them through their Defense | 17 | Redcap 7, Wendigo 6, Adze (2p) 3, Skinwalker 1 |
| A one-of-a-kind objective item dies with its carrier | 7 | White Lady 7 (the Gown, Ring or Finger Bone) |
| Other | 1 | Shadow People |

## After the night limit and Care Packages (expert bot, 40 games × 4 team sizes × 13 monsters)

Undecided: 0 of 2,080 (was 25). Wins 1,365, losses 675, of which 67 (3%) are Lost in the night: Adze solo 12,
Strigoi 18 across sizes, White Lady 12, Redcap 8, Shadow People 6, others 1-4. Adze solo fell to 2 wins of 40
(was 14 before the limit: its solo games ran about 41 rounds).

### Adze solo: 2-health swarms one at a time, Nest toughness 0 (and the solo bot hunts the Nest)

Adze wins: solo 26, 2p 27, 3p 29, 4p 35 of 40. All monsters: 1,389 wins, 651 losses (55 Lost in the night), 0
undecided, 0 anomalies.

### Adze guarding fix (expert bot, 40 games per team size)
Found at the table: once the Adze was named the bots walked to the victims and stood there for the
rest of the game. The guard step started at identification (before the Nest had risen, with no swarms
yet), never finished, and counted a human seat as a guard. Now nobody guards before the Nest rises (they
keep investigating); after it rises the nearest free bot stands only with a victim a swarm is actually
flying at (a human beside the victim covers them), one bot always stays on the Nest, and the rest hunt it.
Test: tests/bot.test.js (a human seat that never moves; no bot may stand still before the Nest rises).

| Team | Before | After |
|---|---|---|
| 1 | 65% | 67% |
| 2 | 67% | 65% |
| 3 | 72% | 75% |
| 4 | 87% | 92% |

The headless numbers barely move, because there all seats are bots and the victims were usually covered
anyway. The big gain is at the table with a human seat: the bots no longer freeze.

### Swarm health 5 → 4 (expert bot, 40 games per team size)
| Team | 5 health | 4 health |
|---|---|---|
| 1 | 67% | 67% (solo swarms have 2 either way) |
| 2 | 65% | 65% |
| 3 | 75% | 78% |
| 4 | 92% | 92% |
Most Fire attacks either light a swarm or don't come close, so one point of health moves little.

## Reload for firearms and crossbows (expert bot, 40 games × 4 team sizes × 13 monsters, before → after)
Guns and crossbows reload instead of 1️⃣ / 🔗 (the Revolver, Rifle and Flare Gun no longer break; the crossbow's
Retrieval is now Flighted Bolt). 0 anomalies, 0 undecided in each run.

| Monster | Solo | 2 | 3 | 4 | Wins ± (of 160) |
|---|---|---|---|---|---|
| Werewolf | 2% → 2% | 18% → 22% | 48% → 58% | 55% → 70% | +12 |
| Barghest | 82% → 82% | 95% → 95% | 98% → 98% | 100% → 100% | +0 |
| Hellhounds | 20% → 22% | 55% → 55% | 90% → 92% | 92% → 92% | +2 |
| Skinwalker | 10% → 18% | 62% → 62% | 85% → 85% | 92% → 92% | +3 |
| Wendigo | 8% → 10% | 40% → 38% | 68% → 70% | 65% → 65% | +1 |
| Banshee | 75% → 75% | 92% → 92% | 92% → 95% | 100% → 100% | +1 |
| Ushi-Oni | 2% → 2% | 20% → 28% | 50% → 55% | 65% → 65% | +5 |
| Redcap | 2% → 0% | 10% → 12% | 45% → 52% | 58% → 65% | +6 |
| Poltergeist | 10% → 10% | 38% → 38% | 75% → 78% | 95% → 95% | +1 |
| White Lady | 62% → 60% | 90% → 90% | 92% → 92% | 95% → 95% | -1 |
| Strigoi | 12% → 12% | 35% → 40% | 68% → 68% | 82% → 85% | +3 |
| Adze | 68% → 75% | 65% → 72% | 78% → 82% | 92% → 92% | +8 |
| Shadow People | 80% → 80% | 68% → 68% | 62% → 62% | 62% → 62% | +0 |

All: 1,251 → 1,292 wins of 2,080 (60% → 62%). The fights decided by damage gain most (Werewolf, Redcap,
Ushi-Oni, the Adze's Nest); objective monsters barely move. Solo hardly changes: one investigator rarely
has the dice to fire and reload as well as move.
