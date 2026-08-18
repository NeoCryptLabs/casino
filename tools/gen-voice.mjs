/**
 * Génération HORS LIGNE de la voix du croupier (ElevenLabs text-to-speech).
 *
 * TOUT le répertoire sort du même comédien : les annonces d'arène (`ann_*`,
 * l'esprit « SUPERKILL » de Counter-Strike) ET les répliques de table jouées
 * par dealer.js. Avant, seules les annonces avaient droit à la voix de
 * bande-annonce ; le reste venait d'une vieille génération plate, et le
 * contraste s'entendait à chaque manche.
 *
 *   ELEVENLABS_API_KEY=sk_... node tools/gen-voice.mjs
 *   ELEVENLABS_API_KEY=sk_... node tools/gen-voice.mjs --force
 *   ELEVENLABS_API_KEY=sk_... node tools/gen-voice.mjs --voice=<id> --suffix=_test
 *
 * `--voice` + `--suffix` servent à comparer deux comédiens sans écraser les
 * fichiers en place : on génère ann_blackjack_test.mp3, on écoute, on tranche.
 */
import { writeFile, mkdir, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "voice");

/**
 * Voix de la bibliothèque PUBLIQUE ElevenLabs (pas une voix clonée maison) :
 * « Paul K — French Ad & Trailer Voice », français natif, taillé pour les
 * bandes-annonces. Il faut l'ajouter une fois au compte avant de s'en servir,
 * ce que fait `ensureVoice()` plus bas.
 */
const VOICE = {
  id: "ecxPjiGTvAfpGEams6ec",
  owner: "08cb726069be6a0fae454156fe8898ed6fc29841598070e2ebbb516a219efc8a",
  label: "Paul K - Annonceur du Mirage",
};

/**
 * Le modèle v3 lit les balises entre crochets comme des indications de jeu.
 * C'est ce qui fait la différence entre un mot lu et un mot GUEULÉ — sans
 * elles, « inferno » sort sur le ton d'une annonce de gare.
 */
const LINES = [
  // — Annonces d'arène (moments forts, gueulées) —
  { name: "ann_blackjack", text: "[shouting] Blackjack !" },
  { name: "ann_chauffe", text: "[aggressively] Ça chauffe !" },
  { name: "ann_en_feu", text: "[shouting] Table en feu !" },
  { name: "ann_inferno", text: "[shouting] [intense] Inferno !" },
  { name: "ann_magistral", text: "[excited] Magistral !" },

  // — Répliques de table (dealer.js) : courtes et frappées, jamais lues.
  //   Les balises portent l'intention ; le texte reste minimal, c'est ce qui
  //   fait le punch — une réplique longue retombe toujours.
  { name: "bienvenue", text: "[excited] Bienvenue au Mirage !" },
  { name: "bonne_chance", text: "[excited] Bonne chance !" },
  { name: "faites_vos_jeux", text: "[projecting] Faites vos jeux !" },
  { name: "rien_ne_va_plus", text: "[dramatic tone] Rien ne va plus !" },
  { name: "vite", text: "[hurried] Allez, on se décide !" },
  { name: "carte", text: "[confident] Carte !" },
  { name: "on_separe", text: "[confident] On sépare !" },
  { name: "assurance", text: "[mischievously] Assurance, mesdames et messieurs ?" },
  { name: "joli_coup", text: "[impressed] Joli coup !" },
  { name: "magnifique", text: "[excited] Magnifique !" },
  { name: "vous_gagnez", text: "[excited] Vous gagnez !" },
  { name: "dommage", text: "[sighs] Dommage…" },
  { name: "egalite", text: "[surprised] Égalité !" },
  { name: "la_banque_gagne", text: "[smug] La banque gagne." },
  { name: "banque_saute", text: "[shouting] La banque saute !" },
  { name: "blackjack", text: "[excited] Blackjack !" },
  { name: "ca_chauffe", text: "[aggressively] Ça chauffe, ici !" },
  { name: "table_en_feu", text: "[intense] Cette table est en feu !" },
  { name: "inferno", text: "[shouting] C'est l'inferno !" },
];

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY manquante.\n  ELEVENLABS_API_KEY=$(pass elevenlabs/api-key) node tools/gen-voice.mjs");
  process.exit(1);
}
const H = { "xi-api-key": KEY, "Content-Type": "application/json" };

const args = process.argv.slice(2);
const force = args.includes("--force");
const suffix = (args.find((a) => a.startsWith("--suffix=")) || "").split("=")[1] || "";
const voiceId = (args.find((a) => a.startsWith("--voice=")) || "").split("=")[1] || null;
const only = args.filter((a) => !a.startsWith("--"));

const exists = (p) => access(p).then(() => true, () => false);

/** Ajoute la voix partagée au compte si elle n'y est pas déjà. */
async function ensureVoice() {
  if (voiceId) return voiceId;                     // id explicite : supposé déjà dispo
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: H });
  const mine = (await r.json()).voices || [];
  if (mine.some((v) => v.voice_id === VOICE.id)) return VOICE.id;

  const add = await fetch(
    `https://api.elevenlabs.io/v1/voices/add/${VOICE.owner}/${VOICE.id}`,
    { method: "POST", headers: H, body: JSON.stringify({ new_name: VOICE.label }) }
  );
  if (!add.ok) throw new Error(`ajout de la voix : ${add.status} ${(await add.text()).slice(0, 200)}`);
  const id = (await add.json()).voice_id || VOICE.id;
  console.log(`+ voix « ${VOICE.label} » ajoutée au compte (${id})`);
  return id;
}

async function speak(id, line) {
  const file = join(OUT, line.name + suffix + ".mp3");
  if (!force && !suffix && (await exists(file))) {
    console.log(`· ${line.name} — déjà là, ignoré (--force pour régénérer)`);
    return;
  }
  const r = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${id}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        text: line.text,
        model_id: "eleven_v3",
        // stabilité basse = le comédien s'autorise l'emphase ; au-dessus il
        // aplatit tout et les balises de jeu ne servent plus à rien
        voice_settings: { stability: 0.3, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true },
      }),
    }
  );
  if (!r.ok) throw new Error(`${line.name} : ${r.status} ${(await r.text()).slice(0, 300)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(file, buf);
  console.log(`✓ ${line.name}${suffix} — ${(buf.length / 1024).toFixed(0)} Ko`);
}

await mkdir(OUT, { recursive: true });
const id = await ensureVoice();
const todo = only.length ? LINES.filter((l) => only.includes(l.name)) : LINES;
if (!todo.length) {
  console.error("Aucune réplique ne correspond. Disponibles : " + LINES.map((l) => l.name).join(", "));
  process.exit(1);
}
for (const l of todo) await speak(id, l);
