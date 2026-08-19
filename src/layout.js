/**
 * Le plan du casino comme DONNÉE.
 *
 * Trois couches, appliquées dans cet ordre au démarrage :
 *   1. LAYOUT (world.js) — les valeurs par défaut, écrites en dur ;
 *   2. les ancres d'un éventuel assets/world.glb : des Empties Blender
 *      nommées `anchor.blackjack`, `anchor.bar`, `anchor.spawn`… ;
 *   3. assets/layout.json, écrit par le mode éditeur (F2) — il gagne toujours.
 *
 * layout.json n'est PAS un format de scène : c'est un calque de SURCHARGES
 * posé sur le monde que le code construit. Chaque entrée déplace, tourne,
 * redimensionne ou cache un mesh existant, identifié par `nom#occurrence`
 * (l'ordre de construction est déterministe, l'identifiant aussi). On ne crée
 * donc rien ici — la géométrie nouvelle, c'est le rôle de world.glb.
 *
 * world.glb, lui, est de la géométrie AJOUTÉE au monde : modélisée dans
 * Blender, exportée en glTF, chargée telle quelle. Conventions de nommage :
 *   - `anchor.<clé>`  Empty : déplace l'ancre LAYOUT correspondante
 *                     (blackjack, fountain, spawn, bar, slots) ;
 *   - `phys.*`        le mesh reçoit un corps physique statique Havok ;
 *   - tout mesh       bloque le joueur (collisions caméra) et reçoit les ombres.
 */
const B = () => BABYLON;   // accès paresseux : les fonctions pures n'y touchent pas

/* ------------------------------------------------------------------ réseau */

const EMPTY = () => ({ anchors: {}, overrides: {}, clones: [], cameras: {}, poses: {} });

export async function fetchLayout() {
  try {
    const r = await fetch("/api/layout", { cache: "no-store" });
    if (!r.ok) return EMPTY();
    const j = await r.json();
    return {
      anchors: j.anchors || {},
      overrides: j.overrides || {},
      clones: Array.isArray(j.clones) ? j.clones : [],
      // acteurs-caméras posés dans le monde (vue de table…) — voir main.js
      cameras: j.cameras && typeof j.cameras === "object" ? j.cameras : {},
      // poses de figurants (mode pose de l'éditeur) — voir pose.js / npc.js
      poses: j.poses && typeof j.poses === "object" ? j.poses : {},
    };
  } catch {
    // pas de serveur (jeu ouvert en statique) : on joue avec le plan par défaut
    return EMPTY();
  }
}

export async function saveLayout(layout) {
  const r = await fetch("/api/layout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(layout, null, 2),
  });
  if (!r.ok) throw new Error("sauvegarde refusée (" + r.status + ")");
}

/* ------------------------------------------------------------------ ancres */

/**
 * Applique des ancres sur LAYOUT, en place. Deux formes acceptées :
 *   - [x, y, z] pour les entrées Vector3 (blackjack, fountain, spawn) —
 *     une composante non finie est ignorée (l'ancienne valeur reste) ;
 *   - objet partiel pour les entrées composées (bar {x,z,w}, slots {x0,z0…}) —
 *     seules les clés déjà présentes ET numériques sont retenues.
 */
export function applyAnchors(LAYOUT, anchors) {
  for (const [k, v] of Object.entries(anchors || {})) {
    const cur = LAYOUT[k];
    if (!cur) continue;
    if (Array.isArray(v)) {
      if (typeof cur.x !== "number" || typeof cur.y !== "number") continue;
      if (Number.isFinite(v[0])) cur.x = v[0];
      if (Number.isFinite(v[1])) cur.y = v[1];
      if (Number.isFinite(v[2])) cur.z = v[2];
    } else if (v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v)) {
        if (typeof cur[kk] === "number" && Number.isFinite(vv)) cur[kk] = vv;
      }
    }
  }
  return LAYOUT;
}

/* --------------------------------------------------------------- surcharges */

/**
 * Identité stable d'un mesh : `nom#occurrence` parmi les meshes de même nom,
 * dans l'ordre de scene.meshes. Les meshes dynamiques (cartes, jetons) portent
 * des noms disjoints de ceux du décor : leurs apparitions ne décalent pas les
 * compteurs des meshes qui nous intéressent.
 */
export function meshIds(scene) {
  const counts = new Map(), ids = new Map();
  for (const m of scene.meshes) {
    const n = counts.get(m.name) || 0;
    counts.set(m.name, n + 1);
    ids.set(m, m.name + "#" + n);
  }
  return ids;
}

