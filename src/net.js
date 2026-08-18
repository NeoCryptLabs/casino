/**
 * Multijoueur : synchronisation des joueurs par WebSocket.
 *
 * Volontairement minimal — on n'échange que la pose de chaque joueur. Le
 * blackjack reste local à chacun : on voit les autres se déplacer et s'asseoir,
 * pas leur main de cartes.
 *
 * Deux précautions qui font tout le rendu :
 *  - les avatars distants sont INTERPOLÉS vers la dernière pose reçue, sinon
 *    ils sautent d'une position à l'autre à chaque trame réseau (15 Hz) ;
 *  - on n'émet que si la pose a bougé, pour ne pas saturer la liaison à l'arrêt.
 *
 * C'est aussi par ici que passe LA PERSISTANCE : le client présente son jeton
 * d'identité en ouvrant la liaison, le serveur lui rend son profil (pseudo,
 * caisse, dernière position debout) dans le `welcome`, et la caisse est
 * ensuite tenue par le serveur seul.
 */
import { V3, clamp } from "./util.js";
const B = BABYLON;

const SEND_HZ = 12;
const MOVE_EPS = 0.015;      // m
const TURN_EPS = 0.02;       // rad

/**
 * LE JETON D'IDENTITÉ. Pas un compte, pas un mot de passe : un ticket de
 * vestiaire, fabriqué une fois et gardé dans le navigateur. Il dit au serveur
 * « c'est encore moi » et suffit à retrouver son nom et sa caisse. Stockage
 * refusé (navigation privée, cookies bloqués) : on renvoie null et la session
 * tourne sans mémoire, comme avant.
 */
const IDENT = "mirage.ident.v1";
function identity() {
  try {
    let t = localStorage.getItem(IDENT);
    if (!/^[0-9a-f]{32}$/.test(t || "")) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      t = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(IDENT, t);
    }
    return t;
  } catch {
    return null;
  }
}

export class Net {
  /**
   * @param {object} o {scene, people, player, onCount}
   */
  constructor(o) {
    this.scene = o.scene;
    this.people = o.people;
    this.player = o.player;
    this.onCount = o.onCount || (() => { });
    // Résout un identifiant de place ("blackjack:2") en position monde de la
    // CHAISE. Indispensable : on transmet la position de la caméra, or en
    // s'asseyant elle avance de 52 cm vers la table — l'avatar finissait donc
    // planté dans le plateau au lieu d'être sur son siège.
    this.spotPos = o.spotPos || (() => null);
    this.onTable = o.onTable || (() => { });
    // Le concert est un événement de SALLE : il arrive du serveur, jamais d'ici.
    this.onConcert = o.onConcert || (() => { });
    // Le jackpot du pit : une cagnotte commune aux trois tables, annoncée à
    // toute la salle — y compris à qui n'est assis nulle part.
    this.onJackpot = o.onJackpot || (() => { });
    // Le salon : {id, name, text}. Le serveur rediffuse À TOUT LE MONDE,
    // expéditeur compris — c'est ce retour qui sert d'accusé d'envoi.
    this.onChat = o.onChat || (() => { });
    // Le profil rendu à la connexion (pseudo, caisse, position, préférences),
    // et les mouvements de caisse qui suivent. Le serveur fait foi : le client
    // n'additionne rien de son côté, il affiche ce qu'on lui annonce.
    this.onProfile = o.onProfile || (() => { });
    this.onWallet = o.onWallet || (() => { });
    // Le plan des places, à enseigner au serveur : lui seul décidera où
    // reposer un joueur, y compris un joueur parti sans un mot.
    this.spotMap = o.spotMap || null;
    this.token = identity();
    this.id = null;
    this.name = "";             // pseudo, réémis à chaque connexion (voir setName)
    this.peers = new Map();     // id -> {npc, target:{p,r}, seat, name}
    this.ws = null;
    this._acc = 0;
    this._last = { p: V3(0, 0, 0), r: 0, spot: null, safe: null };
    this._retry = 0;
    this._spot = null;
    this.connected = false;

    // Relance indépendante de la boucle de rendu. Un onglet en arrière-plan voit
    // son requestAnimationFrame suspendu par le navigateur : `tick()` cesse
    // d'être appelé et le joueur se fige pour les autres. setInterval, lui,
    // continue de tourner (ralenti à ~1 Hz, ce qui suffit largement ici).
    this._ka = setInterval(() => this._send(true), 2000);
  }

