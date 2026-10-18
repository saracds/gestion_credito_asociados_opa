# syntax=docker/dockerfile:1
# =============================================================================
# Receptor de webhooks de prueba (simula el sistema externo)
# =============================================================================
ARG NODE_VERSION=24.21.0
FROM node:${NODE_VERSION}-bookworm-slim

WORKDIR /app
COPY receptor.ts ./

ENV NODE_ENV=production \
    PORT=4000

USER node
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "receptor.ts"]
