#!/usr/bin/env bash
# =============================================================================
# Bootstrap desde AWS CloudShell (sin instalar nada local ni crear access keys).
#
#   1. Consola de AWS -> icono de CloudShell (región us-east-1)
#   2. git clone https://github.com/Danielperdomo29/devsecops-gitops-challenge.git
#   3. cd devsecops-gitops-challenge && ./infra/bootstrap/cloudshell.sh tu-correo@dominio.com
#
# Al final imprime las 4 variables que hay que registrar en GitHub (no son secretos).
# =============================================================================
set -euo pipefail

EMAIL="${1:?Uso: $0 <correo-para-alertas-de-presupuesto>}"
TF_VERSION="1.17.1"
TF_SHA256="4638628058e71a55212b1c563712eac03b902128f40740f3dc8174df12135061" # linux_amd64
BIN_DIR="$HOME/.local/bin"

cd "$(dirname "$0")"

if ! command -v terraform >/dev/null || [[ "$(terraform version -json | jq -r .terraform_version)" != "$TF_VERSION" ]]; then
  echo "==> Instalando Terraform ${TF_VERSION} (verificando SHA-256)"
  tmp="$(mktemp -d)"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/tf.zip" "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_amd64.zip"
  echo "${TF_SHA256}  $tmp/tf.zip" | sha256sum -c -
  mkdir -p "$BIN_DIR" && unzip -oq "$tmp/tf.zip" -d "$BIN_DIR" && rm -rf "$tmp"
  export PATH="$BIN_DIR:$PATH"
fi

echo "==> Cuenta: $(aws sts get-caller-identity --query Account --output text)"

terraform init -input=false

# Proveedor OIDC de GitHub (solo puede haber uno por cuenta):
#  - si ya lo gestiona ESTE estado (re-ejecución), se mantiene gestionado;
#  - si existe pero lo creó otro proceso, se reutiliza como data source.
create_oidc=true
if terraform state list 2>/dev/null | grep -qF 'aws_iam_openid_connect_provider.github[0]'; then
  echo "==> Proveedor OIDC gestionado por este estado: se mantiene"
elif aws iam list-open-id-connect-providers --query 'OpenIDConnectProviderList[].Arn' --output text \
   | grep -q 'token.actions.githubusercontent.com'; then
  create_oidc=false
  echo "==> Proveedor OIDC de GitHub ya existe: se reutiliza"
fi
terraform apply -input=false \
  -var "budget_emails=[\"${EMAIL}\"]" \
  -var "create_oidc_provider=${create_oidc}"

echo
echo "==> Registra estas variables en GitHub (Settings > Secrets and variables > Actions > Variables):"
terraform output -json github_variables | jq -r 'to_entries[] | "\(.key)=\(.value)"'
