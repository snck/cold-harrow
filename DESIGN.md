# Coldharrow — design

*A browser game about one long night and one long day on a mountain.*

## The pitch

You run the **Coldharrow Traverse**, a fictional 100 km mountain ultra with
about 4,500 m of
climbing. It starts at **midnight on Friday night** in the village of
Lowmere. You run through the night over a 2,140 m ridge. You see sunrise
(if you get there), then cross a hot, shadeless climb at midday, and with luck
finish on Saturday evening. The cutoff is 28 hours (04:00 Sunday).

One race is one session: 30–45 minutes of play, with about 50 meaningful
decisions.

### Why one overnight race (decision)
I chose one race over a series or a training arc because the emotional arc the
brief asks for (lows, recoveries, temptation to quit, an earned finish) is the
arc of a *single long ultra*. A series would dilute it, and training is a
spreadsheet.

**Why midnight (changed in round 1).** I first chose 22:00. Headless runs showed
that a mid-pack runner then reached the Oven at 10:00, before the heat. With a
midnight start, the witching hour (02:00–05:00: sleepy, cold, dark, climbing)
lands on the night climbs. Sunrise arrives around the Rakes and the ridge. The
Oven is crossed at 12:00–14:30, and the Last Lie comes in the evening. The
course designs its own waves.

## Core loop

1. **Look ahead.** The elevation profile is always visible: aid stations,
   cutoffs, the ridge, the Oven, the Last Lie. Hovering a section tells you
   what it is.
2. **Decide how to run the next section** (2–6 km). Choices:
   * **Effort**: Walk / Easy / Steady / Push. The label changes with the
     terrain. On climbs it reads *Slow hike / Power-hike / Hard hike / Run it*.
     On descents it reads *Walk down / Cautious / Flowing / Bomb it*. Every
     option shows a projected time and cost: energy, legs, water, and fall
     risk on technical ground.
   * **Fuel plan** (sticky): Nothing / Light / Steady / Heavy, in kcal per
     hour taken from your vest.
   * **Water** (sticky): Drink to thirst / Ration.
   * **Quick actions**: jacket on or off, salt capsule, gel now, caffeine,
     music, "Remember why".
3. **Watch it play out.** The runner moves across a side-on landscape. The
   clock runs, the sky changes, and other runners' headlamps bob ahead and
   behind. The animation is only a presentation of results the simulation has
   already computed. It can be sped up or skipped and never asks for input.
4. **Interruptions.** Threshold warnings, encounters, and course features pause
   the run and ask for a decision. After every interruption you choose your
   effort again.
5. **Aid stations.** A menu of actions, each with a time cost: refill, drink,
   eat what's on the table, ice, sit, nap, medic, drop bag, change socks. You
   can also *hand in your bib*. Cutoffs are enforced here.
6. **Finish, DNF, timed out, or evacuated** leads to a race report. It shows
   the body and mind curves over the whole race, annotated, with an
   explanation of what caused your worst moments.

Nothing in the game uses real-time input. The simulation advances only when
the player commits a decision.

## The simulation

Internally the race advances in 100 m steps. Each step computes speed, then
updates every body and mind variable. All numbers live in `js/sim.js`. The
course and text live in `js/course.js`.

### Body (physical)

