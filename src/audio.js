// Procedural audio: every sound is synthesized with WebAudio (no recorded assets).
import * as THREE from 'three';

export class Audio {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.emitters = new Map();
    this.scene = null;
    this.buffers = {};
    this.started = false;
    this.voices = [];
    this.speaking = false;
    this.subtitle = null; // callback(text, who)
    if ('speechSynthesis' in window) {
      const load = () => { this.voices = speechSynthesis.getVoices(); };
      load();
      speechSynthesis.onvoiceschanged = load;
    }
  }

  start(scene) {
    this.scene = scene;
    if (this.ctx.state !== 'running') this.ctx.resume();
    if (this.started) return;
    this.started = true;
    this.makeBuffers();
  }

  makeBuffers() {
    const sr = this.ctx.sampleRate;
    const mk = (len, fn) => {
      const b = this.ctx.createBuffer(1, Math.max(1, Math.floor(len * sr)), sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = fn(i / sr, i);
      return b;
    };
    // GM click: sharp decaying noise burst
    this.buffers.click = mk(0.004, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 1800));
    // noise for loops
    let last = 0;
    this.buffers.brown = mk(4, () => { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; return last * 3.5; });
    this.buffers.white = mk(2, () => Math.random() * 2 - 1);
    // ratchet tick
    this.buffers.tick = mk(0.03, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 260) * 0.8 + Math.sin(t * 2 * Math.PI * 2400) * Math.exp(-t * 400) * 0.5);
    // latch clunk
    this.buffers.clunk = mk(0.35, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.5 + Math.sin(t * 2 * Math.PI * 70) * Math.exp(-t * 12));
    // button click
    this.buffers.btn = mk(0.025, (t) => (Math.random() * 2 - 1) * Math.exp(-t * 500) * 0.6 + Math.sin(t * 2 * Math.PI * 1500) * Math.exp(-t * 300) * 0.3);
  }

  // an emitter = PositionalAudio fed by a GainNode we drive
  emitter(name, pos, opts = {}) {
    if (this.emitters.has(name)) return this.emitters.get(name);
    const pa = new THREE.PositionalAudio(this.listener);
    pa.setRefDistance(opts.ref ?? 1.0);
    pa.setRolloffFactor(opts.rolloff ?? 1.2);
    pa.setDistanceModel('inverse');
    const input = this.ctx.createGain();
    input.gain.value = 1;
    pa.setNodeSource(input);
    pa.setVolume(opts.volume ?? 1);
    const holder = opts.parent || new THREE.Object3D();
    if (!opts.parent) { holder.position.copy(pos); this.scene.add(holder); }
    holder.add(pa);
    const e = { pa, input, holder };
    this.emitters.set(name, e);
    return e;
  }

  playBuffer(buf, dest, gain = 1, rate = 1, when = 0) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start(when || this.ctx.currentTime);
    return s;
  }

  oneShot(kind, pos, gain = 1) {
    if (!this.started) return;
    const e = this.emitter('os_' + kind + '_' + (pos ? pos.toArray().map(v => v.toFixed(1)).join(',') : ''), pos || new THREE.Vector3(), { ref: 1.2 });
    if (kind === 'beep' || kind === 'beep_lo' || kind === 'beep_hi') {
      const f = kind === 'beep_lo' ? 660 : kind === 'beep_hi' ? 2200 : 1200;
      this.tone(e.input, f, 0.12, gain * 0.25, 'square');
      return;
    }
    if (kind === 'whoosh') {
      const n = this.ctx.createBufferSource(); n.buffer = this.buffers.white;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
      const g = this.ctx.createGain(); const t = this.ctx.currentTime;
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain * 0.25, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      n.connect(bp).connect(g).connect(e.input); n.start(t); n.stop(t + 1);
      return;
    }
    const buf = this.buffers[kind];
    if (buf) this.playBuffer(buf, e.input, gain, kind === 'tick' ? 0.9 + Math.random() * 0.2 : 1);
  }

  tone(dest, freq, dur, gain, type = 'sine', when) {
    const t = when || this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.setValueAtTime(gain, t + dur - 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
    o.connect(lp).connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---------- continuous sources
  roomTone(name, pos, gain) {
    const e = this.emitter(name, pos, { ref: 4, rolloff: 0.4 });
    const s = this.ctx.createBufferSource(); s.buffer = this.buffers.brown; s.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const hum = this.ctx.createOscillator(); hum.frequency.value = 120; const hg = this.ctx.createGain(); hg.gain.value = 0.004;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(lp).connect(g).connect(e.input);
    hum.connect(hg).connect(e.input);
    s.start(); hum.start();
  }

  // patterned alarm (console / area monitor). pattern: array of [freq, dur, gap]
  alarm(name, pos, pattern, gain = 0.25, opts = {}) {
    const e = this.emitter(name, pos, opts);
    e.alarm = { pattern, gain, on: false, next: 0, i: 0 };
    return e;
  }
  setAlarm(name, on) {
    const e = this.emitters.get(name);
    if (!e || !e.alarm) return;
    if (on && !e.alarm.on) e.alarm.next = this.ctx.currentTime + 0.05;
    e.alarm.on = on;
  }

  motor(pos) {
    const e = this.emitter('motor', pos, { ref: 0.8 });
    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 190;
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 383;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 3;
    const n = this.ctx.createBufferSource(); n.buffer = this.buffers.white; n.loop = true;
    const nb = this.ctx.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 2500; nb.Q.value = 2;
    const ng = this.ctx.createGain(); ng.gain.value = 0.0;
    const g = this.ctx.createGain(); g.gain.value = 0;
    o1.connect(lp); o2.connect(lp); lp.connect(g); n.connect(nb).connect(ng).connect(g); g.connect(e.input);
    o1.start(); o2.start(); n.start();
    e.motor = { g, o1, o2, ng, lp };
    return e;
  }
  // mode: 'off' | 'run' | 'strain'
  setMotor(mode) {
    const e = this.emitters.get('motor');
    if (!e) return;
    const t = this.ctx.currentTime, m = e.motor;
    if (mode === 'off') { m.g.gain.setTargetAtTime(0, t, 0.05); return; }
    if (mode === 'run') {
      m.g.gain.setTargetAtTime(0.06, t, 0.03); m.o1.frequency.setTargetAtTime(190, t, 0.1); m.o2.frequency.setTargetAtTime(383, t, 0.1);
      m.ng.gain.setTargetAtTime(0.01, t, 0.05);
    } else {
      m.g.gain.setTargetAtTime(0.09, t, 0.03); m.o1.frequency.setTargetAtTime(95, t, 0.25); m.o2.frequency.setTargetAtTime(150, t, 0.25);
      m.ng.gain.setTargetAtTime(0.06, t, 0.05);
    }
  }

  // Geiger-Müller click stream; rate in counts per second
  geiger(parent) {
    const e = this.emitter('gm', null, { parent, ref: 0.5, rolloff: 1.0 });
    const buzz = this.ctx.createBufferSource(); buzz.buffer = this.buffers.white; buzz.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 0.7;
    const bg = this.ctx.createGain(); bg.gain.value = 0;
    buzz.connect(bp).connect(bg).connect(e.input); buzz.start();
    e.gm = { rate: 0, next: 0, bg, on: false };
    return e;
  }
  setGeiger(cps, on) {
    const e = this.emitters.get('gm');
    if (!e) return;
    e.gm.rate = cps; e.gm.on = on;
    const t = this.ctx.currentTime;
    const buzz = on && cps > 120 ? Math.min(0.5, (cps - 120) / 600) : 0;
    e.gm.bg.gain.setTargetAtTime(buzz, t, 0.05);
  }

  epd(parent) { return this.emitter('epd', null, { parent, ref: 0.4 }); }
  epdChirp(hi = false) {
    const e = this.emitters.get('epd');
    if (e) this.tone(e.input, hi ? 3400 : 2600, 0.05, 0.12, 'square');
  }

  // scheduler for clicks and alarms; call each frame
  update() {
    if (!this.started) return;
    const now = this.ctx.currentTime, ahead = now + 0.12;
    for (const e of this.emitters.values()) {
      if (e.gm && e.gm.on && e.gm.rate > 0) {
        if (e.gm.next < now) e.gm.next = now;
        let guard = 0;
        while (e.gm.next < ahead && guard++ < 80) {
          if (e.gm.rate <= 400) this.playBuffer(this.buffers.click, e.input, 0.9, 1, e.gm.next);
          e.gm.next += -Math.log(1 - Math.random()) / Math.max(e.gm.rate, 0.01);
        }
      }
      if (e.alarm && e.alarm.on) {
        const a = e.alarm;
        let guard = 0;
        while (a.next < ahead && guard++ < 10) {
          const [f, d, gap] = a.pattern[a.i % a.pattern.length];
          if (f > 0) this.tone(e.input, f, d, a.gain, 'square', a.next);
          a.next += d + gap; a.i++;
        }
      }
    }
  }

  // ---------- speech (patient, phone)
  say(text, who = 'patient', opts = {}) {
    if (this.subtitle) this.subtitle(text, who);
    if (!('speechSynthesis' in window)) return Promise.resolve();
    return new Promise((res) => {
      try {
        const u = new SpeechSynthesisUtterance(text);
        const en = this.voices.filter(v => /^en/i.test(v.lang));
        const fem = en.find(v => /female|samantha|victoria|karen|zira|aria|jenny|susan|serena/i.test(v.name));
        const male = en.find(v => /male|daniel|alex|david|guy|fred/i.test(v.name) && !/female/i.test(v.name));
        u.voice = who === 'patient' ? (fem || en[0] || null) : (male || en[1] || en[0] || null);
        u.rate = opts.rate || (who === 'patient' ? 0.95 : 1.05);
        u.pitch = who === 'patient' ? 1.05 : 0.95;
        u.volume = opts.volume ?? 0.9;
        u.onend = () => res(); u.onerror = () => res();
        speechSynthesis.speak(u);
        setTimeout(res, 9000);
      } catch (e) { res(); }
    });
  }
  hush() { try { speechSynthesis.cancel(); } catch (e) {} }
}
