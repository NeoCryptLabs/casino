/**
 * LE HUB TACTILE — tout ce qui rend le casino jouable au doigt.
 *
 * Le jeu reste le même ; seule la COUCHE D'ENTRÉE change. Sur un écran
 * tactile (détection `hover: none` + `pointer: coarse` : téléphones et
 * tablettes, pas les portables à écran tactile qui gardent leur souris) :
 *
 *  - moitié GAUCHE de l'écran : un joystick flottant — il naît là où le pouce
 *    se pose, l'inclinaison est analogique (à fond = courir) ;
 *  - moitié DROITE (et tout l'écran une fois assis) : glisser = regarder,
 *    l'équivalent de la souris verrouillée — assis, le débattement est borné
 *    par la place, comme la parallaxe Maj+souris du bureau ;
 *  - l'invite d'interaction (#prompt) devient un BOUTON : ce qui s'écrivait
 *    « E — s'asseoir » se touche ;
 *  - un bouton ✕ en haut à droite tient lieu d'Échap : se lever, quitter la
 *    machine, ouvrir la pause ;
 *  - PAYSAGE OBLIGATOIRE : en portrait, un voile opaque demande de tourner
 *    l'appareil (le jeu continue derrière, rien n'est détruit) ; à l'entrée
 *    en jeu on tente plein écran + verrouillage `landscape` (Android — iOS
 *    n'a pas l'API, le voile suffit).
 *
 * Le pointer lock est neutralisé (player.noPointerLock) : il n'existe pas au
 * doigt, et ses tentatives/rattrapages sèmeraient des états incohérents.
 */
import { MOBILE, clamp } from "./util.js";

export function createMobileHub({ player, state, canvas, onEscape }) {
  if (!MOBILE) return { active: false, goFullscreen() { } };

  document.body.classList.add("mobile");
  player.noPointerLock = true;

  /* ------------------------------------------------------------- DOM */

  const el = (tag, id, parent, html) => {
    const d = document.createElement(tag);
    d.id = id;
    if (html !== undefined) d.innerHTML = html;
    parent.appendChild(d);
    return d;
  };

  // voile portrait — au-dessus de tout, y compris le loader et le menu
  el("div", "rotate", document.body,
    `<div class="rot-phone">📱</div><div>Tournez votre appareil<br/><small>le Mirage se joue en paysage</small></div>`);

  // joystick flottant : caché tant qu'aucun pouce ne se pose
  const joy = el("div", "mjoy", document.body, `<div id="mjoyKnob"></div>`);
  const knob = joy.firstElementChild;

  // l'Échap du pouce — dans le HUD : il apparaît et disparaît avec lui
  const hud = document.getElementById("hud");
  const pauseBtn = el("button", "mpause", hud, "✕");
  pauseBtn.type = "button";
  pauseBtn.addEventListener("click", () => onEscape?.());

  // les rappels clavier du HUD mentent au doigt : on les réécrit
  const leave = document.getElementById("leave");
  if (leave) leave.innerHTML = "<b>glisser</b> — regarder autour &nbsp;•&nbsp; ✕ — quitter la table";
  const leave2 = document.getElementById("leave2");
  if (leave2) leave2.innerHTML = "<b>glisser</b> — regarder autour &nbsp;•&nbsp; ✕ — s'éloigner";

  // un appui long sur le canvas ouvrait le menu contextuel par-dessus le jeu
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ------------------------------------------------------- joystick */

  const R = 56;                    // course du pommeau, en px
  let joyId = null, joyBase = null;

  function joyMove(x, y) {
    let dx = x - joyBase.x, dy = y - joyBase.y;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, d / R);
    // avant = pouce vers le haut ; l'inclinaison dose la vitesse, à fond on court
    player.touchMove = {
      f: (-dy / R) * (d > R ? R / d : 1),
      s: (dx / R) * (d > R ? R / d : 1),
      run: mag > 0.92,
    };
  }

  function joyEnd() {
    joyId = null;
    player.touchMove = null;
    joy.classList.remove("on");
    knob.style.transform = "";
  }

  /* ---------------------------------------------------------- regard */

  const SENS = 0.0044;             // rad par pixel de glissement
  let lookId = null, lookLast = null;

  function lookMove(x, y) {
    const dx = x - lookLast.x, dy = y - lookLast.y;
    lookLast = { x, y };
    const cam = player.camera;
    const vy = player.invertY ? -1 : 1;
    if (player.seated) {
      // assis : même contrat que la parallaxe Maj+souris — un OFFSET normalisé
      // [-1, 1], borné par la place, amorti par player.update. Il PERSISTE au
      // relâché : le regard reste où on l'a laissé, pas de retour au centre.
      const t = player.touchLook || { nx: 0, ny: 0 };
      player.touchLook = {
        nx: clamp(t.nx + dx * 0.004, -1, 1),
        ny: clamp(t.ny + dy * 0.004 * vy, -1, 1),
      };
    } else if (state.mode === "walk" && !player.frozen) {
      cam.rotation.y += dx * SENS;
      cam.rotation.x = clamp(cam.rotation.x + dy * SENS * vy, -1.45, 1.45);
    }
  }

  /* ------------------------------------------------- routage des doigts */

  // Seuls les doigts posés sur le CANVAS pilotent le jeu : le HUD, le menu,
  // le salon et la caisse gardent les leurs. Un doigt à gauche en marchant =
  // joystick ; tout autre doigt = regard. Multi-touch : un doigt par rôle,
  // suivis par pointerId — on marche en regardant autour.
  addEventListener("pointerdown", (e) => {
    if (e.target !== canvas) return;
    const walkSide = state.mode === "walk" && !player.seated && e.clientX < innerWidth * 0.45;
    if (walkSide && joyId === null) {
      joyId = e.pointerId;
      joyBase = { x: e.clientX, y: e.clientY };
      joy.style.left = e.clientX + "px";
      joy.style.top = e.clientY + "px";
      joy.classList.add("on");
      joyMove(e.clientX, e.clientY);
    } else if (lookId === null) {
      lookId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
    }
  }, { passive: true });

  addEventListener("pointermove", (e) => {
    if (e.pointerId === joyId) joyMove(e.clientX, e.clientY);
    else if (e.pointerId === lookId) lookMove(e.clientX, e.clientY);
  }, { passive: true });

  const drop = (e) => {
    if (e.pointerId === joyId) joyEnd();
    else if (e.pointerId === lookId) { lookId = null; lookLast = null; }
  };
  addEventListener("pointerup", drop, { passive: true });
  addEventListener("pointercancel", drop, { passive: true });

  /* ------------------------------------------------- paysage obligatoire */

  /** À appeler DANS le geste d'entrée en jeu (le navigateur l'exige). */
  function goFullscreen() {
    try {
      const p = document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
      // le verrouillage d'orientation n'est accepté qu'EN plein écran
      p?.then?.(() => screen.orientation?.lock?.("landscape")?.catch?.(() => { }))
        ?.catch?.(() => { });
    } catch { /* iOS : pas d'API — le voile portrait fait le travail */ }
  }

  return { active: true, goFullscreen };
}
