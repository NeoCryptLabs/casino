/**
 * MODE POSE — le rayon « figurants » de l'éditeur (F2).
 *
 * Dans l'éditeur, cliquer un personnage pose une pastille sur chacun de ses
 * os ; cliquer une pastille y attache un gizmo de ROTATION en axes locaux —
 * on plie le squelette os par os, comme une figurine. Échap remonte d'un
 * cran (os -> personnage -> éditeur), R rend au personnage la pose calculée
 * du départ, Ctrl+S (géré par l'éditeur) écrit la pose dans le plan.
 *
 * Tant qu'aucun os n'est sélectionné, le PERSONNAGE ENTIER porte son propre
 * gizmo : flèches de position + anneau de lacet à ses pieds — on le déplace
 * et on le tourne d'un bloc. Sélectionner un os cache ce gizmo racine (les
 * anneaux se confondraient), le désélectionner le ramène.
 *
 * La pose sauvée vit dans layout.poses sous la clé `poste@modèle` (voir
 * npc.js : poseKey). Au démarrage, npc.js la rejoue PAR-DESSUS la posture
 * calculée (_dealerStance, _sit…), puis rebase les micro-animations dessus :
 * la respiration continue autour de la pose choisie au lieu de l'écraser.
 * Le PLACEMENT retouché vit, lui, dans layout.npcs sous la clé placeKey
 * (npc.js) — le point de spawn d'origine : déplacer l'ancre d'un ensemble
 * rebâtit ses figurants ailleurs et laisse tomber la retouche, c'est voulu.
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
  let rootPos = null, rootRot = null;   // gizmo racine : déplacer / tourner le PNJ
  let proxy = null;               // relais du gizmo d'os (échelle 1, cf. ensureGizmo)
  let draggingBone = false;       // drag d'anneau en cours : le relais mène l'os
  const dirty = new Set();        // npc modifiés depuis la dernière sauvegarde
  const moved = new Set();        // npc DÉPLACÉS/TOURNÉS, à verser dans layout.npcs

  const HANDLE_D = 0.05;

  function ensureGizmo() {
    if (gizmo) return;
    layer = new B.UtilityLayerRenderer(scene);
    try { layer.setRenderCamera(player.camera); } catch { }
    gizmo = new B.RotationGizmo(layer);
    // Le gizmo ne s'attache JAMAIS à l'os : en axes locaux
    // (updateGizmoRotationToMatchAttachedMesh), Babylon refuse de tourner un
    // nœud dont l'échelle MONDE n'est pas uniforme (simple Logger.Warn, les
    // anneaux ne font rien) — et tous nos squelettes sont dans ce cas : la
    // carrure (npc.js, model.scaling.x/z *= build) rend l'échelle anisotrope,
    // les rigs du personnel portent en plus des échelles d'os non uniformes
    // d'origine (~0,89/0,91). Et en axes MONDE, les anneaux ignorent
    // l'orientation de l'os — le drag semble suivre la souris.
    // D'où le RELAIS : un TransformNode d'échelle 1, calé sur la rotation
    // monde de l'os, qui porte les anneaux du gizmo.
    // Mais on N'UTILISE PAS l'angle calculé par Babylon : il sort de
    // l'intersection rayon/plan de l'anneau, et un anneau vu par la tranche
    // rend cette intersection instable — l'os oscillait entre deux positions,
    // ou la jambe se téléportait au premier pixel de drag (ses anneaux rasent
    // la caméra quand on est debout). L'angle est donc mesuré À L'ÉCRAN,
    // autour du centre projeté du gizmo, façon Blender : atan2 du pointeur,
    // stable quel que soit l'angle de caméra. Chaque delta (borné à ±π) est
    // rejoué sur l'os par rotate(axe MONDE de l'anneau saisi, angle) — le
    // même chemin que les poses procédurales de npc.js — et la rotation que
    // Babylon inflige au relais est annulée à chaque événement, ce qui fige
    // aussi les anneaux pendant le drag. Maj = mouvement ×0,1 (précision
    // fine) ; l'angle cumulé s'affiche dans le HUD.
    gizmo.updateGizmoRotationToMatchAttachedMesh = true;
    gizmo.scaleRatio = 0.55;
    proxy = new B.TransformNode("poseGizmoProxy", scene);
    proxy.rotationQuaternion = new B.Quaternion();

    let fine = false;                     // Maj enfoncée : sensibilité ×0,1
    const onKey = (e) => { fine = e.shiftKey; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);

    const drag = {
      q0: new B.Quaternion(),   // relais à la saisie — restauré à chaque delta
      axis: new B.Vector3(),    // axe MONDE de l'anneau saisi
      sign: 1,                  // sens écran <-> sens monde (axe vers/loin caméra)
      theta: null,              // dernier angle écran (null : pas encore mesuré)
      total: 0,                 // radians appliqués depuis la saisie, pour le HUD
    };

    /** Angle écran du pointeur autour du centre projeté du gizmo (ou null
     *  à moins de ~8 px du centre, où l'angle n'est pas défini). */
    const screenTheta = () => {
      const engine = scene.getEngine(), cam = scene.activeCamera;
      const c = B.Vector3.Project(proxy.position, B.Matrix.Identity(),
        scene.getTransformMatrix(),
        cam.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
      // pointerX/Y sont en px CSS, Project rend des px du tampon de rendu
      const canvas = engine.getRenderingCanvas();
      const k = canvas && canvas.clientWidth ? engine.getRenderWidth() / canvas.clientWidth : 1;
      const dx = scene.pointerX * k - c.x, dy = scene.pointerY * k - c.y;
      if (dx * dx + dy * dy < 64 * k * k) return null;
      return Math.atan2(dy, dx);
    };

    const applyDelta = () => {
      if (!boneNode || !proxy) return;
      // annule la rotation « rayon/plan » que Babylon vient d'écrire au relais
      proxy.rotationQuaternion.copyFrom(drag.q0);
      const t = screenTheta();
      if (t === null) return;
      if (drag.theta === null) { drag.theta = t; return; }
      let d = t - drag.theta;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      drag.theta = t;
      const a = d * drag.sign * (fine ? 0.1 : 1);
      if (!a) return;
      boneNode.rotate(drag.axis, a, B.Space.WORLD);
      drag.total += a;
      if (npc) npc._sync();
      const el = document.getElementById("editSel");
      if (el) {
        const deg = drag.total * 180 / Math.PI;
        el.textContent = "Os « " + boneNode.name.split(":").pop() + " »  "
          + (deg >= 0 ? "+" : "") + deg.toFixed(1) + "°"
          + (fine ? "  •  fin ×0,1" : "  •  Maj = fin");
      }
    };
    const AXES = [[0, B.Axis.X], [1, B.Axis.Y], [2, B.Axis.Z]];
    for (const [i, localAxis] of AXES) {
      const g = [gizmo.xGizmo, gizmo.yGizmo, gizmo.zGizmo][i];
      g.dragBehavior.onDragStartObservable.add(() => {
        draggingBone = true;
        drag.q0.copyFrom(proxy.rotationQuaternion);
        localAxis.applyRotationQuaternionToRef(drag.q0, drag.axis).normalize();
        const cam = scene.activeCamera;
        const toCenter = proxy.position.subtract(cam.globalPosition);
        drag.sign = B.Vector3.Dot(drag.axis, toCenter) > 0 ? 1 : -1;
        drag.theta = screenTheta();
        drag.total = 0;
      });
      g.dragBehavior.onDragObservable.add(applyDelta);
      g.dragBehavior.onDragEndObservable.add(() => {
        applyDelta();
        draggingBone = false;
        if (npc) { dirty.add(npc); npc._sync(); npc._snapshot(); }
        updateHudHint();
      });
    }
  }

  /** Cale le relais sur l'os : position toujours, rotation hors drag. */
  function syncProxy() {
    if (!proxy || !boneNode) return;
    const q = new B.Quaternion(), p = new B.Vector3();
    boneNode.getWorldMatrix().decompose(undefined, q, p);
    proxy.position.copyFrom(p);
    if (!draggingBone) proxy.rotationQuaternion.copyFrom(q);
  }

  /**
   * Le gizmo racine : flèches de position (axes monde) + anneau de lacet.
   * Pas d'anneaux X/Z — pencher un figurant le planterait dans le sol, et le
   * lacet suffit pour l'orienter face à sa table.
   */
  function ensureRootGizmo() {
    if (rootPos) return;
    rootPos = new B.PositionGizmo(layer);
    rootPos.scaleRatio = 0.9;
    rootRot = new B.PlaneRotationGizmo(new B.Vector3(0, 1, 0), C3(0.9, 0.7, 0.15), layer);
    rootRot.scaleRatio = 1.15;
    const ends = [rootPos.xGizmo, rootPos.yGizmo, rootPos.zGizmo, rootRot];
    for (const g of ends) g.dragBehavior.onDragEndObservable.add(rootMoved);
  }

  function rootMoved() {
    if (!npc) return;
    const r = npc.root;
    // l'anneau écrit un quaternion ; le reste du code (npc.js, réseau) lit
    // rotation.y — on rabat le lacet dans l'Euler et on jette le quaternion
    if (r.rotationQuaternion) {
      const y = r.rotationQuaternion.toEulerAngles().y;
      r.rotationQuaternion = null;
      r.rotation.set(0, y, 0);
    }
    npc._sync();
    moved.add(npc);
    ui.toast("« " + npc.placeKey + " » déplacé — Ctrl+S pour figer");
    updateHudHint();
  }

  function attachRoot() {
    if (!npc) return;
    ensureRootGizmo();
    rootPos.attachedNode = npc.root;
    rootRot.attachedNode = npc.root;
  }

  function detachRoot() {
    if (!rootPos) return;
    rootPos.attachedNode = null;
    rootRot.attachedNode = null;
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
      syncProxy();                   // le relais du gizmo colle à l'os sélectionné
    });
    attachRoot();                    // flèches + anneau : déplacer/tourner le PNJ entier
    audio.ui();
    ui.toast("POSE « " + npc.poseKey + " » — pastille = os ; flèches/anneau = déplacer, tourner ; R = pose d'origine");
    updateHudHint();
  }

  function selectBone(nd, handle) {
    boneNode = nd;
    detachRoot();                    // ses anneaux se confondraient avec ceux de l'os
    for (const s of handles) s.material = s.metadata.poseBone === nd ? handleMat.sel : handleMat.m;
    ensureGizmo();
    syncProxy();                     // cale le relais AVANT d'armer le gizmo
    gizmo.attachedNode = proxy;
    audio.ui();
    ui.toast("Os « " + nd.name.split(":").pop() + " » — anneaux = tourner ; Maj = précision fine (×0,1)");
    updateHudHint();
  }

  function deselectBone() {
    boneNode = null;
    if (gizmo) gizmo.attachedNode = null;
    for (const s of handles) s.material = handleMat.m;
    attachRoot();                    // le gizmo racine reprend la main
    updateHudHint();
  }

  /** Quitte le squelette courant (pastilles et gizmo compris). */
  function exitBones() {
    deselectBone();
    detachRoot();
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

  /** Ctrl+S de l'éditeur : verse poses ET placements modifiés dans le plan. */
  function collect(layout) {
    if (npc) dirty.add(npc);           // l'édition en cours compte, même sans drag final
    let n = 0;
    if (dirty.size) {
      layout.poses = layout.poses || {};
      for (const p of dirty) {
        if (!p.root || p.root.isDisposed()) continue;
        layout.poses[p.poseKey] = p.capturePose();
        n++;
      }
      dirty.clear();
    }
    if (moved.size) {
      layout.npcs = layout.npcs || {};
      const f = (v) => Math.round(v * 1e4) / 1e4;
      for (const p of moved) {
        if (!p.root || p.root.isDisposed()) continue;
        const r = p.root;
        layout.npcs[p.placeKey] = {
          p: [f(r.position.x), f(r.position.y), f(r.position.z)],
          ry: f(r.rotation.y),
        };
        n++;
      }
      moved.clear();
    }
    return n;
  }

  function updateHudHint() {
    const el = document.getElementById("editSel");
    if (!el || !npc) return;
    const bn = boneNode ? boneNode.name.split(":").pop() : null;
    el.textContent = "POSE « " + npc.poseKey + " »"
      + (bn ? "  —  os : " + bn : "  —  pastille = os, flèches/anneau = placer")
      + (moved.has(npc) || dirty.has(npc) ? "  •  non sauvé" : "");
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
