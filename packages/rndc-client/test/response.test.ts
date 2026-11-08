import { describe, expect, it } from 'vitest';
import { buildEnvelope, buildResponseEnvelope, extractRequest, extractReturn, parseRespuesta, RndcRespuestaInvalidaError, RndcTransporteError } from '../src/index.js';

const reg = { consulta: false };
const con = { consulta: true };

describe('parseRespuesta', () => {
  it('radicado', () => {
    expect(parseRespuesta(`<?xml version="1.0" encoding="ISO-8859-1" ?><root><ingresoid>900000026</ingresoid></root>`, reg))
      .toEqual({ tipo: 'radicado', ingresoid: '900000026' });
  });
  it('error en <ErrorMSG> (con una o varias entradas)', () => {
    expect(parseRespuesta('<root><ErrorMSG>Duplicado</ErrorMSG></root>', reg)).toEqual({ tipo: 'error', mensajes: ['Duplicado'] });
    expect(parseRespuesta('<root><ErrorMSG>a</ErrorMSG><ErrorMSG>b</ErrorMSG></root>', reg)).toEqual({ tipo: 'error', mensajes: ['a', 'b'] });
  });
  it('error como texto plano', () => {
    expect(parseRespuesta('Usuario o clave inválidos', reg)).toEqual({ tipo: 'error', mensajes: ['Usuario o clave inválidos'] });
  });
  it('documentos de una consulta (claves en minúscula, valores como texto)', () => {
    const r = parseRespuesta(
      '<root><documento><ingresoid>15</ingresoid><numidconductor>0080387330</numidconductor></documento>' +
        '<documento><ingresoid>8</ingresoid><numidconductor></numidconductor></documento></root>',
      con,
    );
    expect(r).toEqual({
      tipo: 'documentos',
      documentos: [{ ingresoid: '15', numidconductor: '0080387330' }, { ingresoid: '8', numidconductor: '' }],
    });
  });
  it('un solo <documento> también llega como lista', () => {
    const r = parseRespuesta('<root><documento><ingresoid>1</ingresoid></documento></root>', con);
    expect(r).toEqual({ tipo: 'documentos', documentos: [{ ingresoid: '1' }] });
  });
  it('consulta sin resultados = lista vacía; registro sin contenido = inválido', () => {
    expect(parseRespuesta('<root></root>', con)).toEqual({ tipo: 'documentos', documentos: [] });
    expect(() => parseRespuesta('<root></root>', reg)).toThrow(RndcRespuestaInvalidaError);
    expect(() => parseRespuesta('   ', reg)).toThrow(RndcRespuestaInvalidaError);
  });
  it('respuesta irreconocible es inválida (no se asume éxito)', () => {
    expect(() => parseRespuesta('<root><otra>cosa</otra></root>', reg)).toThrow(RndcRespuestaInvalidaError);
  });
});

describe('sobre SOAP', () => {
  it('ida y vuelta conservando tildes, ñ y caracteres reservados', () => {
    const inner = `<root><x>Ñandú & "café" <b></x></root>`.replace('<b>', '&lt;b&gt;');
    expect(extractRequest(buildEnvelope(inner))).toBe(inner);
    expect(extractReturn(buildResponseEnvelope(inner))).toBe(inner);
  });
  it('un SOAP Fault es fallo de transporte (resultado desconocido)', () => {
    const fault = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>Server</faultcode><faultstring>boom</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
    expect(() => extractReturn(fault)).toThrow(RndcTransporteError);
  });
  it('HTML u otra cosa no es un sobre SOAP', () => {
    expect(() => extractReturn('<html><body>502</body></html>')).toThrow(RndcRespuestaInvalidaError);
  });
});
