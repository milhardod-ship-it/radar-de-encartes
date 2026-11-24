// Coleta do Guanabara: o site publica as ofertas do encarte em texto, por categoria
// (https://www.supermercadosguanabara.com.br/produtos/<id>). O clube (Guana Clube) exige login: não coletamos.
import type { Baixar } from './http';

export const SITE_GUANABARA = 'https://www.supermercadosguanabara.com.br';

export const CATEGORIAS_GUANABARA: Record<string, string> = {
  '2': 'Cereais e farináceos',
  '12': 'Matinais e padaria',
  '22': 'Massas',
  '32': 'Biscoitos',
  '42': 'Açougue',
  '52': 'Embutidos',
  '62': 'Frios e laticínios',
  '72': 'Carnes salgadas',
  '82': 'Bebidas',
  '92': 'Conservas',
  '102': 'Limpeza',
  '112': 'Higiene pessoal',
  '152': 'Chocolates e bombons',
  '203': 'Cantinho do bebê',
};

export interface ItemGuanabara {
  categoria: string;
  nome: string;
  /** Preço como aparece ("28,95"). */
  preco: string;
  /** Texto depois do preço ("cada"), se houver. */
  sufixo: string;
  imagem: string | null;
}

export interface ColetaGuanabara {
  fonte: 'guanabara-site';
  coletadoEm: string;
  /** Validade da LISTA de produtos (não da página do encarte, que pode já estar na semana seguinte). */
  inicio: string;
  fim: string;
  /** Validade anunciada na página /encarte no momento da coleta (só para conferência). */
  encarteDoSite: { inicio: string; fim: string } | null;
  itens: ItemGuanabara[];
}

const entidades: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&#039;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
function texto(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, (e) => entidades[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lê os produtos de uma página de categoria. */
export function lerCategoriaGuanabara(html: string, categoria: string): ItemGuanabara[] {
  const itens: ItemGuanabara[] = [];
  const re = /<div class="col item">([\s\S]*?)<div class="name">([\s\S]*?)<\/div>/g;
  for (const m of html.matchAll(re)) {
    const bloco = m[1];
    const preco = bloco.match(/<span class="number">([^<]*)<\/span>\s*([^<]*)</);
    if (!preco) continue;
    const img = bloco.match(/url\('([^']+)'\)/);
    itens.push({
      categoria,
      nome: texto(m[2]),
      preco: texto(preco[1]),
      sufixo: texto(preco[2]),
      imagem: img ? (img[1].startsWith('//') ? `https:${img[1]}` : img[1]).replace(':443/', '/') : null,
    });
  }
  return itens;
}

/** "Validade: 23/11/2026" que aparece em cada página de categoria. */
export function lerValidadeCategoria(html: string): string | null {
  const m = texto(html).match(/Validade:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Validade do encarte: "Promoção válida de 18/11/2026 até 23/11/2026". */
export function lerValidadeGuanabara(html: string): { inicio: string; fim: string } | null {
  const m = texto(html).match(/v[áa]lida de (\d{2})\/(\d{2})\/(\d{4}) at[ée] (\d{2})\/(\d{2})\/(\d{4})/i);
  if (!m) return null;
  return { inicio: `${m[3]}-${m[2]}-${m[1]}`, fim: `${m[6]}-${m[5]}-${m[4]}` };
}

/**
 * Coleta a lista do site. Atenção: a página /encarte e a lista /produtos não mudam juntas
 * (em 23/11 à noite o encarte já dizia 24–25/11 e a lista ainda era a da semana anterior,
 * válida até 23/11). Por isso o fim vem da LISTA; o início vem do encarte só se o fim bater,
 * senão usamos a data da coleta (sabemos apenas que a lista vale de hoje até o fim dela).
 */
export function coletarGuanabara(baixar: Baixar, agora = new Date()): ColetaGuanabara | { vencidaAte: string } {
  const encarteDoSite = lerValidadeGuanabara(baixar(`${SITE_GUANABARA}/encarte`));
  const itens: ItemGuanabara[] = [];
  const fins = new Map<string, number>();
  for (const [id, nome] of Object.entries(CATEGORIAS_GUANABARA)) {
    const html = baixar(`${SITE_GUANABARA}/produtos/${id}`);
    const lidos = lerCategoriaGuanabara(html, nome);
    const fim = lerValidadeCategoria(html);
    if (fim && lidos.length) fins.set(fim, (fins.get(fim) ?? 0) + lidos.length);
    itens.push(...lidos);
  }
  if (itens.length === 0) throw new Error('Guanabara: nenhuma oferta encontrada (o site mudou?)');
  if (fins.size === 0) throw new Error('Guanabara: não achei a validade ("Validade: dd/mm/aaaa") na lista de produtos');
  const fim = [...fins].sort((a, b) => b[1] - a[1])[0][0];
  const hojeRio = new Date(agora.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  if (fim < hojeRio) return { vencidaAte: fim }; // o site ainda não trocou a lista: nada novo
  const inicio = encarteDoSite && encarteDoSite.fim === fim ? encarteDoSite.inicio : hojeRio;
  return { fonte: 'guanabara-site', coletadoEm: agora.toISOString(), inicio, fim, encarteDoSite, itens };
}
