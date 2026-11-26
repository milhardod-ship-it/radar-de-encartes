// Sonda: visita páginas de um mercado (como robô identificado, sem disfarce) e mostra o que existe nelas:
// status, escudo anti-robô, título, links de encarte/ofertas/lojas, PDFs, imagens grandes e dados embutidos.
// Uso: npm run sondar -- https://site1 https://site2   (roda no GitHub: workflow "Sondar site")
import { execFileSync } from 'node:child_process';

const AGENTE = 'Mozilla/5.0 (compatible; RadarDeEncartes/0.1; coleta de encartes publicos)';
const urls = process.argv.slice(2);

function baixar(url: string): { status: string; cabecalhos: string; corpo: string } {
  try {
    const saida = execFileSync('curl', ['-sSL', '-m', '40', '-A', AGENTE, '-D', '-', '-o', '/dev/stdout', url], {
      maxBuffer: 50 * 1024 * 1024,
    }).toString('utf8');
    const partes = saida.split(/\r?\n\r?\n/);
    // pode haver vários blocos de cabeçalho (redirecionamentos)
    let i = 0;
    while (i < partes.length - 1 && /^HTTP\//.test(partes[i + 1] ?? '')) i++;
    const cabecalhos = partes.slice(0, i + 1).join('\n');
    const corpo = partes.slice(i + 1).join('\n\n');
    const status = [...cabecalhos.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].map((m) => m[1]).join(' → ');
    return { status, cabecalhos, corpo };
  } catch (e) {
    return { status: 'ERRO ' + (e as Error).message.split('\n')[0], cabecalhos: '', corpo: '' };
  }
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
  const imagens = links.filter((l) => /\.(jpe?g|png|webp)(\?|$)/i.test(l) && /encarte|oferta|tabloide|folheto|promo/i.test(l));
  if (imagens.length) console.log(`imagens de encarte: ${imagens.slice(0, 15).join(' | ')}`);
  const apis = [...new Set([...corpo.matchAll(/https?:\/\/[^"'\s<>]*(?:api|graphql|json)[^"'\s<>]*/gi)].map((m) => m[0]))];
  if (apis.length) console.log(`endereços de API/JSON: ${apis.slice(0, 20).join(' | ')}`);
}
