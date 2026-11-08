import { XMLParser } from 'fast-xml-parser';
import iconv from 'iconv-lite';
import { RndcRespuestaInvalidaError, RndcTransporteError } from './errors.js';
import { escapeXml } from './xml.js';

export const SOAP_ACTION = 'urn:BPMServicesIntf-IBPMServices#AtenderMensajeRNDC';
const ENCODING_STYLE = 'http://schemas.xmlsoap.org/soap/encoding/';

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false,
});

/** Sobre SOAP rpc/encoded de `AtenderMensajeRNDC` con el XML del request como único parámetro `Request` (string). */
export function buildEnvelope(requestXml: string): string {
  return (
    `<?xml version="1.0" encoding="ISO-8859-1"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:urn="urn:BPMServicesIntf-IBPMServices">` +
    `<soapenv:Body><urn:AtenderMensajeRNDC soapenv:encodingStyle="${ENCODING_STYLE}">` +
    `<Request xsi:type="xsd:string">${escapeXml(requestXml)}</Request>` +
    `</urn:AtenderMensajeRNDC></soapenv:Body></soapenv:Envelope>`
  );
}

export function encodeBody(envelope: string): Buffer {
  return iconv.encode(envelope, 'iso-8859-1');
}

/** Decodifica el cuerpo de la respuesta según charset del header o declaración XML; por defecto ISO-8859-1. */
export function decodeBody(body: Uint8Array, contentType: string | null): string {
  const buf = Buffer.from(body);
  let charset = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '')?.[1];
  if (!charset) charset = /^<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(buf.subarray(0, 200).toString('latin1'))?.[1];
  const enc = charset && iconv.encodingExists(charset) ? charset : 'iso-8859-1';
  return iconv.decode(buf, enc);
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseEnvelope(xml: string): Obj {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (e) {
    throw new RndcRespuestaInvalidaError(`Sobre SOAP ilegible: ${(e as Error).message}`, xml);
  }
  const env = isObj(parsed) && isObj(parsed.Envelope) ? parsed.Envelope : undefined;
  const body = env && isObj(env.Body) ? env.Body : undefined;
  if (!body) throw new RndcRespuestaInvalidaError('La respuesta no es un sobre SOAP', xml);
  return body;
}

/** Extrae el XML interno (`return`) de la respuesta SOAP. Un SOAP Fault es un fallo de transporte (resultado desconocido). */
export function extractReturn(responseEnvelope: string): string {
  const body = parseEnvelope(responseEnvelope);
  if (isObj(body.Fault)) {
    const f = body.Fault;
    throw new RndcTransporteError(`SOAP Fault: ${String(f.faultstring ?? f.faultcode ?? 'desconocido')}`, { retryable: true });
  }
  const response = Object.values(body).find(isObj);
  const ret = response?.return;
  if (typeof ret !== 'string') throw new RndcRespuestaInvalidaError('Respuesta SOAP sin elemento `return`', responseEnvelope);
  return ret;
}

/** Inverso de `buildEnvelope`: extrae el `Request` (útil para el servidor RNDC simulado de los tests). */
export function extractRequest(requestEnvelope: string): string {
  const body = parseEnvelope(requestEnvelope);
  const call = Object.values(body).find(isObj);
  const req = call?.Request;
  if (typeof req !== 'string') throw new RndcRespuestaInvalidaError('Sobre SOAP sin `Request`', requestEnvelope);
  return req;
}

/** Sobre de respuesta (lo usa el servidor simulado de los tests). */
export function buildResponseEnvelope(innerXml: string): string {
  return (
    `<?xml version="1.0" encoding="ISO-8859-1"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">` +
    `<SOAP-ENV:Body><NS1:AtenderMensajeRNDCResponse xmlns:NS1="urn:BPMServicesIntf-IBPMServices">` +
    `<return xsi:type="xsd:string">${escapeXml(innerXml)}</return>` +
    `</NS1:AtenderMensajeRNDCResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`
  );
}
