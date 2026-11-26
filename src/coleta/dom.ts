// Dom Atacadista (domatacadista.net, site em Next.js, sem escudo anti-robô).
// /hub-encartes traz a lista de lojas; /encartes/lojas/<loja> traz os encartes da loja (imagens no DigitalOcean).
// Em 26/11/2026 as 26 lojas do RJ tinham exatamente os mesmos encartes; mesmo assim cada loja é conferida e
// cada encarte guarda em quais lojas aparece. A validade NÃO vem no site: está impressa no encarte (lida pela IA).
import type { Baixar } from './http';

export const SITE_DOM = 'https://domatacadista.net';

export interface LojaDom {
  id: string;
  nome: string;
  slug: string;
  endereco: string;
  bairro: string;
  cidade: string;
}

export interface EncarteDom {
  id: string;
  descricao: string;
  paginas: string[];
  /** Slugs das lojas onde o encarte aparece. */
  lojas: string[];
}

function pageProps(html: string): any {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('página do Dom sem __NEXT_DATA__ (o site mudou?)');
  return JSON.parse(m[1]).props?.pageProps ?? {};
}

export function listarLojasDom(baixar: Baixar): LojaDom[] {
  const lojas: any[] = pageProps(baixar(`${SITE_DOM}/hub-encartes`)).stores ?? [];
  return lojas.map((l) => ({
    id: String(l.id),
    nome: String(l.name).trim(),
    slug: String(l.store),
    endereco: String(l.address ?? '').trim(),
    bairro: String(l.neighborhood ?? '').trim(),
    cidade: String(l.city ?? '').trim(),
  }));
}

/** Encartes de todas as lojas, juntando os iguais (mesmo id e mesmas imagens). */
export function coletarEncartesDom(baixar: Baixar, lojas: LojaDom[]): EncarteDom[] {
  const porChave = new Map<string, EncarteDom>();
  for (const l of lojas) {
    const encartes: any[] = pageProps(baixar(`${SITE_DOM}/encartes/lojas/${encodeURIComponent(l.slug)}`)).store?.encartes ?? [];
    for (const e of encartes) {
      const paginas = [...(e.pages ?? [])].sort((a, b) => a.pageNumber - b.pageNumber).map((p) => String(p.url));
      const chave = `${e.id}|${paginas.join(',')}`;
      const atual = porChave.get(chave);
      if (atual) atual.lojas.push(l.slug);
      else porChave.set(chave, { id: String(e.id), descricao: String(e.description ?? '').trim(), paginas, lojas: [l.slug] });
    }
  }
  return [...porChave.values()];
}
