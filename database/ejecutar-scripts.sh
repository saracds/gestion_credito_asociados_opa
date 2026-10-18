#!/usr/bin/env bash
# =============================================================================
# ejecutar-scripts.sh
# -----------------------------------------------------------------------------
# Aplica, en orden, los scripts SQL versionados sobre SQL Server.
# Lo ejecuta el contenedor "db-init" del docker-compose una vez que la base de
# datos está saludable (healthcheck).
#
#   1. Scripts de migración 0XX_*.sql (orden alfabético = orden de versión).
#   2. Datos de demostración 900_datos_demo.sql, solo si SEED_DEMO=true.
#   3. Usuarios de aplicación y permisos (seguridad/usuarios_aplicacion.sql),
#      SIEMPRE: es un estado deseado, no una migración (permite rotar claves).
#
# Las migraciones controlan su idempotencia con dbo.VersionesEsquema y el
# script de seguridad es idempotente por diseño: ejecutar este proceso varias
# veces es seguro.
#
# El administrador (sa) solo se usa aquí, para aprovisionar. La API y el worker
# se conectan con sus propios logins y nunca reciben MSSQL_SA_PASSWORD.
#
# Variables de entorno:
#   DB_HOST             Host de SQL Server (por defecto: db)
#   MSSQL_SA_PASSWORD   Contraseña del usuario administrador (obligatoria)
#   DB_API_PASSWORD     Contraseña del login app_creditos_api (obligatoria)
#   DB_WORKER_PASSWORD  Contraseña del login app_creditos_worker (obligatoria)
#   SEED_DEMO           true | false (por defecto: false)
# =============================================================================
set -euo pipefail

readonly SQLCMD="/opt/mssql-tools18/bin/sqlcmd"
readonly SCRIPTS_DIR="$(dirname "$0")/scripts"
readonly DB_HOST="${DB_HOST:-db}"
readonly SEED_DEMO="${SEED_DEMO:-false}"

: "${MSSQL_SA_PASSWORD:?Debe definir MSSQL_SA_PASSWORD}"
: "${DB_API_PASSWORD:?Debe definir DB_API_PASSWORD (login de la API)}"
: "${DB_WORKER_PASSWORD:?Debe definir DB_WORKER_PASSWORD (login del worker)}"

# Las claves se insertan como texto en la sentencia CREATE/ALTER LOGIN: una
# comilla la rompería. Se rechazan aquí con un mensaje claro.
validar_clave() {
    local nombre="$1" valor="$2"
    if [[ "$valor" == *"'"* || "$valor" == *'"'* ]]; then
        echo "✘ $nombre no puede contener comillas simples ni dobles." >&2
        exit 1
    fi
    if [[ "$valor" == "$MSSQL_SA_PASSWORD" ]]; then
        echo "✘ $nombre debe ser distinta de MSSQL_SA_PASSWORD." >&2
        exit 1
    fi
}
validar_clave DB_API_PASSWORD "$DB_API_PASSWORD"
validar_clave DB_WORKER_PASSWORD "$DB_WORKER_PASSWORD"
if [[ "$DB_API_PASSWORD" == "$DB_WORKER_PASSWORD" ]]; then
    echo "✘ DB_API_PASSWORD y DB_WORKER_PASSWORD deben ser distintas." >&2
    exit 1
fi

ejecutar_script() {
    local archivo_sql="$1"
    shift
    echo "▶ Ejecutando $(basename "$archivo_sql")"
    # -b : termina con error si algún lote falla (detiene el proceso)
    # -C : confía en el certificado autofirmado del contenedor (solo desarrollo)
    # -I : QUOTED_IDENTIFIER ON, requerido por índices filtrados y columnas calculadas
    # "$@": variables de sqlcmd adicionales (-v NOMBRE=valor)
    "$SQLCMD" -S "$DB_HOST" -U sa -P "$MSSQL_SA_PASSWORD" -C -b -I -i "$archivo_sql" "$@"
}

for archivo_sql in "$SCRIPTS_DIR"/0[0-9][0-9]_*.sql; do
    ejecutar_script "$archivo_sql"
done

if [[ "$SEED_DEMO" == "true" ]]; then
    ejecutar_script "$SCRIPTS_DIR/900_datos_demo.sql"
else
    echo "ℹ SEED_DEMO distinto de 'true': no se cargan datos de demostración."
fi

# Las claves viajan como variables de entorno de sqlcmd (SQLCMDVARIABLE) y no
# como argumentos -v, para que no aparezcan en la lista de procesos (ps).
CLAVE_API="$DB_API_PASSWORD" CLAVE_WORKER="$DB_WORKER_PASSWORD" \
    ejecutar_script "$(dirname "$0")/seguridad/usuarios_aplicacion.sql"

echo "✔ Base de datos lista."
