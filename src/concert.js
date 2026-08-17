/**
 * LE CONCERT — l'événement de la scène de cabaret, MISE EN SCÈNE.
 *
 * Le spectacle lui-même appartient au serveur (`server/concert.mjs`) : c'est
 * lui qui tient la phase et son horloge, et qui les diffuse à tout le monde.
 * Un joueur qui lance le concert le lance POUR TOUTE LA SALLE, au même
 * instant ; ce fichier ne fait que jouer ce qu'on lui dit — rideau, entrée de
 * la chanteuse, musique, salut, sortie.
 *
 * Deux conséquences de ce partage :
 *  - un arrivant tombe en plein milieu du spectacle. L'état reçu porte le temps
 *    écoulé dans la phase (`since`) : on replace la chanteuse sur son trajet et
 *    on démarre le morceau à l'offset voulu, plutôt que de le reprendre à zéro.
 *  - la fin n'est plus décidée ici. La phase `performing` dure exactement le
 *    morceau ; quand il se termine, le serveur enchaîne salut, sortie, rideau.
 *
 * Sans serveur en face (liaison coupée), on rejoue la même machine en local
 * avec les mêmes durées — le jeu reste jouable seul.
 *
 * La chanteuse est `assets/singer.glb`, riggée sur le squelette Mixamo de
 * `assets/player.glb` : elle porte donc ses clips. C'était tout le problème du
 * modèle féminin par défaut, qui n'en a aucun et la faisait glisser jusqu'au
 * micro.
 */
import { V3, clamp } from "./util.js";
const B = BABYLON;

// Vitesse d'avance du clip `walk` à speedRatio 1. Mesurée dans Blender sur la
// PHASE D'APPUI du pied : il glisse de 0,0573 m par image à 24 i/s pendant les
// onze images où il touche le sol, soit 1,375 m/s — ramené à l'échelle de jeu
// (1,70 m pour un modèle de 1,717 m). C'est la seule mesure juste : rapporter
// la foulée à la durée du CYCLE, appui et vol confondus, sous-estime d'un tiers.
const CLIP_SPEED = 1.36;          // m/s
const WALK_SPEED = 0.95;          // m/s — une entrée de diva ne se court pas
// Le pied doit rester collé au sol : on cale la cadence du clip sur la vitesse
// réelle plutôt que l'inverse.
const CLIP_RATIO = WALK_SPEED / CLIP_SPEED;

// Durées de repli, en secondes. Elles DOIVENT rester identiques à celles de
// `server/concert.mjs` : le serveur fait autorité, ces valeurs ne servent qu'à
// tenir le spectacle debout quand la liaison est coupée.
const DUR = {
  announce: 3.6, opening: 2.0, entering: 4.2,
  performing: 0,                  // = durée du morceau, connue du serveur
  bow: 2.6, leaving: 3.8, closing: 2.2,
};
const NEXT = {
  announce: "opening", opening: "entering", entering: "performing",
  performing: "bow", bow: "leaving", leaving: "closing", closing: "idle",
};

