# Plan — Restructuration « Casino Le Royal Monaco »

Source de vérité : `design_handoff_casino_royal_monaco/README.md` (tableau « Géométrie de
référence », mètres, y-up, sol y=0, origine au centre de la fontaine, entrée au +Z).
On garde NOTRE scène de cabaret (`assets/stage.glb`) mais on la replace contre le mur −X.
Style : disposition fidèle au handoff, rendu = notre direction artistique (noir profond,
laiton, marbre crème, feutre émeraude, bordeaux).

## Cible (positions monde, mètres)

| Zone | Position | Notes |
|---|---|---|
| Enveloppe | 52 (X) × 39 (Z), h 6.5 | entrée +Z, baie 10,4 m au centre du mur avant |
| Tapis d'arrivée | 0, 12.9 | 10,4 × 8,8 bordeaux + incrustation d'axe 3,4 × 22 à z 2.0 |
| Portique | 0, 19.5 | 2 colonnes ±4,6, portes laiton, cordons velours |
| Fontaine | 0, −0.8 | notre fontaine existante, lustre au-dessus |
| Bar | 0, −17.6 | face à l'entrée, arrière-bar contre le mur −Z |
| Blackjack ×3 | −16.6 ; z −1.6 / 3.6 / 8.8 | croupier côté −X (dos à la scène), joueurs face à la scène |
| Scène (NOTRE stage.glb) | −22.4, 3.6 | encastrée dans le mur −X, baie ouverte autour |
| Roulettes ×2 | ∓6.4, −0.8 | de part et d'autre de la fontaine |
| Machines à sous | x 14.8→22.4, rangées z −5.6 / 1.2 / 8.0 | 3 épines dos-à-dos, 9 par face = 54 postes |
| Caisse jetons | 18.8, 15.6 | comptoir 9,4 m + dosseret laiton, visible de l'entrée |
| Restaurant | x −20.5/−16/−11.5/−7 ; z 15.4 | 4 tables rondes + 4 chaises chacune |
| Vestiaire | 10.1, 17.2 | comptoir 7 m + dosseret |
| Salon VIP | 18.6, −13.4 | parois de verre, table de baccara, 6 tabourets |
| Colonnes ×8 | (−11,∓6) (19,∓6) (∓9,−12) (∓9,13) | fût marbre + base/chapiteau laiton |
| Spawn | 0, 15 | sur le tapis d'honneur, face à la fontaine |

## Étapes

### Phase 1 — Restructuration du code (blocking complet, procédural)
- [x] 1.1 `world.js` : LAYOUT 52×39 (h 6.5), nouvelles ancres (fountain, bar, blackjack×3,
      stage, slots, spawn, + roulette/restaurant/caisse/vip/vestiaire). Baie de scène
      déplacée du mur +X au mur −X ; baie d'entrée dans le mur +Z (portes laiton fermées,
      collision). Piliers aux 8 positions du handoff. Néons/appliques repositionnés.
- [x] 1.2 Entrée : tapis bordeaux 10,4×8,8, incrustation d'axe marbre 3,4×22, portique
      (dalle + 2 colonnes + portes), cordons velours le long de l'axe.
- [x] 1.3 `blackjack.js` : rotation des tables (croupier dos à −X). `jackpot.js` :
      enseigne au-dessus du pit côté −X.
- [x] 1.4 `slots.js` : 3 épines dos-à-dos ×9 machines par face (54 postes), x 14.8→22.4,
      épine centrale, tabourets.
- [x] 1.5 Nouveau module `venues.js` : restaurant, roulettes ×2 (plateau ovale, cylindre,
      tapis de mise), caisse de jetons (piles de jetons, séparations), vestiaire,
      salon VIP (verre + linteau laiton + baccara + tabourets). Collisions partout.
- [x] 1.6 Lumières : spots repositionnés (tables, bar, slots), + restaurant, VIP, scène.
      Vérifier budget maxSimultaneousLights.
- [x] 1.7 Test navigateur (port 8123, captures headless : axe, pit+scène, slots, VIP, restaurant) : marche complète, collisions, pas de mur fantôme,
      s'asseoir partout, concert OK sur la scène replacée.

