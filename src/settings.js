/**
 * LES PARAMÈTRES — un registre unique, déclaratif, persistant.
 *
 * Chaque réglage est UNE entrée de `DEFS` : son groupe, son libellé, son type,
 * sa valeur par défaut, et surtout `apply(valeur, ctx)` — le seul endroit qui
 * touche au moteur. Le menu (src/menu.js) se construit tout seul à partir de
 * cette liste : ajouter un réglage à venir = ajouter une entrée ici, rien
 * d'autre. Les valeurs sont relues du navigateur au démarrage et appliquées
 * une fois le monde construit (`settings.bind(ctx)`).
 *
 * ctx = { engine, scene, player, world, pipe, ssao, audio, heat, net }
 */

import { MOBILE, thawMats } from "./util.js";

const STORE = "mirage.settings.v1";
// marqueur du recalage Windows (voir constructeur) : posé une fois, jamais relu
const WIN_TUNED = "mirage.winTuned.v1";

export const GROUPS = [
  { id: "image", label: "IMAGE" },
  { id: "vue", label: "VUE" },
  { id: "audio", label: "AUDIO" },
  { id: "jeu", label: "JEU" },
];

/** raccourci : les constantes de rafraîchissement des cartes d'ombres */
const RT = () => BABYLON.RenderTargetTexture;

