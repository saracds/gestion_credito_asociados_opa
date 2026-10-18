# Decisiones técnicas

Las decisiones de más peso del proyecto: qué se decidió, qué alternativa
se descartó y por qué. El razonamiento completo está en el README de cada
componente.

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **SQL escrito a mano con `mssql`** y consultas parametrizadas | ORM (Prisma, TypeORM) | Control de lo que SQL Server hace mejor: índices filtrados, `ROWVERSION`, bloqueos `UPDLOCK/HOLDLOCK/READPAST` y transacciones explícitas, necesarias para el outbox |
| 2 | **Reglas protegidas en dos niveles:** dominio en la API y restricciones en la base (`CHECK`, índice único filtrado, triggers) | Validar solo en la API | La API da mensajes claros (409/422); la base garantiza que ningún otro camino (scripts, soporte, carreras) deje datos inválidos |
| 3 | **Máquina de estados en el dominio** como única fuente de verdad; la API envía en cada crédito las acciones permitidas | Repetir las reglas en el frontend | Cambiar una transición se hace en un solo lugar y la interfaz nunca ofrece una acción que la API rechazaría |
| 4 | **`PATCH` + concurrencia optimista** con `ETag`/`If-Match` sobre `ROWVERSION` | `PUT` sin control de versión | Solo parte del crédito es editable y el historial registra cada campo cambiado. Si dos analistas editan a la vez, el segundo recibe 412 en lugar de pisar el cambio del primero |
| 5 | **Duplicados bloqueados en tres barreras:** consulta con `UPDLOCK + HOLDLOCK`, respuesta 409 e índice único filtrado | Solo una consulta previa | La consulta sola falla con dos peticiones simultáneas; el índice es la garantía final aunque el código falle |
| 6 | **Webhook con outbox transaccional** y worker separado: reintentos con espera exponencial, firma HMAC-SHA256 con timestamp e idempotencia por `eventId` | Llamar al sistema externo dentro de la petición de creación | El crédito nunca se pierde si el externo está caído, nunca se notifica un crédito que no existe y cada intento queda trazado |
| 7 | **JWT con roles** (ADMIN, ANALISTA, CONSULTA), bcrypt y límite de intentos por IP real | API Key | El historial exige saber qué usuario hizo cada cambio, y los permisos dependen del rol |
| 8 | **Dos logins de base de datos con mínimo privilegio,** `UPDATE` por columna y `DENY DELETE` | Conectarse como `sa` o usar `db_datawriter` | El worker (que maneja el secreto del webhook y habla con el exterior) no puede leer créditos ni usuarios; la API no puede cambiar campos inmutables ni borrar |
| 9 | **OpenAPI 3.1 generado desde los esquemas Zod** y verificado con pruebas de contrato | YAML o comentarios escritos a mano | La documentación sale de los mismos esquemas que validan las peticiones, así que no puede desactualizarse. La prueba de contrato encontró una fuga real de datos internos |
| 10 | **Token solo en memoria del navegador** y CSP estricta en Nginx | `localStorage` | Un script inyectado no puede robar el token de forma persistente. Costo aceptado: recargar la página pide iniciar sesión |
| 11 | **Todo en Docker con versiones fijas,** incluido SQL Server, y puerta de calidad dentro de cada imagen | Depender de lo instalado en el equipo | Cualquier persona ejecuta exactamente lo mismo que se desarrolló; una imagen no se construye si fallan los tipos, el lint o las pruebas |
| 12 | **Para varias cooperativas: una base de datos por entidad** en un elastic pool, con catálogo central | Base compartida con `EntidadId` | Aislamiento físico, backup y restauración por entidad, sin vecino ruidoso, y más simple de auditar ante la Superintendencia. El costo se controla con elastic pools |

## Respuestas a las preguntas de la prueba

**¿Dónde están las reglas de negocio y por qué? (punto 6)**

- **Dominio de la API** (`api/src/modules/creditos/domain`): funciones puras
  sin HTTP ni SQL para la máquina de estados, las políticas por tipo de crédito,
  los campos editables y la verificación del nombre del asociado. Es la única
  fuente de verdad, se prueba sin base de datos y da mensajes precisos (422 con
  todas las violaciones).
- **Servicio** (`CreditoService`): las reglas que necesitan datos y
  concurrencia, como el duplicado (`UPDLOCK + HOLDLOCK`) y la versión del
  crédito. También agrupa en una transacción el crédito, el historial y el
  evento.
- **Base de datos:** las invariantes que nunca deben romperse, venga el cambio
  de donde venga: `valorSolicitado > 0`, `tasaInteres >= 0`, `numeroCuotas > 0`,
  el índice único de créditos activos, estados finales e inmutabilidad
  (triggers) y los permisos por columna.
