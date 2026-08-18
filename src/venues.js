/**
 * Les zones du handoff « Casino Le Royal Monaco » qui n'existaient pas au
 * Mirage : restaurant, roulettes, caisse de jetons, vestiaire, salon privé VIP.
 *
 * Tout est bâti en procédural (repli permanent) ; quand un glb d'asset libre
 * existe dans assets/ (roulette.glb, dining.glb…), il remplacera la pièce
 * maîtresse correspondante — voir Phase 2 du plan.
 */
import { V3, C3, pbr, gold, canvasTex, rnd } from "./util.js";
import { LAYOUT } from "./world.js";
const B = BABYLON;

/* ------------------------------------------------------------- matériaux */

function mats(scene) {
  return {
    feltGreen: pbr("vFelt", scene, { color: C3(0.06, 0.30, 0.24), roughness: 0.95 }),
    walnut: pbr("vWalnut", scene, { color: C3(0.18, 0.11, 0.07), roughness: 0.35, metallic: 0.05 }),
    walnutD: pbr("vWalnutD", scene, { color: C3(0.11, 0.065, 0.04), roughness: 0.42, metallic: 0.05 }),
    marble: pbr("vMarble", scene, { color: C3(0.82, 0.78, 0.70), roughness: 0.18, metallic: 0.05 }),
    velvet: pbr("vVelvet", scene, { color: C3(0.36, 0.08, 0.15), roughness: 0.85 }),
    linen: pbr("vLinen", scene, { color: C3(0.92, 0.88, 0.80), roughness: 0.9 }),
    brass: gold(scene, 0.85),
    brassSoft: gold(scene, 0.55),
    glass: pbr("vGlass", scene, {
      color: C3(0.75, 0.82, 0.83), roughness: 0.06, metallic: 0.1,
      alpha: 0.2, backFaceCulling: false,
    }),
    dark: pbr("vDark", scene, { color: C3(0.08, 0.06, 0.05), roughness: 0.5, metallic: 0.2 }),
  };
}

/** Enseigne discrète en capitales dorées (émissif + opacité, sans lampe). */
function sign(scene, text, pos, rotY, size = 0.3) {
  const tex = canvasTex("vsign" + text, scene, 1024, 192, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.font = "400 100px 'Georgia',serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = "#c9a227"; c.shadowBlur = 30;
    c.fillStyle = "#e8d9a0";
    // interlettrage à la main : Georgia n'a pas de letterSpacing en canvas
    const chars = text.split("");
    const step = Math.min(96, (w - 120) / chars.length);
    const x0 = w / 2 - step * (chars.length - 1) / 2;
    chars.forEach((ch, i) => c.fillText(ch, x0 + i * step, h / 2));
  }, { alpha: true, flip180: true });
  const p = B.MeshBuilder.CreatePlane("vsign", { width: size * 10.6, height: size * 2 }, scene);
  p.position = pos; p.rotation.y = rotY;
  const m = new B.StandardMaterial("vsignM" + text, scene);
  m.diffuseTexture = tex; m.opacityTexture = tex;
  m.emissiveTexture = tex; m.emissiveColor = C3(1, 1, 1);
  m.disableLighting = true; m.backFaceCulling = false;
  p.material = m;
  p.isPickable = false;
  return p;
}

/* ------------------------------------------------------------- roulette */

/** Tapis de roulette : feutre vert, grille blanche, cases rouges/noires. */
function rouletteFelt(scene) {
  return canvasTex("rouFelt", scene, 1024, 640, (c, w, h) => {
    c.fillStyle = "#0f4d3c"; c.fillRect(0, 0, w, h);
    // la grille des mises occupe la moitié droite ; la gauche reste au feutre
    const gx = w * 0.42, gy = h * 0.18, gw = w * 0.5, gh = h * 0.64;
    c.strokeStyle = "rgba(240,235,220,.85)"; c.lineWidth = 3;
    const cols = 12, rows = 3;
    for (let i = 0; i <= cols; i++) {
      c.beginPath(); c.moveTo(gx + (gw / cols) * i, gy); c.lineTo(gx + (gw / cols) * i, gy + gh); c.stroke();
    }
    for (let j = 0; j <= rows; j++) {
      c.beginPath(); c.moveTo(gx, gy + (gh / rows) * j); c.lineTo(gx + gw, gy + (gh / rows) * j); c.stroke();
    }
    // numéros rouges et noirs
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "700 30px Georgia";
    let n = 1;
    for (let i = 0; i < cols; i++) {
      for (let j = rows - 1; j >= 0; j--) {
        const cx = gx + (gw / cols) * (i + 0.5), cy = gy + (gh / rows) * (j + 0.5);
        const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n);
        c.fillStyle = red ? "rgba(190,40,40,.8)" : "rgba(15,15,18,.8)";
        c.beginPath(); c.arc(cx, cy, 20, 0, 7); c.fill();
        c.fillStyle = "#f0ead8"; c.fillText(String(n), cx, cy + 1);
        n++;
      }
    }
    // le zéro, à gauche de la grille
    c.fillStyle = "rgba(30,110,60,.9)";
    c.beginPath(); c.arc(gx - 34, gy + gh / 2, 26, 0, 7); c.fill();
    c.fillStyle = "#f0ead8"; c.font = "700 34px Georgia"; c.fillText("0", gx - 34, gy + gh / 2 + 1);
  }, { flip180: true });
}

