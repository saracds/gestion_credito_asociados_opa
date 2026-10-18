# Módulo de créditos de asociados

Prueba técnica para **OPA SAS** (desarrollador semi senior, sector financiero
solidario). El módulo lleva una solicitud de crédito de un asociado desde que
se registra hasta que se desembolsa:

- reglas de negocio y control de duplicados;
- auditoría de cada cambio;
- notificación a un sistema externo mediante un webhook confiable.

| Componente | Tecnología |
|---|---|
| API REST | Node.js 24, TypeScript 6, Express 5, Zod 4 |
| Base de datos | SQL Server 2022 con scripts versionados |
| Webhook | Outbox transaccional + worker con reintentos y firma HMAC-SHA256 |
| Frontend | React 19, Vite 8, Tailwind 4, servido por Nginx |
| Documentación de la API | OpenAPI 3.1 / Swagger UI |
| Ejecución | Docker Compose con versiones fijas: no requiere instalar nada más |

## Puesta en marcha

**Requisito único:** Docker Desktop (con Docker Compose v2).

```powershell
# 1. Variables de entorno (copiar y, si se desea, cambiar las claves)
copy .env.example .env

# 2. Construir y levantar todo
docker compose up -d --build

# 3. Esperar a que la base quede lista (termina con "✔ Base de datos lista.")
docker compose logs -f db-init
```

En Linux o macOS el primer paso es `cp .env.example .env`.

La primera construcción tarda unos minutos: descarga SQL Server y Node.js, y
**ejecuta las pruebas automatizadas dentro de cada imagen** (si alguna falla,
la imagen no se construye).

| Qué | Dirección |
|---|---|
| **Aplicación web** | http://localhost:8080 |
| **Swagger (probar la API)** | http://localhost:3000/api/docs |
| Estado de la API | http://localhost:3000/health/ready |
| Webhooks recibidos por el sistema externo simulado | http://localhost:4000/eventos |
| SQL Server (SSMS / Azure Data Studio) | `localhost,14330` |

### Usuarios de demostración

| Usuario | Clave | Rol: qué puede hacer |
|---|---|---|
| `admin@opa.local` | `Admin123*` | ADMIN: todo, además eliminar créditos y reprogramar webhooks |
| `analista@opa.local` | `Analista123*` | ANALISTA: crear, editar y cambiar el estado de créditos |
| `consulta@opa.local` | `Consulta123*` | CONSULTA: solo consultar |

Para probar la API en Swagger: ejecutar `POST /api/auth/login`, copiar el
`accessToken`, pulsar **Authorize** y pegarlo.

### Detener o empezar de cero

```powershell
docker compose down        # detiene (conserva los datos)
docker compose down -v     # detiene y borra la base de datos
```

## Pruebas

| Pruebas | Cómo se ejecutan | Qué cubren |
|---|---|---|
| **API:** 189 unitarias, HTTP y de contrato | Automáticamente en `docker compose up --build` (o `cd api && npm ci && npm test` con Node 24) | Dominio, servicio, rutas, seguridad, errores, webhook, y que las respuestas cumplan el documento OpenAPI |
| **Frontend:** 22 | Automáticamente al construir la imagen `web` (o `cd web && npm ci && npm test`) | Cliente HTTP, formulario, detalle del crédito (acciones por estado y rol, conflicto 412), formatos |
| **Integración** con SQL Server real | `docker compose --profile test run --rm api-integration-tests` | Transacciones, bloqueos, triggers, índices y el webhook de punta a punta, cada componente con su login de mínimo privilegio |
| **Base de datos:** 44 casos | `docker compose run --rm --entrypoint /database/ejecutar-pruebas.sh db-init` | Restricciones, triggers de inmutabilidad, duplicados y permisos de cada login |

## Probar el webhook

El contenedor `webhook-receptor` simula el sistema externo: verifica la firma
HMAC, descarta duplicados y puede simular fallas.

```powershell
# Ver lo que ha recibido
Invoke-RestMethod http://localhost:4000/eventos

# Simular que el sistema externo está caído (responde 503)
Invoke-RestMethod -Method Put -Uri http://localhost:4000/modo `
  -ContentType 'application/json' -Body '{"modo":"caido"}'

# Volver a la normalidad
Invoke-RestMethod -Method Put -Uri http://localhost:4000/modo `
  -ContentType 'application/json' -Body '{"modo":"normal"}'
