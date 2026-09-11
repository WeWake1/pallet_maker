import type { HandlingMethod } from '../types.js';

/**
 * Whose drawing this is, and the house conventions it is drawn to.
 *
 * A specification sheet goes out to a customer, so it says whose it is: the
 * name across the diagonal and the mark in the corner where a title block's
 * owner belongs. It also carries a handful of things that are settled once per
 * company rather than per design — the projection convention, the shop's
 * tolerances, the units it quotes in, and what a new design starts as.
 *
 * All of it is data. It used to be constants in this folder, which meant one
 * company's name, one company's logo and one company's font were compiled into
 * every copy of the program; now a company's brand is a small file beside its
 * designs, and the program ships a plain default.
 *
 * Nothing here touches the filesystem: the editor needs this type too, and a
 * browser has no files. Reading it off a disk is `resolve.ts`.
 */

/**
 * The mark in the corner.
 *
 * Vector where it can be. A `<path>` is a few hundred bytes, prints sharp at
 * any size, and leaves the SVG sheet takeable-apart in a page-layout program —
 * which is the whole reason that export is worth having. A raster mark is
 * accepted because most companies have a PNG and nothing else, and it costs
 * only that one guarantee, for that one company.
 */
export type BrandLogo =
  | {
      kind: 'svg';
      /** What goes inside the `<svg>`: shapes only, already sanitised. */
      svg: string;
      /** The box those shapes are drawn in, which becomes the viewBox. */
      width: number;
      height: number;
    }
  | {
      kind: 'raster';
      /** `data:image/png;base64,…`, embedded because the sheet has no base URL. */
      dataUri: string;
      /** The picture's own size in pixels, for the aspect ratio. */
      width: number;
      height: number;
    }
  | { kind: 'none' };

/**
 * The face the watermark is set in, embedded in the document.
 *
 * Absent means the sheet's own sans, which is what most companies will want:
 * a face has to be licensed for embedding, and every sheet carries a copy of
 * it. The SVG sheet never uses it — a `<style>` block is one of the things
 * that makes a page-layout program flatten the page — so that export is always
 * set in whatever sans the reader has.
 */
export interface BrandFont {
  family: string;
  /** `data:font/otf;base64,…` */
  dataUri: string;
  format: 'opentype' | 'truetype' | 'woff' | 'woff2';
  /**
   * How wide a character is, as a fraction of the size, averaged over a name.
   *
   * Only the watermark needs it, and only to answer "what size runs corner to
   * corner". Measuring a face properly means parsing it; this is one number
   * off one printed sheet, and it is the difference between a name that fills
   * the diagonal and one that runs off the page. A condensed face is about
   * 0.39, an ordinary sans about 0.49.
   */
  advanceEm?: number;
}

export interface BrandWatermark {
  enabled: boolean;
  /** What it says. The company's name unless it is given something else. */
  text: string;
  opacity: number;
  /**
   * Point size on the printed sheet, overriding the size worked out to fill
   * the diagonal. An escape hatch for a name the arithmetic gets wrong; the
   * SVG sheet always works its own out, since it cannot use the brand face.
   */
  sizePt: number | null;
}

/**
 * What the shop measures in.
 *
 * The currency is not here: it belongs to the rates, where the numbers it
 * counts are, and two places to write it down is one place for them to
 * disagree.
 */
export interface BrandUnits {
  /** Millimetres. Inches are not built; the sheet says `mm` in a dozen places. */
  length: 'mm';
  /** Cubic feet, as the Indian timber trade quotes, or cubic metres. */
  volume: 'cft' | 'm3';
}

/** What a new design starts as, and what the fields suggest. */
export interface BrandDefaults {
  /** Shown in the empty pallet-code field, e.g. `AP-001`. */
  palletCodePlaceholder: string;
  /** The timber a new board is cut from. */
  species: string;
  /** What a new row of the nail schedule is for. */
  nailType: string;
  newPallet: { length: number; width: number };
  /** What a new design is cleared to be moved with. */
  handling: HandlingMethod[];
}

export interface Brand {
  companyName: string;
  logo: BrandLogo;
  watermark: BrandWatermark;
  font: BrandFont | null;
  /**
   * Printed under the drawings, e.g. first-angle or third-angle.
   *
   * It is a note, not an instruction: changing it does not rearrange the
   * views. The sheet captions every view it draws — TOP VIEW, SIDE VIEW and
   * the rest — so which is which is never left to the reader to infer from
   * where it sits, which is the thing a projection convention settles.
   */
  projectionNote: string;
  /** Printed on every sheet, whatever the design. */
  tolerances: { component: string; pallet: string };
  units: BrandUnits;
  defaults: BrandDefaults;
}
