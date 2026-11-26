import { describe, expect, it } from 'vitest';
import { lerCategoriaGuanabara, lerValidadeGuanabara } from '../src/coleta/guanabara';
import { lerEncartesMundial, lerPageProps } from '../src/coleta/mundial';
import { unificarProdutos, idProduto } from '../src/core/canonico';
import { limparNome, separarMarca } from '../src/core/marcas';
import { extrairTamanho } from '../src/core/texto';
import type { Oferta } from '../src/core/tipos';

// Trecho real (simplificado) de https://www.supermercadosguanabara.com.br/produtos/12
const HTML_GUANABARA = `
<div class="col item">
  <div class="row">
    <div class="col image" style="background-image: url('//www.supermercadosguanabara.com.br:443/sites/default/files/acucar.png');">
      <div class="price"><div class="vertical-align"><span class="number">2,99</span> </div></div>
    </div>
    <div class="col text"><div class="vertical-align"><div class="name">Açúcar Guarani kg</div></div></div>
  </div>
</div>
<div class="col item">
  <div class="row">
    <div class="col image" style="background-image: url('//www.supermercadosguanabara.com.br:443/sites/default/files/aveia.png');">
      <div class="price"><div class="vertical-align"><span class="number">3,69</span> cada</div></div>
    </div>
    <div class="col text"><div class="vertical-align"><div class="name">Aveia em Flocos ou Flocos Finos Quaker 165g</div></div></div>
  </div>
</div>`;

describe('robô do Guanabara', () => {
  it('lê nome, preço, sufixo e foto de cada produto', () => {
    const itens = lerCategoriaGuanabara(HTML_GUANABARA, 'Matinais e padaria');
    expect(itens).toEqual([
      { categoria: 'Matinais e padaria', nome: 'Açúcar Guarani kg', preco: '2,99', sufixo: '', imagem: 'https://www.supermercadosguanabara.com.br/sites/default/files/acucar.png' },
      { categoria: 'Matinais e padaria', nome: 'Aveia em Flocos ou Flocos Finos Quaker 165g', preco: '3,69', sufixo: 'cada', imagem: 'https://www.supermercadosguanabara.com.br/sites/default/files/aveia.png' },
    ]);
  });

  it('lê a validade do encarte', () => {
    expect(lerValidadeGuanabara('<p>Promoção válida de 18/11/2026 até 23/11/2026, enquanto durarem nossos estoques.</p>')).toEqual({
      inicio: '2026-11-18',
      fim: '2026-11-23',
    });
    expect(lerValidadeGuanabara('<p>sem data</p>')).toBeNull();
  });
});

