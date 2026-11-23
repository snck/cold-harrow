# Coldharrow — dev log

Tools used for every round:
* `node tools/headless.js`: plays N races per scripted strategy and prints a table (finish rate, times, place percentile, DNF types, % of runs with a real low *and* recovery, median lowest morale, % of runs where an aid station made quitting tempting, bonk/vomit rates, falls, legs at the end).
* `node tools/headless.js --trace <strategy> --seed N`: one race with body and mind curves every 2 km, sparklines, the narrative log, and the cause breakdown.
* `npm test`: rules tests plus a random-play fuzz.
* A real browser (an in-app preview) to look at every screen and play.

Strategies: `sensible` (power-hike climbs, cautious technical descents, steady runnable, steady fuel, salt, layers, reasons when low), `even-steady`, `out-hard` (push the first 30 km), `out-hard-adapts` (same, but switches to sensible after the first bonk or stomach trouble), `never-eat`, `walk-all`, `bomb-descents`, `heavy-fuel`, `push-all`, `easy-all`, `no-body-care` (no salt, no layers, no reasons, bold event choices), `quits-when-tempted`, `random`, and later `typical-human` (sensible intent with human sloppiness: 25% of sections one effort too hard, random fuel changes, forgets salt or jacket half the time, mixed event choices, sits in chairs).

---

## Round 0: design

Wrote `DESIGN.md`. Key decisions:
* **One overnight 100 km race** as the session. The single-race arc *is* the emotional arc, and a series would dilute it.
* **Effort per section, not per step.** About 23 sections, 8 aid stops, and ~20 interruptions gives about 50 real decisions in 30–45 minutes.
* **Fuel and water as sticky plans.** A per-gel clicker would make it a spreadsheet. A plan you revisit at each decision is closer to how runners actually eat.
* **Two mind resources.** Morale (now) and Resolve (reserve). This lets a low point be physical, mental, or both, each with different fixes.
* **Delayed eccentric quad damage.** This is the main "consequence arrives hours later" device.
* **Vanilla JS, no build.** The same sim file runs in Node for the headless player and tests.

## Round 1: first headless runs (sim only, no UI)

**What was wrong**
1. Sensible play took **25h10** and the field was absurdly slow (26 finishers of 140). Night technical penalties and climb costs were too harsh.
2. **Morale pinned at 100 for 70% of the race.** It was a flat arc, exactly what the brief warns against. Small gains (aid stations, passing people, "finding a rhythm") outweighed all drains.
3. The stomach **death-spiralled** from aid-station meals: overload threshold too low, absorption crippled, no recovery path.
4. With a 22:00 start, a mid-pack runner reached the Oven at 10:00, *before* the heat. The course's "worst things at the worst times" premise didn't hold.

**What I changed**
* Faster flat speeds, gentler climb equivalence, less night penalty: sensible now finishes in about 20h.
* **Moved the start to midnight.** The witching hour now lands on the night climbs (km 15–30), sunrise around the Rakes and the ridge, the Oven at 12:00–14:30, and the Last Lie in the evening.
* **Rebuilt morale** as a value that relaxes towards a set point that sags with hours on your feet. Discomforts pull below it and events kick it. This makes recovery automatic once the body is fixed ("it never always gets worse").
* Raised the gut overload threshold, added a slow gut emptying while walking, and made the fuel plan self-limit when the stomach is full.

## Round 2: making failure meaningful and varied

**What was wrong**
1. Every reckless strategy ended in **dehydration collapse and evacuation**. Bonked runners walk slowly between aid stations and run dry. That's real, but there was no way out: no water meant an automatic evac.
2. Once glycogen hit zero it **never recovered**. Out-hard runners walked 60 km on empty. Real runners recover because the body leans on fat at low glycogen.
3. `even-steady` beat `sensible`. Fuel was so plentiful that hiking hard on every climb had no cost.
4. Leapfrog messages fired several times per kilometre (spam).
5. Thirst didn't drive extra drinking, so recovery from dehydration was impossible even with full flasks.

