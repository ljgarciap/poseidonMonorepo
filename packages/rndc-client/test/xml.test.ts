import { describe, expect, it } from 'vitest';
import { buildRequestXml, escapeXml, renderElement, sanitizeRequestXml, RndcValidacionError } from '../src/index.js';

describe('renderElement', () => {
  it('omite undefined y cadenas vacías', () => {
    expect(renderElement('v', { A: 'x', B: undefined, C: '' })).toBe('<v><A>x</A></v>');
  });
  it('repite el elemento para arrays y soporta atributos con "@"', () => {
    const xml = renderElement('REMESASMAN', {
      '@procesoid': '43',
      REMESA: [{ CONSECUTIVOREMESA: 'TRUCKE1587' }, { CONSECUTIVOREMESA: 'TRUCKE1586' }],
    });
    expect(xml).toBe(
      '<REMESASMAN procesoid="43"><REMESA><CONSECUTIVOREMESA>TRUCKE1587</CONSECUTIVOREMESA></REMESA>' +
        '<REMESA><CONSECUTIVOREMESA>TRUCKE1586</CONSECUTIVOREMESA></REMESA></REMESASMAN>',
    );
  });
  it('rechaza nombres de elemento que permitirían inyección XML', () => {
    expect(() => renderElement('v', { 'A><evil': 'x' })).toThrow(RndcValidacionError);
    expect(() => renderElement('v', { '@a" b="c': 'x' })).toThrow(RndcValidacionError);
  });
  it('conserva números y ceros a la izquierda (como texto)', () => {
    expect(renderElement('v', { A: 1400, B: '0301' })).toBe('<v><A>1400</A><B>0301</B></v>');
  });
});

describe('escapeXml', () => {
  it('escapa caracteres reservados', () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
  });
  it('acepta acentos y ñ (ISO-8859-1)', () => {
    expect(escapeXml('Ñandú, camión, ¿señor? ºª')).toBe('Ñandú, camión, ¿señor? ºª');
  });
  it('falla ante caracteres fuera de ISO-8859-1 en vez de enviar "?"', () => {
    expect(() => escapeXml('precio — usd')).toThrow(/ISO-8859-1/);
    expect(() => escapeXml('hola 😀')).toThrow(RndcValidacionError);
  });
  it('elimina caracteres de control inválidos en XML', () => {
    expect(escapeXml('a\u0000b\u0008c')).toBe('abc');
  });
});

describe('buildRequestXml', () => {
  it('arma un registro con la estructura de la guía RNDC', () => {
    const xml = buildRequestXml({
      username: 'USR@1',
      password: 'p&ss',
      tipo: 1,
      procesoid: 3,
      variables: { NUMNITEMPRESATRANSPORTE: '9018605600', CONSECUTIVOREMESA: 'TRUCKE1587' },
    });
    expect(xml).toBe(
      `<?xml version='1.0' encoding='ISO-8859-1' ?><root>` +
        `<acceso><username>USR@1</username><password>p&amp;ss</password></acceso>` +
        `<solicitud><tipo>1</tipo><procesoid>3</procesoid></solicitud>` +
        `<variables><NUMNITEMPRESATRANSPORTE>9018605600</NUMNITEMPRESATRANSPORTE><CONSECUTIVOREMESA>TRUCKE1587</CONSECUTIVOREMESA></variables></root>`,
    );
  });
  it('arma una consulta con campos, documento y documentorango', () => {
    const xml = buildRequestXml({
      username: 'u', password: 'p', tipo: 3, procesoid: 73,
      variables: 'INGRESOID,FECHAING',
      documento: { NUMNITEMPRESATRANSPORTE: '9018605600' },
      documentorango: { iniFECHAING: "'2026/01/01'", finFECHAING: "'2026/03/31'" },
    });
    expect(xml).toContain('<variables>INGRESOID,FECHAING</variables>');
    expect(xml).toContain('<documento><NUMNITEMPRESATRANSPORTE>9018605600</NUMNITEMPRESATRANSPORTE></documento>');
    expect(xml).toContain('<documentorango><iniFECHAING>&apos;2026/01/01&apos;</iniFECHAING>');
  });
  it('exige tipo y procesoid enteros', () => {
    expect(() => buildRequestXml({ username: 'u', password: 'p', tipo: 1.5, procesoid: 3 })).toThrow(RndcValidacionError);
  });
});

describe('sanitizeRequestXml', () => {
  it('enmascara la clave', () => {
    const xml = buildRequestXml({ username: 'u', password: 'secreto', tipo: 1, procesoid: 3, variables: {} });
    const safe = sanitizeRequestXml(xml);
    expect(safe).not.toContain('secreto');
    expect(safe).toContain('<password>***</password>');
  });
});