- **Frontend:** solo valida para dar respuesta inmediata, y muestra las
  acciones que la API declara permitidas. Nunca decide una regla.

**¿Qué pasa si el sistema externo no responde, devuelve error o está caído? (punto 7)**

El crédito **ya está creado** y el evento guardado en la misma transacción. La
falla del externo nunca afecta la creación. El worker clasifica cada respuesta:

| Respuesta del externo | Qué hace el worker |
|---|---|
| 2xx | `ENVIADO`; se registra el intento |
| Sin respuesta (timeout de 10 s, conexión rechazada, DNS) | Reintento |
| 5xx, 408 (timeout) o 429 (saturado) | Reintento |
| Otro 4xx (por ejemplo 400 o 401: el externo rechaza el mensaje) | `FALLIDO` de inmediato: repetirlo no lo arreglaría |

- **Espera entre reintentos:** se duplica en cada intento (10 s, 20 s, 40 s,
  80 s, 160 s) con una variación aleatoria de ±20 %, para que muchos eventos no
  reintenten todos en el mismo segundo cuando el externo se recupera.
- **Al agotar los 6 intentos** (unos 5 minutos con los valores por defecto;
  las esperas se configuran con `WEBHOOK_RETRY_BASE_SECONDS` y
  `WEBHOOK_RETRY_MAX_SECONDS`, y el número de intentos es el valor por defecto
  de `maxIntentos` en la tabla): queda en `FALLIDO`, visible en el detalle del crédito, y un
  ADMIN puede reprogramarlo sin perder la traza.
- **Cada intento** queda en `WebhookIntentos` con código HTTP, duración y error.
- **Sin duplicados en el receptor:** si un envío llegó pero su resultado no se
  alcanzó a registrar, el reenvío lleva el mismo `eventId` y el receptor lo
  descarta.
- **Recomendación para producción:** una ventana más larga, por ejemplo una
  espera base de 60 s, tope de 1 hora y 10 intentos (unas 4 horas), para
  tolerar mantenimientos del sistema externo.

**¿Qué información es modificable y cuál inmutable? (punto 11)**

| Inmutable (nunca cambia) | Modificable con restricciones |
|---|---|
| `id` y `numeroCredito` (identidad del crédito) | Condiciones (tipo, valor, tasa, cuotas, forma de pago): **solo en Solicitado o En estudio**, porque al aprobarse se vuelven un compromiso |
| Asociado del crédito y fecha de solicitud | Estado: **solo por las transiciones permitidas**; Rechazado, Desembolsado y Cancelado son finales |
| Usuario que lo creó | Borrado: **solo lógico**, solo en Solicitado y solo ADMIN; el registro se conserva |
| **Todo el historial** (`HistorialCredito`) y la traza de envíos | — |

Cada cambio permitido deja en el historial el estado anterior y el nuevo, los
valores anteriores y nuevos de cada campo, el usuario, la fecha y la
observación. La inmutabilidad se garantiza en tres niveles: la API rechaza el
campo (422), el permiso por columna lo impide (error 230) y un trigger lo
bloquea aunque se intente con otro usuario.

## Supuestos de negocio

- La **tasa de interés** es nominal mensual en porcentaje (`1.5` = 1,5 % mensual)
  y cada tipo de crédito tiene un techo; en una entidad real lo define su
  reglamento y nunca supera la tasa de usura vigente.
- **Duplicado:** un asociado no puede tener dos créditos activos (Solicitado,
  En estudio o Aprobado) del mismo tipo.
- Si una identificación ya existe con **otro nombre**, se rechaza (409) en vez
  de actualizar el nombre en silencio.
- Las condiciones solo se editan **antes de aprobar**. Rechazar o cancelar exige
  un motivo. Eliminar es un **borrado lógico** permitido solo en Solicitado y
  solo para ADMIN.

## Dónde está el detalle

| Tema | Documento |
|---|---|
| Arquitectura, flujos y seguridad por capas | [arquitectura.md](arquitectura.md) |
| Producción y escalabilidad | [despliegue-y-escalabilidad.md](despliegue-y-escalabilidad.md) |
| Modelo de datos, restricciones, índices y permisos | [database/README.md](../database/README.md) |
| API, errores, seguridad y webhook | [api/README.md](../api/README.md) |
| Frontend y Nginx | [web/README.md](../web/README.md) |
| Receptor de prueba del webhook | [webhook-receptor/README.md](../webhook-receptor/README.md) |
| Cómo probar el webhook y sus fallas | [como-probar-el-webhook.md](como-probar-el-webhook.md) |
