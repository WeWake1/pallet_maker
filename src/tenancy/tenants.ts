import { join, resolve } from 'node:path';
import { brandResolver } from '../brand/resolve.js';
import { DEFAULT_RATES_PATH } from '../costing/load.js';
import { ratesResolver } from '../costing/resolve.js';
import { StoreHandle } from '../store/handle.js';
import { Mutex } from '../store/mutex.js';
import { reconcileClients } from '../server/repository.js';
import type { TenantContext } from './context.js';
import type { Registry, Tenant } from './registry.js';

/**
 * Every company's designs, on one server.
 *
 * A company is a folder, and this is the map from who signed in to which
 * folder that is. Folders are opened when they are first wanted rather than at
 * startup, so a server with fifty companies on it starts as fast as one with a
 * single company, and each keeps its own caches — a company's prices and
 * branding are read off its own folder and remembered until its own files
 * change.
 *
 *   <data root>/tenants/<slug>/designs/<id>.json
 *                             /clients.json
 *                             /rates.json      optional, beats the shipped one
 *                             /brand.json      optional, beats the shipped one
 *                             /backups/
 *
 * The folder is named by the short name rather than by the id, because the
 * person who will one day restore it from a backup is reading a directory
 * listing, not a database. **A short name is therefore permanent**: renaming
 * one would leave its designs behind under the old one.
 */

export interface TenantsOptions {
  /** The rates this build ships with, for a company that has set none. */
  ratesPath?: string;
  /** The branding this build ships with, for a company that has set none. */
  brandPath?: string;
}

export class Tenants {
  private readonly open = new Map<string, TenantContext>();
  private readonly root: string;

  constructor(
    dataRoot: string,
    private readonly registry: Registry,
    private readonly options: TenantsOptions = {},
  ) {
    this.root = resolve(dataRoot, 'tenants');
  }

  /** Where a company's designs live. */
  folderFor(tenant: Tenant): string {
    return join(this.root, tenant.slug);
  }

  /**
   * The company's folder, opened if this is the first time it has been asked
   * for.
   *
   * The folder is made when it is not there. That is the opposite of what the
   * desktop app does, and right for the opposite reason: on a laptop a missing
   * folder means Drive has not started and inventing one would hide somebody's
   * designs, while here it means a company was created a moment ago and has
   * not saved anything yet.
   */
  context(tenant: Tenant): TenantContext {
    const held = this.open.get(tenant.id);
    if (held) {
      // The name or the time zone may have been changed since it was opened.
      held.tenant = tenant;
      return held;
    }

    const root = this.folderFor(tenant);
    const handle = new StoreHandle(root, { create: true, source: 'environment' });
    const context: TenantContext = {
      tenant,
      handle,
      rates: ratesResolver(
        () => (handle.ready() ? handle.status().root : null),
        this.options.ratesPath ?? DEFAULT_RATES_PATH,
      ),
      brand: brandResolver(() => (handle.ready() ? handle.status().root : null), this.options.brandPath),
      lock: new Mutex(),
    };

    // A design can arrive in a folder naming a client the folder does not hold
    // yet — through an import, or a copy from somewhere else. Folding those in
    // once, when the folder is first opened, settles the dashboard.
    if (handle.ready()) {
      try {
        reconcileClients(handle.require());
      } catch (error) {
        console.error(
          `Could not reconcile clients for ${tenant.slug}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.open.set(tenant.id, context);
    return context;
  }

  /** Let go of a company, so the next request opens its folder afresh. */
  forget(tenantId: string): void {
    this.open.delete(tenantId);
  }

  /** Every company that is not suspended, for the nightly work. */
  forEachActive(work: (context: TenantContext) => void): void {
    for (const tenant of this.registry.listTenants()) {
      if (tenant.status !== 'active') continue;
      try {
        work(this.context(tenant));
      } catch (error) {
        console.error(
          `${tenant.slug}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** How many folders are open, for the health check to report. */
  get openCount(): number {
    return this.open.size;
  }
}
