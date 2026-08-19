/* Service worker MINIMAL : il existe pour que le jeu soit installable en PWA
 * (plein écran au lancement), pas pour jouer hors-ligne — un casino
 * multijoueur sans réseau n'a pas de sens, et les .glb pèsent trop lourd pour
 * les figer dans un cache qu'on oublierait d'invalider. Tout passe donc au
 * réseau, sans cache : le serveur gère déjà la revalidation (ETag). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  e.respondWith(fetch(e.request));
});
