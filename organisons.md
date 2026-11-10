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

## Build et dépôt

- Lancement sous Windows 11 validé le 09/11/2026 (`npm run tauri dev`).
- Build validé le 09/11/2026 (`npm run tauri build`, environ 5 min) : `target/release/organisons.exe` et les installateurs `bundle/nsis/*-setup.exe` (3,3 Mo) et `bundle/msi/*.msi` (4,6 Mo), en français (`bundle.windows` de `tauri.conf.json`). Les deux installent pour tout l’ordinateur, dans Program Files (`installMode: perMachine`). Fermer `target/release/organisons.exe` avant un build, sinon erreur « fichier utilisé ».
- MapLibre 6 : le worker (`maplibre-gl-worker.mjs`) doit être importé avec `?url` et passé à `maplibregl.setWorkerUrl` (fait dans `useMapLibre.ts`), sinon l’appli installée n’a pas de fond de carte (en dev, tout marche quand même).
- L’installateur n’embarque aucune donnée : l’index est dans `%APPDATA%/fr.organisons.app/index.sqlite`.
- Dépôt GitHub privé : https://github.com/minicake1/organisons (`gh` installé dans `C:\Program Files\GitHub CLI\`).

## Feuille de route

### v0.5 : appareils GPS, entraînements et renommage
- **Renommer une trace** depuis la fiche (Classement, mode édition) : nom affiché, `<name>` du GPX (si la bibliothèque autorise l'écriture) et, dans une bibliothèque gérée, nom du fichier au prochain « Ranger ».
- **Hammerhead (Karoo), fait et validé le 10/11/2026** (connexion, envoi, POI présents sur le Dashboard). Piège : le remplissage automatique mettait l’e-mail dans le champ Client ID (page de confirmation vide) ; désormais bloqué et vérifié. comme Pédalons, l’application Organisons est intégrée au build (`src-tauri/hammerhead.local.env`, non versionné, lu par `build.rs`) : l’utilisateur n’a qu’à « Connecter mon compte » ; saisie d’une autre application possible (« Avancé »). Une nouvelle connexion remplace celle qui attendait (port libéré), bouton « Annuler la connexion ». `src-tauri/src/hammerhead.rs` (connexion par le navigateur, serveur local sur le port de l’adresse de retour, défaut `http://localhost:3001`, jeton renouvelé), `traces_core::device` (GPX préparé : POI en Food/Water/Danger/Summit/Generic, nom de fichier ASCII), table `device_sends` (mise à jour au lieu de doublon). Réglages → Appareils, bouton de la fiche, sélection de la Bibliothèque, menu Exporter du tour. Plan d’origine : API officielle (`api.hammerhead.io/v1`, OAuth 2.0, comme Pédalons). L'utilisateur crée un compte développeur sur le Dashboard Hammerhead, accepte la licence API et obtient un client ID et un secret (onglet « API settings »), avec une adresse de retour locale (`http://127.0.0.1:<port>/…`). Organisons : identifiants et jeton dans le gestionnaire d'identifiants, connexion par le navigateur ; `POST /routes/file` (GPX en multipart, scope `route:write`), `PUT /routes/{id}/file` pour mettre à jour et `DELETE /routes/{id}` pour retirer (identifiant gardé dans l'index) ; `POST /workouts/file` accepte les `.zwo` (entraînements). Le Karoo récupère ensuite les parcours par le cloud.
- **Appareils GPS (plus tard)** : Garmin et Wahoo réservent leur API à des partenaires. Mode recommandé : passer par le compte Pédalons ; sinon copie USB dans `Garmin\NewFiles` vers un Edge.
- **Envoi des séances** (`src-tauri/src/training.rs`, menu `WorkoutSendMenu`) : Zwift par copie dans `DocumentsZwiftWorkouts<id>` (dossier trouvé tout seul, OneDrive compris, choix dans Réglages) ; intervals.icu par l’API officielle, validé le 10/11/2026 (clé personnelle, `Basic API_KEY:<clé>`, `POST /athlete/{id}/events` en `WORKOUT` avec `file_contents` = le .zwo, à une date) ; MyWhoosh sans API : ouverture de workout.mywhoosh.com/workouts-library et du fichier dans l’Explorateur.
- **Entraînements, fait** : onglet Entraînements (`WorkoutsPage`), `.zwo` lus par `workout.rs` (blocs, intervalles déroulés, durée, IF par puissance normalisée, TSS = h × IF² × 100), indexés à la relecture (table `workouts`), import dans le dossier « Entraînements » d’une bibliothèque gérée, graphique par zone (`WorkoutChart`), envoi vers Hammerhead (`POST /workouts/file`, scope `workout:write` : reconnecter le compte une fois), envois mémorisés (`workout_sends`). Idée d’origine : nouvelle catégorie à côté des sports, avec la prise en charge des fichiers `.zwo` (séances structurées Zwift : XML avec échauffement, intervalles, paliers en % de FTP, récupération). Lecture, classement (tags, collections), durée et charge, graphique de puissance par bloc ; rangés dans les bibliothèques comme les GPX.

### Plus tard
- **Version macOS** : Tauri sait produire une appli Mac (`.dmg`) ; à prévoir : build sur un Mac (ou CI GitHub macOS), signature et notarisation Apple, trousseau macOS pour le jeton Komoot (crate `keyring`, déjà multiplateforme), chemins de NAS (`/Volumes/…`), tests de l’interface sous WebKit.
- **Agenda Pédalons** : le flux ICS ne contient que des liens vers les sorties, pas de GPX. Il faudra l’API de Pédalons avec le compte de l’utilisateur ; Pédalons n’a pas de clé d’accès personnelle, à ajouter côté Pédalons.
