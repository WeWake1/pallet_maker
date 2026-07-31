import { z } from 'zod';

/**
 * Rates live in one config file and are never hardcoded. This module is the
 * shape of that file; reading it is in `load.ts`, which the editor must not
 * pull in, since a browser has no filesystem.
 *
 * Timber is priced by material and nails by type, because a pallet with
 * hardwood blocks under a pine deck costs what its parts cost; both fall back
 * to `default`.
 */

const RateTable = z.record(z.string(), z.number().nonnegative());

export const RatesSchema = z.object({
  currency: z.string().min(1).default('INR'),
  timberPerCft: RateTable,
  nailsPerThousand: RateTable,
  overhead: z
    .object({
      perPallet: z.number().nonnegative().default(0),
      percentOfMaterial: z.number().nonnegative().default(0),
    })
    .default({ perPallet: 0, percentOfMaterial: 0 }),
});

export type Rates = z.infer<typeof RatesSchema>;

export function parseRates(input: unknown): Rates {
  const result = RatesSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid rates file:\n${lines}`);
  }
  return result.data;
}

/** The rate for a material, or the fallback. Names are matched case-insensitively. */
export function rateFor(table: Record<string, number>, key: string): number {
  const wanted = key.trim().toLowerCase();
  for (const [name, rate] of Object.entries(table)) {
    if (name.toLowerCase() === wanted) return rate;
  }
  return table['default'] ?? 0;
}
