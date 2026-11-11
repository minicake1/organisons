# Équivalences des points d'intérêt (POI)

Ce tableau dit à Organisons comment **reconnaître** un point d'intérêt venant de chaque plateforme (Openrunner, Komoot, gpx.studio, Garmin…) et comment **l'envoyer** vers un appareil (Karoo de Hammerhead). Il est lu par l'appli à la compilation : pour l'enrichir, il suffit d'ajouter une ligne, puis de relancer les tests (`cargo test -p traces-core`), qui vérifient le tableau. Après un changement, les traces sont reclassées à la relecture suivante si `ANALYSIS_VERSION` (`index.rs`) est augmenté.

Comment un POI est classé :

1. son symbole (`<sym>` du GPX, sinon `<type>`) est cherché dans **Symboles** (sans tenir compte des majuscules) ;
2. si le symbole est inconnu, absent, ou si sa catégorie est « nom, sinon … », le nom du POI est comparé aux **Mots du nom**, ligne par ligne : la première qui correspond l'emporte ;
3. sinon : la catégorie après « nom, sinon », ou `other`.

Règles d'écriture :

- une cellule peut contenir plusieurs valeurs séparées par des points-virgules (`;`) : certains symboles Garmin contiennent eux-mêmes une virgule (« Flag, Blue ») ;
- un mot est cherché comme mot entier, sans tenir compte des majuscules ni des accents ; avec `*` à la fin, il suffit qu'un mot du nom commence ainsi (`chapelle*` trouve « Chapelles ») ; un mot sans lettre ni chiffre (`%`) est cherché tel quel ;
- la colonne Karoo est facultative : vide, c'est le type Karoo de la catégorie qui sert. Types acceptés par le Karoo : Food, Water, Parking, Camping, Lodging, Geocache, Summit, Generic, Danger.

## Catégories

| Code | Nom affiché | Karoo |
|---|---|---|
| control | Contrôles | Generic |
| warning | Attention | Danger |
| water | Eau | Water |
| shop | Commerces | Food |
| sight | Curiosités | Generic |
| lodging | Hébergement | Lodging |
| service | Services | Generic |
| other | Autres | Generic |

## Symboles

| Symbole | Plateformes | Catégorie | Karoo |
|---|---|---|---|
| 1 | Openrunner | control | |
| 15; 16 | Openrunner | warning | |
| 104 | Openrunner | water | |
| 50 | Openrunner | shop | |
| 60 | Openrunner | sight | |
| Flag, Blue | Komoot (highlights), Garmin | nom, sinon sight | |
| Flag; Flag, Red; Flag, Green; Pin, Blue; Waypoint | Garmin, gpx.studio | nom, sinon other | |
| Drinking Water; Water Source | Garmin, gpx.studio | water | |
| Restaurant; Fast Food; Pizza; Bar; Food; Convenience Store; Shopping Center; Department Store | Garmin, gpx.studio, Komoot | shop | |
| Gas Station | Garmin, gpx.studio | shop | |
| Summit | Garmin, gpx.studio, Komoot | sight | Summit |
| Scenic Area; Binoculars; Museum; Church; Bridge; Forest; Park; Beach; Building; Tunnel | Garmin, gpx.studio, Komoot | sight | |
| Danger Area; Skull and Crossbones; Alert; Crossing; Restricted Area | Garmin, gpx.studio | warning | |
| Campground | Garmin, gpx.studio, Komoot | lodging | Camping |
| Lodging; Lodge; Hotel; Shelter | Garmin, gpx.studio | lodging | |
| Fishing Hot Spot Facility | Komoot (hébergements : appartements, cabanes…) | lodging | |
| Parking Area | Garmin, gpx.studio | service | Parking |
| Restroom; Shower; Information; Pharmacy; Bank; Telephone; Car Repair; Ground Transportation; Picnic Area | Garmin, gpx.studio, Komoot | service | |
| Geocache | Garmin | other | Geocache |

## Mots du nom

| Mots | Catégorie |
|---|---|
| cp*; contrôle*; controle*; pointage | control |
| ravito*; ravitaillement*; boulangerie*; boulanger*; épicerie*; commerce*; café; cafe; bar; restaurant*; crêperie*; supermarché*; supérette | shop |
| eau; eaux; fontaine*; source; sources; water; robinet* | water |
| attention; danger*; risque*; %; descente*; travaux; gué; boue*; chemin endommagé; montée*; côte; col | warning |
| camping*; gîte*; gite*; hôtel*; hotel*; auberge*; refuge*; chambre d'hôtes; abri | lodging |
| parking*; toilettes; wc; gare*; office de tourisme; pharmacie*; atelier vélo; réparation* | service |
| point de vue; panorama*; belvédère*; chapelle*; église*; cathédrale*; château*; abbaye*; moulin*; pont*; passerelle*; viaduc*; forêt*; bois; lac*; étang*; rivière*; canal; cascade*; plage*; musée*; menhir*; dolmen*; calvaire*; jardin*; parc | sight |
