# Poseidon — Contrato de APIs (v0, BORRADOR para revisión)

Estado: borrador del 2026-11-10; decisiones D8–D11 resueltas por Luis (sección 5). Se define **antes** de implementar handlers (pedido del equipo: primero las APIs, qué datos recibe cada una y la arquitectura; luego el código).
Fuente de las variables RNDC: `docs/rndc-diccionario.md` y `docs/referencia-rndc.md`.

## 1. Convenciones
- Base: `/v1`. JSON UTF-8 (la conversión a ISO-8859-1 ocurre solo dentro de `rndc-client`). Campos en `camelCase`, nombres de negocio alineados con el RNDC (remesa, manifiesto, cumplido).
- **Auth:** `Authorization: Bearer <JWT Cognito>`. El `tenantId` y el `rol` salen del token, **nunca** del body ni de la URL.
- **Roles:** `admin` (todo), `despachador` (viajes/remesas/manifiestos/maestros), `consulta` (solo GET), `conductor` (reservado, app móvil futura).
- **Operaciones que tocan el RNDC son asíncronas:** responden `202 Accepted` con `{ "jobId", "estado": "EN_COLA" }`; el estado final se consulta en el recurso (`radicado`, `estado`) o en `GET /v1/jobs/{jobId}`. La API nunca espera al RNDC.
- **Idempotencia:** header obligatorio `Idempotency-Key` en todo `POST` que cree o radique. Misma clave + mismo cuerpo = misma respuesta, sin duplicar.
- **Paginación:** `?limit=50&cursor=…`; respuesta `{ "items": [], "nextCursor": null }`.
- **Errores** (`application/problem+json`): `{ "type", "title", "status", "detail", "errores":[{ "campo", "mensaje" }], "rndc": { "codigo": "RNDC11", "mensajes": [] } }`.
  - `400` validación · `401/403` auth/rol · `404` no existe (también si es de otro tenant) · `409` estado inválido o duplicado · `422` rechazo de negocio del RNDC · `502/504` RNDC no disponible (el job se reintenta solo).

## 2. Mapa de endpoints → Lambda → proceso RNDC
**Decisión D8: una Lambda por endpoint.** Cada fila de la tabla es su propia función, con nombre `<recurso>-<accion>` (ej. `manifiestos-crear`, `manifiestos-consultar`, `manifiestos-cumplir`) y su propio bundle. La columna *Lambda* indica la familia (carpeta `packages/api/src/handlers/<recurso>/`); la lógica compartida vive en `packages/core`, no en los handlers, que solo validan entrada, abren `withTenant()` y delegan. Todas comparten el mismo código de autenticación y manejo de errores.

| Lambda | Método y ruta | Qué hace | RNDC |
|---|---|---|---|
| `viajes-api` | `POST /viajes` | Crea viaje en BORRADOR con sus remesas y el manifiesto | — |
| | `GET /viajes` · `GET /viajes/{id}` | Lista (filtros) / detalle con radicados y cumplidos | — |
| | `POST /viajes/{id}/radicar` | Radica remesa(s) y luego manifiesto, en orden | 3 → 4 |
| | `POST /viajes/{id}/cumplir` | Cumple remesa(s) y luego manifiesto, en orden | 5 → 6 |
| | ~~`POST /viajes/{id}/anular`~~ | *Post-MVP (D11)* | 32, 9 (+28, 29) |
| `remesas-api` | `POST /remesas` · `GET /remesas` · `GET /remesas/{id}` | Crear / consultar | — |
| | `POST /remesas/{id}/radicar` | Expide la remesa | 3 |
| | `POST /remesas/{id}/cumplido` | Cumple (normal / suspensión / diferencia de cantidad) | 5 |
| | ~~`POST /remesas/{id}/anular`~~ | *Post-MVP (D11)* | 9 / 28 |
| `manifiestos-api` | `POST /manifiestos` · `GET /manifiestos` · `GET /manifiestos/{id}` | Crear / consultar | — |
| | `POST /manifiestos/{id}/radicar` | Expide el manifiesto | 4 |
| | `POST /manifiestos/{id}/cumplido` | Cumple manifiesto | 6 |
| | ~~`POST /manifiestos/{id}/anular`~~ | *Post-MVP (D11)* | 32 / 29 |
| | `GET /manifiestos/{id}/aceptacion` | Consulta firma/aceptación electrónica | 73 (consulta) |
| `maestros-api` | CRUD `/terceros`, `/vehiculos`, `/conductores`, `/clientes`, `/sedes` | Maestros del tenant | — |
| | `POST /terceros/{id}/sincronizar` · `POST /vehiculos/{id}/sincronizar` | Registra/actualiza en RNDC solo si cambió | 11 · 12 |
| `parametros-api` | CRUD `/tarifas`, `/parametros`; `POST /tarifas/cotizar` | Tarifas pactadas y parámetros (retención, ICA, horas pacto…) | — |
| `operacion-api` | `GET /jobs/{id}` · `GET /rndc/transacciones` | Estado de jobs y bitácora RNDC | — |
| `rndc-worker` | (consumidor de cola) | Envía al RNDC, interpreta radicado/errores, actualiza estados y bitácora | 3, 4, 5, 6, 11, 12 (MVP) |

