variable "region" {
  description = "Región de AWS para el estado y los entornos efímeros (us-east-1 es la de menor costo)."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Nombre del proyecto: se usa como prefijo y como etiqueta de asignación de costos."
  type        = string
  default     = "devsecops-gitops-challenge"
}

variable "github_repository" {
  description = "Repositorio autorizado a asumir el rol vía OIDC (owner/nombre, sensible a mayúsculas)."
  type        = string
  default     = "Danielperdomo29/devsecops-gitops-challenge"
}

variable "github_environment" {
  description = "GitHub Environment desde el que se permite asumir el rol (claim 'sub' del token OIDC)."
  type        = string
  default     = "preview"
}

variable "create_oidc_provider" {
  description = "false si la cuenta ya tiene el proveedor OIDC de GitHub (solo puede existir uno por URL)."
  type        = bool
  default     = true
}

variable "monthly_budget_usd" {
  description = "Presupuesto mensual (USD). Se notifica al 50 %, 80 % y 100 % real, y al 100 % pronosticado."
  type        = number
  default     = 5
}

variable "budget_emails" {
  description = "Correos que reciben las alertas de presupuesto (FinOps)."
  type        = list(string)

  validation {
    condition     = length(var.budget_emails) > 0
    error_message = "Indica al menos un correo para las alertas de presupuesto."
  }
}
