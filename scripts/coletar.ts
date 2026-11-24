// Robô de coleta: busca as ofertas nos sites dos mercados e salva em data/brutos/.
// Uso:  npm run coletar               (todos)
//       npm run coletar -- guanabara  (só um)
// Depois rode `npm run importar` (o build já faz isso) para atualizar data/ofertas.json.
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agruparFolhetos, lerPdfDoFolheto, listarLojasComFolhetos, type ColetaAtacadao } from '../src/coleta/atacadao';
import { coletarGuanabara } from '../src/coleta/guanabara';
import { lerPdfPrezunic, listarEncartesPrezunic, type ColetaPrezunic } from '../src/coleta/prezunic';
import { baixarArquivo, criarBaixar } from '../src/coleta/http';
import { coletarMundial } from '../src/coleta/mundial';

const BRUTOS = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'brutos');
const pedidos = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const quer = (m: string) => pedidos.length === 0 || pedidos.includes(m);
const baixar = criarBaixar();
// Data no Rio (UTC−3): às 21h30 de 23/11 no Rio já é 24/11 em UTC.
const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
let falhas = 0;

function salvar(nome: string, dados: unknown) {
  writeFileSync(join(BRUTOS, nome), JSON.stringify(dados, null, 1) + '\n');
  console.log(`  salvo data/brutos/${nome}`);
}

if (quer('guanabara')) {
  try {
    console.log('Guanabara…');
    const r = coletarGuanabara(baixar);
    if ('vencidaAte' in r) {
      console.log(`  a lista do site ainda é a antiga (válida até ${r.vencidaAte}); nada novo por enquanto`);
      throw null;
    }
    const c = r;
    console.log(`  ${c.itens.length} ofertas, válidas de ${c.inicio} a ${c.fim}`);
    if (c.encarteDoSite && c.encarteDoSite.fim !== c.fim)
      console.log(`  (a página do encarte já anuncia ${c.encarteDoSite.inicio} a ${c.encarteDoSite.fim}; a lista ainda não foi trocada)`);
    // Um arquivo por lista (pela data final): coletar de novo a mesma lista só atualiza o arquivo.
    const nome = `guanabara-site-ate-${c.fim}.json`;
    if (existsSync(join(BRUTOS, nome))) {
      // Mesma lista coletada antes: mantém o início mais antigo que já conhecíamos.
      const antes = JSON.parse(readFileSync(join(BRUTOS, nome), 'utf8')) as { inicio?: string };
      if (antes.inicio && antes.inicio < c.inicio) c.inicio = antes.inicio;
    }
    salvar(nome, c);
  } catch (e) {
    if (e !== null) {
      falhas++;
      console.error(`  ERRO: ${(e as Error).message}`);
    }
  }
}

if (quer('mundial')) {
  try {
    console.log('Mundial…');
    const c = coletarMundial(baixar);
    console.log(`  ${c.ofertas.length} ofertas; encartes: ${c.encartes.map((e) => e.descricao).join(' | ')}`);
    // A lista do Mundial é o retrato do momento: fica só a coleta mais recente.
    for (const f of readdirSync(BRUTOS)) if (f.startsWith('mundial-site-')) unlinkSync(join(BRUTOS, f));
    salvar(`mundial-site-${hoje}.json`, c);
  } catch (e) {
    falhas++;
    console.error(`  ERRO: ${(e as Error).message}`);
  }
}

if (quer('atacadao')) {
  try {
    console.log('Atacadão…');
    const lojas = listarLojasComFolhetos(baixar, 'RJ');
    const folhetos = agruparFolhetos(lojas).filter((f) => f.fim >= hoje);
    console.log(`  ${lojas.length} lojas no RJ; ${folhetos.length} folhetos valendo`);
    for (const f of folhetos) {
      const nome = `atacadao-folheto-${f.id}.json`;
      const caminho = join(BRUTOS, nome);
      let coleta: ColetaAtacadao;
      if (existsSync(caminho)) {
        // Folheto já lido: o PDF não muda; só atualiza a lista de lojas.
        coleta = JSON.parse(readFileSync(caminho, 'utf8'));
        coleta.folheto = f;
      } else {
        const pdf = join(tmpdir(), `atacadao-${f.id}.pdf`);
        baixarArquivo(f.url, pdf);
        const dados = lerPdfDoFolheto(pdf);
        unlinkSync(pdf);
        if (!dados) console.log(`  ! "${f.nome}" (${f.id}) não tem dados embutidos: vai precisar do leitor por IA`);
        coleta = { fonte: 'atacadao-api', coletadoEm: new Date().toISOString(), folheto: f, documento: dados?.documento ?? '', paginas: dados?.paginas ?? [] };
      }
      const n = coleta.paginas.reduce((t, p) => t + p.itens.length, 0);
      console.log(`  "${f.nome}" ${f.inicio} a ${f.fim}: ${n} ofertas, ${f.lojas.length} lojas`);
      salvar(nome, coleta);
    }
    // Remove folhetos vencidos há mais de 14 dias.
    const limite = new Date(Date.now() - 3 * 3600 * 1000 - 14 * 86400000).toISOString().slice(0, 10);
    for (const arq of readdirSync(BRUTOS).filter((a) => a.startsWith('atacadao-folheto-'))) {
      const c = JSON.parse(readFileSync(join(BRUTOS, arq), 'utf8')) as ColetaAtacadao;
      if (c.folheto.fim < limite) unlinkSync(join(BRUTOS, arq));
    }
  } catch (e) {
    falhas++;
    console.error(`  ERRO: ${(e as Error).message}`);
  }
}

if (quer('prezunic')) {
  try {
    console.log('Prezunic…');
    const encartes = listarEncartesPrezunic(baixar, 'RJ').filter((e) => e.fim >= hoje);
    console.log(`  ${encartes.length} encartes do RJ valendo`);
    for (const e of encartes) {
      const id = (e.pdf.split('/').pop() ?? '').split('___')[0].slice(0, 13) || String(Date.now());
      const nome = `prezunic-encarte-${id}.json`;
      const caminho = join(BRUTOS, nome);
      let coleta: ColetaPrezunic;
      if (existsSync(caminho)) {
        coleta = JSON.parse(readFileSync(caminho, 'utf8'));
        coleta.encarte = e; // o PDF não muda; atualiza título, validade e lojas
      } else {
        const pdf = join(tmpdir(), `prezunic-${id}.pdf`);
        baixarArquivo(e.pdf, pdf);
        const itens = lerPdfPrezunic(pdf);
        unlinkSync(pdf);
        if (itens.length === 0) console.log(`  ! "${e.titulo}": nenhum produto lido (layout novo? talvez precise do leitor por IA)`);
        coleta = { fonte: 'prezunic-site', coletadoEm: new Date().toISOString(), encarte: e, itens };
      }
      console.log(`  "${e.titulo.slice(0, 60)}" ${e.inicio} a ${e.fim}: ${coleta.itens.length} ofertas`);
      salvar(nome, coleta);
    }
    const limite = new Date(Date.now() - 3 * 3600 * 1000 - 14 * 86400000).toISOString().slice(0, 10);
    for (const arq of readdirSync(BRUTOS).filter((a) => a.startsWith('prezunic-encarte-'))) {
      const c = JSON.parse(readFileSync(join(BRUTOS, arq), 'utf8')) as ColetaPrezunic;
      if (c.encarte.fim < limite) unlinkSync(join(BRUTOS, arq));
    }
  } catch (e) {
    falhas++;
    console.error(`  ERRO: ${(e as Error).message}`);
  }
}

if (falhas) process.exit(1);
