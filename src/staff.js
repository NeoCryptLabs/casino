/**
 * Personnel du casino construit en primitives — croupier et barman.
 *
 * Le reste du décor est procédural ; les figurants ne l'étaient pas, faute de
 * modèle. Résultat : tout le monde était le même personnage importé. Ces deux-là
 * sont donc bâtis ici, avec une hiérarchie d'os aux noms Mixamo (`...Hips`,
 * `...LeftUpLeg`, `...Neck`…) : `npc.js` résout ses os PAR SUFFIXE, donc
 * `_lowerArms`, `_sit`, `_pose`, `gesture` et `_outfit` fonctionnent tels quels.
 *
 * Les membres sont des primitives rigides parentées aux nœuds d'os — pas de
 * skinning : c'est suffisant pour une silhouette stylisée et ça évite un
 * squelette à peaufiner.
 */
import { C3, pbr, gold, rnd } from "./util.js";
const B = BABYLON;

/** Habillage par rôle. Le gilet est la seule vraie différence de lecture. */
export const STAFF = {
  dealer: {
    vest: C3(0.055, 0.055, 0.075), trouser: C3(0.05, 0.05, 0.065),
    shirt: C3(0.93, 0.92, 0.87), skin: C3(0.66, 0.48, 0.36),
    hair: C3(0.10, 0.08, 0.07), height: 1.78, build: 1.0,
  },
  bar: {
    vest: C3(0.34, 0.06, 0.11), trouser: C3(0.07, 0.07, 0.08),
    shirt: C3(0.95, 0.94, 0.90), skin: C3(0.80, 0.62, 0.48),
    hair: C3(0.22, 0.14, 0.08), height: 1.82, build: 1.06,
  },
};

/**
 * Construit un personnage dans un AssetContainer, prêt pour
 * `instantiateModelsToScene` comme n'importe quel modèle importé.
 *
 * Le personnage est bâti pour une taille de 1 m (npc.js le remet à l'échelle
 * voulue), debout, BRAS LE LONG DU CORPS : c'est le cas où `_lowerArms` n'a
 * aucune correction à appliquer.
 */
