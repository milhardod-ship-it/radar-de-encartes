# CLAUDE.md — Radar de Encartes

## O projeto
App (PWA, mobile-first) que reúne os encartes dos supermercados do **Rio de Janeiro** e mostra
**onde a lista de compras sai mais barata**. Nome provisório: **Radar de Encartes**. Objetivo: virar negócio.
Carro-chefe: **lista de compras** (total por mercado, melhor mercado, quando vale dividir entre 2).

## Como trabalhar com o dono
- Tudo em **português do Brasil** (interface, commits, explicações).
- Ele gosta de entender o **porquê** e de ver cada etapa funcionando; trabalhe em etapas e pare para ele testar.
- Testa pelo **celular** (layout em 390px). Aprovações de rede/ambiente só funcionam pelo **computador**.
- Publicado na **Vercel** a cada push no `main`: https://radar-de-encartes-vhve.vercel.app
- Antes de push: `npm run build` (precisa passar — é o que a Vercel roda) e `npm test`.

## Decisões tomadas
- Mercados: Guanabara, Mundial, Prezunic, Supermarket, Assaí, Atacadão (RJ).
- Preço padrão = o que **qualquer pessoa** paga; preços de app/cartão/clube só valem para quem marcou no Perfil
  e aparecem sempre identificados ("com app"). Nunca misturar.
- **Não** coletar nada que exija login (ex.: Guana Clube) nem copiar dados de dentro de apps com conta.
  Clube fechado → futuro: parceria com o mercado.
- Honestidade: oferta vencida some; "não compensa a viagem" quando dividir economiza pouco; sem truques.
- Etiquetas "nesta embalagem X sai por R$ Y" nos encartes são só referência para o cliente: NÃO viram oferta.
- Só entra no app o que está **no encarte**. "Oferta Especial" sem preço no encarte não entra, mesmo que outra
  fonte (site, app) mostre um valor.
- Sem logos/cores das redes na interface (marcas registradas). Dados `revisado: false` até o painel de revisão.

## Fontes de dados (situação em 23/11/2026)
- **Guanabara**: a lista `/produtos/<id>` do site NÃO é o encarte (em 25/11 só ~40% batia com o PDF; preços
  e itens diferentes). Decisão do dono: **só entra o que está no encarte**. O robô ainda coleta a lista, mas o
  importador não usa (`USAR_LISTA_DO_SITE_GUANABARA = false`). Fonte: PDF do encarte em `/encarte/baixe`
  (12 páginas, SÓ IMAGEM) → leitura manual em `data/curadoria/` até existir o leitor por IA (chave da API).
  Encarte novo às 2as e no meio da semana. Itens "Oferta Especial" sem preço NÃO entram.
- **Mundial**: robô lê o JSON `__NEXT_DATA__` de `/departamentos/categoria/ofertas?page=N` + `/encarte`.
  No site, `price` = preço no app Mundial Total e `oldPrice` = preço sem app.
  Conferido em 25/11 (encarte 19/11–02/12 lido por IA): 328 de 333 ofertas do encarte estão na lista com o mesmo
  preço; a lista tem +216 ofertas "Mundial Total" e +6 "Imperdível" (validade própria em `unpublishedIn`). Decisão do
  dono: a lista basta (preço confiável + data de fim); não ler o encarte do Mundial com IA.
  Promoção por quantidade no site (`quantity` > 1): `price` NÃO é o preço de 1 unidade ("leve 4 pague 3" = média
  levando 4; "30% na 2ª" = preço só da 2ª). O importador usa `oldPrice` como preço, a promoção vira aviso e a oferta
  fica "a confirmar" até o dono conferir o padrão. Categoria "Imperdível" (relâmpago, fora do encarte) também fica
  "a confirmar" (Filé-mignon Suíno Aurora 19,95 no site × 24,70 no encarte = provável erro do mercado).
- **Atacadão**: robô usa a API pública de folhetos do site ("Folhetos" → `apigw.cloud.carrefour.com.br/
  api-middleware-flyer-services`: `/api/v2/Store/city/uf?uf=RJ`, `/api/v2/Store/city?uf=&city=`, PDF em
  `/api/v2/Flyer/?id=`). Os PDFs trazem dados embutidos (metadado "TABLOIDI-DADOS", lido com `pdfinfo`):
  P = todos, PSEG = app, PTER = app + cartão, D = "de". Em 23/11: 29 lojas no RJ, Ofertão (semana) + Boa do Dia.
