import { AsyncLocalStorage } from 'node:async_hooks';
import type { BrandInUse } from '../brand/resolve.js';
import type { RatesInUse } from '../costing/resolve.js';
import type { StoreHandle } from '../store/handle.js';
import type { Mutex } from '../store/mutex.js';
import type { Tenant } from './registry.js';

/**
 * Which company the request being answered belongs to.
 *
 * Every route in this program reads or writes "the designs", and for years
 * that meant one folder on one laptop. On a server it means whichever folder
 * belongs to whoever signed in, and that is not something a route should have
 * to remember to ask about: a route that forgot would quietly serve one
 * company another company's drawings.
 *
 * So it is not passed. The middleware that works out who is asking puts the
 * answer here for the duration of the request, and the one function every
 * repository already calls to find its folder reads it back. Nothing else in
 * the program changes, and there is no way to reach a folder without having
 * gone through the middleware — asking outside a request throws rather than
 * guessing.
 */

export interface TenantContext {
  tenant: Tenant;
  /** The folder this company's designs are in. */
  handle: StoreHandle;
  /** Their prices: the ones in their folder, or the ones this build ships. */
  rates: () => RatesInUse;
  /** Their name, mark and house conventions, resolved the same way. */
  brand: () => BrandInUse;
  /** Held by anything that rewrites many designs at once. */
  lock: Mutex;
}

/**
 * Nobody said which company, so nothing is served.
 *
 * Loud on purpose. Every other failure in this program has a sensible thing to
 * do instead; this one does not, because every sensible-looking thing to do is
 * to pick a company, and picking the wrong one is the worst thing the program
 * could do.
 */
export class NoTenantContextError extends Error {
  constructor() {
    super('No company is in context: a request reached the designs without going through the door');
    this.name = 'NoTenantContextError';
  }
}

const storage = new AsyncLocalStorage<TenantContext>();

/** Answer this request as this company. */
export function runInTenant<T>(context: TenantContext, work: () => T): T {
  return storage.run(context, work);
}

/** Whose designs are being asked for. Throws rather than guessing. */
export function currentTenant(): TenantContext {
  const context = storage.getStore();
  if (!context) throw new NoTenantContextError();
  return context;
}

/** Whether there is one, for the few places that may ask without needing one. */
export function tenantIfAny(): TenantContext | undefined {
  return storage.getStore();
}
