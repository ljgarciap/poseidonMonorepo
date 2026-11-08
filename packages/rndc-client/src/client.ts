import { RndcRechazoError, RndcRespuestaInvalidaError, RndcTransporteError } from './errors.js';
import { HOSTS_DEFAULT, resolveUrl, type Ambiente, type RndcHosts } from './hosts.js';
import { parseRespuesta, type RndcDocumento } from './response.js';
import { buildEnvelope, decodeBody, encodeBody, extractReturn, SOAP_ACTION } from './soap.js';
import { buildRequestXml, sanitizeRequestXml, type XmlNode } from './xml.js';

export interface RndcCredentials {
  username: string;
  password: string;
}

/** Registro de cada llamada, ya sin la clave. El dominio lo persiste en `rndc_transaccion`. */
export interface RndcTransaccion {
  ambiente: Ambiente;
  url: string;
  tipo: number;
  procesoid: number;
  requestXml: string;
  responseXml?: string;
  resultado: 'radicado' | 'documentos' | 'rechazo' | 'transporte' | 'invalida';
  ingresoid?: string;
  error?: string;
  duracionMs: number;
}

export interface RndcClientOptions {
  ambiente: Ambiente;
  credentials: RndcCredentials;
  hosts?: Partial<RndcHosts>;
  timeoutMs?: number;
  fetch?: typeof fetch;
  onTransaccion?: (t: RndcTransaccion) => void;
}

export interface RndcClient {
  /** Registra información (tipo 1). Devuelve el radicado o lanza `RndcRechazoError`. */
  registrar(input: { procesoid: number; variables: XmlNode }): Promise<{ ingresoid: string }>;
  /** Consulta documentos (tipo 3 por defecto). `campos` es la lista de variables a devolver. */
  consultar(input: {
    procesoid: number;
    campos: string[];
    documento: XmlNode;
    rango?: XmlNode;
    tipo?: number;
  }): Promise<RndcDocumento[]>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function createRndcClient(opts: RndcClientOptions): RndcClient {
  const doFetch = opts.fetch ?? fetch;
  const hosts: RndcHosts = { ...HOSTS_DEFAULT[opts.ambiente], ...opts.hosts };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(tipo: number, procesoid: number, requestXml: string) {
    const url = resolveUrl(opts.ambiente, tipo, procesoid, hosts);
    const started = Date.now();
    const base = {
      ambiente: opts.ambiente,
      url,
      tipo,
      procesoid,
      requestXml: sanitizeRequestXml(requestXml),
    };
    const consulta = tipo !== 1;
    let responseXml: string | undefined;
    try {
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=ISO-8859-1', SOAPAction: `"${SOAP_ACTION}"` },
          body: new Uint8Array(encodeBody(buildEnvelope(requestXml))),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
        throw new RndcTransporteError(timeout ? `Timeout de ${timeoutMs} ms hacia el RNDC` : `Fallo de red hacia el RNDC: ${(e as Error).message}`, {
          retryable: true,
          causa: e,
        });
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      responseXml = decodeBody(buf, res.headers.get('content-type'));
      if (res.status >= 500) {
        // Un Fault 5xx puede traer detalle, pero el resultado en el RNDC es desconocido: tratar como transporte.
        throw new RndcTransporteError(`HTTP ${res.status} del RNDC`, { retryable: true, status: res.status });
      }
      if (!res.ok) throw new RndcTransporteError(`HTTP ${res.status} del RNDC`, { retryable: false, status: res.status });

      const respuesta = parseRespuesta(extractReturn(responseXml), { consulta });
      if (respuesta.tipo === 'error') {
        const err = new RndcRechazoError(respuesta.mensajes, procesoid, responseXml);
        opts.onTransaccion?.({ ...base, responseXml, resultado: 'rechazo', error: err.message, duracionMs: Date.now() - started });
        throw err;
      }
      opts.onTransaccion?.({
        ...base,
        responseXml,
        resultado: respuesta.tipo,
        ...(respuesta.tipo === 'radicado' ? { ingresoid: respuesta.ingresoid } : {}),
        duracionMs: Date.now() - started,
      });
      return respuesta;
    } catch (e) {
      if (!(e instanceof RndcRechazoError)) {
        opts.onTransaccion?.({
          ...base,
          ...(responseXml !== undefined ? { responseXml } : {}),
          resultado: e instanceof RndcRespuestaInvalidaError ? 'invalida' : 'transporte',
          error: (e as Error).message,
          duracionMs: Date.now() - started,
        });
      }
      throw e;
    }
  }

  return {
    async registrar({ procesoid, variables }) {
      const xml = buildRequestXml({ ...opts.credentials, tipo: 1, procesoid, variables });
      const r = await call(1, procesoid, xml);
      if (r.tipo !== 'radicado') throw new RndcRespuestaInvalidaError('Se esperaba un radicado (ingresoid)', JSON.stringify(r));
      return { ingresoid: r.ingresoid };
    },
    async consultar({ procesoid, campos, documento, rango, tipo = 3 }) {
      const xml = buildRequestXml({
        ...opts.credentials,
        tipo,
        procesoid,
        variables: campos.join(','),
        documento,
        ...(rango ? { documentorango: rango } : {}),
      });
      const r = await call(tipo, procesoid, xml);
      if (r.tipo !== 'documentos') throw new RndcRespuestaInvalidaError('Se esperaban documentos', JSON.stringify(r));
      return r.documentos;
    },
  };
}
