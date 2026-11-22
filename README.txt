EDUCRESPi — VERSION 1.1.1
========================

Contenu
- index.html : page principale
- css/style.css : interface
- js/ : logique de respiration, audio, stockage et maintien écran
- icons/ : icônes de l'application
- manifest.webmanifest : configuration PWA
- sw.js : cache et fonctionnement hors connexion

Modifications de cette version
- Les phases Inspiration, Suspension pleine, Expiration et Suspension vide
  utilisent un pas de 0,5 seconde.
- Une saisie manuelle non multiple de 0,5 est arrondie au demi-seconde le plus proche
  lors de la validation du champ.
- Les limites minimales et maximales des champs sont conservées.
- Le titre EducRespi et la version 1.1.0 sont affichés dans l'interface.
- Le cache du Service Worker est renouvelé pour déclencher la mise à jour.

Installation
Déployer l'intégralité du dossier sur le même hébergement HTTPS que précédemment.
Ne pas séparer index.html, css/, js/, icons/, manifest.webmanifest et sw.js.
Pour tester localement, utiliser un serveur web local plutôt que d'ouvrir index.html
directement en file:// (le Service Worker nécessite HTTP/HTTPS).

Correction 1.1.1
- Les champs des quatre phases corrigent immédiatement toute valeur saisie
  au clavier ou collée qui n'est pas un multiple de 0,5 seconde.
- La correction est également appliquée à la sortie du champ.
