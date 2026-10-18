# syntax=docker/dockerfile:1
# =============================================================================
# Dockerfile — Frontend de créditos (React + Vite, servido por Nginx)
# -----------------------------------------------------------------------------
#   build       Node.js: puerta de calidad (tipos, lint, formato, pruebas) y
#               compilación a archivos estáticos (HTML, JS, CSS).
#   production  Nginx sin privilegios de root: sirve esos archivos y hace de
#               proxy hacia la API.
# =============================================================================

# Misma versión de Node que la API.
ARG NODE_VERSION=24.21.0

ARG NGINX_VERSION=1.30.6

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
# Puerta de calidad: si algo falla, la imagen no se construye.
RUN npm run typecheck \
 && npm run lint \
 && npm run format:check \
 && npm test \
 && npx vite build

# ---------------------------------------------------------------------------
# nginx-unprivileged: corre como usuario sin privilegios y escucha
# en el puerto 8080 en lugar del 80, que requiere root.
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine AS production
COPY nginx/default.conf nginx/security-headers.inc /etc/nginx/conf.d/
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/salud-web || exit 1
