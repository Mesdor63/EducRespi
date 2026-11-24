export class ScreenWakeLock {
  #sentinel = null;
  #pendingGeneration = null;
  #generation = 0;

  async acquire(isSessionActive) {
    if (!('wakeLock' in navigator) || this.#sentinel) return;
    const generation = this.#generation;
    // Une demande est déjà en cours pour cette « génération » : inutile d'en lancer une autre.
    // (Après un release(), la génération change et une nouvelle demande reste possible,
    // ce qui évite de perdre le verrou lors d'un enchaînement rapide pause → reprise.)
    if (this.#pendingGeneration === generation) return;
    this.#pendingGeneration = generation;
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
      console.info("EducRespi : maintien de l'écran non disponible.", error);
    } finally {
      if (this.#pendingGeneration === generation) this.#pendingGeneration = null;
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
