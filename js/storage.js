/* ------------------------------------------------------------------
 * Stockage local d'EducRespi (v1.4) — un profil de données par utilisateur.
 *
 *   educrespi_users_v1          → { currentId, users: [{ id, name }] }
 *   educrespi_user_<id>_v1      → { settings, audio, presets, history }
 *
 * Au premier lancement, les données des versions précédentes (clés
 * « mareduc_* » et « educrespi_history_v1 ») sont copiées dans un premier
 * utilisateur. Les anciennes clés ne sont pas supprimées (retour arrière possible),
 * sauf celle de l'ambiance sonore, supprimée de l'application.
 * ------------------------------------------------------------------ */
export const STORAGE_KEYS = Object.freeze({
  users: 'educrespi_users_v1',
  userPrefix: 'educrespi_user_',
  userSuffix: '_v1',
  // Anciennes clés, lues uniquement pour la migration
  legacyPresets: 'mareduc_presets_v3',
  legacySettings: 'mareduc_last_settings_v3',
  legacyAudio: 'mareduc_audio_v3',
  legacyHistory: 'educrespi_history_v1',
  obsoleteAmbient: 'educrespi_ambient_v1'
});
export const LIMITS = Object.freeze({
  users: 20, presets: 50, history: 200, phase: 60, duration: 120, name: 25
});
export const DEFAULT_SETTINGS = Object.freeze({ inhale: 5, holdFull: 0, exhale: 5, holdEmpty: 0, duration: 5 });
export const DEFAULT_AUDIO = Object.freeze({ volume: 90, enabled: true, mode: 'pad' });
const GUIDED_MODES = ['pad', 'gong', 'chime'];
const SETTING_KEYS = ['inhale', 'holdFull', 'exhale', 'holdEmpty', 'duration'];