## 3. Contratos de las operaciones principales

### 3.1 `POST /v1/manifiestos` — crear (borrador, no toca el RNDC)
```json
{
  "viajeId": "uuid | null",
  "tipoOperacion": "G",
  "fechaExpedicion": "2026-09-27",
  "origenMunicipio": "25214000",
  "destinoMunicipio": "05001000",
  "viaCodigo": "11872",
  "titular": { "tipoId": "N", "numId": "9017977765" },
  "placa": "PWY561",
  "placaRemolque": null,
  "conductor": { "tipoId": "C", "numId": "1033784337" },
  "conductor2": null,
  "remesaIds": ["uuid", "uuid"],
  "valores": { "fletePactado": 1700000, "anticipo": 1200000 },
  "pagoSaldo": { "municipio": "25214000", "fecha": "2026-10-17" },
  "responsablePagoCargue": "REMITENTE",
  "responsablePagoDescargue": "REMITENTE",
  "aceptacionElectronica": true,
  "observaciones": ""
}
```
- **Los valores derivados NO los envía el cliente:** `retencionFuente`, `retencionIca`, `netoAPagar` y `saldo` los calcula el servidor con los parámetros del tenant (ej. ejemplo del PDF: retención 17.000 = 1 %, neto 1.683.000, saldo 483.000). La respuesta los devuelve.
- El `consecutivo` lo asigna el servidor (prefijo del tenant + número atómico, p. ej. `TRUCKE1438`).
- Validaciones: remesas del mismo tenant y sin otro manifiesto, vehículo y conductor registrados, anticipo ≤ neto, municipios válidos.
- Respuesta `201`: manifiesto completo con `estado: "BORRADOR"`, `radicado: null`.

Mapeo a RNDC (proceso 4): `fletePactado→VALORFLETEPACTADOVIAJE`, `retencionFuente→RETENCIONFUENTEMANIFIESTO`, `retencionIca→RETENCIONICAMANIFIESTOCARGA`, `anticipo→VALORANTICIPOMANIFIESTO`, `pagoSaldo.municipio→CODMUNICIPIOPAGOSALDO`, `pagoSaldo.fecha→FECHAPAGOSALDOMANIFIESTO`, `remesaIds→REMESASMAN/CONSECUTIVOREMESA`, `titular→CODIDTITULARMANIFIESTO/NUMIDTITULARMANIFIESTO`, `conductor→CODIDCONDUCTOR/NUMIDCONDUCTOR`, etc.

### 3.2 `POST /v1/manifiestos/{id}/radicar`
Sin cuerpo. Precondiciones: manifiesto `BORRADOR`, todas sus remesas `RADICADA`. `202` + `jobId`. Estado final: `RADICADO` con `radicado` y `autorizacion`, o `RECHAZADO` con el mensaje del RNDC. Si falla el transporte, el job reintenta; antes de reenviar el worker **consulta** si el documento ya existe (evita duplicados).

### 3.3 `GET /v1/manifiestos` — consultar
Filtros: `estado`, `placa`, `conductorNumId`, `clienteId`, `destinoId`, `desde`, `hasta`, `consecutivo`, `radicado`. Cada ítem: consecutivo, radicado, autorización, estado, placa, conductor, origen/destino, flete, anticipo, saldo, remesas (consecutivo + radicado), `cumplido`. Es la base de la **tabla de control** (reemplazo de `CONTROL GENERAL`).

### 3.4 `POST /v1/manifiestos/{id}/cumplido` — cumplir manifiesto
```json
{
  "tipo": "NORMAL",
  "fechaEntregaDocumentos": "2026-10-20",
  "valorAdicionalFlete": 0,
  "valorAdicionalHorasCargue": 0,
  "valorAdicionalHorasDescargue": 0,
  "motivoValorAdicional": null,
  "valorDescuentoFlete": 0,
  "motivoDescuento": null,
  "valorSobreAnticipo": 0,
  "motivoSuspension": null,
  "consecuenciaSuspension": null,
  "observaciones": ""
}
```
`tipo`: `NORMAL | SUSPENSION` (se traduce a los códigos del RNDC mediante catálogo). Precondiciones: manifiesto `RADICADO` y **todas las remesas con cumplido radicado**. → proceso 6.