describe('robô do Mundial', () => {
  it('lê o __NEXT_DATA__ e os encartes', () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { encartes: [{ id: '61', description: 'Encarte - Ofertas 19.11 a 02.12.2026', file: { url: 'https://x/61.pdf' }, publishedIn: '2026-11-19T04:05:00.000Z', unpublishedIn: '2026-12-03T01:20:00.000Z' }] } },
    })}</script>`;
    expect(lerEncartesMundial(lerPageProps(html))).toEqual([
      { id: '61', descricao: 'Encarte - Ofertas 19.11 a 02.12.2026', pdf: 'https://x/61.pdf', publicadoEm: '2026-11-19T04:05:00.000Z', despublicadoEm: '2026-12-03T01:20:00.000Z' },
    ]);
  });

  it('avisa quando o site muda', () => {
    expect(() => lerPageProps('<html></html>')).toThrow(/mudou/);
  });
});

describe('marcas e nomes', () => {
  const marcas = ['Tio João', 'Andorinha', 'Andorinha Seleção', 'Hellmann\'s', 'Italac', 'Camil'];
  it.each([
    ['Arroz Camil 5kg', 'Camil', 'Arroz'],
    ['Azeite Extra Virgem Seleção Andorinha 500ml', 'Andorinha Seleção', 'Azeite Extra Virgem'],
    ['Maionese Hellmanns Trad. 500g', 'Hellmann\'s', 'Maionese Trad.'],
    ['Leite UHT Longa Vida Italac Integral TP Litro', 'Italac', 'Leite UHT Longa Vida Integral'],
    ['Feijão Preto Macio Kg', '', 'Feijão Preto Macio'],
  ])('%s', (texto, marca, nome) => {
    const r = separarMarca(texto, marcas);
    expect(r.marca).toBe(marca);
    expect(limparNome(r.nome)).toBe(nome);
  });

  it('pack e litro sem número', () => {
    expect(extrairTamanho('Cerveja Brahma 350ml Pack c/18 unidades').tamanho).toEqual({ valor: 6300, unidade: 'ml' });
    expect(extrairTamanho('Leite UHT Italac Integral TP Litro').tamanho).toEqual({ valor: 1000, unidade: 'ml' });
  });
});

describe('unificarProdutos', () => {
  function o(mercado: Oferta['mercado'], nome: string, marca: string, ml: number): Oferta {
    const tamanho = { valor: ml, unidade: 'ml' as const };
    return {
      id: `${mercado}-${nome}`, mercado, encarte: `encarte-${mercado}`, produto: idProduto(nome, marca, tamanho, false), nome, marca,
      original: nome, categoria: 'Mercearia', tamanho, porKg: false, precos: [{ valor: 1, exige: [] }], revisado: false,
    };
  }

  it('junta o mesmo produto escrito de jeitos diferentes em mercados diferentes', () => {
    const r = unificarProdutos([
      o('guanabara', 'Leite UHT Longa Vida Integral', 'Italac', 1000),
      o('atacadao', 'Leite Integral', 'Italac', 1000),
    ]);
    expect(r[0].produto).toBe(r[1].produto);
  });

  it('não junta variações diferentes nem produtos do mesmo mercado', () => {
    const r = unificarProdutos([
      o('guanabara', 'Leite UHT Integral', 'Italac', 1000),
      o('atacadao', 'Leite UHT Desnatado', 'Italac', 1000),
      o('mundial', 'Azeite Extravirgem', 'Andorinha', 500),
      o('mundial', 'Azeite Extravirgem Spray', 'Andorinha', 500),
    ]);
    expect(r[0].produto).not.toBe(r[1].produto);
    expect(r[2].produto).not.toBe(r[3].produto);
  });

  it('junta o mesmo produto em encartes diferentes do mesmo mercado (encarte velho × novo)', () => {
    const velho = o('guanabara', 'Achocolatado em Pó', 'Nescau', 350);
    const novo = { ...o('guanabara', 'Achocolatado Lata', 'Nescau', 350), encarte: 'guanabara-novo' };
    const r = unificarProdutos([velho, novo]);
    expect(r[0].produto).toBe(r[1].produto);
  });

  it('entende plural e sinônimos simples', () => {
    const r = unificarProdutos([
      o('guanabara', 'Bombons Sortidos', 'Garoto', 220),
      o('prezunic', 'Bombom Sortido', 'Garoto', 220),
      o('guanabara', 'Lava-Roupas Líquido', 'Omo', 3000),
      o('mundial', 'Sabão Líquido', 'Omo', 3000),
    ]);
    expect(r[0].produto).toBe(r[1].produto);
    expect(r[2].produto).toBe(r[3].produto);
  });
});

describe('validade da lista do Guanabara', () => {
  it('usa a validade da LISTA, não a da página do encarte', async () => {
    const { coletarGuanabara } = await import('../src/coleta/guanabara');
    const paginas: Record<string, string> = {
      '/encarte': '<p>Promoção válida de 24/11/2026 até 25/11/2026</p>',
    };
    const lista = `<p>Validade: 23/11/2026</p>${HTML_GUANABARA}`;
    const baixar = (url: string) => paginas[new URL(url).pathname] ?? lista;
    // 23/11 às 21h30 no Rio = 24/11 00:30 UTC
    const r = coletarGuanabara(baixar, new Date('2026-11-24T00:30:00Z'));
    expect('vencidaAte' in r || 'listaVazia' in r).toBe(false);
    if (!('vencidaAte' in r) && !('listaVazia' in r)) {
      expect(r.fim).toBe('2026-11-23');
      expect(r.inicio).toBe('2026-11-23'); // o encarte anunciado (24–25) não é o desta lista
      expect(r.encarteDoSite).toEqual({ inicio: '2026-11-24', fim: '2026-11-25' });
    }
    // lista vazia na troca de encarte: aviso, não erro
    const vazio = (url: string) => (new URL(url).pathname === '/encarte' ? paginas['/encarte'] : '<p>Validade: 31/12/1969</p>');
    expect(coletarGuanabara(vazio, new Date('2026-11-24T10:00:00Z'))).toEqual({ listaVazia: true, encarteDoSite: { inicio: '2026-11-24', fim: '2026-11-25' } });
    // no dia seguinte, a mesma lista antiga não é importada
    expect(coletarGuanabara(baixar, new Date('2026-11-24T12:00:00Z'))).toEqual({ vencidaAte: '2026-11-23' });
  });
});

describe('robô do Atacadão', () => {
  it('agrupa os folhetos de todas as lojas (um folheto, várias lojas)', async () => {
    const { agruparFolhetos } = await import('../src/coleta/atacadao');
    const folheto = (id: string, nome: string, ini: string, fim: string) => ({
      id, name: nome, validity: { initial: `${ini}T00:00:00Z`, final: `${fim}T00:00:00Z` }, urlFinalDocument: `https://x/?id=${id}`, exclude: false,
    });
    const lojas = [
      { storeId: 247, loja: 'Realengo', bairro: 'Realengo', cidade: 'Rio de Janeiro', lat: '-22.87', long: '-43.42', flyers: [folheto('A', 'Ofertão', '2026-11-24', '2026-11-30'), folheto('B', 'Boa do Dia', '2026-11-24', '2026-11-24')] },
      { storeId: 300, loja: 'Maria da Luz', bairro: 'Centro', cidade: 'Nova Iguaçu', lat: '-22.7', long: '-43.4', flyers: [folheto('A', 'Ofertão', '2026-11-24', '2026-11-30')] },
    ];
    const r = agruparFolhetos(lojas);
    expect(r.map((f) => [f.id, f.nome, f.inicio, f.fim, f.lojas.map((l) => l.nome)])).toEqual([
      ['B', 'Boa do Dia', '2026-11-24', '2026-11-24', ['Realengo']],
      ['A', 'Ofertão', '2026-11-24', '2026-11-30', ['Realengo', 'Maria da Luz']],
    ]);
  });

  it('lê os dados embutidos do PDF (TABLOIDI-DADOS)', async () => {
    const { lerTabloide } = await import('../src/coleta/atacadao');
    const meta = {
      versao: '2.0', documento: 'rj (BOA DO DIA) 24 nov 26',
      paginas: [{ pagina: 1, itens: [{ numero: 1, descricao: { texto: 'Açúcar Refinado Guarani\nPacote com 1kg' }, campos: { P: { texto: 'R$3,39' }, D: { texto: 'de:  R$ 3,59  por:' } }, fotos: [{ sku: '47951' }, { sku: '47951' }] }] }],
    };
    const saida = `Title: x\nSubject:         TABLOIDI-DADOS 2.0\n${JSON.stringify(meta)}\nCreator: Adobe InDesign`;
    expect(lerTabloide(saida)).toEqual({
      documento: 'rj (BOA DO DIA) 24 nov 26',
      paginas: [{ pagina: 1, itens: [{ numero: 1, descricao: 'Açúcar Refinado Guarani\nPacote com 1kg', campos: { P: 'R$3,39', D: 'de:  R$ 3,59  por:' }, skus: ['47951'] }] }],
    });
    expect(lerTabloide('Creator: InDesign\nPages: 4')).toBeNull();
  });
});

