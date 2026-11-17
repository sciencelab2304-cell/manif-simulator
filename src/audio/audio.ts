import * as THREE from 'three';
import { rr, pick, clamp } from '../core/util';

type Pos = THREE.Vector3 | null;

/**
 * Every sound in the game is synthesised with the Web Audio API (no audio files,
 * no licensing issues): crowd, chants, drums, sirens, detonations, glass, screams...
 */
export class AudioEngine {
  ctx: AudioContext;
  master: GainNode;
  muffle: BiquadFilterNode;
  sfx: GainNode;
  amb: GainNode;
  reverb: ConvolverNode;
  revSend: GainNode;
  noise: AudioBuffer;
  voices = 0;
  maxVoices = 56;
  volume = 0.8;
  private listenerPos = new THREE.Vector3();

  // loops
  private crowdGain!: GainNode; private crowdFilter!: BiquadFilterNode; private crowdPanner!: PannerNode;
  private chatterGain!: GainNode;
  private heliGain!: GainNode; private heliPanner!: PannerNode;
  private waterGain!: GainNode; private waterPanner!: PannerNode;
  private fireGain!: GainNode; private firePanner!: PannerNode;
  private windGain!: GainNode;
  private sirens: { gain: GainNode; panner: PannerNode; osc: OscillatorNode }[] = [];
  private tinnitusGain!: GainNode;
  private nextChant = 4;
  private nextDrum = 0;
  private drumBeat = 0;
  private nextWhistle = 2;
  private nextHeart = 0;
  started = false;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.25;
    this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000;
    this.sfx = c.createGain(); this.amb = c.createGain();
    this.sfx.connect(this.muffle); this.amb.connect(this.muffle);
    this.muffle.connect(comp); comp.connect(this.master); this.master.connect(c.destination);
    // urban reverb (generated impulse response)
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.2);
    this.revSend = c.createGain(); this.revSend.gain.value = 0.35;
    this.revSend.connect(this.reverb); this.reverb.connect(this.muffle);
    // white noise buffer
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.buildLoops();
  }

  private impulse(sec: number, decay: number) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections from the facades + diffuse tail
        const early = i < c.sampleRate * 0.12 && Math.random() < 0.004 ? 1 : 0;
        d[i] = ((Math.random() * 2 - 1) * 0.5 + early) * Math.pow(1 - t, decay);
      }
    }
    return b;
  }

  private panner(pos?: THREE.Vector3, ref = 4, max = 220) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = 1.1;
    if (pos) this.setPannerPos(p, pos);
    return p;
  }
  private setPannerPos(p: PannerNode, v: THREE.Vector3) {
    if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; }
    else (p as any).setPosition(v.x, v.y, v.z);
  }

  private noiseSrc(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = loop;
    if (!loop) s.playbackRate.value = rr(0.9, 1.1);
    s.loopStart = Math.random(); s.loopEnd = s.loopStart + 0.9;
    return s;
  }

  private buildLoops() {
    const c = this.ctx;
    // crowd murmur (positioned on the crowd centroid)
    const n1 = this.noiseSrc(true);
    this.crowdFilter = c.createBiquadFilter(); this.crowdFilter.type = 'bandpass'; this.crowdFilter.frequency.value = 520; this.crowdFilter.Q.value = 0.7;
    this.crowdGain = c.createGain(); this.crowdGain.gain.value = 0;
    this.crowdPanner = this.panner(undefined, 12, 400);
    n1.connect(this.crowdFilter); this.crowdFilter.connect(this.crowdGain); this.crowdGain.connect(this.crowdPanner); this.crowdPanner.connect(this.amb);
    n1.start();
    // chatter band with slow random modulation
    const n2 = this.noiseSrc(true);
    const bp2 = c.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 1500; bp2.Q.value = 1.2;
    this.chatterGain = c.createGain(); this.chatterGain.gain.value = 0;
    const lfo = c.createOscillator(); lfo.frequency.value = 3.3; const lfoG = c.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(this.chatterGain.gain); lfo.start();
    n2.connect(bp2); bp2.connect(this.chatterGain); this.chatterGain.connect(this.crowdPanner);
    n2.start();
    // wind / city bed
    const n3 = this.noiseSrc(true);
    const lp3 = c.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 300;
    this.windGain = c.createGain(); this.windGain.gain.value = 0.05;
    n3.connect(lp3); lp3.connect(this.windGain); this.windGain.connect(this.amb); n3.start();
    // helicopter: low noise chopped by a square LFO
    const n4 = this.noiseSrc(true);
    const lp4 = c.createBiquadFilter(); lp4.type = 'lowpass'; lp4.frequency.value = 260;
    const chop = c.createGain(); chop.gain.value = 0.5;
    const rotor = c.createOscillator(); rotor.type = 'square'; rotor.frequency.value = 13; const rg = c.createGain(); rg.gain.value = 0.5;
    rotor.connect(rg); rg.connect(chop.gain); rotor.start();
    this.heliGain = c.createGain(); this.heliGain.gain.value = 0;
    this.heliPanner = this.panner(undefined, 30, 600);
    n4.connect(lp4); lp4.connect(chop); chop.connect(this.heliGain); this.heliGain.connect(this.heliPanner); this.heliPanner.connect(this.amb);
    n4.start();
    // water cannon jet
    const n5 = this.noiseSrc(true);
    const bp5 = c.createBiquadFilter(); bp5.type = 'bandpass'; bp5.frequency.value = 1100; bp5.Q.value = 0.4;
    this.waterGain = c.createGain(); this.waterGain.gain.value = 0;
    this.waterPanner = this.panner(undefined, 6, 250);
    n5.connect(bp5); bp5.connect(this.waterGain); this.waterGain.connect(this.waterPanner); this.waterPanner.connect(this.sfx);
    n5.start();
    // fire roar (nearest fire)
    const n6 = this.noiseSrc(true);
    const lp6 = c.createBiquadFilter(); lp6.type = 'lowpass'; lp6.frequency.value = 700;
    this.fireGain = c.createGain(); this.fireGain.gain.value = 0;
    this.firePanner = this.panner(undefined, 4, 120);
    n6.connect(lp6); lp6.connect(this.fireGain); this.fireGain.connect(this.firePanner); this.firePanner.connect(this.sfx);
    n6.start();
    // tinnitus
    const t = c.createOscillator(); t.frequency.value = 4200; t.type = 'sine';
    this.tinnitusGain = c.createGain(); this.tinnitusGain.gain.value = 0;
    t.connect(this.tinnitusGain); this.tinnitusGain.connect(this.master); t.start();
  }

  addSiren(pos: THREE.Vector3) {
    const c = this.ctx;
    const osc = c.createOscillator(); osc.type = 'square';
    osc.frequency.value = 435;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const gain = c.createGain(); gain.gain.value = 0;
    const panner = this.panner(pos, 8, 400);
    osc.connect(lp); lp.connect(gain); gain.connect(panner); panner.connect(this.amb);
    osc.start();
    // French two-tone "pin-pon"
    const now = c.currentTime;
    for (let i = 0; i < 2400; i++) osc.frequency.setValueAtTime(i % 2 ? 580 : 435, now + i * 0.6);
    this.sirens.push({ gain, panner, osc });
    return this.sirens.length - 1;
  }

  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); this.started = true; }
  setVolume(v: number) { this.volume = v; this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  // --------------------------------------------------------- one-shot plumbing
  private out(pos: Pos, vol: number, rev = 0.3, ref = 4): AudioNode | null {
    if (!this.started || this.voices >= this.maxVoices) return null;
    if (pos && pos.distanceTo(this.listenerPos) > 260) return null;
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (pos) {
      const p = this.panner(pos, ref);
      g.connect(p); p.connect(this.sfx);
      if (rev > 0) { const s = this.ctx.createGain(); s.gain.value = rev; p.connect(s); s.connect(this.revSend); }
    } else {
      g.connect(this.sfx);
      if (rev > 0) { const s = this.ctx.createGain(); s.gain.value = rev; g.connect(s); s.connect(this.revSend); }
    }
    this.voices++;
    setTimeout(() => { this.voices--; try { g.disconnect(); } catch { /* */ } }, 3500);
    return g;
  }

  private burst(dst: AudioNode, t0: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, attack = 0.002) {
    const c = this.ctx;
    const s = this.noiseSrc();
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dst);
    s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }

  private tone(dst: AudioNode, t0: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.003) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(f1, 10), t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dst); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  // --------------------------------------------------------- sounds
  impact(kind: 'stone' | 'metal' | 'glass' | 'body' | 'can' | 'wood', pos: THREE.Vector3, vol = 1) {
    const o = this.out(pos, vol, 0.15); if (!o) return;
    const t = this.ctx.currentTime;
    switch (kind) {
      case 'stone': this.burst(o, t, 0.12, 'bandpass', 900, 300, 1.2, 0.9); this.tone(o, t, 0.1, 'sine', 140, 60, 0.6); break;
      case 'metal': for (let i = 0; i < 3; i++) this.tone(o, t, 0.5, 'sine', rr(900, 2600), rr(800, 2400), 0.18); this.burst(o, t, 0.05, 'highpass', 3000, 2000, 1, 0.5); break;
      case 'can': for (let i = 0; i < 2; i++) this.tone(o, t, 0.25, 'triangle', rr(1400, 3200), rr(1300, 3000), 0.12); this.burst(o, t, 0.04, 'bandpass', 2500, 1800, 2, 0.4); break;
      case 'glass': this.glassInto(o, t, 0.6); break;
      case 'wood': this.burst(o, t, 0.1, 'bandpass', 500, 250, 2, 0.7); this.tone(o, t, 0.12, 'triangle', 220, 160, 0.3); break;
      case 'body': this.burst(o, t, 0.12, 'lowpass', 600, 120, 1, 0.9); this.tone(o, t, 0.12, 'sine', 90, 50, 0.6); break;
    }
  }

  private glassInto(o: AudioNode, t: number, size: number) {
    this.burst(o, t, 0.25 * size + 0.1, 'highpass', 2500, 5000, 0.7, 0.8);
    const n = Math.floor(10 + size * 20);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * (0.05 + size * 0.6);
      this.tone(o, tt, rr(0.05, 0.3), 'sine', rr(2500, 9000), rr(2000, 8000), rr(0.03, 0.12));
    }
  }

  glass(pos: THREE.Vector3, size = 1) {
    const o = this.out(pos, 1.0, 0.3); if (!o) return;
    this.glassInto(o, this.ctx.currentTime, size);
  }

  whoosh(pos: Pos = null, vol = 0.25) {
    const o = this.out(pos, vol, 0); if (!o) return;
    this.burst(o, this.ctx.currentTime, 0.25, 'bandpass', 600, 1800, 1.5, 0.8, 0.08);
  }

  explosion(pos: THREE.Vector3, size = 1) {
    const o = this.out(pos, 1.4 * size, 0.9, 8); if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, t, 0.04, 'highpass', 2000, 1000, 0.7, 1);
    this.burst(o, t, 1.4 * size, 'lowpass', 4000, 120, 0.7, 1.2, 0.004);
    this.tone(o, t, 0.6, 'sine', 90, 30, 1.2);
  }

  firework(pos: THREE.Vector3) {
    this.explosion(pos, 0.8);
    const o = this.out(pos, 0.5, 0.6); if (!o) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 14; i++) this.burst(o, t + 0.15 + Math.random() * 0.8, 0.04, 'highpass', 3000, 2000, 1, 0.5);
  }

  launch(pos: THREE.Vector3) { // mortar / rocket ignition
    const o = this.out(pos, 0.6, 0.3); if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, t, 0.6, 'bandpass', 3000, 900, 0.8, 0.6, 0.02);
    this.tone(o, t, 0.15, 'sine', 160, 70, 0.6);
  }

  shot(pos: THREE.Vector3, vol = 1) { // LBD
    const o = this.out(pos, vol, 0.8, 6); if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, t, 0.18, 'bandpass', 1400, 400, 0.9, 1.1);
    this.tone(o, t, 0.12, 'sine', 180, 60, 0.9);
  }

  thump(pos: THREE.Vector3, vol = 1) { // grenade launcher / throw of a heavy object
    const o = this.out(pos, vol, 0.6, 6); if (!o) return;
    const t = this.ctx.currentTime;
    this.tone(o, t, 0.2, 'sine', 110, 45, 1);
    this.burst(o, t, 0.15, 'lowpass', 900, 200, 1, 0.6);
  }

  hiss(pos: THREE.Vector3, dur = 2.5) {
    const o = this.out(pos, 0.35, 0.1); if (!o) return;
    this.burst(o, this.ctx.currentTime, dur, 'highpass', 3500, 2500, 0.6, 0.5, 0.05);
  }

  scream(pos: THREE.Vector3, intensity = 1, female = Math.random() < 0.45) {
    const o = this.out(pos, 0.45 * intensity, 0.35); if (!o) return;
    const c = this.ctx, t = c.currentTime;
    const base = female ? rr(380, 520) : rr(210, 320);
    const dur = rr(0.5, 1.2);
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.linearRampToValueAtTime(base * rr(1.4, 1.9), t + dur * 0.25);
    osc.frequency.linearRampToValueAtTime(base * rr(0.8, 1.1), t + dur);
    const vib = c.createOscillator(); vib.frequency.value = rr(5, 8); const vg = c.createGain(); vg.gain.value = base * 0.04;
    vib.connect(vg); vg.connect(osc.frequency);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = rr(800, 1000); f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = rr(1600, 2400); f2.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f1); osc.connect(f2); f1.connect(g); f2.connect(g); g.connect(o);
    osc.start(t); vib.start(t); osc.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }

  cough(pos: Pos, vol = 0.6) {
    const o = this.out(pos, vol, 0.1); if (!o) return;
    const t = this.ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.burst(o, t + i * rr(0.22, 0.35), rr(0.12, 0.2), 'bandpass', rr(500, 800), rr(250, 400), 1.5, 0.9, 0.01);
  }

  whistle(pos: THREE.Vector3) {
    const o = this.out(pos, 0.18, 0.4); if (!o) return;
    const t = this.ctx.currentTime;
    const f = rr(2600, 3300);
    const c = this.ctx;
    const osc = c.createOscillator(); osc.frequency.value = f;
    const trill = c.createOscillator(); trill.frequency.value = rr(25, 40); const tg = c.createGain(); tg.gain.value = 120;
    trill.connect(tg); tg.connect(osc.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    const dur = rr(0.3, 0.9);
    g.gain.setValueAtTime(0.5, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o); osc.start(t); trill.start(t); osc.stop(t + dur + 0.05); trill.stop(t + dur + 0.05);
  }

  baton(pos: THREE.Vector3, flesh = true) {
    const o = this.out(pos, 0.9, 0.2); if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, t, 0.1, flesh ? 'lowpass' : 'bandpass', flesh ? 900 : 1600, 150, 1, 1);
    this.tone(o, t, 0.08, 'sine', flesh ? 110 : 300, 60, 0.6);
  }

  shieldHit(pos: THREE.Vector3) {
    const o = this.out(pos, 0.8, 0.2); if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, t, 0.15, 'bandpass', 1100, 500, 2, 0.9);
    this.tone(o, t, 0.2, 'triangle', 420, 380, 0.25);
  }

  step(vol = 0.15, heavy = false) {
    const o = this.out(null, vol, 0); if (!o) return;
    this.burst(o, this.ctx.currentTime, heavy ? 0.12 : 0.08, 'lowpass', heavy ? 700 : 1200, 200, 1, 0.7);
  }

  click() {
    const o = this.out(null, 0.25, 0); if (!o) return;
    const t = this.ctx.currentTime;
    this.burst(o, t, 0.03, 'highpass', 3000, 2000, 1, 0.8);
    this.burst(o, t + 0.12, 0.04, 'bandpass', 1800, 1200, 2, 0.8);
  }

  pickup() {
    const o = this.out(null, 0.2, 0); if (!o) return;
    this.burst(o, this.ctx.currentTime, 0.1, 'bandpass', 700, 500, 1.5, 0.6);
  }

  hurt() {
    const o = this.out(null, 0.5, 0); if (!o) return;
    const t = this.ctx.currentTime;
    this.tone(o, t, 0.25, 'sawtooth', rr(160, 200), 110, 0.3, 0.01);
    this.burst(o, t, 0.12, 'lowpass', 500, 120, 1, 0.8);
  }

  bip() {
    const o = this.out(null, 0.25, 0.4); if (!o) return;
    const t = this.ctx.currentTime;
    this.tone(o, t, 0.25, 'square', 880, 880, 0.2, 0.01);
    this.tone(o, t + 0.3, 0.25, 'square', 660, 660, 0.2, 0.01);
  }

  tinnitus(seconds: number) {
    const c = this.ctx, t = c.currentTime;
    this.tinnitusGain.gain.cancelScheduledValues(t);
    this.tinnitusGain.gain.setValueAtTime(0.08, t);
    this.tinnitusGain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(380, t);
    this.muffle.frequency.exponentialRampToValueAtTime(20000, t + seconds);
  }

  /** Police loudspeaker: Web Speech API in French when available. */
  say(text: string, opts: { pitch?: number; rate?: number } = {}) {
    try {
      const s = window.speechSynthesis;
      if (!s) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'fr-FR';
      const v = s.getVoices().find((x) => x.lang.startsWith('fr'));
      if (v) u.voice = v;
      u.pitch = opts.pitch ?? 0.7; u.rate = opts.rate ?? 0.92; u.volume = this.volume;
      s.speak(u);
    } catch { /* not supported */ }
  }

  // --------------------------------------------------------- chants & drums
  private chant(pos: THREE.Vector3, loud: number) {
    const o = this.out(pos, 0.11 * loud, 0.5, 20); if (!o) return;
    const c = this.ctx, t0 = c.currentTime;
    // syllable rhythm patterns (beats in seconds) and vowels (formants)
    const patterns = [
      [0.3, 0.3, 0.3, 0.6, 0.3, 0.3, 0.3, 0.6],
      [0.25, 0.25, 0.5, 0.25, 0.25, 0.5],
      [0.45, 0.45, 0.45, 0.9],
    ];
    const vowels = [[730, 1090], [570, 840], [300, 2300], [440, 1020], [400, 1700]];
    const pat = pick(patterns);
    const voices = 8;
    let t = t0;
    for (const d of pat) {
      const [F1, F2] = pick(vowels);
      const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = F1; f1.Q.value = 5;
      const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = F2; f2.Q.value = 6;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1, t + 0.05);
      g.gain.setValueAtTime(1, t + d * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + d * 0.95);
      f1.connect(g); f2.connect(g); g.connect(o);
      for (let v = 0; v < voices; v++) {
        const osc = c.createOscillator(); osc.type = 'sawtooth';
        osc.frequency.value = (v % 2 ? rr(180, 260) : rr(110, 160)) * (d > 0.5 ? 0.92 : 1);
        osc.connect(f1); osc.connect(f2);
        osc.start(t + Math.random() * 0.04); osc.stop(t + d);
      }
      this.burst(o, t, d * 0.7, 'bandpass', 900, 700, 0.6, 0.4, 0.04);
      t += d;
    }
  }

  private drum(pos: THREE.Vector3, accent: boolean) {
    const o = this.out(pos, 0.35, 0.4, 15); if (!o) return;
    const t = this.ctx.currentTime;
    if (accent) this.tone(o, t, 0.35, 'sine', 120, 45, 1);
    else this.burst(o, t, 0.12, 'highpass', 1500, 1200, 0.8, 0.6);
  }

  // --------------------------------------------------------- per-frame
  update(dt: number, cam: THREE.Camera, s: {
    crowdPos: THREE.Vector3; crowdLevel: number; phase: number; tension: number;
    heliPos: THREE.Vector3 | null; water: THREE.Vector3 | null; fire: { pos: THREE.Vector3; level: number } | null;
    sirens: THREE.Vector3[]; sirensOn: boolean; lowHp: number;
  }) {
    if (!this.started) return;
    const c = this.ctx, t = c.currentTime;
    cam.getWorldPosition(this.listenerPos);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const L = c.listener;
    if (L.positionX) {
      L.positionX.value = this.listenerPos.x; L.positionY.value = this.listenerPos.y; L.positionZ.value = this.listenerPos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      (L as any).setPosition(this.listenerPos.x, this.listenerPos.y, this.listenerPos.z);
      (L as any).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
    this.setPannerPos(this.crowdPanner, s.crowdPos);
    const lvl = clamp(s.crowdLevel, 0, 1);
    this.crowdGain.gain.setTargetAtTime(0.25 * lvl * (1 + s.phase * 0.5), t, 0.5);
    this.chatterGain.gain.setTargetAtTime(0.05 * lvl * (1 + s.phase), t, 0.5);
    this.crowdFilter.frequency.setTargetAtTime(500 + s.phase * 250, t, 1);

    if (s.heliPos) { this.setPannerPos(this.heliPanner, s.heliPos); this.heliGain.gain.setTargetAtTime(0.6, t, 2); }
    else this.heliGain.gain.setTargetAtTime(0, t, 2);
    if (s.water) { this.setPannerPos(this.waterPanner, s.water); this.waterGain.gain.setTargetAtTime(0.7, t, 0.08); }
    else this.waterGain.gain.setTargetAtTime(0, t, 0.15);
    if (s.fire) { this.setPannerPos(this.firePanner, s.fire.pos); this.fireGain.gain.setTargetAtTime(0.5 * clamp(s.fire.level, 0, 2), t, 0.3); }
    else this.fireGain.gain.setTargetAtTime(0, t, 0.3);
    this.sirens.forEach((si, i) => {
      if (s.sirens[i]) this.setPannerPos(si.panner, s.sirens[i]);
      si.gain.gain.setTargetAtTime(s.sirensOn ? 0.09 : 0, t, 0.5);
    });

    // chants and drums while the march is peaceful, whistles all the time
    this.nextChant -= dt; this.nextDrum -= dt; this.nextWhistle -= dt;
    if (lvl > 0.05 && this.nextChant <= 0 && s.phase < 2) {
      this.chant(s.crowdPos, lvl); this.nextChant = rr(5, 10);
    }
    if (lvl > 0.05 && s.phase === 0 && this.nextDrum <= 0) {
      this.drum(s.crowdPos, this.drumBeat % 4 === 0 || this.drumBeat % 8 === 3);
      this.drumBeat++; this.nextDrum = 0.24;
    }
    if (lvl > 0.05 && this.nextWhistle <= 0) {
      this.whistle(s.crowdPos.clone().add(new THREE.Vector3(rr(-8, 8), 1.5, rr(-10, 10))));
      this.nextWhistle = rr(0.6, 3) / (1 + s.phase);
    }
    // heartbeat when badly hurt
    if (s.lowHp > 0.3) {
      this.nextHeart -= dt;
      if (this.nextHeart <= 0) {
        const o = this.out(null, 0.5 * s.lowHp, 0);
        if (o) { this.tone(o, t, 0.12, 'sine', 70, 40, 1); this.tone(o, t + 0.22, 0.12, 'sine', 60, 35, 0.8); }
        this.nextHeart = 0.9 - s.lowHp * 0.3;
      }
    }
  }
}
