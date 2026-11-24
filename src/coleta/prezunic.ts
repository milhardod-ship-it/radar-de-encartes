// Coleta do Prezunic: a página https://www.prezunic.com.br/encartes traz, no JSON da página (VTEX),
// a lista de encartes com estado (RJ/GO), validade e o PDF. Os PDFs (gerados pela Smarket) têm texto,
// mas sem dados estruturados: lemos cada produto pela POSIÇÃO das palavras (pdftotext -bbox).
// Em cada "caixinha": nome em maiúsculas em cima, detalhes em minúsculas, dois preços grandes
// (à esquerda o "de", à direita o "por") e "Limite por cliente…" embaixo.
import { execFileSync } from 'node:child_process';
import type { Baixar } from './http';

export const SITE_PREZUNIC = 'https://www.prezunic.com.br';

export interface EncartePrezunic {
  titulo: string;
  textoValidade: string;
  estado: string;
  pdf: string;
  inicio: string;
  fim: string;
  lojas: string[];
}

export interface ItemPrezunic {
  pagina: number;
  nome: string;
  detalhe: string;
  preco: number;
  precoDe: number | null;
  limite: string | null;
}

export interface ColetaPrezunic {
  fonte: 'prezunic-site';
  coletadoEm: string;
  encarte: EncartePrezunic;
  itens: ItemPrezunic[];
}

const dataLocal = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);