function buildRoulette(scene, world, M, P, idx) {
  const root = new B.TransformNode("roulette" + idx, scene);
  root.position = P.clone();
  // les visuels vivent sous `deco` : si assets/monaco/roulette.glb (modélisé
  // dans Blender) se charge, decorate() jette deco et pose le glb à sa place
  const deco = new B.TransformNode("rouletteDeco" + idx, scene);
  deco.parent = root;

  const add = (m, mat, cast = false) => {
    m.parent = deco; m.material = mat; m.receiveShadows = true;
    if (cast) world.shadowGens.forEach((sg) => sg.addShadowCaster(m));
    return m;
  };

  // plateau ovale r 1,75 (échelle z 0,62) à y 0,86 — l'axe long suit X
  const feltMat = pbr("rouFeltM" + idx, scene, { color: C3(1, 1, 1), roughness: 0.95 });
  feltMat.baseTexture = rouletteFelt(scene);
  const top = add(B.MeshBuilder.CreateCylinder("rouTop", { height: 0.08, diameter: 3.5, tessellation: 48 }, scene), feltMat, true);
  top.position.y = 0.86 - 0.04;
  top.scaling.z = 0.62;
  const rim = add(B.MeshBuilder.CreateTorus("rouRim", { diameter: 3.5, thickness: 0.13, tessellation: 48 }, scene), M.walnut, true);
  rim.position.y = 0.87;
  rim.scaling.z = 0.62;
  const skirt = add(B.MeshBuilder.CreateCylinder("rouSkirt", { height: 0.24, diameter: 3.44, tessellation: 48 }, scene), M.walnut);
  skirt.position.y = 0.70;
  skirt.scaling.z = 0.62;
  const ped = add(B.MeshBuilder.CreateCylinder("rouPed", { height: 0.6, diameterTop: 0.5, diameterBottom: 0.9, tessellation: 24 }, scene), M.walnut);
  ped.position.y = 0.3;

  // le cylindre (la roue), au bout −X du plateau
  const wheelBase = add(B.MeshBuilder.CreateCylinder("rouWheel", { height: 0.10, diameter: 1.24, tessellation: 40 }, scene), M.dark, true);
  wheelBase.position.set(-1.05, 0.92, 0);
  const wheelRim = add(B.MeshBuilder.CreateTorus("rouWheelRim", { diameter: 1.24, thickness: 0.06, tessellation: 40 }, scene), M.brass);
  wheelRim.position.set(-1.05, 0.96, 0);
  const cone = add(B.MeshBuilder.CreateCylinder("rouCone", { height: 0.14, diameterTop: 0.02, diameterBottom: 0.5, tessellation: 24 }, scene), M.brass);
  cone.position.set(-1.05, 1.02, 0);
  // pastilles rouges/noires sur la couronne de la roue
  const slotsMat = pbr("rouSlots" + idx, scene, { color: C3(0.75, 0.12, 0.12), roughness: 0.4 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const chip = B.MeshBuilder.CreateBox("rouChip", { width: 0.09, height: 0.02, depth: 0.16 }, scene);
    chip.parent = deco;
    chip.position.set(-1.05 + Math.cos(a) * 0.48, 0.98, Math.sin(a) * 0.48);
    chip.rotation.y = -a;
    chip.material = i % 2 ? M.dark : slotsMat;
  }

  // collision ovale — indépendante du décor, elle survit au passage au glb
  const col = B.MeshBuilder.CreateCylinder("rouCol", { height: 0.95, diameter: 3.6, tessellation: 24 }, scene);
  col.parent = root; col.position.y = 0.475; col.scaling.z = 0.64;
  col.isVisible = false; col.checkCollisions = true;

  return { root, deco };
}

/* ----------------------------------------------------------- restaurant */

function buildDining(scene, world, M) {
  const { xs, z } = LAYOUT.restaurant;
  const root = new B.TransformNode("dining", scene);
  const flameMat = pbr("vFlame", scene, { color: C3(1, 0.8, 0.4), emissive: C3(1, 0.62, 0.2) });
  // relevés pour decorate() : où sont les chaises, quoi jeter si un glb arrive
  const chairSpecs = [], chairMeshes = [], candleMeshes = [], flames = [];

  for (const x of xs) {
    // table ronde r 1,1 à y 0,78, nappe crème, pied noyer, base laiton
    const top = B.MeshBuilder.CreateCylinder("dnTop", { height: 0.05, diameter: 2.2, tessellation: 40 }, scene);
    top.position = V3(x, 0.78, z); top.material = M.linen; top.parent = root;
    top.receiveShadows = true;
    world.shadowGens.forEach((sg) => sg.addShadowCaster(top));
    const skirtCloth = B.MeshBuilder.CreateCylinder("dnCloth", { height: 0.35, diameterTop: 2.2, diameterBottom: 1.7, tessellation: 40 }, scene);
    skirtCloth.position = V3(x, 0.58, z); skirtCloth.material = M.linen; skirtCloth.parent = root;
    const leg = B.MeshBuilder.CreateCylinder("dnLeg", { height: 0.55, diameter: 0.32, tessellation: 16 }, scene);
    leg.position = V3(x, 0.28, z); leg.material = M.walnut; leg.parent = root;
    const base = B.MeshBuilder.CreateCylinder("dnBase", { height: 0.06, diameter: 1.0, tessellation: 24 }, scene);
    base.position = V3(x, 0.03, z); base.material = M.brass; base.parent = root;

    // bougeoir : fût laiton + flamme émissive
    const stick = B.MeshBuilder.CreateCylinder("dnStick", { height: 0.22, diameterTop: 0.03, diameterBottom: 0.07, tessellation: 12 }, scene);
    stick.position = V3(x, 0.91, z); stick.material = M.brass; stick.parent = root;
    candleMeshes.push(stick);
    const flame = B.MeshBuilder.CreateSphere("dnFlame", { diameter: 0.05, segments: 8 }, scene);
    flame.position = V3(x, 1.05, z); flame.scaling.y = 1.7; flame.material = flameMat; flame.parent = root;
    flames.push(flame);

    // couverts : assiettes et verres devant chaque chaise
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const px = x + Math.cos(a), pz = z + Math.sin(a);
      const plate = B.MeshBuilder.CreateCylinder("dnPlate", { height: 0.015, diameter: 0.26, tessellation: 20 }, scene);
      plate.position = V3(x + Math.cos(a) * 0.72, 0.81, z + Math.sin(a) * 0.72);
      plate.material = M.marble; plate.parent = root;

      // chaise : assise velours, dossier, quatre pieds noyer
      const ca = a;                       // la chaise fait face au centre
      const cx = x + Math.cos(ca) * 1.55, cz = z + Math.sin(ca) * 1.55;
      chairSpecs.push({ x: cx, z: cz, a: ca });
      const seat = B.MeshBuilder.CreateBox("dnSeat", { width: 0.46, height: 0.09, depth: 0.46 }, scene);
      seat.position = V3(cx, 0.46, cz);
      seat.rotation.y = -ca + Math.PI / 2;
      seat.material = M.velvet; seat.parent = root;
      seat.checkCollisions = true;
      world.shadowGens.forEach((sg) => sg.addShadowCaster(seat));
      chairMeshes.push(seat);
      const back = B.MeshBuilder.CreateBox("dnBack", { width: 0.46, height: 0.55, depth: 0.07 }, scene);
      back.position = V3(cx + Math.cos(ca) * 0.21, 0.82, cz + Math.sin(ca) * 0.21);
      back.rotation.y = -ca + Math.PI / 2;
      back.material = M.velvet; back.parent = root;
      chairMeshes.push(back);
      for (const [sx, sz2] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
        const lg = B.MeshBuilder.CreateCylinder("dnChLeg", { height: 0.42, diameter: 0.05, tessellation: 8 }, scene);
        const rx = sx * Math.cos(ca) - sz2 * Math.sin(ca), rz = sx * Math.sin(ca) + sz2 * Math.cos(ca);
        lg.position = V3(cx + rx, 0.21, cz + rz);
        lg.material = M.walnut; lg.parent = root;
        chairMeshes.push(lg);
      }
    }
    // collision de la table
    const col = B.MeshBuilder.CreateCylinder("dnCol", { height: 0.8, diameter: 2.25, tessellation: 16 }, scene);
    col.position = V3(x, 0.4, z); col.isVisible = false; col.checkCollisions = true; col.parent = root;
  }
  sign(scene, "RESTAURANT", V3((xs[0] + xs[3]) / 2, 3.4, LAYOUT.hall.d / 2 - 0.4), Math.PI, 0.34);
  return { root, chairSpecs, chairMeshes, candleMeshes, flames, tables: xs.map((x) => ({ x, z })) };
}

