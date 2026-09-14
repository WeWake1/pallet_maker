import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * One line per request, once it has been answered.
 *
 * Enough to place a bug report — which route, what it answered, how long it
 * took, and the id the person was shown — and never the body, which is the
 * design itself and nobody else's business. Where the line goes is up to the
 * caller: the server writes JSON to stdout for journald to keep, and the tests
 * pass nothing and stay quiet.
 */
export interface RequestLog {
  at: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  /** The address the proxy said the request came from, when it said. */
  ip: string | undefined;
}

export type Logger = (entry: RequestLog) => void;

/** The id given to a request, for the error handler and the log to agree on. */
export function requestId(req: Request): string {
  const held = (req as Request & { palletRequestId?: string }).palletRequestId;
  if (held) return held;
  const id = randomUUID();
  (req as Request & { palletRequestId?: string }).palletRequestId = id;
  return id;
}

export function requestLogger(log: Logger | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = requestId(req);
    res.setHeader('X-Request-Id', id);
    if (!log) {
      next();
      return;
    }
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      log({
        at: new Date().toISOString(),
        requestId: id,
        method: req.method,
        // As asked for, not as a mounted router left it: `req.path` inside
        // `/api/vendor` has had `/api/vendor` taken off, and a log that said
        // `/companies` would send whoever reads it looking for a route that
        // does not exist. The query string is left off; it is not the route.
        path: req.originalUrl.split('?')[0] ?? req.path,
        status: res.statusCode,
        ms: Number(process.hrtime.bigint() - started) / 1e6,
        ip: req.ip,
      });
    });
    next();
  };
}

/** A logger that writes one JSON object per line, for journald or a file. */
export function jsonLogger(out: { write(line: string): unknown } = process.stdout): Logger {
  return (entry) => {
    out.write(`${JSON.stringify({ ...entry, ms: Math.round(entry.ms * 10) / 10 })}\n`);
  };
}
