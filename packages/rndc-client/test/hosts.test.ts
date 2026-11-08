import { describe, expect, it } from 'vitest';
import { resolveUrl } from '../src/index.js';

describe('resolveUrl', () => {
  it('producción: remesa y manifiesto por rndcws2', () => {
    expect(resolveUrl('produccion', 1, 3)).toBe('http://rndcws2.mintransporte.gov.co:8080/soap/IBPMServices');
    expect(resolveUrl('produccion', 1, 4)).toContain('rndcws2');
  });
  it('producción: consultas por plc', () => {
    expect(resolveUrl('produccion', 3, 4)).toBe('http://plc.mintransporte.gov.co:8080/soap/IBPMServices');
  });
  it('producción: el resto (cumplidos, maestros) por rndcws', () => {
    for (const p of [5, 6, 11, 12]) expect(resolveUrl('produccion', 1, p)).toContain('//rndcws.mintransporte');
  });
  it('pruebas: un único host', () => {
    for (const [t, p] of [[1, 3], [3, 4], [1, 11]] as const) expect(resolveUrl('pruebas', t, p)).toContain('rndcpruebas');
  });
  it('respeta un host con esquema explícito (tests/proxy)', () => {
    expect(resolveUrl('pruebas', 1, 3, { expedir: 'http://127.0.0.1:9999', consultas: 'x', general: 'y' })).toBe('http://127.0.0.1:9999/soap/IBPMServices');
  });
});
