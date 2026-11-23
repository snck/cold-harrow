/* Coldharrow — tiny procedural sound. No asset files. */
(function (root) {
  'use strict';
  const A = { enabled: true, ready: false };
  let ac, master, windG, windF, rainG, nightG, stepT = 0;

  A.init = function () {
    if (A.ready || !A.enabled) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
    const noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const white = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;
    const loop = (buf) => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    // wind
    windF = ac.createBiquadFilter(); windF.type = 'bandpass'; windF.frequency.value = 400; windF.Q.value = 0.6;
    windG = ac.createGain(); windG.gain.value = 0;
    loop(noise).connect(windF); windF.connect(windG); windG.connect(master);
    // rain
    const rf = ac.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 2500;
    rainG = ac.createGain(); rainG.gain.value = 0;
    loop(white).connect(rf); rf.connect(rainG); rainG.connect(master);
    // night insects (very soft high chirp bed)
    nightG = ac.createGain(); nightG.gain.value = 0; nightG.connect(master);
    A.ready = true;
  };
  A.toggle = function () { A.enabled = !A.enabled; if (master) master.gain.value = A.enabled ? 0.55 : 0; if (A.enabled) A.init(); return A.enabled; };
  A.setEnabled = function (on) { A.enabled = on; if (master) master.gain.value = on ? 0.55 : 0; };

  // called every frame with the environment
  A.ambient = function (env, moving, speedKmh, dt) {
    if (!A.ready || !A.enabled) return;
    const t = ac.currentTime;
    const wind = Math.min(1, (env.wind || 0) * 0.8 + (env.rain ? 0.3 : 0));
    windG.gain.setTargetAtTime(0.04 + wind * 0.22, t, 0.5);
    windF.frequency.setTargetAtTime(300 + wind * 500 + Math.sin(t * 0.3) * 120, t, 0.8);
    rainG.gain.setTargetAtTime(env.rain ? 0.08 : 0, t, 0.8);
    if (moving) {
      stepT += dt * (speedKmh > 6.5 ? 2.8 : 1.8);
      if (stepT > 1) { stepT = 0; step(speedKmh); }
    }
    if (env.night && Math.random() < dt * 0.5) chirp(4200 + Math.random() * 900, 0.012, 0.05);
    if (!env.night && env.light > 0.5 && env.clock < 700 && Math.random() < dt * 0.8) bird();
  };
  function step(speed) {
    const t = ac.currentTime;
    const o = ac.createBufferSource();
    const len = 0.05;
    const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    o.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700 + Math.random() * 400;
    const g = ac.createGain(); g.gain.value = 0.18;
    o.connect(f); f.connect(g); g.connect(master); o.start(t);
  }
  function chirp(freq, vol, dur) {
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = freq; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function bird() {
    const t = ac.currentTime;
    const o = ac.createOscillator(), g = ac.createGain();
    const f0 = 2400 + Math.random() * 1800;
    o.frequency.setValueAtTime(f0, t);
    for (let i = 0; i < 4; i++) o.frequency.linearRampToValueAtTime(f0 * (1 + (Math.random() - 0.3) * 0.4), t + 0.04 * (i + 1));
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.03, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
  }
  function pad(freqs, dur, vol, type) {
    if (!A.ready || !A.enabled) return;
    const t = ac.currentTime;
    for (const f of freqs) {
      const o = ac.createOscillator(), g = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = type || 'triangle'; o.frequency.value = f;
      lp.type = 'lowpass'; lp.frequency.value = 1800;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp); lp.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.1);
    }
  }
  function bell(freq, vol, at) {
    if (!A.ready || !A.enabled) return;
    const t = ac.currentTime + (at || 0);
    for (const [m, v] of [[1, 1], [2.76, 0.4], [5.4, 0.2]]) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = freq * m; g.gain.setValueAtTime(vol * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1.7);
    }
  }
  A.cue = function (kind) {
    if (!A.ready || !A.enabled) return;
    if (kind === 'sunrise') pad([196, 247, 294, 392, 494], 7, 0.05);
    else if (kind === 'summit' || kind === 'home') pad([220, 277, 330, 440], 5, 0.05);
    else if (kind === 'aid') { bell(880, 0.05); bell(990, 0.04, 0.25); }
    else if (kind === 'low') pad([73, 110, 116.5], 6, 0.05, 'sine');
    else if (kind === 'bad') pad([98, 104], 2.5, 0.05, 'sine');
    else if (kind === 'good') pad([392, 494, 587], 2.2, 0.035);
    else if (kind === 'finish') { for (let i = 0; i < 10; i++) bell(700 + Math.random() * 500, 0.035, i * 0.12 + Math.random() * 0.1); pad([196, 247, 294, 392, 494, 587], 9, 0.05); }
    else if (kind === 'click') chirp(1200, 0.02, 0.04);
  };
  root.TrailAudio = A;
})(typeof self !== 'undefined' ? self : this);
