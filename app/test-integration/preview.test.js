// Pruebas de integración contra un entorno DESPLEGADO (efímero en AWS o contenedor local).
// Variables: BASE_URL (obligatoria), EXPECTED_SHA y EXPECTED_PLATFORM (opcionales).
// Sin BASE_URL se omiten, para que nunca fallen por accidente en una máquina de desarrollo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const BASE_URL = process.env.BASE_URL;
const EXPECTED_SHA = process.env.EXPECTED_SHA;
const EXPECTED_PLATFORM = process.env.EXPECTED_PLATFORM;

async function get(path, init) {
  // Reintentos breves: la red de un entorno recién creado puede tardar en estabilizarse.
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fetch(`${BASE_URL}${path}`, { ...init, signal: AbortSignal.timeout(5000) });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

describe(`entorno desplegado: ${BASE_URL ?? '(BASE_URL no definida)'}`, { skip: !BASE_URL }, () => {
  it('liveness y readiness responden 200', async () => {
    assert.equal((await get('/healthz')).status, 200);
    assert.equal((await get('/readyz')).status, 200);
  });

  it('sirve EXACTAMENTE el commit del PR (trazabilidad commit -> imagen -> entorno)', async () => {
    const info = await (await get('/version')).json();
    if (EXPECTED_SHA) assert.equal(info.commit, EXPECTED_SHA);
    if (EXPECTED_PLATFORM) assert.equal(info.platform, EXPECTED_PLATFORM);
    assert.equal(info.environment, 'preview');
  });

  it('aplica las cabeceras de seguridad en el entorno real', async () => {
    const res = await get('/');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('rechaza métodos y rutas no permitidos', async () => {
    assert.equal((await get('/', { method: 'POST', body: 'x' })).status, 405);
    assert.equal((await get('/no-existe')).status, 404);
  });

  it('expone métricas de Prometheus con la versión desplegada', async () => {
    const text = await (await get('/metrics')).text();
    assert.match(text, /app_build_info\{/);
    if (EXPECTED_SHA) assert.ok(text.includes(EXPECTED_SHA));
  });

  it('latencia p95 < 800 ms en 20 peticiones (smoke de rendimiento)', async () => {
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      await (await get('/healthz')).arrayBuffer();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
    assert.ok(p95 < 800, `p95 = ${p95.toFixed(1)} ms`);
  });
});
