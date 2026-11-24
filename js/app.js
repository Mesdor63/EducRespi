import {
  LIMITS, DEFAULT_SETTINGS, normalizeSettings, sanitizeUserName, uniqueName, createUserId,
  defaultUserData, initUsers, loadUserData, saveUserData, saveUsersIndex, removeUserData,
  removeObsoleteKeys, parseBackup
} from './storage.js';
import { createPhases, formatTime } from './breathing.js';
import { AudioEngine } from './audio.js';
import { ScreenWakeLock } from './wake-lock.js';

const $ = id => document.getElementById(id);
const el = {
  bubble: $('bubble'), label: $('phase-label'), timer: $('phase-timer'), cycle: $('cycle-count'),
  remaining: $('remaining'), start: $('start'), pause: $('pause'), stop: $('stop'), fullscreen: $('fullscreen'),
  duration: $('duration'), volume: $('volume'), soundEnabled: $('sound-enabled'), soundMode: $('sound-mode'),
  presetName: $('preset-name'), savePreset: $('save-preset'),
  presetStatus: $('preset-status'), dialogStatus: $('dialog-status'), presetList: $('preset-list'),
  openPresets: $('open-presets'), presetDialog: $('preset-dialog'), closePresets: $('close-presets'),
  userButton: $('user-button'), userDialog: $('user-dialog'), closeUsers: $('close-users'),
  userList: $('user-list'), userName: $('user-name'), addUser: $('add-user'), userStatus: $('user-status'),
  exportCurrent: $('export-current'), exportAll: $('export-all'), importData: $('import-data'), importFile: $('import-file'),
  historyTitle: $('history-title'), historyList: $('history-list'), historyEmpty: $('history-empty'),
  historySummary: $('history-summary'), clearHistory: $('clear-history'),
  modeToggle: $('mode-toggle'),
  helpButton: $('help-button'), helpDialog: $('help-dialog'), closeHelp: $('close-help')
};
const settingIds = {
  inhale: 'inhale', holdFull: 'hold-full', exhale: 'exhale',
  holdEmpty: 'hold-empty', duration: 'duration'
};
let state = {
  running: false, paused: false, raf: null, endAt: 0, phaseStartedAt: 0,
  phaseIndex: 0, lastPhaseIndex: -1, cycles: 0, pausedAt: 0, phases: [],
  durationMin: 0, pattern: '', needsFirstSound: false
};

/* ------------------------------------------------------------------ */
/* Utilisateurs et données                                             */
/* ------------------------------------------------------------------ */
removeObsoleteKeys(); // l'ambiance sonore n'existe plus : on nettoie son ancien réglage
const boot = initUsers();
let userIndex = boot.index;          // { currentId, users: [{ id, name }] }
let userData = boot.data;            // données de l'utilisateur courant { settings, audio, presets, history }
// Si le stockage du navigateur est indisponible, les données des autres utilisateurs
// restent en mémoire le temps de la session.
const memoryStore = new Map();
let editingUserId = null;

const audio = new AudioEngine(() => userData.audio);
const wakeLock = new ScreenWakeLock();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function currentUser() {
  return userIndex.users.find(user => user.id === userIndex.currentId) || userIndex.users[0];
}
function getUserData(id) {
  if (id === userIndex.currentId) return userData;
  return memoryStore.get(id) ?? loadUserData(id);
}
/** Enregistre les données de l'utilisateur courant. Renvoie false si le stockage est indisponible. */
function commit() {
  const ok = saveUserData(userIndex.currentId, userData);
  if (ok) memoryStore.delete(userIndex.currentId);
  else memoryStore.set(userIndex.currentId, userData);
  return ok;
}
function commitIndex() {
  return saveUsersIndex(userIndex);
}
let commitTimer = null;
function scheduleCommit() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(flushCommit, 300);
}
function flushCommit() {
  if (commitTimer === null) return;
  clearTimeout(commitTimer);
  commitTimer = null;
  if (!commit()) setStatus('Données non mémorisées (stockage indisponible).');
}

