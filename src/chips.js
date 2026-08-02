/** Jetons : rendu PBR + physique Havok (empilement, lancer, collisions sonores). */
import { V3, C3, pbr, canvasTex, rnd, animVec } from "./util.js";
const B = BABYLON;

export const CHIP_R = 0.021;   // rayon 21 mm
export const CHIP_H = 0.0042;  // épaisseur 4.2 mm

export const CHIP_TYPES = [
  { v: 5, face: "#f2f0ea", edge: "#c0392b", txt: "#8e1f16" },
  { v: 25, face: "#1f7a4d", edge: "#0e4b2e", txt: "#eafff2" },
  { v: 100, face: "#17171d", edge: "#3a3a44", txt: "#f0e4c0" },
  { v: 500, face: "#5b34a3", edge: "#2d1a54", txt: "#f3e9ff" },
  { v: 1000, face: "#b8912f", edge: "#7a5c14", txt: "#fffbe8" },
];

export function chipTypeFor(v) {
  return CHIP_TYPES.find((c) => c.v === v) || CHIP_TYPES[0];
}

/** Décompose un montant en jetons (du plus gros au plus petit). */
export function breakdown(amount) {
  const out = [];
  for (const t of [...CHIP_TYPES].reverse()) {
    while (amount >= t.v && out.length < 40) { out.push(t.v); amount -= t.v; }
  }
  return out;
}

function chipTexture(scene, t) {
  return canvasTex("chip" + t.v, scene, 1024, 512, (c, w, h) => {
    // ---- moitié gauche : la face (512x512) ----
    const S = 512, cx = S / 2, cy = S / 2;
    c.fillStyle = t.edge; c.fillRect(0, 0, S, S);
    c.save(); c.beginPath(); c.arc(cx, cy, 252, 0, 7); c.clip();
    c.fillStyle = t.edge; c.fillRect(0, 0, S, S);
    // secteurs blancs
    for (let i = 0; i < 8; i++) {
      c.beginPath(); c.moveTo(cx, cy);
      const a0 = (i / 8) * Math.PI * 2, a1 = a0 + Math.PI / 16;
      c.arc(cx, cy, 252, a0, a1); c.closePath();
      c.fillStyle = "rgba(245,245,240,.92)"; c.fill();
    }
    // disque central
    c.beginPath(); c.arc(cx, cy, 185, 0, 7); c.fillStyle = t.face; c.fill();
    c.lineWidth = 7; c.strokeStyle = "rgba(0,0,0,.32)"; c.stroke();
    // guilloché
    for (let r = 96; r < 180; r += 8) {
      c.beginPath(); c.arc(cx, cy, r, 0, 7);
      c.strokeStyle = "rgba(0,0,0,.07)"; c.lineWidth = 2; c.stroke();
    }
    // valeur
    c.fillStyle = t.txt;
    c.font = "700 " + (t.v >= 1000 ? 108 : 132) + "px 'Futura','Avenir Next',sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(String(t.v), cx, cy - 6);
    c.font = "600 34px 'Futura',sans-serif";
    c.fillText("LE MIRAGE", cx, cy + 96);
    c.restore();
    // ombre de bord
    const g = c.createRadialGradient(cx, cy, 200, cx, cy, 256);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.55)");
    c.fillStyle = g; c.fillRect(0, 0, S, S);

    // ---- moitié droite : la tranche ----
    c.fillStyle = t.edge; c.fillRect(S, 0, S, h);
    for (let i = 0; i < 24; i++) {
      c.fillStyle = i % 2 ? "rgba(245,245,240,.85)" : "rgba(0,0,0,.16)";
      c.fillRect(S + i * (S / 24), 0, S / 48, h);
    }
    const g2 = c.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, "rgba(0,0,0,.45)"); g2.addColorStop(0.5, "rgba(255,255,255,.12)");
    g2.addColorStop(1, "rgba(0,0,0,.45)");
    c.fillStyle = g2; c.fillRect(S, 0, S, h);
  });
}

