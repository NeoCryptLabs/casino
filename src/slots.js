/** Machines à sous : cabinets PBR, rouleaux 3D animés, levier, marquee néon, gains. */
import { V3, C3, pbr, gold, canvasTex, rnd, rndInt, pick, animFloat, wait } from "./util.js";
import { LAYOUT } from "./world.js";
const B = BABYLON;

// géométrie d'un rouleau (partagée par la texture et le maillage)
const REEL_D = 0.4;     // diamètre
const REEL_LEN = 0.2;   // largeur (le long de son axe)

/**
 * Décalage entre `rotation.x` et le cran affiché derrière la vitre.
 * Mesuré sur le maillage : à rotation.x = 0, le point face au joueur (+Z local)
 * tombe sur u = 0.75, soit la frontière entre deux crans. Pour centrer le cran
 * `t` il faut donc u = (t + 0.5)/n, d'où rotation.x = (t + 0.5)·pas + π/2.
 */
const REEL_FRONT = Math.PI / 2;

const SYMBOLS = [
  { g: "7", c: "#ff3b3b", pay: 60 },
  { g: "★", c: "#ffd24a", pay: 25 },
  { g: "♦", c: "#4ad1ff", pay: 14 },
  { g: "♣", c: "#63e08a", pay: 10 },
  { g: "♥", c: "#ff6f9e", pay: 8 },
  { g: "BAR", c: "#f5f0e0", pay: 18 },
  { g: "◆◆", c: "#c08bff", pay: 6 },
  { g: "$", c: "#8bff9e", pay: 4 },
];

/**
 * Bande de rouleau. Sur le flanc d'un cylindre Babylon, u fait le tour de la
 * circonférence et v court le long de l'axe. Le rouleau étant couché
 * (rotation.z = π/2), u devient la VERTICALE de l'écran et v l'horizontale :
 * les symboles doivent donc être dessinés tournés d'un quart de tour pour
 * apparaître droits derrière la vitre.
 */
function reelTexture(scene) {
  return canvasTex("reel", scene, 2048, 256, (c, w, h) => {
    const n = SYMBOLS.length, cw = w / n;
    // un cran occupe cw px en u (= l'arc, vertical) et h px en v (= la largeur
    // du rouleau) : on compense le rapport pour ne pas étirer les glyphes
    const SQUASH = (Math.PI * REEL_D / n) / REEL_LEN;
    for (let i = 0; i < n; i++) {
      const s = SYMBOLS[i];
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#fbf7ec"); g.addColorStop(0.5, "#fffdf6"); g.addColorStop(1, "#e2dccb");
      c.fillStyle = g; c.fillRect(i * cw, 0, cw, h);
      c.strokeStyle = "rgba(0,0,0,.25)"; c.lineWidth = 4;
      c.strokeRect(i * cw + 2, 2, cw - 4, h - 4);
      c.save();
      c.translate(i * cw + cw / 2, h / 2);
      c.rotate(Math.PI / 2);          // quart de tour : glyphe droit sur le rouleau
      c.scale(SQUASH, 1);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "700 " + (s.g.length > 2 ? 96 : 150) + "px 'Futura',Georgia,sans-serif";
      c.shadowColor = "rgba(0,0,0,.4)"; c.shadowBlur = 10; c.shadowOffsetY = 5;
      c.fillStyle = s.c;
      c.fillText(s.g, 0, 6);
      c.restore();
    }
  });
}

function marqueeTexture(scene, title, hue) {
  return canvasTex("mq" + title, scene, 1024, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `hsl(${hue},80%,22%)`); g.addColorStop(1, `hsl(${hue + 30},90%,10%)`);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.font = "700 116px 'Futura',sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.shadowColor = `hsl(${hue},100%,60%)`; c.shadowBlur = 45;
    c.fillStyle = "#fff6dc"; c.fillText(title, w / 2, h / 2);
    c.fillText(title, w / 2, h / 2);
    for (let i = 0; i < 34; i++) {
      c.beginPath(); c.arc(20 + i * 30, 22, 8, 0, 7);
      c.fillStyle = i % 2 ? "#ffd76a" : "#ff7a4a"; c.shadowBlur = 22; c.fill();
      c.beginPath(); c.arc(20 + i * 30, h - 22, 8, 0, 7); c.fill();
    }
  }, { mirror: true });
}

