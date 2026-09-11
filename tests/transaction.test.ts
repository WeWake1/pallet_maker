import { afterEach, describe, expect, it } from 'vitest';
import { cleanupStores, loadFixture, tempStore } from './helpers.js';

afterEach(cleanupStores);

/**
 * A transaction is all or nothing, and it has to stay that way when a step
 * inside it is itself a transaction, and when somebody makes it asynchronous
 * by mistake.
 */
describe('a transaction', () => {
  it('writes nothing when a step inside it fails, and says so', () => {
    const store = tempStore();
    const base = loadFixture('block-1000x800');
    expect(() =>
      store.transaction(() => {
        store.writeDesign({ ...base, id: 'first' });
        try {
          store.transaction(() => {
            store.writeDesign({ ...base, id: 'second' });
            throw new Error('the second is bad');
          });
        } catch {
          // Caught and carried on, the way an import that logs and continues might.
        }
      }),
    ).toThrow(/none of it was written/);
    expect(store.readDesign('first')).toBeUndefined();
    expect(store.readDesign('second')).toBeUndefined();
  });

  it('writes everything when every step succeeds', () => {
    const store = tempStore();
    const base = loadFixture('block-1000x800');
    store.transaction(() => {
      store.writeDesign({ ...base, id: 'first' });
      store.transaction(() => {
        store.writeDesign({ ...base, id: 'second' });
      });
      // Inside, the staged writes are already visible.
      expect(store.readDesign('second')?.id).toBe('second');
    });
    expect(store.readDesign('first')?.id).toBe('first');
    expect(store.readDesign('second')?.id).toBe('second');
  });

  it('refuses to be asynchronous', () => {
    const store = tempStore();
    expect(() => store.transaction(async () => undefined)).toThrow(/synchronous/);
  });
});
