import { afterEach, describe, expect, it } from 'vitest';
import { createRndcClient, RndcRechazoError, RndcRespuestaInvalidaError, RndcTransporteError, type RndcTransaccion } from '../src/index.js';
import { startFakeRndc } from './fake-rndc.js';

let fake: Awaited<ReturnType<typeof startFakeRndc>> | undefined;
afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

function clientFor(baseUrl: string, extra: { timeoutMs?: number; log?: RndcTransaccion[] } = {}) {
  return createRndcClient({
    ambiente: 'pruebas',
    credentials: { username: 'USR@1', password: 'clave-secreta' },
    hosts: { expedir: baseUrl, consultas: baseUrl, general: baseUrl },
    ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}),
    onTransaccion: (t) => extra.log?.push(t),
  });
}

describe('registrar', () => {
  it('devuelve el radicado y el servidor recibe el XML correcto en ISO-8859-1 (Ñ y tildes intactas)', async () => {
    fake = await startFakeRndc(() => ({ body: '<?xml version="1.0" encoding="ISO-8859-1" ?><root><ingresoid>900000026</ingresoid></root>' }));
    const log: RndcTransaccion[] = [];
    const r = await clientFor(fake.baseUrl, { log }).registrar({
      procesoid: 3,
      variables: { CONSECUTIVOREMESA: 'TRUCKE1587', DESCRIPCIONCORTAPRODUCTO: 'PIÑA Y CAFÉ' },
    });
    expect(r).toEqual({ ingresoid: '900000026' });

    const sent = fake.received[0]!;
    expect(sent.url).toBe('/soap/IBPMServices');
    expect(sent.headers.soapaction).toContain('AtenderMensajeRNDC');
    expect(sent.headers['content-type']).toContain('ISO-8859-1');
    expect(sent.requestXml).toContain('<DESCRIPCIONCORTAPRODUCTO>PIÑA Y CAFÉ</DESCRIPCIONCORTAPRODUCTO>');
    expect(sent.requestXml).toContain('<procesoid>3</procesoid>');

    // Bitácora sin la clave
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ resultado: 'radicado', ingresoid: '900000026', procesoid: 3, tipo: 1 });
    expect(log[0]!.requestXml).not.toContain('clave-secreta');
    expect(log[0]!.requestXml).toContain('<password>***</password>');
  });

  it('un error del RNDC es RndcRechazoError con sus mensajes y queda en bitácora', async () => {
    fake = await startFakeRndc(() => ({ body: '<root><ErrorMSG>DUPLICADO: la remesa ya existe</ErrorMSG></root>' }));
    const log: RndcTransaccion[] = [];
    const p = clientFor(fake.baseUrl, { log }).registrar({ procesoid: 3, variables: { CONSECUTIVOREMESA: 'X1' } });
    await expect(p).rejects.toBeInstanceOf(RndcRechazoError);
    await expect(p).rejects.toMatchObject({ mensajes: ['DUPLICADO: la remesa ya existe'], procesoid: 3 });
    expect(log.at(-1)).toMatchObject({ resultado: 'rechazo' });
  });

  it('HTTP 5xx es fallo de transporte reintentable', async () => {
    fake = await startFakeRndc(() => ({ status: 503, body: 'Service Unavailable' }));
    const err = await clientFor(fake.baseUrl).registrar({ procesoid: 3, variables: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(RndcTransporteError);
    expect(err.retryable).toBe(true);
    expect(err.detalle.status).toBe(503);
  });

  it('timeout es fallo de transporte (resultado desconocido)', async () => {
    fake = await startFakeRndc(async () => {
      await new Promise((r) => setTimeout(r, 400));
      return { body: '<root><ingresoid>1</ingresoid></root>' };
    });
    const err = await clientFor(fake.baseUrl, { timeoutMs: 100 }).registrar({ procesoid: 3, variables: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(RndcTransporteError);
    expect(err.message).toMatch(/Timeout/);
  });

  it('servidor caído es fallo de transporte', async () => {
    fake = await startFakeRndc(() => ({ body: '' }));
    const url = fake.baseUrl;
    await fake.close();
    fake = undefined;
    await expect(clientFor(url).registrar({ procesoid: 3, variables: {} })).rejects.toBeInstanceOf(RndcTransporteError);
  });

  it('una respuesta irreconocible NO se toma como éxito', async () => {
    fake = await startFakeRndc(() => ({ body: '<root><algo>raro</algo></root>' }));
    await expect(clientFor(fake.baseUrl).registrar({ procesoid: 3, variables: {} })).rejects.toBeInstanceOf(RndcRespuestaInvalidaError);
  });

  it('datos fuera de ISO-8859-1 se rechazan antes de enviar nada', async () => {
    fake = await startFakeRndc(() => ({ body: '<root><ingresoid>1</ingresoid></root>' }));
    await expect(clientFor(fake.baseUrl).registrar({ procesoid: 3, variables: { OBSERVACIONES: 'ok — mal' } })).rejects.toThrow(/ISO-8859-1/);
    expect(fake.received).toHaveLength(0);
  });
});

describe('consultar', () => {
  it('envía tipo 3 con campos, documento y rango; devuelve documentos', async () => {
    fake = await startFakeRndc(() => ({
      body: '<root><documento><ingresoid>15</ingresoid><fechaing>28/03/2020 9:44:52 a. m.</fechaing></documento></root>',
    }));
    const docs = await clientFor(fake.baseUrl).consultar({
      procesoid: 73,
      campos: ['INGRESOID', 'FECHAING'],
      documento: { NUMNITEMPRESATRANSPORTE: '9018605600' },
      rango: { iniFECHAING: "'2026/01/01'", finFECHAING: "'2026/03/31'" },
    });
    expect(docs).toEqual([{ ingresoid: '15', fechaing: '28/03/2020 9:44:52 a. m.' }]);
    const x = fake.received[0]!.requestXml;
    expect(x).toContain('<tipo>3</tipo><procesoid>73</procesoid>');
    expect(x).toContain('<variables>INGRESOID,FECHAING</variables>');
    expect(x).toContain('<documentorango>');
  });

  it('consulta sin resultados devuelve lista vacía', async () => {
    fake = await startFakeRndc(() => ({ body: '<root></root>' }));
    expect(await clientFor(fake.baseUrl).consultar({ procesoid: 4, campos: ['INGRESOID'], documento: { NUMNITEMPRESATRANSPORTE: '1' } })).toEqual([]);
  });
});
