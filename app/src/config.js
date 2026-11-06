// Configuración 12-factor: todo llega por variables de entorno y se valida al arrancar.
// Fallar rápido (fail-fast) con un error claro es preferible a arrancar con valores inválidos.

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

function parseInteger(value, fallback, name, { min, max }) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(
      `Variable ${name} inválida: "${value}" (esperado entero entre ${min} y ${max})`,
    );
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  return Object.freeze({
    port: parseInteger(env.PORT, 8080, 'PORT', { min: 1, max: 65535 }),
    host: env.HOST || '0.0.0.0',
    appEnv: env.APP_ENV || 'local',
    logLevel: LOG_LEVELS.includes(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info',
    // Tiempo que el pod sigue atendiendo tras SIGTERM mientras el Service lo retira de los endpoints.
    shutdownDelayMs: parseInteger(env.SHUTDOWN_DELAY_MS, 0, 'SHUTDOWN_DELAY_MS', {
      min: 0,
      max: 60000,
    }),
    shutdownTimeoutMs: parseInteger(env.SHUTDOWN_TIMEOUT_MS, 10000, 'SHUTDOWN_TIMEOUT_MS', {
      min: 1000,
      max: 120000,
    }),
    // Feed en vivo de GitHub Actions para /pipeline (requiere egress: activo solo en Render).
    pipelineFeed: env.PIPELINE_FEED === 'github' ? 'github' : 'off',
    // Token opcional de SOLO LECTURA para ampliar la cuota de la API (nunca se registra en logs).
    githubToken: env.GITHUB_FEED_TOKEN || '',
  });
}
