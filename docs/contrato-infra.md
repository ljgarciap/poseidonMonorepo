# Contrato de infraestructura — Poseidon

Documento para el **tercero que gestiona la infraestructura**. Define qué entrega el equipo de desarrollo y qué necesitamos aprovisionado. Estado: v0 (2026-11-07), a confirmar con el tercero.

## 1. Qué entrega desarrollo
| Artefacto | Detalle |
|---|---|
| Lambdas API | Un paquete `.zip` por función (bundle esbuild, handler ESM), detrás de API Gateway HTTP API |
| Lambda Worker RNDC | Consumidor de la cola SQS de radicaciones (concurrencia limitada, ver §3) |
| Migraciones SQL | `packages/db/migrations/*.sql`, formato node-pg-migrate. Se aplican con el rol **dueño** en cada despliegue, **antes** de activar el nuevo código |
| Frontend | Build estático de React (`apps/web/dist`) para S3 + CloudFront |

## 2. Qué necesitamos aprovisionado
### Cómputo y runtime
- Runtime Node.js: **el más reciente que AWS permita crear hoy**. El código es compatible con Node 20 y superiores (`engines >=20`). Node 20 llegó a EOL en abril 2026; por favor confirmar si `nodejs20.x` aún admite funciones nuevas. Si no, usar 22 o superior.
- Lambdas dentro de la VPC con acceso a RDS (vía RDS Proxy) y salida a Internet (RNDC y servicios AWS).

### Base de datos
- **PostgreSQL 16** en RDS, con **RDS Proxy** (decisión D5). Las Lambdas usan 1 conexión cada una.
- **Dos roles** (modelo idéntico al `docker/postgres/init/01-roles.sql` local):
  - `poseidon_owner`: dueño del esquema. Solo lo usa el paso de migraciones. **No** debe tener `BYPASSRLS` si se puede evitar.
  - `poseidon_app`: runtime de las Lambdas. **No** dueño, **no** superusuario, **sin `BYPASSRLS`**, `NOCREATEDB`, `NOCREATEROLE`. Privilegios por defecto `SELECT/INSERT/UPDATE/DELETE` sobre las tablas creadas por el dueño.
- El aislamiento multitenant depende de que `poseidon_app` esté sujeto a Row Level Security. **Cambiar ese rol por uno con BYPASSRLS rompe el aislamiento entre empresas** — requiere aprobación explícita.
- Backups automáticos y Multi-AZ en producción (a su criterio según costo).

### Cola
- SQS estándar (o FIFO si prefieren) + **DLQ** para radicaciones al RNDC. Reintentos con backoff; `maxReceiveCount` ≈ 5 antes de DLQ.
- Alarma sobre la DLQ (cualquier mensaje = alerta).

### Secretos
- **Secrets Manager** (o equivalente) con un secreto por tenant y ambiente RNDC (`pruebas`/`produccion`), formato `{"username":"...","password":"..."}`. La BD guarda solo la referencia (`tenant_rndc_config.secret_ref`).
- Permiso de lectura del Worker sobre esos secretos, limitado por prefijo (`poseidon/rndc/*`). La API **no** necesita leerlos.
- Secreto con las credenciales de `poseidon_app` para las Lambdas.

### Autenticación (decisión D1)
- **Cognito** User Pool. Claims requeridos en el token: `custom:tenant_id` (UUID del tenant) y `custom:rol` (`admin|despachador|consulta|conductor`).
- El alta de usuarios debe fijar esos claims de forma que **el usuario no pueda modificarlos** (atributos custom no escribibles por el cliente).
- App client para la web (PKCE) y, más adelante, para la app móvil.

### Red hacia el RNDC (a cargo del tercero)
- Salida HTTP al puerto **8080** de `rndcws2`, `plc`, `rndcws` (producción) y `rndcpruebas` (pruebas) de `mintransporte.gov.co`.
- El RNDC bloquea IPs extranjeras (producción permite EE. UU.; pruebas solo Colombia). La gestión de la IP de salida y su habilitación ante el Ministerio es responsabilidad del tercero.

## 3. Variables de entorno de las Lambdas
| Variable | Contenido |
|---|---|
| `DB_PROXY_HOST`, `DB_NAME`, `DB_APP_SECRET_ARN` | Conexión de runtime vía RDS Proxy |
| `RNDC_QUEUE_URL` | Cola de radicaciones |
| `RNDC_SECRET_PREFIX` | Prefijo de secretos RNDC |
| `RNDC_HOSTS_JSON` | Hosts por ambiente (permite apuntar a pruebas/producción sin redeploy de código) |
| `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` | Validación de tokens |

**Nunca** poner contraseñas en variables de entorno planas.

### Concurrencia del Worker
Limitar la concurrencia reservada del Worker (valor inicial sugerido: 5) para no saturar al RNDC; se ajusta con métricas reales.

## 4. Seguridad y operación
- Logs en CloudWatch con retención definida. Los logs de aplicación **no** contienen contraseñas ni XML con `<password>` (se sanitiza en código).
- Entornos: `dev`, `pruebas` (RNDC de pruebas), `produccion`. Un tenant en `pruebas` nunca apunta a hosts de producción.
- Despliegue: migraciones → worker → API → frontend. Rollback de migraciones solo con aprobación del equipo de desarrollo.

## 5. Preguntas para el tercero
1. ¿Qué runtime Node permite hoy la cuenta para funciones nuevas?
2. ¿Pueden crear el rol `poseidon_app` sin `BYPASSRLS` y el rol dueño aparte?
3. ¿Cognito con atributos custom de solo lectura para el cliente? ¿Pool único para todos los tenants?
4. ¿Cuántos entornos y cuál es la cuenta/región objetivo?
5. ¿Quién ejecuta las migraciones en el pipeline y con qué credencial?
