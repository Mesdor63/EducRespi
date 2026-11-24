# EducRespi — respiration guidée

Application web de respiration guidée : une bulle grossit et rétrécit au rythme que vous choisissez, avec des sons pour vous guider. Elle fonctionne hors ligne et s'installe comme une application. Version 1.5.0.

## Installer / lancer

L'application doit être servie en **HTTP(S)** : l'ouvrir en double-cliquant sur `index.html` ne fonctionne pas.

- **Test local** : dans le dossier, lancer `python3 -m http.server 8000`, puis ouvrir <http://localhost:8000>.
- **En ligne** : déposer tout le dossier sur un hébergement statique (GitHub Pages, Netlify, serveur web…), en HTTPS.
- **Sur téléphone ou ordinateur** : une fois la page ouverte, utiliser « Ajouter à l'écran d'accueil » ou « Installer l'application » dans le navigateur. Elle marche ensuite sans connexion.

## Aide intégrée

Le bouton **Aide** (ou la touche `?`) ouvre un guide d'utilisation dans l'application, disponible hors ligne.

## Faire une séance

1. Réglez le rythme, en secondes (par pas de 0,5) :
   - **Inspiration** et **Expiration** : de 1 à 60 s ;
   - **Suspension pleine** (poumons pleins) et **Suspension vide** (poumons vides) : de 0 à 60 s. Mettre **0** supprime la phase.
2. Choisissez la **durée de séance** (1 à 120 min).
3. Appuyez sur **Démarrer** et suivez la bulle :
   - elle **grossit** pendant l'inspiration et **rétrécit** pendant l'expiration ;
   - elle devient **orange** en suspension pleine et **rouge** en suspension vide ;
   - le texte indique la phase, les secondes restantes et le numéro de cycle.
4. Utilisez **Pause / Reprendre** ou **Arrêter** à tout moment. **Plein écran** est proposé quand le navigateur le permet (pas sur iPhone).

**Raccourcis clavier** : `Espace` démarre ou met en pause, `Échap` arrête.
L'écran reste allumé pendant la séance. Si vous quittez l'application ou verrouillez l'écran, la séance se met en pause.

**Rythmes courants** (inspiration – suspension pleine – expiration – suspension vide) :

| Rythme | Réglages |
|---|---|
| Respiration lente et régulière | 5 – 0 – 5 – 0 |
| Respiration « carrée » | 4 – 4 – 4 – 4 |
| Expiration allongée (4-7-8) | 4 – 7 – 8 – 0 |

Ces exercices ne remplacent pas un avis médical. En cas de vertige ou de gêne, arrêtez et reprenez une respiration normale.

## Sons

- Cochez ou décochez **Sons guidés**, puis choisissez : **Nappe harmonique** (note continue qui monte et descend avec la respiration), **Gongs de transition** ou **Carillons** (un son à chaque changement de phase).
- Le curseur règle le **volume** (0 à 150 %), y compris pendant la séance.

## Mode relaxation

Le bouton **Passer en mode relaxation** masque les réglages pour ne garder que la bulle, le volume et les boutons. Le même bouton ramène au mode éducatif.

## Séances enregistrées

- Réglez un rythme, saisissez un nom (ex. « Matin »), puis **Enregistrer**.
- **Mes séances** liste vos rythmes : touchez-en un pour le charger, ✕ pour le supprimer. Maximum 50 par utilisateur.

## Historique

Chaque séance **menée jusqu'au bout** est ajoutée à l'historique : date, durée, rythme et nombre de cycles. Les 8 dernières sont affichées, avec le total de séances et de minutes ; les 200 plus récentes sont conservées. Une séance arrêtée avant la fin n'est pas comptée. **Effacer l'historique** le vide, après confirmation.

## Utilisateurs

Le bouton **Utilisateur : …** en haut de page ouvre la liste des utilisateurs (20 maximum). Chacun a ses propres réglages, sons, séances enregistrées et historique.

- Touchez un nom pour passer à cet utilisateur.
- ✎ renomme, ✕ supprime (avec toutes ses données, après confirmation).
- Saisissez un nom et **Ajouter** pour créer un utilisateur.

Au premier lancement, un utilisateur « Utilisateur 1 » est créé : pensez à le renommer. Il n'y a pas de mot de passe : tous les utilisateurs sont accessibles à toute personne qui utilise l'appareil.

## Sauvegarder vos données

Les données sont enregistrées **dans le navigateur de l'appareil** uniquement. Vider les données du site, désinstaller l'application ou changer d'appareil les efface : faites des sauvegardes.

Dans la fenêtre **Utilisateurs** :

- **Exporter cet utilisateur** : fichier `.json` pour l'utilisateur actif ;
- **Exporter tout** : fichier `.json` pour tous les utilisateurs ;
- **Importer une sauvegarde** : ajoute les utilisateurs du fichier, ou remplace ceux qui existent déjà (même identifiant) après confirmation. Les autres utilisateurs ne sont pas touchés. Les sauvegardes des versions précédentes sont acceptées et remplacent les séances et l'historique de l'utilisateur actif.

Pour changer d'appareil : exporter sur l'ancien, importer sur le nouveau.

## Structure du projet

```
index.html            page principale
manifest.webmanifest  installation comme application
sw.js                 mode hors ligne (changer CACHE_NAME à chaque mise à jour)
css/style.css         styles
js/app.js             interface et séance
js/storage.js         données par utilisateur, sauvegardes
js/audio.js           sons guidés
js/breathing.js       phases et formatage du temps
js/wake-lock.js       maintien de l'écran allumé
icons/                icônes (dont une icône « maskable » pour Android)
```
## Application réalisée et corrigée avec l'aide de l' IA.