/* ------------------------------------------------------ caisse de jetons */

function buildCashier(scene, world, M, people) {
  const P = LAYOUT.cashier;
  const root = new B.TransformNode("cashier", scene);
  const add = (m, mat, col = false) => {
    m.parent = root; m.material = mat; m.receiveShadows = true;
    if (col) m.checkCollisions = true;
    return m;
  };

  // comptoir 9,4 × 1,15 face à la salle (−Z), plan de marbre — REPLI : le
  // vrai guichet à barreaux (assets/monaco/cashier.glb, modélisé dans
  // Blender) le remplace dans decorate()
  const counter = add(B.MeshBuilder.CreateBox("cashCounter", { width: 9.4, height: 1.05, depth: 1.0 }, scene), M.walnut, true);
  counter.position = V3(P.x, 0.525, P.z);
  const top = add(B.MeshBuilder.CreateBox("cashTop", { width: 9.6, height: 0.08, depth: 1.15 }, scene), M.marble, true);
  top.position = V3(P.x, 1.09, P.z);

  // dosseret laiton 9,4 × 3,4 derrière la caisse
  const back = add(B.MeshBuilder.CreateBox("cashBack", { width: 9.4, height: 3.4, depth: 0.25 }, scene), M.brassSoft, true);
  back.position = V3(P.x, 1.7, P.z + 1.6);
  const signPlane = sign(scene, "CAISSE", V3(P.x, 2.75, P.z + 1.45), Math.PI, 0.3);
  const procMeshes = [counter, top, back];

  // quatre séparations de guichet + piles de jetons
  const chipCols = [C3(0.8, 0.15, 0.15), C3(0.12, 0.35, 0.7), C3(0.1, 0.5, 0.25), C3(0.85, 0.7, 0.2)];
  for (let i = 0; i < 4; i++) {
    const x = P.x - 3.5 + i * 2.35;
    const sep = add(B.MeshBuilder.CreateBox("cashSep", { width: 0.06, height: 0.5, depth: 0.9 }, scene), M.brass);
    sep.position = V3(x + 1.17, 1.4, P.z);
    procMeshes.push(sep);
    const mat = pbr("chipPile" + i, scene, { color: chipCols[i], roughness: 0.4 });
    for (let k = 0; k < 6; k++) {
      const c = B.MeshBuilder.CreateCylinder("cashChips", { height: 0.035, diameter: 0.34, tessellation: 20 }, scene);
      c.position = V3(x + rnd(-0.06, 0.06), 1.15 + k * 0.037, P.z + rnd(-0.05, 0.05));
      c.rotation.y = rnd(0, 3);
      c.material = mat; c.parent = root;
      // piles décor du REPLI : elles doivent partir avec lui — le glb a les
      // siennes, et celles-ci font 34 cm de diamètre posées sur son marbre
      procMeshes.push(c);
    }
  }

  // lampe de guichet (émissif) sous le dosseret
  const lampMat = pbr("cashGlow", scene, { color: C3(1, 0.8, 0.5), emissive: C3(0.9, 0.55, 0.2) });
  const strip = add(B.MeshBuilder.CreateBox("cashStrip", { width: 9.0, height: 0.06, depth: 0.06 }, scene), lampMat);
  strip.position = V3(P.x, 3.32, P.z + 1.42);
  procMeshes.push(strip);

  // LE CAISSIER — kit du barman en attendant un modèle dédié (voir plan).
  // Face à la salle (−Z ; yaw 0 = −Z, cf. bar.js), DANS le couloir de service
  // du cashier.glb (mesuré à la sonde : caisson jusqu'à P.z+0,20, marbre y 1,13
  // jusqu'à +0,30, dosseret à +0,41). À +0,36 son ventre touche le rebord du
  // marbre — posture accoudée — au lieu d'être planté DANS le meuble comme à
  // +0,15, où le plateau lui traversait la taille. `counterY` remonte ses mains
  // pour qu'elles se posent SUR le marbre et non dedans.
  const npc = people ? people.spawn(V3(P.x, 0, P.z + 0.36), 0,
    { sex: "m", uniform: true, role: "bar", height: 1.76, counterY: 1.13 }) : null;

  // zone E devant le guichet central : l'achat de jetons (cashier.js)
  const hit = B.MeshBuilder.CreateBox("cashHit", { width: 3.0, height: 2, depth: 1.6 }, scene);
  hit.position = V3(P.x, 1, P.z - 1.3);
  hit.isVisible = false;
  hit.metadata = { interact: "cashier", label: "Acheter des jetons (carte bancaire)" };

  // où poser les piles de jetons achetées : marbre du guichet central CÔTÉ
  // CLIENT — la grille du glb est dans le plan z = P.z−0.30, le plateau à
  // y 1,13 (cotes confirmées par le modèle Blender), on reste devant elle
  return { root, procMeshes, sign: signPlane, npc, hit, tray: V3(P.x, 1.13, P.z - 0.40) };
}

