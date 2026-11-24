import { useState, type ReactNode } from 'react';
import { melhorPreco, menorPrecoPossivel } from '../core/precos';
import { mercadosDistintos, type Produto } from '../core/produtos';
import { formatarPorMedida, formatarReais, formatarTamanho } from '../core/texto';
import type { Categoria, Oferta, Perfil } from '../core/tipos';
import { nomeMercado } from '../dados';
import { useApp } from './contexto';
import { Icone, IconeCategoria, Logo } from './Icone';

/** Melhor oferta do produto para o perfil (e o mercado dela). */
export function melhorOfertaDoProduto(p: Produto, perfil: Perfil): { oferta: Oferta; valor: number; comApp: boolean } | null {
  let melhor: { oferta: Oferta; valor: number; comApp: boolean } | null = null;
  for (const o of p.ofertas) {
    const preco = melhorPreco(o, perfil);
    if (preco && (!melhor || preco.valor < melhor.valor)) melhor = { oferta: o, valor: preco.valor, comApp: preco.exige.length > 0 };
  }
  return melhor;
}

export function descricaoCurta(p: Pick<Produto, 'marca' | 'tamanho' | 'porKg'>): string {
  return [p.marca, formatarTamanho(p.tamanho, p.porKg)].filter(Boolean).join(' · ');
}

/**
 * Foto do produto (publicada pelo próprio mercado). Sem foto, ou se ela não carregar,
 * mostra o ícone da categoria.
 */
export function FotoProduto({ src, categoria, tamanhoIcone = 40 }: { src?: string; categoria: Categoria; tamanhoIcone?: number }) {
  const [falhou, setFalhou] = useState(false);
  if (!src || falhou) {
    return (
      <span className="foto-vazia">
        <IconeCategoria categoria={categoria} tamanho={tamanhoIcone} />
      </span>
    );
  }
  return (
    <img
      className="foto-produto"
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFalhou(true)}
    />
  );
}

/** Topo azul com a curva. `marca` mostra o logo e o nome do app (tela inicial). */
export function Topo({ titulo, subtitulo, marca, voltar, children }: { titulo?: string; subtitulo?: string; marca?: boolean; voltar?: boolean; children?: ReactNode }) {
  const { fecharProduto, irPara, avisar } = useApp();
  async function compartilhar() {
    const dados = { title: 'Radar de Encartes', text: 'Compare os encartes dos mercados do Rio e veja onde sua lista sai mais barata.', url: location.origin + location.pathname };
    try {
      if (navigator.share) await navigator.share(dados);
      else {
        await navigator.clipboard.writeText(dados.url);
        avisar('Link copiado');
      }
    } catch {
      /* usuário cancelou */
    }
  }
  return (
    <header className="topo">
      <div className="barra-topo">
        {voltar && (
          <button className="botao-topo" aria-label="Voltar" onClick={fecharProduto}>
            <Icone nome="voltar" tamanho={26} />
          </button>
        )}
        {marca ? (
          <>
            <Logo tamanho={58} claro />
            <span className="nome-app">
              Radar de
              <br />
              Encartes
            </span>
          </>
        ) : (
          <div className="cresce">
            <h1 className="titulo-tela">{titulo}</h1>
            {subtitulo && <p className="subtitulo">{subtitulo}</p>}
          </div>
        )}
        <button className="botao-topo" aria-label="Compartilhar o app" onClick={compartilhar}>
          <Icone nome="compartilhar" tamanho={24} />
        </button>
        {marca && (
          <button className="botao-topo" aria-label="Perfil e configurações" onClick={() => irPara('perfil')}>
            <Icone nome="menu" tamanho={26} grosso />
          </button>
        )}
      </div>
      {children}
    </header>
  );
}

/** Linha de produto em listas e resultados de busca. */
export function LinhaProduto({ produto }: { produto: Produto }) {
  const { perfil, abrirProduto } = useApp();
  const melhor = melhorOfertaDoProduto(produto, perfil);
  const n = mercadosDistintos(produto);
  const menorComApp = Math.min(...produto.ofertas.map((o) => menorPrecoPossivel(o)?.valor ?? Infinity));
  return (
    <button className="cartao linha" onClick={() => abrirProduto(produto.id)}>
      <span className="miniatura">
        <FotoProduto src={produto.imagem} categoria={produto.categoria} tamanhoIcone={28} />
      </span>
      <span className="cresce" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontWeight: 600 }}>{produto.nome}</span>
        <span className="apoio">{descricaoCurta(produto)}</span>
        {n > 1 && <span className="chip comparar" style={{ alignSelf: 'flex-start' }}>compare em {n} mercados</span>}
      </span>
      {!melhor && Number.isFinite(menorComApp) && (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <span className="numero" style={{ fontSize: 17 }}>{formatarReais(menorComApp)}</span>
          <span className="chip com-app">só com clube/app</span>
        </span>
      )}
      {melhor && (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
          <span className="numero" style={{ fontSize: 17 }}>{formatarReais(melhor.valor)}</span>
          <span className="apoio" style={{ fontSize: 12 }}>{formatarPorMedida(melhor.valor, produto.tamanho)}</span>
          <span className={melhor.comApp ? 'chip com-app' : 'chip'}>
            {nomeMercado(melhor.oferta.mercado)}
            {melhor.comApp ? ' · app' : ''}
          </span>
          {!melhor.comApp && menorComApp < melhor.valor - 0.001 && (
            <span className="apoio" style={{ fontSize: 12 }}>{formatarReais(menorComApp)} com app</span>
          )}
        </span>
      )}
    </button>
  );
}

/** Cartão de oferta com foto (Só hoje, descontos). */
export function CartaoOferta({ oferta, valor, destaque }: { oferta: Oferta; valor: number; destaque?: string }) {
  const { abrirProduto, produtos } = useApp();
  const foto = oferta.imagem ?? produtos.get(oferta.produto)?.imagem;
  return (
    <button className="cartao cartao-oferta" onClick={() => abrirProduto(oferta.produto)}>
      <span className="nome">
        {destaque && (
          <>
            <span className="chip desconto">{destaque}</span>
            <br />
          </>
        )}
        {oferta.nome}
      </span>
      <span className="info">
        <span className="apoio">{descricaoCurta(oferta)}</span>
        {oferta.precoDe && <span className="preco-de">{formatarReais(oferta.precoDe)}</span>}
      </span>
      <span className="foto">
        <FotoProduto src={foto} categoria={oferta.categoria} tamanhoIcone={38} />
      </span>
      <span className="numero preco">{formatarReais(valor)}</span>
      <span className="rodape">
        <span className="chip">{nomeMercado(oferta.mercado)}</span>
      </span>
    </button>
  );
}

export function dataCurta(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
