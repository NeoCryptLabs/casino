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
| `Maj` | courir |
| `E` | interagir : s'asseoir, commander un verre, jouer |
| `Échap` | se lever, quitter une table |
| molette | mise de la machine à sous |
| `1` `2` `3` `4` | miser 5 / 25 / 100 / 500 |
| `T` `R` `D` | tirer, rester, doubler |

On peut s'asseoir à **n'importe quelle place libre** — chaises du blackjack,
tabourets du bar, machines à sous. Une place occupée par un autre joueur est
refusée. Assis, clic-glissé pour incliner le regard.

## Architecture

```
index.html          page du jeu
src/                client — rendu, entrées, réseau
  main.js           amorçage, boucle, interactions
  world.js          salle, éclairage, post-traitement
  blackjack.js      MISE EN SCÈNE de la table (ne décide de rien)
  net.js            multijoueur : poses, avatars, flux de table
  npc.js            figurants : squelette, postures, clips d'animation
  cards.js chips.js maillages déformables et physique Havok
  slots.js bar.js fountain.js audio.js player.js staff.js
server/
  server.mjs        Next.js + WebSocket, un seul process
  blackjack.mjs     table AUTORITAIRE — règle, sabot, mises, paiements
assets/             personnages glTF riggés (squelette Mixamo)
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

Aucune persistance : tout vit en mémoire et repart de zéro au redémarrage.

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
  base, doubler, blackjack payé 3:2, croupier restant sur tous les 17.
- **Vue « Inscryption »** à table : la caméra se penche au-dessus du tapis, les
  cartes se redressent vers le joueur, profondeur de champ.
- **Physique Havok** : cartes lancées depuis le sabot, jetons empilés et poussés.

## Limites connues

- **Aucune authentification.** Qui atteint le port peut se connecter et bouger un
  avatar. Ne pas exposer tel quel sur Internet.
- Les joueurs se traversent : pas de collision entre avatars.
- Le personnage joueur est un mannequin sans visage (voir crédits).
- La caisse est tenue par le serveur mais n'est pas persistée.

## Crédits et provenance des assets

| fichier | origine | note |
|---|---|---|
| `assets/dealer.glb`, `barman.glb` | générés via **Hyper3D Rodin**, puis riggés et pondérés dans Blender | vérifier les conditions du service avant tout usage commercial |
| `assets/player.glb` | **Xbot**, personnage Mixamo (via les exemples three.js) | Mixamo restreint la redistribution — à remplacer par un modèle à soi pour un usage sérieux |
| figurantes | `Michelle.glb`, chargé à l'exécution depuis threejs.org | non redistribué ici |
