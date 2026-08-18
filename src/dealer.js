/**
 * LA VOIX DU CROUPIER.
 *
 * Le casino avait vingt-sept répliques enregistrées dans `assets/voice/` et en
 * jouait cinq : les annonces de phase (« faites vos jeux », « rien ne va
 * plus ») avaient été coupées parce qu'elles revenaient à CHAQUE manche et
 * saturaient la partie. Le problème n'était pas les répliques, c'était
 * l'absence de mesure — un croupier qui parle à tous les coups n'est plus un
 * personnage, c'est un métronome.
 *
 * Ce module est cette mesure. Trois verrous, dans cet ordre :
 *
 *  1. LE BUDGET DE MANCHE — deux répliques par coup, pas plus. Il se recharge
 *     au « clear » de fin de manche. Une main bavarde en emprunte donc une à
 *     la suivante : c'est voulu, ça crée des mains silencieuses.
 *  2. L'ÉCART MINIMUM — quatre secondes et demie entre deux phrases, quelle
 *     que soit leur importance. Le croupier ne s'enchaîne jamais lui-même.
 *  3. LA PRIORITÉ — un blackjack passe devant un « joli coup », et écrase le
 *     budget si besoin. Le reste attend le prochain coup.
 *
 * S'y ajoute le hasard : chaque intention (`gagne`, `perd`…) tire au sort
 * parmi plusieurs enregistrements, et une intention dite RARE ne sort qu'une
 * fois sur deux ou trois. Deux mains identiques ne s'entendent pas pareil.
 *
 * Le joueur garde la main : le réglage « Voix du croupier » (settings.js)
 * choisit entre BAVARD, MESURÉ et MUET.
 */

/**
 * Le répertoire. Chaque intention pointe vers un ou plusieurs fichiers de
 * `assets/voice/` — le tirage entre eux est ce qui empêche la répétition.
 *
 *  p     priorité (0 = ambiance, 1 = commentaire, 2 = moment fort)
 *  odds  probabilité de dire quelque chose du tout (le silence est une réponse)
 *  cd    délai propre à l'intention, en ms
 */
const LINES = {
  bienvenue:   { f: ["bienvenue", "bonne_chance"], p: 2, odds: 1, cd: 30000 },
  mises:       { f: ["faites_vos_jeux"], p: 0, odds: 0.28, cd: 42000 },
  rideau:      { f: ["rien_ne_va_plus"], p: 0, odds: 0.22, cd: 48000 },
  vite:        { f: ["vite"], p: 1, odds: 0.8, cd: 20000 },
  carte:       { f: ["carte"], p: 0, odds: 0.18, cd: 25000 },
  separe:      { f: ["on_separe"], p: 1, odds: 1, cd: 12000 },
  assurance:   { f: ["assurance"], p: 1, odds: 1, cd: 15000 },
  gagne:       { f: ["joli_coup", "magnifique", "vous_gagnez"], p: 1, odds: 0.55, cd: 9000 },
  perd:        { f: ["dommage"], p: 1, odds: 0.3, cd: 22000 },
  egalite:     { f: ["egalite"], p: 1, odds: 0.5, cd: 20000 },
  banqueGagne: { f: ["la_banque_gagne"], p: 0, odds: 0.25, cd: 30000 },
  banqueSaute: { f: ["banque_saute"], p: 2, odds: 0.85, cd: 12000 },
  // Les moments forts ne jouent QUE les annonces `ann_*` : les vieux doublons
  // (`blackjack`, `ca_chauffe`…) viennent de l'ancienne génération et leur
  // contenu ne correspond plus au nom du fichier — `blackjack.mp3` dit « quel
  // coup de poker ». À réintroduire une fois régénérés par tools/gen-voice.mjs.
  blackjack:   { f: ["ann_blackjack"], p: 3, odds: 1, cd: 8000 },
  magistral:   { f: ["ann_magistral"], p: 3, odds: 1, cd: 12000 },
  chauffe:     { f: ["ann_chauffe"], p: 2, odds: 1, cd: 25000 },
  enFeu:       { f: ["ann_en_feu"], p: 2, odds: 1, cd: 25000 },
  inferno:     { f: ["ann_inferno"], p: 3, odds: 1, cd: 25000 },
};

/** Réglages par niveau de bavardage (clé `dealerVoice` du registre). */
const LEVELS = {
  full: { budget: 3, gap: 3800, minP: 0, odds: 1.25 },
  measured: { budget: 2, gap: 6000, minP: 1, odds: 0.75 },
  off: { budget: 0, gap: 0, minP: 9, odds: 0 },
};

/**
 * LE CROUPIER CHARRIE. Pas d'échantillon dédié pour l'instant (les piques
 * passent par le SALON, signées « Croupier », doublées d'une voix existante
 * quand il y en a une qui colle) — générer les vraies répliques parlées
 * demande une clé ElevenLabs (voir tools/gen-voice.mjs).
 *
 * Chaque pique a son propre délai de répétition, LONG : une vanne répétée
 * n'est plus une vanne, c'est du harcèlement.
 */
