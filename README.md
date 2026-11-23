# Coldharrow

*A browser game about the struggle and joy of trail running.*

You're on the start line of the **Coldharrow Traverse**: 100 km and about 4,500 m of
climbing through fictional mountains, starting at midnight. Run through the night
over a 2,140 m ridge, see the sunrise if you've earned it, cross a shadeless
climb in the afternoon heat, and get home to the village of Lowmere before the
28-hour cutoff. Or hand in your bib at an aid station.

A race takes about 30–45 minutes to play. **Nothing is timed.** Every decision
waits for you as long as you like.

## Running it

**Option 1 (no install):** open `index.html` in a desktop browser (Chrome,
Firefox, Safari or Edge). It works straight from disk: no build, no network,
no accounts.

**Option 2 (local server):**

```
npm install && npm run dev
```

Then open <http://localhost:5173>. (There are no dependencies. `npm run dev` runs
a tiny static server in `tools/serve.js`.)

Your progress is saved in the browser as you play, so you can close the tab and
choose **Continue race** later.

## How to play

1. **Briefing.** Read the forecast. Pack your two drop bags (km 24, in the night,
   and km 52, before the heat), three items each. Choose three *reasons* you're
   here. Each can be used once, when it gets dark.
2. **Each section of trail**, choose:
   * **Effort**: Walk / Easy / Steady / Push. On climbs this reads *Slow hike /
     Power-hike / Hike hard / Run it*. On descents it reads *Walk down / Cautious
     / Flowing / Bomb it*. Every option shows its projected time, its cost
     (energy, legs, hydration, stomach, feet, water drunk) and its fall risk.
   * **Fuel plan**: how much you eat per hour from your vest.
   * **Water**: drink to thirst, or ration.
   * **Quick actions**: gel, salt, jacket and layers, caffeine, music, "Remember why".
3. **Watch it unfold.** Things happen: weather, falls, other runners, the
   sunrise, your stomach, your head. Each one pauses the game and asks you what
   to do. Press **Space** to fast-forward the animation.
4. **Aid stations.** Every action (refill, eat, ice, sit, sleep, medic, drop
   bag, socks) costs minutes. Cutoffs are real. You can also hand in your bib.
5. **Finish** (or don't), and read your race report. It shows your body and mind
   over the whole race and what caused your worst moments.

**Body**: energy, hydration, stomach, legs, feet, core temperature,
alertness. **Mind**: morale (how you feel now) and resolve (your will to go on).
**Hover over any bar to see why it's moving.** Hover over the elevation profile
to look ahead.

Keys: **1–4** effort · **Enter** go / continue · **Space** fast-forward · **Esc**
pause menu · **M** sound.

### Tips from Ines (61, 23 hundreds)
* Power-hike anything you can't see the top of.
* Eat before you're hungry. The race is decided in the first half and felt in the second.
* Go down the Scree Staircase like you're carrying eggs.
* It never always gets worse.

## For developers

```
npm test                                   # rules tests + random-play fuzz (node --test)
node tools/headless.js                     # play 60 races per scripted strategy, print a table
node tools/headless.js --n 200 --only sensible,typical
node tools/headless.js --trace typical --seed 7 [--csv out.csv]   # one race: curves, log, causes
```

| File | What it is |
|---|---|
| `js/course.js` | The course, aid stations, food, drop-bag items, weather, all text data |
| `js/sim.js` | The simulation: body, mind, speed, field of runners, events, aid stations, report. Pure and deterministic per seed. It runs in the browser and in Node. |
| `js/render.js` | Canvas landscape (sky, parallax ridges, the actual course profile, runners, headlamps, weather, mood), elevation strip, report chart |
| `js/audio.js` | Procedural WebAudio: wind, rain, footsteps, birds, cues for moments |
| `js/game.js` | Screens, playback animation, decision panels, aid stations, tooltips, save/continue, report |
| `tools/headless.js` | Scripted strategies and the balance table |
| `tests/sim.test.js` | Rules tests |

`DESIGN.md` has the design. `DEVLOG.md` has the iteration history and the
self-assessment.

All races, places, people and brands are fictional. All assets (graphics and
sound) are generated in code.
