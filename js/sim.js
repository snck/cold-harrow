/* Coldharrow — race simulation. Pure, deterministic given a seed, no DOM.
 * Runs in the browser (window.TrailSim) and in Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./course.js'));
  else root.TrailSim = factory(root.TrailCourse);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // ------------------------------------------------------------------ constants
  const STEP = 0.1; // km
  const EFFORTS = ['walk', 'easy', 'steady', 'push'];
  const INTENSITY = { rest: 0.2, walk: 0.45, easy: 0.62, steady: 0.78, push: 0.95 };
  const CARB_BURN = { rest: 90, walk: 150, easy: 260, steady: 385, push: 610 }; // kcal/h from glycogen
  const FLAT = { walk: 5.3, easy: 8.7, steady: 10.5, push: 12.5 }; // km/h on flat smooth trail
  const DESC = { walk: 5.0, easy: 8.2, steady: 10.6, push: 13.4 };
  const LEG_UP = { walk: 0.5, easy: 0.8, steady: 1.0, push: 1.7 };
  const LEG_DOWN = { walk: 0.35, easy: 0.62, steady: 1.0, push: 2.3 };
  const FALL_EFF = { walk: 0.3, easy: 0.6, steady: 1.0, push: 2.6 };
  const FUEL = { none: 0, light: 140, steady: 230, heavy: 360 }; // kcal/h plan
  const ABSORB_INT = { rest: 1, walk: 1, easy: 1, steady: 0.85, push: 0.55 };
  const KCAL_PER_PT = 18; // energy 100 = 1800 kcal glycogen
  const ML_PER_PT = 0.04; // hydration point = 40 ml
  const FOOD_MAX = 1200;
  const SALT_CAPS_MAX = 6;
  const SUNRISE = 370, SUNSET = 1220; // clock minutes
  const FIELD_SIZE = 140;

  const LABELS = {
    climb: { walk: 'Slow hike', easy: 'Power-hike', steady: 'Hike hard', push: 'Run it' },
    descent: { walk: 'Walk down', easy: 'Cautious', steady: 'Flowing', push: 'Bomb it' },
    runnable: { walk: 'Walk', easy: 'Easy jog', steady: 'Steady run', push: 'Push' }
  };
  const HINTS = {
    climb: {
      walk: 'Recover while climbing. Slow, but cheap on everything.',
      easy: 'Hands on knees, steady breathing. What experienced runners do on steep ground.',
      steady: 'Hard hiking, jogging where it eases. Faster, but it costs energy.',
      push: 'Running a climb this steep is barely faster than hiking and burns far more.'
    },
    descent: {
      walk: 'Spare your quads completely. Slow.',
      easy: 'Small steps, brakes on. Low fall risk, gentle on the legs.',
      steady: 'Let gravity help. Quads take real damage on steep ground.',
      push: 'Fast and fun now. Heavy quad damage that you will feel later, and fall risk.'
    },
    runnable: {
      walk: 'Walk it. Recover, eat, let the stomach settle.',
      easy: 'Conversational pace. Sustainable for a very long time.',
      steady: 'Honest running. Good speed, steady cost.',
      push: 'Racing pace. Fast now, expensive later.'
    }
  };

  // ------------------------------------------------------------------ helpers
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  function mulberry(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rand(s) {
    s.rng = (s.rng + 0x6D2B79F5) | 0;
    let t = Math.imul(s.rng ^ (s.rng >>> 15), s.rng | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length) % arr.length];
  function clockOf(t) { return ((C.START_CLOCK + t) % 1440 + 1440) % 1440; }
  function clockStr(t) {
    const c = Math.round(clockOf(t));
    return String(Math.floor(c / 60) % 24).padStart(2, '0') + ':' + String(c % 60).padStart(2, '0');
  }
  function durStr(min) {
    const neg = min < 0; min = Math.abs(Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    return (neg ? '−' : '') + (h ? h + 'h' + String(m).padStart(2, '0') : m + ' min');
  }

  // ------------------------------------------------------------------ course geometry
  const P = C.PROFILE;
  function elevAt(km) {
    if (km <= P[0][0]) return P[0][1];
    for (let i = 1; i < P.length; i++) {
      if (km <= P[i][0]) {
        const [k0, e0] = P[i - 1], [k1, e1] = P[i];
        return e0 + (e1 - e0) * (km - k0) / (k1 - k0);
      }
    }
    return P[P.length - 1][1];
  }
  function sectionIndexAt(km) {
    for (let i = 0; i < C.SECTIONS.length; i++) if (km < C.SECTIONS[i].to - 1e-9) return i;
    return C.SECTIONS.length - 1;
  }
  function nodeAt(km) { return C.NODES.find((n) => Math.abs(n.km - km) < 1e-6) || null; }
  function nextAid(km) { return C.NODES.find((n) => n.km > km + 1e-6 && (n.type === 'aid' || n.type === 'finish')); }
  function sectionKindLabel(sec) { return sec.kind === 'ridge' ? 'runnable' : sec.kind; }
  // equivalent-flat km, cumulative, for projections
  const EQ = (function () {
    const arr = [0];
    for (let i = 1; i <= 1000; i++) {
      const a = (i - 1) * STEP, b = i * STEP;
      const dz = elevAt(b) - elevAt(a);
      const sec = C.SECTIONS[sectionIndexAt(a + 0.05)];
      arr.push(arr[i - 1] + STEP + Math.max(0, dz) / 100 + Math.max(0, -dz) / 100 * 0.25 + STEP * sec.tech * 0.4);
    }
    return arr;
  })();
  const eqAt = (km) => EQ[clamp(Math.round(km / STEP), 0, 1000)];
  const TOTAL_GAIN = (function () { let g = 0; for (let i = 1; i < P.length; i++) g += Math.max(0, P[i][1] - P[i - 1][1]); return Math.round(g); })();

  // ------------------------------------------------------------------ environment
  function daylight(clock) {
    const a = SUNRISE - 35, b = SUNSET + 35;
    if (clock < a || clock > b) return 0;
    if (clock < SUNRISE + 35) return smooth((clock - a) / 70);
    if (clock > SUNSET - 35) return smooth((b - clock) / 70);
    return 1;
  }
  function sunHeight(clock) { // 0..1
    if (clock <= SUNRISE || clock >= SUNSET) return 0;
    return Math.sin(Math.PI * (clock - SUNRISE) / (SUNSET - SUNRISE));
  }
  function valleyTemp(w, clock) {
    const tMinAt = 330, tMaxAt = 900;
    if (clock >= tMinAt && clock <= tMaxAt) {
      const x = (clock - tMinAt) / (tMaxAt - tMinAt);
      return w.tMin + (w.tMax - w.tMin) * (1 - Math.cos(Math.PI * x)) / 2;
    }
    const cc = clock < tMinAt ? clock + 1440 : clock;
    const x = (cc - tMaxAt) / (tMinAt + 1440 - tMaxAt);
    return w.tMax - (w.tMax - w.tMin) * (1 - Math.cos(Math.PI * x)) / 2;
  }
  const inWin = (wins, t) => wins.some(([a, b]) => t >= a && t <= b);
  function weatherOf(s) { return C.WEATHER.find((w) => w.id === s.weather) || C.WEATHER[0]; }
  function envAt(s, km, t) {
    const w = weatherOf(s);
    const sec = C.SECTIONS[sectionIndexAt(km)];
    const elev = elevAt(km);
    const clock = clockOf(t);
    const light = daylight(clock);
    const sh = sunHeight(clock);
    const rain = inWin(w.rain, t) && elev > 450;
    const fog = inWin(w.fog, t) && elev > 1000;
    const air = valleyTemp(w, clock) - 6.5 * (elev - 400) / 1000 - (rain ? 2 : 0);
    const sunLoad = sh * (1 - w.cloud) * (fog ? 0.2 : 1) * (sec.sunny || (0.4 + 0.6 * sec.exposed)) * (1 - 0.7 * sec.forest);
    const wind = w.wind * sec.exposed * (elev > 1500 ? 1.4 : 1);
    return { sec, elev, clock, light, dark: light < 0.4, rain, fog, air, sunLoad, wind, night: light < 0.2 };
  }

  // ------------------------------------------------------------------ race creation
  function defaultDrops() { return { hollin: ['warm', 'caffeine', 'poles'], mill: ['sunhat', 'flask', 'socks'] }; }

  function newRace(opts) {
    opts = opts || {};
    const seed = (opts.seed == null ? Math.floor(Math.random() * 2 ** 31) : opts.seed) >>> 0;
    const r = mulberry(Math.imul(seed ^ 0xA5A5A5, 2654435761) >>> 0); r(); r();
    const weather = opts.weather || C.WEATHER[Math.floor(r() * 10) < 4 ? 0 : Math.floor(r() * 10) < 6 ? 1 : 2].id;
    const reasons = (opts.reasons || ['dad', 'cant', 'sunrise']).map((id) => {
      const rr = C.REASONS.find((x) => x.id === id) || C.REASONS[0];
      return { id: rr.id, text: rr.text, short: rr.short, used: false };
    });
    const s = {
      v: 1, seed, rng: seed ^ 0x51ED, weather,
      t: 0, km: 0, sec: 0, phase: 'section',
      effort: 'steady', fuel: 'steady', ration: false,
      b: { energy: 100, gut: 0, sugar: 0, hyd: 100, salt: 100, stomach: 100, legs: 100, legsPending: 0, feet: 100,
        heat: 0, alert: 64, caffeine: 0 },
      m: { morale: 70, resolve: 60 },
      inj: { ankle: 0, scrapes: 0, ankleTaped: false, feetTaped: false },
      kit: { food: 900, salt: 4, caffeine: 0, rice: 0, water: 1.0, waterCap: 1.0, layers: 0, warm: false,
        headphones: false, music: false, musicMin: 300, battery: 100, spareBattery: 1, poles: false, sunhat: false,
        socks: 0, note: false },
      drops: opts.drops || defaultDrops(), dropTaken: {},
      reasons,
      flags: {}, armed: {}, done: {},
      companion: null, forcedWalkUntil: -1, stiffUntil: -1, iceUntil: -1, wetUntil: -1,
      lastEventT: -999, lastMoraleBoostT: -999,
      paceEq: 7.0, flowUntilKm: -1,
      event: null, aid: null, pendingEvents: [],
      log: [], hist: [], why: {}, tot: {}, secLog: [],
      rank: null, aheadSet: null, passMade: 0, passTaken: 0, secPassMade: 0, secPassTaken: 0, leap: {},
      kcalIn: 0, kcalWindow: [], eatenAid: 0,
      outcome: null, strangersMet: 0
    };
    const R = { s, field: buildField(seed, weather) };
    s.rank = computeRank(R);
    addLog(s, 'neutral', `Lowmere, midnight. ${weatherOf(s).name}. 141 runners on the start line.`);
    pushHist(s);
    // Jonah at the start line
    s.event = { id: 'jonah0', ctx: {} };
    s.phase = 'event';
    return R;
  }

  // ------------------------------------------------------------------ log & accounting
  function addLog(s, tone, text, extra) {
    const e = { t: s.t, km: Math.round(s.km * 10) / 10, clock: clockStr(s.t), tone, text };
    if (extra) Object.assign(e, extra);
    s.log.push(e);
    if (s.log.length > 400) s.log.shift();
    return e;
  }
  // track causes: recent (decaying) and totals
  function cause(s, stat, tag, amount) {
    if (!amount) return;
    if (s.estimate) return;
    const w = s.why[stat] || (s.why[stat] = {});
    w[tag] = (w[tag] || 0) + amount;
    const tt = s.tot[stat] || (s.tot[stat] = {});
    tt[tag] = (tt[tag] || 0) + amount;
  }
  function decayWhy(s, dtH) {
    const k = Math.exp(-dtH / 1.0);
    for (const st in s.why) for (const tag in s.why[st]) {
      s.why[st][tag] *= k;
      if (Math.abs(s.why[st][tag]) < 0.05) delete s.why[st][tag];
    }
  }
  function moraleDelta(s, tag, amt) {
    s.m.morale = clamp(s.m.morale + amt, 0, 100);
    cause(s, 'morale', tag, amt);
  }
  function resolveDelta(s, tag, amt) {
    s.m.resolve = clamp(s.m.resolve + amt, 0, 100);
    cause(s, 'resolve', tag, amt);
  }
  function pushHist(s) {
    if (s.estimate) return;
    const b = s.b, m = s.m;
    // top recent morale drain causes
    const w = s.why.morale || {};
    const neg = Object.entries(w).filter(([, v]) => v < 0).sort((a, b2) => a[1] - b2[1]).slice(0, 3).map(([k]) => k);
    s.hist.push({ t: Math.round(s.t * 10) / 10, km: Math.round(s.km * 10) / 10, energy: r1(b.energy), hyd: r1(b.hyd),
      stomach: r1(b.stomach), legs: r1(b.legs), legsP: r1(b.legsPending), feet: r1(b.feet), heat: r1(b.heat), alert: r1(b.alert),
      salt: r1(b.salt), morale: r1(m.morale), resolve: r1(m.resolve), rank: s.rank, why: neg });
  }
  const r1 = (x) => Math.round(x * 10) / 10;

  // ------------------------------------------------------------------ field of other runners
  function refSegmentMinutes(weatherId) {
    // A baseline runner's minutes per 0.1 km: sensible effort, legs fading with distance.
    const s = { weather: weatherId, b: { energy: 80, hyd: 90, heat: 0, alert: 70, legs: 100, feet: 90, stomach: 90 }, m: { morale: 60 },
      inj: { ankle: 0 }, kit: { poles: false, battery: 100 }, t: 0, stiffUntil: -1, flowUntilKm: -1, km: 0 };
    const out = [];
    let t = 0;
    for (let i = 0; i < 1000; i++) {
      const a = i * STEP, b = a + STEP;
      const sec = C.SECTIONS[sectionIndexAt(a + 0.05)];
      const dz = elevAt(b) - elevAt(a);
      const g = dz / (STEP * 1000);
      s.b.legs = 100 - 0.55 * a;
      s.km = a; s.t = t;
      const env = envAt(s, a + 0.05, t);
      const eff = sec.kind === 'climb' ? 'easy' : sec.kind === 'descent' ? 'easy' : 'steady';
      let v = rawSpeed(s, sec, eff, g, env);
      if (env.sunLoad > 0.5 && env.air > 20) v *= 0.92;
      const m = STEP / v * 60;
      out.push(m); t += m;
    }
    return out;
  }
  function buildField(seed, weatherId) {
    const rng = mulberry(seed ^ 0x9E3779B9);
    const gauss = () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const ref = refSegmentMinutes(weatherId);
    const aidKms = C.NODES.filter((n) => n.type === 'aid').map((n) => n.km);
    const runners = [];
    for (let i = 0; i < FIELD_SIZE; i++) {
      const ability = clamp(1.05 + gauss() * 0.15, 0.72, 1.6);
      const r = rng();
      const style = r < 0.3 ? 'hot' : r < 0.8 ? 'even' : 'cons';
      const patches = [];
      const np = rng() < 0.5 ? 1 : rng() < 0.7 ? 2 : 0;
      for (let p = 0; p < np; p++) { const a = 10 + rng() * 85; patches.push([a, a + 4 + rng() * 10]); }
      const splits = new Float32Array(101); // minutes at each km
      let t = 0, dnfKm = null, dnfT = null;
      for (let i2 = 0; i2 < 1000; i2++) {
        const km = i2 * STEP;
        let mult = 1 / ability;
        const x = km / 100;
        if (style === 'hot') mult *= 0.87 + 0.55 * Math.pow(x, 1.3);
        else if (style === 'even') mult *= 1.0 + 0.24 * Math.pow(x, 1.4);
        else mult *= 1.06 + 0.12 * Math.pow(x, 1.5);
        if (patches.some(([a, b]) => km >= a && km <= b)) mult *= 1.28;
        if (km < 2) mult *= 1.12; // start crush
        t += ref[i2] * mult * (0.96 + rng() * 0.08);
        const kmEnd = Math.round((km + STEP) * 10) / 10;
        if (Number.isInteger(kmEnd)) splits[kmEnd] = t;
        if (aidKms.includes(kmEnd)) {
          t += 2 + rng() * (kmEnd > 40 ? 14 : 6);
          const node = nodeAt(kmEnd);
          const struggling = mult * ability > 1.3 || patches.some(([a, b]) => kmEnd >= a && kmEnd <= b);
          const margin = node.cutoff - t;
          let p = 0.012 + (struggling ? 0.07 : 0) + (style === 'hot' && kmEnd > 40 ? 0.03 : 0) + (margin < 75 ? 0.25 : 0);
          if (kmEnd === 52) p *= 1.6; // the shuttle effect
          if (t > node.cutoff || rng() < p) { dnfKm = kmEnd; dnfT = t; break; }
        }
      }
      if (dnfKm == null && t > 1680) { dnfKm = 99.9; dnfT = 1680; }
      if (dnfKm != null) for (let k = Math.floor(dnfKm) + 1; k <= 100; k++) splits[k] = Infinity;
      runners.push({ id: i, ability, style, splits, dnfKm, dnfT, finishT: dnfKm == null ? splits[100] : null,
        look: C.LOOKS[i % C.LOOKS.length], bib: 200 + i });
    }
    return { runners };
  }
  function npcKmAt(rn, t) {
    const sp = rn.splits;
    if (rn.dnfKm != null && t >= rn.dnfT) return -1; // out of race
    if (t <= 0) return 0;
    if (t >= sp[100]) return 100.0001; // finished
    let lo = 0, hi = 100;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sp[mid] <= t) lo = mid; else hi = mid; }
    const a = sp[lo], b = sp[hi];
    if (!isFinite(b)) return rn.dnfKm != null ? Math.min(rn.dnfKm, lo + 0.99) : lo;
    return lo + (t - a) / (b - a);
  }
  function computeRank(R) {
    if (!R.field) return null;
    const s = R.s;
    let ahead = 0;
    for (const rn of R.field.runners) {
      const k = npcKmAt(rn, s.t);
      if (k > s.km + 1e-6) ahead++;
    }
    return ahead + 1;
  }
  function fieldStats(R) {
    const s = R.s;
    let out = 0, finished = 0, active = 0;
    for (const rn of R.field.runners) {
      const k = npcKmAt(rn, s.t);
      if (k < 0) out++; else if (k >= 100) finished++; else active++;
    }
    return { out, finished, active, total: R.field.runners.length + 1 };
  }
  function nearbyRunners(R, windowKm) {
    const s = R.s, res = [];
    if (!R.field) return res;
    for (const rn of R.field.runners) {
      const k = npcKmAt(rn, s.t);
      if (k >= 0 && k < 100 && Math.abs(k - s.km) < windowKm) res.push({ id: rn.id, km: k, look: rn.look });
    }
    return res;
  }
  function updatePasses(R) {
    if (!R.field || R.s.estimate) return;
    const s = R.s;
    const now = new Set();
    for (const rn of R.field.runners) {
      const k = npcKmAt(rn, s.t);
      if (k > s.km + 1e-6 && k < 100.0001 + 1) now.add(rn.id);
    }
    const prev = s.aheadSet ? new Set(s.aheadSet) : null;
    let made = 0, taken = 0;
    if (prev) {
      for (const id of prev) if (!now.has(id)) {
        const rn = R.field.runners[id];
        if (npcKmAt(rn, s.t) >= 0) { made++; leap(R, rn, 'made'); }
      }
      for (const id of now) if (!prev.has(id)) { taken++; leap(R, R.field.runners[id], 'taken'); }
    }
    s.aheadSet = Array.from(now);
    s.rank = now.size + 1;
    s.passMade += made; s.passTaken += taken; s.secPassMade += made; s.secPassTaken += taken;
    if (made) moraleDelta(s, 'passing people', Math.min(0.3, made * 0.12));
    if (taken) moraleDelta(s, 'being passed', -Math.min(0.6, taken * 0.2));
  }
  function leap(R, rn, kind) {
    const s = R.s;
    const L = s.leap[rn.id] || (s.leap[rn.id] = { n: 0, said: 0 });
    L.n++;
    if (L.n >= 4 && L.said < 1 && s.t - (s.leapLastT || -999) > 150 && s.km > 8) {
      L.said++; s.leapLastT = s.t;
      const lines = kind === 'made'
        ? [`You pass the runner in the ${rn.look} again. "You again!" they laugh. Third time today.`,
          `The ${rn.look} again: you've swapped places with them all day. A fist bump as you go by.`]
        : [`The runner in the ${rn.look} comes past you again. "Can't get rid of me," they grin.`,
          `Here's the ${rn.look} again. You've leapfrogged so often it feels like a conversation.`];
      addLog(s, 'good', lines[L.said - 1] || lines[0]);
      moraleDelta(s, 'leapfrogging', 2);
    }
  }

  // ------------------------------------------------------------------ speed
  function legsFactor(legs) { return 0.45 + 0.55 * Math.pow(clamp(legs, 0, 100) / 100, 0.6); }
  function rawSpeed(s, sec, effort, grade, env) {
    const b = s.b;
    let v;
    if (grade >= -0.02) {
      let vf = FLAT[effort];
      if (grade > 0.07 && (effort === 'steady' || effort === 'push')) {
        const k = Math.max(0.28, 1 - (grade - 0.07) * 5);
        vf = FLAT.easy + (vf - FLAT.easy) * k;
      }
      const g = Math.max(0, grade);
      v = vf / (1 + g * 8.3);
      if (s.kit.poles && g > 0.06) v *= 1.06;
      v *= 1 - sec.tech * 0.2;
      v *= legsFactor(b.legs);
    } else {
      const g = -grade;
      v = DESC[effort] * (1 + Math.min(g, 0.06) * 3) * (1 - Math.max(0, g - 0.10) * 1.8);
      v *= 1 - sec.tech * 0.42;
      const lf = legsFactor(b.legs);
      v *= lf * Math.pow(lf, 0.7);
    }
    if (env.dark) {
      const dim = s.kit.battery < 15;
      v *= 1 - 0.03 - sec.tech * (dim ? 0.45 : 0.18);
    }
    if (env.fog) v *= 0.95;
    if (env.rain && sec.tech > 0.3) v *= 0.94;
    if (b.energy < 25) v *= 0.55 + 0.45 * b.energy / 25;
    if (b.hyd < 65) v *= 0.7 + 0.3 * b.hyd / 65;
    if (b.heat > 45) v *= 1 - (b.heat - 45) / 180;
    if (b.heat < -40) v *= 1 - Math.min(0.25, (-b.heat - 40) / 200); // numb, clumsy
    if (b.alert < 40) v *= 0.9 + 0.1 * b.alert / 40;
    if (s.m.morale < 35) v *= 0.85 + 0.15 * s.m.morale / 35;
    const ank = s.inj.ankle;
    if (ank === 1) v *= 1 - 0.03 - sec.tech * (s.inj.ankleTaped ? 0.06 : 0.12);
    else if (ank === 2) v *= s.inj.ankleTaped ? 0.84 : 0.78;
    else if (ank >= 3) v *= 0.45;
    if (b.feet < 40) v *= 0.88 + 0.12 * b.feet / 40;
    if (s.t < s.stiffUntil) v *= 0.9;
    if (s.km < s.flowUntilKm) v *= 1.05;
    return Math.max(1.1, v);
  }

  function effectiveEffort(s) {
    let e = s.effort;
    if (s.companion) e = s.companion.effort;
    if (s.t < s.forcedWalkUntil || s.flags.committedDNF || s.inj.ankle >= 3) e = 'walk';
    if (s.m.morale < 20 && e === 'push') e = 'steady';
    if (s.b.energy < 8 && (e === 'push' || e === 'steady')) e = 'easy';
    return e;
  }

  // ------------------------------------------------------------------ body update
  function sweatRate(s, I, env) {
    const b = s.b;
    const sunHeat = env.sunLoad * 9 * (s.kit.sunhat ? 0.62 : 1);
    const tskin = env.air + sunHeat - env.wind * (env.night ? 5 : 3) - (env.rain ? 3 : 0);
    let sw = (0.2 + 0.6 * I) * (1 + Math.max(0, tskin - 10) / 20);
    if (b.heat > 40) sw *= 1.12;
    if (s.kit.layers > 0 && I > 0.3) sw *= 1.1;
    if (tskin < 6) sw *= 0.78; // you sweat (and drink) less in the cold
    return { sweat: sw, tskin };
  }

  function updateBody(R, dtH, ctx) {
    const s = R.s, b = s.b, m = s.m, kit = s.kit;
    const { effort, env, sec } = ctx;
    const I = INTENSITY[effort];
    const est = !!s.estimate;

    // ---------- core temperature
    const { sweat, tskin } = sweatRate(s, I, env);
    let feel = tskin + 16 * I;
    if (kit.layers >= 1) feel += 10;
    if (kit.layers >= 2) feel += 8;
    const wet = env.rain || s.t < s.wetUntil;
    if (env.rain && kit.layers === 0) feel -= 5;
    if (s.t < s.wetUntil && !env.rain) feel -= 2;
    if (s.t < s.iceUntil && feel > 20) feel = Math.max(20, feel - 11); // ice and cold water take heat away; they can't make you hypothermic
    let target = 0;
    if (feel > 26) target = (feel - 26) * 3.2;
    else if (feel < 8) target = (feel - 8) * 5;
    target = clamp(target, -100, 100);
    b.heat += (target - b.heat) * Math.min(1, dtH / 0.35);

    // ---------- energy, gut, absorption
    let burn = CARB_BURN[effort];
    // as glycogen runs out the body leans on fat: burn (and capacity) drops
    if (b.energy < 50) burn *= 0.5 + 0.5 * b.energy / 50;
    if (b.heat < -40) burn *= 1 + Math.min(0.35, (-b.heat - 40) / 150);
    b.energy -= burn * dtH / KCAL_PER_PT;
    if (effort !== 'rest' && ctx.moving) {
      let rate = FUEL[s.fuel];
      if (b.stomach < 45) rate *= b.stomach / 45;
      if (b.sugar > 14) rate *= 0.6;
      if (b.gut > 340) rate *= 0.6; // you don't really want to eat on a full stomach
      const intake = Math.min(kit.food, rate * dtH);
      if (intake > 0) {
        kit.food -= intake; b.gut += intake; b.sugar += intake / 100 * 0.9;
        s.kcalIn += intake; if (!est) s.kcalWindow.push([s.t, intake]);
      }
    }
    let absMax = 280 * (b.stomach >= 60 ? 1 : Math.max(0.3, b.stomach / 60)) * ABSORB_INT[effort];
    if (b.hyd < 60) absMax *= Math.max(0.4, b.hyd / 60);
    if (b.heat > 50) absMax *= 0.75;
    if (I <= 0.62) absMax = Math.max(absMax, 130); // walking lets even a bad gut empty slowly
    const abs = Math.min(b.gut, absMax * dtH);
    b.gut -= abs; b.energy += abs / KCAL_PER_PT;
    b.sugar = Math.max(0, b.sugar - 0.45 * dtH);
    if (b.energy > 100) b.energy = 100;
    if (b.energy < 0) b.energy = 0;

    // ---------- hydration & salt
    let drinkRate = Math.min(sweat * 0.85 + (b.hyd < 85 ? (85 - b.hyd) * 0.015 : 0), 1.0);
    if (s.ration) drinkRate *= 0.45;
    if (effort === 'rest') drinkRate = 0; // drinking at aid is explicit
    if (est) s._thirst = (s._thirst || 0) + Math.min(sweat * 0.85, 1.0) * dtH;
    const drink = Math.min(kit.water, drinkRate * dtH);
    kit.water -= drink;
    const eff = b.salt < 35 ? 0.75 : 1;
    const dh = (drink * eff - sweat * dtH) / ML_PER_PT;
    b.hyd = clamp(b.hyd + dh, 0, 100);
    if (dh < 0) cause(s, 'hyd', env.sunLoad > 0.4 ? 'sun & heat' : 'sweat', dh);
    b.salt = clamp(b.salt - sweat * dtH * 6.5, 0, 100);
    if (b.hyd > 99 && drink > 0) kit.water += 0; // (overdrinking not modelled beyond salt dilution)

    // ---------- stomach
    let sDmg = 0;
    const over = Math.max(0, b.gut - 300) / 20 * (effort === 'push' ? 1.7 : effort === 'steady' ? 1.15 : 1);
    if (over) { sDmg += over; cause(s, 'stomach', 'too much food at once', -over * dtH); }
    if (b.heat > 45) { const x = (b.heat - 45) / 9; sDmg += x; cause(s, 'stomach', 'heat', -x * dtH); }
    if (b.hyd < 65) { const x = (65 - b.hyd) / 5; sDmg += x; cause(s, 'stomach', 'dehydration', -x * dtH); }
    if (b.sugar > 9) { const x = (b.sugar - 9) * 0.9; sDmg += x; cause(s, 'stomach', 'too many gels', -x * dtH); }
    if (b.salt < 35) { const x = (35 - b.salt) / 10; sDmg += x; cause(s, 'stomach', 'low salt', -x * dtH); }
    if (effort === 'push') { sDmg += 0.8; cause(s, 'stomach', 'pushing hard', -0.8 * dtH); }
    let sRec = 0;
    if (I <= 0.62 && b.gut < 260 && b.heat < 45 && b.hyd > 60) sRec = 7; else if (b.gut < 220) sRec = 2.5;
    if (b.stomach < 30 && I <= 0.62) sRec += 2;
    b.stomach = clamp(b.stomach + (sRec - sDmg) * dtH, 0, 100);

    // ---------- legs (with delayed eccentric damage)
    if (ctx.moving) {
      const poles = kit.poles;
      const climb = ctx.up / 100 * 0.30 * LEG_UP[effort] * (poles ? 0.82 : 1);
      const flat = ctx.d * 0.12 * LEG_UP[effort];
      let desc = 0;
      if (ctx.down > 0) {
        const g = ctx.down / (ctx.d * 1000);
        desc = ctx.down / 100 * 0.85 * LEG_DOWN[effort] * (1 + sec.tech * 0.7) * (1 + Math.max(0, g - 0.12) * 4) * (poles ? 0.9 : 1) * (b.legs < 50 ? 1.15 : 1);
      }
      b.legs -= climb + flat + desc * 0.55;
      b.legsPending += desc * 0.45;
      const tagD = `${sec.name} (${(LABELS[sectionKindLabel(sec)] || LABELS.runnable)[effort] || effort})`;
      cause(s, 'legs', 'climbing', -climb); cause(s, 'legs', 'running', -flat);
      if (desc) { cause(s, 'legs', 'descending', -desc); if (!est) { s.legsBySec = s.legsBySec || {}; s.legsBySec[tagD] = (s.legsBySec[tagD] || 0) + desc; } }
    }
    if (b.legsPending > 0) {
      const rel = b.legsPending * Math.min(1, dtH / 2);
      b.legs -= rel; b.legsPending -= rel;
    }
    if (effort === 'rest') b.legs += 0.6 * dtH;
    b.legs = clamp(b.legs, 0, 100);

    // ---------- feet
    if (ctx.moving) {
      let f = ctx.d * 0.22 * (wet ? 3.2 : 1) * (ctx.down > 0 ? 1.4 : 1) * (b.heat > 50 ? 1.2 : 1) * (s.inj.feetTaped ? 0.55 : 1) * (effort === 'push' ? 1.3 : 1);
      b.feet = clamp(b.feet - f, 0, 100);
      cause(s, 'feet', wet ? 'wet socks' : 'distance', -f);
    }

    // ---------- alertness
    const clock = env.clock;
    let aDrain = clock < 360 ? 2 + 6.5 * Math.sin(Math.PI * clock / 360) : clock > 1200 ? 2.5 : 0.8;
    if (s.t > 1260) aDrain += 2; // second night
    if (effort === 'rest' && env.night) aDrain += 2;
    b.alert -= aDrain * dtH;
    if (b.caffeine > 0) { const c = Math.min(b.caffeine, 45 * dtH); b.alert += c; b.caffeine -= c; }
    b.alert = clamp(b.alert, 0, 100);

    // ---------- headlamp
    if (env.dark) kit.battery = Math.max(0, kit.battery - 11 * dtH);
    if (kit.music) { kit.musicMin -= dtH * 60; if (kit.musicMin <= 0) { kit.music = false; kit.musicMin = 0; if (!est) addLog(s, 'bad', 'Your headphones die mid-song. Silence, and your own breathing.'); } }

    // ---------- mind
    // Morale relaxes towards a set point that sags as the hours pile up; every
    // discomfort pulls it below that; events kick it up or down.
    const hours = s.t / 60;
    // the body clock: a deep trough in the small hours, an afternoon slump, and the second evening
    const ck = env.clock;
    const circ = ck < 400 ? 14 * Math.sin(Math.PI * ck / 400) : ck > 760 && ck < 1060 ? 6 * Math.sin(Math.PI * (ck - 760) / 300) : ck > 1200 ? 6 : 0;
    let setpoint = Math.max(26, 70 - 1.15 * hours - circ);
    if (s.companion) setpoint += 12;
    if (kit.music) setpoint += 7;
    const drains = [];
    const dr = (tag, x) => { if (x > 0) drains.push([tag, x]); };
    dr('hungry', b.energy < 35 ? (35 - b.energy) * 0.5 + (b.energy < 12 ? 7 : 0) : 0);
    dr('nausea', b.stomach < 60 ? (60 - b.stomach) * 0.3 : 0);
    dr('thirst', b.hyd < 72 ? (72 - b.hyd) * 0.32 : 0);
    dr('sore legs', b.legs < 55 ? (55 - b.legs) * 0.22 : 0);
    dr('sore feet', b.feet < 68 ? (68 - b.feet) * 0.25 : 0);
    dr('heat', b.heat > 20 ? (b.heat - 20) * 0.35 : 0);
    dr('cold', b.heat < -25 ? (-25 - b.heat) * 0.24 : 0);
    dr('sleepiness', b.alert < 55 ? (55 - b.alert) * 0.45 : 0);
    dr('ankle', [0, 2, 5, 7][s.inj.ankle] || 0);
    const physical = drains.reduce((a, [, x]) => a + x, 0);
    if (ctx.moving) {
      dr('alone in the dark', env.night && !s.companion ? 5 : 0);
      dr('the witching hour', clock >= 120 && clock < 345 ? 6 * Math.sin(Math.PI * (clock - 120) / 225) : 0);
      dr('rain', env.rain ? 4 : 0);
      dr('fog', env.fog ? 1.5 : 0);
      dr('pushing', effort === 'push' ? 2.5 : 0);
      dr('endless climbing', sec.kind === 'climb' ? 2 + Math.min(4, (s.climbMin || 0) / 25) : 0);
      const margin = cutoffMargin(s);
      dr('the clock', margin < 30 ? 5 : margin < 75 ? 2 : 0);
    }
    let mult = 1;
    if (s.companion) mult *= 0.5;
    if (kit.music) mult *= 0.75;
    const pull = (setpoint - m.morale) * (m.morale > setpoint ? 0.55 : 0.4);
    if (pull > 0) cause(s, 'morale', physical < 2 ? 'finding a rhythm' : 'recovering', pull * dtH);
    else cause(s, 'morale', 'the long day', pull * dtH);
    let loss = 0;
    for (const [tag, x] of drains) { loss += x * mult; cause(s, 'morale', tag, -x * mult * dtH); }
    let gain = 0;
    if (ctx.moving && s.km < s.flowUntilKm) { gain += 3; cause(s, 'morale', 'flow', 3 * dtH); }
    m.morale = clamp(m.morale + (pull + gain - loss) * dtH, 0, 100);
    // resolve: every hour of suffering wears it down a little; dark places wear it fast
    if (loss > 0) resolveDelta(s, 'grinding it out', -loss * 0.32 * dtH);
    if (m.morale < 35) resolveDelta(s, 'dark place', -(35 - m.morale) * 1.0 * dtH);
    else if (m.morale > 60 && m.resolve < 55) resolveDelta(s, 'feeling good', 0.5 * dtH);

    decayWhy(s, dtH);
  }

  function restTick(R, minutes) {
    const s = R.s;
    let left = minutes;
    while (left > 1e-6) {
      const dt = Math.min(5, left);
      const env = envAt(s, s.km, s.t + dt / 2);
      updateBody(R, dt / 60, { effort: 'rest', env, sec: env.sec, moving: false, d: 0, up: 0, down: 0 });
      s.t += dt; left -= dt;
    }
    if (R.field) updatePasses(R);
  }

  // projected minutes to spare at next cutoff, based on recent pace
  function cutoffMargin(s) {
    const node = nextAid(s.km);
    if (!node || node.cutoff == null) return 999;
    const rem = eqAt(node.km) - eqAt(s.km);
    return node.cutoff - (s.t + rem / Math.max(2, s.paceEq) * 60);
  }

  // ------------------------------------------------------------------ movement
  function stepMove(R, dist) {
    const s = R.s;
    const sec = C.SECTIONS[s.sec];
    const km0 = s.km, km1 = Math.min(sec.to, km0 + dist);
    const d = km1 - km0;
    if (d <= 1e-9) return 0;
    const e0 = elevAt(km0), e1 = elevAt(km1);
    const dz = e1 - e0;
    const grade = dz / (d * 1000);
    const env = envAt(s, (km0 + km1) / 2, s.t);
    const effort = effectiveEffort(s);
    const v = rawSpeed(s, sec, effort, grade, env);
    const dtH = d / v;
    updateBody(R, dtH, { effort, env, sec, moving: true, d, up: Math.max(0, dz), down: Math.max(0, -dz) });
    s.t += dtH * 60;
    s.km = Math.round(km1 * 1000) / 1000;
    s.climbMin = sec.kind === 'climb' && grade > 0.03 ? (s.climbMin || 0) + dtH * 60 : 0;
    const eq = eqAt(km1) - eqAt(km0);
    s.paceEq = s.paceEq * 0.97 + (eq / dtH) * 0.03;
    if (!s.estimate) {
      // fall risk accumulates as a probability per step
      const p = fallProb(s, sec, effort, grade, env) * d;
      s._fallRoll = p;
      if (s.secAcc) { s.secAcc.minutes += dtH * 60; }
    } else {
      s._riskSum = (s._riskSum || 0) + fallProb(s, sec, effort, grade, env) * d;
    }
    return dtH * 60;
  }

  function fallProb(s, sec, effort, grade, env) {
    if (sec.tech < 0.25) return 0;
    let p = 0.009 * sec.tech * FALL_EFF[effort];
    if (grade < -0.05) p *= 1.6;
    p *= Math.max(0.7, 1 + (60 - s.b.legs) / 40);
    if (env.dark) p *= s.kit.battery < 15 ? 2.2 : 1.6;
    if (s.b.alert < 40) p *= 1.5;
    if (env.rain) p *= 1.5;
    if (env.fog) p *= 1.15;
    if (s.inj.ankle >= 1) p *= 1.3;
    if (s.b.heat < -50) p *= 1.3;
    return p;
  }

  function advance(R) {
    const s = R.s;
    s.phase = 'moving';
    const frames = [];
    let guard = 0;
    while (guard++ < 2000) {
      const sec = C.SECTIONS[s.sec];
      if (s.km >= sec.to - 1e-9) { arriveSectionEnd(R); break; }
      const nextGrid = Math.floor(s.km / STEP + 1e-6 + 1) * STEP;
      stepMove(R, Math.min(sec.to, nextGrid) - s.km);
      if (Math.abs(s.km * 2 - Math.round(s.km * 2)) < 1e-6) { updatePasses(R); pushHist(s); }
      frames.push(frameOf(R));
      const ev = checkEvents(R);
      if (ev) { openEvent(R, ev.id, ev.ctx || {}); break; }
      if (s.phase !== 'moving') break;
    }
    return frames;
  }

  function frameOf(R) {
    const s = R.s;
    return { t: s.t, km: s.km, b: Object.assign({}, s.b), m: Object.assign({}, s.m), rank: s.rank, water: s.kit.water, food: s.kit.food };
  }

  function arriveSectionEnd(R) {
    const s = R.s;
    finishSecLog(R);
    const node = nodeAt(s.km);
    s.sec = Math.min(C.SECTIONS.length - 1, s.sec + (s.km >= C.SECTIONS[s.sec].to - 1e-9 ? 1 : 0));
    if (s.companion && s.companion.untilKm <= s.km + 1e-6) endCompanion(s);
    if (node && node.type === 'finish') return finishRace(R);
    if (node && (node.type === 'aid' || node.type === 'water')) return arriveAid(R, node);
    s.phase = 'section';
    startSecLog(R);
  }

  function startSecLog(R) {
    const s = R.s;
    s.secPassMade = 0; s.secPassTaken = 0;
    s.secAcc = { sec: s.sec, t0: s.t, minutes: 0, legs0: s.b.legs - s.b.legsPending, efforts: {} };
  }
  function finishSecLog(R) {
    const s = R.s;
    if (!s.secAcc) return;
    const sec = C.SECTIONS[s.secAcc.sec];
    const mins = s.t - s.secAcc.t0;
    const parts = [`${sec.name} done in ${durStr(mins)}.`];
    if (s.secPassMade || s.secPassTaken) {
      if (s.secPassMade > s.secPassTaken) parts.push(`You passed ${s.secPassMade}${s.secPassTaken ? `, ${s.secPassTaken} passed you` : ''}.`);
      else if (s.secPassTaken > 0) parts.push(`${s.secPassTaken} runner${s.secPassTaken > 1 ? 's' : ''} passed you${s.secPassMade ? `, you passed ${s.secPassMade}` : ''}.`);
    }
    if (s.rank) parts.push(`Position ${s.rank}.`);
    addLog(s, 'neutral', parts.join(' '));
    s.secLog.push({ id: sec.id, name: sec.name, minutes: mins, efforts: s.secAcc.efforts, made: s.secPassMade, taken: s.secPassTaken, rankEnd: s.rank });
    s.secAcc = null;
  }

  function endCompanion(s, why) {
    if (!s.companion) return;
    const c = s.companion;
    if (!s.estimate) addLog(s, 'neutral', why || `${c.name} ${c.parting || 'drifts on ahead. You\'re alone again.'}`);
    if (c.id === 'tomas' && s.km < 99.9) s.flags.tomasTogether = false;
    s.companion = null;
  }

  // ------------------------------------------------------------------ events
  function armedCross(s, key, cond, rearm) {
    if (cond && !s.armed[key]) { s.armed[key] = true; return true; }
    if (rearm && s.armed[key]) s.armed[key] = false;
    return false;
  }
  function chance(s, p) { return !s.estimate && rand(s) < p; }

  function checkEvents(R) {
    const s = R.s, b = s.b, m = s.m;
    if (s.estimate) return null;
    const env = envAt(s, s.km, s.t);
    const sec = C.SECTIONS[s.sec];
    const sinceEv = s.t - s.lastEventT;
    const calm = sinceEv > 10;

    // queued events first
    if (s.pendingEvents.length) return s.pendingEvents.shift();

    // ---- critical body events (no cooldown)
    if (armedCross(s, 'collapse', b.hyd < 18, b.hyd > 40)) return { id: 'collapse' };
    if (b.hyd < 6) return { id: 'collapse2' };
    if (b.heat > 84 && armedCross(s, 'heatex', true, false)) return { id: 'heatex' };
    if (b.heat < 70) s.armed.heatex = false;
    if (b.heat < -70 && armedCross(s, 'hypo', true, false)) return { id: 'hypo' };
    if (b.heat > -55) s.armed.hypo = false;
    if (armedCross(s, 'bonk', b.energy < 12, b.energy > 30)) return { id: 'bonk' };
    if (s._fallRoll && rand(s) < s._fallRoll) { s._fallRoll = 0; return { id: 'fall' }; }
    s._fallRoll = 0;
    if (m.resolve <= 0.01 && !s.flags.committedDNF && armedCross(s, 'breaking', true, false)) return { id: 'breaking' };
    if (m.resolve > 25) s.armed.breaking = false;

    // ---- course features at this exact km
    for (const f of C.FEATURES) {
      if (!s.done['f_' + f.id] && Math.abs(s.km - f.km) < 1e-6) { s.done['f_' + f.id] = true; return { id: 'feature', ctx: { f: f.id } }; }
    }
    // ---- sunrise / sunset
    const clock = clockOf(s.t);
    if (!s.done.sunrise && s.t > 120 && clock >= SUNRISE && clock < SUNRISE + 120) { s.done.sunrise = true; return { id: 'sunrise' }; }
    if (!s.done.sunset && s.t > 1000 && clock >= SUNSET && s.km < 94) { s.done.sunset = true; return { id: 'sunset' }; }

    // ---- story
    if (!s.done.tomas1 && s.km >= 0.6) { s.done.tomas1 = true; return { id: 'tomas1' }; }
    if (!s.done.ines1 && s.km >= 25.5 && s.km < 33 && !s.companion) { s.done.ines1 = true; return { id: 'ines1' }; }
    if (!s.done.tomas2 && s.km > 30 && s.km < 90) {
      const tk = tomasKm(R);
      if (tk >= 0 && tk < s.km && tk > s.km - 1.5) { s.done.tomas2 = true; return { id: 'tomas2' }; }
    }
    if (!s.done.jonah2 && s.km >= 57 && s.km <= 71 && calm && !s.companion && chance(s, 0.06)) { s.done.jonah2 = true; return { id: 'jonah2' }; }
    if (!s.done.jonah2 && s.km > 71) s.done.jonah2 = 'missed';
    if (s.flags.jonahHelped && !s.done.jonah3 && s.km > 74 && s.km < 97 && m.morale < 40 && !s.companion && calm) { s.done.jonah3 = true; return { id: 'jonah3' }; }
    if (!s.done.ines2 && s.km > 42 && s.km < 92 && m.morale < 28 && !s.companion && calm) { s.done.ines2 = true; return { id: 'ines2' }; }
    if (s.flags.tomasHelped && !s.done.tomas3 && s.km >= 94) { s.done.tomas3 = true; return { id: 'tomas3' }; }

    // ---- body thresholds and warnings
    if (b.stomach < 22 && calm && chance(s, 0.12)) return { id: 'vomit' };
    if (sec.kind === 'climb' && (b.salt < 32 || b.hyd < 55 || b.legs < 28) && calm && s.km - (s.crampKm == null ? -99 : s.crampKm) > 8 && chance(s, 0.01)) { s.crampKm = s.km; return { id: 'cramp' }; }
    if (armedCross(s, 'hotspot', b.feet < 74, false)) return { id: 'hotspot' };
    if (armedCross(s, 'blister', b.feet < 45, false)) return { id: 'blister' };
    if (s.kit.battery < 15 && env.dark && armedCross(s, 'lamp', true, false)) return { id: 'lamp' };
    if (s.kit.battery > 40) s.armed.lamp = false;
    if (calm || sinceEv > 4) {
      const W = [
        ['w_energy', b.energy < 30, b.energy > 50],
        ['w_hyd', b.hyd < 62, b.hyd > 78],
        ['w_stomach', b.stomach < 45, b.stomach > 65],
        ['w_heat', b.heat > 55, b.heat < 30],
        ['w_cold', b.heat < -45, b.heat > -20],
        ['w_legs', b.legs < 50, false],
        ['w_legs2', b.legs < 25, false],
        ['w_alert', b.alert < 30, b.alert > 50],
        ['w_salt', b.salt < 30, b.salt > 55],
        ['w_water', s.kit.water < 0.05 && !s.ration, s.kit.water > 0.3],
        ['w_food', s.kit.food < 1 && s.fuel !== 'none', s.kit.food > 200]
      ];
      for (const [k, c, re] of W) if (armedCross(s, k, c, re)) return { id: 'warn', ctx: { k } };
    }
    if (armedCross(s, 'darkpatch', m.morale < 24, m.morale > 45) && !s.flags.committedDNF) return { id: 'darkpatch' };

    // ---- random encounters & moments
    if (calm) {
      if ((env.dark || env.fog) && !s.companion && b.alert < 48 && s.km > 14 && s.km - (s.lostKm == null ? -99 : s.lostKm) > 15 && chance(s, (env.fog ? 0.006 : 0.003))) { s.lostKm = s.km; return { id: 'wrongturn' }; }
      if (b.alert < 20 && s.km - (s.hallKm == null ? -99 : s.hallKm) > 10 && chance(s, 0.01)) { s.hallKm = s.km; return { id: 'halluc' }; }
      if (!s.companion && s.strangersMet < 2 && s.km > 12 && ((env.night && m.morale < 60) || m.morale < 38) && chance(s, 0.004)) return { id: 'stranger' };
      if (!s.done.stars && env.night && !env.fog && !env.rain && sec.exposed > 0.7 && weatherOf(s).id !== 'storm' && chance(s, 0.08)) { s.done.stars = true; return { id: 'stars' }; }
    }
    // log-only moments
    if (!s.estimate) moments(R, env, sec);
    return null;
  }

  function moments(R, env, sec) {
    const s = R.s, b = s.b;
    if (sec.kind === 'runnable' && s.km > 2 && s.km >= s.flowUntilKm + 3 && b.legs > 52 && b.stomach > 60 && b.energy > 40 && b.hyd > 70 && b.heat < 40 && b.heat > -35 && rand(s) < (sec.flow ? 0.08 : 0.02)) {
      s.flowUntilKm = s.km + 2.5;
      addLog(s, 'good', sec.flow
        ? 'Flow. The trail unspools under you, roots and stones arriving exactly where your feet want them. You are not running; you are being run.'
        : ['For a while it just works: breath, feet, trail. Easy. Light. You remember why you love this.', 'Your legs find a rhythm all on their own. You stop thinking about kilometres and just run, and it feels like flying, a little.', 'Somebody behind you is humming. The trail is soft. For ten minutes nothing hurts at all.', 'You catch yourself smiling for no reason. This, right here, is the bit nobody believes when you tell them.'][(s.flowCount = (s.flowCount || 0) + 1) % 4], { moment: 'flow' });
      moraleDelta(s, 'flow', 4);
    }
    if (rand(s) < 0.005 && s.km - (s.wildKm == null ? -99 : s.wildKm) > 6) {
      const clock = env.clock;
      const opts = env.night
        ? ['An owl calls from the trees, close enough to make you jump.', 'Two green eyes in your headlamp beam: a fox, unbothered, watching you pass.', 'A hare sits in the middle of the trail, then thinks better of it.']
        : clock < 600
          ? ['A red deer stag lifts his head out of the bracken, steaming in the cold, and watches you go by.', 'Skylarks going up all around you, singing like they mean it.']
          : ['A kite hangs on the wind right at eye level, close enough to see its feathers move.', 'A herd of goats on the rocks above regards you with total contempt.', 'Somebody\'s dog runs beside you for two hundred metres, tail going, then goes home.'];
      s.seenWild = s.seenWild || [];
      const fresh = opts.filter((o) => !s.seenWild.includes(o));
      if (!fresh.length) return;
      const line = pick(s, fresh); s.seenWild.push(line); s.wildKm = s.km;
      addLog(s, 'good', line, { moment: 'wildlife' });
      moraleDelta(s, 'small joys', 2);
    }
  }

  function tomasKm(R) {
    // Tomas: went out far too hard. Starts ~25% faster than you; fades hard.
    const s = R.s;
    if (s.flags.tomasOut) return -1;
    const tm = s.t;
    // position as function of time: v(t) = v0 * decay; calibrated around the player
    if (!s.flags.tomasModel) return -1;
    const { A, p } = s.flags.tomasModel;
    // km(t) = A * t^p  (p < 1: fast start, relentless fade)
    return Math.min(100, A * Math.pow(Math.max(0, tm), p));
  }

  function openEvent(R, id, ctx) {
    const s = R.s;
    s.event = { id, ctx };
    s.phase = 'event';
    s.lastEventT = s.t;
  }

  function reasonsLeft(s) { return s.reasons.filter((r) => !r.used); }
  function useReason(R, idx, big) {
    const s = R.s;
    const r = s.reasons.filter((x) => !x.used)[idx || 0];
    if (!r) return false;
    r.used = true;
    moraleDelta(s, 'remembering why', big ? 40 : 30);
    resolveDelta(s, 'remembering why', big ? 30 : 15);
    addLog(s, 'good', `You remember why you're here. ${r.text}`, { moment: 'reason' });
    return true;
  }

  function eatNow(s, kcal, opts) {
    opts = opts || {};
    s.b.gut += kcal;
    s.kcalIn += kcal;
    s.kcalWindow.push([s.t, kcal]);
    if (opts.sweet !== false) s.b.sugar += kcal / 100 * (opts.sweet || 0.9);
    if (opts.savory) s.b.sugar = Math.max(0, s.b.sugar - 4);
  }

  function kcalLastHours(s, h) {
    const t0 = s.t - h * 60;
    return Math.round(s.kcalWindow.filter(([t]) => t >= t0).reduce((a, [, k]) => a + k, 0));
  }

  // Event definitions: build(R, ctx) -> {title, text, choices}, apply(R, choice, ctx)
  const EVENTS = {
    jonah0: {
      build: () => ({
        title: 'The start line',
        text: 'Lowmere square, 23:58. A hundred and forty headlamps, a man with a megaphone, cowbells. The lad next to you is bouncing on his toes. "First hundred," he says. "Jonah. I\'m terrified. Any advice?"',
        choices: [
          { id: 'slow', label: '"Start slower than feels right. Then slower."', tag: 'kind' },
          { id: 'smash', label: '"You\'ll smash it, mate."', tag: 'neutral' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        s.flags.jonahAdvice = c === 'slow';
        addLog(s, 'neutral', c === 'slow' ? 'Jonah nods hard, like you\'ve told him a secret. The hooter goes.' : 'Jonah grins. The hooter goes, and he\'s gone into the crowd.');
        s.flags.tomasModel = { A: 0.94, p: 0.605 };
      }
    },
    tomas1: {
      build: () => ({
        title: 'Bib 88',
        text: 'A runner in a sleeveless top and a very expensive vest elbows past on the lane, already breathing hard. "Tomas," he says, as though you asked. "Going for top twenty. Come on, old timer, keep up!" He\'s doing about four-thirty a kilometre. There are ninety-seven kilometres left.',
        choices: [
          { id: 'chase', label: 'Go with him', desc: 'Push effort for the rest of this section.', tag: 'bold' },
          { id: 'let', label: 'Let him go. It\'s a long way.', desc: 'Stay on your plan.', tag: 'safe' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'chase') { s.effort = 'push'; s.flags.chasedTomas = true; moraleDelta(s, 'rivalry', 6); addLog(s, 'neutral', 'You go with him. It feels great. Everything feels great at kilometre one.'); }
        else { addLog(s, 'neutral', 'You let him go. His headlamp bobs away into the dark ahead. Somewhere behind you, an older voice says: "See you later, Tomas."'); }
      }
    },
    ines1: {
      build: (R) => ({
        title: 'A dim old headlamp',
        text: 'A small woman with a dim old headlamp and very muddy knees falls into step with you on the climb. "Ines," she says. "Sixty-one. This is my twenty-third hundred." She is power-hiking so smoothly she seems to float. "Want some company to the top? I talk a lot. People say it helps."',
        choices: [
          { id: 'with', label: 'Climb with her', desc: 'Company until the ridge (Power-hike pace). Morale drains half as fast.', tag: 'safe' },
          { id: 'on', label: 'Thank her and push on', desc: 'Keep your own pace, alone.', tag: 'bold' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'with') {
          s.companion = { id: 'ines', name: 'Ines', effort: 'easy', untilKm: 33, parting: 'squeezes your arm at the top of the Rakes. "Go on. I\'ll see you later. I always see people later." She drops back to eat.' };
          s.flags.inesFriend = true;
          moraleDelta(s, 'company', 6);
          addLog(s, 'good', 'Ines talks about her first hundred (1991, wool socks, a bin bag for a jacket). "Power-hike anything you can\'t see the top of," she says. "And eat before you\'re hungry. The race is decided by what you do in the first half and felt in the second."');
        } else addLog(s, 'neutral', '"Go on then," Ines says, amused. "I\'ll see you later. I always see people later."');
      }
    },
    tomas2: {
      build: (R) => {
        const s = R.s;
        return {
          title: 'Bib 88, again',
          text: `Tomas is sitting on a rock beside the trail, grey-faced, vest open, staring at nothing. He went through the first twenty kilometres like a train. "I don't get it," he says. "I trained. I'm fit." He's out of food and he hasn't eaten in hours.`,
          choices: [
            { id: 'gel', label: 'Give him some of your food and walk with him a minute', desc: s.kit.food >= 100 ? '−100 kcal from your vest, −3 min.' : 'You have almost nothing to give.', tag: 'kind', disabled: s.kit.food < 100 },
            { id: 'word', label: '"Eat something, walk till it passes. It does pass."', desc: 'A word and move on.', tag: 'neutral' },
            { id: 'pass', label: 'Pass in silence', desc: 'He did call you old timer.', tag: 'cold' }
          ]
        };
      },
      apply: (R, c) => {
        const s = R.s;
        if (c === 'gel') {
          s.kit.food -= 100; restTick(R, 3);
          s.flags.tomasHelped = true; moraleDelta(s, 'kindness', 5); resolveDelta(s, 'kindness', 6);
          addLog(s, 'good', 'You sit him up, give him a gel and a bar, make him drink. After a minute the colour comes back into his face. "Thanks," he says, and he means it. "Seriously."');
        } else if (c === 'word') {
          s.flags.tomasWord = true; moraleDelta(s, 'passing a rival', 4);
          addLog(s, 'neutral', 'He nods without looking up. You leave him fumbling with a wrapper.');
        } else {
          s.flags.tomasIgnored = true; moraleDelta(s, 'passing a rival', 6);
          addLog(s, 'neutral', 'You walk past. A small, mean part of you enjoys it. A bigger part doesn\'t.');
        }
        s.flags.tomasOut = !s.flags.tomasHelped; // he drops at the next aid unless helped
      }
    },
    tomas3: {
      build: () => ({
        title: 'Footsteps behind',
        text: 'Footsteps behind you on the descent, and a laugh you recognise. Tomas, back from the dead, eating a flapjack. "You saved my race back there," he says. "So. Do we race it in, or what?"',
        choices: [
          { id: 'race', label: 'Race him to the line', desc: 'Push effort to the finish. Tired legs, rocky ground.', tag: 'bold' },
          { id: 'together', label: '"We run in together."', desc: 'Company to the finish, at his (steady) pace.', tag: 'kind' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'race') { s.effort = 'push'; s.flags.racedTomas = true; moraleDelta(s, 'rivalry', 10); addLog(s, 'good', '"Ha! Go on then!" And you\'re racing, two wrecks clattering downhill, laughing like idiots.'); }
        else { s.companion = { id: 'tomas', name: 'Tomas', effort: 'steady', untilKm: 100, parting: '' }; s.flags.tomasTogether = true; moraleDelta(s, 'company', 10); addLog(s, 'good', '"Deal," he says. You run the last kilometres side by side, not saying much.'); }
      }
    },
    jonah2: {
      build: (R) => {
        const s = R.s;
        return {
          title: 'Jonah',
          text: 'Someone is sitting in the long grass beside the trail with his head on his knees. Jonah. Both calves are cramping so hard you can see them twitch, and he\'s crying the way you only cry at kilometre sixty. "I can\'t," he says. "I can\'t, I can\'t."',
          choices: [
            { id: 'help', label: 'Stop and help him up', desc: `About 12 minutes. ${s.kit.salt > 0 ? 'Give him a salt cap. ' : ''}Walk him till he's moving.`, tag: 'kind' },
            { id: 'send', label: '"Walk to the next aid, I\'ll tell them you\'re coming."', desc: 'Costs nothing now.', tag: 'neutral' },
            { id: 'go', label: 'Keep going', desc: 'You have your own race.', tag: 'cold' }
          ]
        };
      },
      apply: (R, c) => {
        const s = R.s;
        if (c === 'help') {
          if (s.kit.salt > 0) s.kit.salt--;
          restTick(R, 12);
          s.flags.jonahHelped = true; moraleDelta(s, 'kindness', 5); resolveDelta(s, 'kindness', 8);
          addLog(s, 'good', 'You stretch his calves out, feed him salt, pull him to his feet and walk with him until he\'s jogging. "I\'ll pay you back," he says. "I swear."');
        } else if (c === 'send') {
          s.flags.jonahSent = true; moraleDelta(s, 'guilt', -2);
          addLog(s, 'neutral', 'He nods. You tell yourself the aid station will sort him out.');
        } else { s.flags.jonahLeft = true; moraleDelta(s, 'guilt', -7); addLog(s, 'bad', 'You keep going. You can hear him for a long time.'); }
      }
    },
    jonah3: {
      build: () => ({
        title: '"My turn."',
        text: 'Running footsteps. Jonah, of all people, moving well, salt crusted on his cap. He takes one look at you. "Oh mate. No. Come on. My turn." He falls in beside you and doesn\'t ask.',
        choices: [{ id: 'ok', label: 'Let him pull you along', desc: 'Company for about 5 km.', tag: 'safe' }]
      }),
      apply: (R) => {
        const s = R.s;
        s.companion = { id: 'jonah', name: 'Jonah', effort: 'easy', untilKm: Math.min(100, s.km + 5), parting: 'finally runs out of jokes. "See you at the finish. Actually see you. Promise?" He goes on ahead.' };
        moraleDelta(s, 'kindness repaid', 16); resolveDelta(s, 'kindness repaid', 12);
        addLog(s, 'good', 'He tells you terrible jokes for five kilometres. You laugh at all of them.', { moment: 'company' });
      }
    },
    ines2: {
      build: (R) => ({
        title: R.s.flags.inesFriend ? 'Ines again' : 'A dim old headlamp',
        text: R.s.flags.inesFriend
          ? 'Ines, small and muddy and unhurried, comes alongside. She looks at your face for a second. "Ah," she says. "You\'re in the hole." She hands you a salted potato from her vest. "It never always gets worse. I promise you. I\'ve been where you are a hundred times. Walk with me a bit."'
          : 'A small older woman with very muddy knees comes alongside and looks at your face for a second. "Ah. You\'re in the hole. I\'m Ines." She hands you a salted potato from her vest. "It never always gets worse. Walk with me a bit."',
        choices: [
          { id: 'with', label: 'Walk with her a while', desc: 'Company for ~3 km at Power-hike / Easy pace.', tag: 'safe' },
          { id: 'on', label: 'Thank her, and let her go ahead', desc: 'You need to do this yourself.', tag: 'neutral' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        eatNow(s, 120, { savory: true, sweet: false }); s.b.salt = clamp(s.b.salt + 8, 0, 100);
        if (c === 'with') {
          s.companion = { id: 'ines', name: 'Ines', effort: 'easy', untilKm: Math.min(100, s.km + 3), parting: 'pats your back. "There. See? Go on. I\'m slower than you, really." She lets you go.' };
          moraleDelta(s, 'It never always gets worse', 12); resolveDelta(s, 'It never always gets worse', 8);
          addLog(s, 'good', '"It never always gets worse." You say it back to her. It sounds less stupid out loud.', { moment: 'company' });
        } else { moraleDelta(s, 'It never always gets worse', 7); resolveDelta(s, 'It never always gets worse', 6); addLog(s, 'good', '"Suit yourself. It never always gets worse," she says over her shoulder. You find yourself repeating it.'); }
      }
    },
    stranger: {
      build: (R) => {
        const s = R.s;
        const st = C.STRANGERS[(s.seed + s.strangersMet * 3) % C.STRANGERS.length];
        return {
          title: 'Company', ctxName: st.name,
          text: `A runner falls in beside you: ${st.name}. ${st.line}`,
          choices: [
            { id: 'with', label: `Run with ${st.name} for a while`, desc: 'Company for a few km at their pace (Easy). Morale drains half as fast.', tag: 'safe' },
            { id: 'no', label: 'Let them go', desc: 'You\'d rather be in your own head right now.', tag: 'neutral' }
          ]
        };
      },
      apply: (R, c) => {
        const s = R.s;
        const st = C.STRANGERS[(s.seed + s.strangersMet * 3) % C.STRANGERS.length];
        s.strangersMet++;
        if (c === 'with') {
          s.companion = { id: 'stranger', name: st.name, effort: 'easy', untilKm: Math.min(C.SECTIONS[s.sec].to + 2, s.km + 4), parting: 'peels off at a stile to deal with a stone in their shoe. "Go on, I\'ll catch you." They don\'t, but you feel better.' };
          moraleDelta(s, 'company', 7);
        } else addLog(s, 'neutral', `${st.name} nods and moves on.`);
      }
    },
    feature: {
      build: (R, ctx) => featureEvent(R, ctx.f).build(),
      apply: (R, c, ctx) => featureEvent(R, ctx.f).apply(c)
    },
    sunrise: {
      build: (R) => {
        const s = R.s;
        const env = envAt(s, s.km, s.t);
        const high = env.elev > 1500 && env.sec.exposed > 0.6;
        const w = weatherOf(s).id;
        let text;
        if (high) text = w === 'clear'
          ? 'It starts as a grey line, then a red one. Then the sun comes up over the eastern ridges and every mountain in the world turns gold at once. Your shadow jumps out across the rock, fifty metres long. You switch off your headlamp. You made it through the night.'
          : 'The cloud you\'ve been running inside all night goes from black to grey to pearl, then tears open. Below you the valleys are full of white and the sun comes up on top of it, and you are standing above a sea. You made it through the night.';
        else if (env.rain) text = 'It doesn\'t so much get light as less dark: black, then charcoal, then a wet, streaming grey. No colours, no sun. But you can see the trail without your headlamp, and the rain has started to sound like rain instead of like something hunting you. The night is over.';
        else if (env.sec.forest > 0.5) text = 'Somewhere it gets light. The forest goes from black to blue to green. Birds start up all at once, as if someone flicked a switch. You turn off your headlamp. The night is over.';
        else text = 'The sky behind the hills goes from black to grey to pink. The sun comes up and puts warmth on your face for the first time in eight hours. You switch off your headlamp. The night is over.';
        return {
          title: 'Sunrise', big: true, moment: 'sunrise', text,
          choices: [
            { id: 'watch', label: 'Stop and watch it come up', desc: '3 minutes. Take it in.', tag: 'joy' },
            { id: 'run', label: 'Run into the day', desc: 'Keep moving.', tag: 'safe' }
          ]
        };
      },
      apply: (R, c) => {
        const s = R.s;
        const env = envAt(s, s.km, s.t);
        const high = env.elev > 1500 && env.sec.exposed > 0.6;
        const k = high ? 1 : env.sec.forest > 0.5 ? 0.5 : 0.75;
        moraleDelta(s, 'sunrise', Math.round(28 * k)); resolveDelta(s, 'sunrise', Math.round(10 * k));
        s.b.alert = clamp(s.b.alert + 20, 0, 100);
        if (c === 'watch') { restTick(R, 3); moraleDelta(s, 'sunrise', 8); resolveDelta(s, 'sunrise', 4); }
        s.flags.sunriseHigh = high;
        s.flags.sunriseKm = s.km;
        addLog(s, 'good', high ? `Sunrise from ${env.sec.name}. Your body forgets, for a while, that it has been awake since yesterday morning.` : 'Sunrise. Your body remembers what daytime is. Alertness and spirits lift.', { moment: 'sunrise' });
        if (s.reasons.some((r) => r.id === 'sunrise') && high) { resolveDelta(s, 'sunrise', 8); addLog(s, 'good', 'It\'s everything they said.'); }
      }
    },
    sunset: {
      build: (R) => {
        const s = R.s;
        return {
          title: 'Second night', moment: 'sunset',
          text: `The sun goes down behind the Crown, where you were this morning. It is going to be dark for the rest of your race. ${s.kit.battery < 40 && s.kit.spareBattery < 1 ? 'Your headlamp has been through one night already.' : ''}`,
          choices: [{ id: 'ok', label: 'Headlamp on. Keep going.' }]
        };
      },
      apply: (R) => { const s = R.s; moraleDelta(s, 'second night', -6); if (s.kit.battery < 25 && s.kit.spareBattery > 0) { s.kit.spareBattery--; s.kit.battery = 100; addLog(s, 'neutral', 'You put the fresh batteries in. Bright again.'); } }
    },
    bonk: {
      build: (R) => {
        const s = R.s;
        const k3 = kcalLastHours(s, 3);
        const choices = [];
        if (s.kit.food >= 100) {
          choices.push({ id: 'gelwalk', label: 'Gel now, walk for 15 minutes', desc: '+100 kcal. Forced walk while it hits.', tag: 'safe' });
          choices.push({ id: 'all', label: 'Eat everything you can, keep moving', desc: '+300 kcal at once. Risky for your stomach.', tag: 'bold' });
        }
        if (s.kit.rice > 0) choices.push({ id: 'rice', label: 'Eat a rice ball, walk 15 minutes', desc: '+200 kcal, savoury.', tag: 'safe' });
        choices.push({ id: 'push', label: 'Keep going, it\'ll pass', desc: s.kit.food < 100 ? 'Your vest is empty.' : 'It won\'t.', tag: 'bold' });
        return {
          title: 'The bonk', text: `The world goes grey at the edges. Your legs are full of sand, your hands shake, and you can't remember why you thought this was a good idea. You've eaten ${k3} kcal in the last three hours. You've burned more than ${Math.round(3 * CARB_BURN.easy / 100) * 100}.`,
          choices
        };
      },
      apply: (R, c) => {
        const s = R.s;
        if (c === 'gelwalk') { s.kit.food -= 100; eatNow(s, 100); s.forcedWalkUntil = s.t + 15; addLog(s, 'neutral', 'You walk and eat. Twenty minutes later the colours start to come back.'); }
        else if (c === 'all') { const k = Math.min(300, s.kit.food); s.kit.food -= k; eatNow(s, k); addLog(s, 'neutral', `You eat ${k} kcal in a few minutes and keep moving. Your stomach does not thank you.`); }
        else if (c === 'rice') { s.kit.rice--; eatNow(s, 200, { savory: true, sweet: false }); s.forcedWalkUntil = s.t + 15; addLog(s, 'neutral', 'Rice ball, salty and plain. Real food. It helps.'); }
        else { moraleDelta(s, 'hungry', -5); addLog(s, 'bad', 'You keep going on nothing.'); }
        s.b.energy = Math.max(s.b.energy, 6);
      }
    },
    vomit: {
      build: () => ({
        title: 'Your stomach turns', text: 'A sour wave climbs your throat. Everything sloshes. You\'re going to be sick, or you\'re going to have to slow right down until you\'re not.',
        choices: [
          { id: 'let', label: 'Let it happen', desc: 'Empty the tank. Lose what\'s in your gut and some fluid; often you feel better after.', tag: 'bold' },
          { id: 'walk', label: 'Walk and sip until it settles', desc: '20 min forced walk, fuel plan paused.', tag: 'safe' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'let') {
          s.b.gut = 0; s.b.hyd = clamp(s.b.hyd - 6, 0, 100); s.b.stomach = clamp(s.b.stomach + 35, 0, 100); s.b.sugar = Math.max(0, s.b.sugar - 6);
          moraleDelta(s, 'being sick', -6); restTick(R, 2);
          s.flags.vomitKm = s.flags.vomitKm || s.km;
          addLog(s, 'bad', 'You are sick in the heather, spectacularly. Then, weirdly, you feel better. Lighter.', { moment: 'vomit' });
          moraleDelta(s, 'relief', 6);
        } else {
          s.forcedWalkUntil = s.t + 20; s.fuel = 'none';
          addLog(s, 'neutral', 'You walk, sipping water, breathing through your nose. Fuel plan paused. Turn it back on when you can face it.');
        }
      }
    },
    heatex: {
      build: (R) => ({
        title: 'Overheating', text: 'Your head throbs, your skin is hot and strangely dry, and you get goosebumps in the full sun, which is a very bad sign. The trail tilts slightly when you look up.',
        choices: [
          { id: 'shade', label: 'Find shade, drink, pour water on your head', desc: '10 minutes, uses 0.3 L. Brings you right down.', tag: 'safe', disabled: R.s.kit.water < 0.1 },
          { id: 'walk', label: 'Slow to a walk', desc: 'Walk for 20 minutes.', tag: 'safe' },
          { id: 'push', label: 'Push on to the next water', desc: 'Dangerous.', tag: 'bold' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'shade') { s.kit.water = Math.max(0, s.kit.water - 0.3); s.b.hyd = clamp(s.b.hyd + 4, 0, 100); s.iceUntil = s.t + 25; restTick(R, 10); s.b.heat = Math.min(s.b.heat, 30); addLog(s, 'neutral', 'Ten minutes under a boulder with water down your neck. The world slowly stops tilting.'); }
        else if (c === 'walk') { s.forcedWalkUntil = s.t + 20; addLog(s, 'neutral', 'You slow right down.'); }
        else { moraleDelta(s, 'heat', -4); s.flags.heatRisk = true; addLog(s, 'bad', 'You push on, head down, heart racing.'); }
      }
    },
    hypo: {
      build: (R) => {
        const s = R.s;
        const choices = [];
        if (s.kit.layers < (s.kit.warm ? 2 : 1)) choices.push({ id: 'layers', label: 'Every layer on, and move', desc: '2 minutes with numb fingers.', tag: 'safe' });
        choices.push({ id: 'faster', label: 'Move faster to warm up', desc: 'Steady effort to the next aid.', tag: 'bold' });
        choices.push({ id: 'foil', label: 'Foil blanket. Sit and wait for the sweep.', desc: 'Your race ends here.', tag: 'quit' });
        return { title: 'Hypothermic', text: 'You\'re shivering so hard your teeth click. Your fingers won\'t work the zip. You notice you\'ve stopped caring about the cold, and some distant part of you knows that is the dangerous part.', choices };
      },
      apply: (R, c) => {
        const s = R.s;
        if (c === 'layers') { restTick(R, 2); s.kit.layers = s.kit.warm ? 2 : 1; s.b.heat = Math.max(s.b.heat, -55); addLog(s, 'neutral', 'You fight your jacket on with clumsy hands. Slowly, slowly, warmth.'); }
        else if (c === 'faster') { s.effort = 'steady'; addLog(s, 'neutral', 'You force yourself into a shuffle-run to make heat.'); }
        else endRace(R, 'evac', 'Hypothermia on ' + C.SECTIONS[s.sec].name);
      }
    },
    collapse: {
      build: (R) => {
        const s = R.s;
        const choices = [];
        if (s.kit.water > 0.25) choices.push({ id: 'drink', label: 'Sit. Drink everything you have. Wait.', desc: '15 minutes. Then walk.', tag: 'safe' });
        else choices.push({ id: 'beg', label: 'Ask the next runner to share their water', desc: 'About 20 minutes sitting in the dirt. Someone will stop.', tag: 'safe' });
        choices.push({ id: 'help', label: 'Ask the next runner to radio for help', desc: 'Race control will come. Your race ends here.', tag: 'quit' });
        return { title: 'Collapse', text: 'Your vision narrows to a tunnel. You sit down hard without deciding to. Your mouth is sand. You haven\'t peed in hours.', choices };
      },
      apply: (R, c) => {
        const s = R.s;
        s.done.collapse = true;
        if (c === 'drink') { s.b.hyd = clamp(s.b.hyd + s.kit.water / ML_PER_PT * 0.9, 0, 100); s.kit.water = 0; restTick(R, 15); s.forcedWalkUntil = s.t + 20; moraleDelta(s, 'scare', -8); addLog(s, 'bad', 'You drink every drop and sit with your head between your knees. After a while you can stand.'); }
        else if (c === 'beg') { restTick(R, 20); s.b.hyd = clamp(s.b.hyd + 0.45 / ML_PER_PT, 0, 100); s.kit.water = Math.min(s.kit.waterCap, 0.2); s.forcedWalkUntil = s.t + 25; moraleDelta(s, 'scare', -10); resolveDelta(s, 'scare', -8); addLog(s, 'bad', 'A runner you\'ve never met crouches beside you, pours half their flask into your mouth and the rest into yours. "Walk," she says. "Just walk. Little sips." Then she\'s gone.'); }
        else endRace(R, 'evac', 'Collapsed with severe dehydration on ' + C.SECTIONS[s.sec].name);
      }
    },
    collapse2: {
      build: () => ({
        title: 'You can\'t go on', text: 'You are on the ground again and this time you can\'t get up. A runner kneels beside you, looks at your face, and gets out their phone.',
        choices: [{ id: 'help', label: 'Let them call race control', tag: 'quit' }]
      }),
      apply: (R) => endRace(R, 'evac', 'Collapsed with severe dehydration on ' + C.SECTIONS[R.s.sec].name)
    },
    fall: {
      build: (R) => {
        const s = R.s;
        if (!s.event.ctx.sev) { const r = rand(s); s.event.ctx.sev = r < 0.58 ? 'scrape' : r < 0.9 ? 'ankle' : 'hard'; }
        const sev = s.event.ctx.sev;
        const sec = C.SECTIONS[s.sec];
        const env = envAt(s, s.km, s.t);
        let text, choices;
        if (sev === 'scrape') {
          text = `${env.dark ? 'A root you never saw in the headlamp beam' : 'A rock that moved'} and you're down: palms, knee, a mouthful of ${sec.forest > 0.5 ? 'pine needles' : 'grit'}. Blood on your shin. Nothing broken.`;
          choices = [{ id: 'ok', label: 'Get up, dust off, carry on' }];
        } else if (sev === 'ankle') {
          const worse = s.inj.ankle >= 1;
          text = worse ? 'The same ankle goes again, harder. A white flash of pain. You hop, swear, and stand on one leg in the dark.' : 'Your foot lands on the edge of a rock and your ankle rolls right over. Hot pain. You hop, swear, test it. It takes weight. Mostly.';
          choices = [
            { id: 'walk', label: 'Walk it off for 10 minutes', desc: 'Lets the first pain settle.', tag: 'safe' },
            { id: 'run', label: 'Run on it', desc: 'Adrenaline will help. Until it doesn\'t.', tag: 'bold' }
          ];
        } else {
          text = 'You go down hard: a full-length slam onto rock, all the air out of your lungs. For a long moment you just lie there looking at the sky, checking each part of yourself in turn.';
          choices = [{ id: 'up', label: 'Take a minute. Then get up.' }];
        }
        return { title: sev === 'scrape' ? 'Down!' : sev === 'ankle' ? 'Rolled ankle' : 'A bad fall', text, choices };
      },
      apply: (R, c, ctx) => {
        const s = R.s;
        const sec = C.SECTIONS[s.sec];
        s.flags.falls = (s.flags.falls || 0) + 1;
        const lastEff = effectiveEffort(s);
        s.flags.fallLog = (s.flags.fallLog || []).concat([{ km: s.km, sec: sec.name, effort: lastEff, sev: ctx.sev }]);
        if (ctx.sev === 'scrape') { s.inj.scrapes++; moraleDelta(s, 'falling', -7); addLog(s, 'bad', `You fell on ${sec.name}. Bloody knee, wounded pride.`, { moment: 'fall' }); }
        else if (ctx.sev === 'ankle') {
          s.inj.ankle = Math.min(3, s.inj.ankle + 1 + (c === 'run' && rand(s) < 0.25 ? 1 : 0));
          moraleDelta(s, 'falling', -10); resolveDelta(s, 'injury', -6);
          if (c === 'walk') { s.forcedWalkUntil = s.t + 10; }
          addLog(s, 'bad', `Rolled ankle on ${sec.name}.${s.inj.ankle >= 2 ? ' It is swelling.' : ''}`, { moment: 'fall' });
          if (s.inj.ankle >= 3) s.pendingEvents.push({ id: 'ankle3' });
        } else {
          restTick(R, 2); moraleDelta(s, 'falling', -15); resolveDelta(s, 'injury', -8); s.b.legs = clamp(s.b.legs - 5, 0, 100); s.inj.scrapes += 2;
          if (s.inj.ankle < 2 && rand(s) < 0.5) s.inj.ankle++;
          addLog(s, 'bad', `A bad fall on ${sec.name}. Bruised, bleeding, shaken.`, { moment: 'fall' });
        }
      }
    },
    ankle3: {
      build: () => ({
        title: 'You can\'t run on it', text: 'The ankle is the size of a grapefruit. You can walk, barely, with your teeth gritted. Running is out of the question.',
        choices: [
          { id: 'hobble', label: 'Hobble to the next aid station', desc: 'Very slow. Your race will end there.', tag: 'safe' },
          { id: 'help', label: 'Call race control', desc: 'Wait for the mountain rescue team.', tag: 'quit' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'help') endRace(R, 'evac', 'Ankle injury on ' + C.SECTIONS[s.sec].name);
        else { s.flags.committedDNF = true; s.flags.injuryDNF = true; addLog(s, 'bad', 'You limp on towards the next aid station, one careful step at a time.'); }
      }
    },
    cramp: {
      build: (R) => ({
        title: 'Cramp', text: `Mid-step, your ${rand(R.s) < 0.5 ? 'calf' : 'hamstring'} locks solid, a knot of muscle you can see through the skin. You stand on one leg, swearing.`,
        choices: [
          { id: 'stretch', label: R.s.kit.salt > 0 ? 'Stretch it out and take a salt cap' : 'Stretch it out', desc: '3 minutes.', tag: 'safe' },
          { id: 'walk', label: 'Walk it off, carefully', desc: 'Walk for 15 minutes.', tag: 'neutral' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        moraleDelta(s, 'cramp', -5);
        if (c === 'stretch') { if (s.kit.salt > 0) { s.kit.salt--; s.b.salt = clamp(s.b.salt + 15, 0, 100); } restTick(R, 3); addLog(s, 'neutral', 'You stretch it out against a rock until it lets go.'); }
        else { s.forcedWalkUntil = s.t + 15; addLog(s, 'neutral', 'You walk, very carefully, waiting for it to let go.'); }
        s.crampKm = s.km;
      }
    },
    hotspot: {
      build: () => ({
        title: 'Hotspot', text: 'A hot, rubbing patch on your heel: the start of a blister. Every runner knows the deal: deal with it now, or deal with something much worse later.',
        choices: [
          { id: 'tape', label: 'Stop and tape it', desc: '4 minutes. Feet wear much slower afterwards.', tag: 'safe' },
          { id: 'ignore', label: 'Ignore it', desc: 'It might settle down.', tag: 'bold' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'tape') { restTick(R, 4); s.inj.feetTaped = true; addLog(s, 'neutral', 'You sit on a rock and tape your heel. Good as new, nearly.'); }
        else { s.flags.ignoredHotspot = s.km; addLog(s, 'neutral', 'You ignore it. It doesn\'t ignore you.'); }
      }
    },
    blister: {
      build: (R) => ({
        title: 'Blister', text: R.s.flags.ignoredHotspot != null ? `The hotspot from kilometre ${Math.round(R.s.flags.ignoredHotspot)} has become a blister the size of a coin, and it has just burst. Every step is a small, bright, specific pain.` : 'Your feet have had enough: a blister on the ball of your foot has burst. Every step is a small, bright, specific pain.',
        choices: [{ id: 'ok', label: 'Keep going. Get it taped at the next medic.' }]
      }),
      apply: (R) => { moraleDelta(R.s, 'sore feet', -6); addLog(R.s, 'bad', 'Burst blister.'); }
    },
    lamp: {
      build: (R) => ({
        title: 'Your beam fades', text: 'Your headlamp beam has gone yellow and soft. Rocks are guesses now.',
        choices: R.s.kit.spareBattery > 0
          ? [{ id: 'swap', label: 'Swap batteries', desc: '2 minutes with cold fingers.', tag: 'safe' }, { id: 'dim', label: 'Carry on dim', desc: 'Slower and riskier on technical ground.', tag: 'bold' }]
          : [{ id: 'dim', label: 'Carry on dim. You have no spare.', desc: 'Slower and riskier on technical ground.' }]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'swap') { restTick(R, 2); s.kit.spareBattery--; s.kit.battery = 100; addLog(s, 'neutral', 'Fresh batteries. The world comes back into focus.'); }
        else { moraleDelta(s, 'dim headlamp', -4); addLog(s, 'bad', 'You squint along in a puddle of yellow light.'); }
      }
    },
    warn: {
      build: (R, ctx) => warning(R, ctx.k),
      apply: (R, c, ctx) => {
        const s = R.s;
        if (c === 'gel' && s.kit.food >= 100) { s.kit.food -= 100; eatNow(s, 100); addLog(s, 'neutral', 'Gel.'); }
        if (c === 'salt' && s.kit.salt > 0) { s.kit.salt--; s.b.salt = clamp(s.b.salt + 15, 0, 100); addLog(s, 'neutral', 'Salt cap.'); }
        if (c === 'layer') { restTick(R, 1.5); s.kit.layers = s.kit.warm ? 2 : 1; addLog(s, 'neutral', 'Layers on.'); }
        if (c === 'strip') { restTick(R, 1); s.kit.layers = 0; addLog(s, 'neutral', 'Jacket off.'); }
        if (c === 'caff' && s.kit.caffeine > 0) { s.kit.caffeine--; eatNow(s, 100); s.b.caffeine += 25; addLog(s, 'neutral', 'Caffeine gel.'); }
        if (c === 'fuel') { s.fuel = 'steady'; addLog(s, 'neutral', 'Fuel plan: Steady.'); }
        if (c === 'drink') { s.ration = false; }
      }
    },
    darkpatch: {
      build: (R) => {
        const s = R.s;
        const why = topCauses(s, 'morale', 3);
        const left = reasonsLeft(s);
        const choices = [];
        left.forEach((r, i) => choices.push({ id: 'reason' + i, label: `Remember why: "${r.text}"`, desc: 'One use. A big lift for body and will.', tag: 'reason' }));
        choices.push({ id: 'chunk', label: 'Just get to the next flag. Then the next.', desc: 'Small comfort. Doesn\'t fix anything.', tag: 'safe' });
        choices.push({ id: 'sit', label: 'Let the thought sit there', desc: 'It\'s just a thought.', tag: 'neutral' });
        const phys = s.b.energy < 30 || s.b.stomach < 40 || s.b.hyd < 60 || Math.abs(s.b.heat) > 50 || s.b.alert < 30;
        return {
          title: 'A dark patch', moment: 'low',
          text: `A voice in your head, very calm and reasonable: what are you doing out here? Nobody would blame you. ${why.length ? 'Right now it\'s mostly: ' + why.join(', ') + '.' : ''} ${phys ? 'Some of this is your body talking. Fix the body and the voice gets quieter.' : 'Your body is holding together. This one is in your head.'}`,
          choices
        };
      },
      apply: (R, c) => {
        const s = R.s;
        s.flags.darkPatches = (s.flags.darkPatches || 0) + 1;
        s.flags.lowestKm = s.flags.lowestKm || [];
        s.flags.lowestKm.push(Math.round(s.km));
        if (c.startsWith('reason')) useReason(R, +c.slice(6));
        else if (c === 'chunk') { moraleDelta(s, 'small goals', 6); addLog(s, 'neutral', 'Next flag. Next flag. Next flag.'); }
        else addLog(s, 'neutral', 'You let it sit there. It doesn\'t go away, but it doesn\'t get bigger.');
      }
    },
    breaking: {
      build: (R) => {
        const s = R.s;
        const left = reasonsLeft(s);
        const choices = [];
        left.forEach((r, i) => choices.push({ id: 'reason' + i, label: `Remember why: "${r.text}"`, desc: 'Find the thing that got you here.', tag: 'reason' }));
        if (s.kit.note && !s.flags.noteRead) choices.push({ id: 'note', label: 'Open the note from home', tag: 'reason' });
        choices.push({ id: 'sit', label: 'Sit on a rock for fifteen minutes', desc: 'Time and cold. Some of your will comes back.', tag: 'safe' });
        choices.push({ id: 'drop', label: 'Walk to the next aid station and hand in your bib', desc: 'You\'ll walk there. Decide finally at the table.', tag: 'quit' });
        return { title: 'Breaking point', moment: 'low', text: 'You stop. You don\'t decide to; your legs just stop. You sit down on a rock beside the trail and look at your hands. You can\'t think of a single reason to stand up. Runners go past. One of them asks if you\'re OK, and you hear yourself say "yeah, fine".', choices };
      },
      apply: (R, c) => {
        const s = R.s;
        s.flags.broke = (s.flags.broke || 0) + 1;
        s.flags.brokeKm = s.km;
        if (c.startsWith('reason')) useReason(R, +c.slice(6), true);
        else if (c === 'note') readNote(R);
        else if (c === 'sit') { restTick(R, 15); resolveDelta(s, 'sitting it out', 22); moraleDelta(s, 'sitting it out', 10); addLog(s, 'neutral', 'Fifteen minutes on a rock. Then, without really deciding, you stand up.'); }
        else { s.flags.committedDNF = true; addLog(s, 'bad', 'You decide. You\'ll walk to the next aid station and stop. The relief is enormous, and awful.'); resolveDelta(s, 'decided to stop', 10); }
      }
    },
    wrongturn: {
      build: () => ({
        title: 'Where are the flags?', text: 'You realise you haven\'t seen a course marker for a while. The path is still a path. It\'s probably fine. Probably.',
        choices: [
          { id: 'back', label: 'Go back to the last flag', desc: 'Certain loss: about 12 minutes.', tag: 'safe' },
          { id: 'on', label: 'Push on, it must rejoin', desc: 'Maybe nothing lost. Maybe a lot.', tag: 'bold' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'back') { restTick(R, 12); moraleDelta(s, 'getting lost', -5); addLog(s, 'bad', 'Back up the hill, swearing, to a flag fluttering by a junction you ran straight past. Twelve minutes gone.'); }
        else if (rand(s) < 0.5) { moraleDelta(s, 'getting lost', -2); addLog(s, 'neutral', 'After an anxious few minutes a reflective flag winks in your beam. Phew.'); }
        else { restTick(R, 32); moraleDelta(s, 'getting lost', -14); resolveDelta(s, 'getting lost', -6); addLog(s, 'bad', 'It doesn\'t rejoin. A sheep track, then nothing. Half an hour to find your way back.', { moment: 'lost' }); }
      }
    },
    halluc: {
      build: (R) => {
        const s = R.s;
        const choices = [];
        if (s.kit.caffeine > 0) choices.push({ id: 'caff', label: 'Caffeine gel', desc: '+alertness within half an hour.', tag: 'safe' });
        choices.push({ id: 'nap', label: 'Lie down on the trail for ten minutes', desc: 'A dirt nap. Big alertness boost, but you\'ll get cold.', tag: 'bold' });
        choices.push({ id: 'on', label: 'Keep moving', desc: 'It\'s fine. It\'s fine.', tag: 'neutral' });
        return { title: 'Seeing things', text: pick(s, ['The rock ahead is a sleeping bear. You are sure of it. Then it is a rock. You laugh out loud, alone, at four in the morning.', 'There is a man in a hat standing by the trail. There is a fence post by the trail. There is a man in a hat.', 'The leaves on the path are writing words. You almost stop to read them.']), choices };
      },
      apply: (R, c) => {
        const s = R.s;
        if (c === 'caff') { s.kit.caffeine--; eatNow(s, 100); s.b.caffeine += 25; }
        else if (c === 'nap') { restTick(R, 10); s.b.alert = clamp(s.b.alert + 30, 0, 100); s.b.heat -= 15; addLog(s, 'neutral', 'You lie down in the trail with your vest as a pillow and are asleep instantly. Ten minutes later you wake up cold and clear.'); }
        else moraleDelta(s, 'sleepiness', -2);
      }
    },
    stars: {
      build: () => ({
        title: 'Look up', text: 'On the open ridge, between gusts, you look up. More stars than you have ever seen. The Milky Way is a smear of light from one horizon to the other.',
        choices: [
          { id: 'off', label: 'Switch off your headlamp for a minute', desc: '1 minute. Just look.', tag: 'joy' },
          { id: 'on', label: 'Eyes back on the trail', tag: 'safe' }
        ]
      }),
      apply: (R, c) => {
        const s = R.s;
        if (c === 'off') { restTick(R, 1); moraleDelta(s, 'the stars', 10); resolveDelta(s, 'the stars', 5); addLog(s, 'good', 'Headlamp off. Silence and stars. You feel very small and completely fine about it.', { moment: 'stars' }); }
        else moraleDelta(s, 'the stars', 3);
      }
    }
  };

  function readNote(R) {
    const s = R.s;
    s.flags.noteRead = true; s.kit.note = false;
    moraleDelta(s, 'the note', 25); resolveDelta(s, 'the note', 25);
    addLog(s, 'good', 'You open the note. It\'s short. You read it three times, then put it back in your vest, and for a while you can\'t see the trail very well.', { moment: 'note' });
  }

  function warning(R, k) {
    const s = R.s, b = s.b;
    const ok = { id: 'ok', label: 'Noted', desc: 'You can change your effort and plan next.' };
    const W = {
      w_energy: { title: 'Running low', text: `Your legs feel heavy and you're thinking about food a lot. Energy is getting low: you've eaten ${kcalLastHours(s, 2)} kcal in the last two hours.${s.fuel === 'none' || s.fuel === 'light' ? ' Your fuel plan isn\'t keeping up.' : ''}`,
        choices: [s.kit.food >= 100 ? { id: 'gel', label: 'Gel now', desc: '+100 kcal (takes ~20 min to hit)' } : null, s.fuel === 'none' || s.fuel === 'light' ? { id: 'fuel', label: 'Switch fuel plan to Steady' } : null, ok] },
      w_hyd: { title: 'Thirsty', text: `Dry mouth, a dull headache, and the last time you peed it was dark yellow. You're getting dehydrated. ${s.kit.water < 0.1 ? 'Your flasks are empty.' : s.ration ? 'You are rationing water.' : ''}`,
        choices: [s.ration && s.kit.water > 0.1 ? { id: 'drink', label: 'Stop rationing' } : null, ok] },
      w_stomach: { title: 'Stomach trouble', text: `Your stomach is sloshing and tight. ${topCauses(s, 'stomach', 2).length ? 'Mostly: ' + topCauses(s, 'stomach', 2).join(', ') + '.' : ''} Easy effort and an emptier gut let it recover. Pushing on a full stomach makes it worse.`, choices: [ok] },
      w_heat: { title: 'Getting hot', text: `You're overheating: sweat stinging your eyes, heart rate high for the effort. Slow down, drink, get water on your head. ${s.kit.layers ? 'And take your jacket off!' : ''}`,
        choices: [s.kit.layers ? { id: 'strip', label: 'Jacket off' } : null, ok] },
      w_cold: { title: 'Getting cold', text: `The cold is getting into you: stiff fingers, clumsy feet. ${s.kit.layers < (s.kit.warm ? 2 : 1) ? 'You have another layer.' : 'You\'re wearing everything you have. Move a bit faster, or get to shelter.'}`,
        choices: [s.kit.layers < (s.kit.warm ? 2 : 1) ? { id: 'layer', label: 'Put a layer on', desc: '1–2 minutes' } : null, ok] },
      w_legs: { title: 'Quads talking', text: `Your quads have started to complain on every downhill step. Legs are at ${Math.round(b.legs)}%${b.legsPending > 3 ? `, and there's more damage still coming from the last descent` : ''}. Leg damage doesn't heal during a race. Every hard descent from here costs extra.`, choices: [ok] },
      w_legs2: { title: 'Legs shot', text: 'Your quads are destroyed. Downhills are a stiff-legged hobble, and it feels like every rock wants to trip you. Speed and fall risk are both much worse now.', choices: [ok] },
      w_alert: { title: 'Eyes closing', text: 'You catch yourself drifting, eyes half closed, feet finding the trail on their own. Sleepiness makes you slower, clumsier and gloomier.', choices: [s.kit.caffeine > 0 ? { id: 'caff', label: 'Caffeine gel' } : null, ok] },
      w_salt: { title: 'Salt', text: 'White salt crust on your cap and face. Your hands are puffy and water is sloshing in your stomach instead of going in. You\'re low on salt.', choices: [s.kit.salt > 0 ? { id: 'salt', label: 'Salt cap' } : null, ok] },
      w_water: { title: 'Empty flasks', text: `You suck air from your flask. Empty. ${nextAid(s.km) ? `${nextAid(s.km).name} is ${(nextAid(s.km).km - s.km).toFixed(1)} km away.` : ''}`, choices: [ok] },
      w_food: { title: 'Vest empty', text: 'You reach for a gel and there are none left. Your fuel plan has nothing to work with until the next aid station.', choices: [ok] }
    };
    const w = W[k];
    return { title: w.title, text: w.text, warn: true, choices: w.choices.filter(Boolean) };
  }

  function featureEvent(R, fid) {
    const s = R.s;
    const f = C.FEATURES.find((x) => x.id === fid);
    const env = envAt(s, s.km, s.t);
    const w = weatherOf(s).id;
    const tmin = clockOf(s.t);
    const toSunrise = tmin < SUNRISE ? SUNRISE - tmin : 9999;
    const simple = (title, text, gainM, gainR, extra) => ({
      build: () => ({ title, text, big: extra && extra.big, moment: extra && extra.moment, choices: (extra && extra.choices) || [{ id: 'ok', label: 'Keep going' }] }),
      apply: (c) => { moraleDelta(s, extra && extra.tag || 'the view', gainM); if (gainR) resolveDelta(s, extra && extra.tag || 'the view', gainR); if (extra && extra.after) extra.after(c); addLog(s, gainM >= 0 ? 'good' : 'bad', (extra && extra.log) || title, { moment: extra && extra.moment }); }
    });
    if (f.type === 'ford') {
      const day = !env.dark;
      return {
        build: () => ({
          title: f.name, text: day ? `The river at ${f.name} is knee-deep and clear, sliding fast over brown stones. On a day like this it looks wonderful.` : `${f.name}. Black water, fast and loud, in your headlamp beam. A rope is strung across. Knee-deep, the marshal says. Feels like more.`,
          choices: [
            { id: 'wade', label: 'Wade straight through', desc: `Wet feet for a while.${day ? ' Cools you right down.' : ' Cold.'}`, tag: 'safe' },
            { id: 'stones', label: 'Pick across on the stones', desc: '+3 minutes. Probably dry feet. Maybe not.', tag: 'neutral' },
            day ? { id: 'sit', label: 'Sit down in it for a minute', desc: 'Soaked to the waist. Heat gone. Pure joy.', tag: 'joy' } : null
          ].filter(Boolean)
        }),
        apply: (c) => {
          if (c === 'wade') { s.wetUntil = s.t + 90; s.b.heat -= day ? 30 : 15; addLog(s, 'neutral', day ? 'Cold water to the knees. Bliss. Squelching shoes for an hour.' : 'Icy water to the knees. Your feet go numb, then sting.'); }
          else if (c === 'stones') {
            restTick(R, 3);
            if (rand(s) < 0.65) addLog(s, 'neutral', 'Stone to stone to stone. Dry feet.');
            else { s.wetUntil = s.t + 90; moraleDelta(s, 'getting wet', -4); addLog(s, 'bad', 'The last stone rocks and you go in up to the thigh. So much for that.'); }
          } else { restTick(R, 1.5); s.wetUntil = s.t + 120; s.b.heat = Math.min(s.b.heat - 50, 0); moraleDelta(s, 'the river', 9); addLog(s, 'good', 'You sit down in the river in your clothes and gasp and laugh. Ten degrees cooler for half an hour.', { moment: 'river' }); }
        }
      };
    }
    if (f.type === 'false') {
      const second = fid === 'false2';
      return simple(second ? 'The Last Lie lies twice' : 'A summit!', second
        ? 'There. That has to be it: the trees end and there\'s only sky. You crest it, and the path drops and rears up again ahead, higher. You hear somebody behind you sob, once, then start laughing.'
        : 'The trees thin, the angle eases. That\'s the top! You can see sky! You crest it, and the path dips into a gully and climbs again, steeper. The Last Lie.', second ? -9 : -7, 0,
        { tag: 'false summits', log: second ? 'Second false summit.' : 'False summit.' });
    }
    if (fid === 'ridgeon') {
      const coldNow = env.dark || env.air < 8;
      const ch = [];
      if (coldNow && s.kit.layers < (s.kit.warm ? 2 : 1)) ch.push({ id: 'layer', label: s.kit.warm && s.kit.layers === 1 ? 'Stop and add your warm layer' : 'Stop and put your jacket on', desc: '2 minutes.', tag: 'safe' });
      ch.push({ id: 'ok', label: 'Keep going, you\'ll warm up', tag: 'bold' });
      return {
        build: () => ({
          title: 'Coldharrow Ridge', text: env.dark
            ? (w === 'storm' ? 'You top out of the Rakes onto the ridge and the storm hits you full in the face: rain coming sideways, wind that shoves you off your line. The flags crack like gunshots.'
              : w === 'fog' ? 'Onto the ridge and into the cloud. Your headlamp makes a white wall a metre ahead. Wind, wet, the next flag a ghost.'
                : 'You top out of the Rakes onto the ridge and the wind arrives all at once, cold enough to make your eyes water. Headlamps strung out along the crest ahead like a necklace.')
            : 'You top out of the Rakes onto Coldharrow Ridge: rock, sky, and the wind. The rest of the ridge rises ahead to the Crown.',
          choices: ch
        }),
        apply: (c) => { if (c === 'layer') { restTick(R, 2); s.kit.layers = s.kit.warm ? 2 : 1; addLog(s, 'neutral', 'Jacket on, hood up. Better.'); } else addLog(s, 'neutral', 'Onto the ridge.'); }
      };
    }
    if (fid === 'crown') {
      if (toSunrise <= 45 && toSunrise > 4) {
        return {
          build: () => ({
            title: 'The Crown, before dawn', big: true,
            text: `The summit cairn of the Crown, 2,140 metres. A marshal in a bivvy bag gives you a thumbs-up. It's ${clockStr(s.t)}. The eastern sky is going grey. Sunrise is about ${Math.round(toSunrise)} minutes away. It'll be cold up here, waiting.`,
            choices: [
              { id: 'wait', label: `Wait for the sunrise on the summit (${Math.round(toSunrise)} min)`, desc: 'Lose time and get cold. Get the view of a lifetime.', tag: 'joy' },
              { id: 'go', label: 'Touch the cairn and keep moving', tag: 'safe' }
            ]
          }),
          apply: (c) => {
            moraleDelta(s, 'the summit', 8); resolveDelta(s, 'the summit', 4);
            if (c === 'wait') { restTick(R, toSunrise + 1); s.flags.waitedSunrise = true; addLog(s, 'neutral', 'You crouch in the lee of the cairn with three other runners and a marshal, and wait.'); }
            else addLog(s, 'good', 'The Crown. The high point of the race. All downhill from here, ha.');
          }
        };
      }
      const light = !env.dark;
      return simple('The Crown', light
        ? (env.fog ? 'The cairn on the Crown looms out of white cloud. 2,140 metres, the high point. You can see nothing at all, and you\'ve never been so happy to see nothing.'
          : `The Crown: 2,140 metres, the roof of the race. Ridges in every direction, valleys still full of morning cloud. You can see the whole route: Witchknee far behind, Mill End in its valley, the bare slope of the Oven ${tmin > 720 ? 'shimmering' : 'already catching the sun'}.`)
        : 'The cairn on the Crown, in the dark. A marshal in a bivvy bag, a flag cracking in the wind, and below you nothing but black. You can\'t see anything. You know it is the highest point of the race, and your legs know it too.',
      light ? 12 : 7, light ? 5 : 3, { big: light, moment: 'summit', tag: 'the summit', log: 'Summit of the Crown, 2,140 m.',
        choices: [{ id: 'look', label: light ? 'Stop and take it in' : 'Touch the cairn', desc: light ? '2 minutes.' : undefined, tag: 'joy' }, { id: 'ok', label: 'Keep moving' }],
        after: (c) => { if (c === 'look' && light) { restTick(R, 2); moraleDelta(s, 'the view', 6); resolveDelta(s, 'the view', 5); } } });
    }
    if (fid === 'witchtop') {
      return simple('Witchknee Top', env.dark
        ? 'Witchknee Top. The wind finds every gap in your clothes. Behind you a river of headlamps winds up through the woods; ahead, a few lights bob away downhill into the dark.'
        : 'Witchknee Top. Heather, wind, and the whole valley laid out behind you.', 4, 2,
      { tag: 'the summit', log: 'Over Witchknee Top.', choices: [{ id: 'look', label: 'Turn round and look at the lights', desc: '1 minute.', tag: 'joy' }, { id: 'ok', label: 'Keep moving' }],
        after: (c) => { if (c === 'look') { restTick(R, 1); moraleDelta(s, 'the view', 4); } } });
    }
    if (fid === 'oventop') {
      return simple('Top of the Oven', `Top of the Oven. ${env.sunLoad > 0.3 ? 'A breeze, finally, on the crest. You stand in it with your arms out like a scarecrow.' : 'The angle eases and the slope rolls over onto the Saddleback.'} Behind you, the slope you just climbed drops away to Fernhollow, tiny and far.`, 7, 4, { tag: 'the summit', log: 'Top of the Oven.' });
    }
    if (fid === 'gallows') {
      const night = env.dark;
      return simple('Gallows Edge', night
        ? 'Gallows Edge. And there, far below in the black valley, a small cluster of orange lights. Lowmere. The finish. You can hear, you\'re almost sure you can hear, the cowbells.'
        : 'Gallows Edge. And there it is, down in the valley: Lowmere. The church tower, the square, the tiny white finish arch. You can hear, you\'re almost sure you can hear, the cowbells.',
      18, 12, { big: true, moment: 'home', tag: 'seeing home', log: 'From Gallows Edge you can see Lowmere.',
        choices: [{ id: 'ok', label: 'Seven kilometres. Go.' }] });
    }
    return simple(f.name, f.name, 4, 0, {});
  }

  function topCauses(s, stat, n) {
    const w = s.why[stat] || {};
    return Object.entries(w).filter(([, v]) => v < -0.3).sort((a, b) => a[1] - b[1]).slice(0, n).map(([k]) => k);
  }

  // ------------------------------------------------------------------ aid stations
  function arriveAid(R, node) {
    const s = R.s;
    if (node.type === 'aid' && s.t > node.cutoff) {
      addLog(s, 'bad', `You reach ${node.name} at ${clockStr(s.t)}. The cutoff was ${clockStr(node.cutoff)}. A marshal gently takes your bib.`);
      return endRace(R, 'timeout', `Missed the cutoff at ${node.name}`);
    }
    s.phase = 'aid';
    s.aid = { node: node.id, arriveT: s.t, did: {}, food: {} };
    if (s.companion && s.companion.id !== 'tomas') endCompanion(s);
    if (node.type === 'aid') {
      resolveDelta(s, 'reaching an aid station', 1);
      addLog(s, 'good', `${node.name} aid station, km ${node.km}, ${clockStr(s.t)}. Cutoff ${clockStr(node.cutoff)}: ${durStr(node.cutoff - s.t)} to spare.`);
      if (s.flags.committedDNF) addLog(s, 'neutral', 'This is where you said you would stop.');
    } else addLog(s, 'neutral', `${node.name}, km ${node.km}.`);
    s.aid.news = aidNews(R, node);
  }

  function aidNews(R, node) {
    const s = R.s;
    const n = [];
    if (s.flags.tomasOut && !s.flags.tomasNews && (s.flags.tomasIgnored || s.flags.tomasWord)) { s.flags.tomasNews = true; n.push('A volunteer on the radio: "Bib 88 has dropped at the last station. Yeah, Brecken. Lift back to Lowmere."'); }
    if (s.flags.jonahSent && !s.flags.jonahNews && node.km > 62) { s.flags.jonahNews = true; s.flags.jonahDNF = true; n.push('You tell them about Jonah. "Pell? He came in about ten minutes behind you, on his knees. He\'s dropped. He\'s alright, he\'s in the van." You don\'t know what you feel.'); }
    if (s.flags.jonahLeft && !s.flags.jonahNews && node.km > 62) { s.flags.jonahNews = true; s.flags.jonahDNF = true; n.push('On the radio: "Bib 141, Pell, being walked down by the sweep." Jonah.'); }
    const ahead = s.flags.tomasModel && !s.done.tomas2 ? tomasKm(R) - s.km : null;
    if (ahead != null && ahead > 0 && ahead < 25 && node.km > 30 && !s.flags.tomasSeen) { s.flags.tomasSeen = true; n.push(`"Bib 88? Came through about ${Math.max(5, Math.round(ahead / 6 * 60 / 5) * 5)} minutes ago," says a volunteer. "Looked rough, to be honest. Wouldn\'t eat."`); }
    return n;
  }

  function aidActions(R) {
    const s = R.s;
    const node = C.NODES.find((n) => n.id === s.aid.node);
    const did = s.aid.did;
    const acts = [];
    const env = envAt(s, s.km, s.t);
    const add = (id, label, time, desc, opts) => acts.push(Object.assign({ id, label, time, desc, done: !!did[id] }, opts || {}));
    add('refill', `Refill flasks (${s.kit.water.toFixed(1)} / ${s.kit.waterCap.toFixed(1)} L)`, 1.5, 'Full water for the next leg.', { done: s.kit.water >= s.kit.waterCap - 0.01, group: 'water' });
    if (node.type === 'water') {
      add('drinkdeep', 'Drink deeply from the trough', 1, '+0.5 L straight in.', { group: 'water', max: 2, count: did.drinkdeep || 0 });
      if (env.sunLoad > 0.2 || s.b.heat > 15) add('dunk', 'Dunk your head and hat in the trough', 1, 'Cools you hard for a while.', { group: 'cool' });
      return acts;
    }
    add('drink', 'Drink cups of water / electrolyte', 1.5, '+0.6 L and a little salt.', { group: 'water', max: 4, count: did.drink || 0 });
    add('restock', `Restock vest: gels, chews, salt caps (${Math.round(s.kit.food)} kcal, ${s.kit.salt} caps)`, 2, `Fill to ${FOOD_MAX} kcal, ${SALT_CAPS_MAX} caps.`, { done: s.kit.food >= FOOD_MAX - 1 && s.kit.salt >= SALT_CAPS_MAX, group: 'food' });
    for (const fid of node.food) {
      if (fid === 'water' || fid === 'electro') continue;
      const f = C.FOOD[fid];
      add('food:' + fid, f.name, f.time, foodDesc(f, s), { group: 'food', max: 3, count: s.aid.food[fid] || 0 });
    }
    if (node.ice || env.sunLoad > 0.3 || env.air > 22) add('ice', 'Ice in your hat and bandana', 1.5, 'Cools you hard for 45 minutes.', { group: 'cool' });
    add('sit', 'Sit down in a chair', 10, 'Morale and will come back a bit. Legs stiffen. Time passes.', { group: 'rest', max: 3, count: did.sit || 0 });
    if (node.cots) add('nap', 'Sleep on a camp bed', 20, '20 minutes. Big boost to alertness. You\'ll be cold and stiff after.', { group: 'rest', max: 1, count: did.nap || 0 });
    if (node.medic) add('medic', 'See the medic: tape feet' + (s.inj.ankle ? ' and ankle' : ''), 8, 'Feet recover a little and wear slower. Ankle strapped.', { group: 'care' });
    if (node.dropBag && !s.dropTaken[node.id]) {
      const items = s.drops[node.id] || [];
      add('drop', 'Open your drop bag' + (items.length ? ': ' + items.map((i) => C.DROP_ITEMS[i].name).join(', ') : ' (empty)'), 3, 'You packed this the night before.', { group: 'care' });
    }
    if (s.kit.socks > 0) add('socks', 'Change into fresh socks', 5, 'Dry feet; feet recover.', { group: 'care' });
    { const maxL = s.kit.warm ? 2 : 1;
      if (s.kit.layers > 0) add('layersoff', 'Take your layers off', 1, 'For a warm leg ahead.', { group: 'care', done: false });
      if (s.kit.layers < maxL) add('layerson', s.kit.layers === 0 ? 'Put your jacket on' : 'Add your warm layer', 1, 'For a cold leg ahead.', { group: 'care', done: false }); }
    if (!did.talk) add('talk', 'Chat to the volunteers', 1, 'News, a joke, a little lift.', { group: 'rest' });
    if ((node.id === 'mill' || node.id === 'lowford') && !s.flags.phone) add('phone', 'Check your phone', 2, 'People are following your tracker.', { group: 'rest' });
    return acts;
  }
  function foodDesc(f, s) {
    const p = [];
    p.push(`${f.kcal} kcal`);
    if (f.salt) p.push('salty');
    if (f.fluid) p.push(`+${f.fluid} L`);
    if (f.soothe) p.push('settles the stomach');
    if (f.caffeine) p.push('caffeine');
    if (f.warm) p.push('warming');
    if (f.cool) p.push('cooling');
    if (f.savory) p.push('savoury');
    if (f.heavy) p.push(s.b.stomach < 50 ? 'heavy: risky with your stomach' : 'heavy: walk out to let it settle');
    return p.join(' · ');
  }

  function doAid(R, id) {
    const s = R.s, b = s.b, kit = s.kit;
    const node = C.NODES.find((n) => n.id === s.aid.node);
    const did = s.aid.did;
    did[id] = (did[id] || 0) + 1;
    if (id === 'refill') { restTick(R, 1.5); kit.water = kit.waterCap; addLog(s, 'neutral', 'Flasks full.'); }
    else if (id === 'drinkdeep') { restTick(R, 1); b.hyd = clamp(b.hyd + 0.5 / ML_PER_PT * 0.9, 0, 100); }
    else if (id === 'dunk') { restTick(R, 1); s.iceUntil = s.t + 35; if (b.heat > 0) b.heat = Math.max(-5, b.heat - 35); addLog(s, 'good', 'Head in the trough. You come up gasping, cold water running down your back.'); }
    else if (id === 'drink') { restTick(R, 1.5); b.hyd = clamp(b.hyd + 0.6 / ML_PER_PT * (b.salt < 35 ? 0.75 : 0.92), 0, 100); b.salt = clamp(b.salt + 6, 0, 100); }
    else if (id === 'restock') { restTick(R, 2); kit.food = FOOD_MAX; kit.salt = SALT_CAPS_MAX; addLog(s, 'neutral', 'Vest restocked.'); }
    else if (id.startsWith('food:')) {
      const fid = id.slice(5); const f = C.FOOD[fid];
      s.aid.food[fid] = (s.aid.food[fid] || 0) + 1;
      restTick(R, f.time);
      if (f.kcal) eatNow(s, f.kcal, { savory: f.savory, sweet: f.sweet != null ? f.sweet : f.savory ? false : 0.4 });
      if (f.heavy && b.stomach < 50) b.stomach = clamp(b.stomach - 8, 0, 100);
      if (f.fluid) b.hyd = clamp(b.hyd + f.fluid / ML_PER_PT * 0.92, 0, 100);
      if (f.salt) b.salt = clamp(b.salt + f.salt, 0, 100);
      if (f.soothe) b.stomach = clamp(b.stomach + f.soothe, 0, 100);
      if (f.caffeine) b.caffeine += f.caffeine;
      if (f.warm && b.heat < 10) b.heat = Math.min(10, b.heat + f.warm);
      if (f.cool) b.heat -= f.cool;
      s.eatenAid += f.kcal;
      if (!s.aid.ateLift) { s.aid.ateLift = true; moraleDelta(s, 'aid station food', 3); }
      if (f.savory && b.sugar > 6) addLog(s, 'good', `${f.name}. After hours of sweet gels, the salt is the best thing you've ever tasted.`);
      else addLog(s, 'neutral', `${f.name}.`);
    }
    else if (id === 'ice') { restTick(R, 1.5); s.iceUntil = s.t + 45; if (b.heat > 0) b.heat = Math.max(-5, b.heat - 30); addLog(s, 'good', 'Ice in your hat, ice in a bandana round your neck. Shockingly cold. Wonderful.'); }
    else if (id === 'sit') {
      restTick(R, 10);
      moraleDelta(s, 'sitting down', 7); resolveDelta(s, 'sitting down', 6);
      addLog(s, 'neutral', pick(s, ['The chair is the most comfortable object in the world.', 'You sit. Your legs buzz. Someone puts a blanket round your shoulders.', 'Sitting down is wonderful. Getting up will not be.']));
    }
    else if (id === 'nap') { restTick(R, 20); b.alert = clamp(b.alert + 42, 0, 100); moraleDelta(s, 'sleep', 5); b.heat -= 15; addLog(s, 'good', 'Twenty minutes of black, dreamless sleep. A volunteer shakes your shoulder. You wake up a different person: cold, stiff, but awake.'); }
    else if (id === 'medic') {
      restTick(R, 8);
      s.inj.feetTaped = true; b.feet = clamp(b.feet + 10, 0, 100);
      if (s.inj.ankle) s.inj.ankleTaped = true;
      addLog(s, 'neutral', 'The medic lances, dries and tapes your feet with terrifying efficiency.' + (s.inj.ankle ? ' Your ankle gets strapped tight.' : ''));
    }
    else if (id === 'drop') {
      restTick(R, 3);
      s.dropTaken[node.id] = true;
      const items = s.drops[node.id] || [];
      for (const it of items) {
        if (it === 'socks') kit.socks++;
        else if (it === 'flask') { kit.waterCap += 0.5; kit.water += 0.5; }
        else if (it === 'caffeine') kit.caffeine += 3;
        else if (it === 'headphones') { kit.headphones = true; kit.musicMin = 300; }
        else if (it === 'sunhat') kit.sunhat = true;
        else if (it === 'warm') kit.warm = true;
        else if (it === 'poles') kit.poles = true;
        else if (it === 'batteries') kit.spareBattery++;
        else if (it === 'note') kit.note = true;
        else if (it === 'riceballs') kit.rice += 3;
      }
      addLog(s, 'neutral', items.length ? `Drop bag: ${items.map((i) => C.DROP_ITEMS[i].name).join(', ')}.` : 'Your drop bag is empty. Past you was optimistic.');
    }
    else if (id === 'socks') {
      restTick(R, 5); kit.socks--; s.wetUntil = -1; b.feet = clamp(b.feet + (b.feet < 60 ? 14 : 8), 0, 100);
      addLog(s, 'good', 'Fresh, dry socks. You make an involuntary noise.');
    }
    else if (id === 'talk') { restTick(R, 1); moraleDelta(s, 'the volunteers', 2); }
    else if (id === 'layersoff' || id === 'layerson') { const maxL = kit.warm ? 2 : 1; kit.layers = id === 'layersoff' ? 0 : Math.min(maxL, kit.layers + 1); restTick(R, 1); addLog(s, 'neutral', kit.layers === 0 ? 'Layers off and stuffed in your vest.' : kit.layers === 1 ? 'Jacket on.' : 'Warm layer on under the jacket.'); }
    else if (id === 'phone') {
      restTick(R, 2); s.flags.phone = true;
      const n = 20 + Math.floor(rand(s) * 40);
      moraleDelta(s, 'messages from home', 8); resolveDelta(s, 'messages from home', 6);
      addLog(s, 'good', `${n} messages. People you haven't spoken to in years are watching a dot crawl across a map at 3 a.m. and sending you exclamation marks. "GO ON!!" "You're flying!!" (You are not flying.)`, { moment: 'messages' });
    }
  }

  function leaveAid(R) {
    const s = R.s;
    const node = C.NODES.find((n) => n.id === s.aid.node);
    const dwell = s.t - s.aid.arriveT;
    if (node.type === 'aid' && s.t > node.cutoff) {
      addLog(s, 'bad', `It's ${clockStr(s.t)}. The cutoff here was ${clockStr(node.cutoff)}. You've sat too long; a marshal takes your bib.`);
      return endRace(R, 'timeout', `Timed out at ${node.name}`);
    }
    if (s.flags.committedDNF) { s.flags.committedDNF = false; s.flags.changedMind = true; addLog(s, 'good', 'You said you would stop here. You stand up anyway.', { moment: 'unquit' }); resolveDelta(s, 'refusing to quit', 15); moraleDelta(s, 'refusing to quit', 10); }
    if (dwell > 12) {
      s.stiffUntil = s.t + Math.min(30, (dwell - 12) * 1.5);
      moraleDelta(s, 'getting going again', -3);
      addLog(s, 'neutral', `${Math.round(dwell)} minutes at ${node.name}. Your legs have set like concrete; the first kilometre is a stiff hobble.`);
    } else addLog(s, 'neutral', `Out of ${node.name} after ${Math.max(1, Math.round(dwell))} min.`);
    s.aid = null;
    s.phase = 'section';
    startSecLog(R);
  }

  // How strongly the aid station pulls you towards stopping (0..1), and why.
  function dnfReasons(R) {
    const s = R.s, b = s.b, m = s.m;
    const parts = [];
    if (m.morale < 60) parts.push(['you feel awful', clamp((60 - m.morale) / 40, 0, 1)]);
    if (m.resolve < 55) parts.push(['your will is fading', clamp((55 - m.resolve) / 35, 0, 1)]);
    if (b.legs < 35) parts.push(['your legs are wrecked', clamp((35 - b.legs) / 35, 0, 1) * 0.7]);
    if (s.inj.ankle >= 2) parts.push(['your ankle', 0.7]);
    if (b.stomach < 30) parts.push(['your stomach', 0.5]);
    if (b.feet < 35) parts.push(['your feet', 0.4]);
    if (b.hyd < 45) parts.push(['you are badly dehydrated', 0.5]);
    if (b.energy < 20) parts.push(['you are running on empty', 0.4]);
    const node = s.aid && C.NODES.find((n) => n.id === s.aid.node);
    const na = node && nextAid(node.km);
    if (na && na.cutoff) {
      const rem = eqAt(na.km) - eqAt(s.km);
      const margin = na.cutoff - (s.t + rem / Math.max(2, s.paceEq) * 60);
      if (margin < 0) parts.push(['the next cutoff looks impossible', 0.9]);
      else if (margin < 60) parts.push(['the next cutoff is close', 0.6]);
    }
    if (s.flags.committedDNF) parts.push(['you promised yourself you would stop here', 0.9]);
    parts.sort((a, c) => c[1] - a[1]);
    let x = parts.length ? parts[0][1] : 0;
    for (let i = 1; i < parts.length; i++) x += parts[i][1] * 0.2;
    return { score: clamp(x, 0, 1), reasons: parts.map((p) => p[0]) };
  }
  function dnfTemptation(R) { return dnfReasons(R).score; }

  // ------------------------------------------------------------------ outcomes
  function finishRace(R) {
    const s = R.s;
    const fin = C.NODES.find((n) => n.type === 'finish');
    if (s.t > fin.cutoff) {
      addLog(s, 'bad', `You cross the line in Lowmere at ${clockStr(s.t)}, ${durStr(s.t - fin.cutoff)} after the 28-hour cutoff. The arch is half taken down. A marshal waited for you anyway.`);
      return endRace(R, 'timeout', 'Finished after the 28-hour cutoff');
    }
    s.phase = 'done';
    s.rank = computeRank(R);
    const st = R.field ? fieldStats(R) : null;
    // count runners who eventually finish ahead
    let finishers = 1, ahead = 0;
    if (R.field) for (const rn of R.field.runners) { if (rn.finishT != null) { finishers++; if (rn.finishT < s.t) ahead++; } }
    s.outcome = { kind: 'finish', t: s.t, place: ahead + 1, finishers, starters: (R.field ? R.field.runners.length : 0) + 1, km: 100 };
    addLog(s, 'good', `Finish. ${durStr(s.t)}. ${ordinal(ahead + 1)} of ${finishers} finishers.`, { moment: 'finish' });
    moraleDelta(s, 'the finish line', 100); resolveDelta(s, 'the finish line', 100);
    pushHist(s);
    return s.outcome;
  }
  function endRace(R, kind, why) {
    const s = R.s;
    s.phase = 'done';
    s.outcome = { kind, t: s.t, km: s.km, why, starters: (R.field ? R.field.runners.length : 0) + 1 };
    pushHist(s);
    return s.outcome;
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

  // ------------------------------------------------------------------ estimates
  function cloneState(s) { return JSON.parse(JSON.stringify(s)); }
  function estimate(R, effort) {
    const s2 = cloneState(R.s);
    s2.estimate = true; s2.effort = effort; s2.companion = R.s.companion && R.s.companion.effort === effort ? R.s.companion : null;
    if (s2.companion == null && R.s.companion) s2.companion = null;
    s2.phase = 'moving'; s2._riskSum = 0;
    const R2 = { s: s2, field: null };
    const b0 = R.s.b, t0 = s2.t, w0 = s2.kit.water, f0 = s2.kit.food;
    const sec = C.SECTIONS[s2.sec];
    let guard = 0;
    while (s2.km < sec.to - 1e-9 && guard++ < 500) {
      const nextGrid = Math.floor(s2.km / STEP + 1e-6 + 1) * STEP;
      stepMove(R2, Math.min(sec.to, nextGrid) - s2.km);
    }
    const b = s2.b;
    return {
      effort, minutes: s2.t - t0,
      arrive: s2.t,
      d: {
        energy: b.energy - b0.energy, hyd: b.hyd - b0.hyd, stomach: b.stomach - b0.stomach,
        legs: (b.legs - b.legsPending) - (b0.legs - b0.legsPending), feet: b.feet - b0.feet, heat: b.heat - b0.heat, morale: s2.m.morale - R.s.m.morale
      },
      end: { energy: b.energy, hyd: b.hyd, stomach: b.stomach, legs: b.legs - b.legsPending, heat: b.heat },
      water: w0 - s2.kit.water, waterLeft: s2.kit.water, food: f0 - s2.kit.food,
      fall: 1 - Math.exp(-(s2._riskSum || 0))
    };
  }

  // projection to the next cutoff with a given effort through the rest of the course to that node
  // how much you'd want to drink before the next place with water, at a given effort
  function legWater(R, effort) {
    const s2 = cloneState(R.s);
    s2.estimate = true; s2.effort = effort; s2.companion = null; s2.phase = 'moving'; s2._thirst = 0;
    const R2 = { s: s2, field: null };
    const node = C.NODES.find((n) => n.km > s2.km + 1e-6 && (n.type === 'aid' || n.type === 'water' || n.type === 'finish'));
    if (!node) return null;
    let guard = 0;
    while (s2.km < node.km - 1e-9 && guard++ < 1200) {
      const sec = C.SECTIONS[s2.sec];
      if (s2.km >= sec.to - 1e-9) { s2.sec++; continue; }
      const nextGrid = Math.floor(s2.km / STEP + 1e-6 + 1) * STEP;
      stepMove(R2, Math.min(sec.to, nextGrid) - s2.km);
    }
    return { node: node.name, km: node.km - R.s.km, minutes: s2.t - R.s.t, liters: s2._thirst, carry: R.s.kit.waterCap };
  }

  function projectToNext(R, effort) {
    const s2 = cloneState(R.s);
    s2.estimate = true; s2.effort = effort; s2.companion = null; s2.phase = 'moving';
    const R2 = { s: s2, field: null };
    const node = nextAid(s2.km);
    if (!node) return null;
    let guard = 0;
    while (s2.km < node.km - 1e-9 && guard++ < 1200) {
      const sec = C.SECTIONS[s2.sec];
      if (s2.km >= sec.to - 1e-9) { s2.sec++; continue; }
      const nextGrid = Math.floor(s2.km / STEP + 1e-6 + 1) * STEP;
      stepMove(R2, Math.min(sec.to, nextGrid) - s2.km);
    }
    return { node: node.name, km: node.km, arrive: s2.t, cutoff: node.cutoff, margin: node.cutoff - s2.t };
  }

  // ------------------------------------------------------------------ public decision API
  function decision(R, opt) {
    const s = R.s;
    const light = opt && opt.light;
    if (s.phase === 'event') {
      const def = EVENTS[s.event.id];
      if (!s.event.built) s.event.built = def.build(R, s.event.ctx);
      return Object.assign({ kind: 'event', id: s.event.id }, s.event.built);
    }
    if (s.phase === 'aid') {
      const node = C.NODES.find((n) => n.id === s.aid.node);
      const dr = dnfReasons(R);
      return { kind: 'aid', node, actions: aidActions(R), dwell: s.t - s.aid.arriveT, news: s.aid.news, temptation: node.type === 'aid' ? dr.score : 0, temptReasons: dr.reasons,
        canDNF: node.type === 'aid', next: nextAid(node.km), projection: light ? null : projectToNext(R, s.effort === 'push' ? 'steady' : s.effort),
        water: light ? null : legWater(R, s.effort === 'push' ? 'steady' : s.effort) };
    }
    if (s.phase === 'section') {
      const sec = C.SECTIONS[s.sec];
      const kind = sectionKindLabel(sec);
      const options = EFFORTS.map((e) => {
        const est = light ? null : estimate(R, e);
        return { effort: e, label: LABELS[kind][e], hint: HINTS[kind][e], est,
          disabled: (e === 'push' && s.m.morale < 20) ? 'You can\'t make yourself push right now.' : null,
          companion: s.companion && s.companion.effort === e ? s.companion.name : null };
      });
      return { kind: 'section', sec, fromKm: s.km, remainingKm: sec.to - s.km, fresh: Math.abs(s.km - sec.from) < 1e-6, options,
        effort: s.effort, fuel: s.fuel, ration: s.ration, quick: quickActions(R), companion: s.companion,
        projection: light ? null : projectToNext(R, s.effort), forcedWalk: s.t < s.forcedWalkUntil || s.flags.committedDNF || s.inj.ankle >= 3 };
    }
    return { kind: 'done', outcome: s.outcome };
  }

  function quickActions(R) {
    const s = R.s, kit = s.kit;
    const q = [];
    q.push({ id: 'gel', label: `Gel now (${Math.floor(kit.food / 100)} left)`, desc: '+100 kcal, hits in ~20 min', disabled: kit.food < 100 });
    if (kit.caffeine > 0) q.push({ id: 'caff', label: `Caffeine gel (${kit.caffeine})`, desc: '+100 kcal, +alertness' });
    if (kit.rice > 0) q.push({ id: 'rice', label: `Rice ball (${kit.rice})`, desc: '+200 kcal, savoury, resets sugar fatigue' });
    q.push({ id: 'salt', label: `Salt cap (${kit.salt})`, desc: 'Restores salt', disabled: kit.salt <= 0 });
    const maxL = kit.warm ? 2 : 1;
    q.push({ id: 'layers', label: kit.layers === 0 ? 'Put jacket on' : kit.layers < maxL ? 'Add warm layer' : 'Take layers off', desc: 'About a minute' });
    if (kit.headphones && kit.musicMin > 0) q.push({ id: 'music', label: kit.music ? 'Music off' : `Music on (${Math.round(kit.musicMin / 60 * 10) / 10}h battery)`, desc: 'Morale drains slower; no chatting' });
    if (kit.spareBattery > 0 && kit.battery < 60) q.push({ id: 'battery', label: 'Swap headlamp batteries', desc: '2 minutes' });
    if (kit.note && !s.flags.noteRead) q.push({ id: 'note', label: 'Open the note from home', desc: 'One time only', reason: true });
    reasonsLeft(s).forEach((r, i) => q.push({ id: 'reason' + i, label: 'Remember: ' + (r.short || 'why'), desc: r.text + ' (one use: a big lift to morale and resolve)', reason: true }));
    return q;
  }

  function doQuick(R, id) {
    const s = R.s, kit = s.kit;
    if (id === 'gel' && kit.food >= 100) { kit.food -= 100; eatNow(s, 100); addLog(s, 'neutral', 'Gel.'); restTick(R, 0.3); }
    else if (id === 'caff' && kit.caffeine > 0) { kit.caffeine--; eatNow(s, 100); s.b.caffeine += 25; addLog(s, 'neutral', 'Caffeine gel. Bitter, sticky, wonderful.'); restTick(R, 0.3); }
    else if (id === 'rice' && kit.rice > 0) { kit.rice--; eatNow(s, 200, { savory: true, sweet: false }); addLog(s, 'neutral', 'A rice ball, salty and plain. Real food.'); restTick(R, 1); }
    else if (id === 'salt' && kit.salt > 0) { kit.salt--; s.b.salt = clamp(s.b.salt + 15, 0, 100); addLog(s, 'neutral', 'Salt cap.'); }
    else if (id === 'layers') {
      const maxL = kit.warm ? 2 : 1;
      kit.layers = kit.layers < maxL ? kit.layers + 1 : 0;
      restTick(R, 1);
      addLog(s, 'neutral', kit.layers === 0 ? 'Layers off, tied round your waist.' : kit.layers === 1 ? 'Jacket on.' : 'Warm layer on under the jacket.');
    }
    else if (id === 'music') { kit.music = !kit.music; if (kit.music && s.companion) endCompanion(s, 'You put your headphones in.'); addLog(s, 'neutral', kit.music ? 'Headphones in. The playlist you made in a better mood.' : 'Headphones out.'); }
    else if (id === 'battery' && kit.spareBattery > 0) { kit.spareBattery--; kit.battery = 100; restTick(R, 2); addLog(s, 'neutral', 'Fresh headlamp batteries.'); }
    else if (id === 'note' && kit.note) readNote(R);
    else if (id.startsWith('reason')) useReason(R, +id.slice(6));
  }

  // act(R, action) -> { frames }
  function act(R, a) {
    const s = R.s;
    let frames = [];
    if (s.phase === 'done') return { frames };
    if (a.type === 'fuel' && FUEL[a.plan] != null) { s.fuel = a.plan; return { frames }; }
    if (a.type === 'ration') { s.ration = !!a.on; return { frames }; }
    if (a.type === 'quick') { doQuick(R, a.id); return { frames }; }
    if (a.type === 'event' && s.phase === 'event') {
      const def = EVENTS[s.event.id];
      const ctx = s.event.ctx;
      if (!s.event.built) s.event.built = def.build(R, ctx);
      const built = s.event.built;
      const ch = built.choices.find((c) => c.id === a.choice);
      if (!ch || ch.disabled) return { frames, error: 'invalid choice' };
      s.event.chosen = ch.id;
      const evId = s.event.id;
      if (!s.flags.evlog) s.flags.evlog = [];
      s.flags.evlog.push({ id: evId, c: ch.id, km: Math.round(s.km * 10) / 10, t: Math.round(s.t) });
      def.apply(R, ch.id, ctx);
      if (s.phase === 'done') return { frames };
      s.event = null;
      if (s.pendingEvents.length) { const e = s.pendingEvents.shift(); openEvent(R, e.id, e.ctx || {}); return { frames }; }
      // start-line event → begin race
      if (evId === 'jonah0') { s.phase = 'section'; startSecLog(R); return { frames }; }
      s.phase = 'section';
      // an event that fired exactly at the end of a section: carry straight on
      if (s.km >= C.SECTIONS[s.sec].to - 1e-9) { s.phase = 'moving'; frames = advance(R); }
      return { frames };
    }
    if (a.type === 'go' && s.phase === 'section') {
      if (EFFORTS.indexOf(a.effort) < 0) return { frames, error: 'bad effort' };
      if (a.effort === 'push' && s.m.morale < 20) a.effort = 'steady';
      if (s.companion && s.companion.effort !== a.effort) endCompanion(s, `You ${EFFORTS.indexOf(a.effort) > EFFORTS.indexOf(s.companion.effort) ? 'pull away from' : 'let'} ${s.companion.name}${EFFORTS.indexOf(a.effort) > EFFORTS.indexOf(s.companion.effort) ? '' : ' go on ahead'}.`);
      s.effort = a.effort;
      if (!s.secAcc) startSecLog(R);
      s.secAcc.efforts[a.effort] = (s.secAcc.efforts[a.effort] || 0) + 1;
      frames = advance(R);
      return { frames };
    }
    if (a.type === 'aid' && s.phase === 'aid') { doAid(R, a.id); return { frames }; }
    if (a.type === 'leave' && s.phase === 'aid') { leaveAid(R); return { frames }; }
    if (a.type === 'dnf' && s.phase === 'aid') {
      const node = C.NODES.find((n) => n.id === s.aid.node);
      if (node.type !== 'aid') return { frames, error: 'no dnf here' };
      addLog(s, 'neutral', `You hand your bib to the volunteer at ${node.name}. ${s.flags.injuryDNF ? 'The medic agrees.' : ''}`);
      endRace(R, 'dnf', `Dropped at ${node.name}`);
      return { frames };
    }
    return { frames, error: 'invalid action for phase ' + s.phase };
  }

  // ------------------------------------------------------------------ report
  function report(R) {
    const s = R.s;
    // the trail only: the finish-line lift would otherwise count as "coming back" from any low
    const h = s.outcome && s.outcome.kind === 'finish' ? s.hist.slice(0, -1) : s.hist;
    let low = null, high = null;
    for (const p of h) { if (!low || p.morale < low.morale) low = p; }
    // biggest recovery after the low
    if (low) for (const p of h) if (p.t > low.t && (!high || p.morale > high.morale)) high = p;
    const legsDesc = Object.entries(s.legsBySec || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => ({ where: k, dmg: Math.round(v) }));
    const tot = (stat) => Object.entries(s.tot[stat] || {}).filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k, v]) => ({ cause: k, amt: Math.round(-v) }));
    const plus = (stat) => Object.entries(s.tot[stat] || {}).filter(([k, v]) => v > 0 && k !== 'the finish line').sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ cause: k, amt: Math.round(v) }));
    return {
      outcome: s.outcome, low, high, legsDesc,
      moraleDrains: tot('morale'), moraleGains: plus('morale'), stomach: tot('stomach'),
      kcal: Math.round(s.kcalIn), hours: s.t / 60, passMade: s.passMade, passTaken: s.passTaken,
      falls: s.flags.fallLog || [], darkPatches: s.flags.darkPatches || 0, broke: s.flags.broke || 0,
      named: namedFates(R), secLog: s.secLog
    };
  }
  function namedFates(R) {
    const s = R.s, f = s.flags, out = [];
    const T = s.outcome ? s.outcome.t : s.t;
    const fin = s.outcome && s.outcome.kind === 'finish';
    // Tomas
    if (f.tomasTogether === false && s.done.tomas3) out.push({ who: 'Tomas Brecken', text: 'Ran with you for a while on the last descent, then you went your separate ways. He found you at the finish anyway.' });
    else if (f.tomasTogether && fin) out.push({ who: 'Tomas Brecken', text: `Finished with you, ${durStr(T)}, arm in arm. "Next year," he says, "I'm starting with you."` });
    else if (f.racedTomas && fin) {
      const won = s.b.legs > 20 && !(f.fallLog || []).some((x) => x.km > 94);
      out.push({ who: 'Tomas Brecken', text: won ? `You beat him to the line by ${3 + (s.seed % 20)} seconds. He collapses laughing on the cobbles.` : `He beat you to the line by a few seconds. You both lie on the cobbles laughing.` });
    } else if (f.tomasHelped) out.push({ who: 'Tomas Brecken', text: 'Recovered after you helped him, and finished in the dark, very humble.' });
    else if (f.tomasOut) out.push({ who: 'Tomas Brecken', text: 'Dropped out after the ridge. Went out far too fast.' });
    else out.push({ who: 'Tomas Brecken', text: s.done.tomas2 ? 'Somewhere behind you.' : 'Stayed ahead of you all day. Went out fast and somehow held on.' });
    // Ines
    const inesT = 1230 + (s.seed % 60);
    const knewInes = f.inesFriend || s.done.ines2;
    out.push({ who: 'Ines Arrabal', text: !knewInes ? `Finished in ${durStr(inesT)}. Her twenty-third hundred.`
      : fin && inesT > T ? `Came in ${durStr(inesT - T)} after you, her twenty-third hundred. You were waiting at the line for her, and she hugged you like you were family.`
        : `Finished her twenty-third hundred in ${durStr(inesT)}.${fin ? ' She was waiting at the line for you, eating chips.' : ''}` });
    // Jonah
    if (f.jonahHelped) out.push({ who: 'Jonah Pell', text: fin ? 'Finished his first hundred. He hugged you at the line for an uncomfortably long time.' : 'Finished his first hundred, thanks to you.' });
    else if (f.jonahDNF) out.push({ who: 'Jonah Pell', text: 'Dropped out in the afternoon. He says he\'ll be back next year.' });
    else out.push({ who: 'Jonah Pell', text: f.jonahAdvice ? 'Started slow, like you told him. Finished his first hundred in the dark, shaking.' : 'Went out with the fast crowd. Dropped at Mill End.' });
    return out;
  }

  // public
  return {
    C, STEP, EFFORTS, LABELS, HINTS, FUEL, FOOD_MAX, TOTAL_GAIN, SUNRISE, SUNSET,
    newRace, decision, act, report, estimate, projectToNext,
    elevAt, envAt, daylight, sunHeight, clockOf, clockStr, durStr, ordinal, sectionIndexAt, nodeAt, nextAid,
    nearbyRunners, computeRank, fieldStats, npcKmAt, cutoffMargin, topCauses, dnfTemptation, dnfReasons, tomasKm,
    effectiveEffort, weatherOf, sectionKindLabel, kcalLastHours,
    _internal: { rawSpeed, updateBody, EVENTS, buildField, refSegmentMinutes, cloneState }
  };
});
