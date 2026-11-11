# Organisons

Application de bureau personnelle pour classer, filtrer et préparer des traces GPX vélo.
Elle s'inspire de Pédalons (https://github.com/glandais/pedalons) et de biketeam (https://github.com/tomacla/biketeam).
Stack : Tauri 2, cœur en Rust (`crates/traces-core`), interface React 18 + Mantine 7 + MapLibre.
Tout le texte visible par l'utilisateur est en français.

## Commandes

- `npm install` puis `npm run tauri dev` : lance l'appli
- `cargo test -p traces-core` : tests du cœur, dont une trace synthétique au format Openrunner (`tests/fixtures/boucle-600.gpx`, 605 km, 182 POI, régénérable avec `node crates/traces-core/tests/fixtures/generer-boucle.mjs`)
- `npm run build` : contrôle des types TypeScript et build de Vite
- `npm run build:public` : installateurs à diffuser (sans l’application Hammerhead intégrée, vérifiés)
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
  - `tour.rs` : export des tours (un GPX, une piste par étape, ou étape par étape).
  - `workout.rs` : lecture des `.zwo` (blocs, durée, IF, TSS).
  - `device.rs` : GPX préparé pour un appareil (POI Hammerhead, nom de fichier ASCII, multipart).
  - `scan.rs` : `scan_library_shared` prend l'index fichier par fichier (trait `IndexAccess`, `Mutex<Index>`) : l'interface reste utilisable pendant une relecture.
  - `organize.rs` : aussi `replace_trace_file` (version modifiée à la place du GPX, ancienne dans la corbeille, tags/notes/collections gardés).
- `src-tauri/src/` :
  - `lib.rs` : commandes exposées à l'interface. Paramètres en snake_case côté Rust, camelCase côté JS. Tout travail long (fichiers, NAS, réseau) passe par `blocking()` (hors du fil principal, sinon la fenêtre se fige). L'index est dans le dossier de données de l'appli (`index.sqlite`, `index-dev.sqlite` en dev).
  - `http.rs` : client HTTP commun (délai 60 s, `Organisons/<version>`) et messages d'erreur.
  - `komoot.rs`, `openrunner.rs` : imports. `hammerhead.rs` : Karoo. `training.rs` : Zwift et intervals.icu. `gpxstudio.rs` : gpx.studio et dossier surveillé.
