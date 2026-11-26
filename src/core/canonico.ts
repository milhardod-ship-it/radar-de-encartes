import { normalizar } from './texto';
import type { Oferta, Tamanho } from './tipos';

// Palavras que não ajudam a identificar o produto (embalagem, conectivos, "vários sabores"…).
const IGNORADAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'em', 'e', 'ou', 'a', 'o', 'p', 'c', 's', 'para',
  'tipo', '1', 'varios', 'varias', 'sabores', 'tipos', 'fragrancias', 'linha', 'toda',
  'congelado', 'congelada', 'resfriado', 'resfriada', 'pacote', 'bandeja', 'band', 'pote', 'lata', 'latao',
  'caixeta', 'caixa', 'garrafa', 'pet', 'frasco', 'tp', 'unidade', 'unidades', 'unids', 'preco', 'por', 'quilo',
  'na', 'no', 'peca', 'sache', 'vidro', 'tubo', 'pack', 'refil', 'kg', 'g', 'ml', 'l', 'un', 'cada', 'litro',
  'longa', 'vida', 'pct', 'iqf', 'vacuo', 'inst', 'instantaneo', 'tradicional', 'trad', 'leve', 'pague',
  'carne', 'bovina', 'bovino', 'bov', 'exc', 'und', 'unid', 'peixe', 'barril', 'tp', 'doypack', 'pouch', 'envelopado',
  'envelopada', 'embalagem', 'kit', 'hot', 'dog',
]);

// Grafias diferentes da mesma coisa entre os encartes.
const SINONIMOS: Record<string, string> = {
  extravirgem: 'extra-virgem',
  int: 'integral',
  semi: 'semidesnatado',
  desn: 'desnatado',
  refin: 'refinado',
  file: 'file',
  contrafile: 'contra-file',
  moida: 'moida',
  parb: 'parboilizado',
  bombon: 'bombom',
  chopp: 'cerveja',
  chope: 'cerveja',
  sabao: 'lava-roupa',
  capsula: 'capsula',
};

/**
 * Plural → singular, só para comparar ("bombons" = "bombom", "coxinhas" = "coxinha", "corações" = "coração").
 * Regras simples do português; palavras curtas ficam como estão.
 */
export function singular(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('oes') || w.endsWith('aes')) return w.slice(0, -3) + 'ao';
  if (w.endsWith('ais')) return w.slice(0, -3) + 'al';
  if (w.endsWith('ns')) return w.slice(0, -2) + 'm';
  if (/[rz]es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w) && !/(is|us)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Palavras que identificam o produto (sem marca, sem embalagem, sem números). */
export function palavrasDoProduto(nome: string, marca: string): string[] {
  const daMarca = new Set(normalizar(marca).split(' ').flatMap((w) => [w, singular(w)]));
  const t = normalizar(nome)
    .replace(/\bextra virgem\b/g, 'extra-virgem')
    .replace(/\bcontra file\b/g, 'contra-file')
    .replace(/\blava roupas?\b/g, 'lava-roupas')
    // "s/ casca", "sem pele" → "sem-casca", "sem-pele": "com casca" e "sem casca" são produtos diferentes.
    .replace(/\bs (?=[a-z])/g, 'sem ')
    .replace(/\bsem (\w+)/g, 'sem-$1');
  const lista = t
    .split(' ')
    .filter((w) => !IGNORADAS.has(w))
    .map((w) => singular(w))
    .map((w) => SINONIMOS[w] ?? w)
    .filter((w) => w && !IGNORADAS.has(w) && !daMarca.has(w) && !/^\d/.test(w));
  return [...new Set(lista)];
}

/**
 * Etiqueta do tamanho para compor o id: "5000g", "500ml", "30un".
 * Vendido por quilo vira "1000g": assim "filé por kg" e "filé bandeja 1 kg" se comparam.
 */
export function etiquetaTamanho(tamanho: Tamanho | null, porKg: boolean): string {
  if (porKg) return '1000g';
  if (!tamanho) return 'sem-tamanho';
  return `${tamanho.valor}${tamanho.unidade}`;
}

