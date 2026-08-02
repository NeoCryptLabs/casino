/**
 * Table de blackjack AUTORITAIRE, côté serveur.
 *
 * Elle tourne en continu, indépendamment des joueurs connectés : le figurant de
 * la place 0 joue toujours, donc une partie est visible même casino vide. Les
 * clients ne décident de rien — ils envoient des intentions (miser, tirer,
 * rester) et reçoivent l'état ; toute la règle est ici.
 *
 * Aucune persistance : l'état vit en mémoire et repart de zéro au redémarrage.
 *
 * Les clients rendent la partie à partir de deux flux complémentaires :
 *  - `state` : photo complète, envoyée à chaque changement et à toute connexion
 *    tardive, pour qu'un arrivant voie la table telle qu'elle est ;
 *  - `events` : ce qui vient de se produire (carte distribuée, jeton posé…),
 *    pour déclencher les animations. Un client qui rate un event reste correct
 *    grâce à la photo — l'inverse serait faux.
 */

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SEATS = 5;
const NPC_SEAT = 0;

// durées de phase, en millisecondes
const T = { betting: 14000, deal: 900, turn: 16000, dealer: 1200, payout: 7000 };

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
      hand: [],
      done: false,
      result: null,
      cash: 2500,
    }));
    this.dealer = [];
    this.phase = "betting";
    this.turn = null;          // index de la place qui doit jouer
    this.until = Date.now() + T.betting;
    this.round = 0;
    this._events = [];
    this._newShoe();
    this._npcBet();
  }

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
    this._push({ t: "shuffle" });
  }
  _draw() {
    if (this.shoe.length < 40) this._newShoe();
    return this.shoe.pop();
  }

  /* ------------------------------------------------------------ état */

  /** Photo complète. Le sabot n'est jamais exposé : un client le lirait. */
  state() {
    return {
      round: this.round,
      phase: this.phase,
      turn: this.turn,
      msLeft: Math.max(0, this.until - Date.now()),
      dealer: {
        // la carte cachée reste cachée tant que le croupier n'a pas joué
        hand: this.dealer.map((c, i) =>
          (i === 1 && this.phase !== "dealer" && this.phase !== "payout")
            ? { hidden: true } : c),
        total: (this.phase === "dealer" || this.phase === "payout")
          ? handValue(this.dealer).total : null,
      },
      seats: this.seats.map((s) => ({
        i: s.i, npc: s.npc, taken: !!s.playerId || s.npc, name: s.name,
        // `pid` permet à chaque client de reconnaître SA place, et donc de
        // caler son portefeuille sur la comptabilité du serveur, seule vraie.
        pid: s.playerId,
        bet: s.bet, hand: s.hand, total: s.hand.length ? handValue(s.hand).total : 0,
        cash: s.cash, done: s.done, result: s.result,
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

  sit(playerId, seat, name) {
    const s = this.seats[seat];
    if (!s || s.npc || s.playerId) return false;
    s.playerId = playerId; s.name = name || ("Joueur " + playerId);
    this._flush();
    return true;
  }

  leave(playerId) {
    let changed = false;
    for (const s of this.seats) {
      if (s.playerId === playerId) {
        s.playerId = null; s.name = null; s.bet = 0; s.hand = []; s.done = false;
        changed = true;
      }
    }
    if (changed) this._flush();
  }

  seatOf(playerId) {
    return this.seats.find((s) => s.playerId === playerId) || null;
  }

  /* ------------------------------------------------------- actions */

  bet(playerId, amount) {
    if (this.phase !== "betting") return;
    const s = this.seatOf(playerId);
    if (!s) return;
    const v = Math.max(0, Math.min(500, Math.floor(Number(amount) || 0)));
    if (!v || s.cash < v) return;
    s.cash -= v; s.bet += v;
    this._push({ t: "bet", seat: s.i, value: v, total: s.bet });
    this._flush();
  }

  /** Retire la mise et la recrédite. Sans ça le bouton « Retirer » était mort. */
  clearBet(playerId) {
    if (this.phase !== "betting") return;
    const s = this.seatOf(playerId);
    if (!s || !s.bet) return;
    s.cash += s.bet; s.bet = 0;
    this._push({ t: "clearbet", seat: s.i });
    this._flush();
  }

  action(playerId, what) {
    const s = this.seatOf(playerId);
    if (!s || this.phase !== "player" || this.turn !== s.i || s.done) return;
    if (what === "hit") this._hit(s);
    else if (what === "stand") this._stand(s);
    else if (what === "double") {
      if (s.hand.length !== 2 || s.cash < s.bet) return;
      s.cash -= s.bet; s.bet *= 2;
      this._push({ t: "bet", seat: s.i, value: s.bet / 2, total: s.bet });
      this._hit(s, true);
    }
  }

  _hit(s, thenStand = false) {
    const c = this._draw();
    s.hand.push(c);
    this._push({ t: "card", seat: s.i, card: c, faceUp: true });
    const v = handValue(s.hand).total;
    if (v > 21) { s.done = true; s.result = "bust"; this._push({ t: "bust", seat: s.i }); this._next(); }
    else if (v === 21 || thenStand) { s.done = true; this._next(); }
    else this._flush();
  }

  _stand(s) { s.done = true; this._next(); }

  /* ------------------------------------------------------- déroulé */

  _active() { return this.seats.filter((s) => s.bet > 0); }

  _npcBet() {
    const s = this.seats[NPC_SEAT];
    s.bet = [25, 50, 100, 100, 200][Math.floor(Math.random() * 5)];
    this._push({ t: "bet", seat: s.i, value: s.bet, total: s.bet });
  }

  _beginRound() {
    this.round++;
    this.dealer = [];
    for (const s of this.seats) { s.hand = []; s.done = false; s.result = null; }
    this.phase = "dealing";
    this.until = Date.now() + T.deal;
    this._push({ t: "clear" });
    this._flush();
  }

  _dealAll() {
    const act = this._active();
    for (let pass = 0; pass < 2; pass++) {
      for (const s of act) {
        const c = this._draw(); s.hand.push(c);
        this._push({ t: "card", seat: s.i, card: c, faceUp: true });
      }
      const c = this._draw(); this.dealer.push(c);
      this._push({ t: "card", seat: "dealer", card: pass === 0 ? c : null, faceUp: pass === 0 });
    }
    for (const s of act) if (isBJ(s.hand)) { s.done = true; s.result = "bj"; }
    this.phase = "player";
    this.turn = null;
    this._next();
  }

  /** Donne la main à la place suivante, ou passe au croupier. */
  _next() {
    const act = this._active();
    let from = this.turn === null ? -1 : this.turn;
    for (let i = from + 1; i < SEATS; i++) {
      const s = this.seats[i];
      if (s.bet > 0 && !s.done) {
        this.turn = i;
        this.until = Date.now() + (s.npc ? 1200 : T.turn);
        this.phase = "player";
        this._flush();
        return;
      }
    }
    this.turn = null;
    this.phase = "dealer";
    this.until = Date.now() + T.dealer;
    this._flush();
  }

  _dealerPlay() {
    this._push({ t: "flip", seat: "dealer", card: this.dealer[1] });
    let guard = 0;
    while (guard++ < 8 && handValue(this.dealer).total < 17) {
      const c = this._draw(); this.dealer.push(c);
      this._push({ t: "card", seat: "dealer", card: c, faceUp: true });
    }
    this._payout();
  }

  _payout() {
    const dv = handValue(this.dealer).total;
    const dbj = isBJ(this.dealer);
    for (const s of this._active()) {
      const pv = handValue(s.hand).total;
      let res, gain = 0;
      if (s.result === "bust") res = "lose";
      else if (s.result === "bj") { res = dbj ? "push" : "bj"; gain = dbj ? s.bet : Math.round(s.bet * 2.5); }
      else if (pv > 21) res = "lose";
      else if (dv > 21 || pv > dv) { res = "win"; gain = s.bet * 2; }
      else if (pv < dv) res = "lose";
      else { res = "push"; gain = s.bet; }
      s.result = res;
      s.cash += gain;
      this._push({ t: "result", seat: s.i, result: res, gain });
    }
    this.phase = "payout";
    this.until = Date.now() + T.payout;
    this._flush();
  }

  _endRound() {
    for (const s of this.seats) { s.bet = 0; s.hand = []; s.done = false; s.result = null; }
    this.phase = "betting";
    this.until = Date.now() + T.betting;
    this._push({ t: "clear" });
    this._npcBet();
    this._flush();
  }

  /* ------------------------------------------------------- horloge */

  /** Appelée régulièrement : fait avancer la phase quand son temps est écoulé. */
  tick() {
    const now = Date.now();
    if (now < this.until) {
      // un joueur qui ne répond pas ne bloque pas la table
      if (this.phase === "player" && this.turn !== null) {
        const s = this.seats[this.turn];
        if (s.npc) {
          const up = cardValue(this.dealer[0].rank);
          if (basicStrategy(s.hand, up) === "hit") this._hit(s); else this._stand(s);
        }
      }
      return;
    }
    switch (this.phase) {
      case "betting": this._beginRound(); break;
      case "dealing": this._dealAll(); break;
      case "player": {
        const s = this.turn !== null ? this.seats[this.turn] : null;
        if (s && !s.done) { s.done = true; this._push({ t: "timeout", seat: s.i }); }
        this._next();
        break;
      }
      case "dealer": this._dealerPlay(); break;
      case "payout": this._endRound(); break;
    }
  }
}
