/**
 * Multijoueur : synchronisation des joueurs par WebSocket.
 *
 * Volontairement minimal et sans persistance — on n'échange que la pose de
 * chaque joueur. Le blackjack reste local à chacun : on voit les autres se
 * déplacer et s'asseoir, pas leur main de cartes.
 *
 * Deux précautions qui font tout le rendu :
 *  - les avatars distants sont INTERPOLÉS vers la dernière pose reçue, sinon
 *    ils sautent d'une position à l'autre à chaque trame réseau (15 Hz) ;
 *  - on n'émet que si la pose a bougé, pour ne pas saturer la liaison à l'arrêt.
 */
import { V3, clamp } from "./util.js";
const B = BABYLON;

const SEND_HZ = 12;
const MOVE_EPS = 0.015;      // m
const TURN_EPS = 0.02;       // rad

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
    this.id = null;
    this.peers = new Map();     // id -> {npc, target:{p,r}, seat, name}
    this.ws = null;
    this._acc = 0;
    this._last = { p: V3(0, 0, 0), r: 0, spot: null };
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
    let ws;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
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
      console.info("[net] connecté");
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this._handle(m);
    };
    ws.onclose = () => {
      this.connected = false;
      this._dropAll();
      this._scheduleRetry();
    };
    ws.onerror = () => { /* onclose suit toujours */ };
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
        for (const p of m.players) this._upsert(p);
        // photo de la table : un arrivant voit la partie en cours
        if (m.bj) this.onTable(m.bj, []);
        break;
      case "bj":
        this.onTable(m.state, m.events || []);
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

  /** Envoie une intention de jeu. Le serveur tranche, le client ne décide rien. */
  bj(action, extra = {}) {
    if (!this.connected || this.ws?.readyState !== 1) return;
    this.ws.send(JSON.stringify({ t: "bj", do: action, ...extra }));
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

  /** Appelée à chaque frame : émission throttlée + interpolation des avatars. */
  tick(dt, spot) {
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
    const moved = Math.abs(p.x - this._last.p.x) > MOVE_EPS
      || Math.abs(p.z - this._last.p.z) > MOVE_EPS
      || Math.abs(cam.rotation.y - this._last.r) > TURN_EPS
      || spot !== this._last.spot;
    if (!force && !moved) return;

    this._last.p.copyFrom(p);
    this._last.r = cam.rotation.y;
    this._last.spot = spot;
    this.ws.send(JSON.stringify({
      t: "state",
      // l'avatar se pose au sol : on n'envoie pas la hauteur d'œil
      p: [+p.x.toFixed(2), 0, +p.z.toFixed(2)],
      r: +cam.rotation.y.toFixed(3),
      spot,
    }));
  }
}
