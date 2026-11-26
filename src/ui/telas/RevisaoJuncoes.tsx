// Aba "Juntar produtos" do painel de revisão.
// Sugere pares de produtos com a mesma marca e o mesmo tamanho que a regra automática deixou separados, e mostra
// os que ela juntou com nomes diferentes. As decisões do dono vão para data/juncoes.json (no GitHub).
import { useEffect, useMemo, useState } from 'react';
import { formatarReais } from '../../core/texto';
import { nomeMercado } from '../../dados';
import type { MercadoId } from '../../core/tipos';

interface Resumo {
  produto: string;
  assinatura: string;
  nome: string;
  marca: string;
  tamanho: string;
  mercados: MercadoId[];
  preco: number | null;
}
interface Sugestoes {
  sugestoes: { a: Resumo; b: Resumo; parecido: number }[];
  juntos: { produto: string; itens: Resumo[] }[];
}
type Decisao = { tipo: 'juntar' | 'diferentes'; a: string; b: string; rotulo: string };

const CHAVE = 'radar:revisao:juncoes:v1';
const CHAVE_ENVIADAS = 'radar:revisao:juncoes-enviadas:v1';
const par = (a: string, b: string) => [a, b].sort().join('§');

function lerLocal<T>(chave: string, inicial: T): T {
  try {
    const t = localStorage.getItem(chave);
    return t ? (JSON.parse(t) as T) : inicial;
  } catch {
    return inicial;
  }
}
function gravarLocal(chave: string, valor: unknown) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    /* segue só na memória */
  }
}

