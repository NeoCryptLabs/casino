/**
 * PERSISTANCE DES JOUEURS — un profil par identité, sur disque.
 *
 * Il n'y a pas d'authentification ici (cf. README) : l'identité est un jeton
 * aléatoire que le client fabrique une fois et garde dans son `localStorage`,
 * puis présente à chaque connexion (`/ws?id=…`). Ça ne prouve rien — c'est un
 * ticket de vestiaire, pas un mot de passe : qui le recopie prend la place. En
 * échange le joueur retrouve son nom, sa caisse et l'endroit où il s'était
 * arrêté, sans compte à créer.
 *
 * Ce qui est gardé : le pseudo, LA CAISSE (une seule, pour tout le casino —
 * blackjack, machines à sous, bar), LA BANQUE DE TEMPS (les barres de temps
 * additionnel encore en réserve), la dernière pose DEBOUT, et deux broutilles
 * de confort (verres bus, mise de machine choisie).
 *
 * Ce qui n'est PAS gardé, volontairement : la place assise, la main en cours et
 * la série de chaleur. On ne se rassied pas tout seul à une table, et la
 * chaleur est une propriété de la TABLE — on ne l'emporte pas dans sa poche.
 *
 * Le fichier est réécrit en entier, atomiquement (temporaire + `rename`), au
 * plus une fois toutes les SAVE_MS et seulement si son contenu a changé.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const VERSION = 1;
const SAVE_MS = 10_000;                       // plancher entre deux écritures
const MAX_PROFILES = 2000;                    // le fichier ne gonfle pas sans fin
const MAX_AGE_MS = 90 * 24 * 3600 * 1000;     // un profil oublié depuis 3 mois s'efface
const TOKEN = /^[0-9a-f]{32}$/;

/** Caisse d'un nouveau venu. */
export const START_CASH = 2500;
/**
 * LA MAISON RÉ-AVANCE. Une caisse persistante peut tomber à zéro, et un joueur
 * ruiné pour toujours n'a plus de jeu : ni blackjack, ni machine, ni verre. On
 * le remet en selle À L'ARRIVÉE, et seulement là — on ne se renfloue pas en
 * pleine partie, la ruine doit rester une gifle.
 */
export const FLOOR_CASH = 100;
export const ADVANCE_CASH = 500;

/**
 * LA BANQUE DE TEMPS vit DANS LE PROFIL, pas sur la place.
 *
 * C'est tout son sens : le temps consommé ne revient pas — ni à la main
 * suivante, ni en changeant de table, ni en rechargeant la page. Si elle était
 * portée par la place, il aurait suffi de se relever pour la retrouver pleine,
 * et le rachat n'aurait rien coûté à personne.
 *
 * ELLE SE COMPTE EN MILLISECONDES, et ne fond QUE pendant le dépassement :
 * le chrono normal du tour ne l'entame jamais. Déborder de 3 s coûte 3 s —
 * il en reste 17 pour les prochaines fois, pas zéro. Le plafond reste la
 * mécanique elle-même : on ne peut racheter QUE la réserve épuisée, donc
 * jamais faire provision de sursis avant d'en avoir eu besoin.
 *
 * Le nouveau venu reçoit la réserve pleine, offerte par la maison. Ensuite
 * il paye.
 */
export const TIME_BANK_START = 20000;   // ms
export const TIME_BANK_MAX = 20000;     // ms — la taille du réservoir

const clampNum = (v, lo, hi, def) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;

function blank(id) {
  const now = Date.now();
  return {
    id, name: "", cash: START_CASH,
    p: null,            // null = jamais posé : le client reprend son point d'apparition
    r: 0, drinks: 0, slotBet: 10,
    // CE QU'IL A MIS ET REPRIS au blackjack, cumulé sur toute sa vie de joueur.
    // Leur différence plafonne sa cagnotte de série (voir POT_SHARE dans
    // blackjack.mjs) : elle ne rembourse que ce qu'il a réellement laissé.
    staked: 0, back: 0,
    // barres de temps additionnel en réserve (voir TIME_BANK_START)
    tbank: TIME_BANK_START,
    created: now, seen: now,
  };
}

/** Relecture défensive : rien de ce qui vient du disque n'est cru sur parole. */
function sanitize(id, raw) {
  const p = blank(id);
  if (!raw || typeof raw !== "object") return p;
  // pas de caractères de contrôle : ce nom finit dans une bulle de chat
  p.name = String(raw.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 24);
  p.cash = Math.round(clampNum(Number(raw.cash), 0, 1e9, START_CASH));
  if (Array.isArray(raw.p) && raw.p.length === 3 && raw.p.every(Number.isFinite)) {
    p.p = raw.p.map((v) => clampNum(v, -200, 200, 0));
  }
  p.r = clampNum(Number(raw.r), -1e4, 1e4, 0);
  p.drinks = Math.round(clampNum(Number(raw.drinks), 0, 9999, 0));
  p.slotBet = Math.round(clampNum(Number(raw.slotBet), 5, 200, 10));
  p.staked = Math.round(clampNum(Number(raw.staked), 0, 1e12, 0));
  p.back = Math.round(clampNum(Number(raw.back), 0, 1e12, 0));
  // un profil d'avant la banque de temps n'a pas le champ : réserve offerte.
  // MIGRATION : les anciens profils comptaient en BARRES (0 ou 1) — une
  // valeur ≤ 1 est une barre d'antan et vaut le réservoir entier ; au-delà,
  // ce sont déjà des millisecondes.
  let tb = Number(raw.tbank);
  if (Number.isFinite(tb) && tb >= 0 && tb <= 1) tb = tb * TIME_BANK_MAX;
  p.tbank = Math.round(clampNum(tb, 0, TIME_BANK_MAX, TIME_BANK_START));
  const soon = Date.now() + 86_400_000;       // une horloge un peu avancée, pas l'an 3000
  p.seen = clampNum(Number(raw.seen), 0, soon, Date.now());
  p.created = clampNum(Number(raw.created), 0, soon, p.seen);
  return p;
}

