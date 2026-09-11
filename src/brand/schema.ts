import { z } from 'zod';
import { DEFAULT_BRAND } from './defaults.js';

/**
 * The brand as it sits on disk, beside the designs it brands.
 *
 *   <designs folder>/brand.json
 *   <designs folder>/brand/logo.svg     (or .png, .jpg)
 *   <designs folder>/brand/font.otf
 *
 * The artwork is referenced rather than pasted in, so the file stays something
 * a person can open and read, and so the logo can be replaced by dropping a
 * new file in. Turning this into the `Brand` the sheet uses — reading the
 * files, sanitising the logo, encoding the font — is `resolve.ts`.
 *
 * Every field may be left out. A brand file saying nothing but a name is a
 * perfectly good brand file, and everything it does not say is the default.
 */

const HandlingMethodSchema = z.enum(['pallet_truck', 'forklift', 'crane', 'conveyor', 'manual']);

export const BrandFileSchema = z.object({
  companyName: z.string().default(DEFAULT_BRAND.companyName),

  /** A path relative to the brand file, or null for no mark at all. */
  logo: z.string().min(1).nullable().default(null),

  watermark: z
    .object({
      /** Absent means "on when there is a name to write". */
      enabled: z.boolean().optional(),
      /** Absent means the company's name. */
      text: z.string().nullable().default(null),
      opacity: z.number().min(0).max(1).default(DEFAULT_BRAND.watermark.opacity),
      sizePt: z.number().positive().nullable().default(null),
    })
    .default({}),

  font: z
    .object({
      /** What the sheet asks for it by. Any name, so long as it is its own. */
      family: z.string().min(1),
      /** A path relative to the brand file. */
      file: z.string().min(1),
      /** See BrandFont.advanceEm. Measured once, off a printed sheet. */
      advanceEm: z.number().positive().max(2).optional(),
    })
    .nullable()
    .default(null),

  projectionNote: z.string().default(DEFAULT_BRAND.projectionNote),

  tolerances: z
    .object({
      component: z.string().default(DEFAULT_BRAND.tolerances.component),
      pallet: z.string().default(DEFAULT_BRAND.tolerances.pallet),
    })
    .default({}),

  units: z
    .object({
      volume: z.enum(['cft', 'm3']).default(DEFAULT_BRAND.units.volume),
    })
    .default({}),

  defaults: z
    .object({
      palletCodePlaceholder: z.string().default(DEFAULT_BRAND.defaults.palletCodePlaceholder),
      species: z.string().min(1).default(DEFAULT_BRAND.defaults.species),
      nailType: z.string().min(1).default(DEFAULT_BRAND.defaults.nailType),
      newPallet: z
        .object({
          length: z.number().int().positive().default(DEFAULT_BRAND.defaults.newPallet.length),
          width: z.number().int().positive().default(DEFAULT_BRAND.defaults.newPallet.width),
        })
        .default({}),
      handling: z.array(HandlingMethodSchema).default([...DEFAULT_BRAND.defaults.handling]),
    })
    .default({}),
});

export type BrandFile = z.infer<typeof BrandFileSchema>;

export function parseBrandFile(input: unknown): BrandFile {
  const result = BrandFileSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid brand file:\n${lines}`);
  }
  return result.data;
}
