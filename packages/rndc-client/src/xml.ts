import { RndcValidacionError } from './errors.js';

export type Scalar = string | number;
export interface XmlNode {
  /** Las claves que empiezan con "@" son atributos (ej. "@procesoid"). El resto son elementos hijos. */
  [key: string]: XmlValue | undefined;
}
export type XmlValue = Scalar | XmlNode | XmlValue[];

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function assertName(name: string): string {
  if (!NAME_RE.test(name)) throw new RndcValidacionError(`Nombre de elemento XML inválido: "${name}"`);
  return name;
}

/**
 * Escapa texto para XML y verifica que sea representable en ISO-8859-1 (encoding exigido por el RNDC).
 * Falla ruidosamente ante comillas tipográficas, emojis, etc. en vez de enviar '?' en silencio.
 */
export function escapeXml(text: string): string {
  const clean = text.normalize('NFC').replace(INVALID_XML_CHARS, '');
  for (const ch of clean) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0xff) {
      throw new RndcValidacionError(
        `Carácter no representable en ISO-8859-1: "${ch}" (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`,
      );
    }
  }
  return clean.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function scalarText(v: XmlValue): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RndcValidacionError('Número no finito en XML');
    return String(v);
  }
  if (typeof v === 'string') return v;
  throw new RndcValidacionError('Se esperaba un valor escalar');
}

/** Renderiza un elemento. `undefined` y cadenas vacías se omiten (igual que wstest: campo en blanco = no se envía). */
export function renderElement(name: string, value: XmlValue | undefined): string {
  if (value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => renderElement(name, v)).join('');
  assertName(name);
  if (typeof value === 'object') {
    let attrs = '';
    let children = '';
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      if (k.startsWith('@')) {
        attrs += ` ${assertName(k.slice(1))}="${escapeXml(scalarText(v))}"`;
      } else {
        children += renderElement(k, v);
      }
    }
    return `<${name}${attrs}>${children}</${name}>`;
  }
  const text = scalarText(value);
  if (text === '') return '';
  return `<${name}>${escapeXml(text)}</${name}>`;
}

export interface RequestInput {
  username: string;
  password: string;
  /** 1 = registrar, 3 = consultar documentos, etc. (ver docs/referencia-rndc.md) */
  tipo: number;
  procesoid: number;
  /** Registro: elementos con el diccionario del proceso. Consulta: lista de campos separada por comas. */
  variables?: XmlNode | string;
  documento?: XmlNode;
  documentorango?: XmlNode;
}

/** Arma el XML `<root>` del Request de `AtenderMensajeRNDC`. */
export function buildRequestXml(input: RequestInput): string {
  if (!Number.isInteger(input.tipo) || !Number.isInteger(input.procesoid)) {
    throw new RndcValidacionError('tipo y procesoid deben ser enteros');
  }
  const variables =
    typeof input.variables === 'string'
      ? `<variables>${escapeXml(input.variables)}</variables>`
      : renderElement('variables', input.variables ?? {});
  return (
    `<?xml version='1.0' encoding='ISO-8859-1' ?>` +
    `<root>` +
    `<acceso><username>${escapeXml(input.username)}</username><password>${escapeXml(input.password)}</password></acceso>` +
    `<solicitud><tipo>${input.tipo}</tipo><procesoid>${input.procesoid}</procesoid></solicitud>` +
    variables +
    (input.documento ? renderElement('documento', input.documento) : '') +
    (input.documentorango ? renderElement('documentorango', input.documentorango) : '') +
    `</root>`
  );
}

/** Enmascara la clave para poder registrar/loguear el XML. */
export function sanitizeRequestXml(xml: string): string {
  return xml.replace(/<password>[\s\S]*?<\/password>/g, '<password>***</password>');
}
