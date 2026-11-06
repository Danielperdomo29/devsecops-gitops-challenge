// Feed en vivo de GitHub Actions para la página /pipeline.
// - Solo lectura de la API pública de GitHub (token opcional para más cuota).
// - Caché con TTL + caché permanente de jobs de ejecuciones TERMINADAS (son inmutables):
//   en régimen estable bastan 2-3 llamadas cada pocos minutos (límite anónimo: 60/h).
// - Si GitHub falla, se sirve el último dato bueno marcado como "stale": la página nunca cae.
// - En Kubernetes está desactivado: la NetworkPolicy deniega todo el egress de la app.

const API = 'https://api.github.com';
const MAX_JOB_CACHE = 100;

const STAGE_RE = /^(\d)\s·/;

export function stageOf(jobName) {
  const match = STAGE_RE.exec(jobName);
  return match ? Number(match[1]) : null;
}

export function aggregate(jobs) {
  if (jobs.length === 0) return 'pending';
  if (jobs.some((j) => j.status !== 'completed')) return 'running';
  if (jobs.some((j) => ['failure', 'timed_out', 'cancelled'].includes(j.conclusion))) {
    return 'fail';
  }
  if (jobs.every((j) => j.conclusion === 'skipped')) return 'skip';
  return 'ok';
}

const DEPLOY_STEPS = [
  ['Gates', /Security gates/],
  ['Build', /^Build/],
  ['GitOps', /^GitOps/],
  ['ArgoCD e2e', /^Verificaci/],
  ['Render', /^Render/],
];

export function createGithubFeed({
  repository,
  token = '',
  fetchImpl = globalThis.fetch,
  ttlMs = 180_000,
  timeoutMs = 4_000,
  now = Date.now,
}) {
  const runsBase = `https://github.com/${repository}/actions/runs/`;
  const jobCache = new Map();
  let cache = null;
  let inflight = null;

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'devsecops-api-pipeline-feed',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  async function get(path) {
    const res = await fetchImpl(`${API}${path}`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const error = new Error(`GitHub API respondió ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  async function jobsFor(run) {
    if (jobCache.has(run.id)) return jobCache.get(run.id);
    const data = await get(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=50`);
    const jobs = (data.jobs ?? []).map((j) => ({
      name: String(j.name),
      status: j.status,
      conclusion: j.conclusion,
    }));
    if (run.status === 'completed') {
      jobCache.set(run.id, jobs);
      if (jobCache.size > MAX_JOB_CACHE) jobCache.delete(jobCache.keys().next().value);
    }
    return jobs;
  }

  function baseRun(run) {
    const started = Date.parse(run.run_started_at ?? run.created_at);
    const ended = run.status === 'completed' ? Date.parse(run.updated_at) : now();
    const url = String(run.html_url ?? '');
    return {
      id: run.id,
      title: String(run.display_title ?? ''),
      pr: run.pull_requests?.[0]?.number ?? null,
      // GitHub deja de informar el número de PR cuando la rama se borra tras el merge:
      // la rama de origen sirve de respaldo para identificar la ejecución.
      branch: /^[\w./-]{1,100}$/.test(run.head_branch ?? '') ? run.head_branch : '',
      sha: /^[0-9a-f]{40}$/.test(run.head_sha) ? run.head_sha : '',
      status: run.status,
      conclusion: run.conclusion,
      url: url.startsWith(runsBase) ? url : null,
      durationSec: Number.isFinite(started) ? Math.max(0, Math.round((ended - started) / 1000)) : 0,
      createdAt: run.created_at,
    };
  }

  async function workflowRuns(file, limit) {
    try {
      const path = `/repos/${repository}/actions/workflows/${file}/runs?per_page=${limit}`;
      return (await get(path)).workflow_runs ?? [];
    } catch (error) {
      // Un workflow que aún no existe (404) no debe ocultar los datos de los demás.
      if (error.status === 404) return [];
      throw error;
    }
  }

  async function load() {
    const [previewRuns, deployRuns] = await Promise.all([
      workflowRuns('preview.yaml', 5),
      workflowRuns('deploy.yaml', 3),
    ]);

    const preview = await Promise.all(
      previewRuns.map(async (run) => {
        const jobs = await jobsFor(run);
        const stages = Array.from({ length: 9 }, (_, i) =>
          aggregate(jobs.filter((j) => stageOf(j.name) === i + 1)),
        );
        // Cierre = corrió el destroy (8) o la limpieza (9). Sin AWS el destroy se omite,
        // por eso no basta con mirar la etapa 8.
        const ran = (s) => s !== 'skip' && s !== 'pending';
        const kind = ran(stages[7]) || ran(stages[8]) ? 'cierre' : 'apertura';
        return { ...baseRun(run), stages, kind };
      }),
    );

    const deploy = await Promise.all(
      deployRuns.map(async (run) => {
        const jobs = await jobsFor(run);
        const steps = DEPLOY_STEPS.map(([label, re]) => ({
          label,
          state: aggregate(jobs.filter((j) => re.test(j.name))),
        }));
        return { ...baseRun(run), steps };
      }),
    );

    return { preview, deploy, fetchedAt: now() };
  }

  return {
    async snapshot() {
      if (cache && now() - cache.fetchedAt < ttlMs) return { ...cache, stale: false };
      inflight ??= load().finally(() => {
        inflight = null;
      });
      try {
        cache = await inflight;
        return { ...cache, stale: false };
      } catch (error) {
        if (cache) return { ...cache, stale: true, error: error.message };
        return { preview: [], deploy: [], fetchedAt: null, stale: true, error: error.message };
      }
    },
  };
}
