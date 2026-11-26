// Fotos dos produtos padronizadas: o robô baixa a foto publicada pelo mercado, tira o fundo branco (só o que encosta
// na borda, para não apagar partes brancas do produto), corta a sobra e centraliza num quadrado de 256 px com fundo
// transparente → public/fotos/<mercado>-<código>.webp. Só processa fotos novas; apaga as que saíram dos encartes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baixarArquivo } from '../src/coleta/http';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FOTOS = join(RAIZ, 'public/fotos');
mkdirSync(FOTOS, { recursive: true });

/** Arquivo padronizado de uma foto do Mundial (o código do produto vem no endereço). */
export function nomeFotoMundial(url: string): string | null {
  const m = url.match(/\/products\/(\w+)\//);
  return m ? `mundial-${m[1]}.webp` : null;
}

const brutos = readdirSync(join(RAIZ, 'data/brutos')).filter((f) => f.startsWith('mundial-site-')).sort();
const ultimo = brutos.pop();
const usadas = new Set<string>();
let novas = 0;
let falhas = 0;
if (ultimo) {
  const c = JSON.parse(readFileSync(join(RAIZ, 'data/brutos', ultimo), 'utf8'));
  const pasta = mkdtempSync(join(tmpdir(), 'fotos-'));
  try {
    for (const o of c.ofertas) {
      const url: string | undefined = o.product?.images?.[0]?.url;
      const nome = url && nomeFotoMundial(url);
      if (!url || !nome) continue;
      usadas.add(nome);
      if (existsSync(join(FOTOS, nome))) continue;
      try {
        const original = join(pasta, 'original');
        baixarArquivo(url, original);
        execFileSync('convert', [
          original, '-alpha', 'set', '-bordercolor', 'white', '-border', '1',
          '-fill', 'none', '-fuzz', '8%', '-draw', 'color 0,0 floodfill', '-shave', '1x1',
          '-trim', '+repage', '-resize', '240x240', '-background', 'none', '-gravity', 'center', '-extent', '256x256',
          '-quality', '80', join(FOTOS, nome),
        ]);
        novas++;
      } catch (e) {
        falhas++;
        console.log(`  foto não processada (${url}): ${(e as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}
let apagadas = 0;
for (const f of readdirSync(FOTOS)) {
  if (f.endsWith('.webp') && !usadas.has(f)) {
    rmSync(join(FOTOS, f));
    apagadas++;
  }
}
console.log(`Fotos: ${novas} novas, ${apagadas} apagadas, ${falhas} com erro, ${usadas.size} em uso.`);
