/**
 * LE CONCERT, côté serveur — un seul spectacle pour toute la salle.
 *
 * Même principe que la table de blackjack : le serveur tient la machine à
 * états, les clients ne font que la mettre en scène. Quand un joueur lance le
 * concert, tout le monde voit le rideau s'ouvrir au même instant ; un joueur
 * qui arrive en cours de morceau tombe au bon endroit du spectacle, musique
 * comprise, parce que l'état diffusé porte le temps écoulé dans la phase.
 *
 * La fin n'est PAS décidée par un client : la phase `performing` dure
 * exactement le morceau, mesuré une fois au démarrage dans l'en-tête du mp3.
 * La musique se termine, la chanteuse salue, sort, le rideau tombe.
 */
import { readFileSync } from "node:fs";

/**
 * Durée d'un mp3, sans dépendance ni décodage.
 *
 * On saute l'étiquette ID3v2, on lit l'en-tête de la première trame (débit,
 * fréquence, version) puis, si l'encodeur a posé un en-tête Xing/Info, le
 * NOMBRE DE TRAMES qu'il annonce — c'est la seule mesure juste en débit
 * variable. Sans Xing, on retombe sur taille/débit, exact en débit constant.
 */
export function mp3Duration(path) {
  let b;
  try { b = readFileSync(path); } catch { return 0; }
  let o = 0;
  if (b.length > 10 && b.toString("latin1", 0, 3) === "ID3") {
    // taille ID3v2 : quatre octets à 7 bits utiles
    o = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
  }
  // resynchronisation : la première trame ne suit pas toujours l'étiquette
  while (o + 4 < b.length && !(b[o] === 0xff && (b[o + 1] & 0xe0) === 0xe0)) o++;
  if (o + 4 >= b.length) return 0;

  const verBits = (b[o + 1] >> 3) & 3;              // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b[o + 1] >> 1) & 3;                // 1 = Layer III
  const brIdx = (b[o + 2] >> 4) & 0x0f;
  const srIdx = (b[o + 2] >> 2) & 3;
  if (layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) return 0;

  const SR = [[11025, 12000, 8000], [], [22050, 24000, 16000], [44100, 48000, 32000]];
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const rate = (SR[verBits] || [])[srIdx];
  const kbps = (verBits === 3 ? BR1 : BR2)[brIdx];
  if (!rate || !kbps) return 0;
  const perFrame = verBits === 3 ? 1152 : 576;      // échantillons par trame

  // en-tête Xing/Info : il vit dans la zone de données de la première trame
  const head = b.toString("latin1", o, Math.min(b.length, o + 200));
  const tag = head.search(/Xing|Info/);
  if (tag > 0) {
    const at = o + tag;
    const flags = b.readUInt32BE(at + 4);
    if (flags & 1) {
      const frames = b.readUInt32BE(at + 8);
      if (frames > 0) return (frames * perFrame) / rate;
    }
  }
  return ((b.length - o) * 8) / (kbps * 1000);
}

/** Enchaînement des phases et leur durée en ms. `performing` dure le morceau. */
const NEXT = {
  announce: "opening",
  opening: "entering",
  entering: "performing",
  performing: "bow",
  bow: "leaving",
  leaving: "closing",
  closing: "idle",
};
const DUR = {
  announce: 3600,   // l'annonce se pose avant que le rideau bouge
  opening: 2000,    // le velours est lourd (ressort amorti côté client)
  entering: 4200,   // des coulisses au micro : 3,35 m à 0,95 m/s, marge comprise
  performing: 0,    // remplacé par la durée du morceau
  bow: 2600,
  leaving: 3800,
  closing: 2200,
};

export class Concert {
  /**
   * @param {(msg:object)=>void} send diffusion à tous les clients
   * @param {string} songPath chemin du morceau chanté
   */
  constructor(send, songPath) {
    this.send = send;
    this.song = Math.round(mp3Duration(songPath) * 1000) || 180000;
    this.phase = "idle";
    this.t0 = Date.now();
    this.by = null;
    console.log(`[concert] morceau : ${(this.song / 1000).toFixed(1)} s`);
  }

  _dur(phase = this.phase) {
    return phase === "performing" ? this.song : (DUR[phase] || 0);
  }

  /** Photo diffusable. `since` permet à un arrivant de tomber au bon endroit. */
  state() {
    return {
      phase: this.phase,
      since: this.phase === "idle" ? 0 : Date.now() - this.t0,
      dur: this._dur(),
      song: this.song,
      by: this.by,
    };
  }

  _to(phase) {
    this.phase = phase;
    this.t0 = Date.now();
    if (phase === "idle") this.by = null;
    this.send({ t: "concert", state: this.state() });
  }

  /** Un joueur lance le spectacle. Ignoré si un concert tourne déjà. */
  start(id, name) {
    if (this.phase !== "idle") return false;
    this.by = name || ("Joueur " + id);
    console.log(`[concert] lancé par ${this.by}`);
    this._to("announce");
    return true;
  }

  /**
   * Fin anticipée, demandée depuis la salle. Seulement pendant le morceau :
   * on ne coupe pas une entrée en scène ni un salut.
   */
  stop(id) {
    if (this.phase !== "performing") return false;
    console.log(`[concert] écourté par le joueur ${id}`);
    this._to("bow");
    return true;
  }

  /** Avance l'horloge du spectacle. Appelée au même rythme que les tables. */
  tick() {
    if (this.phase === "idle") return;
    const d = this._dur();
    if (d && Date.now() - this.t0 >= d) this._to(NEXT[this.phase]);
  }
}