- **Assaí**: lojas e folhetos em `/sites/default/files/static/ofertas_assai.json`, mas o site tem escudo
  anti-robô (Incapsula) que bloqueia robô honesto. Decidido: NÃO disfarçar o robô de navegador.
  No RJ é 1 encarte para as 41 lojas, só imagem (precisa do leitor por IA). Pendente: dono mandar o encarte
  e/ou chave da API do Claude; futuro: pedir autorização/parceria ao Assaí.
- **Prezunic**: robô lê a lista de encartes no JSON da página `/encartes` (título, estado RJ/GO, `validityText`,
  `pdfUrl` em prezunic.vtexassets.com). Validade: vale o TEXTO ("Válidas de 13 a 26/11/2026", igual ao PDF);
  `startAt/endAt` é só a janela em que o site exibe. Lojas vêm do título ("…lojas: Recreio, Barra…"; vazio = todas).
  PDFs (Smarket) têm texto sem dados estruturados: leitura pela posição das palavras (`pdftotext -bbox-layout`):
  nome em maiúsculas acima, 2 preços grandes (esq. = "de", dir. = "por"), "Limite por cliente" abaixo; altura
  de referência = altura mais comum dos números da página. Em 23/11: 7 encartes RJ, 429 ofertas, 100% lidas.
- **Supermarket**: site `www.redesupermarket.com.br` (da SAERJ, associação de supermercados independentes; cada
  loja associada pode ter encarte próprio). Em 23/11: escudo anti-robô do Cloudflare ("Just a moment…", bloqueia
  até o robots.txt). Mesma decisão do Assaí: NÃO contornar. Caminho: dono manda o encarte + leitor por IA,
  ou parceria.

## Leitura por IA (encartes só imagem)
- `src/coleta/leitorIA.ts` + `scripts/lerEncartes.ts`, rodando no GitHub com o segredo `ANTHROPIC_API_KEY`
  (créditos pré-pagos do dono, sem recarga automática). Trava: US$ 1 por execução.
- Modelo padrão **Sonnet 5.5** (teste 25/11, pág. 1 Guanabara: Sonnet US$ 0,037/pág, acertou tudo; Opus US$ 0,073,
  acertou tudo; Haiku US$ 0,002, inventou preço do Omo "Oferta Especial" e errou marcas → descartado).
- Páginas idênticas a uma já lida são reaproveitadas de `data/leituras/<hash>.json` (custo zero).
- Encarte já lido (ou cadastrado à mão) não é relido. Workflow manual "Ler encartes com IA" (teste/ler/mundial);
  a leitura automática roda dentro do robô de coleta.

## Lojas e localização
- `data/lojas.json` (112 lojas): Guanabara (página /lojas, coordenada do link do Google Maps), Mundial (JSON de
  /nossas-lojas), Prezunic (11 exatas via `/api/checkout/pub/pickup-points`; demais pelo centro do bairro, marcadas
  `aproximada`), Atacadão (API de folhetos). Assaí: lista de 41 lojas existe no site, mas atrás do escudo.
- Encarte com `lojasIds` vale só nessas lojas; sem lista = todas da rede; rede sem lojas conhecidas = não filtra.
- Região do usuário (GPS ou bairro da tabela `BAIRROS` em `src/core/locais.ts`) + raio fica só no aparelho
  (`radar:regiao:v1`).

## Etapas
| # | Etapa | Status |
|---|-------|--------|
| 1 | Prova de conceito dos dados (leitura de encartes, comparação) | ✅ |
| 2 | Protótipo visual + identidade | ✅ |
| 3 | App base: Início, Busca, Produto, Lista, Encartes, Perfil | ✅ |
| 4 | Robô de coleta Guanabara + Mundial, agendado no GitHub Actions | ✅ |
| 5 | Atacadão ✅ e Prezunic ✅ automáticos; Assaí e Supermarket bloqueados por anti-robô (ver acima) | ⏳ |
| 6 | Localização (GPS ou bairro → só encartes de lojas no raio; loja mais perto e distância) | ✅ |
| 7 | Painel de revisão das ofertas e da junção de produtos | ⏳ |
| 8 | Alertas de preço, histórico, favoritos | ⏳ |

## Comandos
```
npm install
npm run dev        # http://localhost:5173  (data de teste: ?data=2026-11-23)
npm run coletar    # robô: Guanabara, Mundial, Atacadão e Prezunic → data/brutos/ (precisa de poppler-utils)
npm run importar   # data/brutos + curadoria → data/ofertas.json e data/encartes.json
npm run lojas      # refaz data/lojas.json (lojas com coordenadas; rodar de vez em quando)
npm test
npm run build
```
Organização do código: ver README.md.
