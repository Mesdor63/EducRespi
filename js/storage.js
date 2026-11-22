export const STORAGE_KEYS = Object.freeze({
  presets: 'mareduc_presets_v3',
  settings: 'mareduc_last_settings_v3',
  audio: 'mareduc_audio_v3'
});
export const LIMITS = Object.freeze({ presets: 10, phase: 60, duration: 120 });

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function numberOr(value, fallback, allowZero = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return fallback;
  return n;
}
export function normalizeSettings(input = {}) {
  return {
    inhale: clamp(numberOr(input.inhale, 5), 1, LIMITS.phase),
    holdFull: clamp(numberOr(input.holdFull, 0, true), 0, LIMITS.phase),
    exhale: clamp(numberOr(input.exhale, 5), 1, LIMITS.phase),
    holdEmpty: clamp(numberOr(input.holdEmpty, 0, true), 0, LIMITS.phase),
    duration: clamp(numberOr(input.duration, 5), 1, LIMITS.duration)
  };
}
function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}
export function loadSettings() {
  let raw = readJSON(STORAGE_KEYS.settings, null);
  if (raw === null) {
    // Migration douce depuis les clés utilisées par les versions précédentes.
    const legacy = readJSON('mareduc_last_settings', null);
    if (legacy && typeof legacy === 'object') {
      raw = { inhale: legacy.i, holdFull: legacy.h1, exhale: legacy.e,
        holdEmpty: legacy.h2, duration: legacy.dur };
      const migrated = normalizeSettings(raw);
      saveSettings(migrated);
      return migrated;
    }
  }
  return raw && typeof raw === 'object' ? normalizeSettings(raw) : null;
}
export function saveSettings(settings) {
  return writeJSON(STORAGE_KEYS.settings, normalizeSettings(settings));
}
export function loadAudioPreferences() {
  let raw = readJSON(STORAGE_KEYS.audio, null);
  if (raw === null) {
    const legacy = readJSON('mareduc_audio', null);
    if (legacy && typeof legacy === 'object') {
      raw = { volume: legacy.volume, enabled: legacy.on, mode: legacy.type };
      const migrated = {
        volume: clamp(numberOr(raw.volume, 70, true), 0, 100),
        enabled: raw.enabled !== false,
        mode: ['pad', 'gong', 'wave'].includes(raw.mode) ? raw.mode : 'pad'
      };
      saveAudioPreferences(migrated);
      return migrated;
    }
  }
  return {
    volume: clamp(numberOr(raw?.volume, 70, true), 0, 100),
    enabled: raw?.enabled !== false,
    mode: ['pad', 'gong', 'wave'].includes(raw?.mode) ? raw.mode : 'pad'
  };
}
export function saveAudioPreferences(prefs) {
  return writeJSON(STORAGE_KEYS.audio, {
    volume: clamp(numberOr(prefs.volume, 70, true), 0, 100),
    enabled: prefs.enabled !== false,
    mode: ['pad', 'gong', 'wave'].includes(prefs.mode) ? prefs.mode : 'pad'
  });
}
export function loadPresets() {
  let raw = readJSON(STORAGE_KEYS.presets, null);
  if (raw === null) {
    const legacy = readJSON('mareduc_presets', []);
    if (Array.isArray(legacy)) {
      raw = legacy.map(item => item && ({
        name: item.name, inhale: item.i, holdFull: item.h1,
        exhale: item.e, holdEmpty: item.h2, duration: item.dur
      }));
    } else raw = [];
  }
  if (!Array.isArray(raw)) return [];
  const migrated = raw.filter(item => item && typeof item.name === 'string' &&
    ['inhale', 'holdFull', 'exhale', 'holdEmpty', 'duration'].every(k => Number.isFinite(Number(item[k]))))
    .slice(0, LIMITS.presets)
    .map(item => ({ name: item.name.trim().slice(0, 25), ...normalizeSettings(item) }))
    .filter(item => item.name.length > 0);
  // Enregistre au nouveau format ; les données historiques ne sont pas effacées.
  if (localStorage.getItem(STORAGE_KEYS.presets) === null && migrated.length) savePresets(migrated);
  return migrated;
}
export function savePresets(presets) {
  return writeJSON(STORAGE_KEYS.presets, presets.slice(0, LIMITS.presets));
}
