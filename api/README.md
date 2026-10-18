# API de créditos

API REST del módulo de créditos de asociados. Está construida con **Node.js 24 LTS, TypeScript 6 y Express 5** sobre SQL Server 2022.

> Todo se ejecuta en Docker con versiones fijas. No hace falta tener Node.js ni SQL Server instalados en el equipo.

## 1. Arquitectura

Está organizada **por módulos de negocio** y, dentro de cada módulo, **por capas**:

```
src/
├── server.ts                 Punto de entrada de la API: arranque y apagado ordenado
├── worker.ts                 Punto de entrada del worker de webhooks (otro proceso, misma imagen)
├── compositionRoot.ts        Crea repositorios y servicios concretos y los conecta
├── app.ts                    Construye la app Express (sin abrir puertos, testeable)
├── apiRouter.ts              Rutas de negocio bajo /api y su protección
├── config/environment.ts     Variables de entorno validadas con Zod (falla rápido)
├── infrastructure/database/  Pool, transacciones y traducción de errores de SQL Server
├── modules/
│   ├── auth/                 Login, JWT, autenticación y autorización por rol
│   ├── catalogos/            Tipos de crédito y formas de pago
│   ├── creditos/
│   │   ├── domain/           Reglas puras: estados, políticas, asociado, eventos
│   │   ├── repositories/     Interfaces + implementación SQL Server
│   │   ├── CreditoService.ts Reglas de negocio y transacciones
│   │   ├── credito.controller.ts / credito.router.ts / credito.schemas.ts
│   ├── webhooks/             Outbox, firma HMAC, política de reintentos, despachador y worker
│   └── health/               Health checks (liveness / readiness)
└── shared/                   Errores, contrato HTTP, ETag, logger, validación
```

| Capa         | Responsabilidad                                                         | Qué NO hace            |
| ------------ | ----------------------------------------------------------------------- | ---------------------- |
| `router`     | Mapear URL y método al controlador; exigir autenticación y rol          | Lógica                 |
| `controller` | Validar la entrada (Zod), invocar el servicio y armar la respuesta HTTP | Reglas de negocio, SQL |
| `service`    | **Reglas de negocio**, orquestación y transacciones                     | Conocer HTTP o SQL     |
| `repository` | Consultas SQL parametrizadas                                            | Decidir reglas         |
| `domain`     | Estados, políticas y comparaciones: funciones puras                     | E/S de cualquier tipo  |

El servicio depende de **interfaces** de repositorio, no de SQL Server. Por eso las reglas de negocio se prueban con una base de datos en memoria, en milisegundos.

### ¿Dónde están las reglas de negocio y por qué? (punto 6 de la prueba)

| Regla                                                                                                        | Dónde                                                           | Por qué allí                                                           |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Tipos, rangos y formatos (`valorSolicitado > 0`, `tasaInteres >= 0`, `numeroCuotas > 0`, máximo 2 decimales) | `credito.schemas.ts` (Zod) → **400**                            | Se comprueban sin consultar datos; se rechaza lo antes posible         |
| Política por tipo de crédito (monto, plazo y tasa máxima)                                                    | `domain/politicaCredito.ts`, invocada por el servicio → **422** | Depende del catálogo de la BD, que el negocio configura                |
| Duplicados (un crédito activo por asociado y tipo)                                                           | Servicio → **409**, más índice único filtrado en la BD          | El servicio da el mensaje claro y la BD cubre la concurrencia          |
| Identificación existente con otro nombre                                                                     | `domain/asociado.ts`, invocada por el servicio → **409**        | Evita asociar un crédito a la persona equivocada                       |
| Transiciones de estado                                                                                       | `domain/estadoCredito.ts` → **422**                             | Única fuente de verdad, con mensajes que indican qué sí está permitido |
| Inmutabilidad                                                                                                | Servicio, esquema del PATCH y trigger de la BD                  | Defensa en profundidad                                                 |

La **base de datos** repite los invariantes críticos (CHECK, índice único, triggers) como última barrera ante scripts, procesos batch o accesos directos.

## 2. Endpoints

