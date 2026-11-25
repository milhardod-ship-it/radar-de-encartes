// Leitor de encartes em IMAGEM com a API do Claude (roda no robô do GitHub, com a chave ANTHROPIC_API_KEY).
// Cada página do encarte vira uma lista de ofertas no formato de data/curadoria (o mesmo da leitura manual).
import Anthropic from '@anthropic-ai/sdk';

/** Modelo usado na leitura. Pode trocar sem mexer no código: variável LEITOR_MODELO. */
export const MODELO_PADRAO = 'claude-sonnet-5-5'; // testado em 25/11: acerta como o Opus pela metade do preço

/** Preço em US$ por milhão de tokens (entrada, saída), para estimar o gasto de cada leitura. */
const PRECOS: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};

export interface ItemLido {
  nome: string;
  marcas: string[];
  tamanho: string;
  preco: number;
  de: number | null;
  clube: number | null;
  soClube: boolean;
  condicao: string | null;
  duvida: string | null;
}

export interface PaginaLida {
  itens: ItemLido[];
  validade: { inicio: string; fim: string } | null;
  lojas: string[];
  tokensEntrada: number;
  tokensSaida: number;
  custoUS: number;
}

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['validade', 'lojas', 'itens'],
  properties: {
    validade: {
      description: 'Validade impressa na página (AAAA-MM-DD), ou null se a página não mostra.',
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['inicio', 'fim'],
          properties: { inicio: { type: 'string' }, fim: { type: 'string' } },
        },
        { type: 'null' },
      ],
    },
    lojas: {
      type: 'array',
      description: 'Lojas onde as ofertas valem, se a página listar. Vazio se não listar.',
      items: { type: 'string' },
    },
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['nome', 'marcas', 'tamanho', 'preco', 'de', 'clube', 'soClube', 'condicao', 'duvida'],
        properties: {
          nome: { type: 'string', description: 'Tipo do produto, sem a marca. Ex.: "Arroz Tipo 1", "Leite UHT Integral".' },
          marcas: { type: 'array', items: { type: 'string' }, description: 'Uma ou mais marcas ("Piracanjuba, Italac ou Elegê" = 3).' },
          tamanho: { type: 'string', description: 'Como no encarte: "5kg", "1L", "kg" (preço por quilo), "c/20 unidades", "" se não houver.' },
          preco: { type: 'number', description: 'Preço que qualquer pessoa paga (ou o do clube, se soClube).' },
          de: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Preço "De" riscado, se houver.' },
          clube: { anyOf: [{ type: 'number' }, { type: 'null' }], description: 'Preço menor do clube/app, quando aparece junto do preço normal.' },
          soClube: { type: 'boolean', description: 'true se o encarte só mostra o preço do clube/app (sem preço normal).' },
          condicao: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Condição curta: "leve 3, pague 2", "exceto X", "50% na 2ª unidade"…' },
          duvida: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Se algo não ficou 100% legível ou é ambíguo, explique curto. Senão null.' },
        },
      },
    },
  },
} as const;

const INSTRUCOES = `Você transcreve ofertas de encartes de supermercado do Rio de Janeiro para um app de comparação de preços.
Leia a imagem da página e devolva TODAS as ofertas que tenham preço, seguindo as regras:
- Copie nome, marca, tamanho e preço exatamente como no encarte. Nunca invente nem complete.
- Preço com centavos pequenos ("27,95") vira 27.95.
- NÃO inclua: itens só com "Oferta Especial" ou sem preço; etiquetas "nesta embalagem X sai por R$ Y" ou
  "cada unidade sai por" (são só referência para o cliente, não são preço de produto).
- Pack (ex.: "c/12 un."): o preço é o do pack; "cada unidade sai por" vai só na condicao.
- Promoção de clube/app (ex.: "Guana Clube"): se aparecem o preço normal e o do clube, preço = normal e clube = o do
  clube. Se só aparece o do clube (ex.: "Leve 12 pague 10, cada unidade sai por 1,66"), use soClube = true, preço = esse
  valor e explique a condição.
- Uma oferta para várias marcas ("Leite Piracanjuba, Italac ou Elegê") = um item com várias marcas.
- Se qualquer parte (nome, tamanho, preço) não estiver nítida ou for ambígua (preço entre dois produtos, preço cortado),
  inclua o item e explique em "duvida". Se não der para ler o preço, não inclua.
- Não repita o mesmo item duas vezes na mesma página.`;

export function criarCliente(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não definida (segredo do GitHub).');
  return new Anthropic();
}

/** Lê uma página (imagem JPEG/PNG) do encarte. */
export async function lerPagina(
  cliente: Anthropic,
  imagem: Buffer,
  tipo: 'image/jpeg' | 'image/png',
  contexto: string,
  modelo = process.env.LEITOR_MODELO || MODELO_PADRAO,
): Promise<PaginaLida> {
  // Se a IA recusar por engano (raríssimo em encarte), a própria API refaz com outro modelo ("fallbacks").
  const resposta = await cliente.beta.messages.create({
    model: modelo,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
    system: INSTRUCOES,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: tipo, data: imagem.toString('base64') } },
          { type: 'text', text: `${contexto}\nTranscreva as ofertas desta página.` },
        ],
      },
    ],
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);

  if (resposta.stop_reason === 'refusal') throw new Error('a IA recusou ler esta página');
  if (resposta.stop_reason === 'max_tokens') throw new Error('a resposta passou do limite de tamanho (página muito cheia)');
  const texto = resposta.content.find((b) => b.type === 'text');
  if (!texto || texto.type !== 'text') throw new Error('a IA não devolveu texto');
  const dados = JSON.parse(texto.text) as { validade: PaginaLida['validade']; lojas: string[]; itens: ItemLido[] };

  const [pe, ps] = PRECOS[modelo] ?? [0, 0];
  const entrada = resposta.usage.input_tokens + (resposta.usage.cache_read_input_tokens ?? 0) + (resposta.usage.cache_creation_input_tokens ?? 0);
  const saida = resposta.usage.output_tokens;
  return {
    itens: dados.itens.filter((i) => i.preco > 0 && i.nome.trim()),
    validade: dados.validade,
    lojas: dados.lojas ?? [],
    tokensEntrada: entrada,
    tokensSaida: saida,
    custoUS: (entrada * pe + saida * ps) / 1e6,
  };
}
