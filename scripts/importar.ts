// Importa os encartes (coletas do robô + dados manuais) para data/ofertas.json e data/encartes.json.
// Rode com: npm run importar  (o build já roda)
//
// Fontes em data/brutos/:
//  - guanabara-site-<início>.json  coletado pelo robô (npm run coletar) do site do Guanabara
//  - mundial-site-<data>.json      coletado pelo robô do site do Mundial (só o mais recente vale)
//  - atacadao-ofertao-*.json       dados embutidos no PDF do Atacadão (manual, por enquanto)
// E em data/curadoria/: ofertas lidas de imagem (ex.: Boa do Dia do Atacadão).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ColetaAtacadao } from '../src/coleta/atacadao';
import type { ColetaGuanabara } from '../src/coleta/guanabara';
import type { ColetaPrezunic } from '../src/coleta/prezunic';
import type { ColetaMundial } from '../src/coleta/mundial';
import { aplicarJuncoes, assinatura, etiquetaTamanho, idProduto, palavrasDoProduto, unificarProdutos, type Juncoes } from '../src/core/canonico';
import { normalizar } from '../src/core/texto';
import { categorizar } from '../src/core/categorias';
import { idsDasLojas } from '../src/core/locais';
import { MARCAS_CONHECIDAS, limparNome, separarMarca, separarMarcas } from '../src/core/marcas';
import { extrairTamanho, formatarReais } from '../src/core/texto';
import type { Encarte, Loja, MercadoId, Oferta, Preco, ProgramaId } from '../src/core/tipos';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (rel: string) => JSON.parse(readFileSync(join(RAIZ, rel), 'utf8'));
const brutos = readdirSync(join(RAIZ, 'data/brutos')).sort();

let ofertas: Oferta[] = [];
const lojas: Loja[] = ler('data/lojas.json');
const encartes: Encarte[] = ler('data/encartes-manuais.json');
for (const e of encartes) if (e.lojas.length) e.lojasIds = idsDasLojas(e.lojas, lojas, e.mercado);
let seq = 0;

/** Cria uma oferta por marca (ofertas "Marca A, B ou C" valem para cada uma). */
function adicionar(base: {
  mercado: MercadoId;
  encarte: string;
  nome: string;
  marcas: string[];
  original: string;
  textoTamanho: string;
  precos: Preco[];
  precoDe?: number;
  fim?: string;
  limite?: string;
  produto?: string;
  imagem?: string;
  duvida?: string;
  revisado?: boolean;
}) {
  const { tamanho, porKg } = extrairTamanho(base.textoTamanho);
  const marcas = base.marcas.length ? base.marcas : [''];
  for (const marca of marcas) {
    const produto =
      base.produto && marcas.length === 1 ? base.produto : idProduto(base.nome, marca, tamanho, porKg);
    ofertas.push({
      id: `${base.encarte}#${++seq}`,
      mercado: base.mercado,
      encarte: base.encarte,
      produto,
      nome: base.nome,
      marca,
      original: base.original,
      categoria: categorizar(`${base.nome} ${base.original}`),
      tamanho,
      porKg,
      precos: base.precos,
      ...(base.precoDe ? { precoDe: base.precoDe } : {}),
      ...(base.fim ? { fim: base.fim } : {}),
      ...(base.limite ? { limite: base.limite } : {}),
      ...(base.imagem ? { imagem: base.imagem } : {}),
      ...(base.duvida ? { duvida: base.duvida } : {}),
      revisado: !!base.revisado,
    });
  }
}

const reais = (txt: string | null | undefined): number | undefined => {
  if (!txt) return undefined;
  const m = txt.replace(/\./g, '').match(/(\d+),(\d{2})/);
  return m ? Number(`${m[1]}.${m[2]}`) : undefined;
};

