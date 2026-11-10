# Poseidon

Sistema multitenant de gestión de transporte de carga para empresas colombianas, integrado con el **RNDC** (Ministerio de Transporte) por SOAP/XML. Reemplaza los Excel de control de viajes y la radicación manual en el portal del RNDC.

Primer tenant: **Truck Express S.A.S.**

## Alcance del MVP
Crear un viaje con **remesa, manifiesto y cumplidos** contra el RNDC, usado por despachadores internos. La app móvil de conductores, la facturación, el asiento contable y la migración del histórico quedan fuera del MVP.

## Stack
| Capa | Tecnología |
|---|---|
| Backend | Node.js 20 + TypeScript, AWS Lambda (una Lambda por endpoint) |
| Base de datos | PostgreSQL 16 (RDS en nube, Docker en local) con Row Level Security |
| Acceso a datos | Kysely + node-pg-migrate |
| Asíncrono | Cola (SQS) + DLQ para toda llamada al RNDC |
| Frontend | React + Vite + TypeScript (pendiente) |
| Infraestructura | Gestionada por un tercero; este repo no contiene IaC |

## Estructura
```
packages/
  rndc-client/   cliente SOAP/XML del RNDC
  core/          dominio (pendiente)
  api/           handlers Lambda (pendiente)
  db/            migraciones, tipos Kysely, helpers de tenancy
apps/web/        frontend React (pendiente)
docs/            arquitectura, contratos, referencia RNDC
scripts/         migraciones y sondeo del RNDC
```

## Puesta en marcha
Requiere Node ≥ 20.19 y Docker.
```
cp .env.example .env
npm install
npm run db:up        # Postgres 16 en localhost:5433
npm run db:migrate
npm test
npm run typecheck && npm run lint
```
`npm run db:reset` borra el volumen y recrea la base.

Los tests y el runtime usan el rol `poseidon_app`, sujeto a RLS. Nunca apuntar la API al rol dueño.

## Reglas clave
- Todo dato de negocio lleva `tenant_id`; el tenant sale del token, nunca del body.
- Las credenciales del RNDC viven solo en el gestor de secretos. En local, `.env` está en `.gitignore`.
- Los valores de negocio (tarifas, retención, ICA, horas pacto) van en tablas paramétricas por tenant, sin hardcodear.
- Los tests automáticos solo apuntan al RNDC de **pruebas**, nunca a producción.
- Los insumos de la empresa (Excel, PDFs, imágenes) no se suben al repo.

## Documentación
| Documento | Contenido |
|---|---|
| [`docs/arquitectura.md`](docs/arquitectura.md) | Especificación del MVP, modelo de datos, backlog y decisiones |
| [`docs/api-contrato.md`](docs/api-contrato.md) | Contrato de las APIs por Lambda (borrador v0) |
| [`docs/referencia-rndc.md`](docs/referencia-rndc.md) | Resumen de la guía del RNDC V6 |
| [`docs/rndc-diccionario.md`](docs/rndc-diccionario.md) | Variables por proceso del RNDC |
| [`docs/contrato-infra.md`](docs/contrato-infra.md) | Qué entrega desarrollo y qué se pide al tercero de infraestructura |

El contrato de cada endpoint se aprueba antes de implementar su handler.

## Estado
- Fase 0: monorepo, Postgres local, tenancy con RLS y test de aislamiento.
- Fase 1: transporte del `rndc-client` listo (T1.1). Faltan los métodos tipados de maestros, remesa, manifiesto y cumplidos.
- Contrato de APIs en borrador, pendiente de revisión del equipo.