```

Modos disponibles: `normal`, `falla-temporal`, `caido`, `lento` y `rechazar`.

Al crear un crédito con el receptor caído se ven los reintentos en vivo en el
detalle del crédito. Todos los escenarios, con sus comandos, están en
[cómo probar el webhook](docs/como-probar-el-webhook.md).

## Endpoints principales

Todos bajo `/api`; salvo el login, todos requieren `Authorization: Bearer <token>`.
La referencia completa, con ejemplos y códigos de error, está en Swagger.

| Método | Ruta | Descripción | Roles |
|---|---|---|---|
| `POST` | `/auth/login` | Inicia sesión y devuelve el JWT | Público |
| `GET` | `/auth/me` | Usuario de la sesión | Todos |
| `GET` | `/catalogos` | Tipos de crédito (con sus límites) y formas de pago | Todos |
| `GET` | `/creditos` | Listado paginado con filtros, búsqueda y orden | Todos |
| `GET` | `/creditos/resumen` | Cantidad y valor por estado | Todos |
| `POST` | `/creditos` | Crea un crédito y encola el webhook `credito.creado` | ADMIN, ANALISTA |
| `GET` | `/creditos/{id}` | Detalle, versión (`ETag`) y acciones permitidas | Todos |
| `PATCH` | `/creditos/{id}` | Edita condiciones; exige `If-Match` | ADMIN, ANALISTA |
| `PATCH` | `/creditos/{id}/estado` | Cambia el estado según la máquina de estados | ADMIN, ANALISTA |
| `DELETE` | `/creditos/{id}` | Borrado lógico (solo en Solicitado) | ADMIN |
| `GET` | `/creditos/{id}/historial` | Auditoría de cambios | Todos |
| `GET` | `/creditos/{id}/notificaciones` | Traza de envíos del webhook | Todos |
| `POST` | `/webhooks/notificaciones/{id}/reprogramar` | Reintenta un webhook fallido | ADMIN |

## Estructura del repositorio

```
creditos-opa/
├── api/                 API REST y worker de webhooks (misma imagen)
├── database/            Scripts SQL versionados, permisos, pruebas y Dockerfile
├── web/                 Frontend React + configuración de Nginx
├── webhook-receptor/    Sistema externo simulado para probar el webhook
├── docs/                Arquitectura, decisiones, despliegue y escalabilidad
├── docker-compose.yml   Entorno completo (modo evaluación)
├── docker-compose.dev.yml  Ajustes para desarrollo con recarga automática
└── .env.example         Plantilla de variables (sin secretos reales)
```

## Documentación

| Documento | Contenido |
|---|---|
| [Decisiones técnicas](docs/decisiones-tecnicas.md) | Las 12 decisiones principales, alternativas y supuestos de negocio |
| [Arquitectura](docs/arquitectura.md) | Diagramas de contexto y contenedores, flujo del webhook, componentes stateless y con estado, seguridad por capas |
| [Despliegue y escalabilidad](docs/despliegue-y-escalabilidad.md) | Producción en Azure (HTTPS, secretos, backups, logs, health checks, monitoreo, CI/CD) y la respuesta para 500.000 créditos/mes con varias cooperativas |
| [Base de datos](database/README.md) | Modelo entidad-relación, restricciones, índices, concurrencia y permisos |
| [API](api/README.md) | Arquitectura interna, contrato de errores, seguridad, webhook y variables |
| [Frontend](web/README.md) | Pantallas, decisiones de UX y seguridad, Nginx |
| [Receptor del webhook](webhook-receptor/README.md) | Verificación de firma y modos de falla |

## Cobertura de lo solicitado

| Punto de la prueba | Dónde |
|---|---|
| 3-4. Modelo de negocio y base de datos | `database/scripts` y [database/README.md](database/README.md) (diagrama entidad-relación y justificación) |
| 5. API REST: CRUD, paginación y filtros | `api/src/modules/creditos` y Swagger |
| 6. Reglas de negocio | `api/src/modules/creditos/domain`, reforzadas con restricciones y triggers en `001_esquema.sql` |
| 7. Webhook que reutiliza la creación y deja traza | `api/src/modules/webhooks`, tablas `WebhookNotificaciones` y `WebhookIntentos`, contenedor `webhook-worker` |
| 8. Seguridad | [arquitectura.md §6](docs/arquitectura.md#6-seguridad-por-capas) y [api/README.md](api/README.md) |
| 9. Frontend | `web/`: resumen, listado, formulario y detalle con historial y traza del webhook |
| 10. Manejo de errores | Contrato `{ success, error: { code, message, details, requestId } }` en [api/README.md](api/README.md) |
| 11. Auditoría y trazabilidad | Tabla `HistorialCredito` (inmutable por trigger y por permisos), `X-Request-Id` en logs y errores |
| 12. Pruebas automatizadas | Sección [Pruebas](#pruebas) |
| 13. Swagger / OpenAPI | http://localhost:3000/api/docs |
| 14. Docker y ejecución | `docker-compose.yml` y un Dockerfile por componente |
| 15. Documentación requerida | Esta página, [`docs/`](docs) y `.env.example` |
| 16. Despliegue y arquitectura | [despliegue-y-escalabilidad.md, parte A](docs/despliegue-y-escalabilidad.md#parte-a-despliegue-en-producción) |
| 17. Escalabilidad | [despliegue-y-escalabilidad.md, parte B](docs/despliegue-y-escalabilidad.md#parte-b-de-500-a-500000-créditos-mensuales-con-varias-cooperativas) |