function screenTexture(scene) {
  return canvasTex("scr", scene, 512, 512, (c, w, h) => {
    c.fillStyle = "#08111c"; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      c.fillStyle = `hsla(${rnd(180, 300)},90%,60%,${rnd(0.05, 0.25)})`;
      c.fillRect(rnd(0, w), rnd(0, h), rnd(10, 120), rnd(2, 10));
    }
    c.font = "700 54px 'Futura',sans-serif"; c.textAlign = "center";
    c.fillStyle = "#ffd76a"; c.fillText("JACKPOT", w / 2, 130);
    c.fillStyle = "#7ef0ff"; c.font = "700 78px 'Futura',sans-serif";
    c.fillText("48 720 €", w / 2, 230);
    c.fillStyle = "#f5f5f5"; c.font = "34px 'Futura',sans-serif";
    c.fillText("MISEZ POUR JOUER", w / 2, 340);
    c.fillText("★ ★ ★", w / 2, 410);
  }, { flip180: true });
}

const TITLES = ["MIRAGE", "GOLD RUSH", "LUCKY 7", "DIAMOND", "NEON CITY", "PHARAON", "WILD WEST", "MEGA WIN", "ROYALE", "TIKI FEVER", "DRAGON", "STARDUST"];

/** Ressources partagées entre toutes les machines (une seule fois). */
let SHARED = null;
function shared(scene) {
  if (SHARED) return SHARED;
  const reelTex = reelTexture(scene);
  const scrTex = screenTexture(scene);
  const scrMat = new B.StandardMaterial("scrM", scene);
  scrMat.diffuseTexture = scrTex; scrMat.emissiveTexture = scrTex;
  scrMat.emissiveColor = C3(0.55, 0.55, 0.55); scrMat.disableLighting = true;
  const reelMat = pbr("reelM", scene, { color: C3(1, 1, 1), roughness: 0.42 });
  reelMat.baseTexture = reelTex;
  SHARED = {
    reelMat, scrMat,
    body: pbr("slotBody", scene, { color: C3(0.06, 0.06, 0.08), roughness: 0.32, metallic: 0.35 }),
    glass: pbr("glassS", scene, { color: C3(0.7, 0.85, 1), roughness: 0.03, metallic: 0.1, alpha: 0.07 }),
    chrome: pbr("slotChrome", scene, { color: C3(0.85, 0.85, 0.88), metallic: 1, roughness: 0.12 }),
    knob: pbr("knobM", scene, { color: C3(0.75, 0.05, 0.06), roughness: 0.2, metallic: 0.2 }),
    btn: pbr("btnM", scene, { color: C3(0.8, 0.1, 0.1), emissive: C3(0.9, 0.15, 0.05) }),
    marquee: new Map(),
    flare: new B.Texture("https://assets.babylonjs.com/textures/flare.png", scene),
  };
  return SHARED;
}
function marqueeMat(scene, title, hue) {
  const S = shared(scene);
  if (!S.marquee.has(title)) {
    const m = new B.StandardMaterial("mqM" + title, scene);
    const t = marqueeTexture(scene, title, hue);
    m.diffuseTexture = t; m.emissiveTexture = t;
    m.emissiveColor = C3(0.62, 0.62, 0.62); m.disableLighting = true;
    S.marquee.set(title, m);
  }
  return S.marquee.get(title);
}

