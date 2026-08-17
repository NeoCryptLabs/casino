/**
 * LA SALLE, vue du serveur — juste assez pour savoir où reposer quelqu'un.
 *
 * Le problème : un joueur peut disparaître SANS PRÉVENIR. Alt+F4, onglet tué,
 * portable qui se ferme, Wi-Fi coupé — le navigateur n'exécute plus une ligne
 * de code, il n'y a ni « je me lève » ni dernier message. Le serveur ne reçoit
 * qu'une socket fermée. S'il se contentait alors de garder la dernière pose
 * reçue, il enregistrerait l'œil d'un joueur ASSIS : au retour, la tête dans le
 * feutre, à l'intérieur de la chaise et du plateau.
 *
 * La position de réapparition est donc décidée ICI, par le serveur, et il en
 * sort toujours une — jamais « rien », jamais une pose assise.
 *
 * Reste que la géométrie exacte (où est la chaise 3 de la table 1 ?) est bâtie
 * par le client, et déplaçable en mode éditeur. Le serveur ne la devine pas :
 * il l'APPREND. Chaque client, une fois le casino construit, lui envoie le
 * point de sortie de chaque place (`{t:"spots"}`) — la même carte pour tout le
 * monde, puisque tout le monde bâtit le même casino. Le serveur la garde et
 * s'en sert ensuite pour n'importe qui, y compris pour un joueur déjà parti et
 * dont le client n'avait rien eu le temps d'annoncer.
 *
 * Trois filets, dans cet ordre : la carte apprise, ce que le client avait
 * déclaré de son vivant, puis le point d'apparition.
 */

/** Défauts calqués sur `LAYOUT` (src/world.js) — la salle fait 44 × 34 m. */
const DEFAULT_SPAWN = [0, 1.62, 14.5];
const HALL = { w: 44, d: 34 };
const MARGIN = 1.2;                  // on ne repose personne dans un mur
const MAX_SPOTS = 512;               // une carte de places, pas un dépotoir
const EYE = 1.62;                    // hauteur d'œil : la pose d'un joueur debout

const finite3 = (a) =>
  Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

export class Room {
  constructor() {
    this.spawn = [...DEFAULT_SPAWN];
    /** identifiant de place ("blackjack:1:3", "bar:2") -> point de sortie */
    this.spots = new Map();
    this.taught = false;
  }

  /**
   * Le point d'apparition vient du plan si l'éditeur l'a déplacé.
   * @param {object} layout contenu de assets/layout.json
   */
  useLayout(layout) {
    const a = layout?.anchors?.spawn;
    if (finite3(a) && this.inside(a)) this.spawn = [a[0], EYE, a[2]];
  }

  /** Le point est-il dans la salle, à distance raisonnable des murs ? */
  inside(p) {
    if (!finite3(p)) return false;
    return Math.abs(p[0]) <= HALL.w / 2 - MARGIN
      && Math.abs(p[2]) <= HALL.d / 2 - MARGIN;
  }

  /**
   * Un client enseigne la sortie de chaque place. On ne le croit pas sur
   * parole : hors de la salle, l'entrée est refusée — au pire un client
   * bricolé fera réapparaître quelqu'un ailleurs DANS le casino, il ne
   * l'expédiera pas dans le décor.
   * @returns {number} nombre d'entrées retenues
   */
  learn(map) {
    if (!map || typeof map !== "object") return 0;
    let n = 0;
    for (const [key, v] of Object.entries(map)) {
      if (this.spots.size >= MAX_SPOTS && !this.spots.has(key)) break;
      if (typeof key !== "string" || key.length > 32) continue;
      if (!finite3(v) || !this.inside(v)) continue;
      this.spots.set(key, [v[0], EYE, v[2]]);
      n++;
    }
    if (n) this.taught = true;
    return n;
  }

  /** Sortie connue de cette place, ou null. */
  exitOf(spot) {
    return spot ? this.spots.get(spot) || null : null;
  }

  /**
   * OÙ REPOSER CE JOUEUR — la décision, entière, prise par le serveur.
   *
   * Assis, sa pose ne vaut rien : on lui cherche une sortie, d'abord dans la
   * carte apprise (fiable même s'il est parti sans un mot), puis dans ce que
   * son client avait déclaré, puis là où il se tenait debout pour la dernière
   * fois. Debout, sa pose fait l'affaire — sauf si elle ne représente pas un
   * corps (vol libre de l'éditeur), auquel cas il a déclaré un point de sortie.
   *
   * Tout ce qui sort de la salle est écarté. On finit toujours par le point
   * d'apparition : il n'existe pas de cas « aucune position ».
   */
  respawn(pl) {
    const tries = pl.spot
      ? [this.exitOf(pl.spot), pl.sp, pl.free]
      : [pl.sp, pl.posted ? pl.p : null, pl.free];
    for (const t of tries) {
      if (!finite3(t) || !this.inside(t)) continue;
      // la hauteur n'est jamais reprise du réseau : les avatars voyagent à
      // y = 0 et les caméras assises à 1,38 m. On repose un joueur DEBOUT.
      return [+t[0].toFixed(2), EYE, +t[2].toFixed(2)];
    }
    return [...this.spawn];
  }
}
