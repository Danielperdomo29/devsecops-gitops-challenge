import { escapeHtml as e } from './security.js';

const PIPELINE = [
  ['Secret scanning', 'Gitleaks sobre todo el historial de Git'],
  ['SAST', 'Semgrep (job en contenedor) + CodeQL'],
  ['Pruebas', 'node:test con umbral de cobertura obligatorio'],
  ['IaC / Policy', 'Checkov, kubeconform, Hadolint, actionlint y zizmor'],
  ['Build', 'Docker multi-stage sobre distroless, usuario no root'],
  ['SCA / Imagen', 'Trivy (bloquea CRITICAL/HIGH) + SBOM CycloneDX'],
  ['DAST', 'OWASP ZAP baseline contra el contenedor en ejecución'],
  ['Publicación', 'GHCR con tag = commit SHA + attestation SLSA firmada'],
  ['GitOps', 'El pipeline actualiza values.yaml; ArgoCD sincroniza'],
  ['Verificación', 'kind + ArgoCD efímeros: Synced/Healthy + self-heal de drift'],
];

const CONTROLS = [
  ['Zero-trust en CI', 'permissions mínimos por job, OIDC, acciones fijadas por SHA'],
  ['Supply chain', 'imagen inmutable por digest, SBOM y procedencia verificable'],
  ['Runtime', 'read-only rootfs, sin capabilities, seccomp RuntimeDefault'],
  ['Red', 'NetworkPolicy default-deny, solo ingreso al puerto de la app'],
];

const link = (href, text) => `<a href="${e(href)}" rel="noopener noreferrer">${e(text)}</a>`;

export function renderHome(info) {
  const repoUrl = `https://github.com/${info.repository}`;
  const commitCell =
    info.commit === 'unknown'
      ? '<code>unknown</code>'
      : link(`${repoUrl}/commit/${info.commit}`, info.shortCommit);
  // Imagen del pipeline: enlace a su ejecución. Imagen construida en Render: enlace a los
  // checks de GitHub del commit (Render solo despliega cuando todos pasaron).
  let runCell = 'n/a';
  if (info.runUrl) runCell = link(info.runUrl, 'Ver ejecución en GitHub Actions');
  else if (info.commit !== 'unknown') {
    runCell = link(
      `${repoUrl}/commit/${info.commit}/checks`,
      'Ver checks de este commit en GitHub',
    );
  }

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DevSecOps GitOps Delivery</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<main>
<header>
<span class="pill">● Operativo</span>
<h1>DevSecOps · GitOps Delivery</h1>
<p>Prueba técnica DevOps Senior: Git, GitHub Actions, Kubernetes, OpenShift, Helm y ArgoCD.</p>
<p class="cta"><a href="/pipeline">Ver el flujo DevSecOps + FinOps por Pull Request, paso a paso y en vivo →</a></p>
</header>

<section aria-labelledby="trace">
<h2 id="trace">Trazabilidad de esta instancia</h2>
<dl>
<dt>Commit</dt><dd>${commitCell}</dd>
<dt>Versión</dt><dd><code>${e(info.version)}</code></dd>
<dt>Imagen</dt><dd><code>${e(info.image)}</code></dd>
<dt>Build</dt><dd>${e(info.buildDate)}</dd>
<dt>Pipeline</dt><dd>${runCell}</dd>
<dt>Plataforma</dt><dd>${e(info.platform)} · entorno <code>${e(info.environment)}</code> · Node ${e(info.node)}</dd>
</dl>
</section>

<section aria-labelledby="pipeline">
<h2 id="pipeline">Pipeline que produjo este despliegue</h2>
<ol>
${PIPELINE.map(([name, detail]) => `<li><strong>${e(name)}</strong>: ${e(detail)}</li>`).join('\n')}
</ol>
</section>

<section aria-labelledby="controls">
<h2 id="controls">Controles de seguridad</h2>
<div class="grid">
${CONTROLS.map(([name, detail]) => `<div><strong>${e(name)}</strong><span>${e(detail)}</span></div>`).join('\n')}
</div>
</section>

<section aria-labelledby="api">
<h2 id="api">Endpoints</h2>
<dl>
<dt><code>/healthz</code></dt><dd>Liveness probe</dd>
<dt><code>/readyz</code></dt><dd>Readiness probe (503 durante el apagado ordenado)</dd>
<dt><code>/version</code></dt><dd>Metadatos de build en JSON</dd>
<dt><code>/metrics</code></dt><dd>Métricas en formato Prometheus</dd>
</dl>
</section>

<footer>
Autor: Daniel Enrique Perdomo Carvajal · Código fuente: ${link(repoUrl, info.repository)}
</footer>
</main>
</body>
</html>
`;
}
