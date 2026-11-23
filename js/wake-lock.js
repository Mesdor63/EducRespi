export class ScreenWakeLock {
  #sentinel = null;
  #requesting = false;
  #generation = 0;

  async acquire(isSessionActive) {
    if (!('wakeLock' in navigator) || this.#sentinel || this.#requesting) return;
    const generation = this.#generation;
    this.#requesting = true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // La séance peut avoir été arrêtée ou mise en pause pendant l'attente.
      if (generation !== this.#generation || !isSessionActive()) {
        await sentinel.release();
        return;
      }
      this.#sentinel = sentinel;
      sentinel.addEventListener('release', () => {
        if (this.#sentinel === sentinel) this.#sentinel = null;
      }, { once: true });
    } catch (error) {
      // Fonctionnalité facultative : l'application reste utilisable sans Wake Lock.
      console.info('EducRespi : maintien de l’écran non disponible.', error);
    } finally {
      this.#requesting = false;
    }
  }

  async release() {
    this.#generation++;
    const current = this.#sentinel;
    this.#sentinel = null;
    if (current && !current.released) {
      try { await current.release(); } catch { /* déjà libéré */ }
    }
  }
}
