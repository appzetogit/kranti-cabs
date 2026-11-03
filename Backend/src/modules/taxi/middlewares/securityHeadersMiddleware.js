/**
 * Browser security headers on everything the API serves. The website's own
 * files come from nginx, which sets the same headers (see the Kranti nginx
 * config).
 *
 * API responses are data, never pages, so their CSP allows nothing to load.
 * Uploads get framing rules only: a stricter policy can stop a browser's
 * built-in viewer opening an uploaded PDF.
 */
const API_CSP = "default-src 'none'; frame-ancestors 'self'; base-uri 'none'";
const UPLOADS_CSP = "frame-ancestors 'self'; base-uri 'none'";

export const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  res.setHeader('Content-Security-Policy', req.path.startsWith('/uploads') ? UPLOADS_CSP : API_CSP);
  next();
};
