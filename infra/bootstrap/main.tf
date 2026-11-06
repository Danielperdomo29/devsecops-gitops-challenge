# =============================================================================
# Bootstrap (se ejecuta UNA vez, con credenciales de administrador)
# -----------------------------------------------------------------------------
# Crea lo mínimo para que GitHub Actions gestione entornos efímeros SIN llaves:
#   1. Bucket S3 para el estado remoto de Terraform (cifrado, versionado, privado),
#      con access logging: quién leyó o escribió el estado queda auditado.
#   2. Proveedor OIDC de GitHub + rol IAM asumible SOLO desde el environment
#      "preview" de este repositorio (sin AWS_ACCESS_KEY_ID en GitHub).
#   3. Rol de ejecución de tareas ECS con permisos mínimos (solo escribir logs).
#   4. Presupuesto mensual con alertas (FinOps: el gasto nunca es una sorpresa).
# =============================================================================

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id   = data.aws_caller_identity.current.account_id
  partition    = data.aws_partition.current.partition
  state_bucket = "${var.project}-tfstate-${local.account_id}"
  oidc_url     = "token.actions.githubusercontent.com"
  repo_owner   = split("/", var.github_repository)[0]
  repo_name    = split("/", var.github_repository)[1]
  # Prefijo del subject inmutable de GitHub: nombres + IDs numéricos.
  oidc_subject = "repo:${local.repo_owner}@${var.github_owner_id}/${local.repo_name}@${var.github_repository_id}"
  oidc_arn     = var.create_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : data.aws_iam_openid_connect_provider.github[0].arn
  log_prefix   = "/ecs/devsecops-pr-"
}

# -----------------------------------------------------------------------------
# 1. Estado remoto de Terraform
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "tfstate" {
  #checkov:skip=CKV_AWS_144:El estado está versionado y es reproducible; la replicación entre regiones duplica el costo sin necesidad
  #checkov:skip=CKV2_AWS_62:No hay consumidores de eventos del bucket de estado
  bucket = local.state_bucket
}

