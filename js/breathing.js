export const PHASES = Object.freeze([
  { key: 'inhale', label: 'Inspirez' },
  { key: 'holdFull', label: 'Suspension pleine' },
  { key: 'exhale', label: 'Expirez' },
  { key: 'holdEmpty', label: 'Suspension vide' }
]);
export function createPhases(settings) {
  return PHASES.map(phase => ({ ...phase, duration: settings[phase.key] }))
    .filter(phase => phase.duration > 0);
}
export function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}