export class Chips {
  constructor(scene, audio, world) {
    this.scene = scene;
    this.audio = audio;
    this.world = world;
    this.pool = [];          // tous les jetons physiques vivants
    this.max = 170;
    this.templates = new Map();
    for (const t of CHIP_TYPES) {
      const mat = pbr("chipM" + t.v, scene, { color: C3(1, 1, 1), roughness: 0.52, metallic: 0.02 });
      mat.baseTexture = chipTexture(scene, t);
      this.templates.set(t.v, mat);
    }
    // Ordre imposé par Babylon : [0] = capuchon du BAS, [1] = tranche,
    // [2] = capuchon du HAUT. Sur le capuchon, u croît avec +X, or +X est à
    // GAUCHE de l'écran : c'est la face du DESSUS — la seule qu'on voie sur le
    // tapis — qui doit prendre le u inversé, sinon la valeur se lit en miroir.
    this._faceUV = [
      new B.Vector4(0, 0, 0.5, 1),   // dessous (vu d'en bas : u direct)
      new B.Vector4(0.5, 0, 1, 1),   // tranche
      new B.Vector4(0.5, 0, 0, 1),   // dessus (u inversé)
    ];
  }

  /**
   * Un jeton fait 4 mm d'épaisseur : trop fin pour qu'un solveur garde une pile
   * stable (les corps s'interpénètrent et la pile s'écrase). On simule donc
   * réellement le vol (dynamique) puis on fige le jeton à sa place exacte
   * (cinématique) — la pile reste nette et se dépile jeton par jeton.
   */
  setKinematic(chip) {
    const b = chip.metadata.agg.body;
    b.setLinearVelocity(V3(0, 0, 0));
    b.setAngularVelocity(V3(0, 0, 0));
    b.setMotionType(B.PhysicsMotionType.ANIMATED);
    b.disablePreStep = false;
    if (chip.rotationQuaternion) {
      chip.rotation = chip.rotationQuaternion.toEulerAngles();
      chip.rotationQuaternion = null;
    }
  }
  setDynamic(chip) {
    const b = chip.metadata.agg.body;
    b.disablePreStep = true;
    b.setMotionType(B.PhysicsMotionType.DYNAMIC);
  }

  /** Pose le jeton à plat exactement sur `target` (fin de course d'une mise). */
  rest(chip, target) {
    if (!chip || chip.isDisposed()) return;
    this.setKinematic(chip);
    animVec(this.scene, chip, "position", chip.position, target, 9);
    animVec(this.scene, chip, "rotation", chip.rotation,
      V3(0, chip.rotation.y + rnd(-0.3, 0.3), 0), 9);
  }

  /** Crée un jeton physique. */
  spawn(value, pos, opts = {}) {
    const scene = this.scene;
    const t = chipTypeFor(value);
    const m = B.MeshBuilder.CreateCylinder("chip" + value, {
      height: CHIP_H, diameter: CHIP_R * 2, tessellation: 28,
      faceUV: this._faceUV, cap: B.Mesh.CAP_ALL,
    }, scene);
    m.material = this.templates.get(t.v);
    m.position.copyFrom(pos);
    m.rotation = V3(opts.tilt ? rnd(-0.05, 0.05) : 0, rnd(0, 6.28), opts.tilt ? rnd(-0.05, 0.05) : 0);
    m.receiveShadows = true;
    // seule la lumière de table projette les ombres des jetons (perf)
    if (this.world.shadowGens[0]) this.world.shadowGens[0].addShadowCaster(m);

    const agg = new B.PhysicsAggregate(m, B.PhysicsShapeType.CYLINDER, {
      mass: 0.0105, restitution: 0.12, friction: 0.72,
    }, scene);
    agg.body.setLinearDamping(0.5);
    agg.body.setAngularDamping(0.6);
    agg.body.setCollisionCallbackEnabled(true);

    let last = 0;
    agg.body.getCollisionObservable().add((ev) => {
      const now = performance.now();
      if (now - last < 55) return;
      last = now;
      let p = 0.5;
      const v = agg.body.getLinearVelocity();
      p = Math.min(1, (Math.abs(v.y) + v.length() * 0.4) * 0.55);
      if (p > 0.06) this.audio.chip(p);
    });

    m.metadata = { chip: true, value: t.v, agg };
    this.pool.push(m);
    if (opts.kinematic) this.setKinematic(m);
    this._gc();
    return m;
  }