const PEQUENAS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'e', 'ou', 'em', 'a', 'o', 'para']);
function capitalizar(txt: string): string {
  return txt
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && PEQUENAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** Data local (Rio, UTC−3) a partir de um instante ISO em UTC. */
function dataLocal(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const marcasConhecidas = new Set<string>(MARCAS_CONHECIDAS);

// ---------------------------------------------------------------- Mundial (robô; só a coleta mais recente)
{
  const arquivo = brutos.filter((f) => f.startsWith('mundial-site-')).pop();
  if (arquivo) {
    const c = ler(`data/brutos/${arquivo}`) as ColetaMundial;
    const idEncarte = arquivo.replace('.json', '');
    const fins: string[] = [];
    const finsImperdivel: string[] = [];
    for (const o of c.ofertas as any[]) {
      const p = o.product;
      if (p.customBrand) marcasConhecidas.add(capitalizar(p.customBrand));
      const imperdivel = !p.customBrand && !p.customWeight;
      const nomeBase = imperdivel
        ? capitalizar(String(p.customName).replace(/\s+(c\/\s*\d+.*|\d.*|kg)$/i, ''))
        : [p.customName, p.customType].filter(Boolean).join(' ');
      const marca = p.customBrand ? capitalizar(p.customBrand) : '';
      const textoTamanho = o.measureUnit === 'KG' ? 'Quilo' : `${p.customWeight ?? ''} ${p.customName ?? ''}`;
      const preco = reais(o.price)!;
      const normal = reais(o.oldPrice);
      // Promoção por quantidade (só no app Mundial Total): no site, `price` NÃO é o preço de 1 unidade.
      //   "leve 4, pague 3" → price = média por unidade levando 4 (9,80 → 7,35);
      //   "30% na 2ª unidade" → price = preço só da 2ª unidade (Omo 14,66 → 10,26, confirmado pelo dono em 25/11).
      // O preço de 1 unidade é o `oldPrice`; a promoção vira aviso com os valores.
      const promoQuantidade = o.quantity > 1 && normal;
      let limite: string | undefined;
      let duvida: string | undefined;
      let precos: Preco[];
      if (promoQuantidade) {
        limite = o.percent
          ? `No app Mundial Total: a ${o.quantity}ª unidade sai por ${formatarReais(preco)} (${o.percent}% de desconto)`
          : `No app Mundial Total: leve ${o.quantity}, pague ${o.quantity2} (sai por ${formatarReais(preco)} cada)`;
        precos = [{ valor: normal, exige: [] }];
      } else {
        precos = normal
          ? [
              { valor: normal, exige: [] },
              { valor: preco, exige: ['mundial-total'], condicao: 'no app Mundial Total' },
            ]
          : [{ valor: preco, exige: [] }];
      }
      // "Imperdível" = oferta relâmpago do site (1 a 2 dias, um preço só, sem "de"). Vale também na loja (dono, 26/11).
      // Fica num encarte próprio, com a validade dela, para não aparecer como "Ofertas 19.11 a 02.12".
      const relampago = o.category?.name === 'Imperdível';
      const fim = dataLocal(o.unpublishedIn);
      if (relampago) finsImperdivel.push(fim);
      else fins.push(fim);
      adicionar({
        mercado: 'mundial',
        encarte: relampago ? `${idEncarte}-imperdivel` : idEncarte,
        // Nomes da seção Imperdível vêm em MAIÚSCULAS no site.
        nome: nomeBase.trim() === nomeBase.trim().toUpperCase() ? capitalizar(nomeBase.trim()) : nomeBase.trim(),
        marcas: [marca],
        original: [p.customName, p.customBrand, p.customType, p.customWeight, p.customDetail].filter(Boolean).join(' ').replace(/\s+/g, ' '),
        textoTamanho,
        precos,
        fim,
        limite,
        duvida,
        imagem: p.images?.[0]?.url,
      });
    }
    const inicios = c.encartes.map((e) => dataLocal(e.publicadoEm)).sort();
    encartes.push({
      id: idEncarte,
      mercado: 'mundial',
      titulo: c.encartes.map((e) => e.descricao.replace(/^Encarte - /, '')).join(' + ') || 'Ofertas do site',
      inicio: inicios[0] ?? c.coletadoEm.slice(0, 10),
      fim: fins.sort().pop() ?? c.coletadoEm.slice(0, 10),
      lojas: [],
      fonte: `site do Mundial (robô, ${c.coletadoEm.slice(0, 10)})`,
    });
    if (finsImperdivel.length)
      encartes.push({
        id: `${idEncarte}-imperdivel`,
        mercado: 'mundial',
        titulo: 'Imperdível (oferta relâmpago)',
        // O site não diz quando começou: vale a partir da coleta.
        inicio: dataLocal(c.coletadoEm),
        fim: finsImperdivel.sort().pop()!,
        lojas: [],
        fonte: `seção "Imperdível" do site do Mundial (robô, ${c.coletadoEm.slice(0, 10)})`,
      });
  }
}

// ---------------------------------------------------------------- Atacadão (dados embutidos no PDF)
const MARCAS_ATACADAO = [
  'Copacol', 'Aurora', 'Frimesa', 'Friboi', 'Sadia', 'Canção', 'Lar', 'São Geraldo', 'Imperial', 'Mutumilk',
  'Perdigão', 'Uai', 'Aldente', 'Kicaldo', 'Guarani', 'Bulnez', 'Pramesa', 'Cisne', 'Junco', 'Único', 'Panco',
  'Porto Alegre', 'Trakinas', 'Renata', 'Triunfo', 'Moça', 'Ninho', 'Nestlé', 'Mucilon', 'Santa Edwiges',
  'Mucininho', 'Nescau', 'Nescafé', 'Elma Chips', 'Kerus', 'Cantina da Serra', 'Cereser', 'OQ', 'Aliança',
  'Pink Moon', 'Cliper', 'Itaipava', 'Amstel', 'Grapette', 'Antarctica', 'Búfalo', 'Comfort', 'Cif', 'Veja',
  'Harpic', 'Darling', 'Palmolive', 'Giovanna Baby', 'Lady', 'Dunlop', 'Celeste', 'Kerocopo', 'Vittamax', 'Alklin',
];
for (const m of MARCAS_ATACADAO) marcasConhecidas.add(m);

function separarMarcasAtacadao(linha: string): { nome: string; marcas: string[] } {
  let resto = ` ${linha} `;
  const marcas: string[] = [];
  for (const m of MARCAS_ATACADAO) {
    const re = new RegExp(`(?<=[\\s/])${m.replace(/ /g, '\\s+')}(?=[\\s/,])`, 'i');
    if (re.test(resto)) {
      marcas.push(m);
      resto = resto.replace(re, ' ');
    }
  }
  return { nome: resto.replace(/[/,]/g, ' ').replace(/\s+/g, ' ').trim(), marcas };
}

function importarTabloideAtacadao(paginas: { itens: { descricao: string; campos: Record<string, string> }[] }[], idEncarte: string) {
  for (const pg of paginas) {
    for (const it of pg.itens) {
      const linhas = String(it.descricao).split('\n').map((s: string) => s.trim()).filter(Boolean);
      if (linhas.length === 0) continue;
      let { nome, marcas } = separarMarcasAtacadao(linhas[0]);
      if (marcas.length === 0) {
        // Marca fora da lista do Atacadão: tenta o dicionário geral (inclui as marcas do Mundial).
        const r = separarMarca(linhas[0], [...marcasConhecidas]);
        if (r.marca) {
          nome = limparNome(r.nome) || r.nome;
          marcas = [r.marca];
        }
      }
      const c = it.campos;
      const precos: Preco[] = [];
      const normal = reais(c.P);
      if (!normal) continue;
      precos.push({ valor: normal, exige: [] });
      const app = reais(c.PSEG);
      if (app) precos.push({ valor: app, exige: ['meu-atacadao'], condicao: 'ativando a oferta no app Meu Atacadão' });
      const cartao = reais(c.PTER);
      if (cartao)
        precos.push({
          valor: cartao,
          exige: ['meu-atacadao', 'cartao-atacadao'] as ProgramaId[],
          condicao: 'app Meu Atacadão + cartão Atacadão, Carrefour ou Sam’s Club',
        });
      const de = reais(c.D);
      adicionar({
        mercado: 'atacadao',
        encarte: idEncarte,
        nome,
        marcas,
        original: linhas.join(' · '),
        textoTamanho: linhas.join(' '),
        precos,
        precoDe: de && de > normal ? de : undefined,
        limite: c.QUNTOFERTAO ? 'limite por cliente: consulte no app' : undefined,
      });
    }
  }
}

// Ofertão cadastrado à mão (PDF enviado pelo dono), antes do robô
for (const arquivo of brutos.filter((f) => f.startsWith('atacadao-ofertao-'))) {
  importarTabloideAtacadao(ler(`data/brutos/${arquivo}`).paginas, arquivo.replace('.json', ''));
}

// Folhetos coletados pelo robô (API de folhetos do site)
for (const arquivo of brutos.filter((f) => f.startsWith('atacadao-folheto-'))) {
  const c = ler(`data/brutos/${arquivo}`) as ColetaAtacadao;
  const idEncarte = arquivo.replace('.json', '');
  encartes.push({
    id: idEncarte,
    mercado: 'atacadao',
    titulo: c.folheto.nome.replace(/O(f+)e(r+)t[ãa]+o/i, 'Ofertão'),
    inicio: c.folheto.inicio,
    fim: c.folheto.fim,
    lojas: c.folheto.lojas.map((l) => (l.cidade && l.cidade !== 'Rio de Janeiro' ? `${l.cidade} (${l.nome})` : l.nome)).sort(),
    lojasIds: c.folheto.lojas.map((l) => `atacadao-${l.id}`),
    fonte: `folhetos do site do Atacadão (robô, ${c.coletadoEm.slice(0, 10)})`,
  });
  importarTabloideAtacadao(c.paginas, idEncarte);
}

// ---------------------------------------------------------------- Guanabara (DESLIGADO)
// A lista /produtos do site NÃO é o encarte: em 25/11 só ~40% batia com o PDF, com preços diferentes
// (Camil 5kg 28,95 no site × 27,95 no encarte) e itens fora do encarte. Regra do dono: só entra o que
// está no encarte. O robô continua coletando a lista (para referência), mas ela não vai para o app.
// O Guanabara entra pela leitura do PDF do encarte (data/curadoria; futuramente, leitor por IA).
const USAR_LISTA_DO_SITE_GUANABARA = false;
if (USAR_LISTA_DO_SITE_GUANABARA) {
  const coletas = brutos
    .filter((f) => f.startsWith('guanabara-site-'))
    .map((f) => ({ arquivo: f, c: ler(`data/brutos/${f}`) as ColetaGuanabara }));
  const maisRecente = coletas.map((x) => x.c.fim).sort().pop();
  const limite = maisRecente ? new Date(new Date(maisRecente).getTime() - 14 * 86400000).toISOString().slice(0, 10) : '';
  const listaMarcas = [...marcasConhecidas];
  for (const { arquivo, c } of coletas) {
    if (c.fim < limite) continue;
    const idEncarte = arquivo.replace('.json', '');
    encartes.push({
      id: idEncarte,
      mercado: 'guanabara',
      titulo: 'Encarte Guanabara',
      inicio: c.inicio,
      fim: c.fim,
      lojas: [],
      fonte: `site do Guanabara (robô, ${c.coletadoEm.slice(0, 10)})`,
    });
    for (const it of c.itens) {
      const preco = reais(it.preco);
      if (!preco) continue;
      const { marca, nome } = separarMarca(it.nome, listaMarcas);
      const obs = it.nome.match(/\(([^)]*)\)/)?.[1]?.trim();
      adicionar({
        mercado: 'guanabara',
        encarte: idEncarte,
        nome: limparNome(nome) || nome,
        marcas: marca ? [marca] : [],
        original: it.nome,
        textoTamanho: it.nome,
        precos: [{ valor: preco, exige: [], ...(obs && !/^pe[çc]a$/i.test(obs) ? { condicao: obs.replace(/^Exc\.?:?\s*/i, 'exceto ') } : {}) }],
        imagem: it.imagem ?? undefined,
      });
    }
  }
}

// ---------------------------------------------------------------- Prezunic (robô; PDFs lidos pela posição das palavras)
{
  const listaMarcas = [...marcasConhecidas];
  for (const arquivo of brutos.filter((f) => f.startsWith('prezunic-encarte-'))) {
    const c = ler(`data/brutos/${arquivo}`) as ColetaPrezunic;
    const idEncarte = arquivo.replace('.json', '');
    const titulo =
      c.encarte.titulo
        .split('|')[0]
        .replace(/\s+(nas|para as)?\s*lojas?:?.*$/i, '')
        .trim() || 'Encarte Prezunic';
    encartes.push({
      id: idEncarte,
      mercado: 'prezunic',
      titulo: titulo.charAt(0).toUpperCase() + titulo.slice(1),
      inicio: c.encarte.inicio,
      fim: c.encarte.fim,
      lojas: c.encarte.lojas,
      lojasIds: idsDasLojas(c.encarte.lojas, lojas, 'prezunic'),
      fonte: `encartes do site do Prezunic (robô, ${c.coletadoEm.slice(0, 10)})`,
    });
    for (const it of c.itens) {
      // Alguns encartes põem o rodapé ("LOJAS…, NO PERÍODO DE…, ENQUANTO DURAREM NOSSOS ESTOQUES.") colado no nome.
      const nomeLimpo = it.nome.replace(/^.*ENQUANTO DURAREM NOSSOS ESTOQUES\.?\s*/i, '').trim() || it.nome;
      const texto = capitalizar(nomeLimpo);
      const { marcas, nome } = separarMarcas(texto, listaMarcas);
      adicionar({
        mercado: 'prezunic',
        encarte: idEncarte,
        nome: limparNome(nome) || nome || texto,
        marcas,
        original: `${nomeLimpo} ${it.detalhe}`.trim(),
        textoTamanho: `${it.detalhe} ${nomeLimpo}`,
        precos: [{ valor: it.preco, exige: [] }],
        precoDe: it.precoDe ?? undefined,
        limite: it.limite ? it.limite.replace(/^Limite/, 'limite') : undefined,
      });
    }
  }
}

// ---------------------------------------------------------------- Curadoria (lida de imagens)
interface ItemCuradoria {
  nome: string;
  marcas: string[];
  tamanho: string;
  preco: number;
  de?: number;
  clube?: number;
  app?: number;
  condicao?: string;
  limite?: string;
  produto?: string;
  duvida?: string;
  /** Só existe preço para quem é do clube (o encarte não mostra o preço normal). */
  soClube?: boolean;
  /** Página do encarte (leituras por IA). A imagem fica em public/paginas/<encarte>/p<pagina>.jpg. */
  pagina?: number;
  /** Conferido pelo dono no painel de revisão. */
  revisado?: boolean;
  /** Apagado no painel de revisão (fica no arquivo para não mudar a posição dos outros itens). */
  removido?: boolean;
}
interface ArquivoCuradoria {
  encarte: string;
  /** Encarte desta curadoria (leituras por IA registram o encarte aqui, não em encartes-manuais.json). */
  encarteInfo?: Encarte;
  /** Se este arquivo de data/brutos existir, a curadoria é ignorada (a fonte automática chegou). */
  pularSeExistir?: string;
  mercado: MercadoId;
  programaClube?: ProgramaId;
  nomeClube?: string;
  programaApp?: ProgramaId;
  itens: ItemCuradoria[];
}

/** "cada", "garrafa", "Pote 1kg", "Caixeta 672g", "preço cada pacote"… = só a embalagem, não é condição de compra. */
function condicaoSoEmbalagem(t: string): boolean {
  if (/%|leve|pague|app|clube|cart[aã]o|r\$|a partir|gr[aá]tis|limite|desconto|unidade sai|kg sai/i.test(t)) return false;
  return /^(pre[çc]o\s+)?(cada|unidade|garrafa|pacote|caixeta|sach[eê]|pote|bandeja|lata|frasco|gal[aã]o|embalagem)(?=$|[\s,;.])/i.test(t.trim());
}

const HOJE_RIO = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const revisao: unknown[] = [];

for (const arq of readdirSync(join(RAIZ, 'data/curadoria')).filter((f) => f.endsWith('.json')).sort()) {
  const c = ler(`data/curadoria/${arq}`) as ArquivoCuradoria;
  if (c.pularSeExistir && existsSync(join(RAIZ, c.pularSeExistir))) {
    const i = encartes.findIndex((e) => e.id === c.encarte);
    if (i >= 0) encartes.splice(i, 1);
    console.log(`Curadoria ${arq} ignorada: a fonte automática (${c.pularSeExistir}) já existe.`);
    continue;
  }
  if (c.encarteInfo && !encartes.some((e) => e.id === c.encarteInfo!.id)) encartes.push(c.encarteInfo);
  const enc = encartes.find((e) => e.id === c.encarte);
  for (const [indice, it] of c.itens.entries()) {
    // Painel de revisão: lista todos os itens de encartes ainda válidos, com o lugar exato no arquivo.
    if (enc && enc.fim >= HOJE_RIO) {
      const imagem = it.pagina ? `paginas/${c.encarte}/p${it.pagina}.jpg` : undefined;
      revisao.push({
        arquivo: arq, indice, mercado: c.mercado, encarte: c.encarte, titulo: enc.titulo, inicio: enc.inicio, fim: enc.fim,
        ...(imagem && existsSync(join(RAIZ, 'public', imagem)) ? { imagem } : {}),
        item: it,
      });
    }
    if (it.removido) continue;
    // A leitura por IA às vezes põe na "condição" só a embalagem ("cada", "Pote 1kg", "garrafa"): isso não é condição.
    const condicao = it.condicao && !condicaoSoEmbalagem(it.condicao) ? it.condicao : undefined;
    // Se a condição fala do clube/app, ela vale para o preço do clube, não para o preço de todo mundo.
    const doClube = !!condicao && /\b(app|clube)\b/i.test(condicao);
    const precos: Preco[] =
      it.soClube && c.programaClube
        ? [{ valor: it.preco, exige: [c.programaClube], condicao: condicao ?? `no ${c.nomeClube ?? 'clube'}` }]
        : [{ valor: it.preco, exige: [], ...(condicao && !(it.clube && doClube) ? { condicao } : {}) }];
    if (it.clube && c.programaClube)
      precos.push({ valor: it.clube, exige: [c.programaClube], condicao: doClube ? condicao! : `no ${c.nomeClube ?? 'clube'}` });
    if (it.app && c.programaApp)
      precos.push({ valor: it.app, exige: [c.programaApp], condicao: 'ativando a oferta no app' });
    adicionar({
      mercado: c.mercado,
      encarte: c.encarte,
      nome: it.nome,
      marcas: it.marcas,
      original: `${it.nome} ${it.marcas.join(', ')} ${it.tamanho}`.replace(/\s+/g, ' ').trim(),
      textoTamanho: it.tamanho,
      precos,
      precoDe: it.de,
      limite: it.limite,
      produto: it.produto,
      duvida: it.revisado ? undefined : it.duvida,
      revisado: it.revisado,
    });
  }
}

// ---------------------------------------------------------------- Junta o mesmo produto escrito de jeitos diferentes
const antes = new Set(ofertas.map((o) => o.produto)).size;
ofertas = unificarProdutos(ofertas);
// Decisões do dono no painel ("são o mesmo" / "são diferentes") vêm por cima da regra automática.
const juncoes: Juncoes = existsSync(join(RAIZ, 'data/juncoes.json')) ? ler('data/juncoes.json') : { juntar: [], diferentes: [] };
ofertas = aplicarJuncoes(ofertas, juncoes);
const depois = new Set(ofertas.map((o) => o.produto)).size;

// ---------------------------------------------------------------- Saída
ofertas.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
writeFileSync(join(RAIZ, 'data/ofertas.json'), JSON.stringify(ofertas, null, 1) + '\n');
encartes.sort((a, b) => a.mercado.localeCompare(b.mercado) || a.inicio.localeCompare(b.inicio));
writeFileSync(join(RAIZ, 'data/encartes.json'), JSON.stringify(encartes, null, 1) + '\n');
// Sugestões de junção para o painel: produtos diferentes com a mesma marca e o mesmo tamanho (provável mesmo produto
// escrito de outro jeito) e produtos já juntados com nomes diferentes (para o dono conferir/separar).
{
  interface Resumo { produto: string; assinatura: string; nome: string; marca: string; tamanho: string; mercados: string[]; preco: number }
  const porProduto = new Map<string, Oferta[]>();
  for (const o of ofertas) porProduto.set(o.produto, [...(porProduto.get(o.produto) ?? []), o]);
  const resumo = (lista: Oferta[]): Resumo => {
    const o = lista[0];
    return {
      produto: o.produto, assinatura: assinatura(o), nome: o.nome, marca: o.marca,
      tamanho: etiquetaTamanho(o.tamanho, o.porKg).replace('sem-tamanho', ''),
      mercados: [...new Set(lista.map((x) => x.mercado))].sort(),
      preco: Math.min(...lista.flatMap((x) => x.precos.filter((p) => !p.exige.length).map((p) => p.valor)), Infinity),
    };
  };
  const ditos = new Set([...juncoes.juntar, ...juncoes.diferentes].map(([a, b]) => [a, b].sort().join('§')));
  const grupos = new Map<string, Oferta[][]>();
  for (const lista of porProduto.values()) {
    const o = lista[0];
    const marca = normalizar(o.marca);
    if (!marca || (!o.tamanho && !o.porKg)) continue;
    const k = `${marca}|${etiquetaTamanho(o.tamanho, o.porKg)}`;
    grupos.set(k, [...(grupos.get(k) ?? []), lista]);
  }
  const sugestoes: { a: Resumo; b: Resumo; parecido: number }[] = [];
  for (const listas of grupos.values()) {
    for (let x = 0; x < listas.length; x++)
      for (let y = x + 1; y < listas.length; y++) {
        const a = resumo(listas[x]);
        const b = resumo(listas[y]);
        if (a.mercados.every((m) => b.mercados.includes(m)) && b.mercados.every((m) => a.mercados.includes(m))) continue;
        if (ditos.has([a.assinatura, b.assinatura].sort().join('§'))) continue;
        const pa = new Set(palavrasDoProduto(a.nome, a.marca));
        const pb = new Set(palavrasDoProduto(b.nome, b.marca));
        const comuns = [...pa].filter((w) => pb.has(w)).length;
        if (!comuns) continue;
        sugestoes.push({ a, b, parecido: comuns / new Set([...pa, ...pb]).size });
      }
  }
  sugestoes.sort((p, q) => q.parecido - p.parecido);
  // Já juntados com nomes diferentes (a regra automática pode ter errado).
  const juntos: { produto: string; itens: Resumo[] }[] = [];
  for (const [produto, lista] of porProduto) {
    const porNome = new Map<string, Oferta[]>();
    for (const o of lista) porNome.set(assinatura(o), [...(porNome.get(assinatura(o)) ?? []), o]);
    if (porNome.size < 2) continue;
    juntos.push({ produto, itens: [...porNome.values()].map(resumo) });
  }
  writeFileSync(join(RAIZ, 'data/juncoes-sugestoes.json'), JSON.stringify({ sugestoes: sugestoes.slice(0, 300), juntos }) + '\n');
}

// Só o painel de revisão carrega este arquivo (separado do app, para não pesar para os clientes).
writeFileSync(join(RAIZ, 'data/revisao.json'), JSON.stringify(revisao) + '\n');

const porMercado = new Map<string, number>();
for (const o of ofertas) porMercado.set(o.mercado, (porMercado.get(o.mercado) ?? 0) + 1);
const produtos = new Map<string, Set<string>>();
for (const o of ofertas) {
  if (!produtos.has(o.produto)) produtos.set(o.produto, new Set());
  produtos.get(o.produto)!.add(o.mercado);
}
const emVarios = [...produtos].filter(([, m]) => m.size > 1);
console.log(`Ofertas: ${ofertas.length} (${[...porMercado].map(([m, n]) => `${m} ${n}`).join(', ')})`);
console.log(`Encartes: ${encartes.map((e) => `${e.id} [${e.inicio}..${e.fim}]${e.lojas.length ? ` lojas ${e.lojasIds?.length ?? 0}/${e.lojas.length}` : ''}`).join(', ')}`);
console.log(`Produtos: ${depois} (unificados ${antes - depois}); em 2+ mercados: ${emVarios.length}`);
if (process.argv.includes('--comparaveis')) for (const [id, m] of emVarios) console.log(`  ${id}  [${[...m].join(', ')}]`);
