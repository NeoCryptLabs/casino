/**
 * SABOT ET CORBEILLE — le stock de cartes, modélisé.
 *
 * Avant : deux boîtes noires. Le sabot ne contenait rien, la défausse était un
 * bloc plein, et les cartes naissaient dans le vide, 24 cm devant. On modélise
 * ici le vrai objet — et surtout ce qu'il contient.
 *
 * GÉOMÉTRIE DU STOCK. Dans un sabot de casino les cartes sont debout, appuyées
 * en arrière (~30°), et le croupier tire celle de DEVANT : la face avant du
 * paquet ne bouge donc jamais, c'est l'arrière qui recule, poussé par le
 * presseur. Vu de côté, le paquet n'est pas un rectangle mais un
 * PARALLÉLOGRAMME — les tranches basses reposent toutes sur le plancher, les
 * hautes sont décalées de CARD_L·sin θ vers l'arrière. D'où le prisme sur
 * profil plutôt qu'une boîte : une boîte inclinée traverserait la semelle de
 * 7 cm à l'arrière quand le sabot est plein.
 *
 * COÛT. Tout ce qui est fixe est accumulé en VertexData, exprimé en
 * coordonnées de TABLE, et fondu en TROIS maillages pour les deux meubles
 * (laque, acrylique fumé, laiton) — soit autant qu'avant pour un objet vingt
 * fois plus détaillé. Ne bougent que le paquet, la carte de coupe, le presseur
 * et la pile de défausse ; leur topologie est constante, on réécrit les
 * sommets au lieu de reconstruire un maillage plusieurs fois par seconde.
 */
import { V3, C3, pbr, canvasTex, rnd } from "./util.js";
import { CARD_W, CARD_L, CARD_T } from "./cards.js";
const B = BABYLON;

export const FULL_SHOE = 312;        // six jeux
// Cartes restant DERRIÈRE la carte de coupe. Calé sur le seuil de remélange du
// serveur (`server/blackjack.mjs` : `if (this.shoe.length < 90) this._newShoe()`)
// pour que la carte jaune sorte du sabot au moment même où la table remélange —
// ce qui suppose que le paquet visible suive le compte du serveur, d'où `sync()`.
const CUT_RESERVE = 90;
const TILE = 24;                     // cartes par répétition de la texture de tranches

/* ------------------------------------------------------------- dimensions */

const LEAN = 0.52;                   // ~30° : inclinaison des cartes dans le sabot
const SIN_L = Math.sin(LEAN), COS_L = Math.cos(LEAN);
const STEP = CARD_T / COS_L;         // empreinte au sol d'une carte inclinée
const LEAN_BACK = CARD_L * SIN_L;    // recul du haut de carte
const LEAN_UP = CARD_L * COS_L;      // hauteur du haut de carte

const IN_W = CARD_W + 0.010;         // largeur intérieure
const WALL = 0.006;
const LEN = 0.225, HZ = LEN / 2;     // longueur hors tout, demi-longueur
const FLOOR = 0.010;                 // épaisseur de la semelle
const H_BACK = 0.128, H_FRONT = 0.040;
const SLOT = 0.005;                  // fente de sortie, sous la paroi avant

const T_WALL = 0.005, T_FLOOR = 0.008;
const T_IN_X = CARD_W + 0.010, T_IN_Z = CARD_L + 0.010;
const T_H = 0.078, T_FRONT_H = 0.030;

/* -------------------------------------------------------------- géométrie */

/** Repère d'assemblage d'une pièce : rotation autour de X, puis translation. */
const xf = (x, y, z, rx = 0) =>
  B.Matrix.RotationX(rx).multiply(B.Matrix.Translation(x, y, z));

/**
 * Chaque triangle doit regarder VERS L'EXTÉRIEUR. Plutôt que de raisonner sur
 * l'ordre des sommets — qui dépend du sens de parcours du profil, écrit ici à
 * la main — on compare la normale géométrique au vecteur centre→triangle et on
 * retourne ce qui pointe à l'envers. Exact tant que la forme est étoilée depuis
 * son centre : c'est le cas des deux profils utilisés (joue et paquet).
 *
 * SENS DE LA COMPARAISON, MESURÉ et non deviné : passée sur `CreateBox`, la
 * règle « produit vectoriel vers l'extérieur » retourne les 12 triangles sur
 * 12. En repère GAUCHER — celui de Babylon, `useRightHandedSystem === false` —
 * une face avant s'enroule donc dans l'autre sens, et c'est le produit
 * vectoriel SORTANT qui signale une face à l'envers. Le premier jet inversait
 * ce test : le sabot rendait son intérieur, on voyait la carte de coupe au
 * travers du paquet.
 */
