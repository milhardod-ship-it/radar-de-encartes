// Sonda: visita páginas de um mercado (como robô identificado, sem disfarce) e mostra o que existe nelas:
// status, escudo anti-robô, título, links de encarte/ofertas/lojas, PDFs, imagens grandes e dados embutidos.
// Uso: npm run sondar -- https://site1 https://site2   (roda no GitHub: workflow "Sondar site")
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const AGENTE = 'Mozilla/5.0 (compatible; RadarDeEncartes/0.1; coleta de encartes publicos)';
const urls = process.argv.slice(2);

function baixar(url: string): { status: string; cabecalhos: string; corpo: string } {
  try {
    const dir = mkdtempSync(join(tmpdir(), 'sonda-'));
    const arqC = join(dir, 'cab.txt');
    const arqB = join(dir, 'corpo.html');
    try {
      execFileSync('curl', ['-sSL', '-m', '40', '-A', AGENTE, '-D', arqC, '-o', arqB, url]);
    } catch {
      /* status de erro ainda deixa o cabeçalho para mostrar */
    }
    const cabecalhos = existsSync(arqC) ? readFileSync(arqC, 'utf8') : '';
    const corpo = existsSync(arqB) ? readFileSync(arqB, 'utf8') : '';
    rmSync(dir, { recursive: true, force: true });
    if (!cabecalhos) throw new Error('sem resposta (endereço não existe ou não respondeu)');
    const status = [...cabecalhos.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].map((m) => m[1]).join(' → ');
    return { status, cabecalhos, corpo };
  } catch (e) {
    return { status: 'ERRO ' + (e as Error).message.split('\n')[0], cabecalhos: '', corpo: '' };
  }
}

// Comparação especial: os encartes de TODAS as lojas do Dom Atacadista são iguais?
if (urls[0] === 'dom-lojas') {
  const dadosDe = (url: string) => {
    const { corpo } = baixar(url);
    const m = corpo.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    return m ? JSON.parse(m[1]).props.pageProps : null;
  };
  const lojas: { name: string; store: string }[] = dadosDe('https://domatacadista.net/hub-encartes')?.stores ?? [];
  console.log(`${lojas.length} lojas`);
  const porConjunto = new Map<string, string[]>();
  const descricao = new Map<string, string>();
  for (const l of lojas) {
    const pp = dadosDe(`https://domatacadista.net/encartes/lojas/${encodeURIComponent(l.store)}`);
    const encartes: { id: string; description: string; pages: { url: string }[] }[] = pp?.store?.encartes ?? [];
    for (const e of encartes) descricao.set(e.id, `${e.description} (${e.pages.length} pág.)`);
    const chave = encartes.map((e) => `${e.id}:${e.pages.map((p) => p.url.split('/').pop()).join(',')}`).sort().join(' | ') || '(nenhum)';
    porConjunto.set(chave, [...(porConjunto.get(chave) ?? []), l.name]);
  }
  console.log(`conjuntos diferentes de encartes: ${porConjunto.size}`);
  for (const [chave, nomes] of porConjunto) {
    const ids = chave === '(nenhum)' ? [] : chave.split(' | ').map((c) => c.split(':')[0]);
    console.log(`\n${nomes.length} lojas: ${nomes.join(', ')}`);
    console.log(`  encartes: ${ids.map((i) => `${i} ${descricao.get(i)}`).join('; ') || 'nenhum'}`);
  }
  process.exit(0);
}

