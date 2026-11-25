// Lê com IA os encartes que só existem como IMAGEM e salva em data/curadoria/ (mesmo formato da leitura manual).
// Roda no GitHub (workflow "Ler encartes com IA"), usando o segredo ANTHROPIC_API_KEY.
//   npm run ler-encartes            → lê o encarte atual do Guanabara (se ainda não foi lido)
//   npm run ler-encartes -- --teste → lê só a 1ª página, mostra o resultado e o custo, não salva nada
// Trava de gasto: para quando a execução passa de LIMITE_US (padrão US$ 1,00).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerValidadeGuanabara, SITE_GUANABARA } from '../src/coleta/guanabara';
import { baixarArquivo, criarBaixar } from '../src/coleta/http';
import { criarCliente, lerPagina, MODELO_PADRAO, type ItemLido } from '../src/coleta/leitorIA';
import { lerEncartesMundial, lerPageProps, SITE_MUNDIAL } from '../src/coleta/mundial';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CURADORIA = join(RAIZ, 'data/curadoria');
const TESTE = process.argv.includes('--teste');
const LIMITE_US = Number(process.env.LIMITE_US || 1);
const modelo = process.env.LEITOR_MODELO || MODELO_PADRAO;
const baixar = criarBaixar();
const hojeRio = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const LEITURAS = join(RAIZ, 'data/leituras');

/**
 * Lê uma página reaproveitando leituras anteriores: se a MESMA imagem já foi lida (mesmo conteúdo, qualquer
 * encarte), usa o resultado guardado em data/leituras/<hash>.json e não gasta nada.
 */
async function lerComReaproveitamento(
  cliente: ReturnType<typeof criarCliente>,
  arq: string,
  contexto: string,
): Promise<{ itens: ItemLido[]; custo: number; reaproveitada: boolean; info: string }> {
  const img = readFileSync(arq);
  const hash = createHash('sha256').update(img).digest('hex').slice(0, 32);
  const cache = join(LEITURAS, `${hash}.json`);
  if (existsSync(cache)) {
    const c = JSON.parse(readFileSync(cache, 'utf8'));
    return { itens: c.itens, custo: 0, reaproveitada: true, info: `reaproveitada (lida antes por ${c.modelo})` };
  }
  const r = await lerPagina(cliente, img, 'image/jpeg', contexto, modelo);
  if (!TESTE) {
    mkdirSync(LEITURAS, { recursive: true });
    writeFileSync(cache, JSON.stringify({ modelo, lidaEm: hojeRio, itens: r.itens }, null, 1) + '\n');
  }
  return { itens: r.itens, custo: r.custoUS, reaproveitada: false, info: `${r.tokensEntrada} + ${r.tokensSaida} tokens · US$ ${r.custoUS.toFixed(4)}` };
}

function jaExiste(mercado: string, inicio: string, fim: string): string | null {
  const manuais = JSON.parse(readFileSync(join(RAIZ, 'data/encartes-manuais.json'), 'utf8')) as any[];
  const m = manuais.find((e) => e.mercado === mercado && e.inicio === inicio && e.fim === fim);
  if (m) return `cadastrado à mão (${m.id})`;
  for (const f of readdirSync(CURADORIA).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(CURADORIA, f), 'utf8'));
    if (c.mercado === mercado && c.encarteInfo?.inicio === inicio && c.encarteInfo?.fim === fim) return `já lido (${f})`;
  }
  return null;
}

/** Converte cada página do PDF numa imagem JPEG (lado maior 1568 px, o tamanho que a IA usa). */
function paginasDoPdf(pdf: string, pasta: string): string[] {
  execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=85', '-scale-to', '1568', pdf, join(pasta, 'p')]);
  return readdirSync(pasta).filter((f) => f.endsWith('.jpg')).sort().map((f) => join(pasta, f));
}

