/**
 * LE MENU — écran-titre et pause, à la manière d'un jeu vidéo.
 *
 * Un seul calque sert les deux : l'écran-titre (avec la caméra qui dérive
 * lentement au-dessus du casino, déjà chargé derrière) et la pause (le jeu
 * reste visible, flouté, gelé). Les pages s'empilent — racine, paramètres,
 * commandes, crédits — et Échap dépile.
 *
 * Le clavier prime : ↑ ↓ pour naviguer, ← → pour régler, Entrée pour valider,
 * Échap pour revenir. La souris fait la même chose, et survoler déplace le
 * curseur : les deux ne se contredisent jamais.
 *
 * Le contenu des paramètres n'est PAS écrit ici : il est engendré depuis
 * src/settings.js. Un réglage qui arrivera plus tard s'ajoutera là-bas et
 * apparaîtra ici tout seul.
 */
import { settings, DEFS, GROUPS } from "./settings.js";

const $ = (id) => document.getElementById(id);

/** Vrai tant qu'un menu est ouvert — les autres modules s'effacent alors. */
let OPEN = false;
export const menuIsOpen = () => OPEN;

const CONTROLS = [
  ["Se déplacer", "Z Q S D <i>/</i> W A S D"],
  ["Courir", "Maj"],
  ["Regarder", "Souris"],
  ["Interagir, s'asseoir, miser", "E"],
  ["Se lever / quitter la table", "Échap"],
  ["Pause & paramètres", "Échap <i>(debout)</i>"],
  ["Parler aux autres joueurs", "⏎"],
  ["Mise de la machine à sous", "Molette"],
  ["À table — regarder autour", "Maj + souris"],
  ["Blackjack — tirer / rester", "H <i>/</i> R"],
  ["Blackjack — doubler / séparer", "D <i>/</i> S"],
  ["Blackjack — miser 5 / 25 / 100 / 500", "1 2 3 4"],
  ["Mode éditeur du décor", "F2 <i>ou</i> P"],
];

const CREDITS = `
  <p><b>LE MIRAGE</b> — casino 3D multijoueur, table de blackjack autoritaire.</p>
  <p>Moteur <b>Babylon.js</b> · physique <b>Havok</b> · serveur de table en <b>Node</b>.</p>
  <p>Décor, éclairage, mise en scène et voix : maison.</p>
  <p class="dim">Jouez pour le plaisir. La banque, elle, ne s'amuse jamais.</p>`;

/**
 * @param {object} o
 * @param {import("./player.js").Player} o.player
 * @param {object} o.audio      moteur audio (pour les clics du menu)
 * @param {BABYLON.Vector3} o.driftCenter  point que survole la caméra de titre
 * @param {() => void} o.onPlay    l'écran-titre lâche le joueur dans le casino
 * @param {() => void} o.onResume  la pause se referme
 * @param {() => void} o.onHome    la partie retourne à l'écran-titre
 */
