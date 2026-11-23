#!/usr/bin/env node
/* Headless playtester: plays many races with scripted strategies and reports
 * outcomes, times, emotional-arc statistics and quitting temptation.
 *
 *   node tools/headless.js            # summary table, 60 races per strategy
 *   node tools/headless.js --n 200    # more races
 *   node tools/headless.js --trace sensible --seed 7   # one race, curves + log
 *   node tools/headless.js --csv out.csv --trace sensible --seed 7
 */
'use strict';
const S = require('../js/sim.js');
const C = S.C;

// ------------------------------------------------------------------ strategies
const tagPref = (prefs) => (d) => {
  const ok = d.choices.filter((c) => !c.disabled);
  for (const p of prefs) { const c = ok.find((x) => x.tag === p); if (c) return c.id; }
  const nonQuit = ok.filter((c) => c.tag !== 'quit');
  return (nonQuit[0] || ok[0]).id;
};

function baseCare(R, d, acts, opt) {
  const s = R.s, b = s.b, kit = s.kit;
  opt = opt || {};
  // fuel plan
  let fuel = opt.fuel || 'steady';
  if (!opt.fuel) {
    if (b.stomach < 40) fuel = 'light';
    else if (b.energy < 25 && b.stomach > 55) fuel = 'heavy';
  }
  if (s.fuel !== fuel) acts.push({ type: 'fuel', plan: fuel });
  if (!opt.noSalt && b.salt < 55 && kit.salt > 0) acts.push({ type: 'quick', id: 'salt' });
  if (!opt.noLayers) {
    const maxL = kit.warm ? 2 : 1;
    if (b.heat < -25 && kit.layers < maxL) acts.push({ type: 'quick', id: 'layers' });
    else if (b.heat > 20 && kit.layers > 0) { for (let i = kit.layers; i <= maxL; i++) acts.push({ type: 'quick', id: 'layers' }); }
  }
  if (!opt.noMind && s.m.morale < 25) {
    const q = d.quick.find((x) => x.reason);
    if (q) acts.push({ type: 'quick', id: q.id });
  }
  if (kit.caffeine > 0 && b.alert < 35) acts.push({ type: 'quick', id: 'caff' });
  if (kit.headphones && !kit.music && kit.musicMin > 0 && s.m.morale < 45 && !s.companion) acts.push({ type: 'quick', id: 'music' });
  if (kit.spareBattery > 0 && kit.battery < 20) acts.push({ type: 'quick', id: 'battery' });
}

function aidPlan(R, d, opt) {
  opt = opt || {};
  const s = R.s, b = s.b;
  const has = (id) => d.actions.find((a) => a.id === id && !a.done && !(a.max && a.count >= a.max));
  if (opt.quitAt && d.canDNF && d.temptation >= opt.quitAt) return { type: 'dnf' };
  if (s.inj.ankle >= 3 && d.canDNF) return { type: 'dnf' };
  if (has('refill')) return { type: 'aid', id: 'refill' };
  if (has('drinkdeep') && b.hyd < 90) return { type: 'aid', id: 'drinkdeep' };
  if (has('dunk') && b.heat > 10) return { type: 'aid', id: 'dunk' };
  if (d.node.type === 'water') return { type: 'leave' };
  if (has('drop')) return { type: 'aid', id: 'drop' };
  if (has('drink') && b.hyd < 88) return { type: 'aid', id: 'drink' };
  if (opt.noEat) return { type: 'leave' };
  if (has('restock')) return { type: 'aid', id: 'restock' };
  const ate = Object.values(s.aid.food).reduce((a, x) => a + x, 0);
  const eatTarget = b.energy < 50 ? 3 : 2;
  if (ate < eatTarget) {
    const prefs = b.stomach < 50 ? ['broth', 'ginger', 'cola', 'watermelon', 'noodles'] : ['potatoes', 'noodles', 'broth', 'cola', 'crisps', 'pizza', 'watermelon', 'tea'];
    for (const f of prefs) if (has('food:' + f) && !(s.aid.food[f] >= 1)) return { type: 'aid', id: 'food:' + f };
  }
  if (has('ice') && b.heat > 15) return { type: 'aid', id: 'ice' };
  if (has('socks') && (s.t < s.wetUntil || b.feet < 70)) return { type: 'aid', id: 'socks' };
  if (has('medic') && (b.feet < 60 || s.inj.ankle)) return { type: 'aid', id: 'medic' };
  if (has('nap') && b.alert < 30) return { type: 'aid', id: 'nap' };
  if (opt.sit && has('sit') && s.m.resolve < 30) return { type: 'aid', id: 'sit' };
  if (has('phone')) return { type: 'aid', id: 'phone' };
  if (has('talk')) return { type: 'aid', id: 'talk' };
  return { type: 'leave' };
}

