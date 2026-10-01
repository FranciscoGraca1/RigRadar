// Testa dist/sw.js num sandbox com Cache API, fetch e eventos simulados.
// O ponto central: o browser pode terminar o service worker assim que as promises
// passadas a respondWith/waitUntil terminam. Tudo o que tem de ficar gravado (como a
// resposta de rede que chega depois do timeout) tem de estar dentro desse tempo de vida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://franciscograca1.github.io/RigRadar/';

function createWorker({ fetchImpl }) {
  const stores = new Map();
  const key = request => new URL(typeof request === 'string' ? request : request.url, SCOPE).href.split('?')[0];
  function openStore(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async match(request) { const hit = store.get(key(request)); return hit ? new Response(hit.body, { status:hit.status, headers:hit.headers }) : undefined; },
      async put(request, response) { store.set(key(request), { body:await response.arrayBuffer(), status:response.status, headers:[...response.headers] }); },
      async addAll() {},
      async keys() { return [...store.keys()].map(url => new Request(url)); }
    };
  }
  const caches = { open:async name => openStore(name), keys:async () => [...stores.keys()], delete:async name => stores.delete(name) };
  const listeners = {};
  const self = { registration:{ scope:SCOPE }, addEventListener:(type, fn) => { listeners[type] = fn; }, skipWaiting:() => {}, clients:{ claim:async () => {} } };
  // Encurta os timeouts do SW (4 s → 20 ms) para o teste não esperar.
  const fastTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, 20));
  vm.runInNewContext(SOURCE, { self, caches, fetch:fetchImpl, Response, Request, Headers, URL, setTimeout:fastTimeout, Promise });
  const cacheName = SOURCE.match(/const CACHE = '([^']+)'/)[1];
  // Despacha um evento fetch e devolve a resposta e uma promise que só termina quando
  // terminar o tempo de vida do evento (respondWith + todos os waitUntil).
  function dispatch(url, mode = 'cors') {
    const lifetime = []; let responsePromise;
    const event = { request:{ url, method:'GET', mode }, respondWith(p) { responsePromise = Promise.resolve(p); lifetime.push(responsePromise); }, waitUntil(p) { lifetime.push(Promise.resolve(p)); } };
    listeners.fetch(event);
    // Novas promises podem ser acrescentadas enquanto o evento está vivo.
    const settled = (async () => { for (let done = 0; done < lifetime.length;) { await Promise.allSettled(lifetime.slice(done)); done = lifetime.length; await Promise.resolve(); } })();
    return { response:responsePromise, settled };
  }
  const cached = async url => { const response = await openStore(cacheName).match(url); return response ? response.text() : null; };
  const seed = (url, body) => openStore(cacheName).put(url, new Response(body, { status:200 }));
  return { dispatch, cached, seed };
}

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('resposta de rede que chega depois do timeout fica gravada dentro do tempo de vida do evento', async () => {
  const network = deferred();
  const worker = createWorker({ fetchImpl:() => network.promise });
  await worker.seed(`${SCOPE}prices.json`, 'v1');
  const { response, settled } = worker.dispatch(`${SCOPE}prices.json`);
  const first = await response;
  assert.equal(await first.text(), 'v1', 'rede lenta: serve a cópia guardada');
  assert.equal(first.headers.get('X-RigRadar-Offline'), '1');
  // A rede responde mais tarde; o evento só pode terminar depois de a gravar.
  setTimeout(() => network.resolve(new Response('v2', { status:200 })), 60);
  await settled;
  assert.equal(await worker.cached(`${SCOPE}prices.json`), 'v2', 'a escrita na cache não pode ficar fora do tempo de vida do evento');
});

test('resposta rápida é devolvida e gravada antes de o evento terminar', async () => {
  const worker = createWorker({ fetchImpl:async () => new Response('app-v2', { status:200 }) });
  await worker.seed(`${SCOPE}app.js`, 'app-v1');
  const { response, settled } = worker.dispatch(`${SCOPE}app.js`);
  assert.equal(await (await response).text(), 'app-v2');
  await settled;
  assert.equal(await worker.cached(`${SCOPE}app.js`), 'app-v2');
});

test('sem rede: usa a cópia e marca apenas prices.json como cópia guardada', async () => {
  const worker = createWorker({ fetchImpl:async () => { throw new TypeError('Failed to fetch'); } });
  await worker.seed(`${SCOPE}prices.json`, 'v1');
  await worker.seed(`${SCOPE}app.js`, 'app-v1');
  const prices = await worker.dispatch(`${SCOPE}prices.json`).response;
  assert.equal(await prices.text(), 'v1');
  assert.equal(prices.headers.get('X-RigRadar-Offline'), '1');
  const app = await worker.dispatch(`${SCOPE}app.js`).response;
  assert.equal(await app.text(), 'app-v1');
  assert.equal(app.headers.get('X-RigRadar-Offline'), null);
});

test('resposta de erro da rede não substitui uma cópia válida', async () => {
  const worker = createWorker({ fetchImpl:async () => new Response('erro', { status:503 }) });
  await worker.seed(`${SCOPE}prices.json`, 'v1');
  const { response, settled } = worker.dispatch(`${SCOPE}prices.json`);
  assert.equal(await (await response).text(), 'v1');
  await settled;
  assert.equal(await worker.cached(`${SCOPE}prices.json`), 'v1');
});

test('navegação sem rede devolve o index.html guardado; sem cópia devolve erro', async () => {
  const worker = createWorker({ fetchImpl:async () => { throw new TypeError('offline'); } });
  await worker.seed(`${SCOPE}index.html`, '<html>RigRadar</html>');
  assert.equal(await (await worker.dispatch(`${SCOPE}catalogo`, 'navigate').response).text(), '<html>RigRadar</html>');
  assert.equal((await worker.dispatch(`${SCOPE}nao-existe.json`).response).type, 'error');
});
