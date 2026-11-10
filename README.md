# Organisons, v0.5.1

Application de bureau pour classer, filtrer et préparer ses traces GPX vélo, sur son PC et son NAS, dans l'esprit de Pédalons.
Tauri 2 (cœur en Rust), React, Mantine et MapLibre. Interface en français, pour Windows (macOS prévu plus tard).

## Ce que fait Organisons

### Bibliothèque

- **Dossiers du PC ou du NAS** (lecteur réseau ou chemin `\\NAS\…`), lus récursivement. Une relecture ne réanalyse que les fichiers modifiés.
- **Deux modes de bibliothèque** :
  - *indexée sur place* : les fichiers restent où ils sont ;
  - *gérée* : rangée selon un modèle de dossiers modifiable dans les Réglages (`{sport}/{année}/{nom}.gpx` par défaut, avec aussi `{mois}`, `{source}`, `{collection}`). Le rangement montre toujours un aperçu, et rien ne bouge avant validation.
- **Quatre affichages** : tuiles avec fond de carte, liste + carte, liste, carte de toutes les traces.
- **Filtres** : recherche, distance, dénivelé, relief, sport, direction du vent (±45° en option), source, tags, collection. Tri par date, distance, dénivelé, relief, nom (dans l'ordre des nombres : np#2 avant np#10) ou sport.
- **Modification par lot** : sélectionner plusieurs traces pour ajouter ou retirer des tags, changer le sport, ajouter ou retirer des collections.
- **NAS éteint** : la bibliothèque reste consultable, et une relecture ne retire rien de l'index.

### Analyse de chaque trace

- Distance, dénivelé lissé, points haut et bas, relief selon les seuils de Pédalons (< 8, 8–15, > 15 m/km).
- Vent idéal, selon la méthode de biketeam : la trace part face au vent et revient vent dans le dos.
- Sport lu dans le GPX (`<type>` de Komoot ou Garmin, ou un mot du titre) : Route, Gravel, VTT, Randonnée, Course à pied, Vélo.
- Nom nettoyé (sans `_`, ni date, ni identifiant Openrunner), date lue dans le titre ; l'identifiant retiré est gardé dans les notes.
- Points d'intérêt classés : contrôles, attention, eau, commerces, curiosités (codes Openrunner, symboles Garmin, puis nom).

### Fiche d'une trace

- Carte avec bornes kilométriques et bouton « recentrer ».
- Profil coloré selon la pente la plus forte de chaque tronçon. Son curseur se suit sur la carte, et il suit le zoom de la carte.
- **Revêtement** calculé depuis OpenStreetMap (tuiles vectorielles VersaTiles) : asphalte, pavés, stabilisé, chemin. Le profil et la carte sont colorés, avec la part de chaque type en km et en %.
- Au survol d'une légende (pente ou revêtement), le type ressort et les autres s'atténuent.
- Points d'intérêt affichés par catégorie (repliables) ou par km.
- Classement en lecture ou en édition : sport, tags, collections, notes.

### Tags

- **Tags proposés** : détectés dans le titre, la description et les mots-clés du GPX (BRM 600, Brevet, Gravel…). Ils sont seulement proposés : à valider sur la fiche, ou par lot après un import ou un rangement.
- On peut créer ses propres tags avec la **détection automatique** et des **mots-clés** : par exemple `NP#` trouve « np#614 ».
- Renommer (avec fusion), supprimer.
- Tags et notes écrits dans le GPX, si la bibliothèque l'autorise. Seul le bloc `<extensions>` est modifié, et le fichier est vérifié avant de remplacer l'original.

### Collections et tours

- Collections : listes nommées de traces, ouvertes dans l'onglet Collections.
- **Tour** : une collection dont les traces sont des étapes.
  - Carte et profil enchaînés, une couleur par étape ;
  - chiffres du tour entier ou d'une étape ;
  - ordre changé en glissant les étapes ;
  - export en un seul GPX (une piste par étape) ou étape par étape.

### Imports

- **Fichiers GPX** dans une bibliothèque gérée : copiés directement à leur place. Les doublons sont détectés avant la copie.
- **Komoot** : connexion au compte, liste des parcours planifiés et réalisés, import en lot avec avancement. Le mot de passe n'est pas conservé ; le jeton d'accès est rangé dans le gestionnaire d'identifiants de Windows. Komoot n'a pas d'API publique : Organisons passe par l'API de son site, qui peut changer sans prévenir.
- **Openrunner** : coller les liens des parcours publics. Ils sont téléchargés avec leurs points d'intérêt. Un parcours privé doit être exporté depuis le site.
- Un parcours déjà présent dans la bibliothèque (même fichier ou même parcours) n'est pas importé une seconde fois.

### Doublons et corbeille

- **Doublons** : fichiers identiques et doublons probables (distance à ±1 %, D+ à ±5 %, départ et arrivée à moins de 300 m).
  - On peut les traiter un par un ou par lot : on choisit la trace à garder (la plus ancienne, la plus récente, la plus taguée, celle de la bibliothèque gérée) et on met les autres de côté.
  - Un doublon mis de côté est déplacé dans le dossier caché `.organisons-doublons` de sa bibliothèque.
- **Corbeille** : une trace supprimée part dans `.organisons-corbeille`, après confirmation.
  - L'onglet Corbeille liste les traces supprimées et les doublons mis de côté, restaurables un par un.
  - Vidage manuel, ou automatique après 7, 14 ou 30 jours.

### Navigation

- Alt+← et Alt+→, ou les boutons latéraux de la souris, pour revenir à l'écran précédent ou suivant.

## Installer

### Avec l'installateur (Windows)

Lancer `Organisons_<version>_x64_fr-FR.msi` ou `Organisons_<version>_x64-setup.exe`, produits par `npm run tauri build` dans `target/release/bundle/`. L'appli s'installe dans `C:\Program Files\Organisons`. Elle utilise WebView2, déjà présent sur Windows 11.

### Depuis les sources

1. Installer les prérequis de Tauri 2 : https://v2.tauri.app/start/prerequisites/
   - Rust (rustup), avec la chaîne MSVC ;
   - Microsoft C++ Build Tools (« Développement Desktop en C++ ») ;
   - WebView2.
2. Installer Node.js 20 ou plus récent.
3. Dans le dossier du projet :

```bash
npm install
npm run tauri dev      # appli en développement
npm run tauri build    # installateurs .msi et .exe dans target/release/bundle
```

Au premier lancement, ajoute un dossier de GPX dans **Réglages**.

## Données et sécurité des fichiers

- L'index est dans `%APPDATA%\fr.organisons.app\index.sqlite`. La version de développement utilise `index-dev.sqlite`, une copie faite au premier lancement. Supprimer l'index remet l'appli à zéro ; les tags et notes écrits dans les GPX reviennent à la relecture.
- Tes fichiers GPX ne sont modifiés ou déplacés que si tu l'as demandé :
  - écriture des tags et notes (option par bibliothèque) ;
  - rangement validé dans l'aperçu ;
  - doublon mis de côté ou trace mise à la corbeille, ce qui reste récupérable jusqu'au vidage.
- Rien n'est supprimé définitivement sans confirmation, sauf par le vidage automatique, si on l'a activé.

## Organisation du code

```
crates/traces-core/     cœur Rust sans interface, testé seul
  src/analyze.rs        distance, dénivelé, pente, vent, POI, profil
  src/index.rs          base SQLite : traces, tags, collections, tours, doublons, réglages
  src/scan.rs           parcours des dossiers, empreinte SHA-256, tags et notes relus dans le GPX
  src/gpxmeta.rs        écriture des tags et notes dans <extensions>, fichier inchangé par ailleurs
  src/organize.rs       rangement, import, doublons mis de côté, corbeille
  src/naming.rs         nom nettoyé, date du titre, identifiant Openrunner
  src/autotags.rs       tags proposés
  src/sport.rs          sport d'après le GPX ou le titre
  src/surface.rs        revêtement depuis les voies OpenStreetMap
  src/tour.rs           export des tours
  tests/brm600.rs       tests sur un vrai fichier (BRM 600 Tour de Manche, Openrunner)
src-tauri/src/          application Tauri : commandes, Komoot (komoot.rs), Openrunner (openrunner.rs)
src/                    interface React : pages Bibliothèque, Fiche, Tour, Collections, Tags,
                        Doublons, Corbeille, Komoot, Openrunner, Réglages
```

Les notes de développement (règles de conception, choix validés par version, pièges connus) sont dans [organisons.md](organisons.md).

## Tests

```bash
cargo test -p traces-core          # cœur : analyse, index, rangement, tours, corbeille…
npm run build                      # vérification des types et build de l'interface
cargo run -p traces-core --example indexer -- "D:\GPX"   # indexer un dossier sans interface
```

## Feuille de route

- **v0.5** : envoi vers les appareils GPS (Garmin, Wahoo, copie USB vers un Edge), entraînements avec les fichiers `.zwo`.
- **Plus tard** : version macOS, agenda Pédalons.

## Inspirations

Organisons est un projet indépendant, écrit de zéro. Il ne reprend pas le code des projets ci-dessous, seulement des idées et des règles de calcul.

- [Pédalons](https://github.com/glandais/pedalons) (Gabriel Landais, PolyForm Noncommercial 1.0.0) : seuils de relief, filtres de la bibliothèque, et l'idée de lire le revêtement dans les tuiles vectorielles OpenStreetMap au schéma Shortbread.
- [biketeam](https://github.com/tomacla/biketeam) (tomacla) : méthode du vent idéal, reprise de gpx2web.

Si du code de Pédalons est un jour repris, il faudra le signaler ici et conserver sa mention de copyright. Pédalons est sous PolyForm Noncommercial, qui n'est pas compatible avec l'AGPL : il faudrait l'accord de son auteur.

Données cartographiques : © contributeurs OpenStreetMap ; fonds de carte OpenFreeMap ; tuiles du revêtement VersaTiles.

## Licence

[GNU AGPL v3 ou toute version ultérieure](LICENSE) (`AGPL-3.0-or-later`), © minicake1.

- Utilisation, modification et redistribution autorisées, y compris à des fins commerciales.
- Toute version redistribuée, modifiée ou non, doit rester sous la même licence et donner accès à son code source.
- Une version modifiée proposée à d'autres par le réseau (site web, serveur) doit aussi donner accès à son code source.

Jusqu'à la v0.5.1, Organisons était sous PolyForm Noncommercial 1.0.0.