for (const url of urls) {
  console.log(`\n================ ${url}`);
  const { status, cabecalhos, corpo } = baixar(url);
  console.log(`status: ${status} · ${corpo.length} bytes`);
  const escudo = /cf-ray|cloudflare/i.test(cabecalhos) && /just a moment|challenge/i.test(corpo)
    ? 'Cloudflare (desafio)'
    : /incapsula|_incap_/i.test(cabecalhos + corpo) ? 'Incapsula' : /captcha/i.test(corpo) ? 'captcha' : 'nenhum visível';
  console.log(`escudo: ${escudo}`);
  console.log(`servidor: ${(cabecalhos.match(/^server: .*/im) ?? [''])[0]} ${(cabecalhos.match(/^x-powered-by: .*/im) ?? [''])[0]}`);
  console.log(`título: ${(corpo.match(/<title[^>]*>([^<]*)/i) ?? ['', ''])[1].trim()}`);
  const plataforma = [
    /__NEXT_DATA__/.test(corpo) && 'Next.js (__NEXT_DATA__)',
    /vtex/i.test(corpo) && 'VTEX',
    /wp-content|wp-json/.test(corpo) && 'WordPress',
    /shopify/i.test(corpo) && 'Shopify',
    /tabloide|tabloidi/i.test(corpo) && 'menciona tabloide',
    /issuu/i.test(corpo) && 'Issuu',
    /flipsnack|flipbook|publuu|yumpu|calameo/i.test(corpo) && 'leitor de revista digital',
  ].filter(Boolean);
  console.log(`plataforma/pistas: ${plataforma.join(', ') || '—'}`);
  const links = [...new Set([...corpo.matchAll(/(?:href|src|data-src)=["']([^"']+)["']/gi)].map((m) => m[1]))];
  const interessa = links.filter((l) => /encarte|oferta|tabloide|folheto|promo|loja|unidade|\.pdf|issuu|flip|catalog/i.test(l));
  console.log(`links interessantes (${interessa.length}):`);
  for (const l of interessa.slice(0, 60)) console.log(`  ${l}`);
  const todasImagens = links.filter((l) => /\.(jpe?g|png|webp)(\?|$)/i.test(l));
  console.log(`imagens na página (${todasImagens.length}): ${todasImagens.slice(0, 40).join(' | ')}`);
  const imagens = links.filter((l) => /\.(jpe?g|png|webp)(\?|$)/i.test(l) && /encarte|oferta|tabloide|folheto|promo/i.test(l));
  if (imagens.length) console.log(`imagens de encarte: ${imagens.slice(0, 15).join(' | ')}`);
  const next = corpo.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (next) {
    const dados = JSON.parse(next[1]);
    const pp = dados.props?.pageProps ?? {};
    console.log(`__NEXT_DATA__ pageProps: ${Object.keys(pp).join(', ')}`);
    const semIcones = JSON.stringify(pp, (k, v) => (k === 'icon' ? undefined : v));
    console.log(`  amostra: ${semIcones.slice(0, 6000)}`);
  }
  const textoVisivel = corpo.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  console.log(`texto (início): ${textoVisivel.slice(0, 600)}`);
  const trechos = [...corpo.matchAll(/encarte|ajax|tabloide|folheto|\.pdf|admin-ajax|wp-json\/[a-z]/gi)].slice(0, 25);
  if (trechos.length) {
    console.log('trechos com pistas:');
    for (const m of trechos) console.log(`  …${corpo.slice(Math.max(0, m.index! - 120), m.index! + 160).replace(/\s+/g, ' ')}…`);
  }
  // Programação da página: de onde ela busca dados depois de abrir (fetch, ajax, endereços .json/.php)
  const scripts = [...corpo.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const externos = scripts.map((m) => (m[1].match(/src=["']([^"']+)/) ?? [])[1]).filter(Boolean);
  console.log(`scripts externos (${externos.length}): ${externos.join(' | ')}`);
  for (const m of scripts) {
    const js = m[2];
    for (const p of js.matchAll(/fetch\(|\$\.(ajax|get|post)\(|XMLHttpRequest|admin-ajax|wp-json|\.json|encarte/gi)) {
      console.log(`  js: …${js.slice(Math.max(0, p.index! - 200), p.index! + 300).replace(/\s+/g, ' ')}…`);
    }
  }
  for (const m of corpo.matchAll(/([A-Z_]{4,})\s*=\s*(\[[^\]]{0,4000}\])/g)) console.log(`lista ${m[1]}: ${m[2].replace(/\s+/g, ' ').slice(0, 3000)}`);
  for (const m of corpo.matchAll(/ENCARTE_PAGES|encartePages|encarte_pages/g)) console.log(`  def: …${corpo.slice(Math.max(0, m.index! - 300), m.index! + 1500).replace(/\s+/g, ' ')}…`);
  const apis = [...new Set([...corpo.matchAll(/https?:\/\/[^"'\s<>]*(?:api|graphql|json)[^"'\s<>]*/gi)].map((m) => m[0]))];
  if (apis.length) console.log(`endereços de API/JSON: ${apis.slice(0, 20).join(' | ')}`);
}