export class Profiles {
  /** @param {string} file chemin du fichier de profils */
  constructor(file) {
    this.file = file;
    this.map = new Map();      // jeton -> profil
    this.live = new Set();     // jetons tenus par une connexion en cours
    this._written = null;      // dernier contenu réellement écrit
    this._lastAt = 0;
    this._chain = Promise.resolve();
  }

  /** Relit le fichier. Absent ou illisible : on repart d'un registre vide. */
  async load() {
    let raw = null;
    try { raw = JSON.parse(await readFile(this.file, "utf8")); }
    catch (e) {
      if (e.code !== "ENOENT") console.warn("[profils] fichier illisible :", e.message);
      return 0;
    }
    const players = raw && typeof raw === "object" ? raw.players : null;
    if (!players || typeof players !== "object") return 0;
    const now = Date.now();
    const kept = Object.entries(players)
      .filter(([id]) => TOKEN.test(id))
      .map(([id, v]) => sanitize(id, v))
      .filter((p) => now - p.seen < MAX_AGE_MS)
      .sort((a, b) => b.seen - a.seen)
      .slice(0, MAX_PROFILES);
    for (const p of kept) this.map.set(p.id, p);
    this._written = this._serialize();
    return this.map.size;
  }

  /**
   * Prend le profil de ce jeton pour la durée d'une connexion.
   *
   * Deux onglets présentant le MÊME jeton ne partagent pas une caisse : le
   * second reçoit une copie volatile (même nom, même somme à l'instant T) qui
   * ne sera jamais réécrite. Sans ça, deux fenêtres dépenseraient le même
   * argent et la dernière fermée écraserait le travail de l'autre.
   *
   * @returns {{profile:object, token:string|null, fresh:boolean, why:string}}
   *   `token` non nul = ce profil sera persisté.
   */
  claim(token) {
    if (!TOKEN.test(token || "")) {
      return { profile: blank("volatile"), token: null, fresh: true, why: "sans jeton" };
    }
    // JETON DÉJÀ EN JEU : la nouvelle session le REPREND, elle ne se contente
    // plus d'une copie volatile.
    //
    // Le cas courant n'est pas le double onglet, c'est le simple rechargement
    // de page : le navigateur ouvre la nouvelle liaison avant que le serveur
    // ait vu la fermeture de l'ancienne. Refuser le jeton condamnait alors la
    // session à ne rien retenir — position, caisse, pseudo — et le joueur
    // revenait à l'endroit de l'avant-dernière visite. Le dernier arrivé gagne ;
    // c'est à l'appelant de faire passer le précédent en volatile (voir
    // `claim.stolen` dans server.mjs), pour que deux sessions n'écrivent jamais
    // dans le même profil.
    const stolen = this.live.has(token);
    let p = this.map.get(token);
    const fresh = !p;
    if (!p) {
      p = blank(token);
      this.map.set(token, p);
      this._prune();
    }
    p.seen = Date.now();
    this.live.add(token);
    return { profile: p, token, fresh, stolen, why: stolen ? "jeton repris" : "" };
  }

  /** Rend le jeton : une reconnexion retrouvera le vrai profil, pas une copie. */
  release(token) { if (token) this.live.delete(token); }

  /** Le registre ne grandit pas sans fin : les plus vieux dormeurs partent. */
  _prune() {
    if (this.map.size <= MAX_PROFILES) return;
    const cold = [...this.map.values()]
      .filter((p) => !this.live.has(p.id))
      .sort((a, b) => a.seen - b.seen);
    for (const p of cold) {
      if (this.map.size <= MAX_PROFILES) break;
      this.map.delete(p.id);
    }
  }

  _serialize() {
    const players = {};
    // les plus récents d'abord : le fichier se lit à l'œil
    for (const p of [...this.map.values()].sort((a, b) => b.seen - a.seen)) {
      players[p.id] = p;
    }
    return JSON.stringify({ version: VERSION, players }, null, 1) + "\n";
  }

  /**
   * Écrit si nécessaire. `force` court-circuite le plancher de cadence — pour
   * une déconnexion ou un arrêt du serveur, où l'on ne peut pas attendre.
   * @returns {Promise<boolean>} vrai si le disque a été touché
   */
  async flush({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - this._lastAt < SAVE_MS) return false;
    const body = this._serialize();
    if (body === this._written) { this._lastAt = now; return false; }
    this._lastAt = now;
    // les écritures ne se chevauchent jamais : elles s'enchaînent dans l'ordre
    this._chain = this._chain.then(async () => {
      const tmp = this.file + ".tmp";
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(tmp, body);
      await rename(tmp, this.file);       // remplacement atomique
      this._written = body;
    }).catch((e) => {
      console.warn("[profils] écriture impossible :", e.message);
    });
    await this._chain;
    return true;
  }

  get size() { return this.map.size; }
}
