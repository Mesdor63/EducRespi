import {
  LIMITS, normalizeSettings, loadSettings, saveSettings,
  loadAudioPreferences, saveAudioPreferences, loadPresets, savePresets
} from './storage.js';
import { createPhases, formatTime } from './breathing.js';
import { AudioEngine } from './audio.js';
import { ScreenWakeLock } from './wake-lock.js';

const $ = id => document.getElementById(id);
const el = {
  bubble: $('bubble'), label: $('phase-label'), timer: $('phase-timer'), cycle: $('cycle-count'),
  remaining: $('remaining'), start: $('start'), pause: $('pause'), stop: $('stop'),
  duration: $('duration'), volume: $('volume'), soundEnabled: $('sound-enabled'),
  soundMode: $('sound-mode'), presetName: $('preset-name'), savePreset: $('save-preset'),
  presetStatus: $('preset-status'), presetList: $('preset-list')
};
const settingIds = {
  inhale: 'inhale', holdFull: 'hold-full', exhale: 'exhale',
  holdEmpty: 'hold-empty', duration: 'duration'
};
let state = {
  running: false, paused: false, raf: null, endAt: 0, phaseStartedAt: 0,
  phaseIndex: 0, lastPhaseIndex: -1, cycles: 0, pausedAt: 0, phases: []
};
let audioPrefs = loadAudioPreferences();
let presets = loadPresets();
const audio = new AudioEngine(() => audioPrefs);
const wakeLock = new ScreenWakeLock();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function getSettings() {
  const values = {};
  for (const [key, id] of Object.entries(settingIds)) values[key] = $(id).value;
  return normalizeSettings(values);
}
function putSettings(settings) {
  const safe = normalizeSettings(settings);
  for (const [key, id] of Object.entries(settingIds)) $(id).value = safe[key];
  updatePreview();
}
function updatePreview() {
  if (!state.running) el.remaining.textContent = `Temps restant : ${formatTime(getSettings().duration * 60)}`;
}
function setPhaseText(text) {
  if (el.label.textContent !== text) el.label.textContent = text;
}
function setControls(mode) {
  el.start.hidden = mode !== 'idle';
  el.pause.hidden = mode !== 'running' && mode !== 'paused';
  el.stop.hidden = mode === 'idle';
  el.pause.textContent = mode === 'paused' ? 'Reprendre' : 'Pause';
  el.pause.setAttribute('aria-label', mode === 'paused' ? 'Reprendre la séance' : 'Mettre en pause');
}
function resetVisual(message = 'Prêt') {
  el.bubble.classList.remove('hold-full', 'hold-empty');
  el.bubble.style.transform = 'scale(1)';
  setPhaseText(message);
  el.timer.textContent = '0.0';
  el.cycle.textContent = 'Cycle 0';
  document.title = 'EducRespi';
}
function isSessionActive() { return state.running && !state.paused; }

async function stopSession(message = 'Prêt', completed = false) {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.raf);
  state.raf = null;
  audio.stop();
  navigator.vibrate?.(0);
  await wakeLock.release();
  document.body.classList.remove('active');
  setControls('idle');
  resetVisual(message);
  if (completed) el.remaining.textContent = 'Temps restant : 00:00';
  else updatePreview();
  if (!document.hidden) el.start.focus({ preventScroll: true });
}
function pauseSession() {
  if (!state.running || state.paused) return;
  state.paused = true;
  state.pausedAt = performance.now();
  cancelAnimationFrame(state.raf);
  state.raf = null;
  audio.stop();
  navigator.vibrate?.(0);
  void wakeLock.release();
  setControls('paused');
  setPhaseText('Pause');
  document.title = 'EducRespi';
}
async function resumeSession() {
  if (!state.running || !state.paused) return;
  const pausedFor = performance.now() - state.pausedAt;
  state.endAt += pausedFor;
  state.phaseStartedAt += pausedFor;
  state.paused = false;
  setControls('running');
  await audio.start();
  void wakeLock.acquire(isSessionActive);
  state.raf = requestAnimationFrame(tick);
}
async function startSession() {
  if (state.running) return;
  const settings = getSettings();
  const phases = createPhases(settings);
  if (!phases.length) {
    el.presetStatus.textContent = 'Impossible de démarrer : aucune phase valide.';
    return;
  }
  putSettings(settings);
  saveSettings(settings);
  state.running = true;
  state.paused = false;
  state.phases = phases;
  state.phaseIndex = 0;
  state.lastPhaseIndex = -1;
  state.cycles = 1;
  const now = performance.now();
  state.endAt = now + settings.duration * 60000;
  state.phaseStartedAt = now;
  document.body.classList.add('active');
  setControls('running');
  el.pause.focus({ preventScroll: true });
  void audio.start();
  void wakeLock.acquire(isSessionActive);
  el.cycle.textContent = 'Cycle 1';
  state.raf = requestAnimationFrame(tick);
}
function tick(timestamp) {
  if (!state.running || state.paused) return;
  const remaining = state.endAt - timestamp;
  if (remaining <= 0) {
    void stopSession('Terminé !', true);
    return;
  }
  el.remaining.textContent = `Temps restant : ${formatTime(remaining / 1000)}`;

  let phase = state.phases[state.phaseIndex];
  let elapsed = Math.max(0, (timestamp - state.phaseStartedAt) / 1000);
  // Rattrape les phases si le navigateur a suspendu ou retardé les animations.
  let guard = 0;
  while (elapsed >= phase.duration && guard++ < 1000) {
    elapsed -= phase.duration;
    state.phaseStartedAt += phase.duration * 1000;
    state.phaseIndex = (state.phaseIndex + 1) % state.phases.length;
    phase = state.phases[state.phaseIndex];
    if (state.phaseIndex === 0) {
      state.cycles++;
      el.cycle.textContent = `Cycle ${state.cycles}`;
    }
  }
  if (state.phaseIndex !== state.lastPhaseIndex) {
    state.lastPhaseIndex = state.phaseIndex;
    audio.transition(phase.key);
    navigator.vibrate?.(35);
    document.title = `EducRespi — ${phase.label} · cycle ${state.cycles}`;
  }
  const progress = Math.min(elapsed / phase.duration, 1);
  const ease = (1 - Math.cos(Math.PI * progress)) / 2;
  let scale = 1;
  if (phase.key === 'inhale') scale = 1 + 1.5 * ease;
  else if (phase.key === 'holdFull') scale = 2.5;
  else if (phase.key === 'exhale') scale = 2.5 - 1.5 * ease;

  el.bubble.classList.toggle('hold-full', phase.key === 'holdFull');
  el.bubble.classList.toggle('hold-empty', phase.key === 'holdEmpty');
  el.bubble.style.transform = reducedMotion.matches ? 'scale(1)' : `scale(${scale})`;
  setPhaseText(phase.label);
  el.timer.textContent = (phase.duration - elapsed).toFixed(1);
  audio.update(phase.key, ease);
  state.raf = requestAnimationFrame(tick);
}

