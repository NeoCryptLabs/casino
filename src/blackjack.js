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
import { V3, C3, pbr, gold, canvasTex, rnd, rndInt, pick, animVec } from "./util.js";
import { LAYOUT } from "./world.js";
import { CHIP_H } from "./chips.js";
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

export function buildBlackjack(scene, world, audio, chips, cards, ui, state_, people) {
  const state = state_;
  const P = LAYOUT.blackjack;
  const root = new B.TransformNode("bjRoot", scene);
  root.position = P.clone();
  root.rotation.y = -Math.PI / 2;   // le croupier a le dos au mur (+X monde)

  const RX = 1.62, RZ = 1.15;   // demi-axes de l'ovale

  // Placement ELLIPTIQUE (la table est un ovale : un rayon constant sortirait du feutre)
  const SEATS = [];
  const onEllipse = (a, k, y) => V3(Math.sin(a) * RX * k, y, Math.cos(a) * RZ * k);
  for (let i = 0; i < 5; i++) {
    const a = (-2 + i) * 0.42;                 // angle autour de l'axe +Z local
    SEATS.push({
      i, a,
      chair: onEllipse(a, 1.5, 0),
      cardSpot: onEllipse(a, 0.46, TOP_Y + 0.006),
      betSpot: onEllipse(a, 0.60, TOP_Y + 0.01),
      chipSpot: onEllipse(a, 0.86, TOP_Y + 0.01),
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

  // collision (empêche de traverser la table)
  const col = B.MeshBuilder.CreateBox("bjCol", { width: RX * 2, height: TOP_Y, depth: RZ * 2 }, scene);
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
    cc.checkCollisions = true;
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
    const n = people.spawn(V3(w.x, 0, w.z), root.rotation.y + s.a + Math.PI,
      { seated: true, seatY: 0.79, height: rnd(1.76, 1.88), sex: i % 2 ? "m" : "f" });
    npcs.push({ npc: n, seat: s, hand: [], bet: 0, betChips: [], stack: [], done: false, cash: rndInt(600, 4000) });
  }

  // jetons physiques du joueur (3 piles sur le rail)
  // suit la place choisie : cartes, mises et piles de jetons s'y rattachent
  let playerSeat = SEATS[PLAYER_SEAT];
  const playerStacks = [];
  function refillPlayerStacks() {
    const cs = toWorld(playerSeat.chipSpot);
    const dirX = Math.cos(root.rotation.y + playerSeat.a), dirZ = -Math.sin(root.rotation.y + playerSeat.a);
    const conf = [[100, 6], [25, 8], [5, 8]];
    conf.forEach(([v, n], k) => {
      const off = (k - 1) * 0.075;
      const x = cs.x + dirX * off, z = cs.z + dirZ * off;
      const st = chips.stack(v, n, x, z, TOP_Y);
      playerStacks.push({ v, list: st });
    });
  }

  // jetons décoratifs devant les PNJ
  for (const p of npcs) {
    const cs = toWorld(p.seat.chipSpot);
    for (let k = 0; k < rndInt(4, 11); k++) {
      const c = B.MeshBuilder.CreateCylinder("nc", { height: CHIP_H, diameter: 0.042, tessellation: 12 }, scene);
      c.position = V3(cs.x + rnd(-0.02, 0.02), TOP_Y + 0.004 + k * (CHIP_H + 0.0003), cs.z + rnd(-0.02, 0.02));
      c.material = pick(rackMats);
      world.shadowGens.forEach(sg => sg.addShadowCaster(c));
    }
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
      interact: "blackjack", seat: s.i, spot: "blackjack:" + s.i,
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
    audio.shuffle();
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
    G.tableCards.forEach((c) => {
      c._animated();
      animVec(scene, c.body, "position", c.body.position, toWorld(V3(0.95, TOP_Y + 0.12, -0.62)), 20,
        undefined, () => c.dispose());
    });
    G.tableCards = [];
    G.hand = []; G.dealerHand = [];
    npcs.forEach((p) => (p.hand = []));
    setTimeout(() => audio.card(), 260);
  }

  /** Sort une carte du sabot et l'envoie vers une place. */
  function dealCard(targetLocal, faceUp, spread, opt = {}) {
    // `opt.card` : carte imposée par le serveur. Le sabot local ne sert plus
    // qu'en repli, quand aucune table distante n'est branchée.
    if (shoeCards.length < 40) newShoe();
    const cd = opt.card || shoeCards.pop();
    const start = toWorld(shoeExit);
    const c = cards.create(cd.rank, cd.suit, start, false);
    const tgtLocal = targetLocal.add(V3(spread.x, 0.004 + spread.y + (opt.lift || 0), spread.z));
    const tgt = toWorld(tgtLocal);
    const T = c.deal(tgt, 1);
    const rotY = root.rotation.y + rnd(-0.09, 0.09);
    setTimeout(() => {
      if (!c.body.isDisposed()) c.settle(tgt, rotY, faceUp, 14, opt.tilt || 0);
      // les cartes du joueur respirent légèrement (aspect organique de près)
      if (opt.wave) c.setBend(rnd(0.0016, 0.0028), rnd(-0.0008, 0.0008), 0.0009);
    }, T * 1000 + 90);
    G.tableCards.push(c);
    c.rank = cd.rank; c.suit = cd.suit;
    return c;
  }

  // carte du joueur : relevée vers lui et légèrement plus haute pour que
  // son bord bas ne s'enfonce pas dans le feutre
  const PLAYER_CARD = { tilt: 0.95, wave: true, lift: 0.046 };
  // la main du croupier est relevée plus doucement : elle est plus loin
  const DEALER_CARD = { tilt: 0.55, lift: 0.026 };

  function handSpread(seat, idx) {
    const dx = Math.sin(seat.a + Math.PI / 2) * idx * 0.07;
    const dz = Math.cos(seat.a + Math.PI / 2) * idx * 0.07;
    return V3(dx, idx * 0.005, dz);      // étagement net : pas d'interpénétration
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

  function spotFor(seatIdx) {
    if (seatIdx === "dealer") return V3(0, TOP_Y + 0.006, -0.16);
    const s = SEATS[seatIdx];
    return s ? s.cardSpot : V3(0, TOP_Y + 0.006, 0);
  }

  function applyServer(state, events, netId) {
    if (netId != null) myNetId = netId;
    for (const ev of events || []) {
      if (ev.t === "clear") {
        clearTable();
        seatCards.clear(); dealerCount = 0; holeCard = null;
      } else if (ev.t === "card") {
        const isDealer = ev.seat === "dealer";
        const n = isDealer ? dealerCount++ : (seatCards.get(ev.seat) || 0);
        if (!isDealer) seatCards.set(ev.seat, n + 1);
        const opt = isDealer ? DEALER_CARD
          : (ev.seat === PLAYER_SEAT ? PLAYER_CARD : {});
        const spread = isDealer
          ? V3(-0.05 + n * 0.07, n * 0.005, 0)
          : handSpread(SEATS[ev.seat] || playerSeat, n);
        const c = dealCard(spotFor(ev.seat), ev.faceUp !== false, spread,
          { ...opt, card: ev.card || undefined });
        if (isDealer && ev.faceUp === false) holeCard = c;
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
            V3(-0.05 + 1 * 0.07, 0.005, 0), { ...DEALER_CARD, card: ev.card });
          if (at) c.body.position.copyFrom(at);
        }
      } else if (ev.t === "bet") {
        const st = SEATS[ev.seat];
        if (st) {
          const t = toWorld(st.betSpot);
          const src = toWorld(st.chipSpot);
          const chip = chips.spawn(ev.value, V3(src.x, TOP_Y + 0.12, src.z));
          chips.toss(chip, V3(t.x + rnd(-0.01, 0.01),
            TOP_Y + CHIP_H / 2 + rnd(0, 4) * CHIP_H, t.z + rnd(-0.01, 0.01)), { arc: 0.2 });
        }
      } else if (ev.t === "result" && ev.seat === PLAYER_SEAT) {
        if (ev.result === "bj") { ui.msg("BLACKJACK — 3:2 !"); audio.win(true); }
        else if (ev.result === "win") { ui.msg("GAGNÉ !"); audio.win(false); }
        else if (ev.result === "push") { ui.msg("ÉGALITÉ"); audio.ui(); }
        else { ui.msg(ev.result === "bust" ? "BRÛLÉ" : "PERDU"); audio.lose(); }
      } else if (ev.t === "clearbet") {
        const st = SEATS[ev.seat];
        if (st) {
          const back = toWorld(st.chipSpot);
          const spot = toWorld(st.betSpot);
          const near = chips.pool.filter((c) => {
            const d = c.getAbsolutePosition().subtract(spot);
            return Math.hypot(d.x, d.z) < 0.18 && Math.abs(d.y) < 0.25;
          });
          chips.slideStack(near, V3(back.x, TOP_Y + 0.03, back.z), 40);
        }
      } else if (ev.t === "shuffle") {
        audio.shuffle();
      }
    }
    if (state) {
      G.phase = state.phase;
      // Ma place est celle que le serveur associe à mon identifiant réseau, pas
      // celle que je crois occuper : lui seul fait foi.
      const me = state.seats.find((s) => s.pid && s.pid === myNetId) || null;
      ui.setDealerVal(state.dealer.total ?? "—");
      ui.setPlayerVal(me && me.total ? me.total : "—");
      ui.setBet(me ? me.bet : 0);
      // le portefeuille suit la caisse du serveur — le front ne débite plus rien
      if (me && Number.isFinite(me.cash) && me.cash !== state_.cash) {
        state_.cash = me.cash;
        ui.updateCash();
      }
      if (G.seated) {
        const mine = state.phase === "player" && state.turn === PLAYER_SEAT;
        ui.showBetPanel(state.phase === "betting");
        ui.showActions(mine, { canDouble: mine && me && me.hand.length === 2 });
        if (state.phase === "betting") ui.msg("Faites vos jeux");
        else if (mine) ui.msg("À vous de jouer");
        else if (state.phase === "player") ui.msg("Tour du joueur " + state.turn);
        else if (state.phase === "dealer") ui.msg("Le croupier joue");
      }
    }
  }

  /* ---------------- API ---------------- */
  let stacksBuilt = false;
  const api = {
    root, seatHits, SEATS, NPC_SEATS, toWorld, G, dealer, npcs, applyServer,
    get PLAYER_SEAT() { return PLAYER_SEAT; },
    seatPos: (i = PLAYER_SEAT) => toWorld(SEATS[i].chair),
    tableCenter: () => toWorld(V3(0, TOP_Y, 0)),
    dealerPos: () => toWorld(V3(0, 1.35, -1.5)),

    /** @param {number} i place choisie ; les jetons sont bâtis à cet endroit. */
    sit(i = PLAYER_SEAT) {
      if (SEATS[i] && !NPC_SEATS.includes(i)) {
        PLAYER_SEAT = i;
        playerSeat = SEATS[i];
      }
      G.seated = true;
      if (!stacksBuilt) { stacksBuilt = true; refillPlayerStacks(); }
      audio.chipRiffle();
      // Aucune partie n'est lancée ici : la table tourne côté serveur et nous
      // envoie son état. Auparavant `beginBetting()` déclenchait `npcBets()`,
      // qui posait des jetons LOCAUX en double de ceux du serveur.
    },
    leave() {
      G.seated = false;
      ui.showBetPanel(false); ui.showActions(false);
    },
    tick(dt, playerPos) {
      // la chaise occupée s'ouvre ; les autres se referment dès qu'on s'éloigne
      for (let i = 0; i < chairCols.length; i++) {
        const cc = chairCols[i];
        if (!cc) continue;
        const near = playerPos && B.Vector3.Distance(
          playerPos, toWorld(SEATS[i].chair)) < 1.1;
        cc.checkCollisions = !(near && (G.seated || i === PLAYER_SEAT));
      }
      dealer.tick(dt, playerPos);
      npcs.forEach((p) => p.npc.tick(dt));
    },
  };
  return api;
}