/** Pose les surcharges sur les meshes existants. Renvoie le nombre appliqué. */
export function applyOverrides(scene, overrides) {
  if (!overrides || !Object.keys(overrides).length) return 0;
  let applied = 0;
  for (const [m, id] of meshIds(scene)) {
    const o = overrides[id];
    if (!o) continue;
    m.unfreezeWorldMatrix?.();   // le décor est gelé : la surcharge doit prendre
    if (Array.isArray(o.p)) m.position.set(o.p[0], o.p[1], o.p[2]);
    if (Array.isArray(o.r)) { m.rotationQuaternion = null; m.rotation.set(o.r[0], o.r[1], o.r[2]); }
    if (Array.isArray(o.s)) m.scaling.set(o.s[0], o.s[1], o.s[2]);
    if (o.hidden) m.setEnabled(false);
    applied++;
  }
  return applied;
}

/** Photographie la transformation d'un mesh, au format des surcharges. */
export function snapshot(m) {
  const r = m.rotationQuaternion ? m.rotationQuaternion.toEulerAngles() : m.rotation;
  const f = (v) => Math.round(v * 1e4) / 1e4;
  const o = {
    p: [f(m.position.x), f(m.position.y), f(m.position.z)],
    r: [f(r.x), f(r.y), f(r.z)],
    s: [f(m.scaling.x), f(m.scaling.y), f(m.scaling.z)],
  };
  if (!m.isEnabled()) o.hidden = true;
  return o;
}

/* ------------------------------------------------------------------ clones */

/**
 * Objets AJOUTÉS depuis l'éditeur (Ctrl+D) : chaque entrée clone un mesh du
 * décor construit (`src` = son identifiant `nom#occurrence`) et le pose à sa
 * transformation. C'est le « placer des objets » du mode éditeur — dans le
 * vocabulaire du mobilier existant ; la géométrie inédite reste à world.glb.
 *
 * Renvoie la liste [{ mesh, src }] pour que l'éditeur adopte ces clones et
 * puisse les re-déplacer ou les supprimer à la session suivante.
 */
export function applyClones(scene, clones, shadowGen) {
  if (!Array.isArray(clones) || !clones.length) return [];
  const byId = new Map();
  for (const [m, id] of meshIds(scene)) byId.set(id, m);
  const out = [];
  for (const cl of clones) {
    const src = byId.get(cl.src);
    if (!src || !Array.isArray(cl.p)) continue;
    const c = src.clone(src.name + "_c");
    if (!c) continue;
    c.unfreezeWorldMatrix?.();   // le clone d'un mesh gelé hérite du gel
    c.position.set(cl.p[0], cl.p[1], cl.p[2]);
    if (Array.isArray(cl.r)) { c.rotationQuaternion = null; c.rotation.set(cl.r[0], cl.r[1], cl.r[2]); }
    if (Array.isArray(cl.s)) c.scaling.set(cl.s[0], cl.s[1], cl.s[2]);
    try { shadowGen?.addShadowCaster(c); } catch { }
    out.push({ mesh: c, src: cl.src });
  }
  return out;
}

/* --------------------------------------------------------------- world.glb */

/**
 * Charge assets/world.glb s'il existe. HEAD d'abord : son absence est le cas
 * normal, pas une erreur à afficher. Renvoie { anchors, meshes } ou null.
 */
export async function loadWorldGlb(scene) {
  try {
    const head = await fetch("/assets/world.glb", { method: "HEAD" });
    if (!head.ok) return null;
  } catch { return null; }

  const res = await B().SceneLoader.ImportMeshAsync("", "/assets/", "world.glb", scene);
  const anchors = {};
  const nodes = [...(res.transformNodes || []), ...(res.meshes || [])];
  for (const node of nodes) {
    const m = /^anchor[._](\w+)/.exec(node.name);
    if (!m) continue;
    node.computeWorldMatrix(true);
    const p = node.getAbsolutePosition();
    const key = m[1];
    if (key === "bar") anchors.bar = { x: p.x, z: p.z };
    else if (key === "slots") anchors.slots = { x0: p.x, z0: p.z };
    else if (key === "spawn") anchors.spawn = [p.x, p.y < 0.5 ? 1.62 : p.y, p.z];
    else anchors[key] = [p.x, p.y, p.z];
    node.setEnabled(false);          // l'Empty a parlé, il n'a rien à afficher
  }
  return { anchors, meshes: (res.meshes || []).filter((x) => x.isEnabled()) };
}

/** Intègre la géométrie du glb au monde bâti : ombres, collisions, physique. */
export function integrateWorldGlb(glb, scene, world) {
  if (!glb) return;
  for (const m of glb.meshes) {
    if (!m.getTotalVertices || !m.getTotalVertices()) continue;    // __root__…
    m.receiveShadows = true;
    m.checkCollisions = true;        // le joueur ne le traverse pas
    if (world.shadowGens[1]) world.shadowGens[1].addShadowCaster(m);
    if (/^phys[._]/.test(m.name) && scene.getPhysicsEngine()) {
      new (B()).PhysicsAggregate(m, B().PhysicsShapeType.MESH,
        { mass: 0, restitution: 0.2, friction: 0.7 }, scene);
    }
  }
}
