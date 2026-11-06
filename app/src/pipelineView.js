import { escapeHtml as e } from './security.js';

// Ciclo de vida de un Pull Request: cada etapa con sus herramientas y su justificación.
export const STAGES = [
  {
    title: 'Security gates',
    tools:
      'Gitleaks · Semgrep · SonarQube efímero · tests ≥ 90 % · Checkov · Terraform validate · zizmor',
    why: 'Shift-left: el defecto más barato es el que no llega a construirse.',
  },
  {
    title: 'Build y escaneo',
    tools: 'Docker multi-stage distroless · Trivy (gate) · SBOM CycloneDX · GHCR',
    why: 'Solo se publica una imagen sin CVEs críticos corregibles.',
  },
  {
    title: 'Validación del artefacto',
    tools: 'Attestation SLSA + SBOM firmados (Sigstore/OIDC) · no root · sin shell · tamaño',
    why: 'Se despliega lo que se construyó, verificado criptográficamente.',
  },
  {
    title: 'Terraform apply',
    tools: 'VPC aislada · ECS Fargate Spot · OIDC sin llaves · estado S3 por PR',
    why: 'Infraestructura idéntica y desechable por PR, con etiquetas de costo y TTL.',
    finops: true,
  },
  {
    title: 'Pruebas de integración',
    tools: 'Acceso just-in-time /32 · commit servido = commit del PR · cabeceras · p95',
    why: 'Se prueba en un entorno real, no solo en el runner.',
  },
  {
    title: 'DAST',
    tools: 'OWASP ZAP full scan (activo)',
    why: 'Ataques reales sin riesgo: el entorno es aislado y desechable.',
  },
  {
    title: 'Reporte en el PR',
    tools: 'Comentario único: resultados + URL + costo estimado + expiración',
    why: 'El revisor decide el merge con evidencia de seguridad y de costo.',
    finops: true,
  },
  {
    title: 'Merge / cierre → destroy',
    tools: 'terraform destroy · borrado del estado · costo real del entorno',
    why: 'Lo que no existe no cuesta ni se puede atacar.',
    finops: true,
  },
  {
    title: 'Limpieza',
    tools:
      'Imágenes del PR · janitor cada 6 h (PR cerrado o TTL vencido) · presupuesto con alertas',
    why: 'Red de seguridad: ningún recurso queda huérfano.',
    finops: true,
  },
];

const STATE_LABEL = {
  ok: ['ok', '✓', 'Éxito'],
  fail: ['fail', '✗', 'Falló'],
  running: ['run', '●', 'En curso'],
  skip: ['skip', '–', 'Omitida'],
  pending: ['pend', '·', 'No alcanzada'],
};

const chip = (state, label) => {
  const [cls, icon, text] = STATE_LABEL[state] ?? STATE_LABEL.pending;
  return `<span class="chip ${cls}" title="${e(text)}">${icon} ${e(label)}</span>`;
};

function runBadge(run) {
  if (run.status !== 'completed') return chip('running', 'en curso');
  return run.conclusion === 'success'
    ? chip('ok', 'éxito')
    : chip('fail', run.conclusion ?? 'falló');
}

const duration = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);

function runLink(run, text) {
  return run.url ? `<a href="${e(run.url)}" rel="noopener noreferrer">${e(text)}</a>` : e(text);
}

