import { useMemo } from 'react';
import { descontoPercentual, ehSoHoje, precoParaTodos } from '../../core/precos';
import { mercadosDistintos } from '../../core/produtos';
import { CATEGORIAS } from '../../core/tipos';
import { MAPA_ENCARTES } from '../../dados';
import { CartaoOferta, LinhaProduto, Topo, dataCurta } from '../componentes';
import { useApp } from '../contexto';
import { Icone, IconeCategoria } from '../Icone';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function Inicio() {
  const { hoje, ofertas, produtos, irPara } = useApp();

  const soHoje = useMemo(() => ofertas.filter((o) => ehSoHoje(o, MAPA_ENCARTES, hoje)), [ofertas, hoje]);

  const descontos = useMemo(() => {
    const vistos = new Set<string>();
    return ofertas
      .map((o) => ({ o, d: descontoPercentual(o) ?? 0 }))
      .filter((x) => x.d >= 15 && !ehSoHoje(x.o, MAPA_ENCARTES, hoje))
      .sort((a, b) => b.d - a.d)
      .filter((x) => !vistos.has(x.o.produto) && vistos.add(x.o.produto))
      .slice(0, 8);
  }, [ofertas, hoje]);

  const comparaveis = useMemo(
    () => [...produtos.values()].filter((p) => mercadosDistintos(p) > 1).sort((a, b) => a.nome.localeCompare(b.nome)),
    [produtos],
  );

  const dia = new Date(`${hoje}T12:00:00`);

  return (
    <>
      <Topo marca>
        <button className="busca" onClick={() => irPara('buscar', { focarBusca: true })}>
          <Icone nome="buscar" tamanho={22} grosso />
          <span>Quanto tá o… arroz, café, frango</span>
        </button>
      </Topo>

      {soHoje.length > 0 && (
        <section className="secao">
          <div className="linha">
            <span className="chip hoje">
              <Icone nome="relogio" tamanho={18} grosso /> Só hoje
            </span>
            <span className="apoio" style={{ fontSize: 15 }}>
              {DIAS[dia.getDay()]}, {dataCurta(hoje)}
            </span>
          </div>
          <div className="grade-2">
            {soHoje.map((o) => (
              <CartaoOferta key={o.id} oferta={o} valor={precoParaTodos(o)?.valor ?? 0} />
            ))}
          </div>
        </section>
      )}

      {descontos.length > 0 && (
        <section className="secao">
          <h2 className="titulo-secao">
            <Icone nome="etiqueta" tamanho={26} grosso /> Maiores descontos
          </h2>
          <div className="grade-2">
            {descontos.map(({ o, d }) => (
              <CartaoOferta key={o.id} oferta={o} valor={precoParaTodos(o)?.valor ?? 0} destaque={`−${d}%`} />
            ))}
          </div>
        </section>
      )}

      <section className="secao">
        <h2 className="titulo-secao">Categorias</h2>
        <div className="grade-3">
          {CATEGORIAS.map((c) => (
            <button
              key={c}
              className="cartao"
              onClick={() => irPara('buscar', { categoria: c })}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 6px', color: 'var(--marinho)', fontWeight: 600, fontSize: 13, textAlign: 'center' }}
            >
              <IconeCategoria categoria={c} tamanho={30} />
              {c}
            </button>
          ))}
        </div>
      </section>

      {comparaveis.length > 0 && (
        <section className="secao">
          <h2 className="titulo-secao">Dá para comparar</h2>
          <p className="apoio">{comparaveis.length} produtos estão no encarte de mais de um mercado.</p>
          {comparaveis.map((p) => (
            <LinhaProduto key={p.id} produto={p} />
          ))}
        </section>
      )}

      {ofertas.length === 0 && (
        <div className="vazio">
          <p>
            Nenhum encarte válido hoje. Ative o “modo de teste” no Perfil para ver os encartes desta versão.
          </p>
        </div>
      )}
    </>
  );
}