resource "aws_s3_bucket_ownership_controls" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true # reduce llamadas (y costo) a KMS
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    id     = "expirar-versiones-antiguas"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "tfstate_tls_only" {
  statement {
    sid       = "DenegarTransporteSinTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  policy = data.aws_iam_policy_document.tfstate_tls_only.json
}

# -----------------------------------------------------------------------------
# 1b. Access logs del estado. Las lecturas de objetos S3 son "data events" que
#     CloudTrail NO registra por defecto: sin esto, nadie sabría quién leyó el estado
#     (que puede contener datos sensibles de la infraestructura).
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "tfstate_logs" { # NOSONAR destino de access logs: registrar sus propios accesos sería recursivo
  #checkov:skip=CKV_AWS_18:Es el bucket DESTINO de los access logs; registrar sus propios accesos sería recursivo
  #checkov:skip=CKV_AWS_145:El destino de los access logs de S3 solo admite SSE-S3, no SSE-KMS
  #checkov:skip=CKV_AWS_144:Logs de auditoría que expiran a los 90 días; replicarlos entre regiones duplica el costo
  #checkov:skip=CKV2_AWS_62:No hay consumidores de eventos del bucket de logs
  bucket = "${local.state_bucket}-logs"
}

resource "aws_s3_bucket_ownership_controls" "tfstate_logs" {
  bucket = aws_s3_bucket.tfstate_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate_logs" {
  bucket                  = aws_s3_bucket.tfstate_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "tfstate_logs" {
  bucket = aws_s3_bucket.tfstate_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate_logs" {
  bucket = aws_s3_bucket.tfstate_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate_logs" {
  bucket = aws_s3_bucket.tfstate_logs.id

  rule {
    id     = "expirar-logs-de-auditoria"
    status = "Enabled"
    filter {}
    expiration {
      days = 90
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

data "aws_iam_policy_document" "tfstate_logs" {
  statement {
    sid       = "EntregaDeAccessLogsSoloDesdeElBucketDeEstado"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.tfstate_logs.arn}/tfstate/*"]
    principals {
      type        = "Service"
      identifiers = ["logging.s3.amazonaws.com"]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.tfstate.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }

  statement {
    sid       = "DenegarTransporteSinTLS"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.tfstate_logs.arn, "${aws_s3_bucket.tfstate_logs.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "tfstate_logs" {
  bucket = aws_s3_bucket.tfstate_logs.id
  policy = data.aws_iam_policy_document.tfstate_logs.json
}

resource "aws_s3_bucket_logging" "tfstate" {
  bucket        = aws_s3_bucket.tfstate.id
  target_bucket = aws_s3_bucket.tfstate_logs.id
  target_prefix = "tfstate/"

  depends_on = [aws_s3_bucket_policy.tfstate_logs]
}

# -----------------------------------------------------------------------------
# 2. Identidad federada GitHub -> AWS (OIDC, sin secretos de larga vida)
# -----------------------------------------------------------------------------
resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_oidc_provider ? 1 : 0
  url            = "https://${local.oidc_url}"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_openid_connect_provider" "github" {
  count = var.create_oidc_provider ? 0 : 1
  url   = "https://${local.oidc_url}"
}

data "aws_iam_policy_document" "github_trust" {
  statement {
    sid     = "SoloEnvironmentPreviewDeEsteRepo"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [local.oidc_arn]
    }
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Claim "sub" permitido (subject inmutable con IDs, coincidencia exacta, sin comodines):
    #  - environment:preview  -> job de despliegue (muestra la URL en el PR)
    #  - pull_request         -> pruebas, DAST y destroy de PRs de ESTE repo
    #                            (los PRs desde forks no reciben token OIDC)
    #  - ref:refs/heads/main  -> janitor programado que limpia entornos huérfanos
    condition {
      test     = "StringEquals"
      variable = "${local.oidc_url}:sub"
      values = [
        "${local.oidc_subject}:environment:${var.github_environment}",
        "${local.oidc_subject}:pull_request",
        "${local.oidc_subject}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "github_preview" {
  name                 = "${var.project}-gha-preview"
  description          = "Rol asumido por GitHub Actions (OIDC) para crear y destruir entornos efímeros de PR"
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_preview" {
  statement {
    sid       = "EstadoTerraformListar"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.tfstate.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["preview/*"]
    }
  }

  statement {
    sid       = "EstadoTerraformLeerEscribir"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.tfstate.arn}/preview/*"]
  }

  # Las acciones de creación de EC2/ECS no admiten un ARN conocido antes de crear el recurso:
  # se acotan por lista explícita de acciones (sin comodines) y por región.
  statement {
    sid = "RedYComputoEfimeros"
    actions = [
      "ec2:CreateVpc", "ec2:DeleteVpc", "ec2:ModifyVpcAttribute", "ec2:DescribeVpcs", "ec2:DescribeVpcAttribute",
      "ec2:CreateSubnet", "ec2:DeleteSubnet", "ec2:ModifySubnetAttribute", "ec2:DescribeSubnets",
      "ec2:CreateInternetGateway", "ec2:DeleteInternetGateway", "ec2:AttachInternetGateway",
      "ec2:DetachInternetGateway", "ec2:DescribeInternetGateways",
      "ec2:CreateRouteTable", "ec2:DeleteRouteTable", "ec2:CreateRoute", "ec2:DeleteRoute",
      "ec2:AssociateRouteTable", "ec2:DisassociateRouteTable", "ec2:DescribeRouteTables",
      "ec2:CreateSecurityGroup", "ec2:DeleteSecurityGroup", "ec2:DescribeSecurityGroups",
      "ec2:DescribeSecurityGroupRules", "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress",
      "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress",
      "ec2:CreateTags", "ec2:DeleteTags", "ec2:DescribeTags",
      "ec2:DescribeAvailabilityZones", "ec2:DescribeNetworkInterfaces", "ec2:DescribeNetworkAcls",
      "ec2:DescribeAccountAttributes", "ec2:DescribePrefixLists",
      "ecs:CreateCluster", "ecs:DeleteCluster", "ecs:DescribeClusters", "ecs:PutClusterCapacityProviders",
      "ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition", "ecs:DescribeTaskDefinition",
      "ecs:DeleteTaskDefinitions", "ecs:CreateService", "ecs:UpdateService", "ecs:DeleteService",
      "ecs:DescribeServices", "ecs:ListTasks", "ecs:DescribeTasks",
      # Lectura de despliegues: la usa el waiter de AWS provider 6.x (wait_for_steady_state).
      "ecs:ListServiceDeployments", "ecs:DescribeServiceDeployments", "ecs:DescribeServiceRevisions",
      "ecs:TagResource", "ecs:UntagResource", "ecs:ListTagsForResource",
      "logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups", "logs:PutRetentionPolicy",
      "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource", "logs:TagLogGroup",
      "logs:ListTagsLogGroup", "logs:FilterLogEvents", "logs:GetLogEvents",
      "tag:GetResources",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.region]
    }
  }

  statement {
    sid       = "PasarSoloElRolDeEjecucionDeTareas"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.ecs_execution.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }

  statement {
    sid       = "RolVinculadoDeEcsSiNoExiste"
    actions   = ["iam:CreateServiceLinkedRole"]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/aws-service-role/ecs.amazonaws.com/*"]
    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values   = ["ecs.amazonaws.com"]
    }
  }

  # Guardarraíl FinOps: aunque alguien amplíe los permisos, los recursos caros quedan vetados.
  statement {
    sid    = "VetarRecursosCaros"
    effect = "Deny"
    actions = [
      "ec2:RunInstances", "ec2:CreateNatGateway", "ec2:AllocateAddress",
      "elasticloadbalancing:CreateLoadBalancer", "rds:CreateDBInstance", "rds:CreateDBCluster",
      "eks:CreateCluster", "ec2:CreateVpcEndpoint",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_preview" {
  name   = "entornos-efimeros-minimo-privilegio"
  role   = aws_iam_role.github_preview.id
  policy = data.aws_iam_policy_document.github_preview.json
}

# -----------------------------------------------------------------------------
# 3. Rol de ejecución de tareas ECS (solo puede escribir sus propios logs)
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_tasks_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "${var.project}-ecs-execution"
  description        = "Rol de ejecución de las tareas efímeras: solo escribir logs en CloudWatch"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_trust.json
}

data "aws_iam_policy_document" "ecs_execution" {
  statement {
    sid       = "EscribirLogsDeEntornosEfimeros"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:${local.log_prefix}*:*"]
  }
}

resource "aws_iam_role_policy" "ecs_execution" {
  name   = "solo-logs"
  role   = aws_iam_role.ecs_execution.id
  policy = data.aws_iam_policy_document.ecs_execution.json
}

# -----------------------------------------------------------------------------
# 4. FinOps: presupuesto mensual con alertas reales y pronosticadas
# -----------------------------------------------------------------------------
resource "aws_budgets_budget" "monthly" {
  name         = "${var.project}-mensual"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.budget_emails
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_emails
  }
}