function previewRows(runs) {
  if (runs.length === 0) return '<p class="muted">Aún no hay ejecuciones de Pull Requests.</p>';
  return runs
    .map(
      (run) => `<div class="run">
<div class="run-head">
<strong>${run.pr ? `PR #${e(run.pr)}` : 'PR'}</strong> ${e(run.title)}
<span class="muted">· ${e(run.kind)} · <code>${e(run.sha.slice(0, 7) || 'n/a')}</code> · ${duration(run.durationSec)}</span>
${runBadge(run)} ${runLink(run, 'ver ejecución')}
</div>
<div class="chips">${run.stages.map((state, i) => chip(state, `${i + 1} ${STAGES[i].title}`)).join('')}</div>
</div>`,
    )
    .join('\n');
}

function deployRows(runs) {
  if (runs.length === 0) return '<p class="muted">Aún no hay ejecuciones en main.</p>';
  return runs
    .map(
      (run) => `<div class="run">
<div class="run-head"><code>${e(run.sha.slice(0, 7) || 'n/a')}</code> ${e(run.title)}
<span class="muted">· ${duration(run.durationSec)}</span> ${runBadge(run)} ${runLink(run, 'ver ejecución')}</div>
<div class="chips">${run.steps.map((s) => chip(s.state, s.label)).join('')}</div>
</div>`,
    )
    .join('\n');
}

function liveSection(feedEnabled, snap, nowMs) {
  if (!feedEnabled) {
    return `<p class="muted">El feed en vivo está desactivado en este entorno. En Kubernetes la
NetworkPolicy deniega todo el egress de la app (zero-trust); se activa en Render con
<code>PIPELINE_FEED=github</code>.</p>`;
  }
  const age =
    typeof snap.fetchedAt === 'number' ? Math.round((nowMs - snap.fetchedAt) / 1000) : null;
  const note = snap.stale
    ? `<p class="warn">GitHub no respondió (${e(snap.error ?? 'error')}). ${age === null ? 'Sin datos todavía.' : `Mostrando datos de hace ${age} s.`}</p>`
    : `<p class="muted">Datos de GitHub Actions de hace ${age ?? 0} s · la página se actualiza cada 30 s.</p>`;
  return `${note}
<h3>Pull Requests (preview.yaml)</h3>
${previewRows(snap.preview)}
<h3>Entrega continua de main (deploy.yaml)</h3>
${deployRows(snap.deploy)}`;
}

export function renderPipeline(info, { feedEnabled, snapshot, nowMs = Date.now() }) {
  const repoUrl = `https://github.com/${info.repository}`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${feedEnabled ? '<meta http-equiv="refresh" content="30">' : ''}
<title>Flujo DevSecOps + FinOps</title>
<link rel="stylesheet" href="/static/app.css">
</head>
<body>
<main>
<header>
<p><a href="/">← Inicio</a></p>
<h1>Flujo DevSecOps + FinOps por Pull Request</h1>
<p>Cada PR obtiene su propia infraestructura en AWS, aislada y temporal. Se prueba, se ataca y se
destruye al hacer merge o cerrarlo. Seguridad en cada etapa, costo visible y cero recursos olvidados.</p>
</header>

<section aria-labelledby="flow">
<h2 id="flow">Paso a paso</h2>
<ol class="flow">
${STAGES.map(
  (s, i) => `<li class="stage${s.finops ? ' finops' : ''}">
<span class="num">${i + 1}</span>
<div><strong>${e(s.title)}</strong>${s.finops ? ' <span class="tag">FinOps</span>' : ''}
<p class="tools">${e(s.tools)}</p>
<p class="why">${e(s.why)}</p></div>
</li>`,
).join('\n')}
</ol>
</section>

<section aria-labelledby="finops">
<h2 id="finops">FinOps: ¿cuánto cuesta?</h2>
<div class="grid">
<div><strong>~US$ 0,009 / hora</strong><span>Entorno por PR: Fargate Spot 0,25 vCPU / 512 MiB + 1 IPv4 pública</span></div>
<div><strong>~US$ 0,45 / mes</strong><span>100 PRs al mes de 30 min cada uno</span></div>
<div><strong>~US$ 65 / mes</strong><span>Un staging permanente equivalente con ALB + NAT Gateway + Fargate 24/7</span></div>
<div><strong>US$ 0 en reposo</strong><span>Sin PR abierto no hay infraestructura: destroy al cerrar, janitor por TTL y presupuesto con alertas</span></div>
</div>
<p class="muted">Precios de referencia us-east-1. La factura real se filtra en Cost Explorer por las etiquetas
<code>Project</code> y <code>PullRequest</code> que Terraform aplica a cada recurso.</p>
</section>

<section aria-labelledby="live">
<h2 id="live">En vivo</h2>
${liveSection(feedEnabled, snapshot, nowMs)}
</section>

<footer>
Autor: Daniel Enrique Perdomo Carvajal · <a href="${e(repoUrl)}" rel="noopener noreferrer">${e(info.repository)}</a>
</footer>
</main>
</body>
</html>
`;
}