export const DEFS = [
  /* ------------------------------------------------------------- IMAGE */
  {
    key: "resolution", group: "image", type: "enum",
    label: "Qualité de rendu", hint: "résolution interne",
    // Mobile : BASSE (GPU de téléphone). Ailleurs, pleine qualité — les
    // dégradations Windows ont sauté avec le correctif des blocs uniformes.
    def: MOBILE ? 0.75 : 1.25,
    options: [
      { v: 0.75, label: "BASSE" },
      { v: 1, label: "NORMALE" },
      { v: 1.25, label: "HAUTE" },
      { v: 2, label: "ULTRA" },
    ],
    apply(v, { engine }) {
      engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio || 1, v));
    },
  },
  {
    key: "shadows", group: "image", type: "enum",
    label: "Ombres", hint: "lustres, projecteurs, table",
    def: MOBILE ? "low" : "high",
    options: [
      { v: "off", label: "AUCUNE" },
      { v: "low", label: "BASSES" },
      { v: "high", label: "HAUTES" },
    ],
    apply(v, { world }) {
      // activer/couper une ombre change les defines d'éclairage : les
      // matériaux gelés (util.freezeMat) doivent pouvoir recompiler
      thawMats();
      const on = v !== "off";
      world.shadowGens.forEach((sg, i) => {
        const light = sg.getLight?.();
        if (light) light.shadowEnabled = on;
        const map = sg.getShadowMap();
        if (!map) return;
        // [0] = la table principale : cartes et jetons bougent, elle se
        // rafraîchit le plus souvent. Les autres sont du décor.
        // BASSES : bar/fontaine/machines ([1..3]) sont rendus UNE fois puis
        // FIGÉS — c'est du décor, il ne bouge pas ; world.refreshShadows()
        // (main.js) re-rend à la demande (chargements tardifs, éditeur).
        // Les TROIS tables ([0], [4], [5]) restent vivantes : cartes et
        // jetons y bougent dès qu'on s'y assied.
        const table = i === 0 || i >= 4;
        map.refreshRate = !on ? RT().REFRESHRATE_RENDER_ONCE
          : v === "high" ? (i ? 2 : 1)
          : table ? (i ? 4 : 2) : RT().REFRESHRATE_RENDER_ONCE;
      });
    },
  },
  {
    key: "ssao", group: "image", type: "toggle",
    label: "Occlusion ambiante", hint: "contact au sol, coûteux",
    def: !MOBILE,
    apply(v, ctx) {
      const { scene, ssao, player } = ctx;
      if (!ssao) return;
      const cur = ctx._ssaoOn !== false;      // créée attachée
      if (!!v === cur) return;
      const mgr = scene.postProcessRenderPipelineManager;
      if (v) mgr.attachCamerasToRenderPipeline("ssao", player.camera);
      else mgr.detachCamerasFromRenderPipeline("ssao", player.camera);
      ctx._ssaoOn = !!v;
    },
  },
  {
    key: "bloom", group: "image", type: "toggle",
    label: "Halo lumineux", hint: "rayonnement des lustres",
    def: true,
    apply(v, { pipe }) { pipe.bloomEnabled = !!v; },
  },
  {
    key: "film", group: "image", type: "toggle",
    label: "Effets pellicule", hint: "grain et aberration chromatique",
    def: true,
    apply(v, { pipe }) {
      pipe.grainEnabled = !!v;
      pipe.chromaticAberrationEnabled = !!v;
    },
  },
  {
    // Séparé de « Effets pellicule » : les halos éblouissent alors que le grain
    // et l'aberration ne gênent pas. Les mêler forçait à tout couper pour se
    // débarrasser des seules traînées. Éteint par défaut.
    key: "flare", group: "image", type: "toggle",
    label: "Halos anamorphiques", hint: "traînées lumineuses sur les sources vives",
    def: false,
    apply(v, { pipe }) { pipe.lensFlareEnabled = !!v; },
  },

  /* --------------------------------------------------------------- VUE */
  {
    key: "fov", group: "vue", type: "range",
    label: "Champ de vision", hint: "vertical",
    def: 60, min: 50, max: 95, step: 1, unit: "°",
    apply(v, { player }) { player.setBaseFov((v * Math.PI) / 180); },
  },
  {
    key: "sensitivity", group: "vue", type: "range",
    label: "Sensibilité de la souris",
    def: 100, min: 20, max: 300, step: 5, unit: "%",
    apply(v, { player }) { player.camera.angularSensibility = 1400 / (v / 100); },
  },
  {
    key: "invertY", group: "vue", type: "toggle",
    label: "Inverser l'axe vertical",
    def: false,
    apply(v, { player }) { player.invertY = !!v; },
  },
  {
    key: "headbob", group: "vue", type: "range",
    label: "Balancement de marche",
    def: 100, min: 0, max: 150, step: 10, unit: "%",
    apply(v, { player }) { player.bobScale = v / 100; },
  },
  {
    key: "shake", group: "vue", type: "range",
    label: "Secousses d'écran", hint: "paliers de chaleur",
    def: 100, min: 0, max: 150, step: 10, unit: "%",
    apply(v, { heat }) { heat.setShakeScale(v / 100); },
  },

  /* ------------------------------------------------------------- AUDIO */
  // AMBIANCE SONORE et son volume : `hidden` les retire du panneau des
  // paramètres — ils vivent à la porte, dans le menu principal (menu.js).
  {
    key: "music", group: "audio", type: "enum", hidden: true,
    label: "Ambiance sonore", hint: "le fond sonore de la salle",
    def: "midnight_lullaby",
    options: [
      { v: "midnight_lullaby", label: "NOCTURNE" },
      { v: "midnight_lullaby_2", label: "APRÈS MINUIT" },
      { v: "neon_static", label: "NÉON" },
      { v: "", label: "SILENCE" },
    ],
    apply(v, { audio }) { audio.ambience(v || null); },
  },
  {
    key: "volMusic", group: "audio", type: "range", hidden: true,
    label: "Volume", hint: "elle reste derrière la salle",
    def: 40, min: 0, max: 100, step: 5, unit: "%",
    apply(v, { audio }) { audio.setMusicLevel(v / 100); },
  },
  {
    key: "volMaster", group: "audio", type: "range",
    label: "Volume général",
    def: 85, min: 0, max: 100, step: 5, unit: "%",
    apply(v, { audio }) { audio.setVolume("master", v / 100); },
  },
  {
    key: "volFx", group: "audio", type: "range",
    label: "Effets sonores", hint: "jetons, cartes, machines",
    def: 100, min: 0, max: 100, step: 5, unit: "%",
    apply(v, { audio }) { audio.setVolume("fx", v / 100); },
  },
  {
    key: "volAmb", group: "audio", type: "range",
    label: "Ambiance", hint: "salle, fontaine, concert, musique",
    def: 100, min: 0, max: 100, step: 5, unit: "%",
    apply(v, { audio }) { audio.setVolume("amb", v / 100); },
  },
  {
    key: "volVoice", group: "audio", type: "range",
    label: "Voix", hint: "croupier, clientèle",
    def: 100, min: 0, max: 100, step: 5, unit: "%",
    apply(v, { audio }) { audio.setVolume("voice", v / 100); },
  },

  /* --------------------------------------------------------------- JEU */
  {
    /**
     * LE PSEUDO. Il vit ici et pas dans un coin de `localStorage` à lui : le
     * registre sait déjà persister et réappliquer, et `apply` est le seul
     * endroit qui parle au moteur — ici, au serveur. `hidden` le retire du
     * panneau des paramètres, il se saisit à la porte (menu.js), comme
     * l'ambiance sonore.
     *
     * Vide = pas encore choisi : le serveur garde son « Joueur N » et
     * l'écran-titre réclame un nom avant de laisser entrer.
     */
    key: "pseudo", group: "jeu", type: "text", hidden: true,
    label: "Votre nom", hint: "vu des autres joueurs, au salon comme à table",
    def: "", max: 24,
    apply(v, { net }) { net?.setName(v); },
  },
  {
    /**
     * LE BAVARDAGE DU CROUPIER. Les annonces avaient été coupées en bloc parce
     * qu'elles revenaient à chaque manche ; elles reviennent mesurées (voir
     * src/dealer.js), et surtout réglables — c'est le genre de détail qui
     * enchante la première heure et agace la troisième.
     */
    key: "dealerVoice", group: "jeu", type: "enum",
    label: "Voix du croupier", hint: "annonces et commentaires de table",
    def: "measured",
    options: [
      { v: "measured", label: "MESURÉE" },
      { v: "full", label: "BAVARDE" },
      { v: "off", label: "MUETTE" },
    ],
    apply() { /* lu à la volée par src/dealer.js */ },
  },
  {
    key: "showFps", group: "jeu", type: "toggle",
    label: "Compteur d'images", hint: "images par seconde, coin bas droit",
    def: false,
    apply(v) {
      const el = document.getElementById("fps");
      if (el) el.hidden = !v;
    },
  },
  {
    key: "crosshair", group: "jeu", type: "toggle",
    label: "Réticule de visée",
    def: true,
    apply(v) { document.body.classList.toggle("nocross", !v); },
  },
];