function renderPresets() {
  el.presetList.replaceChildren();
  presets.forEach((preset, index) => {
    const li = document.createElement('li');
    li.className = 'preset-item';
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'preset-load';
    load.textContent = `${index + 1}. ${preset.name} (${preset.inhale}-${preset.holdFull}-${preset.exhale}-${preset.holdEmpty} | ${preset.duration} min)`;
    load.addEventListener('click', () => { if (!state.running) putSettings(preset); });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'preset-delete';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Supprimer ${preset.name}`);
    remove.addEventListener('click', () => {
      if (state.running) return;
      const next = presets.filter((_, i) => i !== index);
      if (savePresets(next)) { presets = next; renderPresets(); (el.presetList.querySelector('.preset-load') || el.presetName).focus(); }
      else el.presetStatus.textContent = 'Suppression impossible : stockage local indisponible.';
    });
    li.append(load, remove);
    el.presetList.append(li);
  });
  el.savePreset.textContent = `Enregistrer (${presets.length}/${LIMITS.presets})`;
  el.savePreset.disabled = presets.length >= LIMITS.presets;
}
el.savePreset.addEventListener('click', () => {
  if (state.running || presets.length >= LIMITS.presets) return;
  const name = el.presetName.value.trim() || `Séance ${presets.length + 1}`;
  const next = [...presets, { name: name.slice(0, 25), ...getSettings() }];
  if (!savePresets(next)) {
    el.presetStatus.textContent = 'Enregistrement impossible : stockage local indisponible.';
    return;
  }
  presets = next;
  el.presetName.value = '';
  el.presetStatus.textContent = '';
  renderPresets();
});
for (const id of Object.values(settingIds)) $(id).addEventListener('input', updatePreview);

function persistAudioPreferences() {
  audioPrefs = {
    volume: Number(el.volume.value),
    enabled: el.soundEnabled.checked,
    mode: el.soundMode.value
  };
  if (!saveAudioPreferences(audioPrefs)) {
    el.presetStatus.textContent = 'Préférences audio non mémorisées (stockage indisponible).';
  }
  audio.setVolume(audioPrefs.volume);
}
el.volume.value = audioPrefs.volume;
el.soundEnabled.checked = audioPrefs.enabled;
el.soundMode.value = audioPrefs.mode;
el.soundMode.disabled = !audioPrefs.enabled;
el.volume.addEventListener('input', persistAudioPreferences);
el.soundEnabled.addEventListener('change', () => {
  el.soundMode.disabled = !el.soundEnabled.checked;
  persistAudioPreferences();
});
el.soundMode.addEventListener('change', persistAudioPreferences);

el.start.addEventListener('click', () => void startSession());
el.pause.addEventListener('click', () => {
  if (state.paused) void resumeSession();
  else pauseSession();
});
el.stop.addEventListener('click', () => void stopSession());
document.addEventListener('keydown', event => {
  const target = event.target;
  const tag = target?.tagName;
  const isInteractive = target?.isContentEditable ||
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(tag);
  if (isInteractive || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (state.running) state.paused ? void resumeSession() : pauseSession();
    else void startSession();
  } else if (event.code === 'Escape' && state.running) {
    void stopSession();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running && !state.paused) pauseSession();
});
window.addEventListener('pagehide', () => {
  audio.stop();
  void wakeLock.release();
});
reducedMotion.addEventListener?.('change', () => {
  if (reducedMotion.matches) el.bubble.style.transform = 'scale(1)';
});

renderPresets();
const previous = loadSettings();
if (previous) putSettings(previous);
else updatePreview();
setControls('idle');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .catch(error => console.warn('EducRespi : mode hors ligne indisponible.', error));
  }, { once: true });
}
