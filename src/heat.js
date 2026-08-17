/**
 * LA CHALEUR — le multiplicateur de série, rendu comme un incendie.
 *
 * Principe : le feu n'illustre pas le multiplicateur, il EST son affichage. Le
 * joueur ne lit pas « ×3 », il voit sa table brûler. Tout ce qui suit n'est
 * donc qu'une seule et même jauge, déclinée sur cinq canaux simultanés :
 *
 *   1. le bas de l'écran prend feu (automate à la Doom, tramé basse résolution
 *      puis étiré — c'est ce filtrage qui donne les langues de flamme molles) ;
 *   2. une teinte orangée envahit les bords ;
 *   3. l'air au-dessus du feutre se distord (post-traitement) ;
 *   4. des braises montent de la table ;
 *   5. le projecteur de table vire au rouge et se met à vaciller.
 *
 * Le palier vient TOUJOURS du serveur : ce module ne décide de rien, il rend.
 * Les transitions sont amorties (`cur` court après `tgt`) — un feu qui apparaît
 * d'un coup ne fait pas peur, un feu qui MONTE si.
 */
import { V3, C3, canvasTex, clamp, lerp } from "./util.js";
const B = BABYLON;

/* ------------------------------------------------------------------ paliers */

// Doit rester aligné sur HEAT dans server/blackjack.mjs — le serveur envoie
// l'index du palier, pas ses paramètres visuels, qui sont purement clients.
//
// Escalade voulue : TIÈDE ne fait que rougeoyer (aucune flamme), CHAUD pose
// les braises et chauffe le bas d'écran, les FLAMMES n'arrivent qu'à BRÛLANT.
// Une flamme dès la première main gagnée grillerait toute la montée.
const TIERS = [
  { band: 0.000, seed: 0.00, tint: 0.000, haze: 0.00, embers: 0, shake: 0.00, name: "", mult: 1 },
  { band: 0.000, seed: 0.00, tint: 0.045, haze: 0.00, embers: 14, shake: 0.00, name: "TIÈDE", mult: 1.2 },
  { band: 0.055, seed: 0.42, tint: 0.100, haze: 0.25, embers: 65, shake: 0.00, name: "CHAUD", mult: 1.5 },
  { band: 0.240, seed: 0.78, tint: 0.180, haze: 0.90, embers: 160, shake: 0.35, name: "BRÛLANT", mult: 2 },
  // INFERNO calmé après essai en jeu : l'écran doit brûler, pas devenir illisible
  { band: 0.340, seed: 0.92, tint: 0.235, haze: 1.30, embers: 220, shake: 0.60, name: "INFERNO", mult: 3 },
];

// Palette de feu classique : 37 crans, du transparent au blanc. L'indice 0 est
// TRANSPARENT et non noir — c'est ce qui fait que la flamme se fond dans la
// scène au lieu d'être posée sur un rectangle sombre.
const PAL = [
  [7, 7, 7, 0], [31, 7, 7, 34], [47, 15, 7, 74], [71, 15, 7, 112], [87, 23, 7, 144],
  [103, 31, 7, 170], [119, 31, 7, 190], [143, 39, 7, 206], [159, 47, 7, 217],
  [175, 63, 7, 226], [191, 71, 7, 233], [199, 71, 7, 239], [223, 79, 7, 243],
  [223, 87, 7, 247], [223, 87, 7, 250], [215, 95, 7, 252], [215, 95, 7, 254],
  [215, 103, 15, 255], [207, 111, 15, 255], [207, 119, 15, 255], [207, 127, 15, 255],
  [207, 135, 23, 255], [199, 135, 23, 255], [199, 143, 23, 255], [199, 151, 31, 255],
  [191, 159, 31, 255], [191, 159, 31, 255], [191, 167, 39, 255], [191, 167, 39, 255],
  [191, 175, 47, 255], [183, 175, 47, 255], [183, 183, 47, 255], [183, 183, 55, 255],
  [207, 207, 111, 255], [223, 223, 159, 255], [239, 239, 199, 255], [255, 255, 255, 255],
];
const PAL_TOP = PAL.length - 1;

// résolution de l'automate. Assez fine pour que les langues de flamme aient du
// détail, le reste du réalisme vient du DOUBLE PASSAGE flouté au report écran
// (un voile large + un cœur net) — c'est lui qui tue l'aspect pixel art.
const FW = 340, FH = 200;

/* ------------------------------------------------------- distorsion de chaleur */

