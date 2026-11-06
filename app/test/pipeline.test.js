import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { getBuildInfo } from '../src/buildInfo.js';
import { loadConfig } from '../src/config.js';
import { aggregate, createGithubFeed, stageOf } from '../src/githubFeed.js';
import { Metrics } from '../src/metrics.js';
import { renderPipeline, STAGES } from '../src/pipelineView.js';
import { createServer } from '../src/server.js';

const REPO = 'Danielperdomo29/devsecops-gitops-challenge';
const SHA = 'a'.repeat(40);

const run = (over = {}) => ({
  id: 1,
  display_title: 'feat: <b>demo</b>',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'success',
  html_url: `https://github.com/${REPO}/actions/runs/1`,
  created_at: '2026-11-06T10:00:00Z',
  run_started_at: '2026-11-06T10:00:00Z',
  updated_at: '2026-11-06T10:12:30Z',
  pull_requests: [{ number: 7 }],
  ...over,
});

const job = (name, conclusion = 'success', status = 'completed') => ({ name, status, conclusion });

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    const value = routes[key];
    if (value instanceof Error) throw value;
    return { ok: true, status: 200, json: async () => value };
  };
  return { impl, calls };
}

describe('githubFeed: utilidades', () => {
  it('stageOf extrae el número de etapa del nombre del job', () => {
    assert.equal(stageOf('1 · Security gates / SAST (Semgrep)'), 1);
    assert.equal(stageOf('8 · Terraform destroy'), 8);
    assert.equal(stageOf('Build, escaneo y publicación'), null);
  });

  it('aggregate resume el estado de varios jobs', () => {
    assert.equal(aggregate([]), 'pending');
    assert.equal(aggregate([job('a'), job('b', null, 'in_progress')]), 'running');
    assert.equal(aggregate([job('a'), job('b', 'failure')]), 'fail');
    assert.equal(aggregate([job('a', 'skipped'), job('b', 'skipped')]), 'skip');
    assert.equal(aggregate([job('a'), job('b', 'skipped')]), 'ok');
  });
});

describe('githubFeed: carga, caché y degradación', () => {
  it('mapea ejecuciones de PR a las 9 etapas y de main a sus pasos', async () => {
    const { impl } = fakeFetch({
      'workflows/preview.yaml/runs': { workflow_runs: [run()] },
      'workflows/deploy.yaml/runs': { workflow_runs: [run({ id: 2, pull_requests: [] })] },
      'runs/1/jobs': {
        jobs: [
          job('1 · Security gates / SonarQube (quality gate)'),
          job('2 · Build y escaneo de la imagen'),
          job('4 · Terraform apply (AWS efímero)', 'failure'),
          job('8 · Terraform destroy (merge o cierre)', 'skipped'),
        ],
      },
      'runs/2/jobs': { jobs: [job('Security gates / Lint y pruebas'), job('Render - desplegar')] },
    });
    const feed = createGithubFeed({ repository: REPO, fetchImpl: impl, now: () => 1_000 });
    const snap = await feed.snapshot();
    const pr = snap.preview[0];
    assert.equal(pr.pr, 7);
    assert.equal(pr.kind, 'apertura');
    assert.deepEqual(pr.stages.slice(0, 4), ['ok', 'ok', 'pending', 'fail']);
    assert.equal(pr.durationSec, 750);
    assert.equal(snap.deploy[0].steps.find((s) => s.label === 'Render').state, 'ok');
    assert.equal(snap.stale, false);
  });

  it('detecta una ejecución de cierre aunque el destroy se omita (sin AWS)', async () => {
    const { impl } = fakeFetch({
      'workflows/preview.yaml/runs': { workflow_runs: [run({ id: 9 })] },
      'workflows/deploy.yaml/runs': { workflow_runs: [] },
      'runs/9/jobs': {
        jobs: [
          job('8 · Terraform destroy (merge o cierre)', 'skipped'),
          job('9 · Limpieza de imágenes del PR'),
        ],
      },
    });
    const snap = await createGithubFeed({ repository: REPO, fetchImpl: impl }).snapshot();
    assert.equal(snap.preview[0].kind, 'cierre');
  });

  it('usa la caché dentro del TTL y no repite jobs de ejecuciones terminadas', async () => {
    let t = 0;
    const { impl, calls } = fakeFetch({
      'workflows/preview.yaml/runs': { workflow_runs: [run()] },
      'workflows/deploy.yaml/runs': { workflow_runs: [] },
      'runs/1/jobs': { jobs: [job('1 · Security gates / x')] },
    });
    const feed = createGithubFeed({ repository: REPO, fetchImpl: impl, now: () => t, ttlMs: 100 });
    await feed.snapshot();
    const first = calls.length;
    t = 50;
    await feed.snapshot();
    assert.equal(calls.length, first, 'dentro del TTL no se llama a la API');
    t = 500;
    await feed.snapshot();
    assert.equal(calls.filter((c) => c.includes('runs/1/jobs')).length, 1);
  });

  it('ante un error sirve el último dato bueno marcado como stale', async () => {
    let fail = false;
    const impl = async (url) => {
      if (fail) throw new Error('rate limit');
      if (url.includes('preview.yaml'))
        return { ok: true, json: async () => ({ workflow_runs: [] }) };
      return { ok: true, json: async () => ({ workflow_runs: [] }) };
    };
    let t = 0;
    const feed = createGithubFeed({ repository: REPO, fetchImpl: impl, now: () => t, ttlMs: 10 });
    await feed.snapshot();
    fail = true;
    t = 100;
    const snap = await feed.snapshot();
    assert.equal(snap.stale, true);
    assert.equal(snap.error, 'rate limit');
  });

  it('un workflow inexistente (404) no oculta los datos de los demás', async () => {
    const { impl } = fakeFetch({
      'workflows/deploy.yaml/runs': { workflow_runs: [run({ id: 3 })] },
      'runs/3/jobs': { jobs: [job('Build, escaneo y publicación')] },
    });
    const snap = await createGithubFeed({ repository: REPO, fetchImpl: impl }).snapshot();
    assert.equal(snap.stale, false);
    assert.deepEqual(snap.preview, []);
    assert.equal(snap.deploy.length, 1);
  });

  it('sin datos previos devuelve un snapshot vacío con el error', async () => {
    const impl = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const snap = await createGithubFeed({ repository: REPO, fetchImpl: impl }).snapshot();
    assert.equal(snap.stale, true);
    assert.match(snap.error, /403/);
    assert.deepEqual(snap.preview, []);
  });

  it('descarta URLs ajenas al repositorio y SHAs inválidos; envía el token si existe', async () => {
    let auth;
    const impl = async (url, init) => {
      auth = init.headers.Authorization;
      if (url.includes('preview.yaml')) {
        return {
          ok: true,
          json: async () => ({
            workflow_runs: [
              run({ html_url: 'https://evil.example/x', head_sha: 'zzz', status: 'in_progress' }),
            ],
          }),
        };
      }
      if (url.includes('/jobs')) return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    };
    const feed = createGithubFeed({ repository: REPO, token: 't0k3n', fetchImpl: impl });
    const snap = await feed.snapshot();
    assert.equal(snap.preview[0].url, null);
    assert.equal(snap.preview[0].sha, '');
    assert.equal(auth, 'Bearer t0k3n');
  });
});

