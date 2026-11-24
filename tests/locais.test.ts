import { describe, expect, it } from 'vitest';
import { acharBairro, distanciaKm, encarteValePerto, formatarKm, idsDasLojas, lojaMaisPerto, ofertasPerto } from '../src/core/locais';
import type { Encarte, Loja, Oferta } from '../src/core/tipos';

const loja = (id: string, mercado: Loja['mercado'], nome: string, lat: number, lon: number): Loja => ({ id, mercado, nome, endereco: '', bairro: '', cidade: '', lat, lon });
const LOJAS: Loja[] = [
  loja('prezunic-barra', 'prezunic', 'Barra da Tijuca', -23.0067, -43.4394),
  loja('prezunic-penha', 'prezunic', 'Penha', -22.84, -43.28),
  loja('prezunic-caxias-centro', 'prezunic', 'Caxias Centro', -22.786, -43.311),
  loja('guanabara-1', 'guanabara', 'Tijuca', -22.925, -43.235),
];
const COPACABANA = { lat: -22.971, lon: -43.186 };
const PENHA = { lat: -22.842, lon: -43.282 };
const enc = (id: string, mercado: Encarte['mercado'], lojas: string[], lojasIds?: string[]): Encarte => ({
  id, mercado, titulo: '', inicio: '2026-11-13', fim: '2026-11-26', lojas, ...(lojasIds ? { lojasIds } : {}), fonte: '',
});

describe('distâncias', () => {
  it('Copacabana → Tijuca fica entre 7 e 9 km em linha reta', () => {
    const km = distanciaKm(COPACABANA, LOJAS[3]);
    expect(km).toBeGreaterThan(7);
    expect(km).toBeLessThan(9);
  });
  it('formata', () => {
    expect(formatarKm(3.24)).toBe('3,2 km');
    expect(formatarKm(12.6, true)).toBe('~13 km');
    expect(formatarKm(0.1)).toBe('menos de 1 km');
  });
  it('acha bairro sem acento e pelo começo do nome', () => {
    expect(acharBairro('meier')).toEqual({ lat: -22.902, lon: -43.279 });
    expect(acharBairro('Freguesia')).not.toBeNull();
    expect(acharBairro('Lugar Nenhum')).toBeNull();
  });
});

describe('encarte vale perto?', () => {
  const grupoA = enc('a', 'prezunic', ['Barra'], ['prezunic-barra']);
  const grupoB = enc('b', 'prezunic', ['Penha', 'Caxias Centro'], ['prezunic-penha', 'prezunic-caxias-centro']);
  const todas = enc('c', 'guanabara', []);
  const semLojasConhecidas = enc('d', 'mundial', []);

  it('encarte por grupo de lojas: só vale perto das lojas do grupo', () => {
    expect(encarteValePerto(grupoA, LOJAS, PENHA, 10)).toBe(false);
    expect(encarteValePerto(grupoB, LOJAS, PENHA, 10)).toBe(true);
    expect(lojaMaisPerto(grupoB, LOJAS, PENHA)?.loja.nome).toBe('Penha');
  });
  it('encarte sem lista = todas as lojas da rede', () => {
    expect(encarteValePerto(todas, LOJAS, COPACABANA, 10)).toBe(true);
    expect(encarteValePerto(todas, LOJAS, COPACABANA, 5)).toBe(false);
  });
  it('rede sem lojas conhecidas: não esconde a oferta', () => {
    expect(encarteValePerto(semLojasConhecidas, LOJAS, COPACABANA, 3)).toBe(true);
  });
  it('filtra as ofertas pelos encartes', () => {
    const mapa = new Map([grupoA, grupoB].map((e) => [e.id, e]));
    const o = (encarte: string) => ({ id: encarte, encarte }) as unknown as Oferta;
    expect(ofertasPerto([o('a'), o('b')], mapa, LOJAS, PENHA, 10).map((x) => x.encarte)).toEqual(['b']);
  });
});

describe('ids das lojas citadas no encarte', () => {
  it('casa "Barra" com "Barra da Tijuca" e ignora o que não conhece', () => {
    expect(idsDasLojas(['Barra', 'Caxias Centro', 'Park Shopping'], LOJAS, 'prezunic')).toEqual(['prezunic-barra', 'prezunic-caxias-centro']);
  });
});
