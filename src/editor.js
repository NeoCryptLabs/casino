/**
 * MODE ÉDITEUR (F2) — réagencer le casino depuis le jeu.
 *
 * Vol libre, clic pour sélectionner un mesh, gizmos Babylon pour le déplacer /
 * tourner / redimensionner, Ctrl+S pour sauvegarder. La sauvegarde n'écrit pas
 * une scène : elle écrit un CALQUE DE SURCHARGES (assets/layout.json, voir
 * layout.js) que le démarrage rejoue par-dessus le monde construit par le code.
 *
 * Les sphères colorées sont les ANCRES du plan (table, bar, machines, fontaine,
 * spawn). Les déplacer déplace l'ancre logique — tout ce qui se construit
 * autour (chaises, tabourets, physique, lumières) suivra. Comme cette
 * construction n'a lieu qu'au démarrage, une ancre déplacée ne prend effet
 * qu'au rechargement de la page ; les meshes, eux, bougent en direct.
 */
import { V3, C3 } from "./util.js";
import { LAYOUT } from "./world.js";
import { meshIds, snapshot, saveLayout } from "./layout.js";
const B = BABYLON;

// meshes qui n'appartiennent pas au décor : cartes et jetons vivent leur vie,
// les proxys invisibles et l'anneau d'onde de choc n'ont rien à faire ici
const BLOCKED = /^(card|chip|pFloor|bjRing)/;

/**
 * Les ensembles à racine logique. Déplacer UN mesh de la table déplacerait le
 * plateau sans les chaises — et surtout sans la logique (`toWorld`, places,
 * cibles des cartes), qui lit le TransformNode racine, pas les meshes. Cliquer
 * un morceau de ces ensembles sélectionne donc leur ANCRE à la place : le tout
 * suivra, au rechargement, chaises et cartes comprises.
 */
const ROOT_TO_ANCHOR = [
  { test: (n) => n === "bjRoot", key: "blackjack" },
  { test: (n) => n === "bjRoot1", key: "blackjack1" },
  { test: (n) => n === "bjRoot2", key: "blackjack2" },
  { test: (n) => n === "bar", key: "bar" },
  { test: (n) => n === "stage", key: "stage" },
  { test: (n) => n === "fountain", key: "fountain" },
  { test: (n) => /^slot\d+$/.test(n), key: "slots" },
];

/** Remonte la parenté : si le mesh vit sous une racine logique, renvoie la clé d'ancre. */
function anchorKeyFor(mesh) {
  for (let n = mesh; n; n = n.parent) {
    for (const r of ROOT_TO_ANCHOR) if (r.test(n.name)) return r.key;
  }
  return null;
}

// le projecteur qui éclaire chaque ensemble, pour qu'il suive le déménagement
const LIGHT_OF = {
  blackjack: "table", blackjack1: "table1", blackjack2: "table2",
  bar: "bar", fountain: "fountain", slots: "slots",
};

// les ancres du plan : où elles se lisent dans LAYOUT, où poser leur sphère,
// et ce qu'un déplacement écrit dans layout.json
const ANCHOR_DEFS = [
  { key: "blackjack", color: C3(1, 0.25, 0.2), at: (L) => V3(L.blackjack.x, 1.15, L.blackjack.z), put: (p) => [p.x, 0, p.z] },
  { key: "blackjack1", color: C3(1, 0.45, 0.15), at: (L) => V3(L.blackjack1.x, 1.15, L.blackjack1.z), put: (p) => [p.x, 0, p.z] },
  { key: "blackjack2", color: C3(1, 0.15, 0.45), at: (L) => V3(L.blackjack2.x, 1.15, L.blackjack2.z), put: (p) => [p.x, 0, p.z] },
  { key: "fountain", color: C3(0.25, 0.6, 1), at: (L) => V3(L.fountain.x, 1.15, L.fountain.z), put: (p) => [p.x, 0, p.z] },
  { key: "spawn", color: C3(0.3, 1, 0.4), at: (L) => V3(L.spawn.x, 1.62, L.spawn.z), put: (p) => [p.x, 1.62, p.z] },
  { key: "bar", color: C3(1, 0.7, 0.15), at: (L) => V3(L.bar.x, 1.15, L.bar.z), put: (p) => ({ x: p.x, z: p.z }) },
  { key: "stage", color: C3(0.95, 0.85, 0.35), at: (L) => V3(L.stage.x, 1.15, L.stage.z), put: (p) => [p.x, 0, p.z] },
  { key: "slots", color: C3(0.85, 0.3, 1), at: (L) => V3(L.slots.x0, 1.15, L.slots.z0), put: (p) => ({ x0: p.x, z0: p.z }) },
  // La scène de cabaret, réglée au doigt : où se plante la chanteuse, et où
  // ses deux mains empoignent le micro. Seules ancres dont la HAUTEUR compte —
  // d'où le `p.y` conservé, là où les autres écrasent y à 0.
  { key: "singerSpot", color: C3(0.2, 1, 0.85), at: (L) => L.singerSpot.clone(), put: (p) => [p.x, p.y, p.z] },
  { key: "micHigh", color: C3(1, 0.3, 0.55), at: (L) => L.micHigh.clone(), put: (p) => [p.x, p.y, p.z] },
  { key: "micLow", color: C3(0.55, 0.4, 1), at: (L) => L.micLow.clone(), put: (p) => [p.x, p.y, p.z] },
];

