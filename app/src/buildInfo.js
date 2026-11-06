// Metadatos de trazabilidad: qué commit, qué imagen y qué ejecución del pipeline produjeron
// este proceso. Los valores llegan como build-args/env y se validan con listas blancas
// (defensa en profundidad: nunca se refleja en HTML/JSON un valor arbitrario del entorno).

const SHA_RE = /^[0-9a-f]{7,40}$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const IMAGE_RE = /^[a-z0-9.\-/:@]{1,255}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;
const RUN_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/;

const DEFAULT_REPOSITORY = 'Danielperdomo29/devsecops-gitops-challenge';

function pick(value, regex, fallback) {
  return typeof value === 'string' && regex.test(value) ? value : fallback;
}

export function detectPlatform(env) {
  if (env.RENDER === 'true') return 'render';
  if (env.ECS_CONTAINER_METADATA_URI_V4) return 'aws-ecs-fargate';
  if (env.KUBERNETES_SERVICE_HOST) return 'kubernetes';
  return 'container';
}

export function getBuildInfo(env = process.env) {
  // En Render la imagen se construye en su plataforma: el SHA llega como RENDER_GIT_COMMIT.
  // Se toma el primer SHA VÁLIDO: el Dockerfile define GIT_SHA=unknown por defecto.
  const commit =
    [env.GIT_SHA, env.RENDER_GIT_COMMIT].find((v) => typeof v === 'string' && SHA_RE.test(v)) ??
    'unknown';
  return Object.freeze({
    service: 'devsecops-api',
    version: pick(env.APP_VERSION, VERSION_RE, '1.0.0'),
    commit,
    shortCommit: commit === 'unknown' ? 'unknown' : commit.slice(0, 7),
    buildDate: pick(env.BUILD_DATE, DATE_RE, 'unknown'),
    image: pick(env.IMAGE_REF, IMAGE_RE, 'unknown'),
    repository: pick(env.GIT_REPOSITORY, REPO_RE, DEFAULT_REPOSITORY),
    runUrl: pick(env.BUILD_RUN_URL, RUN_URL_RE, null),
    platform: detectPlatform(env),
    environment: pick(env.APP_ENV, VERSION_RE, 'local'),
    node: process.version,
  });
}
