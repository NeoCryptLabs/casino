/** Architecture du casino : sol, murs, plafond, piliers, lustres, éclairage. */
import { V3, C3, pbr, gold, canvasTex, normalMap, rnd, rndInt, merge, WINDOWS } from "./util.js";
const B = BABYLON;

/**
 * Disposition « Casino Le Royal Monaco » — voir PLAN_CASINO_MONACO.md et
 * design_handoff_casino_royal_monaco/README.md (source de vérité, mètres,
 * origine au centre de la fontaine, entrée au +Z, fond de salle au −Z).
 *
 * MIROIR EN X par rapport aux coordonnées du handoff : la référence est en
 * three.js (repère main-droite), Babylon est main-gauche. À coordonnées
 * égales, tout ce que le plan met à droite du visiteur passerait à sa gauche.
 * On négative donc les x asymétriques — l'EXPÉRIENCE (machines à droite en
 * entrant, pit et scène à gauche, VIP au fond à droite) est celle du handoff.
 */
export const LAYOUT = {
  hall: { w: 52, d: 39, h: 6.5 },
  fountain: V3(0, 0, -0.8),
  bar: { x: 0, z: -17.6, w: 9.4 },     // fond d'axe, face à l'entrée
  // le « pit » : trois tables de blackjack le long du mur +X, la scène derrière
  blackjack: V3(16.6, 0, 3.6),
  blackjack1: V3(16.6, 0, -1.6),
  blackjack2: V3(16.6, 0, 8.8),
  // SOUDÉE au mur +X (x = hall.w/2 - 0.05) : `stage.js` recale de toute façon
  // cet axe sur le plan du mur, seul le z (position le long du mur) est libre
  stage: V3(25.95, 0, 3.6),
  spawn: V3(0, 1.62, 15),
  // LE MICRO ET LA CHANTEUSE, en MONDE : place de l'artiste, prise de la main
  // haute (corps du micro) et de la main basse (fût). À zéro = non réglés,
  // `stage.js` y pose alors les valeurs déduites du pied qu'il construit. Ils
  // se déplacent au gizmo en mode éditeur (P) et se sauvent dans layout.json.
  singerSpot: V3(0, 0, 0),
  micHigh: V3(0, 0, 0),
  micLow: V3(0, 0, 0),
  // trois épines dos-à-dos à droite du visiteur (−X) : 9 par face = 54 postes
  slots: { x0: -22.4, z0: -5.6, rows: 3, per: 9 },
  // les zones du handoff, bâties par venues.js
  // handoff : ∓6,4 — écartées à ∓7,0 pour laisser 1,5 m entre bassin et table
  roulette1: V3(-7.0, 0, -0.8),
  roulette2: V3(7.0, 0, -0.8),
  restaurant: { xs: [20.5, 16.0, 11.5, 7.0], z: 15.4 },
  cashier: V3(-18.8, 0, 15.6),
  // aligné sur la caisse (retour utilisateur 18/08) : les deux comptoirs
  // tiennent la même ligne z, dos au mur +Z avec leur couloir de service
  cloakroom: V3(-10.1, 0, 15.6),
  vip: V3(-18.6, 0, -13.4),
};

/* --------------------------------------------------------------- textures */

function carpetTexture(scene) {
  return canvasTex("carpet", scene, 1024, 1024, (c, w, h) => {
    c.fillStyle = "#5c1620"; c.fillRect(0, 0, w, h);
    // damas doré
    const cell = 256;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const ox = x + ((y / cell) % 2) * cell * 0.5;
        c.save(); c.translate(ox + cell / 2, y + cell / 2);
        c.strokeStyle = "rgba(214,168,72,.55)"; c.lineWidth = 6;
        c.beginPath();
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          c.moveTo(0, 0);
          c.bezierCurveTo(
            Math.cos(ang) * 40, Math.sin(ang) * 40,
            Math.cos(ang + 0.5) * 80, Math.sin(ang + 0.5) * 80,
            Math.cos(ang) * 104, Math.sin(ang) * 104);
        }
        c.stroke();
        c.beginPath(); c.arc(0, 0, 26, 0, 7); c.fillStyle = "rgba(122,26,34,.9)"; c.fill();
        c.strokeStyle = "rgba(230,190,100,.6)"; c.lineWidth = 3; c.stroke();
        c.restore();
      }
    }
    // grain
    const img = c.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 34;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    c.putImageData(img, 0, 0);
  }, { uScale: 9, vScale: 7 });
}

