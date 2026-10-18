# Cómo probar el webhook `credito.creado`

Comandos para reproducir cómo el sistema notifica a un sistema externo y **qué pasa cuando ese sistema falla** (punto 7 de la prueba): entrega normal, falla temporal con reintentos, caída total, reproceso manual, error permanente, timeout e idempotencia. El contenedor `webhook-receptor` hace de sistema externo y cambia de comportamiento con `PUT /modo`.

> Requisito: el entorno levantado con `docker compose up -d --build`. Los comandos son de PowerShell, desde la raíz del repositorio.

## 0. Preparación

```powershell
# Sesión como analista y una función para crear créditos con identificación aleatoria
$login = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login `
  -ContentType 'application/json' -Body '{"email":"analista@opa.local","password":"Analista123*"}'
$h = @{ Authorization = "Bearer $($login.data.accessToken)" }

function Crear-Credito {
  $cuerpo = @{
    identificacionAsociado = "$(Get-Random -Minimum 10000000 -Maximum 99999999)"
    nombreAsociado = 'Asociado Demostración'
    tipoCredito = 'LIBRE_INVERSION'; valorSolicitado = 15000000
    tasaInteres = 1.5; numeroCuotas = 36; formaPago = 'NOMINA'
  } | ConvertTo-Json
  (Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/creditos -Headers $h `
    -ContentType 'application/json' -Body $cuerpo).data
}
function Ver-Traza($id) {
  (Invoke-RestMethod -Uri "http://localhost:3000/api/creditos/$id/notificaciones" -Headers $h).data |
    ConvertTo-Json -Depth 6
}
function Modo-Receptor($modo) {
  Invoke-RestMethod -Method Put -Uri http://localhost:4000/modo -ContentType 'application/json' `
    -Body (@{ modo = $modo } | ConvertTo-Json)
}
```

En otra terminal, deja visibles los logs del worker y del receptor:

```powershell
docker compose logs -f webhook-worker webhook-receptor
```

## 1. Camino feliz

```powershell
Modo-Receptor normal
$c = Crear-Credito; $c.numeroCredito
Ver-Traza $c.id          # estado ENVIADO, 1 intento, HTTP 200
Invoke-RestMethod http://localhost:4000/eventos | ConvertTo-Json -Depth 6   # firmaValida: true
```

**Qué observar:**

- El `POST /api/creditos` respondió **antes** de notificar. El crédito, su historial y el evento se guardaron en **una sola transacción**, el patrón *Transactional Outbox*.
- El webhook **no duplica la lógica ni hace un segundo INSERT**. Lo envía un proceso aparte, el worker, que lee los eventos pendientes del outbox.
- El receptor verificó la **firma HMAC-SHA256** con el secreto compartido.

## 2. Falla temporal, reintentos y backoff

```powershell
Modo-Receptor falla-temporal     # 503 en los 2 primeros intentos de cada evento
$c = Crear-Credito
Ver-Traza $c.id                   # PENDIENTE, intento 1 con 503, proximoIntento en unos 10 s
Start-Sleep 35
Ver-Traza $c.id                   # ENVIADO al 3.er intento; detalleIntentos muestra 503, 503, 200
```

**Qué observar:**

- Las esperas crecen: **10 s, 20 s, 40 s**, con ±20 % de variación aleatoria (*jitter*). Así no se satura a un sistema que se está recuperando.
- Cada intento queda registrado en `WebhookIntentos` con su código HTTP, duración y error.

## 3. Sistema externo caído

```powershell
Modo-Receptor caido
$c = Crear-Credito
docker compose stop webhook-receptor      # ni siquiera responde: conexión rechazada
Ver-Traza $c.id                           # error: "No fue posible conectar con el sistema externo"
```

**Qué observar:**

- La creación de créditos **sigue funcionando**: el usuario no percibe la caída.
- Tras 6 intentos el evento queda **FALLIDO**, visible para reproceso manual.

```powershell
docker compose start webhook-receptor
Modo-Receptor normal
```

## 4. Reproceso manual de un FALLIDO

Solo el rol ADMIN puede reprogramar. El `id` de la notificación aparece en `Ver-Traza`:

```powershell
$admin = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login `
  -ContentType 'application/json' -Body '{"email":"admin@opa.local","password":"Admin123*"}'
Invoke-RestMethod -Method Post -Headers @{ Authorization = "Bearer $($admin.data.accessToken)" } `
  -Uri "http://localhost:3000/api/webhooks/notificaciones/<ID_NOTIFICACION>/reprogramar"
```

La traza anterior se conserva: se amplían los intentos permitidos, no se borran los existentes.

## 5. Error permanente y timeout

```powershell
Modo-Receptor rechazar     # 400: reenviar lo mismo daría el mismo resultado -> FALLIDO sin reintentos
Modo-Receptor lento        # tarda más que el timeout (10 s) -> se registra "timeout" y se reintenta
```

## 6. Idempotencia

- El envío garantiza **al menos una vez**. Si el worker se cae después de que el externo respondió 200 y antes de registrarlo, el evento se reenvía.
- Por eso cada evento lleva un `eventId` estable. El receptor lo usa para **descartar duplicados**: en `/eventos` aparecen con `duplicado: true`.
- El modo `lento` lo reproduce: el receptor procesa el evento después del timeout del emisor, y el reintento llega como duplicado.

## Preguntas frecuentes

| Pregunta | Respuesta corta |
|---|---|
| ¿Por qué no se llama al webhook dentro del POST? | Una caída o lentitud del externo bloquearía o haría fallar la creación. Además, llamar después del COMMIT perdería la notificación si la API se cae justo en ese instante. |
| ¿Cómo se evita enviar dos veces con varios workers? | `UPDATE ... WITH (UPDLOCK, READPAST)`: cada evento lo toma un solo worker, y los demás saltan las filas bloqueadas sin esperar. |
| ¿Y si un worker se cae a mitad del envío? | El evento queda ENVIANDO con `bloqueadoHasta`. Al vencer ese plazo, otro worker lo retoma. |
| ¿Por qué HMAC y no una API Key? | HMAC prueba quién envía **y** que el cuerpo no fue alterado. El timestamp firmado evita que alguien reenvíe una petición capturada. |
| ¿Qué errores se reintentan? | Sin respuesta, 5xx, 408 y 429. Los demás 4xx son permanentes y pasan directo a FALLIDO para revisión humana. |
