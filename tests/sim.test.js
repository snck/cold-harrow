'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../js/sim.js');
const C = require('../js/course.js');
const { play, STRATS } = require('../tools/headless.js');

const I = S._internal;

// helper: a fresh race already past the start-line event
function race(opts) {
  const R = S.newRace(Object.assign({ seed: 42, weather: 'clear' }, opts));
  S.act(R, { type: 'event', choice: 'slow' });
  return R;
}
// run the body model for a while at an effort on a given section without events
function simulate(R, effort, minutes, secId, extra) {
  const s = R.s;
  const sec = C.SECTIONS.find((x) => x.id === secId);
  const env = Object.assign({ air: 12, sunLoad: 0, wind: 0, rain: false, fog: false, dark: false, night: false, light: 1, clock: 720, sec, elev: 1000 }, extra || {});
  const dtH = 0.05;
  for (let t = 0; t < minutes / 60; t += dtH) {
    I.updateBody(R, dtH, { effort, env, sec, moving: true, d: 0.3, up: 0, down: 0 });
    s.t += dtH * 60;
  }
}

test('course is consistent: sections tile 0–100 km, nodes sit on section boundaries', () => {
  let km = 0;
  for (const sec of C.SECTIONS) { assert.strictEqual(sec.from, km); assert.ok(sec.to > sec.from); km = sec.to; }
  assert.strictEqual(km, 100);
  const bounds = new Set(C.SECTIONS.map((s) => s.to).concat([0]));
  for (const n of C.NODES) assert.ok(bounds.has(n.km), `node ${n.name} at km ${n.km} is not a section boundary`);
  assert.ok(S.TOTAL_GAIN > 4000 && S.TOTAL_GAIN < 5500);
});

test('same seed and same choices give the same race', () => {
  const a = play(7, STRATS.sensible), b = play(7, STRATS.sensible);
  assert.strictEqual(a.t, b.t);
  assert.strictEqual(a.outcome, b.outcome);
  assert.deepStrictEqual(a.R.s.hist.map((p) => p.morale), b.R.s.hist.map((p) => p.morale));
});

test('power-hiking a steep climb is more efficient than running it', () => {
  const R = race();
  const sec = C.SECTIONS.find((x) => x.id === 'rakes');
  const env = S.envAt(R.s, 31, 300);
  const g = 0.17;
  const vEasy = I.rawSpeed(R.s, sec, 'easy', g, env), vPush = I.rawSpeed(R.s, sec, 'push', g, env);
  assert.ok(vPush > vEasy, 'running is still a bit faster');
  assert.ok(vPush / vEasy < 1.3, `but not by much on 17% (got ${(vPush / vEasy).toFixed(2)})`);
  // energy per km: push costs far more
  const costEasy = 260 / vEasy, costPush = 610 / vPush;
  assert.ok(costPush > costEasy * 1.6);
});

test('bombing a descent costs far more leg damage, and part of it arrives later', () => {
  const dmg = {};
  for (const eff of ['easy', 'push']) {
    const R = race();
    const s = R.s;
    const sec = C.SECTIONS.find((x) => x.id === 'scree');
    const env = S.envAt(s, 43, 600);
    I.updateBody(R, 0.1, { effort: eff, env, sec, moving: true, d: 1, up: 0, down: 140 });
    dmg[eff] = { now: 100 - s.b.legs, pending: s.b.legsPending };
    // two hours later the pending damage has landed
    for (let i = 0; i < 36; i++) I.updateBody(R, 0.1, { effort: 'walk', env, sec, moving: false, d: 0, up: 0, down: 0 });
    dmg[eff].later = 100 - s.b.legs;
  }
  assert.ok(dmg.push.now + dmg.push.pending > 2.5 * (dmg.easy.now + dmg.easy.pending));
  assert.ok(dmg.push.pending > 0, 'some damage is delayed');
  assert.ok(dmg.push.later > dmg.push.now + dmg.push.pending * 0.8, 'delayed damage arrives');
});

