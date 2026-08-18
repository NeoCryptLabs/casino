# Brief agent — reconstruire le casino dans Blender, en photoréaliste

Tu reçois deux références de design : un plan d'implantation (`Casino Plan.dc.html`) et une maquette volumétrique three.js (`Casino 3D.html`). Objectif : produire une **scène Blender photoréaliste** du niveau principal, avec des assets réels téléchargés plutôt que des primitives peintes, puis livrer rendus + fichiers sources.

## Prompt à copier tel quel

> Reconstruis dans Blender la scène décrite par `README.md` (tableau « Géométrie de référence », mètres, y-up dans la référence → **z-up dans Blender**, donc échange Y/Z à l'import : `y_blender = -z_three`, `z_blender = y_three`).
>
> Étapes :
> 1. **Blocking** — exporte le GLB depuis `Casino 3D.html` (bouton *Download GLB*) et importe-le comme calque de référence non rendu (collection `REF_blocking`, affichage wireframe). Toute la géométrie finale doit s'aligner dessus au centimètre. Ne modélise rien « à vue ».
> 2. **Enveloppe** — construis sol, murs (h. 5,0 m), trémie d'entrée, plafond à caissons, corniches et colonnes en géométrie propre (quads, épaisseurs réelles, chanfreins 2–3 mm sur toutes les arêtes vues). Ajoute ce que la maquette n'a pas : plafond, plinthes, luminaires encastrés, portes du salon VIP, grilles de reprise d'air.
> 3. **Assets téléchargés** — pour chaque famille de mobilier, va chercher un modèle libre de droits plutôt que de modéliser : tabourets de bar, chaises de restaurant, fauteuils du salon VIP, machines à sous, tables de jeu, lustre à pampilles, plantes, verrerie, couverts, jetons et sabots, enceintes et projecteurs de scène. Sources autorisées (licences CC0 / CC-BY à vérifier et à créditer) : **Poly Haven** (models, textures, HDRI), **ambientCG**, **Blender Studio assets**, **Sketchfab** filtré sur *Downloadable + CC*, **Chocofur free**, **BlenderKit free**. Télécharge tout ce qui est téléchargeable, range dans `assets/<famille>/`, et tiens un `assets/CREDITS.md` avec source, auteur, licence, URL.
> 4. **Matériaux PBR** — remplace les couleurs plates par des matériaux texturés : marbre crème veiné (sol en dalles 900 mm avec joints laiton), marbre sombre pour les murs, laiton brossé et laiton poli (deux nuances), feutre émeraude (velvet + normal fin), velours bordeaux (sheen), noyer verni, verre feuilleté, eau (IOR 1,33, léger displacement). Respecte la palette du README comme base colorimétrique.
> 5. **Éclairage** — HDRI intérieur nuit ou studio sombre (Poly Haven) à faible intensité pour l'ambiance, puis lumière artificielle : lustre central émissif + area lights, downlights encastrés sur trame, néons chauds des machines à sous, wash bordeaux sur la scène, spots rasants sur le marbre, lumière sous-marine dans la fontaine. Cible : ambiance nocturne chaude, noirs riches, reflets laiton, pas d'aplat gris.
> 6. **Détail réaliste** — jetons empilés sur les tables, cartes et sabots, verres et bouteilles sur le bar, couverts et bougies au restaurant, cordons de file d'attente à la caisse, tapis avec fibres (hair particles courtes ou displacement), traces de reflets sur le sol.
> 7. **Rendu** — Cycles, 1024+ samples, denoise OpenImageDenoise, résolution 3840 × 2160. Livre au minimum :
>    - **Vue du dessus** orthographique (caméra orthographic, axe -Z, cadrage exact 52 × 39 m) — pendant photoréaliste du plan.
>    - **Vue 45°** depuis l'arrivée, hauteur d'œil ~18 m, focale 35 mm équivalent, correspondant à la caméra `(34, 27, 40)` visant `(0, 2.5, 1)` de la référence.
>    - 3 vues intérieures à hauteur d'homme (1,60 m) : axe entrée→fontaine→bar, tables de blackjack avec la scène en fond, allée des machines à sous.
> 8. **Contraintes de programme à ne pas casser** : arrivée au centre du mur avant, fontaine sur l'axe, bar en fond d'axe face à l'entrée avec allée barman ≥ 0,9 m derrière un comptoir de 0,65 m, machines à sous à droite, 3 blackjack à gauche avec **le croupier côté scène** et les joueurs assis face à la scène, caisse de jetons visible dès l'entrée, restaurant et vestiaire aux angles avant, salon VIP vitré à l'arrière droit.
> 9. **Nommage et organisation** — collections par zone (`00_shell`, `01_entrance`, `02_fountain`, `03_bar`, `04_slots`, `05_blackjack`, `06_stage`, `07_cashier`, `08_dining`, `09_roulette`, `10_vip`, `11_cloakroom`), objets et matériaux nommés en clair, modificateurs appliqués sur les copies d'export.
> 10. **Livrables** — `casino_royal_monaco.blend` (assets packés), export `casino_royal_monaco.glb` (hiérarchie conservée), les rendus en PNG 16 bits, `assets/CREDITS.md`, et un court `NOTES.md` listant les écarts assumés par rapport à la référence.

## Points de vigilance

- Ne pas déplacer les équipements pour « faire joli » : les dimensions du README sont issues de la maquette validée.
- Échelle réelle obligatoire (unité Blender = 1 m). Un tabouret fait 0,75 m de haut, un comptoir 1,15 m, une table de jeu 0,88 m.
- Vérifier les licences avant d'intégrer un asset ; tout ce qui n'est pas librement redistribuable doit être remplacé ou remodélisé.
- Si un asset téléchargé est trop lourd, décimer une copie pour le viewport et garder l'original pour le rendu.
