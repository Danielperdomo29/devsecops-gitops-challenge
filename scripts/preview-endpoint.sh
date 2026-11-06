#!/usr/bin/env bash
# =============================================================================
# Obtiene el endpoint del entorno efímero (IP pública de la tarea ECS) y los datos
# FinOps de Terraform. Escribe las salidas del step y el resumen del job.
# Requiere: credenciales AWS, TF_DIR con el estado ya inicializado.
#
# RIESGO ACEPTADO Y DOCUMENTADO: el preview se sirve por HTTP (sin TLS).
#   - TLS exigiría ALB + ACM (~US$16/mes por entorno) o un dominio propio.
#   - El security group NO tiene ingreso permanente: cada job abre su IP /32 y la
#     revoca al terminar (acceso just-in-time), durante minutos.
#   - El entorno no tiene datos reales ni secretos y se destruye al cerrar el PR.
#   Cualquier entorno persistente o público debe servirse por HTTPS.
# =============================================================================
set -euo pipefail

: "${TF_DIR:?TF_DIR requerido}"
out() { terraform -chdir="$TF_DIR" output -raw "$1"; }

cluster="$(out cluster_name)"
task="$(aws ecs list-tasks --cluster "$cluster" --service-name api --desired-status RUNNING \
  --query 'taskArns[0]' --output text)"
eni="$(aws ecs describe-tasks --cluster "$cluster" --tasks "$task" \
  --query "tasks[0].attachments[0].details[?name=='networkInterfaceId'].value | [0]" --output text)"
ip="$(aws ec2 describe-network-interfaces --network-interface-ids "$eni" \
  --query 'NetworkInterfaces[0].Association.PublicIp' --output text)"
[[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || { echo "No se obtuvo la IP pública de la tarea"; exit 1; }

# Riesgo aceptado (Sonar shell:S5332), registrado como "Accepted" en SonarQube Cloud: ver cabecera.
url="http://${ip}:8080"
hourly="$(out estimated_hourly_usd)"
monthly="$(out estimated_monthly_usd_if_forgotten)"
expires="$(out expires_at)"

{
  echo "url=${url}"
  echo "security_group_id=$(out security_group_id)"
  echo "hourly_usd=${hourly}"
  echo "monthly_usd=${monthly}"
  echo "expires_at=${expires}"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"

{
  echo "### Entorno efímero listo"
  echo "| Campo | Valor |"
  echo "|---|---|"
  echo "| Endpoint | \`${url}\` (acceso just-in-time) |"
  echo "| Cómputo | ECS Fargate Spot · 0,25 vCPU · 512 MiB |"
  echo "| Costo estimado | US\$ ${hourly}/h |"
  echo "| Si nadie lo destruyera | US\$ ${monthly}/mes |"
  echo "| Expira (janitor) | ${expires} |"
} >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}"