/* ---------- Utilitaires ---------- */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function halfStep(value) {
  return Math.round(Number(value) * 2) / 2;
}
function numberOr(value, fallback, allowZero = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return fallback;
  return n;
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
function removeKey(key) {
  try { localStorage.removeItem(key); } catch { /* stockage bloqué */ }
}

/* ---------- Validation des données ---------- */

export function normalizeSettings(input = {}) {
  return {
    inhale: clamp(halfStep(numberOr(input.inhale, 5)), 1, LIMITS.phase),
    holdFull: clamp(halfStep(numberOr(input.holdFull, 0, true)), 0, LIMITS.phase),
    exhale: clamp(halfStep(numberOr(input.exhale, 5)), 1, LIMITS.phase),
    holdEmpty: clamp(halfStep(numberOr(input.holdEmpty, 0, true)), 0, LIMITS.phase),
    duration: clamp(numberOr(input.duration, 5), 1, LIMITS.duration)
  };
}
export function sanitizeAudio(raw) {
  return {
    volume: clamp(numberOr(raw?.volume, DEFAULT_AUDIO.volume, true), 0, 150),
    enabled: raw?.enabled !== false,
    mode: GUIDED_MODES.includes(raw?.mode) ? raw.mode : DEFAULT_AUDIO.mode
  };
}
export function sanitizePresets(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(item => item && typeof item.name === 'string' &&
      SETTING_KEYS.every(k => Number.isFinite(Number(item[k]))))
    .slice(0, LIMITS.presets)
    .map(item => ({ name: sanitizeUserName(item.name), ...normalizeSettings(item) }))
    .filter(item => item.name.length > 0);
}
export function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const entries = [];
  for (const item of raw) {
    if (!item || typeof item.date !== 'string' || Number.isNaN(new Date(item.date).getTime())) continue;
    const duration = Number(item.duration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    const cycles = Number(item.cycles);
    const entry = {
      date: item.date,
      duration: Math.min(duration, 1440),
      cycles: Number.isFinite(cycles) && cycles >= 0 ? Math.floor(cycles) : 0
    };
    // Rythme utilisé (« inspiration-suspension-expiration-suspension »), facultatif.
    if (typeof item.pattern === 'string' && /^\d+(\.\d)?(-\d+(\.\d)?){3}$/.test(item.pattern)) {
      entry.pattern = item.pattern;
    }
    entries.push(entry);
    if (entries.length >= LIMITS.history) break;
  }
  return entries;
}
export function sanitizeUserName(name) {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name);
}
export function sanitizeId(id) {
  return typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id) ? id : null;
}
export function defaultUserData() {
  return { settings: null, audio: { ...DEFAULT_AUDIO }, presets: [], history: [] };
}
export function sanitizeUserData(raw) {
  return {
    settings: raw?.settings && typeof raw.settings === 'object' ? normalizeSettings(raw.settings) : null,
    audio: sanitizeAudio(raw?.audio),
    presets: sanitizePresets(raw?.presets),
    history: sanitizeHistory(raw?.history)
  };
}
export function createUserId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
/** Génère un nom unique (comparaison insensible à la casse) : « Marie », « Marie (2) », … */
export function uniqueName(base, users, excludeId = null) {
  const taken = new Set(users.filter(u => u.id !== excludeId).map(u => u.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = ` (${i})`;
    const candidate = base.slice(0, LIMITS.name - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}

/* ---------- Index des utilisateurs ---------- */

export function loadUsersIndex() {
  const raw = readJSON(STORAGE_KEYS.users, null);
  if (!raw || !Array.isArray(raw.users)) return null;
  const seen = new Set();
  const users = [];
  for (const item of raw.users) {
    const id = sanitizeId(item?.id);
    const name = sanitizeUserName(item?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    users.push({ id, name });
    if (users.length >= LIMITS.users) break;
  }
  if (!users.length) return null;
  return { currentId: seen.has(raw.currentId) ? raw.currentId : users[0].id, users };
}
export function saveUsersIndex(index) {
  return writeJSON(STORAGE_KEYS.users, { currentId: index.currentId, users: index.users });
}

/* ---------- Données d'un utilisateur ---------- */

function userKey(id) {
  return `${STORAGE_KEYS.userPrefix}${id}${STORAGE_KEYS.userSuffix}`;
}
export function loadUserData(id) {
  return sanitizeUserData(readJSON(userKey(id), null));
}
export function saveUserData(id, data) {
  return writeJSON(userKey(id), {
    settings: data.settings ? normalizeSettings(data.settings) : null,
    audio: sanitizeAudio(data.audio),
    presets: data.presets.slice(0, LIMITS.presets),
    history: data.history.slice(0, LIMITS.history)
  });
}
export function removeUserData(id) {
  removeKey(userKey(id));
}
export function removeObsoleteKeys() {
  removeKey(STORAGE_KEYS.obsoleteAmbient);
}

/* ---------- Migration des versions précédentes ---------- */

function loadLegacyUserData() {
  // Réglages
  let rawSettings = readJSON(STORAGE_KEYS.legacySettings, null);
  if (rawSettings === null) {
    const old = readJSON('mareduc_last_settings', null);
    if (old && typeof old === 'object') {
      rawSettings = { inhale: old.i, holdFull: old.h1, exhale: old.e, holdEmpty: old.h2, duration: old.dur };
    }
  }
  // Son
  let rawAudio = readJSON(STORAGE_KEYS.legacyAudio, null);
  if (rawAudio === null) {
    const old = readJSON('mareduc_audio', null);
    if (old && typeof old === 'object') rawAudio = { volume: old.volume, enabled: old.on, mode: old.type };
  }
  // Séances enregistrées
  let rawPresets = readJSON(STORAGE_KEYS.legacyPresets, null);
  if (rawPresets === null) {
    const old = readJSON('mareduc_presets', []);
    rawPresets = Array.isArray(old)
      ? old.map(item => item && ({
        name: item.name, inhale: item.i, holdFull: item.h1, exhale: item.e, holdEmpty: item.h2, duration: item.dur
      }))
      : [];
  }
  return sanitizeUserData({
    settings: rawSettings && typeof rawSettings === 'object' ? rawSettings : null,
    audio: rawAudio,
    presets: rawPresets,
    history: readJSON(STORAGE_KEYS.legacyHistory, [])
  });
}

/**
 * Charge l'index des utilisateurs ; au tout premier lancement, crée « Utilisateur 1 »
 * et y reprend les données des versions précédentes.
 */
export function initUsers() {
  const existing = loadUsersIndex();
  if (existing) return { index: existing, data: loadUserData(existing.currentId), migrated: false };
  const id = createUserId();
  const index = { currentId: id, users: [{ id, name: 'Utilisateur 1' }] };
  const data = loadLegacyUserData();
  saveUserData(id, data);
  saveUsersIndex(index);
  return { index, data, migrated: true };
}

/* ---------- Sauvegarde (import) ---------- */

/**
 * Analyse un fichier de sauvegarde. Formats acceptés :
 *  - v3 (≥ 1.4) : { app, formatVersion: 3, users: [{ id, name, settings, audio, presets, history }] }
 *  - v2 (≤ 1.3) : { app, formatVersion: 2, presets, history } → données d'un seul utilisateur
 */
export function parseBackup(data) {
  if (!data || typeof data !== 'object' || data.app !== 'EducRespi') throw new Error('Format invalide');
  if (Array.isArray(data.users)) {
    const users = data.users.slice(0, LIMITS.users).map(item => {
      const name = sanitizeUserName(item?.name);
      return name ? { id: sanitizeId(item.id), name, data: sanitizeUserData(item) } : null;
    }).filter(Boolean);
    if (!users.length) throw new Error('Aucun utilisateur valide');
    return { kind: 'users', users };
  }
  if (Array.isArray(data.presets)) {
    return {
      kind: 'single',
      presets: sanitizePresets(data.presets),
      history: Array.isArray(data.history) ? sanitizeHistory(data.history) : null
    };
  }
  throw new Error('Format invalide');
}
