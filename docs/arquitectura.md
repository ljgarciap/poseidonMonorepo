# Poseidon — Arquitectura y spec del MVP

Estado: **APROBADA** por Luis (2026-11-07) — decisiones en la sección 9

## 1. Alcance del MVP
**Crear viaje con remesa, manifiesto y cumplido contra el RNDC**, para despachadores internos, en arquitectura multitenant.

Flujo (nota manuscrita de Luis):
1. Crear viaje → crear **remesa(s)** → RNDC devuelve radicado (`ingresoid`) — proceso 3
2. Crear **manifiesto** con la misma información de la(s) remesa(s) → radicado — proceso 4
3. **Cumplir** remesa(s) y luego manifiesto (consecutivo, en ese orden) — procesos 5 y 6
   - Cumplido normal / con suspensión / con diferencia de kilos o carga
   - Cada cumplido genera su radicado
4. Tabla de control: placa, radicado manifiesto, radicado remesa, cumplido, cliente, destino, valor cobrado al cliente, valor pagado al tercero, peso.

### Criterios de aceptación (alto nivel)
- CA1. Un despachador crea un viaje (cliente, origen/destino con sede, vehículo, conductor, carga, valores) y puede radicar remesa y manifiesto sin tocar el portal RNDC.
- CA2. Un manifiesto puede agrupar N remesas (el PDF de ejemplo tiene 2).
- CA3. El estado del viaje siempre refleja el último radicado confirmado; un fallo del RNDC deja el viaje en estado recuperable y reintentable, sin duplicar documentos.
- CA4. Los errores del RNDC se muestran en español tal como los devuelve (diccionario de errores) y quedan en bitácora.
- CA5. Cumplir remesa antes que manifiesto; el sistema impide el orden inverso.
- CA6. Valores de manifiesto (flete, retención en la fuente, ICA, anticipo, saldo) se calculan con parámetros del tenant, no constantes. Referencia del PDF: flete 1.700.000, ret. 17.000 (1%), neto 1.683.000, anticipo 1.200.000, saldo 483.000.
- CA7. Dos tenants nunca ven ni modifican datos del otro (test automático de aislamiento RLS).
- CA8. Todo corre en local con `docker compose up` contra el RNDC de **pruebas**.

## 2. Arquitectura lógica
```
React (web)  ──HTTPS──▶ API Gateway ──▶ Lambda API (handlers)
                                           │  valida, transacción, RLS
                                           ├──▶ PostgreSQL (RDS)
                                           └──▶ Cola RNDC ──▶ Lambda Worker ──▶ RNDC (SOAP)
                                                                  │ lee secreto por tenant
                                                                  └─ escribe rndc_transaccion + radicado
```
- **API** nunca llama al RNDC en línea: encola un `rndc_job` y responde 202. La UI hace polling del estado del documento. Esto aísla la lentitud/intermitencia del RNDC.
- **Worker** (concurrencia limitada por tenant para no saturar al RNDC) hace el envío, interpreta `<ingresoid>` / errores, actualiza el documento y la bitácora.
- **rndc-client** es una librería pura: `registrarRemesa()`, `registrarManifiesto()`, `cumplirRemesa()`, `cumplirManifiesto()`, `registrarTercero()`, `registrarVehiculo()`, `consultar()`, `anular*()`. Sin acceso a BD; recibe credenciales por parámetro. Se prueba con fixtures XML.
- Capas con puertos (`QueuePort`, `SecretsPort`, `AuthPort`) para correr local con implementaciones en memoria/Docker.

## 3. Multitenancy
- Tenant = empresa de transporte habilitada (NIT RNDC). Tabla `tenant` + `tenant_rndc_config` (nit, username, `secret_ref` por ambiente, ambiente activo, host overrides).
- Esquema compartido, `tenant_id` en toda tabla de negocio, **RLS** habilitada y forzada; el rol de aplicación no es dueño de las tablas.
- El `tenant_id` y el rol viajan en el token de autenticación (claims). Roles iniciales: `admin`, `despachador`, `consulta`; `conductor` queda reservado para la app móvil.
- Los maestros del RNDC (terceros, vehículos) son por tenant (cada empresa los registra bajo su NIT).

## 4. Modelo de datos (v0)
| Tabla | Notas |
|---|---|
| `tenant`, `tenant_rndc_config`, `usuario`, `rol` | |
| `tercero` | tipo_id, num_id, nombre, apellidos, teléfono, dirección, municipio, `rndc_sincronizado_at`, hash del último payload enviado |
| `sede_tercero` | cod_sede RNDC, nombre, municipio, dirección, lat/long (ej. hoja RUTAS: D1 Sibaté, ARA Cota…) |
| `cliente` | tercero generador de carga + condiciones comerciales |
| `vehiculo` | placa, configuración, peso vacío, carrocería, propietario/tenedor (tercero), SOAT (aseguradora, póliza, vence) |
| `conductor` | tercero + licencia y vencimiento |
| `tarifa` | tenant, cliente, origen, destino, tipo_vehiculo, flete, vigencia desde/hasta, unidad (viaje/caja/kg) |
| `parametro` | clave/valor por tenant con vigencia (retención %, ICA ‰, horas pacto cargue/descargue…) |
| `viaje` | cliente, origen, destino, vehículo, conductor, estado, fechas, valores cobrado/pagado |
| `remesa` | viaje, consecutivo, carga (naturaleza, empaque, producto, cantidad, unidad), remitente/destinatario+sedes, citas pactadas, `radicado`, estado |
| `manifiesto` | viaje, consecutivo, titular, valores (flete, retenciones, anticipo, saldo), lugar/fecha pago, `radicado`, `autorizacion`, aceptación electrónica |
| `manifiesto_remesa` | N:M |
| `cumplido_remesa` / `cumplido_manifiesto` | tipo (normal/suspensión/diferencia), cantidades cumplidas, fechas/horas, `radicado` |
| `rndc_job`, `rndc_transaccion` | cola persistente, bitácora (proceso, request sanitizado, response, radicado, error, ms) |
| `catalogo_*` | municipios RNDC, naturaleza de carga, empaques, configuraciones, productos (sincronizables con el RNDC) |
| `consecutivo` | por tenant y tipo de documento (remesa/manifiesto), asignación atómica |

