import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPriceService } from './price-service.mjs';
import { askAssistant } from './assistant.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const dataDir = join(root, 'data');
const port = Number(process.env.RIGRADAR_PORT || 4173);
const host = process.env.RIGRADAR_HOST || '127.0.0.1';
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Por segurança, o servidor só pode escutar no computador local.');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json', '.json':'application/json; charset=utf-8' };

async function loadJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
const catalog = await loadJson(join(dist, 'catalog.json'));
const sourceConfig = await loadJson(join(root, 'server', 'sources.json')).catch(async error => {
  if (error.code !== 'ENOENT') throw error;
  return loadJson(join(root, 'server', 'sources.example.json'));
});
await mkdir(dataDir, { recursive:true });
const prices = createPriceService({ catalog, sources:sourceConfig.sources, dataDir });
await prices.load();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 12_000) throw new Error('Pedido demasiado grande.');
  }
  return text ? JSON.parse(text) : {};
}

async function serveStatic(req, res, pathname) {
  let name;
  try { name = decodeURIComponent(pathname); } catch { json(res, 400, { error:'URL inválido.' }); return; }
  const path = resolve(dist, '.' + (name === '/' ? '/index.html' : name));
  if (!(path === dist || path.startsWith(dist + sep))) { json(res, 403, { error:'Acesso negado.' }); return; }
  try {
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type':MIME[extname(path)] || 'application/octet-stream', 'X-Content-Type-Options':'nosniff' });
    res.end(bytes);
  } catch (error) { json(res, error.code === 'ENOENT' ? 404 : 500, { error:'Ficheiro indisponível.' }); }
}

export function startServer() {
  return createServer(async (req, res) => {
    try {
      const requestHost = req.headers.host;
      if (!requestHost || ![`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(requestHost)) { json(res, 403, { error:'Origem não autorizada.' }); return; }
      if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${requestHost}`) { json(res, 403, { error:'Origem não autorizada.' }); return; }
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/api/prices' && req.method === 'GET') { json(res, 200, { components:prices.current(), sources:prices.status() }); return; }
      if (url.pathname === '/api/prices/refresh' && req.method === 'POST') { await prices.refresh(); json(res, 200, { components:prices.current(), sources:prices.status() }); return; }
      if (url.pathname === '/api/assistant' && req.method === 'POST') {
        const body = await readJsonBody(req);
        try { const answer = await askAssistant({ message:body.message, context:body.context }); json(res, 200, { answer }); }
        catch (error) { json(res, error.message === 'API de IA não configurada.' ? 503 : 502, { error:error.message }); }
        return;
      }
      if (url.pathname.startsWith('/api/')) { json(res, 404, { error:'Endpoint desconhecido.' }); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { json(res, 405, { error:'Método não permitido.' }); return; }
      await serveStatic(req, res, url.pathname);
    } catch (error) { json(res, 400, { error:error.message }); }
  }).listen(port, host, () => {
    process.stdout.write(`RigRadar em http://${host}:${port}\n`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
