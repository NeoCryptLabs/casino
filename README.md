# LE MIRAGE

Casino 3D temps réel dans le navigateur — Babylon.js, physique Havok, multijoueur
par WebSocket. Le blackjack est une **table autoritaire côté serveur**, partagée :
elle tourne en continu, y compris quand personne n'est assis, et tous les joueurs
voient exactement la même partie.

## Lancer

```bash
cd server
npm install
PORT=8123 node server.mjs
```

Puis <http://localhost:8123>.

Un seul process sert tout : Next.js, les fichiers du jeu (servis depuis la racine
du dépôt, délibérément pas dupliqués dans `public/`) et le WebSocket sur `/ws`.
Une connexion internet est requise au premier chargement — Babylon et Havok
viennent de leur CDN, rien n'est vendorisé.

## Commandes

| touche | action |
|---|---|
| `ZQSD` / `WASD` / flèches | se déplacer |
| souris | regarder (cliquer pour capturer le curseur) |
| `Maj` | courir ; **assis : `Maj` + souris pour regarder autour** |
| `E` | interagir : s'asseoir, commander un verre, jouer |
| `Échap` | debout : **menu pause** ; assis : se lever, quitter une table |
| molette | mise de la machine à sous |
| `1` `2` `3` `4` | miser 5 / 25 / 100 / 500 |
| `T` `R` `D` `S` | tirer, rester, doubler, **séparer** |
| `O` / `N` | accepter / refuser l'**assurance** |
| `P` (ou `F2`) | **mode éditeur** (voir plus bas) |

On peut s'asseoir à **n'importe quelle place libre** — chaises du blackjack,
tabourets du bar, machines à sous. Une place occupée par un autre joueur est
refusée. Assis, clic-glissé pour incliner le regard.

## Menu et paramètres

Le chargement débouche sur un **écran-titre** : le casino est déjà là, derrière,
et la caméra en fait lentement le tour. Sous la navigation, l'**ambiance sonore**
se choisit à la porte — trois pièces ou le silence, et son volume à côté.

On y donne aussi son **nom**. Au premier arrivage le champ prend le focus tout
seul et `Entrée` enchaîne sur la partie ; on n'entre pas anonyme. Le pseudo est
**persisté** comme un réglage (clé `pseudo` du registre, donc `localStorage`) :
les fois suivantes il est déjà là. Il part au serveur à chaque connexion — une
coupure de réseau ne le fait pas perdre — et se change à tout moment depuis le
menu pause, ce qui renomme l'avatar chez les autres joueurs en direct.

`Échap` en pleine partie ouvre le **menu pause** — le jeu reste sous les yeux, flouté et gelé. Les deux servent les mêmes
pages : paramètres, commandes, crédits. Clavier (`↑ ↓` naviguer, `← →` régler,
`Entrée`, `Échap`) et souris font exactement la même chose — les jauges se
**tirent au clic-glissé**, la souris peut sortir de la barre sans lâcher le
curseur.

Les réglages sont **appliqués à chaud** et retenus d'une session à l'autre
(`localStorage`) : résolution interne, ombres, occlusion ambiante, halo et
effets pellicule ; champ de vision, sensibilité, axe vertical inversé,
balancement de marche, secousses ; quatre volumes (général, effets, ambiance,
voix) ; compteur d'images et réticule. L'ambiance sonore, elle, se règle au menu
principal — un réglage marqué `hidden` reste dans le registre (persistance,
`apply`) mais ne s'affiche pas dans le panneau.