Todos requieren `Authorization: Bearer <token>`, excepto el login y los health checks.

| Método | Ruta                                            | Roles           | Descripción                                         |
| ------ | ----------------------------------------------- | --------------- | --------------------------------------------------- |
| POST   | `/api/auth/login`                               | Público         | Inicia sesión y devuelve el token                   |
| GET    | `/api/auth/me`                                  | Autenticado     | Usuario dueño del token                             |
| GET    | `/api/catalogos`                                | Todos           | Tipos de crédito (con su política) y formas de pago |
| GET    | `/api/creditos`                                 | Todos           | Listado paginado con filtros, búsqueda y orden      |
| GET    | `/api/creditos/resumen`                         | Todos           | Total y cantidad por estado (dashboard)             |
| GET    | `/api/creditos/{id}`                            | Todos           | Detalle, con la versión en `ETag`                   |
| GET    | `/api/creditos/{id}/historial`                  | Todos           | Auditoría del crédito                               |
| GET    | `/api/creditos/{id}/notificaciones`             | Todos           | Traza del webhook: estado y cada intento            |
| POST   | `/api/creditos`                                 | ADMIN, ANALISTA | Crea el crédito y encola el webhook                 |
| PATCH  | `/api/creditos/{id}`                            | ADMIN, ANALISTA | Actualización parcial (**exige `If-Match`**)        |
| PATCH  | `/api/creditos/{id}/estado`                     | ADMIN, ANALISTA | Cambio de estado                                    |
| DELETE | `/api/creditos/{id}`                            | ADMIN           | Borrado lógico (solo en SOLICITADO)                 |
| POST   | `/api/webhooks/notificaciones/{id}/reprogramar` | ADMIN           | Reproceso manual de una notificación FALLIDA        |
| GET    | `/health/live` · `/health/ready`                | Público         | Health checks                                       |

**Parámetros del listado** (`GET /api/creditos`):

- `page` (por defecto 1) y `pageSize` (por defecto 10, máximo 100).
- Filtros: `estado`, `identificacionAsociado`, `tipoCredito`.
- `busqueda`: busca por número de crédito o identificación (por prefijo) y por nombre (contenido, sin distinguir tildes).
- Orden: `ordenarPor` (`fechaSolicitud` | `valorSolicitado` | `numeroCredito` | `estado` | `nombreAsociado`) y `direccion` (`asc` | `desc`).

La respuesta incluye `meta: { page, pageSize, totalItems, totalPages }`.

**Usuarios de demostración** (solo con `SEED_DEMO=true`): `admin@opa.local / Admin123*`, `analista@opa.local / Analista123*`, `consulta@opa.local / Consulta123*`.

## 3. Decisiones de diseño de la API

### 3.1 PATCH en lugar de PUT (ADR-020)

La prueba admite PUT o PATCH. Se eligió **PATCH (actualización parcial)**:

1. **Solo se puede editar una parte del recurso.** Identificación, número, fechas y estado son inmutables. PUT significa "reemplazar el recurso completo", lo que obligaría a reenviar campos que nunca pueden cambiar.
2. **Auditoría exacta.** El cliente envía solo lo que cambia y el historial registra cada campo modificado con su valor anterior y nuevo (`{"valorSolicitado": {"anterior": 15000000, "nuevo": 12000000}}`). Si los valores enviados son iguales a los actuales, no se escribe nada.
3. **Menor riesgo de sobrescribir datos.** Con PUT, un cliente con datos viejos en pantalla reenviaría todos los campos y podría pisar cambios ajenos.
4. **El estado tiene su propio endpoint.** Se cambia con `PATCH /api/creditos/{id}/estado`, porque es una acción de negocio con reglas propias (transiciones y observación), no una edición de datos.

Enviar un campo inmutable responde `422 CAMPO_INMUTABLE`, y `PUT` responde `405` indicando que se use PATCH.

### 3.2 Concurrencia optimista con ETag / If-Match (ADR-021)

Problema que resuelve, la "actualización perdida": dos analistas abren el mismo crédito y el segundo en guardar borraría sin saberlo el cambio del primero.

