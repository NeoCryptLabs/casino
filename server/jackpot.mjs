/**
 * LE JACKPOT DU PIT — une seule cagnotte pour les trois tables.
 *
 * C'est le seul objet du casino que tout le monde regarde en même temps : il
 * monte à chaque mise 21+3 posée n'importe où dans le pit, il est affiché en
 * enseigne au-dessus des tables, et quand quelqu'un le touche, TOUTE la salle
 * l'apprend. C'est ce qui fait qu'un joueur assis à la table 2 lève les yeux
 * quand la table 0 gagne.
 *
 * Il vit ici, côté serveur, pour la même raison que la chaleur : deux clients
 * doivent voir le même chiffre au même instant, et personne ne doit pouvoir
 * s'inventer une cagnotte.
 *
 * Alimentation et paiement :
 *  - chaque euro misé au 21+3 en verse SHARE (arrondi, au moins 1 €) ;
 *  - le BRELAN ASSORTI — la main la plus rare du 21+3, déjà payée 100:1 —
 *    emporte la cagnotte entière, qui repart de sa graine.
 */

/** Remise en jeu après un coup gagnant : la cagnotte n'est jamais vide. */
const SEED = 2500;
/** Part de chaque mise annexe qui tombe dans la cagnotte. */
const SHARE = 0.12;
/** Plafond de sécurité : un casino ouvert des mois ne doit pas dériver. */
const CAP = 1_000_000;

export class Jackpot {
  /** @param {(msg:object)=>void} emit diffuse à toute la salle */
  constructor(emit) {
    this.emit = emit;
    this.value = SEED;
    this.last = null;          // dernier vainqueur : {name, amount, at}
    this._dirty = false;
  }

  state() {
    return { value: Math.round(this.value), seed: SEED, last: this.last };
  }

  /**
   * Une mise annexe vient d'être posée : la cagnotte grossit.
   * @param {number} stake euros misés au 21+3
   */
  feed(stake) {
    const v = Math.max(1, Math.round(stake * SHARE));
    this.value = Math.min(CAP, this.value + v);
    this._dirty = true;
    return v;
  }

  /**
   * Touché. La cagnotte part ENTIÈRE et repart de sa graine ; l'annonce est
   * immédiate (pas de regroupement : c'est l'événement de la soirée).
   * @param {{name:string, seat:number, table:number, pid:number}} who
   * @returns {number} euros emportés
   */
  hit(who) {
    const gain = Math.round(this.value);
    this.value = SEED;
    this.last = { name: who.name || "un joueur", amount: gain, at: Date.now() };
    this._dirty = false;
    this.emit({
      t: "jackpot", value: SEED,
      // `pid` permet à chaque client de savoir si c'est LUI qui vient de le
      // toucher — la fête n'est pas la même vue de la place gagnante.
      hit: { ...this.last, seat: who.seat, table: who.table, pid: who.pid ?? null },
    });
    return gain;
  }

  /**
   * Diffusion groupée. La cagnotte bouge à chaque mise annexe : on ne la
   * réannonce qu'au battement suivant, et seulement si elle a changé.
   */
  tick() {
    if (!this._dirty) return;
    this._dirty = false;
    this.emit({ t: "jackpot", value: Math.round(this.value) });
  }
}
