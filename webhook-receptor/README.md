# Receptor de webhooks de prueba

Simula el **sistema externo** que recibe la notificación `credito.creado`. Sirve para demostrar el comportamiento del emisor ante respuestas exitosas, fallas temporales, caídas, lentitud y rechazos.


## Qué hace un receptor

1. **Verifica la firma.** Calcula `HMAC-SHA256(secreto, "<X-Webhook-Timestamp>.<cuerpo>")`, lo compara en tiempo constante con `X-Webhook-Signature` y rechaza timestamps con más de 5 minutos de antigüedad (**401**).
2. **Es idempotente.** Un `X-Webhook-Id` ya procesado responde **200** sin repetir el efecto.

## Modos

| Modo | Respuesta | Comportamiento esperado del emisor |
|---|---|---|
| `normal` | 200 | ENVIADO |
| `falla-temporal` | 503 en los primeros N intentos de cada evento, luego 200 | Reintenta con backoff y termina ENVIADO |
| `caido` | 503 siempre | Reintenta hasta agotar los intentos y termina FALLIDO |
| `lento` | Tarda más que el timeout del emisor | Registra timeout y reintenta |
| `rechazar` | 400 | FALLIDO de inmediato (error permanente, sin reintentos) |

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| POST | `/webhooks/creditos` | Recibe notificaciones |
| GET | `/eventos` | Eventos recibidos, con validez de firma y si era duplicado |
| DELETE | `/eventos` | Limpia lo recibido |
| GET / PUT | `/modo` | Consulta o cambia el modo en caliente: `{"modo":"caido"}` |
| GET | `/health` | Healthcheck |

Cambiar el modo desde PowerShell:

```powershell
Invoke-RestMethod -Method Put -Uri http://localhost:4000/modo -ContentType 'application/json' -Body '{"modo":"falla-temporal"}'
```

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `WEBHOOK_SECRET` | — (obligatoria) | Secreto compartido con el worker |
| `PORT` | `4000` | Puerto HTTP |
| `RECEPTOR_MODO` | `normal` | Modo inicial |
| `RECEPTOR_FALLOS_POR_EVENTO` | `2` | Intentos con 503 en el modo `falla-temporal` |
| `RECEPTOR_DEMORA_MS` | `15000` | Demora del modo `lento` |

> Solo para desarrollo y demostración: `/modo` y `/eventos` no tienen autenticación.
