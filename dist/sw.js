// Estratégia de cache do RigRadar
// - Tudo o que é da própria origem usa "rede primeiro": o pedido vai à rede com
//   cache:'no-cache' (revalida com ETag; um 304 custa poucos bytes) e a cópia guardada
//   é atualizada. Assim, um deploy novo chega sem depender de mudar versões à mão, e
//   index.html, app.js, estilos e catalog.json vêm do mesmo deploy quando há rede.
// - Sem rede (ou se a rede não responder em NETWORK_TIMEOUT_MS e houver cópia), usa a
//   cache. As respostas de prices.json vindas da cache levam 'X-RigRadar-Offline: 1'
//   para a interface dizer que está a mostrar uma cópia guardada. A resposta de rede
//   que chegue depois continua a ser gravada (event.waitUntil).
// - /api/* (servidor local) e outras origens (Google Fonts) não passam por aqui.
// CACHE só precisa de mudar quando a lista de ASSETS ou esta lógica mudarem.
const CACHE = 'rigradar-v14';
const ASSETS = ['./', './index.html', './styles.css', './enhancements.css', './price-state.js', './compatibility.js', './recommend.js', './app.js', './catalog.json', './prices.json', './manifest.webmanifest', './favicon.svg'];
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

// Rede primeiro. A gravação da resposta de rede é registada com event.waitUntil: o browser
// pode terminar o worker logo que respondWith e os waitUntil terminem, e uma resposta que
// chega depois do timeout (quando já servimos a cópia) perder-se-ia sem isso.
function networkFirst(event, cacheKey, { offlineMark = false } = {}) {
  const network = fetch(event.request.url, { cache:'no-cache', credentials:'same-origin' });
  // A cópia é feita no primeiro .then registado, antes de a página poder consumir o corpo.
  const stored = network.then(response => {
    if (!response.ok) return;
    const copy = response.clone();
    return caches.open(CACHE).then(cache => cache.put(cacheKey, copy));
  }).catch(() => {});
  event.waitUntil(stored);
  return (async () => {
    const cached = await caches.open(CACHE).then(cache => cache.match(cacheKey, { ignoreSearch:true }));
    // Com cópia guardada, uma rede muito lenta não bloqueia a interface: usa-se a cópia,
    // e a resposta de rede, quando chegar, atualiza a cache para a próxima visita.
    const timeout = cached ? new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS)) : null;
    try {
      const response = await (timeout ? Promise.race([network, timeout]) : network);
      if (response && (response.ok || !cached)) return response;
    } catch { /* sem rede: usa a cópia abaixo */ }
    if (cached) return offlineMark ? markOffline(cached) : cached;
    return Response.error();
  })();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return;
  if (url.pathname.startsWith(new URL('api/', scope).pathname)) return;
  if (request.mode === 'navigate') { event.respondWith(networkFirst(event, new URL('index.html', scope).href)); return; }
  const isPrices = url.pathname === new URL('prices.json', scope).pathname;
  event.respondWith(networkFirst(event, url.origin + url.pathname, { offlineMark:isPrices }));
});
