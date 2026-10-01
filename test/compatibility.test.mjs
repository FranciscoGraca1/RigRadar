import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkCompatibility, requiredPowerFor } = require('../dist/compatibility.js');
const catalog = JSON.parse(readFileSync(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const sku = id => { const item = catalog.find(entry => entry.id === id); assert.ok(item, `SKU ${id} existe no catálogo`); return item; };

// Build de referência, compatível, só com peças reais do catálogo.
const BASE = { cpu:'cpu7600', board:'boardb650', ram:'ram32', gpu:'gpu4070', storage:'ssd2tb', psu:'psu750', caseItem:'case4000d', cooler:'peerless' };
const build = (overrides = {}) => Object.fromEntries(Object.entries({ ...BASE, ...overrides }).map(([slot, value]) => [slot, typeof value === 'string' ? sku(value) : value]));
const warningsFor = overrides => checkCompatibility(build(overrides)).warnings;
const expectOnly = (overrides, pattern) => {
  const warnings = warningsFor(overrides);
  assert.equal(warnings.length, 1, `esperava um aviso, obtive: ${JSON.stringify(warnings)}`);
  assert.match(warnings[0], pattern);
};

test('build de referência é compatível e calcula a potência com margem', () => {
  const result = checkCompatibility(build());
  assert.deepEqual(result.warnings, []);
  assert.equal(result.draw, 65 + 220 + 75);
  assert.equal(result.requiredPower, 490, '(65+220+75)×1,35 = 486 → 490 W');
});

test('socket CPU/motherboard', () => {
  expectOnly({ board:{ ...sku('boardb650'), socket:'LGA1700' } }, /socket AM5, mas a motherboard usa LGA1700/);
  assert.ok(warningsFor({ cpu:'cpu12400' }).some(w => /socket LGA1700, mas a motherboard usa AM5/.test(w)));
});

test('tipo de RAM tem de servir a board e a CPU (incluindo CPUs DDR4/DDR5)', () => {
  expectOnly({ ram:'ram32d4' }, /RAM DDR4 não é suportada/);
  const intelDdr4 = { cpu:'cpu12400', board:'boardb660', ram:'ram32d4', cooler:'peerless' };
  assert.ok(!warningsFor(intelDdr4).some(w => /RAM/.test(w)), 'i5-12400F aceita DDR4 numa board DDR4');
  assert.ok(warningsFor({ ...intelDdr4, ram:'ram32' }).some(w => /RAM DDR5 não é suportada/.test(w)), 'board DDR4 rejeita DDR5 mesmo com CPU que aceita ambos');
  expectOnly({ cpu:{ ...sku('cpu7600'), ram:'DDR4' } }, /RAM DDR5 não é suportada/);
});

test('número de módulos de RAM vs slots DIMM', () => {
  expectOnly({ board:{ ...sku('boardb650'), dimms:1 } }, /2 módulos, mas a motherboard só tem 1 slots DIMM/);
  assert.deepEqual(warningsFor({ board:{ ...sku('boardb650'), dimms:2 } }), [], 'no limite é compatível');
});

test('cooler: montagem por socket, altura e cooler incluído', () => {
  expectOnly({ cooler:{ ...sku('peerless'), sockets:['LGA1700'] } }, /não inclui montagem para o socket AM5/);
  expectOnly({ cooler:{ ...sku('peerless'), height:171 } }, /cooler tem 171 mm e a caixa permite até 170 mm/);
  assert.deepEqual(warningsFor({ cooler:{ ...sku('peerless'), height:170 } }), [], 'altura igual ao limite cabe');
  assert.deepEqual(warningsFor({ cooler:'coolerstock' }), [], 'cooler incluído com o Ryzen 5 7600');
  expectOnly({ cpu:'cpu7800x3d', cooler:'coolerstock' }, /só acompanha o Ryzen 5 7600/);
});

test('formato da motherboard vs caixa', () => {
  expectOnly({ caseItem:'casemini' }, /não aceita motherboards ATX/);
  assert.deepEqual(warningsFor({ board:'boarda620', caseItem:'casemini' }), [], 'mATX numa caixa mATX');
});

test('GPU: comprimento na caixa', () => {
  expectOnly({ caseItem:{ ...sku('case4000d'), gpuMax:241 } }, /GPU mede 242 mm e excede os 241 mm/);
  assert.deepEqual(warningsFor({ caseItem:{ ...sku('case4000d'), gpuMax:242 } }), []);
});

test('fonte: potência com margem', () => {
  const heavy = { cpu:'cpu7800x3d', gpu:'gpu7900' };
  assert.equal(requiredPowerFor(sku('cpu7800x3d'), sku('gpu7900')), 750, '(120+355+75)×1,35 = 742,5 → 750 W');
  assert.ok(!warningsFor({ ...heavy, psu:'psu750' }).some(w => /fonte de/.test(w)), '750 W no limite chega');
  assert.ok(warningsFor({ ...heavy, psu:'psu650' }).some(w => /fonte de 650 W é curta: recomenda-se pelo menos 750 W/.test(w)));
});

test('fonte: tipo e quantidade de conectores da GPU', () => {
  assert.ok(warningsFor({ gpu:'gpu7900', psu:'psu650', cpu:'cpu7800x3d' }).some(w => /pede 3 conectores PCIe 8-pin, mas a fonte só tem 2/.test(w)));
  const noHpwr = warningsFor({ psu:'psu550' });
  assert.ok(noHpwr.some(w => /pede 1 conector 12VHPWR, mas a fonte só tem 0/.test(w)), 'um 12VHPWR não é substituído por 8-pin');
  expectOnly({ psu:{ ...sku('psu750'), powerConnectors:{ '8pin':3 } } }, /12VHPWR, mas a fonte só tem 0/);
});

test('armazenamento: slots M.2 e portas SATA', () => {
  expectOnly({ board:{ ...sku('boardb650'), m2:0 } }, /Não há slots M\.2 suficientes/);
  assert.deepEqual(warningsFor({ storage:'sata2tb' }), [], 'SSD SATA com 4 portas livres');
  expectOnly({ storage:'sata2tb', board:{ ...sku('boardb650'), sata:0 } }, /precisa de 1 porta SATA, mas a motherboard só tem 0/);
  expectOnly({ storage:{ ...sku('sata2tb'), slots:2 }, board:{ ...sku('boardb650'), sata:1 } }, /precisa de 2 portas SATA/);
  assert.deepEqual(warningsFor({ board:{ ...sku('boardb650'), sata:0 } }), [], 'sem portas SATA não afeta um SSD M.2');
  const { sata, ...withoutSata } = sku('boardb650');
  expectOnly({ storage:'sata2tb', board:withoutSata }, /só tem 0/, 'board sem campo sata é tratada como 0 portas');
});

test('possível gargalo CPU/GPU', () => {
  assert.ok(warningsFor({ cpu:'cpu12400', board:'boardb660', ram:'ram32d4', gpu:'gpu7900', psu:'psu750' }).some(w => /Possível gargalo/.test(w)), '39000/17500 ≈ 2,23 > 1,85');
  assert.ok(!warningsFor({ cpu:'cpu7800x3d', gpu:'gpu7900' }).some(w => /gargalo/.test(w)), '39000/28000 ≈ 1,39');
});

test('todas as combinações do catálogo são avaliadas sem erros', () => {
  const bySlot = { cpu:'CPU', board:'Motherboard', ram:'RAM', gpu:'GPU', storage:'Armazenamento', psu:'Fonte', caseItem:'Caixa', cooler:'Cooler' };
  const options = Object.fromEntries(Object.entries(bySlot).map(([slot, category]) => [slot, catalog.filter(item => item.category === category)]));
  for (const [slot, list] of Object.entries(options)) assert.ok(list.length > 0, `há opções para ${slot}`);
  let count = 0, compatible = 0;
  const walk = (slots, parts) => {
    if (!slots.length) { const result = checkCompatibility(parts); assert.ok(Array.isArray(result.warnings)); count++; if (!result.warnings.length) compatible++; return; }
    const [slot, ...rest] = slots;
    for (const item of options[slot]) walk(rest, { ...parts, [slot]:item });
  };
  walk(Object.keys(options), {});
  assert.equal(count, Object.values(options).reduce((product, list) => product * list.length, 1));
  assert.ok(compatible > 0, 'o catálogo tem de permitir pelo menos uma build compatível');
});

test('o catálogo tem os campos de que as regras dependem', () => {
  const required = {
    CPU:['socket','ram','watt','performance'], Motherboard:['socket','ram','form','m2','sata','dimms'], RAM:['type','modules'],
    GPU:['watt','length','powerConnectors','performance'], Armazenamento:['interface','slots'], Fonte:['watt','powerConnectors'],
    Caixa:['forms','gpuMax','coolerMax'], Cooler:['sockets','height']
  };
  const ids = new Set();
  for (const item of catalog) {
    assert.ok(!ids.has(item.id), `id duplicado: ${item.id}`); ids.add(item.id);
    assert.ok(required[item.category], `categoria desconhecida em ${item.id}: ${item.category}`);
    for (const field of required[item.category]) assert.ok(item[field] != null, `${item.id} não tem ${field}`);
    assert.ok(Number.isFinite(item.price) && item.price >= 0, `${item.id} tem preço de exemplo numérico`);
  }
});
