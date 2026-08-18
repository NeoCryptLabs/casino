/**
 * Table de blackjack AUTORITAIRE, côté serveur.
 *
 * Elle tourne en continu, indépendamment des joueurs connectés : le figurant de
 * la place 0 joue toujours, donc une partie est visible même casino vide. Les
 * clients ne décident de rien — ils envoient des intentions (miser, tirer,
 * rester, séparer, s'assurer) et reçoivent l'état ; toute la règle est ici.
 *
 * La table ne détient PAS l'argent : chaque place emprunte le portefeuille
 * qu'on lui confie en s'asseyant (`sit(..., wallet)`), c'est-à-dire le profil
 * persistant du joueur (server/profiles.mjs). La caisse ne repart donc plus de
 * zéro à chaque assise, et ce qui est gagné ici est le même argent que celui
 * des machines à sous et du bar. La main en cours, elle, ne survit pas au
 * redémarrage — c'est voulu.
 *
 * Les clients rendent la partie à partir de deux flux complémentaires :
 *  - `state` : photo complète, envoyée à chaque changement et à toute connexion
 *    tardive, pour qu'un arrivant voie la table telle qu'elle est ;
 *  - `events` : ce qui vient de se produire (carte distribuée, jeton posé…),
 *    pour déclencher les animations. Un client qui rate un event reste correct
 *    grâce à la photo — l'inverse serait faux.
 *
 * Règles servies : double, SPLIT (un seul, pas de re-split), ASSURANCE sur as
 * visible (2:1), side bet 21+3 (deux cartes du joueur + la carte visible du
 * croupier forment une main de poker), blackjack payé 3:2, croupier reste sur
 * tous les 17.
 *
 * Deux mécaniques de MAISON s'ajoutent à la règle :
 *  - la CAGNOTTE DE SÉRIE (`pot`) : le bonus de chaleur n'est plus payé à la
 *    main, il s'accumule et ne sort qu'encaissé — une main perdue l'emporte ;
 *  - le JACKPOT DU PIT (server/jackpot.mjs) : commun aux trois tables, nourri
 *    par les mises annexes, emporté par un brelan assorti au 21+3.
 */

import { START_CASH, TIME_BANK_MAX } from "./profiles.mjs";

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SEATS = 5;
const NPC_SEAT = 0;

/** Portefeuille de maison : celui du figurant, et celui d'une place libre. */
const houseWallet = () => ({ cash: START_CASH, tbank: 0 });

// durées de phase, en millisecondes
const T = { betting: 9000, deal: 900, turn: 12000, dealer: 650, payout: 5000, insurance: 7000 };
// table sans humain : le spectacle des figurants tourne vite, un passant voit
// plusieurs mains par minute au lieu d'attendre des phases dimensionnées pour
// laisser un joueur réfléchir
const T_EMPTY = { betting: 3500, payout: 3000 };

/**
 * LA BANQUE DE TEMPS — le sursis qu'on ne rend pas.
 *
 * Douze secondes suffisent pour décider, sauf le jour où le téléphone sonne.
 * Sans filet, la table tranchait à la place du joueur : sa main était figée
 * sur RESTER, sa mise en jeu, et il revenait sur un coup qu'il n'avait pas
 * joué. Le filet, c'est une RÉSERVE : quand le chrono de décision arrive à
 * zéro, une barre est consommée d'office et le temps repart pour T_BANK.
 *
 * Trois règles font tout l'objet :
 *  - elle ne se recharge JAMAIS toute seule — ni à la main suivante, ni en
 *    changeant de table, ni en revenant demain (elle vit dans le profil) ;
 *  - une barre par DÉCISION : le sursis ne se rejoue pas sur la même carte,
 *    mais tirer relance le chrono normal, et une autre barre peut y passer ;
 *  - elle se rachète au tapis, TIME_BANK_PRICE la barre, entre deux manches.
 *
 * Elle ne couvre QUE la décision (tirer / rester / doubler / séparer) : c'est
 * le seul moment où l'horloge coûte une main. Ne pas miser à temps ne coûte
 * rien, et l'assurance non répondue est déjà le choix prudent.
 *
 * Elle ne joue pas pour les places automatiques (figurant, place orpheline) :
 * qui a fermé son onglet ne stationne pas la table, il finit à la stratégie de
 * base. Le sursis est pour celui qui est encore là, pas pour celui qui est
 * parti.
 */
const T_BANK = 20000;
/**
 * Le rachat coûte une bouchée de pain — dix euros, moins que la plus petite
 * mise. Ce n'est PAS un prix : c'est un geste. Ce qui coûte au joueur, ce n'est
 * pas l'argent, c'est de devoir y penser entre deux manches, et de ne pouvoir
 * le faire qu'après coup. Un tarif dissuasif aurait fait du filet un privilège
 * de gros tapis ; à dix euros il reste ouvert à qui vient de se faire peur.
 */
export const TIME_BANK_PRICE = 10;

/**
 * Paliers de CHALEUR. Une série de mains gagnées d'affilée multiplie le gain.
 *
 * La série vit ici et nulle part ailleurs : deux clients doivent voir la même
 * flamme au même moment, et un client bricolé ne doit pas pouvoir s'inventer un
 * ×3. Le client ne fait que rendre le palier qu'on lui annonce.
 */
export const HEAT = [
  { at: 0, mult: 1, name: "" },
  { at: 1, mult: 1.2, name: "TIÈDE" },
  { at: 2, mult: 1.5, name: "CHAUD" },
  { at: 3, mult: 2, name: "BRÛLANT" },
  // 7 et non 5 : cinq mains d'affilée tombaient trop souvent pour le palier
  // maximal — l'INFERNO doit rester l'événement de la soirée, pas de l'heure.
  { at: 7, mult: 3, name: "INFERNO" },
];