export function createMenu({ player, audio, driftCenter, onPlay, onResume, onHome }) {
  const root = $("menu"), pageEl = $("mnPage"), footEl = $("mnFoot"), subEl = $("mnSub");

  let kind = "home";       // home | pause
  let stack = [];          // pages empilées au-dessus de la racine
  let items = [];          // éléments navigables de la page courante
  let cursor = 0;
  let started = false;     // la partie a-t-elle déjà commencé ?
  let nameAsked = false;   // le champ du pseudo a-t-il déjà réclamé le focus ?
  let group = GROUPS[0].id;
  let drifting = false, driftT = 0, pose = null, wasFrozen = false;

  const click = () => audio?.ui?.();

  /* ------------------------------------------------------------ curseur */

  function addItem(el, opt) {
    const idx = items.length;
    items.push({ el, ...opt });
    el.addEventListener("mouseenter", () => setCursor(idx, true));
    el.addEventListener("click", () => { setCursor(idx); opt.go?.(); });
    return idx;
  }

  function paint() {
    items.forEach((it, i) => it.el.classList.toggle("on", i === cursor));
  }

  function setCursor(i, silent) {
    if (!items.length) return;
    const n = ((i % items.length) + items.length) % items.length;
    if (n === cursor) return;
    cursor = n;
    paint();
    if (!silent) click();
  }

  /* -------------------------------------------------------------- pages */

  function render() {
    const page = stack[stack.length - 1] || "root";
    pageEl.innerHTML = "";
    items = [];
    ({ root: pageRoot, settings: pageSettings, controls: pageControls, credits: pageCredits })[page]();
    cursor = Math.max(0, Math.min(cursor, items.length - 1));
    paint();
    footEl.innerHTML = "<b>↑ ↓</b> naviguer &nbsp;·&nbsp; <b>← →</b> régler"
      + (page === "root"
        ? " &nbsp;·&nbsp; <b>Entrée</b> valider"
          + (kind === "pause" ? " &nbsp;·&nbsp; <b>Échap</b> reprendre" : "")
        : " &nbsp;·&nbsp; <b>Échap</b> retour");
  }

  function navButton(label, go, cls = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mn-item " + cls;
    b.innerHTML = `<span class="mn-mark"></span><span>${label}</span>`;
    pageEl.appendChild(b);
    addItem(b, { go });
    return b;
  }

  /**
   * Une ligne de réglage — le même objet dans les paramètres et au menu
   * principal : libellé, flèches, jauge, valeur. Elle se branche toute seule
   * sur le registre, il n'y a rien à câbler à l'appel.
   */
  function settingRow(host, d) {
    const row = document.createElement("div");
    row.className = "mn-row";
    row.innerHTML = `
      <div class="mn-lbl"><span class="mn-mark"></span>${d.label}
        ${d.hint ? `<em>${d.hint}</em>` : ""}</div>
      <div class="mn-val">
        <button type="button" class="mn-arw" data-d="-1">‹</button>
        ${d.type === "range" ? '<div class="mn-gauge"><i></i></div>' : ""}
        <div class="mn-num"></div>
        <button type="button" class="mn-arw" data-d="1">›</button>
      </div>`;
    host.appendChild(row);

    const num = row.querySelector(".mn-num");
    const bar = row.querySelector(".mn-gauge i");
    const refresh = () => {
      num.textContent = settings.text(d.key);
      if (bar) bar.style.width = (settings.ratio(d.key) * 100).toFixed(1) + "%";
      row.classList.toggle("off", d.type === "toggle" && !settings.get(d.key));
    };
    refresh();

    const idx = addItem(row, {
      adjust: (dir) => { settings.step(d.key, dir); refresh(); click(); },
      // Entrée (ou un clic sur la ligne) bascule ce qui se bascule ; un
      // curseur, lui, ne se règle qu'aux flèches ou à la jauge.
      go: d.type === "range" ? null
        : () => { settings.step(d.key, 1); refresh(); click(); },
    });
    row.querySelectorAll(".mn-arw").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      setCursor(idx, true);
      settings.step(d.key, Number(b.dataset.d));
      refresh(); click();
    }));
    // LA JAUGE SE TIRE. Poser le doigt règle déjà la valeur, la garder appuyé
    // la fait suivre — et `setPointerCapture` veut dire que la souris peut
    // sortir de la jauge, même de la fenêtre : on ne lâche pas un curseur
    // parce qu'on a dérivé de trois pixels.
    const gauge = row.querySelector(".mn-gauge");
    if (gauge) {
      let dragging = false, last = null, lastTick = 0;
      const to = (e) => {
        const r = gauge.getBoundingClientRect();
        const k = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const v = settings.set(d.key, d.min + (d.max - d.min) * k);
        if (v === last) return;
        last = v;
        refresh();
        // un cran = un tic, mais jamais en rafale : au-delà, ça mitraille
        const now = performance.now();
        if (now - lastTick > 55) { lastTick = now; click(); }
      };
      gauge.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setCursor(idx, true);
        dragging = true;
        last = settings.get(d.key);
        gauge.setPointerCapture?.(e.pointerId);
        to(e);
      });
      gauge.addEventListener("pointermove", (e) => { if (dragging) to(e); });
      const drop = (e) => {
        if (!dragging) return;
        dragging = false;
        gauge.releasePointerCapture?.(e.pointerId);
      };
      gauge.addEventListener("pointerup", drop);
      gauge.addEventListener("pointercancel", drop);
      gauge.addEventListener("click", (e) => e.stopPropagation());
    }
    return row;
  }

  /**
   * LE PSEUDO, à la porte.
   *
   * Premier arrivage : le champ est vide et prend le focus tout seul — on entre
   * son nom avant d'entrer dans la salle, et `Entrée` enchaîne directement sur
   * la partie. Les fois suivantes il est déjà rempli : le registre des réglages
   * l'a persisté (clé `pseudo`, localStorage) et l'a déjà renvoyé au serveur.
   * On peut encore le changer, ici comme en pause : le renommage part en
   * direct aux autres joueurs.
   *
   * Range le contenu du champ dans le registre, qui persiste et diffuse.
   */
  function commitName(input) {
    const v = settings.set("pseudo", input.value);
    input.value = v;                // le registre a normalisé : espaces, 24 max
    return v;
  }

  /** La ligne « VOTRE NOM » de la racine du menu (titre comme pause). */
  function pseudoRow() {
    const row = document.createElement("div");
    row.className = "mn-name";
    row.innerHTML = `
      <div class="mn-lbl"><span class="mn-mark"></span>VOTRE NOM</div>
      <input type="text" maxlength="24" spellcheck="false" autocomplete="off"
             placeholder="entrez votre pseudo…" />`;
    pageEl.appendChild(row);

    const input = row.querySelector("input");
    input.value = settings.get("pseudo");

    const idx = addItem(row, { go: () => input.focus() });
    input.addEventListener("focus", () => setCursor(idx, true));
    // La frappe, elle, est arbitrée par le gestionnaire clavier du menu : il est
    // en CAPTURE sur window et coupe la propagation pour protéger le jeu, donc
    // un écouteur posé ici ne verrait jamais Entrée ni Échap.
    input.addEventListener("change", () => commitName(input));
    input.addEventListener("blur", () => commitName(input));
    // premier arrivage : rien en mémoire, on réclame le nom sans le dire
    if (!nameAsked && !input.value && kind !== "pause") {
      nameAsked = true;
      cursor = idx;
      setTimeout(() => input.focus(), 0);
    }
    return row;
  }

  function pageRoot() {
    const nav = document.createElement("div");
    nav.className = "mn-nav";
    pageEl.appendChild(nav);
    const push = (p) => () => { stack.push(p); cursor = 0; render(); };
    const list = kind === "pause"
      ? [["REPRENDRE", resume], ["PARAMÈTRES", push("settings")],
      ["COMMANDES", push("controls")], ["MENU PRINCIPAL", quitToHome]]
      : [[started ? "REPRENDRE LA PARTIE" : "ENTRER DANS LE MIRAGE", play],
      ["PARAMÈTRES", push("settings")], ["COMMANDES", push("controls")],
      ["CRÉDITS", push("credits")]];
    for (const [label, go] of list) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mn-item";
      b.innerHTML = `<span class="mn-mark"></span><span>${label}</span>`;
      nav.appendChild(b);
      addItem(b, { go });
    }

    // Le NOM sous les boutons, et non au-dessus : le curseur arrive ainsi sur
    // « ENTRER » pour qui a déjà son pseudo en mémoire. Le premier arrivage,
    // lui, va chercher le champ tout seul (voir pseudoRow).
    pseudoRow();

    // L'AMBIANCE SONORE se choisit ICI, à la porte, pas au fond d'un panneau :
    // c'est le fond de la salle qu'on règle avant d'entrer, comme on choisit un
    // disque. Son volume est à côté — elle doit rester DERRIÈRE le casino.
    const amb = document.createElement("div");
    amb.className = "mn-rows mn-amb";
    pageEl.appendChild(amb);
    settingRow(amb, settings.def("music"));
    settingRow(amb, settings.def("volMusic"));
  }

  function pageSettings() {
    // La barre d'onglets EST le premier élément navigable : ← → change de
    // groupe, ↓ descend dans les réglages. Le geste console, sans détour.
    const tabs = document.createElement("div");
    tabs.className = "mn-tabs";
    for (const g of GROUPS) {
      const t = document.createElement("button");
      t.type = "button";
      t.className = "mn-tab" + (g.id === group ? " sel" : "");
      t.textContent = g.label;
      t.addEventListener("click", (e) => {
        e.stopPropagation();
        if (g.id !== group) { group = g.id; click(); render(); }
      });
      tabs.appendChild(t);
    }
    pageEl.appendChild(tabs);
    addItem(tabs, {
      adjust: (d) => {
        const i = GROUPS.findIndex((g) => g.id === group);
        group = GROUPS[(i + d + GROUPS.length) % GROUPS.length].id;
        click(); render();
      },
    });

    const rows = document.createElement("div");
    rows.className = "mn-rows";
    pageEl.appendChild(rows);

    // `hidden` : ce qui vit ailleurs (l'ambiance sonore, au menu principal)
    // ne se répète pas ici.
    for (const d of DEFS.filter((x) => x.group === group && !x.hidden)) {
      settingRow(rows, d);
    }

    navButton("RÉINITIALISER", () => {
      settings.reset();
      click();
      render();
    }, "mn-small");
  }

  function pageControls() {
    const box = document.createElement("div");
    box.className = "mn-doc";
    box.innerHTML = "<h3>COMMANDES</h3>" + CONTROLS
      .map(([what, keys]) => `<div class="mn-key"><span>${what}</span><kbd>${keys}</kbd></div>`)
      .join("");
    pageEl.appendChild(box);
    navButton("RETOUR", back, "mn-small");
  }

  function pageCredits() {
    const box = document.createElement("div");
    box.className = "mn-doc";
    box.innerHTML = "<h3>CRÉDITS</h3>" + CREDITS;
    pageEl.appendChild(box);
    navButton("RETOUR", back, "mn-small");
  }

  /* ----------------------------------------------------------- clavier */

  // En capture, sur window : tant que le menu est ouvert, AUCUNE touche ne
  // descend jusqu'au jeu (déplacement, raccourcis de table, éditeur…).
  addEventListener("keydown", (e) => {
    if (!OPEN) return;
    e.stopPropagation();
    const k = e.code;

    /**
     * UN CHAMP DE TEXTE A LE FOCUS (le pseudo) : les touches lui appartiennent.
     * Sans cette dérivation, `preventDefault` avalait Espace — impossible
     * d'écrire un nom en deux mots — et les flèches déplaçaient le curseur du
     * menu au lieu du caret. On ne coupe surtout pas `stopPropagation` : le jeu
     * ne doit pas recevoir la frappe (« p » ouvrirait le mode éditeur).
     */
    if (e.target instanceof HTMLInputElement) {
      if (k !== "Escape" && k !== "Enter" && k !== "NumpadEnter") return;
      e.preventDefault();
      const v = commitName(e.target);
      e.target.blur();
      // Entrée sur un nom valide = on entre : c'est le geste attendu au premier
      // arrivage. En pause, il n'y a rien à lancer, on se contente de valider.
      if (k !== "Escape" && v && kind !== "pause") play();
      return;
    }
    const nav = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter",
      "NumpadEnter", "Space", "Escape", "KeyW", "KeyS", "KeyZ", "Tab"];
    if (nav.includes(k)) e.preventDefault();

    if (k === "Escape") return back();
    if (k === "ArrowUp" || k === "KeyW" || k === "KeyZ") return setCursor(cursor - 1);
    if (k === "ArrowDown" || k === "KeyS") return setCursor(cursor + 1);
    const it = items[cursor];
    if (!it) return;
    if (k === "ArrowLeft") return it.adjust?.(-1);
    if (k === "ArrowRight") return it.adjust?.(1);
    if (k === "Enter" || k === "NumpadEnter" || k === "Space") return it.go?.();
  }, true);

  // le premier geste de l'utilisateur débloque l'audio du navigateur : les
  // clics du menu sonnent, et l'ambiance du casino monte derrière l'écran-titre
  root.addEventListener("pointerdown", () => {
    if (audio?.ready) return;
    audio?.init?.(); audio?.resume?.();
    settings.applyAll();          // les volumes choisis s'appliquent au bus neuf
  }, { capture: true });

  /* ------------------------------------------------- caméra de l'écran-titre */

  function driftOn() {
    const cam = player.camera;
    if (!drifting) {
      pose = {
        p: cam.position.clone(), r: cam.rotation.clone(),
        col: cam.checkCollisions, grav: cam.applyGravity,
      };
      wasFrozen = player.frozen;
    }
    drifting = true;
    player.frozen = true;
    player.keys.clear();
    cam.detachControl();
    cam.checkCollisions = false;
    cam.applyGravity = false;
    cam.rotation.z = 0;
  }

  function driftOff() {
    if (!drifting) return;
    drifting = false;
    const cam = player.camera;
    cam.position.copyFrom(pose.p);
    cam.rotation.copyFrom(pose.r);
    cam.rotation.z = 0;
    cam.fov = player.baseFov;
    cam.checkCollisions = pose.col;
    cam.applyGravity = pose.grav;
    player.frozen = wasFrozen;
  }

  /**
   * OÙ LE JOUEUR SE POSERA en quittant l'écran-titre.
   *
   * Pendant la ronde de caméra, la position du joueur est confisquée par le
   * survol du hall : `driftOff()` la lui rend depuis `pose`. C'est donc `pose`
   * qu'il faut réécrire — et non la caméra — pour que la position rendue par le
   * serveur (là où le joueur s'était arrêté la fois précédente) soit celle où
   * il rouvre les yeux. Une fois la partie commencée, on ne téléporte plus
   * personne : ce serait un enlèvement.
   *
   * @param {BABYLON.Vector3} p position d'entrée  @param {number} [r] cap
   */
  function setEntry(p, r) {
    if (started || !p) return;
    if (drifting) {
      pose.p.copyFrom(p);
      if (Number.isFinite(r)) pose.r.set(pose.r.x, r, 0);
    } else {
      player.camera.position.copyFrom(p);
      if (Number.isFinite(r)) player.camera.rotation.y = r;
    }
  }

  /** Appelée chaque frame : la lente ronde au-dessus du hall. */
  function tick(dt) {
    if (!drifting) return;
    driftT += dt;
    const cam = player.camera, c = driftCenter;
    const a = 2.1 + driftT * 0.05;
    const r = 10.4 + Math.sin(driftT * 0.09) * 1.3;
    cam.position.set(c.x + Math.cos(a) * r, 2.7 + Math.sin(driftT * 0.13) * 0.4, c.z + Math.sin(a) * r);
    const dx = c.x - cam.position.x, dy = 1.35 - cam.position.y, dz = c.z - cam.position.z;
    cam.rotation.y = Math.atan2(dx, dz);
    cam.rotation.x = Math.atan2(-dy, Math.hypot(dx, dz));
  }

  /* --------------------------------------------------------- ouvrir / fermer */

  function show() {
    OPEN = true;
    document.body.classList.add("menu-open");
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("on"));
  }

  function hide() {
    OPEN = false;
    document.body.classList.remove("menu-open");
    root.classList.remove("on");
    setTimeout(() => { if (!OPEN) root.hidden = true; }, 320);
  }

  /** L'écran-titre : logo, ronde de caméra, monde gelé derrière. */
  function home() {
    kind = "home";
    stack = []; cursor = 0;
    root.classList.remove("paused");
    subEl.textContent = "CASINO & LOUNGE";
    driftOn();
    show(); render();
  }

  /** La pause : le jeu reste sous les yeux, flouté et arrêté. */
  function pause() {
    if (OPEN) return;
    kind = "pause";
    stack = []; cursor = 0;
    root.classList.add("paused");
    subEl.textContent = "PAUSE";
    wasFrozen = player.frozen;
    player.frozen = true;
    player.keys.clear();
    show(); render();
  }

  function play() {
    // On n'entre pas anonyme : sans pseudo, le champ se réclame lui-même
    // plutôt que d'afficher un reproche.
    if (!settings.get("pseudo")) {
      const input = pageEl.querySelector(".mn-name input");
      if (input) {
        input.closest(".mn-name").classList.remove("ask");
        void input.offsetWidth;               // redémarre l'animation
        input.closest(".mn-name").classList.add("ask");
        input.focus();
        return;
      }
    }
    driftOff();
    hide();
    const first = !started;
    started = true;
    onPlay?.(first);
  }

  function resume() {
    hide();
    player.frozen = wasFrozen;
    onResume?.();
  }

  function quitToHome() {
    player.frozen = wasFrozen;
    onHome?.();
    home();
  }

  /** Échap : dépiler une page, sinon reprendre (en pause), sinon rien. */
  function back() {
    if (stack.length) { stack.pop(); cursor = 0; click(); render(); return; }
    if (kind === "pause") { click(); resume(); }
  }

  return { home, pause, resume, tick, setEntry, isOpen: () => OPEN, get started() { return started; } };
}