/* ------------------------------------------------------------ vestiaire */

function buildCloakroom(scene, world, M, people) {
  const P = LAYOUT.cloakroom;
  const root = new B.TransformNode("cloakroom", scene);

  // REPLI procédural — remplacé par assets/monaco/cloakroom.glb (Blender :
  // comptoir, penderie, cintres, manteaux, chapeaux) dans decorate()
  const counter = B.MeshBuilder.CreateBox("clkCounter", { width: 7.0, height: 1.05, depth: 0.9 }, scene);
  counter.position = V3(P.x, 0.525, P.z); counter.material = M.walnut;
  counter.checkCollisions = true; counter.receiveShadows = true; counter.parent = root;
  const top = B.MeshBuilder.CreateBox("clkTop", { width: 7.2, height: 0.07, depth: 1.05 }, scene);
  top.position = V3(P.x, 1.09, P.z); top.material = M.marble;
  top.checkCollisions = true; top.parent = root;
  const back = B.MeshBuilder.CreateBox("clkBack", { width: 7.0, height: 2.6, depth: 0.2 }, scene);
  back.position = V3(P.x, 1.3, P.z + 1.5); back.material = M.walnut;
  back.checkCollisions = true; back.receiveShadows = true; back.parent = root;
  const signPlane = sign(scene, "VESTIAIRE", V3(P.x, 2.3, P.z + 1.38), Math.PI, 0.24);
  const procMeshes = [counter, top, back];

  // tringle + quelques manteaux suspendus
  const rod = B.MeshBuilder.CreateCylinder("clkRod", { height: 6.4, diameter: 0.04, tessellation: 10 }, scene);
  rod.rotation.z = Math.PI / 2; rod.position = V3(P.x, 1.9, P.z + 1.32);
  rod.material = M.brass; rod.parent = root;
  procMeshes.push(rod);
  const coatCols = [C3(0.1, 0.1, 0.12), C3(0.25, 0.1, 0.08), C3(0.08, 0.12, 0.2), C3(0.15, 0.15, 0.15)];
  for (let i = 0; i < 8; i++) {
    const coat = B.MeshBuilder.CreateBox("clkCoat", { width: 0.34, height: 0.9, depth: 0.12 }, scene);
    coat.position = V3(P.x - 2.6 + i * 0.75 + rnd(-0.05, 0.05), 1.4, P.z + 1.32);
    coat.rotation.y = rnd(-0.1, 0.1);
    coat.material = pbr("clkCoatM" + (i % 4), scene, { color: coatCols[i % 4], roughness: 0.9 });
    coat.parent = root;
    procMeshes.push(coat);
  }
  // LA PRÉPOSÉE AU VESTIAIRE, accoudée à son comptoir, face à la salle
  // (yaw 0 = -Z, convention des figurants). La cote de z vaut pour le REPLI
  // procédural, dont le plateau va jusqu'à P.z+0,53 ; `decorate()` la ramène à
  // +0,32 dès que le glb — plus étroit — prend la place. `counterY` remonte ses
  // mains pour qu'elles se posent SUR le marbre au lieu de le traverser.
  const npc = people ? people.spawn(V3(P.x + 1.2, 0, P.z + 0.62), 0,
    { sex: "f", uniform: true, role: "cloak", height: 1.68, counterY: 1.13 }) : null;

  return { root, procMeshes, sign: signPlane, npc };
}