function orientOutward(pos, idx, c) {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, d = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[d] - pos[a], vy = pos[d + 1] - pos[a + 1], vz = pos[d + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (pos[a] + pos[b] + pos[d]) / 3 - c[0];
    const my = (pos[a + 1] + pos[b + 1] + pos[d + 1]) / 3 - c[1];
    const mz = (pos[a + 2] + pos[b + 2] + pos[d + 2]) / 3 - c[2];
    if (nx * mx + ny * my + nz * mz > 0) {
      const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s;
    }
  }
}

/**
 * Prisme : profil (z, y) extrudé sur X. Les deux flancs sont des éventails
 * depuis le centre du profil, la tranche une bande de quadrilatères.
 * `uvFn(z, y)` donne les coordonnées de texture — les deux sommets d'une même
 * arête partagent leurs UV, si bien qu'une rayure du flanc se prolonge droit
 * sur la tranche : c'est ce qui fait lire les tranches de cartes.
 */
function prismData(profile, width, uvFn = () => [0, 0]) {
  const hw = width / 2, n = profile.length;
  let cz = 0, cy = 0;
  for (const [z, y] of profile) { cz += z / n; cy += y / n; }
  const pos = [], uvs = [], idx = [];
  const add = (x, z, y) => {
    const k = pos.length / 3;
    pos.push(x, y, z);
    const uv = uvFn(z, y); uvs.push(uv[0], uv[1]);
    return k;
  };
  for (const s of [1, -1]) {
    const c = add(s * hw, cz, cy);
    const ring = profile.map(([z, y]) => add(s * hw, z, y));
    for (let i = 0; i < n; i++) idx.push(c, ring[i], ring[(i + 1) % n]);
  }
  for (let i = 0; i < n; i++) {
    const [z0, y0] = profile[i], [z1, y1] = profile[(i + 1) % n];
    const a = add(hw, z0, y0), b = add(hw, z1, y1);
    const c = add(-hw, z1, y1), d = add(-hw, z0, y0);
    idx.push(a, b, c, a, c, d);
  }
  orientOutward(pos, idx, [0, cy, cz]);
  const vd = new B.VertexData();
  vd.positions = pos; vd.uvs = uvs; vd.indices = idx;
  vd.normals = []; B.VertexData.ComputeNormals(pos, idx, vd.normals);
  return vd;
}

/**
 * Accumulateur : tout ce qui partage un matériau finit en UN maillage. `frame`
 * est le repère du meuble en cours — le sabot et la corbeille n'ont ni la même
 * place ni le même cap, mais leurs pièces atterrissent dans les mêmes groupes,
 * en coordonnées de table.
 */
class Group {
  constructor() { this.vd = null; this.frame = B.Matrix.Identity(); }
  add(vd, m) {
    vd.transform(m ? m.multiply(this.frame) : this.frame);
    if (this.vd) this.vd.merge(vd, true); else this.vd = vd;
  }
  box(w, h, d, x, y, z, rx = 0) {
    this.add(B.VertexData.CreateBox({ width: w, height: h, depth: d }), xf(x, y, z, rx));
  }
  build(name, scene, mat, parent) {
    if (!this.vd) return null;
    const m = new B.Mesh(name, scene);
    this.vd.applyToMesh(m);
    m.material = mat; m.parent = parent;
    return m;
  }
}

/**
 * Pile de cartes à topologie FIGÉE : un profil de quatre points, donc un nombre
 * de sommets constant quelle que soit son épaisseur. On réécrit les positions à
 * chaque carte tirée plutôt que de rebâtir — et jeter — un maillage.
 */
class Stack {
  constructor(scene, name, mat, width, uvFn, parent) {
    this.uvFn = uvFn; this.width = width;
    this.mesh = new B.Mesh(name, scene);
    this.mesh.material = mat; this.mesh.parent = parent;
    this.built = false;
  }
  set(profile) {
    const vd = prismData(profile, this.width, this.uvFn);
    if (!this.built) { vd.applyToMesh(this.mesh, true); this.built = true; return; }
    this.mesh.updateVerticesData(B.VertexBuffer.PositionKind, vd.positions);
    this.mesh.updateVerticesData(B.VertexBuffer.NormalKind, vd.normals);
    this.mesh.updateVerticesData(B.VertexBuffer.UVKind, vd.uvs);
  }
}