export function buildStaffKit(scene, role) {
  const S = STAFF[role] || STAFF.dealer;
  const container = new B.AssetContainer(scene);
  const keep = (m) => { container.meshes.push(m); return m; };
  const node = (name, parent, x, y, z) => {
    const t = new B.TransformNode(name, scene);
    t.parent = parent; t.position.set(x, y, z);
    container.transformNodes.push(t);
    return t;
  };

  const mats = {
    skin: pbr("stSkin" + role, scene, { color: S.skin, roughness: 0.62 }),
    shirt: pbr("stShirt" + role, scene, { color: S.shirt, roughness: 0.68 }),
    vest: pbr("stVest" + role, scene, { color: S.vest, roughness: 0.55 }),
    trouser: pbr("stTrou" + role, scene, { color: S.trouser, roughness: 0.72 }),
    hair: pbr("stHair" + role, scene, { color: S.hair, roughness: 0.85 }),
    shoe: pbr("stShoe" + role, scene, { color: C3(0.04, 0.04, 0.05), roughness: 0.3, metallic: 0.15 }),
  };
  Object.values(mats).forEach((m) => container.materials.push(m));

  // Le conteneur doit exposer un maillage nommé `__root__` : npc.js s'en sert
  // pour mesurer la taille du modèle (comme sur un glTF importé).
  const root = new B.Mesh("__root__", scene);
  keep(root);
  container.rootNodes.push(root);

  // proportions en fractions de la taille totale (canon ~7,5 têtes)
  const H = 1.0, W = S.build;
  const hipY = 0.52 * H, chestY = 0.72 * H, neckY = 0.82 * H, headY = 0.87 * H;
  const shoulderX = 0.105 * H * W;

  /* ---------------- chaîne vertébrale ---------------- */
  const hips = node("mixamorig:Hips", root, 0, hipY, 0);
  const spine = node("mixamorig:Spine", hips, 0, 0.06 * H, 0);
  const spine1 = node("mixamorig:Spine1", spine, 0, 0.07 * H, 0);
  const spine2 = node("mixamorig:Spine2", spine1, 0, 0.07 * H, 0);
  const neck = node("mixamorig:Neck", spine2, 0, 0.06 * H, 0);
  const head = node("mixamorig:Head", neck, 0, 0.05 * H, 0);
  node("mixamorig:HeadTop_End", head, 0, 0.13 * H, 0);

  /* ---------------- bassin / jambes ---------------- */
  const pelvis = keep(B.MeshBuilder.CreateCylinder("pelvis", {
    height: 0.13 * H, diameterTop: 0.21 * H * W, diameterBottom: 0.20 * H * W, tessellation: 18,
  }, scene));
  pelvis.parent = hips; pelvis.position.y = -0.02 * H;
  pelvis.scaling.z = 0.7; pelvis.material = mats.trouser;

  for (const side of ["Left", "Right"]) {
    const s = side === "Left" ? 1 : -1;
    const up = node(`mixamorig:${side}UpLeg`, hips, s * 0.048 * H * W, -0.06 * H, 0);
    const lo = node(`mixamorig:${side}Leg`, up, 0, -0.23 * H, 0);
    const ft = node(`mixamorig:${side}Foot`, lo, 0, -0.23 * H, 0);

    const thigh = keep(B.MeshBuilder.CreateCylinder("thigh", {
      height: 0.235 * H, diameterTop: 0.098 * H * W, diameterBottom: 0.082 * H * W, tessellation: 14,
    }, scene));
    thigh.parent = up; thigh.position.y = -0.115 * H; thigh.material = mats.trouser;

    const shin = keep(B.MeshBuilder.CreateCylinder("shin", {
      height: 0.235 * H, diameterTop: 0.082 * H * W, diameterBottom: 0.062 * H * W, tessellation: 14,
    }, scene));
    shin.parent = lo; shin.position.y = -0.115 * H; shin.material = mats.trouser;

    const shoe = keep(B.MeshBuilder.CreateBox("shoe", {
      width: 0.072 * H * W, height: 0.042 * H, depth: 0.15 * H,
    }, scene));
    shoe.parent = ft; shoe.position.set(0, -0.018 * H, 0.032 * H); shoe.material = mats.shoe;
  }

  /* ---------------- buste : chemise puis gilet ---------------- */
  // la chemise dépasse au col et sous le gilet
  const shirt = keep(B.MeshBuilder.CreateCylinder("shirt", {
    height: 0.30 * H, diameterTop: 0.205 * H * W, diameterBottom: 0.195 * H * W, tessellation: 20,
  }, scene));
  shirt.parent = spine; shirt.position.y = 0.09 * H;
  shirt.scaling.z = 0.68; shirt.material = mats.shirt;

  // gilet : légèrement plus large, plus court, ouvert en V par une encoche
  const vest = keep(B.MeshBuilder.CreateCylinder("vest", {
    height: 0.245 * H, diameterTop: 0.222 * H * W, diameterBottom: 0.212 * H * W, tessellation: 20,
  }, scene));
  vest.parent = spine; vest.position.y = 0.072 * H;
  vest.scaling.z = 0.70; vest.material = mats.vest;

  // encoche en V : deux prismes clairs plaqués sur le devant du gilet
  for (const s of [-1, 1]) {
    const rev = keep(B.MeshBuilder.CreateBox("lapel", {
      width: 0.052 * H * W, height: 0.15 * H, depth: 0.012 * H,
    }, scene));
    rev.parent = spine;
    rev.position.set(s * 0.034 * H * W, 0.135 * H, 0.076 * H * W);
    rev.rotation.z = s * 0.30;
    rev.material = mats.shirt;
  }
  // épaules : deux boules pour arrondir la jonction bras/buste
  for (const s of [-1, 1]) {
    const sh = keep(B.MeshBuilder.CreateSphere("shoulderPad", {
      diameter: 0.088 * H * W, segments: 10,
    }, scene));
    sh.parent = spine2; sh.position.set(s * shoulderX, 0.028 * H, 0);
    sh.scaling.z = 0.85; sh.material = mats.vest;
  }

  /* ---------------- bras, le long du corps ---------------- */
  for (const side of ["Left", "Right"]) {
    const s = side === "Left" ? 1 : -1;
    const sho = node(`mixamorig:${side}Shoulder`, spine2, s * 0.035 * H, 0.028 * H, 0);
    const arm = node(`mixamorig:${side}Arm`, sho, s * (shoulderX - 0.035 * H), 0, 0);
    const fore = node(`mixamorig:${side}ForeArm`, arm, 0, -0.155 * H, 0);
    const hand = node(`mixamorig:${side}Hand`, fore, 0, -0.145 * H, 0);

    const upper = keep(B.MeshBuilder.CreateCylinder("upperArm", {
      height: 0.155 * H, diameterTop: 0.062 * H * W, diameterBottom: 0.05 * H * W, tessellation: 12,
    }, scene));
    upper.parent = arm; upper.position.y = -0.078 * H; upper.material = mats.shirt;

    const lower = keep(B.MeshBuilder.CreateCylinder("foreArm", {
      height: 0.145 * H, diameterTop: 0.05 * H * W, diameterBottom: 0.042 * H * W, tessellation: 12,
    }, scene));
    lower.parent = fore; lower.position.y = -0.072 * H; lower.material = mats.shirt;

    const palm = keep(B.MeshBuilder.CreateBox("hand", {
      width: 0.045 * H * W, height: 0.085 * H, depth: 0.026 * H,
    }, scene));
    palm.parent = hand; palm.position.y = -0.04 * H; palm.material = mats.skin;
  }

  /* ---------------- cou et tête ---------------- */
  const neckM = keep(B.MeshBuilder.CreateCylinder("neck", {
    height: 0.05 * H, diameter: 0.055 * H * W, tessellation: 12,
  }, scene));
  neckM.parent = neck; neckM.position.y = 0.018 * H; neckM.material = mats.skin;

  const skull = keep(B.MeshBuilder.CreateSphere("head", {
    diameter: 0.125 * H, segments: 16,
  }, scene));
  skull.parent = head; skull.position.y = 0.055 * H;
  skull.scaling.set(0.92, 1.14, 1.0); skull.material = mats.skin;

  // mâchoire, pour que le profil ne soit pas une boule
  const jaw = keep(B.MeshBuilder.CreateBox("jaw", {
    width: 0.072 * H, height: 0.05 * H, depth: 0.078 * H,
  }, scene));
  jaw.parent = head; jaw.position.set(0, 0.026 * H, 0.012 * H);
  jaw.material = mats.skin;

  // cheveux : calotte plaquée, décalée vers l'arrière
  const hair = keep(B.MeshBuilder.CreateSphere("hair", {
    diameter: 0.131 * H, segments: 16, slice: 0.62,
  }, scene));
  hair.parent = head; hair.position.set(0, 0.056 * H, -0.006 * H);
  hair.scaling.set(0.94, 1.06, 1.02); hair.material = mats.hair;

  const brow = keep(B.MeshBuilder.CreateBox("brow", {
    width: 0.085 * H, height: 0.012 * H, depth: 0.02 * H,
  }, scene));
  brow.parent = head; brow.position.set(0, 0.062 * H, 0.055 * H);
  brow.material = mats.hair;

  container.meshes.forEach((m) => { m.isPickable = false; });
  container.removeAllFromScene();
  return container;
}
