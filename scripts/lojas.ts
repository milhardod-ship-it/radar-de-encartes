// Monta data/lojas.json: as lojas físicas de cada rede no RJ, com coordenadas.
// As lojas mudam pouco: rode de vez em quando (npm run lojas), não precisa ir no robô diário.
//  - Guanabara: página /lojas (link do Google Maps de cada loja traz as coordenadas)
//  - Mundial: JSON da página /nossas-lojas
//  - Prezunic: consulta pública de pontos de retirada da loja online (VTEX), numa grade sobre o RJ
//  - Atacadão: API pública de folhetos (mesma do robô)
//  - Assaí: data/fontes/assai-lojas-rj.json (site com escudo anti-robô: lista enviada pelo dono, coordenadas aproximadas)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listarLojasComFolhetos } from '../src/coleta/atacadao';
import { criarBaixar } from '../src/coleta/http';
import { lerPageProps } from '../src/coleta/mundial';
import { acharBairro } from '../src/core/locais';
import type { Loja } from '../src/core/tipos';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const baixar = criarBaixar(1200);
const lojas: Loja[] = [];
const ent: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#039;': "'", '&nbsp;': ' ' };
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, (e) => ent[e] ?? e).replace(/\s+/g, ' ').trim();
const arred = (n: number) => Math.round(n * 1e5) / 1e5;

/** Coordenadas de um link do Google Maps: prefere o pino (!3d/!4d), depois ll=, depois @lat,lng. */
export function coordenadasDoLink(url: string): { lat: number; lon: number } | null {
  const pino = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (pino) return { lat: +pino[1], lon: +pino[2] };
  const ll = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (ll) return { lat: +ll[1], lon: +ll[2] };
  const arroba = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (arroba) return { lat: +arroba[1], lon: +arroba[2] };
  return null;
}

// ---------------------------------------------------------------- Guanabara
try {
  const html = baixar('https://www.supermercadosguanabara.com.br/lojas');
  const blocos = html.split('<div class="item item-list"').slice(1);
  for (const b of blocos) {
    const bruto = texto(b.match(/<h4[^>]*>([\s\S]*?)<\/h4>/)?.[1] ?? '');
    // "BANGU" → "Bangu"; "BARRA DA TIJUCA" → "Barra da Tijuca"
    const nome = bruto.toLowerCase().replace(/(^|\s)(\S)/g, (_m, e, l) => e + l.toUpperCase()).replace(/ (Da|De|Do|Das|Dos) /g, (m) => m.toLowerCase()).replace(/ Ii$/, ' II');
    const endereco = texto(b.match(/Endereço:<\/strong>\s*<p>([\s\S]*?)<\/p>/)?.[1] ?? '').replace(/\s*CEP:.*$/, '');
    const link = b.match(/href="(https:\/\/www\.google\.com\.br\/maps[^"]+)"/)?.[1] ?? '';
    const exata = coordenadasDoLink(link.replace(/&amp;/g, '&'));
    const aprox = exata ? null : acharBairro(nome);
    const c = exata ?? aprox;
    if (!c) {
      console.log(`  Guanabara: sem coordenada para "${nome}"`);
      continue;
    }
    lojas.push({
      id: `guanabara-${lojas.length + 1}`, mercado: 'guanabara', nome: nome || endereco, endereco, bairro: '', cidade: '',
      lat: arred(c.lat), lon: arred(c.lon), ...(aprox ? { aproximada: true } : {}),
    });
  }
  console.log(`Guanabara: ${lojas.filter((l) => l.mercado === 'guanabara').length} lojas`);
} catch (e) {
  console.error('Guanabara: ERRO', (e as Error).message);
}

// ---------------------------------------------------------------- Mundial
try {
  const props = lerPageProps(baixar('https://www.supermercadosmundial.com.br/nossas-lojas'));
  for (const s of props.stores ?? []) {
    if (s.latitude == null) continue;
    lojas.push({
      id: `mundial-${s.id}`, mercado: 'mundial', nome: String(s.name).trim(), endereco: String(s.address ?? '').trim(),
      bairro: String(s.neighborhood ?? '').trim(), cidade: 'Rio de Janeiro', lat: arred(+s.latitude), lon: arred(+s.longitude),
    });
  }
  console.log(`Mundial: ${lojas.filter((l) => l.mercado === 'mundial').length} lojas`);
} catch (e) {
  console.error('Mundial: ERRO', (e as Error).message);
}