describe('robô do Prezunic', () => {
  it('lê a validade e as lojas do encarte', async () => {
    const { lerTextoValidade, lerLojasDoTitulo } = await import('../src/coleta/prezunic');
    expect(lerTextoValidade('Válidas de 24 a 25/11/2026')).toEqual({ inicio: '2026-11-24', fim: '2026-11-25' });
    expect(lerTextoValidade('válidas de 03/11 a 30/11/2026')).toEqual({ inicio: '2026-11-03', fim: '2026-11-30' });
    expect(lerTextoValidade('Válidas de 23/11/2026')).toEqual({ inicio: '2026-11-23', fim: '2026-11-23' });
    expect(lerLojasDoTitulo('Especial sorvetes | lojas: Recreio, Barra, Freguesia e Marapendi.')).toEqual(['Recreio', 'Barra', 'Freguesia', 'Marapendi']);
    expect(lerLojasDoTitulo('3ª e 4ª da feirinha')).toEqual([]);
  });

  it('lê produto, "de/por", detalhe e limite pela posição das palavras', async () => {
    const { lerProdutosPrezunic } = await import('../src/coleta/prezunic');
    const w = (x0: number, y0: number, x1: number, y1: number, t: string) =>
      `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y1}">${t}</word>`;
    // recorte real do encarte "3ª e 4ª da feirinha" (fonte 18 no nome, 52 nos reais, 39 nos centavos)
    const bbox = `<page width="700" height="1871">
      ${w(23, 1132, 108, 1150, 'ACÉM')}${w(110, 1132, 130, 1150, 'OU')}${w(133, 1132, 190, 1150, 'PALETA')}
      ${w(101, 1146, 151, 1164, 'BOVINA')}
      ${w(80, 1170, 120, 1183, '(pedaço')}${w(123, 1170, 135, 1183, 'ou')}${w(138, 1170, 175, 1183, 'moído)')}${w(178, 1170, 190, 1183, 'kg')}
      ${w(32, 1300, 50, 1320, 'R$')}${w(49, 1277, 87, 1329, '42')}${w(87, 1269, 116, 1308, ',99')}
      ${w(137, 1300, 154, 1320, 'R$')}${w(153, 1277, 191, 1329, '36')}${w(191, 1269, 220, 1308, ',98')}
      ${w(77, 1335, 174, 1346, 'Limite por cliente de 10 Kg')}
    </page>`;
    expect(lerProdutosPrezunic(bbox)).toEqual([
      { pagina: 1, nome: 'ACÉM OU PALETA BOVINA', detalhe: '(pedaço ou moído) kg', preco: 36.98, precoDe: 42.99, limite: 'Limite por cliente de 10 Kg' },
    ]);
  });

  it('separa várias marcas da mesma oferta', async () => {
    const { separarMarcas } = await import('../src/core/marcas');
    expect(separarMarcas('Leite Uht Piracanjuba, Elegê ou Glória', ['Piracanjuba', 'Elegê', 'Glória'])).toEqual({
      marcas: ['Piracanjuba', 'Elegê', 'Glória'],
      nome: 'Leite Uht',
    });
    expect(separarMarcas('Café em Pó Pilão ou Pimpinela Golden', ['Pilão', 'Pimpinela', 'Pimpinela Golden'])).toEqual({
      marcas: ['Pilão', 'Pimpinela Golden'],
      nome: 'Café em Pó',
    });
  });
});
