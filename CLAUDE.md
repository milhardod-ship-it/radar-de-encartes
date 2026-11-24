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
- **Atacadão**: PDF do Ofertão traz dados embutidos (metadado "TABLOIDI-DADOS"): P = todos, PSEG = app,
  PTER = app + cartão. Ainda manual. Site é loja online VTEX. Encarte vale em lista de 29 lojas.
- **Assaí**: `/ofertas` pede estado → região → loja (ofertas por loja; carregam por JS). A fazer.
- **Prezunic**: loja online VTEX. A fazer. **Supermarket**: endereço do site a descobrir.

## Etapas
| # | Etapa | Status |
|---|-------|--------|
| 1 | Prova de conceito dos dados (leitura de encartes, comparação) | ✅ |
| 2 | Protótipo visual + identidade | ✅ |
| 3 | App base: Início, Busca, Produto, Lista, Encartes, Perfil | ✅ |
| 4 | Robô de coleta Guanabara + Mundial, agendado no GitHub Actions | ✅ |
| 5 | Atacadão automático, Assaí (por loja), Prezunic, Supermarket | ⏳ |
| 6 | Localização (bairro → lojas próximas, distância) | ⏳ |
| 7 | Painel de revisão das ofertas e da junção de produtos | ⏳ |
| 8 | Alertas de preço, histórico, favoritos | ⏳ |

## Comandos
```
npm install
npm run dev        # http://localhost:5173  (data de teste: ?data=2026-11-23)
npm run coletar    # robô: Guanabara e Mundial → data/brutos/
npm run importar   # data/brutos + curadoria → data/ofertas.json e data/encartes.json
npm test
npm run build
```
Organização do código: ver README.md.
