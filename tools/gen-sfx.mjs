/**
 * Génération HORS LIGNE des bruitages, via l'API « sound effects » d'ElevenLabs.
 *
 * Le jeu ne parle à aucune API au runtime : ce script écrit des mp3 statiques
 * dans assets/sfx/, que audio.js se contente ensuite de lire. On le relance à
 * la main quand on veut retoucher un son.
 *
 *   ELEVENLABS_API_KEY=sk_... node tools/gen-sfx.mjs            # tout ce qui manque
 *   ELEVENLABS_API_KEY=sk_... node tools/gen-sfx.mjs --force    # tout régénérer
 *   ELEVENLABS_API_KEY=sk_... node tools/gen-sfx.mjs slot_lever # un seul son
 *
 * Chaque appel est facturé : par défaut on NE régénère PAS un fichier déjà
 * présent. `--force` est explicite pour cette raison.
 */
import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sfx");
const API = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";

/**
 * Les prompts. Deux règles apprises sur ce type d'API :
 *  - décrire la MÉCANIQUE (« detent », « ratchet »), pas l'ambiance : sinon on
 *    récupère un fond de casino entier là où on veut un seul clac ;
 *  - dire explicitement « no music, no voices, dry, close-miked », sans quoi
 *    le générateur ajoute une nappe et une réverb qui bagarrent avec la nôtre
 *    (la salle a déjà son convolueur dans audio.js).
 */
