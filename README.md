# Organisons, v0.8

Application de bureau pour classer, filtrer et préparer ses traces GPX vélo, sur son PC et son NAS, dans l'esprit de Pédalons.
Tauri 2 (cœur en Rust), React, Mantine et MapLibre. Interface en français, pour Windows (macOS prévu plus tard).

## Ce que fait Organisons

### Bibliothèque

- **Dossiers du PC ou du NAS** (lecteur réseau ou chemin `\\NAS\…`), lus récursivement. Une relecture ne réanalyse que les fichiers modifiés.
- **Deux modes de bibliothèque**, modifiables à tout moment dans les Réglages :
  - *indexée sur place* : les fichiers restent où ils sont ;
  - *gérée* : rangée selon un modèle de dossiers modifiable dans les Réglages (`{sport}/{année}/{nom}.gpx` par défaut, avec aussi `{mois}`, `{source}`, `{collection}`). Le rangement montre toujours un aperçu, et rien ne bouge avant validation.
- **Quatre affichages** : tuiles avec fond de carte, liste + carte, liste, carte de toutes les traces.
- **Filtres** : recherche, distance, dénivelé, relief, sport, direction du vent (±45° en option), source, tags, collection. Tri par date, distance, dénivelé, relief, nom (dans l'ordre des nombres : np#2 avant np#10) ou sport.
- **Modification par lot** : sélectionner plusieurs traces pour ajouter ou retirer des tags, changer le sport, ajouter ou retirer des collections, ou les mettre à la corbeille (après confirmation).
- **NAS éteint** : la bibliothèque reste consultable, et une relecture ne retire rien de l'index.

### Analyse de chaque trace

- Distance, dénivelé lissé, points haut et bas, relief selon les seuils de Pédalons (< 8, 8–15, > 15 m/km).
- Vent idéal, selon la méthode de biketeam : la trace part face au vent et revient vent dans le dos.
- Sport lu dans le GPX (`<type>` de Komoot ou Garmin, ou un mot du titre) : Route, Gravel, VTT, Randonnée, Course à pied, Vélo.
- Nom nettoyé (sans `_`, ni date, ni identifiant Openrunner), date lue dans le titre ; l'identifiant retiré est gardé dans les notes.
- Points d'intérêt classés : contrôles, attention, eau, commerces, curiosités, hébergement, services. La correspondance avec chaque plateforme (codes Openrunner, symboles Komoot, gpx.studio et Garmin, mots du nom) est dans un [tableau d'équivalences](crates/traces-core/data/poi-equivalences.md), facile à compléter.

### Fiche d'une trace

- Carte avec bornes kilométriques et bouton « recentrer ».
- Profil coloré selon la pente la plus forte de chaque tronçon. Son curseur se suit sur la carte, et il suit le zoom de la carte.
- **Revêtement** calculé depuis OpenStreetMap (tuiles vectorielles VersaTiles) : asphalte, pavés, stabilisé, chemin. Le profil et la carte sont colorés, avec la part de chaque type en km et en %.
- Au survol d'une légende (pente ou revêtement), le type ressort et les autres s'atténuent.
- Points d'intérêt affichés par catégorie (repliables) ou par km. Le bouton ⋮ au bout d'un POI (ou sa pastille de couleur) change sa catégorie s'il est mal reconnu (pastille entourée quand elle est choisie, « Revenir à la catégorie détectée ») ; le choix tient à la relecture, sert à l'envoi au Karoo et va dans la sauvegarde.
- **Modifier les POI** (bouton « Modifier » de la section Points d'intérêt, si la bibliothèque autorise l'écriture dans les GPX) : cocher des POI pour changer leur catégorie ou les supprimer ; ⋮ pour renommer, déplacer (clic sur la carte ou le profil) ou supprimer un POI ; « Ajouter un POI » puis un clic sur la carte (position exacte) ou le profil (point de la trace), avec un nom et une catégorie. Les modifications sont écrites dans le fichier GPX, vérifiées comme pour les tags.
- **POI proposés depuis OpenStreetMap** (en mode édition des POI, « OpenStreetMap… ») : eau, toilettes et services, commerces, hébergements, curiosités le long de la trace. Pour chaque catégorie, « sur la trace » (30 m) ou à une distance au plus (100 m à 2 km), réglable pour une recherche ou gardé par défaut. Densité, commune à toutes les catégories mais comptée pour chacune à part : « Limiter à N proposition(s) par catégorie tous les X km » (les plus proches de la trace), appliquée tout de suite aux résultats ; et « Ne rien proposer avant le km X » (par exemple pour ne pas chercher de ravitaillement juste après le départ). On coche ceux à ajouter (km et détour indiqués) ; ils sont écrits dans le GPX. Données © contributeurs OpenStreetMap, par l'API Overpass (service public : une recherche peut demander un peu de patience).
- **Renommer la trace** (crayon à côté du titre) : le nom reste en place aux relectures. Le fichier est renommé tout de suite : rangé selon le modèle dans une bibliothèque gérée, renommé dans son dossier dans une bibliothèque indexée qui autorise l’écriture ; le `<name>` du GPX change aussi dans ce cas. « Nom du fichier » reprend le nom écrit dans le GPX.
- Classement en lecture ou en édition : sport, tags, collections, notes.
- **Modifier dans gpx.studio** : la trace s'ouvre dans gpx.studio, dans le navigateur. Une fois exportée, Organisons propose de remplacer la trace (voir Connexions).
- **Envoyer vers le Karoo** (Hammerhead), aussi pour une sélection de traces ou un tour.

