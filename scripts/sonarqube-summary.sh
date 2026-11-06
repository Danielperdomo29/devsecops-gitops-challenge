#!/usr/bin/env bash
# Imprime en Markdown el estado del quality gate y las métricas principales de SonarQube.
set -euo pipefail

URL="${SONAR_URL:-http://localhost:9000}"
KEY="devsecops-gitops-challenge"
METRICS="coverage,bugs,vulnerabilities,security_hotspots,code_smells,duplicated_lines_density,ncloc,reliability_rating,security_rating,sqale_rating"

get() { curl -fsS -H "Authorization: Bearer ${SONAR_TOKEN}" "${URL}/api/$1"; }

gate="$(get "qualitygates/project_status?projectKey=${KEY}" | jq -r .projectStatus.status)"
icon="✅"; [[ "$gate" = "OK" ]] || icon="❌"

echo "### SonarQube: quality gate ${icon} \`${gate}\`"
echo ""
echo "| Métrica | Valor |"
echo "|---|---|"
get "measures/component?component=${KEY}&metricKeys=${METRICS}" \
  | jq -r '.component.measures | sort_by(.metric)[] | "| \(.metric) | \(.value) |"'
