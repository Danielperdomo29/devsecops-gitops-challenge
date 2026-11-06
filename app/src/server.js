import http from 'node:http';

// Timeouts explícitos: mitigan Slowloris y conexiones colgadas (los defaults de Node son laxos).
export function createServer(handler) {
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, handler);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

// Apagado ordenado compatible con Kubernetes:
// 1) SIGTERM -> /readyz pasa a 503 (el Service deja de enrutar tráfico al pod).
// 2) Se espera shutdownDelayMs para que kube-proxy/Ingress propaguen el cambio.
// 3) Se cierran conexiones y se sale con 0. Si algo se cuelga, timeout -> exit(1).
export function registerGracefulShutdown({
  server,
  state,
  logger,
  delayMs = 0,
  timeoutMs = 10_000,
  signals = ['SIGTERM', 'SIGINT'],
  proc = process,
  exit = (code) => process.exit(code),
}) {
  const shutdown = (signal) => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    logger.info('shutdown_started', { signal, delayMs });

    const killTimer = setTimeout(() => {
      logger.error('shutdown_timeout', { timeoutMs });
      exit(1);
    }, delayMs + timeoutMs);
    killTimer.unref?.();

    setTimeout(() => {
      server.close((err) => {
        clearTimeout(killTimer);
        if (err) logger.error('shutdown_error', { error: err.message });
        else logger.info('shutdown_complete');
        exit(err ? 1 : 0);
      });
      server.closeIdleConnections?.();
    }, delayMs);
  };

  for (const signal of signals) proc.on(signal, shutdown);
  return shutdown;
}