async function guanabara(cliente: ReturnType<typeof criarCliente>, gastoAte: number): Promise<number> {
  console.log('Guanabara…');
  const validade = lerValidadeGuanabara(baixar(`${SITE_GUANABARA}/encarte`));
  if (!validade) throw new Error('não achei a validade na página /encarte');
  if (validade.fim < hojeRio) {
    console.log(`  encarte do site já venceu (${validade.fim}); nada a ler`);
    return gastoAte;
  }
  const existe = jaExiste('guanabara', validade.inicio, validade.fim);
  if (existe && !TESTE) {
    console.log(`  encarte ${validade.inicio} a ${validade.fim} ${existe}; nada a ler`);
    return gastoAte;
  }
  const pasta = mkdtempSync(join(tmpdir(), 'guanabara-'));
  try {
    const pdf = join(pasta, 'encarte.pdf');
    baixarArquivo(`${SITE_GUANABARA}/encarte/baixe`, pdf);
    let paginas = paginasDoPdf(pdf, pasta);
    console.log(`  encarte ${validade.inicio} a ${validade.fim}: ${paginas.length} páginas`);
    if (TESTE) paginas = paginas.slice(0, 1);
    const itens: any[] = [];
    let gasto = gastoAte;
    for (const [i, arq] of paginas.entries()) {
      if (gasto >= LIMITE_US) {
        console.log(`  ! parei na página ${i + 1}: limite de gasto da execução (US$ ${LIMITE_US}) atingido`);
        if (!TESTE) return gasto; // não salva encarte pela metade
        break;
      }
      const r = await lerComReaproveitamento(
        cliente,
        arq,
        `Encarte do Supermercados Guanabara (Rio de Janeiro), página ${i + 1} de ${paginas.length}. O clube de vantagens se chama "Guana Clube".`,
      );
      gasto += r.custo;
      console.log(`  página ${i + 1}: ${r.itens.length} ofertas · ${r.info}`);
      for (const it of r.itens) itens.push({ pagina: i + 1, ...limpar(it) });
    }
    if (TESTE) {
      console.log('  --- amostra (teste, nada foi salvo) ---');
      for (const it of itens.slice(0, 80)) console.log(`  ${it.nome} | ${it.marcas.join(', ')} | ${it.tamanho} | ${it.preco}${it.de ? ` (de ${it.de})` : ''}${it.clube ? ` clube ${it.clube}` : ''}${it.soClube ? ' SÓ CLUBE' : ''}${it.condicao ? ` | ${it.condicao}` : ''}${it.duvida ? ` | DÚVIDA: ${it.duvida}` : ''}`);
      return gasto;
    }
    const id = `guanabara-ia-${validade.inicio}`;
    const arquivo = {
      encarte: id,
      mercado: 'guanabara',
      programaClube: 'guana-clube',
      nomeClube: 'Guana Clube',
      encarteInfo: {
        id,
        mercado: 'guanabara',
        titulo: 'Encarte Guanabara',
        inicio: validade.inicio,
        fim: validade.fim,
        lojas: [],
        fonte: `PDF do encarte do site do Guanabara, lido por IA (${modelo}) em ${hojeRio}`,
      },
      observacao: `Lido por IA (${modelo}); custo aproximado US$ ${(gasto - gastoAte).toFixed(2)}. Não revisado.`,
      itens,
    };
    writeFileSync(join(CURADORIA, `${id}.json`), JSON.stringify(arquivo, null, 1) + '\n');
    console.log(`  salvo data/curadoria/${id}.json (${itens.length} ofertas, US$ ${(gasto - gastoAte).toFixed(2)})`);
    return gasto;
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/**
 * Assaí: o site tem escudo anti-robô, então a lista de encartes vem de data/fontes/assai-encartes-rj.json (o dono abre
 * o ofertas_assai.json no celular e manda). As páginas são imagens num servidor de arquivos (CloudFront) sem escudo.
 * Cada campanha vira data/curadoria/assai-ia-<campanha>.json; campanha já lida ou vencida é pulada.
 */
async function assai(cliente: ReturnType<typeof criarCliente>, gastoAte: number): Promise<number> {
  console.log('Assaí…');
  const fonte = JSON.parse(readFileSync(join(RAIZ, 'data/fontes/assai-encartes-rj.json'), 'utf8'));
  let gasto = gastoAte;
  for (const e of fonte.encartes as { campanha: string; inicio: string; fim: string; paginas: string[] }[]) {
    const id = `assai-ia-${e.campanha}`;
    if (e.fim < hojeRio) { console.log(`  ${e.campanha}: venceu em ${e.fim}; pulei`); continue; }
    if (existsSync(join(CURADORIA, `${id}.json`)) && !TESTE) { console.log(`  ${e.campanha}: já lido; pulei`); continue; }
    const pasta = mkdtempSync(join(tmpdir(), 'assai-'));
    try {
      const itens: any[] = [];
      const inicioGasto = gasto;
      let completo = true;
      const paginas = TESTE ? e.paginas.slice(0, 1) : e.paginas;
      for (const [i, url] of paginas.entries()) {
        if (gasto >= LIMITE_US) { console.log(`  ! parei: limite de gasto (US$ ${LIMITE_US})`); completo = false; break; }
        const original = join(pasta, `p${i + 1}-original.jpg`);
        const arq = join(pasta, `p${i + 1}.jpg`);
        baixarArquivo(url, original);
        // Mesmo tamanho das páginas do Guanabara (lado maior 1568 px): a IA lê bem e custa menos.
        execFileSync('convert', [original, '-resize', '1568x1568>', '-quality', '85', arq]);
        const r = await lerComReaproveitamento(cliente, arq, `Encarte do Assaí Atacadista (Rio de Janeiro), válido de ${e.inicio} a ${e.fim}, página ${i + 1} de ${e.paginas.length}. O app do Assaí se chama "Meu Assaí". Atacarejo: preços de atacado ("a partir de X unidades") são condição, não o preço normal.`);
        gasto += r.custo;
        console.log(`  ${e.campanha} página ${i + 1}: ${r.itens.length} ofertas · ${r.info}`);
        for (const it of r.itens) itens.push({ pagina: i + 1, ...limpar(it) });
      }
      if (TESTE) {
        for (const it of itens.slice(0, 80)) console.log(`  ${it.nome} | ${it.marcas.join(', ')} | ${it.tamanho} | ${it.preco}${it.clube ? ` app ${it.clube}` : ''}${it.condicao ? ` | ${it.condicao}` : ''}${it.duvida ? ` | DÚVIDA: ${it.duvida}` : ''}`);
        return gasto;
      }
      if (!completo) return gasto; // não salva encarte pela metade
      const arquivo = {
        encarte: id,
        mercado: 'assai',
        programaClube: 'meu-assai',
        nomeClube: 'app Meu Assaí',
        encarteInfo: { id, mercado: 'assai', titulo: 'Encarte Assaí RJ', inicio: e.inicio, fim: e.fim, lojas: [], fonte: `imagens do encarte do Assaí (lista enviada pelo dono), lidas por IA (${modelo}) em ${hojeRio}` },
        observacao: `Lido por IA (${modelo}); custo aproximado US$ ${(gasto - inicioGasto).toFixed(2)}. Não revisado.`,
        itens,
      };
      writeFileSync(join(CURADORIA, `${id}.json`), JSON.stringify(arquivo, null, 1) + '\n');
      console.log(`  salvo data/curadoria/${id}.json (${itens.length} ofertas, US$ ${(gasto - inicioGasto).toFixed(2)})`);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }
  return gasto;
}

/** Formato da curadoria: só manda os campos preenchidos. */
function limpar(it: any) {
  return {
    nome: it.nome.trim(),
    marcas: it.marcas.map((m: string) => m.trim()).filter(Boolean),
    tamanho: it.tamanho ?? '',
    preco: it.preco,
    ...(it.de ? { de: it.de } : {}),
    ...(it.clube ? { clube: it.clube } : {}),
    ...(it.soClube ? { soClube: true } : {}),
    ...(it.condicao ? { condicao: it.condicao } : {}),
    ...(it.duvida ? { duvida: it.duvida } : {}),
  };
}

/** Compara o encarte (PDF, lido por IA) com a lista "Nossas Ofertas" do site do Mundial. Não salva ofertas. */
async function compararMundial(cliente: ReturnType<typeof criarCliente>, gastoAte: number): Promise<number> {
  console.log('Mundial (comparação encarte × site)…');
  const encartes = lerEncartesMundial(lerPageProps(baixar(`${SITE_MUNDIAL}/encarte`)));
  const site: any[] = [];
  for (let p = 1, total = 1; p <= total && p <= 80; p++) {
    const props = lerPageProps(baixar(`${SITE_MUNDIAL}/departamentos/categoria/ofertas?page=${p}`));
    total = Number(props.numberOfPages ?? 1);
    site.push(...(props.offers ?? []));
  }
  const reais = (t: string | null) => (t ? Number(t.replace(/[^\d,]/g, '').replace(',', '.')) : null);
  const doEncarte: { nome: string; marcas: string[]; preco: number; clube: number | null; tamanho: string }[] = [];
  let gasto = gastoAte;
  for (const e of encartes.filter((x) => x.pdf)) {
    const pasta = mkdtempSync(join(tmpdir(), 'mundial-'));
    try {
      const pdf = join(pasta, 'encarte.pdf');
      baixarArquivo(e.pdf!, pdf);
      const paginas = paginasDoPdf(pdf, pasta);
      console.log(`  ${e.descricao}: ${paginas.length} páginas`);
      for (const [i, arq] of paginas.entries()) {
        if (gasto >= LIMITE_US) {
          console.log(`  ! parei: limite de gasto (US$ ${LIMITE_US})`);
          break;
        }
        const r = await lerComReaproveitamento(cliente, arq, `Encarte do Supermercados Mundial (Rio de Janeiro), página ${i + 1}. O app/clube se chama "Mundial Total".`);
        gasto += r.custo;
        console.log(`  página ${i + 1}: ${r.itens.length} ofertas · ${r.info}`);
        doEncarte.push(...r.itens);
      }
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let iguais = 0;
  const precoDiferente: string[] = [];
  const foraDoEncarte: string[] = [];
  for (const o of site) {
    const marca = norm(String(o.product?.customBrand ?? ''));
    const candidatos = marca ? doEncarte.filter((x) => x.marcas.some((m) => norm(m).includes(marca) || marca.includes(norm(m)))) : [];
    const precos = [reais(o.price), reais(o.oldPrice)].filter((x): x is number => !!x);
    const nome = `${o.category?.name}: ${o.product?.customName} ${o.product?.customBrand ?? ''} ${o.product?.customWeight ?? ''} R$ ${precos.join(' / ')}`;
    if (candidatos.some((c) => precos.some((p) => Math.abs(p - c.preco) < 0.005 || (c.clube && Math.abs(p - c.clube) < 0.005)))) iguais++;
    else if (candidatos.length) precoDiferente.push(`${nome}  ← encarte: ${candidatos.slice(0, 3).map((c) => `${c.nome} ${c.tamanho} ${c.preco}${c.clube ? `/${c.clube}` : ''}`).join('; ')}`);
    else foraDoEncarte.push(nome);
  }
  console.log(`  RESULTADO: site ${site.length} ofertas · encarte ${doEncarte.length} ofertas`);
  console.log(`  - no site e no encarte com o mesmo preço: ${iguais}`);
  console.log(`  - marca no encarte, mas preço diferente: ${precoDiferente.length}`);
  console.log(`  - no site, sem a marca no encarte: ${foraDoEncarte.length}`);
  const porCategoria = new Map<string, number>();
  for (const f of foraDoEncarte) porCategoria.set(f.split(':')[0], (porCategoria.get(f.split(':')[0]) ?? 0) + 1);
  console.log(`  - fora do encarte por categoria do site: ${[...porCategoria].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const l of precoDiferente.slice(0, 25)) console.log(`    ≠ ${l}`);
  for (const l of foraDoEncarte.slice(0, 25)) console.log(`    ∅ ${l}`);
  return gasto;
}

const cliente = criarCliente();
let gasto = 0;
let falhas = 0;
try {
  if (process.argv.includes('--mundial')) gasto = await compararMundial(cliente, gasto);
  else if (process.argv.includes('--assai')) gasto = await assai(cliente, gasto);
  // Assaí fica fora da passada automática: o servidor das imagens recusou o robô (403) em 25/11.
  else gasto = await guanabara(cliente, gasto);
} catch (e) {
  falhas++;
  console.error(`  ERRO: ${(e as Error).message}`);
}
console.log(`Gasto desta execução: ~US$ ${gasto.toFixed(3)} (modelo ${modelo})`);
if (falhas) process.exit(1);
