// Coordenadas das lojas do Dom Atacadista a partir do ENDEREÇO do site (que não traz coordenada), usando o
// Nominatim do OpenStreetMap (gratuito; regras: 1 consulta por segundo, robô identificado, citar a fonte).
// Roda no GitHub (workflow "Geocodificar lojas"); grava data/fontes/dom-lojas-rj.json e data/lojas.json.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const AGENTE = 'RadarDeEncartes/0.1 (https://github.com/milhardod-ship-it/radar-de-encartes)';
const dormir = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// O site às vezes põe o bairro no lugar da cidade.
const CIDADES: Record<string, string> = {
  angra: 'Angra dos Reis', bangu: 'Rio de Janeiro', 'campo grande': 'Rio de Janeiro', 'búzios': 'Armação dos Búzios',
};

function limparRua(endereco: string): { rua: string; numero: string } {
  let t = endereco.includes('|') ? endereco.split('|').pop()! : endereco;
  t = t.split(' - ')[0].replace(/\(.*?\)/g, '').trim();
  t = t
    .replace(/^Av\.?\s/i, 'Avenida ')
    .replace(/^Rod\.?\s/i, 'Rodovia ')
    .replace(/^Estr\.?\s/i, 'Estrada ')
    .replace(/^R\.\s/i, 'Rua ')
    .replace(/\bGen\.\s/i, 'General ')
    .replace(/\bCap\.\s/i, 'Capitão ');
  const m = t.match(/^(.*?),?\s*(\d[\d.]*)\s*\w?\b.*$/);
  if (!m) return { rua: t.replace(/,?\s*S\/?N.*$/i, '').trim(), numero: '' };
  return { rua: m[1].replace(/,$/, '').trim(), numero: m[2].replace(/\./g, '') };
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Consulta e só aceita resultado que esteja MESMO na cidade esperada (evita rua de mesmo nome em outra cidade). */
function consultar(params: Record<string, string>, cidade: string): any | null {
  const qs = new URLSearchParams({ ...params, country: 'Brasil', format: 'jsonv2', limit: '5', addressdetails: '1' }).toString();
  let lista: any = null;
  for (let tentativa = 1; tentativa <= 3 && !Array.isArray(lista); tentativa++) {
    dormir(1500 * tentativa);
    try {
      lista = JSON.parse(execFileSync('curl', ['-sS', '-m', '30', '-A', AGENTE, `https://nominatim.openstreetmap.org/search?${qs}`]).toString());
    } catch {
      lista = null;
    }
  }
  if (!Array.isArray(lista)) return null;
  const alvo = semAcento(cidade);
  return (lista as any[]).find((r) => {
    const a = r.address ?? {};
    return [a.city, a.town, a.municipality, a.village, a.city_district].some((c) => c && semAcento(c) === alvo);
  }) ?? null;
}

const fonte = JSON.parse(readFileSync(join(RAIZ, 'data/fontes/dom-lojas-rj.json'), 'utf8'));
const doSite: any[] = JSON.parse(readFileSync(join(RAIZ, 'data/brutos/dom-lojas.json'), 'utf8'));
for (const s of doSite) {
  const cidade = CIDADES[s.cidade.toLowerCase()] ?? s.cidade.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_: string, e: string, c: string) => e + c.toUpperCase()).replace(/ (De|Da|Do|Dos) /g, (m: string) => m.toLowerCase());
  const { rua, numero } = limparRua(s.endereco);
  // Sem o número, o centro do BAIRRO é mais confiável que um ponto qualquer da rua (avenidas longas, como a Av. Brasil).
  const tentativas: [string, Record<string, string>][] = [
    ...(numero ? [['endereço exato', { street: `${numero} ${rua}`, city: cidade, state: 'Rio de Janeiro' }] as [string, Record<string, string>]] : []),
    ['bairro', { q: `${s.bairro}, ${cidade}, Rio de Janeiro` }],
    ['rua', { street: rua, city: cidade, state: 'Rio de Janeiro' }],
  ];
  // O número na rua nem sempre está certo no mapa (ex.: Av. Brasil, 32238 caía em Santa Cruz, não em Bangu).
  // Então o endereço exato só vale se ficar a até 3 km do centro do bairro informado pelo site.
  const ponto = (r: any) => ({ lat: Number(Number(r.lat).toFixed(5)), lon: Number(Number(r.lon).toFixed(5)) });
  const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos((a.lat * Math.PI) / 180));
  const rBairro = consultar(tentativas.find(([p]) => p === 'bairro')![1], cidade);
  const bairro = rBairro ? ponto(rBairro) : null;
  let achou: { lat: number; lon: number; precisao: string } | null = null;
  for (const [precisao, p] of tentativas) {
    const r = precisao === 'bairro' ? rBairro : consultar(p, cidade);
    if (!r) continue;
    const pt = ponto(r);
    if (precisao !== 'bairro' && bairro && km(pt, bairro) > 3) {
      console.log(`  (${s.nome}: ${precisao} caiu a ${km(pt, bairro).toFixed(1)} km do bairro; descartado)`);
      continue;
    }
    achou = { ...pt, precisao };
    break;
  }
  const l = fonte.lojas.find((x: any) => x.slug === s.slug);
  const registro = { slug: s.slug, nome: l?.nome ?? s.nome, endereco: `${s.endereco}${s.bairro ? ` - ${s.bairro}` : ''}`, cidade };
  if (achou) Object.assign(registro, { lat: achou.lat, lon: achou.lon, precisao: achou.precisao });
  else Object.assign(registro, { lat: l?.lat, lon: l?.lon, precisao: 'aproximada à mão' });
  if (l) Object.assign(l, registro);
  else fonte.lojas.push(registro);
  console.log(`${s.nome}: ${(registro as any).precisao} → ${(registro as any).lat}, ${(registro as any).lon}  (${rua} ${numero}, ${cidade})`);
}
fonte.fonte = 'Lojas e endereços do site do Dom Atacadista; coordenadas pelo endereço via OpenStreetMap/Nominatim (© colaboradores do OpenStreetMap). "precisao" diz se achou o número, só a rua ou só o bairro.';
writeFileSync(join(RAIZ, 'data/fontes/dom-lojas-rj.json'), JSON.stringify(fonte, null, 1) + '\n');

// Atualiza as lojas do Dom em data/lojas.json (sem refazer as outras redes).
const lojas: any[] = JSON.parse(readFileSync(join(RAIZ, 'data/lojas.json'), 'utf8')).filter((x: any) => x.mercado !== 'dom');
for (const l of fonte.lojas) {
  lojas.push({
    id: `dom-${l.slug}`, mercado: 'dom', nome: l.nome, endereco: l.endereco, bairro: l.nome, cidade: l.cidade, lat: l.lat, lon: l.lon,
    ...(l.precisao === 'endereço exato' ? {} : { aproximada: true }),
  });
}
writeFileSync(join(RAIZ, 'data/lojas.json'), JSON.stringify(lojas, null, 1) + '\n');
