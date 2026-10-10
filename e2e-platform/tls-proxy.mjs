/**
 * E3c · terminador TLS de test (solo e2e-platform; sin dependencias).
 *
 * Un único puerto HTTPS atiende varios hosts y reenvía por `Host` a cada app
 * local por HTTP: así el navegador ve hosts distintos (web/control/api.trust.test)
 * con TLS real, que es lo que exige la cookie `__Host-` (ADR-063). El
 * certificado autofirmado lo genera `global-setup` con openssl y no se versiona.
 */
import http from 'node:http';
import https from 'node:https';

export function hostOf(header) {
  if (typeof header !== 'string') return null;
  const h = header.trim().toLowerCase();
  if (h.startsWith('[')) return null; // sin IPv6 literal: solo nombres
  return h.split(':')[0] || null;
}

/** `routes`: { 'web.trust.test': 3002, … } → puerto HTTP local. */
export function startTlsProxy({ cert, key, port, routes, host = '127.0.0.1' }) {
  const server = https.createServer({ cert, key }, (req, res) => {
    const destino = routes[hostOf(req.headers.host)];
    if (!destino) {
      res.writeHead(421, { 'content-type': 'text/plain' });
      res.end('host desconocido');
      return;
    }
    const upstream = http.request(
      { host: '127.0.0.1', port: destino, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https' } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('upstream caído');
    });
    req.pipe(upstream);
  });
  return new Promise((ok, mal) => {
    server.once('error', mal);
    server.listen(port, host, () => ok(server));
  });
}
