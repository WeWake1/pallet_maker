/**
 * How often the same thing may be tried.
 *
 * One use: signing in. A password nobody can guess is still guessable a few
 * million times a night, and the only thing that stops that is refusing to
 * answer. Counted two ways at once — by where the request came from and by
 * which account it is aimed at — because either alone is easy to step around:
 * one address trying a thousand accounts, or a thousand addresses trying one.
 *
 * Kept in memory, which is right for one process and worth knowing about: a
 * restart forgets it. Somebody who can restart the server has better things to
 * do than guess passwords.
 */

export interface LimitDecision {
  allowed: boolean;
  /** How long until one more attempt would be allowed, in seconds. */
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Whether this key may try again, counting this attempt if it may. */
  take(key: string): LimitDecision {
    const now = Date.now();
    const since = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((at) => at > since);

    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
      const oldest = recent[0] ?? now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)) };
    }

    recent.push(now);
    this.attempts.set(key, recent);
    // Keep the map from growing for ever on a busy server.
    if (this.attempts.size > 10_000) this.sweep(since);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Forget a key, which is what succeeding at what it was trying means. */
  forget(key: string): void {
    this.attempts.delete(key);
  }

  private sweep(since: number): void {
    for (const [key, times] of this.attempts) {
      const recent = times.filter((at) => at > since);
      if (recent.length === 0) this.attempts.delete(key);
      else this.attempts.set(key, recent);
    }
  }
}
