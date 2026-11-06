import { randomUUID } from 'node:crypto';
import { STYLESHEET } from './assets.js';
import { renderPipeline } from './pipelineView.js';
import { SECURITY_HEADERS, sanitizeRequestId } from './security.js';
import { renderHome } from './views.js';

// Rutas sin trazas en log (las consultan las probes cada pocos segundos).
const QUIET_ROUTES = new Set(['/healthz', '/readyz', '/metrics']);

function send(req, res, status, contentType, body) {
  const payload = Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': payload.length,
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

const json = (req, res, status, data) =>
  send(req, res, status, 'application/json; charset=utf-8', JSON.stringify(data));

export function createApp({ buildInfo, logger, metrics, state, pipelineFeed = null }) {
  const homePage = renderHome(buildInfo);

  const routes = new Map([
    ['/', (req, res) => send(req, res, 200, 'text/html; charset=utf-8', homePage)],
    [
      '/pipeline',
      async (req, res) => {
        const snapshot = pipelineFeed ? await pipelineFeed.snapshot() : null;
        const html = renderPipeline(buildInfo, { feedEnabled: Boolean(pipelineFeed), snapshot });
        send(req, res, 200, 'text/html; charset=utf-8', html);
      },
    ],
    ['/static/app.css', (req, res) => send(req, res, 200, 'text/css; charset=utf-8', STYLESHEET)],
    ['/healthz', (req, res) => json(req, res, 200, { status: 'ok' })],
    [
      '/readyz',
      (req, res) =>
        state.shuttingDown
          ? json(req, res, 503, { status: 'shutting_down' })
          : json(req, res, 200, { status: 'ready' }),
    ],
    ['/version', (req, res) => json(req, res, 200, buildInfo)],
    [
      '/metrics',
      (req, res) =>
        send(req, res, 200, 'text/plain; version=0.0.4; charset=utf-8', metrics.render()),
    ],
  ]);

  return function handler(req, res) {
    const startedAt = process.hrtime.bigint();
    const requestId = sanitizeRequestId(req.headers['x-request-id']) ?? randomUUID();

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    res.setHeader('X-Request-Id', requestId);

    let pathname = null;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      pathname = null;
    }
    const route = routes.has(pathname) ? pathname : 'unmatched';

    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      metrics.observe(req.method, route, res.statusCode, seconds);
      if (!QUIET_ROUTES.has(route)) {
        logger.info('http_request', {
          requestId,
          method: req.method,
          route,
          status: res.statusCode,
          durationMs: Math.round(seconds * 1000),
        });
      }
    });

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return json(req, res, 405, { error: 'method_not_allowed' });
    }

    const handle = routes.get(route);
    if (!handle) return json(req, res, 404, { error: 'not_found' });
    // Las rutas asíncronas nunca dejan una petición colgada: cualquier error -> 500 sin detalles.
    return Promise.resolve()
      .then(() => handle(req, res))
      .catch((error) => {
        logger.error('handler_error', { requestId, route, error: error.message });
        if (!res.headersSent) json(req, res, 500, { error: 'internal_error' });
      });
  };
}
