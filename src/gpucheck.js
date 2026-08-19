/**
 * DIAGNOSTIC GPU — le cas « très bon PC mais injouable ».
 *
 * Une page web ne peut PAS corriger la configuration à la place du joueur :
 * aucune API n'ouvre chrome://settings, ne réactive l'accélération matérielle
 * ni ne force le navigateur sur la carte dédiée (powerPreference, déjà posé
 * dans main.js, n'est qu'une suggestion). Tout ce qu'on peut faire — et c'est
 * ce que fait ce module — c'est DÉTECTER que le rendu ne passe pas par la
 * bonne carte et guider le joueur, pas à pas, dans SON cas précis :
 *
 *   1. rendu logiciel (SwiftShader…) : l'accélération matérielle du
 *      navigateur est coupée — le GPU, si bon soit-il, ne sert à rien ;
 *   2. GPU intégré Intel sur Windows : le navigateur tourne sur la puce de
 *      la carte mère alors qu'une carte dédiée existe peut-être (arbitrage
 *      Windows, ou câble écran branché sur la carte mère).
 *
 * Le cas 2 est une supposition (on ne voit qu'UN GPU depuis la page) : son
 * écran est donc congédiable définitivement via localStorage. Le cas 1 est
 * une certitude : il revient à chaque chargement tant qu'il n'est pas réglé.
 */

const $ = (id) => document.getElementById(id);

const DISMISS_KEY = "mirage.gpuwarn.igpu"; // « ne plus afficher » du cas 2

/** Navigateur courant, pour donner la bonne adresse de réglages. */
function browser() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return { name: "Edge", settings: "edge://settings/system" };
  if (/Firefox\//.test(ua)) return { name: "Firefox", settings: null };
  return { name: "Chrome", settings: "chrome://settings/system" };
}

/** Classe la chaîne renderer de WebGL. */
function classify(renderer) {
  // ?gpu=sw | ?gpu=igpu : forcer un cas pour tester l'écran sans la machine.
  const forced = new URLSearchParams(location.search).get("gpu");
  if (forced === "sw") return "software";
  if (forced === "igpu") return "igpu";
  const r = (renderer || "").toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render/.test(r)) return "software";
  const win = /Windows/i.test(navigator.userAgent);
  if (win && /intel/.test(r) && /(uhd|hd graphics|iris)/.test(r)) return "igpu";
  return "ok";
}

/** Un pas numéroté de la marche à suivre. */
const step = (html) => `<li>${html}</li>`;

function softwareSteps(b) {
  if (b.settings === null) {
    // Firefox : pas d'adresse copiable simple, on décrit le chemin.
    return step("Ouvrez le menu <b>≡</b> → <b>Paramètres</b> → section <b>Performances</b>")
      + step("Décochez « Utiliser les paramètres de performance recommandés », puis cochez <b>« Utiliser l'accélération graphique matérielle »</b>")
      + step("Fermez complètement Firefox et relancez-le");
  }
  return step(`Cliquez sur <b>COPIER L'ADRESSE</b> ci-dessous, collez-la dans la barre d'adresse de ${b.name} et validez`)
    + step("Activez <b>« Utiliser l'accélération graphique quand elle est disponible »</b>")
    + step(`Cliquez sur <b>Relancer</b> (ou fermez complètement ${b.name} et rouvrez-le)`)
    + step("Si c'était déjà activé : mettez à jour le pilote de votre carte graphique (GeForce Experience / AMD Software), redémarrez le PC");
}

function igpuSteps(b) {
  return step("Ouvrez les <b>Paramètres Windows</b> → <b>Système</b> → <b>Affichage</b> → <b>Paramètres graphiques</b> (ou « Cartes graphiques »)")
    + step(`Ajoutez ${b.name} à la liste, puis choisissez <b>« Hautes performances »</b>`)
    + step(`Fermez complètement ${b.name} et relancez-le`)
    + step("PC fixe (tour) : vérifiez que le câble de l'écran est branché sur la <b>carte graphique</b> (ports en bas de la tour, à l'horizontale) et non sur la carte mère");
}

/**
 * À appeler juste après la création du moteur. Retourne une promesse qui se
 * résout quand le joueur peut continuer (tout de suite si tout va bien).
 * En rendu logiciel, la définition est réduite d'office : le CPU rend chaque
 * pixel, c'est la seule façon d'obtenir quelque chose d'à peu près mobile.
 */
export function gpuGate(engine) {
  let renderer = "";
  try { renderer = engine.getGlInfo().renderer || ""; } catch { /* rien à diagnostiquer */ }

  // Le nom de la carte, en clair sous la barre de chargement : un joueur au
  // téléphone n'a qu'à LIRE ce qui est écrit — plus besoin d'ouvrir la console.
  const lt = $("loadtxt");
  if (renderer && lt) {
    const tag = document.createElement("div");
    tag.id = "gpuname";
    tag.textContent = renderer;
    lt.after(tag);
  }

  const kind = classify(renderer);
  if (kind === "ok") return Promise.resolve();
  if (kind === "igpu" && localStorage.getItem(DISMISS_KEY)) return Promise.resolve();

  if (kind === "software") engine.setHardwareScalingLevel(2);

  const b = browser();
  const soft = kind === "software";
  const box = document.createElement("div");
  box.id = "gpuwarn";
  box.innerHTML = `
    <div id="gpuwPanel">
      <div id="gpuwTitle">${soft ? "VOTRE CARTE GRAPHIQUE N'EST PAS UTILISÉE" : "LE JEU TOURNE SUR LA PUCE GRAPHIQUE INTÉGRÉE"}</div>
      <div id="gpuwWhy">${soft
        ? `Le navigateur dessine le jeu avec le processeur (rendu détecté : <b>${renderer}</b>). \
Même sur un très bon PC, c'est injouable — l'accélération graphique de ${b.name} est désactivée. Pour la réactiver :`
        : `Rendu détecté : <b>${renderer}</b>. Si ce PC possède une carte NVIDIA ou AMD, \
Windows ne la donne pas au navigateur — le jeu sera beaucoup plus fluide en corrigeant ceci :`}</div>
      <ol id="gpuwSteps">${soft ? softwareSteps(b) : igpuSteps(b)}</ol>
      <div id="gpuwBtns">
        ${soft && b.settings ? `<button id="gpuwCopy" class="mainbtn" type="button">COPIER L'ADRESSE</button>` : ""}
        <button id="gpuwGo" class="txtbtn" type="button">CONTINUER QUAND MÊME</button>
        ${soft ? "" : `<button id="gpuwNever" class="txtbtn" type="button">NE PLUS AFFICHER</button>`}
      </div>
      ${soft ? `<div id="gpuwNote">En attendant, la définition a été réduite pour rester à peu près jouable.</div>` : ""}
    </div>`;
  document.body.appendChild(box);

  const copy = $("gpuwCopy");
  if (copy) copy.onclick = async () => {
    // chrome:// est infranchissable depuis une page (navigation bloquée) :
    // le presse-papier est le maximum autorisé.
    try { await navigator.clipboard.writeText(b.settings); copy.textContent = "COPIÉE ! COLLEZ-LA DANS LA BARRE D'ADRESSE"; }
    catch { copy.textContent = b.settings; }
  };

  return new Promise((resolve) => {
    const done = () => { box.remove(); resolve(); };
    $("gpuwGo").onclick = done;
    const never = $("gpuwNever");
    if (never) never.onclick = () => { localStorage.setItem(DISMISS_KEY, "1"); done(); };
  });
}
