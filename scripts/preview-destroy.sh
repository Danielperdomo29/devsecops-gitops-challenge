#!/usr/bin/env bash
# =============================================================================
# Destruye el entorno efímero de un PR y elimina su estado de Terraform.
# Lo usan preview.yaml (al cerrar o mergear el PR) y preview-janitor.yaml (TTL vencido).
#   scripts/preview-destroy.sh <numero-de-PR>
# Requiere: credenciales AWS, TF_STATE_BUCKET, AWS_REGION y las TF_VAR_* básicas.
# Genera destroy-report.md con la vida útil y el costo estimado del entorno (FinOps).
# =============================================================================
set -euo pipefail

PR="${1:?Uso: $0 <numero-de-PR>}"
[[ "$PR" =~ ^[0-9]+$ ]] || { echo "Número de PR inválido: $PR"; exit 1; }
TF_DIR="${TF_DIR:-infra/preview}"
KEY="preview/pr-${PR}/terraform.tfstate"

if ! aws s3api head-object --bucket "$TF_STATE_BUCKET" --key "$KEY" >/dev/null 2>&1; then
  echo "El PR #${PR} no tiene entorno desplegado (sin estado en S3): nada que destruir."
  exit 0
fi

terraform -chdir="$TF_DIR" init -input=false -reconfigure \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="key=${KEY}" \
  -backend-config="region=${AWS_REGION}" >/dev/null

# Datos FinOps leídos del estado ANTES de destruir.
created_at="$(terraform -chdir="$TF_DIR" output -raw created_at 2>/dev/null || true)"
hourly="$(terraform -chdir="$TF_DIR" output -raw estimated_hourly_usd 2>/dev/null || echo 0)"
export TF_VAR_created_at="${created_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

terraform -chdir="$TF_DIR" destroy -input=false -auto-approve -no-color | tail -n 3
aws s3 rm "s3://${TF_STATE_BUCKET}/${KEY}" >/dev/null

minutes=0
if [[ -n "$created_at" ]]; then
  minutes=$(( ( $(date -u +%s) - $(date -u -d "$created_at" +%s) ) / 60 ))
fi
cost="$(awk -v h="$hourly" -v m="$minutes" 'BEGIN { printf "%.4f", h * m / 60 }')"
reason="cerrado"; [[ "${MERGED:-false}" = "true" ]] && reason="mergeado"

cat > destroy-report.md <<EOF
## Entorno efímero destruido (PR ${reason})

| FinOps | |
|---|---|
| Vida del entorno | ${minutes} min (último despliegue: ${created_at:-n/a}) |
| Costo estimado | US\$ ${cost} (tarifa ~US\$ ${hourly}/h) |
| Recursos | VPC, subredes, security groups, clúster y servicio ECS, logs: **eliminados** |
| Estado de Terraform | \`s3://…/${KEY}\` eliminado |

Infraestructura que no existe no genera costo ni superficie de ataque.
EOF
cat destroy-report.md >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "Entorno del PR #${PR} destruido (${minutes} min, ~US\$ ${cost})."
