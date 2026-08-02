/**
 * Serveur du casino : Next.js + WebSocket, dans un seul process.
 *
 * Le jeu (index.html, src/, assets/) reste à la RACINE du dépôt et n'a pas été
 * déplacé — ce serveur le sert tel quel en statique. Next ne gère que ses
 * propres routes (/_next, /api, et la page d'état). On évite ainsi de dupliquer
 * les 19 Mo de .glb dans un dossier public/.
 *
 * Aucune persistance : l'état des joueurs vit en mémoire et disparaît avec le
 * process. C'est voulu — un rafraîchissement de page repart de zéro.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { Table } from "./blackjack.mjs";

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
};

/* ------------------------------------------------------------ fichiers du jeu */

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
    const body = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target)] || "application/octet-stream",
      "content-length": body.length,
      // le jeu évolue à chaque rechargement pendant le dev
      "cache-control": dev ? "no-store" : "public, max-age=300",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- salle de jeu */

/**
 * État partagé, purement en mémoire.
 * players: id -> { id, name, p:[x,y,z], r:yaw, spot:"bar:3"|null, ts }
 * `spot` identifie la place assise revendiquée ; null = debout.
 */
const players = new Map();
let nextId = 1;

const SEND_KEYS = ["id", "name", "p", "r", "spot"];
const publicView = (pl) => Object.fromEntries(SEND_KEYS.map((k) => [k, pl[k]]));

function broadcast(wss, msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const c of wss.clients) {
    if (c.readyState === 1 && c._pid !== exceptId) c.send(raw);
  }
}

function attachRealtime(server) {
  const wss = new WebSocketServer({ noServer: true });

  // La table tourne en continu, casino vide ou non : le figurant joue toujours,
  // donc un joueur qui traverse la salle voit une partie en cours.
  const table = new Table((msg) => broadcast(wss, msg));
  const TABLE_TICK = setInterval(() => table.tick(), 250);
  TABLE_TICK.unref?.();

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://x").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws) => {
    const id = nextId++;
    ws._pid = id;
    const me = {
      id, name: "Joueur " + id,
      p: [0, 0, 0], r: 0, spot: null, ts: Date.now(),
    };
    players.set(id, me);

    // état initial : qui es-tu, qui est là, ET où en est la table — un arrivant
    // doit voir la partie en cours, pas attendre le prochain coup
    ws.send(JSON.stringify({
      t: "welcome",
      you: id,
      players: [...players.values()]
        .filter((x) => x.id !== id && (x.p[0] !== 0 || x.p[2] !== 0))
        .map(publicView),
      bj: table.state(),
    }));
    broadcast(wss, { t: "join", player: publicView(me) }, id);
    console.log(`[ws] +${id} (${players.size} joueur${players.size > 1 ? "s" : ""})`);

    ws.on("message", (buf) => {
      let m;
      try { m = JSON.parse(buf); } catch { return; }
      const pl = players.get(id);
      if (!pl) return;

      if (m.t === "state") {
        // on ne fait confiance à rien : bornage et typage stricts
        if (Array.isArray(m.p) && m.p.length === 3 && m.p.every(Number.isFinite)) {
          pl.p = m.p.map((v) => Math.max(-200, Math.min(200, v)));
        }
        if (Number.isFinite(m.r)) pl.r = m.r;
        // une place est revendiquee par simple annonce : premier assis, premier
        // servi. Sans persistance ni arbitrage, c'est le compromis assume.
        pl.spot = typeof m.spot === "string" ? m.spot.slice(0, 32) : null;
        pl.ts = Date.now();
      } else if (m.t === "name") {
        pl.name = String(m.name || "").slice(0, 24) || pl.name;
        broadcast(wss, { t: "rename", id, name: pl.name });
      } else if (m.t === "bj") {
        // intentions de jeu : la table valide tout, le client ne décide de rien
        if (m.do === "sit" && Number.isInteger(m.seat)) table.sit(id, m.seat, pl.name);
        else if (m.do === "leave") table.leave(id);
        else if (m.do === "bet") table.bet(id, m.value);
        else if (m.do === "clearbet") table.clearBet(id);
        else if (["hit", "stand", "double"].includes(m.do)) table.action(id, m.do);
      } else if (m.t === "chat") {
        const text = String(m.text || "").slice(0, 200);
        if (text) broadcast(wss, { t: "chat", id, name: pl.name, text });
      }
    });

    const bye = () => {
      table.leave(id);
      if (!players.delete(id)) return;
      broadcast(wss, { t: "leave", id });
      console.log(`[ws] -${id} (${players.size} restant${players.size > 1 ? "s" : ""})`);
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

  return wss;
}

/* ------------------------------------------------------------------ démarrage */

const app = next({ dev, dir: HERE });
const handle = app.getRequestHandler();
await app.prepare();

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
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