### Points d'intérêt

- Onglet **POI** : les points d'intérêt de toutes les traces sur une carte et en liste, regroupés quand plusieurs traces passent au même endroit (même nom à moins de 60 m). Filtres par catégorie, recherche par nom de POI ou de trace, « Sur plusieurs traces » ; tri par nombre de traces, nom, catégorie ou trace. Un lieu choisi montre les traces qui y passent, avec le km ; un clic ouvre la fiche.

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

### Entraînements

- Séances structurées au format Zwift (`.zwo`) : lues dans les bibliothèques, ou importées dans le dossier « Entraînements » d'une bibliothèque gérée.
- **Catégories**, comme dans Zwift : récupération, endurance, tempo, sweet spot, seuil, VO2 max (PMA), anaérobie, sprint, test FTP, mixte. Elles sont détectées d’après la catégorie Zwift du fichier, le nom (« FTP test », « Récup », « PMA »…), puis le profil de puissance ; on peut en choisir une autre sur la séance. Filtre par catégorie et badge sur chaque tuile.
- Graphique de puissance par zone, durée, IF et TSS selon ta FTP.
- Envoi vers le Karoo, Zwift (copie dans son dossier), intervals.icu (planifiée à une date) ou MyWhoosh (ouverture de son Workout Builder).

### Connexions

Tous les services reliés sont dans l'onglet **Connexions** :

- **Pédalons** : connexion au compte (le mot de passe sert une fois ; seul un jeton de session est gardé, dans le gestionnaire d’identifiants de Windows). L’agenda se consulte dans l’onglet **Agenda** : sorties et étapes de voyage de tes équipes (à venir ou passées, toutes ou seulement tes inscriptions), import de leurs parcours, celui de ton groupe si tu es inscrit ; un parcours qui ressemble à une trace existante peut être importé quand même.
- **Komoot** : connexion au compte, liste des parcours planifiés et réalisés, import en lot avec avancement. Le mot de passe n'est pas conservé ; le jeton d'accès est rangé dans le gestionnaire d'identifiants de Windows. Komoot n'a pas d'API publique : Organisons passe par l'API de son site, qui peut changer sans prévenir.
- **Openrunner** : coller les liens des parcours publics. Ils sont téléchargés avec leurs points d'intérêt. Un parcours privé doit être exporté depuis le site.
- **Karoo (Hammerhead)** : connexion au compte par le navigateur (API officielle), puis envoi des traces, avec leurs points d'intérêt, et des séances. Le Karoo les récupère à sa synchronisation.
  - La version publique n'intègre pas d'application Hammerhead : chacun crée la sienne, gratuitement, sur le Dashboard Hammerhead. La marche à suivre est dans l'onglet.
