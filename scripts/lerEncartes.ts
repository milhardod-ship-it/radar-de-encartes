// Lê com IA os encartes que só existem como IMAGEM e salva em data/curadoria/ (mesmo formato da leitura manual).
// Roda no GitHub (workflow "Ler encartes com IA"), usando o segredo ANTHROPIC_API_KEY.
//   npm run ler-encartes            → lê o encarte atual do Guanabara (se ainda não foi lido)
//   npm run ler-encartes -- --teste → lê só a 1ª página, mostra o resultado e o custo, não salva nada
// Trava de gasto: para quando a execução passa de LIMITE_US (padrão US$ 1,00).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerValidadeGuanabara, SITE_GUANABARA } from '../src/coleta/guanabara';
import { coletarEncartesDom, listarLojasDom } from '../src/coleta/dom';
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
const PAGINAS = join(RAIZ, 'public/paginas');

/** Guarda a imagem da página para o painel de revisão (public/paginas/<encarte>/p<n>.jpg), mais leve. */
function salvarPagina(encarte: string, n: number, arq: string) {
  if (TESTE) return;
  mkdirSync(join(PAGINAS, encarte), { recursive: true });
  execFileSync('convert', [arq, '-resize', '1400x1400>', '-quality', '70', join(PAGINAS, encarte, `p${n}.jpg`)]);
}

/** Apaga as imagens de encartes vencidos (o painel só mostra encartes válidos). */
function limparPaginasVencidas() {
  if (!existsSync(PAGINAS)) return;
  for (const dir of readdirSync(PAGINAS)) {
    const cur = join(CURADORIA, `${dir}.json`);
    const fim = existsSync(cur) ? JSON.parse(readFileSync(cur, 'utf8')).encarteInfo?.fim : null;
    if (!fim || fim < hojeRio) {
      rmSync(join(PAGINAS, dir), { recursive: true, force: true });
      console.log(`  imagens de ${dir} apagadas (encarte vencido)`);
    }
  }
}

/**
 * Lê uma página reaproveitando leituras anteriores: se a MESMA imagem já foi lida (mesmo conteúdo, qualquer
 * encarte), usa o resultado guardado em data/leituras/<hash>.json e não gasta nada.
 */
