// Service Worker: hält die App, das Modellverzeichnis und die Wiki-Bilder offline bereit.
// Daten von GitHub und Anfragen an Gemini laufen nie über den Zwischenspeicher.
// Alle Zwischenspeicher heissen „hw-…“: Die Pokémon-App liegt unter derselben Adresse und hat ihre eigenen („app-…“).
const VERSION = "v11";
const APP = ["./", "index.html", "app.js", "erkennung.js", "speicher.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "daten/modell-index.json"];

self.addEventListener("install", e => {
  // cache: "reload" – nicht die bis zu 10 Minuten alte Kopie aus dem Browser-Zwischenspeicher nehmen
  e.waitUntil(caches.open("hw-app-" + VERSION).then(c => c.addAll(APP.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  const alt = n => (n.startsWith("hw-app-") && n !== "hw-app-" + VERSION) || ["app-v1", "app-v2", "app-v3", "app-v4", "verzeichnis"].includes(n);   // eigene alte Namen bis 1.3
  e.waitUntil(caches.keys().then(namen => Promise.all(namen.filter(alt).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname === "static.wikia.nocookie.net" || url.hostname.endsWith("gstatic.com") || url.hostname === "fonts.googleapis.com") {
    // Wiki-Bilder und Schriften: einmal geladen, dann aus dem Zwischenspeicher
    e.respondWith(caches.open("hw-bilder").then(async c => {
      const alt = await c.match(e.request);
      if (alt) return alt;
      const neu = await fetch(e.request);
      if (neu.ok) c.put(e.request, neu.clone());
      return neu;
    }));
    return;
  }
  if (url.origin === self.location.origin) {
    // App-Dateien: zuerst aus dem Netz (damit Updates ankommen), ohne Netz aus dem Zwischenspeicher
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(antwort => {
      if (antwort.ok) caches.open("hw-app-" + VERSION).then(c => c.put(e.request, antwort.clone()));
      return antwort;
    }).catch(() => caches.match(e.request).then(a => a || caches.match("index.html"))));
  }
});
