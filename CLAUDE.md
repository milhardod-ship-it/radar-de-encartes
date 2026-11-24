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
- Sem logos/cores das redes na interface (marcas registradas). Dados `revisado: false` até o painel de revisão.

## Fontes de dados (situação em 23/11/2026)
- **Guanabara**: robô lê `/produtos/<id>` (14 categorias). A validade vem da LISTA ("Validade: dd/mm/aaaa"),
  não da página `/encarte`: as duas não mudam juntas (em 23/11 à noite o encarte já dizia 24–25/11 e a
  lista ainda era a antiga). Lista vencida = nada novo (não é erro). Datas sempre no horário do Rio.
- **Mundial**: robô lê o JSON `__NEXT_DATA__` de `/departamentos/categoria/ofertas?page=N` + `/encarte`.
  No site, `price` = preço no app Mundial Total e `oldPrice` = preço sem app.
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
