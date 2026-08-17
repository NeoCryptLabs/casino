/**
 * HUD DE TABLE EN RÉALITÉ AUGMENTÉE — le « cockpit Iron Man », version casino.
 *
 * Plus aucun panneau plaqué sur l'écran : pendant la partie de blackjack,
 * l'interface est faite de PLAQUES DE VERRE FUMÉ flottant dans la scène,
 * filets or Art déco, texte champagne. Elles sont ancrées à un nœud qui
 * POURSUIT la caméra avec de l'inertie : tourner la tête fait dériver le HUD
 * de quelques degrés avant qu'il se recale — c'est ce retard qui vend le
 * « semi-3D ». Chaque plaque flotte en plus d'un sinus propre (phase décalée).
 *
 * PLACEMENT EN COORDONNÉES D'ÉCRAN, PAS EN MÈTRES. La position de chaque
 * plaque est déclarée en normalisé (nx, ny ∈ [-1, 1], -1 = bord bas/gauche)
 * et convertie à CHAQUE frame en mètres via le fov et l'aspect réels de la
 * caméra ; la taille suit le fov (constante à l'écran) et un clamp final
 * garde toujours la plaque entière DANS l'image, quel que soit le ratio de
 * la fenêtre. L'interface tient en bas de l'écran, elle ne peut pas sortir.
 *
 * Interaction : la souris est libre à table (pointer lock coupé). Un rayon
 * par frame teste les plaques interactives — survol = la plaque s'éclaire et
 * grossit, clic = l'action part vers `onAction` (branché par main.js sur le
 * serveur). Le DOM (#bj) continue d'être écrit en coulisse : il sert de
 * secours et de témoin de debug, masqué par la classe `ar`.
 *
 * Groupes de plaques, alignés sur les phases du jeu :
 *   info  — CROUPIER / VOUS / MISE (toute la partie, coin bas-gauche)
 *   bet   — jetons 5/25/100/500, 21+3, RETIRER (phase de mise, rang du bas)
 *   act   — TIRER / RESTER / DOUBLER / SÉPARER (mon tour, rang du bas)
 *   ins   — question d'assurance OUI/NON (phase d'assurance, bas-centre)
 */
import { fmt, clamp } from "./util.js";
const B = BABYLON;

/* ------------------------------------------------------------ style commun */

const FONT = (px, w = 700) => `${w} ${px}px 'Futura','Avenir Next',sans-serif`;
const GOLD = "#e8c26a", GOLD_HOT = "#ffd76a", IVORY = "#ffe9b0", CORE = "#fff6dc";
const CHIP_COLORS = { 5: "#d8544e", 25: "#3fae72", 100: "#9a9aa8", 500: "#9a6ce6" };

/** Plaque de verre fumé + double filet or + losanges d'angle (Art déco). */
function plate(c, w, h, hot = 0, disabled = false) {
  const a = disabled ? 0.35 : 1;
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, `rgba(46,28,10,${(0.50 + hot * 0.2) * a})`);
  g.addColorStop(0.5, `rgba(22,13,5,${0.42 * a})`);
  g.addColorStop(1, `rgba(40,24,9,${(0.48 + hot * 0.15) * a})`);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.shadowColor = hot > 0 ? GOLD_HOT : GOLD;
  c.shadowBlur = 10 + hot * 16;
  c.strokeStyle = `rgba(232,194,106,${(0.85 + hot * 0.15) * a})`;
  c.lineWidth = 2.5;
  c.strokeRect(6, 6, w - 12, h - 12);
  c.shadowBlur = 0;
  c.strokeStyle = `rgba(232,194,106,${0.32 * a})`;
  c.lineWidth = 1;
  c.strokeRect(12, 12, w - 24, h - 24);
  // losanges d'angle
  c.fillStyle = `rgba(255,215,106,${(0.8 + hot * 0.2) * a})`;
  for (const [x, y] of [[6, 6], [w - 6, 6], [6, h - 6], [w - 6, h - 6]]) {
    c.beginPath();
    c.moveTo(x, y - 7); c.lineTo(x + 7, y); c.lineTo(x, y + 7); c.lineTo(x - 7, y);
    c.fill();
  }
}

