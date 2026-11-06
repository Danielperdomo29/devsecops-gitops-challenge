// HEALTHCHECK de Docker. La imagen distroless no tiene shell ni curl, así que la sonda
// se implementa con el propio runtime de Node.
import http from 'node:http';

const req = http.get(
  { host: '127.0.0.1', port: process.env.PORT || 8080, path: '/healthz', timeout: 2000 },
  (res) => process.exit(res.statusCode === 200 ? 0 : 1),
);
req.on('timeout', () => req.destroy(new Error('timeout')));
req.on('error', () => process.exit(1));
