-- Up Migration

-- ============================================================================
-- Tenancy base: tenant, configuración RNDC, usuarios, terceros, parámetros, consecutivos.
-- Aislamiento: Row Level Security FORZADO. El tenant activo se fija por transacción con
--   SELECT set_config('app.tenant_id', '<uuid>', true)
-- Sin tenant activo, app_tenant_id() es NULL y ninguna fila es visible ni escribible.
-- ============================================================================

CREATE FUNCTION app_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE TABLE tenant (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nit                 text NOT NULL UNIQUE,
  razon_social        text NOT NULL,
  prefijo_consecutivo text NOT NULL CHECK (prefijo_consecutivo ~ '^[A-Z0-9]{1,10}$'),
  activo              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Credenciales RNDC: la BD guarda SOLO la referencia al secreto, nunca la clave.
CREATE TABLE tenant_rndc_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  ambiente    text NOT NULL CHECK (ambiente IN ('pruebas', 'produccion')),
  username    text NOT NULL,
  secret_ref  text NOT NULL,
  activo      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ambiente)
);

CREATE TABLE usuario (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  cognito_sub  text NOT NULL UNIQUE,
  email        text NOT NULL,
  rol          text NOT NULL CHECK (rol IN ('admin', 'despachador', 'consulta', 'conductor')),
  activo       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usuario_tenant_idx ON usuario (tenant_id);

CREATE TABLE tercero (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tipo_id               text NOT NULL CHECK (tipo_id IN ('C', 'N', 'E', 'P', 'T')),
  num_id                text NOT NULL,
  nombre                text NOT NULL,
  primer_apellido       text,
  segundo_apellido      text,
  telefono              text,
  direccion             text,
  cod_municipio_rndc    text CHECK (cod_municipio_rndc ~ '^[0-9]{8}$'),
  rndc_sincronizado_at  timestamptz,
  rndc_payload_hash     text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tipo_id, num_id)
);

-- Parámetros de negocio versionados por vigencia (retenciones, ICA, horas pacto, etc.). Nada hardcodeado.
CREATE TABLE parametro (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  clave          text NOT NULL,
  valor          jsonb NOT NULL,
  vigente_desde  date NOT NULL DEFAULT current_date,
  vigente_hasta  date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  UNIQUE (tenant_id, clave, vigente_desde)
);

-- Consecutivos por tenant y tipo de documento (D2: prefijo por tenant + número secuencial atómico).
CREATE TABLE consecutivo (
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('remesa', 'manifiesto')),
  ultimo     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, tipo)
);

-- Asignación atómica; RLS aplica porque la función corre con los permisos de quien llama.
CREATE FUNCTION next_consecutivo(p_tipo text) RETURNS bigint
  LANGUAGE sql VOLATILE
  AS $$
    INSERT INTO consecutivo (tenant_id, tipo, ultimo)
    VALUES (app_tenant_id(), p_tipo, 1)
    ON CONFLICT (tenant_id, tipo) DO UPDATE SET ultimo = consecutivo.ultimo + 1
    RETURNING ultimo
  $$;

-- ---------------------------------------------------------------------------
-- Row Level Security forzado en TODAS las tablas de negocio.
-- ---------------------------------------------------------------------------
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant
  USING (id = app_tenant_id()) WITH CHECK (id = app_tenant_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_rndc_config', 'usuario', 'tercero', 'parametro', 'consecutivo']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id())',
      t);
  END LOOP;
END $$;

-- El rol de runtime no crea ni borra tenants: el alta de un tenant es una operación administrativa
-- (con el rol dueño), no una acción de la API.
REVOKE INSERT, DELETE ON tenant FROM poseidon_app;

-- Down Migration

DROP FUNCTION IF EXISTS next_consecutivo(text);
DROP TABLE IF EXISTS consecutivo;
DROP TABLE IF EXISTS parametro;
DROP TABLE IF EXISTS tercero;
DROP TABLE IF EXISTS usuario;
DROP TABLE IF EXISTS tenant_rndc_config;
DROP TABLE IF EXISTS tenant;
DROP FUNCTION IF EXISTS app_tenant_id();
