import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createDb, nextConsecutivo, withTenant, type Db } from '../src/index.js';

// Requiere `npm run db:up && npm run db:migrate`. Los defaults coinciden con docker-compose (solo dev local).
const OWNER_URL = process.env.DATABASE_URL_OWNER ?? 'postgres://poseidon_owner:poseidon_owner_dev@localhost:5433/poseidon';
const APP_URL = process.env.DATABASE_URL_APP ?? 'postgres://poseidon_app:poseidon_app_dev@localhost:5433/poseidon';

const run = randomUUID().slice(0, 8);
let owner: pg.Pool;
let app: Db;
let tenantA: string;
let tenantB: string;

async function seedTenant(nit: string, prefijo: string): Promise<string> {
  const r = await owner.query<{ id: string }>(
    `insert into tenant (nit, razon_social, prefijo_consecutivo) values ($1, $2, $3) returning id`,
    [nit, `Empresa ${nit}`, prefijo],
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 2 });
  app = createDb(APP_URL, { max: 10 });
  tenantA = await seedTenant(`A-${run}`, 'TA');
  tenantB = await seedTenant(`B-${run}`, 'TB');
  // Un tercero por tenant, sembrado con el rol dueño (superusuario local, no sujeto a RLS).
  for (const [tid, num] of [[tenantA, '111'], [tenantB, '222']] as const) {
    await owner.query(`insert into tercero (tenant_id, tipo_id, num_id, nombre) values ($1, 'C', $2, $3)`, [tid, num, `Tercero ${num}`]);
  }
});

afterAll(async () => {
  await owner.query(`delete from tenant where id = any($1)`, [[tenantA, tenantB]]); // cascada a tablas hijas
  await owner.end();
  await app.destroy();
});

describe('rol de runtime', () => {
  it('no es superusuario, no es dueño y no tiene BYPASSRLS', async () => {
    const r = await owner.query(`select rolsuper, rolbypassrls from pg_roles where rolname = 'poseidon_app'`);
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('aislamiento por tenant (RLS)', () => {
  it('sin tenant activo no ve ninguna fila', async () => {
    const rows = await app.selectFrom('tercero').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('cada tenant ve solo sus propias filas', async () => {
    const a = await withTenant(app, tenantA, (trx) => trx.selectFrom('tercero').select(['num_id', 'tenant_id']).execute());
    const b = await withTenant(app, tenantB, (trx) => trx.selectFrom('tercero').select(['num_id', 'tenant_id']).execute());
    expect(a).toEqual([{ num_id: '111', tenant_id: tenantA }]);
    expect(b).toEqual([{ num_id: '222', tenant_id: tenantB }]);
  });

  it('el tenant solo ve su propio registro en `tenant`', async () => {
    const rows = await withTenant(app, tenantA, (trx) => trx.selectFrom('tenant').select('id').execute());
    expect(rows).toEqual([{ id: tenantA }]);
  });

  it('no puede insertar filas a nombre de otro tenant (WITH CHECK)', async () => {
    await expect(
      withTenant(app, tenantA, (trx) =>
        trx.insertInto('tercero').values({
          tenant_id: tenantB, tipo_id: 'C', num_id: '999', nombre: 'Intruso',
          primer_apellido: null, segundo_apellido: null, telefono: null, direccion: null,
          cod_municipio_rndc: null, rndc_sincronizado_at: null, rndc_payload_hash: null,
        }).execute(),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('no puede modificar ni borrar filas de otro tenant (0 filas afectadas)', async () => {
    const upd = await withTenant(app, tenantA, (trx) =>
      trx.updateTable('tercero').set({ nombre: 'Hackeado' }).where('num_id', '=', '222').executeTakeFirst());
    expect(Number(upd.numUpdatedRows)).toBe(0);
    const del = await withTenant(app, tenantA, (trx) =>
      trx.deleteFrom('tercero').where('num_id', '=', '222').executeTakeFirst());
    expect(Number(del.numDeletedRows)).toBe(0);
    const still = await withTenant(app, tenantB, (trx) => trx.selectFrom('tercero').select('nombre').execute());
    expect(still).toEqual([{ nombre: 'Tercero 222' }]);
  });

  it('no puede cambiar el tenant_id de una fila propia hacia otro tenant', async () => {
    await expect(
      withTenant(app, tenantA, (trx) =>
        trx.updateTable('tercero').set({ tenant_id: tenantB }).where('num_id', '=', '111').execute()),
    ).rejects.toThrow(/row-level security/i);
  });

  it('el rol de runtime no puede crear ni borrar tenants', async () => {
    await expect(
      withTenant(app, tenantA, (trx) =>
        trx.insertInto('tenant').values({ nit: `X-${run}`, razon_social: 'x', prefijo_consecutivo: 'X' }).execute()),
    ).rejects.toThrow(/permission denied/i);
  });

  it('el tenant activo no persiste entre transacciones (set_config local)', async () => {
    await withTenant(app, tenantA, (trx) => trx.selectFrom('tercero').selectAll().execute());
    const rows = await app.selectFrom('tercero').selectAll().execute();
    expect(rows).toHaveLength(0);
  });

  it('rechaza un tenantId que no es UUID (sin tocar la BD)', async () => {
    await expect(withTenant(app, "x'; drop table tercero;--", async () => 1)).rejects.toThrow(/inválido/);
  });
});

describe('consecutivos', () => {
  it('son atómicos y sin huecos bajo concurrencia', async () => {
    const N = 25;
    const nums = await Promise.all(
      Array.from({ length: N }, () => withTenant(app, tenantA, (trx) => nextConsecutivo(trx, 'remesa'))),
    );
    expect([...nums].sort((x, y) => x - y)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it('son independientes por tenant y por tipo', async () => {
    const b1 = await withTenant(app, tenantB, (trx) => nextConsecutivo(trx, 'remesa'));
    const bm = await withTenant(app, tenantB, (trx) => nextConsecutivo(trx, 'manifiesto'));
    expect(b1).toBe(1);
    expect(bm).toBe(1);
  });

  it('sin tenant activo no asigna consecutivo', async () => {
    await expect(app.transaction().execute((trx) => nextConsecutivo(trx, 'remesa'))).rejects.toThrow();
  });
});
