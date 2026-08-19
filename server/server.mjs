/**
 * Serveur du casino : Next.js + WebSocket, dans un seul process.
 *
 * Le jeu (index.html, src/, assets/) reste à la RACINE du dépôt et n'a pas été
 * déplacé — ce serveur le sert tel quel en statique. Next ne gère que ses
 * propres routes (/_next, /api, et la page d'état). On évite ainsi de dupliquer
 * les 19 Mo de .glb dans un dossier public/.
 *
 * Ce qui SUIT le joueur d'une session à l'autre — pseudo, caisse, dernière
 * position debout — vit dans `server/profiles.mjs`, sur disque. Le reste (la
 * main en cours, la place assise, la chaleur, le concert) est volatile et
 * repart de zéro au redémarrage.
 */
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { Table } from "./blackjack.mjs";
import { Concert } from "./concert.mjs";
import { Jackpot } from "./jackpot.mjs";
import { ADVANCE_CASH, FLOOR_CASH, Profiles } from "./profiles.mjs";
import { Room } from "./room.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const GAME_ROOT = resolve(HERE, "..");           // la racine du dépôt
const PORT = Number(process.env.PORT || 8123);
const dev = process.env.NODE_ENV !== "production";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".mp3": "audio/mpeg",
};

/* ------------------------------------------------------------ fichiers du jeu */

// Types qui valent la peine d'être compressés (les mp3/png/jpg le sont déjà).
// Les .glb gagnent 30-60 % : géométrie et JSON s'y compressent très bien.
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".glb", ".wasm"]);
// gzip d'un .glb de 11 Mo = ~200 ms de CPU : on ne le paie qu'une fois par
// version de fichier, le résultat reste en mémoire (clé = chemin, version = etag).
const gzCache = new Map();
// Le CODE (html, modules ES, css, json) doit toujours revalider : les modules
// arrivent en ~30 requêtes séparées, et un cache qui en garde certains d'une
// version et d'autres de la suivante mélange deux mondes — vu en vrai sur
// mobile : un vieux world.js sans LAYOUT.roulette1 face à un venues.js neuf,
// et boot() meurt sur « P.clone ». Un 304 par fichier ne coûte presque rien ;
// seuls les médias lourds (glb, sons, images) méritent un vrai max-age.
const ALWAYS_REVALIDATE = new Set([".html", ".js", ".mjs", ".css", ".json"]);