1. Toda respuesta con un crédito trae su versión en la cabecera `ETag` y en el campo `version` del cuerpo. La versión es la columna `ROWVERSION` de SQL Server, que cambia sola con cada modificación.
2. Para editar (`PATCH /api/creditos/{id}`), el cliente envía esa versión en `If-Match`.
3. La API lee y bloquea el crédito dentro de la transacción y compara versiones:
   - Si falta `If-Match`: **428 Precondition Required**.
   - Si la versión no es la vigente: **412 Precondition Failed**. El usuario debe recargar.

Se usan **412 y 428**, que son los códigos que define el estándar HTTP para precondiciones (RFC 9110 y RFC 6585), en lugar de un 409 genérico. Así el cliente distingue "alguien modificó el crédito" de "el crédito está duplicado".

Para los **cambios de estado no se exige `If-Match`**. La transición se valida contra el estado vigente con la fila bloqueada, así que si dos usuarios actúan a la vez, el segundo recibe 422 si su transición ya no aplica.

### 3.3 Identificación existente con otro nombre (ADR-022)

Si la identificación ya está registrada con un nombre distinto, se responde **409 `ASOCIADO_NOMBRE_NO_COINCIDE`**. Un nombre que no coincide suele indicar un error de digitación en la cédula, y en finanzas es preferible detener la operación que asociar el crédito a otra persona. Las diferencias de tildes, mayúsculas o espacios no cuentan como nombres distintos (`Juan Pérez` = `JUAN PEREZ`).

### 3.4 Autenticación JWT (ADR-023)

- `POST /api/auth/login` valida la contraseña con **bcrypt** y emite un **JWT HS256** con vigencia de 60 minutos (configurable).
- El token se verifica en cada petición sin consultar la base de datos. La API es **stateless** y escala horizontalmente.
- Contra la enumeración de usuarios, cualquier fallo de login responde el mismo mensaje, y un correo inexistente tarda lo mismo que uno real.
- El login admite 10 intentos por IP cada 15 minutos. El resto de la API admite 300 peticiones por minuto por IP.
- El historial registra el usuario del token en cada cambio.

### 3.5 Webhook: outbox transaccional + worker (ADR-005, ADR-025)

```
POST /api/creditos ──► [ transacción: Crédito + Historial + Evento PENDIENTE ] ──► 201
                                                   │
                  webhook-worker (proceso aparte)  ▼
        reclama PENDIENTE ──► POST firmado ──► sistema externo
                 │                                  │
                 └── registra intento ◄── 2xx / 5xx / timeout / 4xx
                       ENVIADO | PENDIENTE (reintento con backoff) | FALLIDO
```

- **Sin lógica duplicada ni segundo INSERT.** El evento lo encola `CreditoService.crear` en la misma transacción del crédito. El worker solo lee la bandeja de salida.
- **Si el sistema externo no responde, devuelve error o está caído,** el crédito ya está creado y no se afecta. Se reintenta en caso de timeout, falta de conexión, 5xx, 408 y 429, con esperas crecientes de 10 s, 20 s, 40 s... y ±20 % de variación. Los demás 4xx son permanentes y pasan directo a FALLIDO. Después de 6 intentos el evento queda FALLIDO y un ADMIN puede reprogramarlo.
- **Firma HMAC-SHA256 con timestamp.** El worker envía las cabeceras `X-Webhook-Id`, `X-Webhook-Event`, `X-Webhook-Timestamp` y `X-Webhook-Signature: sha256=...`, y el receptor verifica autenticidad, integridad y antigüedad.
- **Al menos una vez + idempotencia.** El `eventId` es estable entre reintentos y el receptor descarta los duplicados.
- **Varios workers sin envíos dobles.** Cada worker reclama eventos con `UPDLOCK + READPAST`. Si un worker se cae, sus eventos se retoman al vencer `bloqueadoHasta`.
- **Traza completa.** `WebhookNotificaciones` guarda el estado y `WebhookIntentos` cada intento, con código HTTP, duración y error. Se consulta en `GET /api/creditos/{id}/notificaciones`.
- **Liveness del worker.** Como no expone HTTP, escribe un archivo de latido en cada ciclo, y el healthcheck de Docker verifica que tenga menos de 60 s.

