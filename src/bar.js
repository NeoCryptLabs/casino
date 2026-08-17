/** Le bar : comptoir, étagère à bouteilles rétroéclairée, tabourets, barman,
 *  et l'action « boire un verre » (verre tenu en main + animation). */
import { V3, C3, pbr, gold, canvasTex, rnd, pick, animFloat, animVec, wait } from "./util.js";
import { LAYOUT } from "./world.js";
const B = BABYLON;

export function buildBar(scene, world, audio, people) {
  const { x: BX, z: BZ, w: BW } = LAYOUT.bar;
  const root = new B.TransformNode("bar", scene);

  const woodTex = canvasTex("wood", scene, 1024, 512, (c, w, h) => {
    c.fillStyle = "#2c1608"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      c.beginPath();
      const y = rnd(0, h);
      c.moveTo(0, y);
      c.bezierCurveTo(w * 0.3, y + rnd(-18, 18), w * 0.7, y + rnd(-18, 18), w, y + rnd(-12, 12));
      c.strokeStyle = `rgba(${rnd(60, 150)},${rnd(30, 80)},${rnd(10, 40)},${rnd(0.05, 0.35)})`;
      c.lineWidth = rnd(0.6, 3); c.stroke();
    }
  }, { uScale: 4, vScale: 1 });

  const wood = pbr("barWood", scene, { color: C3(1, 1, 1), roughness: 0.22, metallic: 0.06 });
  wood.baseTexture = woodTex;
  const topMat = pbr("barTop", scene, { color: C3(0.14, 0.09, 0.06), roughness: 0.08, metallic: 0.25 });
  const brass = gold(scene, 0.9);

  const add = (m, mat, cast = true) => {
    m.material = mat; m.parent = root;
    m.receiveShadows = true;
    if (cast) world.shadowGens.forEach(sg => sg.addShadowCaster(m));
    return m;
  };

  // comptoir
  const counter = add(B.MeshBuilder.CreateBox("counter", { width: BW, height: 1.05, depth: 0.75 }, scene), wood);
  counter.position = V3(BX, 0.525, BZ);
  counter.checkCollisions = true;

  const top = add(B.MeshBuilder.CreateBox("top", { width: BW + 0.3, height: 0.08, depth: 0.95 }, scene), topMat);
  top.position = V3(BX, 1.09, BZ);
  top.checkCollisions = true;

  const foot = add(B.MeshBuilder.CreateCylinder("footrail", { height: BW, diameter: 0.06, tessellation: 12 }, scene), brass);
  foot.rotation.z = Math.PI / 2; foot.position = V3(BX, 0.22, BZ + 0.5);

  // rétroéclairage sous le comptoir
  const under = add(B.MeshBuilder.CreateBox("underGlow", { width: BW, height: 0.05, depth: 0.05 }, scene),
    pbr("ug", scene, { color: C3(0.2, 0.6, 1), emissive: C3(0.04, 0.22, 0.42) }), false);
  under.position = V3(BX, 0.1, BZ + 0.44);

  // dosseret / étagères
  const backWall = add(B.MeshBuilder.CreateBox("backwall", { width: BW + 1.4, height: 3.2, depth: 0.25 }, scene), wood);
  backWall.position = V3(BX, 1.6, BZ - 1.6);
  backWall.checkCollisions = true;

  const mirror = add(B.MeshBuilder.CreatePlane("barMirror", { width: BW + 0.6, height: 2.2 }, scene),
    pbr("mirM", scene, { color: C3(0.75, 0.72, 0.68), metallic: 1, roughness: 0.08 }), false);
  mirror.position = V3(BX, 2.0, BZ - 1.47);

  const shelfGlow = pbr("shelfGlow", scene, { color: C3(0.2, 0.5, 0.9), emissive: C3(0.12, 0.42, 0.68) });
  const bottles = [];
  // teintes d'alcools appliquées au VERRE des modèles Blender
  const liquidCols = [
    C3(0.55, 0.25, 0.05), C3(0.05, 0.28, 0.1), C3(0.62, 0.55, 0.1),
    C3(0.35, 0.06, 0.12), C3(0.85, 0.85, 0.9), C3(0.1, 0.2, 0.45), C3(0.7, 0.35, 0.05),
  ];
  const glassMats = liquidCols.map((col, i) => {
    const m = pbr("btGlass" + i, scene, {
      color: col, roughness: 0.08, metallic: 0.05, alpha: 0.78, emissive: col.scale(0.30),
    });
    return m;
  });
  const shelfYs = [];
  for (let s = 0; s < 3; s++) {
    const y = 1.35 + s * 0.62;
    shelfYs.push(y);
    const shelf = add(B.MeshBuilder.CreateBox("shelf", { width: BW, height: 0.05, depth: 0.3 }, scene), wood);
    shelf.position = V3(BX, y, BZ - 1.38);
    const strip = add(B.MeshBuilder.CreateBox("strip", { width: BW - 0.1, height: 0.03, depth: 0.03 }, scene), shelfGlow, false);
    strip.position = V3(BX, y + 0.05, BZ - 1.25);
  }

  // Les VRAIES bouteilles (assets/bottles.glb, modelées dans Blender : whisky
  // à épaules carrées, vin à long col, gin élancé, liqueur ventrue — corps,
  // étiquette et capsule). Chargées en différé puis clonées sur les étagères ;
  // le verre reçoit une teinte d'alcool au hasard.
  B.SceneLoader.ImportMeshAsync("", "/assets/", "bottles.glb", scene).then((res) => {
    const kinds = [];
    for (const kind of ["bottleWhisky", "bottleWine", "bottleGin", "bottleLiqueur"]) {
      const body = res.meshes.find((m) => m.name === kind);
      if (!body) continue;
      const parts = res.meshes.filter((m) => m === body || m.parent === body);
      // gabarit : les pièces regroupées sous un noeud posé à la BASE du corps
      const bb = body.getBoundingInfo().boundingBox;
      const tpl = new B.TransformNode("tpl_" + kind, scene);
      tpl.position.set(bb.centerWorld.x, bb.minimumWorld.y, bb.centerWorld.z);
      for (const p of parts) p.setParent(tpl);      // conserve la pose monde
      tpl.setEnabled(false);
      kinds.push({ tpl, body });
    }
    if (!kinds.length) return;
    const glbRoot = res.meshes.find((m) => m.name === "__root__");
    for (const s of shelfYs.keys()) {
      const y = shelfYs[s];
      const n = Math.floor(BW / 0.26);
      for (let i = 0; i < n; i++) {
        const x = BX - BW / 2 + 0.16 + i * 0.26 + rnd(-0.02, 0.02);
        const k = kinds[(i + s) % kinds.length];
        const c = k.tpl.clone("bt", root);
        c.setEnabled(true);
        c.position.set(x, y + 0.028, BZ - 1.38 + rnd(-0.015, 0.015));
        c.rotation.y = rnd(0, Math.PI * 2);
        const sc = rnd(0.9, 1.12);
        c.scaling.scaleInPlace(sc);
        // teinte du verre : le mesh corps du clone prend un alcool au hasard
        for (const m of c.getChildMeshes()) {
          if (m.name.includes("bottle")) m.material = pick(glassMats);
          m.isPickable = false;
        }
        bottles.push(c);
      }
    }
    glbRoot?.setEnabled(false);
  }).catch((e) => console.warn("bottles.glb indisponible :", e));

  // verres retournés + shaker
  const glassMat = pbr("glassM", scene, { color: C3(0.85, 0.92, 1), roughness: 0.02, metallic: 0.05, alpha: 0.28 });
  for (let i = 0; i < 10; i++) {
    const gl = B.MeshBuilder.CreateCylinder("gl", { height: 0.12, diameterTop: 0.055, diameterBottom: 0.07, tessellation: 14 }, scene);
    gl.position = V3(BX - BW / 2 + 0.5 + i * 0.4, 1.19, BZ - 0.25);
    gl.material = glassMat; gl.parent = root;
  }

  // tabourets de bar
  const stoolMat = pbr("bstool", scene, { color: C3(0.28, 0.05, 0.08), roughness: 0.7 });
  const chrome = pbr("bchrome", scene, { color: C3(0.8, 0.8, 0.85), metallic: 1, roughness: 0.18 });
  const stools = [];
  for (let i = 0; i < 6; i++) {
    const x = BX - BW / 2 + 1.0 + i * ((BW - 2) / 5);
    const z = BZ + 1.15;
    const seat = B.MeshBuilder.CreateCylinder("bs", { height: 0.12, diameter: 0.38, tessellation: 20 }, scene);
    seat.position = V3(x, 0.78, z); seat.material = stoolMat; seat.parent = root;
    const leg = B.MeshBuilder.CreateCylinder("bl", { height: 0.74, diameter: 0.07 }, scene);
    leg.position = V3(x, 0.37, z); leg.material = chrome; leg.parent = root;
    const fo = B.MeshBuilder.CreateCylinder("bf", { height: 0.04, diameter: 0.36, tessellation: 20 }, scene);
    fo.position = V3(x, 0.03, z); fo.material = chrome; fo.parent = root;
    world.shadowGens.forEach(sg => sg.addShadowCaster(seat));
    stools.push(V3(x, 0, z));

    // tabouret occupable (les places 0 et 4 sont prises par des clients)
    if (i !== 0 && i !== 4) {
      const h = B.MeshBuilder.CreateBox("stoolHit", { width: 0.5, height: 1.1, depth: 0.5 }, scene);
      h.position = V3(x, 0.75, z);
      h.isVisible = false;
      h.metadata = {
        interact: "seat", kind: "bar", spot: "bar:" + i, label: "S'asseoir au bar",
        eye: V3(x, 1.36, z), look: V3(x * 0.35 + (BX + 0.6) * 0.65, 1.45, BZ - 1.05),
      };
    }
  }

  // barman + deux clients accoudés
  // le barman est derrière le comptoir (BZ - 1.02) et doit regarder le client,
  // qui est devant (BZ + 1.3) : il faut donc le tourner vers +Z, d'où le PI.
  const barman = people.spawn(V3(BX + 0.6, 0, BZ - 1.02), Math.PI,
    { sex: "m", uniform: true, role: "bar", height: 1.78 });
  const patrons = [
    people.spawn(stools[0].clone(), Math.PI + 0.06, { seated: true, seatY: 0.84, height: 1.82, sex: "m" }),
    people.spawn(stools[4].clone(), Math.PI - 0.1, { seated: true, seatY: 0.84, height: 1.76 }),
  ];

  // zone d'interaction
  const hit = B.MeshBuilder.CreateBox("barHit", { width: BW, height: 2, depth: 2.2 }, scene);
  hit.position = V3(BX, 1, BZ + 1.3);
  hit.isVisible = false;
  hit.metadata = { interact: "bar", label: "Commander un verre (20 €)" };

  /* ------------------- verre tenu en main ------------------- */
  const camGlass = new B.TransformNode("camGlass", scene);
  const tumbler = B.MeshBuilder.CreateCylinder("tumbler", {
    height: 0.11, diameterTop: 0.072, diameterBottom: 0.062, tessellation: 24,
  }, scene);
  tumbler.material = pbr("tumblerM", scene, { color: C3(0.9, 0.95, 1), roughness: 0.015, metallic: 0.06, alpha: 0.3 });
  tumbler.parent = camGlass;
  const liquid = B.MeshBuilder.CreateCylinder("liq", { height: 0.062, diameter: 0.062, tessellation: 24 }, scene);
  liquid.position.y = -0.018;
  liquid.material = pbr("liqM", scene, {
    color: C3(0.55, 0.22, 0.04), roughness: 0.08, metallic: 0.0, alpha: 0.88,
    emissive: C3(0.16, 0.06, 0.01),
  });
  liquid.parent = camGlass;
  const ice = [];
  for (let i = 0; i < 3; i++) {
    const cube = B.MeshBuilder.CreateBox("ice", { size: 0.021 }, scene);
    cube.position = V3(rnd(-0.014, 0.014), rnd(-0.03, 0.0), rnd(-0.014, 0.014));
    cube.rotation = V3(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    cube.material = pbr("iceM", scene, { color: C3(0.9, 0.96, 1), roughness: 0.02, metallic: 0.02, alpha: 0.45 });
    cube.parent = camGlass; ice.push(cube);
  }
  camGlass.setEnabled(false);

  const api = {
    root, hit, barman, patrons, stools, camGlass,
    drinks: 0,
    tick(dt, playerPos) {
      barman.tick(dt, playerPos);
      patrons.forEach((p) => p.tick(dt));
      if (camGlass.isEnabled()) {
        const t = performance.now() / 1000;
        ice.forEach((c, i) => { c.rotation.y += dt * 0.3; c.position.y = -0.02 + Math.sin(t * 1.6 + i) * 0.004; });
      }
    },

    /** Séquence complète : commande, service, dégustation. */
    async serve(camera, ui) {
      barman.gesture(1.4);
      ui.toast("Le barman vous prépare un Old Fashioned…");
      audio.glass();
      await wait(700);
      audio.pour();
      await wait(2300);
      audio.glass();

      // le verre apparaît en main
      camGlass.parent = camera;
      camGlass.position = V3(0.26, -0.24, 0.45);
      camGlass.rotation = V3(0.15, -0.2, 0.1);
      camGlass.setEnabled(true);
      liquid.scaling.y = 1; liquid.position.y = -0.018;
      animVec(scene, camGlass, "position", V3(0.42, -0.5, 0.6), V3(0.26, -0.24, 0.45), 26);

      await wait(600);
      // gorgées
      for (let i = 0; i < 3; i++) {
        animVec(scene, camGlass, "position", camGlass.position, V3(0.07, -0.1, 0.3), 14);
        animVec(scene, camGlass, "rotation", camGlass.rotation, V3(-0.75, -0.2, 0.1), 14);
        audio.sip();
        await wait(620);
        const lvl = 1 - (i + 1) / 3.4;
        animFloat(scene, liquid, "scaling.y", liquid.scaling.y, lvl, 14);
        animFloat(scene, liquid, "position.y", liquid.position.y, -0.018 - (1 - lvl) * 0.031, 14);
        animVec(scene, camGlass, "position", V3(0.07, -0.1, 0.3), V3(0.26, -0.24, 0.45), 16);
        animVec(scene, camGlass, "rotation", V3(-0.75, -0.2, 0.1), V3(0.15, -0.2, 0.1), 16);
        await wait(700);
      }
      await wait(400);
      animVec(scene, camGlass, "position", camGlass.position, V3(0.45, -0.62, 0.6), 22);
      await wait(400);
      audio.glass();
      camGlass.setEnabled(false);
      camGlass.parent = null;
      this.drinks++;
      return this.drinks;
    },
  };
  return api;
}
