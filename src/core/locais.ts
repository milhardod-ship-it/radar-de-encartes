import { normalizar } from './texto';
import type { Encarte, Loja, MercadoId, Oferta } from './tipos';

export interface Ponto {
  lat: number;
  lon: number;
}

/**
 * Centro APROXIMADO de bairros e cidades do Grande Rio. Serve para:
 *  - o usuário escolher onde está sem usar o GPS;
 *  - posicionar lojas cuja coordenada exata não é publicada (marcadas como aproximadas).
 * Precisão de 1–3 km: suficiente para "lojas a até X km".
 */
export const BAIRROS: Record<string, Ponto> = {
  'Barra da Tijuca': { lat: -23.0, lon: -43.365 },
  Bangu: { lat: -22.876, lon: -43.465 },
  Benfica: { lat: -22.889, lon: -43.236 },
  Bonsucesso: { lat: -22.866, lon: -43.255 },
  Botafogo: { lat: -22.951, lon: -43.183 },
  Cachambi: { lat: -22.889, lon: -43.276 },
  'Campo Grande': { lat: -22.904, lon: -43.562 },
  Campinho: { lat: -22.883, lon: -43.346 },
  Cascadura: { lat: -22.882, lon: -43.33 },
  Catumbi: { lat: -22.915, lon: -43.2 },
  Centro: { lat: -22.903, lon: -43.176 },
  Copacabana: { lat: -22.971, lon: -43.186 },
  Flamengo: { lat: -22.933, lon: -43.176 },
  'Freguesia (Jacarepaguá)': { lat: -22.938, lon: -43.341 },
  Grajaú: { lat: -22.921, lon: -43.264 },
  'Ilha do Governador': { lat: -22.805, lon: -43.205 },
  Ipanema: { lat: -22.984, lon: -43.205 },
  Irajá: { lat: -22.832, lon: -43.326 },
  'Jardim Oceânico': { lat: -23.01, lon: -43.311 },
  Laranjeiras: { lat: -22.937, lon: -43.191 },
  Leblon: { lat: -22.984, lon: -43.224 },
  Madureira: { lat: -22.873, lon: -43.338 },
  Maracanã: { lat: -22.912, lon: -43.229 },
  Méier: { lat: -22.902, lon: -43.279 },
  Olaria: { lat: -22.846, lon: -43.264 },
  'Padre Miguel': { lat: -22.879, lon: -43.448 },
  Pavuna: { lat: -22.807, lon: -43.356 },
  Pechincha: { lat: -22.93, lon: -43.355 },
  Penha: { lat: -22.84, lon: -43.28 },
  Ramos: { lat: -22.851, lon: -43.25 },
  Realengo: { lat: -22.879, lon: -43.43 },
  Recreio: { lat: -23.018, lon: -43.468 },
  'Santa Cruz': { lat: -22.918, lon: -43.686 },
  'Senador Camará': { lat: -22.866, lon: -43.497 },
  Tanque: { lat: -22.914, lon: -43.375 },
  Taquara: { lat: -22.922, lon: -43.373 },
  Tijuca: { lat: -22.925, lon: -43.235 },
  'Vicente de Carvalho': { lat: -22.851, lon: -43.311 },
  'Vila Isabel': { lat: -22.916, lon: -43.246 },
  'Vista Alegre': { lat: -22.829, lon: -43.313 },
  'Voluntários da Pátria (Botafogo)': { lat: -22.953, lon: -43.19 },
  'Belford Roxo': { lat: -22.764, lon: -43.4 },
  'Duque de Caxias': { lat: -22.786, lon: -43.311 },
  Icaraí: { lat: -22.905, lon: -43.105 },
  Itaboraí: { lat: -22.744, lon: -42.859 },
  Maricá: { lat: -22.919, lon: -42.818 },
  Mesquita: { lat: -22.783, lon: -43.432 },
  'Niterói (Centro)': { lat: -22.893, lon: -43.124 },
  Nilópolis: { lat: -22.808, lon: -43.414 },
  'Nova Iguaçu': { lat: -22.759, lon: -43.451 },
  Petrópolis: { lat: -22.505, lon: -43.178 },
  'São Gonçalo': { lat: -22.827, lon: -43.054 },
  'São João de Meriti': { lat: -22.804, lon: -43.372 },
  'Vilar dos Teles': { lat: -22.786, lon: -43.36 },
  'Caxias Centro': { lat: -22.786, lon: -43.311 },
};

