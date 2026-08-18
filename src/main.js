/** LE MIRAGE — casino 3D temps réel (Babylon.js 8 + Havok). Point d'entrée. */
import { V3, C3, fmt, wait, clamp, lightBudget } from "./util.js";
import { buildWorld, raiseLightLimit, pruneShadowCasters, LAYOUT } from "./world.js";
import { buildFountain } from "./fountain.js";
import { buildSlots } from "./slots.js";
import { buildBar } from "./bar.js";
import { Chips } from "./chips.js";
import { Cards } from "./cards.js";
import { buildBlackjack } from "./blackjack.js";
import { Player } from "./player.js";
import { People } from "./npc.js";
import { Audio } from "./audio.js";
import { Net } from "./net.js";
import { createHeat } from "./heat.js";
import { fetchLayout, applyAnchors, applyOverrides, applyClones, loadWorldGlb, integrateWorldGlb, saveLayout } from "./layout.js";
import { createEditor } from "./editor.js";
import { createCinema } from "./cinema.js";
import { buildStage } from "./stage.js";
import { createConcert } from "./concert.js";
import { settings } from "./settings.js";
import { createMenu, menuIsOpen } from "./menu.js";
import { createChat } from "./chat.js";
import { createDealerVoice } from "./dealer.js";
import { createJackpot } from "./jackpot.js";
import { buildVenues } from "./venues.js";
import { createCashierUI } from "./cashier.js";

const B = BABYLON;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ état */

const state = {
  // La caisse est tenue par le SERVEUR (profil persistant) : cette valeur n'est
  // qu'un miroir, posé à la connexion et recalé à chaque mouvement. 2500 n'est
  // qu'un affichage d'attente, le temps que la liaison réponde.
  cash: 2500,
  slotBet: 10,
  mode: "menu",     // menu | walk | slot | table | stool | edit
  currentSlot: null,
  drinks: 0,
  spot: null,        // place assise revendiquee, partagee sur le reseau
  // POINT DE SORTIE de la place occupée : là où le corps se retrouvera en se
  // levant. Annoncé au serveur tant qu'on est assis, pour qu'il ne persiste
  // jamais une pose assise (voir seatExit, plus bas).
  safePos: null,
  advance: 0,        // avance consentie par la maison à l'arrivée, à annoncer
};

/* --------------------------------------------------------------- chargement */

function setProgress(p, txt) {
  $("loadbar").style.width = p + "%";
  if (txt) $("loadtxt").textContent = txt;
}
/**
 * UNE FRAME RENDUE — ou, à défaut, un délai.
 *
 * Le chargement s'égrène en `await frame()` pour laisser respirer l'affichage
 * entre deux étapes. Mais `requestAnimationFrame` est SUSPENDU par le
 * navigateur dès que l'onglet passe en arrière-plan : quitter l'onglet pendant
 * le chargement figeait la barre pour de bon, et il fallait recharger. Le
 * garde-fou rend la main au bout de 100 ms si aucune frame n'est venue — la
 * construction se poursuit sans rien perdre, l'onglet visible garde le rythme
 * de l'affichage.
 */
const frame = () => new Promise((r) => {
  let done = false;
  const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => requestAnimationFrame(fin));
  setTimeout(fin, 100);
});

/* --------------------------------------------------------------- démarrage */