/**
 * Id canônico do produto: tipo (até 3 palavras do nome) + marca + tamanho.
 * Ex.: ("Arroz Parboilizado", "Tio João", 5000 g) → "arroz-parboilizado__tio-joao__5000g".
 * Ofertas com o mesmo id em mercados diferentes são o MESMO produto e entram na comparação.
 * Quando a regra automática erra, a curadoria define o id à mão.
 */
export function idProduto(nome: string, marca: string, tamanho: Tamanho | null, porKg: boolean): string {
  // Até 5 palavras (com 3, "Leite Fermentado Desnatado Zero" e "… Zero Lactose" viravam o mesmo produto).
  // Sem tamanho, os números do nome também contam ("Pneu Aro 14" × "Pneu Aro 15").
  const numeros = tamanho || porKg ? [] : (normalizar(nome).match(/\b\d+\b/g) ?? []).filter((n) => n !== '1');
  const palavras = [...palavrasDoProduto(nome, marca).slice(0, 5), ...numeros];
  return [palavras.join('-') || 'produto', normalizar(marca).replace(/ /g, '-') || 'sem-marca', etiquetaTamanho(tamanho, porKg)].join('__');
}

/**
 * Junta produtos que são o mesmo em mercados diferentes, mas que cada encarte escreveu de um jeito
 * ("Leite UHT Integral Italac 1L" × "Leite Longa Vida Italac Integral TP 1L").
 * Regra conservadora: mesma marca (não vazia), mesmo tamanho, ids que não aparecem juntos
 * no mesmo encarte, as palavras de um nome todas contidas no outro e nenhuma palavra de
 * variação (integral, desnatado, zero, spray…) só de um lado.
 * Devolve as ofertas com o `produto` trocado pelo id escolhido (o mais curto).
 */
export function unificarProdutos(ofertas: Oferta[]): Oferta[] {
  interface Info {
    id: string;
    /** Encartes onde o produto aparece: dois nomes diferentes no MESMO encarte são produtos diferentes. */
    encartes: Set<string>;
    palavras: Set<string>;
    grupo: string;
  }
  const infos = new Map<string, Info>();
  for (const o of ofertas) {
    let i = infos.get(o.produto);
    if (!i) {
      const palavras = palavrasDoProduto(o.nome, o.marca);
      const marca = normalizar(o.marca);
      i = {
        id: o.produto,
        encartes: new Set(),
        palavras: new Set(palavras),
        grupo: marca && (o.tamanho || o.porKg) ? `${marca}|${etiquetaTamanho(o.tamanho, o.porKg)}` : '',
      };
      infos.set(o.produto, i);
    }
    i.encartes.add(o.encarte);
  }

  // union-find simples
  const pai = new Map<string, string>();
  const raiz = (id: string): string => {
    let r = id;
    while (pai.has(r)) r = pai.get(r)!;
    return r;
  };
  const porGrupo = new Map<string, Info[]>();
  for (const i of infos.values()) {
    if (!i.grupo) continue;
    const l = porGrupo.get(i.grupo);
    if (l) l.push(i);
    else porGrupo.set(i.grupo, [i]);
  }
  for (const lista of porGrupo.values()) {
    if (lista.length < 2) continue;
    lista.sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
    for (let x = 0; x < lista.length; x++) {
      for (let y = x + 1; y < lista.length; y++) {
        const a = lista[x];
        const b = lista[y];
        const ra = raiz(a.id);
        const rb = raiz(b.id);
        if (ra === rb) continue;
        const encartesA = encartesDoConjunto(ra);
        const encartesB = encartesDoConjunto(rb);
        if ([...encartesA].some((m) => encartesB.has(m))) continue;
        if (compativeis(a.palavras, b.palavras)) pai.set(rb, ra);
      }
    }
  }
  function encartesDoConjunto(r: string): Set<string> {
    const s = new Set<string>();
    for (const i of infos.values()) if (raiz(i.id) === r) for (const m of i.encartes) s.add(m);
    return s;
  }

  if (pai.size === 0) return ofertas;
  return ofertas.map((o) => {
    const r = raiz(o.produto);
    return r === o.produto ? o : { ...o, produto: r };
  });
}

