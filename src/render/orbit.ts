import type { PlacedPiece } from '../geometry/types.js';
import { paintOrder } from './isometric.js';
import type { IsoPoint } from './isometric.js';

/**
 * A free axonometric: the same geometry the printed isometric is drawn in, with
 * the eye placed by two angles instead of being fixed.
 *
 * `isometric.ts` stays at its one viewpoint on purpose — a drawing on a spec
 * sheet has to be the same drawing every time it is printed. This is for the
 * editor, where the whole point is to turn the pallet round and look at the
 * layer being worked on.
 *
 *   yaw    swings the eye round the pallet
 *   pitch  raises it above the deck
 *
 * The projection is orthographic, so a millimetre is the same length wherever
 * it lands on the page and nothing is foreshortened by distance. Screen y runs
 * down the page, which is why the up vector is negated.
 */

export interface Orientation {
  /** Radians. At 0 the eye is out along +x, looking back down the length. */
  yaw: number;
  /** Radians. Positive looks down on the deck, negative up from underneath. */
  pitch: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface View {
  /** Screen right, in pallet coordinates. */
  right: Vec3;
  /** Screen up. */
  up: Vec3;
  /** From the pallet towards the eye. Decides which faces show and what hides what. */
  eye: Vec3;
}

/**
 * The eye along (1, 1, 1): the viewpoint the printed isometric uses, so the 3D
 * view opens on the drawing that is already on the sheet.
 */
export const ISO_ORIENTATION: Orientation = {
  yaw: Math.PI / 4,
  pitch: Math.atan(1 / Math.SQRT2),
};

/** Looking straight down, which is the top view. Pitch cannot go past it. */
export const MAX_PITCH = Math.PI / 2 - 0.01;

export function viewFor({ yaw, pitch }: Orientation): View {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return {
    right: { x: sy, y: -cy, z: 0 },
    up: { x: -sp * cy, y: -sp * sy, z: cp },
    eye: { x: cp * cy, y: cp * sy, z: sp },
  };
}

export function project(view: View, x: number, y: number, z: number): IsoPoint {
  return {
    sx: x * view.right.x + y * view.right.y + z * view.right.z,
    sy: -(x * view.up.x + y * view.up.y + z * view.up.z),
  };
}

export interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** The box the pieces occupy, in millimetres. The view turns about its centre. */
export function modelExtent(pieces: readonly PlacedPiece[]): Extent {
  const extent: Extent = {
    x0: Infinity,
    x1: -Infinity,
    y0: Infinity,
    y1: -Infinity,
    z0: Infinity,
    z1: -Infinity,
  };
  for (const p of pieces) {
    extent.x0 = Math.min(extent.x0, p.x);
    extent.x1 = Math.max(extent.x1, p.x + p.dx);
    extent.y0 = Math.min(extent.y0, p.y);
    extent.y1 = Math.max(extent.y1, p.y + p.dy);
    extent.z0 = Math.min(extent.z0, p.z);
    extent.z1 = Math.max(extent.z1, p.z + p.dz);
  }
  return extent;
}

export interface Bounds {
  minSx: number;
  maxSx: number;
  minSy: number;
  maxSy: number;
}

const CORNERS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

/**
 * Screen extent of a set of pieces. Which corner of a box is extreme depends on
 * where the eye is, so all eight are taken rather than the four the fixed
 * isometric can get away with.
 */
export function boundsOf(pieces: readonly PlacedPiece[], view: View): Bounds {
  const bounds: Bounds = {
    minSx: Infinity,
    maxSx: -Infinity,
    minSy: Infinity,
    maxSy: -Infinity,
  };
  for (const p of pieces) {
    for (const [fx, fy, fz] of CORNERS) {
      const c = project(view, p.x + fx * p.dx, p.y + fy * p.dy, p.z + fz * p.dz);
      bounds.minSx = Math.min(bounds.minSx, c.sx);
      bounds.maxSx = Math.max(bounds.maxSx, c.sx);
      bounds.minSy = Math.min(bounds.minSy, c.sy);
      bounds.maxSy = Math.max(bounds.maxSy, c.sy);
    }
  }
  return bounds;
}

/**
 * The face names are the ones the fixed isometric uses — where each face falls
 * on the page at the default orientation — and they stay with the pallet's own
 * axes as it turns. That way a face keeps its tone while the view moves, so the
 * shading reads as the shape of the pallet rather than as a light going round.
 */
export type FaceName = 'top' | 'right' | 'left';

export interface Face {
  name: FaceName;
  points: IsoPoint[];
}

/**
 * The three faces of a piece that face the eye: one per axis, at whichever end
 * of that axis the eye is on. A face square to the screen projects to a line,
 * which is right — that is what a box looks like edge on.
 */
export function visibleFaces(p: PlacedPiece, view: View): Face[] {
  const x0 = p.x;
  const x1 = p.x + p.dx;
  const y0 = p.y;
  const y1 = p.y + p.dy;
  const z0 = p.z;
  const z1 = p.z + p.dz;
  const x = view.eye.x >= 0 ? x1 : x0;
  const y = view.eye.y >= 0 ? y1 : y0;
  const z = view.eye.z >= 0 ? z1 : z0;
  const at = (px: number, py: number, pz: number): IsoPoint => project(view, px, py, pz);
  return [
    {
      // The face square to the width.
      name: 'left',
      points: [at(x0, y, z0), at(x1, y, z0), at(x1, y, z1), at(x0, y, z1)],
    },
    {
      // Square to the length.
      name: 'right',
      points: [at(x, y0, z0), at(x, y1, z0), at(x, y1, z1), at(x, y0, z1)],
    },
    {
      // Square to the height: the deck face, or the underside from below.
      name: 'top',
      points: [at(x0, y0, z), at(x1, y0, z), at(x1, y1, z), at(x0, y1, z)],
    },
  ];
}

const EPSILON = 1e-6;

/**
 * True when a lies entirely on the far side of b along one axis. Which end is
 * far depends on the eye, so the test flips with it; an axis square to the
 * screen contributes nothing either way.
 */
function farSide(a0: number, da: number, b0: number, db: number, eye: number): boolean {
  if (eye > EPSILON) return a0 + da <= b0 + EPSILON;
  if (eye < -EPSILON) return a0 >= b0 + db - EPSILON;
  return false;
}

function isBehind(a: PlacedPiece, b: PlacedPiece, eye: Vec3): boolean {
  return (
    farSide(a.x, a.dx, b.x, b.dx, eye.x) ||
    farSide(a.y, a.dy, b.y, b.dy, eye.y) ||
    farSide(a.z, a.dz, b.z, b.dz, eye.z)
  );
}

/** Distance along the view axis of the corner farthest from the eye. Ties only. */
function depthKey(p: PlacedPiece, eye: Vec3): number {
  const x = eye.x >= 0 ? p.x : p.x + p.dx;
  const y = eye.y >= 0 ? p.y : p.y + p.dy;
  const z = eye.z >= 0 ? p.z : p.z + p.dz;
  return x * eye.x + y * eye.y + z * eye.z;
}

/** Back to front, from wherever the eye happens to be. */
export function orderForOrbit(pieces: PlacedPiece[], view: View): PlacedPiece[] {
  // Every pair that overlaps on screen is tested, so the screen box of a piece
  // is asked for many times over. Project each one once.
  const boxes = new Map<PlacedPiece, Bounds>();
  const boxOf = (piece: PlacedPiece): Bounds => {
    let box = boxes.get(piece);
    if (!box) {
      box = boundsOf([piece], view);
      boxes.set(piece, box);
    }
    return box;
  };

  return paintOrder(pieces, {
    behind: (a, b) => isBehind(a, b, view.eye),
    overlaps: (a, b) => {
      const p = boxOf(a);
      const q = boxOf(b);
      return (
        p.minSx < q.maxSx && q.minSx < p.maxSx && p.minSy < q.maxSy && q.minSy < p.maxSy
      );
    },
    depth: (piece) => depthKey(piece, view.eye),
  });
}
