// Painel de revisão (só do dono): abre em <app>/#revisao.
// Mostra as ofertas lidas de imagem (IA ou à mão) dos encartes válidos, com a página do encarte ao lado.
// As correções são gravadas direto nos arquivos de data/curadoria no GitHub (com o token do dono, guardado só no
// aparelho dele). Cada envio vira um commit; a Vercel republica o app em ~1 minuto.
import { useEffect, useMemo, useState } from 'react';
import { formatarReais } from '../../core/texto';
import { nomeMercado } from '../../dados';
import type { MercadoId } from '../../core/tipos';
import { RevisaoJuncoes } from './RevisaoJuncoes';

const REPO = 'milhardod-ship-it/radar-de-encartes';
const CHAVE_TOKEN = 'radar:revisao:token';
const CHAVE_PENDENTES = 'radar:revisao:pendentes:v1';
const CHAVE_ENVIADOS = 'radar:revisao:enviados:v1';

interface ItemCuradoria {
  nome: string;
  marcas: string[];
  tamanho: string;
  preco: number;
  de?: number;
  clube?: number;
  soClube?: boolean;
  condicao?: string;
  duvida?: string;
  pagina?: number;
  revisado?: boolean;
  removido?: boolean;
  [outro: string]: unknown;
}

interface EntradaRevisao {
  arquivo: string;
  indice: number;
  mercado: MercadoId;
  encarte: string;
  titulo: string;
  inicio: string;
  fim: string;
  imagem?: string;
  item: ItemCuradoria;
}

type Acao = { tipo: 'confirmar' } | { tipo: 'remover' } | { tipo: 'corrigir'; item: ItemCuradoria };

const chaveDe = (e: { arquivo: string; indice: number }) => `${e.arquivo}#${e.indice}`;

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
    /* sem armazenamento: segue só na memória */
  }
}

// ---- GitHub (conteúdo de arquivo em base64 com acentos)
function paraBase64(texto: string): string {
  const bytes = new TextEncoder().encode(texto);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function deBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
}
async function github(token: string, caminho: string, init?: RequestInit) {
  const r = await fetch(`https://api.github.com${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}${r.status === 401 ? ' (token inválido ou vencido)' : r.status === 409 ? ' (o arquivo mudou; tente de novo)' : ''}`);
  return r.json();
}

/** Lê data/<arquivo> no GitHub (pode não existir), aplica `mudar` e grava num commit. */
async function gravarArquivoDados(token: string, arquivo: string, mudar: (dados: any) => any, mensagem: string) {
  const caminho = `/repos/${REPO}/contents/data/${arquivo}`;
  let atual: { content: string; sha: string } | null = null;
  try {
    atual = await github(token, `${caminho}?ref=main`);
  } catch (e) {
    if (!String((e as Error).message).includes('404')) throw e;
  }
  const dados = mudar(atual ? JSON.parse(deBase64(atual.content)) : null);
  await github(token, caminho, {
    method: 'PUT',
    body: JSON.stringify({
      message: mensagem,
      content: paraBase64(JSON.stringify(dados, null, 1) + '\n'),
      ...(atual ? { sha: atual.sha } : {}),
      branch: 'main',
    }),
  });
}