export function createEditor({ scene, canvas, player, state, ui, audio, layout, world, bootClones, camActors = {} }) {
  const $ = (id) => document.getElementById(id);
  let active = false;
  let selected = null;
  let gm = null, hl = null;
  const touched = new Set();          // meshes modifiés, à photographier au save
  const markers = new Map();          // sphère d'ancre -> définition
  // objets AJOUTÉS (Ctrl+D), les miens et ceux des sessions passées
  const cloneRecs = new Map();        // mesh -> { src: "nom#occ" du modèle }
  for (const c of bootClones || []) cloneRecs.set(c.mesh, { src: c.src });
  let dirty = false;

  /* -------------------------------------------------------- outillage */

  function ensureTools() {
    if (gm) return;
    // `camera` : le halo de sélection ne se dessine que dans la vue de
    // l'éditeur — sinon il bave dans la vignette d'aperçu, qui doit montrer
    // l'image de la caméra de table et rien d'autre.
    hl = new B.HighlightLayer("hlEdit", scene,
      { camera: player.camera, blurHorizontalSize: 0.6, blurVerticalSize: 0.6 });
    gm = new B.GizmoManager(scene);
    gm.usePointerToAttachGizmos = false;   // on choisit nous-mêmes, au clic
    setMode("move");                       // épingle aussi les couches de gizmos
    // l'éditeur est la seule caméra qui voit les repères (voir HELPER)
    player.camera.layerMask = 0x0FFFFFFF | HELPER;
    ensureCamHandles();

    for (const def of ANCHOR_DEFS) {
      const s = B.MeshBuilder.CreateSphere("anchor:" + def.key, { diameter: 0.34, segments: 12 }, scene);
      const m = new B.StandardMaterial("anchorM:" + def.key, scene);
      m.emissiveColor = def.color;
      m.disableLighting = true;
      m.alpha = 0.85;
      s.material = m;
      s.position = def.at(LAYOUT);
      s.isPickable = true;
      helper(s);
      markers.set(s, def);
    }
    setMarkers(false);
  }

  const setMarkers = (on) => { for (const s of markers.keys()) s.setEnabled(on); };

  /**
   * Les gizmos vivent dans une couche utilitaire qui, faute de consigne, se
   * rend depuis la DERNIÈRE caméra active de la scène. Or dès qu'on allume
   * l'aperçu (PiP) ou la vue scindée, cette dernière est la petite caméra de la
   * vignette : les gizmos se projetaient dans son repère et les clics tombaient
   * à côté — précisément quand on en a besoin, puisque l'aperçu s'allume en
   * sélectionnant une caméra de table. On les épingle donc à la caméra de
   * l'éditeur. Rejoué à chaque changement de mode : un gizmo — et sa couche —
   * ne naît qu'au moment où on l'active.
   */
  function pinGizmoLayers() {
    const layers = [gm.utilityLayer, gm.keepDepthUtilityLayer];
    for (const g of [gm.gizmos.positionGizmo, gm.gizmos.rotationGizmo, gm.gizmos.scaleGizmo]) {
      if (g) layers.push(g.gizmoLayer);
    }
    for (const ul of layers) {
      try { ul.setRenderCamera(player.camera); } catch { }
    }
  }

  function setMode(mode) {
    gm.positionGizmoEnabled = mode === "move";
    gm.rotationGizmoEnabled = mode === "rotate";
    gm.scaleGizmoEnabled = mode === "scale";
    // les gizmos n'existent qu'une fois activés : on branche la fin de drag ici
    for (const g of [gm.gizmos.positionGizmo, gm.gizmos.rotationGizmo, gm.gizmos.scaleGizmo]) {
      if (g && !g._hooked) {
        g._hooked = true;
        g.onDragEndObservable.add(onMoved);
      }
    }
    pinGizmoLayers();
  }

  function onMoved() {
    if (!selected) return;
    dirty = true;
    const def = markers.get(selected);
    if (def) {
      layout.anchors[def.key] = def.put(selected.position);
      ui.toast("« " + def.key + " » déplacé — Ctrl+S pour figer (physique recalée au rechargement)");
    } else if (isCamMesh(selected)) {
      // les caméras sont sérialisées à part (layout.cameras), pas en override
    } else if (!cloneRecs.has(selected)) {
      touched.add(selected);          // les copies sont photographiées au save
    }
    updateHud();
  }

  /* -------------------------------------------------------- sélection */

  function idOf(mesh) {
    return meshIds(scene).get(mesh) || mesh.name;
  }

  function select(mesh) {
    if (selected && selected !== mesh) {
      try { hl.removeMesh(selected); } catch { }
    }
    selected = mesh;
    gm.attachToMesh(mesh);
    if (mesh) {
      // point de départ du suivi en direct (voir tick) pour les ancres
      if (markers.has(mesh)) mesh._lastPos = mesh.position.clone();
      try { hl.addMesh(mesh, C3(1, 0.75, 0.2)); } catch { }
      audio.ui();
    }
    syncCamHandles();
    updateHud();
  }

  /* ----------------------------------------------- déplacement en direct */

  /** Les nœuds racines qui déménagent avec une ancre. */
  function liveTargets(key) {
    const nodes = [];
    if (key === "slots") {
      for (const n of scene.transformNodes) if (/^slot\d+$/.test(n.name)) nodes.push(n);
    } else {
      const name = {
        blackjack: "bjRoot", blackjack1: "bjRoot1", blackjack2: "bjRoot2",
        bar: "bar", fountain: "fountain", stage: "stage",
      }[key];
      const n = name && scene.getTransformNodeByName(name);
      if (n) nodes.push(n);
    }
    return nodes;
  }

  /**
   * WYSIWYG : traîner une ancre déplace l'ENSEMBLE en direct — meubles,
   * chaises, et le projecteur qui l'éclaire. C'est un aperçu fidèle : la
   * physique (surface des cartes) et les figurants, eux, ne se recalent
   * qu'au rechargement, quand tout est rebâti sur le plan sauvegardé.
   */
  function followAnchor(marker, def) {
    if (!marker._lastPos) { marker._lastPos = marker.position.clone(); return; }
    const dx = marker.position.x - marker._lastPos.x;
    const dz = marker.position.z - marker._lastPos.z;
    if (!dx && !dz) return;
    for (const n of liveTargets(def.key)) { n.position.x += dx; n.position.z += dz; }
    const l = world && world.lights && world.lights[LIGHT_OF[def.key]];
    if (l) { l.position.x += dx; l.position.z += dz; }
    // les figurants attachés à l'ensemble (croupier, barman…) déménagent avec :
    // ils sont posés en coordonnées monde, on embarque ceux qui vivent autour
    if (def.key.startsWith("blackjack") || def.key === "bar"
      || def.key === "stage") {
      for (const n of scene.transformNodes) {
        if (n.name !== "npc") continue;
        if (Math.hypot(n.position.x - marker.position.x, n.position.z - marker.position.z) < 4.5) {
          n.position.x += dx; n.position.z += dz;
        }
      }
    }
    marker._lastPos.copyFrom(marker.position);
    // le plan suit en continu : Ctrl+S enregistre la dernière position
    layout.anchors[def.key] = def.put(marker.position);
    dirty = true;
  }

  /* ----------------------------------------------- dupliquer / supprimer */

  /** Ctrl+D : copie l'objet sélectionné. Persisté dans layout.clones. */
  function duplicate(mesh) {
    // la source de la copie d'une copie reste le mesh CONSTRUIT : au prochain
    // démarrage, seul lui existera pour servir de modèle
    const src = cloneRecs.has(mesh) ? cloneRecs.get(mesh).src : idOf(mesh);
    const c = mesh.clone(mesh.name + "_c");
    if (!c) return;
    c.position = mesh.position.clone();
    c.position.x += 0.5;                       // décalée, pour la voir naître
    cloneRecs.set(c, { src });
    dirty = true;
    select(c);
    ui.toast("Copie créée — déplacez-la, Ctrl+S pour la garder");
  }

  /* ------------------------------------- visualisation des collisions */

  // B en mode plan : TOUT ce qui bloque le joueur devient visible — les
  // volumes invisibles apparaissent en rouge translucide, et chaque solide
  // affiche sa boîte englobante. C'est l'outil anti « murs fantômes ».
  let colDebug = false;
  const colDbg = new Map();
  let colDbgMat = null;
  function toggleColDebug() {
    colDebug = !colDebug;
    if (colDebug) {
      if (!colDbgMat) {
        colDbgMat = new B.StandardMaterial("colDbgM", scene);
        colDbgMat.diffuseColor = C3(1, 0.1, 0.1);
        colDbgMat.emissiveColor = C3(0.55, 0.05, 0.05);
        colDbgMat.alpha = 0.30;
        colDbgMat.disableLighting = true;
        colDbgMat.backFaceCulling = false;
      }
      let hidden = 0;
      for (const m of scene.meshes) {
        if (!m.checkCollisions || !m.isEnabled()) continue;
        colDbg.set(m, { vis: m.isVisible, mat: m.material });
        m.showBoundingBox = true;
        if (!m.isVisible) { m.isVisible = true; m.material = colDbgMat; hidden++; }
      }
      ui.toast(`${colDbg.size} volumes de collision — dont ${hidden} invisibles (rouge)`);
    } else {
      for (const [m, st] of colDbg) {
        if (m.isDisposed()) continue;
        m.showBoundingBox = false;
        m.isVisible = st.vis;
        m.material = st.mat;
      }
      colDbg.clear();
    }
  }

  /* ------------------------------------- gizmos des caméras de plateau */

  /**
   * Une caméra de table se règle à trois choses : d'où elle regarde, ce qu'elle
   * regarde, et sa focale. Le corps bleu porte les gizmos habituels (1/2/3)
   * pour la POSITION ; la sphère cyan devant lui est sa VISÉE — la tirer fait
   * pivoter la caméra pour garder ce point au centre du cadre, ce qui est bien
   * plus maniable que le gizmo de rotation (on vise le feutre, pas des angles
   * d'Euler). Le cône en fil de fer montre le champ couvert, la vignette en bas
   * à droite montre l'image obtenue, la molette règle la focale.
   */

  const HELPER = 0x40000000;   // bit de calque réservé aux repères de l'éditeur
  const aims = new Map();      // clé de caméra -> sa sphère de visée

  /** Rend un repère invisible pour toute caméra sauf celles de l'éditeur. */
  function helper(m) {
    m.layerMask = HELPER;
    for (const c of m.getChildMeshes()) c.layerMask = HELPER;
  }

  const isCamMesh = (m) => !!(m && m.metadata && (m.metadata.camActor || m.metadata.camAim));

  /** La caméra visée par la sélection : son corps, ou la sphère de visée. */
  function camOfSelection() {
    if (!selected || !selected.metadata) return null;
    if (selected.metadata.camActor) return selected;
    if (selected.metadata.camAim) return camActors[selected.metadata.camAim] || null;
    return null;
  }

  /** Oriente un acteur-caméra vers un point — même convention que `sitView`. */
  function aimAt(body, target) {
    const d = target.subtract(body.position);
    if (d.lengthSquared() < 1e-8) return;
    body.rotationQuaternion = null;
    body.rotation.set(Math.atan2(-d.y, Math.hypot(d.x, d.z)), Math.atan2(d.x, d.z), 0);
  }

  function ensureCamHandles() {
    for (const [key, body] of Object.entries(camActors)) {
      helper(body);
      // le corps est petit et souvent noyé dans le mobilier : on le dessine
      // par-dessus le décor (Babylon vide le tampon de profondeur entre groupes)
      body.renderingGroupId = 1;
      for (const c of body.getChildMeshes()) c.renderingGroupId = 1;
      if (!Number.isFinite(body.metadata.aimDist)) body.metadata.aimDist = 1.6;

      const s = B.MeshBuilder.CreateSphere("camAim:" + key, { diameter: 0.2, segments: 10 }, scene);
      const m = new B.StandardMaterial("camAimM:" + key, scene);
      m.emissiveColor = C3(0.3, 0.85, 1);
      m.disableLighting = true;
      m.alpha = 0.9;
      s.material = m;
      s.metadata = { camAim: key };
      s.renderingGroupId = 1;
      helper(s);
      s.setEnabled(false);
      aims.set(key, s);
    }
  }

  /** La visée se repose devant la caméra, à sa distance de travail. */
  function placeAim(body) {
    const s = aims.get(body.metadata.camActor);
    if (!s) return;
    s.position.copyFrom(body.position.add(body.getDirection(B.Axis.Z).scale(body.metadata.aimDist)));
  }

  /** Le champ de la caméra, en fil de fer, attaché à son corps. */
  function drawFrustum(body, dist) {
    const eng = scene.getEngine();
    const asp = eng.getRenderWidth() / Math.max(1, eng.getRenderHeight());
    const fov = body.metadata.fov;
    const sig = fov.toFixed(3) + ":" + dist.toFixed(2) + ":" + asp.toFixed(3);
    let fr = body._frustum;
    if (fr && body._frSig === sig) { fr.setEnabled(true); return; }
    body._frSig = sig;
    // la focale de Babylon est verticale par défaut : la largeur suit le format
    const ty = Math.tan(fov / 2) * dist, tx = ty * asp;
    const O = V3(0, 0, 0);
    const c = [V3(-tx, -ty, dist), V3(tx, -ty, dist), V3(tx, ty, dist), V3(-tx, ty, dist)];
    const lines = [
      [O, c[0]], [O, c[1]], [O, c[2]], [O, c[3]],
      [c[0], c[1], c[2], c[3], c[0]],
      [V3(0, -ty * 0.14, dist), V3(0, ty * 0.14, dist)],     // croix de centre
      [V3(-tx * 0.1, 0, dist), V3(tx * 0.1, 0, dist)],
    ];
    fr = B.MeshBuilder.CreateLineSystem("camFrustum", { lines, updatable: true, instance: fr || null }, scene);
    if (!body._frustum) {
      fr.parent = body;                 // les points sont locaux : il suit tout seul
      fr.isPickable = false;
      fr.color = C3(0.3, 0.8, 1);
      fr.renderingGroupId = 1;
      helper(fr);
      body._frustum = fr;
    }
    fr.setEnabled(true);
  }

  /** N'affiche visée et cône que pour la caméra en cours de réglage. */
  function syncCamHandles() {
    const cur = camOfSelection();
    for (const [key, s] of aims) {
      const body = camActors[key];
      const on = body === cur;
      s.setEnabled(on);
      if (body._frustum) body._frustum.setEnabled(on);
      if (!on) continue;
      body.computeWorldMatrix(true);
      if (selected !== s) placeAim(body);
      drawFrustum(body, body.metadata.aimDist);
    }
  }

  /** K : caméra de table suivante — leurs corps sont trop petits pour être visés. */
  function cycleCam() {
    const keys = Object.keys(camActors);
    if (!keys.length) return ui.toast("aucune caméra de plateau", "lose");
    const cur = camOfSelection();
    const i = cur ? (keys.indexOf(cur.metadata.camActor) + 1) % keys.length : 0;
    select(camActors[keys[i]]);
    ui.toast("Caméra « " + keys[i] + " » — 1/2/3 la déplacent, sphère cyan = visée, molette = focale, G = cadrer d'ici");
  }

  /** G : la caméra sélectionnée adopte le point de vue de l'éditeur. Voler
   *  jusqu'au cadrage voulu puis appuyer va plus vite que tirer trois axes. */
  function grabPose() {
    const cam = camOfSelection();
    if (!cam) return ui.toast("sélectionnez une caméra (K) avant de cadrer", "lose");
    cam.position.copyFrom(player.camera.globalPosition || player.camera.position);
    aimAt(cam, cam.position.add(player.camera.getDirection(B.Axis.Z)));
    cam.computeWorldMatrix(true);
    placeAim(cam);
    select(cam);
    dirty = true;
    ui.toast("Caméra posée sur le point de vue (focale inchangée : molette) — Ctrl+S pour figer");
  }

  /* ----------------------------------------- aperçu caméra (PiP) + FOV */

  // Caméra sélectionnée -> un cadre en bas à droite montre CE QU'ELLE VOIT,
  // mis à jour pendant qu'on la déplace au gizmo. Le vrai retour visuel du
  // placement de caméra — sans lui on règle à l'aveugle.
  let pv = null, pipOn = false;
  function pip(on) {
    if (on && !pv) {
      pv = new B.FreeCamera("camPreview", V3(0, 2, 0), scene);
      pv.minZ = 0.05; pv.maxZ = 120;
    }
    if (on === pipOn) return;
    pipOn = on;
    const cam = player.camera;
    if (on) {
      pv.viewport = new B.Viewport(0.66, 0.03, 0.32, 0.32);
      cam.viewport = new B.Viewport(0, 0, 1, 1);
      scene.activeCameras = [cam, pv];
      scene.cameraToUseForPointers = cam;
    } else {
      scene.activeCameras = null;
      scene.activeCamera = cam;
      scene.cameraToUseForPointers = null;
      cam.viewport = new B.Viewport(0, 0, 1, 1);
    }
  }

  // molette sur une caméra sélectionnée : le FOV, aperçu et cône compris
  addEventListener("wheel", (e) => {
    if (!active) return;
    const cam = camOfSelection();
    if (!cam) return;
    const md = cam.metadata;
    md.fov = Math.min(1.35, Math.max(0.45, md.fov + (e.deltaY > 0 ? 0.03 : -0.03)));
    dirty = true;
    updateHud();
  }, { passive: true });

  /* ----------------------------------------------- vue scindée (V) */

  let quad = null;
  function toggleQuad() {
    const engine = scene.getEngine();
    const cam = player.camera;
    if (!quad) {
      const mk = (name, pos, target) => {
        const c = new B.FreeCamera(name, pos, scene);
        c.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
        c.setTarget(target);
        c.minZ = 0.05; c.maxZ = 220;
        c.layerMask = 0x0FFFFFFF | HELPER;   // les vues techniques voient les repères
        return c;
      };
      const H = LAYOUT.hall;
      quad = {
        on: false,
        top: mk("qTop", V3(0, 60, 0.01), V3(0, 0, 0)),
        front: mk("qFront", V3(0, H.h / 2, 60), V3(0, H.h / 2, 0)),
        side: mk("qSide", V3(60, H.h / 2, 0), V3(0, H.h / 2, 0)),
      };
    }
    quad.on = !quad.on;
    if (quad.on) {
      pip(false);                      // les deux régimes de viewports s'excluent
      // perspective à gauche, trois vues techniques empilées à droite
      const e = Math.max(LAYOUT.hall.w, LAYOUT.hall.d) * 0.58;
      const a = (engine.getRenderWidth() * 0.5) / Math.max(1, engine.getRenderHeight() / 3);
      for (const c of [quad.top, quad.front, quad.side]) {
        c.orthoLeft = -e; c.orthoRight = e;
        c.orthoTop = e / a; c.orthoBottom = -e / a;
      }
      cam.viewport = new B.Viewport(0, 0, 0.5, 1);
      quad.top.viewport = new B.Viewport(0.5, 2 / 3, 0.5, 1 / 3);
      quad.front.viewport = new B.Viewport(0.5, 1 / 3, 0.5, 1 / 3);
      quad.side.viewport = new B.Viewport(0.5, 0, 0.5, 1 / 3);
      scene.activeCameras = [cam, quad.top, quad.front, quad.side];
      // la sélection au clic ne vaut que dans la vue perspective
      scene.cameraToUseForPointers = cam;
      ui.toast("Vues : perspective + dessus / face / côté — V pour revenir");
    } else {
      cam.viewport = new B.Viewport(0, 0, 1, 1);
      scene.activeCameras = null;
      scene.activeCamera = cam;
      scene.cameraToUseForPointers = null;
    }
  }

  scene.onPointerObservable.add((info) => {
    if (!active || info.type !== B.PointerEventTypes.POINTERTAP) return;
    const hit = scene.pick(scene.pointerX, scene.pointerY, (m) =>
      m.isEnabled() && m.isVisible && m.isPickable !== false &&
      !m.skeleton && !BLOCKED.test(m.name));
    if (!hit || !hit.hit) return select(null);

    // une copie se manipule toujours directement, où qu'elle soit posée
    if (cloneRecs.has(hit.pickedMesh)) return select(hit.pickedMesh);

    // un morceau de table / bar / machine -> son ancre, pas le mesh isolé
    const key = anchorKeyFor(hit.pickedMesh);
    if (key) {
      for (const [s, def] of markers) {
        if (def.key === key) {
          select(s);
          ui.toast("Ensemble « " + key + " » : tirez l'ancre, tout suit en direct");
          return;
        }
      }
    }
    select(hit.pickedMesh);
  });

  /* -------------------------------------------------------- clavier */

  addEventListener("keydown", async (e) => {
    // P en secours de F2 : sur Mac, F2 est pris par la luminosité sans Fn
    if (e.code === "F2" || (e.code === "KeyP" && !e.metaKey && !e.ctrlKey)) {
      if (state.mode !== "walk" && state.mode !== "edit") return;
      e.preventDefault();
      if (state.mode === "walk") enter();
      else exit();
      return;
    }
    if (!active) return;

    if ((e.ctrlKey || e.metaKey) && e.code === "KeyS") {
      e.preventDefault();
      await save();
    } else if ((e.ctrlKey || e.metaKey) && e.code === "KeyD") {
      e.preventDefault();
      if (selected && !markers.has(selected) && !isCamMesh(selected)) duplicate(selected);
    } else if (e.code === "Digit1") setMode("move");
    else if (e.code === "Digit2") setMode("rotate");
    else if (e.code === "Digit3") setMode("scale");
    else if (e.code === "KeyK") cycleCam();
    else if (e.code === "KeyG") grabPose();
    else if (e.code === "KeyV") toggleQuad();
    else if (e.code === "KeyB") toggleColDebug();
    else if (e.code === "KeyI") {
      // L'INSPECTOR — l'éditeur de scène officiel de Babylon : arbre complet,
      // grille de propriétés, matériaux, lumières. Chargé du CDN à la volée.
      const dl = scene.debugLayer;
      if (dl.isVisible()) dl.hide();
      else dl.show({ embedMode: true }).catch(() => ui.toast("Inspector indisponible hors ligne", "lose"));
    } else if (e.code === "KeyH" || e.code === "Delete" || e.code === "Backspace") {
      if (!selected || markers.has(selected) || isCamMesh(selected)) return;
      if (cloneRecs.has(selected) && e.code !== "KeyH") {
        // une copie se SUPPRIME vraiment ; un mesh construit ne peut être
        // que caché (il renaîtra au prochain démarrage de toute façon)
        const m = selected;
        select(null);
        cloneRecs.delete(m);
        m.dispose();
        dirty = true;
        updateHud();
        return;
      }
      selected.setEnabled(!selected.isEnabled());
      if (!cloneRecs.has(selected)) touched.add(selected);
      dirty = true;
      updateHud();
    } else if (e.code === "Escape") {
      if (selected) select(null);
      else exit();
    }
  });

  /* -------------------------------------------------------- vol libre */

  function tick(dt) {
    if (!active) return;
    // une ancre saisie entraîne son ensemble, chaque frame
    if (selected && markers.has(selected)) followAnchor(selected, markers.get(selected));
    // caméra sélectionnée -> visée, cône et aperçu suivent sa pose en continu
    const shot = camOfSelection();
    if (!(quad && quad.on)) pip(!!shot);
    if (shot) {
      shot.computeWorldMatrix(true);
      const aim = aims.get(shot.metadata.camActor);
      if (aim && selected === aim) {
        // la visée mène : la caméra pivote pour garder le point au centre
        aimAt(shot, aim.position);
        shot.metadata.aimDist = Math.min(24, Math.max(0.3, B.Vector3.Distance(shot.position, aim.position)));
        shot.computeWorldMatrix(true);
      } else if (aim) {
        placeAim(shot);                 // la caméra mène : la visée la suit
      }
      drawFrustum(shot, shot.metadata.aimDist);
      if (pipOn) {
        pv.position.copyFrom(shot.getAbsolutePosition());
        pv.rotationQuaternion = shot.absoluteRotationQuaternion.clone();
        pv.fov = shot.metadata.fov;
      }
    }
    const k = player.keys, cam = player.camera;
    const sp = ((k.has("ShiftLeft") || k.has("ShiftRight")) ? 11 : 4.5) * dt;
    let f = 0, s = 0, v = 0;
    if (k.has("KeyW") || k.has("KeyZ") || k.has("ArrowUp")) f += 1;
    if (k.has("KeyS") && !k.has("ControlLeft") && !k.has("MetaLeft")) f -= 1;
    if (k.has("ArrowDown")) f -= 1;
    if (k.has("KeyA") || k.has("KeyQ") || k.has("ArrowLeft")) s -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) s += 1;
    if (k.has("Space")) v += 1;
    if (k.has("KeyC")) v -= 1;
    if (!f && !s && !v) return;
    const dir = cam.getDirection(B.Axis.Z).scale(f)
      .add(cam.getDirection(B.Axis.X).scale(s))
      .add(V3(0, v, 0));
    cam.position.addInPlace(dir.normalize().scale(sp));
  }

  /* -------------------------------------------------------- entrer / sortir */

  function enter() {
    ensureTools();
    active = true;
    // On garde sous le coude l'endroit où le joueur SE TENAIT. Le vol libre
    // emmène la caméra dans les murs et à dix mètres du sol : c'est cette
    // position-là qui serait retenue si l'on quittait le jeu en plein vol.
    // Comme pour une chaise, on annonce donc un point de sortie praticable.
    state.safePos = V3(player.camera.position.x, player.baseY, player.camera.position.z);
    state.mode = "edit";
    player.editing = true;           // le déverrouillage souris ne détache plus la caméra
    player.frozen = true;            // update() du joueur coupé, le vol prend la main
    player.camera.checkCollisions = false;
    player.unlock();            // voulu : ce n'est pas l'Échap du joueur
    player.camera.attachControl(canvas, true);   // regard au clic-glissé
    setMarkers(true);
    for (const a of Object.values(camActors)) a.setEnabled(true);
    $("editHud").hidden = false;
    updateHud();
    ui.toast("MODE ÉDITEUR — clic pour sélectionner");
  }

  function exit() {
    active = false;
    select(null);
    setMarkers(false);
    if (quad && quad.on) toggleQuad();     // on ne joue pas en vue scindée
    if (colDebug) toggleColDebug();        // ...ni avec les collisions affichées
    pip(false);
    for (const a of Object.values(camActors)) a.setEnabled(false);
    if (scene.debugLayer.isVisible()) scene.debugLayer.hide();
    player.camera.detachControl();
    player.camera.checkCollisions = true;
    player.editing = false;
    player.frozen = false;
    state.mode = "walk";
    state.safePos = null;
    $("editHud").hidden = true;
    if (dirty) ui.toast("Modifications non sauvées — F2 puis Ctrl+S", "lose");
    player.lock();
  }

  /* -------------------------------------------------------- sauvegarde */

  async function save() {
    for (const m of touched) {
      if (!m.isDisposed()) layout.overrides[idOf(m)] = snapshot(m);
    }
    // les copies : re-sérialisées en entier à chaque save (source + transform)
    layout.clones = [];
    for (const [m, rec] of cloneRecs) {
      if (!m.isDisposed()) layout.clones.push({ src: rec.src, ...snapshot(m) });
    }
    // les caméras de plateau : pose + focale
    layout.cameras = layout.cameras || {};
    for (const [k, a] of Object.entries(camActors)) {
      const s = snapshot(a);
      layout.cameras[k] = {
        p: s.p, r: s.r, fov: a.metadata.fov,
        // la distance de visée n'affecte pas le rendu : elle remet la poignée
        // là où on l'avait laissée à la prochaine session d'édition
        aim: Math.round((a.metadata.aimDist || 1.6) * 1e3) / 1e3,
      };
    }
    try {
      await saveLayout(layout);
      dirty = false;
      updateHud();
      audio.win(false);
      ui.toast("Plan sauvegardé" +
        (Object.keys(layout.anchors).length ? " — rechargez pour rebâtir les ancres" : ""), "win");
    } catch (e) {
      ui.toast("Échec de sauvegarde : " + e.message, "lose");
    }
  }

  function updateHud() {
    const el = $("editSel");
    if (!el) return;
    let t;
    if (!selected) t = "rien de sélectionné";
    else if (markers.has(selected)) t = "ANCRE « " + markers.get(selected).key + " »";
    else if (isCamMesh(selected)) {
      const cam = camOfSelection();
      t = (selected.metadata.camAim ? "VISÉE de « " : "CAMÉRA « ")
        + cam.metadata.camActor + " »  fov " + cam.metadata.fov.toFixed(2) + "  (molette)";
    }
    else if (cloneRecs.has(selected)) t = selected.name + "  (copie)";
    else t = idOf(selected) + (selected.isEnabled() ? "" : "  (caché)");
    el.textContent = t + (dirty ? "  •  non sauvé" : "");
  }

  return { tick, get active() { return active; }, enter, exit, save };
}
