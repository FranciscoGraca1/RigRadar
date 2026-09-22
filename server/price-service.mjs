import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const VALID_AVAILABILITY = new Set(['Em stock', 'Limitado', 'Indisponível', 'Pré-encomenda', 'Desconhecido']);
const MAX_FEED_BYTES = 2_000_000;
const MAX_PAGE_BYTES = 500_000;

function assertHttpsHost(value, host) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== host || url.username || url.password) throw new Error('URL fora do domínio autorizado.');
  return url;
}

async function readLimited(response, maxBytes) {
  const header = Number(response.headers.get('content-length'));
  if (header > maxBytes) throw new Error('Resposta maior do que o limite permitido.');
  const reader = response.body.getReader();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error('Resposta maior do que o limite permitido.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function normalizeOffer(raw, source, catalogIds) {
  if (!raw || !catalogIds.has(raw.sku) || typeof raw.store !== 'string' || !raw.store.trim()) throw new Error('SKU ou loja inválidos.');
  if (!Number.isFinite(raw.price) || raw.price <= 0 || raw.price > 100_000) throw new Error('Preço inválido.');
  const url = assertHttpsHost(raw.url, source.type === 'product-jsonld' ? source.host : new URL(raw.url).hostname);
  const availability = VALID_AVAILABILITY.has(raw.availability) ? raw.availability : 'Desconhecido';
  return { sku: raw.sku, store: raw.store.trim().slice(0, 80), priceCents: Math.round(raw.price * 100), url: url.href, availability, observedAt: new Date().toISOString(), source: source.id };
}

function robotsAllowed(robotsText, path, userAgent = 'RigRadar') {
  const groups = [];
  let agents = [], rules = [], seenRule = false;
  function flush() { if (agents.length) groups.push({ agents, rules }); agents = []; rules = []; seenRule = false; }
  for (const original of robotsText.split(/\r?\n/)) {
    const line = original.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(); const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') { if (seenRule) flush(); agents.push(value.toLowerCase()); continue; }
    if ((key === 'allow' || key === 'disallow') && agents.length) { seenRule = true; rules.push({ type:key, value }); }
  }
  flush();
  const specific = groups.filter(group => group.agents.some(agent => agent !== '*' && userAgent.toLowerCase().includes(agent)));
  const applicable = specific.length ? specific : groups.filter(group => group.agents.includes('*'));
  let winning = { length:-1, type:'allow' };
  for (const group of applicable) for (const rule of group.rules) {
    if (!rule.value) continue;
    const pattern = '^' + rule.value.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\$$/, '$');
    if (new RegExp(pattern).test(path)) {
      const length = rule.value.replace(/\*/g, '').length;
      if (length > winning.length || (length === winning.length && rule.type === 'allow')) winning = { length, type:rule.type };
    }
  }
  return winning.type !== 'disallow';
}

function parseProductJsonLd(html) {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of scripts) {
    let document;
    try { document = JSON.parse(match[1]); } catch { continue; }
    const nodes = Array.isArray(document) ? document : [document];
    for (const node of nodes.flatMap(item => item?.['@graph'] || [item])) {
      if (!node || !String(node['@type']).toLowerCase().includes('product')) continue;
      const offers = Array.isArray(node.offers) ? node.offers : [node.offers];
      for (const offer of offers) {
        const price = Number(offer?.price ?? offer?.priceSpecification?.price);
        if (Number.isFinite(price) && price > 0) return { price, availability: String(offer?.availability || '').toLowerCase().includes('instock') ? 'Em stock' : 'Desconhecido' };
      }
    }
  }
  throw new Error('Preço de produto não encontrado no JSON-LD.');
}

