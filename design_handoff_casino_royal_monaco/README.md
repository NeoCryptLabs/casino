# Handoff : Casino Le Royal Monaco — plan de niveau + modélisation 3D

## Overview

Deux livrables décrivent le niveau principal d'un casino ultra-luxe (registre Monaco / Las Vegas VIP) :

1. **Vue du dessus (plan d'implantation)** — `Casino Plan.dc.html`, planche 01/02, légende 01→11.
2. **Modélisation 3D orbitale à ~45°** — `Casino 3D.html`, planche 02/02, volumes en mètres réels, exportable en OBJ+MTL et GLB depuis la page.

Le programme : arrivée en bas (axe d'honneur), fontaine au centre, bar en fond d'axe face à l'entrée, machines à sous à droite, trois tables de blackjack à gauche avec la scène derrière elles, plus caisse de jetons, restaurant, roulettes, salon privé VIP et vestiaire.

## About the Design Files

Les fichiers de ce dossier sont des **références de design réalisées en HTML** : le plan est un dessin technique HTML/CSS, la vue 3D est une maquette volumétrique three.js. Ce ne sont **pas** des assets de production. La tâche attendue (voir `BLENDER_PROMPT.md`) est de **reconstruire cette scène dans Blender** avec de la géométrie, des matériaux PBR et un éclairage réalistes, en récupérant un maximum d'assets libres téléchargeables, puis d'exporter des rendus et des GLB propres.

La géométrie three.js de `Casino 3D.html` est la **source de vérité dimensionnelle** : positions, rayons et hauteurs y sont en mètres, y-up, sol à y = 0, origine au centre de la fontaine (voir tableau ci-dessous). Elle doit être reprise telle quelle comme blocking dans Blender.

## Fidelity

**Hi-fi sur les dimensions et l'implantation, lo-fi sur le rendu.** Les volumes, écartements et compte d'équipements sont définitifs. Les matériaux three.js (couleurs plates, `MeshStandardMaterial`) sont des approximations à remplacer par des matériaux PBR texturés dans Blender. Le style visuel du dossier (noir profond, laiton, marbre crème, feutre émeraude, bordeaux) est la direction artistique à tenir.

## Views

### 1. Plan d'implantation — `Casino Plan.dc.html`

- **Purpose** : lecture du programme et des circulations, planche imprimable.
- **Layout** : page 1560 px de large, fond `#0a0807`, en-tête (titre Marcellus 56 px + méta) séparé par un filet or `rgba(201,162,39,.35)`. Sous l'en-tête, une rangée flex : plan 1300 × 980 px à gauche, légende (grille, gap 16 px) à droite. En pied de page, un bandeau-lien vers la planche 3D.
- **Plan** : boîte 1300 × 980, bordure `2px #c9a227`, fond radial `#221a13 → #0e0a07`, trame marbre en `repeating-linear-gradient` ±45° opacité .16. Échelle du dessin : **1 px = 0,04 m** (1300 px = 52 m, 980 px = 39 m).
- **Repères** (coordonnées px dans le plan, origine coin haut-gauche) :
  | # | Élément | left/top | w × h |
  |---|---|---|---|
  | 01 | Arrivée | 500 / 900 | 300 × 78 |
  | — | Tapis d'honneur | 520 / 700 | 260 × 220 |
  | 02 | Fontaine (cercle) | 530 / 350 | 240 × 240 |
  | 03 | Bar (demi-lune) | 430 / 70 | 440 × 132 |
  | 04 | Machines à sous | 990 / 280 | 250 × 540 |
  | 05 | Blackjack ×3 | 186 / 357, 487, 617 | 104 × 186 |
  | 06 | Scène | 20 / 400 | 150 × 360 |
  | 07 | Caisse jetons | 1000 / 872 | 240 × 106 |
  | 08 | Restaurant | 60 / 820 | 400 × 158 |
  | 09 | Roulettes ×2 | 352 / 432 et 818 / 432 | 130 × 76 |
  | 10 | Salon privé VIP | 990 / 70 | 250 × 170 |
  | 11 | Vestiaire | 812 / 900 | 180 × 78 |

### 2. Modélisation 3D — `Casino 3D.html`

- **Purpose** : vérifier les volumes, l'axe d'honneur et les vues à 45° ; fournir la base géométrique exportable.
- **Shell** : composant `<three-d-stage>` (`three-d-stage.js`) — renderer, OrbitControls, ombre au sol, boutons *Download OBJ + MTL* / *Download GLB*.
- **Caméra par défaut** : position `(34, 27, 40)`, cible `(0, 2.5, 1)` — vue 45° depuis l'arrivée, à droite.
- **Éclairage de la maquette** : hemisphere + key directionnelle du shell, plus 5 `PointLight` chaudes `0xffd9a0` (fontaine 90, scène 55, machines 55, entrée 45, restaurant 40, distance 46, decay 2) et une `AmbientLight 0xfff0d8` 0.35.
- **Overlays HTML** : titre Marcellus 34 px, sur-titre Jost 11 px interlettré .34em en `#c9a227`, légende 01→10 sur fond `rgba(10,8,7,.72)` avec filet or à gauche.

## Géométrie de référence (mètres, y-up, sol y = 0)

Enveloppe : **52 (X) × 39 (Z)**, murs h. 5,0 m ép. 0,6 ; sol dalle 0,3. Entrée au **+Z**, mur du fond au **−Z**. Baie d'entrée : trémie de 10,4 m au centre du mur avant (linteau h. 2,2 sous plafond).

| Élément | Position (x, z) | Dimensions clés |
|---|---|---|
| Tapis d'arrivée | 0, 12,9 | 10,4 × 8,8, bordeaux |
| Incrustation d'axe | 0, 2,0 | 3,4 × 22, marbre clair |
| Portique d'arrivée | 0, 19,5 | dalle 10,4 × 2,2 à y 4,6 ; 2 colonnes r 0,45 h 4,4 en x ±4,6 ; portes laiton 4,4 × 3,2 |
| Fontaine | 0, −0,8 | bassin r 4,9 h 0,7 ; eau r 4,5 ; fût r 0,55→0,85 h 2,2 ; vasque r 1,7 ; jet central r 0,13 h 3,2 ; 8 jets périphériques r 2,6 |
| Lustre | 0, −0,8 | anneaux laiton r 3,6 (y 5,0) et r 2,3 (y 5,8), 24 cristaux r 0,16 |
| Bar | centre 0, −17,6 | comptoir courbe **arcBand r 2,90→3,55**, h 1,15 ; plan marbre r 2,78→3,70 ép. 0,1 ; main courante laiton r 3,66 ; îlot de service r 1,15→1,65 h 0,9 (allée barman 1,25 m) ; arrière-bar 9,4 × 3,6 à z −19,1 avec 3 étagères × 13 bouteilles ; 7 tabourets r 4,45 |
| Blackjack ×3 | −16,6 ; z −1,6 / 3,6 / 8,8 | demi-lune feutre r 1,9 ép. 0,14 à y 0,88, jonc laiton r 1,92 ; croupier côté **−X (scène)**, arc joueurs côté salle, 5 tabourets r 2,55 ; sabot r 0,3 |
| Roulettes ×2 | ∓6,4 ; −0,8 | plateau ovale r 1,75 (échelle z 0,62) à y 0,86 ; cylindre r 0,62 |
| Machines à sous | rangées z −5,6 / 1,2 / 8,0 | 9 machines par face, dos à dos (±0,4 en z), pas 0,95 en x depuis 14,8 ; caisson 0,85 × 1,0 × 0,7, écran 0,78 × 0,62 incliné −0,22 rad, couronne laiton, tabouret r 0,3 ; épine centrale 9,2 × 2,3. **54 postes** |
| Scène | −22,4 ; 3,6 (rot. Y +90°) | estrade 14 × 6 h 0,9 ; plateau bordeaux ; fond de scène 14 × 4,8 ; 11 plis de rideau r 0,34 h 4,4 ; frise laiton à y 5,0 ; nez de scène laiton |
| Restaurant | x −20,5 / −16,0 / −11,5 / −7,0 ; z 15,4 | tables rondes r 1,1 à y 0,78, pied r 0,16, base laiton r 0,5, bougeoir ; 4 chaises par table à r 1,55 |
| Caisse jetons | 18,8 ; 15,6 | comptoir 9,4 × 1,15 ; plan marbre ; dosseret laiton 9,4 × 3,4 ; 4 séparations + 4 piles de jetons r 0,2 |
| Vestiaire | 10,1 ; 17,2 | comptoir 7,0 × 1,1 + dosseret 2,6 |
| Salon VIP | 18,6 ; −13,4 | tapis 10 × 6,8 ; parois verre 3,6 m (façade z +3,4, flanc x −5) ; linteau laiton ; table de baccara ovale r 2,1 (échelle z 0,55) ; 6 tabourets |
| Colonnes | (−11, ∓6), (19, ∓6), (∓9, −12), (∓9, 13) | fût marbre r 0,6 h 5,6, base et chapiteau laiton r 0,8 h 0,5 |

## Design Tokens

**Couleurs**

| Rôle | Hex |
|---|---|
| Fond / nuit | `#0a0807` |
| Marbre sombre (sol, murs) | `#4a3d30` |
| Marbre clair (plans, colonnes) | `#e6ddca` |
| Laiton | `#d8b45c` (rough. 0.30, metal. 0.38) |
| Feutre émeraude | `#0f4d3c` (rough. 0.90) |
| Bordeaux (tapis, rideaux, assises) | `#5c1526` |
| Noyer | `#2e1d12` |
| Eau | `#7fb3bd` (opacité 0.75) |
| Verre | `#bfd2d4` (opacité 0.22) |
| Or (traits et libellés) | `#c9a227` |
| Or clair (titres) | `#e8d9a0` |
| Texte | `#efe7d8` |
| Lumière chaude | `#ffd9a0` / `#fff0d8` |

**Typographie** — Marcellus (titres, numéros de repère), Jost 300/400 (libellés, légendes). Libellés en capitales, interlettrage .14em à .34em. Minimum 11 px sur planche.

**Traits** — filets or 1–2 px `#c9a227` ; zones souples en tireté `rgba(201,162,39,.45)`.

## Assets

Aucun bitmap dans les livrables : tout est géométrie, dégradés CSS et matériaux plats. Polices via Google Fonts (Marcellus, Jost). Les textures et HDRI réalistes sont à **télécharger** dans le cadre du travail Blender — sources et liste dans `BLENDER_PROMPT.md`.

## Files

| Fichier | Rôle |
|---|---|
| `Casino Plan.dc.html` | Planche 01 — vue du dessus (Design Component, nécessite `support.js`) |
| `Casino 3D.html` | Planche 02 — modélisation 3D three.js (nécessite `three-d-stage.js`) |
| `three-d-stage.js` | Shell viewer + exporteurs OBJ/GLB |
| `support.js` | Runtime des Design Components (pour ouvrir le plan) |
| `BLENDER_PROMPT.md` | Brief à donner à l'agent qui reconstruit la scène dans Blender |

Ouvrir les deux HTML directement dans un navigateur (pas de build). Dans `Casino 3D.html`, la barre en bas exporte la maquette en OBJ+MTL ou GLB — c'est le point de départ à importer dans Blender.
