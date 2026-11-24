import { clamp } from './storage.js';

/** Moteur audio : sons guidés uniquement (nappe harmonique, gongs, carillons). */
export class AudioEngine {
  constructor(getPreferences) {
    this.getPreferences = getPreferences;
    this.context = null;
    this.guided = null;
    this.generation = 0;
  }

  async #ensureContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContextClass();
    }
    if (this.context.state !== 'running') {
      try { await this.context.resume(); } catch { /* reprise refusée */ }
    }
    return this.context;
  }

  #teardown(session) {
    if (!session) return;
    const context = this.context;
    const now = context ? context.currentTime : 0;
    const fade = context && context.state === 'running';
    if (fade && session.output) {
      session.output.gain.cancelScheduledValues(now);
      session.output.gain.setValueAtTime(session.output.gain.value, now);
      session.output.gain.linearRampToValueAtTime(0, now + 0.3);
      for (const source of session.sources) {
        try { source.stop(now + 0.4); } catch { /* déjà arrêtée */ }
      }
      setTimeout(() => {
        try { session.output.disconnect(); } catch { /* déjà déconnectée */ }
      }, 500);
    } else {
      try { session.output?.disconnect(); } catch { /* déjà déconnectée */ }
      for (const source of session.sources) {
        try { source.stop(); } catch { /* déjà arrêtée */ }
      }
    }
  }

  async start() {
    const generation = ++this.generation;
    const prefs = this.getPreferences();
    if (!prefs.enabled) {
      this.#teardown(this.guided);
      this.guided = null;
      return;
    }
    const context = await this.#ensureContext();
    if (!context || generation !== this.generation) return;
    try {
      this.#teardown(this.guided);
      const output = context.createGain();
      const volume = context.createGain();
      volume.gain.value = 0;
      volume.connect(output);
      output.connect(context.destination);
      output.gain.setValueAtTime(0, context.currentTime);
      output.gain.linearRampToValueAtTime(1, context.currentTime + 0.25);
      volume.gain.setValueAtTime(clamp(prefs.volume, 0, 150) / 100, context.currentTime);
      const session = { output, volume, sources: [], mode: prefs.mode };
      if (prefs.mode === 'pad') {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'sine'; osc.frequency.value = 174; gain.gain.value = 0;
        osc.connect(gain); gain.connect(volume);
        osc.start();
        gain.gain.setTargetAtTime(0.12, context.currentTime, 0.12);
        session.sources.push(osc);
        session.pad = { osc, gain };
      }
      this.guided = session;
    } catch (error) {
      console.warn("EducRespi : sons guidés indisponibles.", error);
      this.#teardown(this.guided);
      this.guided = null;
    }
  }

  stop() {
    this.generation++;
    this.#teardown(this.guided);
    this.guided = null;
  }

  /** Renvoie true si un son de transition a effectivement été déclenché. */
  transition(type) {
    const session = this.guided;
    if (!session || !['gong', 'chime'].includes(session.mode) || !this.context) return false;
    const frequencies = session.mode === 'chime'
      ? { inhale: 784, holdFull: 988, exhale: 659, holdEmpty: 523 }
      : { inhale: 396, holdFull: 432, exhale: 285, holdEmpty: 256 };
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequencies[type] || 330, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(session.mode === 'chime' ? 0.09 : 0.16, now + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (session.mode === 'chime' ? 2.8 : 1.8));
    osc.connect(gain); gain.connect(session.volume);
    osc.start(); osc.stop(now + (session.mode === 'chime' ? 2.9 : 1.9));
    return true;
  }

  update(type, progress) {
    const session = this.guided;
    if (!session?.pad || !this.context) return;
    const ease = clamp(progress, 0, 1);
    const frequency = type === 'inhale' ? 174 + 87 * ease :
      type === 'holdFull' ? 261 : type === 'exhale' ? 261 - 87 * ease : 174;
    session.pad.osc.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.04);
  }

  setVolume(value) {
    if (this.guided && this.context) {
      this.guided.volume.gain.setTargetAtTime(clamp(value, 0, 150) / 100, this.context.currentTime, 0.03);
    }
  }
}
