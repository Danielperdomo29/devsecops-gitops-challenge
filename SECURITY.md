# Política de seguridad

## Reporte de vulnerabilidades

Si encuentras una vulnerabilidad, **no abras un issue público**. Repórtala de forma privada
desde la pestaña **Security → Report a vulnerability** de este repositorio (GitHub Private
Vulnerability Reporting). Recibirás respuesta en un máximo de 72 horas.

## Controles automatizados

| Capa | Control | Dónde |
|---|---|---|
| Secretos | Gitleaks sobre todo el historial, en pre-commit y en CI | `.pre-commit-config.yaml`, `deploy.yaml` |
| Código (SAST) | Semgrep + CodeQL (JavaScript y GitHub Actions) | `_security-gates.yaml`, `codeql.yaml` |
| Calidad | SonarQube efímero con quality gate como código | `_security-gates.yaml`, `scripts/sonarqube-bootstrap.sh` |
| Dependencias (SCA) | `npm audit`, Trivy, Dependabot con cooldown de 7 días, `min-release-age` en npm | `deploy.yaml`, `dependabot.yml`, `app/.npmrc` |
| Infraestructura (IaC) | Checkov (K8s + Terraform), kubeconform, Hadolint, `terraform validate`, `values.schema.json` | `_security-gates.yaml`, `charts/`, `infra/` |
| Nube (AWS) | OIDC sin llaves, IAM de mínimo privilegio con deny de recursos caros, VPC aislada por PR, acceso just-in-time /32 | `infra/`, `preview.yaml`, `.github/actions/jit-access` |
| CI/CD | zizmor + actionlint, permisos mínimos, acciones e imágenes fijadas por SHA/digest | `deploy.yaml` |
| Imagen | Distroless no root, Trivy (bloquea CRITICAL/HIGH con parche), SBOM CycloneDX | `app/Dockerfile`, `deploy.yaml` |
| Ejecución (DAST) | OWASP ZAP baseline (main) y full scan activo contra el entorno efímero (PR) | `deploy.yaml`, `preview.yaml`, `.zap/rules.tsv` |
| Procedencia | Attestations SLSA y SBOM firmadas con Sigstore (OIDC, sin llaves) | `deploy.yaml` |
| Runtime | Pod Security `restricted`, rootfs de solo lectura, NetworkPolicy default-deny | `charts/`, `gitops/argocd/` |

Los hallazgos se publican en **Security → Code scanning**.
