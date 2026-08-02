/** Cartes « organiques » : maillage subdivisé déformable (cambrure, ondulation,
 *  flexion au retournement) + proxy physique Havok pour les lancers du sabot. */
import { V3, C3, pbr, canvasTex, rnd, clamp, animVec, animFloat, nearestEuler } from "./util.js";
const B = BABYLON;

// format « jumbo index » : cartes légèrement surdimensionnées et gros
// indices d'angle, pour rester lisibles depuis la place du joueur
export const CARD_W = 0.077;
export const CARD_L = 0.108;
export const CARD_T = 0.00035;

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = [
  { s: "♠", red: false }, { s: "♥", red: true }, { s: "♦", red: true }, { s: "♣", red: false },
];

/* ------------------------------------------------------------------ atlas */

const PIPS = {
  "A": [[0.5, 0.5]],
  "2": [[0.5, 0.22], [0.5, 0.78]],
  "3": [[0.5, 0.22], [0.5, 0.5], [0.5, 0.78]],
  "4": [[0.3, 0.22], [0.7, 0.22], [0.3, 0.78], [0.7, 0.78]],
  "5": [[0.3, 0.22], [0.7, 0.22], [0.5, 0.5], [0.3, 0.78], [0.7, 0.78]],
  "6": [[0.3, 0.22], [0.7, 0.22], [0.3, 0.5], [0.7, 0.5], [0.3, 0.78], [0.7, 0.78]],
  "7": [[0.3, 0.22], [0.7, 0.22], [0.5, 0.36], [0.3, 0.5], [0.7, 0.5], [0.3, 0.78], [0.7, 0.78]],
  "8": [[0.3, 0.22], [0.7, 0.22], [0.5, 0.36], [0.3, 0.5], [0.7, 0.5], [0.5, 0.64], [0.3, 0.78], [0.7, 0.78]],
  "9": [[0.3, 0.2], [0.7, 0.2], [0.3, 0.4], [0.7, 0.4], [0.5, 0.5], [0.3, 0.6], [0.7, 0.6], [0.3, 0.8], [0.7, 0.8]],
  "10": [[0.3, 0.2], [0.7, 0.2], [0.5, 0.3], [0.3, 0.4], [0.7, 0.4], [0.3, 0.6], [0.7, 0.6], [0.5, 0.7], [0.3, 0.8], [0.7, 0.8]],
};

