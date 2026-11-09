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
  - `index.rs` : SQLite (rusqlite, version embarquée), filtres et tri.
  - `scan.rs` : parcours récursif des dossiers, empreinte SHA-256 (doublons), fichiers inchangés ignorés (taille et date identiques).
- `src-tauri/src/lib.rs` : commandes exposées à l'interface. Paramètres en snake_case côté Rust, camelCase côté JS. L'index est dans le dossier de données de l'appli (`index.sqlite`).
- `src/` : pages Bibliothèque, Fiche trace et Réglages. `labels.ts` contient les libellés, les couleurs et `niceStep` (pas des graduations adaptés à la longueur et au dénivelé).

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
- Stockage : NAS en bibliothèque « gérée », rangée selon `{sport}/{année}/{nom}.gpx` ; PC indexé sur place ; tags et notes écrits aussi dans le GPX ; doublons Komoot → demander à l'utilisateur.
- Fond de carte OpenFreeMap (sans clé). Repli sur un fond uni hors ligne.

Maquettes (canevas claude.ai, version « v0.1 ») : https://claude.ai/artifact/UgMG2meavfQnAP5ptqqBpY

## Prévu en v0.2

- **Komoot** : pas d'API publique, seulement une API partenaire B2B. Passer par l'API interne `https://api.komoot.de/v007/` (identifiants stockés dans le trousseau du système) ; peut cesser de fonctionner à tout moment.
- **Agenda Pédalons** : le flux ICS ne contient que des liens vers les sorties, pas de GPX. Il faudra l'API de Pédalons avec le compte de l'utilisateur ; Pédalons n'a pas de clé d'accès personnelle, à ajouter côté Pédalons.
- **Appareils GPS** : Garmin et Wahoo réservent leur API à des partenaires. Mode recommandé : passer par le compte Pédalons ; sinon copie USB dans `Garmin\NewFiles` vers un Edge.
- **Rangement automatique** des bibliothèques gérées ; écriture des tags et notes dans `<extensions>` du GPX.
- **Revêtement** calculé depuis OpenStreetMap, comme le fait Pédalons.
- **Écrans** Doublons, Collections et Tags.
- **Carte** : n'afficher les noms des POI qu'au-delà d'un certain zoom (aujourd'hui ils se chevauchent sur une vue d'ensemble).
- Lancement sous Windows 11 validé le 09/11/2026 (`npm run tauri dev`). Reste à tester le build de l'installateur (`npm run tauri build`).
