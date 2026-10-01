import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { recommendBuild } = require('../dist/recommend.js');
const { checkCompatibility } = require('../dist/compatibility.js');

const SLOTS = ['CPU','Motherboard','RAM','GPU','Armazenamento','Fonte','Caixa','Cooler'];
// Cópia nova do catálogo em cada teste (os testes mudam o estado dos preços).
function setup(mutate = () => {}) {
  const catalog = JSON.parse(readFileSync(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
  for (const item of catalog) mutate(item);
  const options = Object.fromEntries(SLOTS.map(slot => [slot, catalog.filter(item => item.category === slot)]));
  const pick = (slot, choice) => options[slot].find(item => item.id === choice[slot]);
  const evaluate = choice => checkCompatibility({ cpu:pick('CPU',choice), board:pick('Motherboard',choice), ram:pick('RAM',choice), gpu:pick('GPU',choice), storage:pick('Armazenamento',choice), psu:pick('Fonte',choice), caseItem:pick('Caixa',choice), cooler:pick('Cooler',choice) });
  const total = choice => SLOTS.reduce((sum, slot) => sum + pick(slot, choice).price, 0);
  return { options, evaluate, total, pick };
}
const live = (state, availability = 'Em stock') => ({ priceSource:'live', priceState:state, availability });

test('recomenda uma build compatível dentro do orçamento', () => {
  const { options, evaluate, total } = setup();
  for (const use of ['gaming','trabalho','criacao','geral']) for (const budget of [1300, 1500, 2200]) {
    const { best } = recommendBuild({ options, budget, use, evaluate });
    assert.ok(best, `${use} ${budget} €: há build`);
    assert.deepEqual(evaluate(best.choice).warnings, [], `${use} ${budget} €: sem avisos`);
    assert.ok(best.total <= budget, `${use} ${budget} €: dentro do orçamento`);
    assert.equal(best.total, total(best.choice), 'total coerente com as peças escolhidas');
  }
});

test('orçamento insuficiente: sem build, mas indica a combinação compatível mais barata', () => {
  const { options, evaluate } = setup();
  const result = recommendBuild({ options, budget:300, use:'gaming', evaluate });
  assert.equal(result.best, null);
  assert.ok(result.cheapest.total > 300);
  assert.deepEqual(evaluate(result.cheapest.choice).warnings, [], 'a mais barata também é compatível');
  assert.equal(recommendBuild({ options, budget:result.cheapest.total, use:'gaming', evaluate }).best.total, result.cheapest.total, 'com o orçamento exato já há build');
});

test('nunca escolhe combinações com avisos de compatibilidade', () => {
  const { options, evaluate } = setup();
  // Uma regra artificialmente estrita: só aceita a caixa compacta. A recomendação tem de a respeitar.
  const strict = choice => { const result = evaluate(choice); return choice.Caixa === 'casemini' ? result : { ...result, warnings:[...result.warnings, 'teste'] }; };
  const { best } = recommendBuild({ options, budget:2000, use:'gaming', evaluate:strict });
  assert.equal(best.choice.Caixa, 'casemini');
  assert.equal(best.choice.Motherboard === 'boardb650', false, 'ATX não cabe na caixa compacta');
});

test('peça com leitura real desatualizada ou sem stock é excluída; atual com stock é elegível', () => {
  // Cenário em que a RTX 4070 SUPER é claramente a melhor GPU: preço real de 450 € e índice alto.
  const scenario = { budget:1500 };
  const run = state => { const s = setup(item => { if (item.id === 'gpu4070') Object.assign(item, { price:450, score:9.9 }, state); }); return recommendBuild({ options:s.options, budget:scenario.budget, use:'gaming', resolution:'1440p', evaluate:s.evaluate }).best; };
  assert.equal(run(live('atual')).choice.GPU, 'gpu4070', 'preço real atual com stock continua elegível');
  assert.notEqual(run(live('desatualizado')).choice.GPU, 'gpu4070');
  assert.notEqual(run(live('sem stock', 'Indisponível')).choice.GPU, 'gpu4070');
  assert.notEqual(run(live('atual', 'Indisponível')).choice.GPU, 'gpu4070', 'estado incoerente também é excluído');
});

test('peças sem leitura real entram com o preço de exemplo (build de demonstração)', () => {
  const { options, evaluate } = setup();
  assert.ok(options.GPU.every(item => item.priceSource == null), 'catálogo de base só tem preços de exemplo');
  assert.ok(recommendBuild({ options, budget:1500, use:'gaming', evaluate }).best);
});

test('slot sem peças elegíveis é reportado em vez de parecer incompatibilidade do catálogo', () => {
  const { options, evaluate } = setup(item => { if (item.category === 'GPU') Object.assign(item, live('desatualizado')); });
  const result = recommendBuild({ options, budget:3000, use:'gaming', evaluate });
  assert.equal(result.best, null);
  assert.equal(result.cheapest, null);
  assert.deepEqual(result.unavailableSlots, ['GPU']);
});

test('resultado determinístico e entradas inválidas rejeitadas', () => {
  const { options, evaluate } = setup();
  const args = { options, budget:1500, use:'criacao', priority:'upgrade', evaluate };
  assert.deepEqual(recommendBuild(args).best, recommendBuild(args).best);
  assert.throws(() => recommendBuild({ ...args, budget:0 }), /inválidos/);
  assert.throws(() => recommendBuild({ ...args, budget:Number.NaN }), /inválidos/);
  assert.throws(() => recommendBuild({ ...args, use:'mineracao' }), /inválidos/);
});

test('prioridade "compacto" favorece mATX na caixa compacta quando cabe no orçamento', () => {
  const { options, evaluate } = setup();
  const { best } = recommendBuild({ options, budget:1500, use:'gaming', priority:'compacto', evaluate });
  assert.equal(best.choice.Caixa, 'casemini');
  assert.notEqual(best.choice.Motherboard, 'boardb650');
});