export function createConcert({ scene, stage, people, audio }) {
  let singer = null;
  let state = "idle";
  let t = 0, stateT = 0;
  let wp = [], wpi = 0;
  let baseYaw = 0;
  let net = null;                  // liaison serveur, posée par main.js
  let songLen = 0;                 // durée du morceau, annoncée par le serveur
  let mouth;                       // cible de morph « bouche ouverte » (undefined = pas cherchée)
  let mouthMgr = null;             // son gestionnaire, pour la sonde
  let mouthT = 0;                  // son influence lissée
  // Réglage de la PRISE, ajustable en jeu par `__dev.grip(...)`. Les décalages
  // sont en local scène (x latéral, y hauteur, z vers le mur) ; `curl` ferme
  // les doigts, `pole` est l'axe de l'objet tenu — vertical pour un pied de
  // micro, c'est lui qui met la paume dans le bon sens.
  const grip = { high: [0, 0, 0], low: [0, 0, 0], curl: 0.8, pole: [0, 1, 0] };

  const deckY = stage.height;

  function ensureSinger() {
    if (singer) return singer;
    const p = stage.at(0, 1.6);              // au fond des coulisses
    singer = people.spawn(V3(p.x, deckY, p.z), stage.root.rotation.y, {
      singer: true, sex: "f", height: 1.70,
    });
    singer.root.setEnabled(false);
    return singer;
  }

  /** Trajet d'entrée (coulisses -> micro) ou de sortie. */
  const pathIn = () => [stage.at(0, 0.2), stage.micSpot()];
  const pathOut = () => [stage.at(0, 0.2), stage.at(0, 1.7)];

  /** Marche vers un point monde (XZ) ; renvoie true à l'arrivée. */
  function walkTo(target, dt) {
    const r = singer.root;
    const dx = target.x - r.position.x, dz = target.z - r.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.07) return true;
    const step = Math.min(d, WALK_SPEED * dt);
    r.position.x += (dx / d) * step;
    r.position.z += (dz / d) * step;
    // se tourne vers sa direction de marche, en douceur
    const want = Math.atan2(dx, dz);
    let dy = want - r.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    r.rotation.y += dy * Math.min(1, dt * 8);
    return false;
  }

  /**
   * Pose la chanteuse à `dist` mètres le long d'un trajet. Sert au rattrapage :
   * un joueur qui arrive alors qu'elle marche déjà doit la voir là où elle en
   * est, pas la voir repartir des coulisses.
   */
  function placeAlong(from, points, dist) {
    const r = singer.root;
    let cur = from.clone(), i = 0;
    while (i < points.length) {
      const seg = points[i].subtract(cur);
      seg.y = 0;
      const L = seg.length();
      if (dist < L) {
        const p = cur.add(seg.scale(dist / L));
        r.position.set(p.x, deckY, p.z);
        r.rotation.y = Math.atan2(seg.x, seg.z);
        wpi = i;
        return false;
      }
      dist -= L;
      cur = points[i];
      i++;
    }
    r.position.set(cur.x, deckY, cur.z);
    wpi = points.length;
    return true;                    // trajet déjà bouclé
  }

  /** Face au public : le regard des figurants part en -Z local, donc yaw + π. */
  const faceCrowd = () => stage.root.rotation.y + Math.PI;

  /**
   * La plante au micro, face à la salle. Indispensable au rattrapage : un
   * arrivant en plein salut n'a pas vu l'entrée en scène, sa chanteuse vient
   * d'être créée au fond des coulisses — sans ce recalage elle saluerait le
   * mur du fond.
   */
  function atMic(s) {
    const mic = stage.micSpot();
    s.root.position.set(mic.x, deckY, mic.z);
    baseYaw = faceCrowd();
    s.root.rotation.y = baseYaw;
    s.root.setEnabled(true);
    return mic;
  }

  /**
   * SYNCHRO LABIALE. Le modèle porte des cibles de morph faciales
   * (`assets/singer.glb` : `aaah`, `smile_open`…) ; on retient celle qui ouvre
   * la bouche, et son influence suit le niveau du chant. Renvoie null sur un
   * modèle qui n'en a pas — la chanteuse chante alors bouche fermée, sans que
   * rien ne casse.
   */
  function mouthTarget() {
    if (mouth !== undefined) return mouth;
    mouth = [];
    // UNE cible ne suffit pas. Le visage est exporté en sept PRIMITIVES (une
    // par matériau : peau, dents, langue, yeux…) et Babylon en fait sept
    // maillages, chacun avec SON gestionnaire de morphs. Ne piloter que le
    // premier trouvé revient à n'ouvrir que les dents — l'influence montait
    // bien (0,77 relevé à la sonde) sans que la bouche bouge.
    for (const m of singer.model.getChildMeshes()) {
      const mgr = m.morphTargetManager;
      if (!mgr) continue;
      for (let i = 0; i < mgr.numTargets; i++) {
        const t = mgr.getTarget(i);
        if (/aaah|mouthopen|jaw/i.test(t.name || "")) { mouth.push(t); mouthMgr = mgr; }
      }
    }
    console.info(mouth.length
      ? "[concert] synchro labiale : " + mouth.length + " cible(s) « " + mouth[0].name + " »"
      : "[concert] modèle sans cible de morph : pas de synchro labiale");
    return mouth;
  }

  let lastGrip = null;             // dernière prise posée, pour le suivi au gizmo

  /** (Re)pose la prise sur le micro, réglages courants compris. */
  function applyGrip(s = singer) {
    if (!s) return null;
    const g = stage.micGrip?.(grip);
    if (!g) return null;
    s.hold?.({
      right: g.high, left: g.low, curl: grip.curl,
      pole: new B.Vector3(grip.pole[0], grip.pole[1], grip.pole[2]),
    });
    lastGrip = g;
    return g;
  }

  const stageLights = (on) => {
    for (const l of stage.lights) {
      l._i0 = l._i0 ?? l.intensity;
      l.intensity = on ? l._i0 * 1.9 : l._i0;
    }
  };

  /**
   * Entre dans une phase. `elapsed` (s) est le temps DÉJÀ écoulé dedans côté
   * serveur : nul pour un spectacle suivi depuis le début, non nul pour un
   * arrivant, qu'on rattrape au lieu de lui rejouer le début.
   */
  function enter(phase, elapsed = 0) {
    state = phase;
    stateT = elapsed;
    const fresh = elapsed < 1.2;             // on ne rejoue pas un son périmé
    if (phase !== "performing") {
      // la bouche se referme et les mains lâchent le micro dès qu'elle ne
      // chante plus — sinon elle repart en coulisses les bras tendus derrière
      if (mouth?.length) { mouthT = 0; for (const m of mouth) m.influence = 0; }
      singer?.hold?.(null);
    }

    switch (phase) {
      case "idle":
        if (singer) singer.root.setEnabled(false);
        stage.open(0);
        stageLights(false);
        audio.concert?.(false);
        break;

      case "announce":
        ensureSinger().root.setEnabled(false);
        stage.open(0);
        if (fresh) audio.say?.("annonce_concert", { cooldown: 4000, vol: 1.0 });
        break;

      case "opening":
        ensureSinger().root.setEnabled(false);
        stage.open(1);
        break;

      case "entering": {
        const s = ensureSinger();
        const start = stage.at(0, 1.6);
        stage.open(1);
        wp = pathIn();
        wpi = 0;
        s.root.position.set(start.x, deckY, start.z);
        s.root.rotation.y = stage.root.rotation.y;
        const arrived = placeAlong(start, wp, elapsed * WALK_SPEED);
        s.root.setEnabled(true);
        // déjà au micro (gros retard réseau) : inutile de piétiner sur place
        if (arrived) { atMic(s); s.play?.("idle"); }
        else s.play?.("walk", { speed: CLIP_RATIO });
        break;
      }

      case "performing": {
        const s = ensureSinger();
        stage.open(1);
        atMic(s);
        s.play?.("idle");
        // les mains empoignent le micro : droite sur le corps, gauche plus bas
        // sur le fût. Cibles en MONDE, réappliquées à chaque image par `_pose`
        // (le clip `idle` reposerait sinon les bras le long du corps).
        applyGrip(s);
        stageLights(true);
        if (fresh) audio.fx?.("applause", { vol: 0.55 });
        // reprise en cours de morceau : on démarre à l'offset, pas à zéro
        audio.concert?.(true, elapsed);
        break;
      }

      case "bow": {
        const s = ensureSinger();
        stage.open(1);
        atMic(s);
        s.play?.("idle");
        stageLights(true);
        audio.concert?.(false);
        if (fresh) audio.fx?.("applause", { vol: 0.6 });
        break;
      }

      case "leaving": {
        const s = ensureSinger();
        stage.open(1);
        stageLights(true);
        // la sortie part TOUJOURS du micro : c'est là qu'elle a salué
        const mic = atMic(s);
        wp = pathOut();
        wpi = 0;
        s.play?.("walk", { speed: CLIP_RATIO });
        const done = placeAlong(mic, wp, elapsed * WALK_SPEED);
        if (done) s.root.setEnabled(false);
        break;
      }

      case "closing":
        if (singer) singer.root.setEnabled(false);
        stage.open(0);
        stageLights(false);
        break;
    }
  }

  const api = {
    // `closing` en fait partie : le rideau tombe encore, et le serveur refuse
    // un nouveau départ tant que la phase n'est pas revenue à `idle`
    get running() { return state !== "idle"; },
    get state() { return state; },
    /** Vrai tant que le serveur n'a pas repris la main : repli local. */
    get solo() { return !net?.connected; },

    /** Liaison serveur, posée par main.js une fois `Net` construit. */
    bind(n) { net = n; },

    /**
     * RÉGLAGE À CHAUD de la prise du micro, depuis la console :
     *   __dev.grip({ high: [0, 0.05, -0.02] })   décale la main haute
     *   __dev.grip({ curl: 0.4 })                doigts moins refermés
     *   __dev.grip({ pole: [0, 0, 1] })          change l'axe de la paume
     * Renvoie l'état courant : quand c'est bon, ce sont ces valeurs qu'il faut
     * reporter en dur dans `stage.js`.
     */
    grip(o = {}) {
      Object.assign(grip, o);
      const g = applyGrip();
      return { ...grip, monde: g && { haute: g.high.asArray(), basse: g.low.asArray() } };
    },

    /**
     * SONDE. `__dev.mic()` en console : dit où sont réellement les mains, où
     * elles devraient être, et ce que vaut la bouche. Le seul moyen de trancher
     * entre « la prise ne s'applique pas » et « la prise s'applique au mauvais
     * endroit » sans passer une heure à deviner.
     */
    debug() {
      const r3 = (v) => (v ? [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)] : null);
      const g = stage.micGrip?.();
      const at = (n) => r3(singer?.node?.(n)?.getAbsolutePosition());
      return {
        phase: state,
        tMorceau: +stateT.toFixed(2),
        chanteuse: r3(singer?.root.position),
        prisePrevue: g ? { haute: r3(g.high), basse: r3(g.low) } : "micGrip absent",
        priseActive: singer?._hold
          ? { droite: r3(singer._hold.right), gauche: r3(singer._hold.left) }
          : "AUCUNE (hold non posé)",
        mainDroite: at("RightHand"), mainGauche: at("LeftHand"),
        paumeDroite: at("RightHandMiddle1"), paumeGauche: at("LeftHandMiddle1"),
        epauleDroite: at("RightArm"),
        bouche: mouth?.length ? +mouth[0].influence.toFixed(3) : "cible introuvable",
        ciblesBouche: mouth?.length ?? 0,
        ancres: {
          singerSpot: r3(stage.micSpot?.()),
          micHigh: r3(stage.micGrip?.().high),
          micLow: r3(stage.micGrip?.().low),
        },
        niveauChant: +(audio.concertLevelAt?.(audio.concertTime?.() ?? stateT) || 0).toFixed(3),
        enveloppePrete: !!audio._concertEnv,
        morphsActifs: mouthMgr ? mouthMgr.numInfluencers : null,
      };
    },

    /**
     * Demande de lancement. On n'ouvre RIEN ici : le serveur tranche et
     * l'ordre revient par `applyServer`, pour tout le monde à la fois.
     */
    start() {
      if (net?.connected) { net.concert("start"); return; }
      if (state !== "idle") return;
      enter("announce");
    },

    /** Fin anticipée, même principe. */
    stop() {
      if (net?.connected) { net.concert("stop"); return; }
      if (state !== "performing") return;
      enter("bow");
    },

    /**
     * Photo du spectacle reçue du serveur.
     * @param {object} st {phase, since (ms), dur (ms), song (ms)}
     */
    applyServer(st) {
      if (!st || typeof st.phase !== "string") return;
      songLen = (st.song || 0) / 1000;
      const elapsed = Math.max(0, (st.since || 0) / 1000);
      if (st.phase === state && state !== "idle") {
        // même phase : on se contente de recaler l'horloge, sans rejouer
        // l'entrée (elle relancerait sons et positions à chaque trame)
        stateT = elapsed;
        return;
      }
      enter(st.phase, elapsed);
    },

    tick(dt, playerPos) {
      // LES POURSUITES d'abord, et même à l'arrêt : c'est là que se fait leur
      // fondu d'extinction. Elles accrochent l'artiste dès son entrée et la
      // lâchent quand elle a disparu dans les coulisses.
      const lit = state === "entering" || state === "performing"
        || state === "bow" || state === "leaving";
      stage.follow?.(
        lit && singer ? singer.root.position.add(V3(0, 1.15, 0)) : null, lit, dt);
      if (state === "idle") return;
      t += dt;
      stateT += dt;

      // ---- avance autonome UNIQUEMENT hors ligne ----
      // Avec un serveur, les transitions arrivent par `applyServer` : les
      // clients restent alors rigoureusement en phase entre eux.
      if (this.solo) {
        const d = state === "performing" ? (songLen || audio.concertLength?.() || 0) : DUR[state];
        if (d && stateT >= d) { enter(NEXT[state]); return; }
      }

      switch (state) {
        case "entering":
          if (wpi < wp.length && walkTo(wp[wpi], dt)) {
            wpi++;
            if (wpi >= wp.length) {
              // arrivée avant le signal du serveur : elle patiente au micro
              singer.play?.("idle");
              baseYaw = faceCrowd();
            }
          }
          break;

        case "performing": {
          // ELLE NE BOUGE PAS DE SON MICRO. Le balancement de buste et le
          // dandinement vertical qui vivaient ici la faisaient pivoter sur
          // elle-même : au micro, une chanteuse est plantée. Ne restent que la
          // respiration et les micro-mouvements de tête, portés par `_pose`
          // dans npc.js, et le clip `idle`.
          const r = singer.root;
          const spot = stage.micSpot();
          r.position.set(spot.x, deckY, spot.z);
          r.rotation.y = baseYaw;
          // RÉGLAGE EN DIRECT : tirer une ancre au gizmo (mode éditeur) doit
          // déplacer les mains tout de suite, sans rechargement. On ne repose
          // la prise que si elle a réellement bougé — `hold()` remet à zéro la
          // correction paume/poignet, qui coûte une passe d'IK de plus.
          const g = stage.micGrip?.(grip);
          if (g && (!lastGrip
              || B.Vector3.Distance(g.high, lastGrip.high) > 0.002
              || B.Vector3.Distance(g.low, lastGrip.low) > 0.002)) {
            applyGrip(singer);
          }
          // LA BOUCHE suit le chant, lue dans l'enveloppe du morceau à
          // l'instant `stateT` — c'est-à-dire à l'horloge du SERVEUR, la même
          // pour tout le monde. On étale un peu, on plafonne, et on lisse :
          // une mâchoire a de l'inertie, elle ne claque pas d'une image à
          // l'autre (attaque vive, relâche plus lente).
          const songT = audio.concertTime?.() ?? stateT;
          const lvl = clamp((audio.concertLevelAt?.(songT) || 0) * 1.5, 0, 1);
          mouthT += (lvl - mouthT) * Math.min(1, dt * (lvl > mouthT ? 18 : 9));
          for (const m of mouthTarget()) m.influence = mouthT * 0.9;
          break;
        }

        case "leaving":
          if (wpi < wp.length && walkTo(wp[wpi], dt)) {
            wpi++;
            if (wpi >= wp.length) singer.root.setEnabled(false);
          }
          break;
      }
    },
  };
  return api;
}