export class SlotMachine {
  constructor(scene, world, audio, pos, rotY, title, hue, index) {
    this.scene = scene; this.world = world; this.audio = audio;
    this.index = index;
    this.spinning = false;
    this.stops = [0, 0, 0];
    const root = new B.TransformNode("slot" + index, scene);
    root.position = pos.clone(); root.rotation.y = rotY;
    this.root = root;

    const S = shared(scene);
    const bodyMat = S.body;
    const trimMat = gold(scene, 0.95);

    const add = (m, mat) => { m.parent = root; m.material = mat; world.shadowGens.forEach(sg => sg.addShadowCaster(m)); m.receiveShadows = true; return m; };

    // socle
    const base = add(B.MeshBuilder.CreateBox("b", { width: 0.78, height: 0.95, depth: 0.72 }, scene), bodyMat);
    base.position.y = 0.475;
    // console inclinée
    const desk = add(B.MeshBuilder.CreateBox("d", { width: 0.78, height: 0.16, depth: 0.42 }, scene), bodyMat);
    desk.position.set(0, 1.02, 0.2); desk.rotation.x = -0.28;
    // corps haut
    const upper = add(B.MeshBuilder.CreateBox("u", { width: 0.78, height: 1.0, depth: 0.5 }, scene), bodyMat);
    upper.position.set(0, 1.52, -0.1);
    // marquee
    const mq = add(B.MeshBuilder.CreateBox("mq", { width: 0.82, height: 0.34, depth: 0.16 }, scene), marqueeMat(scene, title, hue));
    mq.position.set(0, 2.18, -0.06);

    // liserés lumineux
    const glowMat = pbr("slotGlow" + index, scene, {
      color: C3(0.1, 0.1, 0.1), emissive: C3(...hslToRgb(hue / 360, 0.9, 0.55)).scale(2.2),
    });
    for (const s of [-1, 1]) {
      const strip = add(B.MeshBuilder.CreateBox("st", { width: 0.035, height: 1.9, depth: 0.035 }, scene), glowMat);
      strip.position.set(s * 0.4, 1.3, 0.24);
    }
    this.glowMat = glowMat;

    // vitre + rouleaux
    const win = add(B.MeshBuilder.CreateBox("win", { width: 0.66, height: 0.46, depth: 0.04 }, scene), S.glass);
    win.position.set(0, 1.62, 0.16);

    const reelMat = S.reelMat;
    this.reels = [];
    for (let i = 0; i < 3; i++) {
      const r = B.MeshBuilder.CreateCylinder("r", { height: REEL_LEN, diameter: REEL_D, tessellation: 72 }, scene);
      r.parent = root;
      r.position.set((i - 1) * 0.215, 1.62, -0.02);
      r.rotation.z = Math.PI / 2;
      r.material = reelMat;
      r.rotation.x = rnd(0, 6.28);
      this.reels.push({ mesh: r, vel: 0, target: null });
    }

    // écran du bas
    const scr = add(B.MeshBuilder.CreatePlane("scr", { width: 0.62, height: 0.34 }, scene), S.scrMat);
    scr.position.set(0, 1.12, 0.253); scr.rotation.x = -0.02;

    // boutons
    for (let i = 0; i < 4; i++) {
      const btn = add(B.MeshBuilder.CreateCylinder("btn", { height: 0.03, diameter: 0.08, tessellation: 16 }, scene), S.btn);
      btn.position.set(-0.24 + i * 0.16, 1.075, 0.31); btn.rotation.x = -0.28;
    }

    // levier
    const lp = new B.TransformNode("leverPivot", scene);
    lp.parent = root; lp.position.set(0.47, 1.05, 0.06);
    const arm = B.MeshBuilder.CreateCylinder("lever", { height: 0.42, diameter: 0.035 }, scene);
    arm.parent = lp; arm.position.y = 0.21; arm.material = S.chrome;
    const knob = B.MeshBuilder.CreateSphere("knob", { diameter: 0.11, segments: 14 }, scene);
    knob.parent = lp; knob.position.y = 0.44; knob.material = S.knob;
    world.shadowGens.forEach(sg => { sg.addShadowCaster(arm); sg.addShadowCaster(knob); });
    this.lever = lp;

    // bac à monnaie
    const tray = add(B.MeshBuilder.CreateBox("tray", { width: 0.5, height: 0.1, depth: 0.2 }, scene), trimMat);
    tray.position.set(0, 0.55, 0.4);

    // zone d'interaction
    const hit = B.MeshBuilder.CreateBox("slotHit", { width: 1.0, height: 2.2, depth: 1.6 }, scene);
    hit.parent = root; hit.position.set(0, 1.1, 0.5); hit.isVisible = false;
    hit.isPickable = true;
    hit.metadata = { interact: "slot", label: "Jouer à la machine à sous", target: this };
    this.hit = hit;
    base.checkCollisions = true; upper.checkCollisions = true;

    // particules de pièces (gains)
    this.coinPS = new B.ParticleSystem("coins" + index, 400, scene);
    this.coinPS.particleTexture = S.flare;
    this.coinPS.emitter = root.position.add(V3(0, 0.7, 0.4));
    this.coinPS.color1 = new B.Color4(1, 0.85, 0.3, 1);
    this.coinPS.color2 = new B.Color4(1, 0.6, 0.1, 1);
    this.coinPS.colorDead = new B.Color4(0.6, 0.4, 0, 0);
    this.coinPS.minSize = 0.03; this.coinPS.maxSize = 0.09;
    this.coinPS.minLifeTime = 0.5; this.coinPS.maxLifeTime = 1.2;
    this.coinPS.emitRate = 500; this.coinPS.gravity = V3(0, -9.81, 0);
    this.coinPS.direction1 = V3(-1.5, 4, -1); this.coinPS.direction2 = V3(1.5, 6, 1);
    this.coinPS.minEmitPower = 0.5; this.coinPS.maxEmitPower = 1.2;
    this.coinPS.blendMode = B.ParticleSystem.BLENDMODE_ADD;

    this.hue = hue;
    this._t = rnd(0, 10);
    // certaines machines tournent toutes seules (ambiance)
    this.demo = index % 3 === 1;
  }