/** "Válidas de 24 a 25/11/2026" | "válidas de 03/11 a 30/11/2026" | "Válidas de 23/11/2026" */
export function lerTextoValidade(texto: string): { inicio: string; fim: string } | null {
  const t = texto.replace(/\s+/g, ' ');
  let m = t.match(/(\d{1,2})\/(\d{1,2}) a (\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { inicio: `${m[5]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, fim: `${m[5]}-${m[4].padStart(2, '0')}-${m[3].padStart(2, '0')}` };
  m = t.match(/(\d{1,2}) a (\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { inicio: `${m[4]}-${m[3].padStart(2, '0')}-${m[1].padStart(2, '0')}`, fim: `${m[4]}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}` };
  m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return { inicio: d, fim: d };
  }
  return null;
}

/** Lojas citadas no título ("… nas lojas: Recreio, Barra, … e Marapendi."). Vazio = todas as lojas do estado. */
export function lerLojasDoTitulo(titulo: string): string[] {
  const m = titulo.match(/lojas?:?\s+(.+)$/i);
  if (!m) return [];
  return m[1]
    .replace(/\.$/, '')
    .split(/,\s*|\s+e\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Lê a lista de encartes do JSON embutido na página /encartes. */
export function lerEncartesPrezunic(html: string): EncartePrezunic[] {
  const marca = '"content":{"encartes":[';
  const i = html.indexOf(marca);
  if (i < 0) throw new Error('Prezunic: lista de encartes não encontrada na página (o site mudou?)');
  let fim = i + marca.length - 1;
  for (let prof = 0; fim < html.length; fim++) {
    if (html[fim] === '[') prof++;
    else if (html[fim] === ']' && --prof === 0) break;
  }
  const lista = JSON.parse(html.slice(i + marca.length - 1, fim + 1)) as any[];
  return lista
    .filter((e) => e.active !== false && e.pdfUrl)
    .map((e) => {
      const titulo = String(e.title ?? '').replace(/\s+/g, ' ').trim();
      const textoValidade = String(e.validityText ?? '').trim();
      const v = lerTextoValidade(textoValidade);
      return {
        titulo,
        textoValidade,
        estado: String(e.state ?? ''),
        pdf: String(e.pdfUrl),
        inicio: v?.inicio ?? dataLocal(e.startAt),
        fim: v?.fim ?? dataLocal(e.endAt),
        lojas: lerLojasDoTitulo(titulo),
      };
    });
}

export function listarEncartesPrezunic(baixar: Baixar, estado = 'RJ'): EncartePrezunic[] {
  return lerEncartesPrezunic(baixar(`${SITE_PREZUNIC}/encartes`)).filter((e) => e.estado === estado);
}

// ---------------------------------------------------------------- leitura do PDF pela posição das palavras

interface Palavra {
  pagina: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: string;
}
const altura = (p: Palavra) => p.y1 - p.y0;
const centro = (p: { x0: number; x1: number }) => (p.x0 + p.x1) / 2;

/** Palavras com posição, a partir do HTML do `pdftotext -bbox-layout`. */
export function lerPalavras(bbox: string): Palavra[] {
  const palavras: Palavra[] = [];
  const paginas = bbox.split(/<page /).slice(1);
  paginas.forEach((pg, idx) => {
    for (const m of pg.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const t = m[5].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      palavras.push({ pagina: idx + 1, x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t });
    }
  });
  return palavras;
}

interface Preco {
  pagina: number;
  valor: number;
  x0: number;
  x1: number;
  y0: number;
}

/** Junta reais (número grande) e centavos (",99" grande ao lado) em preços. */
function acharPrecos(palavras: Palavra[], usadas: Set<Palavra>): Preco[] {
  // O tamanho da fonte muda de um encarte para outro: o preço é o maior número da página.
  // Referência = a altura mais comum entre os números "grandes" da página (empate: a maior).
  const contagem = new Map<number, Map<number, number>>();
  for (const p of palavras) {
    if (!/^\d{1,4},?(\d{2})?$/.test(p.t) || altura(p) < 15) continue;
    const h = Math.round(altura(p));
    const m = contagem.get(p.pagina) ?? new Map<number, number>();
    m.set(h, (m.get(h) ?? 0) + 1);
    contagem.set(p.pagina, m);
  }
  const maiorNumero = new Map<number, number>();
  for (const [pg, m] of contagem) maiorNumero.set(pg, [...m].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]);
  const ref = (p: Palavra) => maiorNumero.get(p.pagina) ?? 9999;
  const grandes = palavras.filter((p) => altura(p) >= 0.4 * ref(p));
  const inteiros = new Set(grandes.filter((p) => altura(p) >= 0.85 * ref(p) && altura(p) <= 1.3 * ref(p)));
  const precos: Preco[] = [];
  for (const p of grandes) {
    if (usadas.has(p) || !inteiros.has(p)) continue;
    const completo = p.t.match(/^(\d{1,4}),(\d{2})$/);
    if (completo) {
      precos.push({ pagina: p.pagina, valor: Number(`${completo[1]}.${completo[2]}`), x0: p.x0, x1: p.x1, y0: p.y0 });
      usadas.add(p);
      continue;
    }
    const inteiro = p.t.match(/^(\d{1,4}),?$/);
    if (!inteiro) continue;
    // centavos: palavra grande à direita, colada (até 45pt), na mesma faixa vertical
    const cent = grandes
      .filter((c) => !usadas.has(c) && c !== p && c.pagina === p.pagina && (/^,\d{2}$/.test(c.t.replace(/\s/g, '')) || (/^\d{2}$/.test(c.t) && p.t.endsWith(','))))
      .filter((c) => c.x0 >= p.x1 - 8 && c.x0 <= p.x1 + 45 && c.y1 > p.y0 - 15 && c.y0 < p.y1)
      .sort((a, b) => a.x0 - b.x0)[0];
    // centavos podem vir como "," e "99" separados
    let centavos: string | null = cent ? cent.t.replace(/[,\s]/g, '') : null;
    if (!cent) {
      const virgula = grandes.find((c) => c.pagina === p.pagina && c.t === ',' && c.x0 >= p.x1 - 8 && c.x0 <= p.x1 + 20 && c.y1 > p.y0 - 15 && c.y0 < p.y1);
      const dig = virgula && grandes.find((c) => c.pagina === p.pagina && /^\d{2}$/.test(c.t) && c.x0 >= virgula.x0 && c.x0 <= virgula.x1 + 25 && Math.abs(c.y0 - virgula.y0) < 15);
      if (dig) {
        centavos = dig.t;
        usadas.add(virgula!);
        usadas.add(dig);
      }
    } else usadas.add(cent);
    if (centavos === null) continue;
    usadas.add(p);
    precos.push({ pagina: p.pagina, valor: Number(`${inteiro[1]}.${centavos}`), x0: p.x0, x1: Math.max(p.x1, cent?.x1 ?? p.x1), y0: Math.min(p.y0, cent?.y0 ?? p.y0) });
  }
  return precos;
}

interface Linha {
  pagina: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  t: string;
  maiuscula: boolean;
}

/** Agrupa palavras pequenas em linhas (mesma altura na página e próximas na horizontal). */
function acharLinhas(palavras: Palavra[], usadas: Set<Palavra>): Linha[] {
  const maior = new Map<number, number>();
  for (const p of usadas) maior.set(p.pagina, Math.max(maior.get(p.pagina) ?? 0, altura(p)));
  const pequenas = palavras
    .filter((p) => !usadas.has(p) && p.t !== 'R$' && !(/^[\d,]+$/.test(p.t) && altura(p) >= 0.4 * (maior.get(p.pagina) ?? 999))).sort((a, b) => a.pagina - b.pagina || a.y0 - b.y0 || a.x0 - b.x0);
  const linhas: Linha[] = [];
  for (const p of pequenas) {
    const l = linhas.find((l) => l.pagina === p.pagina && Math.abs(l.y0 - p.y0) < 3 && p.x0 - l.x1 < 14 && p.x0 >= l.x0 - 2);
    if (l) {
      l.t += ` ${p.t}`;
      l.x1 = Math.max(l.x1, p.x1);
      l.y1 = Math.max(l.y1, p.y1);
    } else linhas.push({ pagina: p.pagina, x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1, t: p.t, maiuscula: false });
  }
  for (const l of linhas) {
    const letras = l.t.replace(/[^A-Za-zÀ-ÿ]/g, '');
    l.maiuscula = letras.length >= 2 && letras === letras.toUpperCase();
  }
  return linhas;
}

/** Lê os produtos de um encarte do Prezunic a partir da saída do `pdftotext -bbox-layout`. */
export function lerProdutosPrezunic(bbox: string): ItemPrezunic[] {
  const palavras = lerPalavras(bbox);
  const usadas = new Set<Palavra>();
  const precos = acharPrecos(palavras, usadas);
  const linhas = acharLinhas(palavras, usadas).filter((l) => !/^ofertas? (exclusivas|v[áa]lidas)/i.test(l.t));
  const itens: ItemPrezunic[] = [];

  // Nomes: linhas em maiúsculas. Cada preço pertence ao nome mais próximo ACIMA dele, na mesma coluna.
  const nomes = linhas.filter((l) => l.maiuscula && !/^R\$/.test(l.t));
  const grupos = new Map<Linha, Preco[]>();
  for (const pr of precos) {
    const candidatos = nomes.filter((n) => n.pagina === pr.pagina && n.y1 <= pr.y0 + 2 && pr.y0 - n.y1 < 260);
    let melhor: Linha | null = null;
    let melhorD = Infinity;
    for (const n of candidatos) {
      const dx = Math.abs(centro(n) - centro(pr));
      const larg = Math.max(n.x1 - n.x0, 120);
      if (dx > larg) continue;
      const d = (pr.y0 - n.y1) + dx * 0.6;
      if (d < melhorD) {
        melhorD = d;
        melhor = n;
      }
    }
    if (!melhor) continue;
    // sobe até a primeira linha do bloco do nome (nomes em 2–3 linhas)
    let topo = melhor;
    for (;;) {
      // linhas do nome se sobrepõem (fonte 18pt, espaçamento ~13,5pt): compara o início de cada linha
      const acima = nomes.find((n) => n.pagina === topo.pagina && n !== topo && n.y0 < topo.y0 - 5 && topo.y0 - n.y0 < 30 && Math.abs(centro(n) - centro(topo)) < 70);
      if (!acima) break;
      topo = acima;
    }
    const l = grupos.get(topo);
    if (l) l.push(pr);
    else grupos.set(topo, [pr]);
  }

  for (const [topo, prs] of grupos) {
    // linhas do bloco: do topo do nome até o preço, na mesma coluna
    const yPreco = Math.min(...prs.map((p) => p.y0));
    const doBloco = linhas
      .filter((l) => l.pagina === topo.pagina && l.y0 >= topo.y0 - 1 && l.y1 <= yPreco + 2 && Math.abs(centro(l) - centro(topo)) < 110)
      .sort((a, b) => a.y0 - b.y0);
    const nome = doBloco.filter((l) => l.maiuscula).map((l) => l.t).join(' ').replace(/\s+/g, ' ').trim();
    const detalhe = doBloco.filter((l) => !l.maiuscula).map((l) => l.t).join(' ').replace(/\s+/g, ' ').trim();
    const ordenados = [...prs].sort((a, b) => a.x0 - b.x0).slice(0, 2);
    const valores = ordenados.map((p) => p.valor);
    const preco = Math.min(...valores);
    const precoDe = valores.length === 2 && Math.max(...valores) > preco ? Math.max(...valores) : null;
    const xMin = Math.min(...ordenados.map((p) => p.x0));
    const xMax = Math.max(...ordenados.map((p) => p.x1));
    const limite = linhas.find(
      (l) => l.pagina === topo.pagina && /limite/i.test(l.t) && l.y0 > yPreco && l.y0 - yPreco < 110 && centro(l) > xMin - 30 && centro(l) < xMax + 30,
    );
    if (!nome) continue;
    itens.push({ pagina: topo.pagina, nome, detalhe, preco, precoDe, limite: limite ? limite.t : null });
  }
  return itens.sort((a, b) => a.pagina - b.pagina);
}

export function lerPdfPrezunic(caminhoPdf: string): ItemPrezunic[] {
  const bbox = execFileSync('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', caminhoPdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return lerProdutosPrezunic(bbox);
}