function sensibleEffort(R, sec) {
  const s = R.s;
  if (sec.kind === 'climb') return 'easy';
  if (sec.kind === 'descent') return sec.tech > 0.5 || s.b.legs < 45 ? 'easy' : 'steady';
  return s.b.legs < 35 || s.b.energy < 20 ? 'easy' : 'steady';
}

function makeStrategy(name, effortFn, opts) {
  opts = opts || {};
  return {
    name,
    drops: opts.drops,
    decide(R, d) {
      if (d.kind === 'event') return { type: 'event', choice: (opts.eventPick || tagPref(['safe', 'kind', 'reason', 'neutral', 'joy']))(d, R) };
      if (d.kind === 'aid') return aidPlan(R, d, opts.aid);
      if (d.kind === 'section') {
        const acts = [];
        baseCare(R, d, acts, opts.care);
        if (opts.ration != null && R.s.ration !== opts.ration) acts.push({ type: 'ration', on: opts.ration });
        let eff = effortFn(R, d.sec);
        if (d.companion && opts.company !== false) eff = d.companion.effort;
        acts.push({ type: 'go', effort: eff });
        return acts;
      }
      return null;
    }
  };
}

const rnd = (R) => (R.s.rng >>> 0) % 1000 / 1000;
const STRATS = {
  sensible: makeStrategy('sensible', sensibleEffort),
  even: makeStrategy('even-steady', () => 'steady'),
  hard: makeStrategy('out-hard', (R, sec) => R.s.km < 30 ? 'push' : sensibleEffort(R, sec)),
  typical: (function () {
    // Sensible intent, human sloppiness. Deterministic per race seed.
    let rng = null, seedSeen = null;
    const r = (R) => { if (seedSeen !== R.s.seed) { seedSeen = R.s.seed; let a = R.s.seed ^ 0xBEEF; rng = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; } return rng(); };
    return {
      name: 'typical-human',
      decide(R, d) {
        const s = R.s;
        if (d.kind === 'event') {
          const ok = d.choices.filter((c) => !c.disabled && c.tag !== 'quit');
          const safe = ok.find((c) => c.tag === 'safe' || c.tag === 'reason' || c.tag === 'kind');
          return { type: 'event', choice: (r(R) < 0.6 && safe ? safe : ok[Math.floor(r(R) * ok.length)] || d.choices[0]).id };
        }
        if (d.kind === 'aid') {
          if (s.inj.ankle >= 3 && d.canDNF) return { type: 'dnf' };
          const a = aidPlan(R, d, { sit: true });
          if (a.type === 'aid' && a.id.startsWith('food') && r(R) < 0.3) return { type: 'leave' };
          return a;
        }
        const acts = [];
        if (r(R) < 0.25) acts.push({ type: 'fuel', plan: ['light', 'steady', 'steady', 'heavy', 'none'][Math.floor(r(R) * 5)] });
        else if (s.fuel === 'none' && s.b.energy < 40) acts.push({ type: 'fuel', plan: 'steady' });
        if (s.b.salt < 40 && s.kit.salt > 0 && r(R) < 0.5) acts.push({ type: 'quick', id: 'salt' });
        if (s.b.heat < -35 && s.kit.layers === 0 && r(R) < 0.7) acts.push({ type: 'quick', id: 'layers' });
        if (s.b.heat > 25 && s.kit.layers > 0) acts.push({ type: 'quick', id: 'layers' });
        if (s.m.morale < 20) { const q = d.quick.find((x) => x.reason); if (q) acts.push({ type: 'quick', id: q.id }); }
        let eff = sensibleEffort(R, d.sec);
        const x = r(R);
        if (x < 0.25 && eff !== 'push') eff = S.EFFORTS[S.EFFORTS.indexOf(eff) + 1];
        else if (x > 0.9 && eff !== 'walk') eff = S.EFFORTS[S.EFFORTS.indexOf(eff) - 1];
        if (d.companion && r(R) < 0.7) eff = d.companion.effort;
        acts.push({ type: 'go', effort: eff });
        return acts;
      }
    };
  })(),
  hardadapt: makeStrategy('out-hard-adapts', (R, sec) => {
    const s = R.s;
    if (s.b.energy < 35 || s.b.stomach < 50 || s.flags.bonked) { s.flags.bonked = true; return sensibleEffort(R, sec); }
    return s.km < 30 ? 'push' : sensibleEffort(R, sec);
  }),
  noeat: makeStrategy('never-eat', sensibleEffort, { care: { fuel: 'none' }, aid: { noEat: true } }),
  walk: makeStrategy('walk-all', () => 'walk'),
  bomb: makeStrategy('bomb-descents', (R, sec) => sec.kind === 'descent' ? 'push' : sensibleEffort(R, sec)),
  gels: makeStrategy('heavy-fuel', sensibleEffort, { care: { fuel: 'heavy' } }),
  pushall: makeStrategy('push-all', () => 'push'),
  easyall: makeStrategy('easy-all', () => 'easy'),
  nocare: makeStrategy('no-body-care', sensibleEffort, { care: { noSalt: true, noLayers: true, noMind: true }, eventPick: tagPref(['bold', 'neutral', 'safe']) }),
  quitter: makeStrategy('quits-when-tempted', sensibleEffort, { aid: { quitAt: 0.5 } }),
  random: {
    name: 'random',
    decide(R, d) {
      const r = () => Math.random();
      if (d.kind === 'event') { const ok = d.choices.filter((c) => !c.disabled && c.tag !== 'quit'); return { type: 'event', choice: (ok[Math.floor(r() * ok.length)] || d.choices[0]).id }; }
      if (d.kind === 'aid') { if (r() < 0.25) return { type: 'leave' }; const a = d.actions.filter((x) => !(x.max && x.count >= x.max)); return a.length ? { type: 'aid', id: a[Math.floor(r() * a.length)].id } : { type: 'leave' }; }
      const acts = [];
      if (r() < 0.3) acts.push({ type: 'fuel', plan: ['none', 'light', 'steady', 'heavy'][Math.floor(r() * 4)] });
      if (r() < 0.2 && d.quick.length) acts.push({ type: 'quick', id: d.quick[Math.floor(r() * d.quick.length)].id });
      acts.push({ type: 'go', effort: S.EFFORTS[Math.floor(r() * 4)] });
      return acts;
    }
  }
};