| Variable | Range | Goes down from | Comes back from | Effects |
|---|---|---|---|---|
| **Energy** (glycogen) | 0–100 (=1,800 kcal) | Carb burn by effort: 150/260/385/610 kcal/h; cold adds more; burn falls as glycogen runs low (fat takes over) | Absorbed food (max ~280 kcal/h) | <25 slows you; <12 is a **bonk**, recoverable by eating and walking |
| **Gut** (food waiting) | kcal | absorption | eating | Overload (>300 kcal waiting) damages the stomach, worse while pushing |
| **Stomach** | 0–100 | gut overload, heat, dehydration, sugar fatigue, pushing while full | easy effort, empty gut, broth/ginger/cola | Low means less absorption, nausea, vomiting |
| **Hydration** | 0–100 (1 pt = 40 ml) | sweat: effort × felt temperature | drinking from flasks / aid cups | Low slows you, hurts the stomach, causes cramps, can lead to collapse |
| **Salt** | 0–100 | sweat | caps, broth, potatoes, crisps | Low leads to cramps and poor fluid absorption |
| **Legs** | 0–100 | climbing, flats, **descents** (eccentric, scaled by grade, effort, technicality) | barely (sitting) | Slower, much slower on descents, higher fall risk |
| **Feet** | 0–100 | distance, descents, **wet socks** (fords, rain) | fresh socks, taping | Hotspot, then blisters, then pain |
| **Core temp** | −100 (hypothermic) … +100 (overheating) | ambient by altitude/time/weather, sun, wind, rain, effort, jacket | jacket, ice, dunking, slowing | Heat: sweat, stomach, speed. Cold: energy burn, morale, hypothermia |
| **Alertness** | 0–100 | circadian low 02:00–05:00, hours awake | sunrise, caffeine, a nap | Falls, wrong turns, hallucinations, morale |
| **Injuries** | ankle 0–3, scrapes | falls on technical ground | medic tape (partly) | Speed, pain; severe means you can't go on |

**Delayed quad damage.** 40% of descent leg damage doesn't land straight
away. It goes into a "pending" pool that resolves over about two hours. The
legs bar shows it as a hatched segment. A runner who bombs the Scree Staircase
at km 41 feels it at km 55. This is the single most important "consequences
arrive later" mechanic, and it matches the real experience of
eccentric-contraction soreness.

Other slow fuses:
* Starting glycogen (1,800 kcal) lets a runner who doesn't eat feel fine for
  3–4 hours, and then they bonk on the ridge.
* Eating everything at once fills the gut. Stomach damage builds over the next
  hour, and nausea arrives later.
* Not changing wet socks from the night fords causes blisters by midday.
* Going into the Oven with 1 litre of water and no sun hat costs you 90
  minutes later, on the Saddleback.

### Mind

* **Morale** (0–100): how you feel now. It relaxes towards a *set point*. The
  set point sags with hours on your feet and follows the body clock: a deep
  trough in the small hours, a lift with daylight, an afternoon slump, and the
  second evening. Every discomfort pulls morale below the set point, each with
  a named cause: hunger, nausea, thirst, sore legs, feet, heat, cold,
  sleepiness, an injured ankle. So do situations: alone in the dark, rain, fog,
  long climbs, pushing, cutoff pressure, being passed. Events kick it up or
  down: summits, sunrise, flow, company, messages from home, false summits,
  falls. When your body is OK it drifts back up on its own, and that is what
  makes "it never always gets worse" true. Low morale slows you, and below 20
  you can't make yourself push.
* **Resolve** (0–100, starts at 60): the will to go on. Every hour of
  suffering wears it down a little (a fraction of the total morale drain), and
  dark places (morale below 35) wear it down fast. Highs only partly refill it:
  sunrise, summits, kindness given and repaid, your reasons, the note from
  home. At zero you hit a **breaking point**: you stop on the trail and must
  find a way to stand up (a reason, sitting it out, or committing to drop at
  the next aid station).

Mental lows are fixed differently from physical lows. Eating fixes a bonk.
Food doesn't fix despair. Mind tools are: **Remember why** (three one-shot
reasons you choose before the start), **company** (run with someone), **music**
(from a drop bag), **caffeine**, **breaking it down** ("just to the next
flag"), a sealed **note from home** (drop bag), and the sunrise.

### Speed
Speed comes from effort, gradient, technicality, darkness (headlamp), legs,
energy, hydration, heat, cold, alertness, morale, injuries, and feet.
* Climbs use an "equivalent flat distance" model (1 km + 100 m of gain ≈ 1.95
  km flat).
* On grades over 8%, running (Steady/Push) gains little over power-hiking but
  costs far more energy and legs. **Power-hiking the steeps is correct**, as
  every ultrarunner learns.
* On descents, effort sets how much you let go. Speed rises a little, but leg
  damage and fall risk rise steeply, especially on technical ground and in the
  dark.

### Fuel and water
Fuel is a *plan*, not a click per gel. That's realistic (runners eat on a
schedule) and it keeps the game from becoming a clicker. The vest holds 1,200
kcal and is restocked at aid stations. Absorption maxes out around 280 kcal/h
and falls with high effort, a bad stomach, heat, and dehydration. "Heavy"
fuelling exceeds absorption: good for climbing out of a bonk, but bad for the
gut if you keep it up. Many hours of sweet gels build **sugar fatigue**.
Savoury aid-station food resets it, as every ultrarunner craving salty
potatoes knows.

