import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface TenantTable {
  id: Generated<string>;
  nit: string;
  razon_social: string;
  prefijo_consecutivo: string;
  activo: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface TenantRndcConfigTable {
  id: Generated<string>;
  tenant_id: string;
  ambiente: 'pruebas' | 'produccion';
  username: string;
  /** Referencia al secreto (Secrets Manager), nunca la clave. */
  secret_ref: string;
  activo: Generated<boolean>;
  created_at: Generated<Date>;
}

export type Rol = 'admin' | 'despachador' | 'consulta' | 'conductor';

export interface UsuarioTable {
  id: Generated<string>;
  tenant_id: string;
  cognito_sub: string;
  email: string;
  rol: Rol;
  activo: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface TerceroTable {
  id: Generated<string>;
  tenant_id: string;
  tipo_id: 'C' | 'N' | 'E' | 'P' | 'T';
  num_id: string;
  nombre: string;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  telefono: string | null;
  direccion: string | null;
  cod_municipio_rndc: string | null;
  rndc_sincronizado_at: Timestamp | null;
  rndc_payload_hash: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ParametroTable {
  id: Generated<string>;
  tenant_id: string;
  clave: string;
  valor: unknown;
  vigente_desde: Generated<string>;
  vigente_hasta: string | null;
  created_at: Generated<Date>;
}

export interface ConsecutivoTable {
  tenant_id: string;
  tipo: 'remesa' | 'manifiesto';
  ultimo: ColumnType<string, number | string | undefined, number | string>;
}

export interface Database {
  tenant: TenantTable;
  tenant_rndc_config: TenantRndcConfigTable;
  usuario: UsuarioTable;
  tercero: TerceroTable;
  parametro: ParametroTable;
  consecutivo: ConsecutivoTable;
}