### 3.5 `POST /v1/remesas` y `POST /v1/remesas/{id}/cumplido`
Crear remesa (proceso 3; el consecutivo lo asigna el servidor):
```json
{
  "viajeId": "uuid | null",
  "clienteId": "uuid",
  "tipoOperacion": "G",
  "naturalezaCarga": "1",
  "empaque": "0",
  "producto": { "codigo": "000701", "descripcion": "PAPA" },
  "cantidad": 1400,
  "unidadMedida": "KILOGRAMOS",
  "remitente": { "terceroId": "uuid", "sedeId": "uuid" },
  "destinatario": { "terceroId": "uuid", "sedeId": "uuid" },
  "propietarioCarga": { "terceroId": "uuid", "sedeId": "uuid" },
  "pactoCargue": { "horas": 1, "minutos": 0 },
  "pactoDescargue": { "horas": 1, "minutos": 0 },
  "citaCargue": "2026-09-27T06:00",
  "citaDescargue": "2026-09-28T06:00",
  "valorCobrado": 0
}
```
Cumplir remesa (proceso 5) — cubre los 3 casos de la nota del flujo:
```json
{
  "tipo": "NORMAL | SUSPENSION | DIFERENCIA_CANTIDAD",
  "motivoSuspension": null,
  "cantidadCargada": 1400,
  "cantidadEntregada": 1350,
  "tiempos": {
    "llegadaCargue": "…", "entradaCargue": "…", "salidaCargue": "…",
    "llegadaDescargue": "…", "entradaDescargue": "…", "salidaDescargue": "…"
  },
  "observaciones": ""
}
```
Regla: `cantidadEntregada ≠ cantidadCargada` obliga a `DIFERENCIA_CANTIDAD`; `SUSPENSION` exige `motivoSuspension`.

### 3.6 `POST /v1/viajes` — "Crear viaje" (flujo de la nota)
Un solo envío con el cliente, el vehículo/conductor, las remesas y los valores del manifiesto; crea todo en BORRADOR coherente (la misma información de la remesa se reutiliza en el manifiesto). Después: `POST /viajes/{id}/radicar` (remesa → manifiesto) y `POST /viajes/{id}/cumplir` (remesa → manifiesto, en ese orden). Devuelve el viaje con los campos de la tabla de control: placa, radicados, cliente, destino, valor cobrado, valor pagado al tercero y peso.

### 3.7 Estados que expone la API
`BORRADOR → EN_COLA → RADICADO | RECHAZADO` por documento; viaje: `BORRADOR → REMESA_RADICADA → MANIFIESTO_RADICADO → REMESA_CUMPLIDA → CUMPLIDO | ANULADO | ERROR_RNDC` (ver `docs/arquitectura.md` §4).

## 4. Fuera del contrato v0
Anulaciones (remesa, manifiesto, cumplidos; procesos 9, 28, 29, 32; mientras tanto se hacen en el portal RNDC), facturación (DIAN y proceso 86), asiento contable, app móvil de conductores, control de pago real del anticipo/saldo.

## 5. Decisiones (Luis, 2026-11-10)
| # | Decisión |
|---|---|
| D8 | **Una Lambda por endpoint** (ver sección 2). |
| D9 | **El servidor calcula** retención en la fuente, ICA, neto y saldo con parámetros del tenant; el cliente solo envía flete y anticipo. |
| D10 | **Catálogos legibles:** la API usa valores como `KILOGRAMOS`, `REMITENTE`, `NORMAL`; un catálogo interno los traduce a códigos RNDC. |
| D11 | **Anular queda fuera del MVP.** El MVP cubre crear, radicar y cumplir. |

## 6. Pendientes
1. **Tope de remesas por manifiesto:** el diccionario lista `CONSECUTIVOREMESA` 5 veces; falta confirmar si 5 es el máximo (se verifica registrando en pruebas).
2. **Catálogos reales:** levantar desde el RNDC los códigos de naturaleza de carga, empaque, unidad, responsable de pago y tipo de cumplido para poblar el catálogo interno (D10).
3. En la transcripción del equipo dicen «se mantiene el nombre del otro servicio»; se interpretó como mantener los nombres del RNDC (remesa, manifiesto, cumplido, radicado). Confirmar.
