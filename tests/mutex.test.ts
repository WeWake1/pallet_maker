import { describe, expect, it } from 'vitest';
import { Mutex } from '../src/store/mutex.js';

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

describe('the mutex', () => {
  it('runs one thing at a time, in the order asked', async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    const slow = mutex.run(async () => {
      order.push('slow starts');
      await sleep(20);
      order.push('slow ends');
      return 1;
    });
    const quick = mutex.run(() => {
      order.push('quick');
      return 2;
    });
    expect(await Promise.all([slow, quick])).toEqual([1, 2]);
    expect(order).toEqual(['slow starts', 'slow ends', 'quick']);
  });

  it('carries on after a failure', async () => {
    const mutex = new Mutex();
    await expect(
      mutex.run(() => {
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    expect(await mutex.run(() => 'yes')).toBe('yes');
  });
});