const byKey = new Map(DEFS.map((d) => [d.key, d]));

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function sanitize(d, v) {
  if (d.type === "toggle") return !!v;
  if (d.type === "enum") return d.options.some((o) => o.v === v) ? v : d.def;
  // texte : une ligne, espaces normalisés, longueur bornée comme côté serveur
  // (server.mjs tronque à 24) — ce qui est stocké est donc ce qui sera diffusé
  if (d.type === "text") {
    return String(v ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "")   // pas de caractères de contrôle
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, d.max || 24);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return d.def;
  return clamp(Math.round(n / d.step) * d.step, d.min, d.max);
}

class Settings {
  constructor() {
    this.values = {};
    for (const d of DEFS) this.values[d.key] = d.def;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
      for (const [k, v] of Object.entries(saved)) {
        const d = byKey.get(k);
        if (d) this.values[k] = sanitize(d, v);
      }
      /**
       * RECALAGE WINDOWS, une seule fois — et désormais VERS LE HAUT.
       *
       * La version précédente rabaissait résolution, ombres et occlusion sur
       * Windows, et `_save()` gravait ces valeurs : les joueurs concernés
       * gardaient une image dégradée pour toujours. Le motif était un GPU
       * qu'on croyait saturé ; il ne l'était pas — la salle disparaissait par
       * moitiés faute de shaders compilables (cf. lightBudget), et la frame
       * est bornée par le CPU. On rend donc l'image à ceux à qui on l'avait
       * prise, une seule fois, puis on ne touche plus à leurs choix.
       */
      if (localStorage.getItem(WIN_TUNED) === "1") {
        localStorage.setItem(WIN_TUNED, "2");
        for (const k of ["resolution", "shadows", "ssao"]) {
          const d = byKey.get(k);
          if (d) this.values[k] = d.def;
        }
        this._saveSoon = true;
      }
    } catch { /* stockage indisponible : on garde les défauts */ }
    if (this._saveSoon) { delete this._saveSoon; this._save(); }
    this.ctx = null;
    this._subs = new Set();
  }

  def(key) { return byKey.get(key); }
  get(key) { return this.values[key]; }

  /** Branche le registre sur le moteur et applique TOUT d'un coup. */
  bind(ctx) { this.ctx = ctx; this.applyAll(); }

  set(key, value) {
    const d = byKey.get(key);
    if (!d) return;
    const v = sanitize(d, value);
    if (v === this.values[key]) return v;
    this.values[key] = v;
    this._save();
    this._apply(d);
    for (const fn of this._subs) fn(key, v);
    return v;
  }

  /** Un cran vers le haut (+1) ou vers le bas (−1) : flèches du menu. */
  step(key, dir) {
    const d = byKey.get(key);
    if (!d) return;
    // un texte ne se règle pas aux flèches : elles appartiennent au caret
    if (d.type === "text") return this.values[key];
    if (d.type === "toggle") return this.set(key, !this.values[key]);
    if (d.type === "enum") {
      const i = d.options.findIndex((o) => o.v === this.values[key]);
      const n = d.options.length;
      return this.set(key, d.options[(i + dir + n) % n].v);
    }
    return this.set(key, this.values[key] + dir * d.step);
  }

  /** Valeur telle qu'elle s'affiche dans le menu. */
  text(key) {
    const d = byKey.get(key), v = this.values[key];
    if (d.type === "text") return v || "—";
    if (d.type === "toggle") return v ? "ACTIVÉ" : "DÉSACTIVÉ";
    if (d.type === "enum") return d.options.find((o) => o.v === v)?.label ?? String(v);
    return v + (d.unit || "");
  }

  /** Position 0→1 dans sa plage (jauge). */
  ratio(key) {
    const d = byKey.get(key);
    if (d.type !== "range") return 0;
    return (this.values[key] - d.min) / (d.max - d.min);
  }

  reset() {
    for (const d of DEFS) this.values[d.key] = d.def;
    this._save();
    this.applyAll();
    for (const fn of this._subs) fn(null, null);
  }

  applyAll() { for (const d of DEFS) this._apply(d); }

  onChange(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }

  _apply(d) {
    if (!this.ctx) return;
    try { d.apply?.(this.values[d.key], this.ctx); }
    catch (e) { console.warn("[param] " + d.key, e); }
  }

  _save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.values)); } catch { }
  }
}

export const settings = new Settings();
