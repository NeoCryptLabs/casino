/**
 * LE GUICHET DE LA CAISSE — achat de jetons « par carte bleue ».
 *
 * L'interface de paiement est un ACCESSOIRE DE JEU : rien n'est vérifié
 * au-delà de la forme, rien ne part nulle part — la mention est affichée dans
 * la fenêtre. Le crédit passe par le canal wallet existant (bar, machines) :
 * le serveur borne le mouvement et sa caisse fait foi.
 *
 * Les jetons achetés existent PHYSIQUEMENT : les piles apparaissent sur le
 * plateau du guichet puis sont « ramassées » — aspirées vers le joueur, comme
 * un paiement de croupier à l'envers. Les recettes sont FIXES par montant :
 * un découpage glouton donnait un jeton unique pour 1 000 € — une pile de
 * plusieurs couleurs raconte mieux ce qu'on vient d'acheter.
 */
import { V3, fmt, wait } from "./util.js";

const RECIPES = {
  100: [[25, 2], [5, 10]],
  500: [[100, 3], [25, 6], [5, 10]],
  1000: [[500, 1], [100, 4], [25, 3], [5, 5]],
  5000: [[1000, 3], [500, 2], [100, 8], [25, 6], [5, 10]],
};

export function createCashierUI({ state, ui, audio, net, chips, player, venues }) {
  const $ = (id) => document.getElementById(id);
  let opened = false, busy = false, amount = 500;

  const numI = $("cbNum"), nameI = $("cbName"), expI = $("cbExp"), cvvI = $("cbCvv");
  const payB = $("cbPay"), status = $("cbStatus"), statusTxt = $("cbStatusTxt");

  /* ---------------- la carte à l'écran se remplit à mesure qu'on tape */

  const syncCard = () => {
    const d = numI.value.replace(/\D/g, "");
    $("cbNumView").textContent = (d.padEnd(16, "•").match(/.{4}/g) || []).join(" ");
    $("cbNameView").textContent = (nameI.value.trim() || "VOTRE NOM").toUpperCase();
    $("cbExpView").textContent = expI.value || "MM/AA";
  };
  numI.addEventListener("input", () => {
    const d = numI.value.replace(/\D/g, "").slice(0, 16);
    numI.value = (d.match(/.{1,4}/g) || []).join(" ");
    numI.classList.remove("bad"); syncCard();
  });
  nameI.addEventListener("input", () => { nameI.classList.remove("bad"); syncCard(); });
  expI.addEventListener("input", () => {
    const d = expI.value.replace(/\D/g, "").slice(0, 4);
    expI.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
    expI.classList.remove("bad"); syncCard();
  });
  cvvI.addEventListener("input", () => {
    cvvI.value = cvvI.value.replace(/\D/g, "").slice(0, 3);
    cvvI.classList.remove("bad");
  });

  /* ---------------- montants */

  const amtBtns = [...document.querySelectorAll("#cbAmts .cb-amt")];
  const syncPay = () => { payB.textContent = "PAYER " + fmt(amount) + " €"; };
  for (const b of amtBtns) {
    b.onclick = () => {
      amount = parseInt(b.dataset.v, 10);
      amtBtns.forEach((x) => x.classList.toggle("sel", x === b));
      syncPay(); audio.ui?.();
    };
  }

  /* ---------------- paiement (faux de bout en bout) */

  function validate() {
    let ok = true;
    const bad = (el) => { el.classList.add("bad"); ok = false; };
    if (numI.value.replace(/\D/g, "").length !== 16) bad(numI);
    if (nameI.value.trim().length < 2) bad(nameI);
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(expI.value)) bad(expI);
    if (cvvI.value.length !== 3) bad(cvvI);
    return ok;
  }

  async function pay(e) {
    e.preventDefault();
    if (busy || !opened) return;
    if (!validate()) {
      audio.lose?.();
      status.hidden = false; status.className = "err";
      statusTxt.textContent = "Vérifiez les informations de la carte";
      setTimeout(() => { if (!busy) status.hidden = true; }, 1900);
      return;
    }
    busy = true;
    $("cbForm").classList.add("busy");
    status.hidden = false; status.className = "run";
    audio.ui?.();
    statusTxt.textContent = "Connexion sécurisée…";
    await wait(750);
    statusTxt.textContent = "Autorisation en cours…";
    await wait(1250);
    status.className = "ok";
    statusTxt.textContent = "✓ Paiement accepté";
    audio.coin?.();
    await wait(850);
    busy = false;
    $("cbForm").classList.remove("busy");
    status.hidden = true;
    close();
    grant(amount);
  }

  /** Crédite la caisse et matérialise les jetons sur le plateau du guichet. */
  function grant(v) {
    state.cash += v; ui.updateCash(); net.wallet(v);
    const c = venues.cashier;
    c?.npc?.gesture?.(1.4);
    if (c?.tray && chips) {
      // la surface du marbre est MESURÉE (rayon vertical) : la cote du glb
      // Blender bouge d'une passe à l'autre, et 3 mm d'erreur suffisent à
      // noyer une pile de jetons de 4 mm d'épaisseur dans le comptoir
      const B = BABYLON, scene = chips.scene;
      const probe = scene.pickWithRay(
        new B.Ray(V3(c.tray.x, 2.4, c.tray.z), V3(0, -1, 0), 3),
        (m) => m.checkCollisions && m.isEnabled());
      const surfY = probe?.hit ? probe.pickedPoint.y : c.tray.y;
      const spawned = [];
      (RECIPES[v] || []).forEach(([val, n], i) => {
        spawned.push(...chips.stack(val, n,
          c.tray.x - 0.17 + i * 0.115,
          c.tray.z + (i % 2 ? 0.06 : -0.05),
          surfY + 0.002));
      });
      // le temps de les voir posés, puis le joueur les empoche
      setTimeout(() => {
        const p = player.position;
        chips.sweep(spawned, V3(p.x, 1.15, p.z));
      }, 1900);
    }
    ui.toast("+ " + fmt(v) + " € en jetons", "win");
  }

  /* ---------------- ouverture / fermeture */

  function open() {
    if (opened) return;
    opened = true;
    player.frozen = true;
    player.unlock();
    $("cbui").hidden = false;
    status.hidden = true;
    syncPay(); syncCard();
    venues.cashier?.npc?.gesture?.(1.0);
    setTimeout(() => numI.focus(), 60);
    audio.ui?.();
  }

  function close() {
    if (!opened || busy) return;
    opened = false;
    $("cbui").hidden = true;
    document.activeElement?.blur?.();
    player.frozen = false;
    if (state.mode === "walk") player.lock();
  }

  $("cbClose").onclick = () => close();
  $("cbForm").addEventListener("submit", pay);
  // un clic sur le fond referme le guichet (mais pas pendant l'autorisation)
  $("cbui").addEventListener("pointerdown", (e) => { if (e.target === e.currentTarget) close(); });

  return { open, close, isOpen: () => opened };
}
