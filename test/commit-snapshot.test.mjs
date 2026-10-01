// Testa .github/scripts/commit-snapshot.sh com um remoto git local: o bot e um humano
// fazem push para o mesmo main. Prova que o histórico de preços não se perde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCRIPT = new URL('../.github/scripts/commit-snapshot.sh', import.meta.url).pathname;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] }).trim();
const ENV = { ...process.env, GIT_AUTHOR_NAME:'t', GIT_AUTHOR_EMAIL:'t@t', GIT_COMMITTER_NAME:'t', GIT_COMMITTER_EMAIL:'t@t' };
const run = cwd => { try { return { code:0, out:execFileSync('bash', [SCRIPT], { cwd, env:ENV, encoding:'utf8', stdio:['ignore', 'pipe', 'pipe'] }) }; } catch (error) { return { code:error.status, out:`${error.stdout}${error.stderr}` }; } };

function snapshot(sourcesActive, generatedAt) {
  return JSON.stringify({ generatedAt, sources:[{ id:'feed', status:sourcesActive ? 'atualizada' : 'não configurada' }], components:[] });
}
function addReading(repo, price) {
  const db = new DatabaseSync(join(repo, 'data', 'prices.sqlite'));
  db.prepare('INSERT INTO price_history (component_id, source_id, store, price_cents, availability, url, collected_at) VALUES (?,?,?,?,?,?,?)').run('cpu7600', 'feed', 'Loja', price, 'Em stock', 'https://loja.example/c', new Date().toISOString());
  db.close();
}
const readings = repo => { const db = new DatabaseSync(join(repo, 'data', 'prices.sqlite')); const rows = db.prepare('SELECT price_cents FROM price_history ORDER BY id').all().map(row => row.price_cents); db.close(); return rows; };

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'rigradar-git-'));
  const remote = join(root, 'remote.git'), bot = join(root, 'bot'), human = join(root, 'human');
  git(root, 'init', '-q', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, bot);
  for (const [k, v] of [['user.name','bot'],['user.email','bot@x']]) git(bot, 'config', k, v);
  mkdirSync(join(bot, 'data')); mkdirSync(join(bot, 'dist'));
  const db = new DatabaseSync(join(bot, 'data', 'prices.sqlite'));
  db.exec('CREATE TABLE price_history (id INTEGER PRIMARY KEY, component_id TEXT, source_id TEXT, store TEXT, price_cents INTEGER, availability TEXT, url TEXT, collected_at TEXT)');
  db.close();
  addReading(bot, 10000); // leitura histórica já versionada
  writeFileSync(join(bot, 'dist', 'prices.json'), snapshot(true, '2026-09-30T05:00:00Z'));
  writeFileSync(join(bot, 'README.md'), 'v1\n');
  git(bot, 'add', '.'); git(bot, 'commit', '-qm', 'base'); git(bot, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', remote, human);
  for (const [k, v] of [['user.name','humano'],['user.email','h@x']]) git(human, 'config', k, v);
  return { root, remote, bot, human, cleanup:() => rmSync(root, { recursive:true, force:true }) };
}
const remoteLog = env => git(env.human, 'log', '--format=%s', 'origin/main');

test('push humano durante a recolha: o commit do bot é refeito por cima, sem perder leituras', () => {
  const env = setup();
  try {
    // O bot já fez checkout; entretanto um humano publica uma alteração ao frontend.
    writeFileSync(join(env.human, 'README.md'), 'v2 humano\n'); git(env.human, 'commit', '-qam', 'Alteração humana'); git(env.human, 'push', '-q', 'origin', 'main');
    addReading(env.bot, 12000);
    writeFileSync(join(env.bot, 'dist', 'prices.json'), snapshot(true, '2026-10-01T05:00:00Z'));
    const result = run(env.bot);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /Push rejeitado \(tentativa 1\)/);
    git(env.human, 'pull', '-q', '--ff-only');
    assert.deepEqual(remoteLog(env).split('\n'), ['Atualizar histórico de preços', 'Alteração humana', 'base'], 'histórico linear, sem force push');
    assert.equal(readFileSync(join(env.human, 'README.md'), 'utf8'), 'v2 humano\n', 'alteração humana preservada');
    assert.deepEqual(readings(env.human), [10000, 12000], 'leitura antiga e nova presentes no main');
  } finally { env.cleanup(); }
});

test('commit humano nos ficheiros de dados: falha explícita, sem force push, dados locais intactos', () => {
  const env = setup();
  try {
    addReading(env.human, 99900); git(env.human, 'commit', '-qam', 'Alteração humana aos dados'); git(env.human, 'push', '-q', 'origin', 'main');
    addReading(env.bot, 12000);
    writeFileSync(join(env.bot, 'dist', 'prices.json'), snapshot(true, '2026-10-01T05:00:00Z'));
    const result = run(env.bot);
    assert.equal(result.code, 1);
    assert.match(result.out, /resolução manual necessária/);
    assert.equal(remoteLog(env).split('\n')[0], 'Alteração humana aos dados', 'o remoto não foi reescrito');
    assert.deepEqual(readings(env.bot), [10000, 12000], 'a recolha continua no disco para o artefacto do workflow');
  } finally { env.cleanup(); }
});

test('sem fontes ativas nem leituras novas: não cria commit diário e repõe o snapshot versionado', () => {
  const env = setup();
  try {
    writeFileSync(join(env.bot, 'dist', 'prices.json'), snapshot(false, '2026-10-01T05:00:00Z'));
    const result = run(env.bot);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /não há commit/);
    assert.equal(remoteLog(env), 'base');
    assert.equal(git(env.bot, 'status', '--porcelain'), '', 'árvore limpa: o deploy publica o snapshot versionado');
  } finally { env.cleanup(); }
});

test('caminho normal: grava e publica numa tentativa', () => {
  const env = setup();
  try {
    addReading(env.bot, 11000);
    writeFileSync(join(env.bot, 'dist', 'prices.json'), snapshot(true, '2026-10-01T05:00:00Z'));
    const result = run(env.bot);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /tentativa 1/);
    git(env.human, 'pull', '-q', '--ff-only');
    assert.deepEqual(readings(env.human), [10000, 11000]);
  } finally { env.cleanup(); }
});
