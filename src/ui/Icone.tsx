import type { Categoria } from '../core/tipos';

const CAMINHOS: Record<string, string> = {
  inicio: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  buscar: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 2-4-4',
  lista: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  encartes: 'M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 5h8m-8 4h8m-8 4h5',
  perfil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-8 9c0-4 4-6 8-6s8 2 8 6',
  voltar: 'm15 6-6 6 6 6',
  seta: 'm9 6 6 6-6 6',
  mais: 'M12 5v14M5 12h14',
  menos: 'M5 12h14',
  relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-14v5l3 2',
  cartao: 'M3 6h18v13H3zM3 10h18M7 15h4',
  check: 'm5 12 5 5 9-10',
  lixeira: 'M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13',
  local: 'M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  compartilhar: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  menu: 'M12 5h.01M12 12h.01M12 19h.01',
  etiqueta: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM7.5 7.5h.01',
};

const ICONES_CATEGORIA: Record<Categoria, string> = {
  Açougue: 'M15 4c3 0 5 2 5 5 0 4-4 7-8 9-3 1.5-6 2-7 1s-.5-4 1-7c2-4 5-8 9-8zm-2 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  Hortifrúti: 'M12 7c-3-2-7-1-7 4s3 9 7 9 7-4 7-9-4-6-7-4zm0 0c0-2 1-4 3-5',
  'Frios e Laticínios': 'M3 15l9-9 9 6v6H3zm6 0h.01M15 14h.01M12 17h.01',
  Mercearia: 'M5 8h14l-1 13H6zm4 0V6a3 3 0 0 1 6 0v2',
  Bebidas: 'M10 2h4v4l2 3v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9l2-3zm-2 11h8',
  Limpeza: 'M9 9h6l1 12H8zm2-6h4v6h-4zm4 2h4l-1 3',
  Higiene: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z',
  Congelados: 'M12 2v20M3 7l18 10M21 7 3 17M9 4l3 2 3-2M9 20l3-2 3 2',
  Outros: 'M4 8l8-4 8 4v8l-8 4-8-4zm0 0 8 4 8-4m-8 4v8',
};

export function Icone({ nome, tamanho = 22, grosso = false }: { nome: string; tamanho?: number; grosso?: boolean }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={grosso ? 2.4 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={CAMINHOS[nome] ?? ''} />
    </svg>
  );
}

/** Ícone da categoria, usado quando o produto não tem foto. */
export function IconeCategoria({ categoria, tamanho = 40 }: { categoria: Categoria; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONES_CATEGORIA[categoria] ?? ICONES_CATEGORIA.Mercearia} />
    </svg>
  );
}

/** Logo do radar. `claro`: versão para o topo azul (traço branco, ponteiro ciano). */
export function Logo({ tamanho = 32, claro = false }: { tamanho?: number; claro?: boolean }) {
  const traco = claro ? '#FFFFFF' : '#0B2A66';
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke={traco} />
      <circle cx="12" cy="12" r="5.5" stroke="#2EC4D6" />
      <path d="M12 12 19 5" stroke="#2EC4D6" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.8" fill="#2EC4D6" stroke="none" />
    </svg>
  );
}
