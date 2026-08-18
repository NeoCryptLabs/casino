/**
 * LA SCÈNE DE CABARET — modèle Blender (assets/stage.glb), encastrée dans le
 * mur derrière le pit de blackjack.
 *
 * Le glb contient : plateau rond en bois verni + jupe velours + nez doré,
 * marches en arc, pilastres cannelés, ARC lisse à double tore doré/bronze,
 * entablement, enseigne « LE MIRAGE » en lettres émissives, cantonnière à
 * glands, rampe de globes, pied de micro — et les DEUX PANS de rideau
 * (`curtainL`/`curtainR`), plis modélisés, dont l'origine est posée sur leur
 * pilastre : Babylon les anime par `scaling.x`, la compression des plis vers
 * le montant — le geste réel d'un rideau à l'italienne — avec ressort amorti.
 *
 * Convention d'axes vérifiée EN JEU (captures) : Blender (x, y, z) arrive en
 * local Babylon (x, z, y) avec rotation racine atan2(P.x, P.z) — le côté
 * public (-Y Blender) regarde alors le centre de la salle.
 *
 * Les COULISSES restent bâties ici : une niche noire creusée derrière le
 * rideau (le glb n'a pas à connaître le mur du casino).
 */
import { V3, C3, pbr, gold } from "./util.js";
import { LAYOUT } from "./world.js";
const B = BABYLON;

export const STAGE_H = 0.45;      // hauteur du plateau (cf. modèle Blender)
const R = 2.6;                    // rayon de la DEMI-LUNE qui déborde du mur
const DEPTH = 2.6;                // profondeur des coulisses (dans le mur)
/**
 * Plan du MUR, en z local de la scène.
 *
 * Le glb porte trois panneaux de remplissage (`wallFill+1`, `wallFill-1`,
 * `wallFillTop`) qui bouchent le pourtour de la baie. Ils sont taillés à
 * l'épaisseur exacte du mur — 0,5 m, comme les boîtes de `world.js` — et
 * centrés en z local +0,05 : c'est CE plan qui doit coïncider avec l'axe du
 * mur, sinon les panneaux flottent dans la salle et la baie reste béante
 * derrière les coulisses.
 */
const FILL_Z = 0.05;