describe('pipelineView', () => {
  const info = getBuildInfo({});

  it('describe las 9 etapas del ciclo de vida del PR', () => {
    assert.equal(STAGES.length, 9);
    const html = renderPipeline(info, { feedEnabled: false, snapshot: null });
    for (const stage of STAGES) assert.ok(html.includes(stage.title.replace('→', '→')));
    assert.ok(html.includes('NetworkPolicy'));
    assert.ok(!html.includes('http-equiv="refresh"'));
  });

  it('renderiza datos en vivo escapando HTML y con auto-refresco', () => {
    const snapshot = {
      fetchedAt: 0,
      stale: false,
      preview: [
        {
          pr: 7,
          title: '<script>x</script>',
          sha: SHA,
          kind: 'cierre',
          status: 'completed',
          conclusion: 'failure',
          url: null,
          durationSec: 95,
          stages: ['ok', 'fail', 'running', 'skip', 'pending', 'ok', 'ok', 'ok', 'ok'],
        },
      ],
      deploy: [
        {
          sha: SHA,
          title: 'fix',
          status: 'in_progress',
          url: `https://github.com/${REPO}/actions/runs/2`,
          durationSec: 30,
          steps: [{ label: 'Gates', state: 'ok' }],
        },
      ],
    };
    const html = renderPipeline(info, { feedEnabled: true, snapshot, nowMs: 5_000 });
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(!html.includes('<script>x'));
    assert.ok(html.includes('PR #7'));
    assert.ok(html.includes('1 min 35 s'));
    assert.ok(html.includes('hace 5 s'));
    assert.ok(html.includes('http-equiv="refresh"'));
  });

  it('muestra aviso cuando GitHub no responde y listas vacías', () => {
    const html = renderPipeline(info, {
      feedEnabled: true,
      snapshot: {
        fetchedAt: null,
        stale: true,
        error: 'GitHub API respondió 403',
        preview: [],
        deploy: [],
      },
    });
    assert.ok(html.includes('GitHub no respondió'));
    assert.ok(html.includes('Sin datos todavía'));
    assert.ok(html.includes('Aún no hay ejecuciones'));
  });
});

describe('config del feed', () => {
  it('solo se activa explícitamente', () => {
    assert.equal(loadConfig({}).pipelineFeed, 'off');
    assert.equal(loadConfig({ PIPELINE_FEED: 'github' }).pipelineFeed, 'github');
  });
});

describe('ruta /pipeline', () => {
  let server;
  let base;
  const logs = [];
  const buildInfo = getBuildInfo({});
  const feed = { snapshot: async () => ({ preview: [], deploy: [], fetchedAt: 0, stale: false }) };
  const broken = { snapshot: async () => Promise.reject(new Error('boom')) };
  let current = feed;

  before(async () => {
    const logger = { info() {}, error: (msg, f) => logs.push({ msg, ...f }) };
    const proxyFeed = { snapshot: () => current.snapshot() };
    server = createServer(
      createApp({
        buildInfo,
        logger,
        metrics: new Metrics(buildInfo),
        state: { shuttingDown: false },
        pipelineFeed: proxyFeed,
      }),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('responde 200 con cabeceras de seguridad', async () => {
    const res = await fetch(`${base}/pipeline`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.ok((await res.text()).includes('Paso a paso'));
  });

  it('un error interno devuelve 500 sin filtrar detalles', async () => {
    current = broken;
    const res = await fetch(`${base}/pipeline`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'internal_error' });
    assert.ok(logs.some((l) => l.msg === 'handler_error' && l.error === 'boom'));
    current = feed;
  });
});