function marbleTexture(scene, light = false, name = null, uScale = 3, vScale = 3) {
  return canvasTex(name || (light ? "marbleL" : "marble"), scene, 1024, 1024, (c, w, h) => {
    c.fillStyle = light ? "#d9d2c4" : "#1a1a1f"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      c.beginPath();
      let x = rnd(-100, w), y = rnd(-100, h);
      c.moveTo(x, y);
      for (let k = 0; k < 14; k++) { x += rnd(-60, 100); y += rnd(-60, 90); c.lineTo(x, y); }
      c.strokeStyle = light
        ? `rgba(${rndInt(90, 150)},${rndInt(85, 140)},${rndInt(70, 120)},${rnd(0.06, 0.3)})`
        : `rgba(${rndInt(150, 235)},${rndInt(140, 220)},${rndInt(120, 190)},${rnd(0.04, 0.22)})`;
      c.lineWidth = rnd(0.6, 4.5); c.stroke();
    }
    for (let i = 0; i < 26; i++) {
      c.beginPath(); c.arc(rnd(0, w), rnd(0, h), rnd(60, 300), 0, 7);
      c.fillStyle = light ? `rgba(255,252,246,${rnd(0.05, 0.16)})` : `rgba(255,250,240,${rnd(0.008, 0.03)})`;
      c.fill();
    }
  }, { uScale, vScale });
}

function panelTexture(scene) {
  return canvasTex("panel", scene, 512, 512, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#2a1a10"); g.addColorStop(0.5, "#3a2415"); g.addColorStop(1, "#20130b");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      c.beginPath();
      c.moveTo(0, rnd(0, h)); c.bezierCurveTo(w * 0.3, rnd(0, h), w * 0.7, rnd(0, h), w, rnd(0, h));
      c.strokeStyle = `rgba(${rndInt(20, 90)},${rndInt(12, 55)},${rndInt(5, 30)},${rnd(0.05, 0.3)})`;
      c.lineWidth = rnd(0.5, 2.6); c.stroke();
    }
  }, { uScale: 4, vScale: 2 });
}

/* --------------------------------------------------------------- world */