**What I changed**
* Collapse now offers "ask the next runner to share their water" (20 minutes in the dirt). A second collapse below 6% hydration is terminal.
* **Fat shift:** carb burn scales down as glycogen falls below 50, so walking and eating brings you back. A bonk is now a 30–90 minute hole, not a death sentence.
* Higher carb burn at Steady/Push. Lower plan rates so "Steady" fuel (230 kcal/h) roughly matches absorption.
* Leapfrog messages: once per runner, at most one every 2.5 hours.
* Drinking to thirst increases when you're behind on fluid.
* Added a finish-line cutoff check (a 29-hour "finish" was being counted).

## Round 3: the emotional arc

**What was wrong**
1. Sensible runs had **no real low**: median lowest morale 47–54. Passing runners, wildlife, flow, summits and aid arrivals added about 12 morale per hour.
2. **Resolve never moved.** Kindness, summits and sunrise filled it to 100 before any low arrived, so the breaking point could never happen.
3. **Quitting was never tempting** for a sensible runner. The aid station gave an instant morale lift on arrival, so you never sat down in your low.
4. A browser playtest found the **17 km / 1,700 m climb from Hollin Bridge to Tarn Hut with only 1 litre** left runners dry halfway up. That's a course design flaw, not a decision.

**What I changed**
* Smaller positive nudges, which fade faster above the set point. A stronger night: the witching hour, alone in the dark, sleepiness. Cola caffeine halved. A heavier heat drain.
* **Resolve redesigned:** every hour of suffering wears it down a little, dark places wear it fast, and highs only partly refill it.
* Aid stations no longer lift you on arrival. Food and sitting down do. The DNF "pull" is now computed from named reasons ("you feel awful", "your will is fading", "the next cutoff is close", "your ankle"…) and shown to the player.
* Added **Rakes Top water point** (km 33). Sweat is lower in the cold.

**Result after round 3** (60–80 races per strategy):

| strategy | finish | median | place | real low + recovery | tempted (≥0.4) |
|---|---|---|---|---|---|
| sensible | 100% | 20h04 | top 28% | 58% | 15% |
| typical-human | 100% | 20h41 | top 34% | 57–65% | 73% |
| even-steady | 100% | 20h42 | 35% | 20% | – |
| out-hard | 100% | 23h30 | 72% (back of field) | 63% | 83% |
| heavy-fuel | 100% | 20h51 | 38%, vomits every time | 48% | – |
| never-eat | 0% (timeouts / evac, breaking point in 58/60) | | | | 100% |
| walk-all | 0% (timeouts) | | | | |
| bomb-descents | 0–3% (legs to zero, falls, evac) | | | | |

The field: 71–75% of 140 runners finish, winner ~15h30, median ~21h, last ~27h45.

Lowest points for typical runs are spread between the night (km 20–40) and the last climb (km 85–100). That's what I wanted: two waves, not one long slide.

Open concerns going into the human playtest:
* The scripted strategies never quit voluntarily, so out-hard "finishing 100%" overstates it. A human in that state would face a 0.6–0.9 temptation at most aid stations.
* `no-body-care` is as fast as `sensible`. Body care shows up as morale (storm-night minimum 22 vs 35) and temptation, not time. I think that's honest (a jacket doesn't make you faster), but I'll check it in play.

## Round 4: first full human playthrough (browser, storm night)

I played a whole race as a careful first-timer: storm forecast, jacket on early, warm layer and poles in the Hollin Bridge bag, power-hiking, cautious descents. Then mistakes a real person makes: I ran the Scree Staircase "Flowing", ignored a hotspot, never took the night layers off, and ate a bowl of pasta before running steady.

**What felt right**
* The night was miserable. Rain, sleepiness and climbing took morale to **30 at 05:16**, just as Ines appeared on the climb. Saying yes felt like relief, not optimisation.
* Hollin Bridge at 04:41, morale 33: *"A volunteer crouches beside you. 'You can stop here, you know.'"* I hovered over "Hand in your bib". That's the moment the design is for.
* Sunrise, then the Crown, took morale from 30 to 78 in three hours. The curve in the race report shows a clear wave.
* Mistakes came back later and could be traced. The pasta showed up as "Stomach: too much food at once 54" in the report, and the layers as "core temp 52 / hot" at Mill End. The Scree descent showed as the biggest line under "where your quads went".
* Jonah, whom I'd helped at km 58, came back on the Last Lie with "My turn." That landed better than any stat change.
* Finished 20h48, 42nd of 101. Position went from 125th at km 3 to 42nd by patient running: the classic second-half ultra experience.

