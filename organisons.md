# Organisons

Application de bureau personnelle pour classer, filtrer et préparer des traces GPX vélo.
Elle s'inspire de Pédalons (https://github.com/glandais/pedalons) et de biketeam (https://github.com/tomacla/biketeam).
Stack : Tauri 2, cœur en Rust (`crates/traces-core`), interface React 18 + Mantine 7 + MapLibre.
Tout le texte visible par l'utilisateur est en français.

## Commandes

- `npm install` puis `npm run tauri dev` : lance l'appli
- `cargo test -p traces-core` : tests du cœur, dont une vraie trace (BRM 600 Tour de Manche, Openrunner, 182 waypoints)
- `npm run build` : contrôle des types TypeScript et build de Vite
- `cargo run -p traces-core --example indexer -- <dossier> [base.sqlite]` : indexation en ligne de commande

## Architecture

- `crates/traces-core` : aucune dépendance à Tauri.
  - `analyze.rs` : distance haversine ; altitude ré-échantillonnée tous les 50 m puis lissée sur 250 m ; D+ calculé avec un seuil de 3 m ; pente locale sur 200 m ; `slopeMax` par tronçon de profil ; vent idéal ; classement des POI ; profil de 200 à 2000 points.
  - `index.rs` : SQLite (rusqlite, version embarquée), filtres et tri, collections, tags, doublons (identiques par empreinte, probables par distance ±1 %, D+ ±5 % ou 30 m, départ et arrivée < 300 m). Les colonnes ajoutées après la v0.1 passent par `migrate()` (ALTER TABLE si absente) ; les nouvelles tables par `CREATE TABLE IF NOT EXISTS`.
  - `scan.rs` : parcours récursif des dossiers (dossiers commençant par `.` ignorés), empreinte SHA-256, fichiers inchangés ignorés (taille et date identiques). Relit les tags et notes Organisons présents dans le GPX. `write_trace_meta` écrit dans le GPX si la bibliothèque l'autorise, puis met à jour l'état du fichier dans l'index.
  - `gpxmeta.rs` : bloc `<organisons:meta>` (espace de noms `https://github.com/minicake1/organisons/gpx/1`) dans les `<extensions>` de `<gpx>`. Édition textuelle, le reste du fichier reste identique octet pour octet (ne pas réécrire avec le crate `gpx`, qui perdrait les extensions d'Openrunner et Garmin). Écriture refusée si le fichier n'est pas en UTF-8 ou si le nombre de points change ; fichier temporaire puis renommage.
  - `organize.rs` : rangement des bibliothèques gérées (`plan` → aperçu, `apply` → déplacements revérifiés un par un), `import_files` (copie à sa place), `set_aside` (doublon déplacé dans `.organisons-doublons`). Variables du modèle : `{sport}`, `{annee}`/`{année}`, `{mois}`, `{source}`, `{collection}`, `{nom}`.
  - `naming.rs` : nom affiché et `{nom}` nettoyés dès l’analyse (`analyze.rs`) (`_` → espaces, identifiant Openrunner final `-15424659` et date retirés) ; la date du titre (`2022_2708`, `2025-06-14`, `14/06/2025`, `20250614`, année seule) prime pour `{annee}`/`{mois}` (l’heure des points Openrunner est celle de l’export). L’identifiant retiré (`route_id`) est ajouté aux notes à la première lecture seulement (lien `openrunner.com/route-details/…`).
  - `sport.rs` : `<type>` du GPX → dossier français (Route, Gravel, VTT, Randonnée, Course à pied ; Vélo par défaut). Komoot : `mtb_easy` = Gravel. Sans `<type>` (Openrunner), mot du titre (gravel, VTT, rando). Choix sur la fiche dans `sport_user`. `ANALYSIS_VERSION` (index.rs) fait relire tous les fichiers une fois quand ces règles changent.
  - Le sport remplace le « type de revêtement » manuel (colonne `surface_type` gardée mais plus utilisée) : filtre de la Bibliothèque, badge coloré (`SportBadge`, `SPORT_COLORS` : Route bleu, Gravel vert foncé, VTT marron, Vélo violet, Randonnée jaune, Course à pied orange).
  - `surface.rs` : revêtement OSM, comme Pédalons (osm-route-details lit les tuiles Shortbread). `src/osmSurface.ts` télécharge les tuiles VersaTiles z14 (`https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}`, couche `streets` : `kind`, `surface`, `tracktype`) qui couvrent la trace, 6 en parallèle, et garde les voies à ~100 m ; `match_surface` (échantillons tous les 50 m, voie à moins de 25 m, préférée dans le sens de la trace, tronçons < 120 m absorbés). Stocké dans `trace_surface` avec une empreinte de géométrie (`geom_key`). Overpass abandonné : trop lent sur 600 km.
- `src-tauri/src/lib.rs` : commandes exposées à l'interface. Paramètres en snake_case côté Rust, camelCase côté JS. L'index est dans le dossier de données de l'appli (`index.sqlite`).
- `src/` : pages Bibliothèque, Fiche trace, Collections, Tags, Doublons et Réglages. `labels.ts` contient les libellés, les couleurs et `niceStep` (pas des graduations adaptés à la longueur et au dénivelé).
- Pas de Python sur le PC de développement (Windows) : faire les modifications de fichiers avec les outils d'édition ou `sed`.

## Règles de conception validées (maquettes v0.1 du 09/11/2026)

- Relief selon les seuils de Pédalons : Plat < 8 m/km, Vallonné de 8 à 15, Montagneux > 15.
- Vent idéal selon la méthode de biketeam / gpx2web : moyenne des directions entre le départ et chaque point, puis la direction cardinale la plus proche (aller face au vent, retour vent dans le dos). Filtre vent avec option ±45°. Abréviations françaises affichées (O pour Ouest ; « W » en interne).
- Catégories de POI :

  | Catégorie | Code Openrunner | Affichée par défaut |
  |---|---|---|
  | Contrôle | 1 | oui |
  | Attention | 15 ou 16 | oui |
  | Eau | 104 | non |
  | Commerces | 50 | non |
  | Curiosités | 60 | non |

  Viennent ensuite les symboles Garmin, puis le nom du POI.
- Bibliothèque : filtres de Pédalons + source, tags, tri croissant ou décroissant. 4 affichages dans cet ordre : grille, liste + carte (seule la trace sélectionnée, carte centrée dessus), liste, carte.
- Fiche trace :
  - le profil est coloré selon la pente la plus forte du tronçon, pour ne pas lisser les passages raides ;
  - le curseur du profil place un point sur la carte et surligne la partie parcourue ;
  - les bornes kilométriques (fond blanc transparent à 60 %) sont tous les distance ÷ 7, arrondi « rond » ;
  - l'info-bulle donne km, pente, altitude, D+/D− cumulés et heure de passage si le GPX a des horaires ;
  - POI filtrables par catégorie et un par un, avec une case générale « afficher sur la carte ».
- Stockage : NAS en bibliothèque « gérée », rangée selon `{sport}/{année}/{nom}.gpx` ; PC indexé sur place ; doublons Komoot → demander à l'utilisateur.
- Fond de carte OpenFreeMap (sans clé). Repli sur un fond uni hors ligne.
- Carte : noms des POI masqués en dessous du zoom 11 (`POI_LABEL_MIN_ZOOM`), nom au survol de la pastille.

## Choix validés pour la v0.2 (09/11/2026)

- Écriture des tags et notes dans le GPX : **option par bibliothèque** (activée par défaut pour une bibliothèque gérée, désactivée pour une bibliothèque indexée sur place).
- Rangement : **aperçu puis déplacement**. Les fichiers déjà présents ne bougent qu'après validation ; les fichiers importés par l'appli sont rangés directement (copie, l'original reste).
- `{sport}` : tiré du champ `<type>` du GPX, modifiable sur la fiche.
- Doublons : « Mettre de côté » déplace dans `.organisons-doublons`, en préfixant le nom par la date du jour (`AAAA-MM-JJ nom.gpx`), qui sert à calculer l'ancienneté (un déplacement garde la date du fichier). Vidage manuel avec confirmation, ou automatique après 7, 14 ou 30 jours (réglage `set_aside_purge_days` dans la table `settings`, appliqué au démarrage et à chaque relecture). « Ce ne sont pas des doublons » mémorise la paire (`not_duplicates`).
- Importer et Ranger sont disponibles dans la Bibliothèque et dans les Réglages (composant `ManagedActions`).
- Vignettes : une seule carte MapLibre cachée (`thumbRenderer.ts`) rend les vignettes visibles une par une en JPEG, gardées en mémoire pendant la session ; dessin SVG simple en attendant ou hors ligne.
- POI sur la carte : info-bulle MapLibre (`.poi-tip`) aux coins arrondis, de la couleur de la catégorie. Liste des POI de la fiche groupée par catégorie (par défaut) ou triée par km.
- Mantine 7 : `Group` n'accepte pas `component="form"`, il faut un vrai `<form>` autour.

Maquettes (canevas claude.ai, version « v0.1 ») : https://claude.ai/artifact/UgMG2meavfQnAP5ptqqBpY

## Build et dépôt

- Lancement sous Windows 11 validé le 09/11/2026 (`npm run tauri dev`).
- Build validé le 09/11/2026 (`npm run tauri build`, environ 5 min) : `target/release/organisons.exe` et les installateurs `bundle/nsis/*-setup.exe` (3,3 Mo) et `bundle/msi/*.msi` (4,6 Mo), en français (`bundle.windows` de `tauri.conf.json`). Les deux installent pour tout l’ordinateur, dans Program Files (`installMode: perMachine`). Fermer `target/release/organisons.exe` avant un build, sinon erreur « fichier utilisé ».
- L’installateur n’embarque aucune donnée : l’index est dans `%APPDATA%/fr.organisons.app/index.sqlite`.
- Dépôt GitHub privé : https://github.com/minicake1/organisons (`gh` installé dans `C:\Program Files\GitHub CLI\`).

## Feuille de route

### v0.3 : finitions et réglages
- **Vignettes** : en passant de fenêtre à plein écran, elles ne se redessinent pas toutes seules (Ctrl+R nécessaire). Piste : recalculer à la taille du cadre (ResizeObserver) dans `TrackThumb.tsx`.
- **Données de développement** : `npm run tauri dev` et la version installée partagent le même index (même identifiant d’appli). Les séparer ; la version installée garde la bibliothèque actuelle.
- **Réglages** : modèle de rangement modifiable (la maquette Stockage montre un champ et les variables), détection des doublons à l’import, cache hors ligne du NAS.
- **Tags automatiques** : proposer des tags détectés dans le titre et les métadonnées du GPX (`<desc>`, `<keywords>`, `<type>`, créateur…), par exemple « BRM », « 600 », « Gravel » ; à valider ou appliquer selon un réglage.
- **Tri par sport** dans la Bibliothèque (en plus des tris actuels).

### v0.4 : tours
- **Tours** : une collection de type « tour » qui regroupe plusieurs traces (étapes) dans une seule vue : carte avec toutes les étapes, profil enchaîné, bornes et POI de l’ensemble.
- Chiffres pour le tour entier (distance, D+/D−, revêtement, nombre d’étapes) ou pour chaque GPX séparément (sélection d’une étape).
- Ordre des étapes modifiable ; export possible du tour en un seul GPX ou étape par étape.

### v0.5 : Komoot
- Pas d’API publique, seulement une API partenaire B2B. Passer par l’API interne `https://api.komoot.de/v007/` (identifiants stockés dans le trousseau du système) ; peut cesser de fonctionner à tout moment.

### v0.6 : appareils GPS
- Garmin et Wahoo réservent leur API à des partenaires. Mode recommandé : passer par le compte Pédalons ; sinon copie USB dans `Garmin\NewFiles` vers un Edge.

### Plus tard : agenda Pédalons
- Le flux ICS ne contient que des liens vers les sorties, pas de GPX. Il faudra l’API de Pédalons avec le compte de l’utilisateur ; Pédalons n’a pas de clé d’accès personnelle, à ajouter côté Pédalons.