/**
 * LA CAGNOTTE DE SÉRIE — le pari sur soi-même.
 *
 * Le bonus de chaleur ne tombe plus dans la poche à la fin de la main : il est
 * mis DE CÔTÉ, et n'en sort que de deux façons — le joueur l'encaisse (et sa
 * série retombe à zéro, le feu s'éteint), ou il continue et une main perdue
 * emporte tout.
 *
 * Le multiplicateur annoncé est HONNÊTE, et c'est la règle qui fixe le
 * montant : à ×3, une main gagnée vaut exactement trois fois son net — 1× payé
 * cash, 2× dans la cagnotte, à risque. L'ancien POT_BOOST doublait la part
 * cagnotte : la main « ×3 » valait ×5, l'annonce mentait et la maison payait
 * le mensonge.
 */

/**
 * PLAFOND DE LA CAGNOTTE — la part de ce que la place a réellement laissé à la
 * maison (cumul misé moins cumul rendu) qu'elle peut espérer récupérer.
 *
 * Sans ce plafond, la cagnotte suivait le bénéfice de la MAIN COURANTE : cent
 * mains à 25 € puis une seule à 500 € gagnée en série la faisaient bondir à
 * 200 €, sans le moindre rapport avec ce que le joueur avait dépensé. Elle
 * devient un remboursement partiel de ses pertes, jamais une prime sur un
 * coup d'éclat.
 */
const POT_SHARE = 0.5;

/** Palier atteint par une série donnée (le dernier seuil franchi). */
export function heatOf(streak) {
  let k = 0;
  for (let i = 0; i < HEAT.length; i++) if (streak >= HEAT[i].at) k = i;
  return { tier: k, mult: HEAT[k].mult, name: HEAT[k].name };
}

function cardValue(rank) {
  if (rank === "A") return 11;
  if (rank === "10" || rank === "J" || rank === "Q" || rank === "K") return 10;
  return parseInt(rank, 10);
}

export function handValue(hand) {
  let total = 0, aces = 0;
  for (const c of hand) { total += cardValue(c.rank); if (c.rank === "A") aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 && total <= 21 };
}
const isBJ = (h) => h.length === 2 && handValue(h).total === 21;

/** Stratégie de base : sert au figurant, et de repli si un joueur ne répond pas. */
function basicStrategy(hand, up) {
  const { total, soft } = handValue(hand);
  if (total >= 21) return "stand";
  if (soft) {
    if (total >= 19) return "stand";
    if (total === 18) return up >= 9 ? "hit" : "stand";
    return "hit";
  }
  if (total >= 17) return "stand";
  if (total >= 13) return up >= 7 ? "hit" : "stand";
  if (total === 12) return (up >= 4 && up <= 6) ? "stand" : "hit";
  return "hit";
}

/**
 * 21+3 : les deux cartes du joueur + la carte visible du croupier, lues comme
 * une main de poker à trois cartes. Rendu par le paiement seul — la mise part
 * à la donne, gagnée ou perdue avant même de jouer sa main.
 */
export function sideBet21p3(cards) {
  const idx = cards.map((c) => RANKS.indexOf(c.rank));       // A = 0
  const sameSuit = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
  const sameRank = cards[0].rank === cards[1].rank && cards[1].rank === cards[2].rank;
  const straight = (vals) => {
    const s = [...vals].sort((a, b) => a - b);
    return s[1] === s[0] + 1 && s[2] === s[1] + 1;
  };
  // l'as compte bas (A-2-3) ou haut (Q-K-A)
  const isStraight = straight(idx) || straight(idx.map((v) => (v === 0 ? 13 : v)));
  if (sameRank && sameSuit) return { name: "BRELAN ASSORTI", mult: 100 };
  if (isStraight && sameSuit) return { name: "QUINTE FLUSH", mult: 40 };
  if (sameRank) return { name: "BRELAN", mult: 30 };
  if (isStraight) return { name: "SUITE", mult: 10 };
  if (sameSuit) return { name: "COULEUR", mult: 5 };
  return null;
}

export class Table {
  /** @param {(msg:object)=>void} emit diffuse un message à tous les clients */
  constructor(emit) {
    this.emit = emit;
    this.shoe = [];
    this.seats = Array.from({ length: SEATS }, (_, i) => ({
      i,
      npc: i === NPC_SEAT,
      playerId: null,
      name: i === NPC_SEAT ? "Maison" : null,
      bet: 0,
      side: 0,             // mise 21+3
      insurance: 0,        // mise d'assurance
      insResponded: false,
      hand: [],
      split: null,         // { hand, bet, done, result } — un seul split
      done: false,
      result: null,
      // LE PORTEFEUILLE EST EMPRUNTÉ, pas détenu : `sit()` y branche le profil
      // du joueur. Hors de ça, la place joue avec l'argent de la maison.
      wallet: houseWallet(),
      orphan: false,       // le joueur a lâché la table en pleine main
      tbankOn: false,      // sursis en cours sur la décision courante
      streak: 0,           // mains gagnées d'affilée — pilote la chaleur
      pot: 0,              // cagnotte de série, à encaisser ou à perdre
      lastBet: 0,          // dernière mise engagée — sert au bouton RÉPÉTER
      lastSide: 0,
    }));
    this.dealer = [];
    this.phase = "betting";
    this.turn = null;          // index de la place qui doit jouer
    this.round = 0;
    this.msTotal = 1;          // durée nominale de la phase (jauge côté client)
    this._events = [];
    this._lastBetAt = 0;
    this._dealerStep = null;
    this._setPhase("betting", T_EMPTY.betting);   // personne au démarrage
    this._newShoe();
    this._npcBet();
  }