/** Sert un fichier du dépôt, en refusant toute sortie de l'arborescence. */
async function serveGameFile(req, res) {
  const url = new URL(req.url, "http://x");
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  // normalize() écrase les ".." ; on revérifie ensuite que le chemin reste dedans
  const target = resolve(GAME_ROOT, "." + normalize(rel));
  if (!target.startsWith(GAME_ROOT)) {
    res.writeHead(403).end("interdit");
    return true;
  }
  try {
    const st = await stat(target);
    if (!st.isFile()) return false;
    const etag = `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
    const headers = {
      "content-type": MIME[extname(target)] || "application/octet-stream",
      etag,
      // `no-cache` et pas `no-store` : le navigateur GARDE le fichier et ne
      // demande que « a-t-il changé ? » (304). Avec no-store, chaque visite
      // re-téléchargeait l'intégralité des assets — 90 Mo de .glb et de sons.
      "cache-control": dev || ALWAYS_REVALIDATE.has(extname(target))
        // `private` en plus : Cloudflare réécrit le Cache-Control des réponses
        // qu'il juge cachables (Browser Cache TTL de zone, 4 h) — no-cache seul
        // ressortait en max-age=14400 et le mix de versions restait possible.
        // Une réponse private n'est ni gardée à l'edge ni réécrite.
        ? "private, no-cache"
        : "public, max-age=86400",
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers).end();
      return true;
    }
    let body = await readFile(target);
    const ext = extname(target);
    if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      const hit = gzCache.get(target);
      body = hit?.etag === etag ? hit.buf
        : (gzCache.set(target, { etag, buf: gzipSync(body) }), gzCache.get(target).buf);
      headers["content-encoding"] = "gzip";
    }
    headers["content-length"] = body.length;
    res.writeHead(200, headers);
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ plan (éditeur) */

/**
 * Le mode éditeur du client (F2) lit et écrit ici son calque de surcharges.
 * Un seul fichier, un chemin fixe : rien à valider côté chemin. Le contenu est
 * re-sérialisé depuis le JSON parsé — on ne stocke jamais l'octet brut reçu.
 */
const LAYOUT_FILE = join(GAME_ROOT, "assets", "layout.json");

async function handleLayout(req, res) {
  if (req.method === "GET") {
    let body = "{}";
    try { body = await readFile(LAYOUT_FILE, "utf8"); } catch { }
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }
  if (req.method === "POST") {
    let raw = "", size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 512 * 1024) { res.writeHead(413).end("trop gros"); return; }
      raw += chunk;
    }
    try {
      const j = JSON.parse(raw);
      const clean = {
        anchors: j.anchors && typeof j.anchors === "object" ? j.anchors : {},
        overrides: j.overrides && typeof j.overrides === "object" ? j.overrides : {},
        clones: Array.isArray(j.clones) ? j.clones : [],
        cameras: j.cameras && typeof j.cameras === "object" ? j.cameras : {},
        // poses de figurants (mode pose de l'éditeur, voir src/pose.js)
        poses: j.poses && typeof j.poses === "object" ? j.poses : {},
      };
      await writeFile(LAYOUT_FILE, JSON.stringify(clean, null, 2) + "\n");
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      console.log(`[plan] sauvegardé (${Object.keys(clean.overrides).length} surcharge(s), ${Object.keys(clean.anchors).length} ancre(s))`);
    } catch {
      res.writeHead(400).end("JSON invalide");
    }
    return;
  }
  res.writeHead(405).end();
}

/* --------------------------------------------------------------- salle de jeu */

/**
 * État partagé de la salle.
 * players: id -> {
 *   id, name, p:[x,y,z], r:yaw, spot:"bar:3"|null, ts,
 *   profile,        le profil persistant (server/profiles.mjs) — la caisse y vit
 *   token,          non nul = ce profil sera réécrit sur disque
 *   sp,             POINT DE SORTIE annoncé par le client quand il est assis :
 *                   là où son corps se retrouvera en se levant (derrière la
 *                   chaise). C'est lui qu'on persiste — jamais la pose assise.
 *   free,           dernier endroit où il se tenait DEBOUT (filet de sécurité)
 *   posted,         a-t-il déjà annoncé une pose ? sinon on n'écrit rien
 * }
 * `spot` identifie la place assise revendiquée ; null = debout.
 */
const players = new Map();
let nextId = 1;

/** Les profils persistants, relus une fois pour toutes au démarrage. */
const store = new Profiles(join(HERE, "players.json"));
{
  const n = await store.load();
  console.log(`[profils] ${n} profil(s) relu(s) — ${store.file}`);
}

/**
 * Le plan de la salle côté serveur : il ne sert qu'à UNE chose, décider seul où
 * reposer un joueur qui s'en va — y compris celui qui disparaît sans prévenir.
 * Le point d'apparition suit le plan de l'éditeur s'il a été déplacé.
 */
const room = new Room();
try {
  room.useLayout(JSON.parse(await readFile(LAYOUT_FILE, "utf8")));
} catch { /* pas de plan : les défauts de LAYOUT font l'affaire */ }

const SEND_KEYS = ["id", "name", "p", "r", "spot"];
const publicView = (pl) => Object.fromEntries(SEND_KEYS.map((k) => [k, pl[k]]));

/** Jeton d'identité présenté dans l'URL du WebSocket (`/ws?id=…`). */
function tokenOf(req) {
  try { return new URL(req.url, "http://x").searchParams.get("id") || ""; }
  catch { return ""; }
}

/**
 * Recopie dans le profil ce qui doit survivre à la déconnexion.
 *
 * La position n'est pas recopiée : elle est DÉCIDÉE, par `room.respawn()`. Un
 * joueur peut disparaître sans prévenir (Alt+F4, onglet tué, réseau coupé) —
 * il n'y a alors ni « je me lève » ni dernier message, et sa dernière pose
 * connue peut être l'œil d'un joueur assis. Le serveur ne la reprend jamais
 * telle quelle : il cherche une sortie praticable, et en trouve toujours une.
 *
 * La caisse, elle, n'a rien à recopier — le portefeuille de la table EST
 * l'objet profil.
 */
function syncProfile(pl) {
  if (!pl.token) return;                 // profil volatile : rien à écrire
  const pr = pl.profile;
  // Le nom n'est PAS recopié ici : il n'entre au profil que par un `name`
  // explicite. Sinon le « Joueur 12 » posé d'office à la connexion s'y
  // installerait comme un pseudo choisi, et l'écran-titre cesserait d'en
  // réclamer un à qui n'en a jamais donné.
  pr.p = room.respawn(pl);
  pr.r = pl.r;
  pr.seen = Date.now();
}

function broadcast(wss, msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1 && c._pid !== exceptId) c.send(raw);
  }
}

function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true });
  let roomKnown = false;        // le plan des places a-t-il déjà été journalisé ?

  // LE PIT : trois tables autoritaires, indépendantes — sabots, figurants et
  // chaleurs séparés. Chacune signe ses messages de son index ; le client
  // route vers la jumelle de mise en scène correspondante. Elles tournent en
  // continu, casino vide ou non.
  const tables = [0, 1, 2].map((k) =>
    new Table((msg) => broadcast(wss, { ...msg, table: k })));
  tables.forEach((t, k) => { t.tag = "T" + k; });   // étiquette de journal

  // LE JACKPOT DU PIT : une seule cagnotte pour les trois tables. Elle monte à
  // chaque mise annexe, d'où qu'elle vienne, et s'annonce à toute la salle.
  const jackpot = new Jackpot((msg) => {
    broadcast(wss, msg);
    if (msg.hit) {
      console.log(`[jackpot] ${msg.hit.name} emporte ${msg.hit.amount} € `
        + `(table ${msg.hit.table}, place ${msg.hit.seat})`);
    }
  });
  tables.forEach((t, k) => { t.jackpot = jackpot; t.index = k; });

  // LA SCÈNE : un seul spectacle pour tout le casino. Le concert appartient au
  // serveur, pas à celui qui a appuyé sur la touche — sinon chacun aurait sa
  // chanteuse, à son propre instant.
  const concert = new Concert(
    (msg) => broadcast(wss, msg),
    join(GAME_ROOT, "assets", "sfx", "concert_song.mp3"),
    join(GAME_ROOT, "assets", "voice", "annonce_concert.mp3"));

  // LE SPECTACLE AUTOMATIQUE. Chaque fois que la salle se repeuple — personne,
  // puis au moins un joueur — le concert se lance tout seul dix minutes plus
  // tard, si la salle ne s'est pas revidée entre-temps. Un spectacle déjà en
  // cours à l'échéance (lancé à la main) vaut lancement : `start` le refuse,
  // on n'insiste pas.
  const CONCERT_AUTO_MS = 10 * 60 * 1000;
  let concertAuto = null;
  const armConcertAuto = () => {
    clearTimeout(concertAuto);
    concertAuto = setTimeout(() => {
      concertAuto = null;
      if (players.size) concert.start(0, "la maison");
    }, CONCERT_AUTO_MS);
    concertAuto.unref?.();
  };

  const TABLE_TICK = setInterval(() => {
    tables.forEach((t) => t.tick());
    concert.tick();
    jackpot.tick();
  }, 250);
  TABLE_TICK.unref?.();

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://x").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws, req) => {
    const id = nextId++;
    ws._pid = id;
    const claim = store.claim(tokenOf(req));
    // Le jeton vient d'être repris à une session encore ouverte (rechargement
    // de page, le plus souvent) : l'ancienne continue de jouer, mais sur une
    // COPIE. Sans ça les deux écriraient dans le même profil, et la session
    // fantôme — celle dont l'onglet est déjà fermé — aurait le dernier mot.
    if (claim.stolen) {
      for (const other of players.values()) {
        if (other.token !== claim.token) continue;
        other.profile = { ...other.profile, p: other.profile.p ? [...other.profile.p] : null };
        other.token = null;
        console.log(`[profils] jeton repris à ${other.name} (session ${other.id} passée en volatile)`);
      }
    }
    const profile = claim.profile;
    // LA MAISON RÉ-AVANCE, à l'arrivée seulement : une caisse persistante peut
    // tomber à zéro, et un joueur ruiné pour toujours n'aurait plus de jeu du
    // tout — ni table, ni machine, ni verre.
    const advance = profile.cash < FLOOR_CASH ? ADVANCE_CASH - profile.cash : 0;
    if (advance) profile.cash = ADVANCE_CASH;
    const me = {
      id, name: profile.name || "Joueur " + id,
      // La pose reste à l'origine tant que le client n'a rien annoncé : on ne
      // fait pas apparaître un avatar chez les autres pour quelqu'un qui n'a
      // pas encore franchi l'écran-titre.
      p: [0, 0, 0], r: profile.r || 0, spot: null, ts: Date.now(),
      profile, token: claim.token, sp: null,
      free: profile.p ? [...profile.p] : null,
      posted: false,
    };
    // la salle était vide et se repeuple : le compte à rebours du spectacle part
    if (!players.size) armConcertAuto();
    players.set(id, me);

    // état initial : qui es-tu, qui est là, ET où en est la table — un arrivant
    // doit voir la partie en cours, pas attendre le prochain coup
    ws.send(JSON.stringify({
      t: "welcome",
      you: id,
      dev,                 // le client n'active ses raccourcis de test qu'en dev
      // CE QU'ON LUI REND de sa session précédente. `saved` dit franchement si
      // ce qui suit sera réécrit en partant : sans jeton (localStorage refusé)
      // ou avec un jeton déjà en jeu dans un autre onglet, la session tourne
      // sur une copie volatile.
      me: {
        name: profile.name, cash: profile.cash,
        p: profile.p, r: profile.r,
        drinks: profile.drinks, slotBet: profile.slotBet,
        saved: !!claim.token, fresh: claim.fresh, advance,
      },
      players: [...players.values()]
        .filter((x) => x.id !== id && (x.p[0] !== 0 || x.p[2] !== 0))
        .map(publicView),
      bj: tables.map((t) => t.state()),
      concert: concert.state(),
      jackpot: jackpot.state(),
    }));
    broadcast(wss, { t: "join", player: publicView(me) }, id);
    console.log(`[ws] +${id} ${me.name} — ${profile.cash} € `
      + (claim.token ? (claim.fresh ? "(nouveau profil)" : "(profil retrouvé)")
        : `(session volatile : ${claim.why})`)
      + ` (${players.size} joueur${players.size > 1 ? "s" : ""})`);
    if (advance) console.log(`[profils] avance de ${advance} € à ${me.name}`);

    ws.on("message", (buf) => {
      let m;
      try { m = JSON.parse(buf); } catch { return; }
      const pl = players.get(id);
      if (!pl) return;

      if (m.t === "state") {
        // on ne fait confiance à rien : bornage et typage stricts
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) {
          pl.p = m.p.map((v) => Math.max(-200, Math.min(200, v)));
          pl.posted = true;
        }
        if (Number.isFinite(m.r)) pl.r = m.r;
        // une place est revendiquee par simple annonce : premier assis, premier
        // servi. Sans arbitrage, c'est le compromis assume.
        pl.spot = typeof m.spot === "string" ? m.spot.slice(0, 32) : null;
        // POINT DE SORTIE : le client, seul à connaître la géométrie des
        // chaises, annonce où son corps atterrira en se levant. C'est cette
        // position-là qu'on persistera s'il s'en va sans se relever.
        if (Array.isArray(m.sp) && m.sp.length === 3 && m.sp.every(Number.isFinite)) {
          pl.sp = m.sp.map((v) => Math.max(-200, Math.min(200, v)));
        } else if (!pl.spot) pl.sp = null;
        if (!pl.spot && pl.posted) pl.free = pl.p;
        pl.ts = Date.now();
      } else if (m.t === "name") {
        pl.name = String(m.name || "").slice(0, 24) || pl.name;
        pl.profile.name = pl.name;
        broadcast(wss, { t: "rename", id, name: pl.name });
      } else if (m.t === "wallet") {
        /**
         * Mouvement de caisse HORS blackjack : machine à sous et bar.
         *
         * Contrairement à la table, ces deux-là sont joués par le client — le
         * tirage des rouleaux est local. Le delta est donc DÉCLARÉ, pas
         * arbitré : un client bricolé peut se payer. C'est le même compromis
         * que partout ici (aucune authentification, cf. README) ; le serveur ne
         * garantit que la cohérence — bornes et plancher à zéro.
         */
        const v = Math.round(Number(m.v) || 0);
        if (v) {
          const d = Math.max(-100000, Math.min(100000, v));
          pl.profile.cash = Math.max(0, Math.round(pl.profile.cash + d));
        }
        // la caisse du serveur fait foi, même quand elle refuse le mouvement
        ws.send(JSON.stringify({ t: "wallet", cash: pl.profile.cash }));
      } else if (m.t === "spots") {
        /**
         * LE CLIENT ENSEIGNE LA SALLE. Il vient de bâtir le casino : il sait où
         * est chaque chaise et par où l'on en sort. Le serveur, lui, n'a pas de
         * géométrie — mais il doit pouvoir replacer un joueur qui a fermé sa
         * fenêtre au milieu d'une main, sans que celui-ci ait rien annoncé.
         * Cette carte est commune (tout le monde bâtit le même casino) et vaut
         * donc pour les joueurs déjà partis comme pour ceux à venir.
         */
        const n = room.learn(m.map);
        if (n && !roomKnown) {
          roomKnown = true;
          console.log(`[salle] plan appris : ${n} place(s), apparition à `
            + room.spawn.map((v) => v.toFixed(1)).join(", "));
        }
      } else if (m.t === "prefs") {
        // menues préférences de jeu, retenues d'une session à l'autre
        if (Number.isFinite(m.slotBet)) {
          pl.profile.slotBet = Math.max(5, Math.min(200, Math.round(m.slotBet)));
        }
        if (Number.isFinite(m.drinks)) {
          pl.profile.drinks = Math.max(0, Math.min(9999, Math.round(m.drinks)));
        }
      } else if (m.t === "bj") {
        // intentions de jeu : la table visée valide tout, le client ne décide rien
        const k = Number.isInteger(m.table) && m.table >= 0 && m.table < tables.length
          ? m.table : 0;
        const table = tables[k];
        if (m.do !== "bet" || Number.isFinite(m.value)) {
          console.log(`[bj T${k}] joueur ${id} : ${m.do}${m.value ? " " + m.value : ""}${Number.isInteger(m.seat) ? " place " + m.seat : ""}`);
        }
        if (m.do === "sit" && Number.isInteger(m.seat)) {
          // une seule place dans tout le pit : on quitte les autres tables
          tables.forEach((t, i) => { if (i !== k) t.leave(id); });
          // la place joue avec LE portefeuille du joueur, pas une caisse à elle
          table.sit(id, m.seat, pl.name, pl.profile);
        }
        else if (m.do === "leave") table.leave(id);
        else if (m.do === "bet") table.bet(id, m.value);
        else if (m.do === "sidebet") table.sideBet(id, m.value);
        else if (m.do === "clearbet") table.clearBet(id);
        else if (m.do === "rebet") table.rebet(id);
        else if (m.do === "bank") table.bank(id);
        else if (m.do === "buytime") table.buyTime(id);
        else if (dev && m.do === "devstreak") {
          // TRICHE DE DEV UNIQUEMENT : force la série de la place, pour tester
          // chaque palier de chaleur (flammes, ×, bonus, extinction) sans
          // gagner 5 mains. Inerte en production : `dev` est faux, la branche
          // n'existe pas. La photo diffusée propage tier/mult à tous.
          const s = table.seatOf(id);
          if (s) {
            s.streak = Math.max(0, Math.min(50, Math.floor(Number(m.value) || 0)));
            table._flush();
            console.log(`[dev] série de ${pl.name} forcée à ${s.streak} (table ${k})`);
          }
        }
        else if (["hit", "stand", "double", "split", "insure", "noinsure"].includes(m.do)) table.action(id, m.do);
      } else if (m.t === "concert") {
        // simple intention : le serveur seul décide s'il y a lieu d'y donner
        // suite (un concert déjà en cours ne se relance pas)
        if (m.do === "start") concert.start(id, pl.name);
        else if (m.do === "stop") concert.stop(id);
      } else if (m.t === "dev") {
        // journal remonté par les clients (dev) : le back voit tout
        console.log(`[dev ${id}]`, String(m.msg || "").slice(0, 400));
      } else if (m.t === "chat") {
        const text = String(m.text || "").slice(0, 200);
        if (text) broadcast(wss, { t: "chat", id, name: pl.name, text });
      }
    });

    const bye = () => {
      const pl = players.get(id);
      // ON LE SORT DE TABLE AVANT D'ÉCRIRE. `syncProfile` refuse la pose assise
      // et lui substitue le point de sortie (derrière la chaise) ; `t.leave`
      // rend la place — et laisse sa main en cours se terminer toute seule,
      // portefeuille branché, plutôt que de confisquer la mise.
      if (pl) {
        syncProfile(pl);
        store.release(pl.token);
      }
      tables.forEach((t) => t.leave(id));
      if (!players.delete(id)) return;
      // salle vide : le spectacle programmé n'a plus de public, on l'annule
      if (!players.size) { clearTimeout(concertAuto); concertAuto = null; }
      broadcast(wss, { t: "leave", id });
      console.log(`[ws] -${id} (${players.size} restant${players.size > 1 ? "s" : ""})`);
      // le dépôt ne peut pas attendre le battement suivant : l'onglet est déjà
      // fermé, et un `kill` du serveur arriverait avant
      store.flush({ force: true });
    };
    ws.on("close", bye);
    ws.on("error", bye);
  });

  // diffusion groupée : une seule trame pour tout le monde, 15 fois par seconde.
  // On n'annonce QUE les joueurs ayant émis une pose : un client qui se connecte
  // sans jamais bouger resterait sinon à [0,0,0], au milieu de la salle.
  const TICK = setInterval(() => {
    if (!players.size) return;
    const placed = [...players.values()].filter((p) => p.p[0] !== 0 || p.p[2] !== 0);
    if (placed.length) broadcast(wss, { t: "sync", players: placed.map(publicView) });
  }, 66);
  TICK.unref?.();

  // DÉPÔT RÉGULIER : une déconnexion propre écrit déjà, mais un `kill -9`, une
  // panne de courant ou un plantage n'en laissent pas le temps. On repasse donc
  // toutes les dix secondes — sans rien écrire si rien n'a changé.
  const SAVE = setInterval(() => {
    for (const pl of players.values()) syncProfile(pl);
    store.flush();
  }, 10_000);
  SAVE.unref?.();

  return wss;
}

/** Dernier dépôt avant de rendre la main. */
async function shutdown(sig) {
  console.log(`\n[${sig}] arrêt — dépôt des profils…`);
  for (const pl of players.values()) syncProfile(pl);
  await store.flush({ force: true });
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { shutdown(sig).catch(() => process.exit(1)); });
}

/* ------------------------------------------------------------------ démarrage */

const app = next({ dev, dir: HERE });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/api/layout") return handleLayout(req, res);
  // Next garde ses propres routes ; tout le reste vient du dépôt
  if (path.startsWith("/_next") || path.startsWith("/api") || path === "/etat") {
    return handle(req, res);
  }
  if (await serveGameFile(req, res)) return;
  return handle(req, res);
});

attachRealtime(server);

server.listen(PORT, () => {
  console.log(`Le Mirage — http://localhost:${PORT}`);
  console.log(`WebSocket   — ws://localhost:${PORT}/ws`);
  console.log(`État        — http://localhost:${PORT}/etat`);
});