- `src/` : pages Bibliothèque, Fiche trace, Tour, Collections, Tags, Doublons, Entraînements, Connexions, Corbeille et Réglages. `labels.ts` contient les libellés, les couleurs et `niceStep` (pas des graduations adaptés à la longueur et au dénivelé).
- **Thème sombre** (v0.6) : Mantine `defaultColorScheme="auto"`, choix Clair / Sombre / Comme Windows dans Réglages → Apparence (mémorisé par Mantine dans le navigateur de l'appli). Ne pas écrire de couleurs de fond ou de texte en dur : utiliser les variables Mantine (`var(--mantine-color-teal-light)`, `-light-color`, `--mantine-color-body`, `--mantine-color-text`, `--mantine-color-dimmed`, `--mantine-color-default-border`, `--mantine-color-default-hover`). Les couleurs de données (pentes, revêtements, sports, zones, étapes) restent fixes. Les fonds de carte restent clairs.
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

## Choix validés pour la v0.3 (09/11/2026)

- **Tags automatiques** (`autotags.rs`) : règles intégrées, plus les tags de l’utilisateur avec « Détection auto » et leurs mots-clés (onglet Tags, `tag_names.auto` et `tag_names.keywords` ; activer la détection met le nom du tag dans ses mots-clés, que l’on peut ensuite retirer ; ajouter un mot-clé active la détection ; recherche `text_has_tag` dans `traces.hint_text` : titre brut, `<desc>`, `<keywords>`). Tags créables sans trace (`tag_names`). détectés dans le titre brut, `<desc>` et `<keywords>` (BRM + distance, brevet, audax, gravel…), **proposés à valider** : badge « + » pour ajouter, « × » pour ne plus proposer (`tags_ignored`). Sur la fiche et juste après un import.
- **Doublons à l’import** (`organize::check_import`) : avant la copie, fenêtre « fichier identique » / « même parcours probable » (mêmes critères que la page Doublons, `index::similar_routes`) ; l’utilisateur coche ce qu’il importe.
- **NAS hors ligne** : consultation seule depuis l’index. `scan_library` refuse un dossier injoignable et ne retire rien après une lecture incomplète (sinon tags, notes et collections étaient perdus). `offline_libraries` (vérifié en parallèle) masque Importer/Ranger et grise « Ouvrir le dossier ».
- **Modèle de rangement** modifiable dans Réglages (`PatternEditor`, `organize::validate_pattern` : chemin relatif, variables connues, `{nom}` dans le nom du fichier ; exemple affiché).
- **Tri par sport** ; tri par nom « naturel » (collation SQLite `NATUREL`, `index::natural_cmp` : np#2 avant np#10 ; `NATURAL` est un mot réservé) ; vignettes redessinées quand leur cadre change de taille (ResizeObserver).
- **Collections** : ouvrir une collection l’affiche dans l’onglet Collections (route `collection`, `LibraryPage` avec `onBack`), avec tous les affichages et filtres.
- **Modification par lot** : bouton « Sélectionner » (Bibliothèque et vue de collection), cases sur les tuiles et les lignes, barre « N sélectionnée(s) », fenêtre `BatchEditModal` : ajouter/retirer des tags, changer le sport (vide = retour au GPX), ajouter (création par nom) ou retirer des collections. `Index::batch_edit`, puis réécriture des GPX dont les tags changent.
- **Suppression d’une trace** : croix sur la tuile, corbeille en bout de ligne (liste, liste + carte), bouton « Supprimer » sur la fiche ; toujours confirmée (`TrashButton`). Le GPX va dans `.organisons-corbeille` de sa bibliothèque (`organize::trash_trace`, préfixe date), récupérable jusqu’au vidage : onglet Corbeille (au-dessus de Réglages, `TrashPage`) avec la liste, « Restaurer » (`restore_from_trash` : retour à la racine de la bibliothèque sous le nom d’origine, réindexé) et le vidage manuel ou auto 7/14/30 jours (`trash_purge_days`). Icônes de suppression à 45 % d’opacité, 100 % au survol (`.trash-faded`). Même mécanisme que les doublons mis de côté (`move_aside`, `purge_aside`).
- **Données de développement séparées** : `npm run tauri dev` utilise `index-dev.sqlite` (copie de `index.sqlite` au premier lancement) ; la version installée garde `index.sqlite`.

## Choix validés pour la v0.4 (10/11/2026)

- **Navigation** : historique des écrans visités (50 au plus, l’écran seulement : filtres et défilement non gardés), Alt+← / Alt+→ et boutons latéraux de la souris, sans flèches à l’écran (`App.tsx`, `nav`).
- **Onglet Corbeille** : bascule « Traces supprimées » / « Doublons mis de côté » (`organize::set_aside_list`) ; « Restaurer » marche pour les deux (`restore_from_trash`).
- **Doublons par lot** : cases sur les groupes (« Tout », « Les identiques »), règle de la trace gardée (plus ancienne, plus récente, plus de tags, bibliothèque gérée ; repère « Gardée » / « Mise de côté »), « Mettre les autres de côté » confirmé, ou « Pas des doublons ».
- **Imports Komoot et Openrunner** : un parcours déjà présent (même fichier ou même parcours, ex. exporté à la main) est ignoré et noté comme importé (`import_one` dans `lib.rs`, liste `skipped` du rapport).
- **Tours** : une collection devient un tour (interrupteur dans Collections, `collections.is_tour`) ; étapes ordonnées par date puis nom à l’activation (`collection_traces.position`, gardé quand une trace change d’autres collections), ordre modifiable en glissant la poignée ⋮⋮ des étapes (événements de pointeur, pas le glisser-déposer HTML que Tauri intercepte sous Windows). Vue `TourPage` : carte et profil enchaînés (km, D+ et D− cumulés), couleur par étape ou pente, chiffres du tour ou d’une étape. Export (`tour.rs`) : un GPX avec une piste par étape (« 01 - nom ») et tous les POI, ou étape par étape dans un dossier.
- **Openrunner** (`src-tauri/src/openrunner.rs`, onglet Openrunner) : coller des liens de parcours ; les parcours publics se téléchargent sans compte (`api.openrunner.com/api/v2/routes/{id}/export/gpx-track`, avec les POI), un parcours privé est refusé (export manuel). Import un par un (`openrunner-progress`), parcours déjà importés mémorisés (`external_imports`, source « openrunner »).
- **Komoot** (`src-tauri/src/komoot.rs`, API interne non officielle) : connexion `GET /v006/account/email/{email}/` en Basic → identifiant et jeton, rangés dans le gestionnaire d’identifiants Windows (crate `keyring`, mot de passe non conservé) ; liste `/v007/users/{id}/tours/` (planifiés et réalisés) ; GPX `/v007/tours/{id}.gpx`. Import parcours par parcours (téléchargement puis `import_files`, index verrouillé le temps d’un parcours), avancement envoyé par l’événement `komoot-progress` (barre dans l’onglet), parcours déjà importés mémorisés (`external_imports`). Tour : sélection et modification par lot des étapes, corbeille par étape ; survol d’une étape = les autres atténuées à 40 % et halo jaune sur la carte (`TraceMap` `glow`) ; légende des pentes avec la même mise en avant.

## Choix validés pour la v0.5 (10/11/2026)

- **Hammerhead (Karoo)**, validé le 10/11/2026 (connexion, envoi, POI présents sur le Dashboard).
  - Comme Pédalons, l'application Organisons peut être intégrée au build (`src-tauri/hammerhead.local.env`, non versionné, lu par `build.rs`) : l'utilisateur n'a qu'à « Connecter mon compte ». Sinon, ou avec « Avancé », il saisit sa propre application.
  - `hammerhead.rs` : connexion par le navigateur, serveur local sur le port de l'adresse de retour (défaut `http://localhost:3001`, écoute 127.0.0.1 et ::1), jeton renouvelé ; une nouvelle connexion remplace celle qui attendait. Piège : le remplissage automatique mettait l'e-mail dans le champ Client ID (page de confirmation vide), désormais bloqué et vérifié.
  - API `api.hammerhead.io/v1` : `POST /routes/file` (GPX en multipart), `PUT /routes/{id}/file`, `DELETE /routes/{id}`, `POST /workouts/file` (.zwo) ; scopes `route:write workout:write`. POI : 9 types seulement (Food, Water, Parking, Camping, Lodging, Geocache, Summit, Generic, Danger). Envois mémorisés (`device_sends`, `workout_sends`).
- **Entraînements** : onglet Entraînements (`WorkoutsPage`), `.zwo` lus par `workout.rs` (blocs, intervalles déroulés, durée, IF par puissance normalisée, TSS = h × IF² × 100), indexés à la relecture (table `workouts`), import dans le dossier « Entraînements » d'une bibliothèque gérée, graphique par zone (`WorkoutChart`, FTP mémorisée), envoi vers le Karoo, Zwift (copie dans `Documents\Zwift\Workouts\<id>`, OneDrive compris), intervals.icu (API officielle, clé personnelle, `POST /athlete/{id}/events` en `WORKOUT`, validé le 10/11/2026) et MyWhoosh (pas d'API : ouverture de workout.mywhoosh.com/workouts-library et du fichier).
- **v0.5.1** (revue de code) : relecture et écriture des GPX hors du fil principal, numérotation « (2) » qui garde l'extension, identifiant Openrunner limité à 7 chiffres collés au tiret (les codes postaux restent), sélection par lot limitée aux traces affichées, client HTTP commun.

## Choix validés pour la v0.6 (10/11/2026)

- **Connexions** : un seul onglet (`ConnectionsPage`, route `connections` avec `tab`) regroupe Komoot, Openrunner, Karoo, Entraînement (Zwift, intervals.icu) et gpx.studio. Les entrées « Sources », « Agenda Pédalons » et « Appareils GPS » (qui ne menaient nulle part) sont retirées ; rien de non disponible n'apparaît dans la navigation.
- **Modifier dans gpx.studio**, validé le 10/11/2026 : bouton de la fiche. gpx.studio ouvre un GPX par adresse (`/app?files=["url"]`) ; Organisons le sert sur `http://127.0.0.1:<port libre>/<jeton>/<nom>.gpx`, CORS limité à `https://gpx.studio`, 15 minutes (`gpxstudio.rs`). Le navigateur intégré de l'app Claude bloque cette requête, Vivaldi non. Retour par un **dossier surveillé** (Téléchargements par défaut, Connexions → gpx.studio) : GPX arrivés après la mise en service (`inbox_since`), identiques écartés, traités mémorisés (`inbox_done`) ; bandeau `InboxPanel` (Bibliothèque et fiche, toutes les 5 s quand un retour est attendu) : « Remplacer la trace » (si la bibliothèque autorise l'écriture), « Ajouter » à une bibliothèque gérée, « Ignorer ». L'export de gpx.studio garde le nom servi, ce qui relie le fichier à sa trace (`gpxstudio_sessions`). Le fichier téléchargé n'est jamais touché.
- **Thème sombre** (voir Architecture) aux couleurs du thème « Dark (modifié) » de Vivaldi de l'utilisateur (`main.tsx`) : fond des panneaux `#2e2f37` (dark[7]), fenêtre `#1D1E21` (dark[8]), texte `#d3d9e3` (dark[0]), bordures `#4b4c53` (dark[4]), mise en avant `#6590fd` (indigo[5], `primaryShade` dark 5).
- **Renommer une trace** (prévu en v0.5, oublié, fait en v0.6) : crayon à côté du titre de la fiche. Colonne `traces.name_user` : `upsert_trace` garde `COALESCE(name_user, nom lu)`, donc le nom tient aux relectures. Le fichier suit aussitôt (`organize::rename_file`, appelé par la commande `rename_trace`) : bibliothèque gérée → rangé selon le modèle (le « Ranger » de cette trace seulement), indexée avec écriture → renommé dans son dossier, indexée sans écriture → ne bouge pas. Si la bibliothèque autorise l'écriture, `gpxmeta::with_name` remplace le `<name>` de la première piste (ou de l'itinéraire, ajouté s'il manque) et celui des métadonnées, par la même réécriture vérifiée que les tags (`rewrite`). « Nom du fichier » remet `name_user` à vide (`scan::rename_trace`).
- **Crédits** (texte validé par l’utilisateur) : Réglages → À propos et crédits (`CreditsPanel`) et section Crédits du README, identiques : licence et code source, données cartographiques, services reliés, logiciels libres.
- **Icône** : `app-icon.png` avait des arrondis décalés (marches aux jonctions du S) ; toutes les icônes sont régénérées depuis `src-tauri/icons/icon.svg` (`npx tauri icon`, sans les dossiers android et ios). Piège : `build.rs` déclare des `rerun-if-changed`, donc Cargo ne le relance plus pour les autres fichiers ; l'icône Windows de l'exécutable (barre des tâches, menu Démarrer) restait l'ancienne. `build.rs` surveille maintenant `icons`, `tauri.conf.json` et `capabilities`.
- **Halo des étapes d'un tour** : la colonne des étapes défile, donc elle rogne ce qui dépasse sur les côtés ; elle a une marge de 14 px pour que le halo du survol reste entier. La bande de couleur de l'étape est un élément placé dans la carte (`overflow: hidden`), pas une bordure gauche, qui décalait le coin du halo.
- **Notes privées** : `notes-privees/` (exclu par `.git/info/exclude`, comme `presentation/`) pour ce qui ne doit pas être publié, par exemple l'étude des autres appareils GPS.
- **Publiable** : licence AGPL-3.0-or-later ; `npm run build:public` construit sans l'application Hammerhead intégrée (`ORGANISONS_PUBLIC_BUILD=1`, lu par `build.rs`) puis vérifie qu'aucun identifiant de `hammerhead.local.env` n'est dans l'exécutable ni les installateurs. Dans cette version, chacun crée sa propre application Hammerhead (marche à suivre dans Connexions → Karoo).

