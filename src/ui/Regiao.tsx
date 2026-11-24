import { useState } from 'react';
import { BAIRROS, distanciaKm, formatarKm } from '../core/locais';
import type { MercadoId } from '../core/tipos';
import { LOJAS, nomeMercado } from '../dados';
import { useApp } from './contexto';
import { Icone } from './Icone';

const RAIOS = [3, 5, 10, 20];
const MERCADOS_COM_LOJAS: MercadoId[] = ['guanabara', 'mundial', 'prezunic', 'atacadao'];

/** Escolha da região: GPS do celular ou bairro, e o raio. Fica salvo só no aparelho. */
export function EditorRegiao() {
  const { regiao, definirRegiao, ofertasForaDaRegiao } = useApp();
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const raio = regiao?.raioKm ?? 10;

  function usarGps() {
    setErro(null);
    if (!('geolocation' in navigator)) {
      setErro('Este aparelho não informa a localização. Escolha o bairro abaixo.');
      return;
    }
    setBuscando(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBuscando(false);
        definirRegiao({ ponto: { lat: p.coords.latitude, lon: p.coords.longitude }, rotulo: 'Minha localização', raioKm: raio });
      },
      (e) => {
        setBuscando(false);
        setErro(
          e.code === e.PERMISSION_DENIED
            ? 'A localização foi negada. Você pode liberar nas configurações do navegador ou escolher o bairro abaixo.'
            : 'Não consegui pegar a localização agora. Tente de novo ou escolha o bairro abaixo.',
        );
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 },
    );
  }

  const bairros = Object.keys(BAIRROS).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button className="botao primario bloco" onClick={usarGps} disabled={buscando}>
        <Icone nome="local" /> {buscando ? 'Localizando…' : 'Usar minha localização'}
      </button>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="apoio">ou escolha o bairro / cidade</span>
        <select
          value={regiao && regiao.rotulo !== 'Minha localização' ? regiao.rotulo : ''}
          onChange={(e) => {
            const p = BAIRROS[e.target.value];
            if (p) definirRegiao({ ponto: p, rotulo: e.target.value, raioKm: raio });
          }}
          style={{ height: 48, borderRadius: 14, border: '1px solid var(--borda-forte)', padding: '0 12px', background: '#fff', fontSize: 16, color: 'var(--tinta)' }}
        >
          <option value="">Escolher…</option>
          {bairros.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>

      {erro && <div className="aviso">{erro}</div>}

      {regiao && (
        <>
          <div>
            <p className="apoio" style={{ marginBottom: 6 }}>Mostrar lojas a até:</p>
            <div className="rolagem-h" role="group" aria-label="Distância máxima">
              {RAIOS.map((r) => (
                <button key={r} className="filtro" aria-pressed={raio === r} onClick={() => definirRegiao({ ...regiao, raioKm: r })}>
                  {r} km
                </button>
              ))}
            </div>
          </div>

          <div className="cartao" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>Lojas mais perto de {regiao.rotulo === 'Minha localização' ? 'você' : regiao.rotulo}</span>
            {MERCADOS_COM_LOJAS.map((m) => {
              let melhor: { nome: string; km: number; aprox: boolean } | null = null;
              for (const l of LOJAS) {
                if (l.mercado !== m) continue;
                const km = distanciaKm(regiao.ponto, l);
                if (!melhor || km < melhor.km) melhor = { nome: l.nome, km, aprox: !!l.aproximada };
              }
              if (!melhor) return null;
              const longe = melhor.km > raio;
              return (
                <div key={m} className="linha" style={{ opacity: longe ? 0.6 : 1 }}>
                  <span className="cresce">
                    <strong>{nomeMercado(m)}</strong> <span className="apoio">· {melhor.nome}</span>
                  </span>
                  <span className={longe ? 'apoio' : 'chip'}>{formatarKm(melhor.km, melhor.aprox)}</span>
                </div>
              );
            })}
            {ofertasForaDaRegiao > 0 && (
              <p className="apoio">{ofertasForaDaRegiao} ofertas de lojas mais longe que {raio} km estão escondidas.</p>
            )}
            <p className="apoio" style={{ fontSize: 12 }}>"~" = posição aproximada da loja (centro do bairro).</p>
          </div>

          <button className="botao bloco" onClick={() => definirRegiao(null)}>
            Ver ofertas de todas as lojas
          </button>
        </>
      )}
      <p className="apoio" style={{ fontSize: 12 }}>Sua localização fica só neste aparelho. Não enviamos para lugar nenhum.</p>
    </div>
  );
}

/** Faixa do Início: mostra a região escolhida ou convida a escolher. */
export function ChipRegiao() {
  const { regiao, irPara } = useApp();
  return (
    <button className="cartao linha" onClick={() => irPara('perfil')} style={{ padding: '10px 14px' }}>
      <span style={{ color: 'var(--marinho)' }}>
        <Icone nome="local" />
      </span>
      {regiao ? (
        <span className="cresce">
          <strong>Perto de {regiao.rotulo === 'Minha localização' ? 'você' : regiao.rotulo}</strong>
          <span className="apoio"> · lojas a até {regiao.raioKm} km</span>
        </span>
      ) : (
        <span className="cresce">
          <strong>Onde você faz compras?</strong>
          <span className="apoio"> Escolha sua região para ver só as lojas perto de você.</span>
        </span>
      )}
      <span className="apoio" style={{ fontWeight: 600 }}>{regiao ? 'Alterar' : 'Escolher'}</span>
    </button>
  );
}

/** Loja mais perto de uma rede (qualquer loja), para mostrar na lista. */
export function lojaDaRedeMaisPerto(mercado: MercadoId, ponto: { lat: number; lon: number }) {
  let melhor: { nome: string; km: number; aprox: boolean } | null = null;
  for (const l of LOJAS) {
    if (l.mercado !== mercado) continue;
    const km = distanciaKm(ponto, l);
    if (!melhor || km < melhor.km) melhor = { nome: l.nome, km, aprox: !!l.aproximada };
  }
  return melhor;
}
