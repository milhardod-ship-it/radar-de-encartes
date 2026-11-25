// Lê com IA os encartes que só existem como IMAGEM e salva em data/curadoria/ (mesmo formato da leitura manual).
// Roda no GitHub (workflow "Ler encartes com IA"), usando o segredo ANTHROPIC_API_KEY.
//   npm run ler-encartes            → lê o encarte atual do Guanabara (se ainda não foi lido)
//   npm run ler-encartes -- --teste → lê só a 1ª página, mostra o resultado e o custo, não salva nada
// Trava de gasto: para quando a execução passa de LIMITE_US (padrão US$ 1,00).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lerValidadeGuanabara, SITE_GUANABARA } from '../src/coleta/guanabara';
import { baixarArquivo, criarBaixar } from '../src/coleta/http';
import { criarCliente, lerPagina, MODELO_PADRAO } from '../src/coleta/leitorIA';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CURADORIA = join(RAIZ, 'data/curadoria');
const TESTE = process.argv.includes('--teste');
const LIMITE_US = Number(process.env.LIMITE_US || 1);
const modelo = process.env.LEITOR_MODELO || MODELO_PADRAO;
const baixar = criarBaixar();
const hojeRio = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

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
      const r = await lerPagina(
        cliente,
        readFileSync(arq),
        'image/jpeg',
        `Encarte do Supermercados Guanabara (Rio de Janeiro), página ${i + 1} de ${paginas.length}. O clube de vantagens se chama "Guana Clube".`,
        modelo,
      );
      gasto += r.custoUS;
      console.log(`  página ${i + 1}: ${r.itens.length} ofertas · ${r.tokensEntrada} + ${r.tokensSaida} tokens · US$ ${r.custoUS.toFixed(4)}`);
      for (const it of r.itens) itens.push({ pagina: i + 1, ...limpar(it) });
    }
    if (TESTE) {
      console.log('  --- amostra (teste, nada foi salvo) ---');
      for (const it of itens.slice(0, 25)) console.log(`  ${it.nome} | ${it.marcas.join(', ')} | ${it.tamanho} | ${it.preco}${it.de ? ` (de ${it.de})` : ''}${it.clube ? ` clube ${it.clube}` : ''}${it.soClube ? ' SÓ CLUBE' : ''}${it.condicao ? ` | ${it.condicao}` : ''}${it.duvida ? ` | DÚVIDA: ${it.duvida}` : ''}`);
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

const cliente = criarCliente();
let gasto = 0;
let falhas = 0;
try {
  gasto = await guanabara(cliente, gasto);
} catch (e) {
  falhas++;
  console.error(`  ERRO: ${(e as Error).message}`);
}
console.log(`Gasto desta execução: ~US$ ${gasto.toFixed(3)} (modelo ${modelo})`);
if (falhas) process.exit(1);