function buildAtlas(scene) {
  const COLS = 14, ROWS = 4, CW = 292, CH = 400; // 14e colonne = dos + carte vierge
  return canvasTex("cardAtlas", scene, COLS * CW, ROWS * CH, (c, W, H) => {
    c.fillStyle = "#101010"; c.fillRect(0, 0, W, H);

    const roundRect = (x, y, w, h, r) => {
      c.beginPath();
      c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
      c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
    };

    for (let r = 0; r < ROWS; r++) {
      const suit = SUITS[r];
      for (let k = 0; k < 13; k++) {
        const rank = RANKS[k];
        const X = k * CW, Y = r * CH;
        const col = suit.red ? "#c1272d" : "#16161a";

        // fond ivoire légèrement texturé
        c.save(); c.translate(X, Y);
        roundRect(6, 6, CW - 12, CH - 12, 26); c.fillStyle = "#f7f3e8"; c.fill();
        c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,.18)"; c.stroke();
        c.save(); roundRect(6, 6, CW - 12, CH - 12, 26); c.clip();
        for (let i = 0; i < 700; i++) {
          c.fillStyle = `rgba(${180 + Math.random() * 60},${170 + Math.random() * 60},${140 + Math.random() * 60},.05)`;
          c.fillRect(Math.random() * CW, Math.random() * CH, 2, 2);
        }
        c.restore();

        // coins
        c.fillStyle = col;
        c.textAlign = "center";
        const corner = (cx, cy, rot) => {
          c.save(); c.translate(cx, cy); c.rotate(rot);
          c.font = "700 " + (rank === "10" ? 92 : 112) + "px Georgia,serif";
          c.textBaseline = "middle";
          c.fillText(rank, 0, 0);
          c.font = "76px Georgia,serif";
          c.fillText(suit.s, 0, 84);
          c.restore();
        };
        corner(66, 78, 0);
        corner(CW - 66, CH - 78, Math.PI);

        // centre
        if (k >= 10) {
          // figures : cartouche décoratif
          roundRect(52, 78, CW - 104, CH - 156, 12);
          c.strokeStyle = col; c.lineWidth = 4; c.stroke();
          c.fillStyle = suit.red ? "rgba(193,39,45,.08)" : "rgba(22,22,26,.07)";
          c.fill();
          c.fillStyle = col; c.font = "700 132px Georgia,serif"; c.textBaseline = "middle";
          c.fillText(rank, CW / 2, CH / 2 - 18);
          c.font = "72px Georgia,serif";
          c.fillText(suit.s, CW / 2, CH / 2 + 78);
          // filigranes
          c.strokeStyle = suit.red ? "rgba(193,39,45,.3)" : "rgba(22,22,26,.28)";
          c.lineWidth = 2;
          for (let i = 0; i < 5; i++) {
            c.beginPath();
            c.arc(CW / 2, CH / 2, 40 + i * 13, 0.6, 2.4); c.stroke();
            c.beginPath();
            c.arc(CW / 2, CH / 2, 40 + i * 13, 3.74, 5.54); c.stroke();
          }
        } else {
          c.fillStyle = col; c.textBaseline = "middle";
          const pips = PIPS[rank];
          const size = rank === "A" ? 132 : 58;
          c.font = size + "px Georgia,serif";
          for (const [px, py] of pips) {
            c.save();
            c.translate(CW * (0.5 + (px - 0.5) * 0.74), CH * (0.16 + py * 0.68));
            if (py > 0.52 && rank !== "A") c.rotate(Math.PI);
            c.fillText(suit.s, 0, 0);
            c.restore();
          }
        }
        c.restore();
      }
    }

    // ---- dos de carte (colonne 13, toutes les lignes) ----
    for (let r = 0; r < ROWS; r++) {
      const X = 13 * CW, Y = r * CH;
      c.save(); c.translate(X, Y);
      roundRect(6, 6, CW - 12, CH - 12, 26);
      const g = c.createLinearGradient(0, 0, CW, CH);
      g.addColorStop(0, "#7e1420"); g.addColorStop(0.5, "#4c0a12"); g.addColorStop(1, "#8d1a26");
      c.fillStyle = g; c.fill();
      c.save(); roundRect(6, 6, CW - 12, CH - 12, 26); c.clip();
      c.strokeStyle = "rgba(226,190,110,.5)"; c.lineWidth = 2;
      for (let i = -CH; i < CW + CH; i += 15) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i + CH, CH); c.stroke();
        c.beginPath(); c.moveTo(i, CH); c.lineTo(i + CH, 0); c.stroke();
      }
      c.fillStyle = "rgba(20,4,7,.55)";
      c.beginPath(); c.ellipse(CW / 2, CH / 2, 88, 122, 0, 0, 7); c.fill();
      c.strokeStyle = "#e8c477"; c.lineWidth = 4; c.stroke();
      c.fillStyle = "#e8c477";
      c.font = "700 34px 'Futura',sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("LE", CW / 2, CH / 2 - 34);
      c.fillText("MIRAGE", CW / 2, CH / 2 + 4);
      c.font = "44px Georgia,serif";
      c.fillText("♠ ♥ ♦ ♣", CW / 2, CH / 2 + 62);
      c.restore();
      roundRect(18, 18, CW - 36, CH - 36, 18);
      c.strokeStyle = "rgba(232,196,119,.75)"; c.lineWidth = 3; c.stroke();
      c.restore();
    }
  });
}

/* ------------------------------------------------------------------ mesh */

const GX = 7, GZ = 11; // subdivisions (déformation organique)