test('eating a lot at once hurts the stomach; little and often does not', () => {
  const A = race(), B = race();
  A.s.fuel = 'none'; B.s.fuel = 'none';
  A.s.b.gut = 700; // a huge feed
  for (let i = 0; i < 6; i++) { B.s.b.gut += 100; simulate(B, 'steady', 20, 'millrace'); }
  simulate(A, 'steady', 120, 'millrace');
  assert.ok(A.s.b.stomach < B.s.b.stomach - 10, `big feed ${A.s.b.stomach.toFixed(0)} vs little and often ${B.s.b.stomach.toFixed(0)}`);
});

test('not eating leads to a bonk hours later, not immediately', () => {
  const R = race();
  R.s.fuel = 'none';
  simulate(R, 'steady', 60, 'millrace');
  assert.ok(R.s.b.energy > 70, 'fine after an hour');
  simulate(R, 'steady', 240, 'millrace');
  assert.ok(R.s.b.energy < 25, `empty after five hours (${R.s.b.energy.toFixed(0)})`);
  const F = race();
  F.s.fuel = 'steady'; F.s.kit.food = 5000;
  simulate(F, 'easy', 300, 'millrace');
  assert.ok(F.s.b.energy > 70, 'eating steadily at easy effort holds energy');
});

test('bonked runners recover if they eat and slow down', () => {
  const R = race();
  R.s.b.energy = 8; R.s.fuel = 'steady'; R.s.kit.food = 2000;
  simulate(R, 'walk', 90, 'millrace');
  assert.ok(R.s.b.energy > 16, `recovering (${R.s.b.energy.toFixed(0)})`);
});

test('rationing water in the heat dehydrates you faster', () => {
  const hot = { air: 28, sunLoad: 1 };
  const A = race(), B = race();
  A.s.kit.water = B.s.kit.water = 1.5;
  B.s.ration = true;
  simulate(A, 'easy', 60, 'oven', hot);
  simulate(B, 'easy', 60, 'oven', hot);
  assert.ok(B.s.b.hyd < A.s.b.hyd - 5);
  assert.ok(B.s.kit.water > A.s.kit.water);
});

test('a jacket matters on a cold, wet, windy night', () => {
  const night = { air: -1, wind: 1.4, rain: true, dark: true, night: true, clock: 240 };
  const A = race(), B = race();
  B.s.kit.layers = 1;
  simulate(A, 'easy', 60, 'ridge', night);
  simulate(B, 'easy', 60, 'ridge', night);
  assert.ok(A.s.b.heat < -40, `no jacket is cold (${A.s.b.heat.toFixed(0)})`);
  assert.ok(B.s.b.heat > A.s.b.heat + 25);
});

test('morale recovers when the body is OK (it never always gets worse)', () => {
  const R = race();
  R.s.m.morale = 15;
  simulate(R, 'easy', 180, 'millrace');
  assert.ok(R.s.m.morale > 35, `recovered to ${R.s.m.morale.toFixed(0)}`);
});

test('resolve drains in a dark place and the breaking point triggers', () => {
  const R = race();
  R.s.m.morale = 5; R.s.m.resolve = 6;
  R.s.b.energy = 5; R.s.fuel = 'none';
  simulate(R, 'easy', 60, 'millrace');
  assert.ok(R.s.m.resolve <= 0.01);
});

test('every decision offers at least one enabled choice (random play fuzz)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const R = S.newRace({ seed });
    let guard = 0;
    let rs = seed * 9973;
    const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
    while (R.s.phase !== 'done' && guard++ < 3000) {
      const d = S.decision(R, { light: true });
      if (d.kind === 'event') {
        const ok = d.choices.filter((c) => !c.disabled);
        assert.ok(ok.length > 0, `event ${d.id} has no enabled choice`);
        for (const c of d.choices) assert.ok(c.id && c.label, `event ${d.id} has a malformed choice`);
        S.act(R, { type: 'event', choice: ok[Math.floor(rnd() * ok.length)].id });
      } else if (d.kind === 'aid') {
        const r = rnd();
        if (r < 0.03 && d.canDNF) S.act(R, { type: 'dnf' });
        else if (r < 0.35) S.act(R, { type: 'leave' });
        else { const a = d.actions.filter((x) => !(x.max && x.count >= x.max)); if (a.length) S.act(R, { type: 'aid', id: a[Math.floor(rnd() * a.length)].id }); else S.act(R, { type: 'leave' }); }
      } else if (d.kind === 'section') {
        if (rnd() < 0.2) S.act(R, { type: 'fuel', plan: ['none', 'light', 'steady', 'heavy'][Math.floor(rnd() * 4)] });
        if (rnd() < 0.2 && d.quick.length) S.act(R, { type: 'quick', id: d.quick[Math.floor(rnd() * d.quick.length)].id });
        S.act(R, { type: 'go', effort: S.EFFORTS[Math.floor(rnd() * 4)] });
      }
    }
    assert.strictEqual(R.s.phase, 'done', `seed ${seed} never ended`);
    assert.ok(['finish', 'dnf', 'timeout', 'evac'].includes(R.s.outcome.kind));
    const rep = S.report(R);
    assert.ok(rep.outcome && Array.isArray(rep.named));
  }
});

