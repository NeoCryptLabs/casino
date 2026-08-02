/** Contrôleur joueur : déplacement FPS avec collisions, head-bob, pas,
 *  interaction au regard, et bascule vers la vue « Inscryption » assise. */
import { V3, C3, clamp, animVec, animFloat, nearestEuler } from "./util.js";
const B = BABYLON;

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
    cam.applyGravity = true;
    // ellipsoïde centrée sous l'œil : le joueur mesure ~1,75 m (œil à 1,62)
    cam.ellipsoid = new B.Vector3(0.34, 0.81, 0.34);
    cam.ellipsoidOffset = new B.Vector3(0, -0.81, 0);
    cam.rotation.y = Math.PI;            // regarde vers l'intérieur du casino
    cam.keysUp = []; cam.keysDown = []; cam.keysLeft = []; cam.keysRight = [];
    this.camera = cam;
    scene.activeCamera = cam;

    this.keys = new Set();
    this.seated = false;
    this.locked = false;
    this.bob = 0;
    this.stepPhase = 0;
    this.baseY = spawn.y;
    this.lookBase = null;
    this.lookOff = { x: 0, y: 0 };

    addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Space") e.preventDefault();
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => this.keys.clear());

    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked && !this.seated) cam.attachControl(canvas, true);
      else cam.detachControl();
    });

    // en position assise : regard limité, à la souris maintenue (façon Inscryption)
    canvas.addEventListener("pointerdown", () => { if (this.seated) this.dragging = true; });
    addEventListener("pointerup", () => { this.dragging = false; });
    addEventListener("mousemove", (e) => {
      if (!this.seated || !this.dragging || !this.lookBase) return;
      const L = this.limits || { yaw: 0.55, up: 0.32, down: 0.28 };
      this.lookOff.y = clamp(this.lookOff.y + e.movementX * 0.0016, -L.yaw, L.yaw);
      this.lookOff.x = clamp(this.lookOff.x + e.movementY * 0.0016, -L.up, L.down);
      cam.rotation.y = this.lookBase.y + this.lookOff.y;
      cam.rotation.x = this.lookBase.x + this.lookOff.x;
    });
  }

  lock() { this.canvas.requestPointerLock(); }

  get position() { return this.camera.position; }

  update(dt) {
    const cam = this.camera;
    if (this.seated || this.frozen) return;

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
      const b = Math.abs(Math.sin(this.stepPhase)) * (run ? 0.045 : 0.026);
      this.bob += (b - this.bob) * 0.3;
      if (this.stepPhase > (this._lastStep || 0) + Math.PI) {
        this._lastStep = this.stepPhase;
        this.audio.step(run);
      }
      cam.rotation.z += (Math.sin(this.stepPhase * 0.5) * (run ? 0.017 : 0.009) - cam.rotation.z) * 0.2;
    } else {
      this.bob += (0 - this.bob) * 0.12;
      cam.rotation.z += (0 - cam.rotation.z) * 0.12;
      this._lastStep = this.stepPhase;
    }

    // La résolution de collision de l'ellipsoïde repousse la caméra vers le
    // haut à chaque frame sans jamais la redescendre : mesuré, l'œil dérivait
    // de 1,62 m à 1,68 m en trois secondes de marche, et continuait de monter.
    // On le ramène doucement à sa hauteur nominale — un rappel progressif
    // plutôt qu'un verrouillage, pour rester tolérant à une dénivellation.
    cam.position.y += (this.baseY - cam.position.y) * Math.min(1, dt * 7);

    this._bobApplied = this.bob;
    cam.position.y += this._bobApplied;
    cam.fov = 1.05 + Math.abs(this.bob) * 0.35;
  }

  /** Installe la caméra à une place assise, orientée vers `lookTarget`. */
  sitView(eyePos, lookTarget, fov = 1.05, onDone, limits) {
    this.seated = true;
    this.keys.clear();
    document.body.classList.add("seated");
    this.camera.detachControl();
    this.camera.applyGravity = false;
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
   */
  sit(seatWorld, tableCenter, onDone) {
    const dir = tableCenter.subtract(seatWorld); dir.y = 0; dir.normalize();
    const pos = seatWorld.add(dir.scale(0.52)); pos.y = 1.38;
    const look = seatWorld.add(dir.scale(1.52)); look.y = 0.95;
    this.sitView(pos, look, 0.92, onDone, { yaw: 0.4, up: 0.24, down: 0.22 });
  }

  /** Relève le joueur. */
  stand(onDone) {
    document.body.classList.remove("seated");
    const back = this._savedPos || this.camera.position.clone();
    this._savedPos = null;
    const target = this._savedRot || this.camera.rotation.clone();
    this.camera.rotation = nearestEuler(this.camera.rotation, target);

    animVec(this.scene, this.camera, "position", this.camera.position, back, 34);
    animVec(this.scene, this.camera, "rotation", this.camera.rotation,
      target, 34, undefined, () => {
        this.seated = false;
        this.lookBase = null;
        this.camera.applyGravity = true;
        this.camera.checkCollisions = true;
        if (this.locked) this.camera.attachControl(this.canvas, true);
        if (onDone) onDone();
      });
    animFloat(this.scene, this.camera, "fov", this.camera.fov, 1.05, 34);
  }

  /** Renvoie l'objet interactif visé, ou null. */
  pick(maxDist = 3.2) {
    const ray = this.camera.getForwardRay(maxDist);
    const hit = this.scene.pickWithRay(ray, (m) => !!(m.metadata && m.metadata.interact) && m.isEnabled());
    if (hit && hit.hit && hit.distance <= maxDist) return hit.pickedMesh.metadata;
    return null;
  }
}