/* ------------------------------------------------------------------ */
/* Messages d'état                                                     */
/* ------------------------------------------------------------------ */
function setStatus(text, ok = false) {
  el.presetStatus.textContent = text;
  el.presetStatus.classList.toggle('success', ok && Boolean(text));
}
// Les messages d'une boîte de dialogue s'affichent DANS la boîte : le statut de la page
// reste masqué derrière le fond modal tant qu'elle est ouverte.
function setDialogStatus(node, text, ok = false) {
  node.textContent = text;
  node.classList.toggle('success', ok && Boolean(text));
}
const setPresetDialogStatus = (text, ok) => setDialogStatus(el.dialogStatus, text, ok);
const setUserStatus = (text, ok) => setDialogStatus(el.userStatus, text, ok);

/* ------------------------------------------------------------------ */
/* Réglages de la séance                                               */
/* ------------------------------------------------------------------ */
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
  document.title = 'EducRespi — respiration guidée';
}
function isSessionActive() { return state.running && !state.paused; }
function warnAudio(error) { console.warn('EducRespi : audio indisponible.', error); }

/* ------------------------------------------------------------------ */
/* Déroulement de la séance                                            */
/* ------------------------------------------------------------------ */
function stopSession(message = 'Prêt', completed = false) {
  state.running = false;
  state.paused = false;
  cancelAnimationFrame(state.raf);
  state.raf = null;
  audio.stop();
  navigator.vibrate?.(0);
  void wakeLock.release();
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
  document.title = 'EducRespi — respiration guidée';
}
function resumeSession() {
  if (!state.running || !state.paused) return;
  const pausedFor = performance.now() - state.pausedAt;
  state.endAt += pausedFor;
  state.phaseStartedAt += pausedFor;
  state.paused = false;
  setControls('running');
  void audio.start().catch(warnAudio);
  void wakeLock.acquire(isSessionActive);
  state.raf = requestAnimationFrame(tick);
}
function startSession() {
  if (state.running) return;
  const settings = getSettings();
  const phases = createPhases(settings);
  if (!phases.length) {
    setStatus('Impossible de démarrer : aucune phase valide.');
    return;
  }
  putSettings(settings);
  userData.settings = settings;
  if (!commit()) setStatus('Réglages non mémorisés (stockage indisponible).');
  state.running = true;
  state.paused = false;
  state.phases = phases;
  state.phaseIndex = 0;
  state.lastPhaseIndex = -1;
  state.cycles = 1;
  state.durationMin = settings.duration;
  state.pattern = `${settings.inhale}-${settings.holdFull}-${settings.exhale}-${settings.holdEmpty}`;
  state.needsFirstSound = true;
  const now = performance.now();
  state.endAt = now + settings.duration * 60000;
  state.phaseStartedAt = now;
  document.body.classList.add('active');
  setControls('running');
  el.pause.focus({ preventScroll: true });
  // L'audio démarre de façon asynchrone : si le premier « gong/carillon » a été manqué
  // faute de contexte audio prêt, on le joue dès que la couche guidée est disponible.
  audio.start().then(() => {
    if (state.needsFirstSound && isSessionActive() && state.lastPhaseIndex >= 0 &&
        state.phaseIndex === 0 && state.cycles === 1) {
      state.needsFirstSound = false;
      audio.transition(state.phases[0].key);
    }
  }).catch(warnAudio);
  void wakeLock.acquire(isSessionActive);
  el.cycle.textContent = 'Cycle 1';
  state.raf = requestAnimationFrame(tick);
}
function tick(timestamp) {
  if (!state.running || state.paused) return;
  const remaining = state.endAt - timestamp;
  if (remaining <= 0) {
    recordSession(state.durationMin, state.cycles, state.pattern);
    stopSession('Terminé !', true);
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
    if (audio.transition(phase.key)) state.needsFirstSound = false;
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

/* ------------------------------------------------------------------ */
/* Séances enregistrées (propres à l'utilisateur courant)              */
/* ------------------------------------------------------------------ */
function renderPresets() {
  el.presetList.replaceChildren();
  userData.presets.forEach((preset, index) => {
    const li = document.createElement('li');
    li.className = 'preset-item';
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'preset-load';
    load.textContent = `${index + 1}. ${preset.name} (${preset.inhale}-${preset.holdFull}-${preset.exhale}-${preset.holdEmpty} | ${preset.duration} min)`;
    load.addEventListener('click', () => {
      if (state.running) return;
      putSettings(preset);
      el.presetDialog.close();
      $('inhale').focus({ preventScroll: true });
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'preset-delete';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Supprimer ${preset.name}`);
    remove.addEventListener('click', () => {
      if (state.running) return;
      userData.presets = userData.presets.filter((_, i) => i !== index);
      if (!commit()) setPresetDialogStatus('Suppression non mémorisée : stockage local indisponible.');
      renderPresets();
      renderUsers();
    });
    li.append(load, remove);
    el.presetList.append(li);
  });
  el.savePreset.textContent = 'Enregistrer';
  el.savePreset.disabled = userData.presets.length >= LIMITS.presets;
  el.openPresets.textContent = `Mes séances (${userData.presets.length}/${LIMITS.presets})`;
}
el.savePreset.addEventListener('click', () => {
  if (state.running || userData.presets.length >= LIMITS.presets) return;
  const name = sanitizeUserName(el.presetName.value) || `Séance ${userData.presets.length + 1}`;
  userData.presets = [...userData.presets, { name, ...getSettings() }];
  el.presetName.value = '';
  setStatus(commit() ? '' : 'Enregistrement non mémorisé : stockage local indisponible.');
  renderPresets();
});

/* ------------------------------------------------------------------ */
/* Historique (propre à l'utilisateur courant)                         */
/* ------------------------------------------------------------------ */
function formatTotalMinutes(total) {
  const minutes = Math.round(total);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')} min` : `${hours} h`;
}
function renderHistory() {
  const items = userData.history;
  el.historyTitle.textContent = `Historique récent — ${currentUser().name}`;
  el.historyList.replaceChildren();
  el.historyEmpty.hidden = items.length > 0;
  el.clearHistory.hidden = items.length === 0;
  if (items.length) {
    const total = items.reduce((sum, item) => sum + item.duration, 0);
    el.historySummary.textContent =
      `${items.length} séance${items.length > 1 ? 's' : ''} terminée${items.length > 1 ? 's' : ''} · ${formatTotalMinutes(total)} au total`;
  } else {
    el.historySummary.textContent = '';
  }
  items.slice(0, 8).forEach(item => {
    const li = document.createElement('li');
    const date = new Date(item.date);
    const dateText = Number.isNaN(date.getTime()) ? 'Date inconnue' :
      date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const parts = [dateText, `${item.duration} min`];
    if (item.pattern) parts.push(item.pattern);
    parts.push(`${item.cycles || 0} cycle(s)`);
    li.textContent = parts.join(' — ');
    el.historyList.append(li);
  });
}
function recordSession(minutes, cycles, pattern) {
  const entry = { date: new Date().toISOString(), duration: minutes, cycles, pattern };
  userData.history = [entry, ...userData.history].slice(0, LIMITS.history);
  if (!commit()) setStatus("Séance non mémorisée dans l'historique (stockage indisponible).");
  renderHistory();
  renderUsers();
}
el.clearHistory.addEventListener('click', () => {
  if (state.running || !userData.history.length) return;
  if (!window.confirm(`Effacer tout l'historique de « ${currentUser().name} » ? Cette action est définitive.`)) return;
  userData.history = [];
  if (!commit()) setStatus('Effacement non mémorisé (stockage indisponible).');
  renderHistory();
  renderUsers();
});

/* ------------------------------------------------------------------ */
/* Champs de réglage                                                   */
/* ------------------------------------------------------------------ */
// Les phases respiratoires n'acceptent que des multiples de 0,5 seconde.
// Toute saisie clavier ou valeur collée non conforme est immédiatement corrigée.
const phaseSettingIds = ['inhale', 'hold-full', 'exhale', 'hold-empty'];
for (const id of phaseSettingIds) {
  const input = $(id);
  input.step = '0.5';

  const enforceHalfStep = (finalize = false) => {
    const raw = input.value.trim().replace(',', '.');
    if (raw === '') {
      if (finalize) input.value = input.min;
      updatePreview();
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      if (finalize) input.value = input.min;
      updatePreview();
      return;
    }
    const min = Number(input.min);
    const max = Number(input.max);
    const snapped = Math.min(max, Math.max(min, Math.round(value * 2) / 2));
    if (Math.abs(snapped - value) > 1e-9) input.value = String(snapped);
    updatePreview();
  };

  input.addEventListener('input', () => enforceHalfStep(false));
  input.addEventListener('change', () => enforceHalfStep(true));
  input.addEventListener('blur', () => enforceHalfStep(true));
}
$('duration').addEventListener('input', updatePreview);
// La durée saisie hors limites (ex. 500) est ramenée à la valeur réellement utilisée.
$('duration').addEventListener('change', () => {
  $('duration').value = getSettings().duration;
  updatePreview();
});

/* ------------------------------------------------------------------ */
/* Sons guidés                                                         */
/* ------------------------------------------------------------------ */
function persistAudioPreferences({ immediate = true } = {}) {
  const before = userData.audio;
  userData.audio = {
    volume: Number(el.volume.value),
    enabled: el.soundEnabled.checked,
    mode: el.soundMode.value
  };
  if (immediate) {
    clearTimeout(commitTimer);
    commitTimer = null;
    if (!commit()) setStatus('Préférences audio non mémorisées (stockage indisponible).');
  } else {
    scheduleCommit(); // curseur de volume : on regroupe les enregistrements
  }
  audio.setVolume(userData.audio.volume);
  // Relancer la couche guidée à chaque cran du curseur la ferait « hacher » :
  // on ne la relance que si le type de son ou son activation a changé.
  if ((before.mode !== userData.audio.mode || before.enabled !== userData.audio.enabled) && isSessionActive()) {
    void audio.start().catch(warnAudio);
  }
}
el.volume.addEventListener('input', () => persistAudioPreferences({ immediate: false }));
el.soundEnabled.addEventListener('change', () => {
  el.soundMode.disabled = !el.soundEnabled.checked;
  persistAudioPreferences();
});
el.soundMode.addEventListener('change', () => persistAudioPreferences());

/* ------------------------------------------------------------------ */
/* Utilisateurs                                                        */
/* ------------------------------------------------------------------ */
/** Affiche à l'écran les données de l'utilisateur courant. */
function applyUser() {
  const user = currentUser();
  el.userButton.textContent = `Utilisateur : ${user.name}`;
  el.userButton.setAttribute('aria-label', `Utilisateur actuel : ${user.name}. Changer d'utilisateur`);
  putSettings(userData.settings || DEFAULT_SETTINGS);
  el.volume.value = userData.audio.volume;
  el.soundEnabled.checked = userData.audio.enabled;
  el.soundMode.value = userData.audio.mode;
  el.soundMode.disabled = !userData.audio.enabled;
  el.presetName.value = '';
  setStatus('');
  renderPresets();
  renderHistory();
}
function plural(n, word) { return `${n} ${word}${n > 1 ? 's' : ''}`; }

function renderUsers() {
  el.userList.replaceChildren();
  let editInput = null;
  for (const user of userIndex.users) {
    const isCurrent = user.id === userIndex.currentId;
    const data = getUserData(user.id);
    const li = document.createElement('li');
    li.className = `user-item${isCurrent ? ' current' : ''}`;

    if (editingUserId === user.id) {
      const form = document.createElement('div');
      form.className = 'user-edit';
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = LIMITS.name;
      input.value = user.name;
      input.setAttribute('aria-label', `Nouveau nom pour ${user.name}`);
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'user-action';
      save.textContent = 'OK';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'user-action';
      cancel.textContent = 'Annuler';
      const doSave = () => renameUser(user.id, input.value);
      const doCancel = () => { editingUserId = null; setUserStatus(''); renderUsers(); };
      save.addEventListener('click', doSave);
      cancel.addEventListener('click', doCancel);
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); doSave(); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); doCancel(); }
      });
      form.append(input, save, cancel);
      li.append(form);
      editInput = input;
    } else {
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'user-select';
      if (isCurrent) select.setAttribute('aria-current', 'true');
      const name = document.createElement('span');
      name.className = 'user-name';
      name.textContent = user.name;
      if (isCurrent) {
        const badge = document.createElement('span');
        badge.className = 'user-badge';
        badge.textContent = 'Actif';
        name.append(badge);
      }
      const meta = document.createElement('span');
      meta.className = 'user-meta';
      meta.textContent = `${plural(data.presets.length, 'séance')} enregistrée${data.presets.length > 1 ? 's' : ''} · ${plural(data.history.length, 'séance')} dans l'historique`;
      select.append(name, meta);
      select.addEventListener('click', () => selectUser(user.id));

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'user-action';
      rename.textContent = '✎';
      rename.setAttribute('aria-label', `Renommer ${user.name}`);
      rename.addEventListener('click', () => { editingUserId = user.id; setUserStatus(''); renderUsers(); });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'user-action danger';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Supprimer ${user.name}`);
      remove.disabled = userIndex.users.length <= 1;
      remove.addEventListener('click', () => deleteUser(user.id));
      li.append(select, rename, remove);
    }
    el.userList.append(li);
  }
  el.addUser.disabled = userIndex.users.length >= LIMITS.users;
  el.userName.disabled = userIndex.users.length >= LIMITS.users;
  if (editInput) { editInput.focus(); editInput.select(); }
}
function selectUser(id) {
  if (state.running) return;
  if (id !== userIndex.currentId) {
    flushCommit();
    // Charger les données AVANT de changer l'identifiant courant (getUserData renvoie
    // l'utilisateur courant lorsqu'on lui passe l'identifiant courant).
    const nextData = getUserData(id);
    userIndex.currentId = id;
    userData = nextData;
    memoryStore.delete(id);
    if (!commitIndex()) setStatus('Utilisateur non mémorisé (stockage indisponible).');
    applyUser();
  }
  editingUserId = null;
  el.userDialog.close();
}
function nameTaken(name, exceptId = null) {
  return userIndex.users.some(user => user.id !== exceptId && user.name.toLowerCase() === name.toLowerCase());
}
function addUser() {
  if (state.running) return;
  const name = sanitizeUserName(el.userName.value);
  if (!name) { setUserStatus('Saisissez un nom.'); return; }
  if (nameTaken(name)) { setUserStatus('Ce nom existe déjà.'); return; }
  if (userIndex.users.length >= LIMITS.users) { setUserStatus(`Limite de ${LIMITS.users} utilisateurs atteinte.`); return; }
  flushCommit();
  const user = { id: createUserId(), name };
  const data = defaultUserData();
  if (!saveUserData(user.id, data)) memoryStore.set(user.id, data);
  userIndex.users.push(user);
  userIndex.currentId = user.id;
  userData = data;
  memoryStore.delete(user.id);
  if (!commitIndex()) setUserStatus('Utilisateur créé, mais non mémorisé (stockage indisponible).');
  el.userName.value = '';
  applyUser();
  renderUsers();
  if (el.userStatus.textContent === '') setUserStatus(`« ${name} » créé et sélectionné.`, true);
}
function renameUser(id, rawName) {
  const name = sanitizeUserName(rawName);
  if (!name) { setUserStatus('Le nom ne peut pas être vide.'); return; }
  if (nameTaken(name, id)) { setUserStatus('Ce nom existe déjà.'); return; }
  const user = userIndex.users.find(item => item.id === id);
  if (!user) return;
  user.name = name;
  editingUserId = null;
  if (!commitIndex()) setUserStatus('Nom modifié, mais non mémorisé (stockage indisponible).');
  else setUserStatus('Nom modifié.', true);
  if (id === userIndex.currentId) applyUserLabels();
  renderUsers();
}
function applyUserLabels() {
  const user = currentUser();
  el.userButton.textContent = `Utilisateur : ${user.name}`;
  el.userButton.setAttribute('aria-label', `Utilisateur actuel : ${user.name}. Changer d'utilisateur`);
  el.historyTitle.textContent = `Historique récent — ${user.name}`;
}
function deleteUser(id) {
  if (state.running || userIndex.users.length <= 1) return;
  const user = userIndex.users.find(item => item.id === id);
  if (!user) return;
  if (!window.confirm(`Supprimer l'utilisateur « ${user.name} » avec toutes ses séances, ses réglages et son historique ? Cette action est définitive.`)) return;
  flushCommit();
  const wasCurrent = id === userIndex.currentId;
  userIndex.users = userIndex.users.filter(item => item.id !== id);
  removeUserData(id);
  memoryStore.delete(id);
  if (wasCurrent) {
    const nextId = userIndex.users[0].id;
    const nextData = getUserData(nextId); // avant de changer l'identifiant courant
    userIndex.currentId = nextId;
    userData = nextData;
    memoryStore.delete(nextId);
  }
  if (!commitIndex()) setUserStatus('Suppression non mémorisée (stockage indisponible).');
  else setUserStatus(`« ${user.name} » supprimé.`, true);
  editingUserId = null;
  if (wasCurrent) applyUser();
  renderUsers();
}

el.userButton.addEventListener('click', () => {
  if (state.running) return;
  editingUserId = null;
  setUserStatus('');
  renderUsers();
  el.userDialog.showModal();
});
el.closeUsers.addEventListener('click', () => { editingUserId = null; el.userDialog.close(); });
el.userDialog.addEventListener('close', () => { editingUserId = null; });
el.addUser.addEventListener('click', addUser);
el.userName.addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); addUser(); }
});