export async function buildStage(scene, world, audio) {
  const P = LAYOUT.stage;
  const root = new B.TransformNode("stage", scene);
  root.position = P.clone();
  // coulisses vers le mur le plus proche — arrondi au quart de tour pour que
  // la niche s'encastre PARALLÈLE au mur (l'ancre n'est jamais pile sur l'axe)
  const q = ((Math.round(Math.atan2(P.x, P.z) / (Math.PI / 2)) % 4) + 4) % 4;
  root.rotation.y = q * (Math.PI / 2);

  // SOUDURE AU MUR. Après le quart de tour, le +Z local regarde le mur : +Z
  // monde pour q=0, +X pour q=1, -Z pour q=2, -X pour q=3. On recale l'ancre
  // sur ce mur-là, et sur ce seul axe — le placement LATÉRAL reste celui du
  // plan (et du gizmo). Sans ce recalage, l'ancre saisie à la main laisse la
  // scène en avant du mur : 3,55 m d'écart mesurés, donc une baie ouverte sur
  // le vide derrière les coulisses.
  const hw = LAYOUT.hall.w / 2, hd = LAYOUT.hall.d / 2;
  if (q === 0) P.z = hd - FILL_Z;
  else if (q === 1) P.x = hw - FILL_Z;
  else if (q === 2) P.z = -hd + FILL_Z;
  else P.x = -hw + FILL_Z;
  root.position = P.clone();
  root.computeWorldMatrix(true);
  const local = (v) => B.Vector3.TransformCoordinates(v, root.getWorldMatrix());

  let curtainL = null, curtainR = null;
  try {
    const res = await B.SceneLoader.ImportMeshAsync("", "/assets/", "stage.glb", scene);
    const glbRoot = res.meshes.find((m) => m.name === "__root__") || res.meshes[0];
    glbRoot.parent = root;
    // AUTO-ORIENTATION : le glb embarque un marqueur invisible côté public
    // (markFront). Si après import il se retrouve côté mur (+Z local), on
    // retourne le sous-arbre de 180° — fini les paris sur les axes glTF.
    const mark = res.meshes.find((m) => m.name === "markFront");
    if (mark) {
      mark.computeWorldMatrix(true);
      const lp = B.Vector3.TransformCoordinates(
        mark.getAbsolutePosition(),
        B.Matrix.Invert(root.getWorldMatrix()));
      // ATTENTION : le chargeur pose un rotationQuaternion sur __root__ — les
      // écritures d'euler sont IGNORÉES tant qu'il existe. On compose donc le
      // demi-tour directement dans le quaternion.
      if (lp.z > 0) {
        const q = glbRoot.rotationQuaternion;
        const half = B.Quaternion.RotationAxis(B.Axis.Y, Math.PI);
        if (q) glbRoot.rotationQuaternion = q.multiply(half);
        else glbRoot.rotation.y += Math.PI;
      }
      mark.setEnabled(false);
    }
    const sg = world.shadowGens[1] || world.shadowGens[0];
    for (const m of res.meshes) {
      if (!m.getTotalVertices || !m.getTotalVertices()) continue;
      m.receiveShadows = true;
      if (/curtain|stageDeck|prosShaft/.test(m.name)) sg?.addShadowCaster(m);
    }
    curtainL = res.meshes.find((m) => m.name === "curtainL") || null;
    curtainR = res.meshes.find((m) => m.name === "curtainR") || null;

    // LE MICRO du glb est jeté. Trois défauts, tous rédhibitoires : il est posé
    // à x = -1,35 (le glb) alors que tout le code visait +1,35 — la chanteuse
    // chantait donc à 2,70 m de son pied ; sa capsule culmine à 1,25 m du
    // plateau, hauteur de table basse ; et son corps est basculé de 70°, tête
    // en bas. Il est reconstruit ci-dessous, au centre et à hauteur de bouche.
    for (const m of res.meshes) {
      if (/^mic(Base|Stem|Clamp|Boom|Body|Head)$/.test(m.name)) m.dispose();
    }
  } catch (e) {
    console.warn("stage.glb indisponible :", e);
  }

  /* ---------------- pied de micro, au centre du plateau ------------------- */
  // Repères : le plateau est en y = STAGE_H, le public en -Z local. La
  // chanteuse se place DERRIÈRE le pied (z un peu plus grand) et regarde le
  // public ; la capsule doit donc pointer vers elle, c'est-à-dire vers +Z.
  const MIC_Z = -1.55;              // avancée du pied sur le plateau
  // hauteur de la capsule AU-DESSUS DU PLATEAU (le nœud du pied y est posé) :
  // la bouche d'un personnage de 1,70 m est à ~1,55 m, le micro se tient juste
  // en dessous et pointe vers elle
  const MIC_Y = 1.42;
  const mic = new B.TransformNode("micStand", scene);
  mic.parent = root;
  mic.position.set(0, STAGE_H, MIC_Z);
  // points de PRISE, remplis pendant la construction : c'est là que la
  // chanteuse pose ses mains (le corps du micro pour la haute, le fût pour la
  // basse). Exprimés en local, `local()` les passe en monde à la demande.
  let gripHigh = V3(0, STAGE_H + 1.2, MIC_Z);
  let gripLow = V3(0, STAGE_H + 0.98, MIC_Z);
  {
    const dark = pbr("micMetal", scene, { color: C3(0.09, 0.09, 0.11), metallic: 0.9, roughness: 0.34 });
    const grille = pbr("micGrille", scene, { color: C3(0.16, 0.16, 0.18), metallic: 1, roughness: 0.52 });
    const part = (m, y, z = 0) => { m.parent = mic; m.position.set(0, y, z); return m; };

    part(B.MeshBuilder.CreateCylinder("micBase", { diameter: 0.30, height: 0.035, tessellation: 24 }, scene), 0.018)
      .material = dark;
    part(B.MeshBuilder.CreateCylinder("micBaseRing", { diameter: 0.32, height: 0.012, tessellation: 24 }, scene), 0.006)
      .material = gold(scene, 0.85);
    const H = MIC_Y - 0.18;         // le fût s'arrête sous le col
    part(B.MeshBuilder.CreateCylinder("micStem", { diameter: 0.032, height: H, tessellation: 12 }, scene), H / 2)
      .material = dark;
    part(B.MeshBuilder.CreateCylinder("micCollar", { diameter: 0.048, height: 0.03, tessellation: 12 }, scene), H * 0.55)
      .material = gold(scene, 0.8);
    part(B.MeshBuilder.CreateCylinder("micClamp", { diameter: 0.05, height: 0.05, tessellation: 12 }, scene), H + 0.02)
      .material = dark;

    // Corps incliné vers la chanteuse : 28° de la verticale, capsule en HAUT.
    // C'est tout l'inverse du glb, où la capsule plongeait vers le plancher.
    const tilt = 0.49;
    const body = B.MeshBuilder.CreateCylinder("micBody", { diameterTop: 0.046, diameterBottom: 0.034, height: 0.15, tessellation: 16 }, scene);
    body.parent = mic;
    // repère gaucher : une rotation POSITIVE autour de X bascule +Y vers +Z,
    // donc vers la chanteuse — c'est bien ce qu'on veut, et le corps doit
    // pencher du même côté que le décalage de position calculé juste après
    body.rotation.x = tilt;
    body.position.set(0, H + 0.045 + Math.cos(tilt) * 0.075, Math.sin(tilt) * 0.075);
    body.material = dark;
    const head = B.MeshBuilder.CreateSphere("micHead", { diameter: 0.062, segments: 12 }, scene);
    head.parent = mic;
    head.position.set(0, H + 0.045 + Math.cos(tilt) * 0.16, Math.sin(tilt) * 0.16);
    head.material = grille;
    for (const m of [body, head]) m.receiveShadows = true;

    // la main haute empoigne le corps du micro, juste sous la grille ; la
    // basse tient le fût une vingtaine de centimètres plus bas
    gripHigh = V3(0, STAGE_H + body.position.y, MIC_Z + body.position.z);
    gripLow = V3(0, STAGE_H + H * 0.90, MIC_Z);
  }

  // Les trois points réglables au gizmo (voir ANCHOR_DEFS dans editor.js). À
  // zéro, ils n'ont jamais été réglés : on y pose ce que donne la géométrie du
  // pied qu'on vient de bâtir. Réglés, ils gagnent — c'est le calque de
  // l'éditeur qui commande, pas le code.
  const unset = (v) => !v || (!v.x && !v.y && !v.z);
  if (unset(LAYOUT.singerSpot)) LAYOUT.singerSpot.copyFrom(local(V3(0, STAGE_H, MIC_Z + 0.30)));
  if (unset(LAYOUT.micHigh)) LAYOUT.micHigh.copyFrom(local(gripHigh));
  if (unset(LAYOUT.micLow)) LAYOUT.micLow.copyFrom(local(gripLow));

  /* -------- collisions (la géométrie visible vient toute du glb) -------- */
  const box = (name, w, h, d, pos) => {
    const m = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    m.parent = root; m.position.copyFrom(pos);
    m.isVisible = false;
    m.checkCollisions = true;
    return m;
  };
  // coulisses : fond, flancs, plancher praticable
  box("nicheBackCol", 8.6, 5.6, 0.3, V3(0, 2.8, DEPTH));
  box("nicheLCol", 0.3, 5.6, DEPTH, V3(-4.2, 2.8, DEPTH / 2));
  box("nicheRCol", 0.3, 5.6, DEPTH, V3(4.2, 2.8, DEPTH / 2));
  box("stageWingsCol", 8.2, STAGE_H, DEPTH, V3(0, STAGE_H / 2, DEPTH / 2));
  // demi-lune (cylindre plein : la moitié dans le mur ne gêne personne)
  const cyl = B.MeshBuilder.CreateCylinder("stageColC", { height: STAGE_H, diameter: R * 2, tessellation: 24 }, scene);
  cyl.parent = root; cyl.position.y = STAGE_H / 2;
  cyl.isVisible = false; cyl.checkCollisions = true;
  // marches et pilastres
  box("stageStepCol0", 2.0, 0.15, 0.34, V3(0, 0.075, -(R + 0.40)));
  box("stageStepCol1", 2.0, 0.30, 0.30, V3(0, 0.15, -(R + 0.12)));
  box("prosColL", 0.6, 4.0, 0.6, V3(-3.75, 2.0, -0.1));
  box("prosColR", 0.6, 4.0, 0.6, V3(3.75, 2.0, -0.1));

  /* ---------------- lumière d'ambiance du plateau -------------------------- */
  const sp = new B.SpotLight("lStage", local(V3(0, 4.6, -R - 2.6)),
    local(V3(0, STAGE_H, 0.4)).subtract(local(V3(0, 4.6, -R - 2.6))).normalize(),
    1.0, 4, scene);
  sp.intensity = 17; sp.diffuse = C3(1, 0.84, 0.55); sp.specular = C3(0.35, 0.3, 0.18);
  sp.range = 15;
  const lights = [sp];

  /* ---------------- POURSUITES : deux faisceaux sur la chanteuse ---------- */
  // Elles ne sont PAS dans `lights` : ce tableau est celui que le concert
  // pousse à 1,9× pendant le spectacle, et 1,9 × 0 vaut toujours 0. Les
  // poursuites s'allument par `stage.follow(true)` et se braquent chaque
  // image sur le personnage — d'où le nom.
  const FOLLOW = [
    { x: -2.9, tint: C3(1, 0.90, 0.72), peak: 26 },   // côté jardin, blanc chaud
    { x: 2.9, tint: C3(0.80, 0.86, 1.00), peak: 20 },  // côté cour, plus froid
  ];
  const aimAt = local(V3(0, STAGE_H + 1.0, MIC_Z));
  const spots = FOLLOW.map((f, i) => {
    const from = local(V3(f.x, 5.0, -R - 1.0));
    const l = new B.SpotLight("lFollow" + i, from,
      aimAt.subtract(from).normalize(), 0.46, 14, scene);
    l.diffuse = f.tint;
    l.specular = f.tint.scale(0.6);
    l.intensity = 0;
    l.range = 16;
    l._peak = f.peak;
    l._from = from;
    return l;
  });
  let followT = 0;              // 0 = éteintes, 1 = plein feu (fondu doux)

  /**
   * Braque les poursuites sur un point du monde. Le fondu est fait ici plutôt
   * qu'à l'allumage : un projecteur de music-hall monte en une seconde, il ne
   * claque pas.
   */
  function aimFollow(worldPos, on, dt) {
    const want = on ? 1 : 0;
    followT += (want - followT) * Math.min(1, dt * 2.2);
    if (followT < 0.002 && !on) followT = 0;
    for (const l of spots) {
      l.intensity = l._peak * followT;
      if (!worldPos) continue;
      // le faisceau suit le personnage, avec un rattrapage doux : une poursuite
      // manuelle a toujours un temps de retard sur l'artiste
      const dir = worldPos.subtract(l._from).normalize();
      l.direction.addInPlace(dir.subtract(l.direction).scale(Math.min(1, dt * 5)));
      l.direction.normalize();
    }
  }

  /* ---------------- le rideau : ressort + compression des plis ------------- */
  let open = 0, target = 0, vel = 0, t = 0;
  const curtain = {
    get open() { return open; },
    get target() { return target; },
    setOpen(v) { target = Math.max(0, Math.min(1, v)); },
    toggle() { target = target > 0.5 ? 0 : 1; },
    tick(dt) {
      if (!curtainL || !curtainR) return;
      t += dt;
      vel += ((target - open) * 15 - vel * 6.2) * dt;   // le velours est lourd
      open += vel * dt;
      const o = Math.max(0, Math.min(1, open));
      const sq = 1 - o * 0.85;          // jamais tout à fait nul : le paquet de plis
      curtainL.scaling.x = sq;
      curtainR.scaling.x = sq;
      // ballant : le bas des pans suit le mouvement avec l'inertie
      curtainL.rotation.x = vel * 0.10;
      curtainR.rotation.x = vel * 0.10;
      // micro-vie du velours au repos
      const breathe = 1 + Math.sin(t * 0.6) * 0.004;
      curtainL.scaling.y = breathe;
      curtainR.scaling.y = breathe;
    },
    meshes: [curtainL, curtainR].filter(Boolean),
  };
  curtain.tick(0.016);

  return {
    root, height: STAGE_H, lights, curtain, spots,
    center: () => root.getAbsolutePosition(),
    at: (x, z, y = STAGE_H) => local(V3(x, y, z)),
    /** Pied du micro, au CENTRE du plateau. */
    micAt: () => local(V3(0, STAGE_H, MIC_Z)),
    /** Où doit se tenir l'artiste : ancre `singerSpot`, réglable au gizmo. */
    micSpot: () => LAYOUT.singerSpot.clone(),
    /**
     * Les deux prises du micro, en monde : main haute (corps), main basse (fût).
     * Les deux points viennent des ANCRES du plan, donc du gizmo de l'éditeur.
     * `adj` y ajoute un décalage monde, pour un réglage fin à la console
     * (`__dev.grip`) sans passer par l'éditeur.
     */
    micGrip: (adj = {}) => {
      const off = (base, d) => new B.Vector3(base.x + (d?.[0] || 0),
                                             base.y + (d?.[1] || 0),
                                             base.z + (d?.[2] || 0));
      return { high: off(LAYOUT.micHigh, adj.high), low: off(LAYOUT.micLow, adj.low) };
    },
    /** @param {BABYLON.Vector3|null} at cible des poursuites ; `on` les allume */
    follow: (at, on, dt) => aimFollow(at, on, dt),
    tick: (dt) => curtain.tick(dt),
    open: (v) => curtain.setOpen(v),
    toggle: () => curtain.toggle(),
    get isOpen() { return curtain.target > 0.5; },
  };
}
