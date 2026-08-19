/**
 * Table de blackjack — MISE EN SCÈNE UNIQUEMENT.
 *
 * La règle, le sabot, les mises et les paiements vivent désormais dans
 * `server/blackjack.mjs` : la table est autoritaire côté serveur et partagée
 * par tous les joueurs. Ce fichier construit le mobilier et rejoue ce que le
 * serveur annonce (`applyServer`). Il ne décide plus rien.
 *
 * Le sabot local qui subsiste ne sert qu'à fabriquer le carton posé FACE CACHÉE
 * devant le croupier : le serveur ne révèle sa vraie carte qu'au retournement,
 * précisément pour qu'aucun client ne puisse la lire à l'avance.
 */
import { V3, C3, pbr, gold, canvasTex, rnd, rndInt, pick, animVec, fmt } from "./util.js";
import { LAYOUT } from "./world.js";
import { CHIP_H, CHIP_R } from "./chips.js";
const B = BABYLON;

const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const TOP_Y = 0.92;

function cardValue(rank) {
  if (rank === "A") return 11;
  if (["10", "J", "Q", "K"].includes(rank)) return 10;
  return parseInt(rank, 10);
}
export function handValue(hand) {
  let total = 0, aces = 0;
  for (const c of hand) { total += cardValue(c.rank); if (c.rank === "A") aces++; }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 && total <= 21 };
}

/* --------------------------------------------------------------- feutre */

/**
 * Sérigraphie du feutre, dessinée directement en coordonnées LOCALES de la table.
 * Le plateau est un cap de cylindre : le haut du canvas correspond à -Z (côté
 * croupier) et la droite du canvas à +X, ce qui se lit en miroir depuis la place
 * du joueur — d'où l'inversion horizontale intégrée dans `P()`.
 */
function feltTexture(scene, RX, RZ, seats) {
  const S = 2048;
  // mètres -> pixels (les deux axes n'ont pas la même échelle : la table est ovale)
  const PX = S / (2 * RX), PZ = S / (2 * RZ);
  // vraie projection du cap : canvas-droite -> +X, canvas-bas -> +Z
  const P = (x, z) => [S * 0.5 + x * PX, S * 0.5 + z * PZ];
  // Vu depuis la place du joueur, +X est à GAUCHE de l'écran : les glyphes
  // doivent donc être dessinés en miroir (scale x négatif), pas repositionnés.
  const SQUASH = -PX / PZ;

  return canvasTex("felt", scene, S, S, (c) => {
    c.fillStyle = "#0b4a2c"; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 90000; i++) {
      c.fillStyle = `rgba(${rnd(0, 40)},${rnd(60, 130)},${rnd(40, 90)},.05)`;
      c.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    // vignettage du feutre
    const g = c.createRadialGradient(S / 2, S / 2, S * 0.15, S / 2, S / 2, S * 0.52);
    g.addColorStop(0, "rgba(255,255,255,.05)"); g.addColorStop(1, "rgba(0,0,0,.35)");
    c.fillStyle = g; c.fillRect(0, 0, S, S);

    c.textAlign = "center"; c.textBaseline = "middle";
    const text = (t, x, z, size, alpha = 0.85, weight = "600", font = "Georgia,serif") => {
      const [px, py] = P(x, z);
      c.save(); c.translate(px, py); c.scale(SQUASH, 1);
      c.fillStyle = `rgba(240,225,180,${alpha})`;
      c.font = `${weight} ${size}px ${font}`;
      c.fillText(t, 0, 0); c.restore();
    };
    // arcs concentriques centrés sur le croupier
    const arc = (rad, alpha, lw) => {
      c.save(); c.beginPath();
      c.ellipse(...P(0, -RZ * 0.98), rad * PX, rad * PZ, 0, 0, Math.PI * 2);
      c.strokeStyle = `rgba(240,225,180,${alpha})`; c.lineWidth = lw; c.stroke(); c.restore();
    };
    arc(0.86, 0.5, 6); arc(1.55, 0.45, 6);

    text("BLACKJACK  PAYS  3  TO  2", 0, -0.13, 92, 0.9, "700");
    text("Dealer must draw to 16 and stand on all 17's", 0, -0.02, 48, 0.6);
    text("INSURANCE  PAYS  2  TO  1", 0, 0.30, 54, 0.7);
    text("LE MIRAGE", 0, -0.72, 120, 0.13, "700", "'Futura',sans-serif");

    // cercles de mise, exactement sous les emplacements de mise
    for (const s of seats) {
      const [px, py] = P(s.betSpot.x, s.betSpot.z);
      c.beginPath(); c.ellipse(px, py, 0.085 * PX, 0.085 * PZ, 0, 0, Math.PI * 2);
      c.strokeStyle = "rgba(240,225,180,.75)"; c.lineWidth = 7; c.stroke();
      c.beginPath(); c.ellipse(px, py, 0.068 * PX, 0.068 * PZ, 0, 0, Math.PI * 2);
      c.strokeStyle = "rgba(240,225,180,.3)"; c.lineWidth = 4; c.stroke();
    }
  });
}

/* --------------------------------------------------------------- table */

