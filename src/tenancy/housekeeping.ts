import { join } from 'node:path';
import { backupLibrary } from '../server/backup.js';
import type { Registry } from './registry.js';
import type { Tenants } from './tenants.js';

/**
 * The work nobody asks for.
 *
 * A laptop took a snapshot every time it started, which on a laptop is every
 * morning. A server starts when it is deployed, which may be twice in a month,
 * so the same snapshot has to be on a clock instead. Sessions that have run
 * out and invitations nobody followed are swept on the hour, because a table
 * that only grows is a table that eventually matters.
 *
 * Nothing here is urgent and nothing here may take the server down: each piece
 * is wrapped, and a failure is written down and left for the next round.
 */

export interface HousekeepingOptions {
  /** Snapshots to keep per company. */
  keep?: number;
  /** Where the registry's own copies go. */
  registryBackups?: string;
  /** How many of those to keep. */
  keepRegistry?: number;
}

const HOUR_MS = 60 * 60 * 1000;

/** Back up every company's library, and the registry beside them. */
export function backupEverything(
  tenants: Tenants,
  registry: Registry,
  options: HousekeepingOptions = {},
): { companies: number; failures: number } {
  const keep = options.keep ?? 30;
  let companies = 0;
  let failures = 0;

  tenants.forEachActive((context) => {
    if (!context.handle.ready()) return;
    try {
      backupLibrary(context.handle.require(), { keep });
      companies += 1;
    } catch (error) {
      failures += 1;
      console.error(
        `Could not back up ${context.tenant.slug}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  if (options.registryBackups) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      registry.snapshot(join(options.registryBackups, `registry-${stamp}.sqlite`));
    } catch (error) {
      failures += 1;
      console.error(
        `Could not back up the registry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { companies, failures };
}

/**
 * Start the clocks. Returns a function that stops them again, for a server
 * that is shutting down and for tests that would otherwise never finish.
 */
export function startHousekeeping(
  tenants: Tenants,
  registry: Registry,
  options: HousekeepingOptions & { backupHour?: number } = {},
): () => void {
  const hourly = setInterval(() => {
    try {
      const swept = registry.sweep();
      if (swept.sessions > 0 || swept.invitations > 0) {
        console.log(`Swept ${swept.sessions} old session(s) and ${swept.invitations} unused invitation(s)`);
      }
    } catch (error) {
      console.error(`Could not sweep: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, HOUR_MS);

  // Checked every hour rather than scheduled once, so a server that is
  // restarted at midnight does not skip the night's backup.
  const wantedHour = options.backupHour ?? 2;
  let lastBackupDay = '';
  const nightly = setInterval(() => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getHours() !== wantedHour || day === lastBackupDay) return;
    lastBackupDay = day;
    const result = backupEverything(tenants, registry, options);
    console.log(`Backed up ${result.companies} compan(ies), ${result.failures} failure(s)`);
  }, HOUR_MS);

  // Neither should hold the process open when everything else has stopped.
  hourly.unref();
  nightly.unref();

  return () => {
    clearInterval(hourly);
    clearInterval(nightly);
  };
}