// ------------------------------------------------------------------ play
function play(seed, strat, opts) {
  opts = opts || {};
  const R = S.newRace({ seed, weather: opts.weather, drops: strat.drops });
  let maxTempt = 0, temptAt = null, guard = 0;
  while (R.s.phase !== 'done' && guard++ < 6000) {
    const d = S.decision(R, { light: true });
    if (d.kind === 'aid' && d.canDNF && d.temptation > maxTempt) { maxTempt = d.temptation; temptAt = d.node.name; }
    let a = strat.decide(R, d);
    if (!a) break;
    if (!Array.isArray(a)) a = [a];
    for (const x of a) { const r = S.act(R, x); if (r.error && x.type !== 'quick') throw new Error(`${r.error} ${JSON.stringify(x)} phase=${R.s.phase} event=${R.s.event && R.s.event.id}`); if (R.s.phase === 'done') break; }
  }
  if (guard >= 6000) throw new Error('race did not terminate, seed ' + seed);
  const s = R.s;
  // measure the arc on the trail only: the finish-line lift would trivially 'recover' any low
  const h = s.hist.filter((p, i) => !(s.outcome.kind === 'finish' && i === s.hist.length - 1));
  let minM = 100, minAt = 0;
  h.forEach((p, i) => { if (p.morale < minM) { minM = p.morale; minAt = i; } });
  let recov = 0; for (let i = minAt; i < h.length; i++) recov = Math.max(recov, h[i].morale - minM);
  // count distinct lows (morale dips below 35 after being above 50) and highs
  let lows = 0, highs = 0, state = 'mid';
  for (const p of h) {
    if (p.morale < 35 && state !== 'low') { lows++; state = 'low'; }
    else if (p.morale > 60 && state !== 'high') { highs++; state = 'high'; }
  }
  const evs = (s.flags.evlog || []).map((e) => e.id);
  return {
    seed, weather: s.weather, outcome: s.outcome.kind, t: s.t, km: s.km, place: s.outcome.place, finishers: s.outcome.finishers,
    minMorale: minM, minKm: h[minAt] ? h[minAt].km : 0, recovery: recov, lows, highs, maxTempt, temptAt,
    minResolve: Math.min(...h.map((p) => p.resolve)), endLegs: s.b.legs, kcal: s.kcalIn,
    bonk: evs.includes('bonk'), vomit: evs.includes('vomit'), falls: (s.flags.fallLog || []).length, broke: s.flags.broke || 0,
    darkPatch: s.flags.darkPatches || 0, why: s.outcome.why, R
  };
}