/* ------------------------------------------------------------ salon VIP */

function buildVip(scene, world, M) {
  const P = LAYOUT.vip;
  const root = new B.TransformNode("vip", scene);

  // tapis 10 × 6,8 — un bordeaux profond dédié : le velours des assises
  // devenait rose vif sous le spot du salon
  const rugMat = pbr("vipRugM", scene, { color: C3(0.20, 0.045, 0.085), roughness: 0.92 });
  const rug = B.MeshBuilder.CreateGround("vipRug", { width: 10, height: 6.8 }, scene);
  rug.position = V3(P.x, 0.012, P.z);
  rug.material = rugMat; rug.receiveShadows = true; rug.parent = root;

  // parois de verre h 3,6 : façade (+Z, porte au centre) et flanc (−X)
  const glassWall = (name, w, pos, rotY) => {
    const g = B.MeshBuilder.CreateBox(name, { width: w, height: 3.6, depth: 0.08 }, scene);
    g.position = pos; g.rotation.y = rotY;
    g.material = M.glass; g.checkCollisions = true; g.parent = root;
    return g;
  };
  // façade vers la salle (+Z, porte au centre) et flanc côté salle (+X) —
  // le salon est adossé au coin arrière droit du visiteur (mur −X / −Z)
  const zFace = P.z + 3.4;
  glassWall("vipGlassL", 3.4, V3(P.x - 3.3, 1.8, zFace), 0);
  glassWall("vipGlassR", 3.4, V3(P.x + 3.3, 1.8, zFace), 0);
  glassWall("vipGlassFlank", 6.8, V3(P.x + 5, 1.8, P.z), Math.PI / 2);
  // linteau laiton au couronnement
  const lintel = B.MeshBuilder.CreateBox("vipLintel", { width: 10.2, height: 0.22, depth: 0.16 }, scene);
  lintel.position = V3(P.x, 3.7, zFace); lintel.material = M.brass; lintel.parent = root;
  const lintel2 = B.MeshBuilder.CreateBox("vipLintel2", { width: 7.0, height: 0.22, depth: 0.16 }, scene);
  lintel2.position = V3(P.x + 5, 3.7, P.z); lintel2.rotation.y = Math.PI / 2;
  lintel2.material = M.brass; lintel2.parent = root;
  // l'enseigne regarde la salle (+Z) : c'est de là qu'on arrive au salon
  sign(scene, "SALON PRIVE", V3(P.x, 3.15, zFace + 0.12), 0, 0.26);

  // table de baccara ovale r 2,1 (échelle z 0,55), feutre émeraude
  const top = B.MeshBuilder.CreateCylinder("vipTop", { height: 0.1, diameter: 4.2, tessellation: 48 }, scene);
  top.position = V3(P.x, 0.83, P.z); top.scaling.z = 0.55;
  top.material = M.feltGreen; top.receiveShadows = true; top.parent = root;
  world.shadowGens.forEach((sg) => sg.addShadowCaster(top));
  const rim = B.MeshBuilder.CreateTorus("vipRim", { diameter: 4.2, thickness: 0.14, tessellation: 48 }, scene);
  rim.position = V3(P.x, 0.86, P.z); rim.scaling.z = 0.55;
  rim.material = M.walnut; rim.parent = root;
  const ped = B.MeshBuilder.CreateCylinder("vipPed", { height: 0.72, diameterTop: 0.5, diameterBottom: 1.0, tessellation: 24 }, scene);
  ped.position = V3(P.x, 0.36, P.z); ped.material = M.walnut; ped.parent = root;
  const col = B.MeshBuilder.CreateCylinder("vipCol", { height: 0.9, diameter: 4.3, tessellation: 24 }, scene);
  col.position = V3(P.x, 0.45, P.z); col.scaling.z = 0.57;
  col.isVisible = false; col.checkCollisions = true; col.parent = root;

  // six tabourets capitonnés autour (remplacés par bar_chair_round_01 si dispo)
  const stoolSpecs = [], stoolMeshes = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const sx = P.x + Math.cos(a) * 2.7, sz = P.z + Math.sin(a) * 1.75;
    stoolSpecs.push({ x: sx, z: sz, a });
    const seat = B.MeshBuilder.CreateCylinder("vipStool", { height: 0.14, diameter: 0.44, tessellation: 20 }, scene);
    seat.position = V3(sx, 0.72, sz); seat.material = M.velvet; seat.parent = root;
    const leg = B.MeshBuilder.CreateCylinder("vipStoolLeg", { height: 0.65, diameter: 0.07, tessellation: 10 }, scene);
    leg.position = V3(sx, 0.33, sz); leg.material = M.brass; leg.parent = root;
    world.shadowGens.forEach((sg) => sg.addShadowCaster(seat));
    stoolMeshes.push(seat, leg);
  }
  // deux fauteuils d'angle, dos aux murs du fond, tournés vers la table
  const armchairSpots = [
    { x: P.x - 3.6, z: P.z - 2.4 },
    { x: P.x + 3.2, z: P.z - 2.6 },
  ];
  return { root, stoolSpecs, stoolMeshes, armchairSpots, center: P };
}

