import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPriceService } from './price-service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const catalog = await readJson(join(root, 'dist', 'catalog.json'));
let config;
if (process.env.RIGRADAR_SOURCES_JSON) config = JSON.parse(process.env.RIGRADAR_SOURCES_JSON);
else config = await readJson(join(root, 'server', 'sources.json')).catch(async error => {
  if (error.code !== 'ENOENT') throw error;
  return readJson(join(root, 'server', 'sources.example.json'));
});
if (!Array.isArray(config.sources)) throw new Error('Configuração de fontes inválida.');
const service = createPriceService({ catalog, sources:config.sources, dataDir:join(root, 'data') });
try {
  await service.refresh();
  const result = { generatedAt:new Date().toISOString(), statsPeriodDays:90, components:service.current(90), sources:service.status() };
  await writeFile(join(root, 'dist', 'prices.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  process.stdout.write(`Snapshot: ${result.components.filter(item => item.price != null).length} peças com leituras reais; ${result.sources.filter(item => item.status === 'erro').length} fontes com erro.\n`);
} finally { service.close(); }