  _setPhase(phase, ms) {
    if (phase !== this.phase && this.tag) {
      console.log(new Date().toISOString().slice(11, 19),
        this.tag, this.phase, "->", phase, `(${ms} ms)`);
    }
    this.phase = phase;
    this.until = Date.now() + ms;
    this.msTotal = ms;
  }

  _hasHumans() { return this.seats.some((s) => s.playerId); }

  /**
   * Ouvre le chrono de DÉCISION de cette place — le seul endroit d'où il part.
   *
   * Il repasse `tbankOn` à faux : chaque nouvelle décision repart sur le temps
   * normal, donc le sursis peut être redemandé (et une deuxième barre y
   * passer). Sans ce point de passage unique, un joueur ayant tiré pendant son
   * sursis serait resté marqué « en sursis » et n'en aurait plus jamais eu.
   */
  _turnTimer(s) {
    s.tbankOn = false;
    this._setPhase("player", this._auto(s) ? 1200 : T.turn);
  }

  /**
   * Cette place joue-t-elle toute seule ? Le figurant, bien sûr — et la place
   * orpheline, dont le joueur est parti en pleine main : elle la termine à la
   * stratégie de base, au rythme d'un figurant. Sans ça, la table entière
   * attendrait douze secondes le retour de quelqu'un qui a fermé son onglet.
   */
  _auto(s) { return s.npc || s.orphan; }

  /* ------------------------------------------------------------ sabot */