/* --------------------------------------------- assets libres (Poly Haven) */

/** Charge un conteneur d'assets s'il existe (HEAD d'abord : l'absence est le
 *  cas normal en clone frais, pas une erreur). `file` omis = glb à la racine
 *  de assets/monaco (nos modèles Blender). */
export async function loadKit(scene, folder, file = null) {
  const rootUrl = file ? `/assets/monaco/${folder}/` : "/assets/monaco/";
  const name = file || folder;
  try {
    const head = await fetch(rootUrl + name, { method: "HEAD" });
    if (!head.ok) return null;
    return await B.SceneLoader.LoadAssetContainerAsync(rootUrl, name, scene);
  } catch (e) {
    console.warn(`asset ${name} indisponible :`, e.message || e);
    return null;
  }
}

/* ------------------- matériaux du jeu posés sur NOS modèles Blender ------ */

/**
 * Les GLB modélisés dans Blender (bar, caisse, vestiaire, épine des machines,
 * roulette) sortent avec des matériaux plats — le glTF n'emporte pas les
 * textures procédurales. Chaque mesh porte son matériau dans son NOM
 * (`_wood`, `_marbleL`, `_brass`…) : à l'import on lui applique la version
 * RICHE du jeu, bois veiné et marbre en canvas, laiton et miroirs PBR.
 */
let LUX = null;
export function luxMats(scene) {
  if (LUX) return LUX;
  const woodTex = canvasTex("luxWood", scene, 1024, 512, (c, w, h) => {
    c.fillStyle = "#2c1608"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 380; i++) {
      c.beginPath();
      const y = rnd(0, h);
      c.moveTo(0, y);
      c.bezierCurveTo(w * 0.3, y + rnd(-16, 16), w * 0.7, y + rnd(-16, 16), w, y + rnd(-10, 10));
      c.strokeStyle = `rgba(${rnd(60, 150)},${rnd(30, 80)},${rnd(10, 40)},${rnd(0.05, 0.35)})`;
      c.lineWidth = rnd(0.6, 3); c.stroke();
    }
  }, { uScale: 2.5, vScale: 1.2 });
  const marbTex = canvasTex("luxMarble", scene, 1024, 1024, (c, w, h) => {
    c.fillStyle = "#ddd5c6"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 80; i++) {
      c.beginPath();
      let x = rnd(-100, w), y = rnd(-100, h);
      c.moveTo(x, y);
      for (let k = 0; k < 12; k++) { x += rnd(-60, 100); y += rnd(-60, 90); c.lineTo(x, y); }
      c.strokeStyle = `rgba(${140 + rnd(0, 40)},${130 + rnd(0, 40)},${110 + rnd(0, 40)},${rnd(0.06, 0.28)})`;
      c.lineWidth = rnd(0.6, 4); c.stroke();
    }
  }, { uScale: 1.6, vScale: 1.6 });
  const wood = pbr("luxWoodM", scene, { color: C3(1.35, 1.22, 1.08), roughness: 0.26, metallic: 0.06 });
  wood.baseTexture = woodTex;
  const marbleL = pbr("luxMarbleM", scene, { color: C3(1, 1, 1), roughness: 0.12, metallic: 0.05 });
  marbleL.baseTexture = marbTex;
  LUX = {
    _wood: wood,
    _marbleL: marbleL,
    _brass: gold(scene, 0.9),
    _dark: pbr("luxDark", scene, { color: C3(0.03, 0.026, 0.026), roughness: 0.34, metallic: 0.3 }),
    _mirror: pbr("luxMirror", scene, { color: C3(0.72, 0.71, 0.68), metallic: 1, roughness: 0.07 }),
    _glow: pbr("luxGlow", scene, { color: C3(1, 0.85, 0.55), emissive: C3(1.35, 0.88, 0.42) }),
    _felt: pbr("luxFelt", scene, { color: C3(0.05, 0.28, 0.2), roughness: 0.95 }),
    _coatA: pbr("luxCoatA", scene, { color: C3(0.055, 0.05, 0.06), roughness: 0.92 }),
    _coatB: pbr("luxCoatB", scene, { color: C3(0.22, 0.05, 0.08), roughness: 0.92 }),
    _coatC: pbr("luxCoatC", scene, { color: C3(0.05, 0.08, 0.16), roughness: 0.92 }),
  };
  return LUX;
}

export function applyLuxMats(scene, meshes) {
  const L = luxMats(scene);
  for (const m of meshes) {
    if (!m.getTotalVertices || !m.getTotalVertices()) continue;
    for (const key of Object.keys(L)) {
      if (m.name.includes(key)) { m.material = L[key]; break; }
    }
  }
}

/**
 * Pose une instance du conteneur : mesurée à l'identité, remise à l'échelle
 * pour viser `targetH` de haut (0 = échelle du fichier), assise au sol, puis
 * tournée. Le wrapper isole la transformation du __root__ glTF (quaternion du
 * chargeur) — on ne touche jamais à ce dernier.
 */