  /**
   * Volume de CETTE machine pour le joueur, 0..1.
   *
   * Deux verrous, et il en faut deux. Les machines en démo (une sur trois)
   * relancent leurs rouleaux toutes seules en permanence : elles doivent être
   * MUETTES, sinon leurs crans claquent en boucle dans toute la salle même
   * quand on ne joue pas. Et une machine qu'on joue reste locale : au-delà de
   * 7 m on ne l'entend plus, ce qui protège aussi des spins des autres joueurs.
   */
  vol() {
    if (this.demo) return 0;
    if (!this._dist) return 1;                 // pas encore de position joueur
    return Math.max(0, 1 - this._dist / 7) ** 2;
  }

  tick(dt, playerPos) {
    this._t += dt;
    if (playerPos) this._dist = B.Vector3.Distance(playerPos, this.root.position);
    // pulsation des néons
    const p = 0.6 + 0.4 * Math.sin(this._t * 2.4 + this.index);
    this.glowMat.emissiveColor = C3(...hslToRgb(this.hue / 360, 0.9, 0.35 + p * 0.3)).scale(0.8);

    for (const r of this.reels) {
      if (r.vel !== 0) {
        r.mesh.rotation.x += r.vel * dt;
        if (r.target !== null) {
          r.vel *= Math.pow(0.14, dt);
          if (r.vel < 1.6) {
            // accrochage sur le cran, centré derrière la vitre
            const TAU = Math.PI * 2;
            const step = TAU / SYMBOLS.length;
            const want = (((r.target + 0.5) * step + REEL_FRONT) % TAU + TAU) % TAU;
            let cur = r.mesh.rotation.x % (Math.PI * 2);
            if (cur < 0) cur += Math.PI * 2;
            let diff = want - cur;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            r.mesh.rotation.x += diff * Math.min(1, dt * 9);
            if (Math.abs(diff) < 0.012) {
              r.mesh.rotation.x = want; r.vel = 0; r.target = null;
              this.audio.reelStop(this.vol());
            }
          }
        }
      } else if (this.demo && Math.random() < dt * 0.12) {
        r.vel = rnd(9, 16);
        r.target = rndInt(0, SYMBOLS.length - 1);
      }
    }
  }

