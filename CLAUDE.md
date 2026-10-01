# RigRadar — regras de desenvolvimento

PWA em JavaScript vanilla para acompanhar preços de componentes de PC e validar builds. A interface está em português de Portugal.

## Comandos

```sh
node --test "server/*.test.mjs" "test/*.test.mjs"   # testes (Node 24; o CI corre exatamente isto)
node server/server.mjs                                          # servidor local em http://127.0.0.1:4173/
node server/collect-prices.mjs                                  # recolha + snapshot (altera data/prices.sqlite e dist/prices.json)
```

Para testar sem alterar a SQLite versionada, corre o coletor numa cópia do repositório.

## Arquitetura (não mudar sem decisão explícita)

- `dist/` é publicado tal como está no GitHub Pages: sem framework, sem build step, sem dependências npm. Scripts clássicos carregados por ordem em `index.html`: `price-state.js` → `compatibility.js` → `recommend.js` → `app.js`.
- A lógica pura vive em módulos pequenos (`dist/price-state.js`, `dist/compatibility.js`, `dist/recommend.js`) que funcionam no browser e em Node via `require`, para poderem ser testados em `test/`. O service worker é testado em sandbox (`test/sw.test.mjs`).
- `dist/catalog.json` é a fonte única de SKUs. As regras de compatibilidade são determinísticas (`dist/compatibility.js`); a IA nunca as substitui. Uma peça nova tem de ter os campos verificados em `test/compatibility.test.mjs`.
- O GitHub Actions (`.github/workflows/deploy-pages.yml`) tem os jobs `collect` (diário: recolhe e grava os dados em `main` com `.github/scripts/commit-snapshot.sh`, com rebase e nova tentativa) e `deploy` (publica o `main` mais recente). Os ficheiros de dados (`data/prices.sqlite`, `dist/prices.json`) só são escritos pelo workflow.
- O backend (`server/`) usa apenas módulos nativos do Node (`node:sqlite`).

## Dados de preços — regras invioláveis

- Nunca apresentar dados de exemplo como preços atuais. Os estados são `atual`, `sem stock`, `desatualizado`, `sem leituras` (ver `DATA_MODEL.md`). Só `atual` + stock conta como comprável (`PS.isBuyable`).
- Uma oferta só é atual com menos de `OFFER_MAX_AGE_HOURS` (48 h). Leituras antigas ficam no histórico; nunca as apagar nem reescrever.
- Não ativar fontes, scraping ou feeds sem autorização/licença expressa da fonte. `robots.txt` não é autorização. Fontes de exemplo ficam com `enabled:false`, `authorized:false`.
- Nunca colocar tokens, chaves ou credenciais em `dist/`, URLs, commits, logs ou respostas. Os segredos vivem em GitHub Actions Secrets ou em variáveis de ambiente do servidor local.

## Estilo

- Manter os tokens de cor e tipografia de `dist/styles.css`; estilos novos vão para `dist/enhancements.css` e usam esses tokens.
- Comentar cache, frescura, compatibilidade e segurança; não comentar o óbvio.
- Mensagens de commit em português, curtas e no imperativo («Validar…», «Corrigir…»).
- Ficheiro novo em `dist/`: acrescentá-lo a `ASSETS` em `sw.js` e mudar `CACHE`; mudar `CACHE` também quando a estratégia do SW muda.

## Publicação

- `main` publica automaticamente. Antes de fazer push, correr os testes; depois, confirmar a execução do Actions e o ficheiro servido no Pages.
- Mudanças substantivas vão num branch + PR; correções pequenas e isoladas podem ir diretamente para `main` depois dos testes.
- Nunca fazer force push nem reescrever o histórico (o bot faz commits diários em `main`): fazer `git fetch` e rebase antes de publicar.
