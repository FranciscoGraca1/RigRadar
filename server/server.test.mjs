import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPriceService, internals } from './price-service.mjs';
import { askAssistant } from './assistant.mjs';

test('recolhe um feed autorizado, guarda observações e reutiliza a cache da loja', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rigradar-test-'));
  let calls = 0;
  const source = { id:'feed', name:'Feed', type:'partner-json', enabled:true, authorized:true, host:'feed.example', url:'https://feed.example/offers.json', minRefreshMinutes:10 };
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify([{ sku:'cpu7600', store:'Loja A', price:199.99, url:'https://loja.example/cpu', availability:'Em stock' }]), { status:200, headers:{ 'Content-Type':'application/json' } }); };
  try {
    const service = createPriceService({ catalog:[{ id:'cpu7600' }], sources:[source], dataDir, fetchImpl });
    await service.load();
    await service.refresh(); await service.refresh();
    assert.equal(calls, 1);
    assert.equal(service.current()[0].price, 199.99);
    assert.equal(service.current()[0].history.length, 1);
    const reopened = createPriceService({ catalog:[{ id:'cpu7600' }], sources:[source], dataDir, fetchImpl });
    await reopened.load();
    assert.equal(reopened.current()[0].stores[0].url, 'https://loja.example/cpu');
  } finally { await rm(dataDir, { recursive:true, force:true }); }
});

test('uma fonte com erro não impede outra de atualizar', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'rigradar-test-'));
  const sources = [
    { id:'bad', name:'Falha', type:'partner-json', enabled:true, authorized:true, host:'bad.example', url:'https://bad.example/offers', minRefreshMinutes:10 },
    { id:'good', name:'Disponível', type:'partner-json', enabled:true, authorized:true, host:'good.example', url:'https://good.example/offers', minRefreshMinutes:10 }
  ];
  const fetchImpl = async url => url.includes('bad.example') ? new Response('erro', { status:503 }) : new Response(JSON.stringify([{ sku:'cpu7600', store:'Loja B', price:190, url:'https://loja-b.example/cpu', availability:'Em stock' }]), { status:200 });
  try {
    const service = createPriceService({ catalog:[{ id:'cpu7600' }], sources, dataDir, fetchImpl });
    const states = await service.refresh();
    assert.equal(states[0].status, 'erro');
    assert.equal(states[1].status, 'atualizada');
    assert.equal(service.current()[0].price, 190);
  } finally { await rm(dataDir, { recursive:true, force:true }); }
});

test('respeita robots.txt e extrai preço JSON-LD', () => {
  const robots = 'User-agent: *\nDisallow: /search\nDisallow: /produto/privado\nAllow: /produto/privado/info';
  assert.equal(internals.robotsAllowed(robots, '/search?q=cpu'), false);
  assert.equal(internals.robotsAllowed(robots, '/produto/privado'), false);
  assert.equal(internals.robotsAllowed(robots, '/produto/privado/info'), true);
  assert.deepEqual(internals.parseProductJsonLd('<script type="application/ld+json">{"@type":"Product","offers":{"price":199.9,"availability":"https://schema.org/InStock"}}</script>'), { price:199.9, availability:'Em stock' });
});

test('assistente usa a API apenas com chave no servidor e contexto válido', async () => {
  let request;
  const fetchImpl = async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ output:[{ content:[{ type:'output_text', text:'A build está compatível.' }] }] }), { status:200 }); };
  const context = { selections:{ CPU:'cpu7600' }, total:1000, warnings:[], estimatedWatts:400, recommendedWatts:550 };
  const answer = await askAssistant({ message:'Está compatível?', context, fetchImpl, apiKey:'test-key', model:'test-model' });
  assert.equal(answer, 'A build está compatível.');
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(request.options.body).store, false);
  await assert.rejects(askAssistant({ message:'Olá', context, fetchImpl, apiKey:'', model:'test-model' }), /não configurada/);
});
