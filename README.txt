EDUCRESPi — VERSION 1.1.1
========================

Contenu
- index.html : page principale
- css/style.css : interface
- js/ : logique de respiration, audio, stockage et maintien écran
- icons/ : icônes de l'application
- manifest.webmanifest : configuration PWA
- sw.js : cache et fonctionnement hors connexion

Modifications de cette version 1.1.1
- Les phases Inspiration, Suspension pleine, Expiration et Suspension vide
  utilisent un pas de 0,5 seconde.
- Une saisie manuelle non multiple de 0,5 est arrondie au demi-seconde le plus proche
  lors de la validation du champ.
- Les limites minimales et maximales des champs sont conservées.

