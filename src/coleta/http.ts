// Download simples via curl (respeita o proxy da máquina e funciona igual no GitHub Actions).
import { execFileSync } from 'node:child_process';

const AGENTE = 'Mozilla/5.0 (compatible; RadarDeEncartes/0.1; coleta de encartes publicos)';

export type Baixar = (url: string) => string;

/** Baixa uma página como texto. Tenta de novo até 3 vezes; espera entre pedidos para não sobrecarregar o site. */
export function criarBaixar(pausaMs = 1200): Baixar {
  let ultimo = 0;
  return (url: string) => {
    for (let tentativa = 1; ; tentativa++) {
      const espera = ultimo + pausaMs - Date.now();
      if (espera > 0) dormir(espera);
      ultimo = Date.now();
      try {
        return execFileSync('curl', ['-sSL', '--fail', '-m', '40', '-A', AGENTE, url], {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
      } catch (e) {
        if (tentativa >= 3) throw new Error(`Falha ao baixar ${url}: ${(e as Error).message.split('\n')[0]}`);
        dormir(2000 * tentativa);
      }
    }
  };
}

function dormir(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Baixa um arquivo binário (PDF) para o disco. */
/**
 * Baixa um arquivo. `comoNavegador` manda os cabeçalhos de um navegador comum vindo da página indicada; só usado no
 * Assaí, por decisão do dono (25/11), porque o servidor de imagens recusa o robô identificado. Poucas imagens por vez.
 */
export function baixarArquivo(url: string, destino: string, comoNavegador?: { pagina: string }) {
  const cabecalhos = comoNavegador
    ? ['-A', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
       '-e', comoNavegador.pagina, '-H', 'Accept: image/avif,image/webp,image/apng,image/*,*/*;q=0.8', '-H', 'Accept-Language: pt-BR,pt;q=0.9']
    : ['-A', AGENTE];
  for (let tentativa = 1; ; tentativa++) {
    try {
      execFileSync('curl', ['-sSL', '--fail', '-m', '180', ...cabecalhos, '-o', destino, url]);
      return;
    } catch (e) {
      if (tentativa >= 3) throw new Error(`Falha ao baixar ${url}: ${(e as Error).message.split('\n')[0]}`);
      dormir(3000 * tentativa);
    }
  }
}