/** @param {number} idx index de la table (0..2) — ancre LAYOUT.blackjack[idx] */
export function buildBlackjack(scene, world, audio, chips, cards, ui, state_, people, idx = 0) {
  const state = state_;
  const P = LAYOUT[idx ? "blackjack" + idx : "blackjack"];
  const root = new B.TransformNode("bjRoot" + (idx || ""), scene);
  root.position = P.clone();
  root.rotation.y = -Math.PI / 2;   // le croupier a le dos à la scène (+X monde)

  const RX = 1.62, RZ = 1.15;   // demi-axes de l'ovale
  const SEAT_DA = 0.42;         // écart angulaire entre deux places
  const CARD_K = 0.46;          // rayon (fraction d'axe) où se posent les cartes

  // Placement ELLIPTIQUE (la table est un ovale : un rayon constant sortirait du feutre)
  const SEATS = [];
  const onEllipse = (a, k, y) => V3(Math.sin(a) * RX * k, y, Math.cos(a) * RZ * k);
  for (let i = 0; i < 5; i++) {
    const a = (-2 + i) * SEAT_DA;              // angle autour de l'axe +Z local
    SEATS.push({
      i, a,
      chair: onEllipse(a, 1.5, 0),
      cardSpot: onEllipse(a, CARD_K, TOP_Y + 0.006),
      betSpot: onEllipse(a, 0.60, TOP_Y + 0.01),
      // la réserve du joueur, RAPPROCHÉE du cercle (0,86 -> 0,76) : à 0,86
      // elle vivait sous le bord bas du cadre assis, on gagnait sans jamais
      // voir ses jetons. 0,76 garde 18 cm d'écart avec le cercle — au-dessus
      // du rayon de détection chipsNear (0,17), les tris restent justes.
      chipSpot: onEllipse(a, 0.76, TOP_Y + 0.01),
    });
  }

  const woodMat = pbr("bjWood", scene, { color: C3(0.16, 0.07, 0.03), roughness: 0.22, metallic: 0.1 });
  const feltMat = pbr("bjFelt", scene, { color: C3(1, 1, 1), roughness: 0.95 });
  feltMat.baseTexture = feltTexture(scene, RX, RZ, SEATS);
  const railMat = pbr("bjRail", scene, { color: C3(0.22, 0.05, 0.07), roughness: 0.55 });

  // plateau
  const topM = B.MeshBuilder.CreateCylinder("bjTop", { height: 0.09, diameter: 2, tessellation: 64 }, scene);
  topM.parent = root; topM.position.y = TOP_Y - 0.045;
  topM.scaling = V3(RX, 1, RZ);
  topM.material = feltMat; topM.receiveShadows = true;

  // boudin de rebord
  const rail = B.MeshBuilder.CreateTorus("bjRailM", { diameter: 2, thickness: 0.14, tessellation: 64 }, scene);
  rail.parent = root; rail.position.y = TOP_Y - 0.01;
  rail.scaling = V3(RX * 1.005, 1, RZ * 1.007);
  rail.material = railMat;

  // ceinture bois + pied
  const skirt = B.MeshBuilder.CreateCylinder("skirt", { height: 0.28, diameter: 2, tessellation: 64 }, scene);
  skirt.parent = root; skirt.position.y = TOP_Y - 0.22;
  skirt.scaling = V3(RX * 0.99, 1, RZ * 0.99);
  skirt.material = woodMat;
  const ped = B.MeshBuilder.CreateCylinder("bjPed", { height: 0.66, diameterTop: 0.4, diameterBottom: 0.75, tessellation: 32 }, scene);
  ped.parent = root; ped.position.y = 0.33; ped.material = woodMat;
  const foot = B.MeshBuilder.CreateCylinder("bjFoot", { height: 0.06, diameter: 1.1, tessellation: 32 }, scene);
  foot.parent = root; foot.position.y = 0.03; foot.material = woodMat;
  [topM, rail, skirt, ped].forEach(m => world.shadowGens.forEach(sg => sg.addShadowCaster(m)));

  // Collision OVALE, comme le plateau : la boîte englobante d'avant débordait
  // de ~35 cm à chaque coin — quatre angles fantômes par table, douze au pit.
  const col = B.MeshBuilder.CreateCylinder("bjCol", { height: TOP_Y, diameter: 2, tessellation: 24 }, scene);
  col.scaling = V3(RX * 1.02, 1, RZ * 1.02);
  col.parent = root; col.position.y = TOP_Y / 2; col.isVisible = false; col.checkCollisions = true;

  root.computeWorldMatrix(true);
  const toWorld = (l) => B.Vector3.TransformCoordinates(l, root.getWorldMatrix());

  // Surface physique — corps STATIQUES NON PARENTÉS (Havok ignore les transforms
  // parents à la création : on place tout en coordonnées monde).
  const physTop = B.MeshBuilder.CreateBox("bjPhys", { width: RX * 2.02, height: 0.1, depth: RZ * 2.02 }, scene);
  physTop.position = toWorld(V3(0, TOP_Y - 0.05, 0));
  physTop.rotation.y = root.rotation.y;
  physTop.isVisible = false;
  physTop.computeWorldMatrix(true);
  new B.PhysicsAggregate(physTop, B.PhysicsShapeType.BOX, { mass: 0, restitution: 0.06, friction: 0.85 }, scene);

  // rebord physique invisible : les jetons ne tombent pas de la table
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const w = B.MeshBuilder.CreateBox("bjEdge", { width: 0.3, height: 0.16, depth: 0.05 }, scene);
    w.position = toWorld(V3(Math.sin(a) * RX * 1.0, TOP_Y + 0.06, Math.cos(a) * RZ * 1.0));
    w.rotation.y = root.rotation.y + a;
    w.isVisible = false;
    w.computeWorldMatrix(true);
    new B.PhysicsAggregate(w, B.PhysicsShapeType.BOX, { mass: 0, restitution: 0.1, friction: 0.7 }, scene);
  }

  /* ---------------- places ---------------- */
  // Les places occupées par un figurant ne sont pas proposées aux joueurs.
  // Tout le reste est libre : chacun s'assoit où il veut, et `playerSeat` suit.
  const NPC_SEATS = [0];
  let PLAYER_SEAT = 2;

  // chaises
  const chairCols = [];
  const chairMat = pbr("chairM", scene, { color: C3(0.3, 0.05, 0.08), roughness: 0.72 });
  const chairWood = pbr("chairW", scene, { color: C3(0.18, 0.09, 0.04), roughness: 0.4, metallic: 0.1 });
  for (const s of SEATS) {
    const g = new B.TransformNode("chair", scene);
    g.parent = root; g.position = s.chair.clone();
    g.rotation.y = s.a;
    const seat = B.MeshBuilder.CreateBox("cs", { width: 0.46, height: 0.1, depth: 0.44 }, scene);
    seat.parent = g; seat.position.y = 0.73; seat.material = chairMat;
    const back = B.MeshBuilder.CreateBox("cb", { width: 0.44, height: 0.26, depth: 0.08 }, scene);
    back.parent = g; back.position.set(0, 0.93, 0.22); back.material = chairMat;
    for (const [dx, dz] of [[-0.18, -0.16], [0.18, -0.16], [-0.18, 0.16], [0.18, 0.16]]) {
      const l = B.MeshBuilder.CreateCylinder("cl", { height: 0.71, diameter: 0.05 }, scene);
      l.parent = g; l.position.set(dx, 0.355, dz); l.material = chairWood;
    }
    // repose-pieds, comme sur les vraies chaises hautes de casino
    const rail = B.MeshBuilder.CreateBox("cr", { width: 0.4, height: 0.035, depth: 0.035 }, scene);
    rail.parent = g; rail.position.set(0, 0.28, -0.16); rail.material = chairWood;
    world.shadowGens.forEach(sg => { sg.addShadowCaster(seat); sg.addShadowCaster(back); });
    // collision douce
    const cc = B.MeshBuilder.CreateBox("chairCol", { width: 0.5, height: 0.6, depth: 0.5 }, scene);
    cc.parent = g; cc.position.y = 0.3; cc.isVisible = false;
    // Solide par défaut, mais on ouvre la chaise que le joueur occupe : en se
    // levant, la caméra se retrouve À la position du siège, donc dans la boîte
    // — il y restait coincé. Réactivée dès qu'il s'en est éloigné (voir tick).
    // Chaises NON solides : avec trois tables au pit, quinze boîtes de
    // collision transformaient l'allée en labyrinthe invisible. Le plateau,
    // lui, reste solide — c'est lui qu'on ne doit pas traverser.
    cc.checkCollisions = false;
    chairCols[s.i] = cc;
  }

  /* ---------------- sabot, corbeille, rack du croupier ---------------- */
  const shoePos = V3(-0.95, TOP_Y + 0.005, -0.62);
  const shoe = new B.TransformNode("shoe", scene);
  shoe.parent = root; shoe.position = shoePos.clone(); shoe.rotation.y = 0.5;
  const shoeMat = pbr("shoeM", scene, { color: C3(0.09, 0.07, 0.06), roughness: 0.35, metallic: 0.2 });
  const sBody = B.MeshBuilder.CreateBox("sb", { width: 0.14, height: 0.13, depth: 0.24 }, scene);
  sBody.parent = shoe; sBody.position.y = 0.065; sBody.material = shoeMat;
  const sRamp = B.MeshBuilder.CreateBox("sr", { width: 0.14, height: 0.02, depth: 0.2 }, scene);
  sRamp.parent = shoe; sRamp.position.set(0, 0.055, 0.2); sRamp.rotation.x = 0.35; sRamp.material = shoeMat;
  world.shadowGens.forEach(sg => sg.addShadowCaster(sBody));
  const shoeExit = V3(shoePos.x, TOP_Y + 0.06, shoePos.z + 0.24);

  const discard = B.MeshBuilder.CreateBox("discard", { width: 0.13, height: 0.1, depth: 0.2 }, scene);
  discard.parent = root; discard.position.set(0.95, TOP_Y + 0.05, -0.62); discard.material = shoeMat;

  // rack de jetons du croupier (décor)
  const rack = B.MeshBuilder.CreateBox("rack", { width: 0.66, height: 0.06, depth: 0.2 }, scene);
  rack.parent = root; rack.position.set(0, TOP_Y + 0.03, -0.86); rack.material = shoeMat;
  const rackCols = [C3(0.95, 0.95, 0.92), C3(0.12, 0.48, 0.3), C3(0.08, 0.08, 0.1), C3(0.36, 0.2, 0.64), C3(0.72, 0.57, 0.19)];
  const rackMats = rackCols.map((c, i) => pbr("rcM" + i, scene, { color: c, roughness: 0.5 }));
  for (let r = 0; r < 5; r++) {
    for (let k = 0; k < 12; k++) {
      const c = B.MeshBuilder.CreateCylinder("rc", { height: CHIP_H, diameter: 0.042, tessellation: 14 }, scene);
      c.parent = root;
      c.position.set(-0.26 + r * 0.13, TOP_Y + 0.062 + k * (CHIP_H + 0.0002), -0.86);
      c.material = rackMats[r];
    }
  }

  /* ---------------- personnages ---------------- */
  const dealer = people.spawn(toWorld(V3(0, 0, -1.52)), root.rotation.y + Math.PI,
    { sex: "m", uniform: true, role: "dealer", height: 1.76 });
  const npcs = [];
  // Un seul figurant : les autres places sont laissées libres pour les joueurs
  // connectés. La place 2 reste celle du joueur local (PLAYER_SEAT).
  for (const i of [0]) {
    const s = SEATS[i];
    const w = toWorld(s.chair);
    // s.a place la chaise sur l'arc ; PAS de +π ici : ce demi-tour compensait
    // en douce l'orientation inversée des kits Ready Player Me, normalisée
    // depuis dans People.load (kit.flip). Yaw en convention -Z, comme partout.
    const n = people.spawn(V3(w.x, 0, w.z), root.rotation.y + s.a,
      { seated: true, seatY: 0.79, height: rnd(1.76, 1.88), sex: i % 2 ? "m" : "f", poseId: "bj-place" + i });
    npcs.push({ npc: n, seat: s, hand: [], bet: 0, betChips: [], stack: [], done: false, cash: rndInt(600, 4000) });
  }

  // suit la place choisie : cartes, mises et piles de jetons s'y rattachent
  let playerSeat = SEATS[PLAYER_SEAT];

  /* ------------------------------------------------ LA BANQUE VISIBLE
   * La pile devant le joueur vaut EXACTEMENT son portefeuille (me.cash) :
   * une colonne par valeur de jeton, alignée sur le rail. Les mises prennent
   * le VRAI jeton en haut de la bonne colonne, les gains atterrissent sur la
   * colonne de leur valeur, et bankSync (appelé à chaque état serveur) répare
   * tout écart — débits sans jetons (assurance, double), monnaie à rendre.
   * `count` est le registre ENGAGÉ (vols compris, cf. betLedger) ; `meshes`
   * ne liste que les jetons déjà matérialisés, dans l'ordre des étages.
   * bankBreakdown() borne à 40 jetons : au-delà la pile plafonne, assumé. */
  const bank = { meshes: new Map(), count: new Map(), built: false };
  const bcol = (v) => { let l = bank.meshes.get(v); if (!l) bank.meshes.set(v, l = []); return l; };
  const bcount = (v) => bank.count.get(v) || 0;
  // LES MÊMES VALEURS QUE LE HUD (et que la décomposition serveur des mises) :
  // pas de jeton de 1000 à la table, il n'existe qu'au guichet.
  const BANK_VALS = [5, 25, 100, 500];
  /**
   * Décompose un montant FAÇON JOUEUR : beaucoup de petits jetons, le moins
   * possible de gros — 2500 € donne 2×500 + 12×100 + 10×25 + 10×5, pas 5×500.
   * Chaque étage prend son quota en laissant un reste divisible par l'étage
   * supérieur (l'exactitude au jeton de 5 près est garantie) ; au-delà de
   * 40 jetons au total, les petits refusionnent vers le haut.
   */
  function bankBreakdown(amount) {
    amount = Math.floor(Math.max(0, amount) / 5) * 5;
    const n = { 5: 0, 25: 0, 100: 0, 500: 0 };
    // [valeur, groupe (= 1 jeton du dessus), quota de colonne]
    for (const [v, g, q] of [[5, 5, 14], [25, 4, 11], [100, 5, 12]]) {
      const min = (amount % (v * g)) / v;              // l'appoint obligatoire
      const k = Math.max(0, Math.min(Math.floor((q - min) / g),
        Math.floor((Math.floor(amount / v) - min) / g)));
      n[v] = min + g * k;
      amount -= n[v] * v;
    }
    n[500] = Math.floor(amount / 500);
    const tot = () => n[5] + n[25] + n[100] + n[500];
    while (tot() > 40) {
      if (n[100] >= 5) { n[100] -= 5; n[500]++; }
      else if (n[25] >= 4) { n[25] -= 4; n[100]++; }
      else if (n[5] >= 5) { n[5] -= 5; n[25]++; }
      else break;
    }
    // au-delà du représentable (~20 000 €), la colonne de 500 plafonne : la
    // pile ne montre plus TOUT le portefeuille, bankSync vise la même borne
    n[500] = Math.min(n[500], Math.max(0, 40 - n[5] - n[25] - n[100]));
    const out = [];
    for (const v of [...BANK_VALS].reverse()) for (let i = 0; i < n[v]; i++) out.push(v);
    return out;
  }

  /**
   * Décompose un GAIN dans la monnaie de la mise : misé en 25, payé en 25 ;
   * misé en 100, payé en 100. `unit` = le plus gros jeton misé dans la manche.
   * L'appoint (blackjack 3:2…) descend en jetons plus petits ; si le paiement
   * demandait plus de 14 jetons, on s'autorise la valeur supérieure.
   */
  function payoutBreakdown(gain, unit) {
    gain = Math.floor(Math.max(0, gain) / 5) * 5;
    let hi = Math.max(0, BANK_VALS.indexOf(unit));
    for (;;) {
      const out = [];
      let r = gain;
      for (let k = hi; k >= 0; k--) {
        const v = BANK_VALS[k];
        while (r >= v && out.length < 40) { out.push(v); r -= v; }
      }
      if ((r > 0 || out.length > 14) && hi < BANK_VALS.length - 1) { hi++; continue; }
      return out;
    }
  }

  /** Pied de la colonne d'une valeur, sur le rail de la place du joueur. */
  function bankColXZ(v) {
    const cs = toWorld(playerSeat.chipSpot);
    const dirX = Math.cos(root.rotation.y + playerSeat.a);
    const dirZ = -Math.sin(root.rotation.y + playerSeat.a);
    const k = Math.max(0, BANK_VALS.indexOf(v));
    const off = (k - 1.5) * 0.052;
    return { x: cs.x + dirX * off, z: cs.z + dirZ * off };
  }

  /** Réserve l'étage suivant d'une colonne ; rend la position cible du jeton. */
  function bankReserve(v) {
    const n = bcount(v);
    bank.count.set(v, n + 1);
    const p = bankColXZ(v);
    return V3(p.x + rnd(-0.0015, 0.0015), TOP_Y + CHIP_H / 2 + n * CHIP_H,
      p.z + rnd(-0.0015, 0.0015));
  }
  /** Matérialise un jeton dans sa colonne (appeler quand le vol démarre). */
  function bankRegister(c) { c.metadata.keep = true; bcol(c.metadata.value).push(c); }

  /** Prend le jeton du HAUT d'une colonne pour miser ; null si indisponible. */
  function bankTake(v) {
    const l = bank.meshes.get(v);
    // un jeton réservé mais pas encore matérialisé est en vol : on n'y touche pas
    if (!l || !l.length || l.length < bcount(v)) return null;
    const c = l.pop();
    bank.count.set(v, bcount(v) - 1);
    if (c.isDisposed()) return null;
    c.metadata.keep = false;
    return c;
  }

  /** Fait pleuvoir des jetons du râtelier du croupier sur leurs colonnes. */
  function bankAdd(values, { start = 260, delay = 85 } = {}) {
    const from = toWorld(V3(0, TOP_Y + 0.16, -0.74));
    values.forEach((v, i) => {
      const dst = bankReserve(v);
      setTimeout(() => {
        const c = chips.spawn(v, V3(from.x + rnd(-0.07, 0.07), from.y, from.z + rnd(-0.03, 0.03)));
        bankRegister(c);
        chips.toss(c, dst, { arc: 0.3 });
      }, start + i * delay);
    });
  }

  /**
   * Décompose une MONNAIE À RENDRE en tenant compte des colonnes déjà en
   * place : chaque valeur ne prend que ce qui reste de son quota (celui de
   * bankBreakdown), le surplus monte en gros jetons. Décomposer l'appoint
   * façon bankBreakdown regonflait la colonne de 5 à chaque pluie — les
   * piles doivent rester à peu près équilibrées entre elles.
   */
  function rainBreakdown(amount) {
    amount = Math.floor(Math.max(0, amount) / 5) * 5;
    const n = { 5: 0, 25: 0, 100: 0, 500: 0 };
    for (const [v, g, q] of [[5, 5, 14], [25, 4, 11], [100, 5, 12]]) {
      const min = (amount % (v * g)) / v;              // l'appoint obligatoire
      const room = Math.max(0, q - bcount(v) - min);   // ce que la colonne accepte encore
      const k = Math.max(0, Math.min(Math.floor(room / g),
        Math.floor((Math.floor(amount / v) - min) / g)));
      n[v] = min + g * k;
      amount -= n[v] * v;
    }
    n[500] = Math.floor(amount / 500);
    const out = [];
    for (const v of [...BANK_VALS].reverse()) for (let i = 0; i < n[v]; i++) out.push(v);
    return out;
  }

  /** Bâtit la banque d'un coup (à l'assise), sans animation. */
  function bankBuild(cash) {
    bank.built = true;
    const byV = new Map();
    for (const v of bankBreakdown(Math.max(0, Math.floor(cash)))) byV.set(v, (byV.get(v) || 0) + 1);
    for (const [v, n] of byV) {
      const p = bankColXZ(v);
      bank.count.set(v, n);
      for (const c of chips.stack(v, n, p.x, p.z, TOP_Y)) bankRegister(c);
    }
  }

  /** Vide la banque (départ ou changement de place). */
  function bankClear(animate) {
    const all = [];
    for (const l of bank.meshes.values())
      for (const c of l) if (!c.isDisposed()) { c.metadata.keep = false; all.push(c); }
    bank.meshes.clear(); bank.count.clear(); bank.built = false;
    if (!all.length) return;
    if (animate) chips.sweep(all, toWorld(playerSeat.chair).add(V3(0, 1.1, 0)));
    else all.forEach((c) => {
      const i = chips.pool.indexOf(c);
      if (i >= 0) chips.pool.splice(i, 1);
      c.metadata.agg?.dispose(); c.dispose();
    });
  }

  /**
   * Rapproche la banque du portefeuille. On ne corrige que l'ÉCART DE VALEUR
   * (assurance, double, appoint impossible sur une mise, dépôt au guichet) —
   * exiger la répartition idéale au jeton près ferait échanger des jetons à
   * chaque manche. Seule exception : une colonne de petits qui déborde est
   * refusionnée en jetons supérieurs (le croupier fait de la monnaie).
   */
  function bankSync(cash) {
    if (!bank.built) return;
    // la cible est ce que la pile PEUT montrer (bankBreakdown plafonne) —
    // viser le cash brut au-delà de la borne ferait pleuvoir sans fin
    cash = bankBreakdown(cash).reduce((s, v) => s + v, 0);
    const excess = [], rain = [];
    let need = -cash;
    for (const v of BANK_VALS) need += v * bcount(v);   // > 0 : banque trop riche
    // l'appoint exact d'abord, en partant des grosses colonnes…
    for (const v of [...BANK_VALS].reverse()) {
      while (need >= v) { const c = bankTake(v); if (!c) break; excess.push(c); need -= v; }
    }
    // …sinon on casse un jeton et la monnaie sera rendue en pluie
    for (const v of BANK_VALS) {
      while (need > 0) { const c = bankTake(v); if (!c) break; excess.push(c); need -= v; }
      if (need <= 0) break;
    }
    if (need < 0) rain.push(...rainBreakdown(-need));
    // colonnes qui débordent : dès qu'une colonne dépasse son quota de
    // bankBreakdown d'un groupe entier, le croupier fait de la monnaie jusqu'à
    // la ramener AU quota — pas juste sous le seuil de déclenchement, sinon la
    // colonne de 5 plafonnait à 22 jetons quand les autres en montraient dix.
    // La marge d'un groupe reste ce qui évite l'échange à chaque manche.
    for (const [v, g, q] of [[5, 5, 14], [25, 4, 11], [100, 5, 12]]) {
      if (bcount(v) < q + g) continue;
      while (bcount(v) > q
        && (bank.meshes.get(v)?.length ?? 0) === bcount(v)) {
        for (let j = 0; j < g; j++) { const c = bankTake(v); if (c) excess.push(c); }
        rain.push(v * g);
      }
    }
    if (excess.length) chips.sweep(excess, rackWorld());
    if (rain.length) bankAdd(rain, { start: excess.length ? 500 : 180 });
  }

  // jetons décoratifs devant les PNJ : les VRAIS matériaux texturés de
  // chips.js (une valeur par colonne), en colonnes nettes alignées sur le
  // rail comme la banque du joueur — sans physique, c'est du décor
  for (const p of npcs) {
    const cs = toWorld(p.seat.chipSpot);
    const dirX = Math.cos(root.rotation.y + p.seat.a);
    const dirZ = -Math.sin(root.rotation.y + p.seat.a);
    const vals = [...BANK_VALS].sort(() => rnd(-1, 1)).slice(0, rndInt(2, 3));
    vals.forEach((v, col) => {
      const off = (col - (vals.length - 1) / 2) * 0.052;
      for (let k = 0, n = rndInt(2, 6); k < n; k++) {
        const c = B.MeshBuilder.CreateCylinder("nc", {
          height: CHIP_H, diameter: CHIP_R * 2, tessellation: 28,
          faceUV: chips._faceUV, cap: B.Mesh.CAP_ALL,
        }, scene);
        c.material = chips.templates.get(v);
        c.position = V3(cs.x + dirX * off + rnd(-0.0015, 0.0015),
          TOP_Y + CHIP_H / 2 + k * CHIP_H,
          cs.z + dirZ * off + rnd(-0.0015, 0.0015));
        c.rotation.y = rnd(0, 6.28);
        c.receiveShadows = true;
        world.shadowGens.forEach(sg => sg.addShadowCaster(c));
      }
    });
  }

  // une zone d'interaction PAR place libre, chacune porteuse de son index et
  // d'un identifiant stable partagé sur le réseau
  const seatHits = [];
  for (const s of SEATS) {
    if (NPC_SEATS.includes(s.i)) continue;
    const h = B.MeshBuilder.CreateBox("bjHit" + s.i, { width: 0.8, height: 1.8, depth: 0.8 }, scene);
    const w = toWorld(s.chair);
    h.position = V3(w.x, 0.9, w.z);
    h.isVisible = false;
    h.metadata = {
      interact: "blackjack", seat: s.i, table: idx,
      spot: "blackjack:" + idx + ":" + s.i,
      label: "S'asseoir à la table de blackjack",
    };
    seatHits.push(h);
  }

  /* ---------------- sabot logique ---------------- */
  let shoeCards = [];
  function newShoe() {
    shoeCards = [];
    for (let d = 0; d < 6; d++)
      for (let s = 0; s < 4; s++)
        for (const r of RANKS) shoeCards.push({ rank: r, suit: s });
    for (let i = shoeCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shoeCards[i], shoeCards[j]] = [shoeCards[j], shoeCards[i]];
    }
    // Volontairement muet ici : `tableVol` n'existe pas encore au moment de
    // l'appel de construction ci-dessous (zone morte du const), et surtout les
    // trois tables du pit mélangeaient leur sabot à plein volume au chargement.
    // Le remélange en cours de partie, lui, sonne — via l'événement "shuffle".
  }
  newShoe();

  /* ---------------- état de la partie ---------------- */
  const G = {
    phase: "idle",       // idle | betting | dealing | player | dealer | payout
    bet: 0,
    betChips: [],
    hand: [],
    dealerHand: [],
    tableCards: [],
    doubled: false,
    seated: false,
  };

  function clearTable() {
    // une carte en train de brûler se détruit toute seule : la balayer ici la
    // ferait glisser vers la défausse au milieu de sa combustion
    G.tableCards.filter((c) => !c._burning && !c.body.isDisposed()).forEach((c) => {
      c._animated();
      animVec(scene, c.body, "position", c.body.position, toWorld(V3(0.95, TOP_Y + 0.12, -0.62)), 20,
        undefined, () => c.dispose());
    });
    G.tableCards = [];
    G.hand = []; G.dealerHand = [];
    npcs.forEach((p) => (p.hand = []));
    setTimeout(() => audio.cardTap(tableVol()), 260);
  }

  /** Sort une carte du sabot et l'envoie vers une place. */
  function dealCard(targetLocal, faceUp, spread, opt = {}) {
    // `opt.card` : carte imposée par le serveur. Le sabot local ne sert plus
    // qu'en repli, quand aucune table distante n'est branchée.
    if (shoeCards.length < 40) newShoe();
    const cd = opt.card || shoeCards.pop();
    const start = toWorld(shoeExit);
    const c = cards.create(cd.rank, cd.suit, start, false);
    // La cible vit SUR la carte : une carte qui arrive resserre l'éventail
    // (`relayoutHand`), et celles encore en vol doivent se poser à la nouvelle
    // place, pas à celle calculée au moment du lancer.
    c._tgtLocal = targetLocal.add(V3(spread.x, 0.004 + spread.y + (opt.lift || 0), spread.z));
    c._lift = opt.lift || 0; c._tilt = opt.tilt || 0;
    // Orientée pour être lue depuis SA place (`seatA` = angle du siège sur
    // l'ovale) : avec la seule rotation de table, toutes les mains étaient
    // cadrées pour la place centrale — en bord, ses propres cartes
    // apparaissaient tournées de ~45°.
    const rotY = root.rotation.y + (opt.seatA || 0) + rnd(-0.09, 0.09);
    c._rotY = rotY;

    // `opt.delay` échelonne le lancer : la carte est créée tout de suite mais
    // reste dans le sabot jusqu'à son tour. C'est ce qui rend la donne lisible
    // — et audible, un « tac » par carte au lieu de tous en même temps.
    //
    // Le corps naît DYNAMIQUE et tomberait du sabot pendant l'attente : on le
    // fige en ANIMATED, `deal()` le rebascule en dynamique au moment du lancer.
    const launch = () => {
      if (c.body.isDisposed()) return;
      const T = c.deal(toWorld(c._tgtLocal), 1);
      setTimeout(() => {
        if (c.body.isDisposed()) return;
        c._settled = true;
        c.settle(toWorld(c._tgtLocal), rotY, faceUp, 14, opt.tilt || 0);
        // les cartes du joueur respirent légèrement (aspect organique de près)
        if (opt.wave) c.setBend(rnd(0.0016, 0.0028), rnd(-0.0008, 0.0008), 0.0009);
      }, T * 1000 + 90);
    };
    if (opt.delay > 0) { c._animated(); setTimeout(launch, opt.delay); }
    else launch();

    G.tableCards.push(c);
    c.rank = cd.rank; c.suit = cd.suit;
    return c;
  }

  // Depuis la caméra de plateau FIXE, toutes les cartes se posent À PLAT sur
  // le feutre — le relevage "Inscryption" vers un œil au ras de la table datait
  // de la caméra première personne et faisait flotter les cartes en l'air.
  const PLAYER_CARD = { wave: true };   // la respiration organique, elle, reste
  const DEALER_CARD = {};

  // ÉVENTAIL BORNÉ. Chaque main tient dans le quartier de sa place : elle
  // s'ouvre EN ANGLE autour de la place (donc en suivant l'ovale) et le pas se
  // resserre dès qu'elle déborderait. Avant, chaque carte partait de 7 cm en
  // ligne droite toujours du même côté : deux places n'étant espacées que de
  // ~28 cm, la 4e carte d'un joueur atterrissait sur le tapis du voisin.
  const FAN_STEP = 0.10;        // pas angulaire nominal (rad) ≈ 7 cm d'arc
  const FAN_HALF = 0.11;        // demi-ouverture maximale d'une main (rad)
  const SPLIT_K = [0.52, 0.38]; // mains séparées : décalées EN PROFONDEUR

  const isSplit = (seatIdx) => seatCards.has(seatIdx + ":1");
  const handK = (h, split) => (split ? SPLIT_K[h ? 1 : 0] : CARD_K);

  /** Décalage d'une carte par rapport au centre de sa main. */
  function handSpread(seat, i, count = i + 1, h = 0, split = false) {
    const n = Math.max(1, count);
    const step = n > 1 ? Math.min(FAN_STEP, (2 * FAN_HALF) / (n - 1)) : FAN_STEP;
    const da = (i - (n - 1) / 2) * step;        // éventail CENTRÉ sur la place
    const k = handK(h, split);
    const p = onEllipse(seat.a + da, k, 0), base = onEllipse(seat.a, k, 0);
    return V3(p.x - base.x, i * 0.005, p.z - base.z);   // étagement net en hauteur
  }

  /** Même logique pour le croupier, qui n'est pas sur l'ovale : en ligne. */
  function dealerSpread(i, count = i + 1) {
    const n = Math.max(1, count);
    const step = n > 1 ? Math.min(0.07, 0.48 / (n - 1)) : 0.07;
    return V3((i - (n - 1) / 2) * step, i * 0.005, 0);
  }

  /**
   * Recalcule la pose de TOUTE une main : le pas dépend du nombre de cartes,
   * donc l'arrivée d'une carte resserre celles déjà posées. Les cartes encore
   * en vol ne sont pas touchées — elles liront leur cible mise à jour en se
   * posant (cf. `_tgtLocal` dans `dealCard`).
   */
  function relayoutHand(seatIdx, h = 0) {
    const hand = G.tableCards.filter((c) => c._seat === seatIdx
      && (c._h || 0) === h && !c._burning && !c.body.isDisposed());
    if (!hand.length) return;
    const dealer = seatIdx === "dealer";
    const seat = dealer ? null : (SEATS[seatIdx] || playerSeat);
    const split = !dealer && isSplit(seatIdx);
    const base = spotFor(seatIdx, h);
    hand.forEach((c, i) => {
      const sp = dealer ? dealerSpread(i, hand.length)
        : handSpread(seat, i, hand.length, h, split);
      c._tgtLocal = base.add(V3(sp.x, 0.004 + sp.y + (c._lift || 0), sp.z));
      if (c._settled) c.settle(toWorld(c._tgtLocal), c._rotY, c.faceUp, 16, c._tilt || 0);
    });
  }

  /* ---------------- mises ---------------- */



  /* ---------------- déroulé d'un coup ---------------- */

  const upValue = () => cardValue(G.dealerHand[0].rank);

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








  /* ---------------- miroir de la table serveur ---------------- */

  // Rendu piloté par le serveur : on ne calcule plus rien, on met en scène ce
  // qui est arrivé. La photo (`state`) sert au cadrage et à l'affichage des
  // totaux ; les `events` déclenchent les animations.
  let myNetId = null;
  const seatCards = new Map();          // index de place -> nb de cartes posées
  let dealerCount = 0, holeCard = null;

  // chrono de phase : le serveur donne msLeft/msTotal, on interpole entre deux
  // photos pour que la jauge coule au lieu de sauter de trame en trame
  const timer = { deadline: 0, total: 1, show: false, mine: false, lastSec: -1,
    // sursis en cours : la jauge passe au blanc-or et cesse de rougir — ce
    // n'est plus le temps qui manque, c'est la réserve qui brûle
    bank: false };

  // Les totaux (réticules AR + HUD) sont retenus tant qu'une carte est en vol :
  // la photo serveur arrive AVANT que la carte atterrisse, et afficher "19"
  // pendant que la carte plane encore éventait le tirage.
  let settleUntil = 0, valTimer = null;

  function spotFor(seatIdx, h = 0) {
    if (seatIdx === "dealer") return V3(0, TOP_Y + 0.006, -0.16);
    const s = SEATS[seatIdx];
    if (!s) return V3(0, TOP_Y + 0.006, 0);
    // Mains séparées : décalées EN PROFONDEUR (l'une vers le joueur, l'autre
    // vers le croupier) et non sur le côté — latéralement, 20 cm mettaient la
    // seconde main sur la place d'à côté.
    const split = isSplit(seatIdx);
    if (!split) return s.cardSpot;
    return onEllipse(s.a, handK(h, true), TOP_Y + 0.006);
  }

  /* ---------------- valeurs flottantes (façon Inscryption) ---------------- */

  // Chaque main porte sa valeur en 3D, pastille flottant au-dessus des cartes —
  // le compte se lit sur la table, pas dans un coin d'écran. Crème en jeu,
  // or à 21, rouge au-delà. Le croupier affiche « 10+? » tant que sa carte
  // est cachée : le calcul mental du joueur, rendu visible.
  const badges = new Map();      // "2:0" | "2:1" | "dealer" -> pastille

  const BDG_W = 320, BDG_H = 192;     // texture de la pastille

  function badge(key) {
    let b = badges.get(key);
    if (b) return b;
    const dt = new B.DynamicTexture("bdg" + key, { width: BDG_W, height: BDG_H }, scene, false);
    dt.hasAlpha = true;
    const mat = new B.StandardMaterial("bdgM" + key, scene);
    mat.emissiveTexture = dt;
    mat.opacityTexture = dt;
    mat.disableLighting = true;
    // Mélange NORMAL, plus additif. En additif la pastille ajoutait sa lumière
    // à celle du feutre déjà éclairé : sur fond clair le chiffre saturait à
    // blanc et le bloom ré-amplifiait par-dessus — il éblouissait au lieu de
    // se lire. En alpha classique il reste une projection nette, lisible.
    mat.alphaMode = B.Engine.ALPHA_COMBINE;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    const plane = B.MeshBuilder.CreatePlane("bdgP" + key,
      { width: 0.26, height: 0.26 * BDG_H / BDG_W }, scene);
    plane.material = mat;
    // DEBOUT ET FACE AU JOUEUR. Couchée sur le feutre, la pastille était vue
    // sous ~20° : le chiffre y était écrasé à un quart de sa hauteur, et les
    // cartes lui passaient dessus. Elle flotte maintenant au-dessus de sa main,
    // en billboard vertical — donc jamais déformée, jamais recouverte.
    plane.billboardMode = B.AbstractMesh.BILLBOARDMODE_Y;
    plane.renderingGroupId = 1;        // toujours par-dessus le tapis et les cartes
    plane.isPickable = false;
    b = { plane, dt, sig: "", pop: 0, size: 1 };
    badges.set(key, b);
    return b;
  }

  /**
   * Pastille de valeur : plaque de verre fumé cerclée d'or, crochets de visée,
   * le chiffre au centre. Elle FLOTTE au-dessus de sa main et fait toujours
   * face au joueur (billboard) — le fond sombre lui donne le contraste que le
   * feutre ne donnait pas, et l'altitude la met hors d'atteinte des cartes.
   */
  function setBadge(key, pos, text, color = "#f2e7c8", size = 1) {
    const b = badge(key);
    b.plane.setEnabled(true);
    b.plane.position.copyFrom(pos);
    b.size = size;
    const sig = text + "|" + color;
    if (b.sig === sig) return;
    b.sig = sig;
    const c = b.dt.getContext();
    const W = BDG_W, H = BDG_H, cx = W / 2, cy = H / 2;
    c.clearRect(0, 0, W, H);
    // plaque : le chiffre se lit SUR un fond à lui, plus sur le tapis
    const pw = 200, ph = 118, px = cx - pw / 2, py = cy - ph / 2, r = 18;
    c.beginPath();
    c.moveTo(px + r, py);
    c.arcTo(px + pw, py, px + pw, py + ph, r);
    c.arcTo(px + pw, py + ph, px, py + ph, r);
    c.arcTo(px, py + ph, px, py, r);
    c.arcTo(px, py, px + pw, py, r);
    c.closePath();
    const g = c.createLinearGradient(0, py, 0, py + ph);
    g.addColorStop(0, "rgba(18,12,5,.88)");
    g.addColorStop(1, "rgba(6,4,2,.94)");
    c.fillStyle = g; c.fill();
    c.strokeStyle = color; c.lineWidth = 3;
    c.shadowColor = color; c.shadowBlur = 12;
    c.stroke();
    // crochets de visée, de part et d'autre — l'idiome « réticule » survit
    c.lineWidth = 4; c.shadowBlur = 6;
    for (const dir of [-1, 1]) {
      const x = cx + dir * (pw / 2 + 16);
      c.beginPath();
      c.moveTo(x, cy - 22); c.lineTo(x + dir * 9, cy); c.lineTo(x, cy + 22);
      c.stroke();
    }
    // le chiffre, plein cadre : c'est LUI qu'on vient lire
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = color;
    c.shadowColor = "rgba(0,0,0,.9)"; c.shadowBlur = 8;
    c.font = "700 " + (text.length > 3 ? 62 : text.length > 2 ? 74 : 88)
      + "px 'Futura','Avenir Next',sans-serif";
    c.fillText(text, cx, cy + 4);
    b.dt.update();
    b.pop = 1;                       // le réticule « pope » quand la valeur change
  }

  /* ALTITUDE, RECUL ET ÉCART DES PASTILLES.
   *
   * La pastille vole 9 cm au-dessus du feutre et se pose 22 % plus près du
   * centre que les cartes : à l'écran elle sort par le HAUT de l'éventail, sans
   * jamais l'effleurer — ni toucher la ligne du croupier, plus haut encore.
   *
   * AU SPLIT, tout se complique : les deux mains sont décalées en PROFONDEUR
   * (0,52 et 0,38), donc l'une derrière l'autre vue de la place — deux
   * pastilles au même régime se superposeraient. On les sépare sur les TROIS
   * axes à la fois : un peu en angle (0,14 rad, assez pour trancher, pas assez
   * pour empiéter sur le quartier du voisin, qui commence à 0,42 rad), et
   * surtout en altitude — la main du fond monte plus haut. Réduites à 72 %,
   * elles se lisent alors comme deux étiquettes distinctes.
   */
  // Réglables à chaud pendant une partie (le placement est recalculé à chaque
  // photo serveur) : __game.bj.tuneBadges({ lift: .11, back: .74 }).
  const BDG = {
    lift: 0.09,        // vol au-dessus du feutre, main unique
    back: 0.78,        // recul vers le centre (fraction du rayon carte)
    side: 0.14,        // écart angulaire des mains séparées (rad)
    split: [0.07, 0.16],   // altitude de la main proche / de la main du fond
    small: 0.72,       // taille des pastilles quand la place en porte deux
  };

  /** Point de vol de la pastille : au-dessus de SA main, jamais sur une autre. */
  function arSpot(seatIdx, h) {
    const s = SEATS[seatIdx];
    if (!s) return toWorld(V3(0, TOP_Y + BDG.lift, 0));
    if (!isSplit(seatIdx)) {
      return toWorld(onEllipse(s.a, CARD_K * BDG.back, TOP_Y + BDG.lift));
    }
    return toWorld(onEllipse(s.a + (h ? BDG.side : -BDG.side),
      handK(h, true) * 0.84, TOP_Y + BDG.split[h ? 1 : 0]));
  }

  /** Deux pastilles pour une place : plus petites, pour ne pas se marcher dessus. */
  const badgeSize = (seatIdx) => (isSplit(seatIdx) ? BDG.small : 1);

  const hideBadge = (key) => { const b = badges.get(key); if (b) b.plane.setEnabled(false); };
  const hideAllBadges = () => { for (const k of badges.keys()) hideBadge(k); };
  const badgeColor = (t) => (t > 21 ? "#ff5a45" : t === 21 ? "#ffd76a" : "#f2e7c8");

  /** Chiffre de gain qui jaillit du feutre et s'évapore — dégâts de RPG. */
  function floatText(text, worldPos, color = "#ffd76a") {
    const dt = new B.DynamicTexture("ft", { width: 256, height: 96 }, scene, false);
    dt.hasAlpha = true;
    const c = dt.getContext();
    c.clearRect(0, 0, 256, 96);
    c.textAlign = "center"; c.textBaseline = "middle";
    // La police RÉTRÉCIT pour tenir : « +300 € » et « cagnotte +240 € » ne font
    // pas la même largeur, et un chiffre coupé au bord de la texture ne se
    // lit plus du tout. On mesure, on ajuste, une fois.
    let px = 52;
    c.font = `700 ${px}px Futura,Arial,sans-serif`;
    const w = c.measureText(text).width;
    if (w > 236) {
      px = Math.max(24, Math.floor(px * 236 / w));
      c.font = `700 ${px}px Futura,Arial,sans-serif`;
    }
    c.shadowColor = "rgba(0,0,0,.85)"; c.shadowBlur = 10;
    c.fillStyle = color;
    c.fillText(text, 128, 48);
    dt.update();
    const mat = new B.StandardMaterial("ftM", scene);
    mat.diffuseTexture = dt; mat.emissiveTexture = dt; mat.opacityTexture = dt;
    mat.disableLighting = true; mat.backFaceCulling = false;
    const p = B.MeshBuilder.CreatePlane("ftP", { width: 0.36, height: 0.135 }, scene);
    p.material = mat;
    p.billboardMode = B.AbstractMesh.BILLBOARDMODE_ALL;
    p.renderingGroupId = 1;
    p.isPickable = false;
    p.position.copyFrom(worldPos);
    let e = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      e += scene.getEngine().getDeltaTime() / 1000;
      const k = Math.min(1, e / 1.5);
      p.position.y = worldPos.y + k * 0.36;
      mat.alpha = k < 0.12 ? k / 0.12 : 1 - Math.pow((k - 0.12) / 0.88, 1.6);
      if (k >= 1) {
        scene.onBeforeRenderObservable.remove(obs);
        dt.dispose(); mat.dispose(); p.dispose();
      }
    });
  }

  /** Pluie de confettis dorés — réservée au blackjack naturel. */
  let confetti = null;
  function confettiBurst(seatIdx) {
    if (!confetti) {
      const tex = canvasTex("confettiT", scene, 32, 32, (c) => {
        c.fillStyle = "#fff"; c.fillRect(9, 4, 14, 24);
      });
      const ps = new B.ParticleSystem("confetti", 600, scene);
      ps.particleTexture = tex;
      ps.emitter = V3(0, 0, 0);
      ps.createConeEmitter(0.35, 0.8);
      ps.minSize = 0.014; ps.maxSize = 0.034;
      ps.minLifeTime = 1.2; ps.maxLifeTime = 2.6;
      ps.minEmitPower = 1.5; ps.maxEmitPower = 3.1;
      ps.gravity = V3(0, -3.2, 0);
      ps.minAngularSpeed = -9; ps.maxAngularSpeed = 9;
      ps.minInitialRotation = 0; ps.maxInitialRotation = Math.PI;
      ps.color1 = new B.Color4(1, 0.84, 0.30, 1);
      ps.color2 = new B.Color4(0.93, 0.32, 0.32, 1);
      ps.colorDead = new B.Color4(0.9, 0.7, 0.3, 0);
      ps.emitRate = 0;
      ps.start();
      confetti = ps;
    }
    const st = SEATS[seatIdx];
    const p = st ? toWorld(st.betSpot) : toWorld(V3(0, TOP_Y, 0));
    confetti.emitter = V3(p.x, TOP_Y + 0.85, p.z);
    confetti.manualEmitCount = 220;
  }

  /** Fontaine d'étincelles dorées — jaillit du cercle de mise gagnant. */
  let sparks = null;
  function sparkBurst(seatIdx, power = 1) {
    if (!sparks) {
      const tex = canvasTex("sparkT", scene, 32, 32, (c, w, h) => {
        const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g.addColorStop(0, "rgba(255,250,225,1)");
        g.addColorStop(0.4, "rgba(255,205,90,.9)");
        g.addColorStop(1, "rgba(255,150,20,0)");
        c.fillStyle = g; c.fillRect(0, 0, w, h);
      });
      const ps = new B.ParticleSystem("sparks", 500, scene);
      ps.particleTexture = tex;
      ps.emitter = V3(0, 0, 0);
      ps.createConeEmitter(0.1, 0.4);          // jet serré, presque vertical
      ps.minSize = 0.008; ps.maxSize = 0.022;
      ps.minLifeTime = 0.6; ps.maxLifeTime = 1.5;
      ps.minEmitPower = 2.0; ps.maxEmitPower = 3.8;
      ps.gravity = V3(0, -7, 0);               // monte vite, retombe en pluie
      ps.color1 = new B.Color4(1, 0.9, 0.5, 1);
      ps.color2 = new B.Color4(1, 0.7, 0.2, 1);
      ps.colorDead = new B.Color4(1, 0.4, 0.05, 0);
      ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
      ps.emitRate = 0;
      ps.start();
      sparks = ps;
    }
    const st = SEATS[seatIdx];
    const p = st ? toWorld(st.betSpot) : toWorld(V3(0, TOP_Y, 0));
    sparks.emitter = V3(p.x, TOP_Y + 0.03, p.z);
    sparks.manualEmitCount = Math.round(90 * power);
  }

  /* ---------------- HUD AR ---------------- */

  // Le MESSAGE et le CHRONO ne sont plus un hologramme au-dessus du feutre :
  // ils vivent dans un bandeau FIXE en haut de l'écran (#bjtop, voir
  // index.html) — l'hologramme dérivait avec la caméra et forçait à chercher
  // le texte dans la scène. La MISE reste gravée près du cercle.

  /**
   * LA CAGNOTTE DE SÉRIE, gravée au feutre devant mes jetons.
   *
   * Elle doit être VUE en permanence, pas rappelée par un message qui passe :
   * c'est la somme que le joueur risque à chaque main, et toute la tension de
   * la mécanique tient à ce qu'il l'ait sous les yeux quand il décide de
   * continuer. Braise plutôt qu'or : ce n'est pas encore de l'argent acquis.
   */
  let potAR = null, potARText = null;
  function arPot(v) {
    const text = v > 0 ? "CAGNOTTE  " + fmt(v) + " €" : "";
    if (!potAR && !text) return;
    if (!potAR) {
      const dt = new B.DynamicTexture("arPot" + idx, { width: 512, height: 96 }, scene, false);
      dt.hasAlpha = true;
      const mat = new B.StandardMaterial("arPotM" + idx, scene);
      mat.emissiveTexture = dt; mat.opacityTexture = dt;
      mat.disableLighting = true;
      mat.alphaMode = B.Engine.ALPHA_COMBINE;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;
      const p = B.MeshBuilder.CreatePlane("arPotP" + idx, { width: 0.34, height: 0.064 }, scene);
      p.material = mat;
      p.scaling.x = -1;                 // même correction miroir que les réticules
      p.isPickable = false;
      potAR = { dt, p };
    }
    const st = SEATS[PLAYER_SEAT];
    if (!st || !text || !G.seated) { potAR.p.setEnabled(false); potARText = text; return; }
    // entre le cercle de mise et le bord de table, sous l'étiquette de mise :
    // le regard descend de la main aux jetons et la trouve en chemin
    const out = V3(st.betSpot.x, 0, st.betSpot.z).normalize().scale(0.225);
    potAR.p.position.copyFrom(toWorld(
      V3(st.betSpot.x + out.x, TOP_Y + 0.004, st.betSpot.z + out.z)));
    const topDir = toWorld(V3(0, 0, 0)).subtract(toWorld(st.chair)); topDir.y = 0;
    potAR.p.rotation.set(-Math.PI / 2, Math.atan2(-topDir.x, -topDir.z), 0);
    potAR.p.setEnabled(true);
    if (text !== potARText) {
      potARText = text;
      const c = potAR.dt.getContext();
      c.clearRect(0, 0, 512, 96);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "#ff9a3d";
      c.shadowColor = "#ff6a1a"; c.shadowBlur = 10;
      c.font = "700 46px 'Futura','Avenir Next',sans-serif";
      c.fillText(text, 256, 50);
      potAR.dt.update();
    }
  }

  // la mise, gravée au feutre à côté du cercle
  let betAR = null, betARText = null;
  function arBet(v) {
    const text = v > 0 ? fmt(v) + " €" : "";
    if (!betAR && !text) return;
    if (!betAR) {
      const dt = new B.DynamicTexture("arBet" + idx, { width: 256, height: 96 }, scene, false);
      dt.hasAlpha = true;
      const mat = new B.StandardMaterial("arBetM" + idx, scene);
      mat.emissiveTexture = dt; mat.opacityTexture = dt;
      mat.disableLighting = true;
      mat.alphaMode = B.Engine.ALPHA_COMBINE;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;
      const p = B.MeshBuilder.CreatePlane("arBetP" + idx, { width: 0.22, height: 0.0825 }, scene);
      p.material = mat;
      p.scaling.x = -1;                 // même correction miroir que les réticules
      p.isPickable = false;
      betAR = { dt, p };
    }
    const st = SEATS[PLAYER_SEAT];
    if (!st || !text) { betAR.p.setEnabled(false); betARText = text; return; }
    // Posée entre le cercle de mise et les piles, lisible depuis ma place.
    //
    // DÉCALAGE CONSTANT, pas un facteur d'échelle. Le cercle de mise fait
    // 0,085 m de rayon (feltTexture) et l'étiquette 0,0825 m de haut : il faut
    // donc ~0,13 m entre les deux centres pour que le texte passe SOUS le trait
    // sans le mordre. Un facteur sur betSpot ne le garantit pas — il décale
    // proportionnellement à l'excentricité de la place, si bien qu'un réglage
    // qui dégage le cercle au centre (le plus près du bord de table) poussait
    // les places latérales hors cadre : 1,24 sortait par le côté, 1,12 restait
    // dans l'image mais chevauchait le cercle. Les sièges étant alignés sur le
    // même rayon que les mises (`onEllipse` est linéaire en k), il suffit de
    // s'éloigner du centre de la table : c'est « vers le bas » à l'écran depuis
    // n'importe quelle place.
    const out = V3(st.betSpot.x, 0, st.betSpot.z).normalize().scale(0.135);
    const local = V3(st.betSpot.x + out.x, TOP_Y + 0.004, st.betSpot.z + out.z);
    betAR.p.position.copyFrom(toWorld(local));
    const topDir = toWorld(V3(0, 0, 0)).subtract(toWorld(st.chair)); topDir.y = 0;
    betAR.p.rotation.set(-Math.PI / 2, Math.atan2(-topDir.x, -topDir.z), 0);
    betAR.p.setEnabled(true);
    if (text !== betARText) {
      betARText = text;
      const c = betAR.dt.getContext();
      c.clearRect(0, 0, 256, 96);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = "#ffd76a";
      c.shadowColor = "#ffb84a"; c.shadowBlur = 6;
      c.font = "700 52px 'Futura','Avenir Next',sans-serif";
      c.fillText(text, 128, 50);
      betAR.dt.update();
    }
  }

  /* ---------------- sanction et récompense ---------------- */

  // Chaleur et cinéma sont injectés après coup : ils ont besoin de la caméra
  // du joueur, qui n'existe pas encore quand la table est construite.
  let heat = null, heatSynced = false;
  let cinema = null;
  // La voix du croupier est PARTAGÉE par les trois tables du pit : son budget
  // de paroles est commun, donc deux tables ne peuvent pas se parler dessus.
  let voice = null;
  let lastMe = null;                 // ma dernière photo, pour armer le cinéma

  /** Les cartes d'UNE main se consument, décalées pour lire la propagation. */
  function burnHand(seatIdx, h = null) {
    const hand = G.tableCards.filter((c) => c._seat === seatIdx && !c._burning
      && (h === null || (c._h || 0) === h));
    hand.forEach((c, i) => c.burn({ delay: 90 + i * 130 }));
    // elles se détruisent seules : `clearTable` ne doit plus les toucher
    G.tableCards = G.tableCards.filter((c) => !hand.includes(c));
  }

  /** Le croupier saute : sa main brûle, toute la table y gagne. */
  let dealerBurned = -1;
  function burnDealerIfBust(state) {
    if (!state || state.phase !== "payout") return;
    if (dealerBurned === state.round) return;
    if (!(state.dealer && state.dealer.total > 21)) return;
    dealerBurned = state.round;
    burnHand("dealer");
    // LA BANQUE SAUTE : c'est le seul moment où toute la table gagne ensemble.
    // La salle applaudit — d'autant plus fort qu'ils sont nombreux à toucher.
    const alive = state.seats.filter((s) => s.bet > 0 && s.total > 0 && s.total <= 21).length;
    if (G.seated && alive >= 1) {
      voice?.say("banqueSaute", { delay: 500 });
      if (alive >= 2) audio.fx?.("applause", { vol: 0.16 + alive * 0.06, when: 0.7 });
    }
  }

  /** Jetons actuellement posés sur le feutre autour d'un point (rayon XZ). */
  function chipsNear(world, r) {
    return chips.pool.filter((c) => {
      if (c.isDisposed()) return false;
      const p = c.getAbsolutePosition();
      return Math.hypot(p.x - world.x, p.z - world.z) < r && p.y > TOP_Y - 0.15;
    });
  }
  const rackWorld = () => toWorld(V3(0, TOP_Y + 0.05, -0.86));
  // Étage de la PROCHAINE mise par place, tenu au moment où le jeton est
  // PROGRAMMÉ (le vol dure ~300 ms : compter les jetons posés ne suffit pas).
  const betLedger = new Map();
  // Le plus gros jeton que J'AI misé cette manche : le croupier paie le gain
  // dans cette monnaie (misé en 25 -> payé en 25). Remis à zéro au clear.
  let myBetUnit = 0;
  // Même registre pour la PILE DU JOUEUR (chipSpot) : gains et mises rendues
  // arrivent en vol pendant ~1 s, compter les jetons posés ne suffit pas.
  const pileLedger = new Map();
  /** Réserve `count` étages sur la pile d'une place ; rend le premier. */
  function reservePile(seatIdx, count) {
    const st = SEATS[seatIdx];
    const n = pileLedger.has(seatIdx)
      ? pileLedger.get(seatIdx)
      : chipsNear(toWorld(st.chipSpot), 0.17).length;
    pileLedger.set(seatIdx, n + count);
    return n;
  }

  /** Volume des sons DE CETTE TABLE selon la distance de la caméra. */
  const tableVol = () => {
    const cam = scene.activeCamera;
    if (!cam) return 1;
    const d = B.Vector3.Distance(cam.position, toWorld(V3(0, TOP_Y, 0)));
    // aligné sur cards.js / chips.js : plein volume à sa table, éteint à 6 m
    return d < 2.5 ? 1 : Math.max(0, 1 - (d - 2.5) / 3.5) ** 2;
  };

  /** Avalanche de jetons poussée par le croupier vers la place gagnante. */
  function payoutChips(seatIdx, gain) {
    const st = SEATS[seatIdx];
    if (!st || !(gain > 0)) return;
    // Chez MOI : le gain arrive du râtelier SUR LES BONNES COLONNES de la
    // banque, valeur par valeur — la pile qu'on voit vaut ce qu'on possède.
    if (G.seated && seatIdx === PLAYER_SEAT && bank.built) {
      bankAdd(payoutBreakdown(gain, myBetUnit || 100));
      return;
    }
    const out = [];
    let left = gain;
    // on borne à 9 jetons : au-delà c'est de la physique jetée par la fenêtre
    for (const v of [500, 100, 25, 5]) {
      while (left >= v && out.length < 9) { out.push(v); left -= v; }
    }
    if (!out.length) out.push(5);
    const from = toWorld(V3(0, TOP_Y + 0.16, -0.74));      // râtelier du croupier
    const to = toWorld(st.chipSpot);
    // ÉTAGES RÉSERVÉS D'AVANCE (cf. betLedger) : l'ancienne cible
    // `rnd(0, 3) * CHIP_H` ± 5 cm éparpillait les gains n'importe comment sur
    // la pile. Chaque jeton vise SON étage — la pile grandit jeton par jeton.
    const base = reservePile(seatIdx, out.length);
    out.forEach((v, i) => setTimeout(() => {
      const c = chips.spawn(v, V3(from.x + rnd(-0.07, 0.07), from.y, from.z + rnd(-0.03, 0.03)));
      chips.toss(c, V3(to.x + rnd(-0.002, 0.002),
        TOP_Y + CHIP_H / 2 + (base + i) * CHIP_H, to.z + rnd(-0.002, 0.002)), { arc: 0.3 });
    }, 260 + i * 85));
  }

  /** Onde de choc dorée sur le feutre, centrée sur la place gagnante. */
  let ring = null;
  function shockwave(seatIdx, power = 1) {
    const st = SEATS[seatIdx];
    if (!st) return;
    if (!ring) {
      ring = B.MeshBuilder.CreateDisc("bjRing", { radius: 1, tessellation: 48 }, scene);
      const m = new B.StandardMaterial("bjRingM", scene);
      m.emissiveColor = C3(1, 0.82, 0.38);
      m.diffuseColor = C3(0, 0, 0);
      m.disableLighting = true;
      m.alphaMode = B.Engine.ALPHA_ADD;
      m.alpha = 0;
      // CreateDisc fait face à +Z : couché à plat il ne montre que son dos au
      // joueur. On désactive le culling plutôt que de deviner le signe.
      m.backFaceCulling = false;
      ring.material = m;
      ring.rotation.x = Math.PI / 2;      // à plat sur le feutre
      ring.isPickable = false;
      ring.renderingGroupId = 1;          // toujours par-dessus le tapis
    }
    const p = toWorld(st.betSpot);
    ring.position.set(p.x, TOP_Y + 0.004, p.z);
    let e = 0;
    const dur = 0.6;
    const obs = scene.onBeforeRenderObservable.add(() => {
      e += scene.getEngine().getDeltaTime() / 1000;
      const k = Math.min(1, e / dur);
      const s = 0.04 + k * 0.62 * power;
      ring.scaling.set(s, s, s);
      ring.material.alpha = (1 - k) * (1 - k) * 0.85 * power;
      if (k >= 1) { ring.material.alpha = 0; scene.onBeforeRenderObservable.remove(obs); }
    });
  }

  /**
   * « GAGNÉ  +300 €  → cagnotte +240 € ».
   *
   * Le bonus de série n'est plus payé à la main : il tombe dans la cagnotte.
   * Le message doit donc distinguer ce qui est ACQUIS de ce qui est MIS DE
   * CÔTÉ — sans quoi le joueur croit avoir touché une somme qu'il peut encore
   * perdre.
   */
  function gainMsg(label, ev) {
    let s = label;
    if (ev.gain > 0) s += "  +" + Math.round(ev.gain) + " €";
    if (ev.bonus > 0) s += "  → cagnotte +" + fmt(ev.bonus) + " €";
    return s;
  }

  function applyServer(state, events, netId) {
    if (netId != null) myNetId = netId;
    // Le serveur pousse toute la donne initiale d'un bloc (_dealAll), donc ce
    // paquet d'événements peut contenir dix cartes d'un coup. Un croupier ne
    // distribue pas dix cartes à la fois : on les échelonne, une toutes les
    // DEAL_STAGGER ms, dans l'ordre où le serveur les a tirées.
    const DEAL_STAGGER = 190;
    let dealt = 0;
    // « Répéter la mise » repose une PILE d'un coup : le serveur la décompose
    // en jetons de vraies valeurs, arrivés dans le même paquet. Sans décalage,
    // quatre jetons se matérialisent au même instant au même endroit et se
    // repoussent en explosant — échelonnés, c'est un geste de croupier.
    let tossed = 0;
    for (const ev of events || []) {
      try {
      if (ev.t === "clear") {
        betLedger.clear();
        myBetUnit = 0;
        // re-semé du vrai décompte à la prochaine arrivée : corrige la dérive
        // si le GC du pool a mangé le bas d'une pile entre-temps
        pileLedger.clear();
        clearTable();
        seatCards.clear(); dealerCount = 0; holeCard = null;
        hideAllBadges();
        // Filet de sécurité, UNIQUEMENT sur le clear de fin de manche (la photo
        // jointe dit "betting") : tout jeton oublié sur un cercle part au
        // râtelier. Le clear de début de manche ("dealing") ne balaie pas —
        // il faucherait les mises fraîchement posées.
        if (state && state.phase === "betting") {
          for (const s of SEATS) {
            const left = chipsNear(toWorld(s.betSpot), 0.18);
            if (left.length) chips.sweep(left, rackWorld());
          }
        }
        // Les annonces de phase reviennent — mais mesurées : le croupier a un
        // budget de paroles par manche, et « faites vos jeux » ne sort qu'une
        // fois sur quatre (voir src/dealer.js). C'est leur retour à CHAQUE
        // coup qui saturait, pas les répliques elles-mêmes.
        //
        // Seulement à MA table : les trois tables du pit poussent leur propre
        // « clear » toutes les quelques secondes, et recharger le budget à
        // chacun reviendrait à n'en avoir aucun.
        if (G.seated) {
          if (state && state.phase === "betting") { voice?.round(); voice?.say("mises"); }
          else voice?.say("rideau");
        }
      } else if (ev.t === "bust") {
        // MA carte de trop : arrêt sur image à l'impact, comme un coup encaissé.
        // Différé le temps que la carte atterrisse physiquement sur le feutre.
        if (G.seated && ev.seat === PLAYER_SEAT) {
          setTimeout(() => { cinema?.hitStop(95); audio.thud?.(); }, 620);
        }
      } else if (ev.t === "card") {
        const isDealer = ev.seat === "dealer";
        const h = ev.h || 0;
        const key = ev.seat + ":" + h;         // cartes comptées PAR MAIN
        const n = isDealer ? dealerCount++ : (seatCards.get(key) || 0);
        if (!isDealer) seatCards.set(key, n + 1);
        const opt = isDealer ? DEALER_CARD
          : (ev.seat === PLAYER_SEAT ? PLAYER_CARD : {});
        const spread = isDealer
          ? dealerSpread(n)
          : handSpread(SEATS[ev.seat] || playerSeat, n, n + 1, h, isSplit(ev.seat));
        const wait = dealt++ * DEAL_STAGGER;     // une carte à la fois
        const c = dealCard(spotFor(ev.seat, h), ev.faceUp !== false, spread,
          { ...opt, card: ev.card || undefined, delay: wait,
            seatA: isDealer ? 0 : (SEATS[ev.seat] || playerSeat).a });
        c._seat = ev.seat;          // pour savoir quelle main faire brûler
        c._h = h;
        // « Une carte. » — seulement sur MES tirages, jamais sur la donne
        // initiale : c'est le geste qu'on demande, pas celui qu'on subit.
        if (G.seated && !isDealer && ev.seat === PLAYER_SEAT && n >= 2) {
          voice?.say("carte", { delay: 220 });
        }
        // la main entière se resserre pour absorber la nouvelle carte
        relayoutHand(ev.seat, h);
        // la lecture des totaux attend la DERNIÈRE carte, pas la première
        settleUntil = Math.max(settleUntil, Date.now() + wait + 900);
        if (isDealer && ev.faceUp === false) holeCard = c;
      } else if (ev.t === "split") {
        // la 2e carte de la main glisse vers l'emplacement de la main séparée
        const mine = G.tableCards.filter((c) => c._seat === ev.seat && (c._h || 0) === 0);
        const moved = mine[mine.length - 1];
        if (moved) moved._h = 1;
        seatCards.set(ev.seat + ":0", 1);
        seatCards.set(ev.seat + ":1", 1);
        // les deux mains se réinstallent : la séparation change leur ancrage
        relayoutHand(ev.seat, 0);
        relayoutHand(ev.seat, 1);
        audio.cardFlip(tableVol());
        if (ev.seat === PLAYER_SEAT) {
          ui.msg("Mains séparées — jouez la première");
          if (G.seated) voice?.say("separe", { delay: 500 });
        }
      } else if (ev.t === "flip") {
        // Le serveur n'envoie la carte cachée qu'ici — avant, il enverrait sa
        // valeur à des clients qui pourraient la lire. Le carton posé face
        // cachée était donc un LEURRE tiré du sabot local : on le remplace par
        // la vraie carte, sinon la révélation affichait autre chose que ce que
        // la table a réellement compté.
        const at = holeCard && !holeCard.body.isDisposed()
          ? holeCard.body.position.clone() : null;
        if (holeCard && !holeCard.body.isDisposed()) {
          const i = G.tableCards.indexOf(holeCard);
          if (i >= 0) G.tableCards.splice(i, 1);
          holeCard.dispose();
        }
        holeCard = null;
        if (ev.card) {
          const c = dealCard(spotFor("dealer"), true,
            dealerSpread(1, Math.max(2, dealerCount)), { ...DEALER_CARD, card: ev.card });
          c._seat = "dealer";
          c._h = 0;
          if (at) c.body.position.copyFrom(at);
          relayoutHand("dealer", 0);
          settleUntil = Math.max(settleUntil, Date.now() + 700);
          heat?.flare(0.55);        // la révélation fait monter la température
          // LE moment : ralenti + rack focus, seulement si ma main est vivante
          // (assis, misé, ni sautée ni blackjack — sinon rien à espérer du flip)
          if (G.seated && lastMe && lastMe.bet > 0
            && lastMe.result !== "bust" && lastMe.total > 0 && lastMe.total <= 21) {
            cinema?.flipMoment();
          }
        }
      } else if (ev.t === "bet") {
        const st = SEATS[ev.seat];
        if (st) {
          const t = toWorld(st.betSpot);
          const src = toWorld(st.chipSpot);
          const wait = tossed++ * 80;
          // HAUTEUR DE PILE EXACTE. L'ancienne cible `rnd(0, 4) * CHIP_H`
          // donnait des étages fractionnaires : rest() FIGEAIT des jetons
          // imbriqués l'un dans l'autre (bug « mes jetons se chevauchent »).
          // Le registre attribue l'étage suivant dès la programmation du vol,
          // semé du nombre de jetons déjà posés si la place est inconnue.
          const n = betLedger.has(ev.seat) ? betLedger.get(ev.seat) : chipsNear(t, 0.17).length;
          betLedger.set(ev.seat, n + 1);
          // MA mise décolle du haut de la vraie colonne (pris MAINTENANT :
          // le registre de la banque doit refléter le débit dès la programmation)
          if (ev.seat === PLAYER_SEAT) myBetUnit = Math.max(myBetUnit, ev.value);
          const fromBank = G.seated && ev.seat === PLAYER_SEAT ? bankTake(ev.value) : null;
          setTimeout(() => {
            const chip = fromBank && !fromBank.isDisposed() ? fromBank
              : chips.spawn(ev.value, V3(src.x, TOP_Y + 0.12, src.z));
            chips.toss(chip, V3(t.x + rnd(-0.008, 0.008),
              TOP_Y + CHIP_H / 2 + n * CHIP_H, t.z + rnd(-0.008, 0.008)), { arc: 0.2 });
          }, wait);
        }
      } else if (ev.t === "rebet") {
        // la mise reposée d'un geste : un riffle de jetons, rien de plus. Le
        // détail qui vend le raccourci, c'est qu'il SONNE comme un vrai geste.
        if (G.seated && ev.seat === PLAYER_SEAT) {
          audio.chipRiffle();
          ui.msg("Mise reposée — " + fmt(ev.bet + (ev.side || 0)) + " €");
        }
      } else if (ev.t === "bank") {
        // LA CAGNOTTE ENCAISSÉE : les jetons remontent du râtelier, le feu
        // s'éteint. Un moment volontairement doux — c'est un soulagement, pas
        // une victoire ; le fracas est réservé à ce qu'on a risqué et gardé.
        payoutChips(ev.seat, ev.gain);
        const st = SEATS[ev.seat];
        if (st) floatText("+" + fmt(ev.gain) + " €",
          toWorld(st.chipSpot).add(V3(0, 0.18, 0)), "#9fe8ff");
        if (G.seated && ev.seat === PLAYER_SEAT) {
          ui.toast("Cagnotte encaissée — " + fmt(ev.gain) + " € (la série repart de zéro)", "win");
          audio.win(false);
          heat?.extinguish(ev.tier || 0);
          arPot(0);
        }
      } else if (ev.t === "timebank") {
        // LE SURSIS S'ENGAGE — tout seul, sans un clic. C'est le principe :
        // celui qui n'est pas là ne peut rien cliquer. On le DIT : la réserve
        // s'écoule maintenant, et seul le temps consommé sera retenu.
        if (G.seated && ev.seat === PLAYER_SEAT) {
          ui.toast("TEMPS ADDITIONNEL — la réserve s'écoule ("
            + Math.ceil((ev.ms || 0) / 1000) + " s restantes)");
          audio.chipRiffle?.();
          voice?.say("vite", { delay: 400 });
        } else {
          // chez le voisin, une ligne discrète : la table sait pourquoi elle
          // attend, au lieu de croire à un serveur figé
          const st = SEATS[ev.seat];
          if (st) floatText("+ TEMPS", toWorld(st.chipSpot).add(V3(0, 0.22, 0)), "#ffe9b0");
        }
      } else if (ev.t === "buytime") {
        if (G.seated && ev.seat === PLAYER_SEAT) {
          ui.toast("Réserve de temps rechargée — " + fmt(ev.price) + " € ("
            + Math.round((ev.left || 0) / 1000) + " s)");
          audio.chipRiffle?.();
        }
      } else if (ev.t === "result") {
        const lost = ev.result === "lose" || ev.result === "bust";
        const won = ev.result === "win" || ev.result === "bj";
        const h = ev.h || 0;

        // La main perdue part en fumée — pour TOUTES les places, pas seulement
        // la mienne : voir brûler la main du voisin est la moitié du spectacle.
        if (lost) burnHand(ev.seat, h);
        // LE SORT DES MISES : perdues -> le croupier les ramasse au râtelier ;
        // gagnées ou rendues -> elles reviennent devant le joueur. Sans ça les
        // jetons s'empilaient sur les cercles de mise, manche après manche.
        if (h === 0) {
          betLedger.delete(ev.seat);
          const stc = SEATS[ev.seat];
          if (stc) {
            const betW = toWorld(stc.betSpot);
            const onCircle = chipsNear(betW, 0.17);
            if (lost) chips.sweep(onCircle, rackWorld());
            else if (G.seated && ev.seat === PLAYER_SEAT && bank.built) {
              // chaque jeton regagne LA COLONNE DE SA VALEUR dans la banque
              onCircle.forEach((c, i) => {
                const dst = bankReserve(c.metadata.value);
                setTimeout(() => {
                  if (c.isDisposed()) return;
                  bankRegister(c);
                  chips.toss(c, dst, { arc: 0.18 });
                }, i * 80);
              });
            } else if (onCircle.length) {
              const cs = toWorld(stc.chipSpot);
              chips.slideStack(onCircle, V3(cs.x, TOP_Y, cs.z), 80,
                reservePile(ev.seat, onCircle.length));
            }
          }
        }
        if (won) {
          payoutChips(ev.seat, ev.gain);
          // le gain jaillit du feutre à la place gagnante, pour tout le monde
          const st = SEATS[ev.seat];
          if (st && ev.gain > 0) {
            floatText("+" + fmt(ev.gain) + " €",
              toWorld(st.betSpot).add(V3(0, 0.16, 0)));
            // ...et le versement à la cagnotte monte SÉPARÉMENT, en braise :
            // deux chiffres, deux natures d'argent
            if (ev.bonus > 0) {
              setTimeout(() => floatText("cagnotte +" + fmt(ev.bonus) + " €",
                toWorld(st.chipSpot).add(V3(0, 0.16, 0)), "#ff9a3d"), 420);
            }
          }
          // fontaine d'étincelles — pleine puissance chez moi, écho chez les voisins
          sparkBurst(ev.seat, ev.seat === PLAYER_SEAT && G.seated
            ? (ev.result === "bj" ? 1.6 : 1) + (ev.bonus > 0 ? 0.4 : 0)
            : 0.35);
          if (ev.result === "bj") confettiBurst(ev.seat);
          // L'ANNONCE D'ARÈNE « BLACKJACK ! » ne se crie que pour MA place —
          // le blackjack d'un voisin reste silencieux (confettis seulement).
          // Toujours, jamais autre chose : la seule réplique de l'intention
          // est ann_blackjack (voir dealer.js), et `force` + priorité 3 la
          // font passer devant tout. `ev.natural` : blackjack soldé « push »
          // (la banque en a un aussi) — la main reste un blackjack, le cri
          // part quand même ; seuls les confettis exigent la victoire.
          if (ev.result === "bj" || ev.natural) {
            if (G.seated && ev.seat === PLAYER_SEAT)
              voice?.say("blackjack", { delay: 420, force: true });
          }
        }

        if (G.seated && ev.seat === PLAYER_SEAT) {
          const tag = seatCards.has(PLAYER_SEAT + ":1") ? ` (main ${h + 1})` : "";
          if (ev.result === "bj") {
            ui.msg(gainMsg("BLACKJACK — 3:2", ev) + tag); audio.win(true);
            heat?.gold(true); shockwave(ev.seat, 1);
            cinema?.winPunch(1.25);
            heat?.flashLamp(1.4);
            // l'annonce « BLACKJACK ! » est criée plus haut (ma place
            // uniquement) — ici seulement la pique, réservée à MON blackjack
            voice?.tease?.("bigWin", { delay: 2800 });
          } else if (ev.result === "win") {
            ui.msg(gainMsg("GAGNÉ", ev) + tag); audio.win(false);
            heat?.gold(false); shockwave(ev.seat, 0.6);
            // le coup de zoom grossit avec le bonus de série : gagner chaud
            // frappe plus fort que gagner froid
            cinema?.winPunch(0.7 + (ev.bonus > 0 ? 0.35 : 0));
            heat?.flashLamp(0.9 + (ev.bonus > 0 ? 0.4 : 0));
            voice?.say("gagne", { delay: 600 });
          } else if (ev.result === "push") {
            ui.msg("ÉGALITÉ" + tag); audio.ui();
            voice?.say("egalite", { delay: 500 });
          } else {
            ui.msg((ev.result === "bust" ? "BRÛLÉ" : "PERDU") + tag); audio.lose();
            voice?.say(ev.result === "bust" ? "perd" : "banqueGagne", { delay: 700 });
          }

          // La chaleur suit le NET de la place — un split gagné/perdu à mises
          // égales est neutre. Piloté par l'événement de la main 0 seulement :
          // c'est lui qui porte la vérité de la série, l'autre n'est qu'écho.
          if (h === 0) {
            // LE CROUPIER CHARRIE — sur les séries, comme un vrai croupier qui
            // glisse un mot. Deux mains brûlées d'affilée, ou trois pertes de
            // suite : la pique part dans le salon (et en voix quand il y en a
            // une). L'égalité ne casse ni ne nourrit la série.
            if (ev.net < 0) {
              G.loseRun = (G.loseRun || 0) + 1;
              G.bustRun = ev.result === "bust" ? (G.bustRun || 0) + 1 : 0;
              if (G.bustRun >= 2) voice?.tease?.("bust", { delay: 1700 });
              else if (G.loseRun >= 3) voice?.tease?.("loseStreak", { delay: 1700 });
            } else if (ev.net > 0) { G.loseRun = 0; G.bustRun = 0; }
            // LA CAGNOTTE PERDUE : ce qui s'est accumulé main après main part
            // avec la série. C'est le prix du pari, il doit se voir passer —
            // en rouge, à l'endroit même où le chiffre grossissait.
            if (ev.potLost > 0) {
              const stc = SEATS[ev.seat];
              if (stc) setTimeout(() => floatText("cagnotte −" + fmt(ev.potLost) + " €",
                toWorld(stc.chipSpot).add(V3(0, 0.18, 0)), "#ff5a45"), 300);
              ui.toast("Cagnotte de série perdue — " + fmt(ev.potLost) + " €", "lose");
              audio.burn?.(tableVol());
              cinema?.hitStop(120);
            }
            arPot(ev.pot || 0);
            if (ev.net < 0) heat?.extinguish(ev.brokeAt || 0);
            else if (Number.isFinite(ev.tier)) {
              const up = heat && ev.tier > heat.tier;
              heat?.set(ev.tier);
              if (ev.net > 0) heat?.flare(1);
              if (up) {
                const line = { 2: "chauffe", 3: "enFeu", 4: "inferno" }[ev.tier];
                if (line) voice?.say(line, { delay: 1900, force: true });
              }
            }
          }
        }
      } else if (ev.t === "side") {
        // 21+3 : réglé dès la donne — un pic de dopamine avant même de jouer
        if (ev.gain > 0) {
          const st = SEATS[ev.seat];
          if (st) floatText("+" + fmt(ev.gain) + " €",
            toWorld(st.chipSpot).add(V3(0, 0.16, 0)), "#9fe8ff");
        }
        // LE JACKPOT DU PIT emporté : brelan assorti. Confettis à la place
        // gagnante quelle qu'elle soit — c'est l'événement de la soirée, il se
        // voit depuis les trois tables.
        if (ev.jackpot > 0) {
          confettiBurst(ev.seat);
          sparkBurst(ev.seat, 2);
          shockwave(ev.seat, 1.4);
        }
        if (G.seated && ev.seat === PLAYER_SEAT) {
          if (ev.gain > 0) {
            ui.toast(`21+3 — ${ev.result} ×${ev.mult}  +${fmt(ev.gain)} €`, "win");
            audio.win(ev.mult >= 30);
            if (ev.mult >= 10) voice?.say("magistral", { delay: 500, force: true });
            heat?.gold(ev.mult >= 10);
            shockwave(ev.seat, Math.min(1, 0.5 + ev.mult / 60));
          } else {
            ui.toast("21+3 perdu — " + fmt(ev.stake) + " €", "lose");
          }
        } else if (ev.gain > 0 && ev.mult >= 30) {
          ui.toast(`La place ${ev.seat + 1} touche un ${ev.result} — ×${ev.mult} !`, "win");
        }
      } else if (ev.t === "offer_insurance") {
        if (G.seated) {
          audio.ui(); ui.msg("Le croupier montre un AS…");
          voice?.say("assurance", { delay: 250 });
        }
      } else if (ev.t === "insured") {
        if (G.seated && ev.seat === PLAYER_SEAT) ui.msg("Assuré pour " + fmt(ev.value) + " €");
      } else if (ev.t === "insurance") {
        if (G.seated && ev.seat === PLAYER_SEAT) {
          if (ev.result === "win") { ui.toast("Assurance payée 2:1  +" + fmt(ev.gain) + " €", "win"); audio.win(false); }
          else ui.toast("Pas de blackjack — assurance perdue", "lose");
        }
      } else if (ev.t === "clearbet") {
        betLedger.delete(ev.seat);
        const st = SEATS[ev.seat];
        if (st) {
          const back = toWorld(st.chipSpot);
          const spot = toWorld(st.betSpot);
          const near = chips.pool.filter((c) => {
            const d = c.getAbsolutePosition().subtract(spot);
            return Math.hypot(d.x, d.z) < 0.18 && Math.abs(d.y) < 0.25;
          });
          if (G.seated && ev.seat === PLAYER_SEAT && bank.built) {
            near.forEach((c, i) => {
              const dst = bankReserve(c.metadata.value);
              setTimeout(() => {
                if (c.isDisposed()) return;
                bankRegister(c);
                chips.toss(c, dst, { arc: 0.18 });
              }, i * 40);
            });
          } else {
            chips.slideStack(near, V3(back.x, TOP_Y, back.z), 40,
              reservePile(ev.seat, near.length));
          }
        }
      } else if (ev.t === "shuffle") {
        audio.shuffle(tableVol());
      }
      } catch (e) {
        // un évènement qui casse ne doit JAMAIS geler la table : on le jette
        // et l'état qui suit resynchronise tout (phase, chaleur, totaux). Le
        // gel du 18/08 (« Le croupier joue » figé, mises muettes, flammes
        // immortelles) venait d'une exception non attrapée exactement ici.
        console.error("[bj] évènement", ev && ev.t, "en échec :", e);
      }
    }
    if (state) {
      G.phase = state.phase;
      // Ma place est celle que le serveur associe à mon identifiant réseau, pas
      // celle que je crois occuper : lui seul fait foi.
      const me = state.seats.find((s) => s.pid && s.pid === myNetId) || null;
      lastMe = me;
      burnDealerIfBust(state);

      // valeurs des mains (réticules AR + totaux HUD), différées tant qu'une
      // carte vole encore — la valeur n'existe qu'une fois la carte posée
      const applyValues = () => {
        // Les pastilles n'existent que pour QUI EST ASSIS À CETTE TABLE. Vues
        // de loin, les totaux des autres tables flottaient dans la salle et se
        // mélangeaient à ceux de la mienne.
        if (!G.seated) { hideAllBadges(); return; }
        for (const st of state.seats) {
          if (st.hand && st.hand.length) {
            setBadge(st.i + ":0", arSpot(st.i, 0), String(st.total),
              badgeColor(st.total), badgeSize(st.i));
          } else hideBadge(st.i + ":0");
          if (st.split && st.split.hand.length) {
            setBadge(st.i + ":1", arSpot(st.i, 1), String(st.split.total),
              badgeColor(st.split.total), badgeSize(st.i));
          } else hideBadge(st.i + ":1");
        }
        const dh = state.dealer.hand || [];
        if (dh.length) {
          // la pastille du croupier flotte derrière SA ligne de cartes
          const dpos = toWorld(V3(0, TOP_Y + BDG.lift + 0.02, -0.42));
          if (state.dealer.total != null) {
            // le total du croupier se LIT sur le badge ; il n'est plus annoncé
            // à voix haute (« dix-huit », « la banque saute »… à chaque manche)
            setBadge("dealer", dpos, String(state.dealer.total), badgeColor(state.dealer.total));
          } else {
            // carte cachée : on affiche ce que le joueur peut compter, « 10+? »
            const vis = dh.filter((c) => c && c.rank);
            setBadge("dealer", dpos, (vis.length ? handValue(vis).total : "") + "+?");
          }
        } else hideBadge("dealer");
        if (G.seated) {
          ui.setDealerVal(state.dealer.total ?? "—");
          // avec un split : les deux totaux, main active devinable au « · »
          ui.setPlayerVal(!me || !me.total ? "—"
            : me.split ? me.total + " · " + (me.split.total || "—") : me.total);
          // LES MÊMES MAINS, DOUBLÉES À PLAT dans le HUD classique : la table
          // 3D se regarde, ce panneau se LIT. La carte cachée du croupier y
          // reste un dos — le serveur ne l'envoie pas, on n'invente rien.
          const tag = (c) => (c && c.rank ? { r: c.rank, s: c.suit } : null);
          const vis = dh.filter((c) => c && c.rank);
          const mine = state.phase === "player" && state.turn === PLAYER_SEAT;
          ui.setHands?.({
            dealer: {
              cards: dh.map(tag),
              total: state.dealer.total ?? 0,
              label: state.dealer.total != null ? String(state.dealer.total)
                : vis.length ? handValue(vis).total + "+?" : "—",
            },
            main: {
              cards: (me && me.hand ? me.hand : []).map(tag),
              total: me ? me.total : 0,
              active: !!(mine && me && !me.done),
            },
            split: me && me.split && me.split.hand.length ? {
              cards: me.split.hand.map(tag),
              total: me.split.total,
              active: !!(mine && me.done && !me.split.done),
            } : null,
          });
        }
      };
      clearTimeout(valTimer);
      const settleWait = settleUntil - Date.now();
      if (settleWait > 40) valTimer = setTimeout(applyValues, settleWait);
      else applyValues();
      // Un arrivant en cours de série doit voir la table déjà chaude : on cale
      // le palier sur la photo, sans jouer la montée (elle a déjà eu lieu).
      if (heat && me && Number.isFinite(me.tier) && me.tier !== heat.tier) {
        heat.set(me.tier, { instant: !heatSynced });
        heatSynced = true;
      }
      if (G.seated) {
        ui.setBet(me ? me.bet : 0);   // les totaux, eux, attendent la carte
        // LA CAGNOTTE, gravée au feutre : elle reste sous les yeux tant qu'elle
        // n'est pas encaissée. C'est elle qu'on risque à chaque main.
        arPot(me ? me.pot || 0 : 0);
        // RÉPÉTER : proposé seulement quand il y a quelque chose à répéter et
        // que le cercle est net — sinon le bouton mentirait.
        ui.setRebet?.(state.phase === "betting" && me && !me.bet && !me.side && me.lastBet
          && me.cash >= me.lastBet ? me.lastBet + (me.lastSide || 0) : 0);
        // ENCAISSER : pendant la phase de mise, et elle seule. C'est le bon
        // moment de toute façon — on sécurise AVANT de remettre au tapis — et
        // le bouton vit dans la barre de mise, qui est neutralisée ailleurs
        // (`#bjbet.off`) : proposé en phase de paiement, il serait mort au
        // clic. Le serveur, lui, accepte aussi le paiement (raccourci C).
        ui.setBank?.(me && me.pot > 0 && state.phase === "betting" ? me.pot : 0);
        // LA RÉSERVE DE TEMPS : le restant en millisecondes, et le sursis en
        // cours. Affichée en permanence à table — elle ne se recharge pas
        // toute seule, autant que le joueur voie fondre son filet.
        ui.setTimeBank?.(me ? me.tbank || 0 : 0, !!(me && me.tbankOn),
          state.tbankMax || 20000);
        // +TEMPS : entre deux manches, et seulement RÉSERVE ÉPUISÉE — sous
        // 400 ms il ne reste rien d'utilisable (même seuil que le serveur,
        // qui revalide tout : voir buyTime).
        const price = state.tbankPrice || 0;
        ui.setBuyTime?.(me && price && (me.tbank || 0) < 400
          && me.cash >= price && (state.phase === "betting" || state.phase === "payout")
          ? price : 0);
      }
      // le portefeuille suit la caisse du serveur — le front ne débite plus rien
      if (me && Number.isFinite(me.cash) && me.cash !== state_.cash) {
        state_.cash = me.cash;
        ui.updateCash();
      }
      // ...et la banque physique suit le portefeuille : les évènements du lot
      // ont déjà engagé leurs jetons, bankSync ne répare que le reste
      // (assurance, double, monnaie à rendre, jetons mangés par le GC).
      if (G.seated && bank.built && me && Number.isFinite(me.cash)) bankSync(me.cash);
      timer.deadline = Date.now() + (state.msLeft || 0);
      timer.total = Math.max(1, state.msTotal || 1);
      timer.mine = (state.phase === "player" && state.turn === PLAYER_SEAT)
        || (state.phase === "insurance" && !!me && !me.insResponded);
      timer.bank = !!(me && me.tbankOn && state.phase === "player"
        && state.turn === PLAYER_SEAT);
      timer.bankMax = state.tbankMax || 20000;
      timer.show = G.seated
        && ["betting", "player", "insurance"].includes(state.phase);
      if (G.seated) {
        const mine = state.phase === "player" && state.turn === PLAYER_SEAT;
        // main active : la principale, puis la séparée
        const activeHand = me && (!me.done ? me.hand
          : (me.split && !me.split.done ? me.split.hand : null));
        ui.showBetPanel(state.phase === "betting");
        ui.showActions(mine, {
          canDouble: mine && activeHand && activeHand.length === 2,
          canSplit: mine && me && !me.split && !me.done && me.hand.length === 2
            && cardValue(me.hand[0].rank) === cardValue(me.hand[1].rank)
            && me.cash >= me.bet,
        });
        // panneau d'assurance : à moi de répondre, une seule fois. Via ui,
        // pour que le HUD AR reçoive le même signal que le DOM.
        const ask = state.phase === "insurance" && me && me.bet > 0 && !me.insResponded;
        ui.showInsurance?.(ask, ask ? Math.floor(me.bet / 2) : 0);
        // rappel de la mise 21+3 sur son bouton
        ui.setSide?.(me && me.side ? me.side + " €" : "");
        if (state.phase === "betting") ui.msg("Faites vos jeux");
        else if (state.phase === "insurance") { if (me && me.insResponded) ui.msg("Le croupier vérifie…"); }
        else if (mine && timer.bank) ui.msg("TEMPS ADDITIONNEL — à vous de jouer");
        else if (mine) ui.msg(me && me.done && me.split && !me.split.done ? "Jouez la 2e main" : "À vous de jouer");
        else if (state.phase === "player") ui.msg("Tour du joueur " + state.turn);
        else if (state.phase === "dealer") ui.msg("Le croupier joue");
      }
    }
  }

  /* ---------------- API ---------------- */
  const api = {
    root, seatHits, SEATS, NPC_SEATS, toWorld, G, dealer, npcs, applyServer, idx,
    get PLAYER_SEAT() { return PLAYER_SEAT; },

    arBet,

    /** Injectés par main.js : chaleur et cinéma ont besoin de la caméra, créée après. */
    setHeat(h) { heat = h; },
    setCinema(c) { cinema = c; },
    /** La voix du croupier, commune au pit (src/dealer.js). */
    setVoice(v) { voice = v; },
    seatPos: (i = PLAYER_SEAT) => toWorld(SEATS[i].chair),
    tableCenter: () => toWorld(V3(0, TOP_Y, 0)),
    /** Réglage à chaud du vol des pastilles de valeur (voir BDG). */
    tuneBadges: (o) => Object.assign(BDG, o),
    dealerPos: () => toWorld(V3(0, 1.35, -1.5)),

    /** @param {number} i place choisie ; les jetons sont bâtis à cet endroit. */
    sit(i = PLAYER_SEAT) {
      if (SEATS[i] && !NPC_SEATS.includes(i)) {
        if (i !== PLAYER_SEAT) bankClear(false);   // la banque déménage avec moi
        PLAYER_SEAT = i;
        playerSeat = SEATS[i];
      }
      G.seated = true;
      if (!bank.built) bankBuild(state_.cash);
      audio.chipRiffle();
      // le croupier salue celui qui s'assoit — une fois, pas à chaque va-et-vient
      voice?.reset();
      voice?.say("bienvenue", { delay: 900, force: true });
      // Aucune partie n'est lancée ici : la table tourne côté serveur et nous
      // envoie son état. Auparavant `beginBetting()` déclenchait `npcBets()`,
      // qui posait des jetons LOCAUX en double de ceux du serveur.
    },
    leave() {
      G.seated = false;
      bankClear(true);          // on empoche ses jetons en quittant la table
      heatSynced = false;
      if (betAR) betAR.p.setEnabled(false);
      if (potAR) potAR.p.setEnabled(false);
      heat?.reset();          // on ne quitte pas la table avec l'écran en feu
      voice?.reset();
      G.loseRun = G.bustRun = G.slowRun = 0;   // les séries meurent avec le départ
      ui.showBetPanel(false); ui.showActions(false);
      ui.setRebet?.(0); ui.setBank?.(0);
      ui.setTimeBank?.(0, false); ui.setBuyTime?.(0);
      timer.bank = false;
      ui.setHands?.(null);
      hideAllBadges();
    },
    tick(dt, playerPos) {
      // jauge de temps : coule chaque frame, rougit et bat quand c'est à moi
      const tEl = G.seated ? document.getElementById("bjtimer") : null;
      if (tEl) {
        tEl.hidden = !timer.show;
        if (timer.show) {
          const left = Math.max(0, timer.deadline - Date.now());
          document.getElementById("bjtimerfill").style.width =
            (100 * Math.min(1, left / timer.total)).toFixed(1) + "%";
          // le sursis ne rougit PAS : le rouge dit « tu vas perdre ta main »,
          // or ici la main est déjà sauvée. Il bat en blanc-or, et le compte à
          // rebours vocal se tait — le croupier a déjà charrié une fois.
          const urgent = timer.mine && !timer.bank && left < 3600 && left > 0;
          tEl.classList.toggle("bank", timer.bank);
          tEl.classList.toggle("urgent", urgent);
          if (urgent) {
            const sec = Math.ceil(left / 1000);
            if (sec !== timer.lastSec) {
              timer.lastSec = sec;
              audio.tick?.();
              // « Allez, on se décide » — une seule fois, au bord du gouffre
              if (sec === 3) {
                voice?.say("vite");
                // deux fins de chrono frôlées : le croupier charrie le lambin
                G.slowRun = (G.slowRun || 0) + 1;
                if (G.slowRun >= 2) { G.slowRun = 0; voice?.tease?.("slow", { delay: 900 }); }
              }
            }
          } else timer.lastSec = -1;
          // PENDANT LE SURSIS, le temps du chrono EST la réserve (le serveur
          // lui a accordé tout le restant) : la ligne RÉSERVE fond donc en
          // direct, seconde par seconde — c'est ça qu'on paie.
          if (timer.bank) {
            const sec = Math.ceil(left / 1000);
            if (sec !== timer.lastBankSec) {
              timer.lastBankSec = sec;
              ui.setTimeBank?.(left, true, timer.bankMax || 20000);
            }
          } else timer.lastBankSec = -1;
        }
      }
      // pastilles : le « pop » à chaque changement de valeur, puis retour
      for (const b of badges.values()) {
        if (!b.plane.isEnabled()) continue;
        b.pop = Math.max(0, b.pop - dt * 4.5);
        const sc = (b.size || 1) * (1 + b.pop * b.pop * 0.45);
        b.plane.scaling.set(sc, sc, sc);   // billboard : plus de miroir à corriger
      }
      // la chaise occupée s'ouvre ; les autres se referment dès qu'on s'éloigne
      // (les chaises ne bloquent plus : voir la construction de chairCol)
      dealer.tick(dt, playerPos);
      npcs.forEach((p) => p.npc.tick(dt));
    },
  };
  return api;
}
