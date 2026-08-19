# Figurants — les clients sont des pantins

Les clients de la salle instancient le même pantin Mixamo que les joueurs
distants (`player.glb`), teinté et calibré (taille, carrure) par personne.
Aucun fichier dédié à déposer. Les anciens figurants habillés (`male.glb`,
`male2.glb`, `female2.glb` — Rodin re-habillé et Ready Player Me) restent
récupérables dans l'historique git.

La Michelle de three.js (afro, lunettes) ne sert plus que de filet de
sécurité : elle reste chargée — son atlas neutre nourrit la tenue de service
(vestiaire) — et elle remplace les clients si `player.glb` manque.

# `singer.glb` — la chanteuse du concert

La seule contrainte qui compte : le fichier doit porter des os `mixamorig`
**et les clips `idle` / `walk`**. Sans eux, `concert.js` la fait glisser
jusqu'au micro au lieu de la faire marcher — c'était le bug d'origine, le modèle
féminin par défaut du jeu ne portant aucune animation.

Deux fabriques, selon ce dont on dispose :

- **`tools/retarget-singer.py`** — la bonne. Part d'un modèle du commerce déjà
  riggé et pesé (FBX ou glTF, chemin en tête du script, hors dépôt) et lui
  transplante les clips de `player.glb`. Le retarget se fait par VISÉE DE
  DIRECTION, os par os : les deux squelettes ont beau être des rigs Mixamo, les
  chargeurs FBX et glTF ne construisent pas les repères d'os de la même façon,
  et copier les rotations replie le personnage en deux. Le script recale aussi
  chaque clip au sol (la longueur de jambe diffère d'un rig à l'autre), décime
  la chevelure et plafonne les textures — sans ça le glb dépasse 14 Mo.
  Le modèle peut être en A-pose : la visée est absolue.
- **`tools/build-singer.py`** — le repli. Modèle un mannequin stylisé de A à Z
  (metaballs, robe ajustée sur la silhouette mesurée, poids par enveloppes) et
  l'attache au squelette de `player.glb`. Ne dépend d'aucun asset extérieur.

# `player.glb` / `player_f.glb` — les avatars des joueurs

Les joueurs distants tirent au sort l'un des deux. Contrat commun : os au
suffixe Mixamo (`…Hips`, `…LeftArm`, peu importe le préfixe) **et clips
`idle`/`walk`** (sans eux l'avatar glisse au lieu de marcher).

- `player.glb` — LE PANTIN : le Xbot Mixamo d'origine, restauré. Les joueurs
  distants sont des pantins, c'est voulu — les personnages habillés sont
  réservés au personnel et à la chanteuse. Les clients de la salle instancient
  le même conteneur, teinté (voir « Figurants » ci-dessus).
- `player_f.glb` — absent volontairement : tout le monde tirait la variante
  issue de `singer.glb` et la salle se remplissait de sosies de la chanteuse.

Fabrique des deux : `tools/build-avatars.py` (à lancer dans Blender).
