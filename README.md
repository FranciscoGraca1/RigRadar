# RigRadar

PWA em JavaScript vanilla para acompanhar preços de componentes, comparar valor e validar uma build. Não há build step nem dependências npm. O servidor usa apenas módulos nativos do Node.js.

## Executar

É necessário Node.js 24 (para `node:sqlite`). Na raiz do projeto:

```powershell
node .\server\server.mjs
```

Abre `http://127.0.0.1:4173/`. O servidor está limitado ao computador local. A PWA e os dados de demonstração também funcionam offline depois da primeira visita. Localmente, o servidor recolhe preços a pedido e responde ao assistente com IA; no GitHub Pages, os preços reais chegam pelo snapshot estático `dist/prices.json`, gerado por uma recolha diária e publicado quando há alterações (ver [Publicação no GitHub Pages](#publicação-no-github-pages)) e o assistente usa apenas a resposta local. Executa os testes com `node --test "server/*.test.mjs" "test/*.test.mjs"` (o mesmo comando corre no GitHub Actions).

## Dados e compatibilidade

`dist/catalog.json` é a fonte única de SKUs: as opções do builder são derivadas da categoria de cada entrada. Fonte, Caixa e Cooler estão no catálogo e podem ser seguidos, tal como CPU, GPU, RAM, motherboard e armazenamento. O cooler AMD incluído é uma exceção: não é vendido como SKU autónomo, por isso tem `trackable:false` e não aparece no catálogo. Os novos SKUs não têm histórico inventado; o gráfico surge quando houver pelo menos duas leituras. Os valores já existentes no protótipo são exemplos e são rotulados como tal até serem substituídos por recolhas autorizadas.

O questionário de 4 perguntas recomenda uma build compatível dentro do orçamento e aplica-a diretamente aos slots. Usa preço, índice de valor e rácios por utilização; se um SKU não tiver `score`, usa uma estimativa neutra. “Compacto” usa formato de caixa/motherboard; “upgrade” usa slots M.2 e potência da fonte; “silêncio” é uma aproximação pelo cooler. Não existem métricas fiáveis de ruído ou estética. Se o orçamento não chega, a seleção anterior mantém-se. Peças com leitura real só entram na recomendação quando o preço é atual e com stock; uma peça com leitura real desatualizada ou sem stock é excluída. Peças sem qualquer leitura real entram com o preço de exemplo do catálogo, para que haja sempre uma build de demonstração; o resultado diz quantos preços são reais, quantos são de exemplo e que peças foram excluídas. Os preços-alvo são guardados localmente no navegador, e o alerta visual só dispara para preços reais com stock. Não há notificações push/email nem sincronização entre dispositivos.

As regras estão em `dist/compatibility.js` (cobertas por `test/compatibility.test.mjs`). O builder verifica socket CPU/motherboard, suporte DDR, módulos de RAM vs. slots DIMM, socket e altura do cooler, formato da caixa, potência e **tipo/quantidade** dos conectores da fonte, comprimento da GPU, slots M.2, portas SATA e rácio de desempenho CPU/GPU. A análise da IA não substitui estas regras determinísticas.

## Preços reais

Localmente, o botão «Atualizar preços» chama `POST /api/prices/refresh`; `GET /api/prices` devolve o estado atual. O backend grava cada leitura em `data/prices.sqlite`, tabela `price_history`, com SKU, fonte, loja, URL, disponibilidade, preço em cêntimos e timestamp. `source_runs` guarda o último estado, erro e número de ofertas por fonte. Há cache por fonte de pelo menos 10 minutos (60 minutos no exemplo de lojas diretas), deduplicação de pedidos simultâneos e isolamento de erros. Mínimo/média/contagem usam leituras em stock nos últimos 90 dias. O frontend mantém a janela de 10 minutos por dispositivo.

Por razões de autorização e termos de uso, **nenhuma origem vem ativa**. Copia `server/sources.example.json` para `server/sources.json` e configura apenas fontes para as quais tenhas permissão explícita:

- `partner-json`: URL HTTPS e domínio de um feed licenciado de agregador. Se for necessária autenticação, define `tokenEnv` para o nome de uma variável de ambiente com o token. O adaptador espera uma lista JSON normalizada como `[{"sku":"gpu4070","store":"Loja","price":629.99,"url":"https://loja.exemplo/produto","availability":"Em stock"}]`. Contratos reais podem exigir adaptar o mapeamento do feed; não se presume que KuantoKusta ou idealo forneçam este formato.
- `product-jsonld`: domínio, `robotsUrl` e URLs canónicas de produtos por SKU em `products`. Só lê JSON-LD `Product`/`Offer` em páginas permitidas por `robots.txt`; não pesquisa o site. Requer autorização além de permissão técnica em `robots.txt`.

Define `enabled:true` e `authorized:true` só depois de confirmar as condições da fonte. Os erros de um fornecedor não impedem os restantes. O parser direto é intencionalmente simples: uma mudança no HTML/JSON-LD pode exigir manutenção. Os pedidos usam `User-Agent` próprio com contacto (`RIGRADAR_CONTACT` ou URL público das Issues). Preços não incluem necessariamente portes; confirma sempre preço e stock no comerciante. Vê [fontes e limites](SOURCES_AND_LIMITS.md).

## Frescura e estado dos preços

Uma leitura real só é apresentada como preço atual se tiver menos de **48 horas** (`OFFER_MAX_AGE_HOURS` em `server/price-service.mjs`) e estiver «Em stock» ou «Limitado». A recolha é diária e o Actions pode atrasar várias horas; 48 h toleram um atraso grande ou uma execução falhada, mas uma oferta que deixou de aparecer no feed deixa de parecer comprável. Cada preço mostra um rótulo:

- **Preço real** — leitura recente e com stock; é o único estado que dispara o alerta de preço-alvo.
- **Sem stock** — há leituras recentes, mas nenhuma comprável; mostra-se o último valor lido apenas como contexto.
- **Preço desatualizado** — só há leituras com mais de 48 h; não há ofertas listadas.
- **Preço de exemplo** — valor demonstrativo do catálogo; não houve leitura real.

As leituras antigas continuam no histórico (gráficos, mínimo e média) e nunca são apagadas. O browser volta a verificar a idade com o seu relógio, por isso uma cópia offline antiga é rotulada como desatualizada. O painel mostra também a data e a idade do snapshot e se veio da cópia guardada. Com o separador aberto, os estados são reavaliados a cada minuto e quando o separador volta a ficar visível: uma oferta que passa das 48 h deixa de contar como atual sem recarregar a página. O formato do snapshot está descrito no [modelo de dados](DATA_MODEL.md#formato-de-distpricesjson-implementado).

## Cache e atualização da PWA

`dist/sw.js` usa **rede primeiro** para todos os ficheiros do site: cada pedido revalida com o servidor (`cache: 'no-cache'`, normalmente uma resposta 304) e atualiza a cópia local. Um deploy novo chega na visita seguinte sem mudar versões à mão. Sem rede, ou se a rede não responder em 4 s, usa-se a cópia guardada; um `prices.json` vindo da cache é assinalado como «cópia guardada». Uma resposta de rede que chegue depois do limite continua a ser gravada para a visita seguinte (`event.waitUntil`); isto está coberto por `test/sw.test.mjs`. Só é preciso mudar `CACHE` em `sw.js` quando a lista de ficheiros ou a estratégia mudam.

## Assistente com IA

Define `OPENAI_API_KEY` **no ambiente do processo do servidor**; opcionalmente, `OPENAI_MODEL` (por defeito `gpt-4.1-mini`). O frontend envia pergunta e contexto da build a `POST /api/assistant`; o servidor chama a API Responses da OpenAI com `store:false`. A chave não entra no browser nem em ficheiros do repositório. Se não houver chave ou a chamada falhar, o chat usa `answerFor()` local. Isto foi testado com uma resposta simulada; uma chamada real requer a tua chave e saldo da API. Não publiques este servidor sem adicionar autenticação, limites de utilização e um deployment apropriado.

`dist/` isolada continua uma PWA estática. O Pages pode mostrar preços reais através de `dist/prices.json` gerado pelo workflow diário, sem correr o backend em cada visita. O gráfico filtra timestamps reais por 7/30/90/365 dias e mostra tooltip com preço, data e loja; os dados de exemplo não recebem datas artificiais. Monitor, periféricos, software, consumíveis e armazenamento externo são expansão futura do catálogo. O [modelo de dados](DATA_MODEL.md) distingue o SQLite implementado de uma evolução futura para SQL multiutilizador.

## Publicação no GitHub Pages

Escolhemos a opção A: o workflow `.github/workflows/deploy-pages.yml` publica `dist/` a cada atualização de `main` e executa a recolha diariamente às **05:17 UTC** (o GitHub Actions pode atrasar). O workflow tem dois jobs:

- `collect` (só em execuções agendadas ou manuais) corre os testes e `server/collect-prices.mjs`. Se a recolha terminar, guarda os ficheiros como artefacto `recolha-concluida-<run>-<tentativa>` (30 dias, com `recolha.json` a identificar a recolha) antes de os gravar em `main` com `.github/scripts/commit-snapshot.sh`; se os testes ou a recolha falharem, não há artefacto. Se alguém fizer push durante a recolha, o commit do bot é refeito sobre o `main` mais recente e o push é repetido, sem force push. Se um commit humano tiver alterado os ficheiros de dados, o job falha de forma explícita e as leituras ficam no artefacto. Sem fontes ativas nem leituras novas, não cria commit: o snapshot publicado mantém a data da última publicação. Tem um grupo de concorrência próprio, para que um push humano não cancele a recolha do dia.
- `deploy` corre os testes e publica `dist/` a partir do `main` mais recente (inclui o commit de dados do bot). Os deploys são serializados.

**Recolha diária, publicação quando há alterações.** A recolha corre todos os dias, mas o snapshot só é gravado e publicado quando muda. Com fontes ativas isso acontece em todas as recolhas, porque o estado das fontes e a hora da verificação mudam sempre; sem fontes ativas não há nada novo a publicar. Por isso, a data «snapshot de…» no site é a da última publicação, e não necessariamente a da última execução do workflow. A frescura de cada preço não depende dessa data: é sempre calculada a partir da hora da leitura (48 h).

Para recuperar uma recolha cujo push falhou: descarrega o artefacto `recolha-concluida-…` do run em *Actions*, confirma em `recolha.json` o `generatedAt` e o commit de base, e repõe `data/prices.sqlite` e `dist/prices.json` num commit sobre o `main` atual (a SQLite só acrescenta linhas, por isso a recolha mais recente contém as anteriores do seu commit de base).

`data/prices.sqlite` e `dist/prices.json` são escritos apenas pelo workflow; não os alteres à mão nem em commits humanos. No site, o botão de preços volta a consultar o snapshot publicado, mas não inicia scraping. Sem fontes autorizadas, o snapshot contém zero leituras reais — os preços de exemplo mantêm-se claramente identificados.

Para configurar o workflow, cria o secret `RIGRADAR_SOURCES_JSON` nas definições do repositório com o objeto completo `{"sources":[...]}`. Opcionalmente cria os secrets `KUANTOKUSTA_FEED_TOKEN`/`IDEALO_FEED_TOKEN` se houver contratos para esses feeds, e a variável `RIGRADAR_CONTACT` para o contacto do `User-Agent`. Nunca ponhas tokens em URLs, ficheiros versionados ou no frontend. A lista de fontes vem desligada por defeito e o formato dos feeds reais pode exigir adaptação. O GitHub Pages não pode executar o proxy de IA: para IA pública, falta um serviço serverless separado com autenticação, limites de utilização e a chave em secret. Até lá, a resposta local por regex continua a funcionar.

## Resolução de problemas

- **O site mostra uma versão antiga.** Recarrega a página uma vez com rede; o service worker revalida tudo em cada visita. Se persistir, em DevTools → Application → Service Workers escolhe *Unregister* e recarrega.
- **«Preços indisponíveis (sem ligação)».** O `prices.json` não foi obtido nem estava guardado; os valores de exemplo continuam visíveis e rotulados.
- **Todos os preços aparecem como desatualizados.** A última recolha com ofertas tem mais de 48 h. Vê o estado da última execução em *Actions* e o campo `sources` em `prices.json`.
- **A build ou a lista seguida desapareceu.** Valores corrompidos no `localStorage` são ignorados para não bloquear o arranque; a aplicação volta às escolhas por defeito.
- **Os testes falham com `node:sqlite`.** É necessário Node.js 24 (o CI usa 24; o módulo existe sem flag desde Node 22.13).