Los comandos para probar el webhook y sus fallas están en `docs/como-probar-el-webhook.md`, en la raíz del repositorio.

### 3.6 Documentación OpenAPI / Swagger (ADR-028)

- **Swagger UI:** `http://localhost:3000/api/docs`. Permite probar todos los endpoints: login, _Authorize_ con el token y _Try it out_.
- **Documento OpenAPI 3.1:** `http://localhost:3000/api/docs/openapi.json`. Se puede importar en Postman o en generadores de clientes.
- **Una sola fuente de verdad.** Los esquemas se **generan desde Zod** con `z.toJSONSchema`, sin escribirlos a mano. Las entradas usan los mismos esquemas que validan las peticiones, y las salidas usan los esquemas de `src/docs/openapiSchemas.ts`.
- **Verificada por pruebas de contrato** (`tests/http/openapi.contract.test.ts`):
  1. El documento es OpenAPI 3.1 válido según el validador oficial.
  2. Cada operación documentada existe en la API.
  3. Las respuestas reales cumplen los esquemas documentados, que son estrictos: un campo no documentado hace fallar la prueba.
  4. Los tipos de TypeScript coinciden con los esquemas.
- **Webhooks salientes documentados.** La sección `webhooks` de OpenAPI 3.1 describe `credito.creado`: cuerpo, cabeceras de firma, reintentos y respuestas esperadas.
- **Error real detectado.** Al escribir estas pruebas se descubrió que el listado exponía el campo interno `asociadoId`. TypeScript no lo detecta, porque permite propiedades adicionales; el esquema estricto sí.
- Se controla con `API_DOCS_ENABLED`, activa por defecto para la evaluación. En producción real conviene desactivarla o publicarla solo en la red interna.

## 4. Convenciones

- **Idioma:** el vocabulario de negocio está en español, como el enunciado; los términos técnicos en inglés; comentarios y mensajes en español.
- **Respuesta estándar:**
  - Éxito: `{ "success": true, "data": ..., "meta": ... }`
  - Error: `{ "success": false, "error": { "code", "message", "details?", "requestId" } }`
- **Códigos HTTP:**

  | Código    | Significado                              |
  | --------- | ---------------------------------------- |
  | 400       | Datos mal formados                       |
  | 401       | Sin token válido                         |
  | 403       | Rol sin permiso                          |
  | 404       | No existe                                |
  | 405       | Método no permitido                      |
  | 409       | Duplicado o asociado con otro nombre     |
  | 412 / 428 | Versión vencida o faltante               |
  | 422       | Regla de negocio violada                 |
  | 429       | Límite de peticiones superado            |
  | 500       | Error inesperado (sin detalles internos) |
  | 503       | Dependencia caída                        |

- **Trazabilidad:** cada petición tiene un `X-Request-Id`, que aparece en la cabecera, en los errores y en los logs.
- **Dinero:** número con máximo 2 decimales en la API y `DECIMAL(18,2)` en la base de datos. Nunca `FLOAT`.

## 5. Ejecución y pruebas

Todos los comandos se ejecutan desde la raíz del repositorio.

