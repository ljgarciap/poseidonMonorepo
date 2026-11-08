-- Rol de runtime de la aplicación: NO es dueño de las tablas, no es superusuario y no tiene BYPASSRLS,
-- por lo que el Row Level Security siempre le aplica. En nube lo crea el tercero de infraestructura
-- (ver docs/contrato-infra.md); aquí replicamos el mismo modelo de permisos.
CREATE ROLE poseidon_app LOGIN PASSWORD 'poseidon_app_dev' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE poseidon TO poseidon_app;
GRANT USAGE ON SCHEMA public TO poseidon_app;
-- Todo lo que cree poseidon_owner (migraciones) queda accesible al rol de app, sujeto a RLS.
ALTER DEFAULT PRIVILEGES FOR ROLE poseidon_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO poseidon_app;
ALTER DEFAULT PRIVILEGES FOR ROLE poseidon_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO poseidon_app;
