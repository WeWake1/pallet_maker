import type { Layout } from '../geometry/types.js';
import type { Pallet } from '../types.js';
import { rateFor } from './rates.js';
import type { Rates } from './rates.js';

/**
 * Timber volume and what the pallet costs.
 *
 * Volume is the sum of dx x dy x dz over every placed piece, so it counts what
 * the drawing shows and nothing else. Costing is volume times a rate per cubic
 * foot, plus nails, plus overhead, all of which come from the rates file.
 */

/** 1 CFT in cubic millimetres. */
export const MM3_PER_CFT = 28_316_846.6;

export function toCft(mm3: number): number {
  return mm3 / MM3_PER_CFT;
}

export interface MaterialLine {
  material: string;
  pieces: number;
  volumeMm3: number;
  cft: number;
  ratePerCft: number;
  cost: number;
}

export interface NailCostLine {
  label: string;
  type: string;
  /** Undefined on a schedule line whose size has not been filled in. */
  sizeMm?: number;
  count: number;
  ratePerThousand: number;
  cost: number;
}

export interface Costing {
  currency: string;
  volumeMm3: number;
  cft: number;
  materials: MaterialLine[];
  timberCost: number;
  nails: NailCostLine[];
  nailCount: number;
  nailCost: number;
  materialCost: number;
  overhead: { perPallet: number; percentOfMaterial: number; amount: number };
  total: number;
}

/** Timber volume alone, for anyone who only wants the CFT. */
export function timberVolumeMm3(layout: Layout): number {
  return layout.pieces.reduce((sum, piece) => sum + piece.dx * piece.dy * piece.dz, 0);
}

/**
 * Timber is priced off the layout, so it is priced for the pieces the drawing
 * actually shows. Nails are priced off the schedule typed on the document,
 * because how many a pallet takes is an estimate somebody makes rather than
 * something the geometry can be trusted to say.
 */
export function computeCosting(pallet: Pallet, layout: Layout, rates: Rates): Costing {
  const volumes = new Map<string, { volumeMm3: number; pieces: number }>();
  for (const piece of layout.pieces) {
    const found = volumes.get(piece.material) ?? { volumeMm3: 0, pieces: 0 };
    found.volumeMm3 += piece.dx * piece.dy * piece.dz;
    found.pieces += 1;
    volumes.set(piece.material, found);
  }

  const materials: MaterialLine[] = [...volumes.entries()]
    .map(([material, found]) => {
      const cft = toCft(found.volumeMm3);
      const ratePerCft = rateFor(rates.timberPerCft, material);
      return {
        material,
        pieces: found.pieces,
        volumeMm3: found.volumeMm3,
        cft,
        ratePerCft,
        cost: cft * ratePerCft,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const nailLines: NailCostLine[] = pallet.nails.map((nail) => {
    const ratePerThousand = rateFor(rates.nailsPerThousand, nail.type);
    // A row whose qty has not been filled in prices at nothing rather than
    // guessing a number and quietly putting it in the total.
    const count = nail.count ?? 0;
    return {
      label: nail.label,
      type: nail.type,
      sizeMm: nail.sizeMm,
      count,
      ratePerThousand,
      cost: (count / 1000) * ratePerThousand,
    };
  });

  const volumeMm3 = materials.reduce((sum, line) => sum + line.volumeMm3, 0);
  const timberCost = materials.reduce((sum, line) => sum + line.cost, 0);
  const nailCost = nailLines.reduce((sum, line) => sum + line.cost, 0);
  const nailCount = nailLines.reduce((sum, line) => sum + line.count, 0);
  const materialCost = timberCost + nailCost;
  const amount =
    rates.overhead.perPallet + (materialCost * rates.overhead.percentOfMaterial) / 100;

  return {
    currency: rates.currency,
    volumeMm3,
    cft: toCft(volumeMm3),
    materials,
    timberCost,
    nails: nailLines,
    nailCount,
    nailCost,
    materialCost,
    overhead: { ...rates.overhead, amount },
    total: materialCost + amount,
  };
}
