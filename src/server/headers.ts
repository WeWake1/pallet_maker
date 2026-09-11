import type { NextFunction, Request, Response } from 'express';

/**
 * What every response says about how it may be used.
 *
 * The editor loads nothing from anywhere else — its script and stylesheet are
 * served from this same origin, the sheet's font travels inside the document as
 * a data URI and so do the drawings — so the content-security policy can be
 * strict, and the strictness costs nothing.
 *
 * The policy goes only on HTML. A PDF is shown by the browser's own viewer, an
 * SVG and a DXF are downloads, and JSON is data: none of them runs anything, and
 * a policy on a PDF has been known to stop a viewer from showing it at all.
 *
 * `'unsafe-inline'` for styles and `data:` for fonts and images are what the
 * sheet needs: the editor opens it in a fresh tab with `document.write`, and a
 * page written that way inherits the policy of the page that wrote it.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (wantsHtml(req)) res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  next();
}

/**
 * The editor's pages and the printable sheet. Everything under `/api/` is data
 * or a download, except the sheet as HTML, which a browser renders.
 */
function wantsHtml(req: Request): boolean {
  if (req.path.endsWith('/sheet.html')) return true;
  return !req.path.startsWith('/api/') && req.path !== '/healthz';
}