export function place(scene, world, cont, { x, z, rotY = 0, targetH = 0, y = 0, collide = false, lux = false, name }) {
  const inst = cont.instantiateModelsToScene((n) => name + ":" + n, false);
  const wrap = new B.TransformNode(name, scene);
  for (const r of inst.rootNodes) r.parent = wrap;
  let min = null, max = null;
  for (const m of wrap.getChildMeshes()) {
    if (!m.getTotalVertices || !m.getTotalVertices()) continue;
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    if (!min) { min = bb.minimumWorld.clone(); max = bb.maximumWorld.clone(); }
    else {
      min = B.Vector3.Minimize(min, bb.minimumWorld);
      max = B.Vector3.Maximize(max, bb.maximumWorld);
    }
  }
  if (!min) { wrap.dispose(); return null; }
  const s = targetH > 0 ? targetH / Math.max(0.01, max.y - min.y) : 1;
  wrap.scaling.setAll(s);
  wrap.rotation.y = rotY;
  wrap.position.set(x, y - min.y * s, z);
  const sg = world.shadowGens[1] || world.shadowGens[0];
  for (const m of wrap.getChildMeshes()) {
    m.receiveShadows = true;
    m.isPickable = false;
    if (collide) m.checkCollisions = true;
    try { sg?.addShadowCaster(m); } catch { }
  }
  if (lux) applyLuxMats(scene, wrap.getChildMeshes());
  return wrap;
}

/**
 * Habille les zones avec les modèles libres (CC0, crédits dans
 * assets/monaco/CREDITS.md) et la roulette modélisée dans Blender. Chaque
 * famille est indépendante : ce qui manque laisse son repli procédural.
 */