/* -------------------------------------------------------------- matériaux */

const CACHE = new WeakMap();

/**
 * Texture des TRANCHES. Des bandes horizontales — une par carte — en ivoire
 * légèrement dépareillé, séparées par le fin liseré d'ombre qui existe entre
 * deux cartes. `TILE` cartes par répétition : les UV des piles sont comptées en
 * CARTES, la texture se répète donc d'elle-même quelle que soit la hauteur, et
 * une carte fait toujours la même épaisseur à l'écran.
 */
function stripeTexture(scene) {
  const W = 64, H = 512, band = H / TILE;
  return canvasTex("cardEdges", scene, W, H, (c) => {
    c.fillStyle = "#e9e2cf"; c.fillRect(0, 0, W, H);
    for (let k = 0; k < TILE; k++) {
      const y = k * band;
      // 312 cartes sur 11 cm : à un mètre, une tranche fait moins d'un pixel et
      // le mip-mapping moyenne TOUT — la pile rendait ivoire uni. D'où deux
      // échelles : le liseré fin, exact, pour la vue rapprochée ; et une
      // rainure marquée toutes les six cartes — le tassement naturel d'une pile
      // faite à la main — assez large pour survivre à la réduction.
      const groove = k % 6 === 0;
      const l = 212 + rnd(-14, 14) - (groove ? 22 : 0);
      c.fillStyle = `rgb(${l},${l - 6},${l - 22})`;
      c.fillRect(0, y + 1, W, band - 1.6);
      c.fillStyle = "rgba(58,48,34,.55)";          // liseré entre deux cartes
      c.fillRect(0, y, W, 1.4);
      if (groove) { c.fillStyle = "rgba(34,27,16,.8)"; c.fillRect(0, y - 1, W, 3); }
      if (k % 5 === 2) {                            // une pile n'est jamais parfaite
        c.fillStyle = "rgba(90,76,52,.22)";
        c.fillRect(0, y + band * 0.5, W, band * 0.5);
      }
    }
    // salissure longitudinale, sinon les bandes se lisent comme un code-barres
    for (let i = 0; i < 900; i++) {
      c.fillStyle = `rgba(120,102,72,${rnd(0.02, 0.09)})`;
      c.fillRect(rnd(0, W), rnd(0, H), rnd(1, 6), 1);
    }
  });
}

/** Matériaux partagés par TOUTES les tables du pit (trois sabots, un jeu). */
function mats(scene) {
  if (CACHE.has(scene)) return CACHE.get(scene);
  const m = {
    lacquer: pbr("shoeLacquer", scene, { color: C3(0.045, 0.038, 0.036), roughness: 0.28, metallic: 0.12 }),
    // acrylique fumé : on doit VOIR le stock à travers les joues du sabot
    // Fumé assez DENSE pour se voir : à 0,44 d'opacité la joue disparaissait
    // complètement sur le paquet ivoire, et le sabot semblait ouvert.
    smoke: pbr("shoeSmoke", scene, { color: C3(0.13, 0.11, 0.12), roughness: 0.18, metallic: 0, alpha: 0.5 }),
    // Laiton PROPRE au sabot, pas le `gold()` du décor : un métal pur (rugosité
    // 0,19) n'a ici presque rien à réfléchir et rendait noir — des tubes de
    // plastique sombre sur la corbeille. On le rend légèrement satiné, il capte
    // alors la diffuse de la lampe de table et redevient du laiton.
    brass: pbr("shoeBrass", scene, { color: C3(0.72, 0.55, 0.24), metallic: 0.85, roughness: 0.34 }),
    chrome: pbr("shoeChrome", scene, { color: C3(0.62, 0.63, 0.66), roughness: 0.18, metallic: 1 }),
    cut: pbr("shoeCut", scene, { color: C3(0.92, 0.76, 0.08), roughness: 0.42, metallic: 0 }),
    edges: pbr("shoeEdges", scene, { color: C3(1, 1, 1), roughness: 0.74, metallic: 0 }),
  };
  m.edges.baseTexture = stripeTexture(scene);
  // Sur une surface TRANSPARENTE, Babylon ajoute par défaut le spéculaire et la
  // radiance PAR-DESSUS l'alpha : une joue quasi miroir renvoyait alors la salle
  // à pleine intensité et virait au verre dépoli blanc, qui masquait le paquet
  // au lieu de le teinter. On les repasse SOUS l'alpha — le fumé redevient du
  // fumé, et le reflet ne survit qu'aux angles rasants.
  m.smoke.useSpecularOverAlpha = false;
  m.smoke.useRadianceOverAlpha = false;
  CACHE.set(scene, m);
  return m;
}