// Palavras que mudam o produto: se só um dos nomes tem, não é o mesmo produto.
const VARIACOES = new Set([
  'integral', 'desnatado', 'semidesnatado', 'zero', 'light', 'diet', 'lactose', 'spray', 'refil', 'parboilizado',
  'branco', 'preto', 'carioca', 'vermelho', 'extra', 'forte', 'gourmet', 'premium', 'kids', 'infantil', 'baby',
  'masculino', 'feminino', 'noturno', 'concentrado', 'liquido', 'pastoso', 'gel', 'aerossol', 'roll',
  'morango', 'chocolate', 'baunilha', 'limao', 'laranja', 'uva', 'coco', 'sem', 'mini', 'max', 'plus',
  'defumado', 'defumada', 'waffle', 'pipoquinha', 'lanche', 'levinho', 'ovinho', 'condicionador', 'supreme', 'maltado',
]);

function compativeis(a: Set<string>, b: Set<string>): boolean {
  const [menor, maior] = a.size <= b.size ? [a, b] : [b, a];
  if (menor.size === 0) return false;
  // Nome genérico de uma palavra ("Biscoito") só junta com outro que tenha no máximo uma palavra a mais
  // ("Biscoito" × "Biscoito Maltado Recheado" não; "Sabonete" × "Sabonete em Barra" sim).
  if (menor.size === 1 && maior.size - menor.size >= 2) return false;
  for (const w of menor) if (!maior.has(w)) return false;
  for (const w of maior) if (!menor.has(w) && VARIACOES.has(w)) return false;
  return true;
}

/**
 * Assinatura de uma oferta: nome + marca + tamanho como o encarte escreveu (sem mercado).
 * É o que o painel grava em data/juncoes.json: continua valendo mesmo se as regras de id mudarem.
 */
export function assinatura(o: Pick<Oferta, 'nome' | 'marca' | 'tamanho' | 'porKg'>): string {
  return `${normalizar(o.nome)}|${normalizar(o.marca)}|${etiquetaTamanho(o.tamanho, o.porKg)}`;
}

export interface Juncoes {
  /** Pares de assinaturas que são o MESMO produto (decisão do dono). */
  juntar: [string, string][];
  /** Pares que NÃO são o mesmo produto (separa se a regra automática juntou; some das sugestões). */
  diferentes: [string, string][];
}

/** Aplica as decisões do dono por cima da junção automática. */
export function aplicarJuncoes(ofertas: Oferta[], j: Juncoes): Oferta[] {
  const sig = ofertas.map((o) => assinatura(o));
  const produto = ofertas.map((o) => o.produto);
  // 1) "diferentes": se estão no mesmo produto, a segunda assinatura ganha um produto só dela.
  for (const [a, b] of j.diferentes) {
    const pa = new Set(produto.filter((_, i) => sig[i] === a));
    ofertas.forEach((o, i) => {
      if (sig[i] === b && pa.has(produto[i])) produto[i] = `${idProduto(o.nome, o.marca, o.tamanho, o.porKg)}~${b.replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    });
  }
  // 2) "juntar": o produto da segunda passa a ser o da primeira (em todas as ofertas dele).
  for (const [a, b] of j.juntar) {
    const ia = sig.indexOf(a);
    const ib = sig.indexOf(b);
    if (ia < 0 || ib < 0) continue;
    const destino = produto[ia];
    const origem = produto[ib];
    if (destino === origem) continue;
    for (let i = 0; i < produto.length; i++) if (produto[i] === origem) produto[i] = destino;
  }
  return ofertas.map((o, i) => (produto[i] === o.produto ? o : { ...o, produto: produto[i] }));
}
