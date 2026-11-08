/** Datos inválidos detectados ANTES de enviar al RNDC (nada salió de nuestro lado). No reintentar. */
export class RndcValidacionError extends Error {
  override name = 'RndcValidacionError';
}

/** El RNDC respondió y rechazó el documento (error de negocio). No reintentar sin corregir los datos. */
export class RndcRechazoError extends Error {
  override name = 'RndcRechazoError';
  constructor(
    public readonly mensajes: string[],
    public readonly procesoid: number,
    public readonly respuestaCruda: string,
  ) {
    super(`RNDC rechazó el proceso ${procesoid}: ${mensajes.join(' | ')}`);
  }
}

/** Fallo de red, timeout o HTTP 5xx: el resultado en el RNDC es DESCONOCIDO. Antes de reenviar, consultar. */
export class RndcTransporteError extends Error {
  override name = 'RndcTransporteError';
  constructor(
    message: string,
    public readonly detalle: { retryable: boolean; status?: number; causa?: unknown } = { retryable: true },
  ) {
    super(message);
  }
  get retryable(): boolean {
    return this.detalle.retryable;
  }
}

/** Llegó una respuesta que no se puede interpretar (ni radicado, ni documentos, ni error conocido). */
export class RndcRespuestaInvalidaError extends Error {
  override name = 'RndcRespuestaInvalidaError';
  constructor(
    message: string,
    public readonly respuestaCruda: string,
  ) {
    super(message);
  }
}
