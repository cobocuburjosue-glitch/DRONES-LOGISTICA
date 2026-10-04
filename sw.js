/* Soluciones TACA: permite instalar la app y abrirla aunque no haya señal.
   Siempre intenta traer la versión más nueva; si no hay internet usa la guardada. */
const CACHE = 'taca-v2';
const ARCHIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return; // Apps Script y CDN van directo
  e.respondWith(
    fetch(req)
      .then(res => { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
