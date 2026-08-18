/** Contrôleur joueur : déplacement FPS avec collisions, head-bob, pas,
 *  interaction au regard, et bascule vers la vue « Inscryption » assise. */
import { V3, C3, clamp, animVec, animFloat, nearestEuler } from "./util.js";
import { LAYOUT } from "./world.js";
const B = BABYLON;

/** La frappe est-elle en train d'écrire dans un champ (le salon) ? */
const isTyping = (e) => {
  const t = e.target;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
};

export class Player {
  constructor(scene, canvas, audio, spawn) {
    this.scene = scene; this.canvas = canvas; this.audio = audio;

    const cam = new B.UniversalCamera("cam", spawn.clone(), scene);
    cam.minZ = 0.03; cam.maxZ = 120;
    cam.fov = 1.05;
    cam.speed = 0;                       // on gère le déplacement à la main
    cam.inertia = 0;
    cam.angularSensibility = 1400;
    cam.checkCollisions = true;
    // PAS de gravité caméra : le rappel au sol (rayon, voir update) gère déjà
    // l'axe Y dans les deux sens. La passe de gravité de Babylon replaquait
    // l'ellipsoïde au sol CHAQUE frame en avalant le head-bob ; la frame
    // suivante retranchait un bob devenu inexistant et l'ellipsoïde repartait
    // ENCASTRÉE dans le plancher — d'où les blocages aléatoires sur les arêtes
    // internes des triangles du sol, sans aucun solide à proximité.
    cam.applyGravity = false;
    // Ellipsoïde centrée sous l'œil : le joueur mesure ~1,75 m (œil à 1,62).
    // Rayon 0,26 (épaules humaines) : à 0,34 on butait 30 cm avant CHAQUE
    // obstacle — le fameux « mur invisible » ressenti partout.
    cam.ellipsoid = new B.Vector3(0.26, 0.81, 0.26);
    cam.ellipsoidOffset = new B.Vector3(0, -0.81, 0);
    cam.rotation.y = Math.PI;            // regarde vers l'intérieur du casino
    cam.keysUp = []; cam.keysDown = []; cam.keysLeft = []; cam.keysRight = [];
    this.camera = cam;
    scene.activeCamera = cam;

    // Mouchard de collision : à chaque contact, Babylon fournit le mesh
    // touché — c'est l'outil qui NOMME les murs fantômes (affiché en dev).
    cam.onCollide = (mesh) => {
      if (!mesh) return;
      const now = performance.now();
      this._colLog = this._colLog || new Map();
      if (now - (this._colLog.get(mesh.name) || 0) < 900) return;
      this._colLog.set(mesh.name, now);
      this.onCollideDebug?.(mesh);
    };

    this.keys = new Set();
    this.seated = false;
    this.locked = false;
    // Réglages du menu (src/settings.js les pilote) : focale de marche,
    // amplitude du balancement, inversion de l'axe vertical.
    this.baseFov = 1.05;
    this.bobScale = 1;
    this.invertY = false;
    this.editing = false;   // mode éditeur : la caméra reste attachée sans pointer lock
    this.bob = 0;
    this.stepPhase = 0;
    this.baseY = spawn.y;      // hauteur d'œil AU-DESSUS DU SUPPORT (1,62 m)
    this.lookBase = null;
    this.lookOff = { x: 0, y: 0 };

    addEventListener("keydown", (e) => {
      // Une frappe destinée à un champ de texte (le salon) ne pilote pas le
      // corps : sans ce barrage, écrire « oui d'accord » faisait avancer,
      // reculer et sauter le joueur pendant qu'il tapait.
      if (isTyping(e)) return;
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    // `keyup` n'est PAS filtré, volontairement : une touche enfoncée avant
    // l'ouverture du salon doit pouvoir se relâcher, sinon elle reste collée.
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());

    document.addEventListener("pointerlockchange", () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (!this.editing) {
        if (this.locked && !this.seated) cam.attachControl(canvas, true);
        else cam.detachControl();
      }
      // Le joueur a repris sa souris SANS qu'on le lui demande : c'est son
      // Échap (le navigateur mange la touche, on ne verra jamais le keydown).
      // Ce signal-là, et lui seul, ouvre le menu pause.
      if (was && !this.locked) {
        const wanted = this._wantedUnlock;
        this._wantedUnlock = false;
        this.onUnlock?.(wanted);
      }
    });

    // En position assise : regard « parallaxe » — la caméra suit doucement la
    // POSITION de la souris à l'écran, dans les débattements de la place. Pas
    // besoin de cliquer-glisser : on regarde autour naturellement. Le suivi
    // lui-même est amorti dans update(), ici on ne fait que mémoriser.
    addEventListener("mousemove", (e) => {
      this._mouse = { x: e.clientX, y: e.clientY };
      // AXE VERTICAL INVERSÉ. Babylon ne sait inverser que les DEUX axes à la
      // fois (camera.invertRotation) : on retranche donc deux fois l'apport
      // vertical de la souris — le cumul net est exactement son opposé.
      if (this.invertY && this.locked && !this.seated && !this.frozen) {
        cam.cameraRotation.x -= (2 * (e.movementY || 0)) / cam.angularSensibility;
      }
    });
  }

