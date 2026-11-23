/* Coldharrow — browser front end: screens, playback, decisions, report. */
(function () {
  'use strict';
  const S = window.TrailSim, C = window.TrailCourse, RND = window.TrailRender, PROF = window.TrailProfile, AU = window.TrailAudio;
  const $ = (q, el) => (el || document).querySelector(q);
  const $$ = (q, el) => Array.from((el || document).querySelectorAll(q));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  // Touch devices (or ?touch=1 for testing) get tap equivalents for everything that is hover on desktop.
  const TOUCH = (window.matchMedia && matchMedia('(hover: none), (pointer: coarse)').matches) || /[?&]touch=1/.test(location.search);
  document.documentElement.classList.toggle('touch', TOUCH);

  // ------------------------------------------------------------ storage (never required)
  const store = {
    get(k, d) { try { const v = localStorage.getItem('coldharrow.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('coldharrow.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('coldharrow.' + k); } catch (e) { /* ignore */ } }
  };

  // ------------------------------------------------------------ app state
  const app = {
    screen: 'title', R: null, setup: null,
    play: null, // playback
    view: null, // what is shown
    shownLog: 0,
    speed: store.get('speed', 1),
    sel: null, // selected effort
    d: null, // current decision
    lastTick: 0, anim: 0,
    flash: null, trendRef: null, trendT: -999,
    momentOpen: false
  };

  function show(name) {
    $$('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + name));
    app.screen = name;
    if (name === 'title') { RND.init($('#title-canvas')); refreshTitle(); }
    if (name === 'race') { RND.init($('#land')); PROF.init($('#profile'), profileHover); setTimeout(() => { RND.resize(); PROF.resize(); }, 0); }
  }

  // ------------------------------------------------------------ title
  function refreshTitle() {
    const save = store.get('save', null);
    $('#btn-continue').classList.toggle('hidden', !save || !save.s || save.s.phase === 'done');
    const best = store.get('best', null);
    const runs = store.get('runs', []);
    let txt = '';
    if (best) txt = `Your best: ${S.durStr(best.t)} · ${S.ordinal(best.place)} of ${best.finishers}`;
    else if (runs.length) txt = `${runs.length} attempt${runs.length > 1 ? 's' : ''}. No finish yet.`;
    $('#title-best').textContent = txt;
  }
  const titleState = { weather: 'clear', kit: { battery: 100 }, m: { morale: 70 } };

  // ------------------------------------------------------------ briefing
  function openBriefing(seed) {
    const sd = seed != null ? seed : Math.floor(Math.random() * 2 ** 31);
    const prev = S.newRace({ seed: sd });
    const w = S.weatherOf(prev.s);
    const last = store.get('setup', null);
    app.setup = { seed: sd, weather: w.id, drops: last ? last.drops : { hollin: ['warm', 'caffeine', 'poles'], mill: ['sunhat', 'flask', 'socks'] }, reasons: last ? last.reasons : ['dad', 'cant', 'sunrise'] };
    $('#brief-weather').textContent = w.name;
    $('#brief-forecast').textContent = w.forecast;
    drawBriefProfile();
    renderDrops(); renderReasons();
    $('#cutoffs').innerHTML = C.NODES.filter((n) => n.cutoff).map((n) => `<tr><td>${esc(n.type === 'finish' ? 'Finish, Lowmere' : n.name)}${n.dropBag ? ' <span class="dim">(drop bag)</span>' : ''}</td><td>km ${n.km}</td><td>${S.clockStr(n.cutoff)}${n.cutoff >= 1440 ? ' Sun' : ''}</td></tr>`).join('');
    show('brief');
  }
  function drawBriefProfile() {
    const cv = $('#brief-profile');
    requestAnimationFrame(() => {
      const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = r.width * dpr; cv.height = r.height * dpr;
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = r.width, H = r.height, x0 = 6, x1 = W - 6, top = 22, bot = H - 18;
      const xk = (k) => x0 + (x1 - x0) * k / 100, yE = (e) => bot - (e - 300) / 1900 * (bot - top);
      const g = c.createLinearGradient(0, top, 0, bot); g.addColorStop(0, '#8aa4b8'); g.addColorStop(1, '#26323d');
      c.fillStyle = g; c.beginPath(); c.moveTo(xk(0), bot);
      for (let k = 0; k <= 100; k += 0.25) c.lineTo(xk(k), yE(S.elevAt(k)));
      c.lineTo(xk(100), bot); c.fill();
      c.font = '10.5px system-ui'; c.textAlign = 'center';
      for (const n of C.NODES) {
        if (n.type !== 'aid' && n.type !== 'finish' && n.type !== 'start') continue;
        const x = xk(n.km); c.strokeStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.moveTo(x, yE(S.elevAt(n.km))); c.lineTo(x, bot); c.stroke();
        c.fillStyle = '#e9e4da'; c.textAlign = n.type === 'start' ? 'left' : n.type === 'finish' ? 'right' : 'center'; c.fillText(n.type === 'start' ? 'Start' : n.type === 'finish' ? 'Finish' : n.name, x, H - 5); c.textAlign = 'center';
      }
      const label = (km, t, col) => { c.fillStyle = col; c.fillText(t, xk(km), yE(S.elevAt(km)) - 7); };
      label(10, 'Witchknee', '#ffe3b5'); label(38, 'the Crown 2,140 m', '#ffd38a'); label(44, 'Scree Staircase', '#ffb3a0');
      label(67, 'the Oven', '#ffb07a'); label(90, 'the Last Lie', '#ffc9b5');
      c.fillStyle = 'rgba(255,255,255,.55)'; c.textAlign = 'left'; c.fillText(`${S.TOTAL_GAIN.toLocaleString()} m of climbing`, 8, 12);
    });
  }
  function renderDrops() {
    for (const bag of ['hollin', 'mill']) {
      const el = $('#drop-' + bag);
      el.innerHTML = Object.entries(C.DROP_ITEMS).map(([id, it]) => `<button class="drop-item ${app.setup.drops[bag].includes(id) ? 'sel' : ''}" data-bag="${bag}" data-id="${id}">${esc(it.name)}<span class="d">${esc(it.desc)}</span></button>`).join('');
    }
    $$('.drop-item').forEach((b) => b.onclick = () => {
      const list = app.setup.drops[b.dataset.bag];
      const i = list.indexOf(b.dataset.id);
      if (i >= 0) list.splice(i, 1); else { if (list.length >= 3) list.shift(); list.push(b.dataset.id); }
      renderDrops();
    });
  }
  function renderReasons() {
    $('#reasons').innerHTML = C.REASONS.map((r) => `<button class="reason ${app.setup.reasons.includes(r.id) ? 'sel' : ''}" data-id="${r.id}">${esc(r.text)}</button>`).join('');
    $$('.reason').forEach((b) => b.onclick = () => {
      const list = app.setup.reasons; const i = list.indexOf(b.dataset.id);
      if (i >= 0) { if (list.length > 1) list.splice(i, 1); } else { if (list.length >= 3) list.shift(); list.push(b.dataset.id); }
      renderReasons();
    });
  }

  // ------------------------------------------------------------ start / continue
  function startRace() {
    const st = app.setup;
    store.set('setup', { drops: st.drops, reasons: st.reasons });
    app.R = S.newRace({ seed: st.seed, drops: st.drops, reasons: st.reasons });
    app.shownLog = 0; app.play = null; app.sel = null; app.trendRef = null;
    $('#log').innerHTML = '';
    show('race');
    AU.init();
    app.view = snapshot();
    save();
    nextDecision();
  }
  function continueRace() {
    const sv = store.get('save', null);
    if (!sv) return;
    const s = sv.s;
    app.R = { s, field: S._internal.buildField(s.seed, s.weather) };
    app.setup = sv.setup;
    app.shownLog = 0; app.play = null; app.sel = null;
    $('#log').innerHTML = '';
    show('race');
    AU.init();
    app.view = snapshot();
    nextDecision();
  }
  function save() { if (app.R) store.set('save', { s: app.R.s, setup: app.setup }); }

  function snapshot() {
    const s = app.R.s;
    return { t: s.t, km: s.km, b: Object.assign({}, s.b), m: Object.assign({}, s.m), rank: s.rank, water: s.kit.water, food: s.kit.food };
  }

  // ------------------------------------------------------------ actions
  function act(a) {
    if (app.play || !app.R) return;
    const before = snapshot();
    const res = S.act(app.R, a);
    if (res.error) console.warn(res.error, a);
    save();
    if (res.frames && res.frames.length) {
      const frames = [before].concat(res.frames);
      app.play = { frames, i: 0, t: before.t, tEnd: frames[frames.length - 1].t };
      renderMoving();
    } else {
      app.view = snapshot();
      flushLog();
      nextDecision();
    }
  }

  function nextDecision() {
    const s = app.R.s;
    flushLog();
    if (s.phase === 'done') { finishScreen(); return; }
    const d = S.decision(app.R);
    app.d = d;
    if (d.kind === 'section') { if (!app.sel || d.fresh) app.sel = d.companion ? d.companion.effort : s.effort; renderSection(d); maybeTip('effort'); }
    else if (d.kind === 'event') renderEvent(d);
    else if (d.kind === 'aid') { renderAid(d); AU.cue('aid'); maybeTip('aid'); }
  }

  // ------------------------------------------------------------ playback loop
  const MIN_PER_SEC = { 1: 12, 2: 26, 4: 60 };
  function tick(ts) {
    const dt = Math.min(0.1, (ts - (app.lastTick || ts)) / 1000);
    app.lastTick = ts; app.anim += dt;
    if (app.screen === 'title') {
      RND.draw({ km: 37 + app.anim * 0.02, t: 372 + Math.sin(app.anim * 0.05) * 8, s: titleState, moving: true, anim: app.anim, nearby: [{ km: 37.15 + app.anim * 0.02, id: 2 }, { km: 36.8 + app.anim * 0.02, id: 5 }], morale: 70 });
    } else if (app.screen === 'race' && app.R) {
      let moving = false;
      if (app.play) {
        moving = true;
        const p = app.play;
        p.t += dt * MIN_PER_SEC[app.speed];
        while (p.i < p.frames.length - 2 && p.frames[p.i + 1].t <= p.t) p.i++;
        if (p.t >= p.tEnd) { app.view = p.frames[p.frames.length - 1]; app.play = null; flushLog(); nextDecision(); }
        else {
          const a = p.frames[p.i], b = p.frames[p.i + 1];
          const f = b.t > a.t ? clamp((p.t - a.t) / (b.t - a.t), 0, 1) : 1;
          app.view = interp(a, b, f);
          flushLog(app.view.t);
        }
      }
      const v = app.view || snapshot();
      const s = app.R.s;
      const nearby = S.nearbyRunners({ s: Object.assign({}, s, { t: v.t, km: v.km }), field: app.R.field }, 1.8);
      if (app.flash) { app.flash.a *= Math.pow(0.5, dt / app.flash.half); if (app.flash.a < 0.01) app.flash = null; }
      RND.draw({ km: v.km, t: v.t, s, moving, anim: app.anim, nearby, companion: s.companion && s.companion.name, morale: v.m.morale, flash: app.flash, effort: S.effectiveEffort(s) });
      PROF.draw({ km: v.km }, { runners: nearby });
      updateHud(v);
      updateBars(v);
      const env = S.envAt(s, clamp(v.km, 0, 99.99), v.t);
      AU.ambient(env, moving, 8, dt);
    }
    requestAnimationFrame(tick);
  }
  function interp(a, b, f) {
    const L = (x, y) => x + (y - x) * f;
    const o = { t: L(a.t, b.t), km: L(a.km, b.km), b: {}, m: {}, rank: f < 0.5 ? a.rank : b.rank, water: L(a.water, b.water), food: L(a.food, b.food) };
    for (const k in b.b) o.b[k] = L(a.b[k], b.b[k]);
    for (const k in b.m) o.m[k] = L(a.m[k], b.m[k]);
    return o;
  }

  // ------------------------------------------------------------ HUD & bars
  function updateHud(v) {
    const s = app.R.s;
    $('#hud-clock').textContent = S.clockStr(v.t);
    $('#hud-elapsed').textContent = S.durStr(v.t) + ' elapsed';
    $('#hud-km').textContent = v.km.toFixed(1);
    $('#hud-pos').textContent = v.rank ? v.rank : '-';
    const fs = S.fieldStats({ s: Object.assign({}, s, { t: v.t }), field: app.R.field });
    $('#hud-field').textContent = `position · ${fs.active + fs.finished + 1} still in`;
    const na = S.nextAid(v.km);
    if (s.phase === 'done' && s.outcome) {
      $('#hud-next').textContent = s.outcome.kind === 'finish' ? 'Finished' : 'Race over';
      $('#hud-cut').textContent = s.outcome.kind === 'finish' ? S.durStr(s.outcome.t) : s.outcome.why;
    } else if (na) {
      $('#hud-next').textContent = `${na.type === 'finish' ? 'Finish' : na.name} in ${(na.km - v.km).toFixed(1)} km`;
      $('#hud-cut').textContent = na.cutoff ? `cutoff ${S.clockStr(na.cutoff)}` : 'next aid';
    }
    const env = S.envAt(s, clamp(v.km, 0, 99.99), v.t);
    $('#hud-temp').textContent = Math.round(env.air) + '°C';
    $('#hud-wx').textContent = (env.rain ? 'rain' : env.fog ? 'fog' : env.dark ? 'night' : env.sunLoad > 0.5 ? 'full sun' : 'clear') + (env.wind > 0.8 ? ', windy' : '');
  }

  const BARS = {
    body: [
      { k: 'energy', name: 'Energy', warn: 30, crit: 15 },
      { k: 'hyd', name: 'Hydration', warn: 65, crit: 45 },
      { k: 'stomach', name: 'Stomach', warn: 50, crit: 25 },
      { k: 'legs', name: 'Legs', warn: 50, crit: 25 },
      { k: 'feet', name: 'Feet', warn: 60, crit: 35 },
      { k: 'heat', name: 'Core temp', bipolar: true },
      { k: 'alert', name: 'Alertness', warn: 35, crit: 20 }
    ],
    mind: [
      { k: 'morale', name: 'Morale', warn: 35, crit: 20, mind: true },
      { k: 'resolve', name: 'Resolve', warn: 35, crit: 15, mind: true }
    ]
  };
  function buildBars() {
    const mk = (b) => `<div class="bar ${b.bipolar ? 'bipolar' : ''}" data-k="${b.k}"><span class="lbl">${b.name}</span><span class="track"><span class="fill"></span>${b.k === 'legs' ? '<span class="pend"></span>' : ''}${b.k === 'stomach' ? '<span class="gut"></span>' : ''}</span><span class="val"></span></div>`;
    $('#bars-body').innerHTML = BARS.body.map(mk).join('');
    $('#bars-mind').innerHTML = BARS.mind.map(mk).join('');
    $$('.bar').forEach((el) => {
      el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') barTip(el.dataset.k, e); });
      el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') placeTip($('#bar-tip'), e); });
      el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') $('#bar-tip').classList.add('hidden'); });
      el.addEventListener('click', (e) => { if (TOUCH || e.pointerType !== 'mouse') { $('#bar-tip').classList.add('hidden'); openSheet(barTipHtml(el.dataset.k)); } });
    });
  }
  function colourFor(v, mind) {
    if (mind) return v < 20 ? '#8a5bb8' : v < 35 ? '#9a74c4' : '#b48ae0';
    const h = clamp(v, 0, 100) * 1.1; return `hsl(${h},62%,52%)`;
  }
  let lastBarUpd = 0;
  function updateBars(v) {
    const now = performance.now();
    if (now - lastBarUpd < 90) return; lastBarUpd = now;
    // trend reference: value ~30 race-minutes ago
    if (!app.trendRef || v.t - app.trendT > 30 || v.t < app.trendT) { app.trendPrev = app.trendRef; app.trendRef = { b: Object.assign({}, v.b), m: Object.assign({}, v.m) }; app.trendT = v.t; }
    const ref = app.trendPrev;
    for (const grp of [BARS.body, BARS.mind]) for (const bd of grp) {
      const el = $(`.bar[data-k="${bd.k}"]`); if (!el) continue;
      const val = bd.mind ? v.m[bd.k] : v.b[bd.k];
      const fill = $('.fill', el);
      if (bd.bipolar) {
        const x = clamp(val, -100, 100);
        fill.style.left = (x < 0 ? 50 + x / 2 : 50) + '%'; fill.style.width = Math.abs(x) / 2 + '%';
        fill.style.background = x > 0 ? `hsl(${30 - x * 0.3},80%,${55 - x * 0.1}%)` : `hsl(${205 + x * 0.2},70%,${60 + x * 0.1}%)`;
        const word = x > 75 ? 'cooking' : x > 45 ? 'hot' : x > 20 ? 'warm' : x < -75 ? 'hypothermic' : x < -45 ? 'cold' : x < -20 ? 'chilly' : 'ok';
        $('.val', el).textContent = word;
        el.classList.toggle('crit', Math.abs(x) > 75); el.classList.toggle('warn', Math.abs(x) > 45 && Math.abs(x) <= 75);
      } else {
        fill.style.width = clamp(val, 0, 100) + '%'; fill.style.left = '0';
        fill.style.background = colourFor(val, bd.mind);
        let tr = '';
        if (ref) { const pv = bd.mind ? ref.m[bd.k] : ref.b[bd.k]; const dd = val - pv; tr = dd > 3 ? '<span class="trend" style="color:#7fd18b">▲</span>' : dd < -3 ? '<span class="trend" style="color:#ff8f80">▼</span>' : ''; }
        $('.val', el).innerHTML = Math.round(val) + tr;
        el.classList.toggle('crit', val < bd.crit); el.classList.toggle('warn', val >= bd.crit && val < bd.warn);
      }
      if (bd.k === 'legs') { const p = $('.pend', el); const pend = clamp(v.b.legsPending || 0, 0, v.b.legs); p.style.left = clamp(v.b.legs - pend, 0, 100) + '%'; p.style.width = pend + '%'; }
      if (bd.k === 'stomach') { const g = $('.gut', el); g.style.width = clamp((v.b.gut || 0) / 6, 0, 60) + '%'; }
    }
    updateKit(v);
  }
  function updateKit(v) {
    const s = app.R.s, k = s.kit;
    const comp = s.companion ? `<div class="k full" style="color:var(--mind)">Running with <b>${esc(s.companion.name)}</b></div>` : '';
    const reasons = s.reasons.filter((r) => !r.used).length;
    $('#kit').innerHTML = `
      <div class="k">Water <b>${(v.water != null ? v.water : k.water).toFixed(1)}</b>/${k.waterCap.toFixed(1)} L</div>
      <div class="k">Vest food <b>${Math.round(v.food != null ? v.food : k.food)}</b> kcal</div>
      <div class="k">Fuel <b>${s.fuel}</b>${s.ration ? ' · <b style="color:var(--warn)">rationing</b>' : ''}</div>
      <div class="k">Salt caps <b>${k.salt}</b>${s.b.salt < 40 ? ' <b style="color:var(--warn)">salt low</b>' : ''}</div>
      <div class="k">${k.layers === 0 ? 'No jacket' : k.layers === 1 ? '<b>Jacket on</b>' : '<b>Jacket + layer</b>'}</div>
      <div class="k">Headlamp <b>${Math.round(k.battery)}%</b>${k.spareBattery ? ' +spare' : ''}</div>
      ${k.caffeine ? `<div class="k">Caffeine gels <b>${k.caffeine}</b></div>` : ''}${k.rice ? `<div class="k">Rice balls <b>${k.rice}</b></div>` : ''}
      ${k.poles ? '<div class="k"><b>Poles</b></div>' : ''}${k.sunhat ? '<div class="k"><b>Sun hat</b></div>' : ''}${k.music ? '<div class="k"><b>♪ music</b></div>' : ''}
      ${s.inj.ankle ? `<div class="k" style="color:var(--bad)">Ankle: <b>${['', 'tweaked', 'sprained', 'wrecked'][s.inj.ankle]}</b></div>` : ''}
      <div class="k full" style="color:#d4c2ea">Reasons left: <b>${reasons}</b>${s.kit.note && !s.flags.noteRead ? ' · a sealed note' : ''}</div>${comp}`;
  }

  const WHYTEXT = {
    energy: 'Glycogen: the sugar in your muscles and liver. Burned faster the harder you go; topped up by food you <i>absorb</i> (not just eat). Below 25 you slow; below 12 you bonk.',
    hyd: 'Body water. Sweat goes up with effort, heat and sun. Drinking to thirst replaces most of it while your flasks last.',
    stomach: 'Your gut. Hurt by too much food at once (the pale block is food still waiting to be absorbed), heat, dehydration, too many sweet gels, and pushing hard while digesting. Easy effort and an emptier gut let it recover.',
    legs: 'Muscle damage. It does not heal during a race. Descents hurt most, especially fast and technical ones, and part of that damage arrives later (the hatched part is still on its way).',
    feet: 'Wear, hotspots, blisters. Much faster with wet socks. Fresh socks and the medic help.',
    heat: 'Core temperature. Driven by the air, sun, wind, rain, your effort and your layers.',
    alert: 'How awake you are. Falls hard between 02:00 and 05:00. Sunrise, caffeine and a nap bring it back.',
    morale: 'How you feel right now. Every discomfort drags it down. Company, views, the sun, food when you are hungry, and your reasons lift it. When your body is OK, it slowly recovers.',
    resolve: 'Your will to go on. It drains while morale is very low. If it hits zero, you will stop on the trail.'
  };
  function barTip(k, e) {
    const tip = $('#bar-tip');
    tip.innerHTML = barTipHtml(k);
    tip.classList.remove('hidden'); placeTip(tip, e);
  }
  function barTipHtml(k) {
    const s = app.R.s, b = s.b;
    let extra = '';
    const why = (stat) => {
      const w = s.why[stat] || {};
      const neg = Object.entries(w).filter(([, x]) => x < -0.3).sort((a, c) => a[1] - c[1]).slice(0, 4);
      const pos = Object.entries(w).filter(([, x]) => x > 0.3).sort((a, c) => c[1] - a[1]).slice(0, 3);
      let h = '';
      if (neg.length) h += `<br><b>Dragging it down lately:</b> ${neg.map(([n]) => esc(n)).join(', ')}`;
      if (pos.length) h += `<br><b>Helping:</b> ${pos.map(([n]) => esc(n)).join(', ')}`;
      return h;
    };
    if (k === 'energy') extra = `<br><b>In the last 2 h</b> you ate ${S.kcalLastHours(s, 2)} kcal. ${Math.round(b.gut)} kcal still in your stomach. Fuel plan: ${s.fuel}.`;
    else if (k === 'heat') { const env = S.envAt(s, Math.min(99.99, s.km), s.t); extra = `<br>Air ${Math.round(env.air)}°C${env.sunLoad > 0.3 ? ', strong sun' : ''}${env.wind > 0.5 ? ', wind' : ''}${env.rain ? ', rain' : ''}. ${s.kit.layers ? 'Jacket on.' : 'No jacket.'}`; }
    else if (k === 'hyd') extra = `<br>Water carried: ${s.kit.water.toFixed(1)} L${s.ration ? ' (rationing)' : ''}. Salt ${b.salt < 40 ? '<b>low</b>' : 'ok'}.` + why('hyd');
    else if (k === 'legs') extra = (b.legsPending > 1 ? `<br><b>${Math.round(b.legsPending)} points of damage still arriving</b> from recent descents.` : '') + why('legs');
    else if (k === 'alert') extra = b.caffeine > 1 ? '<br>Caffeine kicking in.' : '';
    else if (k === 'morale' || k === 'resolve' || k === 'stomach' || k === 'feet') extra = why(k);
    return `<b>${esc(k === 'hyd' ? 'Hydration' : k === 'heat' ? 'Core temperature' : k === 'alert' ? 'Alertness' : k[0].toUpperCase() + k.slice(1))}</b><br>${WHYTEXT[k]}${extra}`;
  }
  // bottom sheet: the touch replacement for hover tooltips
  function openSheet(html) { $('#sheet .sheet-body').innerHTML = html; $('#sheet').classList.remove('hidden'); }
  function closeSheet() { $('#sheet').classList.add('hidden'); }
  function placeTip(tip, e) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX - w - 16, y = e.clientY + 10;
    if (x < 8) x = e.clientX + 16;
    if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function profileHover(km, e, touch) {
    const tip = $('#profile-tip');
    if (km == null) { tip.classList.add('hidden'); return; }
    const sec = C.SECTIONS[S.sectionIndexAt(Math.min(99.99, km))];
    let up = 0, down = 0;
    for (let k = sec.from; k < sec.to - 1e-6; k += 0.1) { const dz = S.elevAt(k + 0.1) - S.elevAt(k); if (dz > 0) up += dz; else down -= dz; }
    const node = C.NODES.find((n) => Math.abs(n.km - km) < 0.8 && n.type !== 'start');
    tip.innerHTML = `<b>${esc(sec.name)}</b> · km ${sec.from}–${sec.to}<br>+${Math.round(up)} m / −${Math.round(down)} m · ${sec.kind}${sec.tech > 0.5 ? ', technical' : ''}${sec.exposed > 0.7 ? ', exposed' : ''}${sec.forest > 0.6 ? ', forest' : ''}<br><span class="dim">${esc(sec.text)}</span>${node ? `<br><b>${esc(node.name)}</b> (km ${node.km})${node.cutoff ? ' · cutoff ' + S.clockStr(node.cutoff) : ''}${node.dropBag ? ' · drop bag' : ''}${node.type === 'water' ? ' · water only' : ''}` : ''}`;
    tip.classList.remove('hidden');
    if (touch) {
      // pinned just above the strip, full width, so a finger doesn't cover it
      const r = $('#profile-wrap').getBoundingClientRect();
      tip.style.left = '8px'; tip.style.right = '8px'; tip.style.maxWidth = 'none';
      tip.style.top = Math.max(8, r.top - tip.offsetHeight - 6) + 'px';
    } else { tip.style.right = ''; tip.style.maxWidth = ''; placeTip(tip, e); }
  }

  // ------------------------------------------------------------ log
  function flushLog(uptoT) {
    const s = app.R.s;
    const el = $('#log');
    let added = false;
    while (app.shownLog < s.log.length) {
      const e = s.log[app.shownLog];
      if (uptoT != null && e.t > uptoT + 0.01) break;
      const div = document.createElement('div');
      div.className = 'e ' + e.tone + (e.moment ? ' mom' : '');
      div.innerHTML = `<span class="tm">${e.clock} · ${e.km}k</span>${esc(e.text)}`;
      el.appendChild(div);
      app.shownLog++; added = true;
      if (e.moment === 'flow') { app.flash = { a: 0.18, half: 0.8, color: 'rgba(255,230,170,A)' }; AU.cue('good'); }
    }
    if (added) el.scrollTop = el.scrollHeight;
  }

  // ------------------------------------------------------------ panels
  function renderMoving() {
    const s = app.R.s;
    const sec = C.SECTIONS[Math.min(C.SECTIONS.length - 1, S.sectionIndexAt(Math.min(99.99, app.view.km)))];
    const eff = S.effectiveEffort(s);
    $('#panel').innerHTML = `<div class="dec moving"><div class="dec-head"><div><h2>${esc(sec.name)}</h2><div class="sub">${esc(S.LABELS[S.sectionKindLabel(sec)][eff])} · fuel ${s.fuel}${s.ration ? ' · rationing water' : ''}${s.companion ? ' · with ' + esc(s.companion.name) : ''}</div></div></div>
      <p class="sec-text dim">On the move. ${TOUCH ? 'Tap the scene to skip ahead.' : 'The race log on the right fills in as you go.'}</p></div>`;
    $('#playbar').classList.remove('hidden');
    $('#play-label').textContent = 'Running…';
  }

  function costHtml(est, s) {
    const d = est.d;
    const f = (label, x, inv) => {
      const v = Math.round(x);
      if (Math.abs(v) < 1) return '';
      const good = inv ? v < 0 : v > 0;
      return `<span class="${good ? 'pos' : 'neg'}">${label} ${v > 0 ? '+' : '−'}${Math.abs(v)}</span>`;
    };
    const parts = [f('Energy', d.energy), f('Legs', d.legs), f('Hydration', d.hyd), f('Stomach', d.stomach), f('Feet', d.feet)].filter(Boolean);
    if (Math.abs(d.heat) > 8) parts.push(`<span class="${(d.heat > 0 && est.end.heat > 25) || (d.heat < 0 && est.end.heat < -25) ? 'neg' : 'pos'}">${d.heat > 0 ? 'warmer' : 'cooler'}</span>`);
    let w = `drink ${est.water.toFixed(1)} L`;
    if (est.waterLeft < 0.05 && est.water > 0) w = `<span class="neg">flasks run dry</span>`;
    parts.push(w);
    return parts.join(' · ');
  }
  function riskLabel(p) {
    if (p < 0.02) return '';
    const c = p < 0.06 ? 'low' : p < 0.14 ? 'mid' : 'high';
    return `<span class="risk ${c}">fall risk ${c === 'low' ? 'low' : c === 'mid' ? 'moderate' : 'HIGH'} (${Math.round(p * 100)}%)</span>`;
  }

  function renderSection(d) {
    $('#playbar').classList.add('hidden');
    const s = app.R.s, sec = d.sec;
    const env = S.envAt(s, Math.min(99.99, s.km), s.t);
    let up = 0, down = 0;
    for (let k = s.km; k < sec.to - 1e-6; k += 0.1) { const dz = S.elevAt(Math.min(sec.to, k + 0.1)) - S.elevAt(k); if (dz > 0) up += dz; else down -= dz; }
    const proj = d.projection;
    let projHtml = '';
    if (proj) {
      const m = proj.margin;
      const cls = m < 0 ? 'late' : m < 60 ? 'tight' : '';
      projHtml = `Next: <b>${esc(proj.node)}</b> (km ${proj.km})${proj.cutoff ? `, cutoff ${S.clockStr(proj.cutoff)}` : ''}<br>at your current effort you'd get there ≈ ${S.clockStr(proj.arrive)} <span class="${cls}">(${m >= 0 ? S.durStr(m) + ' spare' : S.durStr(-m) + ' too late'})</span>`;
    }
    const intro = d.fresh ? `<p class="sec-text">${esc(sec.text)}</p>` : `<p class="sec-text dim">${(sec.to - s.km).toFixed(1)} km of ${esc(sec.name)} left.</p>`;
    const effHtml = d.options.map((o, i) => {
      const e = o.est;
      const dis = o.disabled ? 'disabled' : '';
      return `<button class="effort ${app.sel === o.effort ? 'sel' : ''}" data-e="${o.effort}" ${dis}>
        <span class="k">${i + 1}</span><b>${esc(o.label)}</b>
        ${o.companion ? `<span class="comp">with ${esc(o.companion)}</span>` : ''}
        <span class="tm">${S.durStr(e.minutes)} · arrive ${S.clockStr(e.arrive)}</span>
        <span class="costs">${costHtml(e, s)}</span>
        ${riskLabel(e.fall)}
        <span class="hint">${esc(o.disabled || o.hint)}</span></button>`;
    }).join('');
    const FUELDESC = { none: 'eat nothing', light: '~140 kcal/h', steady: '~230 kcal/h, about what a gut can absorb', heavy: '~360 kcal/h, more than you can absorb' };
    const fuelBtns = ['none', 'light', 'steady', 'heavy'].map((p) => `<button class="${s.fuel === p ? 'on' : ''}" data-fuel="${p}" title="${FUELDESC[p]}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('');
    const quick = d.quick.map((q) => `<button class="${q.reason ? 'reason' : ''}" data-q="${q.id}" ${q.disabled ? 'disabled' : ''} title="${esc(q.desc || '')}">${esc(q.label)}${q.desc ? `<small class="qdesc">${esc(q.desc)}</small>` : ''}</button>`).join('');
    const selOpt = d.options.find((o) => o.effort === app.sel) || d.options[2];
    const forced = d.forcedWalk ? `<span class="forced">${s.flags.committedDNF ? 'You are walking to the next aid station to drop.' : s.inj.ankle >= 3 ? 'You can only hobble.' : 'You have to walk for a few minutes.'}</span>` : '';
    $('#panel').innerHTML = `<div class="dec section">
      <div class="dec-head"><div><h2>${esc(sec.name)}</h2><div class="sub">km ${s.km.toFixed(1)} → ${sec.to} · ${sec.kind} · +${Math.round(up)} m / −${Math.round(down)} m${sec.tech > 0.5 ? ' · technical' : ''}${sec.exposed > 0.7 ? ' · exposed' : ''} · ${env.dark ? 'dark' : 'daylight'}, ${Math.round(env.air)}°C</div></div><div class="proj">${projHtml}</div></div>
      ${intro}
      <div class="efforts">${effHtml}</div>
      <p class="sel-hint">${esc(selOpt.disabled || selOpt.hint)}</p>
      <div class="plans">
        <div class="seg"><label>Fuel plan</label>${fuelBtns}<span class="note">${FUELDESC[s.fuel]} · ${Math.round(s.kit.food)} kcal in vest</span></div>
        <div class="seg"><label>Water</label><button class="${!s.ration ? 'on' : ''}" data-r="0">Drink to thirst</button><button class="${s.ration ? 'on' : ''}" data-r="1">Ration</button><span class="note">${s.kit.water.toFixed(1)} L</span></div>
      </div>
      <div class="quick"><label>Now</label>${quick}</div>
      <div class="go-row">${forced}<span class="note keys">Enter to go</span><button class="primary go">${d.fresh ? 'Go' : 'Continue'} ▶</button></div>
    </div>`;
    $$('.effort').forEach((b) => b.onclick = () => {
      app.sel = b.dataset.e; $$('.effort').forEach((x) => x.classList.toggle('sel', x === b)); AU.cue('click');
      const o = d.options.find((x) => x.effort === app.sel); $('.sel-hint').textContent = o.disabled || o.hint;
    });
    $$('[data-fuel]').forEach((b) => b.onclick = () => { act({ type: 'fuel', plan: b.dataset.fuel }); });
    $$('[data-r]').forEach((b) => b.onclick = () => { act({ type: 'ration', on: b.dataset.r === '1' }); });
    $$('[data-q]').forEach((b) => b.onclick = () => { act({ type: 'quick', id: b.dataset.q }); });
    $('.go').onclick = go;
  }
  function go() {
    if (!app.d || app.d.kind !== 'section') return;
    const opt = app.d.options.find((o) => o.effort === app.sel);
    if (!opt || opt.disabled) app.sel = 'steady';
    AU.init();
    act({ type: 'go', effort: app.sel });
  }

  const MOMENT_IDS = ['sunrise', 'darkpatch', 'breaking', 'jonah3', 'ines2', 'tomas3', 'jonah0'];
  function renderEvent(d) {
    $('#playbar').classList.add('hidden');
    const big = d.big || MOMENT_IDS.includes(d.id) || d.moment === 'summit' || d.moment === 'home';
    const choicesHtml = d.choices.map((c, i) => `<button class="choice ${c.tag === 'reason' ? 'reason' : ''} ${c.tag === 'quit' ? 'quit' : ''}" data-c="${esc(c.id)}" ${c.disabled ? 'disabled' : ''}><span class="n">${i + 1}</span><span><span class="lbl">${esc(c.label)}</span>${c.desc ? `<span class="d">${esc(c.desc)}</span>` : ''}</span></button>`).join('');
    // cues
    const low = d.id === 'darkpatch' || d.id === 'breaking';
    if (d.id === 'sunrise') { AU.cue('sunrise'); app.flash = { a: 0.55, half: 1.6, color: 'rgba(255,190,120,A)' }; }
    else if (d.moment === 'summit' || d.moment === 'home') { AU.cue('summit'); app.flash = { a: 0.3, half: 1.2, color: 'rgba(255,240,210,A)' }; }
    else if (low) AU.cue('low');
    else if (['fall', 'vomit', 'bonk', 'collapse', 'collapse2', 'hypo', 'heatex', 'cramp', 'ankle3'].includes(d.id)) AU.cue('bad');
    else if (d.warn) AU.cue('click');
    if (big) {
      const m = $('#moment');
      m.classList.remove('hidden'); m.classList.toggle('low', low);
      $('h2', m).textContent = d.title;
      $('p', m).textContent = d.text;
      const ch = $('.choices', m);
      ch.innerHTML = choicesHtml; ch.classList.remove('show');
      requestAnimationFrame(() => m.classList.add('show'));
      app.momentOpen = true;
      setTimeout(() => ch.classList.add('show'), 1100);
      $('#panel').innerHTML = `<div class="dec event"><p class="sec-text dim">${low ? 'A low moment.' : 'A moment.'} Take your time.</p></div>`;
      $$('.choice', m).forEach((b) => b.onclick = () => chooseEvent(b.dataset.c));
    } else {
      $('#panel').innerHTML = `<div class="dec event ${d.warn ? 'warn' : ''}"><h2>${esc(d.title)}</h2><p class="ev-text">${esc(d.text)}</p><div class="choices">${choicesHtml}</div></div>`;
      $$('#panel .choice').forEach((b) => b.onclick = () => chooseEvent(b.dataset.c));
    }
  }
  function chooseEvent(c) {
    const m = $('#moment');
    if (app.momentOpen) {
      m.classList.remove('show');
      $$('.choice', m).forEach((x) => { x.disabled = true; });
      setTimeout(() => { if (!app.momentOpen) { m.classList.add('hidden'); $('.choices', m).textContent = ''; } }, 400);
      app.momentOpen = false;
    }
    AU.cue('click');
    act({ type: 'event', choice: c });
  }

  function renderAid(d) {
    $('#playbar').classList.add('hidden');
    const s = app.R.s, n = d.node;
    const groups = { water: 'Water', food: 'Food', cool: 'Cool', care: 'Care', rest: 'Rest' };
    const byG = {};
    for (const a of d.actions) (byG[a.group] = byG[a.group] || []).push(a);
    const actHtml = Object.entries(groups).filter(([g]) => byG[g]).map(([g, name]) => `<div class="aid-group"><label>${name}</label>${byG[g].map((a) => {
      const maxed = a.max && a.count >= a.max;
      return `<button class="aid-act ${a.done || maxed ? 'done' : ''}" data-a="${esc(a.id)}" ${maxed || (a.done && !a.max) ? 'disabled' : ''} title="${esc(a.desc || '')}">${esc(a.label)}<span class="t">${a.time} min</span>${a.count ? `<span class="c">×${a.count}</span>` : ''}${a.desc ? `<small class="qdesc">${esc(a.desc)}</small>` : ''}</button>`;
    }).join('')}</div>`).join('');
    let cut = '';
    if (n.cutoff) {
      const spare = n.cutoff - s.t;
      cut += `You must leave by <b>${S.clockStr(n.cutoff)}</b> (${spare >= 0 ? S.durStr(spare) + ' from now' : '<span style="color:var(--bad)">already past!</span>'}). `;
    }
    cut += `Time here: <b>${Math.round(d.dwell)} min</b>.`;
    if (d.projection && d.next) {
      const m = d.projection.margin;
      cut += `<br>Next: ${esc(d.next.type === 'finish' ? 'the finish' : d.next.name)}, km ${d.next.km}${d.next.cutoff ? `, cutoff ${S.clockStr(d.next.cutoff)}` : ''}. At your recent effort ≈ ${S.clockStr(d.projection.arrive)} <span class="${m < 0 ? 'late' : m < 60 ? 'tight' : ''}" style="color:${m < 0 ? 'var(--bad)' : m < 60 ? 'var(--warn)' : 'inherit'}">(${m >= 0 ? S.durStr(m) + ' spare' : S.durStr(-m) + ' late'})</span>.`;
    }
    if (d.water) {
      const lw = d.water, short = lw.liters > lw.carry + 0.25;
      cut += `<br>Water: the next ${lw.km.toFixed(0)} km to ${esc(lw.node)} (~${S.durStr(lw.minutes)}) needs about <b>${lw.liters.toFixed(1)} L</b> in these conditions. You can carry <b>${lw.carry.toFixed(1)} L</b>.${short ? ' <span style="color:var(--warn)">You will run dry. Drink extra here, slow down, or ration.</span>' : ''}`;
    }
    const warns = [];
    const B = s.b;
    if (B.hyd < 55) warns.push(`You are ${B.hyd < 35 ? 'dangerously' : 'badly'} dehydrated. Drink here before you go.`);
    if (B.energy < 25) warns.push('You are running on empty. Eat something real here, and give it time.');
    if (B.stomach < 35) warns.push('Your stomach is in revolt: something gentle (broth, ginger, flat cola) and a slow start.');
    if (B.heat > 45) warns.push('You are overheating. Ice, water on your head, layers off.');
    if (B.heat < -40) warns.push('You are cold. Something warm, and another layer.');
    if (B.alert < 25 && n.cots) warns.push('You are falling asleep on your feet. There are camp beds.');
    if (B.feet < 45 && n.medic) warns.push('Your feet are a mess. The medic is right there.');
    if (warns.length) cut += '<br>' + warns.map((w) => `<span style="color:var(--warn)">⚠ ${esc(w)}</span>`).join('<br>');
    const tempt = d.temptation;
    const temptLine = !d.canDNF ? '' : tempt > 0.65 ? (n.shuttle ? 'The minibus to Lowmere is leaving in ten minutes. It has heated seats.' : 'A volunteer crouches beside you. "You can stop here, you know. Nobody will think less of you."') : tempt > 0.4 ? 'There is a row of empty chairs, and blankets, and somewhere warm to sit. You notice them.' : '';
    $('#panel').innerHTML = `<div class="dec aid">
      <div><h2>${esc(n.name)} · km ${n.km}</h2><p class="ad-text">${esc(n.text)}</p>${n.volunteer && !d.dwell ? `<p class="vol">${esc(n.volunteer)}</p>` : ''}${(d.news || []).map((x) => `<p class="news">${esc(x)}</p>`).join('')}<div class="cut">${cut}</div>${temptLine ? `<p class="tempt-line">${esc(temptLine)}</p>` : ''}</div>
      <div class="aid-actions">${actHtml}</div>
      <div class="aid-foot">${d.canDNF ? `<button class="dnf ${tempt > 0.4 ? 'tempt' : ''}">Hand in your bib</button>` : '<span></span>'}<span class="dim small">Every action costs time. The field keeps moving while you're here.</span><button class="primary go">Leave ${esc(n.name)} ▶</button></div>
    </div>`;
    $$('.aid-act').forEach((b) => b.onclick = () => { AU.cue('click'); act({ type: 'aid', id: b.dataset.a }); });
    $('#panel .go').onclick = () => act({ type: 'leave' });
    const dn = $('#panel .dnf'); if (dn) dn.onclick = () => confirmDNF(d);
  }

  function confirmDNF(d) {
    const s = app.R.s, n = d.node;
    const lines = [];
    if (s.flags.committedDNF) lines.push('You told yourself on the mountain that you would stop here.');
    if (s.inj.ankle >= 2) lines.push('Your ankle is badly swollen. The medic purses her lips when she looks at it.');
    if (s.m.morale < 30) lines.push('Everything in you wants to sit down and not get up.');
    if (d.projection && d.projection.margin < 30) lines.push(`At the pace you've been moving, the next cutoff is ${d.projection.margin < 0 ? 'already out of reach' : 'going to be very tight'}.`);
    if (!lines.length) lines.push('You could keep going. You know you could.');
    modal(`<h2>Hand in your bib at ${esc(n.name)}?</h2><p>${lines.map(esc).join(' ')}</p><p class="dim">This ends your race at km ${n.km}. You can't undo it.</p>
      <div class="row"><button id="m-no" class="primary">Not yet. Keep going.</button><button id="m-yes" class="dnf">Hand in your bib</button></div>`);
    $('#m-no').onclick = closeModal;
    $('#m-yes').onclick = () => { closeModal(); act({ type: 'dnf' }); };
  }

  // ------------------------------------------------------------ finish / report
  function finishScreen() {
    const s = app.R.s, o = s.outcome;
    $('#playbar').classList.add('hidden');
    app.view = snapshot();
    store.del('save');
    const rep = S.report(app.R);
    const runs = store.get('runs', []);
    runs.push({ kind: o.kind, t: o.t, km: o.km, place: o.place, finishers: o.finishers, weather: s.weather, date: Date.now() });
    store.set('runs', runs.slice(-30));
    let newBest = false;
    if (o.kind === 'finish') { const best = store.get('best', null); if (!best || o.t < best.t) { store.set('best', { t: o.t, place: o.place, finishers: o.finishers, weather: s.weather }); newBest = !!best || true; } }
    // finish moment first
    const m = $('#moment');
    const title = o.kind === 'finish' ? 'Lowmere' : o.kind === 'dnf' ? 'Your race is over' : o.kind === 'timeout' ? 'Timed out' : 'Evacuated';
    m.classList.remove('hidden'); m.classList.toggle('low', o.kind !== 'finish');
    $('h2', m).textContent = title;
    $('p', m).textContent = finishText(rep, s);
    const ch = $('.choices', m);
    ch.innerHTML = '<button class="choice" id="to-report"><span class="lbl">See your race</span></button>';
    ch.classList.remove('show');
    requestAnimationFrame(() => m.classList.add('show'));
    setTimeout(() => ch.classList.add('show'), 1500);
    if (o.kind === 'finish') { AU.cue('finish'); app.flash = { a: 0.5, half: 2, color: 'rgba(255,220,160,A)' }; } else AU.cue('low');
    $('#panel').innerHTML = '';
    $('#to-report').onclick = () => { m.classList.remove('show'); m.classList.add('hidden'); showReport(rep, newBest); };
  }

  function finishText(rep, s) {
    const o = s.outcome;
    const low = rep.low;
    const lowWhy = low && low.why && low.why.length ? low.why.slice(0, 2).join(' and ') : null;
    const bits = [];
    if (o.kind === 'finish') {
      bits.push('The lane, the bridge, the square. People you have never met are shouting your name off your race number. The cowbells are deafening.');
      if (low && low.morale < 40) bits.push(`At kilometre ${Math.round(low.km)}, ${S.clockStr(low.t)}, you were in a dark place${lowWhy ? `: ${lowWhy}` : ''}. You kept going.`);
      if (s.flags.broke) bits.push('You sat on a rock and couldn\'t think of a reason to stand up. You stood up anyway.');
      if (s.flags.changedMind) bits.push('You had decided to quit. You changed your mind.');
      if (s.flags.vomitKm) bits.push(`You were sick on the mountain at km ${Math.round(s.flags.vomitKm)}.`);
      if ((s.flags.falls || 0) > 0) bits.push(s.flags.falls > 1 ? `You fell ${s.flags.falls} times and got up ${s.flags.falls} times.` : 'You fell, and got up.');
      if (s.flags.sunriseHigh) bits.push('You watched the sun come up from the ridge.');
      if (s.flags.inesFriend) bits.push('Ines walked you up the mountain in the dark.');
      if (s.flags.jonahHelped && s.done.jonah3) bits.push('Jonah paid you back on the Last Lie.');
      else if (s.flags.jonahHelped) bits.push('You stopped for Jonah when it cost you.');
      if (s.flags.tomasTogether) bits.push('Tomas is beside you, crying and pretending not to.');
      bits.push(`You cross the line in ${S.durStr(o.t)}, ${S.ordinal(o.place)} of ${o.finishers} finishers. Someone puts a medal round your neck. You sit down on the kerb and don't get up for a long time.`);
    } else if (o.kind === 'dnf') {
      bits.push(`You stopped at ${o.why.replace('Dropped at ', '')}, ${o.km.toFixed(0)} km in, after ${S.durStr(o.t)}.`);
      if (lowWhy) bits.push(`In the end it was ${lowWhy}.`);
      bits.push('A volunteer cuts the timing chip off your shoe. It doesn\'t feel like you thought it would. Lowmere, and the Crown, and the finish arch, will still be there next year.');
    } else if (o.kind === 'timeout') {
      bits.push(`${o.why}, ${o.km.toFixed(0)} km in. The clock was the one thing you couldn't argue with.`);
      bits.push('A marshal takes your bib gently, like it might break.');
    } else {
      bits.push(`${o.why}, at km ${o.km.toFixed(1)}. The mountain rescue team are kind and very matter-of-fact, and the stretcher is surprisingly comfortable.`);
      bits.push('You will be fine. You will also think about this for a long time.');
    }
    return bits.join(' ');
  }

  function showReport(rep, newBest) {
    const s = app.R.s, o = s.outcome;
    show('report');
    const fin = o.kind === 'finish';
    const verdict = fin ? 'Finisher' : o.kind === 'dnf' ? `DNF · km ${o.km.toFixed(0)}` : o.kind === 'timeout' ? `Timed out · km ${o.km.toFixed(0)}` : `Evacuated · km ${o.km.toFixed(1)}`;
    const best = store.get('best', null);
    $('#rep-head').innerHTML = `<div><div class="verdict ${fin ? 'fin' : 'out'}">${verdict}</div><div class="lede">${esc(lede(rep, s))}</div></div>
      <div class="stats">${fin ? `<b>${S.durStr(o.t)}</b><br>${S.ordinal(o.place)} of ${o.finishers} finishers (${o.starters} started)` : `<b>${o.km.toFixed(1)} km</b> in ${S.durStr(o.t)}<br>${esc(o.why)}`}
      ${fin && newBest ? '<br><span class="newbest">Personal best</span>' : best ? `<br><span class="dim">Best: ${S.durStr(best.t)}</span>` : ''}<br><span class="dim">${esc(S.weatherOf(s).name)}</span></div>`;
    const marks = [];
    for (const e of s.log) {
      if (!e.moment) continue;
      const good = !['fall', 'vomit', 'lost'].includes(e.moment);
      marks.push({ km: e.km, good });
    }
    for (const k of s.flags.lowestKm || []) marks.push({ km: k, good: false });
    requestAnimationFrame(() => {
      const series = RND.chart($('#rep-chart'), s.hist, marks);
      $('#rep-legend').innerHTML = series.slice().reverse().map(([k, c]) => `<span><i style="background:${c}"></i>${{ morale: 'Morale', resolve: 'Resolve', energy: 'Energy', legs: 'Legs', stomach: 'Stomach', hyd: 'Hydration' }[k]}</span>`).join('') + '<span><i style="background:#ffd38a;height:6px;width:6px;border-radius:50%"></i>highs</span><span><i style="background:#ff5b5b;height:6px;width:6px;border-radius:50%"></i>lows</span>';
    });
    // moments
    const seen = {};
    const mom = s.log.filter((e) => {
      if (!e.moment || e.moment === 'wildlife') return false;
      if (e.moment === 'flow') { if (seen.flow) return false; seen.flow = true; }
      return true;
    }).map((e) => ({ km: e.km, clock: e.clock, tone: e.tone, text: e.text }));
    if (rep.low && rep.low.morale < 40) mom.push({ km: rep.low.km, clock: S.clockStr(rep.low.t), tone: 'bad', text: `Your lowest point${rep.low.why && rep.low.why.length ? ': ' + rep.low.why.slice(0, 2).join(', ') : ''}.` });
    mom.sort((a, b) => a.km - b.km);
    $('#rep-moments').innerHTML = `<h3>Your race</h3><ul>${mom.slice(0, 22).map((e) => `<li class="${e.tone === 'good' ? 'g' : e.tone === 'bad' ? 'b' : ''}"><span class="km">km ${Math.round(e.km)} · ${e.clock}</span> ${esc(trimText(e.text))}</li>`).join('')}</ul>`;
    // why
    const li = (arr, f) => arr.map((x) => `<li>${f(x)}</li>`).join('');
    const legs = rep.legsDesc.length ? `<h3>Where your quads went</h3><ul>${li(rep.legsDesc, (x) => `${esc(x.where)}: <b>${x.dmg}</b>`)}</ul>` : '';
    const stom = rep.stomach.length ? `<h3>Your stomach</h3><ul>${li(rep.stomach.slice(0, 3), (x) => `${esc(x.cause)}: <b>${x.amt}</b>`)}</ul>` : '';
    $('#rep-why').innerHTML = `<h3>What dragged you down</h3><ul>${li(rep.moraleDrains, (x) => `${esc(x.cause)} <span class="dim">(${x.amt})</span>`)}</ul>
      <h3>What carried you</h3><ul>${li(rep.moraleGains, (x) => `${esc(x.cause)} <span class="dim">(${x.amt})</span>`)}</ul>${legs}${stom}
      <p class="dim small">You ate ${rep.kcal.toLocaleString()} kcal over ${rep.hours.toFixed(1)} hours. Falls: ${rep.falls.length}. Dark patches: ${rep.darkPatches}.</p>`;
    $('#rep-people').innerHTML = `<h3>The others</h3><ul>${li(rep.named, (x) => `<b>${esc(x.who)}</b>: ${esc(x.text)}`)}</ul>
      <p>You made ${rep.passMade} overtakes and were overtaken ${rep.passTaken} times.</p>`;
  }
  function trimText(t) { return t.length > 160 ? t.slice(0, 157) + '…' : t; }
  function lede(rep, s) {
    const o = s.outcome;
    const parts = [];
    const firstHalf = s.secLog.filter((x) => C.SECTIONS.find((c) => c.id === x.id).to <= 52);
    const pushed = firstHalf.filter((x) => x.efforts.push).length;
    if (pushed >= 3) parts.push(`You raced the first half hard (${pushed} sections at Push).`);
    else if (firstHalf.length >= 6 && firstHalf.every((x) => !x.efforts.push)) parts.push('You held back early.');
    if (rep.low && rep.low.morale < 35) parts.push(`Your lowest point came at km ${Math.round(rep.low.km)} (${S.clockStr(rep.low.t)})${rep.low.why && rep.low.why.length ? ', ' + rep.low.why.slice(0, 2).join(' and ') : ''}.`);
    if (rep.high && rep.low && rep.high.morale - rep.low.morale > 25) parts.push(`By km ${Math.round(rep.high.km)} you'd come all the way back.`);
    if (rep.legsDesc[0] && rep.legsDesc[0].dmg > 12) parts.push(`${rep.legsDesc[0].where.replace(/ \(.*\)/, '')} cost your quads the most.`);
    if (o.kind === 'finish' && o.place && o.finishers) parts.push(o.place <= o.finishers * 0.25 ? 'A strong race.' : o.place <= o.finishers * 0.6 ? 'A solid finish.' : 'You got it done.');
    return parts.join(' ');
  }

  // ------------------------------------------------------------ tips (first race)
  const TIPS = {
    effort: TOUCH
      ? '<b>Pick an effort for this section</b>, then tap <b>Go</b>. Each card shows the time and what it costs. Most finishers power-hike the climbs and take technical descents cautiously.<br><br><b>Tap any body or mind bar</b> to see why it is moving. <b>Touch and drag the elevation strip</b> to look ahead.'
      : '<b>Pick an effort for this section</b> (1–4), then press <b>Go</b>. Each card shows the time and what it costs. Most finishers power-hike the climbs and take technical descents cautiously.<br><br><b>Hover over the body and mind bars</b> on the right to see why they are moving, and hover over the profile below to look ahead.',
    aid: '<b>Aid station.</b> Every action costs minutes, and the cutoff is real. Refill your flasks, restock your vest, eat something, and get out. Or sit down. You decide.'
  };
  function maybeTip(id) {
    const seen = store.get('tips', {});
    if (seen[id]) return;
    const el = $('#tip');
    el.innerHTML = TIPS[id] + '<br><button>Got it</button>';
    el.classList.remove('hidden');
    $('button', el).onclick = () => { el.classList.add('hidden'); seen[id] = true; store.set('tips', seen); };
  }

  // ------------------------------------------------------------ modal / menu
  function modal(html) { $('#modal .modal-card').innerHTML = html; $('#modal').classList.remove('hidden'); }
  function closeModal() { $('#modal').classList.add('hidden'); }
  function menu() {
    if (!$('#modal').classList.contains('hidden')) { closeModal(); return; }
    modal(`<h2>Paused</h2><p class="dim">The race waits for you. Nothing happens while this is open.</p><div class="menu-list">
      <button id="mm-resume" class="primary">Resume</button>
      <button id="mm-help">How to play</button>
      <button id="mm-sound">Sound: ${AU.enabled ? 'on' : 'off'}</button>
      <button id="mm-speed">Animation speed: ${app.speed}×</button>
      <button id="mm-quit">Save and quit to title</button></div>`);
    $('#mm-resume').onclick = closeModal;
    $('#mm-help').onclick = () => { closeModal(); app.helpFrom = 'race'; show('howto'); };
    $('#mm-sound').onclick = () => { AU.toggle(); store.set('sound', AU.enabled); menu(); menu(); };
    $('#mm-speed').onclick = () => { cycleSpeed(); menu(); menu(); };
    $('#mm-quit').onclick = () => { closeModal(); save(); app.play = null; show('title'); };
  }
  function cycleSpeed() { app.speed = app.speed === 1 ? 2 : app.speed === 2 ? 4 : 1; store.set('speed', app.speed); $('#btn-speed').textContent = app.speed + '×'; }

  // ------------------------------------------------------------ keyboard
  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Escape') { if (app.screen === 'race') menu(); else if (app.screen === 'howto') $('#screen-howto .back').click(); else closeModal(); return; }
    if (e.key === 'm' || e.key === 'M') { AU.toggle(); store.set('sound', AU.enabled); return; }
    if (app.screen !== 'race' || !$('#modal').classList.contains('hidden')) return;
    if (e.key === ' ') { e.preventDefault(); if (app.play) app.play.t = app.play.tEnd; return; }
    if (app.play) return;
    const d = app.d; if (!d) return;
    const n = parseInt(e.key, 10);
    if (d.kind === 'section') {
      if (n >= 1 && n <= 4) { const b = $$('.effort')[n - 1]; if (b && !b.disabled) b.click(); }
      if (e.key === 'Enter') { e.preventDefault(); go(); }
    } else if (d.kind === 'event') {
      const scope = app.momentOpen ? $('#moment') : $('#panel');
      const btns = $$('.choice', scope);
      if (n >= 1 && n <= btns.length && !btns[n - 1].disabled) btns[n - 1].click();
      if (e.key === 'Enter' && btns.length === 1) btns[0].click();
    } else if (d.kind === 'aid') {
      if (e.key === 'Enter') { e.preventDefault(); $('#panel .go').click(); }
    }
  });

  // ------------------------------------------------------------ wiring
  function wire() {
    buildBars();
    $('#btn-new').onclick = () => { AU.init(); openBriefing(); };
    $('#btn-continue').onclick = () => { AU.init(); continueRace(); };
    $('#btn-howto').onclick = () => { app.helpFrom = 'title'; show('howto'); };
    $$('#screen-howto .back').forEach((b) => b.onclick = () => { show(app.helpFrom === 'race' ? 'race' : 'title'); if (app.helpFrom === 'race') { RND.resize(); } });
    $('#screen-brief .back').onclick = () => show('title');
    $('#btn-start').onclick = startRace;
    $('#btn-again').onclick = () => openBriefing();
    $('#btn-same').onclick = () => openBriefing(app.R.s.seed);
    $('#btn-title').onclick = () => show('title');
    $('#btn-skip').onclick = () => { if (app.play) app.play.t = app.play.tEnd; };
    $('#land').addEventListener('click', () => { if (app.play) app.play.t = app.play.tEnd; }); // tap the scene to skip ahead (never makes a choice)
    $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet' || e.target.classList.contains('sheet-close')) closeSheet(); });
    document.addEventListener('pointerdown', (e) => {
      AU.unlock(); // iOS suspends audio until a gesture
      if (!e.target.closest || !e.target.closest('#profile-wrap')) $('#profile-tip').classList.add('hidden');
    }, { passive: true });
    $('#btn-speed').onclick = cycleSpeed;
    $('#btn-speed').textContent = app.speed + '×';
    $('#btn-sound').onclick = () => { AU.toggle(); store.set('sound', AU.enabled); $('#btn-sound').style.opacity = AU.enabled ? 1 : 0.4; };
    $('#btn-menu').onclick = menu;
    AU.setEnabled(store.get('sound', true));
    $('#btn-sound').style.opacity = AU.enabled ? 1 : 0.4;
    window.addEventListener('resize', () => { RND.resize(); PROF.resize(); });
    show('title');
    requestAnimationFrame(tick);
  }
  window.ColdharrowApp = app; // for debugging / automated checks
  wire();
})();