function label(c, w, h, txt, px, hot = 0, disabled = false) {
  c.textAlign = "center"; c.textBaseline = "middle";
  try { c.letterSpacing = Math.round(px * 0.18) + "px"; } catch { }
  c.font = FONT(px);
  c.shadowColor = "#ffb84a"; c.shadowBlur = hot > 0 ? 26 : 14;
  c.fillStyle = disabled ? "rgba(255,233,176,.3)" : (hot > 0 ? CORE : IVORY);
  c.fillText(txt, w / 2, h / 2 + 2);
  c.shadowBlur = 0;
  try { c.letterSpacing = "0px"; } catch { }
}

/* ------------------------------------------------------------------ module */

export function createArHud({ scene, camera, audio, settings }) {
  const engine = scene.getEngine();
  const root = new B.TransformNode("arhud", scene);
  root.setEnabled(false);

  // Réglages de mise en place, exposés (window.__game.arhud.L) pour être
  // ajustés en direct à table plutôt que devinés à l'aveugle dans le code.
  // Les tailles de plaques (à la création, plus bas) valent pour fovRef ;
  // elles sont re-mises à l'échelle chaque frame pour rester constantes à
  // l'écran quand la focale change.
  const L = {
    dist: 1.0,             // distance des plaques devant l'œil (m)
    fovRef: 0.92,          // focale pour laquelle les tailles sont déclarées
    aspectRef: 1.7,        // ratio pour lequel la disposition est dessinée :
    //                        plus étroit -> TOUT rétrécit d'un même facteur
    //                        (tailles ET espacements), rien ne déborde jamais
    margin: 0.012,         // garde aux bords de l'écran (m à dist)
    chaseYaw: 6.5,         // vitesse de recalage du lacet (le « retard » du HUD)
    chasePitch: 5.0,       // ...et du tangage
    float: 0.0035,         // amplitude du flottement (m)
  };

  const ctls = new Map();          // id -> contrôle
  const groups = { info: { on: false, k: 0 }, bet: { on: false, k: 0 }, act: { on: false, k: 0 }, ins: { on: false, k: 0 } };
  let active = false;
  let hoverId = null;
  let hoverUV = null;      // UV du point survolé — sert au − / + du volume
  let t = 0;

  function mkPlane(id, group, w, h, texW, texH, draw, interactive) {
    const dt = new B.DynamicTexture("arhud:" + id, { width: texW, height: texH }, scene, false);
    dt.hasAlpha = true;
    const mat = new B.StandardMaterial("arhudM:" + id, scene);
    mat.emissiveTexture = dt;
    mat.opacityTexture = dt;
    mat.disableLighting = true;
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    const p = B.MeshBuilder.CreatePlane("arhudP:" + id, { width: w, height: h }, scene);
    p.material = mat;
    p.parent = root;
    p.renderingGroupId = 2;        // par-dessus la scène ET les hologrammes de table
    p.isPickable = !!interactive;
    if (interactive) p.metadata = { arBtn: id };
    const ctl = {
      id, group, mesh: p, dt, texW, texH, draw,
      w, h, hidden: false, disabled: false, hover: false, dirty: true,
      phase: Math.random() * 6.28, freq: 0.7 + Math.random() * 0.5,
      // position d'ÉCRAN normalisée + inclinaisons ; -1 = bord gauche / bas.
      // Le clamp final garde la plaque entière dans l'image : viser -1 veut
      // dire « collé au bord », quel que soit l'aspect de la fenêtre.
      base: { nx: 0, ny: 0, rx: 0, ry: 0 },
    };
    ctls.set(id, ctl);
    return ctl;
  }

  const redraw = (ctl) => {
    const c = ctl.dt.getContext();
    c.clearRect(0, 0, ctl.texW, ctl.texH);
    ctl.draw(c, ctl.texW, ctl.texH, ctl.hover ? 1 : 0, ctl.disabled);
    ctl.dt.update();
    ctl.dirty = false;
  };

  /* ---------------- panneau d'information (coin bas-gauche) ---------------- */

  const vals = { dealer: "—", player: "—", bet: "0 €" };
  const info = mkPlane("info", "info", 0.26, 0.15, 640, 384, (c, w, h) => {
    plate(c, w, h);
    const rows = [["CROUPIER", vals.dealer], ["VOUS", vals.player], ["MISE", vals.bet]];
    rows.forEach(([k, v], i) => {
      const y = 78 + i * 112;
      c.textBaseline = "middle";
      try { c.letterSpacing = "6px"; } catch { }
      c.textAlign = "left";
      c.font = FONT(30, 600);
      c.fillStyle = "rgba(232,205,141,.85)";
      c.shadowColor = "#ffb84a"; c.shadowBlur = 8;
      c.fillText(k, 52, y);
      c.textAlign = "right";
      c.font = FONT(52);
      c.fillStyle = IVORY;
      c.shadowBlur = 16;
      c.fillText(String(v), w - 52, y);
      c.shadowBlur = 0;
      if (i < 2) {
        c.strokeStyle = "rgba(232,194,106,.25)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(44, y + 56); c.lineTo(w - 44, y + 56); c.stroke();
      }
      try { c.letterSpacing = "0px"; } catch { }
    });
  }, false);
  info.base = { nx: -1, ny: -1, rx: 0, ry: 0.22 };

  /* ---------------- actions (rang du bas, quand c'est mon tour) ------------ */

  const ACTIONS = [["hit", "TIRER"], ["stand", "RESTER"], ["double", "DOUBLER"], ["split", "SÉPARER"]];
  ACTIONS.forEach(([id, txt], i) => {
    const ctl = mkPlane(id, "act", 0.185, 0.075, 512, 200, (c, w, h, hot, dis) => {
      plate(c, w, h, hot, dis);
      label(c, w, h, txt, 66, hot, dis);
    }, true);
    ctl.base = { nx: -0.36 + i * 0.24, ny: -0.87, rx: -0.10, ry: (1.5 - i) * 0.05 };
  });

  /* ---------------- mise : jetons + 21+3 + retirer (rang du bas) ----------- */

  let sideTxt = "";
  [5, 25, 100, 500].forEach((v, i) => {
    const ctl = mkPlane("chip" + v, "bet", 0.082, 0.082, 256, 256, (c, w, h, hot) => {
      const r = w / 2 - 14;
      c.shadowColor = CHIP_COLORS[v]; c.shadowBlur = hot ? 30 : 16;
      c.strokeStyle = CHIP_COLORS[v]; c.lineWidth = 13;
      c.beginPath(); c.arc(w / 2, h / 2, r, 0, 7); c.stroke();
      // tirets d'un vrai jeton, en or
      c.shadowColor = "#ffb84a"; c.shadowBlur = hot ? 18 : 8;
      c.strokeStyle = hot ? GOLD_HOT : GOLD; c.lineWidth = 7;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        c.beginPath(); c.arc(w / 2, h / 2, r, a - 0.16, a + 0.16); c.stroke();
      }
      c.fillStyle = `rgba(20,12,5,${hot ? 0.55 : 0.42})`;
      c.beginPath(); c.arc(w / 2, h / 2, r - 22, 0, 7); c.fill();
      label(c, w, h, String(v), v >= 100 ? 74 : 84, hot);
    }, true);
    ctl.base = { nx: -0.17 + i * 0.115, ny: -0.87, rx: -0.10, ry: 0 };
    ctl.action = { id: "chip", v };
  });
  const side = mkPlane("side", "bet", 0.15, 0.066, 512, 218, (c, w, h, hot) => {
    plate(c, w, h, hot);
    label(c, w, h, sideTxt ? `21+3 · ${sideTxt}` : "21+3", 58, hot);
  }, true);
  side.base = { nx: 0.36, ny: -0.87, rx: -0.10, ry: -0.06 };
  const clear = mkPlane("clear", "bet", 0.15, 0.066, 512, 218, (c, w, h, hot) => {
    plate(c, w, h, hot);
    label(c, w, h, "RETIRER", 52, hot);
  }, true);
  clear.base = { nx: -0.42, ny: -0.87, rx: -0.10, ry: 0.06 };

  /* ---------------- assurance (bas-centre) ---------------- */

  let insCost = 0;
  const insLbl = mkPlane("insLbl", "ins", 0.46, 0.062, 1024, 138, (c, w, h) => {
    plate(c, w, h);
    label(c, w, h, `LE CROUPIER MONTRE UN AS — ASSURANCE ${insCost} € ?`, 40);
  }, false);
  insLbl.base = { nx: 0, ny: -0.62, rx: -0.08, ry: 0 };
  const insYes = mkPlane("insYes", "ins", 0.13, 0.064, 384, 192, (c, w, h, hot) => {
    plate(c, w, h, hot); label(c, w, h, "OUI", 68, hot);
  }, true);
  insYes.base = { nx: -0.095, ny: -0.85, rx: -0.10, ry: 0 };
  const insNo = mkPlane("insNo", "ins", 0.13, 0.064, 384, 192, (c, w, h, hot) => {
    plate(c, w, h, hot); label(c, w, h, "NON", 68, hot);
  }, true);
  insNo.base = { nx: 0.095, ny: -0.85, rx: -0.10, ry: 0 };

  /* ---------------- ambiance sonore (coin bas-droite) ---------------- */

  // La même option que le menu principal, à portée de main sans quitter la
  // table : un clic fait défiler NOCTURNE / APRÈS MINUIT / NÉON / SILENCE.
  // `settings.step` applique ET sauvegarde ; on ne fait que refléter.
  let amb = null, vol = null;
  if (settings) {
    amb = mkPlane("amb", "info", 0.165, 0.072, 512, 224, (c, w, h, hot) => {
      plate(c, w, h, hot);
      c.textAlign = "center"; c.textBaseline = "middle";
      try { c.letterSpacing = "5px"; } catch { }
      c.font = FONT(26, 600);
      c.fillStyle = "rgba(232,205,141,.8)";
      c.shadowColor = "#ffb84a"; c.shadowBlur = 8;
      c.fillText("AMBIANCE", w / 2, 62);
      c.font = FONT(50);
      c.fillStyle = hot ? CORE : IVORY;
      c.shadowBlur = hot ? 24 : 14;
      c.fillText("♪ " + settings.text("music"), w / 2, h - 74);
      c.shadowBlur = 0;
      try { c.letterSpacing = "0px"; } catch { }
    }, true);
    amb.base = { nx: 1, ny: -0.73, rx: -0.08, ry: -0.22 };
    amb.action = { id: "amb" };

    // ...et son VOLUME, juste en dessous : − / + aux extrémités (le côté
    // cliqué décide du sens), molette au survol pour les impatients.
    vol = mkPlane("vol", "info", 0.165, 0.060, 512, 186, (c, w, h, hot) => {
      plate(c, w, h, hot);
      c.textAlign = "center"; c.textBaseline = "middle";
      try { c.letterSpacing = "5px"; } catch { }
      c.font = FONT(24, 600);
      c.fillStyle = "rgba(232,205,141,.8)";
      c.shadowColor = "#ffb84a"; c.shadowBlur = 8;
      c.fillText("VOLUME", w / 2, 52);
      try { c.letterSpacing = "0px"; } catch { }
      // − / + : les deux zones cliquables
      c.font = FONT(64);
      c.fillStyle = hot ? CORE : IVORY;
      c.shadowBlur = hot ? 20 : 10;
      c.fillText("−", 64, h / 2 + 16);
      c.fillText("+", w - 64, h / 2 + 16);
      // jauge or + pourcentage
      const r = settings.ratio("volMusic");
      const bx = 120, bw = w - 240, by = h - 62;
      c.shadowBlur = 6;
      c.fillStyle = "rgba(255,233,176,.16)";
      c.fillRect(bx, by, bw, 7);
      c.fillStyle = GOLD_HOT;
      c.shadowColor = GOLD_HOT; c.shadowBlur = 12;
      c.fillRect(bx, by, bw * r, 7);
      c.shadowBlur = 10;
      c.font = FONT(34);
      c.fillStyle = IVORY;
      c.fillText(settings.text("volMusic"), w / 2, 92);
      c.shadowBlur = 0;
    }, true);
    vol.base = { nx: 1, ny: -1, rx: -0.10, ry: -0.22 };
    vol.action = { id: "vol" };

    // le menu principal peut changer tout ça pendant qu'on est assis
    settings.onChange((k) => {
      if (k === "music" || k === null) amb.dirty = true;
      if (k === "volMusic" || k === null) vol.dirty = true;
    });
    // molette au survol de l'une ou l'autre plaque : réglage rapide
    engine.getRenderingCanvas().addEventListener("wheel", (e) => {
      if (!active || (hoverId !== "vol" && hoverId !== "amb")) return;
      settings.step("volMusic", e.deltaY < 0 ? 1 : -1);
      vol.dirty = true;
    }, { passive: true });
  }

  for (const ctl of ctls.values()) redraw(ctl);

  /* ---------------- interaction ---------------- */

  const canvas = engine.getRenderingCanvas();
  canvas.addEventListener("pointerdown", () => {
    if (!active || !hoverId) return;
    const ctl = ctls.get(hoverId);
    if (!ctl || ctl.disabled) return;
    audio.ui?.();
    // petit « punch » de la plaque cliquée
    ctl.mesh.scaling.scaleInPlace(0.94);
    const a = ctl.action || { id: ctl.id };
    // l'ambiance et son volume se règlent ici même, sans passer par la table
    if (a.id === "amb") { settings.step("music", 1); ctl.dirty = true; return; }
    if (a.id === "vol") {
      // le CÔTÉ cliqué décide du sens : moitié gauche −, moitié droite +
      settings.step("volMusic", hoverUV && hoverUV.x < 0.5 ? -1 : 1);
      ctl.dirty = true;
      return;
    }
    api.onAction?.(a.id, a.v);
  });

  function pickHover() {
    if (!active) { hoverId = null; return; }
    const ray = scene.createPickingRay(scene.pointerX, scene.pointerY, B.Matrix.Identity(), camera);
    const hit = scene.pickWithRay(ray, (m) => m.isEnabled() && m.metadata && m.metadata.arBtn);
    const id = hit?.hit ? hit.pickedMesh.metadata.arBtn : null;
    try { hoverUV = hit?.hit ? hit.getTextureCoordinates() : null; } catch { hoverUV = null; }
    if (id !== hoverId) {
      const prev = ctls.get(hoverId), next = ctls.get(id);
      if (prev) { prev.hover = false; prev.dirty = true; }
      if (next && !next.disabled) { next.hover = true; next.dirty = true; audio.tick?.(); }
      hoverId = id;
      canvas.style.cursor = next && !next.disabled ? "pointer" : "";
    }
  }

  /* ---------------- poursuite caméra + rendu ---------------- */

  // le HUD suit le regard avec du RETARD : c'est lui, l'effet « Iron Man »
  let yaw = 0, pitch = 0;
  const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));

  function tick(dt) {
    if (!active && groups.info.k < 0.01) { root.setEnabled(false); return; }
    t += dt;

    yaw += wrap(camera.rotation.y - yaw) * Math.min(1, dt * L.chaseYaw);
    pitch += (camera.rotation.x - pitch) * Math.min(1, dt * L.chasePitch);
    root.position.copyFrom(camera.position);
    root.rotation.set(pitch, yaw, 0);

    for (const g of Object.values(groups)) {
      g.k += ((g.on && active ? 1 : 0) - g.k) * Math.min(1, dt * 9);
    }

    // demi-champ de vision réel à la distance des plaques : c'est LA vérité
    // qui garantit que tout reste à l'écran, focale et ratio compris.
    const tanV = Math.tan(camera.fov / 2);
    const halfH = tanV * L.dist;
    const halfW = halfH * engine.getAspectRatio(camera);
    // Fenêtre plus étroite que le ratio de référence : l'étalement horizontal
    // se cale sur la largeur réelle et les plaques rétrécissent du même
    // facteur — tailles et espacements restent proportionnels, zéro overlap.
    const spanW = Math.min(halfW, halfH * L.aspectRef);
    const shrink = spanW / (halfH * L.aspectRef);
    const fit = (tanV / Math.tan(L.fovRef / 2)) * shrink;

    for (const ctl of ctls.values()) {
      const g = groups[ctl.group];
      const vis = g.k * (ctl.hidden ? 0 : 1);
      if (vis < 0.02) { ctl.mesh.setEnabled(false); continue; }
      ctl.mesh.setEnabled(true);
      ctl.mesh.visibility = vis;

      const s = (0.94 + 0.06 * vis) * (ctl.hover && !ctl.disabled ? 1.06 : 1) * fit;
      ctl.mesh.scaling.x += (s - ctl.mesh.scaling.x) * Math.min(1, dt * 14);
      ctl.mesh.scaling.y = ctl.mesh.scaling.x;

      // normalisé -> mètres, puis clamp : la plaque ENTIÈRE reste dans l'image
      const hw = (ctl.w * ctl.mesh.scaling.x) / 2 + L.margin;
      const hh = (ctl.h * ctl.mesh.scaling.y) / 2 + L.margin;
      const float = Math.sin(t * ctl.freq + ctl.phase) * L.float;
      const x = clamp(ctl.base.nx * spanW, -halfW + hw, halfW - hw);
      const y = clamp(ctl.base.ny * halfH + float - (1 - vis) * 0.04, -halfH + hh, halfH - hh);
      ctl.mesh.position.set(x, y, L.dist);
      ctl.mesh.rotation.set(ctl.base.rx, ctl.base.ry, Math.sin(t * ctl.freq * 0.6 + ctl.phase) * 0.006);
      if (ctl.dirty) redraw(ctl);
    }

    pickHover();
  }

  /* ---------------- API (miroir de makeUI) ---------------- */

  const setVal = (key, v) => {
    const s = String(v);
    if (vals[key] === s) return;
    vals[key] = s;
    info.dirty = true;
  };

  const api = {
    L,
    onAction: null,
    show() { active = true; groups.info.on = true; root.setEnabled(true); yaw = camera.rotation.y; pitch = camera.rotation.x; },
    hide() {
      active = false;
      for (const g of Object.values(groups)) g.on = false;
      canvas.style.cursor = "";
      hoverId = null;
    },
    setBet(v) { setVal("bet", fmt(v) + " €"); },
    setPlayerVal(v) { setVal("player", v); },
    setDealerVal(v) { setVal("dealer", v); },
    showBetPanel(on) { groups.bet.on = !!on; },
    showActions(on, opt = {}) {
      groups.act.on = !!on;
      const d = ctls.get("double"), s = ctls.get("split");
      if (d.disabled !== !opt.canDouble) { d.disabled = !opt.canDouble; d.dirty = true; }
      if (s.hidden !== !opt.canSplit) s.hidden = !opt.canSplit;
    },
    showInsurance(ask, cost) {
      groups.ins.on = !!ask;
      if (ask && cost !== insCost) { insCost = cost; insLbl.dirty = true; }
    },
    setSide(txt) {
      if (txt === sideTxt) return;
      sideTxt = txt;
      side.dirty = true;
    },
    tick,
  };
  return api;
}