  /** Verrouille la souris. Chrome refuse un verrouillage demandé trop tôt
   *  après un Échap : on retente une fois, sans bruit. */
  lock() {
    clearTimeout(this._relock);
    this._relock = null;
    // ASSIS, ON NE VERROUILLE JAMAIS. À une table, à une machine ou au bar, la
    // souris appartient au HUD : la confisquer rend tous ses boutons muets.
    if (this.seated) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) {
        p.catch(() => {
          this._relock = setTimeout(() => {
            this._relock = null;
            if (this.seated) return;
            try { this.canvas.requestPointerLock()?.catch?.(() => { }); } catch { }
          }, 500);
        });
      }
    } catch { /* pointer lock indisponible : le jeu reste jouable à la souris */ }
  }

  /** Déverrouillage VOULU par le jeu (s'asseoir, ouvrir un panneau) : il ne
   *  doit surtout pas être pris pour l'Échap du joueur. */
  unlock() {
    this._wantedUnlock = true;
    // ON ANNULE LE RATTRAPAGE EN ATTENTE. `lock()` arme une reprise à 500 ms
    // quand le navigateur refuse le verrouillage (Chrome et Safari le
    // refusent pendant un court délai après un Échap). Sans cette annulation,
    // la reprise se déclenchait APRÈS coup et reprenait la souris à l'instant
    // même où le jeu venait de la rendre : le joueur s'asseyait à une table,
    // la souris repartait en capture sans que rien ne l'indique, et plus un
    // seul bouton du HUD ne répondait — 21+3, Retirer, Répéter — alors que le
    // clavier, lui, continuait de marcher.
    clearTimeout(this._relock);
    this._relock = null;
    document.exitPointerLock();
  }

  /** Focale de marche (réglage « champ de vision »). Les vues assises gardent
   *  leur cadrage de plateau : on ne touche qu'à la caméra debout. */
  setBaseFov(f) {
    this.baseFov = f;
    if (!this.seated) this.camera.fov = f;
  }

  get position() { return this.camera.position; }

  update(dt) {
    const cam = this.camera;
    // FILET DE SÉCURITÉ : assis, la souris appartient au HUD. Si elle se
    // retrouve capturée malgré tout — reprise de verrouillage échappée, clic
    // sur le canvas, verrouillage rendu par le navigateur après coup — on la
    // rend immédiatement. Sans ce garde-fou, la panne est MUETTE : aucun
    // bouton ne répond, aucune erreur en console, et le clavier continue de
    // marcher, ce qui égare complètement le diagnostic.
    if (this.seated && document.pointerLockElement) this.unlock();
    if (this.seated) {
      // Regard libre autour de la table, MAJ ENFONCÉE seulement : la souris à
      // gauche de l'écran tourne la tête à gauche, etc. — amorti, borné par
      // les limites de la place. Sans Maj, la caméra revient au centre : la
      // souris sert alors aux boutons de jeu sans faire dériver la vue.
      // Actif seulement une fois l'animation d'assise finie (lookBase posé),
      // sinon on écraserait l'interpolation en cours.
      if (this.lookBase && this._mouse) {
        const L = this.limits || { yaw: 0.55, up: 0.32, down: 0.28 };
        const peek = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
        const nx = peek ? clamp((this._mouse.x / innerWidth) * 2 - 1, -1, 1) : 0;
        const ny = peek ? clamp((this._mouse.y / innerHeight) * 2 - 1, -1, 1) : 0;
        const ty = this.lookBase.y + nx * L.yaw;
        const tx = this.lookBase.x + (ny > 0 ? ny * L.down : ny * L.up);
        const k = Math.min(1, dt * 6.5);
        cam.rotation.y += (ty - cam.rotation.y) * k;
        cam.rotation.x += (tx - cam.rotation.x) * k;
      }
      return;
    }
    if (this.frozen) return;

    // on retire le head-bob de la frame précédente avant de bouger
    cam.position.y -= this._bobApplied || 0;
    this._bobApplied = 0;

    const k = this.keys;
    const run = k.has("ShiftLeft") || k.has("ShiftRight");
    const speed = (run ? 4.5 : 2.3) * dt;
    let f = 0, s = 0;
    if (k.has("KeyW") || k.has("KeyZ") || k.has("ArrowUp")) f += 1;
    if (k.has("KeyS") || k.has("ArrowDown")) f -= 1;
    if (k.has("KeyA") || k.has("KeyQ") || k.has("ArrowLeft")) s -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) s += 1;

    // Détecteur de blocage : intention de mouvement sans déplacement réel
    // pendant 0,5 s -> on prévient (main.js nomme alors les solides voisins).
    if (f || s) {
      const lp = this._lastPos;
      if (lp) {
        const moved = Math.hypot(cam.position.x - lp.x, cam.position.z - lp.z);
        // 0,15 n'attrapait que l'immobilité TOTALE : glisser le long d'un mur
        // ou n'avancer qu'au quart passait sous le radar, alors que c'est
        // exactement ce qu'on ressent comme « je bloque ». Seuil remonté.
        if (moved < speed * 0.35) {
          this._stuckT = (this._stuckT || 0) + dt;
          if (this._stuckT > 0.5) { this._stuckT = -2.0; this.onStuck?.(); }
        } else if (this._stuckT > 0) this._stuckT = 0;
      }
    } else this._stuckT = 0;
    this._lastPos = { x: cam.position.x, z: cam.position.z };

    if (f || s) {
      const n = Math.hypot(f, s);
      f /= n; s /= n;
      const fwd = cam.getDirection(B.Axis.Z);
      const right = cam.getDirection(B.Axis.X);
      fwd.y = 0; right.y = 0;
      fwd.normalize(); right.normalize();
      // Babylon applique les collisions sur cameraDirection
      cam.cameraDirection.addInPlace(fwd.scale(f * speed).add(right.scale(s * speed)));

      this.stepPhase += dt * (run ? 10.5 : 6.6);
      const b = Math.abs(Math.sin(this.stepPhase)) * (run ? 0.045 : 0.026) * this.bobScale;
      this.bob += (b - this.bob) * 0.3;
      if (this.stepPhase > (this._lastStep || 0) + Math.PI) {
        this._lastStep = this.stepPhase;
        // Surface sous les pieds. Le disque de marbre (world.js, `plaza`,
        // rayon 8,4 m autour de la fontaine) n'a pas de collision, donc le
        // rayon-sol ne peut pas le désigner : on tranche à la distance, ce qui
        // évite en prime de toucher au rayon-sol et à ses réglages délicats.
        const dF = Math.hypot(cam.position.x - LAYOUT.fountain.x,
          cam.position.z - LAYOUT.fountain.z);
        this.audio.step(run, dF < 8.4 ? "marble" : "carpet");
      }
      cam.rotation.z += (Math.sin(this.stepPhase * 0.5) * (run ? 0.017 : 0.009) - cam.rotation.z) * 0.2;
    } else {
      this.bob += (0 - this.bob) * 0.12;
      cam.rotation.z += (0 - cam.rotation.z) * 0.12;
      this._lastStep = this.stepPhase;
    }

    // La résolution de collision fait dériver l'œil vers le haut (mesuré :
    // 1,62 -> 1,68 m en 3 s de marche). L'ancien rappel visait une CONSTANTE
    // (1,62), ce qui tirait le joueur DANS les marches et l'estrade dès qu'il
    // montait dessus — coincé sur place, apparemment « dans le vide ». La
    // référence suit désormais le SOL RÉEL sous les pieds (rayon vers le bas
    // sur les seuls solides) : anti-dérive conservé, escalade réparée.
    this._downRay = this._downRay || new B.Ray(cam.position, new B.Vector3(0, -1, 0), 4);
    this._downRay.origin.copyFrom(cam.position);
    const ghit = this.scene.pickWithRay(this._downRay,
      (m) => m.checkCollisions && m.isEnabled());
    const groundY = ghit?.hit ? ghit.pickedPoint.y : 0;
    // 2 cm de garde : le bas de l'ellipsoïde ne doit JAMAIS raser le plan du
    // sol pendant un déplacement — tangent, le solveur de Babylon considère le
    // sol « pénétré » et ses tests d'arêtes annulent le mouvement horizontal.
    const CLEAR = 0.02;
    const restY = groundY + this.baseY + CLEAR;
    cam.position.y += (restY - cam.position.y) * Math.min(1, dt * 7);
    // Petit déficit (apparition, relevé de chaise : l'œil repart à 1,62 pile,
    // 2 cm sous la garde) : on rejoint la hauteur de repos D'UN COUP au lieu
    // de traverser ~0,3 s de contact tangent avec le sol. Les marches et
    // l'estrade (déficit large) gardent leur montée amortie.
    if (cam.position.y < restY && restY - cam.position.y < 0.06) cam.position.y = restY;

    this._bobApplied = this.bob;
    cam.position.y += this._bobApplied;
    cam.fov = this.baseFov + Math.abs(this.bob) * 0.35;
  }

  /** Installe la caméra à une place assise, orientée vers `lookTarget`. */
  sitView(eyePos, lookTarget, fov = 1.05, onDone, limits) {
    this.seated = true;
    this.keys.clear();
    document.body.classList.add("seated");
    this.camera.detachControl();
    this.camera.checkCollisions = false;
    if (!this._savedPos) {
      this._savedPos = this.camera.position.clone();
      this._savedRot = this.camera.rotation.clone();
    }
    this.limits = limits || { yaw: 0.55, up: 0.32, down: 0.28 };

    const d = lookTarget.subtract(eyePos);
    const yaw = Math.atan2(d.x, d.z);
    const pitch = Math.atan2(-d.y, Math.hypot(d.x, d.z));

    // Le lacet de la caméra s'accumule sans borne (souris), alors que `yaw`
    // sort d'un atan2 dans [-π, π] : sans recalage, l'interpolation part du
    // mauvais côté et le joueur fait un tour complet en s'asseyant.
    const target = V3(pitch, yaw, 0);
    this.camera.rotation = nearestEuler(this.camera.rotation, target);

    animVec(this.scene, this.camera, "position", this.camera.position, eyePos, 42);
    animVec(this.scene, this.camera, "rotation",
      this.camera.rotation, target, 42, undefined, () => {
        this.lookBase = { x: pitch, y: yaw };
        this.lookOff = { x: 0, y: 0 };
        if (onDone) onDone();
      });
    animFloat(this.scene, this.camera, "fov", this.camera.fov, fov, 42);
  }

  /**
   * Place assise au blackjack — cadrage « Inscryption » : la caméra se penche
   * au-dessus du tapis, juste derrière sa propre main. Les cartes du joueur
   * occupent le bas de l'image, celles du croupier le haut.
   *
   * Le cadrage est PARAMÉTRÉ (et non plus codé en dur) : `params` vient du
   * plan (layout.camera.table), réglable en direct à table avec P.
   *  - fwd      avancée de l'œil vers la table depuis la chaise (m)
   *  - eyeY     hauteur de l'œil (m)
   *  - lookFwd  distance du point visé (m)  - lookY  sa hauteur (m)
   *  - fov      focale (rad)
   */
  static SIT_DEFAULTS = { fwd: 0.52, eyeY: 1.38, lookFwd: 1.52, lookY: 0.95, fov: 0.92 };

  _sitFrame(seatWorld, tableCenter, params) {
    const P = { ...Player.SIT_DEFAULTS, ...(params || {}) };
    const dir = tableCenter.subtract(seatWorld); dir.y = 0; dir.normalize();
    const pos = seatWorld.add(dir.scale(P.fwd)); pos.y = P.eyeY;
    const look = seatWorld.add(dir.scale(P.lookFwd)); look.y = P.lookY;
    return { pos, look, fov: P.fov };
  }

  sit(seatWorld, tableCenter, onDone, params) {
    const f = this._sitFrame(seatWorld, tableCenter, params);
    this.sitView(f.pos, f.look, f.fov, onDone, { yaw: 0.4, up: 0.24, down: 0.22 });
  }

  /** Ré-applique la vue assise SANS animation — pour le réglage en direct. */
  retune(seatWorld, tableCenter, params) {
    if (!this.seated) return;
    const f = this._sitFrame(seatWorld, tableCenter, params);
    const d = f.look.subtract(f.pos);
    const yaw = Math.atan2(d.x, d.z);
    const pitch = Math.atan2(-d.y, Math.hypot(d.x, d.z));
    this.camera.position.copyFrom(f.pos);
    this.camera.rotation.x = pitch;
    this.camera.rotation.y = yaw;
    this.camera.rotation.z = 0;
    this.camera.fov = f.fov;
    this.lookBase = { x: pitch, y: yaw };
    this.lookOff = { x: 0, y: 0 };
  }

  /**
   * Relève le joueur. `at` impose le point d'arrivée (ex. : derrière la chaise
   * de blackjack) — sans lui on revient à la position d'approche, qui coince
   * parfois le joueur entre la chaise et la table.
   */
  stand(onDone, at = null) {
    document.body.classList.remove("seated");
    const back = at || this._savedPos || this.camera.position.clone();
    this._savedPos = null;
    const target = this._savedRot || this.camera.rotation.clone();
    this.camera.rotation = nearestEuler(this.camera.rotation, target);

    animVec(this.scene, this.camera, "position", this.camera.position, back, 34);
    animVec(this.scene, this.camera, "rotation", this.camera.rotation,
      target, 34, undefined, () => {
        this.seated = false;
        this.lookBase = null;
        this.camera.checkCollisions = true;
        if (this.locked) this.camera.attachControl(this.canvas, true);
        if (onDone) onDone();
      });
    animFloat(this.scene, this.camera, "fov", this.camera.fov, this.baseFov, 34);
  }

  /** Renvoie l'objet interactif visé, ou null. */
  pick(maxDist = 3.2) {
    const ray = this.camera.getForwardRay(maxDist);
    const hit = this.scene.pickWithRay(ray, (m) => !!(m.metadata && m.metadata.interact) && m.isEnabled());
    if (hit && hit.hit && hit.distance <= maxDist) return hit.pickedMesh.metadata;
    return null;
  }
}
