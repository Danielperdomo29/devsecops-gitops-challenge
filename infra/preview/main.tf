# =============================================================================
# Entorno EFÍMERO por Pull Request
# -----------------------------------------------------------------------------
# Aislado: VPC propia por PR (sin peering ni rutas a otros entornos).
# Seguro:  rootfs de solo lectura, sin capabilities, no root, imagen por digest,
#          security group sin reglas de ingreso permanentes (acceso just-in-time).
# FinOps:  Fargate Spot, sin NAT Gateway (~US$32/mes) ni ALB (~US$16/mes),
#          logs retenidos 14 días (borrados con el entorno), etiquetas de costo y TTL.
# Efímero: se crea al abrir/actualizar el PR y se destruye al hacer merge o cerrarlo.
# =============================================================================

locals {
  name = "devsecops-pr-${var.pr_number}"

  tags = {
    Project     = "devsecops-gitops-challenge"
    Environment = "preview"
    PullRequest = tostring(var.pr_number)
    Commit      = var.commit_sha
    Owner       = var.owner
    CostCenter  = "devsecops-demo"
    ManagedBy   = "terraform"
    Repository  = var.repository
    CreatedAt   = var.created_at
    ExpiresAt   = timeadd(var.created_at, "${var.ttl_hours}h")
  }

  vcpu      = var.cpu / 1024
  memory_gb = var.memory / 1024
  price_mul = var.use_spot ? (1 - var.spot_discount) : 1
  hourly_usd = (
    local.vcpu * var.price_vcpu_hour * local.price_mul +
    local.memory_gb * var.price_gb_hour * local.price_mul +
    var.price_public_ipv4_hour
  )
}

# -----------------------------------------------------------------------------
# Red aislada
# -----------------------------------------------------------------------------
resource "aws_vpc" "this" {
  #checkov:skip=CKV2_AWS_11:Entorno de minutos sin datos sensibles; los flow logs (costo por GB) se habilitan en entornos persistentes
  cidr_block           = "10.42.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

# El security group por defecto queda sin reglas: nada puede usarlo por accidente.
resource "aws_default_security_group" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = "${local.name}-default-deny" }
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id            = aws_vpc.this.id
  cidr_block        = cidrsubnet(aws_vpc.this.cidr_block, 2, count.index)
  availability_zone = var.availability_zones[count.index]
  # La IP pública NO se asigna por defecto en la subred: solo la tarea ECS la pide explícitamente.
  map_public_ip_on_launch = false

  tags = { Name = "${local.name}-public-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "app" {
  name        = "${local.name}-app"
  description = "API del PR ${var.pr_number}: ingreso just-in-time al 8080, egress solo HTTPS"
  vpc_id      = aws_vpc.this.id

  tags = { Name = "${local.name}-app" }
}

# Acceso permanente opcional (revisores). Los jobs del pipeline añaden y revocan su /32.
resource "aws_vpc_security_group_ingress_rule" "reviewers" {
  for_each = toset(var.allowed_cidrs)

  security_group_id = aws_security_group.app.id
  description       = "Revisores del PR"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 8080
  to_port           = 8080
}

resource "aws_vpc_security_group_egress_rule" "https" {
  security_group_id = aws_security_group.app.id
  description       = "Descarga de la imagen (GHCR) y envio de logs (CloudWatch)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

# -----------------------------------------------------------------------------
# Cómputo: ECS Fargate (Spot) con la misma imagen endurecida que va a Kubernetes
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "app" {
  #checkov:skip=CKV_AWS_338:FinOps: el grupo se borra con el entorno (vida máx. 72 h); retener 1 año logs de un PR destruido es costo sin valor
  #checkov:skip=CKV_AWS_158:Logs sin datos sensibles, cifrados en reposo con llaves de AWS; una CMK cuesta US$1/mes por entorno
  name = "/ecs/${local.name}"
  # 14 días > TTL máximo (72 h): ningún log se pierde mientras el entorno vive.
  retention_in_days = 14
}

resource "aws_ecs_cluster" "this" {
  #checkov:skip=CKV_AWS_65:Container Insights cobra por métrica; en un entorno efímero se observa vía /metrics y logs
  name = local.name

  # Container Insights tiene costo por métrica; en un entorno de minutos no aporta valor.
  setting {
    name  = "containerInsights"
    value = "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  # Sin task role: la app no llama a ninguna API de AWS (mínimo privilegio).

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = "api"
      image                  = var.image
      essential              = true
      user                   = "65532:65532"
      readonlyRootFilesystem = true
      portMappings           = [{ containerPort = 8080, protocol = "tcp" }]
      environment = [
        { name = "APP_ENV", value = "preview" },
        { name = "LOG_LEVEL", value = "info" },
        { name = "PORT", value = "8080" },
      ]
      linuxParameters = {
        capabilities = { drop = ["ALL"] }
      }
      mountPoints = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
      healthCheck = {
        command     = ["CMD", "/nodejs/bin/node", "/app/src/healthcheck.js"]
        interval    = 10
        timeout     = 3
        retries     = 3
        startPeriod = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "app" {
  #checkov:skip=CKV_AWS_333:IP pública en lugar de NAT Gateway (~US$32/mes); el security group no tiene ingreso permanente (acceso just-in-time /32)
  name            = "api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1

  capacity_provider_strategy {
    capacity_provider = var.use_spot ? "FARGATE_SPOT" : "FARGATE"
    weight            = 1
  }

  network_configuration {
    subnets         = aws_subnet.public[*].id
    security_groups = [aws_security_group.app.id]
    # IP pública en lugar de NAT Gateway: ahorra ~US$32/mes por entorno.
    assign_public_ip = true
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  propagate_tags          = "SERVICE"
  enable_ecs_managed_tags = true
  # terraform apply espera a que la tarea esté RUNNING y HEALTHY (healthCheck del contenedor).
  wait_for_steady_state = true
  force_delete          = true

  depends_on = [aws_ecs_cluster_capacity_providers.this, aws_route_table_association.public]
}