  _gc() {
    while (this.pool.length > this.max) {
      const old = this.pool.shift();
      if (old && !old.isDisposed()) {
        if (old.metadata?.agg) old.metadata.agg.dispose();
        old.dispose();
      }
    }
  }

  /** Empile n jetons d'une valeur sur une surface (pile au repos, stable). */
  stack(value, count, x, z, surfaceY) {
    const out = [];
    for (let i = 0; i < count; i++) {
      out.push(this.spawn(value, V3(
        x + rnd(-0.0009, 0.0009),
        surfaceY + CHIP_H / 2 + i * CHIP_H,
        z + rnd(-0.0009, 0.0009)), { kinematic: true }));
    }
    return out;
  }

  /**
   * Lance un jeton vers une cible : vol balistique réel, puis pose nette.
   * `target` est la position FINALE du jeton (centre), empilement compris.
   */
  toss(chip, target, opts = {}) {
    this.setDynamic(chip);
    const body = chip.metadata.agg.body;
    const p = chip.getAbsolutePosition();
    const d = target.subtract(p);
    const dist = Math.hypot(d.x, d.z);
    const g = 9.81;
    const h = opts.arc ?? 0.28;                      // hauteur d'arc
    const vy = Math.sqrt(2 * g * h);
    const tflight = (vy + Math.sqrt(Math.max(0.01, vy * vy + 2 * g * (p.y - target.y)))) / g;
    const vx = d.x / tflight, vz = d.z / tflight;
    // l'amortissement linéaire freine le vol : on le compense
    const c = 0.5, comp = (c * tflight) / (1 - Math.exp(-c * tflight));
    body.setLinearVelocity(V3(vx * comp * rnd(0.97, 1.03), vy, vz * comp * rnd(0.97, 1.03)));
    body.setAngularVelocity(V3(rnd(-9, 9), rnd(-26, 26), rnd(-9, 9)));
    this.audio.chip(0.35);
    if (opts.settle !== false) {
      setTimeout(() => this.rest(chip, target), tflight * 1000 + 420);
    }
    return tflight;
  }

  /** Fait glisser une pile entière vers une cible (paiement du croupier). */
  slideStack(chips, target, delay = 60) {
    let n = 0;
    chips.forEach((c, i) =>
      setTimeout(() => {
        if (c.isDisposed()) return;
        const dst = target.add(V3(rnd(-0.006, 0.006), CHIP_H / 2 + (n++) * CHIP_H, rnd(-0.006, 0.006)));
        this.toss(c, dst, { arc: 0.18 });
      }, i * delay)
    );
  }

  /** Détruit une liste de jetons avec une petite animation d'aspiration. */
  sweep(chips, to) {
    chips.forEach((c, i) => {
      if (c.isDisposed()) return;
      const agg = c.metadata.agg;
      setTimeout(() => {
        if (c.isDisposed()) return;
        agg.body.setMotionType(B.PhysicsMotionType.ANIMATED);
        agg.body.disablePreStep = false;
        animVec(this.scene, c, "position", c.position, to, 22,
          B.EasingFunction.EASINGMODE_EASEIN, () => {
            const idx = this.pool.indexOf(c);
            if (idx >= 0) this.pool.splice(idx, 1);
            agg.dispose(); c.dispose();
          });
        this.audio.chip(0.3);
      }, i * 45);
    });
  }
}