async function lerComReaproveitamento(
  cliente: ReturnType<typeof criarCliente>,
  arq: string,
  contexto: string,
): Promise<{ itens: ItemLido[]; validade: { inicio: string; fim: string } | null; custo: number; reaproveitada: boolean; info: string }> {
  const img = readFileSync(arq);
  const hash = createHash('sha256').update(img).digest('hex').slice(0, 32);
  const cache = join(LEITURAS, `${hash}.json`);
  if (existsSync(cache)) {
    const c = JSON.parse(readFileSync(cache, 'utf8'));
    return { itens: c.itens, validade: c.validade ?? null, custo: 0, reaproveitada: true, info: `reaproveitada (lida antes por ${c.modelo})` };
  }
  const r = await lerPagina(cliente, img, 'image/jpeg', contexto, modelo);
  if (!TESTE) {
    mkdirSync(LEITURAS, { recursive: true });
    writeFileSync(cache, JSON.stringify({ modelo, lidaEm: hojeRio, validade: r.validade, itens: r.itens }, null, 1) + '\n');
  }
  return { itens: r.itens, validade: r.validade, custo: r.custoUS, reaproveitada: false, info: `${r.tokensEntrada} + ${r.tokensSaida} tokens · US$ ${r.custoUS.toFixed(4)}` };
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
  const idIA = `guanabara-ia-${validade.inicio}`;
  if (existe && !TESTE) {
    // Já lido; se ainda faltam as imagens das páginas para o painel de revisão, baixa só elas (sem IA, custo zero).
    if (existsSync(join(CURADORIA, `${idIA}.json`)) && !existsSync(join(PAGINAS, idIA))) {
      const pasta = mkdtempSync(join(tmpdir(), 'guanabara-'));
      try {
        const pdf = join(pasta, 'encarte.pdf');
        baixarArquivo(`${SITE_GUANABARA}/encarte/baixe`, pdf);
        for (const [i, arq] of paginasDoPdf(pdf, pasta).entries()) salvarPagina(idIA, i + 1, arq);
        console.log(`  imagens das páginas salvas para o painel de revisão`);
      } finally {
        rmSync(pasta, { recursive: true, force: true });
      }
    }
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
      salvarPagina(`guanabara-ia-${validade.inicio}`, i + 1, arq);
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
        // O servidor de imagens só entrega para acessos do Brasil (25/11: abre no celular do dono, 403 no GitHub).
        // Por isso o dono pode subir as imagens em data/recebidos/ com o nome original do link; se estiverem lá, usa elas.
        const recebida = join(RAIZ, 'data/recebidos', url.split('/').pop()!);
        if (existsSync(recebida)) copyFileSync(recebida, original);
        else baixarArquivo(url, original, { pagina: 'https://www.assai.com.br/ofertas/rio-de-janeiro' });
        // Mesmo tamanho das páginas do Guanabara (lado maior 1568 px): a IA lê bem e custa menos.
        execFileSync('convert', [original, '-resize', '1568x1568>', '-quality', '85', arq]);
        const r = await lerComReaproveitamento(cliente, arq, `Encarte do Assaí Atacadista (Rio de Janeiro), válido de ${e.inicio} a ${e.fim}, página ${i + 1} de ${e.paginas.length}. O app do Assaí se chama "Meu Assaí". Atacarejo: preços de atacado ("a partir de X unidades") são condição, não o preço normal.`);
        gasto += r.custo;
        salvarPagina(id, i + 1, arq);
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

/**
 * Dom Atacadista: lê do site a lista de lojas e os encartes de cada uma (imagens abertas, sem escudo).
 * Cada encarte novo é lido uma vez (vale para as lojas onde aparece). A validade vem do próprio encarte (IA).
 */
async function dom(cliente: ReturnType<typeof criarCliente>, gastoAte: number): Promise<number> {
  console.log('Dom Atacadista…');
  const lojas = listarLojasDom(baixar);
  const encartes = coletarEncartesDom(baixar, lojas);
  // Guarda a lista de lojas (o importador usa para o mapa).
  if (!TESTE) writeFileSync(join(RAIZ, 'data/brutos/dom-lojas.json'), JSON.stringify(lojas, null, 1) + '\n');
  console.log(`  ${lojas.length} lojas, ${encartes.length} encartes`);
  let gasto = gastoAte;
  for (const e of encartes) {
    const id = `dom-ia-${e.id}`;
    if (existsSync(join(CURADORIA, `${id}.json`)) && !TESTE) {
      console.log(`  ${e.id} ${e.descricao}: já lido`);
      continue;
    }
    const pasta = mkdtempSync(join(tmpdir(), 'dom-'));
    try {
      const itens: any[] = [];
      let validade: { inicio: string; fim: string } | null = null;
      const inicioGasto = gasto;
      let completo = true;
      const paginas = TESTE ? e.paginas.slice(0, 1) : e.paginas;
      for (const [i, url] of paginas.entries()) {
        if (gasto >= LIMITE_US) { console.log(`  ! parei: limite de gasto (US$ ${LIMITE_US})`); completo = false; break; }
        const original = join(pasta, `p${i + 1}-original`);
        const arq = join(pasta, `p${i + 1}.jpg`);
        baixarArquivo(url, original);
        execFileSync('convert', [original, '-resize', '1568x1568>', '-quality', '85', arq]);
        const r = await lerComReaproveitamento(
          cliente,
          arq,
          `Encarte "${e.descricao}" do Dom Atacadista (atacarejo do Rio de Janeiro), página ${i + 1} de ${e.paginas.length}. ` +
            'O app/clube se chama "Meu Dom". Preços de atacado ("a partir de X unidades") são condição, não o preço normal. ' +
            'A validade costuma estar impressa no encarte: devolva-a em "validade".',
        );
        gasto += r.custo;
        validade ??= r.validade;
        salvarPagina(id, i + 1, arq);
        console.log(`  ${e.id} ${e.descricao} página ${i + 1}: ${r.itens.length} ofertas · ${r.info}${r.validade ? ` · validade ${r.validade.inicio} a ${r.validade.fim}` : ''}`);
        for (const it of r.itens) itens.push({ pagina: i + 1, ...limpar(it) });
      }
      if (TESTE) {
        for (const it of itens.slice(0, 60)) console.log(`  ${it.nome} | ${it.marcas.join(', ')} | ${it.tamanho} | ${it.preco}${it.clube ? ` app ${it.clube}` : ''}${it.condicao ? ` | ${it.condicao}` : ''}${it.duvida ? ` | DÚVIDA: ${it.duvida}` : ''}`);
        console.log(`  validade lida: ${validade ? `${validade.inicio} a ${validade.fim}` : 'NÃO ENCONTRADA'}`);
        return gasto;
      }
      if (!completo) return gasto; // não salva encarte pela metade
      // Sem validade impressa: vale por 7 dias a partir de hoje e todas as ofertas ficam "a confirmar".
      const semValidade = !validade || !/^\d{4}-\d{2}-\d{2}$/.test(validade.inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(validade.fim);
      const inicio = semValidade ? hojeRio : validade!.inicio;
      const fim = semValidade ? new Date(Date.parse(hojeRio) + 6 * 86400000).toISOString().slice(0, 10) : validade!.fim;
      if (semValidade) for (const it of itens) it.duvida = it.duvida ?? 'validade não encontrada no encarte';
      const todas = e.lojas.length === lojas.length;
      const arquivo = {
        encarte: id,
        mercado: 'dom',
        programaClube: 'meu-dom',
        nomeClube: 'app Meu Dom',
        encarteInfo: {
          id, mercado: 'dom', titulo: e.descricao || 'Encarte Dom Atacadista', inicio, fim,
          lojas: todas ? [] : e.lojas.map((s) => lojas.find((l) => l.slug === s)?.nome ?? s),
          ...(todas ? {} : { lojasIds: e.lojas.map((s) => `dom-${s}`) }),
          fonte: `site do Dom Atacadista (imagens do encarte), lido por IA (${modelo}) em ${hojeRio}`,
        },
        observacao: `Lido por IA (${modelo}); custo aproximado US$ ${(gasto - inicioGasto).toFixed(2)}.${semValidade ? ' VALIDADE NÃO ENCONTRADA (7 dias).' : ''} Não revisado.`,
        itens,
      };
      writeFileSync(join(CURADORIA, `${id}.json`), JSON.stringify(arquivo, null, 1) + '\n');
      console.log(`  salvo data/curadoria/${id}.json (${itens.length} ofertas, ${inicio} a ${fim}, US$ ${(gasto - inicioGasto).toFixed(2)})`);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }
  return gasto;
}

/**
 * Redeconomia (associação de supermercados, WordPress sem escudo): o encarte fica na PÁGINA INICIAL como imagens
 * em /wp-content/uploads/AAAA/MM/Site-<página>-<edição>.jpg. Uma edição = um encarte; a validade vem da imagem (IA).
 */
async function redeconomia(cliente: ReturnType<typeof criarCliente>, gastoAte: number): Promise<number> {
  console.log('Redeconomia…');
  const html = baixar('https://www.redeconomia.com.br/');
  const imagens = [...new Set([...html.matchAll(/https:\/\/www\.redeconomia\.com\.br\/wp-content\/uploads\/(\d{4})\/(\d{2})\/Site-(\d+)-(\d+)\.(?:jpe?g|png)/gi)].map((m) => m[0]))];
  if (!imagens.length) throw new Error('não achei as imagens do encarte na página inicial (o site mudou?)');
  // Agrupa por edição (ano/mês + número final) e ordena pelas páginas.
  const edicoes = new Map<string, { pagina: number; url: string }[]>();
  for (const url of imagens) {
    const m = url.match(/uploads\/(\d{4})\/(\d{2})\/Site-(\d+)-(\d+)\./i)!;
    const chave = `${m[1]}-${m[2]}-${m[4]}`;
    edicoes.set(chave, [...(edicoes.get(chave) ?? []), { pagina: Number(m[3]), url }]);
  }
  let gasto = gastoAte;
  for (const [edicao, lista] of edicoes) {
    lista.sort((a, b) => a.pagina - b.pagina);
    const id = `redeconomia-ia-${edicao}`;
    if (existsSync(join(CURADORIA, `${id}.json`)) && !TESTE) { console.log(`  edição ${edicao}: já lida`); continue; }
    console.log(`  edição ${edicao}: ${lista.length} páginas`);
    const pasta = mkdtempSync(join(tmpdir(), 'redeconomia-'));
    try {
      const itens: any[] = [];
      let validade: { inicio: string; fim: string } | null = null;
      const inicioGasto = gasto;
      let completo = true;
      for (const [i, { url }] of (TESTE ? lista.slice(0, 1) : lista).entries()) {
        if (gasto >= LIMITE_US) { console.log(`  ! parei: limite de gasto (US$ ${LIMITE_US})`); completo = false; break; }
        const original = join(pasta, `p${i + 1}-original`);
        const arq = join(pasta, `p${i + 1}.jpg`);
        baixarArquivo(url, original);
        execFileSync('convert', [original, '-resize', '1568x1568>', '-quality', '85', arq]);
        const r = await lerComReaproveitamento(
          cliente,
          arq,
          `Encarte da Redeconomia (rede de supermercados do Rio de Janeiro), página ${i + 1} de ${lista.length}. ` +
            'O clube/cartão se chama "Clube Redeconomia". Se a página mostrar preço só para quem tem o cartão/clube, use soClube. ' +
            'A validade costuma estar impressa no encarte: devolva-a em "validade".',
        );
        gasto += r.custo;
        validade ??= r.validade;
        salvarPagina(id, i + 1, arq);
        console.log(`  página ${i + 1}: ${r.itens.length} ofertas · ${r.info}${r.validade ? ` · validade ${r.validade.inicio} a ${r.validade.fim}` : ''}`);
        for (const it of r.itens) itens.push({ pagina: i + 1, ...limpar(it) });
      }
      if (TESTE) {
        for (const it of itens.slice(0, 60)) console.log(`  ${it.nome} | ${it.marcas.join(', ')} | ${it.tamanho} | ${it.preco}${it.clube ? ` clube ${it.clube}` : ''}${it.soClube ? ' SÓ CLUBE' : ''}${it.condicao ? ` | ${it.condicao}` : ''}${it.duvida ? ` | DÚVIDA: ${it.duvida}` : ''}`);
        console.log(`  validade lida: ${validade ? `${validade.inicio} a ${validade.fim}` : 'NÃO ENCONTRADA'}`);
        return gasto;
      }
      if (!completo) return gasto;
      const semValidade = !validade || !/^\d{4}-\d{2}-\d{2}$/.test(validade.inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(validade.fim);
      const inicio = semValidade ? hojeRio : validade!.inicio;
      const fim = semValidade ? new Date(Date.parse(hojeRio) + 6 * 86400000).toISOString().slice(0, 10) : validade!.fim;
      if (semValidade) for (const it of itens) it.duvida = it.duvida ?? 'validade não encontrada no encarte';
      writeFileSync(join(CURADORIA, `${id}.json`), JSON.stringify({
        encarte: id, mercado: 'redeconomia', programaClube: 'clube-redeconomia', nomeClube: 'Clube Redeconomia',
        encarteInfo: { id, mercado: 'redeconomia', titulo: 'Encarte Redeconomia', inicio, fim, lojas: [], fonte: `página inicial do site da Redeconomia (imagens), lida por IA (${modelo}) em ${hojeRio}` },
        observacao: `Lido por IA (${modelo}); custo aproximado US$ ${(gasto - inicioGasto).toFixed(2)}.${semValidade ? ' VALIDADE NÃO ENCONTRADA (7 dias).' : ''} Não revisado.`,
        itens,
      }, null, 1) + '\n');
      console.log(`  salvo data/curadoria/${id}.json (${itens.length} ofertas, ${inicio} a ${fim})`);
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

limparPaginasVencidas();
const cliente = criarCliente();
let gasto = 0;
let falhas = 0;
// Assaí fica fora da passada automática: o servidor das imagens recusa o robô (bloqueio por país, 25/11).
const tarefas = process.argv.includes('--mundial')
  ? [compararMundial]
  : process.argv.includes('--assai')
    ? [assai]
    : process.argv.includes('--dom')
      ? [dom]
      : process.argv.includes('--redeconomia')
        ? [redeconomia]
        : [guanabara, dom];
for (const tarefa of tarefas) {
  try {
    gasto = await tarefa(cliente, gasto);
  } catch (e) {
    falhas++;
    console.error(`  ERRO (${tarefa.name}): ${(e as Error).message}`);
  }
}
console.log(`Gasto desta execução: ~US$ ${gasto.toFixed(3)} (modelo ${modelo})`);
if (falhas) process.exit(1);
