// Service worker de Guerre des panneaux (généré au build par vite.config.js).
// - rend le site installable sur l'écran d'accueil du téléphone ;
// - garde l'interface de l'appli pour qu'elle s'ouvre même sans réseau.
// La carte partagée (Supabase), le fond de carte et les polices passent toujours par le réseau.
const VERSION = "__VERSION__";
const FICHIERS = __FICHIERS__;
const CACHE = "gdp-" + VERSION;

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  // pas de skipWaiting : la nouvelle version prend la main à la prochaine ouverture,
  // pour ne pas retirer des fichiers à une page déjà ouverte
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("gdp-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") {
    // la page : toujours la dernière version en ligne, celle du cache hors ligne
    ev.respondWith(fetch(req).catch(() => caches.match("./index.html", { ignoreSearch: true })));
    return;
  }
  ev.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