```powershell
# Modo evaluación (imágenes de producción)
docker compose up -d --build
curl http://localhost:3000/health/ready

# Pruebas unitarias y HTTP (sin base de datos); también corren al construir la imagen
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps api npm test

# Pruebas de integración contra el SQL Server real
docker compose --profile test run --rm api-integration-tests

# Modo desarrollo (recarga automática al guardar cambios en api/src)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

| Suite               | Qué verifica                                                                                        | Base de datos   |
| ------------------- | --------------------------------------------------------------------------------------------------- | --------------- |
| `tests/unit`        | Máquina de estados (todas las combinaciones), políticas, nombres, servicio (incluida la atomicidad) | En memoria      |
| `tests/http`        | Rutas, autenticación, roles, códigos HTTP, ETag/If-Match, validaciones                              | En memoria      |
| `tests-integration` | SQL real: transacción crédito + historial + outbox, índices, bloqueos, búsqueda                     | SQL Server real |

Swagger UI (`/api/docs`) permite probar todo desde el navegador. El archivo `docs/creditos.http` contiene peticiones listas para probar a mano con la extensión REST Client de VS Code.

## 6. Variables de entorno

| Variable                      | Obligatoria | Por defecto                                     | Descripción                                       |
| ----------------------------- | ----------- | ----------------------------------------------- | ------------------------------------------------- |
| `NODE_ENV`                    | No          | `development`                                   | `development` \| `test` \| `production`           |
| `PORT`                        | No          | `3000`                                          | Puerto HTTP                                       |
| `LOG_LEVEL`                   | No          | `info`                                          | Nivel de log de pino                              |
| `CORS_ALLOWED_ORIGINS`        | No          | `http://localhost:5173`                         | Orígenes permitidos, separados por coma           |
| `DB_HOST`                     | **Sí**      | —                                               | Servidor SQL Server                               |
| `DB_PORT`                     | No          | `1433`                                          | Puerto SQL Server                                 |
| `DB_NAME`                     | No          | `CreditosOPA`                                   | Base de datos                                     |
| `DB_USER`                     | **Sí**      | —                                               | Login propio; en producción no se acepta `sa`     |
| `DB_PASSWORD`                 | **Sí**      | —                                               | Contraseña de base de datos                       |
| `DB_ENCRYPT`                  | No          | `true`                                          | Cifrado TLS hacia SQL Server                      |
| `DB_TRUST_SERVER_CERTIFICATE` | No          | `false`                                         | Aceptar certificado autofirmado (solo desarrollo) |
| `DB_POOL_MAX`                 | No          | `10`                                            | Conexiones máximas del pool                       |
| `JWT_SECRET`                  | **Sí**      | —                                               | Secreto de firma (mínimo 32 caracteres)           |
| `JWT_EXPIRES_IN_MINUTES`      | No          | `60`                                            | Vigencia del token                                |
| `JWT_ISSUER` / `JWT_AUDIENCE` | No          | `creditos-opa-api` / `creditos-opa-web`         | Emisor y audiencia del token                      |
| `API_DOCS_ENABLED`            | No          | `true`                                          | Publica Swagger UI en `/api/docs`                 |
| `TRUST_PROXY_HOPS`            | No          | `0`                                             | Proxies inversos de confianza (Nginx del web = 1) |
| `WEBHOOK_URL`                 | No          | `https://sistema-externo.com/webhooks/creditos` | Destino del evento `credito.creado`               |

Si falta una variable obligatoria o tiene un formato inválido, la API no arranca y muestra exactamente qué corregir.

### Variables del worker de webhooks (`worker.ts`)

Usa las mismas variables `DB_*`, `NODE_ENV` y `LOG_LEVEL` que la API, más estas:

| Variable                     | Obligatoria | Por defecto                     | Descripción                                                  |
| ---------------------------- | ----------- | ------------------------------- | ------------------------------------------------------------ |
| `WEBHOOK_SECRET`             | **Sí**      | —                               | Secreto compartido para la firma HMAC (mínimo 32 caracteres) |
| `WEBHOOK_POLL_INTERVAL_MS`   | No          | `2000`                          | Espera entre consultas cuando no hay pendientes              |
| `WEBHOOK_BATCH_SIZE`         | No          | `10`                            | Eventos por ciclo (se envían en paralelo)                    |
| `WEBHOOK_REQUEST_TIMEOUT_MS` | No          | `10000`                         | Tiempo máximo de respuesta del externo                       |
| `WEBHOOK_RETRY_BASE_SECONDS` | No          | `10`                            | Primera espera entre reintentos                              |
| `WEBHOOK_RETRY_MAX_SECONDS`  | No          | `3600`                          | Tope de espera entre reintentos                              |
| `WORKER_HEARTBEAT_FILE`      | No          | `/tmp/webhook-worker.heartbeat` | Archivo de latido para el healthcheck                        |
