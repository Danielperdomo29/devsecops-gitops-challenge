#!/usr/bin/env bash
# =============================================================================
# Prepara un SonarQube EFÍMERO (contenedor de servicio del job de CI):
#   1. Espera a que el servidor esté UP.
#   2. Reemplaza la contraseña por defecto por una aleatoria (enmascarada en logs).
#   3. Crea el quality gate "devsecops" COMO CÓDIGO y lo marca por defecto.
#   4. Emite un token de análisis efímero (muere con el contenedor).
# Salidas (GITHUB_OUTPUT): token
# =============================================================================
set -euo pipefail

URL="${SONAR_URL:-http://localhost:9000}"
GATE="devsecops"

echo "Esperando a SonarQube en ${URL}..."
for _ in $(seq 1 90); do
  status="$(curl -fsS "${URL}/api/system/status" 2>/dev/null | jq -r .status || true)"
  [[ "$status" = "UP" ]] && break
  sleep 3
done
[[ "$status" = "UP" ]] || { echo "SonarQube no arrancó (estado: ${status:-desconocido})"; exit 1; }

password="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)Aa1!"
echo "::add-mask::${password}"
# La imagen oficial arranca con la credencial por defecto documentada por SonarSource.
# Se lee de variables (nunca como literal "usuario:clave" en el código) y se rota de inmediato.
admin_user="${SONAR_ADMIN_USER:-admin}"
initial_password="${SONAR_INITIAL_PASSWORD:-admin}"
curl -fsS -u "${admin_user}:${initial_password}" -X POST "${URL}/api/users/change_password" \
  --data-urlencode "login=${admin_user}" --data-urlencode "previousPassword=${initial_password}" \
  --data-urlencode "password=${password}" >/dev/null

api() { curl -fsS -u "${admin_user}:${password}" -X POST "${URL}/api/$1" "${@:2}"; }

# Quality gate como código: el umbral es explícito, versionado y revisable en el PR.
api qualitygates/create --data-urlencode "name=${GATE}" >/dev/null
while read -r metric op error; do
  api qualitygates/create_condition --data-urlencode "gateName=${GATE}" \
    --data-urlencode "metric=${metric}" --data-urlencode "op=${op}" --data-urlencode "error=${error}" >/dev/null
  echo "  condición: ${metric} ${op} ${error}"
done <<'EOF'
coverage LT 80
duplicated_lines_density GT 3
reliability_rating GT 1
security_rating GT 1
sqale_rating GT 1
EOF
api qualitygates/set_as_default --data-urlencode "name=${GATE}" >/dev/null

token="$(api user_tokens/generate --data-urlencode "name=ci-${GITHUB_RUN_ID:-local}" \
  --data-urlencode "type=GLOBAL_ANALYSIS_TOKEN" | jq -r .token)"
echo "::add-mask::${token}"
echo "token=${token}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "SonarQube listo: quality gate '${GATE}' activo."
