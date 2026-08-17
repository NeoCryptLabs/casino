/**
 * LE SALON — chat de casino, coin bas-gauche.
 *
 * Fermé, il ne montre que les dernières phrases, qui s'effacent d'elles-mêmes :
 * un mur de texte permanent par-dessus la salle serait insupportable en jeu.
 * ⏎ ouvre la ligne de saisie, ⏎ envoie et referme, Échap referme sans envoyer.
 *
 * TOUT LE CLAVIER LUI APPARTIENT quand il est ouvert. C'est le vrai piège de ce
 * genre de fenêtre : le jeu écoute `keydown` sur `window`, donc sans barrage on
 * marche en tapant « z », on demande une carte en tapant « h » et « m »
 * déclenche la triche de chaleur. `key()` renvoie donc `true` pour absolument
 * toute touche pendant la saisie — l'appelant s'arrête là — et `player.js`
 * ignore de son côté les frappes destinées à un champ de texte.
 *
 * Aucun historique n'est conservé côté serveur : ce qui se dit avant votre
 * arrivée est perdu, comme une conversation dans une vraie salle.
 */

const $ = (id) => document.getElementById(id);

const FADE_MS = 14000;    // survie d'une ligne, chat fermé
const FADE_OUT = 700;     // durée du fondu (doit suivre la transition CSS)
const MAX_LINES = 60;

/**
 * @param {object} o {player, audio} — `player` sert à relâcher les touches
 *   tenues à l'ouverture, `audio` à signaler l'arrivée d'un message.
 */
export function createChat({ player, audio } = {}) {
  const box = $("chat"), log = $("chatLog");
  const bar = $("chatBar"), input = $("chatIn"), hint = $("chatHint");
  let net = null, open = false;

  /** Ajoute une ligne. `from` absent = message du système (hors ligne…). */
  function push(text, { from = null, cls = "" } = {}) {
    const el = document.createElement("div");
    el.className = "chatline " + (from ? cls : "sys " + cls);
    if (from) {
      const b = document.createElement("b");
      b.textContent = from;
      el.appendChild(b);
    }
    // textContent et jamais innerHTML : le texte vient d'un autre joueur
    el.appendChild(document.createTextNode(text));
    log.appendChild(el);
    while (log.children.length > MAX_LINES) log.firstChild.remove();
    requestAnimationFrame(() => el.classList.add("in"));

    // Effacement en deux temps : d'abord le fondu, puis le retrait de la mise
    // en page. Sans le second, les lignes invisibles continuaient de pousser
    // les nouvelles vers le haut et le salon dérivait hors de l'écran.
    setTimeout(() => el.classList.add("gone"), FADE_MS);
    setTimeout(() => el.classList.add("hid"), FADE_MS + FADE_OUT);
    log.scrollTop = log.scrollHeight;
  }

  function setOpen(on) {
    if (on === open) return;
    open = on;
    box.classList.toggle("open", on);
    bar.hidden = !on;
    hint.hidden = on;
    if (on) {
      // Les touches DÉJÀ enfoncées resteraient dans le jeu de `player` : on
      // ouvre le chat en courant, `keyup` part dans le champ, et le joueur
      // continue d'avancer tout seul pendant qu'il tape.
      player?.keys.clear();
      input.value = "";
      input.focus();
      log.scrollTop = log.scrollHeight;
    } else {
      input.blur();
    }
  }

  function submit() {
    const text = input.value.trim();
    input.value = "";
    setOpen(false);
    if (!text) return;
    // Pas d'écho local : le serveur rediffuse à TOUT LE MONDE, expéditeur
    // compris. Un écho en plus afficherait chaque phrase deux fois.
    if (!net?.chat(text)) push("hors ligne — personne ne vous entend");
  }

  /**
   * Une touche du jeu. Renvoie `true` si le salon l'a consommée.
   * @param {KeyboardEvent} e
   */
  function key(e) {
    const enter = e.code === "Enter" || e.code === "NumpadEnter";
    if (!open) {
      if (!enter || e.repeat) return false;
      setOpen(true);
      e.preventDefault();
      return true;
    }
    if (enter) { submit(); e.preventDefault(); return true; }
    if (e.code === "Escape") { setOpen(false); e.preventDefault(); return true; }
    return true;      // tout le reste va dans le champ, et nulle part ailleurs
  }

  /** Message reçu du serveur (le nôtre y revient aussi). */
  function receive(m) {
    const mine = net && m.id === net.id;
    push(String(m.text ?? ""), { from: String(m.name ?? "?"), cls: mine ? "me" : "" });
    if (!mine && !open) audio?.ui?.();
  }

  return {
    bind(n) { net = n; },
    key, receive, push,
    isOpen: () => open,
    close: () => setOpen(false),
  };
}