const SOUNDS = [
  {
    name: "slot_lever",
    text:
      "A single mechanical slot machine arm being pulled down and released: " +
      "a heavy spring-loaded ratchet stretching, then a solid metal clunk as " +
      "it locks. Close-miked, dry, no music, no voices, no room reverb.",
    duration_seconds: 1.2,
    prompt_influence: 0.6,
  },
  {
    name: "slot_reel_loop",
    text:
      "Seamless continuous loop of three mechanical slot machine reels " +
      "spinning fast: a steady whirring drum with a rapid regular ticking of " +
      "detents. Constant speed, no start, no stop, no music, no voices, dry.",
    duration_seconds: 4,
    prompt_influence: 0.7,
    loop: true,
  },
  {
    name: "slot_reel_stop",
    text:
      "One slot machine reel snapping into its detent and stopping: a short " +
      "dry mechanical clack with a faint metallic ring. Single hit, no tail, " +
      "no music, no voices.",
    duration_seconds: 0.7,
    prompt_influence: 0.7,
  },
  {
    name: "slot_win",
    text:
      "Short cheerful retro arcade slot machine win jingle: a bright ascending " +
      "chime arpeggio over a few electronic bell blips. Clean 8-bit style, " +
      "no voices, no applause.",
    duration_seconds: 2,
    prompt_influence: 0.4,
  },
  {
    name: "slot_jackpot",
    text:
      "Slot machine jackpot celebration: a fast rising arcade fanfare of bells " +
      "and chimes, then a rapid stream of metal coins pouring into a tray. " +
      "Energetic, no voices, no applause.",
    duration_seconds: 5,
    prompt_influence: 0.45,
  },
  /**
   * LES PAS. Le sol de la salle est de la MOQUETTE (world.js, `carpetMat`),
   * sauf le disque de marbre de 8,4 m autour de la fontaine — deux surfaces,
   * donc deux familles de sons. Plusieurs variantes par surface : un pas
   * unique rejoué en boucle s'entend immédiatement comme une machine à coudre,
   * même avec de la variation de hauteur.
   *
   * Le prompt insiste sur UN SEUL pas : par défaut le générateur en enchaîne
   * trois ou quatre, ce qui décale tout le rythme de la marche.
   */
  // SUBTILITÉ AVANT TOUT : ces pas s'entendent des centaines de fois par
  // session, à cadence régulière — le moindre claquement devient une machine.
  // Les prompts demandent donc des impacts très doux, attaque molle, aucun
  // détail « intéressant » (pas de scuff, pas de click) : un pas qu'on devine
  // plus qu'on ne l'écoute.
  {
    name: "step_carpet_1",
    text:
      "ONE extremely soft, gentle footstep on thick plush carpet, then " +
      "silence. A quiet, barely-there muffled thud with a soft attack and " +
      "very low dynamics — no heel click, no scuff, no fabric detail. " +
      "Subtle background foley, one single impact only. " +
      "Close-miked, dry, no music, no voices, no reverb.",
    duration_seconds: 0.7,
    prompt_influence: 0.8,
  },
  {
    name: "step_carpet_2",
    text:
      "A single very quiet footstep sinking into deep soft carpet: a gentle " +
      "rounded muffled bump, softer than a heartbeat, smooth attack, no " +
      "click, no rustle. One step only, understated foley for a walking " +
      "loop. Close-miked, dry, no music, no voices, no reverb.",
    duration_seconds: 0.5,
    prompt_influence: 0.8,
  },
  {
    name: "step_carpet_3",
    text:
      "ONE soft discreet footstep on wool carpet, then silence. A low gentle " +
      "muted thump, quiet and rounded, with the faintest breath of fibre — " +
      "no scuff, no click, nothing sharp. One single impact in the whole " +
      "recording. Dry, no music, no voices, no reverb.",
    duration_seconds: 0.7,
    prompt_influence: 0.8,
  },
  {
    name: "step_marble_1",
    text:
      "One quiet, discreet footstep of a soft leather sole set down gently " +
      "on polished marble: a small mellow tap, low volume, soft attack, the " +
      "faintest short ring — NOT a sharp heel click. Single step only. " +
      "Close-miked, dry, no music, no voices, no big hall reverb.",
    duration_seconds: 0.6,
    prompt_influence: 0.8,
  },
  {
    name: "step_marble_2",
    text:
      "A single gentle footstep on smooth stone tile: a quiet subdued tap " +
      "with a soft rounded attack, barely any ring, no scuff. Understated, " +
      "discreet, one impact only. Close-miked, dry, no music, no voices, " +
      "no big hall reverb.",
    duration_seconds: 0.6,
    prompt_influence: 0.8,
  },
  {
    /**
     * La carte d'une main perdue se consume (Card.burn, dur 1,25 s).
     *
     * SOURD AVANT TOUT. Une main brûle carte par carte à 130 ms d'écart : un
     * échantillon détaillé (crépitement fin, froissement de papier) devient une
     * friture de transitoires aigus dès la deuxième carte. On veut un SOUFFLE
     * grave, étouffé, plus senti qu'entendu — la braise sous le feutre, pas le
     * feu de camp. Le prompt bannit donc explicitement tout ce qui claque.
     */
    name: "card_burn",
    text:
      "A deep muffled low-frequency flame whoosh, dull and smothered, as if " +
      "heard through cloth: a soft rounded breath of fire swelling and fading " +
      "into warm smouldering air. Dark, bassy, heavily damped, NO crackle, NO " +
      "snapping, NO paper rustle, no sharp transients, no high frequencies. " +
      "Quiet, understated, one single continuous swell. Close-miked, dry, " +
      "no music, no voices, no room reverb.",
    duration_seconds: 1.5,
    prompt_influence: 0.8,
  },
  /**
   * LES JETONS. Même piège que les pas, en pire : `chips.js` déclenche un son
   * à CHAQUE collision physique un peu énergique (seuil 0,06), donc une poignée
   * de jetons lancée sur le feutre en fait partir dix en une demi-seconde. Un
   * échantillon claquant, métallique ou plastique, tourne aussitôt au grelot.
   *
   * On demande donc de l'ARGILE : un jeton de casino est lourd, mat, sourd —
   * un « tok » grave sans résonance. Les prompts interdisent explicitement le
   * métal, le plastique et le pluriel (le générateur adore livrer une poignée
   * de jetons là où on n'en veut qu'un, et la superposition fait le reste).
   */
  {
    name: "chip_clink",
    text:
      "ONE single heavy clay casino chip landing flat on a stack of chips on " +
      "a felt table: a soft dull low 'tok', muted and woody, with no ring and " +
      "no tail. Quiet, damped, understated. NOT metallic, NOT plastic, no " +
      "coin sound, no rattle, no jingle. One single impact only in the whole " +
      "recording. Close-miked, dry, no music, no voices, no reverb.",
    duration_seconds: 0.5,
    prompt_influence: 0.85,
  },
  {
    name: "chip_stack",
    text:
      "ONE clay casino chip laid down gently on green felt: a very quiet " +
      "muffled pat, soft attack, almost no click, absorbed by the cloth. " +
      "Subtle background foley, one single soft impact. NOT metallic, NOT " +
      "plastic, no ring, no rattle. Close-miked, dry, no music, no voices, " +
      "no reverb.",
    duration_seconds: 0.5,
    prompt_influence: 0.85,
  },
  {
    name: "chip_riffle",
    text:
      "A short discreet riffle of a small stack of clay poker chips between " +
      "fingers: a quick low muted flutter of dull woody taps, quiet and " +
      "rounded, dying immediately. Brief, understated, no metallic ring, no " +
      "plastic clatter, no coins. Close-miked, dry, no music, no voices, " +
      "no reverb.",
    duration_seconds: 0.8,
    prompt_influence: 0.8,
  },
  {
    name: "chip_cascade",
    text:
      "A dealer pushing a pile of clay casino chips across felt toward a " +
      "winner: a warm low tumbling of dull chips sliding and toppling, soft " +
      "and rounded, settling quickly. Muted and woody, NOT metal coins, no " +
      "jingle, no ring, no jackpot rain. Close-miked, dry, no music, " +
      "no voices, no reverb.",
    duration_seconds: 1.6,
    prompt_influence: 0.8,
  },
  {
    name: "slot_lose",
    text:
      "Short descending two-note arcade fail tone, soft and low, a slot " +
      "machine ending a spin with nothing. Subtle, not comedic, no voices.",
    duration_seconds: 1,
    prompt_influence: 0.4,
  },
];

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY manquante. Relance :\n  ELEVENLABS_API_KEY=sk_... node tools/gen-sfx.mjs");
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));