/** Aplica as ações num arquivo de curadoria e grava no GitHub (um commit por arquivo). */
async function enviarArquivo(token: string, arquivo: string, acoes: [number, Acao][]) {
  const caminho = `/repos/${REPO}/contents/data/curadoria/${arquivo}`;
  const atual = await github(token, `${caminho}?ref=main`);
  const dados = JSON.parse(deBase64(atual.content)) as { itens: ItemCuradoria[] };
  for (const [indice, acao] of acoes) {
    const it = dados.itens[indice];
    if (!it) continue;
    if (acao.tipo === 'remover') dados.itens[indice] = { ...it, removido: true, revisado: true };
    else if (acao.tipo === 'confirmar') {
      const { duvida: _d, ...resto } = it;
      dados.itens[indice] = { ...resto, revisado: true };
    } else {
      const { duvida: _d, ...resto } = acao.item;
      dados.itens[indice] = { ...resto, pagina: it.pagina, revisado: true };
    }
  }
  const n = acoes.length;
  await github(token, caminho, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Revisão: ${n} ${n === 1 ? 'oferta' : 'ofertas'} em ${arquivo.replace('.json', '')}`,
      content: paraBase64(JSON.stringify(dados, null, 1) + '\n'),
      sha: atual.sha,
      branch: 'main',
    }),
  });
}

// ---- Números com vírgula
const lerNumero = (t: string): number | undefined => {
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  return t.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
};
const mostrarNumero = (n?: number) => (n == null ? '' : String(n).replace('.', ','));

export function Revisao() {
  const [token, setToken] = useState<string>(() => lerLocal(CHAVE_TOKEN, ''));
  const [entradas, setEntradas] = useState<EntradaRevisao[] | null>(null);
  const [pendentes, setPendentes] = useState<Record<string, Acao>>(() => lerLocal(CHAVE_PENDENTES, {}));
  const [enviados, setEnviados] = useState<Record<string, string>>(() => lerLocal(CHAVE_ENVIADOS, {}));
  const [mostrar, setMostrar] = useState<'duvida' | 'todas'>('duvida');
  const [mercado, setMercado] = useState<MercadoId | ''>('');
  const [busca, setBusca] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [aba, setAba] = useState<'ofertas' | 'juncoes'>('ofertas');

  useEffect(() => {
    // Carregado só aqui: os clientes do app nunca baixam este arquivo.
    import('../../../data/revisao.json').then((m) => setEntradas(m.default as unknown as EntradaRevisao[]));
  }, []);
  useEffect(() => gravarLocal(CHAVE_PENDENTES, pendentes), [pendentes]);
  useEffect(() => gravarLocal(CHAVE_ENVIADOS, enviados), [enviados]);

  const mercados = useMemo(() => [...new Set((entradas ?? []).map((e) => e.mercado))], [entradas]);
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (entradas ?? []).filter((e) => {
      const k = chaveDe(e);
      if (e.item.removido || enviados[k]) return false;
      if (mostrar === 'duvida' && (!e.item.duvida || e.item.revisado)) return false;
      if (mercado && e.mercado !== mercado) return false;
      if (termo && !`${e.item.nome} ${e.item.marcas.join(' ')}`.toLowerCase().includes(termo)) return false;
      return true;
    });
  }, [entradas, enviados, mostrar, mercado, busca]);
  const totalDuvidas = (entradas ?? []).filter((e) => e.item.duvida && !e.item.revisado && !e.item.removido && !enviados[chaveDe(e)]).length;
  const nPendentes = Object.keys(pendentes).length;

  function marcar(k: string, acao: Acao | null) {
    setPendentes((p) => {
      const novo = { ...p };
      if (acao) novo[k] = acao;
      else delete novo[k];
      return novo;
    });
    setEditando(null);
  }

  async function enviar() {
    setEnviando(true);
    setMensagem(null);
    const porArquivo = new Map<string, [number, Acao][]>();
    for (const [k, acao] of Object.entries(pendentes)) {
      const [arquivo, indice] = k.split('#');
      porArquivo.set(arquivo, [...(porArquivo.get(arquivo) ?? []), [Number(indice), acao]]);
    }
    const erros: string[] = [];
    for (const [arquivo, acoes] of porArquivo) {
      try {
        await enviarArquivo(token, arquivo, acoes);
        const agora = new Date().toISOString();
        setEnviados((e) => ({ ...e, ...Object.fromEntries(acoes.map(([i]) => [`${arquivo}#${i}`, agora])) }));
        setPendentes((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith(`${arquivo}#`))));
      } catch (e) {
        erros.push(`${arquivo}: ${(e as Error).message}`);
      }
    }
    setEnviando(false);
    setMensagem(
      erros.length
        ? `Algumas revisões não foram enviadas: ${erros.join('; ')}`
        : 'Enviado! O app atualiza sozinho em 1 ou 2 minutos.',
    );
  }

  if (!token) return <TelaToken aoSalvar={(t) => { setToken(t); gravarLocal(CHAVE_TOKEN, t); }} />;

  return (
    <div className="revisao">
      <header className="topo">
        <div className="barra-topo">
          <div className="cresce">
            <h1 className="titulo-tela">Painel de revisão</h1>
            <p className="subtitulo">{entradas ? `${totalDuvidas} a confirmar · ${entradas.length} ofertas lidas de imagem` : 'Carregando…'}</p>
          </div>
          <a className="botao-topo" href="#" aria-label="Voltar ao app" onClick={() => (location.hash = '')}>✕</a>
        </div>
      </header>

      <div className="abas-revisao" role="tablist">
        <button role="tab" aria-selected={aba === 'ofertas'} onClick={() => setAba('ofertas')}>Ofertas</button>
        <button role="tab" aria-selected={aba === 'juncoes'} onClick={() => setAba('juncoes')}>Juntar produtos</button>
      </div>

      {aba === 'juncoes' ? (
        <section className="secao">
          <RevisaoJuncoes enviarArquivo={(arquivo, mudar, msg) => gravarArquivoDados(token, arquivo, mudar, msg)} />
        </section>
      ) : (
      <>
      <section className="secao">
        <div className="filtros-revisao">
          <button className={mostrar === 'duvida' ? 'chip hoje' : 'chip neutro'} onClick={() => setMostrar('duvida')}>A confirmar</button>
          <button className={mostrar === 'todas' ? 'chip hoje' : 'chip neutro'} onClick={() => setMostrar('todas')}>Todas</button>
          <select value={mercado} onChange={(e) => setMercado(e.target.value as MercadoId | '')} aria-label="Mercado">
            <option value="">Todos os mercados</option>
            {mercados.map((m) => <option key={m} value={m}>{nomeMercado(m)}</option>)}
          </select>
        </div>
        <input className="campo" type="search" placeholder="Buscar produto ou marca" value={busca} onChange={(e) => setBusca(e.target.value)} />

        {entradas && visiveis.length === 0 && (
          <p className="apoio" style={{ textAlign: 'center', padding: 24 }}>
            {mostrar === 'duvida' ? 'Nada a confirmar por aqui. 🎉' : 'Nenhuma oferta com esse filtro.'}
          </p>
        )}

        {visiveis.slice(0, 150).map((e) => {
          const k = chaveDe(e);
          const acao = pendentes[k];
          const it = acao?.tipo === 'corrigir' ? acao.item : e.item;
          return (
            <article key={k} className={`cartao item-revisao${acao ? ` marcado-${acao.tipo}` : ''}`}>
              <div className="cabeca-revisao">
                <span className="chip neutro">{nomeMercado(e.mercado)}{it.pagina ? ` · pág. ${it.pagina}` : ''}</span>
                {e.imagem && (
                  <a href={`/${e.imagem}`} target="_blank" rel="noreferrer" className="link-pagina">Ver página do encarte ↗</a>
                )}
              </div>
              {e.imagem && (
                <a href={`/${e.imagem}`} target="_blank" rel="noreferrer">
                  <img className="miniatura-pagina" src={`/${e.imagem}`} alt={`Página ${it.pagina} do encarte`} loading="lazy" />
                </a>
              )}
              <p style={{ fontWeight: 700 }}>{it.nome}</p>
              <p className="apoio">{[it.marcas.join(', '), it.tamanho].filter(Boolean).join(' · ')}</p>
              <p>
                <span className="numero" style={{ fontSize: 20 }}>{formatarReais(it.preco)}</span>
                {it.soClube && <span className="chip com-app" style={{ marginLeft: 8 }}>só clube/app</span>}
                {it.de && <span className="preco-de" style={{ marginLeft: 8 }}>{formatarReais(it.de)}</span>}
                {it.clube && <span className="apoio"> · {formatarReais(it.clube)} no clube/app</span>}
              </p>
              {it.condicao && <p className="apoio">{it.condicao}</p>}
              {e.item.duvida && !acao && <p className="aviso-duvida">Dúvida da leitura: {e.item.duvida}</p>}

              {acao ? (
                <div className="acoes-revisao">
                  <span className="apoio" style={{ flex: 1 }}>
                    {acao.tipo === 'confirmar' ? '✅ Marcado como certo' : acao.tipo === 'remover' ? '🗑 Vai sair do app' : '✏️ Corrigido'} (falta enviar)
                  </span>
                  <button className="botao pequeno" onClick={() => marcar(k, null)}>Desfazer</button>
                </div>
              ) : editando === k ? (
                <Formulario item={e.item} aoCancelar={() => setEditando(null)} aoSalvar={(novo) => marcar(k, { tipo: 'corrigir', item: novo })} />
              ) : (
                <div className="acoes-revisao">
                  <button className="botao pequeno primario" onClick={() => marcar(k, { tipo: 'confirmar' })}>✅ Está certo</button>
                  <button className="botao pequeno" onClick={() => setEditando(k)}>✏️ Corrigir</button>
                  <button className="botao pequeno" onClick={() => marcar(k, { tipo: 'remover' })}>🗑 Tirar</button>
                </div>
              )}
            </article>
          );
        })}
        {visiveis.length > 150 && <p className="apoio">Mostrando 150 de {visiveis.length}. Use a busca ou o filtro de mercado.</p>}
        <div style={{ height: 90 }} />
      </section>

      <div className="barra-envio">
        {mensagem && <p className="apoio" style={{ marginBottom: 8 }}>{mensagem}</p>}
        <button className="botao primario bloco" disabled={!nPendentes || enviando} onClick={enviar}>
          {enviando ? 'Enviando…' : nPendentes ? `Enviar ${nPendentes} ${nPendentes === 1 ? 'revisão' : 'revisões'}` : 'Nenhuma revisão para enviar'}
        </button>
      </div>
      </>
      )}
    </div>
  );
}

