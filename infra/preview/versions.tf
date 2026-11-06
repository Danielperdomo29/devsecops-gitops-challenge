terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.72"
    }
  }

  # Configuración parcial: bucket y key (preview/pr-<N>/terraform.tfstate) llegan por
  # -backend-config desde el pipeline. use_lockfile = bloqueo nativo de S3 (Terraform >= 1.10),
  # sin tabla DynamoDB: un recurso menos que pagar y mantener.
  backend "s3" {
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  # Todas las etiquetas se propagan a cada recurso: base del showback/chargeback por PR
  # y de la limpieza automática (janitor) por ExpiresAt.
  default_tags {
    tags = local.tags
  }
}
