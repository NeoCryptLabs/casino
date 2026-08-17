/**
 * L'ENSEIGNE DU JACKPOT DU PIT.
 *
 * Un seul chiffre, en néon, au-dessus des trois tables de blackjack — et c'est
 * le seul objet du casino que tout le monde regarde en même temps. Il monte à
 * chaque mise annexe posée n'importe où dans le pit (la cagnotte vit côté
 * serveur, cf. server/jackpot.mjs) ; le client ne fait que la rendre.
 *
 * Deux détails font tout le travail :
 *  - LE CHIFFRE DÉFILE. Il ne saute pas de 2 500 à 2 512 : il roule jusqu'à la
 *    valeur annoncée, avec un petit sursaut à chaque montée. Une cagnotte qui
 *    grimpe sous les yeux vaut dix panneaux d'explication.
 *  - LE COUP GAGNANT PREND LA SALLE. Quand quelqu'un le touche, l'enseigne
 *    passe au blanc, bat, affiche le nom du vainqueur pendant huit secondes,
 *    et la salle applaudit — où que l'on soit, même à l'autre bout du casino.
 */
import { V3, C3, fmt } from "./util.js";
import { LAYOUT } from "./world.js";
const B = BABYLON;

const W = 1024, H = 320;

export function createJackpot({ scene, audio, ui }) {
  // Sur le mur du pit (+X), au-dessus de la table du milieu : visible des trois
  // places assises comme de l'allée centrale.
  const hw = LAYOUT.hall.w / 2;
  const pos = V3(hw - 0.34, 5.15, LAYOUT.blackjack1.z);

  const dt = new B.DynamicTexture("jpSign", { width: W, height: H }, scene, false);
  dt.hasAlpha = true;
  const mat = new B.StandardMaterial("jpSignM", scene);
  mat.diffuseTexture = dt; mat.opacityTexture = dt; mat.emissiveTexture = dt;
  mat.emissiveColor = C3(1, 1, 1);
  mat.disableLighting = true; mat.backFaceCulling = false;
  const plane = B.MeshBuilder.CreatePlane("jpSign", { width: 4.2, height: 1.31 }, scene);
  plane.position = pos;
  plane.rotation.y = -Math.PI / 2;
  // le plan présente son dos au joueur une fois tourné vers l'allée
  plane.scaling.x = -1;
  plane.material = mat;
  plane.isPickable = false;

  /**
   * Halo derrière l'enseigne — un PLAN ÉMISSIF, pas une lampe.
   *
   * Une vraie source ici coûterait une place dans le budget de lumières de la
   * salle (`raiseLightLimit(scene, 10)`), déjà rempli par le pit, le bar, les
   * machines et les projecteurs de scène : la onzième aurait été muette sur
   * certains matériaux, ou aurait forcé la recompilation de leurs shaders.
   * Les autres néons du casino font pareil — émissif plus bloom, rien de plus.
   */
  const halo = B.MeshBuilder.CreatePlane("jpHalo", { width: 5.6, height: 2.4 }, scene);
  halo.position = pos.add(V3(-0.02, -0.05, 0));
  halo.rotation.y = -Math.PI / 2;
  const haloMat = new B.StandardMaterial("jpHaloM", scene);
  const haloTex = new B.DynamicTexture("jpHaloT", { width: 256, height: 128 }, scene, false);
  {
    const c = haloTex.getContext();
    const g = c.createRadialGradient(128, 64, 4, 128, 64, 120);
    g.addColorStop(0, "rgba(255,178,70,.55)");
    g.addColorStop(1, "rgba(255,140,30,0)");
    c.fillStyle = g; c.fillRect(0, 0, 256, 128);
    haloTex.update();
  }
  haloMat.emissiveTexture = haloTex; haloMat.opacityTexture = haloTex;
  haloMat.diffuseColor = C3(0, 0, 0);
  haloMat.disableLighting = true; haloMat.backFaceCulling = false;
  haloMat.alphaMode = B.Engine.ALPHA_ADD;
  halo.material = haloMat;
  halo.isPickable = false;

  let value = 0, shown = 0, target = 0;
  let pop = 0;              // sursaut à chaque montée
  let hitUntil = 0, hitName = "", hitAmount = 0;
  let drawn = -1, t = 0;

  function draw(big) {
    const c = dt.getContext();
    c.clearRect(0, 0, W, H);
    c.textAlign = "center"; c.textBaseline = "middle";

    const gold = big ? "#fffdf4" : "#ffe9b0";
    const hue = big ? "#ffffff" : "#ffb43c";

    // bandeau du haut
    c.font = "600 46px 'Futura','Avenir Next',sans-serif";
    try { c.letterSpacing = "14px"; } catch { }
    c.shadowColor = hue; c.shadowBlur = big ? 60 : 34;
    c.fillStyle = big ? "#fff" : "#ffd76a";
    c.fillText(big ? "JACKPOT TOUCHÉ" : "JACKPOT DU PIT", W / 2, 58);
    try { c.letterSpacing = "0px"; } catch { }

    // le chiffre
    const txt = fmt(big ? hitAmount : Math.round(shown)) + " €";
    const size = txt.length > 11 ? 128 : 156;
    c.font = "700 " + size + "px 'Futura','Avenir Next',sans-serif";
    c.shadowColor = hue; c.shadowBlur = big ? 80 : 52;
    c.fillStyle = gold;
    c.fillText(txt, W / 2, 168);
    c.shadowBlur = big ? 40 : 26;
    c.fillText(txt, W / 2, 168);          // seconde passe : le néon « charge »

    // pied de l'enseigne
    c.font = "600 34px 'Futura','Avenir Next',sans-serif";
    try { c.letterSpacing = "8px"; } catch { }
    c.shadowBlur = 20;
    c.fillStyle = big ? "#ffe9b0" : "rgba(255,214,140,.72)";
    c.fillText(big ? hitName.toUpperCase().slice(0, 22) : "BRELAN ASSORTI AU 21+3",
      W / 2, 262);
    try { c.letterSpacing = "0px"; } catch { }
    dt.update();
  }
  draw(false);

  return {
    /** Nouvelle valeur annoncée par le serveur. */
    set(v) {
      if (!Number.isFinite(v)) return;
      if (!value) { value = shown = target = v; drawn = -1; return; }
      if (v > target) pop = 1;
      value = target = v;
    },

    /**
     * Quelqu'un vient de l'emporter. L'annonce est pour TOUTE la salle : la
     * cagnotte du pit n'appartient à aucune table.
     * @param {{name:string, amount:number, seat:number, table:number}} hit
     * @param {boolean} mine est-ce moi qui l'ai touché ?
     */
    celebrate(hit, mine) {
      hitName = hit.name || "un joueur";
      hitAmount = hit.amount || 0;
      hitUntil = performance.now() + 9000;
      drawn = -1;
      audio.fx?.("applause", { vol: mine ? 0.55 : 0.3 });
      audio.win?.(true);
      ui.toast(mine
        ? `JACKPOT DU PIT — ${fmt(hitAmount)} € !`
        : `${hitName} emporte le jackpot du pit — ${fmt(hitAmount)} €`, "win");
    },

    tick(dt_) {
      t += dt_;
      const big = performance.now() < hitUntil;
      // le chiffre roule vers sa valeur : une cagnotte qui grimpe se REGARDE
      if (Math.abs(target - shown) > 0.5) {
        shown += (target - shown) * Math.min(1, dt_ * 3.4);
        if (Math.abs(target - shown) < 1) shown = target;
      } else shown = target;

      pop = Math.max(0, pop - dt_ * 2.2);
      const beat = big
        ? 1 + Math.sin(t * 13) * 0.06
        : 1 + Math.sin(t * 1.6) * 0.008 + pop * pop * 0.05;
      plane.scaling.set(-beat, beat, 1);
      const h = big ? 1.5 + Math.sin(t * 13) * 0.4 : 0.85 + pop * 0.5;
      halo.scaling.set(h, h, 1);
      haloMat.alpha = big ? 1 : 0.55 + pop * 0.35;

      // on ne redessine que lorsque le chiffre affiché change vraiment
      const key = big ? -2 : Math.round(shown);
      if (key !== drawn) { drawn = key; draw(big); }
      if (!big && hitUntil && performance.now() > hitUntil) { hitUntil = 0; drawn = -1; }
    },
  };
}
