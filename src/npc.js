/**
 * Figurants : personnage glTF rigué (rig Mixamo) instancié par personne,
 * posé debout ou assis par manipulation du squelette.
 *
 * Deux modèles sont prévus (`MODELS`). Le modèle masculin est chargé depuis le
 * dossier local `assets/` : déposez-y un `.glb` rigué Mixamo/Ready Player Me et
 * le barman, le croupier et une partie des clients deviennent des hommes, sans
 * toucher au code. À défaut, tout le monde utilise le modèle féminin.
 */
import { V3, C3, rnd, rndInt, pick, clamp, canvasTex, gold } from "./util.js";
import { buildStaffKit, STAFF } from "./staff.js";
const B = BABYLON;

// Seul modèle réaliste librement accessible en ligne. Les autres sont
// optionnels et lus dans assets/ (voir assets/README.md).
const BASE_MODEL = "https://threejs.org/examples/models/gltf/Michelle.glb";
const OPTIONAL = [
  "assets/male.glb", "assets/male2.glb",
  "assets/female2.glb", "assets/female3.glb",
];
const IS_MALE = /(^|\/)male\d*\.glb$/i;

// Le modèle de base n'a qu'un matériau (corps + vêtements) : la seule variation
// possible est une nuance globale.
const TINTS = [
  C3(1, 1, 1), C3(0.78, 0.76, 0.84), C3(1.05, 0.95, 0.82),
  C3(0.62, 0.66, 0.78), C3(0.95, 0.82, 0.76), C3(0.7, 0.78, 0.72),
  C3(0.85, 0.7, 0.7), C3(0.55, 0.58, 0.62),
];
const UNIFORM_TINT = C3(0.42, 0.4, 0.44);

// Verrou sur les clips squelettiques : voir NPC.play()
const CLIPS_DISABLED = false;

/** Tenues de service. Le rôle doit se lire d'un coup d'œil depuis la table. */
export const OUTFITS = {
  dealer: { vest: "#141419", trim: "#c9a227", visor: true, garters: true, body: false },
  bar: { vest: "#5c1420", trim: "#d8c07a", visor: false, garters: true, body: false },
};

/**
 * Gilet de croupier enroulé sur un cylindre de torse.
 *
 * Sur le flanc d'un cylindre Babylon, u fait le tour et v court le long de
 * l'axe ; `canvasTex` pose le haut du canvas sur v = 0. On recale les deux via
 * `faceUV` (voir `_outfit`) pour que le canvas se lise à l'endroit, l'avant du
 * personnage au centre.
 */
