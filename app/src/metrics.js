// Métricas en formato de exposición de Prometheus (text/plain; version=0.0.4).
// Cardinalidad acotada: la etiqueta "route" solo toma rutas conocidas o "unmatched",
// evitando la explosión de series que provocaría etiquetar con la URL cruda.

const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

const escapeLabel = (value) =>
  String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');

const labels = (obj) =>
  `{${Object.entries(obj)
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(',')}}`;

export class Metrics {
  #requests = new Map();
  #durations = new Map();
  #startedAt = Date.now();
  #buildInfo;

  constructor(buildInfo) {
    this.#buildInfo = buildInfo;
  }

  observe(method, route, status, seconds) {
    const reqKey = JSON.stringify([method, route, String(status)]);
    this.#requests.set(reqKey, (this.#requests.get(reqKey) ?? 0) + 1);

    let hist = this.#durations.get(route);
    if (!hist) {
      hist = { buckets: new Array(BUCKETS.length).fill(0), sum: 0, count: 0 };
      this.#durations.set(route, hist);
    }
    BUCKETS.forEach((le, i) => {
      if (seconds <= le) hist.buckets[i] += 1;
    });
    hist.sum += seconds;
    hist.count += 1;
  }

  render() {
    const out = [];
    const { version, commit, environment } = this.#buildInfo;

    out.push('# HELP app_build_info Información de build (siempre 1).');
    out.push('# TYPE app_build_info gauge');
    out.push(`app_build_info${labels({ version, commit, environment })} 1`);

    out.push('# HELP process_uptime_seconds Segundos desde que arrancó el proceso.');
    out.push('# TYPE process_uptime_seconds gauge');
    out.push(`process_uptime_seconds ${((Date.now() - this.#startedAt) / 1000).toFixed(3)}`);

    out.push('# HELP nodejs_heap_used_bytes Heap de V8 en uso.');
    out.push('# TYPE nodejs_heap_used_bytes gauge');
    out.push(`nodejs_heap_used_bytes ${process.memoryUsage().heapUsed}`);

    out.push('# HELP http_requests_total Total de peticiones HTTP atendidas.');
    out.push('# TYPE http_requests_total counter');
    for (const [key, value] of this.#requests) {
      const [method, route, status] = JSON.parse(key);
      out.push(`http_requests_total${labels({ method, route, status })} ${value}`);
    }

    out.push('# HELP http_request_duration_seconds Latencia de peticiones HTTP.');
    out.push('# TYPE http_request_duration_seconds histogram');
    for (const [route, hist] of this.#durations) {
      BUCKETS.forEach((le, i) => {
        out.push(`http_request_duration_seconds_bucket${labels({ route, le })} ${hist.buckets[i]}`);
      });
      out.push(
        `http_request_duration_seconds_bucket${labels({ route, le: '+Inf' })} ${hist.count}`,
      );
      out.push(`http_request_duration_seconds_sum${labels({ route })} ${hist.sum.toFixed(6)}`);
      out.push(`http_request_duration_seconds_count${labels({ route })} ${hist.count}`);
    }

    return `${out.join('\n')}\n`;
  }
}