/** Acha um bairro da tabela pelo nome (sem acento, aceitando o começo: "Freguesia" → "Freguesia (Jacarepaguá)"). */
export function acharBairro(nome: string): Ponto | null {
  const n = normalizar(nome);
  if (!n) return null;
  for (const [b, p] of Object.entries(BAIRROS)) if (normalizar(b) === n) return p;
  for (const [b, p] of Object.entries(BAIRROS)) if (normalizar(b).startsWith(n + ' ') || normalizar(b).startsWith(n)) return p;
  return null;
}

/** Distância em km entre dois pontos (fórmula de haversine). */
export function distanciaKm(a: Ponto, b: Ponto): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export interface LojaPerto {
  loja: Loja;
  km: number;
}

/**
 * Lojas onde o encarte vale. Lista vazia no encarte = todas as lojas da rede.
 * Devolve null quando não conhecemos nenhuma loja da rede (aí não dá para filtrar).
 */
export function lojasDoEncarte(encarte: Encarte, lojas: Loja[]): Loja[] | null {
  const daRede = lojas.filter((l) => l.mercado === encarte.mercado);
  if (daRede.length === 0) return null;
  if (encarte.lojasIds && encarte.lojasIds.length) {
    const ids = new Set(encarte.lojasIds);
    const achadas = daRede.filter((l) => ids.has(l.id));
    return achadas.length ? achadas : null;
  }
  return encarte.lojas.length === 0 ? daRede : null;
}

/** Loja mais próxima de `ponto` entre as lojas onde o encarte vale. */
export function lojaMaisPerto(encarte: Encarte, lojas: Loja[], ponto: Ponto): LojaPerto | null {
  const candidatas = lojasDoEncarte(encarte, lojas);
  if (!candidatas) return null;
  let melhor: LojaPerto | null = null;
  for (const l of candidatas) {
    const km = distanciaKm(ponto, l);
    if (!melhor || km < melhor.km) melhor = { loja: l, km };
  }
  return melhor;
}

/**
 * O encarte vale para quem está em `ponto` com raio `raioKm`?
 * Se não sabemos as lojas do encarte, não escondemos (melhor mostrar do que sumir com uma oferta válida).
 */
export function encarteValePerto(encarte: Encarte, lojas: Loja[], ponto: Ponto, raioKm: number): boolean {
  const perto = lojaMaisPerto(encarte, lojas, ponto);
  if (!perto) return lojasDoEncarte(encarte, lojas) === null;
  return perto.km <= raioKm;
}

/** Filtra as ofertas pelos encartes que valem perto do usuário. */
export function ofertasPerto(ofertas: Oferta[], encartes: Map<string, Encarte>, lojas: Loja[], ponto: Ponto, raioKm: number): Oferta[] {
  const cache = new Map<string, boolean>();
  return ofertas.filter((o) => {
    let v = cache.get(o.encarte);
    if (v === undefined) {
      const e = encartes.get(o.encarte);
      v = e ? encarteValePerto(e, lojas, ponto, raioKm) : true;
      cache.set(o.encarte, v);
    }
    return v;
  });
}

/** Liga nomes de lojas citados num encarte ("Barra", "Caxias Centro") aos ids de data/lojas.json. */
export function idsDasLojas(nomes: string[], lojas: Loja[], mercado: MercadoId): string[] {
  const daRede = lojas.filter((l) => l.mercado === mercado);
  const ids: string[] = [];
  for (const nome of nomes) {
    const n = normalizar(nome);
    const loja =
      daRede.find((l) => normalizar(l.nome) === n) ??
      daRede.find((l) => normalizar(l.nome).startsWith(n + ' ')) ??
      daRede.find((l) => n.startsWith(normalizar(l.nome) + ' ')) ??
      daRede.find((l) => normalizar(`${l.cidade} ${l.nome}`) === n || normalizar(`${l.cidade} (${l.nome})`) === n);
    if (loja) ids.push(loja.id);
  }
  return ids;
}

export function formatarKm(km: number, aproximada = false): string {
  if (km < 1) return aproximada ? 'perto (~1 km)' : 'menos de 1 km';
  const t = km < 10 ? km.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : Math.round(km).toString();
  return `${aproximada ? '~' : ''}${t} km`;
}