Water: drinking to thirst replaces about 85% of sweat, more when you're behind,
until the flasks run dry. Rationing stretches water but costs hydration.
Capacity is 1.0 L, or 1.5 L with the third flask from a drop bag. Besides the
aid stations there are two water points: **Rakes Top** (km 33) and **Hartwell
Spring** (km 68). The aid screen estimates how much the next leg needs in
current conditions against what you can carry.

### Conditions
* **Time of day**: sunrise 06:10, sunset 20:20. Darkness slows technical
  ground and raises fall risk. The headlamp battery lasts about 9 h, and there's
  one spare set.
* **Temperature**: valley temperature follows a daily curve (low at 05:30,
  high at 15:00) with a lapse rate of −6.5 °C per km of altitude. Exposed
  ground adds wind chill at night and sun by day. The Oven is south-facing.
* **Weather** is randomised per race and forecast in the briefing: *Clear and
  hot*, *Mountain fog*, or *Rain overnight*.

## Course

The Coldharrow Traverse, 100 km:

| km | | |
|---|---|---|
| 0 | **Lowmere** start, 00:00 | |
| 3–10 | Witchknee Climb (+720 m), Witchknee Top | |
| 10–14 | Bracken Drop (−530 m), first test of discipline | |
| 14 | **Brackenfold** aid | cutoff 04:30 |
| 14–24 | Valley running, Brack Ford (wet feet at night) | |
| 24 | **Hollin Bridge** aid + drop bag 1 | cutoff 07:00 |
| 24–38 | Coldharrow Woods, the Rakes, **Rakes Top water** (km 33), Coldharrow Ridge to the **Crown** (2,140 m). The witching hour, cold, wind, and sunrise if you're on time. | |
| 41 | **Tarn Hut** aid (high, cold, soup, cots) | cutoff 12:00 |
| 41–52 | **The Scree Staircase** (−700 m, very technical), then Larch Hollow | |
| 52 | **Mill End** aid + drop bag 2, halfway. **The shuttle back to Lowmere leaves from here.** | cutoff 15:00 |
| 52–62 | Millrace Trail, the flow section | |
| 62 | **Fernhollow** aid | cutoff 17:30 |
| 62–72 | **The Oven** (+920 m, south-facing, no shade), Hartwell Spring at km 68 | |
| 76 | **Saddle Bothy** aid | cutoff 21:30 |
| 76–85 | Bothy Descent, Lowford Fields, ford | |
| 85 | **Lowford** aid (last) | cutoff 00:00 Sun |
| 85–93 | **The Last Lie** (+620 m, two false summits), Gallows Edge, where you first see the lights of home | |
| 100 | **Lowmere** finish | cutoff 04:00 Sun (28 h) |

The course is designed so that a mid-pack runner meets the worst things at
the worst times: the night climbs at 02:00–05:00, the Oven at 12:00–15:00, and
the Last Lie in the evening. A fast runner can reach the Crown for sunrise.
The briefing hints that it's worth it, and if you arrive just before dawn the
game offers to let you wait for it on the summit.

## Other runners

* **The field.** 140 simulated runners with ability, pacing style (30% go out
  hot and fade, 50% even, 20% conservative), random bad patches, aid-station
  dwell, DNF chances, and the same cutoffs. They really move: your position
  changes while you sit in a chair, you can see their headlamps on the hill
  ahead, and runners who go out too fast come back to you in the second half.
  Passing and being passed affect morale, and so does leapfrogging the same
  person ("Green Cap again!").
