#!/usr/bin/env bash
# =============================================================================
# Define BASE_URL para las pruebas de integración y el DAST:
#   - Entorno AWS desplegado (AWS_URL) -> se prueba la nube real.
#   - Sin AWS configurado              -> se levanta la MISMA imagen (por digest) en local
#                                         con el endurecimiento de producción.
# Exporta a GITHUB_ENV: BASE_URL, EXPECTED_SHA, EXPECTED_PLATFORM
# =============================================================================
set -euo pipefail

: "${IMAGE_REF:?IMAGE_REF requerido (repo@sha256:...)}"
: "${HEAD_SHA:?HEAD_SHA requerido}"

if [[ -n "${AWS_URL:-}" ]]; then
  base_url="$AWS_URL"
  platform="aws-ecs-fargate"
  echo "Objetivo: entorno efímero en AWS (${base_url})"
else
  echo "Objetivo: contenedor local (AWS no configurado)"
  docker run -d --name preview-local -p 8080:8080 \
    --read-only --tmpfs /tmp:size=16m --cap-drop ALL --security-opt no-new-privileges \
    --memory 128m --pids-limit 64 -e APP_ENV=preview "$IMAGE_REF" >/dev/null
  base_url="http://localhost:8080"
  platform="container"
fi

for _ in $(seq 1 30); do
  curl -fsS --max-time 5 "${base_url}/healthz" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS --max-time 5 "${base_url}/healthz" >/dev/null || { echo "El objetivo no responde en ${base_url}"; exit 1; }

{
  echo "BASE_URL=${base_url}"
  echo "EXPECTED_SHA=${HEAD_SHA}"
  echo "EXPECTED_PLATFORM=${platform}"
} >> "$GITHUB_ENV"
