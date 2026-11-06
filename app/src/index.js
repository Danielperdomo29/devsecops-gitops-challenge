import { createApp } from './app.js';
import { getBuildInfo } from './buildInfo.js';
import { loadConfig } from './config.js';
import { createGithubFeed } from './githubFeed.js';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { createServer, registerGracefulShutdown } from './server.js';

const config = loadConfig();
const buildInfo = getBuildInfo();
const logger = createLogger({
  level: config.logLevel,
  base: { service: buildInfo.service, env: config.appEnv, commit: buildInfo.shortCommit },
});
const metrics = new Metrics(buildInfo);
const state = { shuttingDown: false };
const pipelineFeed =
  config.pipelineFeed === 'github'
    ? createGithubFeed({ repository: buildInfo.repository, token: config.githubToken })
    : null;

const server = createServer(createApp({ buildInfo, logger, metrics, state, pipelineFeed }));

server.listen(config.port, config.host, () => {
  logger.info('server_started', {
    port: config.port,
    platform: buildInfo.platform,
    pipelineFeed: config.pipelineFeed,
  });
});

registerGracefulShutdown({
  server,
  state,
  logger,
  delayMs: config.shutdownDelayMs,
  timeoutMs: config.shutdownTimeoutMs,
});

// Un error no controlado deja el proceso en estado desconocido: se registra y se termina
// para que el orquestador (Kubernetes/Render) lo reinicie limpio.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    logger.error(event, { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
