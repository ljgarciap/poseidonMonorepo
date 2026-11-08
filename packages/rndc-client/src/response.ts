import { XMLParser } from 'fast-xml-parser';
import { RndcRespuestaInvalidaError } from './errors.js';

export type RndcDocumento = Record<string, string>;

export type RndcRespuesta =
  | { tipo: 'radicado'; ingresoid: string }
  | { tipo: 'documentos'; documentos: RndcDocumento[] }
  | { tipo: 'error'; mensajes: string[] };

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false, // conservar ceros a la izquierda y radicados como texto
  trimValues: true,
  isArray: (name) => name.toLowerCase() === 'documento',
});

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  return JSON.stringify(v);
}

/**
 * Interpreta el XML interno que devuelve el RNDC:
 *  - `<root><ingresoid>N</ingresoid></root>`  → radicado
 *  - `<root><documento>…</documento>…</root>` → resultado de consulta (vacío = sin resultados)
 *  - error                                    → `<root><ErrorMSG>…</ErrorMSG></root>` o texto plano
 * NOTA: el formato exacto del error se debe confirmar contra respuestas reales de `wstest` (D6);
 * por eso el parser es tolerante (cualquier elemento que empiece por "error", o texto plano).
 */
export function parseRespuesta(innerXml: string, opts: { consulta: boolean }): RndcRespuesta {
  const text = innerXml.trim();
  if (text === '') throw new RndcRespuestaInvalidaError('Respuesta vacía del RNDC', innerXml);
  if (!text.startsWith('<')) return { tipo: 'error', mensajes: [text] };

  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch (e) {
    throw new RndcRespuestaInvalidaError(`XML de respuesta ilegible: ${(e as Error).message}`, innerXml);
  }
  const root = isObj(parsed) ? parsed.root : undefined;

  if (root === undefined || root === '') {
    if (opts.consulta && isObj(parsed) && 'root' in parsed) return { tipo: 'documentos', documentos: [] };
    throw new RndcRespuestaInvalidaError('Respuesta sin contenido interpretable', innerXml);
  }
  if (!isObj(root)) return { tipo: 'error', mensajes: [String(root)] };

  const byLower = new Map(Object.entries(root).map(([k, v]) => [k.toLowerCase(), v] as const));

  const errKey = [...byLower.keys()].find((k) => k.startsWith('error'));
  if (errKey) {
    const raw = byLower.get(errKey);
    const mensajes = (Array.isArray(raw) ? raw : [raw]).map(toText).filter((m) => m !== '');
    return { tipo: 'error', mensajes: mensajes.length ? mensajes : ['Error sin descripción'] };
  }

  const ingreso = byLower.get('ingresoid');
  if (typeof ingreso === 'string' && ingreso !== '') return { tipo: 'radicado', ingresoid: ingreso };

  const docs = byLower.get('documento');
  if (Array.isArray(docs)) {
    const documentos = docs.map((d): RndcDocumento => {
      if (!isObj(d)) return {};
      return Object.fromEntries(Object.entries(d).map(([k, v]) => [k.toLowerCase(), toText(v)]));
    });
    return { tipo: 'documentos', documentos };
  }

  throw new RndcRespuestaInvalidaError('Respuesta del RNDC no reconocida', innerXml);
}