  /** Tire le levier et lance les rouleaux. Retourne {symbols, mult}. */
  async spin(bet) {
    if (this.spinning) return null;
    this.spinning = true;
    this.demo = false;
    this.audio.lever(this.vol());
    animFloat(this.scene, this.lever, "rotation.x", 0, 0.95, 8, true, () =>
      animFloat(this.scene, this.lever, "rotation.x", 0.95, 0, 26));

    await wait(180);
    this.audio.reelLoop(true, this.vol());

    // tirage pondéré : les gros symboles sont rares
    const roll = () => {
      const w = SYMBOLS.map((s, i) => 1 / (s.pay * 0.35 + 1));
      const tot = w.reduce((a, b) => a + b, 0);
      let x = Math.random() * tot;
      for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) return i; }
      return 0;
    };
    let res = [roll(), roll(), roll()];
    // léger coup de pouce : parfois on force une quasi-victoire
    if (Math.random() < 0.14) res[2] = res[0];
    if (Math.random() < 0.055) res = [res[0], res[0], res[0]];
    this.stops = res;

    for (let i = 0; i < 3; i++) {
      this.reels[i].vel = rnd(26, 34);
      this.reels[i].target = null;
    }
    for (let i = 0; i < 3; i++) {
      await wait(700 + i * 520);
      this.reels[i].target = res[i];
    }
    await wait(900);
    this.audio.reelLoop(false);
    this.spinning = false;

    // gains
    let mult = 0;
    if (res[0] === res[1] && res[1] === res[2]) mult = SYMBOLS[res[0]].pay;
    else if (res[0] === res[1] || res[1] === res[2] || res[0] === res[2]) mult = 0.5;
    const win = Math.round(bet * mult);
    if (win > 0) {
      this.coinPS.start();
      setTimeout(() => this.coinPS.stop(), mult >= 10 ? 2200 : 700);
      this.audio.slotWin(mult >= 10, this.vol());
    } else {
      this.audio.slotLose(this.vol());
    }
    return { symbols: res.map((i) => SYMBOLS[i].g), win, mult };
  }
}

function hslToRgb(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

export function buildSlots(scene, world, audio) {
  const machines = [];
  let i = 0;
  // deux îlots dos-à-dos, orientés vers les allées
  for (const [zRow, dir] of [[-6.5, 1], [-6.5, -1], [5.5, 1], [5.5, -1]]) {
    for (let k = 0; k < 5; k++) {
      const x = -18.5 + k * 2.0;
      const z = zRow + dir * 0.42;
      const m = new SlotMachine(scene, world, audio,
        V3(x, 0, z), dir > 0 ? 0 : Math.PI,
        TITLES[i % TITLES.length], (i * 47) % 360, i);
      machines.push(m); i++;
    }
  }
  // la machine libre, mise en avant, face à l'allée principale
  const free = new SlotMachine(scene, world, audio, V3(-11.2, 0, 0.4), Math.PI / 2 + 0.15, "LE MIRAGE", 42, 99);
  free.demo = false;
  free.isFree = true;
  free.hit.metadata.label = "Jouer — machine libre";
  machines.push(free);

  // tabourets
  const stoolMat = pbr("stoolM", scene, { color: C3(0.35, 0.06, 0.09), roughness: 0.75 });
  const legMat = pbr("legM", scene, { color: C3(0.5, 0.5, 0.55), metallic: 1, roughness: 0.25 });
  for (const m of machines) {
    const f = m.root.getDirection(new B.Vector3(0, 0, 1));
    const p = m.root.position.add(f.scale(1.15));
    const seat = B.MeshBuilder.CreateCylinder("seat", { height: 0.09, diameter: 0.36, tessellation: 20 }, scene);
    seat.position = V3(p.x, 0.66, p.z); seat.material = stoolMat;
    const leg = B.MeshBuilder.CreateCylinder("leg", { height: 0.62, diameter: 0.06 }, scene);
    leg.position = V3(p.x, 0.31, p.z); leg.material = legMat;
    const foot = B.MeshBuilder.CreateCylinder("foot", { height: 0.04, diameter: 0.34, tessellation: 20 }, scene);
    foot.position = V3(p.x, 0.03, p.z); foot.material = legMat;
    world.shadowGens.forEach(sg => sg.addShadowCaster(seat));

    // s'asseoir devant la machine
    const h = B.MeshBuilder.CreateBox("stoolHit", { width: 0.5, height: 1.1, depth: 0.5 }, scene);
    h.position = V3(p.x, 0.7, p.z);
    h.isVisible = false;
    const screenPos = m.root.position.add(f.scale(0.25)); screenPos.y = 1.45;
    h.metadata = {
      interact: "seat", kind: "slot", target: m, label: "S'asseoir et jouer",
      eye: V3(p.x, 1.28, p.z), look: screenPos,
    };
  }

  return machines;
}

export { SYMBOLS };
