export type Ambiente = 'pruebas' | 'produccion';

export interface RndcHosts {
  /** Expedir remesas y manifiestos */
  expedir: string;
  /** Consultas */
  consultas: string;
  /** Resto de procesos */
  general: string;
}

export const HOSTS_DEFAULT: Record<Ambiente, RndcHosts> = {
  produccion: {
    expedir: 'rndcws2.mintransporte.gov.co',
    consultas: 'plc.mintransporte.gov.co',
    general: 'rndcws.mintransporte.gov.co',
  },
  // El ambiente de pruebas expone un único host para todo.
  pruebas: {
    expedir: 'rndcpruebas.mintransporte.gov.co',
    consultas: 'rndcpruebas.mintransporte.gov.co',
    general: 'rndcpruebas.mintransporte.gov.co',
  },
};

export const SOAP_PATH = '/soap/IBPMServices';
export const SOAP_PORT = 8080;

/** Procesos que se expiden por el host dedicado: 3 (remesa) y 4 (manifiesto). */
const PROCESOS_EXPEDIR = new Set([3, 4]);
/** Tipos de solicitud que son consultas (2..6, 8, 9). El 1 registra y el 7 crea usuario. */
const TIPOS_CONSULTA = new Set([2, 3, 4, 5, 6, 8, 9]);

export function resolveUrl(
  ambiente: Ambiente,
  tipo: number,
  procesoid: number,
  hosts: RndcHosts = HOSTS_DEFAULT[ambiente],
): string {
  let host: string;
  if (tipo === 1 && PROCESOS_EXPEDIR.has(procesoid)) host = hosts.expedir;
  else if (TIPOS_CONSULTA.has(tipo)) host = hosts.consultas;
  else host = hosts.general;
  // Un host con esquema/puerto explícito (tests, proxies) se respeta tal cual.
  if (/^https?:\/\//.test(host)) return host.replace(/\/$/, '') + SOAP_PATH;
  return `http://${host}:${SOAP_PORT}${SOAP_PATH}`;
}
