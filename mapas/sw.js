/* Service worker: guarda la app en el teléfono para que abra sin internet */
const CACHE = 'taca-mapas-v2';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './pdf.min.js', './pdf.worker.min.js',
  './precargados/lotes-taca-26-27.kmz'];

const TILES = 'teselas-v1', MAX_TILES = 6000;
const TILE_HOSTS = /(^mt\d\.google\.com$)|(^server\.arcgisonline\.com$)|(^tile\.openstreetmap\.org$)/;
let puts = 0;
/* Mapa base: guarda las teselas que ves con internet para verlas después sin señal */
async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  try {
    const r = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (r.ok) { cache.put(req.url, r.clone()); if (++puts % 200 === 0) trim(cache); }
    return r;
  } catch (err) {
    try { return await fetch(req); } catch (e) { return new Response('', { status: 504 }); }
  }
}
async function trim(cache) {
  const ks = await cache.keys();
  if (ks.length > MAX_TILES) for (const k of ks.slice(0, ks.length - MAX_TILES)) await cache.delete(k);
}

/* Archivos compartidos a la app desde otras apps (WhatsApp, Archivos, Drive…) */
async function shared(req) {
  try {
    const fd = await req.formData(), c = await caches.open('compartidos');
    let i = 0;
    for (const f of fd.getAll('archivos')) {
      if (!f || typeof f === 'string') continue;
      await c.put(`./compartido/${Date.now()}_${i++}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-nombre': encodeURIComponent(f.name || 'archivo') } }));
    }
  } catch (e) {}
  return Response.redirect('./?compartido=1', 303);
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
// activate: borra solo sus propias copias viejas (comparte dominio con la app TACA)
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('taca-mapas-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/compartir')) { e.respondWith(shared(req)); return; }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.test(url.hostname)) { e.respondWith(tile(req)); return; }
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    const net = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }   // rápido y offline; se actualiza en segundo plano
    return (await net) || new Response('Sin conexión', { status: 503 });
  })());
});