export function createPriceService({ catalog, sources, dataDir, fetchImpl = fetch, now = () => Date.now(), contact = process.env.RIGRADAR_CONTACT || 'https://github.com/FranciscoGraca1/RigRadar/issues' }) {
  const ids = new Set(catalog.map(item => item.id));
  mkdirSync(dataDir, { recursive:true });
  const db = new DatabaseSync(join(dataDir, 'prices.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY, component_id TEXT NOT NULL, source_id TEXT NOT NULL,
    store TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK(price_cents > 0),
    availability TEXT NOT NULL, url TEXT NOT NULL, collected_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_price_history_component_time ON price_history(component_id, collected_at DESC);
  CREATE TABLE IF NOT EXISTS source_runs (
    source_id TEXT PRIMARY KEY, status TEXT NOT NULL, checked_at TEXT, error TEXT, offers_count INTEGER NOT NULL DEFAULT 0
  );`);
  const insertOffer = db.prepare('INSERT INTO price_history (component_id, source_id, store, price_cents, availability, url, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertState = db.prepare('INSERT INTO source_runs (source_id, status, checked_at, error, offers_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET status=excluded.status, checked_at=excluded.checked_at, error=excluded.error, offers_count=excluded.offers_count');
  const rows = db.prepare('SELECT component_id AS sku, source_id AS source, store, price_cents AS priceCents, availability, url, collected_at AS observedAt FROM price_history ORDER BY collected_at, id');
  const summary = db.prepare('SELECT MIN(price_cents) AS low, AVG(price_cents) AS avg, COUNT(*) AS count FROM price_history WHERE component_id = ? AND collected_at >= ? AND availability IN (\'Em stock\', \'Limitado\')');
  const savedStates = new Map(db.prepare('SELECT * FROM source_runs').all().map(row => [row.source_id, row]));
  const states = new Map(sources.map(source => { const saved = savedStates.get(source.id); return [source.id, { id:source.id, name:source.name, status:source.enabled && source.authorized ? saved?.status || 'por atualizar' : 'não configurada', checkedAt:saved?.checked_at || null, error:saved?.error || null, offersCount:saved?.offers_count || 0 }]; }));
  const pending = new Map();
  async function load() { /* A base de dados é aberta e validada no construtor. */ }

  function status() { return [...states.values()]; }
  function current(periodDays = 90) {
    const cutoff = new Date(now() - Math.max(1, Number(periodDays) || 90) * 86_400_000).toISOString();
    const yearCutoff = new Date(now() - 365 * 86_400_000).toISOString();
    const grouped = new Map();
    const historyBySku = new Map();
    for (const offer of rows.all()) {
      if (!ids.has(offer.sku)) continue;
      if (!grouped.has(offer.sku)) grouped.set(offer.sku, new Map());
      const perStore = grouped.get(offer.sku);
      const key = `${offer.source}|${offer.store}|${offer.url}`;
      if (!perStore.has(key) || perStore.get(key).observedAt < offer.observedAt) perStore.set(key, offer);
      if (offer.observedAt >= yearCutoff) {
        if (!historyBySku.has(offer.sku)) historyBySku.set(offer.sku, []);
        historyBySku.get(offer.sku).push({ timestamp:offer.observedAt, price:offer.priceCents / 100, store:offer.store, url:offer.url, availability:offer.availability, source:offer.source });
      }
    }
    return catalog.map(item => {
      const latest = [...(grouped.get(item.id)?.values() || [])].sort((a,b) => a.priceCents - b.priceCents);
      const available = latest.filter(offer => offer.availability === 'Em stock' || offer.availability === 'Limitado');
      const best = available[0] || latest[0];
      const history = historyBySku.get(item.id) || [];
      const stats = summary.get(item.id, cutoff);
      return { id:item.id, price:best ? best.priceCents / 100 : null, store:best?.store ?? null, availability:best?.availability ?? null, low:stats.count ? stats.low / 100 : null, avg:stats.count ? Math.round(stats.avg) / 100 : null, sampleCount:stats.count, statsPeriodDays:periodDays, stores:latest.map(offer => ({ store:offer.store, price:offer.priceCents / 100, availability:offer.availability, url:offer.url, observedAt:offer.observedAt })), history, observedAt:best?.observedAt ?? null };
    });
  }

  async function fetchText(url, maxBytes, headers = {}) {
    const response = await fetchImpl(url, { headers:{ 'User-Agent':`RigRadar/1.0 (+${contact})`, ...headers }, redirect:'error', signal:AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return readLimited(response, maxBytes);
  }

  async function fromPartnerFeed(source) {
    if (!source.url || !source.host) throw new Error('Feed ou domínio não configurado.');
    assertHttpsHost(source.url, source.host);
    const token = source.tokenEnv ? process.env[source.tokenEnv] : null;
    const text = await fetchText(source.url, MAX_FEED_BYTES, token ? { Authorization:`Bearer ${token}` } : {});
    const feed = JSON.parse(text);
    if (!Array.isArray(feed)) throw new Error('O feed precisa de ser uma lista de ofertas.');
    return feed.map(item => normalizeOffer(item, source, ids));
  }

  async function fromProducts(source) {
    if (!source.host || !source.robotsUrl) throw new Error('Domínio ou robots.txt não configurado.');
    assertHttpsHost(source.robotsUrl, source.host);
    const robots = await fetchText(source.robotsUrl, 100_000);
    const offers = [];
    for (const [index, [sku, urlText]] of Object.entries(source.products || {}).entries()) {
      try {
        if (index) await new Promise(resolve => setTimeout(resolve, 1000));
        if (!ids.has(sku)) throw new Error('SKU desconhecido.');
        const url = assertHttpsHost(urlText, source.host);
        if (!robotsAllowed(robots, url.pathname + url.search)) throw new Error('Bloqueado por robots.txt.');
        const html = await fetchText(url.href, MAX_PAGE_BYTES);
        const details = parseProductJsonLd(html);
        offers.push(normalizeOffer({ sku, store:source.name, price:details.price, url:url.href, availability:details.availability }, source, ids));
      } catch (error) { states.get(source.id).error = `${states.get(source.id).error ? states.get(source.id).error + ' ' : ''}${sku}: ${error.message}`.slice(0, 300); }
    }
    return offers;
  }

  async function refreshOne(source) {
    if (!source.enabled || !source.authorized) return states.get(source.id);
    if (pending.has(source.id)) return pending.get(source.id);
    const state = states.get(source.id);
    const ttl = Math.max(10, Number(source.minRefreshMinutes) || 10) * 60_000;
    if (state.checkedAt && now() - Date.parse(state.checkedAt) < ttl) return { ...state, cached:true };
    const job = (async () => {
      state.status = 'a atualizar'; state.error = null;
      try {
        const fetched = source.type === 'partner-json' ? await fromPartnerFeed(source) : source.type === 'product-jsonld' ? await fromProducts(source) : (() => { throw new Error('Tipo de origem não suportado.'); })();
        if (fetched.length) {
          db.exec('BEGIN');
          try { for (const offer of fetched) insertOffer.run(offer.sku, offer.source, offer.store, offer.priceCents, offer.availability, offer.url, offer.observedAt); db.exec('COMMIT'); }
          catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        state.status = state.error ? 'parcial' : fetched.length ? 'atualizada' : 'sem dados';
        state.offersCount = fetched.length;
      } catch (error) { state.status = 'erro'; state.error = error.message.slice(0, 300); }
      state.checkedAt = new Date(now()).toISOString();
      insertState.run(state.id, state.status, state.checkedAt, state.error, state.offersCount);
      return { ...state };
    })().finally(() => pending.delete(source.id));
    pending.set(source.id, job);
    return job;
  }

  async function refresh() { return Promise.all(sources.map(refreshOne)); }
  return { load, current, status, refresh, refreshOne, close:() => db.close() };
}

export const internals = { robotsAllowed, parseProductJsonLd, normalizeOffer };
