/**
 * Moteur audio 100% ÉCHANTILLONS — plus une seule note de synthèse.
 *
 * Tout ce qui était généré en code (lits de bruit blanc filtré, salves de
 * « syllabes » de foule, jingles d'oscillateurs, feu, bobines de machine à
 * sous…) a été retiré : ça grésillait en permanence par-dessus les vraies
 * boucles. Ne restent que les fichiers de `assets/sfx/` et `assets/voice/`.
 *
 * Les méthodes sans échantillon correspondant sont conservées MUETTES : les
 * appelants (main.js, blackjack.js, heat.js, chips.js…) ne changent pas, et
 * il suffira de déposer le mp3 attendu pour que le son revienne.
 */
const rnd = (a, b) => a + Math.random() * (b - a);

/** Plafond de la musique de salle. C'est un FOND : même poussée à 100 %, elle
 *  ne doit pas passer devant les jetons, les cartes et le croupier. */
const MUSIC_MAX = 0.4;

export class Audio {
  constructor() {
    this.ready = false;
    this.ctx = null;
    // Volumes du menu des paramètres. Ils sont réglables AVANT même que le
    // contexte audio existe (le navigateur attend un geste) : on les garde
    // ici, init() les repose sur les bus.
    this._vol = { master: 0.85, fx: 1, amb: 1, voice: 1 };
    this._musicLevel = 0.4;      // curseur d'ambiance du menu principal
  }

  init() {
    if (this.ready) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this._vol.master;

    // TROIS DÉPARTS sous le maître — effets, ambiance, voix. C'est ce qui rend
    // les curseurs du menu indépendants : baisser la rumeur de salle ne doit
    // pas éteindre le croupier.
    this.busFx = ctx.createGain();
    this.busAmb = ctx.createGain();
    this.busVoice = ctx.createGain();
    this.busFx.gain.value = this._vol.fx;
    this.busAmb.gain.value = this._vol.amb;
    this.busVoice.gain.value = this._vol.voice;

    // Réverbération de salle. Ce n'est PAS un son généré : le convolueur ne
    // produit rien tout seul, il ne fait que donner sa taille à la salle pour
    // les échantillons qu'on lui envoie (revSend).
    this.conv = ctx.createConvolver();
    this.conv.buffer = this._impulse(2.6, 2.2);
    const wet = ctx.createGain(); wet.gain.value = 0.28;
    this.conv.connect(wet); wet.connect(this.master);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 1;
    this.revSend.connect(this.conv);

    // Chaque bus part vers le sec ET vers la salle : une source coupée au
    // curseur ne laisse pas traîner sa réverbération.
    for (const b of [this.busFx, this.busAmb, this.busVoice]) {
      b.connect(this.master);
      b.connect(this.revSend);
    }

    // Compresseur de sortie, précédé d'un passe-bas de « ralenti » : ouvert en
    // temps normal (19 kHz), il étouffe tout le bus pendant les moments de
    // cinéma — le son sous l'eau du slow-motion.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.knee.value = 12;
    this._slowFilt = ctx.createBiquadFilter();
    this._slowFilt.type = "lowpass";
    this._slowFilt.frequency.value = 19000;
    this._slowFilt.Q.value = 0.5;
    this.master.connect(this._slowFilt);
    this._slowFilt.connect(comp);
    comp.connect(ctx.destination);

    this.ready = true;

    this._crowd();
    this.waterGain = this._water();
    if (this._ambTrack) this._playAmbience();
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  /**
   * Volume d'un bus — appelé par le menu des paramètres.
   * @param {"master"|"fx"|"amb"|"voice"} bus
   * @param {number} v 0 → 1
   */
  setVolume(bus, v) {
    if (!(bus in this._vol)) return;
    this._vol[bus] = Math.min(1, Math.max(0, v));
    if (!this.ready) return;                 // repris tel quel par init()
    const node = bus === "master" ? this.master
      : bus === "fx" ? this.busFx : bus === "amb" ? this.busAmb : this.busVoice;
    // rampe courte : un curseur qu'on glisse ne doit pas claquer
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(node.gain.value, t);
    node.gain.linearRampToValueAtTime(this._vol[bus], t + 0.06);
  }

  // ---------- échantillons (assets/sfx, générés hors ligne via ElevenLabs) ----------

  _fxBuf(name) {
    this._fxBank = this._fxBank || new Map();
    if (this._fxBank.has(name)) return this._fxBank.get(name);
    const p = fetch("assets/sfx/" + name + ".mp3")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((b) => this.ctx.decodeAudioData(b))
      .catch(() => null);
    this._fxBank.set(name, p);
    return p;
  }

  /**
   * Joue un échantillon. Renvoie true si le fichier existe, false sinon — il
   * n'y a plus de repli procédural derrière ce false : sans le fichier, le jeu
   * est simplement muet sur ce son.
   * `rate` varie la hauteur : indispensable aux sons répétés (jetons) pour ne
   * pas mitrailler exactement le même clic.
   * `when` diffère de N secondes ; `at` vise une date ABSOLUE du contexte audio
   * — c'est ce dont a besoin une file d'attente (voir `card()`), car `when`
   * serait faussé par le temps de décodage entre l'appel et le démarrage.
   */
  async fx(name, { vol = 1, rate = 1, when = 0, at = null } = {}) {
    if (!this.ready || vol <= 0.02) return true;
    const buf = await this._fxBuf(name);
    if (!buf) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g); g.connect(this.busFx);
    const now = this.ctx.currentTime;
    s.start(at != null ? Math.max(at, now) : now + when);
    return true;
  }

