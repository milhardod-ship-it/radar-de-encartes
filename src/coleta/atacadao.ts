// Coleta do Atacadão: a página "Folhetos" do site usa uma API pública do grupo Carrefour
// (apigw.cloud.carrefour.com.br/api-middleware-flyer-services) que lista as lojas de cada cidade e
// os folhetos (PDF) de cada loja. Os PDFs do Atacadão trazem os dados das ofertas embutidos
// nas propriedades do arquivo (metadado "TABLOIDI-DADOS"), então não precisamos de IA.
import { execFileSync } from 'node:child_process';
import type { Baixar } from './http';

export const API_FOLHETOS = 'https://apigw.cloud.carrefour.com.br/api-middleware-flyer-services';

export interface LojaAtacadao {
  id: number;
  nome: string;
  bairro: string;
  cidade: string;
  lat: number | null;
  lon: number | null;
}

export interface FolhetoAtacadao {
  id: string;
  nome: string;
  inicio: string;
  fim: string;
  url: string;
  lojas: LojaAtacadao[];
}

/** Itens no mesmo formato compacto usado em data/brutos (descrição + campos de preço). */
export interface ItemTabloide {
  numero: number;
  descricao: string;
  campos: Record<string, string>;
  skus: string[];
}

export interface ColetaAtacadao {
  fonte: 'atacadao-api';
  coletadoEm: string;
  folheto: FolhetoAtacadao;
  documento: string;
  paginas: { pagina: number; itens: ItemTabloide[] }[];
}

/** Junta os folhetos de todas as lojas: cada folheto aparece uma vez, com a lista de lojas onde vale. */
export function agruparFolhetos(lojasDaApi: any[]): FolhetoAtacadao[] {
  const porId = new Map<string, FolhetoAtacadao>();
  for (const s of lojasDaApi) {
    const loja: LojaAtacadao = {
      id: Number(s.storeId),
      nome: String(s.loja ?? '').trim(),
      bairro: String(s.bairro ?? '').trim(),
      cidade: String(s.cidade ?? '').trim(),
      lat: s.lat ? Number(s.lat) : null,
      lon: s.long ? Number(s.long) : null,
    };
    for (const f of s.flyers ?? []) {
      if (f.exclude) continue;
      let folheto = porId.get(f.id);
      if (!folheto) {
        folheto = {
          id: String(f.id),
          nome: String(f.name ?? '').trim(),
          inicio: String(f.validity?.initial ?? '').slice(0, 10),
          fim: String(f.validity?.final ?? '').slice(0, 10),
          url: String(f.urlFinalDocument),
          lojas: [],
        };
        porId.set(f.id, folheto);
      }
      if (!folheto.lojas.some((l) => l.id === loja.id)) folheto.lojas.push(loja);
    }
  }
  return [...porId.values()].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.nome.localeCompare(b.nome));
}

/** Lê o JSON "TABLOIDI-DADOS" que vem nas propriedades do PDF (saída do `pdfinfo`). */
export function lerTabloide(saidaPdfinfo: string): { documento: string; paginas: ColetaAtacadao['paginas'] } | null {
  const ini = saidaPdfinfo.indexOf('{"versao"');
  const fim = saidaPdfinfo.lastIndexOf('}');
  if (ini < 0 || fim < ini) return null;
  const d = JSON.parse(saidaPdfinfo.slice(ini, fim + 1));
  return {
    documento: String(d.documento ?? ''),
    paginas: (d.paginas ?? []).map((p: any) => ({
      pagina: p.pagina,
      itens: (p.itens ?? []).map((i: any) => ({
        numero: i.numero,
        descricao: String(i.descricao?.texto ?? ''),
        campos: Object.fromEntries(Object.entries(i.campos ?? {}).map(([k, v]: [string, any]) => [k, String(v?.texto ?? '')])),
        skus: [...new Set<string>((i.fotos ?? []).map((f: any) => f.sku).filter(Boolean))].sort(),
      })),
    })),
  };
}

/** Lista todas as lojas do estado com os folhetos de cada uma. */
export function listarLojasComFolhetos(baixar: Baixar, uf = 'RJ'): any[] {
  const cidades = JSON.parse(baixar(`${API_FOLHETOS}/api/v2/Store/city/uf?uf=${uf}&api-version=2`)) as { id: string }[];
  const lojas: any[] = [];
  for (const c of cidades) {
    for (let pagina = 1; pagina <= 10; pagina++) {
      const q = new URLSearchParams({ uf, city: c.id, PageSize: '24', pageNumber: String(pagina), 'api-version': '2' });
      const r = JSON.parse(baixar(`${API_FOLHETOS}/api/v2/Store/city?${q}`));
      lojas.push(...(r.stores ?? []));
      if (!r.totalPages || pagina >= r.totalPages) break;
    }
  }
  return lojas;
}

/** Baixa o PDF e lê os dados embutidos (precisa do `pdfinfo`, do pacote poppler-utils). */
export function lerPdfDoFolheto(caminhoPdf: string): ReturnType<typeof lerTabloide> {
  const saida = execFileSync('pdfinfo', ['-enc', 'UTF-8', caminhoPdf], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return lerTabloide(saida);
}