function pct(arr, q) { if (!arr.length) return NaN; const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; }
const fmtH = (m) => isNaN(m) ? '  -  ' : S.durStr(m).padStart(6);

function summary(n, only) {
  const rows = [];
  const names = only ? only.split(',') : Object.keys(STRATS);
  for (const k of names) {
    const res = [];
    for (let i = 0; i < n; i++) res.push(play(1000 + i, STRATS[k]));
    const fin = res.filter((r) => r.outcome === 'finish');
    const times = fin.map((r) => r.t);
    const kinds = {};
    res.forEach((r) => { if (r.outcome !== 'finish') kinds[r.outcome] = (kinds[r.outcome] || 0) + 1; });
    const arc = res.filter((r) => r.minMorale < 35 && r.recovery >= 25).length;
    rows.push({
      strategy: STRATS[k].name, finish: (fin.length / n * 100).toFixed(0) + '%', median: fmtH(pct(times, 0.5)), p10: fmtH(pct(times, 0.1)), p90: fmtH(pct(times, 0.9)),
      place: fin.length ? Math.round(pct(fin.map((r) => r.place / r.finishers * 100), 0.5)) + '%' : '-',
      dnf: Object.entries(kinds).map(([a, b]) => a + ':' + b).join(' '),
      'low+recov': (arc / n * 100).toFixed(0) + '%', minMor: pct(res.map((r) => r.minMorale), 0.5).toFixed(0),
      tempt50: (res.filter((r) => r.maxTempt >= 0.5).length / n * 100).toFixed(0) + '%',
      bonk: (res.filter((r) => r.bonk).length / n * 100).toFixed(0) + '%', vomit: (res.filter((r) => r.vomit).length / n * 100).toFixed(0) + '%',
      falls: (res.reduce((a, r) => a + r.falls, 0) / n).toFixed(2), legs: pct(res.map((r) => r.endLegs), 0.5).toFixed(0)
    });
  }
  console.table(rows);
}

