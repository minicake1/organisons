# Organisons — v0.2

Application de bureau pour classer, filtrer et préparer ses traces GPX, dans l'esprit de Pédalons.
Tauri 2 (cœur en Rust) + React, Mantine et MapLibre.

## Ce que fait la v0.1

- **Bibliothèques** : ajout d'un dossier sur le PC ou sur le NAS (lecteur réseau ou chemin `\\NAS\…`), indexation récursive des `.gpx`. Une relecture ne réanalyse que les fichiers modifiés et retire ceux qui ont disparu.
- **Analyse de chaque GPX** (crate `traces-core`) :
  - distance (haversine) ;
  - dénivelé lissé sur 250 m avec seuil de 3 m ;
  - points haut et bas ;
  - relief selon les seuils de Pédalons (< 8, 8–15, > 15 m/km) ;
  - vent idéal (méthode de biketeam : la trace part face au vent et revient vent dans le dos) ;
  - points d'intérêt classés en contrôles, alertes, eau, commerces et curiosités (codes Openrunner, symboles Garmin, puis nom) ;
  - profil de 200 à 2 000 points avec pente locale, pente la plus forte du tronçon et heures de passage.
- **Bibliothèque** :
  - filtres de Pédalons (recherche, distance, D+, relief, revêtement, direction du vent) plus source, tags, vent ±45° et tri croissant ou décroissant ;
  - 4 affichages : grille, liste + carte centrée sur la trace sélectionnée, liste, carte de toutes les traces.
- **Fiche trace** :
  - carte avec bornes kilométriques adaptées à la longueur ;
  - profil coloré par pente, dont le curseur déplace un point sur la carte et surligne la partie parcourue ;
  - points d'intérêt filtrables par catégorie ou un par un ;
  - tags, notes et type de revêtement enregistrés dans l'index.
- **Fond de carte** : OpenFreeMap (gratuit, sans clé). Sans internet, la carte passe sur un fond uni et la trace reste visible.

## Nouveautés de la v0.2

- **Noms des points d'intérêt** masqués sur une vue d'ensemble (zoom < 11), affichés en zoomant ; le nom reste visible au survol de la pastille.
- **Tags et notes dans le GPX** : option par bibliothèque (activée par défaut pour une bibliothèque gérée). Ils sont écrits dans `<extensions>` sans toucher au reste du fichier, et relus si l'index est remis à zéro. Le fichier modifié est vérifié (même nombre de points) avant de remplacer l'original.
- **Sport** : lu dans le champ `<type>` du GPX (Komoot, Garmin…) et modifiable sur la fiche : Route, Gravel, VTT, Randonnée, Course à pied, Vélo par défaut.
- **Bibliothèques gérées** :
  - « Importer des GPX… » copie les fichiers directement à leur place ; les originaux ne bougent pas ;
  - « Ranger… » montre d'abord la liste des déplacements, et rien ne bouge avant validation ;
  - modèle `{sport}/{annee}/{nom}.gpx`, avec aussi `{mois}`, `{source}` et `{collection}` ;
  - noms rendus compatibles avec Windows et les NAS, numérotés « (2) » en cas de doublon de nom ; dossiers vidés supprimés.
- **Écran Tags** : nombre de traces par tag, renommage (fusion si le nom existe déjà), suppression. Les GPX concernés sont réécrits.
- **Écran Collections** : listes nommées de traces, une trace pouvant appartenir à plusieurs. On les remplit depuis la fiche, et on les filtre dans la Bibliothèque.
- **Écran Doublons** : fichiers identiques et doublons probables (même distance, D+, départ et arrivée). Rien n'est supprimé : « Mettre de côté » déplace le fichier dans le dossier caché `.organisons-doublons` de sa bibliothèque.

Toujours prévu (déjà présent dans les maquettes) :
- synchronisation Komoot ;
- Agenda Pédalons ;
- envoi vers Garmin, Hammerhead et Wahoo, et copie USB vers un Edge ;
- revêtement calculé depuis OpenStreetMap ;
- modèle de rangement modifiable dans les Réglages.

## Installer et lancer (Windows)

1. Installer les prérequis Tauri : https://v2.tauri.app/start/prerequisites/
   - Rust (rustup), avec la chaîne MSVC ;
   - Microsoft C++ Build Tools (« Développement Desktop en C++ ») ;
   - WebView2, déjà présent sur Windows 11.
2. Installer Node.js 20 ou plus récent.
3. Dans le dossier du projet :

```bash
npm install
npm run tauri dev      # lance l'appli en développement
npm run tauri build    # produit l'installateur (.msi / .exe) dans target/release/bundle
```

Au premier lancement, va dans **Réglages** puis **Choisir le dossier…** et sélectionne ton dossier de GPX.

L'index est enregistré dans `%APPDATA%\fr.organisons.app\index.sqlite`. Le supprimer remet l'appli à zéro (les tags et notes écrits dans les GPX reviennent à la relecture). Tes fichiers GPX ne sont modifiés que si tu l'as autorisé : écriture des tags et notes (option par bibliothèque), rangement validé dans l'aperçu, doublon mis de côté.

## Organisation du code

```
crates/traces-core/   cœur Rust sans interface : analyse GPX, index SQLite, scan des dossiers
  src/analyze.rs      calculs (distance, dénivelé, pente, vent, POI, profil)
  src/index.rs        base SQLite, filtres et tri
  src/scan.rs         parcours des dossiers, empreinte SHA-256 (doublons)
  tests/brm600.rs     tests sur le BRM 600 Tour de Manche (fichier réel)
  examples/indexer.rs indexation en ligne de commande
src-tauri/            application Tauri : commandes exposées à l'interface
src/                  interface React (pages Bibliothèque, Fiche trace, Réglages)
```

## Inspirations

Organisons est un projet indépendant, écrit de zéro : il ne reprend pas le code des projets ci-dessous, seulement des idées et des règles de calcul.

- [Pédalons](https://github.com/glandais/pedalons) (Gabriel Landais, PolyForm Noncommercial 1.0.0) : seuils de relief (< 8, 8–15, > 15 m/km), filtres de la bibliothèque, catégories de revêtement.
- [biketeam](https://github.com/tomacla/biketeam) (tomacla) : méthode du vent idéal (aller face au vent, retour vent dans le dos), reprise de gpx2web.

Si du code de Pédalons est un jour repris (par exemple pour le calcul du revêtement), il faudra le signaler ici et conserver sa mention de copyright.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md), la même licence que Pédalons : utilisation, modification et redistribution autorisées, sauf à des fins commerciales.

## Tests

```bash
cargo test -p traces-core
# Indexer un dossier sans interface :
cargo run -p traces-core --example indexer -- "D:\GPX"
```