  // ---------- helpers ----------

  /** Réponse impulsionnelle de la réverbération (bruit décroissant, jamais audible seul). */
  _impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }

  // ---------- lits d'ambiance ----------

  /**
   * Rumeur de salle : uniquement `crowd_loop.mp3`. L'ancien lit synthétique
   * (bruit bandpass + une salve de « syllabe » toutes les 90–420 ms) est
   * supprimé — c'était le mitraillage permanent.
   */
  _crowd() {
    const ctx = this.ctx;
    this._fxBuf("crowd_loop").then((buf) => {
      if (!buf) return;
      const cs = ctx.createBufferSource();
      cs.buffer = buf; cs.loop = true;
      const cg = ctx.createGain(); cg.gain.value = 0.035;
      cs.connect(cg); cg.connect(this.busAmb);
      cs.start();
    });
  }

  /**
   * FONTAINE — boucle sans couture générée hors ligne. Plus de repli
   * procédural : sans `fountain_loop.mp3`, le bassin est silencieux.
   */
  _water() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    g.connect(this.busAmb);

    this._fxBuf("fountain_loop").then((buf) => {
      if (!buf) return;
      const s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true;
      // le fichier généré a un fondu d'entrée/sortie : bouclé tel quel, le son
      // « respirait » (montée, fondu, reprise). On ne boucle que le CŒUR du
      // fichier — loopStart/loopEnd sautent les bords — et on démarre dedans :
      // le débit devient constant, comme une vraie fontaine
      const edge = Math.min(1.6, buf.duration * 0.18);
      s.loopStart = edge;
      s.loopEnd = buf.duration - edge;
      const sg = ctx.createGain(); sg.gain.value = 0.9;
      s.connect(sg); sg.connect(g);
      s.start(0, edge);
    });

    return g;
  }

  /** appelée chaque frame avec la distance du joueur à la fontaine */
  setWaterDistance(d) {
    if (!this.ready) return;
    // légère, et seulement PRÈS du bassin : portée 9 m, courbe douce
    const v = Math.max(0, 1 - d / 9);
    this.waterGain.gain.value = 0.13 * v * v;
  }

  /** conservée pour l'API (main.js l'appelle) — le piano d'ambiance est retiré */
  setPianoDistance() { }
  duckPiano() { }

  // ---------- musique d'ambiance ----------

  /**
   * L'AMBIANCE SONORE de la salle — une longue pièce, choisie dans le menu.
   *
   * Jouée EN FLUX (`<audio>` + MediaElementSource) et non décodée comme les
   * effets : ces morceaux pèsent 6 Mo chacun, les tenir en PCM coûterait des
   * dizaines de mégaoctets pour rien. Le flux part dans le bus d'ambiance, donc
   * le curseur « Ambiance & musique » le règle comme le reste.
   *
   * @param {string|null} track nom de fichier dans assets/music, null = silence
   */
  ambience(track) {
    this._ambTrack = track || null;
    if (!this.ready) return;             // init() reposera le choix
    this._playAmbience();
  }

  _playAmbience() {
    const ctx = this.ctx;
    if (!this._music) {
      // document.createElement et pas `new Audio()` : dans cette classe, le nom
      // Audio, c'est elle.
      const el = document.createElement("audio");
      el.loop = true;
      el.preload = "none";
      this._music = el;
      this._musicGain = ctx.createGain();
      this._musicGain.gain.value = 0.0001;
      // DEUX étages de gain, et il en faut deux. `_musicGain` porte les fondus
      // de changement de piste et le curseur ; `_musicSpace` porte la position
      // dans la salle, réécrite à chaque frame. Sur un seul nœud, l'écriture
      // par frame annulerait les rampes en cours (`cancelScheduledValues`) et
      // le fondu enchaîné entre deux morceaux sauterait.
      this._musicSpace = ctx.createGain();
      this._musicSpace.gain.value = 1;
      ctx.createMediaElementSource(el).connect(this._musicGain);
      this._musicGain.connect(this._musicSpace);
      this._musicSpace.connect(this.busAmb);
    }
    const url = this._ambTrack ? "assets/music/" + this._ambTrack + ".mp3" : null;
    if (url === this._musicUrl) return;
    const el = this._music;
    const had = !!this._musicUrl;
    this._musicUrl = url;
    // on ne coupe jamais net : la piste en place s'efface, la suivante monte
    clearTimeout(this._musicTimer);
    if (had) this._musicFade(0, 0.55);
    this._musicTimer = setTimeout(() => {
      if (!url) { el.pause(); return; }
      el.src = url;
      // concert en cours : le flux reste en pause, la fin du spectacle le
      // relancera sur cette nouvelle piste
      if (this._ambDuck) return;
      el.play().catch(() => { });      // sans geste utilisateur : on retentera
      this._musicFade(this._musicVol(), 2.2);
    }, had ? 600 : 0);
  }

  /**
   * PLACE de l'ambiance dans la salle, appelée chaque frame.
   *
   * Debout, la musique SORT DE LA SCÈNE : elle décroît avec la distance et
   * s'éteint au-delà de AMB_RANGE — on doit pouvoir la situer à l'oreille.
   * Assis à une table de blackjack (`global`), elle cesse d'appartenir à la
   * scène et passe en fond général, à plein niveau : on est dans sa bulle de
   * jeu, la salle devient une bande-son.
   *
   * Le lissage exponentiel sert deux fois : il évite l'escalier de gain quand
   * on marche, et il transforme la bascule assis/debout en un fondu d'environ
   * une demi-seconde au lieu d'un claquement.
   */
  setAmbienceDistance(d, global = false) {
    if (!this.ready || !this._musicSpace) return;
    const AMB_RANGE = 24;
    const target = global ? 1 : Math.max(0, 1 - d / AMB_RANGE) ** 1.6;
    const cur = this._ambSpace ?? target;
    this._ambSpace = cur + (target - cur) * 0.06;
    this._musicSpace.gain.value = this._ambSpace;
  }

  /** Volume de l'ambiance, 0 → 1 (curseur du menu principal). */
  setMusicLevel(v) {
    this._musicLevel = Math.min(1, Math.max(0, v));
    if (this.ready && this._musicUrl) this._musicFade(this._musicVol(), 0.12);
  }

  /** Niveau réel : le plafond, le curseur — et RIEN pendant le concert. */
  _musicVol() { return this._ambDuck ? 0 : MUSIC_MAX * this._musicLevel; }

  _musicFade(to, sec) {
    if (!this._musicGain) return;
    const g = this._musicGain.gain, t = this.ctx.currentTime;
    const v = Math.max(0.0001, to);
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    if (sec > 0) g.linearRampToValueAtTime(v, t + sec);
    else g.setValueAtTime(v, t);
  }

  /**
   * Le CONCERT : morceau chanté, source localisée à la scène, large portée.
   *
   * `offset` (s) démarre le morceau EN COURS DE ROUTE. C'est ce dont a besoin
   * un joueur qui rejoint le casino pendant le spectacle : le serveur donne le
   * temps écoulé, on entre au même endroit du morceau que les autres.
   *
   * La boucle a disparu : le concert se termine AVEC la chanson (le serveur
   * enchaîne alors salut, sortie et rideau).
   */
  concert(on, offset = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (!this._concertGain) {
      this._concertGain = ctx.createGain();
      this._concertGain.gain.value = 0;
      this._concertGain.connect(this.busAmb);
    }
    this._concertOn = !!on;
    // deux musiques à la fois, c'est une musique de trop : l'ambiance de salle
    // S'ARRÊTE pendant le spectacle — fondu rapide puis pause du flux — et
    // repart quand le rideau tombe.
    this._ambDuck = !!on;
    clearTimeout(this._ambPauseTimer);
    if (this._musicUrl) {
      if (on) {
        this._musicFade(0, 0.9);
        this._ambPauseTimer = setTimeout(() => {
          if (this._ambDuck) this._music?.pause();
        }, 1000);
      } else {
        this._music?.play().catch(() => { });
        this._musicFade(this._musicVol(), 2.5);
      }
    }
    if (on) {
      this._concertSpace = 0;          // le morceau montera de la scène, en fondu
      this._fxBuf("concert_song").then((buf) => {
        if (!buf || !this._concertOn) return;
        this._concertLen = buf.duration;
        if (this._concertSrc) { try { this._concertSrc.stop(); } catch { } }
        const s = ctx.createBufferSource();
        s.buffer = buf; s.loop = false;
        s.connect(this._concertGain);
        // Prise d'analyse pour la SYNCHRO LABIALE. Branchée sur la source, pas
        // sur `_concertGain` : ce gain-là porte l'atténuation par la distance,
        // et la bouche de la chanteuse n'a aucune raison de se fermer parce que
        // le joueur s'éloigne.
        // l'enveloppe pour la synchro labiale, calculée une seule fois
        if (!this._concertEnv) this._buildEnvelope(buf);
        // au-delà de la fin (retard réseau extrême), on ne joue rien plutôt
        // que de faire repartir le morceau du début
        const from = Math.max(0, offset);
        if (from >= buf.duration) return;
        s.start(0, from);
        // Instant de départ RÉEL, décodage compris : la bouche doit suivre ce
        // qu'on entend, pas ce que l'horloge de phase croit qu'on entend. Le
        // décodage du mp3 coûte 100 à 300 ms, sinon en avance sur le son.
        this._concertT0 = ctx.currentTime - from;
        this._concertSrc = s;
      });
    } else if (this._concertSrc) {
      // fondu de sortie, puis arrêt
      const g = this._concertGain.gain, t = ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.0001, t + 1.6);
      const src = this._concertSrc;
      this._concertSrc = null;
      setTimeout(() => { try { src.stop(); } catch { } }, 1800);
    }
  }

  /**
   * ENVELOPPE DU CHANT — l'énergie du morceau, image par image, calculée UNE
   * fois sur le tampon décodé.
   *
   * C'est ce qui ouvre la bouche de la chanteuse. Un `AnalyserNode` temps réel
   * paraissait plus naturel, mais il dépend de l'état du graphe audio, du
   * navigateur et du moment où l'on interroge : il rendait un niveau plat, donc
   * une bouche fermée. Une enveloppe précalculée, elle, se lit à n'importe quel
   * instant du morceau — y compris celui que le SERVEUR annonce, ce qui aligne
   * la bouche sur la musique pour tous les joueurs, où qu'ils en soient.
   */
  async _buildEnvelope(buf) {
    if (this._envPending) return;                 // deux appels, un seul calcul
    this._envPending = true;
    const HZ = 30;

    // RMS par fenêtre de 1/30 s d'un canal de PCM.
    const rms30 = (ch) => {
      const win = Math.max(1, Math.floor(buf.sampleRate / HZ));
      const n = Math.ceil(ch.length / win);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = i * win, b = Math.min(ch.length, a + win);
        let s = 0, c = 0;
        for (let j = a; j < b; j += 8) { const v = ch[j]; s += v * v; c++; }
        out[i] = c ? Math.sqrt(s / c) : 0;
      }
      return out;
    };

    // PRÉSENCE VOCALE, pas énergie brute : l'ancienne enveloppe (RMS large
    // bande) ouvrait la bouche dès l'intro instrumentale — 28 s de piano, 28 s
    // de mâchoire dans le vide. La voix d'un mix est presque toujours au
    // CENTRE stéréo, l'accompagnement a de la largeur : dans la bande vocale
    // (220 Hz – 4,2 kHz), l'énergie du canal mid (L+R) MOINS celle du side
    // (L−R) isole le chant. Rendu hors ligne avec de vrais biquads.
    let env;
    if (buf.numberOfChannels >= 2 && typeof OfflineAudioContext !== "undefined") {
      const off = new OfflineAudioContext(2, buf.length, buf.sampleRate);
      const src = off.createBufferSource(); src.buffer = buf;
      const split = off.createChannelSplitter(2);
      src.connect(split);
      const merge = off.createChannelMerger(2);
      const band = (input, out) => {
        const hp = off.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 220;
        const lp = off.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200;
        input.connect(hp); hp.connect(lp); lp.connect(merge, 0, out);
        return input;
      };
      const gLm = off.createGain(), gRm = off.createGain();
      const gLs = off.createGain(), gRs = off.createGain();
      gLm.gain.value = 0.5; gRm.gain.value = 0.5;    // mid  = (L + R) / 2
      gLs.gain.value = 0.5; gRs.gain.value = -0.5;   // side = (L − R) / 2
      const sumM = off.createGain(), sumS = off.createGain();
      split.connect(gLm, 0); split.connect(gRm, 1); gLm.connect(sumM); gRm.connect(sumM);
      split.connect(gLs, 0); split.connect(gRs, 1); gLs.connect(sumS); gRs.connect(sumS);
      band(sumM, 0); band(sumS, 1);
      merge.connect(off.destination);
      src.start();
      const out = await off.startRendering();
      const mid = rms30(out.getChannelData(0));
      const side = rms30(out.getChannelData(1));
      env = new Float32Array(mid.length);
      // side pondéré ×1,6 (mesuré sur le morceau : meilleur contraste
      // intro/chant du balayage 1,0 → 2,5 sans écorner les couplets)
      for (let i = 0; i < mid.length; i++) env[i] = Math.max(0, mid[i] - 1.6 * side[i]);
    } else {
      // mono (ou vieux navigateur) : pas de séparation possible, on retombe
      // sur l'énergie brute — mieux qu'une bouche définitivement close
      env = rms30(buf.getChannelData(0));
    }

    // Étalonnage sur le 90e centile plutôt que sur le maximum : un seul coup de
    // cymbale écraserait sinon tout le reste et la bouche resterait entrouverte.
    const sorted = Float32Array.from(env).sort();
    const ref = sorted[Math.floor(env.length * 0.9)] || 1;
    // ...puis PORTE À BRUIT : le résidu d'accompagnement qui fuit dans le mid
    // (basse, batterie centrées) ne doit pas faire marmonner la chanteuse.
    const GATE = 0.25;
    for (let i = 0; i < env.length; i++) {
      const v = Math.min(1, env[i] / ref);
      env[i] = v < GATE ? 0 : (v - GATE) / (1 - GATE);
    }
    this._concertEnv = env;
    this._concertEnvHz = HZ;
    return env;
  }

  /**
   * Niveau du chant à l'instant `t` du morceau (secondes), 0 → 1.
   * Renvoie 0 tant que le fichier n'est pas décodé — la bouche reste close.
   */
  concertTime() {
    return this._concertSrc && this._concertT0 != null
      ? Math.max(0, this.ctx.currentTime - this._concertT0) : null;
  }

  concertLevelAt(t) {
    const env = this._concertEnv;
    if (!env) return 0;
    const x = Math.max(0, t) * this._concertEnvHz;
    const i = Math.floor(x);
    if (i >= env.length - 1) return env[env.length - 1] || 0;
    return env[i] + (env[i + 1] - env[i]) * (x - i);   // interpolation linéaire
  }

  /**
   * Durée du morceau, une fois décodé — 0 tant qu'il ne l'est pas. Ne sert
   * qu'au repli hors ligne du concert : avec un serveur, c'est lui qui donne
   * la durée, et il la connaît avant même que le fichier soit chargé ici.
   */
  concertLength() {
    if (!this._concertLen) this._fxBuf("concert_song").then((b) => {
      if (!b) return;
      this._concertLen = b.duration;
      if (!this._concertEnv) this._buildEnvelope(b);   // prêt avant le lever de rideau
    });
    return this._concertLen || 0;
  }

  /**
   * Distance joueur -> scène, appelée chaque frame : le concert SORT DE LA
   * SCÈNE. Comme l'ambiance, il décroît avec la distance et s'éteint au-delà
   * de sa portée — on doit pouvoir le situer à l'oreille depuis n'importe où
   * dans la salle. Le lissage évite l'escalier de gain quand on marche.
   */
  setConcertDistance(d) {
    if (!this.ready || !this._concertGain || !this._concertOn || !this._concertSrc) return;
    const RANGE = 30;                // plus loin que l'ambiance : c'est un spectacle
    const target = Math.max(0, 1 - d / RANGE) ** 1.4;
    const cur = this._concertSpace ?? target;
    this._concertSpace = cur + (target - cur) * 0.08;
    this._concertGain.gain.value = 0.6 * this._concertSpace;
  }

  // ---------- sons d'action (échantillons uniquement) ----------

  /** impact de jeton — vol dépend de l'énergie de la collision */
  chip(power = 1, dv = 1) {
    if (dv <= 0.02) return;
    const v = Math.min(1, power) * dv;
    this.fx("chip_clink", { vol: 0.16 * v, rate: rnd(0.88, 1.18) });
  }
  /** jeton posé à plat sur le feutre */
  chipPlace(v = 1) {
    if (v <= 0.02) return;
    this.fx("chip_stack", { vol: 0.16 * Math.min(1, v), rate: rnd(0.92, 1.1) });
  }
  /** pile de jetons manipulée */
  chipRiffle() {
    this.fx("chip_riffle", { vol: 0.18, rate: rnd(0.95, 1.1) });
  }
  /**
   * Donne d'une carte — MISE EN FILE, jamais superposée.
   *
   * Le serveur envoie la donne initiale d'un bloc : sans file, huit cartes
   * déclenchaient huit fois l'échantillon dans la même poignée de
   * millisecondes, et au lieu d'un « tac… tac… tac » de croupier on entendait
   * une bouillie. On garde donc la date du dernier son et on repousse le
   * suivant d'au moins CARD_GAP — les cartes se distribuent à l'oreille comme
   * elles se distribuent à la main, l'une après l'autre.
   *
   * Au-delà de CARD_MAX_LAG de retard on laisse tomber la carte : mieux vaut
   * un son manquant qu'un cliquetis qui continue longtemps après la donne.
   */
  card(dv = 1) {
    if (!this.ready || dv <= 0.02) return;
    const CARD_GAP = 0.11, CARD_MAX_LAG = 0.5;
    const now = this.ctx.currentTime;
    const at = Math.max(now, this._cardAt || 0);
    if (at - now > CARD_MAX_LAG) return;
    this._cardAt = at + CARD_GAP;
    this.fx("card_deal", { vol: 0.20 * dv, rate: rnd(0.94, 1.12), at });
  }
  cardFlip(dv = 1) {
    if (dv <= 0.02) return;
    this.fx("card_flip", { vol: 0.20 * dv, rate: rnd(0.95, 1.1) });
  }
  /** Cartes ramassées en fin de coup — même échantillon, plus mat. */
  cardTap(dv = 1) {
    if (dv <= 0.02) return;
    this.fx("card_deal", { vol: 0.13 * dv, rate: rnd(0.82, 0.94) });
  }
  shuffle(dv = 1) {
    if (dv <= 0.02) return;
    this.fx("card_shuffle", { vol: 0.18 * dv, rate: rnd(0.96, 1.06) });
  }
  /** Gain générique (blackjack) — la cascade de jetons, pas un jingle d'arcade. */
  win(big = false) {
    if (big) this.fx("chip_cascade", { vol: 0.28, when: 0.65 });
  }

  // ---------- machines à sous (assets générés par tools/gen-sfx.mjs) ----------
  //
  // Toutes ces méthodes prennent un facteur `v` (0..1) fourni par la machine :
  // c'est SA distance au joueur, et 0 pour les machines en démo. Sans ça, les
  // sept machines d'ambiance faisaient claquer leurs crans à pleine puissance
  // dans toute la salle — un cliquetis permanent, audible partout.

  /** Levier tiré : ressort qui se tend, puis le clac de verrouillage. */
  lever(v = 1) {
    this.fx("slot_lever", { vol: 0.30 * v, rate: rnd(0.97, 1.05) });
  }

  /**
   * Rouleaux en rotation : boucle continue, montée et descente en fondu — un
   * démarrage sec ferait un « pop », et une coupure nette trancherait le
   * ronronnement en plein milieu.
   */
  reelLoop(on, v = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    if (on) {
      if (this._reel || v <= 0.02) return;
      const slot = this._reel = {};                 // réservé tout de suite : le
      this._fxBuf("slot_reel_loop").then((buf) => { // décodage est asynchrone et
        if (!buf || this._reel !== slot) return;    // l'arrêt peut le devancer
        const s = ctx.createBufferSource();
        s.buffer = buf; s.loop = true;
        const g = ctx.createGain(); g.gain.value = 0.0001;
        s.connect(g); g.connect(this.busFx);
        s.start();
        const t = ctx.currentTime;
        g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.12);
        slot.s = s; slot.g = g;
      });
    } else if (this._reel) {
      const r = this._reel; this._reel = null;
      if (!r.g) return;                             // arrêté avant même d'avoir démarré
      const t = ctx.currentTime;
      r.g.gain.cancelScheduledValues(t);
      r.g.gain.setValueAtTime(Math.max(0.0001, r.g.gain.value), t);
      r.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      setTimeout(() => { try { r.s.stop(); } catch { } }, 300);
    }
  }

  /** Un rouleau qui s'encliquette. Trois par tour : hauteur variée, sinon on
   *  entend trois fois exactement le même clac. */
  reelStop(v = 1) {
    // l'échantillon culmine à ~64% de la pleine échelle là où les autres
    // touchent 0 dBFS : on compense au gain, sinon le cran passe inaperçu
    this.fx("slot_reel_stop", { vol: 0.30 * v, rate: rnd(0.9, 1.12) });
  }

  /** Gain machine à sous : jingle d'arcade, fanfare + pluie de pièces si gros. */
  slotWin(big = false, v = 1) {
    this.fx(big ? "slot_jackpot" : "slot_win", { vol: (big ? 0.34 : 0.26) * v });
  }

  /**
   * Une carte perdue qui se consume (Card.burn). Une main brûle carte par
   * carte à 130 ms d'écart : les échantillons se recouvrent volontairement,
   * c'est ce chevauchement qui fait le lit de braises. La hauteur varie pour
   * que deux cartes voisines ne crépitent pas à l'identique.
   */
  burn(v = 1) {
    if (v <= 0.02) return;
    // fichier généré à 54% de la pleine échelle : gain rattrapé en conséquence
    this.fx("card_burn", { vol: 0.34 * v, rate: rnd(0.9, 1.12) });
  }

  slotLose(v = 1) {
    // fichier généré très bas (pic à 24% de la pleine échelle, contre ~100%
    // pour les autres) : sans ce rattrapage de gain, on ne l'entend pas
    this.fx("slot_lose", { vol: 0.42 * v });
  }

  /**
   * Aucun échantillon pour ces sons : ils étaient tous synthétisés (oscillateurs
   * ou bruit filtré) et sont donc muets. Déposer le mp3 du même nom dans
   * assets/sfx/ et rebrancher l'appel `fx()` suffira à les faire revenir.
   */
  /**
   * UN PAS. `player.js` l'appelle une fois par demi-cycle de `stepPhase` —
   * environ toutes les 480 ms en marche, 300 ms en course.
   *
   * Deux surfaces : la salle est moquettée, sauf le disque de marbre autour de
   * la fontaine. Plusieurs variantes par surface et un tirage qui interdit de
   * rejouer la même deux fois de suite : sans ça, une cadence aussi régulière
   * transforme n'importe quel échantillon en machine à coudre.
   *
   * Les gains par variante compensent les niveaux de génération, très inégaux
   * d'un fichier à l'autre (mesurés au RMS de la fenêtre de 50 ms la plus
   * forte : 26 / 9 / 30 % pour la moquette, 2,5 % pour les marbres) — sans ce
   * rattrapage on entendrait boiter. Cible ~15 % moquette, ~9 % marbre.
   */
  step(run = false, surface = "carpet") {
    if (!this.ready) return;
    const BANK = {
      carpet: [["step_carpet_1", 0.6], ["step_carpet_2", 1.6], ["step_carpet_3", 0.5]],
      marble: [["step_marble_1", 3.5], ["step_marble_2", 3.5]],
    };
    const bank = BANK[surface] || BANK.carpet;
    let i = Math.floor(Math.random() * bank.length);
    if (bank.length > 1 && bank[i][0] === this._lastStepName) i = (i + 1) % bank.length;
    const [name, g] = bank[i];
    this._lastStepName = name;
    // le marbre porte : on le joue plus bas que la moquette, pas plus fort.
    // Niveaux volontairement BAS : un pas se devine, il ne s'écoute pas.
    const base = (run ? 0.19 : 0.11) * (surface === "marble" ? 0.8 : 1);
    this.fx(name, { vol: base * g, rate: rnd(0.88, 1.14) });
  }
  glass() { }
  pour() { }
  sip() { }
  lose() { }
  ui() { }
  fire() { }
  heatUp() { }
  extinguish() { }
  tick() { }
  thud() { }
  coin() { }

  // ---------- la voix du croupier ----------

  /**
   * Répliques générées HORS LIGNE (ElevenLabs, voix française) et servies en
   * statique depuis assets/voice/ — le jeu ne parle à aucune API. Chargement
   * paresseux avec cache, anti-chevauchement global (le croupier ne se coupe
   * pas la parole) et anti-répétition par réplique.
   */
  _loadVoice(name) {
    this._vbank = this._vbank || new Map();
    if (this._vbank.has(name)) return this._vbank.get(name);
    const p = fetch("assets/voice/" + name + ".mp3")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((b) => this.ctx.decodeAudioData(b))
      .catch(() => null);
    this._vbank.set(name, p);
    return p;
  }

  /**
   * Précharge une réplique. Le décodage d'un mp3 coûte 100 à 300 ms la première
   * fois : une annonce demandée pile au lancement du spectacle arriverait en
   * retard, et déborderait sur la scène suivante.
   */
  preloadVoice(name) { if (this.ready) this._loadVoice(name); }

  async say(name, { vol = 0.9, cooldown = 1500, delay = 0, queue = false, waited = 0, maxWait = 4000 } = {}) {
    // Journal de diagnostic : une annonce muette peut l'être pour cinq raisons
    // très différentes, et sans trace on ne peut que deviner. `[voix]` dans la
    // console dit laquelle.
    if (!this.ready) { console.warn("[voix]", name, "— contexte audio non initialisé"); return; }
    if (delay) { setTimeout(() => this.say(name, { vol, cooldown, queue, maxWait }), delay); return; }
    const now = performance.now();
    this._sayAt = this._sayAt || new Map();
    if (now < (this._speakUntil || 0)) {
      // `queue` : la réplique ATTEND la fin de celle en cours au lieu d'être
      // jetée — deux évènements proches (« rien ne va plus » puis un
      // blackjack) doivent donner deux phrases, pas une. Garde-fou : au-delà
      // de `maxWait` d'attente cumulée, l'annonce n'a plus de sens, on la
      // lâche. Les MOMENTS FORTS passent un maxWait plus long : trois
      // répliques empilées au paiement suffisaient à faire expirer les 4 s,
      // et « blackjack » partait à la poubelle une fois marqué comme dit.
      const wait = this._speakUntil - now + 60;
      if (queue && waited + wait <= maxWait) {
        setTimeout(() => this.say(name, { vol, cooldown, queue, waited: waited + wait, maxWait }), wait);
        return;
      }
      console.warn("[voix]", name, "— écrasée : ça parle encore pendant",
        Math.round(this._speakUntil - now), "ms");
      return;
    }
    if (now - (this._sayAt.get(name) ?? -1e9) < cooldown) {
      console.warn("[voix]", name, "— bloquée par son propre délai de répétition");
      return;
    }
    this._sayAt.set(name, now);
    this._speakUntil = now + 500;              // réservation le temps du décodage
    const buf = await this._loadVoice(name);
    if (!buf) {
      console.warn("[voix]", name, "— fichier absent ou indécodable (assets/voice/" + name + ".mp3)");
      this._speakUntil = 0; return;
    }
    console.log("[voix]", name, buf.duration.toFixed(2) + "s",
      "busVoice=" + this.busVoice.gain.value.toFixed(2),
      "master=" + this.master.gain.value.toFixed(2),
      "ctx=" + this.ctx.state);
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g);
    g.connect(this.busVoice);                  // le croupier parle DANS la salle
    s.start();
    this._speakUntil = performance.now() + buf.duration * 1000 + 140;
  }

  // ---------- cinéma ----------

  /** Ralenti : tout le bus passe sous l'eau (passe-bas), et en ressort. */
  slowmo(on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, f = this._slowFilt.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(Math.max(220, f.value), t);
    f.exponentialRampToValueAtTime(on ? 640 : 19000, t + (on ? 0.16 : 0.4));
  }
}
