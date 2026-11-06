import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { detectPlatform, getBuildInfo } from '../src/buildInfo.js';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { Metrics } from '../src/metrics.js';
import { escapeHtml, sanitizeRequestId } from '../src/security.js';
import { registerGracefulShutdown } from '../src/server.js';
import { renderHome } from '../src/views.js';

describe('config', () => {
  it('usa valores por defecto seguros', () => {
    const cfg = loadConfig({});
    assert.equal(cfg.port, 8080);
    assert.equal(cfg.logLevel, 'info');
    assert.equal(cfg.appEnv, 'local');
    assert.equal(cfg.shutdownDelayMs, 0);
    assert.ok(Object.isFrozen(cfg));
  });

  it('lee el entorno y valida rangos', () => {
    const cfg = loadConfig({ PORT: '10000', LOG_LEVEL: 'debug', SHUTDOWN_DELAY_MS: '5000' });
    assert.equal(cfg.port, 10000);
    assert.equal(cfg.logLevel, 'debug');
    assert.equal(cfg.shutdownDelayMs, 5000);
  });

  it('falla rápido ante valores inválidos', () => {
    assert.throws(() => loadConfig({ PORT: '99999' }), /PORT inválida/);
    assert.throws(() => loadConfig({ PORT: 'abc' }), /PORT inválida/);
    assert.throws(() => loadConfig({ SHUTDOWN_TIMEOUT_MS: '10' }), /SHUTDOWN_TIMEOUT_MS/);
  });

  it('ignora niveles de log desconocidos', () => {
    assert.equal(loadConfig({ LOG_LEVEL: 'trace' }).logLevel, 'info');
  });
});

describe('buildInfo', () => {
  it('acepta solo SHAs hexadecimales válidos', () => {
    assert.equal(getBuildInfo({ GIT_SHA: 'abcdef1' }).shortCommit, 'abcdef1');
    assert.equal(getBuildInfo({ GIT_SHA: '<script>' }).commit, 'unknown');
    assert.equal(getBuildInfo({}).shortCommit, 'unknown');
  });

  it('usa RENDER_GIT_COMMIT cuando la imagen se construye en Render', () => {
    const info = getBuildInfo({ RENDER: 'true', RENDER_GIT_COMMIT: '0123456789abcdef' });
    assert.equal(info.commit, '0123456789abcdef');
    assert.equal(info.platform, 'render');
  });

  it('ignora el GIT_SHA=unknown del Dockerfile y usa el SHA válido de Render (regresión)', () => {
    const info = getBuildInfo({ GIT_SHA: 'unknown', RENDER_GIT_COMMIT: 'ba82a08aabbccdd' });
    assert.equal(info.commit, 'ba82a08aabbccdd');
  });

  it('descarta URLs de pipeline que no son de GitHub Actions', () => {
    assert.equal(
      getBuildInfo({ BUILD_RUN_URL: 'https://evil.example/actions/runs/1' }).runUrl,
      null,
    );
    assert.equal(getBuildInfo({ BUILD_RUN_URL: 'javascript:alert(1)' }).runUrl, null);
  });

  it('detecta la plataforma de ejecución', () => {
    assert.equal(detectPlatform({ KUBERNETES_SERVICE_HOST: '10.0.0.1' }), 'kubernetes');
    assert.equal(
      detectPlatform({ ECS_CONTAINER_METADATA_URI_V4: 'http://169.254.170.2/v4/x' }),
      'aws-ecs-fargate',
    );
    assert.equal(detectPlatform({}), 'container');
  });
});

describe('security', () => {
  it('escapa HTML', () => {
    assert.equal(
      escapeHtml(`<a href="x">'&'</a>`),
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('valida X-Request-Id', () => {
    assert.equal(sanitizeRequestId('req-12345678'), 'req-12345678');
    assert.equal(sanitizeRequestId('short'), null);
    assert.equal(sanitizeRequestId(undefined), null);
  });
});

describe('views', () => {
  it('no enlaza commit ni pipeline cuando son desconocidos', () => {
    const html = renderHome(getBuildInfo({}));
    assert.ok(html.includes('<code>unknown</code>'));
    assert.ok(!html.includes('/commit/'));
  });

  it('sin URL de pipeline enlaza a los checks de GitHub del commit (Render)', () => {
    const html = renderHome(getBuildInfo({ RENDER: 'true', RENDER_GIT_COMMIT: 'abcdef1234567' }));
    assert.ok(html.includes('/commit/abcdef1234567/checks'));
  });
});

describe('logger', () => {
  it('filtra por nivel y emite JSON', () => {
    const lines = [];
    const log = createLogger({
      level: 'warn',
      stream: { write: (l) => lines.push(l) },
      base: { a: 1 },
    });
    log.debug('d');
    log.info('i');
    log.warn('w', { b: 2 });
    log.error('e');
    assert.equal(lines.length, 2);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, 'warn');
    assert.equal(entry.a, 1);
    assert.equal(entry.b, 2);
  });

  it('usa info si el nivel es inválido', () => {
    const lines = [];
    const log = createLogger({ level: 'nope', stream: { write: (l) => lines.push(l) } });
    log.debug('d');
    log.info('i');
    assert.equal(lines.length, 1);
  });
});

describe('metrics', () => {
  it('escapa etiquetas y acumula histogramas', () => {
    const m = new Metrics({ version: '1"0', commit: 'abc', environment: 'x\\y' });
    m.observe('GET', '/', 200, 0.003);
    m.observe('GET', '/', 200, 3);
    const out = m.render();
    assert.ok(out.includes('version="1\\"0"'));
    assert.ok(out.includes('environment="x\\\\y"'));
    assert.ok(out.includes('http_requests_total{method="GET",route="/",status="200"} 2'));
    assert.ok(out.includes('http_request_duration_seconds_bucket{route="/",le="0.005"} 1'));
    assert.ok(out.includes('http_request_duration_seconds_count{route="/"} 2'));
  });
});

describe('graceful shutdown', () => {
  const silent = { info() {}, error() {} };

  it('marca no-ready, cierra el servidor y sale con 0', async () => {
    const proc = new EventEmitter();
    const state = { shuttingDown: false };
    let closed = false;
    const server = {
      close: (cb) => {
        closed = true;
        cb();
      },
      closeIdleConnections() {},
    };
    const code = await new Promise((resolve) => {
      registerGracefulShutdown({ server, state, logger: silent, proc, exit: resolve, delayMs: 5 });
      proc.emit('SIGTERM');
      proc.emit('SIGTERM'); // idempotente
      assert.equal(state.shuttingDown, true);
    });
    assert.equal(code, 0);
    assert.ok(closed);
  });

  it('sale con 1 si el cierre falla', async () => {
    const proc = new EventEmitter();
    const server = { close: (cb) => cb(new Error('boom')) };
    const code = await new Promise((resolve) => {
      registerGracefulShutdown({ server, state: {}, logger: silent, proc, exit: resolve });
      proc.emit('SIGINT');
    });
    assert.equal(code, 1);
  });

  it('fuerza la salida con 1 si el cierre excede el timeout', async () => {
    const proc = new EventEmitter();
    const server = { close() {} }; // nunca invoca el callback
    const code = await new Promise((resolve) => {
      registerGracefulShutdown({
        server,
        state: {},
        logger: silent,
        proc,
        exit: resolve,
        timeoutMs: 20,
      });
      proc.emit('SIGTERM');
    });
    assert.equal(code, 1);
  });
});
