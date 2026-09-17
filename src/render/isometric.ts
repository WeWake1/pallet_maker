import { notchOutline } from '../geometry/notch.js';
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

/** A corner in pallet coordinates. */
export type Corner = readonly [number, number, number];

/** A face of a piece, before projection. */
export interface PieceFace {
  /** Which axis it is square to, named as the fixed isometric names them. */
  name: FaceName;
  corners: Corner[];
}

/** The direction from the pallet to the eye. Only its direction matters. */
export interface EyeDirection {
  x: number;
  y: number;
  z: number;
}

const EPSILON = 1e-6;

/**
 * The faces of a piece that face an eye, as corners for the caller to project,
 * in draw order.
 *
 * A box shows three: one square to each axis, at whichever end the eye is on.
 * A notched runner shows more, and they come first so the box's own faces are
 * painted over them where the timber is in the way. Its face square to the
 * width is the runner's profile with the bites out of it; its underside, from
 * below, is the timber left between the notches; and the inside of each notch
 * — wall, rounded corner, ceiling — is a run of strips across the board, each
 * shown when it faces the eye. Cut right through the width, a notch has no
 * face square to the width of its own — what is behind shows through the
 * bite, which is how a fork sees it.
 */
export function pieceFaces(p: PlacedPiece, eye: EyeDirection): PieceFace[] {
  const x0 = p.x;
  const x1 = p.x + p.dx;
  const y0 = p.y;
  const y1 = p.y + p.dy;
  const z0 = p.z;
  const z1 = p.z + p.dz;
  const x = eye.x >= 0 ? x1 : x0;
  const y = eye.y >= 0 ? y1 : y0;
  const z = eye.z >= 0 ? z1 : z0;

  const notches = p.notches ?? [];
  if (notches.length === 0) {
    return [
      // The face square to the width, which falls to the left of the screen.
      {
        name: 'left',
        corners: [
          [x0, y, z0],
          [x1, y, z0],
          [x1, y, z1],
          [x0, y, z1],
        ],
      },
      // Square to the length, falling to the right.
      {
        name: 'right',
        corners: [
          [x, y0, z0],
          [x, y1, z0],
          [x, y1, z1],
          [x, y0, z1],
        ],
      },
      // Square to the height: the deck face, or the underside from below.
      {
        name: 'top',
        corners: [
          [x0, y0, z],
          [x1, y0, z],
          [x1, y1, z],
          [x0, y1, z],
        ],
      },
    ];
  }

  // Worked in the board's own frame — a along it, b across it — since a
  // runner may run either way and its notches always run through it across.
  const first = notches[0]!;
  const alongX = first.y <= y0 + EPSILON && first.y + first.dy >= y1 - EPSILON;
  const a0 = alongX ? x0 : y0;
  const a1 = alongX ? x1 : y1;
  const b0 = alongX ? y0 : x0;
  const b1 = alongX ? y1 : x1;
  const eyeA = alongX ? eye.x : eye.y;
  const b = alongX ? y : x;
  const a = alongX ? x : y;
  const at = (ra: number, rb: number, rz: number): Corner => (alongX ? [ra, rb, rz] : [rb, ra, rz]);
  const acrossName: FaceName = alongX ? 'left' : 'right';
  const alongName: FaceName = alongX ? 'right' : 'left';

  const cuts = notches
    .map((n) => ({
      a0: alongX ? n.x : n.y,
      a1: alongX ? n.x + n.dx : n.y + n.dy,
      top: n.z + n.dz,
      // Mouth corner to mouth corner, in the board's frame, lifted to the piece.
      outline: notchOutline(alongX ? n.dx : n.dy, n.dz, n.radius).map((point) => ({
        a: (alongX ? n.x : n.y) + point.x,
        z: z0 + point.y,
      })),
    }))
    .sort((m, n) => m.a0 - n.a0);

  const faces: PieceFace[] = [];

  // The inside of each notch, a strip per straight piece of its outline. A
  // strip faces into the cut; it shows when that is towards the eye, which for
  // a wall means the eye is off its end of the board, for the ceiling that the
  // eye is underneath, and for the rounded corner something of both.
  for (const cut of cuts) {
    for (let i = 0; i + 1 < cut.outline.length; i++) {
      const from = cut.outline[i]!;
      const to = cut.outline[i + 1]!;
      const normalA = to.z - from.z;
      const normalZ = -(to.a - from.a);
      if (normalA * eyeA + normalZ * eye.z <= EPSILON) continue;
      faces.push({
        name: Math.abs(normalA) >= Math.abs(normalZ) ? alongName : 'top',
        corners: [at(from.a, b0, from.z), at(to.a, b0, to.z), at(to.a, b1, to.z), at(from.a, b1, from.z)],
      });
    }
  }

  // The profile: along the underside, up and round each notch, then back
  // along the top.
  const profile: Corner[] = [at(a0, b, z0)];
  for (const cut of cuts) {
    for (const point of cut.outline) profile.push(at(point.a, b, point.z));
  }
  profile.push(at(a1, b, z0), at(a1, b, z1), at(a0, b, z1));

  // The end, whole unless a notch runs right up to it.
  const endBottom = cuts
    .filter((cut) => Math.abs((eyeA >= 0 ? cut.a1 : cut.a0) - a) <= EPSILON)
    .reduce((top, cut) => Math.max(top, cut.top), z0);
  const end: Corner[] = [at(a, b0, endBottom), at(a, b1, endBottom), at(a, b1, z1), at(a, b0, z1)];

  // The deck face, or from below the underside in the pieces the notches leave.
  const flats: Corner[][] = [];
  if (eye.z >= 0) {
    flats.push([at(a0, b0, z1), at(a1, b0, z1), at(a1, b1, z1), at(a0, b1, z1)]);
  } else {
    let from = a0;
    for (const cut of [...cuts, { a0: a1, a1, top: z0 }]) {
      if (cut.a0 - from > EPSILON) {
        flats.push([at(from, b0, z0), at(cut.a0, b0, z0), at(cut.a0, b1, z0), at(from, b1, z0)]);
      }
      from = cut.a1;
    }
  }

  const across: PieceFace = { name: acrossName, corners: profile };
  const along: PieceFace = { name: alongName, corners: end };
  faces.push(...(alongX ? [across, along] : [along, across]));
  faces.push(...flats.map((corners) => ({ name: 'top' as const, corners })));
  return faces;
}

