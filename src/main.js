/** LE MIRAGE — casino 3D temps réel (Babylon.js 8 + Havok). Point d'entrée. */
import { V3, C3, fmt, wait, clamp } from "./util.js";
import { buildWorld, raiseLightLimit, LAYOUT } from "./world.js";
import { buildFountain } from "./fountain.js";
import { buildSlots } from "./slots.js";
import { buildBar } from "./bar.js";
import { Chips } from "./chips.js";
import { Cards } from "./cards.js";
import { buildBlackjack } from "./blackjack.js";
import { Player } from "./player.js";
import { People } from "./npc.js";
import { Audio } from "./audio.js";
import { Net } from "./net.js";

const B = BABYLON;
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ état */

const state = {
  cash: 2500,
  slotBet: 10,
  mode: "walk",     // walk | slot | table
  currentSlot: null,
  drinks: 0,
  spot: null,        // place assise revendiquee, partagee sur le reseau
};

/* --------------------------------------------------------------- chargement */

function setProgress(p, txt) {
  $("loadbar").style.width = p + "%";
  if (txt) $("loadtxt").textContent = txt;
}
const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/* --------------------------------------------------------------- démarrage */

async function boot() {
  const canvas = $("renderCanvas");
  const engine = new B.Engine(canvas, true, {
    stencil: true, antialias: true, powerPreference: "high-performance",
    preserveDrawingBuffer: false,
  });
  engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, 1.25));

  const scene = new B.Scene(engine);
  scene.collisionsEnabled = true;
  scene.gravity = new B.Vector3(0, -0.35, 0);
  scene.useRightHandedSystem = false;
  scene.blockMaterialDirtyMechanism = false;

  setProgress(6, "Moteur physique…");
  await frame();

  // ---- Havok ----
  let havokOK = true;
  try {
    // glue JS + .wasm servis par le MÊME paquet versionné (sinon LinkError)
    const HAVOK = "https://cdn.jsdelivr.net/npm/@babylonjs/havok@1.3.10/lib/esm/";
    const mod = await import(HAVOK + "HavokPhysics_es.js");
    const havok = await mod.default({ locateFile: (f) => HAVOK + f });
    scene.enablePhysics(new B.Vector3(0, -9.81, 0), new B.HavokPlugin(true, havok));
  } catch (e) {
    console.error("Havok indisponible", e);
    havokOK = false;
    throw new Error("Impossible de charger le moteur physique Havok (connexion au CDN Babylon requise).");
  }

  setProgress(18, "Construction du casino…");
  await frame();
  const world = buildWorld(scene);

  setProgress(34, "Fontaine…");
  await frame();
  const fountain = buildFountain(scene, world);

  setProgress(44, "Machines à sous…");
  await frame();
  const audio = new Audio();
  const machines = buildSlots(scene, world, audio);

  setProgress(54, "Personnages…");
  await frame();
  const people = await People.load(scene, world);

  setProgress(64, "Le bar…");
  await frame();
  const bar = buildBar(scene, world, audio, people);

  setProgress(70, "Jetons & cartes…");
  await frame();
  const chips = new Chips(scene, audio, world);
  const cards = new Cards(scene, audio, world);

  setProgress(82, "Table de blackjack…");
  await frame();

  // sol physique
  if (havokOK) {
    const pFloor = B.MeshBuilder.CreateBox("pFloor", { width: 60, height: 0.4, depth: 50 }, scene);
    pFloor.position.y = -0.2; pFloor.isVisible = false;
    new B.PhysicsAggregate(pFloor, B.PhysicsShapeType.BOX, { mass: 0, restitution: 0.1, friction: 0.9 }, scene);
  }

  const ui = makeUI();
  const bj = buildBlackjack(scene, world, audio, chips, cards, ui, state, people);

  setProgress(92, "Éclairage & post-traitement…");
  await frame();

  const player = new Player(scene, canvas, audio, LAYOUT.spawn);

  // ---- post-traitement ----
  const pipe = new B.DefaultRenderingPipeline("pipe", true, scene, [player.camera]);
  pipe.samples = 4;
  pipe.fxaaEnabled = true;
  pipe.bloomEnabled = true;
  pipe.bloomThreshold = 0.88;
  pipe.bloomWeight = 0.22;
  pipe.bloomKernel = 64;
  pipe.bloomScale = 0.6;
  pipe.imageProcessingEnabled = true;
  pipe.imageProcessing.toneMappingEnabled = true;
  pipe.imageProcessing.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
  pipe.imageProcessing.exposure = 1.3;
  pipe.imageProcessing.contrast = 1.12;
  pipe.imageProcessing.vignetteEnabled = true;
  pipe.imageProcessing.vignetteWeight = 2.6;
  pipe.imageProcessing.vignetteStretch = 0.4;
  pipe.imageProcessing.vignetteColor = new B.Color4(0, 0, 0, 0);
  pipe.grainEnabled = true;
  pipe.grain.intensity = 3;
  pipe.grain.animated = true;
  pipe.chromaticAberrationEnabled = true;
  pipe.chromaticAberration.aberrationAmount = 2.2;
  pipe.sharpenEnabled = true;
  pipe.sharpen.edgeAmount = 0.18;
  pipe.depthOfFieldEnabled = false;
  pipe.depthOfFieldBlurLevel = B.DepthOfFieldEffectBlurLevel.Medium;

  // occlusion ambiante
  let ssao = null;
  try {
    ssao = new B.SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.6, blurRatio: 1 }, [player.camera]);
    ssao.totalStrength = 1.05;
    ssao.radius = 0.9;
    ssao.expensiveBlur = true;
    ssao.samples = 12;
    ssao.maxZ = 40;
  } catch (e) { console.warn("SSAO2 non supporté", e); }

  // --- réflexions : une sonde rendue depuis l'intérieur du casino remplace
  // l'environnement HDR par défaut (qui est un extérieur : le sol de marbre
  // reflétait un ciel). Rendue quelques frames puis figée.
  const probe = new B.ReflectionProbe("probe", 256, scene, true);
  probe.position = V3(LAYOUT.fountain.x, 3.2, LAYOUT.fountain.z);
  probe.renderList.push(
    ...scene.meshes.filter((m) =>
      m.isVisible && m.isEnabled() && m.material &&
      !/^(card|chip|sheet|waterSurf|w2|w3)/.test(m.name))
  );
  probe.refreshRate = 1;
  scene.environmentTexture = probe.cubeTexture;
  scene.environmentIntensity = 1.7;
  setTimeout(() => { probe.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONCE; }, 1500);

  raiseLightLimit(scene, 6);

  // --- perf : la lumière de table est la seule à rafraîchir ses ombres chaque
  // frame (cartes et jetons bougent) ; les autres tous les 3 frames.
  world.shadowGens.forEach((sg, i) => {
    if (i > 0) sg.getShadowMap().refreshRate = 2;
  });
  scene.skipPointerMovePicking = true;
  engine.enableOfflineSupport = false;

  setProgress(100, "Prêt");
  await frame();

  /* ------------------------------------------------------------- boucle */

  /* ------------------------------------------------------------- réseau */

  // Multijoueur : purement optionnel. Sans serveur WebSocket en face, `Net`
  // retente en arrière-plan et le jeu tourne exactement comme avant.
  const net = new Net({
    scene, people, player,
    // position réelle de chaque place assise, pour poser l'avatar sur la chaise
    spotPos: (spot) => {
      if (!spot) return null;
      const [kind, i] = spot.split(":");
      const n = Number(i);
      if (kind === "blackjack") return bj.seatPos(n);
      if (kind === "bar") return bar.stools[n] || null;
      return null;
    },
    // la table est autoritaire côté serveur : on ne fait que la mettre en scène
    onTable: (st, evs) => bj.applyServer(st, evs, net.id),
    onCount: (n) => {
      const el = $("players");
      if (el) { el.hidden = n < 2; el.textContent = n + " joueurs"; }
    },
  });
  net.connect();

  /* ------------------------------------------------------------- boucle */

  let hovered = null, tick = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    player.update(dt);
    const p = player.position;
    net.tick(dt, state.spot);

    for (const m of machines) m.tick(dt);
    bj.tick(dt, p);
    bar.tick(dt, p);
    for (const c of cards.live) c.tick(dt);

    audio.setWaterDistance(B.Vector3.Distance(p, fountain.center));

    // visée / invite d'interaction (raycast throttlé)
    if (state.mode === "walk") {
      if ((tick++ & 3) === 0) hovered = player.pick(3.4);
      const m = hovered;
      if (m) {
        const busy = spotTaken(m);
        $("prompt").hidden = false;
        $("promptTxt").textContent = busy ? "Place déjà occupée" : m.label;
        $("crosshair").classList.toggle("hot", !busy);
      } else {
        $("prompt").hidden = true;
        $("crosshair").classList.remove("hot");
      }
    } else if (state.mode !== "stool") {
      $("prompt").hidden = true;
      $("crosshair").classList.remove("hot");
    }
  });

  engine.runRenderLoop(() => scene.render());
  addEventListener("resize", () => engine.resize());

  /* ------------------------------------------------------------- entrées */

  addEventListener("keydown", async (e) => {
    if (e.code === "KeyE" && state.mode === "walk" && hovered) {
      interact(hovered);
    } else if (e.code === "KeyE" && state.mode === "stool") {
      doDrink();
    } else if (e.code === "Escape") {
      if (state.mode === "table") leaveTable();
      else if (state.mode === "stool") standUp();
      else if (state.mode === "slot") leaveSlot();
    } else if (state.mode === "table") {
      // raccourcis blackjack
      if (e.code === "KeyH" || e.code === "KeyT") net.bj("hit");
      if (e.code === "KeyR" || e.code === "Space") net.bj("stand");
      if (e.code === "KeyD") net.bj("double");
      if (e.code === "Digit1") net.bj("bet", { value: 5 });
      if (e.code === "Digit2") net.bj("bet", { value: 25 });
      if (e.code === "Digit3") net.bj("bet", { value: 100 });
      if (e.code === "Digit4") net.bj("bet", { value: 500 });
    }
  });

  // molette : mise de la machine à sous
  addEventListener("wheel", (e) => {
    if (state.mode !== "slot") return;
    setSlotBet(state.slotBet + (e.deltaY < 0 ? 5 : -5));
  }, { passive: true });

  canvas.addEventListener("click", () => {
    if (state.mode === "walk" && !player.locked) player.lock();
  });

  /** Une place tenue par un AUTRE joueur ne peut pas être prise. */
  const spotTaken = (meta) => !!meta.spot && net.occupied().has(meta.spot);

  function interact(meta) {
    if (spotTaken(meta)) {
      audio.lose();
      ui.toast("Place déjà occupée", "lose");
      return;
    }
    audio.ui();
    if (meta.interact === "bar") return doDrink();
    if (meta.interact === "slot") return enterSlot(meta.target);
    if (meta.interact === "blackjack") return sitTable(meta.seat);
    if (meta.interact === "seat") return sitStool(meta);
  }

  /* ------------------------------------------------------------- tabourets */

  function sitStool(meta) {
    state.mode = meta.kind === "slot" ? "slot" : "stool";
    state.spot = meta.spot || null;
    document.exitPointerLock();
    player.sitView(meta.eye, meta.look, 1.0, null,
      { yaw: meta.kind === "slot" ? 0.7 : 1.1, up: 0.35, down: 0.35 });
    if (meta.kind === "slot") {
      state.currentSlot = meta.target;
      $("slotui").hidden = false;
      $("slotmsg").textContent = "MISEZ ET TIREZ LE LEVIER";
      setSlotBet(state.slotBet);
    } else {
      showPrompt("Commander un verre (20 €)");
    }
  }

  function showPrompt(txt) {
    $("prompt").hidden = false;
    $("promptTxt").textContent = txt;
  }

  function standUp() {
    $("slotui").hidden = true;
    $("prompt").hidden = true;
    state.currentSlot = null;
    state.spot = null;
    player.stand(() => { state.mode = "walk"; player.frozen = false; player.lock(); });
  }

  /* ------------------------------------------------------------- bar */

  let busy = false;
  async function doDrink() {
    if (busy) return;
    if (state.cash < 20) return ui.toast("Pas assez pour un verre…", "lose");
    busy = true;
    player.frozen = true;
    state.cash -= 20; ui.updateCash();
    document.exitPointerLock();
    await bar.serve(player.camera, ui);
    state.drinks++;
    $("drinkFx").classList.add("on");
    setTimeout(() => $("drinkFx").classList.remove("on"), 6000);
    ui.toast(state.drinks === 1 ? "Vous vous sentez chanceux…" : "Encore un ? Santé.", "win");
    busy = false;
    player.frozen = false;
    if (state.mode === "walk") player.lock();
    else if (state.mode === "stool") showPrompt("Commander un verre (20 €)");
  }

  /* ------------------------------------------------------------- machine à sous */

  function setSlotBet(v) {
    state.slotBet = clamp(Math.round(v / 5) * 5, 5, 200);
    $("slotbet").textContent = state.slotBet;
  }

  function enterSlot(machine) {
    state.mode = "slot";
    state.currentSlot = machine;
    player.frozen = true;
    document.exitPointerLock();
    $("slotui").hidden = false;
    $("slotmsg").textContent = "MISEZ ET TIREZ LE LEVIER";
    setSlotBet(state.slotBet);
  }
  function leaveSlot() {
    if (player.seated) return standUp();     // on était assis sur le tabouret
    state.mode = "walk";
    state.currentSlot = null;
    player.frozen = false;
    $("slotui").hidden = true;
    player.lock();
  }

  $("betup").onclick = () => { setSlotBet(state.slotBet + 5); audio.ui(); };
  $("betdown").onclick = () => { setSlotBet(state.slotBet - 5); audio.ui(); };
  $("spin").onclick = async () => {
    const m = state.currentSlot;
    if (!m || m.spinning) return;
    if (state.cash < state.slotBet) return ui.toast("Fonds insuffisants", "lose");
    state.cash -= state.slotBet; ui.updateCash();
    $("spin").disabled = true;
    $("slotmsg").textContent = "…";
    const r = await m.spin(state.slotBet);
    $("spin").disabled = false;
    if (!r) return;
    $("slotmsg").textContent = r.symbols.join("   ");
    if (r.win > 0) {
      state.cash += r.win; ui.updateCash();
      ui.toast((r.mult >= 10 ? "JACKPOT  " : "GAIN  ") + "+ " + fmt(r.win) + " €", "win");
    } else {
      ui.toast("Perdu — " + fmt(state.slotBet) + " €", "lose");
    }
  };

  /* ------------------------------------------------------------- blackjack */

  function sitTable(seat) {
    state.mode = "table";
    state.spot = Number.isInteger(seat) ? "blackjack:" + seat : null;
    document.exitPointerLock();
    $("bj").hidden = false;
    // mise au point sur sa propre main, sans flouter celle du croupier
    pipe.depthOfFieldEnabled = true;
    pipe.depthOfField.focalLength = 28;
    pipe.depthOfField.fStop = 4.5;
    pipe.depthOfField.focusDistance = 900;
    pipe.imageProcessing.vignetteWeight = 5.2;
    // ambiance « scène » : on baisse les lumières autour
    world.lights.slots.intensity = 34;
    world.lights.bar.intensity = 30;
    player.sit(bj.seatPos(seat), bj.tableCenter(), () => { bj.sit(seat); net.bj("sit", { seat }); });
  }

  function leaveTable() {
    if (bj.G.phase !== "betting" && bj.G.phase !== "idle") {
      ui.msg("Le coup est en cours…");
      return;
    }
    bj.leave(); net.bj("leave");
    $("bj").hidden = true;
    pipe.depthOfFieldEnabled = false;
    pipe.imageProcessing.vignetteWeight = 2.6;
    world.lights.slots.intensity = 80;
    world.lights.bar.intensity = 70;
    state.spot = null;
    player.stand(() => { state.mode = "walk"; player.lock(); });
  }

  document.querySelectorAll(".chipbtn").forEach((b) =>
    (b.onclick = () => { net.bj("bet", { value: parseInt(b.dataset.v, 10) }); audio.ui(); }));
  $("clearBet").onclick = () => net.bj("clearbet");
  $("hit").onclick = () => net.bj("hit");
  $("stand").onclick = () => net.bj("stand");
  $("double").onclick = () => net.bj("double");

  /* ------------------------------------------------------------- UI */

  function makeUI() {
    let toastTimer = null;
    return {
      updateCash() { $("cash").textContent = fmt(state.cash); },
      setBet(v) { $("betVal").textContent = fmt(v) + " €"; },
      setPlayerVal(v) { $("playerVal").textContent = v; },
      setDealerVal(v) { $("dealerVal").textContent = v; },
      msg(t) { $("bjmsg").textContent = t; },
      // plus de bouton « Distribuer » : la table part d'elle-même à la fin
      // des mises, côté serveur. Conservé en no-op pour les appelants.
      enableDeal() { },
      showBetPanel(on) { $("bjbet").hidden = !on; },
      showActions(on, opt = {}) {
        $("bjact").hidden = !on;
        $("double").disabled = !opt.canDouble;
      },
      toast(t, cls = "") {
        const el = $("toast");
        el.textContent = t;
        el.className = "show " + cls;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => (el.className = ""), 2600);
      },
    };
  }

  // hook de debug / test automatisé
  window.__game = {
    scene, engine, state, player, bj, chips, cards, bar, machines, fountain, world, pipe, ui,
    sitTable, leaveTable, enterSlot, leaveSlot, doDrink, sitStool, standUp,
  };

  /* ------------------------------------------------------------- lancement */

  $("startBtn").hidden = false;
  $("loadtxt").textContent = "";
  $("startBtn").onclick = () => {
    audio.init(); audio.resume();
    $("loader").classList.add("gone");
    setTimeout(() => ($("loader").style.display = "none"), 950);
    $("hud").hidden = false;
    ui.updateCash();
    setSlotBet(state.slotBet);
    player.lock();
    ui.toast("Bienvenue au Mirage");
  };
}

boot().catch((e) => {
  console.error(e);
  $("loadtxt").innerHTML = "Erreur de chargement :<br/>" + (e && e.message ? e.message : e);
});
