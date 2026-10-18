# syntax=docker/dockerfile:1
# =============================================================================
# Dockerfile — Base de datos SQL Server del módulo de créditos
# -----------------------------------------------------------------------------
# Dos etapas a partir de la misma imagen base:
#
#   sqlserver    Motor SQL Server. Lo usa el servicio "db" del docker-compose.
#   migraciones  Contiene los scripts SQL versionados y los aplica una vez sobre
#                el motor. Lo usa el servicio "db-init", que termina al acabar.
#
# Los scripts quedan DENTRO de la imagen (no se montan como volumen), así no
# dependen del sistema operativo del anfitrión: permisos de archivos o finales
# de línea de Windows no pueden alterar su ejecución.
# =============================================================================

# Versión fijada de la imagen base, para que la construcción sea reproducible y no dependa
# de la última publicada. Se eligió la versión 2022-CU26-GDR1-ubuntu-22.04, que contiene:
#   SQL Server 2022, Cumulative Update 26 con su parche de seguridad GDR1,
#   sobre Ubuntu 22.04. Se eligió una CU con algunos meses de publicada, en
#   lugar de la más reciente, priorizando estabilidad comprobada.
# Se usa 2022 (y no 2025) por ser la versión con mayor adopción en entidades
# del sector; el esquema no usa funciones exclusivas de una u otra.
ARG MSSQL_IMAGE_TAG=2022-CU26-GDR1-ubuntu-22.04

# ---------------------------------------------------------------------------
FROM mcr.microsoft.com/mssql/server:${MSSQL_IMAGE_TAG} AS sqlserver

ENV ACCEPT_EULA=Y \
    MSSQL_PID=Developer \
    MSSQL_COLLATION=Modern_Spanish_CI_AS

# El motor está listo cuando acepta una consulta con el usuario administrador.
# La contraseña llega en tiempo de ejecución (variable MSSQL_SA_PASSWORD del
# docker-compose); nunca se escribe en la imagen.
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -b -Q "SELECT 1" -o /dev/null || exit 1

# ---------------------------------------------------------------------------
FROM sqlserver AS migraciones

WORKDIR /database
COPY --chmod=755 ejecutar-scripts.sh ejecutar-pruebas.sh ./
COPY scripts/ ./scripts/
COPY seguridad/ ./seguridad/
COPY pruebas/ ./pruebas/

# Esta etapa no ejecuta el motor: solo usa sqlcmd para aplicar los scripts
# sobre el contenedor "db" y termina.
HEALTHCHECK NONE
ENTRYPOINT ["/bin/bash", "/database/ejecutar-scripts.sh"]
