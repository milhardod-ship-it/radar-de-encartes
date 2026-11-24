// Robô de coleta: busca as ofertas nos sites dos mercados e salva em data/brutos/.
// Uso:  npm run coletar               (todos)
//       npm run coletar -- guanabara  (só um)
// Depois rode `npm run importar` (o build já faz isso) para atualizar data/ofertas.json.
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coletarGuanabara } from '../src/coleta/guanabara';
import { criarBaixar } from '../src/coleta/http';
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

if (falhas) process.exit(1);
