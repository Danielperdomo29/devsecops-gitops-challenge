variable "region" {
  description = "Región de AWS."
  type        = string
  default     = "us-east-1"
}

variable "availability_zones" {
  description = "Zonas fijadas explícitamente: el resultado no cambia si AWS agrega zonas nuevas."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2
    error_message = "Se requieren exactamente 2 zonas de disponibilidad."
  }
}

variable "pr_number" {
  description = "Número del Pull Request: aísla nombre, red y estado de cada entorno."
  type        = number

  validation {
    condition     = var.pr_number > 0 && floor(var.pr_number) == var.pr_number
    error_message = "pr_number debe ser un entero positivo."
  }
}

variable "image" {
  description = "Imagen inmutable a desplegar: repositorio@sha256:digest (la misma que se escaneó y firmó)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$", var.image))
    error_message = "La imagen debe referenciarse por digest (repo@sha256:...): nunca por tag mutable."
  }
}

variable "execution_role_arn" {
  description = "Rol de ejecución de tareas ECS creado por infra/bootstrap."
  type        = string
}

variable "allowed_cidrs" {
  description = <<-EOT
    CIDRs con acceso permanente al puerto de la app (p. ej. la red de los revisores).
    Por defecto vacío: los jobs del pipeline abren su propia IP /32 just-in-time y la revocan al terminar.
  EOT
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.allowed_cidrs : can(cidrhost(c, 0)) && c != "0.0.0.0/0"])
    error_message = "allowed_cidrs debe contener CIDRs válidos y nunca 0.0.0.0/0."
  }
}

variable "use_spot" {
  description = "Usar Fargate Spot (hasta ~70 % más barato; tolerable en entornos efímeros)."
  type        = bool
  default     = true
}

variable "cpu" {
  description = "CPU de la tarea en unidades ECS (256 = 0,25 vCPU)."
  type        = number
  default     = 256

  # Guardarraíl FinOps como código: un PR no puede pedir más capacidad de la necesaria.
  validation {
    condition     = contains([256, 512], var.cpu)
    error_message = "Entornos efímeros: cpu permitido 256 o 512."
  }
}

variable "memory" {
  description = "Memoria de la tarea en MiB."
  type        = number
  default     = 512

  validation {
    condition     = contains([512, 1024], var.memory)
    error_message = "Entornos efímeros: memoria permitida 512 o 1024 MiB."
  }
}

variable "ttl_hours" {
  description = "Vida máxima del entorno. El janitor destruye lo que supere ExpiresAt aunque el PR siga abierto."
  type        = number
  default     = 24

  validation {
    condition     = var.ttl_hours >= 1 && var.ttl_hours <= 72
    error_message = "ttl_hours debe estar entre 1 y 72."
  }
}

variable "created_at" {
  description = "Marca de tiempo RFC 3339 de creación (la fija el pipeline; timestamp() cambiaría en cada plan)."
  type        = string
}

variable "commit_sha" {
  description = "Commit desplegado (trazabilidad en etiquetas)."
  type        = string
}

variable "owner" {
  description = "Autor del PR: dueño del costo (showback)."
  type        = string
}

variable "repository" {
  description = "Repositorio de origen."
  type        = string
  default     = "Danielperdomo29/devsecops-gitops-challenge"
}

# Precios de referencia (us-east-1, Linux/x86). Solo para la estimación del reporte FinOps;
# la factura real se consulta en Cost Explorer filtrando por la etiqueta PullRequest.
variable "price_vcpu_hour" {
  description = "USD por vCPU-hora (Fargate on-demand)."
  type        = number
  default     = 0.04048
}

variable "price_gb_hour" {
  description = "USD por GB-hora (Fargate on-demand)."
  type        = number
  default     = 0.004445
}

variable "spot_discount" {
  description = "Descuento aproximado de Fargate Spot sobre on-demand."
  type        = number
  default     = 0.7
}

variable "price_public_ipv4_hour" {
  description = "USD por IPv4 pública por hora (AWS cobra las IPv4 públicas desde 2024)."
  type        = number
  default     = 0.005
}
