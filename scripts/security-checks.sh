#!/usr/bin/env bash
# =============================================================================
# Reproduce en local los gates de seguridad del pipeline (requiere Docker y Helm).
# Mismas herramientas, mismas versiones y mismos digests que .github/workflows/deploy.yaml.
#   ./scripts/security-checks.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

SEMGREP=semgrep/semgrep:1.184.0@sha256:cc1b68266f267878b39739373ea9985b9a78e5d64497dd875c8de100b22695ed
GITLEAKS=zricethezav/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
CHECKOV=bridgecrew/checkov:3.4.3@sha256:bfe9d70bb7f044aba49bd99675813445f106dee6072da583f51008cb667f3a63
HADOLINT=hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d
TRIVY=ghcr.io/aquasecurity/trivy:0.76.2@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb
ZAP=ghcr.io/zaproxy/zaproxy:stable@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af
IMAGE=devsecops-api:local

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

step "Pruebas unitarias + lint"
(cd app && npm ci --ignore-scripts && npm run lint && npm test)

step "Gitleaks (historial de Git)"
docker run --rm -v "$PWD:/repo" -w /repo "$GITLEAKS" git --redact --exit-code 1 .

step "Semgrep (SAST)"
docker run --rm -v "$PWD:/src" -w /src "$SEMGREP" semgrep scan \
  --config p/javascript --config p/nodejs --config p/owasp-top-ten \
  --config p/dockerfile --config p/kubernetes --config p/github-actions --metrics off --error

step "Helm lint + render por entorno"
mkdir -p rendered
for env in dev prod; do
  helm lint charts/devsecops-api --strict -f "gitops/environments/${env}/values.override.yaml"
  helm template devsecops-api charts/devsecops-api --namespace "devsecops-${env}" \
    -f "gitops/environments/${env}/values.override.yaml" > "rendered/${env}.yaml"
done

step "Hadolint + Checkov (IaC)"
docker run --rm -i "$HADOLINT" < app/Dockerfile
docker run --rm -v "$PWD:/repo" -w /repo "$CHECKOV" --config-file .checkov.yaml

step "Build de la imagen"
docker build app -t "$IMAGE" --build-arg GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"

step "Trivy (gate CRITICAL/HIGH con parche)"
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock "$TRIVY" image \
  --scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 "$IMAGE"

step "DAST: OWASP ZAP baseline contra el contenedor endurecido"
docker rm -f devsecops-dast >/dev/null 2>&1 || true
docker run -d --name devsecops-dast -p 18080:8080 --read-only --tmpfs /tmp:size=16m \
  --cap-drop ALL --security-opt no-new-privileges "$IMAGE" >/dev/null
trap 'docker rm -f devsecops-dast >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 20); do curl -fsS http://localhost:18080/healthz >/dev/null && break; sleep 1; done
docker run --rm --user root -v "$PWD/.zap:/zap/wrk:rw" "$ZAP" \
  zap-baseline.py -t http://host.docker.internal:18080 -c rules.tsv -I

step "Todos los controles pasaron"
