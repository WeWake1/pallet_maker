import { DEFAULT_HANDLING } from '../types.js';
import type { Brand } from './types.js';

/**
 * What a sheet says when nobody has said whose it is.
 *
 * Deliberately unnamed and unmarked. A sheet is a document that goes to a
 * customer, and putting some other company's name or mark on it would be worse
 * than putting none — so the watermark is off and the corner is empty until a
 * brand file says otherwise.
 *
 * What is left is the part every pallet shop needs anyway: a projection
 * convention, tolerances, millimetres, and a design to start from. Those are
 * stated rather than absent, because a sheet with no tolerance on it is a
 * sheet somebody has to ask about.
 */
export const DEFAULT_BRAND: Brand = {
  companyName: '',
  logo: { kind: 'none' },
  watermark: { enabled: false, text: '', opacity: 0.06, sizePt: null },
  font: null,
  // First angle is the ISO convention, used across Europe and India. A shop
  // drawing to the American convention says third angle here.
  projectionNote: 'First-angle projection, all dimensions in mm',
  tolerances: { component: '± 2 mm', pallet: '± 5 mm' },
  units: { length: 'mm', volume: 'cft' },
  defaults: {
    palletCodePlaceholder: '',
    species: 'pine',
    nailType: 'wire nail',
    // The commonest pallet in the world, and the one nearly every design is a
    // variation on. A shop that builds something else types over it once.
    newPallet: { length: 1200, width: 800 },
    handling: [...DEFAULT_HANDLING],
  },
};

/** The brand with a name on it, for a sheet that has one but nothing else. */
export function brandNamed(companyName: string): Brand {
  return {
    ...DEFAULT_BRAND,
    companyName,
    watermark: { ...DEFAULT_BRAND.watermark, enabled: true, text: companyName },
  };
}