// ---------------------------------------------------------------- Prezunic (grade de consultas sobre o RJ)
/** Lojas do Prezunic no RJ citadas nos encartes (nov/2026). */
const PREZUNIC_LOJAS_RJ = [
  'Recreio', 'Barra', 'Freguesia', 'Pechincha', 'Jauru', 'Ilha do Governador', 'Méier', 'Icaraí', 'Botafogo', 'Tijuca',
  'Park Shopping', 'Vila Isabel', 'Jardim Oceânico', 'Voluntários', 'Laranjeiras', 'Marapendi', 'Catumbi', 'Senador Camará',
  'Benfica', 'Engenho Novo', 'Campo Grande', 'Realengo', 'Caxias Centenário', 'Olaria', 'Vista Alegre', 'Cidade de Deus',
  'Caxias Centro', 'Campinho', 'Taquara', 'Itaoca', 'Nilópolis', 'Fonseca', 'Penha', 'Cachambi', 'Vilar dos Teles',
  'Padre Miguel', 'Santa Cruz', 'Maricá', 'Tingui',
];
try {
  const vistos = new Map<string, Loja>();
  for (let lat = -23.05; lat <= -22.45; lat += 0.1) {
    for (let lon = -43.75; lon <= -42.75; lon += 0.1) {
      const r = JSON.parse(baixar(`https://www.prezunic.com.br/api/checkout/pub/pickup-points?geoCoordinates=${lon.toFixed(2)};${lat.toFixed(2)}`));
      for (const it of r.items ?? []) {
        const p = it.pickupPoint;
        const codigo = String(p.id).split('_').pop()!.toUpperCase();
        if (vistos.has(codigo) || !p.address?.geoCoordinates) continue;
        const [plon, plat] = p.address.geoCoordinates;
        vistos.set(codigo, {
          id: `prezunic-${codigo}`, mercado: 'prezunic', nome: String(p.friendlyName).replace(/^Prezunic\s+/i, '').trim(),
          endereco: [p.address.street, p.address.number].filter(Boolean).join(', '),
          bairro: String(p.address.neighborhood ?? ''), cidade: String(p.address.city ?? ''), lat: arred(plat), lon: arred(plon),
        });
      }
    }
  }
  // A consulta só traz as lojas com "retire na loja". As outras vêm dos nomes citados nos encartes,
  // posicionadas no centro do bairro (aproximadas). Nome que não sabemos localizar fica de fora.
  const exatas = [...vistos.values()];
  const norm = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  for (const nome of PREZUNIC_LOJAS_RJ) {
    if (exatas.some((l) => norm(l.nome) === norm(nome) || norm(l.nome).startsWith(norm(nome) + ' '))) continue;
    const p = acharBairro(nome);
    if (!p) {
      console.log(`  Prezunic: sem coordenada para "${nome}"`);
      continue;
    }
    vistos.set(nome, { id: `prezunic-${norm(nome).replace(/\s+/g, '-')}`, mercado: 'prezunic', nome, endereco: '', bairro: nome, cidade: '', lat: p.lat, lon: p.lon, aproximada: true });
  }
  lojas.push(...[...vistos.values()].sort((a, b) => a.nome.localeCompare(b.nome)));
  console.log(`Prezunic: ${vistos.size} lojas (${exatas.length} com coordenada exata)`);
} catch (e) {
  console.error('Prezunic: ERRO', (e as Error).message);
}

// ---------------------------------------------------------------- Atacadão
try {
  const n0 = lojas.length;
  for (const s of listarLojasComFolhetos(baixar, 'RJ')) {
    if (!s.lat) continue;
    lojas.push({
      id: `atacadao-${s.storeId}`, mercado: 'atacadao', nome: String(s.loja).trim(),
      endereco: [s.endereco, s.numero].filter(Boolean).join(', '), bairro: String(s.bairro ?? '').trim(),
      cidade: String(s.cidade ?? '').trim(), lat: arred(+s.lat), lon: arred(+s.long),
    });
  }
  console.log(`Atacadão: ${lojas.length - n0} lojas`);
} catch (e) {
  console.error('Atacadão: ERRO', (e as Error).message);
}

// ---------------------------------------------------------------- Dom Atacadista (endereços do site; posição aproximada)
{
  const fonte = JSON.parse(readFileSync(join(RAIZ, 'data/fontes/dom-lojas-rj.json'), 'utf8'));
  for (const l of fonte.lojas) {
    lojas.push({ id: `dom-${l.slug}`, mercado: 'dom', nome: l.nome, endereco: l.endereco, bairro: l.nome, cidade: l.cidade, lat: l.lat, lon: l.lon, ...(l.precisao === 'endereço exato' ? {} : { aproximada: true }) });
  }
  console.log(`Dom: ${fonte.lojas.length} lojas (coordenadas de npm run geocodificar)`);
}

// ---------------------------------------------------------------- Assaí (lista fixa, sem robô)
{
  const fonte = JSON.parse(readFileSync(join(RAIZ, 'data/fontes/assai-lojas-rj.json'), 'utf8'));
  const n0 = lojas.length;
  for (const l of fonte.lojas) {
    if (l.lat == null) continue;
    lojas.push({ id: `assai-${l.loja_id}`, mercado: 'assai', nome: l.nome, endereco: '', bairro: l.nome, cidade: l.cidade, lat: l.lat, lon: l.lon, aproximada: true });
  }
  console.log(`Assaí: ${lojas.length - n0} lojas (posição aproximada)`);
}

writeFileSync(join(RAIZ, 'data/lojas.json'), JSON.stringify(lojas, null, 1) + '\n');
console.log(`Total: ${lojas.length} lojas → data/lojas.json`);
