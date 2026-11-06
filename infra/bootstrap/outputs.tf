output "github_variables" {
  description = "Valores para Settings > Secrets and variables > Actions > Variables del repositorio (no son secretos)."
  value = {
    AWS_REGION             = var.region
    AWS_ROLE_ARN           = aws_iam_role.github_preview.arn
    TF_STATE_BUCKET        = aws_s3_bucket.tfstate.bucket
    ECS_EXECUTION_ROLE_ARN = aws_iam_role.ecs_execution.arn
  }
}
