#!/usr/bin/env bash
# =============================================================================
# ejecutar-pruebas.sh
# -----------------------------------------------------------------------------
# Ejecuta las pruebas de restricciones de la base de datos
# (pruebas/validar_restricciones.sql). Requiere los datos de demostración.
#
# Uso desde la raíz del repositorio:
#   docker compose run --rm --entrypoint /database/ejecutar-pruebas.sh db-init
#
# Termina con código 1 si algún caso falla, para poder usarse en CI/CD.
# =============================================================================
set -euo pipefail

readonly SQLCMD="/opt/mssql-tools18/bin/sqlcmd"
readonly DB_HOST="${DB_HOST:-db}"

: "${MSSQL_SA_PASSWORD:?Debe definir MSSQL_SA_PASSWORD}"

resultado="$("$SQLCMD" -S "$DB_HOST" -U sa -P "$MSSQL_SA_PASSWORD" -C -b -I -W \
    -i "$(dirname "$0")/pruebas/validar_restricciones.sql")"

echo "$resultado"

if echo "$resultado" | grep -q "FALLÓ"; then
    echo "✘ Hay casos fallidos."
    exit 1
fi

echo "✔ Todas las pruebas de restricciones pasaron."