/**
 * Dos de carte prélevé dans l'atlas des cartes (colonne 13 sur 14) : pas de
 * texture ni de matériau de plus — on réutilise celui des cartes et on découpe
 * la bonne case dans les UV du quadrilatère.
 */
function backQuad(scene, name, cardsMgr, parent) {
  const u0 = 13 / 14, u1 = 1, v0 = 0, v1 = 1 / 4;
  const hw = CARD_W / 2, hl = CARD_L / 2;
  const vd = new B.VertexData();
  vd.positions = [-hw, 0, -hl, hw, 0, -hl, hw, 0, hl, -hw, 0, hl];
  vd.uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
  vd.indices = [0, 2, 1, 0, 3, 2];
  vd.normals = [];
  B.VertexData.ComputeNormals(vd.positions, vd.indices, vd.normals);
  const m = new B.Mesh(name, scene);
  vd.applyToMesh(m);
  m.material = cardsMgr.mat;      // backFaceCulling déjà désactivé côté cartes
  m.parent = parent;
  return m;
}

/* ------------------------------------------------------------- assemblage */

/**
 * @param {object} opt { shoe:{pos,yaw}, tray:{pos,yaw} } en coordonnées de table
 * @returns contrôleur du stock : `exit`, `mouth()`, `deal()`, `discard()`, `refill()`
 */
