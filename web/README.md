# Frontend: módulo de créditos de asociados

Aplicación web para los analistas de la cooperativa: resumen de la cartera,
listado con filtros, registro de solicitudes y detalle de cada crédito con su
historial y la traza de la notificación al sistema externo.

**Stack:** React 19, TypeScript 6, Vite 8, Tailwind CSS 4, componentes al estilo
shadcn/ui sobre Radix, TanStack Query 5, React Router 8, React Hook Form y Zod 4.
Se sirve con Nginx 1.30.6 en Docker.

## Cómo ejecutarlo

### Con Docker

Desde la raíz del repositorio:

```bash
docker compose up -d --build
```

La aplicación queda en **http://localhost:8080**. Usuarios de demostración:

| Usuario              | Clave          | Puede                                         |
| -------------------- | -------------- | --------------------------------------------- |
| `admin@opa.local`    | `Admin123*`    | Todo, además eliminar y reintentar webhooks   |
| `analista@opa.local` | `Analista123*` | Crear, editar y cambiar el estado de créditos |
| `consulta@opa.local` | `Consulta123*` | Solo consultar                                |

### En desarrollo (recarga automática)

Con la API corriendo (en Docker o local) en el puerto 3000:

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
```

Vite reenvía `/api` a `http://localhost:3000`. Para otra dirección, defina
`VITE_API_PROXY_TARGET`.

### Scripts

| Script                 | Qué hace                                                    |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo                                      |
| `npm run typecheck`    | Tipos de la aplicación y de `vite.config.ts` (por separado) |
| `npm run lint`         | ESLint (incluye reglas de hooks y del React Compiler)       |
| `npm run format:check` | Prettier                                                    |
| `npm test`             | Vitest + Testing Library                       |
| `npm run build`        | Verifica tipos y genera `dist/`                             |

## Estructura

```
src/
  api/            Cliente HTTP, tipos del contrato y una función por endpoint
  auth/           Sesión (token en memoria), permisos por rol
  components/
    layout/       Menú lateral y encabezado de página
    ui/           Botones, campos, diálogos, tabla, alertas (estilo shadcn/ui)
  features/
    auth/         Inicio de sesión
    dashboard/    Resumen de la cartera
    creditos/     Listado, nuevo crédito, detalle, estados, historial, webhook
  lib/            Formatos colombianos, errores, caché de consultas
  test/           Configuración de pruebas y servidor de API simulado
nginx/            Configuración de Nginx y cabeceras de seguridad
```

## Decisiones principales


**El token vive solo en memoria.** No se guarda en `localStorage` ni en
`sessionStorage`, porque cualquier script inyectado podría leerlo de ahí y
seguir usándolo después. El costo es que al recargar la página hay que iniciar
sesión de nuevo. La evolución natural sería un refresh token en una cookie
`HttpOnly` con protección CSRF, que necesita cambios en la API. Como defensa
complementaria, Nginx publica una Content-Security-Policy que solo permite
ejecutar JavaScript propio. Al cerrar sesión o cuando el token vence se borra la
caché de consultas, para que quien use el navegador después no vea datos ajenos.

**Las reglas de negocio no se duplican.** Cada crédito llega de la API con
`transicionesPermitidas`, `editable` y `eliminable`, calculados por el mismo
dominio que valida las operaciones. La interfaz solo decide cómo mostrarlos. 

**Validar dos veces tiene propósitos distintos.** En el navegador es por
experiencia: el error aparece al instante. En la API es por autoridad: nadie se
salta las reglas enviando peticiones a mano. Los límites que dependen del tipo
de crédito (montos, cuotas, tasa máxima) se leen del catálogo de la API en lugar
de copiarse. Si la API rechaza un campo, su mensaje aparece debajo de ese campo.

**Edición segura entre varios analistas.** Al editar se envía la versión vista
en `If-Match`. Si otra persona guardó primero, la API responde 412 y la pantalla
avisa y recarga la versión más reciente en lugar de sobrescribir su cambio.

**Estado del servidor con TanStack Query.** Gestiona la caché, los reintentos
(nunca ante errores 4xx, porque repetir una petición inválida no la arregla) y
la recarga al volver a la pestaña. La traza del webhook se consulta cada 3 s
mientras hay un envío pendiente, así los reintentos se ven en vivo, y se detiene
al terminar.

**Filtros en la URL.** Búsqueda, estado, tipo, orden y página quedan en la
dirección: se pueden compartir, sobreviven a una recarga y el botón Atrás
funciona como se espera.

**División por rutas.** Cada pantalla se descarga al visitarla.

**Identidad visual.** El crédito se presenta como un expediente: un sello con su
estado, el recorrido por las etapas y un historial en renglones de libreta. Cada 
estado tiene un color, pero siempre acompañado de su nombre: el color nunca es 
la única señal.

**Mismo origen con Nginx.** El navegador ve la aplicación y la API bajo
`localhost:8080` (`/` y `/api`), así que no hace falta CORS y la API no necesita
exponerse al navegador por otro puerto. Nginx también:

- devuelve `index.html` para cualquier ruta desconocida, para que `/creditos/12`
  funcione al recargar o compartir el enlace;
- guarda en caché un año los archivos con hash (`/assets/index-Bdw_aVDe.js`) y
  nunca `index.html`, así cada despliegue llega al instante;
- reemplaza `X-Forwarded-For` con la IP real del cliente, para que la API cuente
  los intentos de login por usuario y no por proxy;
- vuelve a resolver el nombre `api` cada 30 s con el DNS de Docker, para que
  recrear el contenedor de la API no deje el frontend respondiendo 502.

## Pruebas

- `src/api/client.test.ts`: desempaqueta el contrato, adjunta el token,
  traduce errores con detalle por campo, cierra la sesión ante un 401 (salvo en
  el login), maneja la falta de conexión y el 204.
- `src/features/creditos/formularioCredito.test.ts`: política por tipo de
  crédito, mensajes de validación y cuota estimada (sistema francés).
- `src/features/creditos/DetalleCreditoPage.test.tsx`: solo aparecen las
  transiciones permitidas, el rol de consulta no ve acciones, mensaje en estados
  finales, error de la API debajo del campo de observación, PATCH solo con lo
  que cambió y la versión en `If-Match`, aviso y recarga ante un 412, y crédito
  inexistente.
- `src/lib/formato.test.ts`: montos, tasas y fechas en hora de Bogotá.
