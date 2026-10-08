// sw.js: a minimal service worker so the page installs as an app (Chrome "Install",
// Safari "Add to Dock"). It caches the app shell only, the files of this folder; it
// never touches Home Assistant, the fonts or the icon CDNs, whose requests go to the
// network as before (the browser's own cache keeps the fonts).
//
// Shell files come from the network when it answers and from the cache when it does
// not, so an edited file reaches an installed app on the next start and the app still
// opens without the server. Bump VERSION to drop files that no longer exist. The hosted
// page serves this file with Cache-Control: no-cache (vercel.json), so a new version is
// seen on the next visit. The project's figure (figure-default/) is part of the shell;
// the owner's own figure frames are never cached here: they come from another origin,
// which this worker leaves alone.
const VERSION = "muse-web-screen-1.3.0";
const SHELL = [
  "./", "./index.html", "./style.css", "./manifest.webmanifest",
  "./app.js", "./display.js", "./cards.js", "./draw.js", "./render.js", "./figure.js", "./scene.js", "./icons.js",
  "./particles.js", "./text.js", "./tables.js", "./queue.js", "./timers.js", "./weather.js", "./media.js",
  "./audio.js", "./ha.js", "./pip.js", "./demo.js", "./settings.js", "./pace.js", "./apng.js", "./figure_frames.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png",
  "./figure-default/idle.png", "./figure-default/wave.png", "./figure-default/working.png",
  "./figure-default/making.png", "./figure-default/confetti.png", "./figure-default/avatar.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const scope = new URL("./", self.location.href).pathname;
  if (!url.pathname.startsWith(scope)) return;
  const rel = "./" + url.pathname.slice(scope.length);
  const shell = rel === "./" || SHELL.includes(rel) || rel.startsWith("./demo/");
  if (!shell) return;
  event.respondWith(
    fetch(event.request).then((res) => {
      if (res.ok) caches.open(VERSION).then((cache) => cache.put(event.request, res.clone()));
      return res;
    }).catch(() => caches.match(event.request, { ignoreSearch: true })),
  );
});