  dispose() {
    clearInterval(this._ka);
    try { this.ws?.close(); } catch (e) { }
    this._dropAll();
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // le jeton part dans l'URL : le serveur le lit à la poignée de main, avant
    // même le premier message, et a donc le profil sous la main pour `welcome`
    const q = this.token ? "?id=" + this.token : "";
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws${q}`);
    } catch (e) {
      this._scheduleRetry();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this._retry = 0;
      // Pose initiale émise TOUT DE SUITE. Sans ça le serveur garde [0,0,0] et
      // l'avatar apparaît à l'origine du monde, à 14,5 m du point d'apparition.
      this._send(true);
      // ...et le pseudo À CHAQUE (re)connexion : le serveur ne garde rien, il
      // rebaptise « Joueur N » tout nouveau venu. Une coupure de réseau ne doit
      // pas faire perdre son nom au joueur.
      this._sendName();
      // LE PLAN DES PLACES, tout de suite. Il doit être chez le serveur AVANT
      // que le joueur ne puisse s'asseoir puis disparaître — c'est justement
      // pour le cas où plus personne n'est là pour parler qu'il existe.
      this._sendSpots();
      console.info("[net] connecté");
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      // un message mal digéré ne doit pas tuer la liaison : on le signale et
      // on laisse le suivant resynchroniser (l'état complet revoyage sans arrêt)
      try { this._handle(m); } catch (e) { console.error("[net] message", m && m.t, "en échec :", e); }
    };
    ws.onclose = () => {
      this.connected = false;
      this._dropAll();
      this._scheduleRetry();
    };
    ws.onerror = () => { /* onclose suit toujours */ };
  }

  /**
   * Le pseudo choisi à l'écran-titre (registre des réglages, clé `pseudo`).
   * Appelé aussi à chaud : se renommer en pleine partie diffuse un `rename`
   * que les autres clients appliquent à l'étiquette de l'avatar.
   */
  setName(name) {
    const n = String(name || "").slice(0, 24);
    if (n === this.name) return;
    this.name = n;
    this._sendName();
  }

  _sendSpots() {
    if (!this.spotMap || this.ws?.readyState !== WebSocket.OPEN) return;
    try {
      const map = this.spotMap();
      if (map && Object.keys(map).length) {
        this.ws.send(JSON.stringify({ t: "spots", map }));
      }
    } catch (e) {
      // un plan qu'on ne sait pas dresser n'empêche pas de jouer : le serveur
      // gardera ses propres filets (dernière position debout, apparition)
      console.warn("[net] plan des places non transmis", e);
    }
  }

  _sendName() {
    // un nom vide ne s'envoie pas : le serveur garderait « Joueur N » de toute
    // façon, autant ne pas écraser un nom déjà connu par du néant
    if (!this.name || this.ws?.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify({ t: "name", name: this.name })); } catch { }
  }

  _scheduleRetry() {
    // repli progressif, plafonné : un serveur absent ne doit pas marteler
    const wait = Math.min(8000, 500 * Math.pow(2, this._retry++));
    setTimeout(() => this.connect(), wait);
  }

  _handle(m) {
    switch (m.t) {
      case "welcome":
        this.id = m.you;
        this.dev = !!m.dev;      // active les raccourcis de test côté client
        // ce que le serveur nous rend de la session précédente, AVANT tout le
        // reste : la caisse et la position doivent être posées avant que le
        // joueur ne franchisse l'écran-titre
        if (m.me) { this.profile = m.me; this.onProfile(m.me); }
        for (const p of m.players) this._upsert(p);
        // photo de CHAQUE table : un arrivant voit toutes les parties en cours
        if (Array.isArray(m.bj)) m.bj.forEach((st, i) => this.onTable(st, [], i));
        else if (m.bj) this.onTable(m.bj, [], 0);
        // un spectacle peut être en cours : on y entre en marche
        if (m.concert) this.onConcert(m.concert);
        // ...et la cagnotte du pit est déjà à son chiffre du moment
        if (m.jackpot) this.onJackpot(m.jackpot);
        break;
      case "jackpot":
        this.onJackpot(m);
        break;
      case "bj":
        this.onTable(m.state, m.events || [], m.table || 0);
        break;
      case "concert":
        this.onConcert(m.state);
        break;
      case "chat":
        this.onChat(m);
        break;
      case "wallet":
        if (Number.isFinite(m.cash)) this.onWallet(m.cash);
        break;
      case "join":
        this._upsert(m.player);
        break;
      case "sync":
        for (const p of m.players) {
          if (p.id !== this.id) this._upsert(p);
        }
        break;
      case "leave":
        this._drop(m.id);
        break;
      case "rename": {
        const peer = this.peers.get(m.id);
        if (peer) peer.name = m.name;
        break;
      }
    }
    this.onCount(this.peers.size + 1);
  }

  /** Crée ou met à jour l'avatar d'un joueur distant. */
  _upsert(p) {
    if (p.id === this.id) return;
    let peer = this.peers.get(p.id);
    if (!peer) {
      // un figurant ordinaire sert d'avatar : même modèle, même pipeline de pose
      const npc = this.people.spawn(V3(p.p[0], 0, p.p[2]), p.r, { height: 1.75, avatar: true });
      // PAS de volume de collision sur les avatars. J'en avais ajouté un pour
      // qu'on ne traverse pas les autres joueurs : c'était pire que le mal.
      // Chaque client connecté posait un cylindre invisible là où son avatar se
      // trouvait — souvent au point d'apparition commun — et on se retrouvait
      // bloqué par du vide un peu partout. Un joueur qui gêne est au moins
      // VISIBLE ; un mur invisible, non.
      peer = { npc, name: p.name, seat: null, placed: false,
               target: { p: V3(p.p[0], 0, p.p[2]), r: p.r } };
      npc.root.setEnabled(false);
      this.peers.set(p.id, peer);
    }
    const seatAt = p.spot ? this.spotPos(p.spot) : null;
    if (seatAt) peer.target.p.set(seatAt.x, 0, seatAt.z);
    else peer.target.p.set(p.p[0], 0, p.p[2]);

    // un joueur encore à l'origine n'a jamais émis sa pose : ni corps, ni avatar
    const real = seatAt || Math.abs(p.p[0]) > 0.01 || Math.abs(p.p[2]) > 0.01;
    if (real && !peer.placed) {
      peer.placed = true;
      peer.npc.root.position.set(peer.target.p.x, 0, peer.target.p.z);
      peer.npc.root.setEnabled(true);
    }
    peer.target.r = p.r;
    peer.name = p.name ?? peer.name;
    peer.spot = p.spot ?? null;

    // assis / debout : on rejoue la pose localement plutôt que de la transmettre
    if (p.spot !== peer.sat) {
      peer.sat = p.spot;
      if (p.spot && !peer.npc.seated) {
        peer.npc.seated = true;
        peer.npc._sit(p.spot.startsWith("bar:") ? 0.84 : 0.79);
      }
    }
  }

  /**
   * Envoie une intention de jeu. Le serveur tranche, le client ne décide rien.
   * `tableIdx` (posé par main.js à l'assise) route vers la bonne table.
   */
  bj(action, extra = {}) {
    if (!this.connected || this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ t: "bj", do: action, table: this.tableIdx ?? 0, ...extra }));
  }

  /**
   * Mouvement de caisse hors blackjack : machine à sous, bar. La table, elle,
   * n'a pas besoin de ça — le serveur y tient déjà les comptes.
   *
   * Le serveur répond avec la caisse qui fait foi (`onWallet`). Sans liaison,
   * l'appel est sans effet : la caisse locale garde sa valeur du moment et
   * sera recalée à la reconnexion.
   * @param {number} delta euros gagnés (positif) ou dépensés (négatif)
   */
  wallet(delta) {
    const v = Math.round(Number(delta) || 0);
    if (!v || !this.connected || this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ t: "wallet", v }));
  }

  /**
   * Préférences retenues d'une session à l'autre (mise de machine, verres bus).
   * Groupées : la molette d'une machine à sous en émettrait sinon une par cran.
   */
  prefs(obj) {
    this._prefs = { ...(this._prefs || {}), ...obj };
    clearTimeout(this._prefsT);
    this._prefsT = setTimeout(() => {
      const p = this._prefs;
      this._prefs = null;
      if (!p || !this.connected || this.ws?.readyState !== 1) return;
      this.ws.send(JSON.stringify({ t: "prefs", ...p }));
    }, 400);
  }

  /**
   * Demande de spectacle : "start" ou "stop". Comme au blackjack, ce n'est
   * qu'une intention — le serveur décide et rediffuse à toute la salle.
   */
  concert(action) {
    if (!this.connected || this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ t: "concert", do: action }));
  }

  /**
   * Une phrase dans le salon. Renvoie false si la liaison est absente —
   * l'appelant le dit au joueur plutôt que d'avaler la phrase en silence.
   * Le serveur retaille de son côté : ce plafond-ci n'est qu'une politesse.
   */
  chat(text) {
    const t = String(text || "").trim().slice(0, 200);
    if (!t) return false;
    if (!this.connected || this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify({ t: "chat", text: t }));
    return true;
  }

  /** Places déjà prises par les AUTRES joueurs, par identifiant (`bar:3`…). */
  occupied() {
    const set = new Set();
    for (const peer of this.peers.values()) {
      if (peer.spot) set.add(peer.spot);
    }
    return set;
  }

  _drop(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    try { peer.npc.dispose(); } catch (e) { }
    this.peers.delete(id);
  }

  _dropAll() {
    for (const id of [...this.peers.keys()]) this._drop(id);
    this.onCount(1);
  }

  /**
   * Appelée à chaque frame : émission throttlée + interpolation des avatars.
   * @param {string|null} spot place assise revendiquée
   * @param {BABYLON.Vector3|null} safe point de sortie de cette place — où le
   *   corps se retrouvera en se levant. Le serveur le garde pour n'avoir
   *   JAMAIS à persister une pose assise (voir main.js, `seatExit`).
   */
  tick(dt, spot, safe) {
    // ---- avatars distants : rattrapage doux vers la dernière pose reçue ----
    const k = clamp(dt * 9, 0, 1);
    for (const peer of this.peers.values()) {
      const r = peer.npc.root;
      const px = r.position.x, pz = r.position.z;
      r.position.x += (peer.target.p.x - r.position.x) * k;
      r.position.z += (peer.target.p.z - r.position.z) * k;
      let d = peer.target.r - r.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      r.rotation.y += d * k;

      // Locomotion : déduite du déplacement réellement effectué, pas d'un état
      // transmis. Un lissage évite de basculer marche/arrêt à chaque frame.
      const v = Math.hypot(r.position.x - px, r.position.z - pz) / Math.max(dt, 1e-4);
      peer.speed = (peer.speed || 0) * 0.8 + v * 0.2;

      let want;
      if (peer.spot) {
        // Assis : aucun clip. Le modèle Mixamo n'a pas d'animation assise, et
        // surtout un clip debout qui continuerait de tourner ÉCRASERAIT la pose
        // assise posée par `_sit()`. C'était le bug : le personnage restait
        // planté en marche sur sa chaise.
        want = "sit";
      } else {
        // Hystérésis : deux seuils, sinon l'avatar clignote entre marche et
        // repos dès qu'il frôle la valeur de bascule.
        const cur = peer.clip;
        want = cur === "walk"
          ? (peer.speed > 0.14 ? "walk" : "idle")
          : (peer.speed > 0.34 ? "walk" : "idle");
      }

      if (want !== peer.clip) {
        if (want === "sit") peer.npc.stopClip();
        else peer.npc.play(want);
        // on retient l'intention même si le clip n'existe pas, sinon on
        // relancerait la tentative à chaque frame
        peer.clip = want;
      }
    }

    this._spot = spot ?? null;
    this._safe = safe ?? null;
    this._acc += dt;
    if (this._acc < 1 / SEND_HZ) return;
    this._acc = 0;
    this._send(false);
  }

  /**
   * Émet la pose. `force` court-circuite le test de mouvement — indispensable à
   * la connexion et pour la relance périodique.
   */
  _send(force) {
    if (!this.connected || this.ws?.readyState !== 1) return;
    const cam = this.player?.camera;
    if (!cam) return;
    const p = cam.position;
    const spot = this._spot ?? null;
    const safe = this._safe ?? null;
    const moved = Math.abs(p.x - this._last.p.x) > MOVE_EPS
      || Math.abs(p.z - this._last.p.z) > MOVE_EPS
      || Math.abs(cam.rotation.y - this._last.r) > TURN_EPS
      || spot !== this._last.spot
      || !!safe !== !!this._last.safe;
    if (!force && !moved) return;

    this._last.p.copyFrom(p);
    this._last.r = cam.rotation.y;
    this._last.spot = spot;
    this._last.safe = safe;
    this.ws.send(JSON.stringify({
      t: "state",
      // l'avatar se pose au sol : on n'envoie pas la hauteur d'œil
      p: [+p.x.toFixed(2), 0, +p.z.toFixed(2)],
      r: +cam.rotation.y.toFixed(3),
      spot,
      // le point de sortie voyage avec la pose : le serveur l'a donc DÉJÀ en
      // main si la liaison se coupe brutalement, onglet fermé ou câble arraché
      ...(safe ? { sp: [+safe.x.toFixed(2), +safe.y.toFixed(2), +safe.z.toFixed(2)] } : {}),
    }));
  }
}