const TEASES = {
  // trois mains perdues d'affilée
  loseStreak: {
    voice: "dommage", cd: 50000, lines: [
      "La banque vous remercie de votre générosité…",
      "La chance tourne, paraît-il. Un jour.",
      "Je peux vous faire appeler un taxi, si vous préférez.",
    ],
  },
  // deux mains brûlées d'affilée
  bust: {
    voice: null, cd: 60000, lines: [
      "Le jeu s'appelle vingt-et-un. Pas trente-et-un.",
      "Les cartes, ça se compte aussi, vous savez.",
    ],
  },
  // deux fois de suite à jouer au bord du chrono
  slow: {
    voice: null, cd: 45000, lines: [
      "Prenez votre temps, la nuit est encore jeune…",
      "C'est du blackjack, pas une partie d'échecs.",
    ],
  },
  // un blackjack — même gagnant, on se fait charrier
  bigWin: {
    voice: null, cd: 90000, lines: [
      "Profitez-en… ça ne dure jamais.",
      "La maison vous laisse gagner. Pour l'instant.",
    ],
  },
};

export function createDealerVoice({ audio, settings }) {
  let budget = 2;
  let lastAt = -1e9;
  let chat = null;              // branché par main.js une fois le salon créé
  const said = new Map();       // intention -> date de la dernière sortie
  const lastFile = new Map();   // intention -> dernier fichier joué (anti-doublon)
  const teasedAt = new Map();   // pique -> date de la dernière sortie
  const lastTease = new Map();  // pique -> index de la dernière réplique

  const level = () => LEVELS[settings?.get("dealerVoice") ?? "measured"] || LEVELS.measured;

  /**
   * Une réplique. Renvoie true si elle est partie.
   * @param {string} key intention (clé de LINES)
   * @param {{delay?:number, force?:boolean}} opt `force` ignore le budget —
   *   réservé aux moments qui NE PEUVENT PAS passer sous silence.
   */
  function say(key, opt = {}) {
    const L = LINES[key];
    if (!L) return false;
    const lv = level();
    if (!lv.budget) return false;                       // MUET
    if (L.p < lv.minP) return false;                    // trop anodin pour ce niveau
    const now = performance.now();
    // Un MOMENT FORT (force, ou priorité 3 — blackjack, magistral, inferno) ne
    // passe JAMAIS sous silence : ni l'écart minimum ni le tirage au sort ne
    // peuvent le manger. Un blackjack annoncé une fois sur deux, ce n'est pas
    // de la mesure, c'est un croupier défaillant. Le blackjack tombait en plus
    // pile après « rien ne va plus » : l'écart de 6 s l'avalait quasi à coup sûr.
    const urgent = !!opt.force || L.p >= 3;
    if (!urgent && now - lastAt < lv.gap) return false;  // ça vient de parler
    if (now - (said.get(key) ?? -1e9) < L.cd) return false;
    if (!opt.force && budget <= 0) return false;
    if (!urgent && Math.random() > Math.min(1, L.odds * lv.odds)) {
      // Le silence compte comme une prise de parole pour l'écart : sinon le
      // croupier « essaierait » vingt fois par seconde et finirait par parler
      // à chaque événement, ce qui annule tout le propos.
      said.set(key, now);
      return false;
    }
    // on ne rejoue pas deux fois de suite le même enregistrement d'une famille
    let f = L.f[Math.floor(Math.random() * L.f.length)];
    if (L.f.length > 1 && f === lastFile.get(key)) {
      f = L.f[(L.f.indexOf(f) + 1) % L.f.length];
    }
    lastFile.set(key, f);
    said.set(key, now);
    lastAt = now + (opt.delay || 0);
    budget--;
    // queue : une réplique importante qui arrive pendant que ça parle ATTEND
    // la fin au lieu d'être jetée (voir audio.say) — c'est ce qui rendait
    // « blackjack » muet quand « rien ne va plus » finissait de sonner.
    // un moment fort attend jusqu'à 8 s dans la file : il ne PEUT PAS expirer
    // derrière deux répliques ordinaires (cf. maxWait dans audio.say)
    audio.say?.(f, { cooldown: 400, delay: opt.delay || 0, queue: L.p >= 2,
      maxWait: urgent ? 8000 : 4000 });
    return true;
  }

  /**
   * Une PIQUE. Elle sort dans le salon (signée « Croupier ») et joue la voix
   * associée s'il y en a une. Hors budget de manche — c'est un moment de
   * personnage, pas une annonce — mais chaque pique a son long délai propre.
   * @param {keyof TEASES} kind
   */
  function tease(kind, opt = {}) {
    const T = TEASES[kind];
    if (!T) return false;
    if (!level().budget) return false;      // croupier MUET : il ne charrie pas non plus
    const now = performance.now();
    if (now - (teasedAt.get(kind) ?? -1e9) < T.cd) return false;
    teasedAt.set(kind, now);
    let i = Math.floor(Math.random() * T.lines.length);
    if (T.lines.length > 1 && i === lastTease.get(kind)) i = (i + 1) % T.lines.length;
    lastTease.set(kind, i);
    const go = () => {
      chat?.push?.(T.lines[i], { from: "Croupier", cls: "dealer" });
      if (T.voice) { lastAt = performance.now(); audio.say?.(T.voice, { cooldown: 400, queue: true }); }
    };
    if (opt.delay) setTimeout(go, opt.delay); else go();
    return true;
  }

  return {
    say,
    tease,
    /** Le salon, créé après la voix — les piques s'y affichent. */
    setChat(c) { chat = c; },
    /** Nouveau coup : le budget de parole se recharge. */
    round() { budget = level().budget; },
    /** On quitte la table : plus personne à qui parler. */
    reset() { budget = level().budget; lastAt = -1e9; said.clear(); teasedAt.clear(); },
  };
}