const HAZE = "heatHaze";
B.Effect.ShadersStore[HAZE + "FragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float time;
uniform float amp;

void main(void) {
  // l'air ne tremble qu'au-dessus du feu : le masque s'éteint vers le haut
  float m = smoothstep(0.62, 0.0, vUV.y) * amp;
  vec2 o = vec2(
    sin(vUV.y * 44.0 + time * 3.3) * 0.0032 + sin(vUV.y * 17.0 - time * 1.7) * 0.0021,
    sin(vUV.x * 33.0 + time * 2.4) * 0.0024
  ) * m;
  vec4 c = texture2D(textureSampler, clamp(vUV + o, 0.0, 1.0));
  // un souffle de chaud dans les basses lumières, pour que la distorsion ne
  // soit pas qu'un tremblement gris
  c.rgb += vec3(0.10, 0.035, 0.0) * m;
  gl_FragColor = c;
}`;

/* ------------------------------------------------------------------ module */

/**
 * @param {object} o
 * @param {BABYLON.Scene} o.scene
 * @param {object} o.world      retour de buildWorld (lights, glow…)
 * @param {object} o.audio
 * @param {BABYLON.Camera} o.camera
 * @param {BABYLON.Vector3} o.feltCenter  centre du feutre, pour les braises
 */
export function createHeat({ scene, world, audio, camera, feltCenter }) {
  /* ---------------- calques DOM ---------------- */

  const fireEl = document.getElementById("fire");
  const tintEl = document.getElementById("heatTint");
  const badgeEl = document.getElementById("heatBadge");
  const multEl = document.getElementById("heatMult");
  const nameEl = document.getElementById("heatName");
  const flashEl = document.getElementById("goldFlash");

  const fctx = fireEl.getContext("2d", { alpha: true });
  // tampon de l'automate, redimensionné une fois pour toutes
  const src = document.createElement("canvas");
  src.width = FW; src.height = FH;
  const sctx = src.getContext("2d", { alpha: true, willReadFrequently: true });
  const img = sctx.createImageData(FW, FH);
  const buf = new Uint8Array(FW * FH);

  function resize() {
    // demi-résolution : la source fait 190×120, inutile de peindre en 4K
    fireEl.width = Math.max(2, Math.round(innerWidth / 2));
    fireEl.height = Math.max(2, Math.round(innerHeight / 2));
    fctx.imageSmoothingEnabled = true;
  }
  resize();
  addEventListener("resize", resize);

  /* ---------------- braises au-dessus du feutre ---------------- */

  const emberTex = canvasTex("ember", scene, 64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(255,240,200,1)");
    g.addColorStop(0.35, "rgba(255,150,40,.85)");
    g.addColorStop(1, "rgba(255,60,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });

  const embers = new B.ParticleSystem("embers", 400, scene);
  embers.particleTexture = emberTex;
  embers.emitter = feltCenter.clone();
  embers.createCylinderEmitter(0.95, 0.02, 0, 0);
  embers.minSize = 0.006; embers.maxSize = 0.026;
  embers.minLifeTime = 1.1; embers.maxLifeTime = 2.6;
  embers.minEmitPower = 0.14; embers.maxEmitPower = 0.5;
  embers.gravity = V3(0, 0.22, 0);          // les braises MONTENT
  embers.direction1 = V3(-0.1, 1, -0.1);
  embers.direction2 = V3(0.1, 1, 0.1);
  embers.color1 = new B.Color4(1, 0.62, 0.16, 1);
  embers.color2 = new B.Color4(1, 0.26, 0.02, 1);
  embers.colorDead = new B.Color4(0.5, 0.06, 0, 0);
  embers.blendMode = B.ParticleSystem.BLENDMODE_ADD;
  embers.emitRate = 0;
  embers.start();

  /* ---------------- distorsion ---------------- */

  let haze = null;
  try {
    haze = new B.PostProcess(HAZE, HAZE, ["time", "amp"], null, 1, camera);
    let ht = 0;
    haze.onApply = (eff) => {
      ht += scene.getEngine().getDeltaTime() / 1000;
      eff.setFloat("time", ht);
      eff.setFloat("amp", cur.haze);
    };
  } catch (e) { console.warn("distorsion de chaleur indisponible", e); }

  /* ---------------- lumière de table ---------------- */

  let lamp = world.lights.table;
  let lampBase = lamp.diffuse.clone();
  let lampI0 = lamp.intensity;
  const RED = C3(1, 0.34, 0.11);

  /* ---------------- état ---------------- */

  const blank = { band: 0, seed: 0, tint: 0, haze: 0, embers: 0, shake: 0 };
  let tier = 0;
  const tgt = { ...blank };
  const cur = { ...blank };
  let flare = 0;        // surchauffe ponctuelle (gain, montée de palier)
  let lampKick = 0;     // flash du projecteur de table (victoire)
  let t = 0;
  const shake = { x: 0, y: 0 };   // offset caméra courant, à défaire chaque frame
  let shakeScale = 1;             // réglage joueur (menu > VUE > secousses)

  function apply(n, { instant = false } = {}) {
    const T = TIERS[clamp(n, 0, TIERS.length - 1)];
    Object.assign(tgt, T);
    if (instant) Object.assign(cur, T);
    tier = n;
    // badge
    if (n > 0) {
      badgeEl.hidden = false;
      multEl.textContent = "×" + String(T.mult).replace(".", ",");
      nameEl.textContent = T.name;
      badgeEl.className = "t" + n;
    } else {
      badgeEl.hidden = true;
      badgeEl.className = "";
    }
  }

  /* ---------------- boucle ---------------- */

  function step(dt) {
    t += dt;
    // amortissement : le feu met ~0,6 s à rejoindre sa consigne
    const k = 1 - Math.pow(0.02, dt);
    for (const key of Object.keys(blank)) cur[key] = lerp(cur[key], tgt[key], k);
    flare = Math.max(0, flare - dt * 1.6);

    const boost = flare * flare;
    // le flare INTENSIFIE un feu existant, il n'en crée jamais : sans ça, la
    // première main gagnée faisait flamber l'écran alors que TIÈDE ne doit
    // que rougeoyer
    const hasFire = cur.band > 0.012;
    const seed = clamp(cur.seed + (hasFire ? boost * 0.4 : 0), 0, 1);
    const band = clamp(cur.band + (hasFire ? boost * 0.16 : 0), 0, 1);

    /* --- automate de feu --- */
    if (seed > 0.004) {
      const s = Math.round(PAL_TOP * seed);
      const base = (FH - 1) * FW;
      for (let x = 0; x < FW; x++) buf[base + x] = s;
      for (let y = FH - 1; y > 0; y--) {
        const row = y * FW;
        for (let x = 0; x < FW; x++) {
          const v = buf[row + x];
          if (v === 0) { buf[row - FW + x] = 0; continue; }
          const r = (Math.random() * 3) | 0;
          // le décalage horizontal fait ondoyer la flamme ; on le borne à la
          // ligne pour ne pas voir le feu « repasser » par l'autre bord
          const nx = clamp(x - r + 1, 0, FW - 1);
          buf[row - FW + nx] = v - (r & 1);
        }
      }
      const d = img.data;
      for (let i = 0; i < buf.length; i++) {
        const p = PAL[buf[i]], j = i * 4;
        d[j] = p[0]; d[j + 1] = p[1]; d[j + 2] = p[2]; d[j + 3] = p[3];
      }
      sctx.putImageData(img, 0, 0);
    } else if (buf[0] !== 0 || buf[buf.length - 1] !== 0) {
      buf.fill(0);
      sctx.clearRect(0, 0, FW, FH);
    }

    /* --- report à l'écran : deux passes additives ---
       1. un voile LARGEMENT flouté (la lueur, le corps gazeux de la flamme) ;
       2. un cœur légèrement flouté par-dessus (les langues, le détail).
       C'est la superposition des deux qui fait « vrai feu » — une seule passe
       nette rend l'automate pour ce qu'il est : des pixels. */
    const W = fireEl.width, H = fireEl.height;
    fctx.clearRect(0, 0, W, H);
    if (band > 0.004) {
      const h = H * band;
      fctx.globalCompositeOperation = "lighter";
      fctx.globalAlpha = clamp(band * 3.0, 0, 0.95);
      fctx.filter = "blur(" + Math.max(3, W * 0.016) + "px)";
      fctx.drawImage(src, 0, H - h, W, h);
      fctx.globalAlpha = clamp(band * 2.2, 0, 0.8);
      fctx.filter = "blur(" + Math.max(1, W * 0.0035) + "px)";
      fctx.drawImage(src, 0, H - h * 0.97, W, h * 0.97);
      fctx.filter = "none";
      fctx.globalAlpha = 1;
      fctx.globalCompositeOperation = "source-over";
    }

    /* --- teinte des bords --- */
    const tint = clamp(cur.tint + boost * 0.25, 0, 1);
    tintEl.style.opacity = tint.toFixed(3);

    /* --- lumière de table : vire au rouge et vacille --- */
    const red = clamp(cur.tint * 3.1, 0, 1);
    lamp.diffuse.copyFrom(B.Color3.Lerp(lampBase, RED, red));
    const flick = red > 0.02
      ? 1 + Math.sin(t * 23.7) * 0.045 * red + Math.sin(t * 8.3) * 0.07 * red
      : 1;
    lampKick = Math.max(0, lampKick - dt * 3.4);
    lamp.intensity = lampI0 * (1 + red * 0.5 + lampKick * 1.5) * flick;

    /* --- braises --- */
    embers.emitRate = cur.embers + boost * 320;

    /* --- secousse de caméra à haut palier --- */
    // On RETIRE l'offset de la frame précédente avant d'appliquer le nouveau.
    // Sans ça les additions successives ne s'annulent pas — un sinus ajouté
    // frame après frame est une marche aléatoire, et la caméra part en vrille.
    if (camera) {
      camera.rotation.x -= shake.x; camera.rotation.y -= shake.y;
      const a = (cur.shake * 0.0016 + boost * 0.004) * shakeScale;
      shake.x = a > 2e-5 ? Math.sin(t * 41.3) * a : 0;
      shake.y = a > 2e-5 ? Math.sin(t * 33.7) * a : 0;
      camera.rotation.x += shake.x; camera.rotation.y += shake.y;
    }
  }

  /* ---------------- API ---------------- */

  return {
    get tier() { return tier; },

    /**
     * Rattache la chaleur à UNE table : les braises montent de son feutre et
     * c'est SON projecteur qui rougit. Appelé quand le joueur s'assoit —
     * l'ancienne lampe est rendue à son état d'origine.
     */
    attachTable({ center, lamp: newLamp }) {
      if (center) embers.emitter = center.clone();
      if (newLamp && newLamp !== lamp) {
        lamp.diffuse.copyFrom(lampBase);
        lamp.intensity = lampI0;
        lamp = newLamp;
        lampBase = newLamp.diffuse.clone();
        lampI0 = newLamp.intensity;
      }
    },

    /** Palier annoncé par le serveur. `instant` pour un arrivant en cours. */
    set(n, opt) {
      const up = n > tier;
      apply(n, opt);
      if (up && !(opt && opt.instant)) {
        flare = 1;
        audio.heatUp?.(n);
      }
      audio.fire?.(TIERS[clamp(n, 0, TIERS.length - 1)].seed);
    },

    /** Amplitude des secousses de caméra, 0 = aucune (paramètre du joueur). */
    setShakeScale(k) { shakeScale = Math.max(0, k); },

    /** Coup de chaud ponctuel — un gain, une révélation. */
    flare(power = 1) { flare = Math.max(flare, power); },

    /** Le projecteur de la table s'embrase un instant — l'accent de la victoire. */
    flashLamp(power = 1) { lampKick = Math.max(lampKick, power); },

    /** La série casse : le feu s'effondre, d'autant plus fort qu'il était haut. */
    extinguish(fromTier = 0) {
      apply(0);
      audio.fire?.(0);
      if (fromTier > 0) {
        audio.extinguish?.(fromTier);
        // bouffée de fumée : les braises repartent une dernière fois puis meurent
        embers.color1 = new B.Color4(0.4, 0.4, 0.42, 0.8);
        embers.color2 = new B.Color4(0.2, 0.2, 0.22, 0.6);
        embers.emitRate = 120 * fromTier;
        setTimeout(() => {
          embers.color1 = new B.Color4(1, 0.62, 0.16, 1);
          embers.color2 = new B.Color4(1, 0.26, 0.02, 1);
        }, 900);
      }
    },

    /** Éclat doré — le gain, par opposition au feu qui n'est que la promesse. */
    gold(big = false) {
      flashEl.className = "";
      // reflow forcé, sinon rejouer la même classe ne relance pas l'animation
      void flashEl.offsetWidth;
      flashEl.className = big ? "on big" : "on";
      setTimeout(() => (flashEl.className = ""), big ? 1100 : 620);
    },

    /** Tout éteindre en quittant la table. */
    reset() {
      apply(0, { instant: true });
      flare = 0;
      audio.fire?.(0);
      tintEl.style.opacity = "0";
      fctx.clearRect(0, 0, fireEl.width, fireEl.height);
      buf.fill(0);
      lamp.diffuse.copyFrom(lampBase);
      lamp.intensity = lampI0;
      embers.emitRate = 0;
    },

    tick: step,
  };
}