export function RevisaoJuncoes({
  enviarArquivo,
}: {
  /** Lê data/<arquivo> no GitHub, aplica a mudança e grava (um commit). */
  enviarArquivo: (arquivo: string, mudar: (dados: any) => any, mensagem: string) => Promise<void>;
}) {
  const [dados, setDados] = useState<Sugestoes | null>(null);
  const [decisoes, setDecisoes] = useState<Record<string, Decisao>>(() => lerLocal(CHAVE, {}));
  const [enviadas, setEnviadas] = useState<Record<string, true>>(() => lerLocal(CHAVE_ENVIADAS, {}));
  const [ver, setVer] = useState<'sugestoes' | 'juntos'>('sugestoes');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);

  useEffect(() => {
    import('../../../data/juncoes-sugestoes.json').then((m) => setDados(m.default as unknown as Sugestoes));
  }, []);
  useEffect(() => gravarLocal(CHAVE, decisoes), [decisoes]);
  useEffect(() => gravarLocal(CHAVE_ENVIADAS, enviadas), [enviadas]);

  const sugestoes = useMemo(
    () => (dados?.sugestoes ?? []).filter((s) => !enviadas[par(s.a.assinatura, s.b.assinatura)]),
    [dados, enviadas],
  );
  const juntos = useMemo(
    () =>
      (dados?.juntos ?? []).filter((g) => !g.itens.slice(1).every((i) => enviadas[par(g.itens[0].assinatura, i.assinatura)])),
    [dados, enviadas],
  );
  const n = Object.keys(decisoes).length;

  function decidir(tipo: Decisao['tipo'] | null, a: Resumo, b: Resumo) {
    const k = par(a.assinatura, b.assinatura);
    setDecisoes((d) => {
      const novo = { ...d };
      if (tipo) novo[k] = { tipo, a: a.assinatura, b: b.assinatura, rotulo: `${a.nome} × ${b.nome}` };
      else delete novo[k];
      return novo;
    });
  }

  async function enviar() {
    setEnviando(true);
    setMensagem(null);
    const lista = Object.entries(decisoes);
    try {
      await enviarArquivo(
        'juncoes.json',
        (j) => {
          const atual: { juntar: [string, string][]; diferentes: [string, string][] } = { juntar: [], diferentes: [], ...(j ?? {}) };
          const ja = new Set([...atual.juntar, ...atual.diferentes].map(([a, b]) => par(a, b)));
          for (const [k, d] of lista) {
            // A decisão nova vale: tira o par da lista oposta, se estiver lá.
            const oposta = d.tipo === 'juntar' ? 'diferentes' : 'juntar';
            atual[oposta] = atual[oposta].filter(([a, b]) => par(a, b) !== k);
            if (!ja.has(k) || !atual[d.tipo].some(([a, b]) => par(a, b) === k)) atual[d.tipo].push([d.a, d.b]);
          }
          return atual;
        },
        `Junção de produtos: ${lista.length} ${lista.length === 1 ? 'decisão' : 'decisões'}`,
      );
      setEnviadas((e) => ({ ...e, ...Object.fromEntries(lista.map(([k]) => [k, true as const])) }));
      setDecisoes({});
      setMensagem('Enviado! A comparação atualiza em 1 ou 2 minutos.');
    } catch (e) {
      setMensagem(`Não foi enviado: ${(e as Error).message}`);
    }
    setEnviando(false);
  }

  return (
    <>
      <p className="apoio">
        Produtos com a <strong>mesma marca e o mesmo tamanho</strong> que o app não teve certeza se são iguais. Juntar faz
        os mercados entrarem na mesma comparação.
      </p>
      <div className="filtros-revisao">
        <button className={ver === 'sugestoes' ? 'chip hoje' : 'chip neutro'} onClick={() => setVer('sugestoes')}>
          Talvez iguais ({sugestoes.length})
        </button>
        <button className={ver === 'juntos' ? 'chip hoje' : 'chip neutro'} onClick={() => setVer('juntos')}>
          Já juntos ({juntos.length})
        </button>
      </div>

      {!dados && <p className="apoio">Carregando…</p>}

      {ver === 'sugestoes' &&
        sugestoes.slice(0, 80).map((s) => {
          const d = decisoes[par(s.a.assinatura, s.b.assinatura)];
          return (
            <article key={par(s.a.assinatura, s.b.assinatura)} className={`cartao item-revisao${d ? (d.tipo === 'juntar' ? ' marcado-confirmar' : ' marcado-remover') : ''}`}>
              <span className="chip neutro" style={{ alignSelf: 'flex-start' }}>{s.a.marca} · {s.a.tamanho}</span>
              <div className="par-juncao">
                <LadoProduto r={s.a} />
                <span className="versus">×</span>
                <LadoProduto r={s.b} />
              </div>
              {d ? (
                <div className="acoes-revisao">
                  <span className="apoio" style={{ flex: 1 }}>{d.tipo === 'juntar' ? '🔗 Vão ser o mesmo produto' : '↔️ Ficam separados'} (falta enviar)</span>
                  <button className="botao pequeno" onClick={() => decidir(null, s.a, s.b)}>Desfazer</button>
                </div>
              ) : (
                <div className="acoes-revisao">
                  <button className="botao pequeno primario" onClick={() => decidir('juntar', s.a, s.b)}>🔗 São o mesmo</button>
                  <button className="botao pequeno" onClick={() => decidir('diferentes', s.a, s.b)}>↔️ São diferentes</button>
                </div>
              )}
            </article>
          );
        })}

      {ver === 'juntos' &&
        juntos.slice(0, 80).map((g) => (
          <article key={g.produto} className="cartao item-revisao">
            <span className="chip neutro" style={{ alignSelf: 'flex-start' }}>{g.itens[0].marca || 'sem marca'} · {g.itens[0].tamanho || 'sem tamanho'}</span>
            <p className="apoio">O app trata como o mesmo produto:</p>
            {g.itens.map((i, idx) => {
              const d = idx > 0 ? decisoes[par(g.itens[0].assinatura, i.assinatura)] : undefined;
              return (
                <div key={i.assinatura} className="linha-junto">
                  <LadoProduto r={i} />
                  {idx > 0 &&
                    (d ? (
                      <button className="botao pequeno" onClick={() => decidir(null, g.itens[0], i)}>
                        {d.tipo === 'diferentes' ? '↔️ Separar (desfazer)' : '✅ Certo (desfazer)'}
                      </button>
                    ) : (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button className="botao pequeno" onClick={() => decidir('juntar', g.itens[0], i)}>✅</button>
                        <button className="botao pequeno" onClick={() => decidir('diferentes', g.itens[0], i)}>↔️ Separar</button>
                      </span>
                    ))}
                </div>
              );
            })}
          </article>
        ))}

      <div style={{ height: 90 }} />
      <div className="barra-envio">
        {mensagem && <p className="apoio" style={{ marginBottom: 8 }}>{mensagem}</p>}
        <button className="botao primario bloco" disabled={!n || enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : n ? `Enviar ${n} ${n === 1 ? 'decisão' : 'decisões'}` : 'Nenhuma decisão para enviar'}
        </button>
      </div>
    </>
  );
}

function LadoProduto({ r }: { r: Resumo }) {
  return (
    <div className="lado-produto">
      <p style={{ fontWeight: 700 }}>{r.nome}</p>
      <p className="apoio">{r.mercados.map((m) => nomeMercado(m)).join(', ')}</p>
      {r.preco != null && Number.isFinite(r.preco) && <p className="numero">{formatarReais(r.preco)}</p>}
    </div>
  );
}