export function buildShoe(scene, world, root, cardsMgr, opt) {
  const M = mats(scene);
  const lacquer = new Group(), smoke = new Group(), brass = new Group();

  const frameOf = (p, yaw) =>
    B.Matrix.RotationY(yaw).multiply(B.Matrix.Translation(p.x, p.y, p.z));
  const shoeFrame = frameOf(opt.shoe.pos, opt.shoe.yaw);
  const trayFrame = frameOf(opt.tray.pos, opt.tray.yaw);

  /* ------------------------------------------------------------ le sabot */
  for (const g of [lacquer, smoke, brass]) g.frame = shoeFrame;

  // Profil des joues : haut à l'arrière — le stock plein y monte à 10 cm — et
  // bas à l'avant pour que la main atteigne la carte, avec le creux
  // caractéristique au milieu par lequel on voit la tranche du paquet.
  const cheek = [[HZ, 0], [HZ, H_FRONT]];
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    cheek.push([HZ - t * LEN,
      H_FRONT + t * (H_BACK - H_FRONT) - 0.013 * Math.sin(Math.PI * t)]);
  }
  cheek.push([-HZ, 0]);

  const cheekX = (IN_W + WALL) / 2;
  for (const s of [1, -1]) smoke.add(prismData(cheek, WALL), xf(s * cheekX, FLOOR, 0));
  lacquer.box(IN_W + 2 * WALL + 0.006, FLOOR, LEN + 0.006, 0, FLOOR / 2, 0);
  lacquer.box(IN_W, H_BACK, WALL, 0, FLOOR + H_BACK / 2, -HZ + WALL / 2);
  // paroi avant : elle commence AU-DESSUS de la fente, la carte sort dessous
  lacquer.box(IN_W, H_FRONT - SLOT, WALL, 0, FLOOR + SLOT + (H_FRONT - SLOT) / 2, HZ - WALL / 2);

  // seuil de laiton : la langue sur laquelle la carte glisse en sortant
  brass.box(IN_W, 0.0025, 0.036, 0, FLOOR - 0.0005, HZ - 0.004);
  // Plinthe et coiffe arrière. Le laiton ne suit PAS la courbe des joues : un
  // liseré courbe demande huit segments mitrés, qui se lisaient comme une
  // rangée de dents noires posées sur le sabot. Deux lignes droites tiennent le
  // même rôle — cadrer la laque — et laissent l'acrylique respirer.
  const plinthX = (IN_W + 2 * WALL + 0.006) / 2, plinthZ = (LEN + 0.006) / 2;
  for (const s of [1, -1]) brass.box(0.004, 0.005, LEN + 0.008, s * plinthX, FLOOR - 0.0025, 0);
  for (const s of [1, -1]) brass.box(IN_W + 2 * WALL + 0.010, 0.005, 0.004, 0, FLOOR - 0.0025, s * plinthZ);
  brass.box(IN_W + 2 * WALL + 0.002, 0.004, WALL + 0.003, 0, FLOOR + H_BACK, -HZ + WALL / 2);

  /* -------------------------------------------------------- la corbeille */
  for (const g of [lacquer, smoke, brass]) g.frame = trayFrame;

  const tx = (T_IN_X + T_WALL) / 2, tz = (T_IN_Z + T_WALL) / 2;
  lacquer.box(T_IN_X + 2 * T_WALL + 0.005, T_FLOOR, T_IN_Z + 2 * T_WALL + 0.005, 0, T_FLOOR / 2, 0);
  for (const s of [1, -1]) smoke.box(T_WALL, T_H, T_IN_Z, s * tx, T_FLOOR + T_H / 2, 0);
  smoke.box(T_IN_X + 2 * T_WALL, T_H, T_WALL, 0, T_FLOOR + T_H / 2, -tz);
  // face côté table volontairement basse : la pile se voit depuis les places
  smoke.box(T_IN_X + 2 * T_WALL, T_FRONT_H, T_WALL, 0, T_FLOOR + T_FRONT_H / 2, tz);
  for (const s of [1, -1]) brass.box(T_WALL + 0.003, 0.004, T_IN_Z + 2 * T_WALL, s * tx, T_FLOOR + T_H, 0);
  brass.box(T_IN_X + 2 * T_WALL, 0.004, T_WALL + 0.003, 0, T_FLOOR + T_H, -tz);
  brass.box(T_IN_X + 2 * T_WALL, 0.004, T_WALL + 0.003, 0, T_FLOOR + T_FRONT_H, tz);

  const bodyM = lacquer.build("shoeBody", scene, M.lacquer, root);
  smoke.build("shoeGlass", scene, M.smoke, root);
  brass.build("shoeTrim", scene, M.brass, root);
  // Ombre portée : la laque seulement. Une joue transparente projetterait une
  // ombre pleine, et le paquet, lui, est déjà dans l'ombre du sabot.
  world.shadowGens.forEach((sg) => sg.addShadowCaster(bodyM));

  /* ----------------------------------------------- le stock, en mouvement */

  const shoe = new B.TransformNode("shoe", scene);
  shoe.parent = root;
  shoe.position = opt.shoe.pos.clone();
  shoe.rotation.y = opt.shoe.yaw;
  const tray = new B.TransformNode("discardTray", scene);
  tray.parent = root;
  tray.position = opt.tray.pos.clone();
  tray.rotation.y = opt.tray.yaw;

  // Origine du paquet : arête basse de la carte de devant, contre la paroi.
  const stockNode = new B.TransformNode("stock", scene);
  stockNode.parent = shoe;
  stockNode.position.set(0, FLOOR, HZ - WALL - 0.0015);

  // UV du paquet. `v` compte les CARTES : le long d'une même carte, y et z se
  // compensent exactement (le terme en h s'annule), si bien que chaque carte
  // reçoit UNE bande de la texture — c'est ce qui fait lire les tranches. `u`
  // ne sert qu'à monter du plancher au haut de carte : on le prend sur la
  // hauteur plutôt que sur l'axe incliné, qui dérivait avec le cisaillement.
  const stockUV = (z, y) => [
    y / LEAN_UP,
    -(y * SIN_L + z * COS_L) / (CARD_T * TILE),
  ];
  const stock = new Stack(scene, "stockCards", M.edges, CARD_W, stockUV, stockNode);
  world.shadowGens.forEach((sg) => sg.addShadowCaster(stock.mesh));

  // Dos de la carte de devant. Elle ne bouge JAMAIS — on tire par l'avant,
  // c'est l'arrière du paquet qui recule — donc pas d'animation à lui donner.
  const face = backQuad(scene, "stockFace", cardsMgr, stockNode);
  face.rotation.x = Math.PI / 2 - LEAN;
  face.position.set(0, LEAN_UP / 2 + 0.0005 * SIN_L, -LEAN_BACK / 2 + 0.0005 * COS_L);

  // Carte de coupe : plastique jaune vif glissé à CUT_RESERVE cartes du fond,
  // et qui dépasse du paquet — c'est elle qui annonce le remélange.
  const CUT_H = CARD_L * 1.1;
  const cut = B.MeshBuilder.CreateBox("cutCard",
    { width: CARD_W - 0.002, height: CUT_H, depth: 0.0007 }, scene);
  cut.material = M.cut; cut.parent = stockNode; cut.rotation.x = -LEAN;

  // Presseur : le poids chromé qui maintient le paquet plaqué vers l'avant.
  const push = new Group();
  push.box(IN_W - 0.004, CARD_L * 0.86, 0.007, 0, CARD_L * 0.43, 0);
  push.box(0.020, 0.012, 0.020, 0, CARD_L * 0.86 + 0.004, 0.006);
  const pusher = push.build("stockPusher", scene, M.chrome, stockNode);
  pusher.rotation.x = -LEAN;

  /* -------------------------------------------------- la pile de défausse */
  const discNode = new B.TransformNode("discardPile", scene);
  discNode.parent = tray; discNode.position.y = T_FLOOR;
  const discUV = (z, y) => [(z + CARD_L / 2) / CARD_L, y / (CARD_T * TILE)];
  const disc = new Stack(scene, "discardCards", M.edges, CARD_W, discUV, discNode);
  const discFace = backQuad(scene, "discardFace", cardsMgr, discNode);

  /* ----------------------------------------------------------- animation */

  let left = FULL_SHOE, dropped = 0;

  function layStock() {
    const n = Math.max(1, left);
    const f = n * STEP;                        // empreinte au sol du paquet
    stock.set([[0, 0], [-LEAN_BACK, LEAN_UP], [-LEAN_BACK - f, LEAN_UP], [-f, 0]]);

    // La carte de coupe recule avec le fond du paquet, puis disparaît une fois
    // distribuée. Pivot sur son arête basse, d'où les DEUX composantes du
    // décalage : sans quoi elle flotterait au-dessus du plancher.
    const k = n - CUT_RESERVE;
    cut.setEnabled(k > 0);
    if (k > 0) cut.position.set(0, (CUT_H / 2) * COS_L, -k * STEP - (CUT_H / 2) * SIN_L);

    pusher.position.set(0, 0, -f - 0.004);
  }

  function layDiscard() {
    const h = Math.max(CARD_T, dropped * CARD_T);
    disc.set([[CARD_L / 2, 0], [CARD_L / 2, h], [-CARD_L / 2, h], [-CARD_L / 2, 0]]);
    discFace.position.y = h + 0.0005;
    disc.mesh.setEnabled(dropped > 0);
    discFace.setEnabled(dropped > 0);
  }

  /** Rampe douce : repasser de 90 à 312 cartes d'un seul coup « claque ». */
  let ramping = 0;
  function ramp(from, to, set, lay) {
    ramping++;
    for (let i = 1; i <= 12; i++) {
      setTimeout(() => {
        set(Math.round(from + (to - from) * (i / 12))); lay();
        if (i === 12) ramping--;
      }, i * 30);
    }
  }

  layStock(); layDiscard();

  return {
    /** Point de sortie de la carte, en coordonnées de TABLE. */
    exit: B.Vector3.TransformCoordinates(V3(0, FLOOR + 0.006, HZ + 0.022), shoeFrame),

    /** Bouche de la corbeille : juste au-dessus de la pile actuelle. */
    mouth: () => V3(opt.tray.pos.x,
      opt.tray.pos.y + T_FLOOR + dropped * CARD_T + 0.05,
      opt.tray.pos.z),

    /** `n` cartes quittent le sabot — retour immédiat, au lancer de la carte. */
    deal(n = 1) { left = Math.max(1, left - n); layStock(); },

    /**
     * Recale le paquet sur le compte du serveur, seul vrai. `deal()` donne la
     * réaction immédiate ; celui-ci reprend la dérive à chaque photo d'état —
     * toutes les cartes tirées côté serveur n'ont pas de carte à l'écran.
     * Ignoré pendant le rechargement, qui a sa propre rampe.
     */
    sync(n) {
      if (ramping || !Number.isFinite(n)) return;
      const v = Math.max(1, Math.min(FULL_SHOE, Math.round(n)));
      if (v === left) return;
      left = v; layStock();
    },

    /** `n` cartes tombent dans la corbeille. */
    discard(n = 1) { dropped = Math.min(FULL_SHOE, dropped + n); layDiscard(); },

    /** Remélange : sabot rechargé, corbeille vidée. */
    refill() {
      ramp(left, FULL_SHOE, (v) => { left = v; }, layStock);
      ramp(dropped, 0, (v) => { dropped = v; }, layDiscard);
    },
  };
}
