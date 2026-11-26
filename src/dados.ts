import encartesJson from '../data/encartes.json';
import lojasJson from '../data/lojas.json';
import ofertasJson from '../data/ofertas.json';
import type { Encarte, Loja, Mercado, MercadoId, Oferta, Programa, ProgramaId } from './core/tipos';

export const PROGRAMAS: Record<ProgramaId, Programa> = {
  'guana-clube': { id: 'guana-clube', nome: 'Guana Clube', descricao: 'Clube de vantagens do Guanabara' },
  'mundial-total': { id: 'mundial-total', nome: 'App Mundial Total', descricao: 'Preços exclusivos no app do Mundial' },
  'meu-assai': { id: 'meu-assai', nome: 'App Meu Assaí', descricao: 'Ofertas exclusivas no app do Assaí' },
  'meu-dom': { id: 'meu-dom', nome: 'App Meu Dom', descricao: 'Clube de ofertas do app do Dom Atacadista' },
  'clube-redeconomia': { id: 'clube-redeconomia', nome: 'Clube Redeconomia (cartão)', descricao: 'Preços do cartão/clube da Redeconomia' },
  'meu-atacadao': { id: 'meu-atacadao', nome: 'App Meu Atacadão', descricao: 'Ofertas ativadas no app do Atacadão' },
  'cartao-atacadao': {
    id: 'cartao-atacadao',
    nome: 'Cartão Atacadão, Carrefour ou Sam’s Club',
    descricao: 'Desconto extra junto com o app Meu Atacadão',
  },
};

export const MERCADOS: Record<MercadoId, Mercado> = {
  guanabara: { id: 'guanabara', nome: 'Guanabara', programas: [PROGRAMAS['guana-clube']] },
  mundial: { id: 'mundial', nome: 'Mundial', programas: [PROGRAMAS['mundial-total']] },
  atacadao: { id: 'atacadao', nome: 'Atacadão', programas: [PROGRAMAS['meu-atacadao'], PROGRAMAS['cartao-atacadao']] },
  prezunic: { id: 'prezunic', nome: 'Prezunic', programas: [] },
  supermarket: { id: 'supermarket', nome: 'Supermarket', programas: [] },
  assai: { id: 'assai', nome: 'Assaí', programas: [PROGRAMAS['meu-assai']] },
  dom: { id: 'dom', nome: 'Dom Atacadista', programas: [PROGRAMAS['meu-dom']] },
  redeconomia: { id: 'redeconomia', nome: 'Redeconomia', programas: [PROGRAMAS['clube-redeconomia']] },
};

export const ENCARTES: Encarte[] = encartesJson as Encarte[];
export const MAPA_ENCARTES = new Map(ENCARTES.map((e) => [e.id, e]));
export const TODAS_OFERTAS: Oferta[] = ofertasJson as Oferta[];
export const LOJAS: Loja[] = lojasJson as Loja[];

export function nomeMercado(id: MercadoId): string {
  return MERCADOS[id]?.nome ?? id;
}