  _newShoe() {
    this.shoe = [];
    for (let d = 0; d < 6; d++)
      for (let s = 0; s < 4; s++)
        for (const r of RANKS) this.shoe.push({ rank: r, suit: s });
    for (let i = this.shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shoe[i], this.shoe[j]] = [this.shoe[j], this.shoe[i]];
    }
    this.shoe.pop();      // carte brûlée : la première du sabot est écartée
    this._push({ t: "shuffle" });
  }
  /**
   * Procédure officielle du sabot : la CARTE DE COUPE est vérifiée entre deux
   * coups (`_beginRound`), jamais en cours de main — on ne remélange pas un
   * sabot au milieu d'une distribution. Le repli ici ne couvre que le cas
   * théorique d'un sabot vidé par une main pathologique.
   */
  _draw() {
    if (!this.shoe.length) this._newShoe();
    return this.shoe.pop();
  }

  /* ------------------------------------------------------------ état */

  /** Photo complète. Le sabot n'est jamais exposé : un client le lirait. */
  state() {
    return {
      round: this.round,
      phase: this.phase,
      // la barre de temps s'achète : son prix et son plafond viennent d'ici,
      // pour qu'un bouton client n'affiche jamais un tarif que la table refuse
      tbankPrice: TIME_BANK_PRICE,
      tbankMax: TIME_BANK_MAX,
      turn: this.turn,
      msLeft: Math.max(0, this.until - Date.now()),
      msTotal: this.msTotal,
      dealer: {
        // la carte cachée reste cachée tant que le croupier n'a pas joué
        hand: this.dealer.map((c, i) =>
          (i === 1 && this.phase !== "dealer" && this.phase !== "payout")
            ? { hidden: true } : c),
        total: (this.phase === "dealer" || this.phase === "payout")
          ? handValue(this.dealer).total : null,
      },
      seats: this.seats.map((s) => ({
        // une place orpheline reste OCCUPÉE : sa main se joue encore, personne
        // ne peut s'y installer par-dessus
        i: s.i, npc: s.npc, taken: !!s.playerId || s.npc || s.orphan, name: s.name,
        // `pid` permet à chaque client de reconnaître SA place, et donc de
        // caler son portefeuille sur la comptabilité du serveur, seule vraie.
        pid: s.playerId,
        bet: s.bet, hand: s.hand, total: s.hand.length ? handValue(s.hand).total : 0,
        cash: s.wallet.cash, done: s.done, result: s.result,
        side: s.side, insurance: s.insurance, insResponded: s.insResponded,
        split: s.split ? {
          hand: s.split.hand, bet: s.split.bet,
          total: s.split.hand.length ? handValue(s.split.hand).total : 0,
          done: s.split.done, result: s.split.result,
        } : null,
        // un arrivant doit voir la table déjà chaude, pas partir de zéro
        streak: s.streak, tier: heatOf(s.streak).tier, mult: heatOf(s.streak).mult,
        // la cagnotte et la mise à répéter : deux boutons du client en dépendent
        pot: s.pot, lastBet: s.lastBet, lastSide: s.lastSide,
        // la réserve de temps, et le sursis en cours : la jauge du client change
        // de couleur sur le second, le nombre de barres se lit sur le premier
        tbank: Math.max(0, Math.floor(s.wallet?.tbank || 0)), tbankOn: !!s.tbankOn,
      })),
    };
  }

  _push(ev) { this._events.push(ev); }

  /** Diffuse la photo + les évènements accumulés depuis le dernier envoi. */
  _flush() {
    const evs = this._events;
    this._events = [];
    this.emit({ t: "bj", state: this.state(), events: evs });
  }

  /* ------------------------------------------------------- places */

  /**
   * Assoit un joueur. `wallet` est son portefeuille persistant : la place s'en
   * sert tel quel et ne le remet JAMAIS à une valeur de départ — c'est le
   * même argent qu'aux machines et au bar. Sans portefeuille fourni (client
   * sans profil), la place joue avec celui de la maison.
   */
  sit(playerId, seat, name, wallet = null) {
    const s = this.seats[seat];
    if (!s || s.npc || s.playerId || s.orphan) return false;
    if (this.seatOf(playerId)) return false;      // une seule place par joueur
    s.playerId = playerId; s.name = name || ("Joueur " + playerId);
    s.streak = 0;          // la chaleur ne s'hérite pas du joueur précédent
    s.wallet = wallet || houseWallet();
    // qui s'assoit pendant les mises doit avoir le temps de miser — la fenêtre
    // courte d'une table vide serait déjà presque écoulée
    if (this.phase === "betting") {
      this.until = Math.max(this.until, Date.now() + 6000);
      this.msTotal = Math.max(this.msTotal, this.until - Date.now());
    }
    this._flush();
    return true;
  }

  /**
   * Le joueur quitte la place — de son plein gré, ou parce que sa liaison a
   * lâché (`ws.close` appelle ici).
   *
   * Une main déjà distribuée ne peut plus être ni confisquée ni remboursée :
   * confisquer ferait payer une coupure de réseau avec de l'argent désormais
   * persistant, rembourser laisserait fuir les mains perdantes. La place
   * devient donc ORPHELINE — elle finit sa main à la stratégie de base, le
   * portefeuille reste branché jusqu'au paiement, et la place n'est libérée
   * qu'à la fin du coup. En phase de mise, en revanche, les jetons posés
   * retournent simplement au portefeuille.
   */
  leave(playerId) {
    // sans identifiant, la comparaison ci-dessous attraperait toutes les places
    // libres — celle du figurant comprise, dont elle viderait le portefeuille
    if (playerId == null) return;
    let changed = false;
    for (const s of this.seats) {
      if (s.playerId !== playerId) continue;
      if (s.bet > 0 && this.phase !== "betting") {
        s.playerId = null;      // le nom reste : la main se joue encore en son nom
        s.orphan = true;
      } else {
        s.wallet.cash += s.bet + s.side + s.insurance;
        this._release(s);
      }
      changed = true;
    }
    if (changed) this._flush();
  }

  /** Rend la place à la maison : plus de mise, plus de main, plus de caisse. */
  _release(s) {
    // LA CAGNOTTE N'EST JAMAIS CONFISQUÉE. Elle se perd en jouant, pas en
    // partant : quitter la table (ou perdre sa liaison) l'encaisse d'office,
    // comme les mises non engagées juste au-dessus.
    if (s.pot > 0) { s.wallet.cash += s.pot; s.pot = 0; }
    s.playerId = null; s.name = null; s.orphan = false; s.tbankOn = false;
    s.bet = 0; s.side = 0; s.insurance = 0; s.insResponded = false;
    s.hand = []; s.split = null; s.done = false; s.result = null;
    s.streak = 0; s.lastBet = 0; s.lastSide = 0;
    s.wallet = houseWallet();     // le portefeuille du joueur lui est rendu
  }

  seatOf(playerId) {
    return this.seats.find((s) => s.playerId === playerId) || null;
  }

  /* ------------------------------------------------------- mises */

  bet(playerId, amount) {
    if (this.phase !== "betting") return;
    const s = this.seatOf(playerId);
    if (!s) return;
    const v = Math.max(0, Math.min(500, Math.floor(Number(amount) || 0)));
    if (!v || s.wallet.cash < v) return;
    s.wallet.cash -= v; s.bet += v;
    this._lastBetAt = Date.now();
    this._push({ t: "bet", seat: s.i, value: v, total: s.bet });
    this._flush();
  }

  /** Mise 21+3, en plus de la mise principale. Plafonnée à 100. */
  sideBet(playerId, amount) {
    if (this.phase !== "betting") return;
    const s = this.seatOf(playerId);
    if (!s || !s.bet) return;                    // pas de side bet sans mise
    const v = Math.max(0, Math.min(100 - s.side, Math.floor(Number(amount) || 0)));
    if (!v || s.wallet.cash < v) return;
    s.wallet.cash -= v; s.side += v;
    this._lastBetAt = Date.now();
    // une part de toute mise annexe monte au jackpot du pit, commun aux tables
    this.jackpot?.feed(v);
    this._push({ t: "sidebet", seat: s.i, value: v, total: s.side });
    this._flush();
  }

  /**
   * RÉPÉTER LA MISE : repose d'un geste ce qui était engagé au coup précédent,
   * mise annexe comprise. Rien d'autre qu'un raccourci — mais c'est LUI qui
   * fait la boucle : sans lui, chaque manche repart d'un empilage de jetons à
   * la main, et la table s'arrête à chaque tour.
   *
   * Tout ou rien : on ne repose pas une demi-mise à quelqu'un qui n'a plus de
   * quoi suivre — il verrait une mise qu'il n'a pas choisie.
   */
  rebet(playerId) {
    if (this.phase !== "betting") return;
    const s = this.seatOf(playerId);
    if (!s || s.bet > 0 || s.side > 0) return;   // seulement sur un cercle net
    const b = Math.min(500, s.lastBet || 0);
    if (!b || s.wallet.cash < b) return;
    // la mise annexe ne suit que si elle tient encore dans la caisse
    const sd = s.wallet.cash >= b + (s.lastSide || 0) ? Math.min(100, s.lastSide || 0) : 0;
    s.wallet.cash -= b + sd;
    s.bet = b; s.side = sd;
    this._lastBetAt = Date.now();
    // décomposé en jetons de vraies valeurs : le client fait voler une pile,
    // pas un jeton fantôme de 75 € qui n'existe dans aucun rack
    let left = b;
    for (const v of [500, 100, 25, 5]) {
      while (left >= v) { left -= v; this._push({ t: "bet", seat: s.i, value: v, total: b }); }
    }
    if (sd) {
      this.jackpot?.feed(sd);
      this._push({ t: "sidebet", seat: s.i, value: sd, total: sd });
    }
    this._push({ t: "rebet", seat: s.i, bet: b, side: sd });
    this._flush();
  }

  /**
   * ENCAISSER LA CAGNOTTE — et éteindre le feu.
   *
   * Là est tout le pari : la cagnotte est acquise, mais la série repart de
   * zéro, donc le multiplicateur aussi. Sécuriser coûte la chaleur ; continuer
   * risque la cagnotte. Interdit en pleine main : on ne change pas d'avis les
   * cartes sur le feutre.
   */
  bank(playerId) {
    if (this.phase !== "betting" && this.phase !== "payout") return;
    const s = this.seatOf(playerId);
    if (!s || s.pot <= 0) return;
    const gain = s.pot;
    const tier = heatOf(s.streak).tier;
    s.pot = 0; s.streak = 0;
    // la cagnotte encaissée est de l'argent RENDU : elle rembourse d'autant le
    // déficit du JOUEUR, sans quoi la suivante se reconstituerait aussitôt au
    // plafond
    s.wallet.back = (s.wallet.back || 0) + gain;
    s.wallet.cash += gain;
    this._push({ t: "bank", seat: s.i, gain, tier });
    this._flush();
  }

  /**
   * RACHETER UNE BARRE DE TEMPS.
   *
   * Deux verrous, et ils font toute la mécanique :
   *
   *  - ENTRE DEUX MANCHES seulement, jamais pendant sa propre décision. Payer
   *    pour prolonger le coup en cours reviendrait à acheter du temps à la
   *    table ENTIÈRE : les autres attendraient le portefeuille du plus lent.
   *  - RÉSERVE VIDE seulement (`held >= TIME_BANK_MAX`, et le plafond vaut 1).
   *    On ne fait pas provision de sursis : le filet se retend APRÈS qu'on l'a
   *    consommé. Sans ce verrou, dix euros posés d'avance à chaque manche
   *    rendaient le chrono décoratif.
   *
   * L'argent part à la maison et ne rejoint pas `staked` : ce n'est pas une
   * mise, ça ne se gagne pas, et ça ne doit donc pas gonfler le plafond de la
   * cagnotte de série (voir POT_SHARE).
   */
  buyTime(playerId) {
    if (this.phase !== "betting" && this.phase !== "payout") return;
    const s = this.seatOf(playerId);
    if (!s || !s.playerId) return;
    const w = s.wallet;
    const held = Math.max(0, Math.floor(w.tbank || 0));
    if (held >= TIME_BANK_MAX || w.cash < TIME_BANK_PRICE) return;
    w.cash -= TIME_BANK_PRICE;
    w.tbank = held + 1;
    this._push({ t: "buytime", seat: s.i, price: TIME_BANK_PRICE, left: w.tbank });
    this._flush();
  }

  /** Retire la mise et la recrédite. Sans ça le bouton « Retirer » était mort. */
  clearBet(playerId) {
    if (this.phase !== "betting") return;
    const s = this.seatOf(playerId);
    if (!s || (!s.bet && !s.side)) return;
    s.wallet.cash += s.bet + s.side; s.bet = 0; s.side = 0;
    this._lastBetAt = Date.now();   // retirer sa mise rouvre la réflexion
    this._push({ t: "clearbet", seat: s.i });
    this._flush();
  }

  /* ------------------------------------------------------- actions */

  /** Main en cours de jeu d'une place : la principale d'abord, puis le split. */
  _activeHand(s) {
    if (!s.done) return { cards: s.hand, bet: s.bet, h: 0 };
    if (s.split && !s.split.done) return { cards: s.split.hand, bet: s.split.bet, h: 1 };
    return null;
  }

  _markDone(s, h, result = undefined) {
    if (h === 0) { s.done = true; if (result !== undefined) s.result = result; }
    else { s.split.done = true; if (result !== undefined) s.split.result = result; }
  }

  /**
   * Le chrono de décision vient d'expirer : la réserve prend le relais si elle
   * en a encore. Vrai = la main est sauvée, l'appelant ne tranche pas.
   */
  _grantTime(s) {
    if (this._auto(s) || !s.playerId) return false;
    if (s.tbankOn) return false;                 // le sursis ne se rejoue pas
    const w = s.wallet;
    const held = Math.max(0, Math.floor(w?.tbank || 0));
    if (!held) return false;
    w.tbank = held - 1;
    s.tbankOn = true;
    this._setPhase("player", T_BANK);
    this._push({ t: "timebank", seat: s.i, ms: T_BANK, left: w.tbank });
    this._flush();
    return true;
  }

  action(playerId, what) {
    const s = this.seatOf(playerId);
    if (!s) return;
    if (this.phase === "insurance") {
      if (what === "insure") this._insure(s, true);
      else if (what === "noinsure") this._insure(s, false);
      return;
    }
    if (this.phase !== "player" || this.turn !== s.i) return;
    const ah = this._activeHand(s);
    if (!ah) return;
    if (what === "hit") this._hit(s);
    else if (what === "stand") { this._markDone(s, ah.h); this._advance(s); }
    else if (what === "double") {
      if (ah.cards.length !== 2 || s.wallet.cash < ah.bet) return;
      s.wallet.cash -= ah.bet;
      if (ah.h === 0) s.bet *= 2; else s.split.bet *= 2;
      this._push({ t: "bet", seat: s.i, value: ah.bet, total: ah.h === 0 ? s.bet : s.split.bet });
      this._hit(s, true);
    } else if (what === "split") this._split(s);
  }

  _hit(s, thenStand = false) {
    const ah = this._activeHand(s);
    if (!ah) return;
    const c = this._draw();
    ah.cards.push(c);
    this._push({ t: "card", seat: s.i, h: ah.h, card: c, faceUp: true });
    const v = handValue(ah.cards).total;
    if (v > 21) {
      this._markDone(s, ah.h, "bust");
      this._push({ t: "bust", seat: s.i, h: ah.h });
      this._advance(s);
    } else if (v === 21 || thenStand) {
      this._markDone(s, ah.h);
      this._advance(s);
    } else {
      // chaque décision d'un humain relance son temps : on réfléchit à la
      // NOUVELLE main, pas sur le reliquat du chrono précédent
      if (!this._auto(s)) this._turnTimer(s);
      this._flush();
    }
  }

  /** Sépare une paire : deux mains, deux mises. Un seul split, pas de re-split. */
  _split(s) {
    if (s.split || s.done || s.hand.length !== 2) return;
    const [a, b] = s.hand;
    if (cardValue(a.rank) !== cardValue(b.rank)) return;
    if (s.wallet.cash < s.bet) return;
    s.wallet.cash -= s.bet;
    const aces = a.rank === "A";
    s.split = { hand: [s.hand.pop()], bet: s.bet, done: false, result: null };
    this._push({ t: "split", seat: s.i });
    // la main principale reçoit tout de suite sa deuxième carte
    const c = this._draw();
    s.hand.push(c);
    this._push({ t: "card", seat: s.i, h: 0, card: c, faceUp: true });
    // RÈGLE OFFICIELLE : les as séparés reçoivent UNE carte chacun, mains
    // figées — pas de tirage, pas de double. (Et A+10 vaut 21, pas blackjack.)
    if (aces) {
      s.done = true;
      const c2 = this._draw();
      s.split.hand.push(c2);
      this._push({ t: "card", seat: s.i, h: 1, card: c2, faceUp: true });
      s.split.done = true;
      this._next();
      return;
    }
    // 21 après split n'est PAS un blackjack — simple 21, la main est finie
    if (handValue(s.hand).total === 21) { s.done = true; this._advance(s); return; }
    this._turnTimer(s);
    this._flush();
  }

  /**
   * La main active vient de se terminer. S'il reste le split à jouer, il reçoit
   * sa deuxième carte et le tour CONTINUE sur la même place ; sinon on passe.
   */
  _advance(s) {
    if (s.split && s.done && !s.split.done) {
      if (s.split.hand.length === 1) {
        const c = this._draw();
        s.split.hand.push(c);
        this._push({ t: "card", seat: s.i, h: 1, card: c, faceUp: true });
        if (handValue(s.split.hand).total === 21) { s.split.done = true; this._next(); return; }
      }
      if (!this._auto(s)) this._turnTimer(s);
      this._flush();
      return;
    }
    this._next();
  }

  /* ------------------------------------------------------- assurance */

  _insure(s, yes) {
    if (s.insResponded || !s.bet) return;
    if (yes) {
      const cost = Math.floor(s.bet / 2);
      if (cost > 0 && s.wallet.cash >= cost) {
        s.wallet.cash -= cost;
        s.insurance = cost;
        this._push({ t: "insured", seat: s.i, value: cost });
      }
    }
    s.insResponded = true;
    // tous ont répondu : on écourte — un dernier battement de suspense et on révèle
    if (this.seats.every((x) => x.insResponded || !x.playerId || !x.bet)) {
      this.until = Math.min(this.until, Date.now() + 900);
    }
    this._flush();
  }

  _resolveInsurance() {
    if (isBJ(this.dealer)) {
      // blackjack croupier : révélation immédiate, les assurés sont payés 2:1
      this._push({ t: "flip", seat: "dealer", card: this.dealer[1] });
      for (const s of this._active()) {
        if (s.insurance) {
          const g = s.insurance * 3;   // mise rendue + 2:1
          s.wallet.cash += g;
          this._push({ t: "insurance", seat: s.i, result: "win", gain: g });
        }
      }
      this._payout();                  // dv = 21, dbj : tout le monde est réglé
    } else {
      for (const s of this._active()) {
        if (s.insurance) {
          this._push({ t: "insurance", seat: s.i, result: "lose", gain: 0 });
          s.insurance = 0;
        }
      }
      this.turn = null;
      this._next();
    }
  }

  /* ------------------------------------------------------- déroulé */

  _active() { return this.seats.filter((s) => s.bet > 0); }

  _npcBet() {
    const s = this.seats[NPC_SEAT];
    s.bet = [25, 50, 100, 100, 200][Math.floor(Math.random() * 5)];
    this._push({ t: "bet", seat: s.i, value: s.bet, total: s.bet });
  }

  _beginRound() {
    this.round++;
    // carte de coupe : sous ~30% de pénétration restante, on mélange ICI,
    // entre deux coups — jamais pendant une main
    if (this.shoe.length < 90) this._newShoe();
    this.dealer = [];
    for (const s of this.seats) {
      s.hand = []; s.split = null; s.done = false; s.result = null;
      s.insurance = 0; s.insResponded = false; s.tbankOn = false;
      // LA MISE À RÉPÉTER se retient ICI, au moment où elle est engagée : plus
      // tard, `s.side` aura été remis à zéro par le règlement du 21+3 et un
      // double aurait faussé `s.bet`.
      if (s.bet > 0) { s.lastBet = s.bet; s.lastSide = s.side; }
    }
    this._setPhase("dealing", T.deal);
    this._push({ t: "clear" });
    this._flush();
  }

  _dealAll() {
    const act = this._active();
    for (let pass = 0; pass < 2; pass++) {
      for (const s of act) {
        const c = this._draw(); s.hand.push(c);
        this._push({ t: "card", seat: s.i, h: 0, card: c, faceUp: true });
      }
      const c = this._draw(); this.dealer.push(c);
      this._push({ t: "card", seat: "dealer", card: pass === 0 ? c : null, faceUp: pass === 0 });
    }
    for (const s of act) if (isBJ(s.hand)) { s.done = true; s.result = "bj"; }

    // 21+3 : réglé à la donne, avant même de jouer
    const up = this.dealer[0];
    for (const s of act) {
      if (!s.side) continue;
      const win = sideBet21p3([...s.hand, up]);
      let gain = win ? s.side * (win.mult + 1) : 0;
      // LE JACKPOT DU PIT : le brelan assorti, la main la plus rare du 21+3,
      // emporte en plus la cagnotte commune aux trois tables.
      let jp = 0;
      if (win && win.name === "BRELAN ASSORTI" && this.jackpot) {
        jp = this.jackpot.hit({
          name: s.name, seat: s.i, table: this.index ?? 0, pid: s.playerId,
        });
        gain += jp;
      }
      if (gain) s.wallet.cash += gain;
      this._push({
        t: "side", seat: s.i, stake: s.side,
        result: win ? win.name : null, mult: win ? win.mult : 0, gain, jackpot: jp,
      });
      s.side = 0;
    }

    // as visible + au moins un humain en jeu -> phase d'assurance
    if (cardValue(up.rank) === 11 && act.some((s) => s.playerId)) {
      for (const s of this.seats) s.insResponded = !s.playerId || !s.bet;
      this._setPhase("insurance", T.insurance);
      this._push({ t: "offer_insurance" });
      this._flush();
      return;
    }

    // PEEK américain : avec un 10 visible, le croupier vérifie sa carte cachée
    // AVANT que quiconque joue. S'il a blackjack, le coup s'arrête là — personne
    // ne double ni ne sépare contre un blackjack déjà fait.
    if (cardValue(up.rank) === 10 && isBJ(this.dealer)) {
      this._push({ t: "flip", seat: "dealer", card: this.dealer[1] });
      this._payout();
      return;
    }

    this.turn = null;
    this._next();
  }

  /** Donne la main à la place suivante, ou passe au croupier. */
  _next() {
    const from = this.turn === null ? -1 : this.turn;
    for (let i = from + 1; i < SEATS; i++) {
      const s = this.seats[i];
      if (s.bet > 0 && this._activeHand(s)) {
        this.turn = i;
        this._turnTimer(s);
        this._flush();
        return;
      }
    }
    this.turn = null;
    // le croupier joue en plusieurs TEMPS (flip, puis une carte par battement) :
    // chaque tirage arrive seul chez les clients, qui l'animent seul — c'est
    // tout le suspense du 16 qui tire, perdu quand tout arrivait d'un bloc
    this._dealerStep = "flip";
    this._setPhase("dealer", 700);
    this._flush();
  }

  /** Reste-t-il une main que le croupier peut encore battre en tirant ? */
  _liveHands() {
    for (const s of this._active()) {
      // ni sautée ni blackjack : le croupier a une raison de tirer
      if (s.result !== "bj" && handValue(s.hand).total <= 21) return true;
      if (s.split && handValue(s.split.hand).total <= 21) return true;
    }
    return false;
  }

  /** Un battement du croupier : le flip, ou un tirage. */
  _dealerBeat() {
    if (this._dealerStep === "flip") {
      this._push({ t: "flip", seat: "dealer", card: this.dealer[1] });
      this._dealerStep = "draw";
      // règle officielle : tout le monde a sauté ou a blackjack -> le croupier
      // révèle sa carte mais ne tire PAS
      if (!this._liveHands()) this._dealerStep = null;
    } else if (this._dealerStep === "draw" && this.dealer.length < 10) {
      const c = this._draw(); this.dealer.push(c);
      this._push({ t: "card", seat: "dealer", card: c, faceUp: true });
    }
    if (this._dealerStep && (handValue(this.dealer).total >= 17 || this.dealer.length >= 10)) {
      this._dealerStep = null;
    }
    // un temps pour lire le total du croupier avant le verdict
    this._setPhase("dealer", this._dealerStep ? T.dealer : 900);
    this._flush();
  }

  _payout() {
    const dv = handValue(this.dealer).total;
    const dbj = isBJ(this.dealer);

    for (const s of this._active()) {
      let stake = 0, back = 0;

      /** Règle une main contre le croupier ; accumule mise et retour. */
      const settle = (cards, bet, res0) => {
        const pv = handValue(cards).total;
        let res, gain = 0;
        if (res0 === "bust" || pv > 21) res = "lose";
        else if (res0 === "bj") { res = dbj ? "push" : "bj"; gain = dbj ? bet : Math.round(bet * 2.5); }
        else if (dbj) res = "lose";
        else if (dv > 21 || pv > dv) { res = "win"; gain = bet * 2; }
        else if (pv < dv) res = "lose";
        else { res = "push"; gain = bet; }
        stake += bet; back += gain;
        return { res, gain };
      };

      const main = settle(s.hand, s.bet, s.result);
      s.result = main.res;
      let splitR = null;
      if (s.split) {
        splitR = settle(s.split.hand, s.split.bet, s.split.result);
        s.split.result = splitR.res;
      }

      // La chaleur suit le NET de la place (retours - mises) : un split
      // gagné/perdu à mises égales est neutre, comme une égalité. La chaleur
      // DÉJÀ accumulée paie la main courante ; la série ne monte qu'ensuite —
      // on allume le feu à la main N, il paie à la main N+1.
      const before = heatOf(s.streak);
      const net = back - stake;
      // LE CUMUL EST CELUI DU JOUEUR, PAS DE LA PLACE. Il vit sur son
      // portefeuille — donc sur son profil, qui le suit d'une table à l'autre
      // et d'une session à la suivante. Sur la place, il aurait été hérité :
      // les mains du figurant qui l'occupait avant lui, puis celles du joueur
      // suivant, auraient nourri un déficit qui n'est pas le sien. Les
      // figurants jouent avec un portefeuille de maison, neuf par place : leurs
      // compteurs restent les leurs.
      const w = s.wallet;
      w.staked = (w.staked || 0) + stake;
      w.back = (w.back || 0) + back;
      let bonus = 0, potLost = 0;
      if (net > 0) {
        // le multiplicateur ne mord que sur le bénéfice, jamais sur la mise rendue.
        // Le bonus ne rejoint PAS le paiement : il tombe dans la cagnotte —
        // net × (mult − 1), pour que la main gagnée vaille exactement le
        // multiplicateur affiché (voir le bloc CAGNOTTE DE SÉRIE).
        bonus = Math.round(net * (before.mult - 1));
        // ...mais jamais au-delà de ce que la place a laissé à la maison.
        const room = Math.max(0, Math.round((w.staked - w.back) * POT_SHARE) - s.pot);
        bonus = Math.min(bonus, room);
        s.pot += bonus;
        s.streak++;
      } else if (net < 0) {
        // la série casse : la cagnotte part avec elle
        potLost = s.pot;
        s.pot = 0;
        s.streak = 0;
      }
      // ...et le plafond joue DANS LES DEUX SENS : un gain qui comble le
      // déficit rabote la cagnotte d'autant. Sans ça la règle « le cumul
      // dépensé, moins ce qui a été gagné » ne serait vraie qu'à la hausse, et
      // une cagnotte bâtie sur des pertes survivrait au coup qui les efface.
      // Le rabotage est SILENCIEUX : il ne rejoint pas `potLost`, qui déclenche
      // côté client l'alarme rouge « cagnotte perdue » (toast, brûlure, arrêt
      // sur image). Annoncer une perte au joueur qui vient de GAGNER serait un
      // contresens ; le nouveau montant part de toute façon dans `pot`.
      const ceil = Math.max(0, Math.round((w.staked - w.back) * POT_SHARE));
      if (s.pot > ceil) s.pot = ceil;
      const brokeAt = net < 0 ? before.tier : 0;
      const heat = heatOf(s.streak);
      s.wallet.cash += back;

      this._push({
        t: "result", seat: s.i, h: 0, result: main.res, gain: main.gain, bonus, net,
        streak: s.streak, tier: heat.tier, mult: heat.mult, heatName: heat.name, brokeAt,
        pot: s.pot, potLost,
      });
      if (splitR) {
        this._push({
          t: "result", seat: s.i, h: 1, result: splitR.res, gain: splitR.gain,
          bonus: 0, net, streak: s.streak, tier: heat.tier, mult: heat.mult, brokeAt: 0,
        });
      }
    }
    this._setPhase("payout", this._hasHumans() ? T.payout : T_EMPTY.payout);
    this._flush();
  }

  _endRound() {
    for (const s of this.seats) {
      // la place orpheline a fini sa main et touché son dû : elle est rendue
      // à la maison maintenant, pas avant le paiement
      if (s.orphan) { this._release(s); continue; }
      s.bet = 0; s.side = 0; s.insurance = 0; s.insResponded = false;
      s.hand = []; s.split = null; s.done = false; s.result = null;
    }
    this._setPhase("betting", this._hasHumans() ? T.betting : T_EMPTY.betting);
    this._push({ t: "clear" });
    this._npcBet();
    this._flush();
  }

  /* ------------------------------------------------------- horloge */

  /** Appelée régulièrement : fait avancer la phase quand son temps est écoulé. */
  tick() {
    const now = Date.now();
    if (now < this.until) {
      if (this.phase === "player" && this.turn !== null) {
        // le figurant — et la place orpheline — jouent sans attendre le délai
        const s = this.seats[this.turn];
        if (this._auto(s)) {
          const up = cardValue(this.dealer[0].rank);
          if (basicStrategy(s.hand, up) === "hit") this._hit(s);
          else { this._markDone(s, 0); this._advance(s); }
        }
      } else if (this.phase === "betting") {
        // DÉMARRAGE ANTICIPÉ : tous les humains ont misé et plus personne ne
        // touche aux jetons depuis un moment -> on ne fait pas poireauter la
        // table jusqu'au bout du chrono. Les deux gardes évitent de couper
        // l'herbe sous le pied de qui empile encore ses jetons.
        const humans = this.seats.filter((s) => s.playerId);
        const elapsed = now - (this.until - this.msTotal);
        if (humans.length && humans.every((s) => s.bet > 0)
          && elapsed > 2500 && now - this._lastBetAt > 1600) {
          this._beginRound();
        }
      }
      return;
    }
    switch (this.phase) {
      case "betting": this._beginRound(); break;
      case "dealing": this._dealAll(); break;
      case "insurance": this._resolveInsurance(); break;
      case "player": {
        // un joueur qui ne répond pas ne bloque pas la table
        const s = this.turn !== null ? this.seats[this.turn] : null;
        const ah = s ? this._activeHand(s) : null;
        if (s && ah) {
          // la banque de temps d'abord : elle rend la main à son joueur au lieu
          // de la lui figer sur RESTER
          if (this._grantTime(s)) break;
          this._markDone(s, ah.h);
          this._push({ t: "timeout", seat: s.i });
          this._advance(s);
        } else {
          this._next();
        }
        break;
      }
      case "dealer":
        if (this._dealerStep) this._dealerBeat();
        else this._payout();
        break;
      case "payout": this._endRound(); break;
    }
  }
}