function Formulario({ item, aoSalvar, aoCancelar }: { item: ItemCuradoria; aoSalvar: (i: ItemCuradoria) => void; aoCancelar: () => void }) {
  const [nome, setNome] = useState(item.nome);
  const [marcas, setMarcas] = useState(item.marcas.join(', '));
  const [tamanho, setTamanho] = useState(item.tamanho);
  const [preco, setPreco] = useState(mostrarNumero(item.preco));
  const [de, setDe] = useState(mostrarNumero(item.de));
  const [clube, setClube] = useState(mostrarNumero(item.clube));
  const [soClube, setSoClube] = useState(!!item.soClube);
  const [condicao, setCondicao] = useState(item.condicao ?? '');
  const valor = lerNumero(preco);

  function salvar() {
    if (!valor || !nome.trim()) return;
    const novo: ItemCuradoria = { ...item, nome: nome.trim(), marcas: marcas.split(',').map((m) => m.trim()).filter(Boolean), tamanho: tamanho.trim(), preco: valor };
    for (const [campo, v] of [['de', lerNumero(de)], ['clube', lerNumero(clube)]] as const) {
      if (v) novo[campo] = v;
      else delete novo[campo];
    }
    if (soClube) novo.soClube = true;
    else delete novo.soClube;
    if (condicao.trim()) novo.condicao = condicao.trim();
    else delete novo.condicao;
    aoSalvar(novo);
  }

  return (
    <div className="form-revisao">
      <label>Produto<input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      <label>Marcas (separe por vírgula)<input className="campo" value={marcas} onChange={(e) => setMarcas(e.target.value)} /></label>
      <label>Tamanho<input className="campo" value={tamanho} onChange={(e) => setTamanho(e.target.value)} placeholder="ex.: 5kg, 1L, kg" /></label>
      <div className="linha-campos">
        <label>Preço<input className="campo" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} /></label>
        <label>De (riscado)<input className="campo" inputMode="decimal" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label>Clube/app<input className="campo" inputMode="decimal" value={clube} onChange={(e) => setClube(e.target.value)} /></label>
      </div>
      <label className="opcao" style={{ padding: 0 }}>
        <input type="checkbox" checked={soClube} onChange={(e) => setSoClube(e.target.checked)} />
        <span>O encarte só mostra o preço do clube/app</span>
      </label>
      <label>Condição<input className="campo" value={condicao} onChange={(e) => setCondicao(e.target.value)} placeholder="ex.: leve 3, pague 2" /></label>
      <div className="acoes-revisao">
        <button className="botao pequeno primario" disabled={!valor || !nome.trim()} onClick={salvar}>Guardar correção</button>
        <button className="botao pequeno" onClick={aoCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

function TelaToken({ aoSalvar }: { aoSalvar: (t: string) => void }) {
  const [t, setT] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);

  async function testar() {
    setTestando(true);
    setErro(null);
    try {
      const repo = await github(t.trim(), `/repos/${REPO}`);
      if (!repo.permissions?.push) throw new Error('o token não tem permissão de escrita neste repositório');
      aoSalvar(t.trim());
    } catch (e) {
      setErro((e as Error).message);
    }
    setTestando(false);
  }

  return (
    <div className="revisao">
      <header className="topo">
        <div className="barra-topo">
          <div className="cresce">
            <h1 className="titulo-tela">Painel de revisão</h1>
            <p className="subtitulo">Acesso do dono</p>
          </div>
          <a className="botao-topo" href="#" aria-label="Voltar ao app" onClick={() => (location.hash = '')}>✕</a>
        </div>
      </header>
      <section className="secao">
        <p>
          Para gravar as correções, o painel precisa de um <strong>token do GitHub</strong> com permissão só neste
          repositório. Ele fica guardado apenas neste aparelho.
        </p>
        <input className="campo" type="password" autoComplete="off" placeholder="Cole o token aqui (github_pat_…)" value={t} onChange={(e) => setT(e.target.value)} />
        {erro && <p className="aviso-duvida">Não deu certo: {erro}</p>}
        <button className="botao primario bloco" disabled={!t.trim() || testando} onClick={testar}>
          {testando ? 'Conferindo…' : 'Entrar'}
        </button>
      </section>
    </div>
  );
}