### Estados
- `viaje`: BORRADOR → REMESA_PENDIENTE → REMESA_RADICADA → MANIFIESTO_PENDIENTE → MANIFIESTO_RADICADO → REMESA_CUMPLIDA → CUMPLIDO | ANULADO | ERROR_RNDC (con paso de origen para reintento)
- Cada documento (`remesa`, `manifiesto`, cumplidos): PENDIENTE → EN_COLA → RADICADO | RECHAZADO

## 5. Integración RNDC (resumen técnico)
| Tema | Decisión |
|---|---|
| Protocolo | SOAP rpc/encoded, método `AtenderMensajeRNDC(Request:string)`, XML ISO-8859-1 |
| Hosts | `rndcws2…:8080` expedir remesas/manifiestos; `plc…:8080` consultas; `rndcws…:8080` resto. Pruebas: `rndcpruebas…:8080` |
| Respuesta OK | `<root><ingresoid>N</ingresoid></root>`; error = texto en el mismo canal (mapear contra diccionario) |
| Orden de envío | maestros (terceros → vehículos) → remesa → manifiesto → cumplido remesa → cumplido manifiesto |
| Idempotencia | clave (tenant, proceso, consecutivo); antes de reenviar tras un timeout, **consultar** (tipo 3) si el documento ya existe |
| Consultas | SOAP tipo 3; REST (`plc…:8081/Rest/rndc`) para listados |

Detalle en `docs/referencia-rndc.md`.

## 6. Entorno local
`docker-compose.yml`: Postgres 16 + cola local (ElasticMQ o in-memory). Variables de conexión por `.env` (ignorado). Un modo `RNDC_MODE=fake` con servidor SOAP simulado para tests, y `RNDC_MODE=pruebas` para validación contra `rndcpruebas`.

## 7. Consideración de runtime — **requiere confirmación del tercero de infraestructura**
Decisión de Luis: Node 20. Node 20 llegó a fin de vida (EOL) en abril de 2026 y AWS deprecó el runtime `nodejs20.x` en Lambda; en esta fecha puede estar ya bloqueada la *creación* de funciones nuevas con ese runtime. El tercero debe confirmar qué runtimes permite hoy. Mitigación: el código se escribe compatible con Node 20 y 22+ (`engines: >=20`, sin APIs específicas), así que un cambio de runtime no implica rehacer nada.

## 8. Backlog propuesto (PM)
**F0 — Cimientos**
- T0.1 Monorepo, TypeScript, lint, vitest, CI básico
- T0.2 docker-compose + migración inicial + RLS + test de aislamiento
- T0.3 `docs/contrato-infra.md` para el tercero (artefactos, variables, secretos, cola, migraciones, permisos de red al RNDC)

**F1 — rndc-client**
- T1.1 Armado/parseo XML + transporte SOAP + manejo de errores
- T1.2 Tercero (11) y vehículo (12) con fixtures y prueba real en pruebas
- T1.3 Remesa (3), manifiesto (4)
- T1.4 Cumplidos (5, 6) y consultas
- T1.5 Anulaciones (9, 32, 28, 29)

**F2 — Dominio y API**
- T2.1 Autenticación/tenant/roles (pendiente decidir proveedor — ver preguntas)
- T2.2 Maestros: clientes, sedes, vehículos, conductores, terceros + sincronización RNDC
- T2.3 Parámetros y tarifas (CRUD)
- T2.4 Viaje → remesa → manifiesto con cola, worker y bitácora
- T2.5 Cumplidos

**F3 — Web**
- T3.1 Shell, login, selección de tenant implícita por token
- T3.2 Maestros y tarifas (admin)
- T3.3 "Crear viaje" + estado de radicación en vivo
- T3.4 Tabla de control (reemplazo de CONTROL GENERAL) con filtros y exportación

**F4 — Carga inicial de datos del tenant** (solo maestros: conductores/vehículos de `DATOS`, sedes de `RUTAS`, clientes)

Cada tarea pasa por Senior Reviewer; las que tocan auth/secretos/RLS, además por Cybersecurity.

## 9. Decisiones (spec aprobada por Luis, 2026-11-07)
| # | Decisión |
|---|---|
| D1 | **Auth: Cognito**, aprovisionado por el tercero. Claims `tenant_id` y `rol`; sirve a la futura app móvil. |
| D2 | **Consecutivos: prefijo por tenant + número secuencial atómico** por tipo de documento, sin ceros (ej. `TRUCKE1587`). |
| D3 | **Pagos MVP: solo registrar** flete, retenciones, anticipo y saldo en el manifiesto; control de pago real queda fuera. |
| D4 | **Runtime: código compatible con Node 20 y 22** (`engines >=20`); el tercero define el runtime desplegado. |
| D5 | **Conexión a BD: RDS Proxy**, solicitado al tercero en `contrato-infra.md`. |
| D6 | **Diccionario RNDC: se extrae de `wstest`** con credenciales de pruebas entregadas por canal seguro (nunca en el repo). |
| D7 | Cola y secretos: SQS y Secrets Manager (o equivalentes) aprovisionados por el tercero — asumido, a confirmar en el contrato de infra. |