/** The faces of a piece that face the viewer, in draw order. */
export function isoFaces(p: PlacedPiece): IsoFace[] {
  // The eye sits along (1, 1, 1), so it is at the far end of every axis.
  return pieceFaces(p, { x: 1, y: 1, z: 1 }).map((face) => ({
    name: face.name,
    points: face.corners.map(([x, y, z]) => projectIso(x, y, z)),
  }));
}

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
 * What a viewpoint has to answer before its pieces can be put in order. The
 * printed isometric and the editor's free 3D view differ only in these three,
 * so they share the sort below rather than each having their own.
 */
export interface PaintRules {
  /** True when a is behind b, so a is drawn first. */
  behind: (a: PlacedPiece, b: PlacedPiece) => boolean;
  /** True when the two pieces cover any of the same screen. */
  overlaps: (a: PlacedPiece, b: PlacedPiece) => boolean;
  /** Larger is nearer the eye. Only used to break ties. */
  depth: (piece: PlacedPiece) => number;
}

/** Back-to-front ordering at the fixed isometric viewpoint. */
export function orderForPainter(pieces: PlacedPiece[]): PlacedPiece[] {
  return paintOrder(pieces, {
    behind: isBehind,
    overlaps: screenOverlap,
    depth: depthKey,
  });
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
export function paintOrder(pieces: PlacedPiece[], rules: PaintRules): PlacedPiece[] {
  const indexed = pieces.map((piece, index) => ({ piece, index }));
  const byDepth = [...indexed].sort(
    (a, b) => rules.depth(a.piece) - rules.depth(b.piece) || a.index - b.index,
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
      if (!rules.behind(a.piece, b.piece)) continue;
      if (rules.behind(b.piece, a.piece)) continue;
      if (!rules.overlaps(a.piece, b.piece)) continue;
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
    ready.sort((a, b) => rules.depth(a.piece) - rules.depth(b.piece) || a.index - b.index);
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