function fieldReport(seed) {
  const R = S.newRace({ seed });
  const rs = R.field.runners;
  const fin = rs.filter((r) => r.finishT != null).map((r) => r.finishT);
  const dnf = rs.filter((r) => r.dnfKm != null);
  const where = {};
  dnf.forEach((r) => { where[r.dnfKm] = (where[r.dnfKm] || 0) + 1; });
  console.log(`Field (${R.s.weather}): ${fin.length}/${rs.length} finish (${(fin.length / rs.length * 100).toFixed(0)}%). Winner ${fmtH(pct(fin, 0))}, p25 ${fmtH(pct(fin, 0.25))}, median ${fmtH(pct(fin, 0.5))}, p75 ${fmtH(pct(fin, 0.75))}, last ${fmtH(pct(fin, 1))}`);
  console.log('  DNF by km:', JSON.stringify(where));
}

function trace(name, seed, csv) {
  const r = play(seed, STRATS[name]);
  const s = r.R.s;
  console.log(`${STRATS[name].name} seed ${seed} weather ${s.weather}: ${s.outcome.kind} ${S.durStr(s.t)} km ${s.km.toFixed(1)} ${s.outcome.place ? 'place ' + s.outcome.place + '/' + s.outcome.finishers : s.outcome.why}`);
  // ascii curves
  const cols = ['energy', 'hyd', 'stomach', 'legs', 'feet', 'heat', 'alert', 'morale', 'resolve'];
  console.log('  km  clock  ' + cols.map((c) => c.slice(0, 6).padStart(7)).join('') + '  rank  why');
  s.hist.forEach((p, i) => {
    if (i % 4 && i !== s.hist.length - 1) return;
    console.log(String(p.km.toFixed(0)).padStart(4) + '  ' + S.clockStr(p.t) + '  ' + cols.map((c) => String(Math.round(p[c])).padStart(7)).join('') + String(p.rank || '').padStart(6) + '  ' + (p.why || []).join(', '));
  });
  console.log('\nMorale  ' + spark(s.hist.map((p) => p.morale)));
  console.log('Resolve ' + spark(s.hist.map((p) => p.resolve)));
  console.log('Energy  ' + spark(s.hist.map((p) => p.energy)));
  console.log('Legs    ' + spark(s.hist.map((p) => p.legs)));
  console.log('\nLog:');
  s.log.forEach((e) => console.log(`  ${e.clock} km${String(e.km).padStart(5)} [${e.tone[0]}] ${e.text}`));
  const rep = S.report(r.R);
  console.log('\nMorale drains:', rep.moraleDrains.map((x) => `${x.cause} ${x.amt}`).join(', '));
  console.log('Morale gains:', rep.moraleGains.map((x) => `${x.cause} ${x.amt}`).join(', '));
  console.log('Legs by descent:', rep.legsDesc.map((x) => `${x.where} ${x.dmg}`).join(', '));
  console.log('Stomach:', rep.stomach.map((x) => `${x.cause} ${x.amt}`).join(', '));
  if (csv) {
    const fs = require('fs');
    fs.writeFileSync(csv, 'km,t,' + cols.join(',') + ',rank\n' + s.hist.map((p) => [p.km, p.t, ...cols.map((c) => p[c]), p.rank].join(',')).join('\n'));
    console.log('wrote', csv);
  }
}
function spark(vals) {
  const ch = ' ▁▂▃▄▅▆▇█';
  const step = Math.max(1, Math.floor(vals.length / 100));
  let out = '';
  for (let i = 0; i < vals.length; i += step) out += ch[Math.max(0, Math.min(8, Math.round(vals[i] / 100 * 8)))];
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const get = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  if (args.includes('--trace')) trace(get('--trace'), +get('--seed', 7), get('--csv'));
  else {
    const n = +get('--n', 60);
    for (const sd of [1, 2, 3]) fieldReport(sd);
    console.time('summary');
    summary(n, get('--only'));
    console.timeEnd('summary');
  }
}

module.exports = { play, STRATS };
