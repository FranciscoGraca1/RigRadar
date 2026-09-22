# Fontes de preço: decisão de integração

Verificação feita em 22 de setembro de 2026. «Sem API pública encontrada» não significa que a loja não possua integração B2B; significa que não foi localizada uma API pública/documentada neste levantamento. Confirmar por escrito com cada comerciante antes de automatizar.

| Fonte | Estado verificado | Caminho aprovado para o produto | Decisão no MVP |
|---|---|---|---|
| PCDIGA | A loja e catálogo de componentes estão ativos; `robots.txt` permite páginas de produto, mas exclui pesquisa/filtros. Os termos proíbem monitorização/scraping para atividade comercial sem autorização escrita. | Pedir feed/API ou autorização escrita. Se autorizado, consultar URLs canónicas pré-guardadas, com `User-Agent` identificável, 1 leitura/listagem/hora e backoff. | Não automatizar sem autorização. |
| KuantoKusta | Comparador/marketplace ativo; as condições para vendedores proíbem crawlers/robots/scripts para exportar conteúdo. | Feed/API/parceria de afiliado expressamente concedido pelo KuantoKusta. É o melhor agregador se o acordo incluir os dados necessários. | Não raspar. Contactar parceria primeiro. |
| idealo | A documentação pública encontrada descreve feeds/API para **enviar** ofertas como comerciante, não uma API pública para ler preços de outras lojas. O comparador opera sobretudo noutros mercados europeus, não especificamente Portugal. | Negociar acesso a dados de leitura se disponível e licenciado. | Adaptador de feed desligado até existir acordo e formato confirmado. |
| PcComponentes | Existe programa de afiliados/Awin, mas isso não equivale a uma API pública de preços para esta aplicação. | Confirmar condições de parceria e obter permissão específica antes de consultar páginas de produto. | Adaptador direto desligado. |
| Amazon (ES) | A Amazon disponibiliza Creators API/PA API para associados; exige conta de associado, credenciais e uso de conteúdo segundo a licença. | Criar integração de servidor com a API oficial, links para a página Amazon e disclosures de associado. Avaliar se o propósito e visibilidade da app cumprem o programa antes de integrar. | Opcional; não usar scraping. |
| CHIP7 | Loja e páginas de produto ativas. Não foi localizada API pública documentada neste levantamento. | Pedir endpoint/feed/consentimento. Sem acordo, permitir abrir a página no browser e registar uma leitura manual do utilizador. | Manual até haver autorização. |
| Glacial, Alternate.pt, Nova Informática | Não consegui confirmar por fonte oficial acessível neste levantamento uma API/feed público e termos específicos adequados a recolha. | Tratar como «pendente»: validar domínio, `robots.txt`, termos e contacto comercial antes de criar conector. | Sem conector. |
| «WORX» | O nome é ambíguo. Assumi que podes querer dizer **Worten**; a Worten está ativa e tem categoria de informática, mas não encontrei uma API pública de produto nesta verificação. | Confirma o comerciante. Para Worten, pedir parceria/feed; caso contrário, usar entrada manual. | Pendente de confirmação. |

## Limites de recolha implementados e pendentes

1. Implementado: fontes desligadas por defeito, declaração explícita de autorização, HTTPS e domínio fixo para cada fonte, `robots.txt` antes de páginas diretas, URLs de produto pré-configuradas, timeout de 10 s, respostas limitadas por tamanho e sem redirecionamentos automáticos.
2. Implementado: uma execução concorrente por fonte neste processo, páginas diretas lidas sequencialmente com intervalo de 1 s, cache mínima de 10 minutos por fonte (60 minutos nos exemplos diretos), observações persistidas em SQLite e erro isolado por fonte. O workflow diário do GitHub Actions faz commit do histórico e publica uma projeção JSON no Pages. Se houver vários processos/servidores, não existe bloqueio distribuído: seria necessário adicioná-lo antes dessa escala.
3. Pendente para produção: interpretar regras `robots.txt` mais complexas com uma biblioteca auditada, respeitar `Retry-After`/cabeçalhos de cache, backoff exponencial em `429`/`503`, registar versão de termos/autorização e tratar mudanças de estrutura com testes por fornecedor.
4. Não usar browser headless, bypass de CAPTCHAs, rotação de IPs nem endpoints internos não documentados. Desativar o conector se a fonte mudar as regras ou o formato.
5. A interface mostra hora da leitura, estado de stock e URL nas ofertas reais. Portes e preço final de checkout ainda não são conhecidos; qualquer preço é informativo e deve ser confirmado na loja. GitHub Actions pode atrasar ou falhar uma execução agendada; a frescura dos dados é mostrada por SKU.

## Benchmarks e IA

Para CPU/GPU, começar com um índice interno versionado, alimentado por dados que tenhas licença para usar. Não copiar tabelas de PassMark, Geekbench ou 3DMark sem verificar a respetiva licença. Na tabela `performance_scores`, guardar fonte, versão e licença; o ranking é comparável apenas dentro da mesma métrica.

A IA sugere e explica; não decide compatibilidade. O motor determinístico verifica socket, DDR, formato, conectores/folga de potência, comprimento/altura, M.2/SATA e BIOS. A resposta da IA deve receber os avisos calculados e dizer quando falta especificação.

## Evidência consultada

- [Robots da PCDIGA](https://www.pcdiga.com/robots.txt) e [termos da PCDIGA](https://www.pcdiga.com/termos-e-condicoes-da-conta-online): as áreas bloqueadas estão explicitadas; os termos restringem scraping/monitorização comercial sem autorização escrita.
- [Condições KuantoKusta para vendedores](https://www.kuantokusta.pt/documents/CGU_KMV.pdf): proíbem sistemas automáticos de exportação de conteúdo; a via adequada é parceria autorizada.
- [Integração técnica para comerciantes da idealo](https://partner.idealo.com/partner-idealo-com/uk/learning-center/faq-technical-integration) e [mercados idealo](https://www.idealo.de/unternehmen): não documentam uma API pública de leitura de preços.
- [Programa de afiliados PcComponentes](https://www.pccomponentes.pt/blog/faq-afiliados-pt): possível via de contacto, não autorização automática para scraping.
- [Onboarding da Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding) e [políticas de uso](https://affiliate-program.amazon.com/help/operating/policies): a API depende de conta de associado e tem obrigações de uso/linkagem.
- [Termos da CHIP7](https://chip7.pt/index.php/terms): confirmam atividade de venda online, preços com IVA e disponibilidade dinâmica; pedir autorização para automação.