async function decorate(scene, world, roots) {
  const kits = {};
  const load = async (key, folder, file) => (kits[key] = await loadKit(scene, folder, file));
  await Promise.all([
    load("roulette", "roulette.glb"),
    load("cashier", "cashier.glb"),
    load("cloakroom", "cloakroom.glb"),
    load("dining_chair_02", "dining_chair_02", "dining_chair_02.gltf"),
    load("bar_chair_round_01", "bar_chair_round_01", "bar_chair_round_01.gltf"),
    load("ArmChair_01", "ArmChair_01", "ArmChair_01.gltf"),
    load("potted_plant_01", "potted_plant_01", "potted_plant_01.gltf"),
    load("potted_plant_02", "potted_plant_02", "potted_plant_02.gltf"),
    load("brass_candleholders", "brass_candleholders", "brass_candleholders.gltf"),
    load("marble_bust_01", "marble_bust_01", "marble_bust_01.gltf"),
  ]);

  // le guichet de caisse et le vestiaire modélisés dans Blender remplacent
  // leurs replis en boîtes ; l'enseigne du jeu vient se recaler sur le glb
  if (kits.cashier) {
    const c = roots.cashier, P = LAYOUT.cashier;
    const wrap = place(scene, world, kits.cashier, { x: P.x, z: P.z, rotY: 0, collide: true, lux: true, name: "cashierGlb" });
    if (wrap) {
      c.procMeshes.forEach((m) => m.dispose());
      c.sign.position.set(P.x, 2.86, P.z + 0.36);
      // LE COULOIR DE SERVICE, MESURÉ : le caissier se met au milieu de
      // l'espace libre entre le dos du comptoir et l'arrière-caisse. Tant que
      // le glb n'a pas de vrai couloir (< 0,6 m), il garde sa place de repli ;
      // dès qu'un export en offre un, il s'y installe sans retouche de code.
      if (c.npc) {
        let front = -Infinity, rear = Infinity;
        for (const m of wrap.getChildMeshes()) {
          if (!m.getTotalVertices || !m.getTotalVertices()) continue;
          m.computeWorldMatrix(true);
          const bb = m.getBoundingInfo().boundingBox;
          const zMin = bb.minimumWorld.z - P.z, zMax = bb.maximumWorld.z - P.z;
          if (zMax <= 0.35) front = Math.max(front, zMax);
          else if (zMin >= 0.33) rear = Math.min(rear, zMin);
        }
        if (rear - front >= 0.6) {
          c.npc.root.position.z = P.z + (front + rear) / 2;
          // l'enseigne suit le nouveau dosseret
          c.sign.position.z = P.z + rear - 0.05;
        }
      }
    }
  }
  if (kits.cloakroom) {
    const c = roots.cloakroom, P = LAYOUT.cloakroom;
    if (place(scene, world, kits.cloakroom, { x: P.x, z: P.z, rotY: 0, collide: true, lux: true, name: "cloakroomGlb" })) {
      c.procMeshes.forEach((m) => m.dispose());
      c.sign.position.set(P.x, 2.62, P.z + 0.74);
      // le glb est plus étroit que le repli : son marbre s'arrête à P.z+0,26 et
      // la penderie commence à +1,35. La préposée se replace dans ce couloir,
      // ventre au bord du comptoir.
      if (c.npc) c.npc.root.position.z = P.z + 0.32;
    }
  }

  // la roulette Blender remplace les deux maquettes procédurales
  if (kits.roulette) {
    for (const key of ["roulette1", "roulette2"]) {
      const r = roots[key];
      const P = r.root.position;
      if (place(scene, world, kits.roulette, { x: P.x, z: P.z, name: key + "Glb" })) {
        r.deco.dispose(false, true);
      }
    }
  }

  // Yaw d'un modèle posé en (x, z) pour qu'il REGARDE (tx, tz). Convention
  // Babylon : un yaw r présente la face +Z du modèle vers (sin r, cos r) ;
  // `off` rattrape les assets qui ne sont pas modélisés face à +Z.
  const faceTo = (x, z, tx, tz, off = 0) => Math.atan2(tx - x, tz - z) + off;

  // chaises du restaurant, assises tournées vers leur table
  if (kits.dining_chair_02) {
    const d = roots.dining;
    let ok = 0;
    for (const c of d.chairSpecs) {
      const t = { x: c.x - Math.cos(c.a) * 1.55, z: c.z - Math.sin(c.a) * 1.55 };
      if (place(scene, world, kits.dining_chair_02, {
        x: c.x, z: c.z, rotY: faceTo(c.x, c.z, t.x, t.z), targetH: 0.92, collide: true,
        name: "dnChair",
      })) ok++;
    }
    if (ok) d.chairMeshes.forEach((m) => m.dispose());
  }

  // tabourets du salon VIP, tournés vers la table de baccara
  if (kits.bar_chair_round_01) {
    const v = roots.vip;
    let ok = 0;
    for (const s of v.stoolSpecs) {
      if (place(scene, world, kits.bar_chair_round_01, {
        x: s.x, z: s.z, rotY: faceTo(s.x, s.z, v.center.x, v.center.z), targetH: 0.95, collide: true,
        name: "vipStoolGlb",
      })) ok++;
    }
    if (ok) v.stoolMeshes.forEach((m) => m.dispose());
  }

  // fauteuils d'angle du salon VIP
  if (kits.ArmChair_01) {
    const v = roots.vip;
    for (const s of v.armchairSpots) {
      place(scene, world, kits.ArmChair_01, {
        x: s.x, z: s.z, rotY: faceTo(s.x, s.z, v.center.x, v.center.z), targetH: 1.0, collide: true,
        name: "vipArm",
      });
    }
  }

  // plantes en pot, en alternance, aux emplacements du décor
  if (kits.potted_plant_01 || kits.potted_plant_02) {
    const spots = world.plantSpots || [];
    let ok = 0;
    spots.forEach(([x, z], i) => {
      const kit = (i % 2 ? kits.potted_plant_02 : kits.potted_plant_01) ||
        kits.potted_plant_01 || kits.potted_plant_02;
      if (!place(scene, world, kit, {
        x, z, rotY: (i * 2.4) % 6.28, targetH: i % 2 ? 1.15 : 1.5, name: "plant",
      })) return;
      ok++;
      const col = B.MeshBuilder.CreateCylinder("plantCol", { height: 1.2, diameter: 0.85, tessellation: 10 }, scene);
      col.position = V3(x, 0.6, z); col.isVisible = false; col.checkCollisions = true;
    });
    if (ok) (world.plantMeshes || []).forEach((m) => m.dispose());
  }

  // bougeoirs de laiton sur les tables du restaurant
  if (kits.brass_candleholders) {
    const d = roots.dining;
    let ok = 0;
    d.tables.forEach((t, i) => {
      if (place(scene, world, kits.brass_candleholders, {
        x: t.x, z: t.z, y: 0.805, rotY: i * 1.3, targetH: 0.34, name: "candle",
      })) ok++;
    });
    if (ok) {
      d.candleMeshes.forEach((m) => m.dispose());
      d.flames.forEach((f) => { f.position.y = 0.805 + 0.335; f.scaling.setAll(0.8); f.scaling.y = 1.3; });
    }
  }

  // deux bustes de marbre sur piédestal, flanquant le tapis d'honneur et
  // tournés vers l'axe (le modèle regarde +Z à l'échelle 1)
  if (kits.marble_bust_01) {
    const M = mats(scene);
    for (const sx of [-6.0, 6.0]) {
      const ped = B.MeshBuilder.CreateCylinder("bustPed", { height: 1.15, diameterTop: 0.5, diameterBottom: 0.62, tessellation: 24 }, scene);
      ped.position = V3(sx, 0.575, 11);
      ped.material = M.marble; ped.checkCollisions = true; ped.receiveShadows = true;
      place(scene, world, kits.marble_bust_01, {
        x: sx, z: 11, y: 1.15, rotY: sx < 0 ? Math.PI / 2 : -Math.PI / 2, targetH: 0.62, name: "bust",
      });
    }
  }
  console.log("[venues] assets monaco :", Object.entries(kits).map(([k, v]) => k + (v ? " ✓" : " ✗")).join(", "));
}

/* --------------------------------------------------------------- export */

export function buildVenues(scene, world, people) {
  const M = mats(scene);
  const roots = {
    roulette1: buildRoulette(scene, world, M, LAYOUT.roulette1, 1),
    roulette2: buildRoulette(scene, world, M, LAYOUT.roulette2, 2),
    dining: buildDining(scene, world, M),
    cashier: buildCashier(scene, world, M, people),
    cloakroom: buildCloakroom(scene, world, M, people),
    vip: buildVip(scene, world, M),
  };
  decorate(scene, world, roots).catch((e) => console.warn("décor monaco :", e));
  // caissier et préposée au vestiaire suivent le joueur du regard dès qu'il
  // s'approche de leur comptoir
  roots.tick = (dt, playerPos) => {
    for (const [key, anchor] of [["cashier", LAYOUT.cashier], ["cloakroom", LAYOUT.cloakroom]]) {
      const n = roots[key]?.npc;
      if (!n) continue;
      const near = playerPos &&
        Math.hypot(playerPos.x - anchor.x, playerPos.z - anchor.z) < 8;
      n.tick(dt, near ? playerPos : null);
    }
  };
  return roots;
}
