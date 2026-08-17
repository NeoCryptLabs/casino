/** Architecture du casino : sol, murs, plafond, piliers, lustres, éclairage. */
import { V3, C3, pbr, gold, canvasTex, normalMap, rnd, rndInt, merge } from "./util.js";
const B = BABYLON;

export const LAYOUT = {
  hall: { w: 44, d: 34, h: 8.5 },
  fountain: V3(0, 0, -1),
  bar: { x: 0, z: -14.2, w: 13 },
  // le « pit » : trois tables de blackjack alignées le long du mur +X
  blackjack: V3(12.5, 0, 6),
  blackjack1: V3(12.5, 0, -1.5),
  blackjack2: V3(12.5, 0, -9),
  stage: V3(21.72, 0, 0.5),   // SOUDÉE au mur +X : la baie est ouverte autour
  spawn: V3(0, 1.62, 14.5),
  // LE MICRO ET LA CHANTEUSE, en MONDE : place de l'artiste, prise de la main
  // haute (corps du micro) et de la main basse (fût). À zéro = non réglés,
  // `stage.js` y pose alors les valeurs déduites du pied qu'il construit. Ils
  // se déplacent au gizmo en mode éditeur (P) et se sauvent dans layout.json.
  singerSpot: V3(0, 0, 0),
  micHigh: V3(0, 0, 0),
  micLow: V3(0, 0, 0),
  slots: { x0: -17.5, z0: -9, rows: 2, per: 6 },
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

function marbleTexture(scene, light = false) {
  return canvasTex(light ? "marbleL" : "marble", scene, 1024, 1024, (c, w, h) => {
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
  }, { uScale: 3, vScale: 3 });
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
      const sg = new B.ShadowGenerator(1024, s);
      sg.usePercentageCloserFiltering = true;
      sg.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
      sg.bias = 0.00035; sg.normalBias = 0.012;
      sg.darkness = 0.28;
      shadowGens.push(sg);
      s.shadowGen = sg;
    }
    return s;
  }

  const lights = {
    table: spot("lTable", V3(LAYOUT.blackjack.x, 4.2, LAYOUT.blackjack.z), V3(0, -1, 0), 1.15, 65, C3(1, 0.88, 0.66), 14),
    bar: spot("lBar", V3(LAYOUT.bar.x, 4.4, LAYOUT.bar.z + 1.6), V3(0, -1, -0.25), 1.5, 62, C3(1, 0.72, 0.42), 16),
    fountain: spot("lFtn", V3(LAYOUT.fountain.x, 6.5, LAYOUT.fountain.z), V3(0, -1, 0), 1.25, 52, C3(0.8, 0.9, 1), 18),
    slots: spot("lSlots", V3(-12, 5.5, 0), V3(0.25, -1, 0), 1.5, 70, C3(1, 0.72, 0.5), 22),
    // les deux tables du pit, ajoutées EN FIN de littéral : l'ordre des
    // shadowGens (le [0] = table principale, rafraîchi chaque frame) est un
    // contrat que d'autres modules utilisent — on ne l'altère pas
    table1: spot("lTable1", V3(LAYOUT.blackjack1.x, 4.2, LAYOUT.blackjack1.z), V3(0, -1, 0), 1.15, 65, C3(1, 0.88, 0.66), 14),
    table2: spot("lTable2", V3(LAYOUT.blackjack2.x, 4.2, LAYOUT.blackjack2.z), V3(0, -1, 0), 1.15, 65, C3(1, 0.88, 0.66), 14),
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
  const carpetMat = pbr("carpetM", scene, { color: C3(1, 1, 1), roughness: 0.94 });
  carpetMat.baseTexture = carpetTexture(scene);
  const carpetN = normalMap("carpetN", scene, 256, 26, 3.4);
  carpetMat.normalTexture = carpetN;
  floor.material = carpetMat;
  floor.receiveShadows = true;
  floor.checkCollisions = true;
  floor.metadata = { floor: true };

  // Disque de marbre autour de la fontaine + allée
  const lightMarble = marbleTexture(scene, true);      // partagé sol + piliers
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
  const SGAP = 4.5;                      // demi-largeur de la baie
  const sz = LAYOUT.stage.z;
  const zLo = sz - SGAP, zHi = sz + SGAP;
  const walls = [
    wall(hall.w, hall.h, V3(0, hall.h / 2, -hd), 0),
    wall(hall.w, hall.h, V3(0, hall.h / 2, hd), 0),
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
  trim.push(...wainscot(hall.w, V3(0, 0, hd - 0.3), 0));
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
  // le pilier de droite était planté au milieu de la scène : on l'écarte
  for (const [px, pz] of [[-13, -11], [-13, 11], [13, -11], [13, 11], [-19, 0], [19, -13]]) {
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
  for (const [x, z] of [[-14, -8], [-14, 8], [12, -8], [13, 8], [0, 13]]) chandelier(x, z, 0.85);

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
  neon("SLOTS", V3(-21.6, 4.6, 0), Math.PI / 2, "#ff2d6f", 0.5);
  neon("BAR", V3(LAYOUT.bar.x, 4.3, -hd + 0.35), 0, "#41d7ff", 0.45);
  neon("BLACKJACK", V3(hw - 0.35, 4.4, LAYOUT.blackjack.z), -Math.PI / 2, "#ffc23d", 0.45);
  neon("LE MIRAGE", V3(0, 5.4, hd - 0.35), Math.PI, "#ff9a3d", 0.7);

  /* ---------- appliques murales ---------- */
  const sconceMat = pbr("scM", scene, { color: C3(1, 0.75, 0.4), emissive: C3(1.0, 0.6, 0.22), alpha: 0.85 });
  for (let i = -3; i <= 3; i++) {
    for (const [x, z, ry] of [[i * 6, -hd + 0.45, 0], [i * 6, hd - 0.45, Math.PI], [-hw + 0.45, i * 4.5, Math.PI / 2], [hw - 0.45, i * 4.5, -Math.PI / 2]]) {
      const s = B.MeshBuilder.CreateCylinder("sc", { height: 0.55, diameterTop: 0.34, diameterBottom: 0.1, tessellation: 12 }, scene);
      s.position = V3(x, 3.3, z); s.material = sconceMat;
      s.rotation.y = ry;
    }
  }

  /* ---------- plantes & mobilier d'ambiance ---------- */
  const leafMat = pbr("leaf", scene, { color: C3(0.09, 0.22, 0.09), roughness: 0.75, backFaceCulling: false });
  const potMat = pbr("pot", scene, { color: C3(0.12, 0.12, 0.14), roughness: 0.35, metallic: 0.5 });
  for (const [x, z] of [[-8, -15], [8, -15], [-20, -14], [20, -14], [-20, 14], [20, 14], [6, 15], [-6, 15]]) {
    const pot = B.MeshBuilder.CreateCylinder("pot", { height: 0.7, diameterTop: 0.75, diameterBottom: 0.55, tessellation: 16 }, scene);
    pot.position = V3(x, 0.35, z); pot.material = potMat; pot.checkCollisions = true;
    casters.push(pot);
    for (let i = 0; i < 14; i++) {
      const l = B.MeshBuilder.CreatePlane("lf", { width: 0.22, height: rnd(0.9, 1.7) }, scene);
      l.position = V3(x + rnd(-0.2, 0.2), 0.7 + rnd(0.3, 0.9), z + rnd(-0.2, 0.2));
      l.rotation = V3(rnd(-0.5, 0.5), rnd(0, 6.28), rnd(-0.6, 0.6));
      l.material = leafMat;
      casters.push(l);
    }
  }

  // cordons de velours à l'entrée
  const ropeMat = pbr("rope", scene, { color: C3(0.4, 0.05, 0.07), roughness: 0.9 });
  for (let i = -1; i <= 1; i += 2) {
    for (let k = 0; k < 3; k++) {
      const p = B.MeshBuilder.CreateCylinder("post", { height: 1, diameter: 0.09 }, scene);
      // pas de collision : un poteau de 9 cm avec le halo caméra faisait un
      // pilier fantôme de 60 cm en pleine allée d'entrée
      p.position = V3(i * 3.6, 0.5, 12 - k * 3); p.material = gold(scene, 0.7);
      const b = B.MeshBuilder.CreateSphere("pb", { diameter: 0.18 }, scene);
      b.position = V3(i * 3.6, 1.05, 12 - k * 3); b.material = gold(scene, 0.9);
      if (k < 2) {
        const r = B.MeshBuilder.CreateCylinder("rp", { height: 3, diameter: 0.06 }, scene);
        r.position = V3(i * 3.6, 0.86, 10.5 - k * 3);
        r.rotation = V3(Math.PI / 2, 0, 0); r.material = ropeMat;
      }
    }
  }

  // Pas de collision invisible sur la fontaine : la vasque (`basin`,
  // fountain.js) est déjà solide, à sa hauteur réelle de 0,85 m. Le cylindre
  // qui existait ici doublait cette collision sur 2 m de haut — on butait dans
  // le vide bien au-dessus de la pierre visible.

  return { lights, shadowGens, casters, glow, floor, plaza, walls };
}

/** Autorise plus de 4 lumières simultanées sur tous les matériaux. */
export function raiseLightLimit(scene, n = 6) {
  scene.materials.forEach((m) => { if ("maxSimultaneousLights" in m) m.maxSimultaneousLights = n; });
}
