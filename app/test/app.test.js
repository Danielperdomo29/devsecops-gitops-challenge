import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { getBuildInfo } from '../src/buildInfo.js';
import { createLogger } from '../src/logger.js';
import { Metrics } from '../src/metrics.js';
import { SECURITY_HEADERS } from '../src/security.js';
import { createServer } from '../src/server.js';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('API HTTP', () => {
  const logs = [];
  const state = { shuttingDown: false };
  let server;
  let base;

  before(async () => {
    const buildInfo = getBuildInfo({
      GIT_SHA: SHA,
      APP_ENV: 'test',
      IMAGE_REF: `ghcr.io/danielperdomo29/devsecops-api:${SHA}`,
      BUILD_RUN_URL: 'https://github.com/Danielperdomo29/devsecops-gitops-challenge/actions/runs/1',
    });
    const logger = createLogger({ stream: { write: (line) => logs.push(JSON.parse(line)) } });
    server = createServer(createApp({ buildInfo, logger, metrics: new Metrics(buildInfo), state }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('GET / devuelve HTML con trazabilidad del commit', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.ok(html.includes(SHA.slice(0, 7)));
    assert.ok(html.includes(`/commit/${SHA}`));
    assert.ok(html.includes('/actions/runs/1'));
  });

  it('aplica todas las cabeceras de seguridad', async () => {
    const res = await fetch(`${base}/`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      assert.equal(res.headers.get(name), value, `cabecera ${name}`);
    }
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('sirve la hoja de estilos como text/css', async () => {
    const res = await fetch(`${base}/static/app.css`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/css/);
    assert.ok((await res.text()).includes(':root'));
  });

  it('GET /healthz responde ok', async () => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });

  it('GET /readyz refleja el estado de apagado', async () => {
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
    state.shuttingDown = true;
    const res = await fetch(`${base}/readyz`);
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { status: 'shutting_down' });
    state.shuttingDown = false;
  });

  it('GET /version expone el commit y la imagen', async () => {
    const body = await (await fetch(`${base}/version`)).json();
    assert.equal(body.commit, SHA);
    assert.equal(body.environment, 'test');
    assert.match(body.image, /:a1b2c3d/);
  });

  it('GET /metrics expone métricas Prometheus', async () => {
    await fetch(`${base}/healthz`);
    const res = await fetch(`${base}/metrics`);
    assert.match(res.headers.get('content-type'), /text\/plain; version=0\.0\.4/);
    const text = await res.text();
    assert.match(text, /app_build_info\{version="1\.0\.0",commit="a1b2c3d4/);
    assert.match(text, /http_requests_total\{method="GET",route="\/healthz",status="200"\} \d+/);
    assert.match(text, /http_request_duration_seconds_bucket\{route="\/healthz",le="\+Inf"\}/);
  });

  it('rutas desconocidas -> 404 sin filtrar la ruta en métricas', async () => {
    const res = await fetch(`${base}/no-existe-${Date.now()}`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'not_found' });
    const metrics = await (await fetch(`${base}/metrics`)).text();
    assert.ok(metrics.includes('route="unmatched"'));
    assert.ok(!metrics.includes('no-existe'));
  });

  it('métodos no permitidos -> 405 con cabecera Allow', async () => {
    const res = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    assert.equal(res.status, 405);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  });

  it('HEAD no devuelve cuerpo pero conserva Content-Length', async () => {
    const res = await fetch(`${base}/healthz`, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '');
    assert.ok(Number(res.headers.get('content-length')) > 0);
  });

  it('propaga X-Request-Id válido y descarta uno malicioso', async () => {
    const ok = await fetch(`${base}/healthz`, { headers: { 'x-request-id': 'abc-12345678' } });
    assert.equal(ok.headers.get('x-request-id'), 'abc-12345678');
    const bad = await fetch(`${base}/healthz`, {
      headers: { 'x-request-id': 'x"}\\u000a{"level":"error' },
    });
    assert.match(bad.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  });

  it('registra en JSON las peticiones de negocio pero no las probes', async () => {
    logs.length = 0;
    await fetch(`${base}/healthz`);
    await fetch(`${base}/version`);
    await new Promise((resolve) => setImmediate(resolve));
    const routes = logs.map((entry) => entry.route);
    assert.ok(routes.includes('/version'));
    assert.ok(!routes.includes('/healthz'));
  });
});