La musique de salle est jouée **en flux** (`<audio>` branché sur le bus
d'ambiance) et non décodée comme les effets : six mégaoctets par piste, on ne
les garde pas en mémoire. C'est un **fond** : son plafond est bas par
construction (`MUSIC_MAX`), elle ne passe jamais devant les jetons et le
croupier, et elle s'efface d'elle-même quand le concert commence.

Tout part d'une seule liste, `src/settings.js` : un réglage = une entrée avec
son groupe, son type, sa valeur par défaut et sa fonction `apply`. Le menu se
construit à partir d'elle — ajouter un réglage à venir ne demande **rien**
d'autre que cette entrée.

## Architecture

```
index.html          page du jeu
src/                client — rendu, entrées, réseau
  main.js           amorçage, boucle, interactions
  menu.js           écran-titre et pause ; settings.js  registre des réglages
  world.js          salle, éclairage, post-traitement
  blackjack.js      MISE EN SCÈNE de la table (ne décide de rien)
  net.js            multijoueur : poses, avatars, flux de table
  npc.js            figurants : squelette, postures, clips d'animation
  cards.js chips.js maillages déformables et physique Havok
  slots.js bar.js fountain.js audio.js player.js staff.js
server/
  server.mjs        Next.js + WebSocket, un seul process
  blackjack.mjs     table AUTORITAIRE — règle, sabot, mises, paiements
  concert.mjs       spectacle AUTORITAIRE — phases, horloge, durée du morceau
  profiles.mjs      profils persistants — pseudo, caisse, dernière position
  room.mjs          plan minimal de la salle — DÉCIDE où reposer un joueur
assets/             personnages glTF riggés (squelette Mixamo)
  sfx/ voice/       échantillons ; music/  ambiances de salle (flux)
```

### Ce qui vit côté serveur

La règle du blackjack, le sabot, l'ordre du tour, le jeu du croupier et les
paiements. Les clients envoient des intentions (`sit`, `bet`, `hit`, `stand`,
`double`) et reçoivent deux flux complémentaires :

- **`state`** — photo complète, à chaque changement et à toute connexion tardive,
  pour qu'un arrivant voie la table telle qu'elle est ;
- **`events`** — ce qui vient de se produire, pour déclencher les animations.

Un client qui rate un évènement reste correct grâce à la photo ; l'inverse serait
faux. La carte cachée du croupier n'est **jamais** transmise avant son
retournement : le carton posé face cachée est un leurre local, remplacé par la
vraie carte au moment du flip.

**Le concert aussi** (`server/concert.mjs`). C'est un évènement de salle : qui
que soit celui qui appuie sur `E` devant la scène, le rideau s'ouvre pour tout
le monde, au même instant. Le serveur tient la phase (annonce, rideau, entrée,
morceau, salut, sortie) et diffuse le temps déjà écoulé dedans — un joueur qui
se connecte en plein spectacle retrouve la chanteuse au bon endroit de son
trajet et la musique au bon endroit du morceau. La fin n'appartient à personne :
la phase `performing` dure exactement le morceau, dont la durée est lue une fois
au démarrage dans l'en-tête du mp3 (Xing, sans dépendance). La musique se
termine, la chanteuse salue, sort, le rideau tombe.

## Ce qui vous suit d'une visite à l'autre

Le casino se souvient de vous : **pseudo**, **caisse** et **l'endroit où vous
vous êtes arrêté**, plus deux broutilles de confort (verres bus, mise de machine
choisie). Tout ça vit côté serveur, dans `server/players.json` — écrit
atomiquement, à la déconnexion, toutes les dix secondes, et à l'arrêt du
process.

L'identité n'est pas un compte : c'est un **jeton de vestiaire**, un nombre
aléatoire que le navigateur fabrique une fois et présente à chaque connexion
(`/ws?id=…`). Ça ne prouve rien — qui le recopie prend la place — mais ça évite
d'inventer une authentification là où il n'y en a nulle part ailleurs. Stockage
refusé, ou même jeton déjà ouvert dans un autre onglet : la session tourne sur
une **copie volatile**, jouable, simplement jamais réécrite.

**Une seule caisse pour tout le casino.** La table de blackjack n'a plus de
bourse à elle qui repartait de 2500 € à chaque assise : la place *emprunte* le
portefeuille du joueur le temps de la partie. Gagner au blackjack paie les
verres ; vider son compte aux machines se sent à la table. La table reste
autoritaire sur son argent ; la machine à sous et le bar, eux, sont joués par le
client et *déclarent* leur mouvement — le serveur ne garantit là que la
cohérence (plancher à zéro, bornes). Ruiné, on est ré-avancé 500 € à l'arrivée
suivante : une caisse persistante à zéro, ce serait la fin du jeu, pas une leçon.

**On ne quitte jamais le jeu assis.** Un joueur qui ferme sa fenêtre à une table
serait sinon replacé, au retour, à l'endroit exact de son œil de joueur assis —
la tête dans le feutre, à l'intérieur de la chaise.

La position de réapparition est donc **décidée par le serveur**, pas héritée du
client (`server/room.mjs`). C'est important : un Alt+F4, un onglet tué, un
réseau coupé n'exécutent plus une ligne de JavaScript — il ne reste personne
pour annoncer quoi que ce soit, et la dernière pose reçue est justement la
mauvaise. Le serveur cherche donc lui-même une sortie praticable, dans cet
ordre : la **sortie de la place** dans son plan, ce que le client avait déclaré
de son vivant, le dernier endroit où le joueur se tenait debout, et enfin le
point d'apparition. Il en sort toujours une, jamais assise, jamais hors les
murs, toujours à hauteur d'homme.

Ce plan, le serveur ne l'invente pas : il **l'apprend**. Il n'a ni Babylon ni
géométrie, alors chaque client, une fois le casino bâti, lui envoie la sortie de
chaque place (`{t:"spots"}`, dès la connexion — donc avant que quiconque puisse
s'asseoir puis disparaître). La carte est commune, tout le monde bâtissant le
même casino, et sert donc aussi pour les joueurs déjà partis. Le client
continue par ailleurs d'annoncer son point de sortie courant tant qu'il n'est
pas debout — chaise, tabouret, machine, vol libre de l'éditeur — ce qui couvre
ce que le plan des places ne connaît pas.

Et si la liaison se coupe **en pleine main**, la mise n'est ni confisquée (une
coupure réseau ne doit pas coûter d'argent) ni remboursée (on partirait des
mains perdantes) : la place devient *orpheline*, finit sa main à la stratégie de
base, le résultat tombe dans le portefeuille, puis la place est rendue.

Le reste — la main en cours, la place occupée, la chaleur, le concert — vit en
mémoire et repart de zéro au redémarrage.

## Ce qui s'y trouve

- **Casino** de 44 × 34 m : hall, piliers de marbre, lustres, caissons dorés,
  appliques, enseignes néon, tapis à damas, cordons de velours.
- **Fontaine** : `WaterMaterial`, jets et cascades en particules, brume,
  caustiques projetées.
- **21 machines à sous** : rouleaux 3D avec accrochage sur cran, levier animé,
  marquees néon, gains en particules.
- **Bar** : 130 bouteilles rétroéclairées, barman animé, séquence complète
  « commander → service → dégustation ».
- **Blackjack** : sabot 6 jeux, croupier, un figurant jouant la stratégie de
  base, doubler, **split** (un seul, 21 après split ≠ blackjack),
  **assurance** sur as visible (2:1, phase dédiée écourtée quand tous ont
  répondu), **side bet 21+3** (vos 2 cartes + la visible du croupier :
  couleur 5:1 → brelan assorti 100:1, réglé à la donne), blackjack payé 3:2,
  croupier restant sur tous les 17. Le croupier tire **carte par carte** ;
  les mises démarrent en anticipé quand tous les humains ont posé.
- **Vue « Inscryption »** à table : la caméra se penche au-dessus du tapis, les
  cartes se redressent vers le joueur, profondeur de champ.
- **Physique Havok** : cartes lancées depuis le sabot, jetons empilés et poussés.

## La chaleur (multiplicateur de série)

Gagner des mains d'affilée fait monter la **chaleur** de la table : ×1,2 dès la
première, jusqu'à **×3 (INFERNO)** à cinq. Le multiplicateur ne mord que sur le
bénéfice, l'égalité conserve la série, une défaite éteint tout — et les cartes
de la main perdue **se consument** (shader de dissolution, braises Havok-free).
La série vit **côté serveur** (`HEAT` dans `server/blackjack.mjs`) : tous les
clients voient la même flamme, aucun ne peut s'inventer un ×3. Le rendu
(automate de feu en bas d'écran, distorsion de chaleur, braises, lampe de table
qui vire au rouge) est dans `src/heat.js`.

## Mode éditeur (F2) et plan comme donnée

`F2` en marchant : vol libre (`ZQSD` + `Espace`/`C`), clic pour sélectionner,
`1`/`2`/`3` pour déplacer / tourner / redimensionner (gizmos Babylon), `H` pour
cacher, `Ctrl+S` pour sauvegarder. La sauvegarde écrit `assets/layout.json` via
`POST /api/layout` — un **calque de surcharges** (`nom#occurrence` → transform)
rejoué au démarrage par-dessus le monde que le code construit.

Les **sphères colorées** sont les ancres du plan (table, bar, machines,
fontaine, spawn). En déplacer une réécrit `LAYOUT` : la géométrie qui en dépend
suit **au rechargement de la page**, les meshes ordinaires bougent en direct.

### Caméras de plateau

S'asseoir à une table coupe vers un **acteur-caméra** fixe posé dans le monde
(le paradigme Unreal). Ces caméras se règlent dans l'éditeur, et le réglage
s'applique **sans rechargement** :

| touche | effet |
|---|---|
| `K` | sélectionne la caméra de table suivante (leur corps bleu est petit) |
| `1`/`2`/`3` | gizmos de position / rotation / échelle sur le corps |
| sphère cyan | la **visée** : la tirer fait pivoter la caméra pour garder ce point au centre |
| molette | focale (le cône en fil de fer et la vignette suivent) |
| `G` | la caméra adopte le point de vue courant de l'éditeur |

La vignette en bas à droite montre l'image de la caméra sélectionnée ; les
repères d'éditeur en sont exclus (bit de calque `HELPER`). Pose, focale et
distance de visée sont persistées dans `layout.json` (`cameras.table<N>`).

Le jeu charge aussi `assets/world.glb` s'il existe — de la géométrie Blender
ajoutée au monde (`src/layout.js`) :

| convention | effet |
|---|---|
| Empty `anchor.blackjack` / `.bar` / `.slots` / `.fountain` / `.spawn` | déplace l'ancre `LAYOUT` correspondante |
| mesh `phys.*` | corps physique statique Havok |
| tout mesh | collisions caméra + réception d'ombres |

Priorité : `LAYOUT` (défauts) < ancres du `world.glb` < `layout.json`.

## Limites connues

- **Aucune authentification.** Qui atteint le port peut se connecter et bouger un
  avatar. Ne pas exposer tel quel sur Internet.
- **Le jeton d'identité n'est pas un mot de passe.** Qui le recopie hérite du
  profil, caisse comprise ; qui vide le stockage de son navigateur perd le sien.
- **La machine à sous et le bar déclarent leur gain au serveur** au lieu d'être
  arbitrés par lui : leur tirage est joué côté client. Un client bricolé peut
  donc se payer. Seul le blackjack est à l'abri.
- Les joueurs se traversent : pas de collision entre avatars.
- Le personnage joueur est un mannequin sans visage (voir crédits).

## Crédits et provenance des assets

| fichier | origine | note |
|---|---|---|
| `assets/dealer.glb`, `barman.glb` | générés via **Hyper3D Rodin**, puis riggés et pondérés dans Blender | vérifier les conditions du service avant tout usage commercial |
| `assets/player.glb` | **Xbot**, personnage Mixamo (via les exemples three.js) | Mixamo restreint la redistribution — à remplacer par un modèle à soi pour un usage sérieux |
| `assets/singer.glb` | modèle tiers riggé (fourni hors dépôt), **retargeté** sur les clips de `player.glb` par `tools/retarget-singer.py` | le modèle porte les traits d'une personne réelle : droit à l'image à vérifier avant toute diffusion publique ou commerciale |
| figurantes | `Michelle.glb`, chargé à l'exécution depuis threejs.org | non redistribué ici |
| `assets/voice/*.mp3` | voix du croupier générée via **ElevenLabs** (voix pro « David », compte du propriétaire) — hors ligne, le jeu n'appelle aucune API | vérifier la licence ElevenLabs du compte pour l'usage visé |
| `assets/sfx/*.mp3` | bruitages (jetons, cartes, fontaine et foule en boucle) générés via **ElevenLabs Sound Effects** — le moteur WebAudio procédural reste en repli si absents | idem |
| `assets/piano.glb` | piano à queue modélisé par script dans **Blender** (via MCP) puis exporté glTF | libre |
| `assets/sfx/piano_loop.mp3` | boucle de piano lounge (ElevenLabs), source localisée du pianiste | licence du compte |
