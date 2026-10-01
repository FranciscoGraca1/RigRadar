// Estratégia de cache do RigRadar
// - Tudo o que é da própria origem usa "rede primeiro": o pedido vai à rede com
//   cache:'no-cache' (revalida com ETag; um 304 custa poucos bytes) e a cópia guardada
//   é atualizada. Assim, um deploy novo chega sem depender de mudar versões à mão, e
//   index.html, app.js, estilos e catalog.json vêm do mesmo deploy quando há rede.
// - Sem rede (ou se a rede não responder em NETWORK_TIMEOUT_MS e houver cópia), usa a
//   cache. As respostas de prices.json vindas da cache levam 'X-RigRadar-Offline: 1'
//   para a interface dizer que está a mostrar uma cópia guardada.
// - /api/* (servidor local) e outras origens (Google Fonts) não passam por aqui.
// CACHE só precisa de mudar quando a lista de ASSETS ou esta lógica mudarem.
const CACHE = 'rigradar-v12';
const ASSETS = ['./', './index.html', './styles.css', './enhancements.css', './price-state.js', './recommend.js', './app.js', './catalog.json', './prices.json', './manifest.webmanifest', './favicon.svg'];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache:'no-cache' })))).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
])));

async function markOffline(response) {
  const headers = new Headers(response.headers); headers.set('X-RigRadar-Offline', '1');
  return new Response(await response.blob(), { status:response.status, statusText:response.statusText, headers });
}

async function networkFirst(request, cacheKey, { offlineMark = false } = {}) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(cacheKey, { ignoreSearch:true });
  const network = fetch(request.url, { cache:'no-cache', credentials:'same-origin' }).then(response => {
    if (response.ok) cache.put(cacheKey, response.clone());
    return response;
  });
  network.catch(() => {}); // a falha é tratada abaixo; evita rejeição não tratada se o timeout ganhar
  // Com cópia guardada, uma rede muito lenta não bloqueia a interface: usa-se a cópia,
  // e a resposta de rede, se chegar, atualiza a cache para a próxima visita.
  const timeout = cached ? new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS)) : null;
  try {
    const response = await (timeout ? Promise.race([network, timeout]) : network);
    if (response && (response.ok || !cached)) return response;
  } catch { /* sem rede: usa a cópia abaixo */ }
  if (cached) return offlineMark ? markOffline(cached) : cached;
  return Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return;
  if (url.pathname.startsWith(new URL('api/', scope).pathname)) return;
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request, new URL('index.html', scope).href)); return; }
  const isPrices = url.pathname === new URL('prices.json', scope).pathname;
  event.respondWith(networkFirst(request, url.origin + url.pathname, { offlineMark:isPrices }));
});
