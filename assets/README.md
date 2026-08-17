# Modèle masculin (optionnel)

Déposez ici un fichier **`male.glb`** : un personnage rigué au format glTF
binaire, squelette Mixamo standard (os `mixamorig:Hips`, `mixamorig:LeftUpLeg`…),
en T-pose ou A-pose, sans animation nécessaire.

Le jeu le détecte au chargement : le barman, le croupier et la moitié des
clients de la table deviennent alors des hommes. Sans ce fichier, tout le monde
utilise le modèle féminin par défaut.

Sources gratuites : [Mixamo](https://www.mixamo.com) (exporter en FBX puis
convertir en glTF, ou récupérer un .glb tout fait) et
[Ready Player Me](https://readyplayer.me) (l'URL `https://models.readyplayer.me/<id>.glb`
donne directement un .glb — enregistrez-le sous `assets/male.glb`).

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
