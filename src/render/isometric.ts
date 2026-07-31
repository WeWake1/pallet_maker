import type { PlacedPiece } from '../geometry/types.js';

/**
 * Standard 30 degree axonometric, generated geometrically from PlacedPiece[].
 *
 *   sx = (x - y) cos 30
 *   sy = (x + y) sin 30 - z
 *
 * The viewer sits along (1, 1, 1), so the top, the +x end and the +y side of
 * every piece are the three visible faces. Screen y runs down the page, which
 * is why height is subtracted.
 */

export const ISO_COS = Math.cos(Math.PI / 6);
export const ISO_SIN = Math.sin(Math.PI / 6);

export interface IsoPoint {
  sx: number;
  sy: number;
}

export function projectIso(x: number, y: number, z: number): IsoPoint {
  return { sx: (x - y) * ISO_COS, sy: (x + y) * ISO_SIN - z };
}

export interface IsoBounds {
  minSx: number;
  maxSx: number;
  minSy: number;
  maxSy: number;
}

/** Screen extent of a piece. Its corners are the extremes of each axis. */
export function isoBounds(pieces: PlacedPiece[]): IsoBounds {
  const bounds: IsoBounds = {
    minSx: Infinity,
    maxSx: -Infinity,
    minSy: Infinity,
    maxSy: -Infinity,
  };
  for (const p of pieces) {
    // sx is largest at (x1, y0) and smallest at (x0, y1); sy is largest at
    // (x1, y1, z0) and smallest at (x0, y0, z1).
    const corners = [
      projectIso(p.x + p.dx, p.y, p.z),
      projectIso(p.x, p.y + p.dy, p.z),
      projectIso(p.x + p.dx, p.y + p.dy, p.z),
      projectIso(p.x, p.y, p.z + p.dz),
    ];
    for (const c of corners) {
      bounds.minSx = Math.min(bounds.minSx, c.sx);
      bounds.maxSx = Math.max(bounds.maxSx, c.sx);
      bounds.minSy = Math.min(bounds.minSy, c.sy);
      bounds.maxSy = Math.max(bounds.maxSy, c.sy);
    }
  }
  return bounds;
}

export type FaceName = 'top' | 'right' | 'left';

export interface IsoFace {
  name: FaceName;
  points: IsoPoint[];
}

/** The three faces of a piece that face the viewer, in draw order. */
export function isoFaces(p: PlacedPiece): IsoFace[] {
  const x0 = p.x;
  const x1 = p.x + p.dx;
  const y0 = p.y;
  const y1 = p.y + p.dy;
  const z0 = p.z;
  const z1 = p.z + p.dz;
  return [
    {
      // The +y side, which falls to the left of the screen.
      name: 'left',
      points: [
        projectIso(x0, y1, z0),
        projectIso(x1, y1, z0),
        projectIso(x1, y1, z1),
        projectIso(x0, y1, z1),
      ],
    },
    {
      // The +x end, which falls to the right.
      name: 'right',
      points: [
        projectIso(x1, y0, z0),
        projectIso(x1, y1, z0),
        projectIso(x1, y1, z1),
        projectIso(x1, y0, z1),
      ],
    },
    {
      name: 'top',
      points: [
        projectIso(x0, y0, z1),
        projectIso(x1, y0, z1),
        projectIso(x1, y1, z1),
        projectIso(x0, y1, z1),
      ],
    },
  ];
}

const EPSILON = 1e-6;

/** True when a is entirely on the far side of b along one axis. */
function isBehind(a: PlacedPiece, b: PlacedPiece): boolean {
  return (
    a.x + a.dx <= b.x + EPSILON ||
    a.y + a.dy <= b.y + EPSILON ||
    a.z + a.dz <= b.z + EPSILON
  );
}

function screenBox(p: PlacedPiece): { x0: number; x1: number; y0: number; y1: number } {
  const b = isoBounds([p]);
  return { x0: b.minSx, x1: b.maxSx, y0: b.minSy, y1: b.maxSy };
}

function screenOverlap(a: PlacedPiece, b: PlacedPiece): boolean {
  const p = screenBox(a);
  const q = screenBox(b);
  return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
}

/** Distance along the view axis. Only used to break ties. */
function depthKey(p: PlacedPiece): number {
  return p.x + p.y + p.z;
}

/**
 * Back-to-front ordering.
 *
 * A scalar depth sort is not enough: a long deck board can have a farther
 * centre than a bearer that sits underneath it, and would then be painted over
 * by it. So pieces that overlap on screen are ordered pairwise, a piece being
 * behind another when it is entirely on the far side along one axis, and the
 * result is topologically sorted.
 */
export function orderForPainter(pieces: PlacedPiece[]): PlacedPiece[] {
  const indexed = pieces.map((piece, index) => ({ piece, index }));
  const byDepth = [...indexed].sort(
    (a, b) => depthKey(a.piece) - depthKey(b.piece) || a.index - b.index,
  );

  const after = new Map<number, number[]>();
  const inDegree = new Map<number, number>();
  for (const item of indexed) {
    after.set(item.index, []);
    inDegree.set(item.index, 0);
  }

  for (const a of indexed) {
    for (const b of indexed) {
      if (a.index === b.index) continue;
      if (!isBehind(a.piece, b.piece)) continue;
      if (isBehind(b.piece, a.piece)) continue;
      if (!screenOverlap(a.piece, b.piece)) continue;
      after.get(a.index)!.push(b.index);
      inDegree.set(b.index, inDegree.get(b.index)! + 1);
    }
  }

  // Kahn's algorithm, taking the deepest available piece first so that pieces
  // with no relation between them still come out farthest first.
  const ready = byDepth.filter((item) => inDegree.get(item.index) === 0);
  const ordered: PlacedPiece[] = [];
  const done = new Set<number>();

  while (ready.length > 0) {
    ready.sort((a, b) => depthKey(a.piece) - depthKey(b.piece) || a.index - b.index);
    const next = ready.shift()!;
    ordered.push(next.piece);
    done.add(next.index);
    for (const target of after.get(next.index)!) {
      const remaining = inDegree.get(target)! - 1;
      inDegree.set(target, remaining);
      if (remaining === 0) ready.push(indexed[target]!);
    }
  }

  // A cycle would mean pieces that mutually overlap, which a real pallet does
  // not have. Fall back to plain depth order rather than dropping anything.
  if (ordered.length < pieces.length) {
    for (const item of byDepth) {
      if (!done.has(item.index)) ordered.push(item.piece);
    }
  }

  return ordered;
}