- **Entraînement** : dossier Zwift (trouvé tout seul, OneDrive compris) et compte intervals.icu (clé d'API personnelle).
- **gpx.studio** : dossier surveillé, Téléchargements par défaut.
  - « Modifier dans gpx.studio » sert la trace sur une adresse locale, réservée à gpx.studio pendant 15 minutes.
  - Le GPX exporté arrive dans le dossier surveillé, et Organisons propose de **remplacer la trace** : tags, notes et collections sont gardés, et l'ancienne version va dans la Corbeille. On peut aussi l'**ajouter** comme nouvelle trace, ou l'**ignorer**.
  - Tout GPX déposé dans ce dossier, quelle que soit sa provenance, est proposé de la même façon.

Les autres appareils GPS sont à l’étude.

### Imports

- **Fichiers GPX** dans une bibliothèque gérée : copiés directement à leur place. Les doublons sont détectés avant la copie.
- Komoot, Openrunner et le dossier surveillé : voir Connexions.
- Un parcours déjà présent dans la bibliothèque (même fichier ou même parcours) n'est pas importé une seconde fois.

### Doublons et corbeille

- **Doublons** : fichiers identiques et doublons probables (distance à ±1 %, D+ à ±5 %, départ et arrivée à moins de 300 m, et même sens : vent idéal à 45° au plus, une boucle parcourue à l’envers n’est donc pas un doublon).
  - On peut les traiter un par un ou par lot : on choisit la trace à garder (la plus ancienne, la plus récente, la plus taguée, celle de la bibliothèque gérée) et on met les autres de côté.
  - Un doublon mis de côté est déplacé dans le dossier caché `.organisons-doublons` de sa bibliothèque.
- **Corbeille** : une trace supprimée part dans `.organisons-corbeille`, après confirmation.
  - L'onglet Corbeille liste les traces supprimées et les doublons mis de côté, restaurables un par un.
  - Vidage manuel, ou automatique après 7, 14 ou 30 jours.

### Navigation et apparence

- Alt+← et Alt+→, ou les boutons latéraux de la souris, pour revenir à l'écran précédent ou suivant.
- **Thème clair, sombre ou comme Windows** (Réglages → Apparence). Le thème sombre reprend les couleurs du thème sombre de Vivaldi. Les fonds de carte restent clairs.

## Installer

### Avec l'installateur (Windows)

Télécharger `Organisons_<version>_x64_fr-FR.msi` ou `Organisons_<version>_x64-setup.exe` sur la page [Releases](https://github.com/minicake1/organisons/releases), puis le lancer. L'appli s'installe dans `C:\Program Files\Organisons`. Elle utilise WebView2, déjà présent sur Windows 11. Les installateurs ne sont pas signés : Windows SmartScreen peut afficher un avertissement (« Informations complémentaires » → « Exécuter quand même »).

**Mises à jour** (à partir de la v0.8) : au lancement, Organisons regarde si une nouvelle version est publiée et propose « Installer et redémarrer » ; « Plus tard » ne la repropose plus jusqu'à la suivante. Réglages → Mises à jour pour vérifier à la demande. Le paquet téléchargé est vérifié par la clé de mise à jour du projet avant l'installation ; Windows demande l'autorisation administrateur, comme pour la première installation.

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
npm run build:public   # installateurs .msi et .exe à diffuser, dans target/release/bundle
```

Au premier lancement, ajoute un dossier de GPX dans **Réglages**.

#### Application Hammerhead intégrée (facultatif, usage personnel)

Comme Pédalons, Organisons peut intégrer une application Hammerhead, pour que « Connecter mon compte » suffise. Ses identifiants se mettent dans `src-tauri/hammerhead.local.env`, jamais versionné :

```
HAMMERHEAD_CLIENT_ID=…
HAMMERHEAD_CLIENT_SECRET=…
HAMMERHEAD_REDIRECT_URI=http://localhost:3001
```

`npm run tauri build` les intègre alors à l'exécutable, où ils sont lisibles : **ces installateurs ne doivent pas être diffusés**. Pour diffuser, utiliser `npm run build:public`. Il ignore ce fichier, puis vérifie qu'aucun de ces identifiants ne se trouve dans l'exécutable ni dans les installateurs.

## Sauvegarde de la configuration

Réglages → **Sauvegarde de la configuration** : un fichier JSON pour retrouver sa configuration après une réinstallation, un crash ou sur un autre PC.

- Il contient les bibliothèques et leurs réglages, les tags (détection, mots-clés), les collections et les tours, et pour chaque trace le nom et le sport choisis, les tags, les notes ; plus le thème, la FTP et le dossier Zwift.
- Les traces sont retrouvées par l’empreinte de leur fichier, même si la bibliothèque a changé de place.
- La restauration montre d’abord un aperçu. Elle ne supprime rien et ne modifie pas les fichiers GPX.
- **Sauvegarde automatique** en option : une fois par jour au lancement, dans le dossier de ton choix (par exemple sur le NAS), en gardant les 3 dernières.
- Les mots de passe et jetons n’y sont jamais : il faut reconnecter Komoot, Hammerhead et intervals.icu après une restauration.

## Données et sécurité des fichiers

- L'index est dans `%APPDATA%\fr.organisons.app\index.sqlite`. La version de développement utilise `index-dev.sqlite`, une copie faite au premier lancement. Supprimer l'index remet l'appli à zéro : la sauvegarde de la configuration permet de tout retrouver ; sans elle, seuls les tags et notes écrits dans les GPX reviennent à la relecture.
- Tes fichiers GPX ne sont modifiés ou déplacés que si tu l'as demandé :
  - écriture des tags, des notes et du nom choisi (option par bibliothèque) ;
  - rangement validé dans l’aperçu, ou renommage d’une trace (son fichier suit) ;
  - remplacement par une version modifiée dans gpx.studio, l'ancienne allant dans la Corbeille ;
  - doublon mis de côté ou trace mise à la corbeille, ce qui reste récupérable jusqu'au vidage.
- Les fichiers du dossier surveillé (Téléchargements) ne sont jamais modifiés ni supprimés.
- Rien n'est supprimé définitivement sans confirmation, sauf par le vidage automatique, si on l'a activé.
- Les mots de passe ne sont pas conservés. Les jetons et clés (Komoot, Hammerhead, intervals.icu) sont rangés dans le gestionnaire d'identifiants de Windows.

## Organisation du code

```
crates/traces-core/     cœur Rust sans interface, testé seul
  src/analyze.rs        distance, dénivelé, pente, vent, POI, profil
  src/index.rs          base SQLite : traces, tags, collections, tours, doublons, entraînements, réglages
  src/scan.rs           parcours des dossiers, empreinte SHA-256, tags et notes relus dans le GPX
  src/gpxmeta.rs        écriture des tags, notes, nom et POI (<wpt>), fichier inchangé par ailleurs
  src/organize.rs       rangement, import, remplacement, POI modifiés, doublons mis de côté, corbeille
  src/naming.rs         nom nettoyé, date du titre, identifiant Openrunner
  src/autotags.rs       tags proposés
  src/sport.rs          sport d'après le GPX ou le titre
  src/surface.rs        revêtement depuis les voies OpenStreetMap
  src/tour.rs           export des tours
  src/workout.rs        séances .zwo
  src/device.rs         GPX préparé pour un appareil
  src/poi.rs            reconnaissance des POI d’après data/poi-equivalences.md
  src/osm.rs            POI proposés depuis OpenStreetMap (requêtes Overpass, distance à la trace)
  tests/brm600.rs       tests sur une trace synthétique au format Openrunner (fixtures/boucle-600.gpx)
src-tauri/src/          application Tauri : commandes (lib.rs), Komoot, Openrunner, Hammerhead,
                        Zwift et intervals.icu (training.rs), Pédalons, gpx.studio et dossier surveillé,
                        OpenStreetMap (osm.rs), client HTTP commun
src/                    interface React : pages Bibliothèque, Fiche, Tour, Collections, POI, Tags,
                        Agenda, Doublons, Entraînements, Connexions, Corbeille, Réglages
scripts/build-public.mjs  installateurs à diffuser, vérifiés sans secret
```

Les notes de développement (règles de conception, choix validés par version, pièges connus, feuille de route détaillée) sont dans [organisons.md](organisons.md).

## Tests

```bash
cargo test -p traces-core          # cœur : analyse, index, rangement, tours, corbeille, remplacement…
npm run build                      # vérification des types et build de l'interface
cargo run -p traces-core --example indexer -- "D:\GPX"   # indexer un dossier sans interface
```

Ces vérifications tournent aussi automatiquement sur GitHub (GitHub Actions, `.github/workflows/ci.yml`) à chaque push sur `main` et sur chaque pull request : tests du cœur et build de l’interface sous Linux, compilation et tests de l’application sous Windows, sans application Hammerhead intégrée.

## Feuille de route

- **Autres appareils GPS** : à l’étude.
- **Plus tard** : version macOS, éditeur intégré, fonds de carte sombres.

## Crédits

Organisons v0.8, sous licence [GNU AGPL v3 ou ultérieure](LICENSE). Code source : [github.com/minicake1/organisons](https://github.com/minicake1/organisons). Les mêmes crédits sont dans l'appli, Réglages → À propos et crédits.

### Données cartographiques

© [contributeurs OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL) ; fonds de carte [OpenFreeMap](https://openfreemap.org) (© OpenMapTiles) ; tuiles du revêtement [VersaTiles](https://versatiles.org).

### Services reliés

[gpx.studio](https://gpx.studio) (éditeur open source, licence MIT), Pédalons, Komoot, Openrunner, Hammerhead, Zwift, intervals.icu et MyWhoosh. Ces noms et marques appartiennent à leurs propriétaires ; Organisons n'est affilié à aucun d'eux. Komoot est utilisé par son API interne, non officielle.

### Logiciels libres utilisés

[Tauri](https://tauri.app), Rust, [React](https://react.dev), [Mantine](https://mantine.dev), [MapLibre GL JS](https://maplibre.org), [Tabler Icons](https://tabler.io/icons), SQLite (rusqlite), gpx, roxmltree, ureq, keyring, @mapbox/vector-tile et pbf, ainsi que leurs dépendances, chacun sous sa propre licence.

## Licence

[GNU AGPL v3 ou toute version ultérieure](LICENSE) (`AGPL-3.0-or-later`), © minicake1.

- Utilisation, modification et redistribution autorisées, y compris à des fins commerciales.
- Toute version redistribuée, modifiée ou non, doit rester sous la même licence et donner accès à son code source.
- Une version modifiée proposée à d'autres par le réseau (site web, serveur) doit aussi donner accès à son code source.

Jusqu'à la v0.5.1, Organisons était sous PolyForm Noncommercial 1.0.0.