function cardVertexData(uv) {
  const pos = [], nor = [], uvs = [], idx = [];
  const hw = CARD_W / 2, hl = CARD_L / 2;
  const push = (side) => {
    const base = pos.length / 3;
    const y = side * CARD_T * 0.5;
    for (let j = 0; j <= GZ; j++) {
      for (let i = 0; i <= GX; i++) {
        const u = i / GX, v = j / GZ;
        pos.push(-hw + u * CARD_W, y, -hl + v * CARD_L);
        nor.push(0, side, 0);
        // atlas (u déjà inversé côté face via u0>u1)
        const r = uv[side > 0 ? "face" : "back"];
        uvs.push(r.u0 + u * (r.u1 - r.u0), r.v0 + v * (r.v1 - r.v0));
      }
    }
    for (let j = 0; j < GZ; j++) {
      for (let i = 0; i < GX; i++) {
        const a = base + j * (GX + 1) + i, b = a + 1, c = a + GX + 1, d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  };
  push(1); push(-1);
  const vd = new B.VertexData();
  vd.positions = pos; vd.normals = nor; vd.uvs = uvs; vd.indices = idx;
  return vd;
}

export class Cards {
  constructor(scene, audio, world) {
    this.scene = scene; this.audio = audio; this.world = world;
    const atlas = buildAtlas(scene);
    this.mat = pbr("cardM", scene, { color: C3(0.70, 0.69, 0.66), roughness: 0.68, metallic: 0 });
    this.mat.baseTexture = atlas;
    this.mat.backFaceCulling = false;
    this.live = [];
    this.COLS = 14; this.ROWS = 4;
  }

  /**
   * Rectangles d'atlas. Convention établie par test (`update(false)`) : le HAUT
   * du canvas correspond à v = 0, et v croît vers +Z, c'est-à-dire vers le
   * joueur. Le haut de l'image doit donc tomber sur v0 (bord -Z, côté croupier),
   * sinon la carte se lit en miroir vertical (« 3 à l'envers »).
   * La face avant se lit en miroir horizontal (u décroissant : +X est à gauche
   * de l'écran), la face arrière — vue après retournement de 180° autour de Z —
   * se lit en u croissant. Le retournement ne change pas Z : v est identique
   * sur les deux faces.
   */
  uvFor(rank, suit) {
    const k = RANKS.indexOf(rank), r = suit;
    const cw = 1 / this.COLS, ch = 1 / this.ROWS;
    return {
      face: { u0: (k + 1) * cw, u1: k * cw, v0: r * ch, v1: (r + 1) * ch },
      back: { u0: 13 * cw, u1: 14 * cw, v0: r * ch, v1: (r + 1) * ch },
    };
  }

  /** Crée une carte physique. rank: "A".."K", suit: 0..3 */
  create(rank, suit, pos, faceUp = false) {
    const scene = this.scene;
    const uv = this.uvFor(rank, suit);

    // proxy physique invisible
    const body = B.MeshBuilder.CreateBox("cardBody", {
      width: CARD_W, height: 0.0016, depth: CARD_L,
    }, scene);
    body.isVisible = false;
    body.position.copyFrom(pos);
    // l'orientation doit être posée AVANT la création du corps physique
    body.rotation.z = faceUp ? 0 : Math.PI;
    body.computeWorldMatrix(true);

    // maillage visuel déformable
    const vis = new B.Mesh("card" + rank, scene);
    cardVertexData(uv).applyToMesh(vis, true);
    vis.material = this.mat;
    vis.parent = body;
    vis.receiveShadows = true;
    if (this.world.shadowGens[0]) this.world.shadowGens[0].addShadowCaster(vis);

    const agg = new B.PhysicsAggregate(body, B.PhysicsShapeType.BOX, {
      mass: 0.0019, restitution: 0.1, friction: 0.72,
    }, scene);
    agg.body.setLinearDamping(1.4);   // les cartes planent / freinent dans l'air
    agg.body.setAngularDamping(1.8);
    agg.body.setCollisionCallbackEnabled(true);
    let last = 0;
    agg.body.getCollisionObservable().add(() => {
      const now = performance.now();
      if (now - last > 90) { last = now; this.audio.card(); }
    });

    const card = new Card(this, body, vis, agg, rank, suit);
    card.faceUp = faceUp;
    this.live.push(card);
    return card;
  }

  disposeAll() {
    this.live.forEach((c) => c.dispose());
    this.live = [];
  }
}

export class Card {
  constructor(mgr, body, vis, agg, rank, suit) {
    this.mgr = mgr; this.body = body; this.vis = vis; this.agg = agg;
    this.rank = rank; this.suit = suit; this.faceUp = false;
    this.basePos = vis.getVerticesData(B.VertexBuffer.PositionKind).slice();
    this._work = new Float32Array(this.basePos.length);
    this.bendAmt = 0; this.twist = 0; this.wave = 0;
    this._t = rnd(0, 10);
    this.setBend(rnd(0.0012, 0.0028), rnd(-0.0008, 0.0008));
  }

  /** Déformation organique : cambrure transversale + vrille + micro-ondulation. */
  setBend(amount, twist = 0, wave = 0) {
    this.bendAmt = amount; this.twist = twist; this.wave = wave;
    this._deform();
  }

  _deform() {
    const p = this.basePos, w = this._work;
    const hw = CARD_W / 2, hl = CARD_L / 2;
    const a = this.bendAmt, tw = this.twist, wv = this.wave, t = this._t;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      const u = x / hw, v = z / hl;
      let dy = a * (u * u - 0.34);              // cambrure autour de l'axe long
      dy += tw * u * v * 3.2;                   // vrille
      dy += a * 0.35 * (v * v - 0.33);          // légère cambrure longitudinale
      if (wv) dy += wv * Math.sin(v * 3.1 + t * 2.2) * Math.cos(u * 2.0);
      w[i] = x; w[i + 1] = y + dy; w[i + 2] = z;
    }
    this.vis.updateVerticesData(B.VertexBuffer.PositionKind, w, false, false);
  }

  /** Ondulation continue (carte tenue en main / posée sur du feutre souple). */
  tick(dt) {
    if (!this.wave) return;
    this._t += dt;
    this._deform();
  }

  /** Repasse la carte en pilotage par transform (animations). */
  _animated() {
    const b = this.agg.body;
    b.setMotionType(B.PhysicsMotionType.ANIMATED);
    b.disablePreStep = false;
    b.setLinearVelocity(V3(0, 0, 0));
    b.setAngularVelocity(V3(0, 0, 0));
    // la physique écrit un quaternion : on repasse en angles d'Euler pour animer
    if (this.body.rotationQuaternion) {
      this.body.rotation = this.body.rotationQuaternion.toEulerAngles();
      this.body.rotationQuaternion = null;
    }
  }

  /** Lancer physique depuis le sabot vers une cible. */
  deal(target, speed = 1) {
    const b = this.agg.body;
    b.disablePreStep = true;
    b.setMotionType(B.PhysicsMotionType.DYNAMIC);
    const p = this.body.getAbsolutePosition();
    const d = target.subtract(p);
    const dist = Math.hypot(d.x, d.z);
    const T = clamp(dist * 0.55, 0.3, 0.85) / speed;
    b.setLinearVelocity(V3(d.x / T, 1.35 + d.y / T, d.z / T));
    b.setAngularVelocity(V3(rnd(-1.5, 1.5), rnd(6, 13) * (Math.random() < 0.5 ? -1 : 1), rnd(-1.5, 1.5)));
    this.mgr.audio.card();
    return T;
  }

  /** Fige la carte à sa place définitive (glissement propre sur le feutre). */
  settle(pos, rotY, faceUp, frames = 16, tilt = 0) {
    this._animated();
    const scene = this.mgr.scene;
    animVec(scene, this.body, "position", this.body.position, pos, frames);
    const target = V3(tilt, rotY, faceUp ? 0 : Math.PI);
    // la carte sort de la physique avec des angles quelconques : on recale
    // l'angle de départ pour qu'elle se pose par le plus court chemin
    this.body.rotation = nearestEuler(this.body.rotation, target);
    animVec(scene, this.body, "rotation", this.body.rotation, target, frames, undefined, () => {
      this.faceUp = faceUp;
      this.setBend(rnd(0.0009, 0.002), rnd(-0.0006, 0.0006));
    });
  }

  /** Retournement avec flexion (la carte se cambre puis claque à plat). */
  flip(faceUp = true, frames = 22) {
    if (this.faceUp === faceUp) return;
    const scene = this.mgr.scene;
    this._animated();
    this.mgr.audio.cardFlip();
    const y0 = this.body.position.y;
    animFloat(scene, this.body, "position.y", y0, y0 + 0.022, frames * 0.45, true, () =>
      animFloat(scene, this.body, "position.y", y0 + 0.022, y0, frames * 0.55));
    animFloat(scene, this.body, "rotation.z", this.body.rotation.z, faceUp ? 0 : Math.PI, frames, true, () => {
      this.faceUp = faceUp;
      this.setBend(rnd(0.001, 0.0022), rnd(-0.0006, 0.0006));
    });
    // flexion pendant le retournement
    let f = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      f += scene.getEngine().getDeltaTime() / 16.7;
      const k = Math.sin(Math.min(1, f / frames) * Math.PI);
      this.setBend(0.0015 + k * 0.009, k * 0.004);
      if (f >= frames) scene.onBeforeRenderObservable.remove(obs);
    });
  }

  dispose() {
    try { this.agg.dispose(); } catch (e) { }
    this.vis.dispose(); this.body.dispose();
    const i = this.mgr.live.indexOf(this);
    if (i >= 0) this.mgr.live.splice(i, 1);
  }
}
