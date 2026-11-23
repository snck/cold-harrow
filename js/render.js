/* Coldharrow — canvas renderer: side-on landscape and the elevation profile. */
(function (root) {
  'use strict';
  const S = root.TrailSim, C = root.TrailCourse;

  // ---------------------------------------------------------------- utils
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function mix(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  const rgb = (c, a) => a == null ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  function hash(x) { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function noise1(x) { const i = Math.floor(x), f = x - i; const u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u); }
  function fbm(x, oct) { let v = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { v += a * noise1(x * f + i * 17.3); a *= 0.5; f *= 2.03; } return v; }

  // sky keyframes by clock minute: [clock, top, bottom]
  const SKY = [
    [0, '#060a18', '#1f2a4a'], [300, '#070b1c', '#222c4c'], [345, '#1a2546', '#4a3a5a'], [372, '#2e4470', '#e2875a'],
    [410, '#4a74ab', '#f1c194'], [480, '#4f86c6', '#b9d6ee'], [900, '#3f7fca', '#a8cfee'], [1110, '#4a73a8', '#efc58f'],
    [1200, '#3a4a7a', '#e2805e'], [1240, '#1e2448', '#6a4a66'], [1290, '#0b1024', '#222a4a'], [1440, '#060a18', '#1f2a4a']
  ];
  function skyAt(clock) {
    for (let i = 1; i < SKY.length; i++) if (clock <= SKY[i][0]) {
      const [c0, t0, b0] = SKY[i - 1], [c1, t1, b1] = SKY[i];
      const t = (clock - c0) / (c1 - c0);
      return { top: mix(hex(t0), hex(t1), t), bottom: mix(hex(b0), hex(b1), t) };
    }
    return { top: hex('#060a18'), bottom: hex('#111833') };
  }

  // ---------------------------------------------------------------- landscape
  const R = {};
  let cv, ctx, W = 800, H = 400, dpr = 1;
  let stars = [];
  let rainDrops = [];
  R.init = function (canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    stars = Array.from({ length: 160 }, (_, i) => ({ x: hash(i * 3.1), y: Math.pow(hash(i * 7.7), 1.6) * 0.7, s: hash(i * 1.3) * 1.4 + 0.3, tw: hash(i * 9.9) * 6 }));
    rainDrops = Array.from({ length: 140 }, (_, i) => ({ x: hash(i * 2.3), y: hash(i * 5.1), l: 8 + hash(i) * 14 }));
    R.resize();
  };
  R.resize = function () {
    if (!cv) return;
    dpr = Math.min(2, root.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    W = Math.max(200, r.width); H = Math.max(150, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // v: { km, t, s, moving, anim (seconds), nearby: [{km, id, look}], companion, moment, flash }
  R.draw = function (v) {
    if (!ctx) return;
    const s = v.s;
    const clock = S.clockOf(v.t);
    const env = S.envAt(s, clamp(v.km, 0, 99.99), v.t);
    const w = S.weatherOf(s);
    const light = env.light;
    const sky = skyAt(clock);
    let top = sky.top, bot = sky.bottom;
    const grey = hex('#5f666e');
    const cloud = env.rain ? 0.75 : env.fog ? 0.55 : w.cloud * 0.5;
    if (cloud > 0) { top = mix(top, mix(grey, hex('#10141c'), 1 - light), cloud); bot = mix(bot, mix(hex('#9aa1a8'), hex('#1a1f28'), 1 - light), cloud); }

    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bot));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // stars & moon
    const starA = clamp(1 - light * 2.2, 0, 1) * (1 - cloud);
    if (starA > 0.02) {
      for (const st of stars) {
        const tw = 0.6 + 0.4 * Math.sin(v.anim * 1.5 + st.tw);
        ctx.fillStyle = `rgba(235,240,255,${starA * tw})`;
        ctx.fillRect(st.x * W, st.y * H, st.s, st.s);
      }
      // moon (waning, low in the west during the night)
      const mx = W * (0.82 - 0.4 * clamp(((clock + 1440 - 1260) % 1440) / 600, 0, 1)), my = H * 0.18;
      ctx.fillStyle = `rgba(240,236,220,${starA * 0.9})`;
      ctx.beginPath(); ctx.arc(mx, my, 13, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(top, starA * 0.95);
      ctx.beginPath(); ctx.arc(mx - 6, my - 3, 12, 0, Math.PI * 2); ctx.fill();
    }
    // sun
    const sh = S.sunHeight(clock);
    if (clock > S.SUNRISE - 20 && clock < S.SUNSET + 20) {
      const p = (clock - S.SUNRISE) / (S.SUNSET - S.SUNRISE);
      const sx = W * (0.12 + 0.76 * p), sy = H * (0.62 - 0.55 * Math.max(0, sh));
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
      const warm = sh < 0.3 ? [255, 170, 90] : [255, 245, 210];
      sg.addColorStop(0, rgb(warm, 0.95 * (1 - cloud * 0.8))); sg.addColorStop(0.15, rgb(warm, 0.5 * (1 - cloud))); sg.addColorStop(1, rgb(warm, 0));
      ctx.fillStyle = sg; ctx.fillRect(sx - 90, sy - 90, 180, 180);
    }

    // far ridges (parallax)
    const elev = S.elevAt(clamp(v.km, 0, 100));
    const pxPerKm = W / 3.0;
    const pxPerM = H / 620;
    const horizonShift = (elev - 1000) * 0.06;
    const ridgeCols = [
      mix(bot, top, 0.25), mix(bot, mix(top, hex('#1b2430'), 0.5), 0.5), mix(mix(bot, top, 0.5), hex('#0d1218'), 0.55)
    ];
    const ridgeLight = clamp(light, 0.12, 1);
    for (let L = 0; L < 3; L++) {
      const par = [0.03, 0.08, 0.18][L];
      const base = H * [0.5, 0.58, 0.66][L] + horizonShift * (L + 1) * 0.5;
      const amp = H * [0.22, 0.2, 0.18][L];
      let col = ridgeCols[L];
      if (env.fog) col = mix(col, bot, 0.5);
      ctx.fillStyle = rgb(mix(col, hex('#05070c'), (1 - ridgeLight) * (0.45 + L * 0.12)));
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) {
        const wx = (x / W) * (2.2 + L) + v.km * par + L * 40;
        const y = base - fbm(wx, 5) * amp - (L === 0 ? Math.pow(noise1(wx * 0.5 + 9), 3) * amp * 0.6 : 0);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
    }
    // valley mist in the morning
    if (clock > 340 && clock < 560 && !env.rain) {
      const a = 0.35 * Math.sin(Math.PI * (clock - 340) / 220);
      const mg = ctx.createLinearGradient(0, H * 0.55, 0, H * 0.8);
      mg.addColorStop(0, 'rgba(255,255,255,0)'); mg.addColorStop(0.6, `rgba(250,245,240,${a})`); mg.addColorStop(1, 'rgba(250,245,240,0)');
      ctx.fillStyle = mg; ctx.fillRect(0, H * 0.55, W, H * 0.3);
    }

    // near terrain: the course itself
    const px0 = W * 0.36, py0 = H * 0.62;
    const kmAt = (x) => v.km + (x - px0) / pxPerKm;
    const yAt = (km) => py0 - (S.elevAt(clamp(km, -1, 101)) - elev) * pxPerM;
    const secAtX = (km) => C.SECTIONS[S.sectionIndexAt(clamp(km, 0, 99.99))];
    const groundBase = { forest: hex('#2c4329'), rock: hex('#6a655e'), grass: hex('#5a7637'), lane: hex('#4f5a3c') };
    const nightTint = hex('#141c2c');
    const shade = (c) => mix(c, nightTint, clamp(1 - light, 0, 0.7));
    // fill ground
    ctx.beginPath(); ctx.moveTo(-10, H);
    for (let x = -10; x <= W + 10; x += 4) ctx.lineTo(x, yAt(kmAt(x)) + noise1(kmAt(x) * 40) * 3);
    ctx.lineTo(W + 10, H); ctx.closePath();
    const sec0 = secAtX(v.km);
    const gcol = sec0.forest > 0.6 ? groundBase.forest : sec0.tech > 0.5 ? groundBase.rock : sec0.kind === 'runnable' && sec0.tech < 0.15 ? groundBase.lane : groundBase.grass;
    const gg = ctx.createLinearGradient(0, py0 - 100, 0, H);
    gg.addColorStop(0, rgb(shade(gcol))); gg.addColorStop(1, rgb(shade(mix(gcol, hex('#151a12'), 0.6))));
    ctx.fillStyle = gg; ctx.fill();

    // features along the visible trail
    for (let x = -20; x <= W + 20; x += 9) {
      const km = kmAt(x);
      if (km < 0 || km > 100) continue;
      const sec = secAtX(km);
      const y = yAt(km);
      const hsh = hash(Math.floor(km * 111));
      if (sec.forest > 0.4 && hsh < sec.forest * 0.55) {
        const th = 26 + hash(km * 77) * 34;
        const tx = x + (hash(km * 13) - 0.5) * 6;
        const col = shade(mix(hex('#1d3320'), hex('#2f4d2a'), hash(km * 5)));
        ctx.fillStyle = rgb(col);
        ctx.beginPath(); ctx.moveTo(tx, y - th - 4); ctx.lineTo(tx - th * 0.28, y + 2); ctx.lineTo(tx + th * 0.28, y + 2); ctx.closePath(); ctx.fill();
        if (hsh < sec.forest * 0.2) { // background tree a bit higher
          ctx.fillStyle = rgb(mix(col, bot, 0.25));
          ctx.beginPath(); ctx.moveTo(tx + 5, y - th * 1.4 - 10); ctx.lineTo(tx + 5 - th * 0.3, y - 8); ctx.lineTo(tx + 5 + th * 0.3, y - 8); ctx.closePath(); ctx.fill();
        }
      } else if (sec.tech > 0.35 && hsh > 1 - sec.tech * 0.45) {
        const rs = 3 + hash(km * 9) * 7 * sec.tech;
        ctx.fillStyle = rgb(shade(mix(hex('#8a847b'), hex('#5c5852'), hash(km * 3))));
        ctx.beginPath(); ctx.moveTo(x - rs, y + 2); ctx.lineTo(x - rs * 0.4, y - rs); ctx.lineTo(x + rs * 0.7, y - rs * 0.6); ctx.lineTo(x + rs, y + 2); ctx.closePath(); ctx.fill();
      } else if (sec.forest < 0.3 && hsh < 0.25) {
        ctx.strokeStyle = rgb(shade(hex('#7f9a4a')), 0.7); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x - 2, y - 6); ctx.moveTo(x + 2, y + 1); ctx.lineTo(x + 3, y - 5); ctx.stroke();
      }
    }
    // trail line
    ctx.strokeStyle = rgb(shade(hex('#b9a98a')), 0.85); ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = -10; x <= W + 10; x += 4) { const y = yAt(kmAt(x)); x < -9 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.stroke();

    // rivers, aid stations, summits, finish
    const inView = (km) => { const x = px0 + (km - v.km) * pxPerKm; return x > -80 && x < W + 80 ? x : null; };
    for (const f of C.FEATURES) {
      const x = inView(f.km); if (x == null) continue;
      const y = yAt(f.km);
      if (f.type === 'ford') {
        const wg = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
        const wc = shade(hex('#5aa7d8'));
        wg.addColorStop(0, rgb(wc, 0)); wg.addColorStop(0.5, rgb(wc, 0.9)); wg.addColorStop(1, rgb(wc, 0));
        ctx.fillStyle = wg; ctx.fillRect(x - 40, y - 2, 80, 9);
        ctx.strokeStyle = rgb([255, 255, 255], 0.35 * Math.max(0.3, light));
        for (let i = 0; i < 4; i++) { const xx = x - 25 + ((v.anim * 30 + i * 16) % 50); ctx.beginPath(); ctx.moveTo(xx, y + 2); ctx.lineTo(xx + 6, y + 2); ctx.stroke(); }
      } else if (f.type === 'summit' || f.type === 'false') {
        ctx.fillStyle = rgb(shade(hex('#9a948a')));
        for (let i = 0; i < 4; i++) { const r = 6 - i; ctx.beginPath(); ctx.ellipse(x + 14, y - 3 - i * 6, r * 1.2, 3.2, 0, 0, Math.PI * 2); ctx.fill(); }
        if (f.big) { ctx.strokeStyle = rgb(shade(hex('#ddd'))); ctx.beginPath(); ctx.moveTo(x + 14, y - 26); ctx.lineTo(x + 14, y - 44); ctx.stroke(); ctx.fillStyle = '#d94b3a'; ctx.fillRect(x + 14, y - 44, 12, 7); }
      }
    }
    for (const n of C.NODES) {
      const x = inView(n.km); if (x == null) continue;
      const y = yAt(n.km);
      if (n.type === 'aid' || n.type === 'water') drawAid(x, y, n, light, v.anim);
      if (n.type === 'finish') drawArch(x, y, light);
      if (n.type === 'start' && v.t < 3) drawArch(x, y, light);
    }

    // other runners
    const dark = env.dark;
    const near = (v.nearby || []).slice().sort((a, b) => Math.abs(a.km - v.km) - Math.abs(b.km - v.km)).slice(0, 22);
    for (const o of near) {
      const x = px0 + (o.km - v.km) * pxPerKm;
      if (x < -20 || x > W + 20) continue;
      const y = yAt(o.km);
      const gr = (S.elevAt(o.km + 0.05) - S.elevAt(o.km - 0.05)) / 100;
      drawRunner(x, y, gr, v.anim * (v.moving ? 1 : 0.15) + o.id * 1.7, { scale: 0.78, shirt: npcColour(o.id), dark, light, alpha: 0.9, lamp: dark });
    }
    // companion
    if (v.companion) {
      const x = px0 - 18;
      drawRunner(x, yAt(kmAt(x)), (S.elevAt(v.km + 0.05) - S.elevAt(v.km - 0.05)) / 100, v.anim * (v.moving ? 1 : 0.15) + 1.3, { scale: 0.92, shirt: v.companion === 'Ines' ? [120, 80, 170] : v.companion === 'Jonah' ? [60, 140, 200] : v.companion === 'Tomas' ? [40, 40, 40] : [200, 190, 60], dark, light, lamp: dark });
    }
    // the player
    const grade = (S.elevAt(v.km + 0.05) - S.elevAt(v.km - 0.05)) / 100;
    drawRunner(px0, py0, grade, v.anim * (v.moving ? 1 : 0.12), { scale: 1.1, shirt: [235, 110, 40], dark, light, lamp: dark, player: true, battery: s.kit.battery, effort: v.effort });
    // a small marker so you can always find yourself
    ctx.fillStyle = 'rgba(255,170,90,0.9)';
    ctx.beginPath(); ctx.moveTo(px0 + 1, py0 - 50); ctx.lineTo(px0 - 4, py0 - 57); ctx.lineTo(px0 + 6, py0 - 57); ctx.closePath(); ctx.fill();

    // weather overlays
    if (env.rain) {
      ctx.strokeStyle = `rgba(190,200,220,${0.35 + 0.2 * light})`; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of rainDrops) {
        const x = ((d.x * W + v.anim * 60) % (W + 40)) - 20, y = ((d.y * H + v.anim * 700 * (0.7 + d.x * 0.6)) % (H + 40)) - 20;
        ctx.moveTo(x, y); ctx.lineTo(x - 4, y + d.l);
      }
      ctx.stroke();
    }
    if (env.fog) {
      const fg = ctx.createRadialGradient(px0, py0 - 20, 20, px0, py0 - 20, Math.max(W, H) * 0.7);
      const fc = mix(hex('#c8ccd2'), hex('#1c2230'), 1 - light);
      fg.addColorStop(0, rgb(fc, 0.15)); fg.addColorStop(0.35, rgb(fc, 0.65)); fg.addColorStop(1, rgb(fc, 0.9));
      ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
    }
    // darkness outside the headlamp
    if (dark) {
      const dg = ctx.createRadialGradient(px0 + 50, py0 - 10, 30, px0 + 50, py0 - 10, Math.max(W, H) * 0.75);
      dg.addColorStop(0, 'rgba(0,0,8,0)'); dg.addColorStop(0.35, 'rgba(0,0,8,0.25)'); dg.addColorStop(1, 'rgba(0,0,8,0.55)');
      ctx.fillStyle = dg; ctx.fillRect(0, 0, W, H);
    }
    // the mind: low morale greys and narrows the world
    const mor = v.morale != null ? v.morale : s.m.morale;
    if (mor < 45) {
      const a = (45 - mor) / 45;
      ctx.save();
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = `rgba(128,128,128,${a * 0.85})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (0.55 - a * 0.25), W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${0.55 * a})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    }
    // flashes for big moments
    if (v.flash && v.flash.a > 0.01) {
      ctx.fillStyle = v.flash.color.replace('A', v.flash.a.toFixed(3));
      ctx.fillRect(0, 0, W, H);
    }
  };

  function npcColour(id) {
    const pal = [[70, 120, 200], [200, 60, 70], [60, 160, 110], [220, 200, 70], [150, 90, 180], [230, 140, 170], [90, 90, 90], [240, 240, 240], [40, 170, 190]];
    return pal[id % pal.length];
  }

  function drawRunner(x, y, grade, phase, o) {
    const sc = o.scale || 1;
    const lit = o.dark ? (o.player ? 0.6 : 0.35) : 1;
    const skin = mix([90, 70, 60], [214, 170, 140], lit);
    const shirt = mix([30, 30, 40], o.shirt, o.dark ? (o.player ? 0.85 : 0.45) : 1);
    const shorts = mix([15, 15, 20], [40, 45, 60], lit);
    const lean = clamp(grade * 2.2, -0.25, 0.55); // lean into climbs
    const hiking = grade > 0.08 || o.effort === 'walk';
    const stride = hiking ? 0.55 : 1;
    const ph = phase * (hiking ? 5 : 8);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sc, sc);
    ctx.globalAlpha = o.alpha || 1;
    const hipY = -17, shY = -31;
    const hipX = 0, shX = Math.sin(lean) * 14;
    // legs
    ctx.strokeStyle = rgb(shorts); ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (const side of [0, Math.PI]) {
      const a = Math.sin(ph + side) * 0.7 * stride;
      const kx = hipX + Math.sin(a) * 9, ky = hipY + Math.cos(a) * 9;
      const lift = Math.max(0, Math.sin(ph + side + 1.2)) * (hiking ? 0.6 : 1.4);
      const fx = kx + Math.sin(a - lift) * 9, fy = ky + Math.cos(a - lift) * 9;
      ctx.strokeStyle = rgb(side ? mix(shorts, [0, 0, 0], 0.3) : shorts);
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, Math.min(fy, 0)); ctx.stroke();
    }
    // torso
    ctx.strokeStyle = rgb(shirt); ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shX, shY); ctx.stroke();
    // vest
    ctx.strokeStyle = rgb(mix(shirt, [20, 20, 25], 0.55)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hipX - 2.5, hipY - 2); ctx.lineTo(shX - 3, shY + 1); ctx.stroke();
    // arms
    ctx.strokeStyle = rgb(skin); ctx.lineWidth = 2.4;
    for (const side of [0, Math.PI]) {
      const a = -Math.sin(ph + side) * 0.8 * stride;
      const ex = shX + Math.sin(a) * 7, ey = shY + 7;
      const hx = ex + Math.sin(a + (hiking ? 0.2 : 1.2)) * 7, hy = ey + (hiking ? 6 : 2);
      ctx.beginPath(); ctx.moveTo(shX, shY + 1); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke();
    }
    // head
    const hx = shX + Math.sin(lean) * 4 + 1, hy = shY - 6;
    ctx.fillStyle = rgb(skin);
    ctx.beginPath(); ctx.arc(hx, hy, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = rgb(shirt); ctx.fillRect(hx - 4.5, hy - 5, 9, 2.5); // cap
    ctx.restore();
    // headlamp
    if (o.lamp) {
      const lx = x + (shX + 4) * sc, ly = y + (hy - 1) * sc;
      const dim = o.player && o.battery < 15;
      const len = (o.player ? (dim ? 90 : 170) : 70) * sc;
      const ang = 0.15 + Math.max(-0.2, grade * 0.6) * -1;
      const bg = ctx.createRadialGradient(lx, ly, 2, lx, ly, len);
      const bc = dim ? [255, 210, 120] : [255, 250, 225];
      bg.addColorStop(0, rgb(bc, o.player ? 0.55 : 0.45)); bg.addColorStop(1, rgb(bc, 0));
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.moveTo(lx, ly);
      ctx.arc(lx, ly, len, ang - 0.32, ang + 0.42); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgb(bc, 0.95);
      ctx.beginPath(); ctx.arc(lx, ly, o.player ? 2.2 : 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawAid(x, y, n, light, anim) {
    const col = mix([30, 30, 40], [220, 220, 225], light);
    ctx.fillStyle = rgb(col);
    if (n.type === 'water') {
      ctx.fillStyle = rgb(mix([40, 40, 40], [120, 120, 125], light));
      ctx.fillRect(x - 8, y - 8, 16, 8);
      ctx.fillStyle = rgb(mix([20, 40, 60], [90, 170, 220], light)); ctx.fillRect(x - 7, y - 7, 14, 3);
      return;
    }
    ctx.beginPath(); ctx.moveTo(x - 22, y); ctx.lineTo(x - 16, y - 20); ctx.lineTo(x + 16, y - 20); ctx.lineTo(x + 22, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgb(mix([10, 10, 15], [200, 60, 50], light));
    ctx.fillRect(x - 16, y - 22, 32, 4);
    // string lights
    for (let i = 0; i < 9; i++) {
      const lx = x - 30 + i * 7.5, ly = y - 24 + Math.sin(i / 8 * Math.PI) * 5;
      const on = 0.6 + 0.4 * Math.sin(anim * 3 + i);
      ctx.fillStyle = `rgba(255,${200 + i * 5},120,${(1 - light * 0.7) * on})`;
      ctx.beginPath(); ctx.arc(lx, ly, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    if (light < 0.5) {
      const g = ctx.createRadialGradient(x, y - 10, 2, x, y - 10, 70);
      g.addColorStop(0, 'rgba(255,200,120,0.35)'); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.fillRect(x - 70, y - 80, 140, 140);
    }
  }
  function drawArch(x, y, light) {
    ctx.strokeStyle = rgb(mix([40, 40, 50], [235, 235, 240], light)); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x - 20, y); ctx.lineTo(x - 20, y - 42); ctx.lineTo(x + 20, y - 42); ctx.lineTo(x + 20, y); ctx.stroke();
    ctx.fillStyle = rgb(mix([60, 20, 20], [210, 70, 50], light)); ctx.fillRect(x - 22, y - 50, 44, 10);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('COLDHARROW', x, y - 42.5);
  }

  // ---------------------------------------------------------------- profile strip
  const P = {};
  let pcv, pctx, PW = 800, PH = 90, hoverKm = null;
  P.init = function (canvas, onHover) {
    pcv = canvas; pctx = pcv.getContext('2d');
    P.resize();
    pcv.addEventListener('mousemove', (e) => { const r = pcv.getBoundingClientRect(); hoverKm = clamp(((e.clientX - r.left) - 8) / (PW - 16) * 100, 0, 100); onHover && onHover(hoverKm, e); });
    pcv.addEventListener('mouseleave', () => { hoverKm = null; onHover && onHover(null); });
  };
  P.resize = function () {
    if (!pcv) return;
    const r = pcv.getBoundingClientRect();
    PW = Math.max(200, r.width); PH = Math.max(60, r.height);
    pcv.width = Math.round(PW * dpr); pcv.height = Math.round(PH * dpr);
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  P.draw = function (st, opts) {
    if (!pctx) return;
    opts = opts || {};
    const c = pctx;
    c.clearRect(0, 0, PW, PH);
    const x0 = 8, x1 = PW - 8, top = 16, bot = PH - 16;
    const xk = (km) => x0 + (x1 - x0) * km / 100;
    const yE = (e) => bot - (e - 300) / (2200 - 300) * (bot - top);
    // section bands
    for (const sec of C.SECTIONS) {
      if (sec.kind === 'climb') { c.fillStyle = 'rgba(255,140,80,0.05)'; c.fillRect(xk(sec.from), 0, xk(sec.to) - xk(sec.from), bot); }
    }
    // profile fill
    const g = c.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, '#8aa4b8'); g.addColorStop(1, '#2d3b47');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(xk(0), bot);
    for (let k = 0; k <= 100; k += 0.25) c.lineTo(xk(k), yE(S.elevAt(k)));
    c.lineTo(xk(100), bot); c.closePath(); c.fill();
    // done portion
    const km = st ? st.km : 0;
    c.save(); c.beginPath(); c.rect(xk(0), 0, xk(km) - xk(0), PH); c.clip();
    c.fillStyle = 'rgba(240,150,70,0.55)';
    c.beginPath(); c.moveTo(xk(0), bot);
    for (let k = 0; k <= 100; k += 0.25) c.lineTo(xk(k), yE(S.elevAt(k)));
    c.lineTo(xk(100), bot); c.closePath(); c.fill();
    c.restore();
    // hover section highlight
    if (hoverKm != null) {
      const sec = C.SECTIONS[S.sectionIndexAt(Math.min(99.99, hoverKm))];
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(xk(sec.from), top - 6, xk(sec.to) - xk(sec.from), bot - top + 6);
    }
    // nodes
    c.font = '10px system-ui, sans-serif'; c.textAlign = 'center';
    for (const n of C.NODES) {
      const x = xk(n.km);
      if (n.type === 'aid' || n.type === 'finish' || n.type === 'water') {
        c.strokeStyle = n.type === 'water' ? 'rgba(120,190,240,0.7)' : 'rgba(255,255,255,0.5)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, yE(S.elevAt(n.km))); c.lineTo(x, bot + 2); c.stroke();
        c.fillStyle = n.type === 'water' ? '#7cc0f0' : '#f5f0e6';
        c.beginPath(); c.arc(x, yE(S.elevAt(n.km)), 3, 0, Math.PI * 2); c.fill();
        if (n.type !== 'water') {
          c.fillStyle = 'rgba(235,230,220,0.85)';
          c.fillText(n.type === 'finish' ? 'Finish' : n.name, x, PH - 3);
        }
      }
    }
    for (const f of C.FEATURES) {
      if (f.type !== 'summit' && f.id !== 'crown') continue;
      const x = xk(f.km), y = yE(S.elevAt(f.km));
      c.fillStyle = f.big ? '#ffd38a' : 'rgba(255,230,180,0.7)';
      c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x - 3, y - 4); c.lineTo(x + 3, y - 4); c.closePath(); c.fill();
      if (f.big) c.fillText('Crown 2,140 m', x, top - 4);
    }
    const oven = C.SECTIONS.find((x) => x.id === 'oven');
    c.fillStyle = 'rgba(255,170,90,0.85)'; c.fillText('the Oven', xk((oven.from + oven.to) / 2 + 2), top + 18);
    const lie = C.SECTIONS.find((x) => x.id === 'lastlie');
    c.fillStyle = 'rgba(255,200,170,0.75)'; c.fillText('the Last Lie', xk((lie.from + lie.to) / 2), top + 34);
    // other runners as ticks
    if (opts.runners) {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      for (const r of opts.runners) { if (r.km < 0 || r.km > 100) continue; c.fillRect(xk(r.km) - 0.5, bot - 5, 1, 5); }
    }
    // the player
    if (st) {
      const x = xk(km), y = yE(S.elevAt(km));
      c.fillStyle = '#ff8a3d'; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fill(); c.stroke();
    }
  };

  // ---------------------------------------------------------------- race chart (report)
  R.chart = function (canvas, hist, marks) {
    const c = canvas.getContext('2d');
    const r = canvas.getBoundingClientRect();
    const w = Math.max(300, r.width), h = Math.max(160, r.height);
    canvas.width = w * dpr; canvas.height = h * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const x0 = 34, x1 = w - 10, y0 = 12, y1 = h - 26;
    const maxKm = 100;
    const xk = (k) => x0 + (x1 - x0) * k / maxKm;
    const yv = (v) => y1 - (y1 - y0) * v / 100;
    // elevation ghost
    c.fillStyle = 'rgba(140,160,180,0.12)';
    c.beginPath(); c.moveTo(xk(0), y1);
    for (let k = 0; k <= 100; k += 0.5) c.lineTo(xk(k), y1 - (S.elevAt(k) - 300) / 1900 * (y1 - y0));
    c.lineTo(xk(100), y1); c.closePath(); c.fill();
    // grid
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1;
    c.fillStyle = 'rgba(255,255,255,0.45)'; c.font = '10px system-ui, sans-serif'; c.textAlign = 'right';
    for (const v of [0, 25, 50, 75, 100]) { c.beginPath(); c.moveTo(x0, yv(v)); c.lineTo(x1, yv(v)); c.stroke(); c.fillText(v, x0 - 5, yv(v) + 3); }
    c.textAlign = 'center';
    for (let k = 0; k <= 100; k += 10) c.fillText(k + ' km', xk(k), h - 10);
    // aid station lines
    for (const n of C.NODES) if (n.type === 'aid') { c.strokeStyle = 'rgba(255,255,255,0.12)'; c.setLineDash([2, 3]); c.beginPath(); c.moveTo(xk(n.km), y0); c.lineTo(xk(n.km), y1); c.stroke(); c.setLineDash([]); }
    const series = [
      ['legs', '#c98a5a', 1.5], ['energy', '#e8c547', 1.5], ['stomach', '#8fc27a', 1.2], ['hyd', '#5aa7d8', 1.2],
      ['resolve', '#b48ae0', 2], ['morale', '#ff7a59', 2.8]
    ];
    for (const [key, col, lw] of series) {
      c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha = key === 'morale' || key === 'resolve' ? 1 : 0.7;
      c.beginPath();
      hist.forEach((p, i) => { const x = xk(p.km), y = yv(p[key]); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.stroke();
    }
    c.globalAlpha = 1;
    // marks
    for (const m of marks || []) {
      const x = xk(m.km);
      c.fillStyle = m.good ? '#ffd38a' : '#ff5b5b';
      c.beginPath(); c.arc(x, m.good ? y0 + 4 : y1 - 4, 3.5, 0, Math.PI * 2); c.fill();
    }
    return series;
  };

  root.TrailRender = R;
  root.TrailProfile = P;
})(typeof self !== 'undefined' ? self : this);
