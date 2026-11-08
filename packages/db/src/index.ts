import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

export * from './schema.js';

export type Db = Kysely<Database>;
export type TenantTx = Transaction<Database>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crea la conexión de runtime. Debe usarse con el rol de aplicación (no dueño, sin BYPASSRLS),
 * de lo contrario el aislamiento por tenant no se aplica. En Lambda: max=1 detrás de RDS Proxy.
 */
export function createDb(connectionString: string, opts: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString, max: opts.max ?? 1 });
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Ejecuta `fn` en una transacción con el tenant fijado (`app.tenant_id`, local a la transacción).
 * Toda consulta de negocio debe pasar por aquí. El `tenantId` debe venir del token autenticado,
 * nunca de un body o parámetro del cliente.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (trx: TenantTx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error('tenantId inválido');
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
    return fn(trx);
  });
}

/** Siguiente consecutivo atómico del tenant activo para el tipo de documento. */
export async function nextConsecutivo(trx: TenantTx, tipo: 'remesa' | 'manifiesto'): Promise<number> {
  const res = await sql<{ next_consecutivo: string }>`select next_consecutivo(${tipo}) as next_consecutivo`.execute(trx);
  const row = res.rows[0];
  if (!row) throw new Error('next_consecutivo no devolvió fila');
  return Number(row.next_consecutivo);
}