* **Named runners** with short arcs and real decisions:
  * **Tomas Brecken** (bib 88): the rival. Blasts past at the start and dares
    you to go with him. Fades. When you catch him you choose to give him a gel,
    say a word, or pass in silence. That choice decides whether he finishes and
    whether you race or run in together at the end.
  * **Ines Arrabal** (61, her 23rd hundred): the veteran. Offers to climb with
    you in the night. Finds you in a dark patch: "It never always gets worse."
  * **Jonah Pell** (26, first 100K): nervous at the start. You find him
    cramping and in tears in the afternoon. If you stop to help (it costs real
    time), he may come back to carry *you* through your own low.
  * Generic companions (a nurse, a shepherd, a retired postman…) who fall in
    with you for a section at night or in a low.
* Company is mechanical: when you run with someone, your effort follows
  theirs, morale drain halves, and time passes faster.

## Quitting

You can only hand in your bib at an aid station, as in a real race. The game
makes quitting tempting honestly:
* Cutoff projections are shown, so you can see a margin shrinking.
* Continuing in a bad state risks a worse outcome: being **evacuated** from the
  mountain (collapse, hypothermia, a destroyed ankle) is scored and written
  worse than a dignified DNF at a table.
* The aid station computes a "pull" from named reasons: you feel awful, your
  will is fading, your legs or ankle, the next cutoff is close, you're badly
  dehydrated, you promised yourself you'd stop here. The more it pulls, the
  more the screen leans on you: the empty chairs and blankets, the volunteer
  who crouches beside you and says "nobody will think less of you", the
  minibus to Lowmere at Mill End. Handing in your bib needs a second,
  deliberate click, and the confirmation names your reasons.
* There's no automatic lift on arriving at an aid station. You sit down
  *in* your low. Eating and sitting help, but they cost time.
* Sitting has real benefits (morale, resolve) and real costs (time, stiff legs
  when you get up).

## Pillars, and where each is addressed

1. **Struggle comes from your choices.** Every loss has a cause the sim tracks
   and the race report names: delayed quad damage, glycogen, gut overload,
   sugar fatigue, wet socks, and water capacity chosen in a drop bag.
2. **Body and mind are separate.** Two resource families with distinct fixes.
   The bars are grouped and coloured differently. Low points are labelled
   physical or mental in the report.
3. **The course is a character.** A named, hand-shaped course always on
   screen. Day and night text, weather, ridge wind, the Oven, false summits,
   fords, and the lights of home.
4. **Waves.** Regeneration when the body is OK, sunrise, aid stations,
   company, and summits make recovery real. Headless tests check that typical
   runs have a low *and* a recovery.
5. **Quitting is real.** See above.
6. **Joy is earned.** Sunrise, summits, flow, and the finish get full-screen
   moments with a held beat, sky changes, music swells, and writing that
   references *your* race ("you were sick at Fernhollow, and here you are").
7. **Readable.** Projected cost on every option, a "why" tooltip on every bar,
   a narrative log, and a race report with causes.

## Tech

Vanilla JavaScript with classic `<script>` tags, so `index.html` opens directly
from disk with no build step and no network. The simulation (`js/course.js`,
`js/sim.js`) is pure and UMD-wrapped, so Node runs the same code for the
headless playtester (`tools/headless.js`) and the tests (`node --test`).
Canvas 2D does the landscape. WebAudio procedural sound needs no asset files.
`npm run dev` starts a zero-dependency static server for anyone who prefers it.

## Headless verification (summary; full numbers in DEVLOG)

80 races per strategy:

| strategy | finish | median time | notes |
|---|---|---|---|
| sensible (power-hike, cautious technical descents, steady fuel) | 100% | ~20h | top ~26% of the field |
| typical-human (sensible intent, human mistakes) | ~100% | ~20h40 | real low + recovery on the trail in ~75% of runs; tempted to quit in ~75% |
| even-steady (hike hard on every climb) | ~100% | ~20h50 | vomits almost every time |
| out-hard (push the first 30 km) | 100%* | ~23h40 | back of the field; tempted to quit in 88–99% of runs; breaking points |
| heavy-fuel | 100% | ~20h30 | vomits every time |
| never-eat / walk-all / push-all / bomb-descents | 0–5% | | timeouts, collapses, evacuations |

*The bots never quit voluntarily. A human at the aid stations an out-hard
runner reaches would face a strong pull to stop.