function vestTexture(scene, o) {
  return canvasTex("vest" + o.vest, scene, 1024, 512, (c, W, H) => {
    const FRONT = W / 2;
    c.fillStyle = o.vest; c.fillRect(0, 0, W, H);

    // texture de drap : fines hachures verticales
    c.globalAlpha = 0.16;
    for (let x = 0; x < W; x += 3) {
      c.fillStyle = x % 6 ? "rgba(255,255,255,.10)" : "rgba(0,0,0,.35)";
      c.fillRect(x, 0, 1.5, H);
    }
    c.globalAlpha = 1;

    // ombrage sur les flancs : le gilet doit sembler galber le torse
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(0.28, "rgba(0,0,0,.12)");
    g.addColorStop(0.5, "rgba(255,255,255,.07)");
    g.addColorStop(0.72, "rgba(0,0,0,.12)"); g.addColorStop(1, "rgba(0,0,0,.55)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    // chemise blanche : col + échancrure en V sur le devant
    const VW = 132, VD = H * 0.46;
    c.fillStyle = "#f4f1e8";
    c.beginPath();
    c.moveTo(FRONT - VW, 0); c.lineTo(FRONT + VW, 0);
    c.lineTo(FRONT, VD); c.closePath(); c.fill();
    c.fillRect(FRONT - VW * 1.18, 0, VW * 2.36, H * 0.055);   // bande de col

    // revers du gilet, de part et d'autre du V
    c.strokeStyle = "rgba(0,0,0,.5)"; c.lineWidth = 9;
    c.beginPath();
    c.moveTo(FRONT - VW, 0); c.lineTo(FRONT, VD); c.lineTo(FRONT + VW, 0);
    c.stroke();
    c.strokeStyle = o.trim; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(FRONT - VW + 7, 0); c.lineTo(FRONT, VD - 12); c.lineTo(FRONT + VW - 7, 0);
    c.stroke();

    // boutonnage sous le V
    for (let i = 0; i < 4; i++) {
      const y = VD + 34 + i * 46;
      if (y > H - 26) break;
      c.beginPath(); c.arc(FRONT, y, 8, 0, 7);
      c.fillStyle = o.trim; c.fill();
      c.strokeStyle = "rgba(0,0,0,.45)"; c.lineWidth = 2; c.stroke();
    }
    // pointe basse du gilet
    c.fillStyle = "rgba(0,0,0,.35)";
    c.beginPath();
    c.moveTo(FRONT - 88, H); c.lineTo(FRONT + 88, H); c.lineTo(FRONT, H - 74);
    c.closePath(); c.fill();
  });
}

/**
 * Recolore l'atlas du personnage en tenue de service : le jogging jaune devient
 * un pantalon noir, le haut clair une chemise blanche, et les accessoires
 * colorés (écouteurs, liserés) passent au noir. On travaille par clé de
 * couleur : l'atlas est un seul calque corps + vêtements.
 */
async function uniformTexture(scene, mat) {
  const tex = mat.albedoTexture || mat.diffuseTexture;
  if (!tex) return null;
  const size = tex.getSize();
  const raw = await tex.readPixels();
  if (!raw) return null;

  const src = document.createElement("canvas");
  src.width = size.width; src.height = size.height;
  const sctx = src.getContext("2d");
  const img = sctx.createImageData(size.width, size.height);
  img.data.set(new Uint8ClampedArray(raw.buffer || raw));
  sctx.putImageData(img, 0, 0);

  const dt = new B.DynamicTexture("uniformTex", { width: size.width, height: size.height }, scene, true);
  const c = dt.getContext();
  c.save(); c.translate(0, size.height); c.scale(1, -1);   // readPixels est en bas-haut
  c.drawImage(src, 0, 0); c.restore();

  const d = c.getImageData(0, 0, size.width, size.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i], g = p[i + 1], b = p[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx - mn;
    const hue = mx === mn ? 0
      : mx === r ? (60 * ((g - b) / sat) + 360) % 360
      : mx === g ? 60 * ((b - r) / sat) + 120
      : 60 * ((r - g) / sat) + 240;
    const k = mx / 255;
    if (sat > 70 && hue > 40 && hue < 75) {            // jogging jaune -> pantalon
      p[i] = 24 * k; p[i + 1] = 24 * k; p[i + 2] = 29 * k;
    } else if (sat < 42 && mx > 120) {                  // haut clair -> chemise
      p[i] = 232 * k; p[i + 1] = 230 * k; p[i + 2] = 223 * k;
    } else if (sat > 80 && (hue < 25 || hue > 330 || (hue > 150 && hue < 220))) {
      p[i] = 30 * k; p[i + 1] = 30 * k; p[i + 2] = 34 * k;   // rouge/cyan -> noir
    }
  }
  c.putImageData(d, 0, 0);
  dt.update(false);
  dt.hasAlpha = false;
  return dt;
}

async function tryLoad(scene, url) {
  try {
    const head = await fetch(url, { method: "HEAD" });
    if (!head.ok) return null;
  } catch (e) { return null; }
  try {
    const c = B.LoadAssetContainerAsync
      ? await B.LoadAssetContainerAsync(url, scene)
      : await B.SceneLoader.LoadAssetContainerAsync("", url, scene);
    // Le chargeur glTF démarre AUTOMATIQUEMENT le premier groupe d'animation.
    // Sur un modèle porteur de clips, ça laissait `idle` et `walk` tourner en
    // permanence par-dessus tout le reste.
    (c.animationGroups || []).forEach((g) => { g.stop(); g.reset(); });
    return c;
  } catch (e) { console.warn("Modèle illisible :", url, e); return null; }
}

export class People {
  static async load(scene, world) {
    const kits = [];
    const base = B.LoadAssetContainerAsync
      ? await B.LoadAssetContainerAsync(BASE_MODEL, scene)
      : await B.SceneLoader.LoadAssetContainerAsync("", BASE_MODEL, scene);
    kits.push({ url: BASE_MODEL, container: base, male: false });
    for (const url of OPTIONAL) {
      const c = await tryLoad(scene, url);
      if (c) kits.push({ url, container: c, male: IS_MALE.test(url) });
    }
    // Personnel : modèles dédiés, modelés et riggés à part (squelette Mixamo,
    // poids automatiques). `staff: role` réserve le kit à ce poste, pour qu'un
    // client ne se retrouve jamais habillé en croupier. Repli sur le mannequin
    // procédural si le .glb manque.
    // Avatar des joueurs distants : modèle dédié, porteur des clips idle/walk/sit.
    // Sans lui on retombe sur le modèle importé, qui n'a aucune animation.
    const avatar = await tryLoad(scene, "assets/player.glb");
    if (avatar) kits.push({ url: "assets/player.glb", container: avatar, male: true, avatar: true });
    else console.info("[casino] assets/player.glb absent : avatars sans animation");

    for (const [role, file] of [["dealer", "assets/dealer.glb"], ["bar", "assets/barman.glb"]]) {
      const c = await tryLoad(scene, file);
      if (!c) console.info("[casino] " + file + " introuvable : mannequin de repli pour " + role);
      kits.push({
        url: c ? file : "procedural:" + role,
        container: c || buildStaffKit(scene, role),
        male: true, staff: role,
      });
    }
    const people = new People(scene, world, kits);
    await people._prepareUniform();
    return people;
  }

  /** Matériau « tenue de service » partagé par le croupier et le barman. */
  async _prepareUniform() {
    const base = this.kits[0].container.materials[0];
    if (!base) return;
    try {
      const tex = await uniformTexture(this.scene, base);
      if (!tex) return;
      const m = base.clone("uniformMat");
      m.albedoTexture = tex;
      if ("albedoColor" in m) m.albedoColor = C3(1, 1, 1);
      m.metallic = 0; m.roughness = 0.72;
      this.uniformMat = m;
    } catch (e) { console.warn("tenue de service indisponible", e); }
  }

  constructor(scene, world, kits) {
    this.scene = scene;
    this.world = world;
    this.kits = kits;
    this.list = [];
    this.hasMale = kits.some((k) => k.male);
    for (const k of kits) {
      const root = k.container.meshes.find((m) => m.name === "__root__") || k.container.meshes[0];
      root.computeWorldMatrix(true);
      const bb = root.getHierarchyBoundingVectors();
      k.raw = Math.max(0.001, bb.max.y - bb.min.y);
    }
    scene.onAfterAnimationsObservable.add(() => {
      const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
      for (const n of this.list) n._pose(dt);
    });
  }

  /** @param {object} o {sex:'m'|'f', seated, seatY, uniform, role:'dealer'|'bar', height} */
  spawn(pos, faceY, o = {}) {
    const scene = this.scene;
    // le personnel a son propre modèle ; les clients ne le portent jamais
    const pool = o.avatar
      ? this.kits.filter((k) => k.avatar)
      : o.role
        ? this.kits.filter((k) => k.staff === o.role)
        : (o.sex === "m" && this.hasMale
          ? this.kits.filter((k) => k.male && !k.staff && !k.avatar)
          : this.kits.filter((k) => !k.staff && !k.avatar && (o.sex !== "f" || !k.male)));
    const kit = pick(pool.length ? pool : this.kits.filter((k) => !k.staff && !k.avatar));
    const ent = kit.container.instantiateModelsToScene((n) => n, true, { doNotInstantiate: true });
    const model = ent.rootNodes[0];

    // IMPORTANT : le nœud __root__ porte la conversion d'espace du chargeur
    // glTF (retournement de 180°). L'écraser ferait regarder tout le monde à
    // l'envers — on l'encapsule dans notre propre nœud d'orientation.
    const root = new B.TransformNode("npc", scene);
    root.position.copyFrom(pos);
    root.rotation.y = faceY;
    model.parent = root;

    const height = o.height ?? (kit.staff ? STAFF[kit.staff].height : rnd(1.57, 1.81));
    model.scaling.scaleInPlace(height / kit.raw);
    // Carrure. Les figurants tirent au sort ; le personnel est affiné, parce
    // que les modèles générés sont des hommes bien plus larges d'épaules que le
    // modèle importé : 0,29 m contre 0,22 m mesurés en jeu, soit +35 %, ce qui
    // les faisait paraître hors gabarit à côté des clients.
    const build = (kit.staff || kit.avatar) ? 0.86 : rnd(0.94, 1.07);
    model.scaling.x *= build; model.scaling.z *= build;

    const tint = pick(TINTS);
    for (const m of model.getChildMeshes()) {
      m.receiveShadows = true;
      if (this.world.shadowGens[0]) this.world.shadowGens[0].addShadowCaster(m);
      // le personnel procédural est déjà habillé : ni recoloration d'uniforme
      // (elle est calibrée sur l'atlas du modèle importé) ni teinte aléatoire
      if (kit.staff || kit.avatar) continue;
      if (o.uniform && this.uniformMat) { m.material = this.uniformMat; continue; }
      const mat = m.material;
      if (!mat) continue;
      if ("albedoColor" in mat) mat.albedoColor = tint;
      else if ("baseColor" in mat) mat.baseColor = tint;
      if ("metallic" in mat) mat.metallic = 0;
      if ("roughness" in mat) mat.roughness = 0.8;
    }
    // La pose par défaut des nœuds du glTF est une frame de danse (torse plié,
    // bras levés) : on force la T-pose, figée sur une frame, avant de poser les
    // membres nous-mêmes. Sans ça les figurants sont pliés en deux.
    const rest = ent.animationGroups.find((a) => /t[-_ ]?pose|rest|bind/i.test(a.name));
    if (rest) {
      rest.start(false, 1, rest.from, rest.to, false);
      rest.goToFrame(rest.from);
      rest.pause();
    }
    ent.animationGroups.filter((a) => a !== rest).forEach((a) => a.stop());

    const npc = new NPC(this, root, model, ent, o, height);
    npc._lowerArms();
    // posture de métier, prise APRÈS la descente des bras : elle sert de base
    // aux micro-animations de `_pose`
    if (!o.seated && o.role === "dealer") npc._dealerStance();
    else if (!o.seated && o.role === "bar") npc._barStance();
    // Les modèles de personnel dédiés sont déjà habillés (gilet, nœud papillon,
    // tablier) : l'habillage procédural ferait doublon. Il ne sert que quand on
    // est retombé sur le mannequin de repli.
    if (o.uniform && !(kit.staff && kit.url.endsWith(".glb"))) {
      npc._outfit(faceY, o.role || "dealer");
    }
    if (o.seated) npc._sit(o.seatY ?? pos.y);
    this.list.push(npc);
    return npc;
  }
}

class NPC {
  constructor(people, root, model, ent, opts, height) {
    this.people = people; this.root = root; this.model = model; this.ent = ent;
    this.opts = opts; this.height = height;
    this.seated = !!opts.seated;
    this._t = rnd(0, 100);
    this._gesture = 0;
    this._gestureMax = 1;
    this.skel = ent.skeletons[0];
    this.skinned = model.getChildMeshes().find((m) => m.skeleton) || model.getChildMeshes()[0];

    // Le squelette glTF est piloté par une hiérarchie de TransformNodes (un par
    // os), résolus par nom À L'INTÉRIEUR de l'instance : l'accesseur d'os
    // pointerait sur le modèle source partagé par toutes les instances.
    this._nodes = [];
    for (const n of root.getDescendants(false)) {
      if (n.getClassName && n.getClassName() === "TransformNode") this._nodes.push(n);
    }
    this.node = (suffix) => this._nodes.find((n) => n.name.endsWith(suffix)) || null;

    // ---- clips d'animation propres à CETTE instance ----
    // `instantiateModelsToScene` clone les groupes d'animation, donc chaque
    // figurant peut jouer le sien sans perturber les autres.
    this.clips = new Map();
    for (const g of ent.animationGroups || []) {
      this.clips.set(g.name.toLowerCase(), g);
    }
    this.current = null;
    // os réellement pilotés par le clip en cours : les seuls pour lesquels
    // `_pose` doit partir de la pose animée plutôt que de la pose figée
    this._driven = new Set();

    this.head = this.node("Head");
    this.spine = this.node("Spine1");
    this.rArm = this.node("RightArm");
    this.rFore = this.node("RightForeArm");
    this.lArm = this.node("LeftArm");
    this.lFore = this.node("LeftForeArm");
    this.stance = opts.role || null;      // 'dealer' | 'bar' : posture de métier
    this._base = new Map();
    this._sync();
    this._snapshot();
  }

  _sync() {
    this.root.computeWorldMatrix(true);
    for (const n of this.root.getDescendants(false)) {
      if (n.computeWorldMatrix) n.computeWorldMatrix(true);
    }
    if (this.skel) {
      if (this.skel.computeAbsoluteMatrices) this.skel.computeAbsoluteMatrices(true);
      else if (this.skel.computeAbsoluteTransforms) this.skel.computeAbsoluteTransforms(true);
    }
  }

  _snapshot() {
    for (const n of [this.head, this.spine, this.rArm, this.rFore, this.lArm, this.lFore]) {
      if (!n) continue;
      this._base.set(n, n.rotationQuaternion
        ? n.rotationQuaternion.clone()
        : B.Quaternion.FromEulerVector(n.rotation || B.Vector3.Zero()));
    }
  }

  /**
   * Oriente `bone` pour que son extrémité `tip` vise le point monde `target`.
   * Même principe que `_lowerArms` : on travaille en monde parce que
   * l'orientation locale des os d'un rig importé n'est jamais garantie.
   */
  _aim(bone, tip, target) {
    if (!bone || !tip) return;
    const o = bone.getAbsolutePosition();
    const v = tip.getAbsolutePosition().subtract(o);
    const w = target.subtract(o);
    if (v.lengthSquared() < 1e-10 || w.lengthSquared() < 1e-10) return;
    v.normalize(); w.normalize();
    const d = clamp(B.Vector3.Dot(v, w), -1, 1);
    if (d > 0.9999) return;
    const axis = B.Vector3.Cross(v, w);
    if (axis.lengthSquared() < 1e-10) return;
    bone.rotate(axis.normalize(), Math.acos(d), B.Space.WORLD);
    this._sync();
  }

  /**
   * Posture de croupier : mains jointes dans le dos, au creux des reins.
   * C'est la position réglementaire entre deux coups — les mains doivent
   * rester visibles et vides, d'où le « clear hands » des vrais casinos.
   */
  _dealerStance() {
    const hips = this.node("Hips");
    if (!hips) return;
    const right = this._rightAxis();
    const fwd = B.Vector3.Cross(right, B.Axis.Y).normalize();
    const h = hips.getAbsolutePosition();
    const S = this.height / 1.78;         // cotes proportionnelles à la taille
    for (const side of ["Left", "Right"]) {
      const s = side === "Left" ? -1 : 1;
      const arm = this.node(side + "Arm");
      const fore = this.node(side + "ForeArm");
      const hand = this.node(side + "Hand");
      if (!arm || !fore || !hand) continue;
      // coude : légèrement en arrière, resserré contre le buste
      this._aim(arm, fore, h
        .add(right.scale(s * 0.165 * S))
        .add(fwd.scale(-0.09 * S))
        .add(new B.Vector3(0, 0.12 * S, 0)));
      // Main : la cible passe DE L'AUTRE CÔTÉ de l'axe du corps. `_aim` ne fait
      // que pointer l'os vers la cible — la main s'arrête à la longueur de
      // l'avant-bras, bien avant. Viser le milieu laissait 18 cm entre les deux
      // mains ; viser au-delà les amène au contact, poignets croisés.
      this._aim(fore, hand, h
        .add(right.scale(s * -0.10 * S))
        .add(fwd.scale(-0.17 * S))
        .add(new B.Vector3(0, 0.06 * S, 0)));
    }
    this._snapshot();
  }

  /** Posture de barman : une main en avant sur le comptoir, l'autre au niveau du buste. */
  _barStance() {
    const hips = this.node("Hips");
    if (!hips) return;
    const right = this._rightAxis();
    const fwd = B.Vector3.Cross(right, B.Axis.Y).normalize();
    const h = hips.getAbsolutePosition();
    const S = this.height / 1.78;
    for (const side of ["Left", "Right"]) {
      const s = side === "Left" ? -1 : 1;
      const arm = this.node(side + "Arm");
      const fore = this.node(side + "ForeArm");
      const hand = this.node(side + "Hand");
      if (!arm || !fore || !hand) continue;
      this._aim(arm, fore, h
        .add(right.scale(s * 0.19 * S))
        .add(fwd.scale(0.02 * S))
        .add(new B.Vector3(0, 0.02 * S, 0)));
      // Mains basses, au-dessus du comptoir : son plateau est à 1,13 m et les
      // hanches sont à ~0,94 m, d'où les ~0,18 m de dénivelé. Elles étaient
      // auparavant à hauteur de poitrine, ce qui le faisait travailler en l'air.
      this._aim(fore, hand, h
        .add(right.scale(s * 0.09 * S))
        .add(fwd.scale(0.34 * S))
        .add(new B.Vector3(0, 0.18 * S, 0)));
    }
    this._snapshot();
  }

  /** Axe « droite » du personnage, déduit de la position réelle des hanches. */
  _rightAxis() {
    const L = this.node("LeftUpLeg"), R = this.node("RightUpLeg");
    let right;
    if (L && R) {
      right = R.getAbsolutePosition().subtract(L.getAbsolutePosition());
      right.y = 0;
    }
    if (!right || right.lengthSquared() < 1e-8) right = this.root.getDirection(B.Axis.X);
    return right.normalize();
  }

  /**
   * Descend les bras le long du corps, quelle que soit la pose de repos du
   * modèle (T-pose, A-pose, bras déjà baissés).
   *
   * L'ancienne version appliquait un pas FIXE de 1,15 rad puis vérifiait le
   * sens. Sur une T-pose ça tombait à peu près juste, mais sur une A-pose à 45°
   * elle dépassait la verticale d'une vingtaine de degrés et enfonçait les bras
   * dans le torse. On calcule donc l'angle exact et son axe.
   */
  _lowerArms() {
    const right = this._rightAxis();
    const fwd = B.Vector3.Cross(right, B.Axis.Y).normalize();
    const DOWN = new B.Vector3(0, -1, 0);
    // on ne descend pas jusqu'à la verticale parfaite : un bras au repos reste
    // légèrement écarté du corps, sinon les mains traversent les cuisses
    const KEEP = 0.86;
    for (const side of ["Left", "Right"]) {
      const sh = this.node(side + "Arm");
      const hand = this.node(side + "ForeArm");
      if (!sh || !hand) continue;

      const v = hand.getAbsolutePosition().subtract(sh.getAbsolutePosition());
      if (v.lengthSquared() < 1e-10) continue;
      v.normalize();
      const d = clamp(B.Vector3.Dot(v, DOWN), -1, 1);
      if (d > 0.97) continue;                   // déjà le long du corps
      let axis = B.Vector3.Cross(v, DOWN);
      // bras exactement à la verticale vers le haut : axe indéterminé, on
      // retombe sur l'axe avant du personnage
      if (axis.lengthSquared() < 1e-8) axis = fwd.clone();
      axis.normalize();
      sh.rotate(axis, Math.acos(d) * KEEP, B.Space.WORLD);
      this._sync();
      // Coude : assis, l'avant-bras doit venir se poser sur la cuisse — sinon
      // les mains pendent sous l'assise. Le sens est vérifié sur la position
      // réelle de la main (l'orientation des os n'est pas garantie).
      const elbow = this.node(side + "ForeArm");
      const wrist = this.node(side + "Hand");
      if (elbow && wrist) {
        const fwdOf = () => {
          const v = wrist.getAbsolutePosition().subtract(elbow.getAbsolutePosition());
          return B.Vector3.Dot(v.normalize(), fwd);
        };
        const amount = this.seated ? 1.45 : 0.3;
        const b0 = fwdOf();
        elbow.rotate(right, amount, B.Space.WORLD);
        this._sync();
        if (fwdOf() < b0) { elbow.rotate(right, -2 * amount, B.Space.WORLD); this._sync(); }
      }
    }
    this._snapshot();
  }

  /** Plie les jambes : cuisses à l'horizontale, tibias verticaux, bassin sur l'assise. */
  _sit(seatY) {
    const L = this.node("LeftUpLeg"), R = this.node("RightUpLeg");
    const LK = this.node("LeftLeg"), RK = this.node("RightLeg");
    const hip = this.node("Hips"), foot = this.node("LeftFoot");
    if (!L || !R) return;
    const right = this._rightAxis();

    const bend = (dir) => {
      for (const [thigh, shin] of [[L, LK], [R, RK]]) {
        thigh.rotate(right, dir * (Math.PI / 2) + rnd(-0.05, 0.05), B.Space.WORLD);
        if (shin) shin.rotate(right, -dir * (Math.PI / 2) + rnd(-0.14, 0.02), B.Space.WORLD);
      }
      this._sync();
    };
    bend(-1);

    // le genou doit partir vers l'avant, sinon on plie à l'envers
    if (foot && hip && LK) {
      const fwd = B.Vector3.Cross(right, B.Axis.Y).normalize();
      const d = LK.getAbsolutePosition().subtract(hip.getAbsolutePosition());
      if (B.Vector3.Dot(d, fwd) < 0) { bend(1); bend(1); }
    }

    if (hip) {
      for (let pass = 0; pass < 3; pass++) {
        const dy = (seatY + 0.04) - hip.getAbsolutePosition().y;
        if (Math.abs(dy) < 0.002) break;
        this.root.position.y += dy;
        this._sync();
      }
      this.debug = {
        hipY: +hip.getAbsolutePosition().y.toFixed(3),
        kneeY: LK ? +LK.getAbsolutePosition().y.toFixed(3) : null,
        footY: foot ? +foot.getAbsolutePosition().y.toFixed(3) : null,
      };
    }
    this._snapshot();
  }

  /**
   * Joue un clip. Sans clip de ce nom, ne fait rien et renvoie false — le
   * personnage garde alors sa pose procédurale, ce qui est le comportement
   * actuel tant qu'aucune animation n'a été importée.
   * @param {string} name  nom du clip, insensible à la casse
   */
  play(name, { loop = true, speed = 1 } = {}) {
    // Les clips joués ici viennent du MÊME fichier que le modèle (personnage
    // Mixamo et ses animations natives) : rig, pose de repos et roulis des os
    // sont cohérents par construction, il n'y a rien à retargeter. Mes essais
    // de transfert depuis un autre rig — pack Unreal, puis Xbot vers Michelle —
    // sortaient anatomiquement faux, articulations à l'envers.
    if (CLIPS_DISABLED) return false;
    const g = this.clips.get(String(name).toLowerCase());
    if (!g) return false;
    if (this.current === g && g.isPlaying) return true;
    // couper TOUS les autres clips de cette instance, pas seulement `current` :
    // un groupe démarré ailleurs (autoplay du chargeur) resterait sinon actif
    for (const other of this.clips.values()) {
      if (other !== g && other.isPlaying) other.stop();
    }
    this.current = g;
    g.speedRatio = speed;
    // Fondu enchaîné : sans ça le passage marche <-> repos est une coupure
    // sèche. Babylon mélange depuis la pose courante quand l'animation a
    // `enableBlending`, il faut l'armer sur chaque cible du groupe.
    for (const ta of g.targetedAnimations || []) {
      if (ta.animation) {
        ta.animation.enableBlending = true;
        ta.animation.blendingSpeed = 0.09;
      }
    }
    g.start(loop, speed);
    // on relève les os que ce clip pilote : eux seuls seront lus « à chaud »
    this._driven = new Set();
    for (const ta of g.targetedAnimations || []) {
      if (ta.target) this._driven.add(ta.target);
    }
    return true;
  }

  stopClip() {
    if (this.current) this.current.stop();
    this.current = null;
    this._driven = new Set();
  }

  /**
   * Micro-animation appliquée APRÈS l'évaluation des animations.
   *
   * Point délicat : cette couche et les clips squelettiques écrivent les mêmes
   * rotations d'os. Pour qu'ils cohabitent, l'offset procédural se compose sur
   * la pose ISSUE DU CLIP quand l'os est piloté par lui, et sur la pose figée
   * (`_base`) sinon. Lire « à chaud » un os que le clip ne touche pas ferait
   * cumuler l'offset à chaque frame et le personnage partirait en vrille.
   */
  _pose(dt) {
    this._t += dt;
    const t = this._t;
    const live = this.current && this.current.isPlaying;
    const apply = (nd, rx, ry, rz) => {
      if (!nd) return;
      const base = (live && this._driven.has(nd))
        ? (nd.rotationQuaternion
          ? nd.rotationQuaternion.clone()
          : B.Quaternion.FromEulerVector(nd.rotation || B.Vector3.Zero()))
        : this._base.get(nd);
      if (!base) return;
      const out = base.multiply(B.Quaternion.RotationYawPitchRoll(ry, rx, rz));
      if (nd.rotationQuaternion) nd.rotationQuaternion.copyFrom(out);
      else nd.rotationQuaternion = out;
    };
    apply(this.spine, Math.sin(t * 1.5) * 0.022, Math.sin(t * 0.31) * 0.05, 0);
    let ry = Math.sin(t * 0.37 + 1.2) * 0.2 + Math.sin(t * 0.11) * 0.14;
    if (this.lookAt) {
      const d = this.lookAt.subtract(this.root.position);
      const want = Math.atan2(d.x, d.z) - this.root.rotation.y;
      ry = clamp(want, -0.9, 0.9) * 0.55 + ry * 0.45;
    }
    apply(this.head, Math.sin(t * 0.8) * 0.05, ry, Math.sin(t * 0.6) * 0.03);

    // ---- barman : il astique un verre ----
    // La main GAUCHE tient le verre et ne bouge pas ; seule la droite frotte,
    // vite et sur une faible amplitude. La version précédente faisait osciller
    // les deux bras en cadence AVEC un pivot de buste : ça donnait un déhanché
    // de danseur, pas un geste de travail. Le buste garde donc sa seule
    // respiration par défaut, appliquée plus haut.
    if (this.stance === "bar") {
      const w = Math.sin(t * 3.6);
      apply(this.rFore, w * 0.09, w * 0.14, 0);
      apply(this.rArm, w * 0.025, 0, 0);
    }

    // Geste ponctuel des figurants. Le CROUPIER en est exclu : il garde ses
    // mains dans le dos en permanence. Le mouvement de distribution existait
    // mais ne convainquait pas, il a été retiré à la demande.
    if (this._gesture > 0 && this.stance !== "dealer") {
      this._gesture -= dt;
      // rampe douce 0 -> 1 -> 0 sur toute la durée du geste
      const prog = 1 - Math.max(0, this._gesture) / (this._gestureMax || 1);
      const k = Math.sin(clamp(prog, 0, 1) * Math.PI);
      apply(this.rArm, -k * 0.5, 0, 0);
      apply(this.rFore, -k * 0.7, 0, 0);
    }
  }

  /**
   * Ancre un accessoire sur un os. L'orientation des os d'un rig glTF étant
   * arbitraire, on exprime la pose voulue en MONDE puis on la ramène dans
   * l'espace local de l'os. L'échelle héritée est annulée : toutes les cotes
   * de la tenue sont mesurées sur le squelette, donc déjà en unités monde.
   */
  _attach(bone, holder, worldPos, faceY) {
    const wm = bone.getWorldMatrix();
    holder.parent = bone;
    holder.position = B.Vector3.TransformCoordinates(worldPos, wm.clone().invert());
    const q = new B.Quaternion(), sc = new B.Vector3();
    wm.decompose(sc, q, undefined);
    holder.rotationQuaternion = B.Quaternion.Inverse(q)
      .multiply(B.Quaternion.RotationYawPitchRoll(faceY, 0, 0));
    holder.scaling = new B.Vector3(1 / (sc.x || 1), 1 / (sc.y || 1), 1 / (sc.z || 1));
  }

  /**
   * Tenue de service, entièrement construite en 3D par-dessus le corps.
   * Toutes les dimensions sont déduites de la position réelle des os, donc
   * la tenue s'adapte à n'importe quel modèle (y compris un futur .glb maison)
   * sans réglage manuel.
   */
  _outfit(faceY, role) {
    const o = OUTFITS[role] || OUTFITS.dealer;
    this._sync();
    const scene = this.people.scene;
    const sg = this.people.world.shadowGens[0];
    const cast = (m) => { if (sg) sg.addShadowCaster(m); m.receiveShadows = true; };

    const neck = this.node("Neck") || this.node("Spine2");
    const hips = this.node("Hips");
    const spine = this.node("Spine1") || this.node("Spine") || neck;
    if (!neck || !hips || !spine) return;

    const neckP = neck.getAbsolutePosition(), hipP = hips.getAbsolutePosition();
    const torsoH = Math.max(0.18, neckP.y - hipP.y);
    const lArm = this.node("LeftArm"), rArm = this.node("RightArm");
    // ATTENTION : l'écart entre les os d'épaule est celui des ARTICULATIONS
    // (~0,21 m sur un modèle de 1,76 m), pas la largeur du buste. Tout le
    // vêtement se dimensionne sur `chestW`, sinon le corps déborde du gilet.
    const jointW = (lArm && rArm)
      ? B.Vector3.Distance(lArm.getAbsolutePosition(), rArm.getAbsolutePosition())
      : torsoH * 0.72;
    const chestW = jointW * 1.62;
    const chestD = chestW * 0.62;      // le torse est ovale, pas rond

    // Métrique de référence pour les accessoires : la TÊTE. L'écart d'épaules
    // et la longueur du buste varient du simple au double d'un rig à l'autre
    // (0,21 m d'épaules sur le modèle importé, 0,37 m sur le personnel bâti
    // ici) ; la tête, elle, fait la même taille partout à hauteur égale.
    const headNode = this.node("Head"), topNode = this.node("HeadTop_End");
    const headH = (headNode && topNode)
      ? Math.max(0.08, topNode.getAbsolutePosition().y - headNode.getAbsolutePosition().y)
      : torsoH * 0.55;

    /* ---------------- gilet ---------------- */
    // Désactivé par défaut : un solide de révolution ne peut pas épouser un
    // corps stylisé (la poitrine traverse le cylindre, la silhouette fait
    // « caisse »). La recoloration d'uniforme habille déjà le corps ; le rôle
    // est porté par les accessoires. Repasser `body: true` avec un modèle au
    // buste plus neutre.
    if (o.body) {
    if (!this.people._vestMats) this.people._vestMats = new Map();
    let vestMat = this.people._vestMats.get(role);
    if (!vestMat) {
      vestMat = new B.PBRMetallicRoughnessMaterial("vestM" + role, scene);
      vestMat.baseTexture = vestTexture(scene, o);
      vestMat.metallic = 0; vestMat.roughness = 0.74;
      this.people._vestMats.set(role, vestMat);
    }
    const vestH = torsoH * 0.96;
    // le canvas se lit à l'endroit et l'avant du personnage tombe au centre :
    // faceUV[1] inverse v (haut du canvas -> haut du cylindre) et décale u d'un
    // quart de tour (l'avant d'un cylindre Babylon est à u = 0.75).
    const flat = new B.Vector4(0.02, 0.52, 0.04, 0.54);   // pastille unie pour les capuchons
    const vest = B.MeshBuilder.CreateCylinder("vest", {
      height: vestH, diameterTop: chestW, diameterBottom: chestW * 0.90,
      tessellation: 26, cap: B.Mesh.CAP_ALL,
      faceUV: [flat, new B.Vector4(-0.25, 1, 0.75, 0), flat],
    }, scene);
    vest.material = vestMat;
    vest.scaling.z = chestD / chestW;
    cast(vest);
    const holder = new B.TransformNode("vestHolder", scene);
    vest.parent = holder;
    const mid = neckP.add(hipP).scale(0.5);
    this._attach(spine, holder,
      new B.Vector3(mid.x, hipP.y + vestH * 0.5 + torsoH * 0.06, mid.z), faceY);
    }

    /* ---------------- manchettes ---------------- */
    if (o.garters) {
      for (const side of ["Left", "Right"]) {
        const arm = this.node(side + "Arm"), fore = this.node(side + "ForeArm");
        if (!arm || !fore) continue;
        const a = arm.getAbsolutePosition(), f = fore.getAbsolutePosition();
        const g = B.MeshBuilder.CreateTorus("garter", {
          diameter: jointW * 0.38, thickness: jointW * 0.058, tessellation: 14,
        }, scene);
        g.material = gold(scene, 0.9);
        cast(g);
        const gh = new B.TransformNode("garterH", scene);
        g.parent = gh;
        // à mi-biceps, dans le plan perpendiculaire au bras
        const dir = f.subtract(a);
        const axis = B.Vector3.Cross(B.Axis.Y, dir.clone().normalize());
        if (axis.lengthSquared() > 1e-6) {
          g.rotationQuaternion = B.Quaternion.RotationAxis(
            axis.normalize(),
            Math.acos(clamp(B.Vector3.Dot(B.Axis.Y, dir.clone().normalize()), -1, 1)));
        }
        this._attach(arm, gh, a.add(dir.scale(0.42)), faceY);
      }
    }

    /* ---------------- visière de croupier ---------------- */
    const head = this.node("Head");
    if (o.visor && head) {
      const headP = head.getAbsolutePosition();
      // rayon réel du crâne, pas son diamètre : le bec doit PARTIR de la surface
      const skullR = headH * 0.40;

      const vh = new B.TransformNode("visorH", scene);
      const bandMat = new B.PBRMetallicRoughnessMaterial("visorBand", scene);
      bandMat.baseColor = C3(0.05, 0.05, 0.07); bandMat.roughness = 0.6; bandMat.metallic = 0;
      const band = B.MeshBuilder.CreateTorus("visorBand", {
        diameter: skullR * 2.12, thickness: skullR * 0.30, tessellation: 20,
      }, scene);
      band.parent = vh; band.material = bandMat;
      band.scaling.z = 0.88; band.position.y = headH * 0.44;   // sur le front
      cast(band);

      // bec vert, assemblé en éventail de facettes (comme les rebords physiques
      // de la table : plus sûr qu'un arc de cylindre). Chaque facette est posée
      // au-delà du crâne pour que le bec dépasse au lieu de traverser le visage.
      const visMat = new B.PBRMetallicRoughnessMaterial("visorM", scene);
      visMat.baseColor = C3(0.05, 0.36, 0.19); visMat.roughness = 0.28; visMat.metallic = 0;
      visMat.alpha = 0.85; visMat.transparencyMode = 2;
      const N = 9, SPAN = 2.0, DEPTH = skullR * 1.25;
      for (let i = 0; i < N; i++) {
        const a = -SPAN / 2 + (i + 0.5) * (SPAN / N);
        const d = skullR * 0.92 + DEPTH * 0.5 - skullR * 0.22;
        const f = B.MeshBuilder.CreateBox("visor", {
          width: (SPAN / N) * skullR * 2.3, height: skullR * 0.11, depth: DEPTH,
        }, scene);
        f.parent = vh; f.material = visMat;
        f.position.set(Math.sin(a) * d * 0.86, headH * 0.40, Math.cos(a) * d);
        f.rotation.y = a;
        f.rotation.x = 0.55;                      // le bec plonge vers les cartes
        cast(f);
      }
      this._attach(head, vh, headP, faceY);
    }

    // le nœud doit ressortir DEVANT le buste, sinon il est noyé dedans
    this._bowTie(faceY, headH * 0.42, headH * 0.46);
  }

  /** Nœud papillon accroché à l'os du cou. */
  _bowTie(faceY, fwd = 0.085, span = 0.1) {
    const neck = this.node("Neck") || this.node("Spine2");
    if (!neck) return;
    this._sync();
    const scene = this.people.scene;
    const mat = new B.PBRMetallicRoughnessMaterial("bowM", scene);
    mat.baseColor = C3(0.06, 0.02, 0.03); mat.roughness = 0.78; mat.metallic = 0;

    const holder = new B.TransformNode("bowHolder", scene);
    for (const s of [-1, 1]) {
      const w = B.MeshBuilder.CreateCylinder("bow", {
        height: span * 0.5, diameterTop: span * 0.55, diameterBottom: span * 0.18,
        tessellation: 10,
      }, scene);
      w.parent = holder; w.material = mat;
      w.position.x = s * span * 0.34; w.rotation.z = s * Math.PI / 2;
      if (this.people.world.shadowGens[0]) this.people.world.shadowGens[0].addShadowCaster(w);
    }
    const knot = B.MeshBuilder.CreateSphere("knot", { diameter: span * 0.17, segments: 8 }, scene);
    knot.parent = holder; knot.material = mat;

    // position voulue : devant la base du cou, en avant du gilet
    const nw = neck.getAbsolutePosition();
    const dir = new B.Vector3(Math.sin(faceY), 0, Math.cos(faceY));
    this._attach(neck, holder,
      nw.add(dir.scale(fwd)).add(new B.Vector3(0, 0.02, 0)), faceY);
  }

  tick(dt, lookAt) { this.lookAt = lookAt || null; }
  gesture(d = 0.9) { this._gesture = d; this._gestureMax = d; }
  dispose() {
    this.root.dispose(false, true);
    const i = this.people.list.indexOf(this);
    if (i >= 0) this.people.list.splice(i, 1);
  }
}