**Bugs and problems found, all fixed**
1. An event exactly at a section's end produced a pointless "0 km left" decision. The game now carries straight on.
2. **Wrong turns fired twice within 1 km.** Per-step probabilities were 10× too high. Wrong turns, hallucinations, strangers and cramps now have realistic per-km rates and cooldowns. This *lowered* the typical-run low rate, which showed those random negatives had been propping up the arc. I fixed that properly: the set point sags slightly faster, so lows come from the race, not from dice.
3. The same fox appeared three times in 35 minutes. Wildlife lines no longer repeat and need 6 km between them.
4. The sunrise text ignored heavy rain, so I added a grey, rainy dawn ("it doesn't so much get light as less dark").
5. You couldn't change layers at aid stations, which is exactly where you'd do it. Added "Take your layers off" and "Put a layer on".
6. **Ice on a cool day pushed core temperature to −34.** Ice and dunking now only remove heat you actually have.
7. Heavy food (pasta, pizza, porridge) now always warns "walk out to let it settle", not only when the stomach is already bad.
8. Three identical "Remember why…" buttons became "Remember: Dad", "Remember: the sunrise" and so on.
9. The "Second night" event fired 2.5 km from the finish. It's now suppressed after km 94.
10. Finish: the "Running…" bar stayed visible, the HUD said "Finish in 2.0 km", and **morale crossed the line at 44**. The finish now gives the biggest lift of the race (morale and resolve to full), and the finish text tells your own story: lowest point, falls, vomiting, who ran with you.
11. The report contradicted itself. Ines "waited at the line" though she finished after me, and Tomas "finished arm in arm" though I'd left him. Both are now consistent with what happened. The "Your race" list drops wildlife clutter and marks the lowest point.
12. The Tomas text said "the first 18 kilometres" (a formula bug).

## Round 5: second human playthrough (clear and hot, deliberately reckless)

I played as the runner the game should punish. I went with Tomas at km 1, pushed every section, bombed the descents, ran a light fuel plan, chose "keep going, it'll pass" at the bonk, and packed headphones instead of a sun hat and third flask for a 30°C day.

