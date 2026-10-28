// Guarda o "casco" das duas versões para abrirem sem rede. Chamadas de dados nunca vêm do cache.
const CACHE = 'prova-etapa2-v3';   // v3: revisão 4 (troca o casco antigo guardado nos celulares)
const SDK = 'https://www.gstatic.com/firebasejs/10.8.0/';
const SHELL = ['./', 'index.html', 'sb/', 'fb/', 'estilo.css', 'comum.js', 'config.js',
  'sb/index.html', 'sb/app.js', 'sb/api.js', 'sb/manifest.json',
  'fb/index.html', 'fb/app.js', 'fb/fb.js', 'fb/manifest.json',
  SDK + 'firebase-app.js', SDK + 'firebase-auth.js', SDK + 'firebase-firestore.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c =>
  Promise.all(SHELL.map(u => c.add(new Request(u, { mode: u.startsWith('http') ? 'cors' : 'same-origin' })).catch(() => null)))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  const casco = e.request.method === 'GET' && (u.origin === self.location.origin || u.href.startsWith(SDK));
  if (!casco) return;                                  // Supabase/Firestore/Auth: sempre rede
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); } return r; })
    .catch(async () => (await caches.match(e.request, { ignoreSearch: true }))
      || (e.request.mode === 'navigate' ? caches.match(new URL('index.html', e.request.url), { ignoreSearch: true }) : undefined)));
});