## Règle à chaque version poussée

Avant de pousser une nouvelle version (changement du numéro dans `package.json`, `package-lock.json`, `Cargo.toml` et `tauri.conf.json` ; l'appli affiche celui de `package.json`, injecté par Vite dans `src/version.ts`) : relire ce fichier et le README ensemble et les mettre à jour (fonctions, onglets, choix validés, feuille de route, build). Ils doivent décrire la même version.

## Build et dépôt

- Lancement sous Windows 11 validé le 09/11/2026 (`npm run tauri dev`).
- Build validé le 09/11/2026 (`npm run tauri build`, environ 5 min) : `target/release/organisons.exe` et les installateurs `bundle/nsis/*-setup.exe` (3,3 Mo) et `bundle/msi/*.msi` (4,6 Mo), en français (`bundle.windows` de `tauri.conf.json`). Les deux installent pour tout l’ordinateur, dans Program Files (`installMode: perMachine`). Fermer `target/release/organisons.exe` avant un build, sinon erreur « fichier utilisé ».
- MapLibre 6 : le worker (`maplibre-gl-worker.mjs`) doit être importé avec `?url` et passé à `maplibregl.setWorkerUrl` (fait dans `useMapLibre.ts`), sinon l’appli installée n’a pas de fond de carte (en dev, tout marche quand même).
- L’installateur n’embarque aucune donnée : l’index est dans `%APPDATA%/fr.organisons.app/index.sqlite`.
- **Version à diffuser** : construite par GitHub (`.github/workflows/release.yml`) quand on pousse un tag `vX.Y.Z` égal à la version de `package.json` (`git tag -a v0.7.0 -m "Organisons v0.7.0"` puis `git push origin v0.7.0`) : installateurs sans application Hammerhead intégrée, joints à une Release en brouillon, à publier depuis GitHub. En local, toujours `npm run build:public`, jamais `npm run tauri build` (qui intègre le secret Hammerhead du PC de développement).
- Dépôt GitHub **public** depuis le 10/11/2026 : https://github.com/minicake1/organisons (recréé avec un historique réécrit ; l’ancien dépôt privé s’appelle `organisons-ancien`). `gh` installé dans `C:\Program Files\GitHub CLI\`.
- **CI** (`.github/workflows/ci.yml`) : à chaque push sur `main` et pull request, `cargo test -p traces-core` et `npm run build` sous Linux, `npm run build` puis `cargo check`/`cargo test -p organisons` sous Windows (Tauri intègre `dist/` à la compilation). Premier passage vert le 10/11/2026 (≈ 6 min).

## Feuille de route

### v0.7 : sauvegarde de la configuration (à étudier)
- **Fichier de sauvegarde** exportable et réimportable (JSON lisible, par exemple `organisons-sauvegarde-AAAA-MM-JJ.json`), depuis Réglages, pour retrouver sa configuration après une réinstallation, sur un autre PC ou après avoir supprimé l'index.
- Contenu envisagé :
  - bibliothèques (nom, chemin, mode, modèle de rangement, écriture dans les GPX) ;
  - réglages : dossier surveillé, vidages automatiques (corbeille, doublons), thème, FTP, dossier Zwift (ces trois derniers sont aujourd'hui dans le `localStorage` de l'appli) ;
  - tags (détection auto, mots-clés), collections et tours (ordre des étapes) ;
  - données propres à chaque trace : tags, notes, sport et nom choisis, collections, tags proposés ignorés, paires « pas des doublons » ;
  - parcours déjà importés (Komoot, Openrunner) et envois mémorisés (Karoo, séances).
- Les traces sont retrouvées à la restauration par l'empreinte du fichier (SHA-256), puis par le chemin : une bibliothèque déplacée ou un NAS renommé reste reconnu.
- **Jamais de secrets** dans le fichier : jetons et clés (Komoot, Hammerhead, intervals.icu) restent dans le gestionnaire d'identifiants de Windows, à reconnecter après une restauration.
- Restauration avec aperçu (ce qui sera ajouté ou remplacé) avant d'écrire quoi que ce soit ; option de sauvegarde automatique régulière (dans un dossier choisi, par exemple sur le NAS), en gardant les N dernières.
- Les tags et notes déjà écrits dans les GPX (bibliothèques avec écriture) reviennent aussi à la relecture ; la sauvegarde couvre tout le reste.

### Publication (dépôt public depuis le 10/11/2026)
- **Fait** :
  - licence AGPL-3.0-or-later (avant : PolyForm Noncommercial 1.0.0) : toute redistribution partage son code, et une version proposée en ligne (version web, serveur d'échange OAuth…) doit aussi publier ses modifications ; l'usage commercial est permis à cette condition. Du code de Pédalons (PolyForm Noncommercial) ne pourrait pas être repris sans l'accord de son auteur ;
  - dépôt recréé avec un historique nettoyé (trace de test synthétique `boucle-600.gpx` à la place d'un parcours d'un tiers) ;
  - installateurs publics sans application Hammerhead intégrée (`npm run build:public` en local, `release.yml` sur GitHub) ;
  - CI, alertes Dependabot, détection de secrets ; Release v0.6.0 publiée.
- **Reste à faire** :
  - demander à Hammerhead ce qu'ils autorisent pour une appli de bureau distribuée (application commune intégrée, PKCE, ou chacun la sienne) et vérifier la licence de leur API ;
  - vérifier les licences des dépendances (npm, Cargo) et les mentions des données (OpenStreetMap ODbL, OpenFreeMap, VersaTiles).
- **Komoot** : API interne non officielle, déjà signalée dans l'appli et le README.

### Autres appareils GPS
- Options étudiées dans une note privée, hors Git (`notes-privees/appareils.md`, sur le PC de développement).

### Plus tard
- **Version macOS** : Tauri sait produire une appli Mac (`.dmg`) ; à prévoir : build sur un Mac (ou CI GitHub macOS), signature et notarisation Apple, trousseau macOS pour les jetons (crate `keyring`, déjà multiplateforme), chemins de NAS (`/Volumes/…`), tests de l'interface sous WebKit.
- **Agenda Pédalons** (retiré de la navigation en v0.6) : le flux ICS ne contient que des liens vers les sorties, pas de GPX. Il faudra l'API de Pédalons avec le compte de l'utilisateur ; Pédalons n'a pas de clé d'accès personnelle, à ajouter côté Pédalons.
- **Éditeur intégré** (sans quitter l'appli) : couper, inverser, fusionner, POI ; calcul d'itinéraire possible avec BRouter (serveur public ou installé sur le NAS). Pédalons fait son propre planificateur (Valhalla via Stadia Maps, côté serveur) : idées seulement, pas de code repris.
- **Fonds de carte sombres** pour le thème sombre (OpenFreeMap), si les traces restent lisibles.
