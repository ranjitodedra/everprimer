// Tiny sound effects made with the Web Audio API (no audio files needed).
(function () {
  'use strict';

  const SL = window.SparkLab;
  const KEY = 'sparklab-muted';
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem(KEY) === '1'; } catch (e) { /* storage unavailable */ }

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, { type = 'sine', gain = 0.12, slide = 0, delay = 0 } = {}) {
    const c = audio();
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const amp = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.03);
  }

  function pop() {
    const c = audio();
    if (!c) return;
    const len = Math.floor(c.sampleRate * 0.25);
    const buffer = c.createBuffer(1, len, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = c.createBufferSource();
    const amp = c.createGain();
    amp.gain.value = 0.35;
    src.buffer = buffer;
    src.connect(amp).connect(c.destination);
    src.start();
  }

  const SOUNDS = {
    pick: () => tone(560, 0.07, { type: 'triangle', gain: 0.07 }),
    place: () => tone(360, 0.12, { type: 'triangle', gain: 0.12, slide: -90 }),
    click: () => { tone(1500, 0.03, { type: 'square', gain: 0.05 }); tone(900, 0.04, { type: 'square', gain: 0.04, delay: 0.03 }); },
    lit: () => [523, 659, 784].forEach((f, i) => tone(f, 0.2, { gain: 0.09, delay: i * 0.08 })),
    remove: () => tone(320, 0.18, { type: 'sawtooth', gain: 0.05, slide: -200 }),
    buzz: () => tone(110, 0.35, { type: 'sawtooth', gain: 0.06 }),
    pop,
  };

  SL.sound = {
    play(name) {
      if (muted || !SOUNDS[name]) return;
      try { SOUNDS[name](); } catch (e) { /* audio is optional */ }
    },
    get muted() { return muted; },
    setMuted(value) {
      muted = value;
      try { localStorage.setItem(KEY, value ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    },
  };
})();
