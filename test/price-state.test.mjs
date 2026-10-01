import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { priceStateOf, readStored, isBuyable, ageText, priceBadge } = require('../dist/price-state.js');

const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const fresh = { id:'cpu7600', status:'atual', price:189, store:'Loja A', availability:'Em stock', observedAt:'2026-10-01T06:00:00.000Z', lastSeen:{ price:189, store:'Loja A', availability:'Em stock', observedAt:'2026-10-01T06:00:00.000Z' }, stores:[{ store:'Loja A', price:189, availability:'Em stock', url:'https://a.example', observedAt:'2026-10-01T06:00:00.000Z' }], history:[{ timestamp:'2026-10-01T06:00:00.000Z', price:189, availability:'Em stock' }], low:189, avg:189, sampleCount:1 };

test('snapshot fresco mantém o estado atual', () => {
  const state = priceStateOf(fresh, { now:NOW, maxOfferAgeHours:48 });
  assert.equal(state.state, 'atual');
  assert.equal(state.reference.price, 189);
});

test('snapshot "atual" servido da cache dias depois passa a desatualizado no browser', () => {
  const state = priceStateOf(fresh, { now:Date.parse('2026-10-05T12:00:00.000Z'), maxOfferAgeHours:48 });
  assert.equal(state.state, 'desatualizado');
  assert.deepEqual(state.stores, [], 'ofertas antigas não são listadas como compráveis');
  assert.equal(state.history.length, 1, 'o histórico continua disponível');
});

test('sem stock e sem leituras mantêm-se distintos', () => {
  const noStock = priceStateOf({ id:'x', status:'sem stock', price:null, lastSeen:{ price:150, store:'A', availability:'Indisponível', observedAt:'2026-10-01T06:00:00.000Z' }, stores:[{ store:'A', price:150, availability:'Indisponível' }] }, { now:NOW });
  assert.equal(noStock.state, 'sem stock');
  assert.equal(noStock.reference.availability, 'Indisponível');
  assert.equal(priceStateOf({ id:'x', status:'sem leituras', price:null }, { now:NOW }).state, 'sem leituras');
});

test('snapshot antigo sem status é inferido pelo preço e pela idade', () => {
  const legacy = { id:'x', price:100, store:'A', availability:'Em stock', observedAt:'2026-09-01T00:00:00.000Z', history:[] };
  assert.equal(priceStateOf(legacy, { now:NOW }).state, 'desatualizado');
  assert.equal(priceStateOf({ id:'x', price:null }, { now:NOW }).state, 'sem leituras');
});

test('payloads incompletos ou com datas inválidas não produzem preços nem lançam erros', () => {
  assert.equal(priceStateOf(null), null);
  assert.equal(priceStateOf({ price:10 }), null, 'sem id é ignorado');
  const broken = priceStateOf({ id:'x', status:'atual', price:120, availability:'Em stock', observedAt:'ontem', history:[{ price:'abc', timestamp:'2026-10-01T00:00:00Z' }, { price:90, timestamp:'nunca' }, null], stores:'lista', sampleCount:-3 }, { now:NOW });
  assert.equal(broken.state, 'sem leituras', 'preço sem data válida não tem proveniência: não é tratado como leitura real');
  assert.deepEqual(broken.history, []);
  assert.deepEqual(broken.stores, []);
  assert.equal(broken.sampleCount, 0);
  assert.equal(priceStateOf({ id:'x', status:'atual', price:-5, observedAt:'2026-10-01T06:00:00.000Z' }, { now:NOW }).state, 'sem leituras');
  assert.equal(priceStateOf({ id:'x', status:'valor-estranho', price:null }, { now:NOW }).state, 'sem leituras');
  assert.equal(priceStateOf(fresh, { now:NOW, maxOfferAgeHours:'abc' }).state, 'atual', 'limite inválido usa o valor por defeito');
});

test('"atual" sem disponibilidade comprável não conta como atual', () => {
  assert.equal(priceStateOf({ ...fresh, availability:'Indisponível' }, { now:NOW }).state, 'desatualizado');
});

test('readStored nunca lança e valida o tipo', () => {
  const storage = data => ({ getItem:key => key in data ? data[key] : null });
  const isObject = value => value != null && typeof value === 'object' && !Array.isArray(value);
  assert.deepEqual(readStored(storage({ k:'{corrompido' }), 'k', {}, isObject), {});
  assert.deepEqual(readStored(storage({ k:'null' }), 'k', {}, isObject), {});
  assert.deepEqual(readStored(storage({ k:'[1]' }), 'k', {}, isObject), {});
  assert.deepEqual(readStored(storage({ k:'{"a":1}' }), 'k', {}, isObject), { a:1 });
  assert.deepEqual(readStored(storage({}), 'k', ['x'], Array.isArray), ['x']);
  assert.deepEqual(readStored({ getItem() { throw new Error('bloqueado'); } }, 'k', 5, () => true), 5);
});

test('isBuyable exige leitura real, fresca e com stock', () => {
  assert.equal(isBuyable({ priceSource:'live', priceState:'atual', availability:'Em stock' }), true);
  assert.equal(isBuyable({ priceSource:'live', priceState:'desatualizado', availability:'Em stock' }), false);
  assert.equal(isBuyable({ priceSource:'live', priceState:'sem stock', availability:'Indisponível' }), false);
  assert.equal(isBuyable({ price:100 }), false, 'preço de exemplo nunca é comprável');
});

test('rótulos e idade legíveis', () => {
  assert.equal(priceBadge({}).text, 'Preço de exemplo');
  assert.equal(priceBadge({ priceSource:'live', priceState:'desatualizado' }).text, 'Preço desatualizado');
  assert.equal(ageText('2026-10-01T11:30:00.000Z', NOW), 'há 30 min');
  assert.equal(ageText('2026-10-01T03:00:00.000Z', NOW), 'há 9 h');
  assert.equal(ageText('2026-09-27T12:00:00.000Z', NOW), 'há 4 dias');
  assert.equal(ageText('lixo', NOW), 'data desconhecida');
});

test('"sem stock" com leitura mais antiga do que o limite passa a desatualizado', () => {
  const noStock = { id:'x', status:'sem stock', price:null, lastSeen:{ price:150, store:'A', availability:'Indisponível', observedAt:'2026-10-01T06:00:00.000Z' }, stores:[{ store:'A', price:150, availability:'Indisponível', url:'https://a.example', observedAt:'2026-10-01T06:00:00.000Z' }] };
  assert.equal(priceStateOf(noStock, { now:Date.parse('2026-10-03T06:00:00.000Z') }).state, 'sem stock', 'no limite ainda conta como leitura recente');
  const aged = priceStateOf(noStock, { now:Date.parse('2026-10-03T06:01:00.000Z') });
  assert.equal(aged.state, 'desatualizado');
  assert.deepEqual(aged.stores, [], 'ofertas antigas sem stock também deixam de ser listadas');
});