test('cutoffs are enforced, including at the finish', () => {
  const R = race();
  R.s.t = 2000; // far too late
  R.s.km = 13.9; R.s.sec = S.sectionIndexAt(13.9);
  S.act(R, { type: 'go', effort: 'walk' });
  let guard = 0;
  while (R.s.phase === 'event' && guard++ < 10) { const d = S.decision(R); S.act(R, { type: 'event', choice: d.choices.find((c) => !c.disabled).id }); if (R.s.phase === 'section') S.act(R, { type: 'go', effort: 'walk' }); }
  assert.strictEqual(R.s.outcome && R.s.outcome.kind, 'timeout');
});

test('you can only hand in your bib at an aid station', () => {
  const R = race();
  const r = S.act(R, { type: 'dnf' });
  assert.ok(r.error);
  assert.notStrictEqual(R.s.phase, 'done');
});

test('estimates are sane: push is faster than walk, and each option has a cost', () => {
  const R = race();
  const d = S.decision(R);
  assert.strictEqual(d.kind, 'section');
  const by = Object.fromEntries(d.options.map((o) => [o.effort, o.est]));
  assert.ok(by.push.minutes < by.steady.minutes && by.steady.minutes < by.easy.minutes && by.easy.minutes < by.walk.minutes);
  assert.ok(by.push.d.energy < by.walk.d.energy);
});

test('the field is plausible: most finish, some drop, times spread across the day', () => {
  for (const seed of [1, 2, 3]) {
    const R = S.newRace({ seed });
    const fin = R.field.runners.filter((r) => r.finishT != null).map((r) => r.finishT).sort((a, b) => a - b);
    const rate = fin.length / R.field.runners.length;
    assert.ok(rate > 0.6 && rate < 0.9, `finish rate ${rate}`);
    const median = fin[fin.length >> 1] / 60;
    assert.ok(median > 18 && median < 24, `median ${median}h`);
    assert.ok(fin[0] / 60 > 12, 'nobody finishes impossibly fast');
  }
});

test('strategy ordering: wise pacing and fuelling beat reckless play', () => {
  const N = 12;
  const stats = (k) => {
    const rs = []; for (let i = 0; i < N; i++) rs.push(play(500 + i, STRATS[k]));
    const fin = rs.filter((r) => r.outcome === 'finish');
    const med = fin.length ? fin.map((r) => r.t).sort((a, b) => a - b)[fin.length >> 1] : Infinity;
    return { rate: fin.length / N, med };
  };
  const sens = stats('sensible'), hard = stats('hard'), noeat = stats('noeat'), walk = stats('walk'), bomb = stats('bomb');
  assert.ok(sens.rate >= 0.9);
  assert.ok(hard.med > sens.med + 90, 'going out hard costs well over an hour');
  assert.ok(noeat.rate < 0.3, 'never eating fails');
  assert.ok(walk.rate < 0.3, 'walking everything misses cutoffs');
  assert.ok(bomb.rate < sens.rate, 'bombing every descent is punished');
});

test('a typical run has a real low and a recovery', () => {
  let arc = 0;
  for (let i = 0; i < 20; i++) { const r = play(800 + i, STRATS.typical); if (r.minMorale < 35 && r.recovery >= 25) arc++; }
  assert.ok(arc >= 10, `${arc}/20 runs had a low and a recovery`);
});
