// Cabeceras de seguridad aplicadas a TODAS las respuestas (OWASP Secure Headers Project).
// Se validan en CI con OWASP ZAP (DAST) contra el contenedor real.

export const SECURITY_HEADERS = Object.freeze({
  // Sin JavaScript, sin recursos de terceros: la CSP más restrictiva posible.
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Cache-Control': 'no-store',
});

const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

// Solo se propaga un X-Request-Id entrante si cumple el formato: evita log injection.
export function sanitizeRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_RE.test(value) ? value : null;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