export function buildWorld(scene) {
  const { hall } = LAYOUT;
  const casters = [];
  const shadowGens = [];

  /* ---------- environnement / IBL ---------- */
  const env = new B.CubeTexture(
    "https://assets.babylonjs.com/environments/environmentSpecular.env", scene);
  scene.environmentTexture = env;
  scene.environmentIntensity = 0.55;
  scene.clearColor = new B.Color4(0.02, 0.015, 0.01, 1);
  scene.fogMode = B.Scene.FOGMODE_EXP2;
  // brume ambrée légèrement plus dense : elle donne du VOLUME aux faisceaux
  // et éloigne les fonds — c'est elle qui fait « grande salle »
  scene.fogColor = C3(0.075, 0.042, 0.026);
  scene.fogDensity = 0.0125;

  /* ---------- lumières ---------- */
  // Ambiante plus BASSE et plus chaude : le luxe se joue en clair-obscur, la
  // salle doit être éclairée par ses lustres, pas par une lumière du jour.
  const amb = new B.HemisphericLight("amb", V3(0, 1, 0), scene);
  amb.intensity = 0.62;
  amb.diffuse = C3(1, 0.78, 0.52);
  amb.groundColor = C3(0.25, 0.1, 0.08);

  function spot(name, pos, dir, angle, intens, color, range = 30, shadows = true) {
    const s = new B.SpotLight(name, pos, dir, angle, 6, scene);
    s.intensity = intens; s.diffuse = color; s.specular = color; s.range = range;
    if (shadows) {
      // Windows/ANGLE : chaque carte d'ombre alourdit le shader de TOUT
      // matériau qu'elle touche — cartes plus petites et PCF minimal, sinon la
      // compilation D3D gèle le chargement (voir WINDOWS dans util.js).
      const sg = new B.ShadowGenerator(WINDOWS ? 512 : 1024, s);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = WINDOWS
        ? B.ShadowGenerator.QUALITY_LOW : B.ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.00035; sg.normalBias = 0.012;
      sg.darkness = 0.28;
      shadowGens.push(sg);
      s.shadowGen = sg;
    }
    return s;
  }

  const lights = {
    table: spot("lTable", V3(LAYOUT.blackjack.x, 4.2, LAYOUT.blackjack.z), V3(0, -1, 0), 1.15, 65, C3(1, 0.88, 0.66), 14),
    bar: spot("lBar", V3(LAYOUT.bar.x, 4.7, LAYOUT.bar.z + 2.6), V3(0, -1, 0.10), 1.5, 74, C3(1, 0.72, 0.42), 19),
    fountain: spot("lFtn", V3(LAYOUT.fountain.x, 6.5, LAYOUT.fountain.z), V3(0, -1, 0), 1.25, 52, C3(0.8, 0.9, 1), 18),
    slots: spot("lSlots", V3(-13, 5.6, 1.2), V3(-0.35, -1, 0), 1.5, 70, C3(1, 0.72, 0.5), 24),
    // les deux tables du pit, ajoutées EN FIN de littéral : l'ordre des
    // shadowGens (le [0] = table principale, rafraîchi chaque frame) est un
    // contrat que d'autres modules utilisent — on ne l'altère pas
    table1: spot("lTable1", V3(LAYOUT.blackjack1.x, 4.2, LAYOUT.blackjack1.z), V3(0, -1, 0), 1.15, 65, C3(1, 0.88, 0.66), 14),
    table2: spot("lTable2", V3(LAYOUT.blackjack2.x, 4.2, LAYOUT.blackjack2.z), V3(0, -1, 0), 1.15, 65, C3(1, 0.88, 0.66), 14),
    // les zones du handoff — sans ombre : le budget de shadowGens reste au pit
    dining: spot("lDining", V3(13.5, 4.6, LAYOUT.restaurant.z), V3(0, -1, 0), 1.5, 42, C3(1, 0.78, 0.5), 18, false),
    vip: spot("lVip", V3(LAYOUT.vip.x, 4.4, LAYOUT.vip.z), V3(0, -1, 0), 1.2, 46, C3(1, 0.84, 0.58), 15, false),
    cashier: spot("lCash", V3(LAYOUT.cashier.x, 4.3, LAYOUT.cashier.z - 3.6), V3(0, -0.6, 0.85), 1.15, 58, C3(1, 0.8, 0.52), 16, false),
  };

  const glow = new B.GlowLayer("glow", scene, { blurKernelSize: 64 });
  // 0,55 faisait irradier TOUT ce qui porte un émissif — enseignes, dorures,
  // pastilles de valeur — et se cumulait au bloom du pipeline. À 0,28 les
  // néons rayonnent encore franchement sans noyer ce qu'ils entourent.
  glow.intensity = 0.28;

  /* ---------- sol ---------- */
  /**
   * UN SEUL TRIANGLE, plus grand que le casino.
   *
   * Le sol était un `CreateGround` déjà réduit à `subdivisions: 1`, soit le
   * minimum d'un quadrilatère : DEUX triangles, donc une diagonale qui
   * traversait la salle d'un coin à l'autre en passant par le centre. C'est sur
   * cette arête interne que le solveur de collision accrochait — l'ellipsoïde
   * du joueur, tangente au plan du sol, touche les deux faces à la fois et les
   * tests d'arêtes annulent le déplacement horizontal. D'où un mur invisible en
   * diagonale, « sans aucun solide proche » (cf. src/player.js).
   *
   * Un triangle, lui, n'a pas d'arête interne : il suffit qu'il DÉBORDE la
   * salle pour que ses trois côtés — les seules arêtes restantes — tombent
   * derrière les murs. Angle droit à 2 m dehors du coin (-X, -Z), cathètes de
   * w + d + 10 m : les côtés longent les murs -X et -Z à 2 m, et l'hypoténuse
   * (x + z = 45) passe à 4,2 m du coin opposé. Plus une seule arête de sol à
   * l'intérieur du casino.
   *
   * Les UV reprennent exactement le repère de `CreateGround` (u sur la largeur,
   * v sur la profondeur, origine au coin -X/-Z) : avec les mêmes uScale/vScale,
   * le damas ne bouge pas d'un pixel, il continue simplement au-delà des murs.
   */
  const floor = new B.Mesh("floor", scene);
  {
    const L = hall.w + hall.d + 10;                  // cathètes
    const ax = -hall.w / 2 - 2, az = -hall.d / 2 - 2;  // sommet de l'angle droit
    const pts = [[ax, az], [ax + L, az], [ax, az + L]];
    const vd = new B.VertexData();
    vd.positions = pts.flatMap(([x, z]) => [x, 0, z]);
    // même sens de rotation que le premier triangle de CreateGround — c'est lui
    // qui décide de quel côté la face est vue, donc si le sol s'affiche
    vd.indices = [0, 1, 2];
    vd.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0];
    vd.uvs = pts.flatMap(([x, z]) =>
      [(x + hall.w / 2) / hall.w, (z + hall.d / 2) / hall.d]);
    vd.applyToMesh(floor);
  }
  // SOL DE MARBRE sombre et chaud (#4a3d30 du handoff) : la teinte du matériau
  // assombrit la texture de marbre clair. Texture DÉDIÉE au sol : les UV du
  // triangle couvrent toute la salle, l'échelle du disque de la fontaine y
  // étirait les veines en traînées de 17 m.
  const lightMarble = marbleTexture(scene, true);      // plaza + piliers
  const floorMarble = marbleTexture(scene, true, "marbleFloor", 13, 10);
  const floorMat = pbr("floorM", scene, { color: C3(0.36, 0.29, 0.22), metallic: 0.05, roughness: 0.22 });
  floorMat.baseTexture = floorMarble;
  floor.material = floorMat;
  floor.receiveShadows = true;
  floor.checkCollisions = true;
  floor.metadata = { floor: true };

  // le damas bordeaux ne couvre plus la salle : il habille le TAPIS D'HONNEUR
  const carpetMat = pbr("carpetM", scene, { color: C3(1, 1, 1), roughness: 0.94 });
  carpetMat.baseTexture = carpetTexture(scene);
  const carpetN = normalMap("carpetN", scene, 256, 26, 3.4);
  carpetMat.normalTexture = carpetN;

  // Disque de marbre autour de la fontaine + allée
  const marbleMat = pbr("marbleM", scene, { color: C3(0.62, 0.59, 0.54), metallic: 0.06, roughness: 0.16 });
  marbleMat.baseTexture = lightMarble;
  marbleMat.backFaceCulling = false;
  const plaza = B.MeshBuilder.CreateDisc("plaza", { radius: 8.4, tessellation: 96 }, scene);
  plaza.rotation.x = Math.PI / 2;
  plaza.position = V3(LAYOUT.fountain.x, 0.012, LAYOUT.fountain.z);
  plaza.material = marbleMat;
  plaza.receiveShadows = true;

  /* ---------- murs ---------- */
  const wallMat = pbr("wallM", scene, { color: C3(0.55, 0.4, 0.28), roughness: 0.75 });
  wallMat.baseTexture = panelTexture(scene);
  const wainscotMat = gold(scene, 0.85);
  const wallTopMat = pbr("wallTop", scene, { color: C3(0.32, 0.09, 0.10), roughness: 0.85 });

  function wall(w, h, pos, rotY) {
    const m = B.MeshBuilder.CreateBox("wall", { width: w, height: h, depth: 0.5 }, scene);
    m.position = pos; m.rotation.y = rotY;
    m.material = wallTopMat; m.checkCollisions = true; m.receiveShadows = true;
    return m;
  }
  const hw = hall.w / 2, hd = hall.d / 2;
  // le mur +X s'OUVRE autour de la scène de cabaret : deux segments encadrent
  // la baie (le glb de la scène fournit l'arche et remplit le pourtour)
  const SGAP = 4.5;                      // demi-largeur de la baie de scène
  const sz = LAYOUT.stage.z;
  const zLo = sz - SGAP, zHi = sz + SGAP;
  // ...et le mur +Z s'ouvre sur la BAIE D'ENTRÉE : trémie de 10,4 m au centre,
  // linteau au-dessus des portes (le portique et les portes laiton suivent)
  const EGAP = 5.2;                      // demi-largeur de la baie d'entrée
  const walls = [
    wall(hall.w, hall.h, V3(0, hall.h / 2, -hd), 0),
    wall(hw - EGAP, hall.h, V3(-(EGAP + hw) / 2, hall.h / 2, hd), 0),
    wall(hw - EGAP, hall.h, V3((EGAP + hw) / 2, hall.h / 2, hd), 0),
    wall(EGAP * 2, hall.h - 4.4, V3(0, (hall.h + 4.4) / 2, hd), 0),   // linteau
    wall(hall.d, hall.h, V3(-hw, hall.h / 2, 0), Math.PI / 2),
    wall(zLo + hd, hall.h, V3(hw, hall.h / 2, (zLo - hd) / 2), Math.PI / 2),
    wall(hd - zHi, hall.h, V3(hw, hall.h / 2, (zHi + hd) / 2), Math.PI / 2),
  ];
  // lambris bas + cimaise dorée
  function wainscot(w, pos, rotY) {
    const p = B.MeshBuilder.CreateBox("wns", { width: w, height: 2.4, depth: 0.22 }, scene);
    p.position = pos.clone(); p.position.y = 1.2; p.rotation.y = rotY;
    p.material = wallMat; p.receiveShadows = true;
    const r = B.MeshBuilder.CreateBox("rail", { width: w, height: 0.14, depth: 0.3 }, scene);
    r.position = pos.clone(); r.position.y = 2.45; r.rotation.y = rotY;
    r.material = wainscotMat;
    return [p, r];
  }
  const trim = [];
  trim.push(...wainscot(hall.w, V3(0, 0, -hd + 0.3), 0));
  trim.push(...wainscot(hw - EGAP, V3(-(EGAP + hw) / 2, 0, hd - 0.3), 0));
  trim.push(...wainscot(hw - EGAP, V3((EGAP + hw) / 2, 0, hd - 0.3), 0));
  trim.push(...wainscot(hall.d, V3(-hw + 0.3, 0, 0), Math.PI / 2));
  trim.push(...wainscot(zLo + hd, V3(hw - 0.3, 0, (zLo - hd) / 2), Math.PI / 2));
  trim.push(...wainscot(hd - zHi, V3(hw - 0.3, 0, (zHi + hd) / 2), Math.PI / 2));

  /* ---------- plafond ---------- */
  const ceilMat = pbr("ceilM", scene, { color: C3(0.09, 0.06, 0.04), roughness: 0.9 });
  const ceil = B.MeshBuilder.CreateBox("ceil", { width: hall.w, height: 0.4, depth: hall.d }, scene);
  ceil.position.y = hall.h + 0.2; ceil.material = ceilMat;

  // caissons dorés
  const coffers = [];
  for (let x = -hw + 5; x <= hw - 5; x += 6) {
    for (let z = -hd + 5; z <= hd - 5; z += 6) {
      if (Math.hypot(x - LAYOUT.fountain.x, z - LAYOUT.fountain.z) < 5) continue;
      const c = B.MeshBuilder.CreateBox("cof", { width: 4.6, height: 0.3, depth: 4.6 }, scene);
      c.position = V3(x, hall.h - 0.12, z);
      coffers.push(c);
    }
  }
  if (coffers.length) { const cm = merge(coffers, "coffers"); cm.material = gold(scene, 0.5); }

  // verrière au-dessus de la fontaine
  const dome = B.MeshBuilder.CreateSphere("dome", { diameter: 13, slice: 0.5, segments: 28 }, scene);
  dome.position = V3(LAYOUT.fountain.x, hall.h - 0.3, LAYOUT.fountain.z);
  dome.material = pbr("domeM", scene, {
    color: C3(0.5, 0.65, 0.85), roughness: 0.1, metallic: 0.2, alpha: 0.25, backFaceCulling: false,
    emissive: C3(0.06, 0.09, 0.14),
  });

  /* ---------- piliers ---------- */
  const colMat = pbr("colM", scene, { color: C3(1, 1, 1), roughness: 0.24, metallic: 0.05 });
  colMat.baseTexture = lightMarble;
  const capMat = gold(scene, 0.9);
  // les huit colonnes du handoff (x en miroir) : (11, ∓6), (−19, ∓6), (∓9, −12), (∓9, 13)
  for (const [px, pz] of [[11, -6], [11, 6], [-19, -6], [-19, 6], [-9, -12], [9, -12], [-9, 13], [9, 13]]) {
    const shaft = B.MeshBuilder.CreateCylinder("col", { height: hall.h - 0.6, diameter: 1.05, tessellation: 24 }, scene);
    shaft.position = V3(px, (hall.h - 0.6) / 2, pz);
    shaft.material = colMat; shaft.checkCollisions = true; shaft.receiveShadows = true;
    casters.push(shaft);
    for (const y of [0.35, hall.h - 0.75]) {
      const cap = B.MeshBuilder.CreateCylinder("cap", { height: 0.42, diameterTop: y < 1 ? 1.5 : 1.25, diameterBottom: y < 1 ? 1.25 : 1.5, tessellation: 24 }, scene);
      cap.position = V3(px, y, pz); cap.material = capMat;
    }
  }

  /* ---------- lustres ---------- */
  const crystalMat = pbr("crys", scene, { color: C3(1, 0.95, 0.8), roughness: 0.05, metallic: 0.1, alpha: 0.6, emissive: C3(0.4, 0.32, 0.19) });
  function chandelier(x, z, scale = 1) {
    const root = new B.TransformNode("chand", scene);
    root.position = V3(x, hall.h - 1.4, z);
    root.scaling = V3(scale, scale, scale);
    const rod = B.MeshBuilder.CreateCylinder("rod", { height: 1.3, diameter: 0.06 }, scene);
    rod.position.y = 0.9; rod.material = gold(scene, 0.7); rod.parent = root;
    for (const [r, y, n] of [[0.95, 0, 14], [0.65, 0.4, 10], [0.35, 0.75, 6]]) {
      const ring = B.MeshBuilder.CreateTorus("ring", { diameter: r * 2, thickness: 0.05, tessellation: 32 }, scene);
      ring.position.y = y; ring.material = gold(scene, 0.8); ring.parent = root;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const c = B.MeshBuilder.CreateSphere("crys", { diameter: 0.13, segments: 6 }, scene);
        c.position = V3(Math.cos(a) * r, y - 0.16, Math.sin(a) * r);
        c.scaling.y = 1.9; c.material = crystalMat; c.parent = root;
      }
    }
    const core = B.MeshBuilder.CreateSphere("core", { diameter: 0.5, segments: 10 }, scene);
    core.material = pbr("coreM", scene, { color: C3(1, 0.9, 0.7), emissive: C3(1.0, 0.72, 0.4) });
    core.parent = root;
    return root;
  }
  chandelier(LAYOUT.fountain.x, LAYOUT.fountain.z, 1.6);
  // pit, salon VIP, restaurant, allée des machines, axe d'entrée
  for (const [x, z] of [[16.6, 3.6], [-18.6, -13.4], [13.5, 15.4], [-11, 1.2], [0, 10]]) chandelier(x, z, 0.85);

  /* ---------- enseignes néon ---------- */
  function neon(text, pos, rotY, color, size = 0.55) {
    const tex = canvasTex("neon" + text, scene, 1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.font = "600 130px 'Futura','Avenir Next',sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.shadowColor = color; c.shadowBlur = 55;
      c.fillStyle = "#fff8e2";
      c.fillText(text, w / 2, h / 2);
      c.shadowBlur = 25; c.fillText(text, w / 2, h / 2);
    }, { alpha: true, flip180: true });
    const p = B.MeshBuilder.CreatePlane("neon", { width: size * 8, height: size * 2 }, scene);
    p.position = pos; p.rotation.y = rotY;
    const m = new B.StandardMaterial("neonM", scene);
    m.diffuseTexture = tex; m.opacityTexture = tex;
    m.emissiveTexture = tex; m.emissiveColor = C3(1, 1, 1);
    m.disableLighting = true; m.backFaceCulling = false;
    p.material = m;
    return p;
  }
  neon("SLOTS", V3(-hw + 0.35, 4.6, 1.2), Math.PI / 2, "#ff2d6f", 0.5);
  neon("BAR", V3(LAYOUT.bar.x, 5.0, -hd + 0.35), 0, "#41d7ff", 0.45);
  neon("BLACKJACK", V3(hw - 0.35, 4.6, 10.6), -Math.PI / 2, "#ffc23d", 0.45);
  neon("LE MIRAGE", V3(0, 5.4, hd - 0.35), Math.PI, "#ff9a3d", 0.7);

  /* ---------- appliques murales ---------- */
  const sconceMat = pbr("scM", scene, { color: C3(1, 0.75, 0.4), emissive: C3(1.0, 0.6, 0.22), alpha: 0.85 });
  for (let i = -4; i <= 4; i++) {
    for (const [x, z, ry] of [[i * 6, -hd + 0.45, 0], [i * 6, hd - 0.45, Math.PI], [-hw + 0.45, i * 4.5, Math.PI / 2], [hw - 0.45, i * 4.5, -Math.PI / 2]]) {
      const s = B.MeshBuilder.CreateCylinder("sc", { height: 0.55, diameterTop: 0.34, diameterBottom: 0.1, tessellation: 12 }, scene);
      s.position = V3(x, 3.3, z); s.material = sconceMat;
      s.rotation.y = ry;
    }
  }

  /* ---------- plantes & mobilier d'ambiance ---------- */
  // les emplacements et les meshes sont EXPOSÉS (plantSpots/plantMeshes) :
  // venues.js les remplace par les vraies plantes en pot (Poly Haven, CC0)
  // quand assets/monaco est là — ceci reste le repli procédural.
  const plantSpots = [[-7.5, -14.5], [7.5, -14.5], [-10, -17.5], [24.5, -14], [24.5, 12], [-24.5, 12], [-6.5, 18.5], [6.5, 18.5]];
  const plantMeshes = [];
  const leafMat = pbr("leaf", scene, { color: C3(0.09, 0.22, 0.09), roughness: 0.75, backFaceCulling: false });
  const potMat = pbr("pot", scene, { color: C3(0.12, 0.12, 0.14), roughness: 0.35, metallic: 0.5 });
  for (const [x, z] of plantSpots) {
    const pot = B.MeshBuilder.CreateCylinder("pot", { height: 0.7, diameterTop: 0.75, diameterBottom: 0.55, tessellation: 16 }, scene);
    pot.position = V3(x, 0.35, z); pot.material = potMat; pot.checkCollisions = true;
    casters.push(pot); plantMeshes.push(pot);
    for (let i = 0; i < 14; i++) {
      const l = B.MeshBuilder.CreatePlane("lf", { width: 0.22, height: rnd(0.9, 1.7) }, scene);
      l.position = V3(x + rnd(-0.2, 0.2), 0.7 + rnd(0.3, 0.9), z + rnd(-0.2, 0.2));
      l.rotation = V3(rnd(-0.5, 0.5), rnd(0, 6.28), rnd(-0.6, 0.6));
      l.material = leafMat;
      casters.push(l); plantMeshes.push(l);
    }
  }

  /* ---------- l'ARRIVÉE : tapis d'honneur, axe de marbre, portique ---------- */
  // tapis bordeaux 10,4 × 8,8 centré sur (0, 12.9)
  const redCarpet = B.MeshBuilder.CreateGround("redCarpet", { width: 10.4, height: 8.8 }, scene);
  redCarpet.position = V3(0, 0.012, 12.9);
  redCarpet.material = carpetMat;
  redCarpet.receiveShadows = true;
  // incrustation d'axe en marbre clair, du tapis jusqu'au bar (3,4 × 22 à z 2).
  // Texture à l'aspect de la bande (1:6,5), sinon les veines filent en stries.
  const axisMat = pbr("axisM", scene, { color: C3(0.62, 0.59, 0.54), metallic: 0.06, roughness: 0.16 });
  axisMat.baseTexture = marbleTexture(scene, true, "marbleAxis", 1.6, 10);
  const axis = B.MeshBuilder.CreateGround("axisInlay", { width: 3.4, height: 22 }, scene);
  axis.position = V3(0, 0.014, 2.0);
  axis.material = axisMat;
  axis.receiveShadows = true;

  // portique : dalle à y 4,6, deux colonnes r 0,45 en x ±4,6, portes laiton
  const porticoSlab = B.MeshBuilder.CreateBox("portico", { width: 10.4, height: 0.5, depth: 2.2 }, scene);
  porticoSlab.position = V3(0, 4.65, hd);
  porticoSlab.material = wallTopMat;
  for (const px of [-4.6, 4.6]) {
    const c = B.MeshBuilder.CreateCylinder("porticoCol", { height: 4.4, diameter: 0.9, tessellation: 24 }, scene);
    c.position = V3(px, 2.2, hd - 0.4);
    c.material = colMat; c.checkCollisions = true; c.receiveShadows = true;
    casters.push(c);
    const cap = B.MeshBuilder.CreateCylinder("porticoCap", { height: 0.34, diameterTop: 1.15, diameterBottom: 0.95, tessellation: 24 }, scene);
    cap.position = V3(px, 4.35, hd - 0.4); cap.material = capMat;
  }
  // portes laiton fermées : le casino ne se quitte pas à pied
  const doorMat = gold(scene, 0.55);
  for (const px of [-2.2, 2.2]) {
    const door = B.MeshBuilder.CreateBox("brassDoor", { width: 4.35, height: 4.4, depth: 0.14 }, scene);
    door.position = V3(px, 2.2, hd - 0.05);
    door.material = doorMat; door.checkCollisions = true; door.receiveShadows = true;
  }

  // cordons de velours le long du tapis d'honneur
  const ropeMat = pbr("rope", scene, { color: C3(0.4, 0.05, 0.07), roughness: 0.9 });
  for (let i = -1; i <= 1; i += 2) {
    for (let k = 0; k < 3; k++) {
      const p = B.MeshBuilder.CreateCylinder("post", { height: 1, diameter: 0.09 }, scene);
      // pas de collision : un poteau de 9 cm avec le halo caméra faisait un
      // pilier fantôme de 60 cm en pleine allée d'entrée
      p.position = V3(i * 4.2, 0.5, 16.4 - k * 3); p.material = gold(scene, 0.7);
      const b = B.MeshBuilder.CreateSphere("pb", { diameter: 0.18 }, scene);
      b.position = V3(i * 4.2, 1.05, 16.4 - k * 3); b.material = gold(scene, 0.9);
      if (k < 2) {
        const r = B.MeshBuilder.CreateCylinder("rp", { height: 3, diameter: 0.06 }, scene);
        r.position = V3(i * 4.2, 0.86, 14.9 - k * 3);
        r.rotation = V3(Math.PI / 2, 0, 0); r.material = ropeMat;
      }
    }
  }

  // Pas de collision invisible sur la fontaine : la vasque (`basin`,
  // fountain.js) est déjà solide, à sa hauteur réelle de 0,85 m. Le cylindre
  // qui existait ici doublait cette collision sur 2 m de haut — on butait dans
  // le vide bien au-dessus de la pierre visible.

  return { lights, shadowGens, casters, glow, floor, plaza, walls, plantSpots, plantMeshes };
}

/** Autorise plus de 4 lumières simultanées sur tous les matériaux. */
export function raiseLightLimit(scene, n = 6) {
  scene.materials.forEach((m) => { if ("maxSimultaneousLights" in m) m.maxSimultaneousLights = n; });
}