### Phase 2 — Assets 3D (gratuits d'abord, modélisés sinon)
- [x] 2.1 BlenderMCP : Sketchfab / PolyHaven / Rodin décochés dans l'addon → passage
      par l'API publique Poly Haven (téléchargement direct, CC0) + modélisation via
      `execute_blender_code` (qui, lui, fonctionne).
- [x] 2.2 8 modèles CC0 Poly Haven téléchargés dans `assets/monaco/` : dining_chair_02,
      bar_chair_round_01, ArmChair_01, potted_plant_01/02, brass_candleholders,
      marble_bust_01, Chandelier_03 (non intégré). Crédits : `assets/monaco/CREDITS.md`.
- [x] 2.3 Roulette introuvable en libre → modélisée dans Blender (scène « ROULETTE »,
      la scène TINA de la chanteuse n'est pas touchée) : table ovale acajou, tapis
      avec grille et numéros 0-36 en relief, roue 37 alvéoles + séparateurs laiton,
      cône, tourelle, bille. Export `assets/monaco/roulette.glb` (492 Ko,
      use_active_scene pour ne pas embarquer TINA).
- [x] 2.4 Intégration `venues.js` : loadKit/place (conteneurs, normalisation d'échelle,
      assise au sol, ombres, collisions), remplacement des replis procéduraux
      (roulettes, chaises resto, tabourets VIP, plantes, bougeoirs) + fauteuils et
      bustes ajoutés. Repli procédural conservé si un asset manque.
- [x] 2.5 Captures : roulette, restaurant, VIP, entrée OK. Allées vérifiées libres
      (script walkcheck) ; roulettes écartées à ∓7,0 (au lieu de ∓6,4) pour laisser
      1,5 m entre bassin et table.

### Phase 3 — Finitions
- [x] 3.1 Passe visuelle : tapis VIP assombri, enseigne VIP tournée vers la salle,
      néon BLACKJACK + jackpot en bord de baie, bustes déplacés en flanc d'axe.
- [x] 3.3 LA CAISSE JOUABLE (session « gameplay », en parallèle de la session
      « 3D » qui a modélisé cashier.glb) : PNJ caissier au guichet central
      (kit du barman POUR L'INSTANT — un modèle de caissier dédié reste à
      faire), zone E devant le guichet, achat de jetons par fausse interface
      carte bleue (src/cashier.js + fenêtre #cbui dans index.html/styles.css :
      carte qui se remplit en tapant, montants 100/500/1 000/5 000, séquence
      d'autorisation factice, mention « aucun paiement réel »). Le crédit passe
      par net.wallet (le serveur borne ±100 000 et fait foi) ; les jetons
      apparaissent PHYSIQUEMENT sur le marbre (recettes fixes par montant,
      piles multicolores) puis sont aspirés vers le joueur (chips.sweep).
      La surface du marbre est MESURÉE par raycast au moment de poser les
      piles : la cote du glb bouge d'une passe à l'autre, et 3 mm suffisent à
      noyer un jeton de 4 mm. Test bout-en-bout headless :
      scratchpad/cashier-test.mjs (invite E, formulaire, 2 500 → 3 500 €,
      piles posées puis ramassées).
- [ ] 3.2 Restent ouverts : intégrer Chandelier_03, machine à sous en glb (le parc
      procédural de 54 postes est conservé), NPC clients au restaurant/roulette,
      PNJ caissier dédié (remplacer le kit barman), cocher Sketchfab/Rodin dans
      l'addon pour d'autres familles. Commit à la demande de l'utilisateur.

## Journal
- 19/08 (figurants simplifiés) : « pour les clients, utiliser les pantins de
  Mixamo (comme joueur), bien plus simple » — les clients de la salle
  instancient désormais le conteneur de `player.glb` (kit `tint` distinct du
  kit `avatar` : teinte TINTS et carrure aléatoires par personne, joueurs
  distants restés gris). `male.glb`/`male2.glb`/`female2.glb` supprimés
  (historique git), plus aucun HEAD de sonde au boot. Michelle reste le filet
  et la tenue du vestiaire. Vérifié en headless (playwright du vieux dépôt,
  scratchpad client*.png) : 6 pantins assis bar/machines, personnel intact.
- 19/08 (passe de performance — « ça laggue même sur une 4060 ») : le goulot
  n'était pas le GPU mais le CPU (draw calls et travail par frame). Cinq
  chantiers : (1) machines à sous INSTANCIÉES (slots.js, instOf) — ~810 meshes
  → 13 maîtres partagés + instances, et chaque carte d'ombre porte 13 entrées
  au lieu de ~750 ; (2) décor FUSIONNÉ (world.js) — lustres 33→3 meshes, 36
  appliques→1 (les 2 de la baie de scène ne sont plus créées : absorbe les
  surcharges sc#19/sc#23 de layout.json), 112 feuilles→1, murs 7→1, lambris
  12→2, chapiteaux 18→1, cordons 16→3, pièces 40→1, pierre fontaine 5→1 ;
  (3) fontaine en GPUParticleSystem (fallback CPU si WebGL1) — ~7 000 gouttes
  ne sont plus simulées en JS ; (4) GEL — freezeWorldMatrix sur le décor
  (l'éditeur dégèle à la sélection, applyOverrides/applyClones aussi),
  freezeMat/thawMats (util.js) sur les matériaux statiques 4 s après la 1re
  frame (le réglage Ombres dégèle-regèle) ; ombres BASSES : bar/fontaine/
  machines rendues UNE fois puis figées (world.refreshShadows() ré-arme —
  éditeur, GLB tardifs), les 3 tables restent vivantes ; (5)
  scene.skipPointerMovePicking — Babylon re-pickait TOUTE la scène à chaque
  pointermove (une souris 1000 Hz en faisait un poste CPU majeur). Nouveau
  `?perf=1` (perf.js) : FPS, draw calls, temps CPU vs GPU, verdict
  CPU-bound/GPU-bound — à faire tourner sur la machine qui rame avant
  d'optimiser plus loin. Vérifié headless (scratchpad/smoke*.mjs) : 0 erreur
  JS, 55 instances par maître, fusions en place, 6 GPUParticleSystem.
- 18/08 (HUD de mise : géométrie fixe) : la barre changeait de taille après la
  mise — RÉPÉTER/ENCAISSER sortaient du flux (`hidden`) et la barre centrée se
  recompactait, les jetons glissaient sous le curseur. Corrigé : les deux
  boutons restent EN PLACE à l'état fantôme (.ghost, inertes), leurs valeurs et
  celle du 21+3 ont une largeur réservée. Découverte au passage : `left:50% +
  translateX(-50%)` plafonnait la barre à une DEMI-fenêtre (l'espace d'un
  absolu s'arrête au bord droit) et provoquait des replis de ligne — remplacé
  par `left:0;right:0;margin:auto;width:fit-content`. Vérifié headless
  (hud-geom-test.mjs) : aucun rect ne bouge sur 2 manches, mise comprise.
- 18/08 (suite) : « on ne voit toujours pas les jetons » à la table — mesuré :
  la réserve du joueur (chipSpot k 0,86) se projetait à v ≈ −1,0, sous le bord
  du cadre assis, derrière la barre de mise. Réserve rapprochée du cercle
  (k 0,76, écart 18 cm > rayon chipsNear 0,17) + caméra assise : œil reculé à
  0,60 m derrière la pile (au lieu de 0,42) et visée abaissée (look.y 0,90).
  Piles et cercle nettement dans le cadre (v ≈ −0,6), croupier et annonces
  toujours en haut. Vérifié en capture mise + paiement.
- 18/08 (avatars « classe ») : le Xbot Mixamo des joueurs distants est remplacé
  par deux avatars habillés : homme (maillage du barman Rodin, gilet recoloré
  bleu nuit par clé de couleur sur l'atlas, clips du Xbot transplantés par visée
  de direction) → `assets/player.glb`, et femme (`singer.glb` re-habillé en robe
  satin émeraude, ses clips étaient déjà à bord) → `assets/player_f.glb`.
  Fabrique : `tools/build-avatars.py` (réutilise la mécanique de
  `retarget-singer.py`, préfixes d'os surchargés). `npc.js` charge le second kit
  avatar ; chaque joueur distant tire homme ou femme au sort. Pourquoi pas
  Rodin : clé d'essai épuisée (API_INSUFFICIENT_FUNDS), Hunyuan sans serveur
  local, Sketchfab sans clé, Ready Player Me disparu — on repart donc des
  modèles de qualité déjà dans le dépôt. L'« icosphère 2 m » vue au réimport est
  un artefact de l'importateur glTF de Blender (forme d'affichage des os), PAS
  un contenu des glb (vérifié dans le JSON des fichiers).
- 18/08 (« GROS BUG » blackjack) : le client pouvait GELER — une exception dans
  l'application d'un évènement de table figeait tout l'aval (« Le croupier
  joue » permanent, mises muettes, flammes immortelles, pas d'annonce
  BLACKJACK) alors que le serveur, lui, jouait normalement (vérifié en s'y
  connectant en observateur : la mise « ignorée » y était enregistrée).
  Correctifs : (1) chaque évènement isolé dans son try/catch + net._handle
  blindé — une erreur se logge et l'état suivant resynchronise tout ;
  (2) piles de mise à étages EXACTS via un registre par place (l'ancienne
  hauteur rnd(0,4)×CHIP_H figeait des jetons imbriqués — le « chevauchement ») ;
  (3) plus de clic muet : barre de mise grisée mais cliquable, toasts explicites
  pour mise/21+3/retirer/encaisser hors phase (pointer-events:none supprimé).
  Vérifié headless : manches complètes, annonce BLACKJACK réelle observée,
  cagnotte, empilement 4,2 mm exact, caisse re-verte.
- 18/08 (après-midi) : « le perso est dans le sol, il faut un espace » — le
  cashier.glb ne laissait que 11 cm entre comptoir et arrière-caisse (14 cm au
  vestiaire). Session 3D : les deux glb ré-exportés avec un couloir de service
  ≥ 1,1 m (arrière reculé, flancs prolongés). Session gameplay : vestiaire
  ALIGNÉ sur la caisse (LAYOUT.cloakroom z 17,2 → 15,6, même ligne de
  comptoirs) et placement du caissier rendu AUTO-ADAPTATIF — decorate() mesure
  l'espace libre réel entre dos de comptoir et arrière du glb et pose le PNJ
  au milieu (enseigne recalée sur le dosseret) ; sous 0,6 m il garde sa place
  de repli. Vérifié en capture (face, biais, couloir, front commun) + test
  d'achat re-vert.
- 18/08 (matin, session 3D) : suite aux retours — cshSignPanel_dark retiré À LA
  SOURCE du cashier.glb (re-export propre, l'enseigne CAISSE rayonne sur les
  cannelures ; le filtre /SignPanel_dark/ de decorate() ne matche plus rien et
  peut être retiré à l'occasion). L'épine des machines reste SUPPRIMÉE par choix
  utilisateur (machines dos à dos + lisse basse) — slot_spine.glb reste sur le
  disque, hors jeu ; ne pas rebrancher sans demande explicite.
- 18/08 (retours utilisateur, suite) : deux verrues enlevées. (1) Le fond
  d'enseigne du cashier.glb (cshSignPanel_dark, aplat noir de 3,6 m) mangeait
  tout le haut de la cage — jeté au chargement dans decorate(), les capitales
  CAISSE se posent à même le dosseret cannelé. (2) slot_spine.glb sort avec
  les mauvais axes (place() la dressait en tour de 9 m au milieu des allées)
  ET le repli caisson de 2,75 m se lisait comme un mur en bout de rangée →
  l'épine est SUPPRIMÉE des deux côtés : les machines dos à dos se suffisent,
  une lisse basse (0,35 m, collision) ferme l'interstice. À rebrancher si la
  session 3D ré-exporte l'épine couchée.
- 18/08 (session gameplay) : le caissier n'est plus « dans le décor » (retour
  utilisateur : torse planté dans le comptoir). Cotes du glb sondées en jeu
  (cashier-probe.mjs) : caisson jusqu'à P.z+0,20, marbre y 1,13 jusqu'à +0,30,
  dosseret à +0,41 → couloir de service de 21 cm. PNJ reculé de +0,15 à +0,36
  (ventre au rebord du marbre, posture accoudée, plus de marbre derrière lui)
  et mains remontées SUR le plan : _barStance accepte désormais `counterY`
  (npc.js, opt-in — le barman du bar garde son réglage historique).
- 17/08 (nuit, session 3D) : fini les blocs — les zones critiquées sont MODÉLISÉES
  dans Blender et remplacent leurs replis : bar_monaco.glb (demi-lune du handoff :
  comptoir courbe r 2,90→3,55 nervuré, plan de marbre r 2,78→3,70, main courante et
  repose-pieds laiton, îlot de service, arrière-bar 9,4 m — 3 étagères, ~100
  bouteilles de bottles.glb, miroir, corniche, 7 tabourets Poly Haven en arc r 4,45),
  cashier.glb (guichet à 3 fenêtres grillagées laiton avec passe-monnaie, marbre,
  dosseret cannelé, lampes), cloakroom.glb (penderie laiton, cintres, manteaux et
  chapeaux modelés, clochette), slot_spine.glb (épine art-déco cannelée, bandeau
  lumineux, couronne laiton étagée, fleurons). Matériaux riches posés à l'import par
  suffixe de nom de mesh (venues.applyLuxMats : _wood/_marbleL/_brass/_mirror/_glow…).
  Pièges d'axes consignés : nos exports Blender (front +Y, export_yup) débarquent
  l'avant vers −Z Babylon à rotY 0 → caisse/vestiaire rotY 0 (face à la salle), bar
  rotY π (arc vers l'entrée) ; les assets Poly Haven, eux, ont l'avant +Z (faceTo
  inchangé). Le miroir de l'arrière-bar était devant les étagères (bouteilles
  cachées) : reculé dans Blender + re-export. Spot caisse re-visé sur le guichet,
  spot bar avancé sur la demi-lune, néon BAR au-dessus de la corniche.
- 17/08 (soir, session gameplay) : caisse jouable (3.3). Deux sessions Claude en
  parallèle sur ce repo, coordination par messages : la session « 3D » possède
  venues.decorate()/les glb Blender, celle-ci le gameplay (cashier.js, #cbui,
  câblage main.js). Cotes du cashier.glb transmises par la session 3D : marbre
  à y 1,13 (z de P.z−0,5 à +0,3), grille dans le plan z = P.z−0,30 avec
  passe-monnaie ouvert par guichet, PNJ à (P.x, 0, P.z+0,15) — ses jambes
  clipent dans le caisson mais côté client on ne voit que le torse derrière
  les barreaux. Correctif au passage : les piles décor du repli procédural
  (Ø 34 cm) n'étaient pas dans procMeshes et restaient posées sur le glb —
  ajoutées, elles partent avec le repli.
- 17/08 (correctif) : la première passe reproduisait les coordonnées du handoff
  TELLES QUELLES — or la référence est en three.js (main-droite) et Babylon est
  main-gauche : l'expérience en marchant était le MIROIR du plan (machines à
  gauche au lieu d'à droite). Corrigé en négativant les x asymétriques (pit +
  scène → +X, machines/caisse/vestiaire → −X, VIP → arrière −X, restaurant → +X,
  baie de scène au mur +X, piliers/lustres/néons/jackpot/plantes en miroir).
  Le tableau « Cible » ci-dessus se lit désormais avec x inversé.
  Deux autres correctifs : orientation des chaises/tabourets GLB (erreur de π
  dans la formule de visée — helper faceTo() dans venues.js) et textures de
  marbre étirées (le sol 52 m et l'axe 3,4×22 partageaient l'échelle du disque
  de la fontaine ; textures dédiées marbleFloor/marbleAxis).
- 17/08 : Phase 1 faite. Enveloppe 52×39 h 6,5, sol marbre + tapis d'honneur, baie
  d'entrée avec portique et portes laiton, scène replacée mur −X (rotation arrondie au
  quart de tour dans stage.js), pit tourné croupier dos à la scène, 54 machines en
  3 épines, venues.js (roulettes, restaurant, caisse, vestiaire, VIP). layout.json
  purgé des surcharges de l'ancien plan. Captures headless (puppeteer-core + Brave,
  scratchpad/shot_*.png) : disposition conforme au handoff.
  Corrections après capture : enseigne VIP retournée vers la salle, néon BLACKJACK et
  jackpot ramenés en bord de baie (z 10,6). Le 500 sur HEAD /assets/world.glb est le
  comportement historique du serveur quand le fichier n'existe pas.
