/* Soluciones TACA — service worker
   1. Guarda la app para abrirla sin señal (siempre intenta traer la versión más nueva primero).
   2. Guarda la librería de gráficas y las fuentes para ver gráficas sin señal.
   3. Envía los registros pendientes en segundo plano cuando vuelve la señal (Background Sync en Android). */
const CACHE = 'taca-v4';
const ARCHIVOS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const OPCIONALES = ['./chart.umd.js', 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js'];
const API_POR_DEFECTO = 'https://script.google.com/macros/s/AKfycbwIbnegW9MqqQ8S0y_06nCOdHvtf2rHyTRaovvJxlw58KXLXdji0sP3infV3nddNXbP/exec';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ARCHIVOS);
    // la librería de gráficas: si falta un archivo, la app se instala igual
    await Promise.all(OPCIONALES.map(u => fetch(u).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Apps Script siempre va directo (los datos sin señal los guarda la app en IndexedDB)
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Librería de gráficas y fuentes: primero lo guardado, y se actualiza por detrás
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(CACHE).then(async c => {
      const guardado = await c.match(req);
      const red = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => guardado);
      return guardado || red;
    }));
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => { const copia = res.clone(); caches.open(CACHE).then(c => c.put(req, copia)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});

/* ---------- Envío en segundo plano ---------- */
function abrirBD() {
  return new Promise((ok, mal) => {
    const r = indexedDB.open('taca', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('cola')) d.createObjectStore('cola', { keyPath: 'id' });
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error);
  });
}
function pedir(d, almacen, modo, fn) {
  return new Promise((ok, mal) => {
    const t = d.transaction(almacen, modo), req = fn(t.objectStore(almacen));
    t.oncomplete = () => ok(req ? req.result : undefined); t.onerror = () => mal(t.error);
  });
}
async function enviarPendientes() {
  const d = await abrirBD();
  const config = await pedir(d, 'kv', 'readonly', s => s.get('config')).catch(() => null);
  const api = (config && config.api) || API_POR_DEFECTO;
  const cola = ((await pedir(d, 'cola', 'readonly', s => s.getAll())) || []).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let enviados = 0;
  for (const reg of cola) {
    let res;
    try {
      res = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(reg) });
    } catch (err) {
      throw err; // sin señal: el navegador vuelve a intentar más tarde
    }
    let j = null;
    try { j = await res.json(); } catch {}
    if (j && j.ok) { await pedir(d, 'cola', 'readwrite', s => s.delete(reg.id)); enviados++; }
    else if (j && j.error) { reg.error = j.error; await pedir(d, 'cola', 'readwrite', s => s.put(reg)); }
  }
  if (enviados) {
    const clientes = await self.clients.matchAll({ includeUncontrolled: true });
    clientes.forEach(c => c.postMessage({ tipo: 'cola-enviada', enviados }));
  }
}
self.addEventListener('sync', e => {
  if (e.tag === 'taca-enviar') e.waitUntil(enviarPendientes());
});
