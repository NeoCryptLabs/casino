/**
 * MODE POSE — le rayon « figurants » de l'éditeur (F2).
 *
 * Dans l'éditeur, cliquer un personnage pose une pastille sur chacun de ses
 * os ; cliquer une pastille y attache un gizmo de ROTATION en axes locaux —
 * on plie le squelette os par os, comme une figurine. Échap remonte d'un
 * cran (os -> personnage -> éditeur), R rend au personnage la pose calculée
 * du départ, Ctrl+S (géré par l'éditeur) écrit la pose dans le plan.
 *
 * La pose sauvée vit dans layout.poses sous la clé `poste@modèle` (voir
 * npc.js : poseKey). Au démarrage, npc.js la rejoue PAR-DESSUS la posture
 * calculée (_dealerStance, _sit…), puis rebase les micro-animations dessus :
 * la respiration continue autour de la pose choisie au lieu de l'écraser.
 */
import { C3 } from "./util.js";
const B = BABYLON;

// même bit de calque que les repères de l'éditeur : seule sa caméra les voit
const HELPER = 0x40000000;

export function createPoseMode({ scene, player, ui, audio, people }) {
  let npc = null;                 // figurant en cours de pose
  let boneNode = null;            // os sous le gizmo
  let handles = [];               // pastilles cliquables, une par os
  let gizmo = null, layer = null;
  let followObs = null;           // les pastilles suivent les os, chaque frame
  let initial = null;             // pose à l'entrée, pour R
  const dirty = new Set();        // npc modifiés depuis la dernière sauvegarde

  const HANDLE_D = 0.05;

  function ensureGizmo() {
    if (gizmo) return;
    layer = new B.UtilityLayerRenderer(scene);
    try { layer.setRenderCamera(player.camera); } catch { }
    gizmo = new B.RotationGizmo(layer);
    gizmo.updateGizmoRotationToMatchAttachedMesh = true;   // axes LOCAUX de l'os
    gizmo.scaleRatio = 0.55;
    for (const g of [gizmo.xGizmo, gizmo.yGizmo, gizmo.zGizmo]) {
      g.dragBehavior.onDragEndObservable.add(() => {
        if (npc) { dirty.add(npc); npc._sync(); npc._snapshot(); }
        updateHudHint();
      });
    }
  }

  function handleMat() {
    if (handleMat.m) return handleMat.m;
    const m = new B.StandardMaterial("poseHandleM", scene);
    m.emissiveColor = C3(0.2, 0.9, 0.85);
    m.disableLighting = true;
    m.alpha = 0.9;
    const sel = m.clone("poseHandleSelM");
    sel.emissiveColor = C3(1, 0.6, 0.1);
    handleMat.m = m; handleMat.sel = sel;
    return m;
  }

  /** Entre en pose sur ce figurant (ou en change). */
  function enter(target) {
    exitBones();
    npc = target;
    npc.beginPosing();               // fige la respiration : le gizmo agit seul
    initial = npc.capturePose();
    ensureGizmo();
    handleMat();
    for (const nd of npc.poseBones()) {
      // phalanges : pastilles bien plus fines, sinon la main n'est qu'un amas
      const d = /Thumb|Index|Middle|Ring|Pinky|Hand$/.test(nd.name) ? HANDLE_D * 0.4 : HANDLE_D;
      const s = B.MeshBuilder.CreateSphere("poseH", { diameter: d, segments: 8 }, scene);
      s.material = handleMat.m;
      s.layerMask = HELPER;
      s.isPickable = true;
      // par-dessus le corps : les os vivent DEDANS, sans ça on ne voit que
      // les pastilles qui dépassent de la chair (groupe 2 = celui du HUD AR)
      s.renderingGroupId = 2;
      s.metadata = { poseBone: nd };
      handles.push(s);
    }
    followObs = scene.onBeforeRenderObservable.add(() => {
      for (const s of handles) s.position.copyFrom(s.metadata.poseBone.getAbsolutePosition());
    });
    audio.ui();
    ui.toast("POSE « " + npc.poseKey + " » — cliquez une pastille, tournez au gizmo ; R = pose d'origine");
    updateHudHint();
  }

  function selectBone(nd, handle) {
    boneNode = nd;
    for (const s of handles) s.material = s.metadata.poseBone === nd ? handleMat.sel : handleMat.m;
    ensureGizmo();
    gizmo.attachedNode = nd;
    audio.ui();
    ui.toast("Os « " + nd.name.split(":").pop() + " » — tournez les anneaux du gizmo");
    updateHudHint();
  }

  function deselectBone() {
    boneNode = null;
    if (gizmo) gizmo.attachedNode = null;
    for (const s of handles) s.material = handleMat.m;
    updateHudHint();
  }

  /** Quitte le squelette courant (pastilles et gizmo compris). */
  function exitBones() {
    deselectBone();
    if (followObs) { scene.onBeforeRenderObservable.remove(followObs); followObs = null; }
    for (const s of handles) s.dispose();
    handles = [];
    if (npc && npc.root && !npc.root.isDisposed()) {
      npc.endPosing();               // la micro-animation repart sur la pose finale
    }
    npc = null;
    initial = null;
    updateHudHint();
  }

  /**
   * La pastille visée par le pointeur — au PLUS PROCHE, pas au pixel près.
   * Une pastille fait 4 à 15 px à l'écran (2 mm de phalange à trois mètres) :
   * exiger que le rayon touche la sphère rendait la sélection quasi
   * impossible à la souris. On mesure donc l'écart angulaire entre le rayon
   * du clic et chaque os, avec ~1,3° de tolérance — l'équivalent d'une
   * vingtaine de pixels, quel que soit l'écran (Retina compris).
   */
  function pickHandle() {
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, B.Matrix.Identity(), scene.activeCamera);
    let best = null, bestScore = 1;
    for (const s of handles) {
      const v = s.metadata.poseBone.getAbsolutePosition().subtract(ray.origin);
      const t = B.Vector3.Dot(v, ray.direction);
      if (t <= 0.15) continue;                       // derrière ou sur la caméra
      const d = v.subtract(ray.direction.scale(t)).length();
      const score = d / Math.max(0.05, t * 0.022);   // rayon de tolérance ∝ distance
      if (score < bestScore) { bestScore = score; best = s; }
    }
    return best;
  }

  /**
   * Un TAP de l'éditeur pendant le mode pose. Renvoie true si consommé.
   * Pastille (ou presque) -> sélection d'os ; autre figurant -> on y passe ;
   * le figurant lui-même -> rien (un clic raté ne doit PAS fermer le mode) ;
   * le vide -> on remonte d'un cran (os, puis sortie du mode pose).
   */
  function tap(npcFor) {
    const h = pickHandle();
    if (h) {
      selectBone(h.metadata.poseBone, h);
      return true;
    }
    const hitN = scene.pick(scene.pointerX, scene.pointerY, (m) =>
      m.isEnabled() && m.isPickable !== false && !!npcFor(m));
    if (hitN && hitN.hit) {
      const other = npcFor(hitN.pickedMesh);
      if (other && other !== npc) { enter(other); return true; }
      return true;                     // son propre corps : clic raté, on ne bouge pas
    }
    if (boneNode) { deselectBone(); return true; }
    exitBones();
    return true;                       // le clic de sortie ne sélectionne rien d'autre
  }

  /** R : rejoue la pose qu'avait le figurant en entrant dans le mode. */
  function reset() {
    if (!npc || !initial) return;
    npc.applyPose(initial);
    dirty.add(npc);                    // elle peut différer d'une pose déjà SAUVÉE
    ui.toast("Pose d'origine restaurée — Ctrl+S pour l'écrire, ou reposez les os");
  }

  /** Ctrl+S de l'éditeur : verse les poses modifiées dans le plan. */
  function collect(layout) {
    if (npc) dirty.add(npc);           // l'édition en cours compte, même sans drag final
    if (!dirty.size) return 0;
    layout.poses = layout.poses || {};
    let n = 0;
    for (const p of dirty) {
      if (!p.root || p.root.isDisposed()) continue;
      layout.poses[p.poseKey] = p.capturePose();
      n++;
    }
    dirty.clear();
    return n;
  }

  function updateHudHint() {
    const el = document.getElementById("editSel");
    if (!el || !npc) return;
    const bn = boneNode ? boneNode.name.split(":").pop() : null;
    el.textContent = "POSE « " + npc.poseKey + " »" + (bn ? "  —  os : " + bn : "  —  cliquez une pastille");
  }

  /** Échap : remonte d'un cran — os désélectionné, puis sortie du mode. */
  function escape() {
    if (boneNode) deselectBone();
    else exitBones();
  }

  return {
    get active() { return !!npc; },
    enter, tap, reset, collect, escape,
    exit: exitBones,
  };
}
