# RigRadar

PWA em JavaScript vanilla para acompanhar preços de componentes, comparar valor e validar uma build. Não há build step nem dependências npm. O servidor usa apenas módulos nativos do Node.js.

## Executar

É necessário Node.js 24 (para `node:sqlite`). Na raiz do projeto:

```powershell
node .\server\server.mjs
```

Abre `http://127.0.0.1:4173/`. O servidor está limitado ao computador local. A PWA e os dados de demonstração também funcionam offline depois da primeira visita; preços reais e IA exigem ligação ao servidor. Executa os testes com `node --test .\server\server.test.mjs`.

## Dados e compatibilidade

`dist/catalog.json` é a fonte única de SKUs: as opções do builder são derivadas da categoria de cada entrada. Fonte, Caixa e Cooler estão no catálogo e podem ser seguidos, tal como CPU, GPU, RAM, motherboard e armazenamento. O cooler AMD incluído é uma exceção: não é vendido como SKU autónomo, por isso tem `trackable:false` e não aparece no catálogo. Os novos SKUs não têm histórico inventado; o gráfico surge quando houver pelo menos duas leituras. Os valores já existentes no protótipo são exemplos e são rotulados como tal até serem substituídos por recolhas autorizadas.

O questionário de 4 perguntas recomenda uma build compatível dentro do orçamento e aplica-a diretamente aos slots. Usa preço, índice de valor e rácios por utilização; se um SKU não tiver `score`, usa uma estimativa neutra. “Compacto” usa formato de caixa/motherboard; “upgrade” usa slots M.2 e potência da fonte; “silêncio” é uma aproximação pelo cooler. Não existem métricas fiáveis de ruído ou estética. Se o orçamento não chega, a seleção anterior mantém-se. Os preços-alvo são guardados localmente no navegador, e o alerta visual só dispara para preços reais com stock. Não há notificações push/email nem sincronização entre dispositivos.

O builder verifica socket CPU/motherboard, suporte DDR, módulos de RAM vs. slots DIMM, socket e altura do cooler, formato da caixa, potência e **tipo/quantidade** dos conectores da fonte, comprimento da GPU, slots M.2 e rácio de desempenho CPU/GPU. A análise da IA não substitui estas regras determinísticas.

## Preços reais

Localmente, o botão «Atualizar preços» chama `POST /api/prices/refresh`; `GET /api/prices` devolve o estado atual. O backend grava cada leitura em `data/prices.sqlite`, tabela `price_history`, com SKU, fonte, loja, URL, disponibilidade, preço em cêntimos e timestamp. `source_runs` guarda o último estado, erro e número de ofertas por fonte. Há cache por fonte de pelo menos 10 minutos (60 minutos no exemplo de lojas diretas), deduplicação de pedidos simultâneos e isolamento de erros. Mínimo/média/contagem usam leituras em stock nos últimos 90 dias. O frontend mantém a janela de 10 minutos por dispositivo.

Por razões de autorização e termos de uso, **nenhuma origem vem ativa**. Copia `server/sources.example.json` para `server/sources.json` e configura apenas fontes para as quais tenhas permissão explícita:

- `partner-json`: URL HTTPS e domínio de um feed licenciado de agregador. Se for necessária autenticação, define `tokenEnv` para o nome de uma variável de ambiente com o token. O adaptador espera uma lista JSON normalizada como `[{"sku":"gpu4070","store":"Loja","price":629.99,"url":"https://loja.exemplo/produto","availability":"Em stock"}]`. Contratos reais podem exigir adaptar o mapeamento do feed; não se presume que KuantoKusta ou idealo forneçam este formato.
- `product-jsonld`: domínio, `robotsUrl` e URLs canónicas de produtos por SKU em `products`. Só lê JSON-LD `Product`/`Offer` em páginas permitidas por `robots.txt`; não pesquisa o site. Requer autorização além de permissão técnica em `robots.txt`.

Define `enabled:true` e `authorized:true` só depois de confirmar as condições da fonte. Os erros de um fornecedor não impedem os restantes. O parser direto é intencionalmente simples: uma mudança no HTML/JSON-LD pode exigir manutenção. Os pedidos usam `User-Agent` próprio com contacto (`RIGRADAR_CONTACT` ou URL público das Issues). Preços não incluem necessariamente portes; confirma sempre preço e stock no comerciante. Vê [fontes e limites](SOURCES_AND_LIMITS.md).

## Assistente com IA

Define `OPENAI_API_KEY` **no ambiente do processo do servidor**; opcionalmente, `OPENAI_MODEL` (por defeito `gpt-4.1-mini`). O frontend envia pergunta e contexto da build a `POST /api/assistant`; o servidor chama a API Responses da OpenAI com `store:false`. A chave não entra no browser nem em ficheiros do repositório. Se não houver chave ou a chamada falhar, o chat usa `answerFor()` local. Isto foi testado com uma resposta simulada; uma chamada real requer a tua chave e saldo da API. Não publiques este servidor sem adicionar autenticação, limites de utilização e um deployment apropriado.

`dist/` isolada continua uma PWA estática. O Pages pode mostrar preços reais através de `dist/prices.json` gerado pelo workflow diário, sem correr o backend em cada visita. O gráfico filtra timestamps reais por 7/30/90/365 dias e mostra tooltip com preço, data e loja; os dados de exemplo não recebem datas artificiais. Monitor, periféricos, software, consumíveis e armazenamento externo são expansão futura do catálogo. O [modelo de dados](DATA_MODEL.md) distingue o SQLite implementado de uma evolução futura para SQL multiutilizador.

## Publicação no GitHub Pages

Escolhemos a opção A: o workflow `.github/workflows/deploy-pages.yml` publica `dist/` a cada atualização de `main` e executa a recolha diariamente às **05:17 UTC** (o GitHub Actions pode atrasar). Executa `server/collect-prices.mjs`, faz commit de `data/prices.sqlite` e `dist/prices.json` e publica este último no Pages no mesmo workflow. No site, o botão de preços volta a consultar o snapshot publicado, mas não inicia scraping. Sem fontes autorizadas, o snapshot contém zero leituras reais — os preços de exemplo mantêm-se claramente identificados.

Para configurar o workflow, cria o secret `RIGRADAR_SOURCES_JSON` nas definições do repositório com o objeto completo `{"sources":[...]}`. Opcionalmente cria os secrets `KUANTOKUSTA_FEED_TOKEN`/`IDEALO_FEED_TOKEN` se houver contratos para esses feeds, e a variável `RIGRADAR_CONTACT` para o contacto do `User-Agent`. Nunca ponhas tokens em URLs, ficheiros versionados ou no frontend. A lista de fontes vem desligada por defeito e o formato dos feeds reais pode exigir adaptação. O GitHub Pages não pode executar o proxy de IA: para IA pública, falta um serviço serverless separado com autenticação, limites de utilização e a chave em secret. Até lá, a resposta local por regex continua a funcionar.