/* ---------- Sauvegardes (export / import) ---------- */
function slugify(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'utilisateur';
}
function buildBackup(ids) {
  return {
    app: 'EducRespi',
    formatVersion: 3,
    exportedAt: new Date().toISOString(),
    users: ids.map(id => {
      const user = userIndex.users.find(item => item.id === id);
      const data = getUserData(id);
      return { id, name: user.name, settings: data.settings, audio: data.audio, presets: data.presets, history: data.history };
    })
  };
}
function downloadJSON(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Libération différée : la révoquer tout de suite peut interrompre le téléchargement (Safari, Firefox).
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const today = () => new Date().toISOString().slice(0, 10);
el.exportCurrent.addEventListener('click', () => {
  flushCommit();
  const user = currentUser();
  downloadJSON(buildBackup([user.id]), `educrespi-${slugify(user.name)}-${today()}.json`);
  setUserStatus(`Sauvegarde de « ${user.name} » exportée.`, true);
});
el.exportAll.addEventListener('click', () => {
  flushCommit();
  downloadJSON(buildBackup(userIndex.users.map(user => user.id)), `educrespi-sauvegarde-${today()}.json`);
  setUserStatus(`Sauvegarde de ${plural(userIndex.users.length, 'utilisateur')} exportée.`, true);
});
el.importData.addEventListener('click', () => el.importFile.click());

function importUsers(imported) {
  // Si un identifiant apparaît deux fois dans le fichier, la dernière occurrence l'emporte.
  const byId = new Map();
  const list = [];
  for (const item of imported) {
    if (item.id && byId.has(item.id)) list[byId.get(item.id)] = item;
    else { if (item.id) byId.set(item.id, list.length); list.push(item); }
  }
  const known = new Set(userIndex.users.map(user => user.id));
  const replaced = list.filter(item => item.id && known.has(item.id)).length;
  const added = list.length - replaced;
  if (userIndex.users.length + added > LIMITS.users) {
    setUserStatus(`Import impossible : la limite de ${LIMITS.users} utilisateurs serait dépassée.`);
    return;
  }
  const question = `Importer ${plural(list.length, 'utilisateur')} ?\n` +
    `• ${plural(added, 'nouvel utilisateur')} ${added > 1 ? 'seront ajoutés' : 'sera ajouté'}\n` +
    `• ${plural(replaced, 'utilisateur existant')} (même identifiant) ${replaced > 1 ? 'seront remplacés' : 'sera remplacé'} : séances, réglages et historique.\n` +
    'Les autres utilisateurs ne sont pas modifiés.';
  if (!window.confirm(question)) { setUserStatus('Import annulé.'); return; }

  flushCommit();
  const next = { currentId: userIndex.currentId, users: userIndex.users.map(user => ({ ...user })) };
  let unsaved = false;
  for (const item of list) {
    let target = item.id ? next.users.find(user => user.id === item.id) : null;
    if (target) {
      target.name = uniqueName(item.name, next.users, target.id);
    } else {
      const id = item.id && !next.users.some(user => user.id === item.id) ? item.id : createUserId();
      target = { id, name: uniqueName(item.name, next.users) };
      next.users.push(target);
    }
    if (target.id === next.currentId) userData = item.data;
    if (!saveUserData(target.id, item.data)) {
      unsaved = true;
      if (target.id !== next.currentId) memoryStore.set(target.id, item.data);
    }
  }
  userIndex = next;
  if (!commitIndex()) unsaved = true;
  editingUserId = null;
  applyUser();
  renderUsers();
  if (unsaved) setUserStatus('Import effectué, mais non mémorisé durablement (stockage indisponible).');
  else setUserStatus(`Import réussi : ${plural(added, 'ajout')}, ${plural(replaced, 'remplacement')}.`, true);
}
function importSingle(backup) {
  const user = currentUser();
  if (!window.confirm(`Cette sauvegarde (ancien format, un seul utilisateur) remplacera les séances enregistrées${backup.history ? ' et l\'historique' : ''} de « ${user.name} ». Continuer ?`)) {
    setUserStatus('Import annulé.');
    return;
  }
  userData.presets = backup.presets;
  if (backup.history) userData.history = backup.history;
  const ok = commit();
  applyUser();
  renderUsers();
  if (ok) setUserStatus(`Sauvegarde importée dans « ${user.name} ».`, true);
  else setUserStatus('Import effectué, mais non mémorisé (stockage indisponible).');
}
el.importFile.addEventListener('change', async () => {
  const file = el.importFile.files?.[0];
  if (!file) return;
  try {
    const backup = parseBackup(JSON.parse(await file.text()));
    if (backup.kind === 'users') importUsers(backup.users);
    else importSingle(backup);
  } catch {
    setUserStatus('Import impossible : fichier invalide.');
  } finally {
    el.importFile.value = '';
  }
});

/* ------------------------------------------------------------------ */
/* Commandes générales                                                 */
/* ------------------------------------------------------------------ */
// iOS Safari ne prend pas en charge le plein écran sur les pages : on masque alors le bouton.
if (!document.documentElement.requestFullscreen && el.fullscreen) el.fullscreen.hidden = true;
el.fullscreen?.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch {
    setStatus("Le plein écran n'est pas disponible sur cet appareil.");
  }
});
document.addEventListener('fullscreenchange', () => {
  if (el.fullscreen) el.fullscreen.textContent = document.fullscreenElement ? 'Quitter plein écran' : 'Plein écran';
});
el.start.addEventListener('click', () => startSession());
el.pause.addEventListener('click', () => {
  if (state.paused) resumeSession();
  else pauseSession();
});
el.stop.addEventListener('click', () => stopSession());
el.openPresets.addEventListener('click', () => {
  if (state.running) return;
  setPresetDialogStatus('');
  el.presetDialog.showModal();
});
el.closePresets.addEventListener('click', () => el.presetDialog.close());
function openHelp() {
  if (state.running || document.querySelector('dialog[open]')) return;
  el.helpDialog.showModal();
}
el.helpButton.addEventListener('click', openHelp);
el.closeHelp.addEventListener('click', () => el.helpDialog.close());
el.modeToggle.addEventListener('click', () => {
  const enabled = document.body.classList.toggle('relaxation-mode');
  el.modeToggle.textContent = enabled ? 'Revenir au mode éducatif' : 'Passer en mode relaxation';
});
document.addEventListener('keydown', event => {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
  // Échap arrête la séance quel que soit l'élément focalisé (après « Démarrer », le focus est sur « Pause »).
  if (event.code === 'Escape') {
    if (state.running) stopSession();
    return;
  }
  const target = event.target;
  // Sur un champ ou un bouton, Espace garde son comportement natif (saisie / activation).
  const isInteractive = target?.isContentEditable ||
    ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A'].includes(target?.tagName);
  if (event.key === '?' && !isInteractive) {
    event.preventDefault();
    openHelp();
    return;
  }
  if (event.code !== 'Space' || isInteractive) return;
  event.preventDefault();
  if (state.running) state.paused ? resumeSession() : pauseSession();
  else startSession();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushCommit();
    if (state.running && !state.paused) pauseSession();
  }
});
window.addEventListener('pagehide', () => {
  flushCommit();
  audio.stop();
});
reducedMotion.addEventListener?.('change', () => {
  if (reducedMotion.matches) el.bubble.style.transform = 'scale(1)';
});

/* ------------------------------------------------------------------ */
/* Démarrage                                                           */
/* ------------------------------------------------------------------ */
applyUser();
setControls('idle');

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const registerWorker = () => navigator.serviceWorker.register('./sw.js')
    .catch(error => console.warn('EducRespi : mode hors ligne indisponible.', error));
  if (document.readyState === 'complete') registerWorker();
  else window.addEventListener('load', registerWorker, { once: true });
}