const exists = (p) => access(p).then(() => true, () => false);

async function generate(s) {
  const file = join(OUT, s.name + ".mp3");
  if (!force && (await exists(file))) {
    console.log(`· ${s.name} — déjà là, ignoré (--force pour régénérer)`);
    return;
  }
  const body = {
    text: s.text,
    duration_seconds: s.duration_seconds,
    prompt_influence: s.prompt_influence ?? 0.3,
    model_id: "eleven_text_to_sound_v2",
  };
  // `loop` n'existe que sur le modèle v2 : si l'API le refuse, on retente sans,
  // quitte à devoir raccorder la boucle à la main (audio.js saute déjà les bords)
  if (s.loop) body.loop = true;

  for (const attempt of [body, s.loop ? { ...body, loop: undefined } : null]) {
    if (!attempt) break;
    const r = await fetch(API, {
      method: "POST",
      headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify(attempt),
    });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(file, buf);
      console.log(`✓ ${s.name} — ${(buf.length / 1024).toFixed(0)} Ko${attempt.loop ? " (bouclé)" : ""}`);
      return;
    }
    const msg = await r.text().catch(() => "");
    if (attempt.loop) {
      console.warn(`  ${s.name} : loop refusé (${r.status}), nouvelle tentative sans`);
      continue;
    }
    throw new Error(`${s.name} : ${r.status} ${msg.slice(0, 300)}`);
  }
}

await mkdir(OUT, { recursive: true });
const todo = only.length ? SOUNDS.filter((s) => only.includes(s.name)) : SOUNDS;
if (!todo.length) {
  console.error("Aucun son ne correspond. Disponibles : " + SOUNDS.map((s) => s.name).join(", "));
  process.exit(1);
}
for (const s of todo) await generate(s);   // en série : l'API limite le parallélisme
