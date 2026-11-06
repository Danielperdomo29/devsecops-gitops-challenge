output "cluster_name" {
  description = "Clúster ECS del entorno."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "Servicio ECS del entorno."
  value       = aws_ecs_service.app.name
}

output "security_group_id" {
  description = "Security group donde los jobs abren su acceso just-in-time."
  value       = aws_security_group.app.id
}

output "log_group" {
  description = "Grupo de logs en CloudWatch."
  value       = aws_cloudwatch_log_group.app.name
}

output "created_at" {
  description = "Momento del último despliegue (base del cálculo de costo al destruir)."
  value       = var.created_at
}

output "expires_at" {
  description = "Momento a partir del cual el janitor destruye el entorno."
  value       = local.tags.ExpiresAt
}

output "estimated_hourly_usd" {
  description = "Costo estimado por hora (cómputo + IPv4 pública), según los precios de referencia."
  value       = format("%.4f", local.hourly_usd)
}

output "estimated_monthly_usd_if_forgotten" {
  description = "Lo que costaría el entorno si nadie lo destruyera durante un mes (730 h)."
  value       = format("%.2f", local.hourly_usd * 730)
}