async function boot() {
  const canvas = $("renderCanvas");
  const engine = new B.Engine(canvas, true, {
    stencil: true, antialias: true, powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
  // même plafond que le défaut du réglage « Qualité de rendu » (settings.js).
  // Le bridage à 1 sur Windows visait un GPU qu'on croyait « au tapis » : il
  // ne l'était pas — c'est le CPU qui plafonne (soumission des draw calls),
  // et le suréchantillonnage se paie côté GPU, où il reste de la marge.
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, 1.25));
  // la carte et le pilote, en clair dans la console ET dans le dump dev :
  // c'est ce qui permet de diagnostiquer « lent chez lui » sans sa machine
  try {
    const gl = engine.getGlInfo();
    window.__gpu = gl;
    console.info("[gpu]", gl.renderer, "|", gl.version);
  } catch { /* info indisponible : sans conséquence */ }

  const scene = new B.Scene(engine);
  // LE PLAFOND DE LUMIÈRES EST POSÉ AVANT LE PREMIER CHARGEMENT : c'est le
  // chargeur glTF qui le relève (cf. raiseLightLimit), et chaque .glb du décor
  // en déclenchait une bordée de compilations vouées à l'échec pendant l'écran
  // de chargement. Armé ici, il est réappliqué après chaque modèle.
  const LIGHT_CAP = Math.min(lightBudget(engine), 12);
  raiseLightLimit(scene, LIGHT_CAP);
  scene.collisionsEnabled = true;
  scene.gravity = new B.Vector3(0, -0.35, 0);
  scene.useRightHandedSystem = false;
  scene.blockMaterialDirtyMechanism = false;

  setProgress(6, "Moteur physique…");
  await frame();

  // ---- Havok ----
  let havokOK = true;
  try {
    // glue JS + .wasm servis par le MÊME paquet versionné (sinon LinkError)
    const HAVOK = "https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.10/lib/esm/";
    const mod = await import(HAVOK + "HavokPhysics_es.js");
    const havok = await mod.default({ locateFile: (f) => HAVOK + f });
    scene.enablePhysics(new B.Vector3(0, -9.81, 0), new B.HavokPlugin(true, havok));
  } catch (e) {
    console.error("Havok indisponible", e);
    havokOK = false;
    throw new Error("Impossible de charger le moteur physique Havok (connexion au CDN Babylon requise).");
  }

  setProgress(14, "Plan du casino…");
  await frame();
  // Le plan est de la DONNÉE : les ancres d'un éventuel world.glb (Blender)
  // puis le calque de l'éditeur (layout.json) se posent sur LAYOUT avant toute
  // construction. Le JSON gagne toujours sur le glb.
  const layout = await fetchLayout();
  let glbWorld = null;
  try { glbWorld = await loadWorldGlb(scene); } catch (e) { console.warn("world.glb ignoré :", e); }
  if (glbWorld) applyAnchors(LAYOUT, glbWorld.anchors);
  applyAnchors(LAYOUT, layout.anchors);

  setProgress(18, "Construction du casino…");
  await frame();
  const world = buildWorld(scene);
  integrateWorldGlb(glbWorld, scene, world);

  setProgress(34, "Fontaine…");
  await frame();
  const fountain = buildFountain(scene, world);

  setProgress(44, "Machines à sous…");
  await frame();
  const audio = new Audio();
  const machines = buildSlots(scene, world, audio);

  setProgress(54, "Personnages…");
  await frame();
  const people = await People.load(scene, world);

  setProgress(64, "Le bar…");
  await frame();
  const bar = await buildBar(scene, world, audio, people);

  setProgress(65, "Roulettes, restaurant, salon VIP…");
  await frame();
  const venues = buildVenues(scene, world, people);

  setProgress(66, "La scène…");
  await frame();
  const stage = await buildStage(scene, world, audio);

  // LE CONCERT : E devant la scène — annonce, rideau, entrée de la chanteuse,
  // musique. E à nouveau pour terminer le spectacle.
  const concert = createConcert({ scene, stage, people, audio });
  {
    const h = B.MeshBuilder.CreateBox("stageHit", { width: 3.2, height: 1.9, depth: 1.4 }, scene);
    h.position = stage.at(0, -3.4, 0.95);
    h.isVisible = false;
    h.metadata = { interact: "concert", label: "Lancer le concert", target: concert };
    stage.hit = h;
  }

  setProgress(70, "Jetons & cartes…");
  await frame();
  const chips = new Chips(scene, audio, world);
  const cards = new Cards(scene, audio, world);

  setProgress(82, "Table de blackjack…");
  await frame();

  // sol physique
  if (havokOK) {
    const pFloor = B.MeshBuilder.CreateBox("pFloor", { width: 70, height: 0.4, depth: 55 }, scene);
    pFloor.position.y = -0.2; pFloor.isVisible = false;
    new B.PhysicsAggregate(pFloor, B.PhysicsShapeType.BOX, { mass: 0, restitution: 0.1, friction: 0.9 }, scene);
  }

  const ui = makeUI();
  // LE PIT : trois tables, chacune miroir d'une table autoritaire du serveur.
  // `bj` désigne toujours celle où le joueur est assis (la 0 par défaut).
  const bjs = [];
  for (let i = 0; i < 3; i++) {
    bjs.push(buildBlackjack(scene, world, audio, chips, cards, ui, state, people, i));
  }
  let bj = bjs[0];

  // le calque de l'éditeur se rejoue une fois tout le décor construit,
  // AVANT la sonde de réflexion (un mesh caché ne doit pas s'y refléter)
  const nOver = applyOverrides(scene, layout.overrides);
  const bootClones = applyClones(scene, layout.clones, world.shadowGens[1]);
  if (nOver || bootClones.length) {
    console.log(`[plan] ${nOver} surcharge(s), ${bootClones.length} copie(s)`);
  }

  setProgress(92, "Éclairage & post-traitement…");
  await frame();

  const player = new Player(scene, canvas, audio, LAYOUT.spawn);

  // ---- post-traitement ----
  const pipe = new B.DefaultRenderingPipeline("pipe", true, scene, [player.camera]);
  pipe.samples = 4;                 // mesuré sans effet notable : on est CPU-limité
  pipe.fxaaEnabled = true;
  // Bloom RETENU. Il était généreux (seuil 0,82 / poids 0,34) et nappait tout
  // ce qui était un peu clair — badges, dorures, reflets du feutre — au point
  // d'éblouir. Seuil relevé et poids divisé par deux : les lustres et les néons
  // rayonnent encore, le reste de l'image ne bave plus.
  pipe.bloomEnabled = true;
  pipe.bloomThreshold = 0.90;
  pipe.bloomWeight = 0.16;
  pipe.bloomKernel = 96;
  pipe.bloomScale = 0.75;
  pipe.imageProcessingEnabled = true;
  pipe.imageProcessing.toneMappingEnabled = true;
  pipe.imageProcessing.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipe.imageProcessing.exposure = 1.42;
  pipe.imageProcessing.contrast = 1.30;      // noirs profonds, hautes lumières tenues
  pipe.imageProcessing.vignetteEnabled = true;
  pipe.imageProcessing.vignetteWeight = 3.4; // l'oeil est conduit vers le centre
  pipe.imageProcessing.vignetteStretch = 0.4;
  pipe.imageProcessing.vignetteColor = new B.Color4(0.05, 0.01, 0.0, 0);
  // Étalonnage cinéma : une courbe qui réchauffe les hautes lumières (l'or) et
  // refroidit à peine les ombres — le contraste ambré/bleuté d'un film de casino.
  const curve = new B.ColorCurves();
  curve.globalSaturation = 62;
  curve.highlightsHue = 34; curve.highlightsDensity = 42; curve.highlightsSaturation = 28;
  curve.midtonesHue = 30; curve.midtonesDensity = 22; curve.midtonesSaturation = 14;
  curve.shadowsHue = 220; curve.shadowsDensity = 26; curve.shadowsSaturation = 16;
  pipe.imageProcessing.colorCurves = curve;
  pipe.imageProcessing.colorCurvesEnabled = true;
  pipe.grainEnabled = true;
  pipe.grain.intensity = 5.5;                 // grain de pellicule, pas de bruit
  pipe.grain.animated = true;
  pipe.chromaticAberrationEnabled = true;
  pipe.chromaticAberration.aberrationAmount = 3.4;
  pipe.sharpenEnabled = true;
  pipe.sharpen.edgeAmount = 0.24;
  // Halo anamorphique : COUPÉ par défaut. C'était l'éblouissement le plus
  // franc — des traînées et des fantômes sur chaque source vive, qui passaient
  // devant le jeu. Réglages conservés et adoucis : le paramètre « Halos
  // anamorphiques » du menu les rallume pour qui les veut.
  pipe.lensFlareEnabled = false;
  pipe.lensFlareStrength = 0.9;
  pipe.lensFlareHaloWidth = 0.42;
  pipe.lensFlareGhostDispersal = 0.28;
  pipe.lensFlareThreshold = 0.92;
  pipe.depthOfFieldEnabled = false;
  pipe.depthOfFieldBlurLevel = B.DepthOfFieldEffectBlurLevel.Medium;

  // occlusion ambiante
  let ssao = null;
  try {
    ssao = new B.SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.6, blurRatio: 1 }, [player.camera]);
    ssao.totalStrength = 1.05;
    ssao.radius = 0.9;
    ssao.expensiveBlur = true;
    ssao.samples = 12;
    ssao.maxZ = 40;
  } catch (e) { console.warn("SSAO2 non supporté", e); }

  // --- réflexions : une sonde rendue depuis l'intérieur du casino remplace
  // l'environnement HDR par défaut (qui est un extérieur : le sol de marbre
  // reflétait un ciel). Rendue quelques frames puis figée.
  const probe = new B.ReflectionProbe("probe", 256, scene, true);
  probe.position = V3(LAYOUT.fountain.x, 3.2, LAYOUT.fountain.z);
  probe.renderList.push(
    ...scene.meshes.filter((m) =>
      m.isVisible && m.isEnabled() && m.material &&
      !/^(card|chip|sheet|waterSurf|w2|w3)/.test(m.name))
  );
  // une frame sur trois pendant l'échauffement : chaque rendu de sonde, c'est
  // la salle entière ×6 faces — à cadence 1, elle triplait le coût des
  // premières secondes, celles où tout compile déjà. Le résultat figé est le
  // même : seule la DERNIÈRE passe avant le gel compte.
  probe.refreshRate = 3;
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 1.95;
  setTimeout(() => { probe.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE; }, 1500);

  // pit (2) + scène (2) + restaurant/VIP/caisse. Le plafond n'est plus deviné
  // d'après l'user-agent mais LU sur le pilote : c'est le nombre de blocs
  // uniformes disponibles qui commande, et lui seul (cf. lightBudget). Sur
  // ANGLE/D3D11 il vaut 8, sur Metal davantage — sans jamais dépasser les 12
  // lumières que la salle sait utiliser.
  raiseLightLimit(scene, LIGHT_CAP);
  console.info("[gpu] budget lumières/matériau :", LIGHT_CAP);

  // Le décor est complet : chaque spot ne garde que ce qu'il peut réellement
  // assombrir. C'est le poste de soumission le plus lourd de la frame.
  {
    const pr = pruneShadowCasters(world);
    console.info(`[ombres] projeteurs : ${pr.before} -> ${pr.after}`);
  }

  // LA CHALEUR — le multiplicateur de série rendu comme un incendie. Créée ici
  // et pas avec la table : elle a besoin de la caméra du joueur (distorsion,
  // secousse), qui n'existe qu'une fois `player` construit.
  const heat = createHeat({
    scene, world, audio,
    camera: player.camera,
    feltCenter: bj.tableCenter(),
  });
  for (const t of bjs) t.setHeat(heat);

  /* ------------------------------------------------ caméras de plateau */

  // Des ACTEURS-CAMÉRAS fixes, posés dans le monde — le paradigme Unreal :
  // s'asseoir à une table COUPE vers sa caméra ; la caméra elle-même est un
  // objet sélectionnable en mode éditeur (gizmos, molette pour le FOV), et son
  // cadrage est persisté dans le plan (layout.cameras). Le personnage, lui,
  // reste dans le monde.
  const camActors = {};
  {
    const mkCam = (key, pos, look, fov) => {
      const body = B.MeshBuilder.CreateBox("camActor:" + key,
        { width: 0.16, height: 0.16, depth: 0.26 }, scene);
      const lens = B.MeshBuilder.CreateCylinder("camLens:" + key,
        { height: 0.14, diameterTop: 0.13, diameterBottom: 0.05, tessellation: 12 }, scene);
      lens.rotation.x = Math.PI / 2;
      lens.position.z = 0.19;
      lens.parent = body;
      lens.isPickable = false;
      const mat = new B.StandardMaterial("camActorM:" + key, scene);
      mat.emissiveColor = new B.Color3(0.2, 0.55, 1);
      mat.disableLighting = true;
      mat.alpha = 0.92;
      body.material = mat; lens.material = mat;
      body.position.copyFrom(pos);
      const d = look.subtract(pos);
      body.rotation.y = Math.atan2(d.x, d.z);
      body.rotation.x = Math.atan2(-d.y, Math.hypot(d.x, d.z));
      body.metadata = { camActor: key, fov };
      body.setEnabled(false);            // visible seulement en mode éditeur
      camActors[key] = body;
    };
    /**
     * Cadrage par défaut « Inscryption », calculé pour la place centrale.
     *
     * L'œil était à 0,52 m devant la chaise, à 1,38 m : penché si bas et si
     * près du tapis qu'il coupait les deux extrémités de l'information. En
     * projetant les points de la table (v = ±1 aux bords de l'image), le
     * panneau de message sortait par le haut (v = +1,03) tandis que mes piles
     * de jetons (v = -1,56) et l'étiquette de ma mise (v = -1,13) sortaient par
     * le bas : on jouait sans voir sa propre mise.
     *
     * L'œil recule de 20 cm et monte de 11 cm, la focale s'ouvre à peine
     * (0,94). L'écart angulaire entre le râtelier du croupier et mes jetons
     * passe alors sous la hauteur du champ : râtelier à v = +0,48, cartes du
     * croupier +0,22, mes cartes -0,23, cercle de mise -0,42, étiquette -0,55,
     * sommet de mes piles -0,88. Tout est dans le cadre, avec de la marge.
     */
    // UNE CAMÉRA PAR CHAISE (« table0:3 » = table 0, place 3), pas par table :
    // le cadrage n'était calculé que pour la place centrale — assis ailleurs,
    // on voyait ses cartes et ses jetons distribués sur le CÔTÉ de l'image.
    // Même formule pour chaque place, orientée de SA chaise vers le centre.
    bjs.forEach((t, i) => {
      t.SEATS.forEach((s, si) => {
        if (t.NPC_SEATS.includes(si)) return;    // place du figurant : pas de caméra
        // Ancrée sur la ZONE DE JEU, pas sur la chaise : en bord d'ovale, les
        // cartes sont ~25 % plus loin de la chaise qu'au centre — à distance
        // fixe de la chaise, tout paraissait loin.
        // L'œil se règle sur SA PILE DE JETONS, l'objet le plus proche du
        // cadre : 0,42 m derrière (invariant de la place centrale). Ancré sur
        // les cartes, il se retrouvait en bord d'ovale presque au-dessus de la
        // pile, qui sortait par le bas de l'image. La visée, elle, reste sur
        // les cartes (0,22 m au-delà) : le croupier tient dans le haut.
        const seatW = t.seatPos(si);
        const spotW = t.toWorld(s.cardSpot);
        const chipW = t.toWorld(s.chipSpot);
        const dir = spotW.subtract(seatW); dir.y = 0; dir.normalize();
        // MESURÉ le 18/08 : à 0,42 m derrière la pile, celle-ci se projetait à
        // v ≈ −1,0 — sous le bord de l'image, DERRIÈRE la barre de mise. On
        // gagnait « +300 € » sans voir un jeton. Œil reculé à 0,60 m et visée
        // abaissée : la pile remonte à v ≈ −0,6, cercle et réserve dans le
        // cadre, le croupier garde le haut.
        const pos = chipW.subtract(dir.scale(0.60)); pos.y = 1.49;
        const look = spotW.add(dir.scale(0.22)); look.y = 0.90;
        mkCam("table" + i + ":" + si, pos, look, 0.94);
      });
    });
    // cadrages sauvegardés dans le plan : ils priment sur les défauts.
    // Ancien format « table0 » (une caméra par table, réglée pour la place
    // centrale) : appliqué à la place 2, puis retiré — la prochaine
    // sauvegarde n'écrira plus que le format par chaise.
    for (const [k, sv] of Object.entries(layout.cameras || {})) {
      let a = camActors[k];
      if (!a && /^table\d+$/.test(k)) {
        a = camActors[k + ":2"];
        delete layout.cameras[k];
      }
      if (!a || !Array.isArray(sv.p)) continue;
      a.position.set(sv.p[0], sv.p[1], sv.p[2]);
      if (Array.isArray(sv.r)) { a.rotationQuaternion = null; a.rotation.set(sv.r[0], sv.r[1], sv.r[2]); }
      if (Number.isFinite(sv.fov)) a.metadata.fov = sv.fov;
      // distance de la poignée de visée en mode éditeur — pas de rôle au rendu
      if (Number.isFinite(sv.aim)) a.metadata.aimDist = sv.aim;
    }
  }

  // CINÉMA — ralenti de la révélation, arrêt sur image du bust
  const cinema = createCinema({ scene, pipe, audio });
  for (const t of bjs) t.setCinema(cinema);

  // LA VOIX DU CROUPIER — une seule pour tout le pit : le budget de paroles
  // est commun, deux tables ne peuvent donc pas se parler dessus.
  const dealerVoice = createDealerVoice({ audio, settings });
  for (const t of bjs) t.setVoice(dealerVoice);

  // LE JACKPOT DU PIT — l'enseigne au-dessus des tables. La cagnotte vit côté
  // serveur ; ici on ne fait que la regarder monter.
  const jackpot = createJackpot({ scene, audio, ui });

  // mode éditeur (F2) : vol libre, gizmos, sauvegarde du plan
  const editor = createEditor({ scene, canvas, player, state, ui, audio, layout, world, bootClones, camActors });

  // --- perf : la cadence de rafraîchissement des ombres (la table d'abord,
  // le décor ensuite) est pilotée par le réglage « Ombres » — voir settings.js.
  scene.skipPointerMovePicking = true;
  engine.enableOfflineSupport = false;
  // Le TEST de visibilité lui-même a un prix : pour chaque mesh, chaque frame,
  // Babylon vérifie sphère PUIS boîte englobante. La stratégie « inclusion
  // optimiste + sphère seule » coupe ce travail de moitié — au pire quelques
  // meshes en bord de champ sont dessinés pour rien, rien ne change à l'image.
  {
    const cs = B.AbstractMesh.CULLINGSTRATEGY_OPTIMISTIC_INCLUSION_THEN_BSPHERE_ONLY;
    for (const m of scene.meshes) m.cullingStrategy = cs;
    scene.onNewMeshAddedObservable.add((m) => { m.cullingStrategy = cs; });
  }

  setProgress(100, "Prêt");
  await frame();

  /* ------------------------------------------------------------- boucle */

  /* ------------------------------------------------------------- réseau */

  // Le salon existe AVANT la liaison : sans serveur il reste utilisable et
  // répond « hors ligne » plutôt que d'avaler ce qu'on tape.
  const chat = createChat({ player, audio });
  // les piques du croupier partent dans le salon — créé après la voix
  dealerVoice.setChat(chat);

  // Multijoueur : purement optionnel. Sans serveur WebSocket en face, `Net`
  // retente en arrière-plan et le jeu tourne exactement comme avant.
  const net = new Net({
    scene, people, player,
    // position réelle de chaque place assise, pour poser l'avatar sur la chaise
    spotPos: (spot) => {
      if (!spot) return null;
      const parts = spot.split(":");
      // "blackjack:table:place" — l'ancien format à 2 segments reste accepté
      if (parts[0] === "blackjack") {
        const t = parts.length === 3 ? Number(parts[1]) : 0;
        const n = Number(parts[parts.length - 1]);
        return bjs[t] ? bjs[t].seatPos(n) : null;
      }
      if (parts[0] === "bar") return bar.stools[Number(parts[1])] || null;
      return null;
    },
    // chaque table serveur nourrit sa jumelle de mise en scène
    onTable: (st, evs, tableIdx) => bjs[tableIdx]?.applyServer(st, evs, net.id),
    // le concert appartient à la salle : le serveur dit la phase, on la joue
    onConcert: (st) => concert.applyServer(st),
    /**
     * LA CAGNOTTE DU PIT. Elle monte en silence ; quand elle tombe, elle
     * s'annonce à toute la salle — c'est le seul événement du casino que tout
     * le monde apprend en même temps, où qu'il se trouve.
     */
    onJackpot: (m) => {
      jackpot.set(m.value);
      if (m.hit) jackpot.celebrate(m.hit, m.hit.pid != null && m.hit.pid === net.id);
    },
    onCount: (n) => {
      const el = $("players");
      if (el) { el.hidden = n < 2; el.textContent = n + " joueurs"; }
    },
    onChat: (m) => chat.receive(m),
    /**
     * LE RETOUR AU CASINO. Le serveur rend ce qu'il avait gardé de la dernière
     * session : nom, caisse, dernière position DEBOUT, préférences. Rien n'est
     * additionné ici — on repose ce qu'on nous annonce.
     */
    onProfile: (pr) => {
      if (Number.isFinite(pr.cash)) { state.cash = pr.cash; ui.updateCash(); }
      if (Number.isFinite(pr.drinks)) state.drinks = pr.drinks;
      if (Number.isFinite(pr.slotBet)) setSlotBet(pr.slotBet, true);
      // Le pseudo reste au client : c'est lui qu'on vient de saisir à la porte.
      // Le nom du serveur ne sert qu'à qui arrive sans rien en mémoire — un
      // autre navigateur, un stockage nettoyé.
      if (pr.name && !settings.get("pseudo")) settings.set("pseudo", pr.name);
      state.advance = pr.advance || 0;
      if (!pr.saved) console.info("[net] session volatile : rien ne sera retenu");
      // ...et là où il s'était arrêté. Jamais en pleine partie (voir setEntry) :
      // ça ne vaut que pour le pas qui va franchir l'écran-titre.
      if (Array.isArray(pr.p)) {
        menu.setEntry(V3(pr.p[0], LAYOUT.spawn.y, pr.p[2]), pr.r);
      }
    },
    // la caisse du serveur fait foi : machine à sous et bar lui déclarent leur
    // mouvement, il répond par le solde, et c'est celui-là qui s'affiche
    onWallet: (cash) => { state.cash = cash; ui.updateCash(); },
    // ...et le plan des places, pour qu'il sache reposer un joueur tout seul
    spotMap,
  });
  chat.bind(net);
  // le concert émet ses intentions vers le serveur ; sans liaison, il retombe
  // sur sa machine locale et le jeu reste jouable seul
  concert.bind(net);
  editor.bind(net);                // l'éditeur (F2/P) n'ouvre qu'en dev
  net.connect();

  /* ------------------------------------------------------------- debug */

  // JOURNAL DE BORD (dev) : tout événement notable est horodaté, gardé dans
  // un tampon circulaire (window.__dbglog), affiché en console ET remonté au
  // serveur — le back-end voit ce que vit chaque client.
  const DBGBUF = (window.__dbglog = []);
  let _dlogLast = 0, _dlogCount = 0;
  function dlog(tag, msg, data) {
    const line = `${(performance.now() / 1000).toFixed(1)}s [${tag}] ${msg}`
      + (data !== undefined ? " " + JSON.stringify(data) : "");
    console.log("%c" + line, "color:#e8b34a");
    DBGBUF.push(line);
    if (DBGBUF.length > 300) DBGBUF.shift();
    // remontée serveur, plafonnée à 8 lignes/s pour ne pas inonder
    const now = performance.now();
    if (now - _dlogLast > 1000) { _dlogLast = now; _dlogCount = 0; }
    if (net.dev && _dlogCount++ < 8 && net.ws?.readyState === 1) {
      net.ws.send(JSON.stringify({ t: "dev", msg: line }));
    }
  }
  window.__dev = window.__dev || {};
  window.__dev.dump = () => "[gpu] " + (window.__gpu?.renderer || "?") + "\n" + DBGBUF.join("\n");

  // battement de coeur du déplacement : position/FPS/intention toutes les 3 s
  let _hb = 0;
  scene.onBeforeRenderObservable.add(() => {
    _hb += engine.getDeltaTime();
    if (_hb < 3000 || state.mode !== "walk") return;
    _hb = 0;
    const p2 = player.position, cd = player.camera.cameraDirection;
    dlog("mov", `pos(${p2.x.toFixed(1)},${p2.z.toFixed(1)}) fps=${engine.getFps().toFixed(0)}`
      + ` camDir=${cd.length().toFixed(3)} colOn=${player.camera.checkCollisions}`);
  });

  // DEV : chaque collision inhabituelle est nommée à l'écran — l'outil
  // anti « murs fantômes ». Sol et murs d'enceinte exclus (permanents).
  // Auto-rapport de blocage : position + inventaire des solides à moins de
  // 50 cm. « AUCUN solide proche » prouverait une cause HORS collisions.
  player.onStuck = () => {
    const pp = player.position;
    const near = [];
    for (const msh of scene.meshes) {
      if (!msh.checkCollisions || !msh.isEnabled() || msh.name === "floor") continue;
      const bb = msh.getBoundingInfo().boundingBox;
      if (pp.x > bb.minimumWorld.x - 0.5 && pp.x < bb.maximumWorld.x + 0.5
        && pp.z > bb.minimumWorld.z - 0.5 && pp.z < bb.maximumWorld.z + 0.5
        && bb.minimumWorld.y < 1.7 && bb.maximumWorld.y > 0.2) {
        near.push(msh.name + (msh.isVisible ? "" : "*"));
      }
    }
    // vérité triangulaire : un rayon dans la direction du regard, sur les
    // SEULS solides — les bbox mentent, les triangles non
    const fwd = player.camera.getDirection(B.Axis.Z); fwd.y = 0; fwd.normalize();
    const ray = new B.Ray(pp, fwd, 1.4);
    const hit = scene.pickWithRay(ray, (mm) => mm.checkCollisions && mm.isEnabled());
    const cd = player.camera.cameraDirection;
    // garde-sol : hauteur du BAS de l'ellipsoïde au-dessus du sol réel.
    // Négative = ellipsoïde encastrée dans le plancher — c'était la cause des
    // blocages « sans aucun solide proche » (le sol est filtré partout ici).
    const gRay = new B.Ray(pp, new B.Vector3(0, -1, 0), 4);
    const gHit = scene.pickWithRay(gRay, (mm) => mm.checkCollisions && mm.isEnabled());
    const clr = gHit?.hit ? pp.y - player.baseY - gHit.pickedPoint.y : NaN;
    const msg = `BLOQUÉ à (${pp.x.toFixed(1)}, ${pp.z.toFixed(1)}) — `
      + (near.length ? near.join(", ") : "AUCUN solide proche !")
      + ` | rayonAvant=${hit?.hit ? hit.pickedMesh.name + "@" + hit.distance.toFixed(2) : "libre"}`
      + ` | garde-sol=${Number.isFinite(clr) ? (clr * 100).toFixed(1) + "cm" : "?"}`
      + ` | camDir=${cd.length().toFixed(4)} | fps=${engine.getFps().toFixed(0)}`;
    dlog("STUCK", msg);
    if (net.dev) ui.toast("[dev] " + msg, "lose");
  };

  player.onCollideDebug = (mesh) => {
    const c = mesh.getBoundingInfo().boundingBox.centerWorld;
    dlog("col", `${mesh.name}${mesh.isVisible ? "" : "*"} (${c.x.toFixed(1)},${c.z.toFixed(1)})`);
    if (!net.dev || state.mode !== "walk") return;
    if (/^(floor|wall\b)/.test(mesh.name)) return;
    ui.toast(`[dev] contact : ${mesh.name}${mesh.isVisible ? "" : " (INVISIBLE)"} à (${c.x.toFixed(1)}, ${c.z.toFixed(1)})`);
  };

  // transitions d'état visibles dans le journal
  let _lastMode = state.mode, _lastConcert = "idle";
  scene.onBeforeRenderObservable.add(() => {
    if (state.mode !== _lastMode) { dlog("mode", _lastMode + " -> " + state.mode); _lastMode = state.mode; }
    if (concert.state !== _lastConcert) { dlog("concert", _lastConcert + " -> " + concert.state); _lastConcert = concert.state; }
  });

  /* ------------------------------------------------------------- boucle */

  /* ------------------------------------------------------------- menu */

  // L'ÉCRAN-TITRE n'est pas une page à part : le casino est déjà là, derrière,
  // et la caméra du joueur en fait lentement le tour. « Entrer » ne charge
  // rien — ça repose simplement le joueur sur ses pieds.
  const menu = createMenu({
    player, audio,
    driftCenter: V3(LAYOUT.fountain.x, 0, LAYOUT.fountain.z),
    onPlay: (first) => {
      audio.init(); audio.resume();
      $("hud").hidden = false;
      state.mode = "walk";
      ui.updateCash();
      setSlotBet(state.slotBet);
      player.lock();
      if (first) {
        audio.say?.("bienvenue", { delay: 900 });
        // un habitué n'est pas accueilli comme un inconnu
        const pr = net.profile;
        ui.toast(pr && pr.saved && !pr.fresh
          ? "Content de vous revoir au Mirage" : "Bienvenue au Mirage");
      }
      // LA MAISON A RÉ-AVANCÉ pendant que le joueur choisissait sa musique :
      // on le lui dit ici, une fois, et après le mot d'accueil.
      if (state.advance) {
        const v = state.advance;
        state.advance = 0;
        setTimeout(() => ui.toast("La maison vous avance " + fmt(v) + " €", "win"), 3000);
      }
    },
    onResume: () => player.lock(),
    onHome: () => {
      $("hud").hidden = true;
      $("prompt").hidden = true;
      state.mode = "menu";
    },
  });

  // LA CAISSE — fausse interface de paiement par carte : elle crédite le solde
  // (canal wallet, le serveur borne) et pose les jetons sur le marbre du
  // guichet. Voir cashier.js ; la zone E vit dans venues.js (buildCashier).
  const cashierUI = createCashierUI({ state, ui, audio, net, chips, player, venues });

  let hovered = null, tick = 0, devStreakIdx = 0, fpsT = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    menu.tick(dt);                 // la ronde de caméra de l'écran-titre
    player.update(dt);
    const p = player.position;
    // tant que la ronde possède la caméra, on n'émet pas de pose (voir _send)
    net.ghost = menu.drifting;
    net.tick(dt, state.spot, state.safePos);

    for (const m of machines) m.tick(dt, p);
    for (const t of bjs) t.tick(dt, p);
    heat.tick(dt);
    editor.tick(dt);
    bar.tick(dt, p);
    venues.tick?.(dt, p);
    for (const c of cards.live) c.tick(dt);

    audio.setWaterDistance(B.Vector3.Distance(p, fountain.center));
    stage.tick(dt);
    concert.tick(dt, p);
    jackpot.tick(dt);
    // LOCALISATION du concert : distance ET côté. Le panoramique est la
    // projection de la direction de la scène sur l'axe droit de la caméra
    // (-1 plein gauche, +1 plein droit) — tourner la tête déplace le chant
    // d'une oreille à l'autre, c'est ce qui permet de le situer sans le voir.
    {
      const sc = stage.center();
      const toStage = sc.subtract(p); toStage.y = 0;
      const L = toStage.length();
      let pan = 0;
      if (L > 0.5) {
        const right = player.camera.getDirection(B.Axis.X); right.y = 0; right.normalize();
        pan = B.Vector3.Dot(toStage.scale(1 / L), right);
      }
      audio.setConcertDistance(B.Vector3.Distance(p, sc), pan);
    }
    // L'ambiance vit sur la scène quand on se balade, et devient un fond
    // général dès qu'on s'assied à une table. L'écran-titre est global lui
    // aussi : c'est là qu'on choisit la piste, elle ne peut pas y être
    // atténuée par une caméra qui dérive à l'autre bout de la salle.
    audio.setAmbienceDistance(B.Vector3.Distance(p, stage.center()),
      state.mode === "table" || state.mode === "menu");
    if (stage.hit) {
      // Le concert appartient à la salle : l'invite doit dire ce qui se passe,
      // y compris quand c'est un AUTRE joueur qui l'a lancé.
      const cs = concert.state;
      stage.hit.metadata.label = cs === "performing" ? "Terminer le concert"
        : cs === "bow" || cs === "leaving" || cs === "closing" ? "Fin du spectacle…"
        : concert.running ? "Le spectacle commence…" : "Lancer le concert";
    }

    // visée / invite d'interaction (raycast throttlé)
    if (state.mode === "walk") {
      if ((tick++ & 3) === 0) hovered = player.pick(3.4);
      const m = hovered;
      if (m) {
        const busy = spotTaken(m);
        $("prompt").hidden = false;
        $("promptTxt").textContent = busy ? "Place déjà occupée" : m.label;
        $("crosshair").classList.toggle("hot", !busy);
      } else {
        $("prompt").hidden = true;
        $("crosshair").classList.remove("hot");
      }
    } else if (state.mode !== "stool") {
      $("prompt").hidden = true;
      $("crosshair").classList.remove("hot");
    }

    // compteur d'images — paramètre JEU, quatre rafraîchissements par seconde
    fpsT += dt;
    if (fpsT > 0.25) {
      fpsT = 0;
      const el = $("fps");
      if (!el.hidden) el.textContent = engine.getFps().toFixed(0) + " FPS";
    }
  });

  // le hit-stop est un saut de PRÉSENTATION : la boucle tourne, l'image gèle
  engine.runRenderLoop(() => { if (!cinema.frozen()) scene.render(); });
  addEventListener("resize", () => engine.resize());

  /* ------------------------------------------------------------- entrées */

  addEventListener("keydown", async (e) => {
    // LE GUICHET AVANT TOUT : ouvert, on y tape un numéro de carte, pas une
    // direction de marche — il avale donc tout le clavier, Échap le referme.
    if (cashierUI.isOpen()) {
      if (e.code === "Escape") cashierUI.close();
      return;
    }
    // LE SALON D'ABORD, avant tout le reste. Ouvert, il prend TOUT le clavier :
    // sinon taper « chaud » ferait marcher le joueur (ZQSD), demanderait une
    // carte (H) et déclencherait la triche de chaleur (M). Fermé, il ne
    // regarde que ⏎ — et pas au menu ni dans l'éditeur, qui ont leurs propres
    // usages de la touche.
    if (chat.isOpen() || (!menuIsOpen() && !player.editing)) {
      if (chat.key(e)) return;
    }
    // DEV UNIQUEMENT : M fait défiler les paliers de chaleur (série forcée
    // côté serveur -> flammes, badge ×, bonus au prochain gain, extinction à
    // la prochaine défaite). Traité EN PREMIER, et chaque blocage s'explique
    // au lieu d'échouer en silence. e.key et pas e.code : sur AZERTY la touche
    // M physique envoie le code "Semicolon" — le caractère, lui, ne ment pas.
    // DEV : X bascule le noclip (traverser les murs). Deux usages : se
    // libérer d'un blocage, et le PROUVER — si on reste bloqué collisions
    // coupées, la cause n'est pas une collision.
    if ((e.key === "x" || e.key === "X") && net.dev && state.mode === "walk") {
      player.camera.checkCollisions = !player.camera.checkCollisions;
      ui.toast(player.camera.checkCollisions
        ? "[dev] collisions RÉACTIVÉES" : "[dev] NOCLIP — collisions coupées");
      return;
    }
    if (e.key === "m" || e.key === "M") {
      console.log("[dev] M —", { dev: net.dev, mode: state.mode });
      if (!net.dev) {
        ui.toast("DEV inactif — serveur pas en mode dev (ou page pas rechargée)", "lose");
      } else if (state.mode !== "table") {
        ui.toast("DEV — asseyez-vous à une table de blackjack d'abord");
      } else {
        const cycle = [0, 1, 2, 3, 7];
        devStreakIdx = (devStreakIdx + 1) % cycle.length;
        net.bj("devstreak", { value: cycle[devStreakIdx] });
        ui.toast("DEV — série " + cycle[devStreakIdx] + " : " +
          (["éteint", "TIÈDE ×1,2", "CHAUD ×1,5", "BRÛLANT ×2", "INFERNO ×3"][devStreakIdx]));
      }
      return;
    }
    if (e.code === "KeyE" && state.mode === "walk" && hovered) {
      interact(hovered);
    } else if (e.code === "KeyE" && state.mode === "stool") {
      doDrink();
    } else if (e.code === "Escape") {
      // Assis, Échap rend d'abord sa liberté au joueur — c'est ce que promet le
      // HUD. Debout, il ouvre la pause. (Souris verrouillée, le navigateur mange
      // la touche : c'est alors player.onUnlock qui prend le relais.)
      if (state.mode === "table") leaveTable();
      else if (state.mode === "stool") standUp();
      else if (state.mode === "slot") leaveSlot();
      else if (state.mode === "walk") menu.pause();
    } else if (state.mode === "table") {
      // raccourcis blackjack
      if (e.code === "KeyH" || e.code === "KeyT") net.bj("hit");
      // UNE SEULE TOUCHE POUR « CONTINUER » : elle repose la mise pendant les
      // mises, et reste quand c'est à moi. C'est ce qui rend l'enchaînement
      // possible sans jamais lâcher la barre d'espace — la boucle du jeu.
      if (e.code === "KeyR" || e.code === "Space") {
        net.bj(bj && bj.G.phase === "betting" ? "rebet" : "stand");
      }
      if (e.code === "KeyC") tryBank();             // encaisser la cagnotte
      if (e.code === "KeyB") tryBuyTime();          // recharger la réserve de temps
      if (e.code === "KeyD") net.bj("double");
      if (e.code === "KeyS") net.bj("split");
      if (e.code === "KeyO") net.bj("insure");
      if (e.code === "KeyN") net.bj("noinsure");
      if (e.code === "Digit1") tryBet(5);
      if (e.code === "Digit2") tryBet(25);
      if (e.code === "Digit3") tryBet(100);
      if (e.code === "Digit4") tryBet(500);
    }
  });

  // molette : mise de la machine à sous
  addEventListener("wheel", (e) => {
    if (state.mode !== "slot") return;
    setSlotBet(state.slotBet + (e.deltaY < 0 ? 5 : -5));
  }, { passive: true });

  canvas.addEventListener("click", () => {
    if (menuIsOpen()) return;
    // Verrouiller la souris rend le focus au canvas : la saisie en cours
    // perdrait le clavier en pleine phrase, et les touches repartiraient
    // dans les jambes du joueur.
    if (chat.isOpen()) return;
    if (cashierUI.isOpen()) return;
    if (state.mode === "walk" && !player.locked) player.lock();
    if (state.mode === "table") {
      const c = pickBankChip();
      if (c) tryBet(c.metadata.value);
    }
  });

  /* MISER EN POUSSANT SES JETONS — assis à la table la souris est libre :
   * cliquer une colonne de SA banque (metadata.keep) mise un jeton de cette
   * valeur, exactement comme le bouton du HUD. Seule la banque du joueur est
   * cliquable : ni les mises déjà posées, ni les jetons des PNJ. */
  function pickBankChip() {
    const p = scene.pick(scene.pointerX, scene.pointerY,
      (m) => m.metadata?.chip && m.metadata?.keep);
    return p?.hit ? p.pickedMesh : null;
  }
  // au survol : toute la colonne s'allume et le curseur devient une main —
  // sans ça, rien ne dit que ces jetons-là se laissent pousser
  let chipGlowVal = 0;
  const CHIP_GLOW = new B.Color3(1, 0.82, 0.35);
  function setChipGlow(v) {
    chipGlowVal = v;
    for (const m of chips.pool) {
      const on = !!v && m.metadata?.keep && m.metadata.value === v;
      m.renderOutline = on;
      if (on) { m.outlineColor = CHIP_GLOW; m.outlineWidth = 0.0016; }
    }
    canvas.style.cursor = v ? "pointer" : "";
  }
  canvas.addEventListener("pointermove", () => {
    if (state.mode !== "table") { if (chipGlowVal) setChipGlow(0); return; }
    const c = pickBankChip();
    const v = c ? c.metadata.value : 0;
    if (v !== chipGlowVal) setChipGlow(v);
  });

  /** Une place tenue par un AUTRE joueur ne peut pas être prise. */
  const spotTaken = (meta) => !!meta.spot && net.occupied().has(meta.spot);

  function interact(meta) {
    if (spotTaken(meta)) {
      audio.lose();
      ui.toast("Place déjà occupée", "lose");
      return;
    }
    audio.ui();
    if (meta.interact === "concert") {
      if (meta.target.state === "performing") { meta.target.stop(); ui.toast("Le spectacle se termine"); }
      else if (!meta.target.running) { meta.target.start(); ui.toast("Mesdames et messieurs…"); }
      // un concert lancé par quelqu'un d'autre n'appartient plus à personne :
      // on le dit, plutôt que de laisser la touche sans effet
      else ui.toast("Le spectacle est déjà en cours");
      return;
    }
    if (meta.interact === "bar") return doDrink();
    if (meta.interact === "cashier") return cashierUI.open();
    if (meta.interact === "slot") return enterSlot(meta.target);
    if (meta.interact === "blackjack") return sitTable(meta.seat, meta.table || 0);
    if (meta.interact === "seat") return sitStool(meta);
  }

  /* -------------------------------------------------- points de sortie */

  /**
   * DERRIÈRE LA CHAISE — où l'on repose le joueur en le relevant d'une table.
   * Revenir à sa position d'approche le coinçait entre le siège et le plateau.
   *
   * Ce point sert deux fois. Au lever, bien sûr. Et tant qu'il est assis, il
   * est annoncé au serveur comme POINT DE SORTIE : si le joueur ferme son
   * onglet à table, c'est ÇA qui sera persisté, jamais l'œil du joueur assis —
   * sans quoi il rouvrirait les yeux la tête dans le feutre, à l'intérieur de
   * la chaise, à sa prochaine visite.
   */
  function seatExit(tableIdx, seat) {
    const t = bjs[tableIdx];
    if (!t || !Number.isInteger(seat) || !t.SEATS[seat]) return null;
    return backFrom(t.seatPos(seat), t.tableCenter(), 0.9);
  }

  /**
   * Pour un tabouret ou une machine, pas de calcul : le joueur vient d'arriver
   * là DEBOUT, par ses propres jambes. L'endroit est donc praticable par
   * construction — on le garde tel quel.
   */
  const standingHere = () => V3(player.position.x, player.baseY, player.position.z);

  /** Un pas en arrière depuis une assise, en s'éloignant de ce qu'on regarde. */
  function backFrom(seatW, facing, d = 0.9) {
    const dir = seatW.subtract(facing); dir.y = 0;
    if (dir.lengthSquared() < 1e-6) return V3(seatW.x, player.baseY, seatW.z);
    dir.normalize();
    const back = seatW.add(dir.scale(d));
    back.y = player.baseY;
    return back;
  }

  /**
   * LE PLAN DES PLACES, enseigné au serveur.
   *
   * Le serveur n'a pas de géométrie : il ne sait pas où est la chaise 3 de la
   * table 1, ni par où l'on en sort. Or c'est lui qui devra reposer un joueur
   * parti sans prévenir — Alt+F4, onglet tué, réseau coupé : dans ces cas-là le
   * navigateur n'exécute plus rien, il n'y a plus personne pour annoncer quoi
   * que ce soit. On lui donne donc la carte À L'AVANCE, dès la connexion : la
   * sortie de chaque place, une bonne fois, valable pour tout le monde.
   */
  function spotMap() {
    const map = {};
    const put = (k, v) => { if (v) map[k] = [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]; };
    bjs.forEach((t, ti) => {
      for (let i = 0; i < t.SEATS.length; i++) put("blackjack:" + ti + ":" + i, seatExit(ti, i));
    });
    // les tabourets du bar : on s'en écarte dos au comptoir
    const counter = V3(LAYOUT.bar.x, 0, LAYOUT.bar.z);
    bar.stools.forEach((s, i) => put("bar:" + i, backFrom(s, counter, 0.85)));
    return map;
  }

  /* ------------------------------------------------------------- tabourets */

  function sitStool(meta) {
    state.mode = meta.kind === "slot" ? "slot" : "stool";
    state.spot = meta.spot || null;
    state.safePos = standingHere();
    player.unlock();
    player.sitView(meta.eye, meta.look, 1.0, null,
      { yaw: meta.kind === "slot" ? 0.7 : 1.1, up: 0.35, down: 0.35 });
    if (meta.kind === "slot") {
      state.currentSlot = meta.target;
      $("slotui").hidden = false;
      $("slotmsg").textContent = "MISEZ ET TIREZ LE LEVIER";
      setSlotBet(state.slotBet);
    } else {
      showPrompt("Commander un verre (20 €)");
    }
  }

  function showPrompt(txt) {
    $("prompt").hidden = false;
    $("promptTxt").textContent = txt;
  }

  function standUp() {
    $("slotui").hidden = true;
    $("prompt").hidden = true;
    state.currentSlot = null;
    state.spot = null;
    state.safePos = null;
    player.stand(() => { state.mode = "walk"; player.frozen = false; player.lock(); });
  }

  /* ------------------------------------------------------------- bar */

  let busy = false;
  async function doDrink() {
    if (busy) return;
    if (state.cash < 20) return ui.toast("Pas assez pour un verre…", "lose");
    busy = true;
    player.frozen = true;
    // affichage tout de suite, comptabilité au serveur : c'est lui qui tient
    // la caisse et qui la retiendra jusqu'à la prochaine visite
    state.cash -= 20; ui.updateCash(); net.wallet(-20);
    player.unlock();
    await bar.serve(player.camera, ui);
    state.drinks++;
    net.prefs({ drinks: state.drinks });
    $("drinkFx").classList.add("on");
    setTimeout(() => $("drinkFx").classList.remove("on"), 6000);
    ui.toast(state.drinks === 1 ? "Vous vous sentez chanceux…" : "Encore un ? Santé.", "win");
    busy = false;
    player.frozen = false;
    if (state.mode === "walk") player.lock();
    else if (state.mode === "stool") showPrompt("Commander un verre (20 €)");
  }

  /* ------------------------------------------------------------- machine à sous */

  /** @param {boolean} [quiet] ne pas renvoyer au serveur ce qu'il vient de dire */
  function setSlotBet(v, quiet) {
    state.slotBet = clamp(Math.round(v / 5) * 5, 5, 200);
    $("slotbet").textContent = state.slotBet;
    if (!quiet) net.prefs({ slotBet: state.slotBet });
  }

  function enterSlot(machine) {
    state.mode = "slot";
    state.currentSlot = machine;
    state.safePos = standingHere();
    player.frozen = true;
    player.unlock();
    $("slotui").hidden = false;
    $("slotmsg").textContent = "MISEZ ET TIREZ LE LEVIER";
    setSlotBet(state.slotBet);
  }
  function leaveSlot() {
    if (player.seated) return standUp();     // on était assis sur le tabouret
    state.mode = "walk";
    state.currentSlot = null;
    state.safePos = null;
    player.frozen = false;
    $("slotui").hidden = true;
    player.lock();
  }

  $("betup").onclick = () => { setSlotBet(state.slotBet + 5); audio.ui(); };
  $("betdown").onclick = () => { setSlotBet(state.slotBet - 5); audio.ui(); };
  $("spin").onclick = async () => {
    const m = state.currentSlot;
    if (!m || m.spinning) return;
    if (state.cash < state.slotBet) return ui.toast("Fonds insuffisants", "lose");
    state.cash -= state.slotBet; ui.updateCash(); net.wallet(-state.slotBet);
    $("spin").disabled = true;
    $("slotmsg").textContent = "…";
    const r = await m.spin(state.slotBet);
    $("spin").disabled = false;
    if (!r) return;
    $("slotmsg").textContent = r.symbols.join("   ");
    if (r.win > 0) {
      state.cash += r.win; ui.updateCash(); net.wallet(r.win);
      ui.toast((r.mult >= 10 ? "JACKPOT  " : "GAIN  ") + "+ " + fmt(r.win) + " €", "win");
    } else {
      ui.toast("Perdu — " + fmt(state.slotBet) + " €", "lose");
    }
  };

  /* ------------------------------------------------------------- blackjack */

  function sitTable(seat, tableIdx = 0) {
    bj = bjs[tableIdx];                    // cette table devient « la mienne »
    net.tableIdx = tableIdx;               // ...et toutes les intentions y vont
    heat.attachTable({
      center: bj.tableCenter(),
      lamp: world.lights["table" + (tableIdx || "")],
    });
    state.mode = "table";
    state.spot = Number.isInteger(seat) ? "blackjack:" + tableIdx + ":" + seat : null;
    // le point de sortie est calculé À L'ASSISE, pas au lever : il doit être
    // connu du serveur AVANT que le joueur ne puisse disparaître
    state.safePos = seatExit(tableIdx, seat);
    player.unlock();
    $("bj").hidden = false;
    $("bjtop").hidden = false;
    pipe.imageProcessing.vignetteWeight = 5.2;
    // ambiance « scène » : on baisse les lumières autour
    world.lights.slots.intensity = 34;
    world.lights.bar.intensity = 30;
    // ON COUPE VERS LA CAMÉRA DE PLATEAU — un acteur fixe posé dans le monde,
    // sélectionnable et déplaçable en mode éditeur, comme dans Unreal. Le
    // personnage, lui, reste assis sur sa chaise (les autres le voient).
    // la caméra de SA chaise — repli sur la place centrale si besoin
    const actor = camActors["table" + tableIdx + ":" + seat]
      || camActors["table" + tableIdx + ":2"];
    actor.computeWorldMatrix(true);
    const eye = actor.getAbsolutePosition().clone();
    const fwd = actor.getDirection(B.Axis.Z);

    /**
     * MISE AU POINT sur le feutre, mesurée et non devinée.
     *
     * `focusDistance` était figé à 900 (Babylon compte en MILLIMÈTRES, donc
     * 0,9 m) : la netteté tombait DEVANT la table. Avec le cadrage par défaut
     * l'œil est à 1,38 m et le feutre à 0,92 m, l'axe plonge d'environ 0,4 —
     * le regard touche le feutre à ~1,16 m. Cartes et pastilles de valeur, un
     * peu plus loin encore, étaient donc toutes hors du plan net : c'est ça
     * qui rendait les chiffres flous.
     *
     * On intersecte maintenant l'axe de la caméra avec le plan du feutre, ce
     * qui reste juste même pour un cadrage déplacé dans l'éditeur.
     */
    const feltY = bj.tableCenter().y;
    const focus = fwd.y < -0.05 ? (eye.y - feltY) / -fwd.y : 1.2;
    pipe.depthOfFieldEnabled = true;
    pipe.depthOfField.focalLength = 28;
    // f/4,5 ne tenait qu'une vingtaine de centimètres de profondeur : la moindre
    // erreur de mise au point floutait tout le tapis. À f/9 la table entière est
    // nette et seul l'arrière-plan décroche — ce qu'on veut vraiment.
    pipe.depthOfField.fStop = 9;
    pipe.depthOfField.focusDistance = clamp(focus, 0.6, 3) * 1000;
    player.sitView(eye, eye.add(fwd.scale(2)), actor.metadata.fov,
      () => {
        bj.sit(seat); net.bj("sit", { seat });
      },
      { yaw: 0.4, up: 0.24, down: 0.22 });
  }

  function leaveTable() {
    if (bj.G.phase !== "betting" && bj.G.phase !== "idle") {
      ui.msg("Le coup est en cours…");
      return;
    }
    // on se relève DERRIÈRE la chaise — c'est le point de sortie déjà calculé
    // à l'assise, celui-là même que le serveur retiendrait si l'on partait sans
    // se lever. Un départ propre et un onglet fermé posent le joueur au MÊME
    // endroit : il n'y a qu'une porte de sortie.
    const parts = (state.spot || "").split(":");
    const back = state.safePos
      || (parts[0] === "blackjack" && parts.length === 3
        ? seatExit(Number(parts[1]), Number(parts[2])) : null);
    bj.leave(); net.bj("leave");
    setChipGlow(0);
    $("bj").hidden = true;
    $("bjtop").hidden = true;
    $("bjmsg").textContent = "";     // un « GAGNÉ » figé ne doit pas ressortir à la table suivante
    ui.setHands(null);
    pipe.depthOfFieldEnabled = false;
    pipe.imageProcessing.vignetteWeight = 2.6;
    world.lights.slots.intensity = 80;
    world.lights.bar.intensity = 70;
    state.spot = null;
    state.safePos = null;
    player.stand(() => { state.mode = "walk"; player.lock(); }, back);
  }

  /** Miser avec retour : un clic hors phase de mise était avalé SANS UN MOT
   *  (le serveur l'ignore à raison — mais le joueur, lui, croyait à un bug). */
  function tryBet(v) {
    if (bj && bj.G.phase !== "betting") {
      audio.lose();
      return ui.toast("Un instant — misez quand « Faites vos jeux » s'affiche", "lose");
    }
    net.bj("bet", { value: v }); audio.ui();
  }
  /** Encaisser la cagnotte : seulement entre deux manches, et on le DIT. */
  function tryBank() {
    if (bj && bj.G.phase !== "betting" && bj.G.phase !== "payout") {
      audio.lose();
      return ui.toast("La cagnotte s'encaisse entre deux manches — elle reste à vous", "lose");
    }
    net.bj("bank"); audio.ui();
  }
  /**
   * RACHETER UNE BARRE DE TEMPS. Entre deux manches seulement — on achète son
   * filet à froid (voir buyTime, côté serveur). Le refus est DIT : un clic
   * avalé en silence pendant sa propre décision passerait pour une panne.
   */
  function tryBuyTime() {
    if (bj && bj.G.phase !== "betting" && bj.G.phase !== "payout") {
      audio.lose();
      return ui.toast("Le temps se rachète entre deux manches, pas pendant la vôtre", "lose");
    }
    net.bj("buytime"); audio.ui();
  }
  document.querySelectorAll(".chipbtn").forEach((b) =>
    (b.onclick = () => tryBet(parseInt(b.dataset.v, 10))));
  $("clearBet").onclick = () => {
    if (bj && bj.G.phase !== "betting") return ui.toast("La manche est lancée — les mises sont sur le feutre", "lose");
    net.bj("clearbet");
  };
  $("side21").onclick = () => {
    if (bj && bj.G.phase !== "betting") return ui.toast("21+3 se joue avant la donne — attendez « Faites vos jeux »", "lose");
    net.bj("sidebet", { value: 25 }); audio.ui();
  };
  // RÉPÉTER : le raccourci de la boucle. Sans lui, chaque manche repart d'un
  // empilage de jetons à la main — c'est le seul vrai frein à l'enchaînement.
  $("rebet").onclick = () => { net.bj("rebet"); audio.ui(); };
  $("bankPot").onclick = () => tryBank();
  $("buyTime").onclick = () => tryBuyTime();
  $("hit").onclick = () => net.bj("hit");
  $("stand").onclick = () => net.bj("stand");
  $("double").onclick = () => net.bj("double");
  $("split").onclick = () => net.bj("split");
  $("insYes").onclick = () => net.bj("insure");
  $("insNo").onclick = () => net.bj("noinsure");

  // ambiance sonore + volume, à même la console de table : les MÊMES réglages
  // que le menu principal (settings applique, sauvegarde et resynchronise —
  // changer depuis le menu pause met la console à jour, et inversement)
  const refreshSound = () => {
    $("ambName").textContent = settings.text("music");
    $("volFill").style.width = (settings.ratio("volMusic") * 100).toFixed(0) + "%";
  };
  $("ambBtn").onclick = () => { settings.step("music", 1); audio.ui(); };
  $("volDown").onclick = () => { settings.step("volMusic", -1); audio.ui(); };
  $("volUp").onclick = () => { settings.step("volMusic", 1); audio.ui(); };
  settings.onChange(refreshSound);
  refreshSound();

  /* ------------------------------------------------------------- UI */

  function makeUI() {
    let toastTimer = null;
    // LA FENÊTRE DES DÉCISIONS (au-dessus de la barre) : visible dès qu'un de
    // ses groupes l'est, et DÉSARMÉE 350 ms à chaque apparition ou changement
    // de contenu — un bouton qui vient de se matérialiser sous le curseur ne
    // doit pas pouvoir avaler un clic parti pour autre chose.
    let armTimer = null, floatSig = "";
    const syncFloat = () => {
      const f = $("bjfloat");
      const sig = ($("bjact").hidden ? "" : "a") + ($("bjins").hidden ? "" : "i");
      if (sig && sig !== floatSig) {
        f.style.pointerEvents = "none";
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { f.style.pointerEvents = ""; }, 350);
      }
      floatSig = sig;
      f.hidden = !sig;
    };
    /* ---- LES MAINS DOUBLÉES À PLAT ----
       Le feutre 3D porte le geste, ce panneau porte la LECTURE : les mêmes
       cartes, à plat, hors perspective, avec leur total. Rien n'y est calculé —
       tout vient de la photo du serveur relayée par la table. */
    const SUIT_CH = ["\u2660", "\u2665", "\u2666", "\u2663"];   // ordre de l'atlas 3D
    const RED_SUIT = new Set([1, 2]);                    // cœur, carreau
    // Une carte ne se redessine QUE si elle change : sans cette mémoire, chaque
    // photo serveur (plusieurs par seconde) rejouerait l'animation de pose et
    // la main clignoterait en permanence. Et comme une main ne fait que
    // GRANDIR, on n'ajoute que les cartes neuves — seules elles se posent.
    const shown = { dealer: [], 0: [], 1: [] };
    const keyOf = (c) => (c ? c.r + ":" + c.s : "?");

    function cardEl(c) {
      const el = document.createElement("i");
      if (!c) { el.className = "bjh-c back"; return el; }   // le dos du croupier
      el.className = "bjh-c" + (RED_SUIT.has(c.s) ? " red" : "");
      const b = document.createElement("b"); b.textContent = c.r;
      const u = document.createElement("u"); u.textContent = SUIT_CH[c.s] || "";
      el.append(b, u);
      return el;
    }

    function paintRow(row, key, hand) {
      if (!hand) { row.hidden = true; shown[key] = []; return; }
      row.hidden = false;
      row.classList.toggle("active", !!hand.active);
      const tot = row.querySelector(".bjh-tot");
      tot.textContent = hand.label ?? (hand.total || "—");
      tot.className = "bjh-tot" + (hand.total > 21 ? " bust"
        : hand.total === 21 ? " bj" : "");
      const box = row.querySelector(".bjh-cards");
      const now = hand.cards.map(keyOf), was = shown[key];
      // la carte cachée du croupier se RETOURNE : son dos change de valeur,
      // donc le préfixe ne colle plus et la ligne se refait — c'est voulu
      const grew = now.length >= was.length && was.every((k, i) => k === now[i]);
      if (!grew) { box.textContent = ""; }
      for (let i = grew ? was.length : 0; i < hand.cards.length; i++) {
        box.appendChild(cardEl(hand.cards[i]));
      }
      shown[key] = now;
    }

    // ODOMÈTRE : la caisse ne saute pas, elle DÉFILE — et chaque cran de gain
    // fait son tic de pièce. Compter ses gains est la moitié du plaisir.
    let shownCash = null, cashRaf = 0, lastCoin = 0;
    return {
      updateCash() {
        const target = Math.round(state.cash);
        if (shownCash === null) {           // premier affichage : pas de défilé
          shownCash = target;
          $("cash").textContent = fmt(target);
          return;
        }
        if (shownCash === target) return;
        cancelAnimationFrame(cashRaf);
        const from = shownCash, delta = target - from;
        const dur = clamp(300 + Math.abs(delta) * 1.4, 350, 1400);
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / dur);
          const eased = 1 - (1 - k) * (1 - k);
          shownCash = Math.round(from + delta * eased);
          $("cash").textContent = fmt(shownCash);
          if (delta > 0 && k < 1 && now - lastCoin > 70) { lastCoin = now; audio.coin?.(); }
          if (k < 1) cashRaf = requestAnimationFrame(step);
        };
        cashRaf = requestAnimationFrame(step);
      },
      // le HUD de table vit en RÉALITÉ AUGMENTÉE dans la scène : ces setters
      // écrivent encore le DOM (caché, utile au debug) et surtout miroir vers
      // la projection 3D de la table où le joueur est assis
      setBet(v) {
        $("betVal").textContent = fmt(v) + " €";
        $("bjhBet").textContent = fmt(v) + " €";
        bj?.arBet?.(v);
      },
      /**
       * Réplique 2D des mains — le « HUD classique » qui double la table 3D.
       * @param {?{dealer:object, main:object, split:?object}} h null = range le
       *   panneau (debout, ou aucune carte sur le feutre).
       */
      setHands(h) {
        $("bjhand").hidden = !h;
        if (!h) { shown.dealer = []; shown[0] = []; shown[1] = []; return; }
        paintRow($("bjhDealer"), "dealer", h.dealer);
        paintRow($("bjhMain"), 0, h.main);
        paintRow($("bjhSplit"), 1, h.split);
      },
      setPlayerVal(v) { $("playerVal").textContent = v; },
      setDealerVal(v) { $("dealerVal").textContent = v; },
      msg(t) { $("bjmsg").textContent = t; },
      // plus de bouton « Distribuer » : la table part d'elle-même à la fin
      // des mises, côté serveur. Conservé en no-op pour les appelants.
      enableDeal() { },
      // les jetons se GRISENT hors phase de mise au lieu de disparaître :
      // la barre garde la même géométrie toute la main (voir #bjbet.off)
      showBetPanel(on) { $("bjbet").classList.toggle("off", !on); },
      showActions(on, opt = {}) {
        $("bjact").hidden = !on;
        $("double").disabled = !opt.canDouble;
        // le bouton n'existe que quand séparer est possible — un bouton grisé
        // en permanence serait du bruit
        $("split").hidden = !opt.canSplit;
        syncFloat();
      },
      // assurance et mise annexe : posées ici pour que la table n'écrive
      // pas le DOM en direct
      showInsurance(ask, cost) {
        $("bjins").hidden = !ask;
        if (ask) $("insCost").textContent = cost;
        syncFloat();
      },
      setSide(txt) {
        const sv = $("sideval");
        if (sv) sv.textContent = txt;
      },
      /**
       * RÉPÉTER LA MISE. Inactif, le bouton reste EN PLACE à l'état fantôme
       * (.ghost) au lieu de sortir du flux : la barre est centrée
       * (translateX(-50%)), tout bouton qui apparaît ou disparaît recentre
       * toute la rangée — et le joueur qui enchaîne les mises voit sa cible se
       * dérober sous le curseur. La géométrie ne doit JAMAIS changer.
       * @param {number} v total à reposer (mise + 21+3), 0 = rien à répéter
       */
      setRebet(v) {
        const b = $("rebet");
        if (!b) return;
        b.classList.toggle("ghost", !v);
        b.disabled = !v;
        $("rebetval").textContent = v ? fmt(v) + " €" : "—";
      },
      /** ENCAISSER LA CAGNOTTE. Même règle : fantôme quand il n'y a rien. */
      setBank(v) {
        const b = $("bankPot");
        if (!b) return;
        b.classList.toggle("ghost", !v);
        b.disabled = !v;
        $("bankval").textContent = v ? fmt(v) + " €" : "—";
      },
      /**
       * LA RÉSERVE DE TEMPS, sous le chrono du bandeau.
       *
       * Une jauge à l'échelle du restant, et le compte en secondes : la
       * réserve fond au réel (3 s de dépassement coûtent 3 s), l'afficher
       * tout-ou-rien mentirait. Vide, la ligne reste — barrée et éteinte :
       * c'est l'information qui compte, « il ne t'en reste plus ».
       * @param {number} ms réserve restante, en millisecondes
       * @param {boolean} on sursis en cours (elle fond sous les yeux)
       * @param {number} max taille du réservoir, pour l'échelle de la jauge
       */
      setTimeBank(ms, on = false, max = 20000) {
        const el = $("bjbank");
        if (!el) return;
        const seated = state.mode === "table";
        el.hidden = !seated;
        if (!seated) return;
        const sec = Math.ceil(Math.max(0, ms) / 1000);
        el.classList.toggle("on", !!on);
        el.classList.toggle("empty", !sec);
        $("bjbankpips").innerHTML = sec > 0
          ? "<i style='width:" + Math.max(6, Math.round(104 * Math.min(1, ms / max))) + "px'></i>"
          : "<i class='off'></i>";
        $("bjbanklbl").textContent = (on ? "TEMPS ADDITIONNEL"
          : sec > 0 ? "RÉSERVE" : "RÉSERVE ÉPUISÉE")
          + (sec > 0 ? " · " + sec + " s" : "");
      },
      /** +TEMPS. Fantôme quand on ne peut pas acheter — géométrie fixe. */
      setBuyTime(price) {
        const b = $("buyTime");
        if (!b) return;
        b.classList.toggle("ghost", !price);
        b.disabled = !price;
        $("buytimeval").textContent = price ? fmt(price) + " €" : "—";
      },
      toast(t, cls = "") {
        const el = $("toast");
        el.textContent = t;
        el.className = "show " + cls;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (el.className = ""), 2600);
      },
    };
  }

  // hook de debug / test automatisé.
  // On FUSIONNE : cet objet portait déjà `dump()` (le lecteur du journal, posé
  // plus haut avec DBGBUF). Une affectation sèche l'écrasait, et le rapport de
  // blocage devenait illisible alors que c'est justement l'outil dont on a
  // besoin pour traquer les murs fantômes.
  Object.assign(window.__dev, {
    /** Force la série côté serveur (assis à une table, dev uniquement). */
    streak: (v) => net.bj("devstreak", { value: v }),
    /** Visuel local pur, testable même debout : palier, or, extinction. */
    heatTier: (n) => heat.set(n),
    gold: (big = false) => heat.gold(big),
    extinguish: (from = 4) => heat.extinguish(from),
    /** Sonde du concert : mains, prise du micro, bouche. Voir concert.debug(). */
    mic: () => concert.debug(),
    /** Réglage à chaud de la prise du micro : __dev.grip({ high: [0, .05, 0] }). */
    grip: (o) => concert.grip(o),
  });
  window.__game = {
    scene, engine, state, player, bjs, get bj() { return bj; },
    chips, cards, bar, machines, fountain, world, pipe, ui, heat, editor, layout, camActors, stage, concert, venues,
    menu, settings, cashierUI,
    sitTable, leaveTable, enterSlot, leaveSlot, doDrink, sitStool, standUp,
  };

  /* ------------------------------------------------------------- lancement */

  // LES PARAMÈTRES prennent la main sur le moteur : résolution, ombres, focale,
  // volumes… tout ce que le joueur a réglé la dernière fois est reposé ici,
  // d'un coup, maintenant que le monde entier existe.
  // `net` : le pseudo persisté part au serveur dès que le registre s'applique
  settings.bind({ engine, scene, player, world, pipe, ssao, audio, heat, net });

  // La souris rendue au joueur SANS qu'on le lui ait demandé, c'est son Échap :
  // le navigateur avale la touche quand le pointeur est verrouillé, ce signal
  // est donc le seul moyen fiable d'ouvrir la pause en pleine partie.
  player.onUnlock = (wanted) => {
    if (wanted || menuIsOpen()) return;
    // Échap souris verrouillée : le navigateur mange le keydown, on ne le voit
    // QUE par ce signal. Si le salon est ouvert, c'est lui que l'on ferme —
    // pas la partie.
    if (chat.isOpen()) { chat.close(); return; }
    if (state.mode === "walk") menu.pause();
  };

  $("loader").classList.add("gone");
  setTimeout(() => ($("loader").style.display = "none"), 950);
  menu.home();
}

boot().catch((e) => {
  console.error(e);
  $("loadtxt").innerHTML = "Erreur de chargement :<br/>" + (e && e.message ? e.message : e);
});
