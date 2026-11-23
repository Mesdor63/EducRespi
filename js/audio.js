import { clamp } from './storage.js';

export class AudioEngine {
  constructor(getPreferences) {
    this.getPreferences = getPreferences;
    this.context = null;
    this.active = null;
    this.waveBuffer = null;
    this.generation = 0;
  }
  async start() {
    const generation = ++this.generation;
    const prefs = this.getPreferences();
    if (!prefs.enabled) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      if (!this.context || this.context.state === 'closed') {
        this.context = new AudioContextClass();
        this.waveBuffer = null;
      }
      if (this.context.state !== 'running') await this.context.resume();
      // Si la séance a été arrêtée pendant la reprise du contexte audio,
      // ne pas créer une nouvelle ambiance sonore après coup.
      if (generation !== this.generation) return;
      const output = this.context.createGain();
      const volume = this.context.createGain();
      volume.gain.value = clamp(prefs.volume, 0, 100) / 100;
      volume.connect(output);
      output.connect(this.context.destination);
      const session = { output, volume, sources: new Set(), mode: prefs.mode, closed: false };
      this.active = session;
      if (prefs.mode === 'pad') this.#startPad(session);
      if (prefs.mode === 'wave') this.#startWave(session);
    } catch (error) {
      console.warn('EducRespi : audio indisponible.', error);
      this.stop();
    }
  }
  #register(session, source, nodes = []) {
    session.sources.add(source);
    source.addEventListener('ended', () => {
      try { source.disconnect(); } catch {}
      nodes.forEach(node => { try { node.disconnect(); } catch {} });
      session.sources.delete(source);
      if (session.closed && session.sources.size === 0) {
        try { session.output.disconnect(); } catch {}
      }
    }, { once: true });
  }
  #startPad(session) {
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = 'sine'; osc.frequency.value = 174; gain.gain.value = 0;
    osc.connect(gain); gain.connect(session.volume);
    session.pad = osc;
    this.#register(session, osc, [gain]);
    osc.start();
    gain.gain.setTargetAtTime(0.12, this.context.currentTime, 0.12);
  }
  #startWave(session) {
    if (!this.waveBuffer) {
      const length = this.context.sampleRate * 2;
      this.waveBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
      const data = this.waveBuffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.02 * white) / 1.02;
        last = data[i];
        data[i] *= 2.5;
      }
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.waveBuffer; source.loop = true;
    filter.type = 'lowpass'; filter.frequency.value = 180; gain.gain.value = 0;
    source.connect(filter); filter.connect(gain); gain.connect(session.volume);
    session.waveFilter = filter; session.waveGain = gain;
    this.#register(session, source, [filter, gain]);
    source.start();
  }
  transition(type) {
    const session = this.active;
    if (!session || session.mode !== 'gong' || !this.context) return;
    const frequencies = { inhale: 396, holdFull: 432, exhale: 285, holdEmpty: 256 };
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequencies[type] || 330, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.8);
    osc.connect(gain); gain.connect(session.volume);
    this.#register(session, osc, [gain]);
    osc.start(); osc.stop(now + 1.9);
  }
  update(type, progress) {
    const session = this.active;
    if (!session || !this.context) return;
    const ease = clamp(progress, 0, 1);
    if (session.pad) {
      const frequency = type === 'inhale' ? 174 + 87 * ease :
        type === 'holdFull' ? 261 : type === 'exhale' ? 261 - 87 * ease : 174;
      session.pad.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.04);
    }
    if (session.waveFilter && session.waveGain) {
      const frequency = type === 'inhale' ? 160 + 480 * ease :
        type === 'holdFull' ? 640 : type === 'exhale' ? 640 - 480 * ease : 160;
      const volume = type === 'inhale' ? 0.04 + 0.22 * ease :
        type === 'holdFull' ? 0.26 : type === 'exhale' ? 0.26 - 0.22 * ease : 0.04;
      session.waveFilter.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.05);
      session.waveGain.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
    }
  }
  setVolume(value) {
    if (this.active && this.context) {
      this.active.volume.gain.setTargetAtTime(clamp(value, 0, 100) / 100, this.context.currentTime, 0.03);
    }
  }
  stop() {
    this.generation++;
    const session = this.active;
    if (!session || !this.context) return;
    this.active = null;
    session.closed = true;
    const now = this.context.currentTime;
    const fade = this.context.state === 'running' && session.sources.size > 0;
    const cutoff = now + (fade ? 0.04 : 0);
    if (fade) {
      session.output.gain.setValueAtTime(session.output.gain.value, now);
      session.output.gain.linearRampToValueAtTime(0, cutoff);
    } else {
      try { session.output.disconnect(); } catch {}
    }
    for (const source of session.sources) {
      try { source.stop(cutoff); } catch {}
    }
  }
}
