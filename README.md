# EducRespi V3

Version restructurée de l'application de respiration guidée.

## Arborescence

- `index.html` : structure de la page
- `css/style.css` : styles et mise en page responsive
- `js/app.js` : orchestration de l'application et interface
- `js/breathing.js` : phases et formatage du temps
- `js/audio.js` : sons générés avec Web Audio API
- `js/storage.js` : réglages, préférences audio et presets
- `js/wake-lock.js` : maintien facultatif de l'écran allumé
- `manifest.webmanifest` : déclaration de la PWA
- `sw.js` : cache hors ligne et mise à jour du cache
- `icons/` : icônes de l'application

## Installation / lancement

Les modules JavaScript et le service worker nécessitent un contexte sécurisé :
- en local : utiliser un serveur local (par exemple `python -m http.server 8000`) puis ouvrir `http://localhost:8000`;
- en production : déposer **tout le contenu** du dossier sur un hébergement HTTPS.

Ne pas ouvrir `index.html` directement avec `file://` : les imports ES modules et le service worker ne fonctionneront pas correctement.

## Mise à jour après modification

Le nom du cache est versionné dans `sw.js` (`CACHE_NAME`). Incrémenter son suffixe à chaque déploiement important, par exemple `educrespi-v3-cache-2`, pour forcer le renouvellement du cache sur les appareils déjà installés.

## Fonctionnalités

- Respiration animée avec inspiration, suspensions et expiration réglables.
- Durée de séance de 1 à 120 minutes.
- Trois ambiances audio, volume et mémorisation des préférences.
- Jusqu'à 10 séances enregistrées localement.
- Pause automatique lorsque l'onglet passe en arrière-plan.
- Raccourcis clavier : Espace (démarrer/pause), Échap (arrêter).
- Wake Lock facultatif lorsque le navigateur le permet.
- Cache de l'application pour une utilisation hors ligne après le premier chargement.

## Limites et vérifications restantes

Le service worker met en cache les fichiers de cette version. Le comportement exact d'installation varie selon le navigateur et l'appareil. Tester sur les navigateurs réellement ciblés, notamment iOS/Safari et Android/Chrome.

Le maintien de l'écran allumé n'est pas garanti par tous les navigateurs. Les sons peuvent aussi être soumis aux règles d'autoplay du navigateur : ils sont initialisés à la suite de l'action explicite de démarrage.