**What happened (and why it's right)**
* **10th place at km 14**, running with the fast crowd. It felt great, and that's the trap.
* **Bonk at 04:14, km 28** (4 hours in), then three dark patches in 90 minutes on the Rakes that burned all three reasons. 10th fell to 113th by Tarn Hut.
* At Tarn Hut: morale 19, energy 8, hydration 39, and a projection that I'd reach Mill End **36 minutes after its cutoff**. The volunteer's "you can stop here" was a rational option, not a guilt trip. I ate and drank. The projection changed to **2h28 spare** in front of me, and I chose "Not yet". Fixing the body visibly reopens the race.
* I left Mill End at midday with 1 litre, and **collapsed with dehydration at km 61.8**. A stranger shared her water, then came the breaking point and 15 minutes on a rock. I left Fernhollow still badly dehydrated, and was **evacuated from the Oven at 17:10**.
* The race report traced it all: "You raced the first half hard (10 sections at Push)", "Bracken Drop (Bomb it): 15", the energy line falling at km 28 and never recovering, then hydration.

**Problems found and fixed**
1. A first-timer couldn't see *before* leaving that the next leg needs more water than they can carry. Every aid station and water point now says, for example: "the next 6 km to Hartwell Spring (~1h22) needs about **1.4 L** in these conditions. You can carry **1.0 L**. You will run dry."
2. The aid screen didn't shout about a dehydrated or bonked runner. It now lists ⚠ warnings (dehydrated, running on empty, stomach in revolt, overheating, cold, falling asleep with camp beds available, feet with a medic present), and dehydration and an empty tank count as reasons in the "pull" to quit. Drink cups are raised to 4 per stop.

## Round 6: final balance pass

**What was wrong**
1. Adding the finish-line lift made the headless "low + recovery" metric trivially true: crossing the line "recovered" every low. I now measure recovery on the trail only.
2. With honest measurement, the **lowest point was almost always the last 20 km**. Morale's set point sagged in a straight line, so the late race always won. There were waves, but not the shape I wanted.

**What I changed**
* The set point now follows the **body clock**: a deep trough in the small hours, a lift with daylight, an afternoon slump, the second evening, plus a gentler fatigue slope. The separate "witching hour" drain was reduced to match.
* Variety for the generic flow lines.

**Final numbers** (80 races per strategy, 141 starters, mixed weather; `node tools/headless.js --n 80`):

| strategy | finish | median | place | real low + trail recovery | tempted (≥0.5) | notes |
|---|---|---|---|---|---|---|
| sensible | 100% | 20h00 | top 26% | 33% | 14% | the disciplined bot rarely goes below 35 morale |
| typical-human | 100% | 20h41 | top 35% | **75%** | 48% (≥0.4: 75%) | lowest point: night 28/80, late race 49/80 |
| no-body-care | 100% | 19h47 | 25% | 90% | 30% | lowest point at **night** in 70/80 runs (no jacket) |
| even-steady | 100% | 20h49 | 38% | 25% | 30% | vomits 98% |
| out-hard | 100%* | 23h42 | 76% | 44% | 79% (≥0.4: 88%) | bonk 38%, vomit 93%, **11/80 breaking points** |
| out-hard-adapts | 100% | 22h15 | 58% | | | recovering after the bonk still costs ~2h |
| heavy-fuel | 100% | 20h32 | 35% | | | vomits 100% |
| easy-all | 100% | 21h05 | 40% | | | safe but slow |
| quits-when-tempted | 86% | 19h59 | | | | 11/80 hand in their bib |
| never-eat | 0% | | | | | evacuated or timed out, breaking point almost always |
| walk-all | 0% | | | | | timed out every time |
| bomb-descents | 3% | 27h36 | | | | legs to zero, ~1 fall per race, evacuated |
| push-all | 0% | | | | | |
| random | 0% | | | | | |

Field: 71–75% of 140 runners finish; winner about 15h30–16h45, median about 21h10, last about 27h30.

`npm test`: 18 tests, all passing. They cover course consistency, determinism, the power-hike vs run trade-off, delayed quad damage, gut overload, bonk timing and recovery, rationing, the jacket, morale recovery, resolve and the breaking point, a 25-race random-play fuzz (every decision has an enabled choice, every race terminates, reports build), cutoffs including at the finish, DNF only at aid stations, estimate sanity, field plausibility, strategy ordering, and the typical-run arc.

---

## Self-assessment against the definition of done

**☑ I can play a full session from start line to finish (or DNF) with no bugs or dead ends.**
I played two complete races in the browser: one finish (20h48, 42nd/101) and one evacuation. I also played to the DNF confirmation dialog, continued after "Not yet", and resumed a saved race after reloading the page several times mid-race. The random-play fuzz test plays 25 more races through every outcome type (finish, DNF, timeout, evac) and asserts that every decision offers an enabled choice and every race ends. Fourteen bugs found in play are listed in rounds 4 and 5, all fixed.

**☑ At no point does anything depend on reaction speed.**
The simulation advances only inside `TrailSim.act()`, which is called only from a click or key press (`js/game.js`). The animation is a playback of frames the sim has already computed, so it can be fast-forwarded (Space) or slowed, and it never asks for input. Moments fade in their choices after about a second, but nothing ever expires. The pause menu says so: "Nothing happens while this is open."

**☑ Wise pacing and fuelling are clearly rewarded, reckless play clearly punished, but not instantly.**
Sensible: 100% finish, ~20h, top quarter. Going out hard: ~3h40 slower, back of the field, 88% tempted to quit. Never eating, walking everything, bombing descents, pushing everything: 0–3% finish. The punishments arrive late. The out-hard bonk comes 4 hours in. Bombing the first descent at km 10 shows up in the report from km 41 onward. Quad damage is partly delayed by design, with a hatched "still arriving" segment on the legs bar. Gel overload builds over 1–3 hours. Wet socks from night fords cause the hotspot hours later. Leaving Mill End with 1 litre collapses you 2 hours later. Every one of these is named in the race report.

**☑ A typical run has at least one genuine low point and one genuine high.**
Headless: 75% of typical-human runs drop below 35 morale and recover by 25+ points *on the trail* (not counting the finish). Highs: sunrise (+20–36), the Crown, flow, company, Gallows Edge, and the finish. In my storm playthrough morale went from 30 at 05:16 to 78 at the Crown three hours later. The race-report chart shows the waves.

**☑ At least once in a typical run, quitting feels like a real temptation.**
75% of typical runs reach an aid station with a pull of 0.4 or more ("There is a row of empty chairs, and blankets… you notice them"), and 48% reach 0.5 or more ("A volunteer crouches beside you…"). The pull is built from real, named reasons, including cutoff projections that can genuinely say "36 min late". In both playthroughs I was at an aid station deciding whether to stop: Hollin Bridge at 04:41 in the rain, and Tarn Hut in the bad race.

**☑ Other runners make the race feel alive, not decorative.**
140 simulated runners with their own pacing styles, fades, bad patches and DNFs. Your position changes while you sit at an aid station ("the field keeps moving"). Headlamps string up the climbs at night. Runners who went out too fast come back to you: 125th to 42nd in my first race. Leapfrog partners get noticed. Named runners have arcs with real choices and consequences: Ines climbs with you in the dark and finds you in a low; helping Jonah costs 12 minutes and he comes back with "My turn"; Tomas's fate depends on whether you shared food; strangers offer company. Company is mechanical: morale drains half as fast and the set point rises, at the cost of matching their pace.

**☑ A trail runner would recognise the situations and decisions as real.**
Power-hiking steep climbs, the cost of running them, and the eccentric quad damage of descents. Bonks and how you recover from them. Absorption limits, too many gels, craving salty food, GI trouble that comes from eating while pushing or in heat. Hotspots, taping, fresh socks after fords. Wind chill on an exposed ridge, layering. The 03:00–05:00 low. Sunrise as a reset. Caffeine timing. Camp-bed naps. Hallucinations. Wrong turns at night. False summits. Being passed in the first 10 km and passing people in the last 40. "Beware the chair" (stiff legs after long stops). Drop-bag planning against the forecast. Cutoffs as departure times. Dot-watchers' messages. The minibus at halfway. I've kept the numbers inside plausible ranges: about 280 kcal/h absorption, 0.5–1.5 L/h sweat, 450–600 m/h power-hiking, field finish rate around 73%.

**☑ A first-time player can learn how to play within a couple of minutes.**
A one-screen How to play page. Sensible defaults in the briefing, so you can click straight to the start line. Two contextual tips on the first decision and first aid station. Every effort card states time, cost and fall risk in plain words. Every bar explains itself on hover, with recent causes. Warnings interrupt in plain language with suggested fixes. Keyboard shortcuts are shown.

**☑ Finishing a hard race feels like an achievement, and you'd want to try again.**
The finish is the biggest moment in the game: sky flash, bells, morale and resolve filled, and text that retells *your* race (lowest point, falls, being sick, who walked with you, who you helped). Then a report with your curves, causes, place, and the fates of the people you met. Personal best is saved. You can immediately run "Same conditions again" (same seed and weather) or "Race again" (new conditions). Because place, time, the sunrise on the Crown, and the people you can help all depend on choices, there's an obvious reason to go again.

### Known weaknesses I chose not to fix
* **The scripted bots never quit voluntarily**, so "finish %" for bad strategies overstates what a human would do. I report temptation separately and include a `quits-when-tempted` bot.
* **A perfectly disciplined player gets a gentler race** (lowest morale ~36, low + recovery in 33% of runs). I think that's honest (good pacing *does* make ultras feel better), but it means the emotional arc depends on the player making some mistakes or meeting bad weather. Most first-time players will.
* **Evacuation by dehydration is the most common failure for truly terrible play.** It's realistic and always traceable. Every dehydration has warnings, a "share water" lifeline and aid-station advice. Still, a broader mix of failure modes (more injuries, more voluntary drops) would be richer.
* **Named runners are partly scripted.** Their encounters trigger in km windows rather than emerging from their simulated positions, and their finish times in the report are approximate.
* **Art is deliberately simple**: stick-figure runners, procedural ridges. Atmosphere comes from sky, light, weather, headlamps and the mood desaturation.
* **Sound** is procedural and minimal (wind, rain, footsteps, birds, chords for moments, bells at the finish). I verified it runs without errors in the browser, but I couldn't listen to it, so its mix is reasoned rather than tuned by ear.
* One race only, with three weather variants. More courses would help replay, but I preferred to make one course a character.
* Desktop only (as required). Narrow windows are usable but cramped.
