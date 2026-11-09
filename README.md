# Organisons — v0.1

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

Prévu en v0.2 (déjà présent dans les maquettes) :
- synchronisation Komoot ;
- Agenda Pédalons ;
- envoi vers Garmin, Hammerhead et Wahoo, et copie USB vers un Edge ;
- rangement automatique des fichiers dans une bibliothèque gérée ;
- écriture des tags et notes dans le GPX ;
- revêtement calculé depuis OpenStreetMap ;
- écrans Doublons, Collections et Tags.

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

L'index est enregistré dans `%APPDATA%\fr.organisons.app\index.sqlite`. Le supprimer remet l'appli à zéro ; tes fichiers GPX ne sont jamais modifiés.

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
