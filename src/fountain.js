/** Fontaine centrale : eau réfléchissante/réfractive (WaterMaterial),
 *  jets de particules GPU, brume, ondulations et éclairage caustique. */
import { V3, C3, pbr, gold, canvasTex, rnd } from "./util.js";
import { LAYOUT } from "./world.js";
const B = BABYLON;

export function buildFountain(scene, world) {
  const O = LAYOUT.fountain;
  const root = new B.TransformNode("fountain", scene);
  root.position = O.clone();

  const stoneMat = pbr("stone", scene, { color: C3(0.27, 0.26, 0.235), roughness: 0.6, metallic: 0.02 });
  const stoneDark = pbr("stoneD", scene, { color: C3(0.3, 0.31, 0.33), roughness: 0.45 });

  /* ---- bassin ---- */
  const basin = B.MeshBuilder.CreateCylinder("basin", {
    height: 0.85, diameter: 7.2, tessellation: 64,
  }, scene);
  basin.position = V3(O.x, 0.42, O.z);
  basin.material = stoneMat;
  basin.checkCollisions = true;
  basin.receiveShadows = true;

  const lip = B.MeshBuilder.CreateTorus("lip", { diameter: 7.2, thickness: 0.42, tessellation: 64 }, scene);
  lip.position = V3(O.x, 0.85, O.z);
  lip.material = stoneMat;

  const inner = B.MeshBuilder.CreateCylinder("inner", { height: 0.7, diameter: 6.5, tessellation: 64 }, scene);
  inner.position = V3(O.x, 0.5, O.z);
  inner.material = pbr("innerM", scene, { color: C3(0.09, 0.19, 0.2), roughness: 0.25 });

  /* ---- piédestal + vasques ---- */
  const ped = B.MeshBuilder.CreateCylinder("ped", { height: 1.5, diameterTop: 0.6, diameterBottom: 1.3, tessellation: 32 }, scene);
  ped.position = V3(O.x, 1.4, O.z); ped.material = stoneMat; ped.receiveShadows = true;

  const bowl1 = B.MeshBuilder.CreateCylinder("bowl1", { height: 0.24, diameterTop: 3.1, diameterBottom: 1.4, tessellation: 48 }, scene);
  bowl1.position = V3(O.x, 2.2, O.z); bowl1.material = stoneMat;
  const stem = B.MeshBuilder.CreateCylinder("stem", { height: 1.2, diameterTop: 0.35, diameterBottom: 0.6, tessellation: 24 }, scene);
  stem.position = V3(O.x, 2.9, O.z); stem.material = stoneMat;
  const bowl2 = B.MeshBuilder.CreateCylinder("bowl2", { height: 0.2, diameterTop: 1.8, diameterBottom: 0.7, tessellation: 40 }, scene);
  bowl2.position = V3(O.x, 3.6, O.z); bowl2.material = stoneMat;
  const finial = B.MeshBuilder.CreateSphere("finial", { diameter: 0.55, segments: 20 }, scene);
  finial.position = V3(O.x, 4.05, O.z); finial.material = gold(scene, 1);

  [ped, bowl1, bowl2, stem, finial, lip, basin].forEach((m) => world.casters.push(m));

  /* ---- surface d'eau (WaterMaterial) ---- */
  const water = B.MeshBuilder.CreateDisc("waterSurf", { radius: 3.24, tessellation: 96 }, scene);
  water.rotation.x = Math.PI / 2;
  water.position = V3(O.x, 0.72, O.z);

  let waterMat;
  if (B.WaterMaterial) {
    waterMat = new B.WaterMaterial("waterMat", scene, new B.Vector2(512, 512));
    waterMat.bumpTexture = new B.Texture("https://assets.babylonjs.com/textures/waterbump.png", scene);
    waterMat.windForce = -3;
    waterMat.waveHeight = 0.035;
    waterMat.bumpHeight = 0.42;
    waterMat.waveLength = 0.06;
    waterMat.waveSpeed = 42;
    waterMat.windDirection = new B.Vector2(1, 1);
    waterMat.colorBlendFactor = 0.32;
    waterMat.waterColor = C3(0.02, 0.14, 0.19);
    waterMat.alpha = 0.92;
    waterMat.backFaceCulling = false;
    // ce que l'eau reflète / réfracte
    [ped, bowl1, bowl2, stem, finial, lip, inner,
      scene.getMeshByName("dome"), scene.getMeshByName("ceil"), scene.getMeshByName("coffers")]
      .filter(Boolean).forEach((m) => waterMat.addToRenderList(m));
  } else {
    waterMat = pbr("waterFallback", scene, { color: C3(0.05, 0.3, 0.34), roughness: 0.03, metallic: 0.2, alpha: 0.85 });
  }
  water.material = waterMat;
  water.metadata = { water: true };

  // Petites vasques d'eau
  const w2 = B.MeshBuilder.CreateDisc("w2", { radius: 1.5, tessellation: 48 }, scene);
  w2.rotation.x = Math.PI / 2; w2.position = V3(O.x, 2.3, O.z); w2.material = waterMat;
  const w3 = B.MeshBuilder.CreateDisc("w3", { radius: 0.86, tessellation: 32 }, scene);
  w3.rotation.x = Math.PI / 2; w3.position = V3(O.x, 3.68, O.z); w3.material = waterMat;

  /* ---- nappes d'eau géométriques (cascades) ---- */
  // Une vraie nappe translucide à texture défilante rend bien mieux que des
  // particules seules : les gouttes viennent seulement s'y ajouter.
  const streak = canvasTex("streak", scene, 256, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    // voile continu : la nappe doit se lire même entre les filets
    c.fillStyle = "rgba(198,232,255,.05)"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, wd = rnd(1, 7), a = rnd(0.05, 0.42);
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `rgba(255,255,255,0)`);
      g.addColorStop(rnd(0.1, 0.3), `rgba(210,240,255,${a})`);
      g.addColorStop(rnd(0.6, 0.9), `rgba(190,230,255,${a * 0.7})`);
      g.addColorStop(1, `rgba(255,255,255,0)`);
      c.fillStyle = g; c.fillRect(x, 0, wd, h);
    }
    for (let i = 0; i < 500; i++) {
      c.fillStyle = `rgba(255,255,255,${rnd(0.03, 0.16)})`;
      c.fillRect(Math.random() * w, Math.random() * h, rnd(1, 3), rnd(3, 14));
    }
  }, { alpha: true, uScale: 6, vScale: 1.4 });

  const sheetMat = new B.StandardMaterial("sheetM", scene);
  sheetMat.diffuseTexture = streak;
  sheetMat.opacityTexture = streak;
  sheetMat.emissiveColor = C3(0.1, 0.16, 0.2);
  sheetMat.specularColor = C3(0.7, 0.85, 1);
  sheetMat.specularPower = 64;
  sheetMat.backFaceCulling = false;
  sheetMat.disableDepthWrite = true;

  function sheet(yTop, yBot, rTop, rBot) {
    const m = B.MeshBuilder.CreateCylinder("sheet", {
      height: yTop - yBot, diameterTop: rTop * 2, diameterBottom: rBot * 2,
      tessellation: 56, cap: B.Mesh.NO_CAP, sideOrientation: B.Mesh.DOUBLESIDE,
    }, scene);
    m.position = V3(O.x, (yTop + yBot) / 2, O.z);
    m.material = sheetMat;
    m.isPickable = false;
    return m;
  }
  const sheets = [
    sheet(3.62, 2.30, 0.88, 0.94),   // vasque haute -> vasque basse
    sheet(2.22, 0.80, 1.5, 1.62),    // vasque basse -> bassin
  ];
  let flow = 0;
  scene.onBeforeRenderObservable.add(() => {
    flow += scene.getEngine().getDeltaTime() / 1000;
    streak.vOffset = -flow * 1.9;
    streak.uOffset = Math.sin(flow * 0.3) * 0.02;
  });

  /* ---- particules : jets, cascades, brume ---- */
  const dropTex = new B.Texture("https://assets.babylonjs.com/textures/flare.png", scene);

  function jet(pos, dir, power, rate, size, life, color1, color2) {
    const ps = new B.ParticleSystem("jet", 2200, scene);
    ps.particleTexture = dropTex;
    ps.emitter = pos;
    ps.minEmitBox = V3(-0.03, 0, -0.03);
    ps.maxEmitBox = V3(0.03, 0, 0.03);
    ps.color1 = color1; ps.color2 = color2;
    ps.colorDead = new B.Color4(0.5, 0.75, 0.85, 0);
    ps.minSize = size * 0.5; ps.maxSize = size;
    ps.minLifeTime = life * 0.6; ps.maxLifeTime = life;
    ps.emitRate = rate;
    ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    ps.gravity = V3(0, -9.81, 0);
    ps.direction1 = dir.scale(power * 0.85).add(V3(-0.35, 0, -0.35));
    ps.direction2 = dir.scale(power * 1.15).add(V3(0.35, 0, 0.35));
    ps.minEmitPower = 0.9; ps.maxEmitPower = 1.15;
    ps.updateSpeed = 0.012;
    ps.start();
    return ps;
  }

  const jets = [];
  // jet central vertical (≈1 m de haut : il ne doit pas toucher le plafond)
  jets.push(jet(V3(O.x, 4.25, O.z), V3(0, 1, 0), 4.0, 1400, 0.045, 1.6,
    new B.Color4(0.75, 0.92, 1, 0.85), new B.Color4(0.95, 1, 1, 0.6)));

  function ringBase(name, y, rate, life, size, power) {
    const ps = new B.ParticleSystem(name, 2600, scene);
    ps.particleTexture = dropTex;
    ps.emitter = V3(O.x, y, O.z);
    ps.color1 = new B.Color4(0.72, 0.9, 1, 0.28);
    ps.color2 = new B.Color4(0.92, 1, 1, 0.18);
    ps.colorDead = new B.Color4(0.6, 0.8, 0.9, 0);
    ps.minSize = size * 0.5; ps.maxSize = size;
    ps.minLifeTime = life * 0.6; ps.maxLifeTime = life;
    ps.emitRate = rate;
    ps.gravity = V3(0, -9.81, 0);
    ps.minEmitPower = power * 0.85; ps.maxEmitPower = power * 1.15;
    ps.updateSpeed = 0.012;
    return ps;
  }
  // couronne de jets obliques (cône = radial + vertical)
  const crown = ringBase("crown", 3.74, 1600, 1.5, 0.038, 2.3);
  crown.createConeEmitter(0.8, Math.PI * 0.30);
  crown.start(); jets.push(crown);

  // rideaux d'eau qui débordent des vasques (cylindre, chute libre)
  const curtain1 = ringBase("curtain1", 3.6, 2000, 1.0, 0.034, 0.3);
  curtain1.createCylinderEmitter(1.58, 0.03, 0.05, 0);
  curtain1.start(); jets.push(curtain1);

  const curtain2 = ringBase("curtain2", 2.22, 1800, 0.95, 0.034, 0.28);
  curtain2.createCylinderEmitter(2.92, 0.03, 0.05, 0);
  curtain2.start(); jets.push(curtain2);
  // éclaboussures à la surface
  const splash = new B.ParticleSystem("splash", 1400, scene);
  splash.particleTexture = dropTex;
  splash.emitter = V3(O.x, 0.78, O.z);
  splash.createCylinderEmitter(3.0, 0.02, 0.9, 0);
  splash.color1 = new B.Color4(0.85, 0.95, 1, 0.6);
  splash.color2 = new B.Color4(1, 1, 1, 0.35);
  splash.colorDead = new B.Color4(1, 1, 1, 0);
  splash.minSize = 0.02; splash.maxSize = 0.07;
  splash.minLifeTime = 0.25; splash.maxLifeTime = 0.7;
  splash.emitRate = 420;
  splash.gravity = V3(0, -9.81, 0);
  splash.minEmitPower = 0.7; splash.maxEmitPower = 2.0;
  splash.updateSpeed = 0.014;
  splash.start();

  // brume
  const mist = new B.ParticleSystem("mist", 500, scene);
  mist.particleTexture = new B.Texture("https://assets.babylonjs.com/textures/cloud.png", scene);
  mist.emitter = V3(O.x, 1.4, O.z);
  mist.createCylinderEmitter(3.2, 2.4, 1, 0.1);
  mist.color1 = new B.Color4(0.65, 0.8, 0.95, 0.022);
  mist.color2 = new B.Color4(0.8, 0.9, 1, 0.015);
  mist.colorDead = new B.Color4(1, 1, 1, 0);
  mist.minSize = 1.4; mist.maxSize = 3.4;
  mist.minLifeTime = 2.4; mist.maxLifeTime = 5;
  mist.emitRate = 9;
  mist.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  mist.gravity = V3(0, 0.12, 0);
  mist.minEmitPower = 0.03; mist.maxEmitPower = 0.16;
  mist.start();

  /* ---- lumière subaquatique + caustiques animées ---- */
  const under = new B.PointLight("underWater", V3(O.x, 0.45, O.z), scene);
  under.diffuse = C3(0.35, 0.85, 1); under.intensity = 9; under.range = 7;

  const caustic = new B.NoiseProceduralTexture("caustic", 256, scene);
  caustic.octaves = 4; caustic.persistence = 1.1; caustic.animationSpeedFactor = 4;
  if (world.lights.fountain) {
    world.lights.fountain.projectionTexture = caustic;
    world.lights.fountain.projectionTextureLightNear = 1;
    world.lights.fountain.projectionTextureLightFar = 14;
  }

  // léger scintillement de la lumière subaquatique
  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    under.intensity = 8 + Math.sin(t * 2.1) * 2.2 + Math.sin(t * 5.7) * 1.4;
  });

  // pièces de monnaie au fond du bassin
  const coinMat = gold(scene, 1);
  for (let i = 0; i < 40; i++) {
    const a = rnd(0, 6.28), r = rnd(0.4, 2.9);
    const c = B.MeshBuilder.CreateCylinder("coin", { height: 0.006, diameter: 0.045, tessellation: 14 }, scene);
    c.position = V3(O.x + Math.cos(a) * r, 0.703, O.z + Math.sin(a) * r);
    c.rotation = V3(rnd(-0.15, 0.15), rnd(0, 6.28), rnd(-0.15, 0.15));
    c.material = coinMat;
  }

  return { root, water, waterMat, jets, splash, mist, center: O };
}
