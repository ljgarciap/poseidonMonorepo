# Poseidon — Gestión de transporte de carga integrada al RNDC

Sistema multitenant para empresas de transporte de carga en Colombia. Primer tenant: **Truck Express S.A.S.** (NIT 901860560).
Reemplaza los Excel de control de viajes y la radicación manual en el portal del RNDC (Ministerio de Transporte).

## Stack (decidido 2026-11-07)
| Capa | Decisión |
|---|---|
| Backend | Node.js **20** + TypeScript, AWS Lambda (handlers puros, sin acoplarse a la versión de Node) |
| BD | PostgreSQL 16 (RDS en nube; contenedor Docker en local) |
| Acceso a datos | Kysely + node-pg-migrate (sin Prisma: peso en cold start) |
| Asíncrono | Cola (SQS en nube) + DLQ para toda llamada al RNDC; detrás de una interfaz `QueuePort` |
| Frontend | React + Vite + TypeScript (despachadores); app móvil de conductores a mediano plazo (fuera de MVP) |
| Infra | **Gestionada por un tercero** — este repo NO contiene IaC. Contrato en `docs/contrato-infra.md` |
| Repo | Monorepo npm workspaces |

## Estructura prevista
```
packages/
  rndc-client/   # cliente SOAP/XML (+REST de consultas) del RNDC, sin dependencias de dominio
  core/          # dominio: viaje, remesa, manifiesto, cumplidos, tarifas, tenancy
  api/           # handlers Lambda (HTTP) + workers de cola
  db/            # migraciones, seeds, tipos Kysely
apps/web/        # React
docs/            # arquitectura, specs, ADRs, contrato-infra, referencia RNDC
docker-compose.yml  # postgres 16 (+ cola local)
```

## Reglas del proyecto
- **Multitenant desde el día 1**: todo dato de negocio lleva `tenant_id`; aislamiento con Row Level Security de Postgres (`SET LOCAL app.tenant_id` por transacción). El tenant sale del token de autenticación, nunca del body.
- **Credenciales RNDC** (usuario/clave por tenant y por ambiente): solo en el gestor de secretos; la BD guarda únicamente la *referencia*. Nunca en repo, logs ni variables de entorno planas.
- **Parámetros de negocio** (tarifas pactadas, % retención, ICA, topes, horas pacto cargue/descargue, etc.) van en tablas paramétricas por tenant con CRUD y vista de admin. Nada hardcodeado.
- **Toda llamada al RNDC** se registra en `rndc_transaccion` (request sin clave, response, radicado, error, duración) y es idempotente por (tenant, proceso, consecutivo).
- XML RNDC: ISO-8859-1 (`iconv-lite`), construido a mano; el host depende del proceso (ver `docs/referencia-rndc.md`).
- Ambiente pruebas RNDC = radicados > 900.000.000. Prohibido apuntar tests automáticos a producción.
- Maestros (terceros/vehículos) se registran en RNDC solo si cambiaron; datos idénticos devuelven error del RNDC → tratarlo como "ya sincronizado".

## Fuera del MVP
Facturación (fase A: proveedor tecnológico DIAN; fase B: factura electrónica de transporte proceso 86 RNDC), asiento contable (`Hoja1`, sin definir), app móvil de conductores, migración del histórico de Excel.

## Referencias
- `docs/arquitectura.md` — diseño, modelo de datos, flujo del viaje, spec MVP y backlog
- `docs/referencia-rndc.md` — resumen de la guía RNDC V6
- Insumos originales: PDF de la guía RNDC V6, manifiesto de ejemplo, Excel de operación, nota manuscrita del flujo (carpeta raíz del proyecto)

## Comandos (Fase 0)
```
cp .env.example .env     # una vez (valores locales no sensibles)
npm install
npm run db:up            # Postgres 16 en localhost:5433 (crea roles poseidon_owner / poseidon_app)
npm run db:migrate       # aplica migraciones con el rol dueño
npm test                 # vitest, incluye test de aislamiento RLS contra Postgres real
npm run typecheck && npm run lint
npm run db:reset         # borra el volumen y recrea todo
```
- Versiones fijadas por compatibilidad con Node 20 (D4): `kysely ~0.28` (0.29+ exige Node 22), `vitest ^4` (5 exige Node 22.12). No subirlas sin revisar `engines`.
- Tests y runtime usan `poseidon_app` (sujeto a RLS). Nunca apuntar la API al rol dueño.

## Estado
- F0: T0.1 monorepo ✅ · T0.2 compose + migración inicial + RLS + test de aislamiento ✅ · T0.3 `docs/contrato-infra.md` ✅ (pendiente respuesta del tercero)
- F1: T1.1 `rndc-client` transporte SOAP/XML ✅ (XML, sobre rpc/encoded ISO-8859-1, hosts por proceso, errores tipados, bitácora sin clave, servidor RNDC simulado en tests)
- Siguiente: T1.2–T1.5 (maestros, remesa, manifiesto, cumplidos, anulaciones) — bloqueado por el diccionario de variables vía `wstest` (D6). **Pendiente confirmar el formato real de error del RNDC** (hoy el parser acepta `<ErrorMSG>` o texto plano).
