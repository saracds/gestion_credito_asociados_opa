# syntax=docker/dockerfile:1
# =============================================================================
# Dockerfile — API de créditos (Node.js + TypeScript + Express)
# -----------------------------------------------------------------------------
# Construcción MULTI-ETAPA: cada etapa parte de la anterior y la imagen final
# solo contiene lo necesario para ejecutar (sin TypeScript, pruebas ni
# herramientas de desarrollo).
#
#   base         Node.js con versión exacta fijada.
#   dependencies Instala TODAS las dependencias según package-lock.json.
#   development  Ejecuta con recarga automática (docker-compose.dev.yml).
#   build        Verifica calidad (tipos, lint, pruebas) y compila a JavaScript.
#   production   Imagen final mínima, sin privilegios de root.
#
# Reproducibilidad: versión de Node fijada aquí + versiones exactas en
# package-lock.json => la imagen final es idéntica en cualquier máquina y en cualquier momento.
# =============================================================================

ARG NODE_VERSION=24.21.0

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ---------------------------------------------------------------------------
FROM base AS dependencies
# Se copian primero SOLO los manifiestos: si el código cambia pero las
# dependencias no, Docker reutiliza esta capa en caché y no reinstala nada.
COPY package.json package-lock.json ./
# npm ci (y no npm install): instala exactamente lo del lockfile y falla si
# package.json y package-lock.json no coinciden.
RUN --mount=type=cache,target=/root/.npm npm ci

# ---------------------------------------------------------------------------
FROM dependencies AS development
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---------------------------------------------------------------------------
FROM dependencies AS build
COPY . .
# Puerta de calidad: si los tipos, el lint, el formato o las pruebas fallan,
# la imagen NO se construye. Ningún código roto llega a ejecutarse.
RUN npm run typecheck \
 && npm run lint \
 && npm run format:check \
 && npm test \
 && npm run build

# ---------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production \
    PORT=3000

COPY package.json package-lock.json ./
# Solo dependencias de ejecución: menos tamaño y menos superficie de ataque.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=build /app/dist ./dist

# El proceso corre con el usuario sin privilegios "node" (incluido en la imagen
# oficial). Si alguien comprometiera la aplicación, no tendría acceso de root.
USER node

EXPOSE 3000

# Docker verifica periódicamente que el proceso responde (liveness).
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health/live').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Se ejecuta node directamente (no "npm start") para que las señales de apagado
# (SIGTERM) lleguen a la aplicación y se haga el cierre ordenado.
CMD ["node", "dist/server.js"]
