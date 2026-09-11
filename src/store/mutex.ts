/**
 * One thing at a time.
 *
 * Every read and write in the store is synchronous today, so two requests
 * cannot interleave inside a transaction — Node runs each handler to its first
 * `await` without interruption. That holds only as long as nothing in a write
 * path awaits, and nothing enforces it. A route that must not interleave with
 * another takes the mutex, so the day a write path gains an `await` the store
 * is still touched by one request at a time rather than by two at once.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  /** Run `work` once everything queued before it has finished. */
  run<T>(work: () => T | Promise<T>): Promise<T> {
    const mine = this.tail.then(work);
    // The queue carries on whatever happened to this job, so a failure does
    // not stop every job after it.
    this.tail = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  }
}
