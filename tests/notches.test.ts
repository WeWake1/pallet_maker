import { describe, expect, it } from 'vitest';
import { reducer } from '../src/editor/state.js';
import type { Action, EditorState } from '../src/editor/state.js';
import { describePath } from '../src/editor/hints.js';
import { defaultNotchPattern, notchPattern, notchesFor } from '../src/editor/notches.js';
import { analysePallet, computeLayout } from '../src/geometry/layout.js';
import { notchOutline, notchRadius } from '../src/geometry/notch.js';
import { describeNotches, partNumbers, slotSignature } from '../src/geometry/parts.js';
import { isoFaces } from '../src/render/isometric.js';
import { viewFor, visibleFaces } from '../src/render/orbit.js';
import { renderOrbit } from '../src/render/orbitView.js';
import { projectPieces } from '../src/render/project.js';
import { renderView } from '../src/render/views.js';
import { parsePallet } from '../src/schema.js';
import { componentTable } from '../src/sheet/components.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { renderSheetSvg } from '../src/sheet/svgSheet.js';
import { NOTCH_RADIUS_MM } from '../src/types.js';
import type { Layer, Pallet, Slot } from '../src/types.js';
import { loadFixture } from './helpers.js';

/**
 * Notched runners: the stringer pallet a fork gets into from the side as well
 * as the ends, through two cuts in the underside of every runner. The fixture
 * is the 2-way stringer with 229 x 38 notches set in 300 from each end of its
 * 1200 runners, so the cuts run 300–529 and 671–900, and its three bottom
 * boards, at 0, 550 and 1100, sit clear of them.
 */

function runnerLayer(pallet: Pallet): Layer {
  return pallet.layers.find((layer) => layer.kind === 'runner')!;
}

function runnerSlots(pallet: Pallet): Slot[] {
  const content = runnerLayer(pallet).content;
  if (content.type !== 'sequence') throw new Error('expected boards');
  return content.slots;
}

function bottomSlots(pallet: Pallet): Slot[] {
  const content = pallet.layers.find((layer) => layer.kind === 'bottom_deck')!.content;
  if (content.type !== 'sequence') throw new Error('expected boards');
  return content.slots;
}

function labels(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
}

function polygons(svg: string): string[][] {
  return [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1]!.split(' '));
}

describe('a notched runner in the layout', () => {
  const pallet = loadFixture('stringer-notched');
  const layout = computeLayout(pallet);
  const runners = layout.pieces.filter((piece) => piece.layerKind === 'runner');

  it('lays out with nothing to complain about', () => {
    expect(layout.issues).toEqual([]);
    expect(runners).toHaveLength(3);
  });

  it('is still the whole stick, with the notches carried as the timber that is not there', () => {
    for (const runner of runners) {
      expect([runner.x, runner.dx, runner.z, runner.dz]).toEqual([0, 1200, 18, 90]);
      expect(runner.notches).toEqual([
        { x: 300, y: runner.y, z: 18, dx: 229, dy: 100, dz: 38, radius: 38 },
        { x: 671, y: runner.y, z: 18, dx: 229, dy: 100, dz: 38, radius: 38 },
      ]);
    }
    // Nothing else grew a notch.
    expect(layout.pieces.filter((piece) => piece.notches).length).toBe(3);
  });

  it('places the notches in the order they run, however they were typed', () => {
    const reversed = loadFixture('stringer-notched');
    for (const slot of runnerSlots(reversed)) slot.notches = [...slot.notches!].reverse();
    const first = computeLayout(reversed).pieces.find((piece) => piece.layerKind === 'runner')!;
    expect(first.notches!.map((notch) => notch.x)).toEqual([300, 671]);
  });

  it('makes a notched runner a part of its own, and leaves every plain part signed as it was', () => {
    const plain = loadFixture('stringer-2way');
    const plainRunner = runnerSlots(plain)[0]!;
    const notchedRunner = runnerSlots(pallet)[0]!;
    expect(slotSignature(runnerLayer(plain), plainRunner)).toBe('runner/1200x100x90/pine/');
    expect(slotSignature(runnerLayer(pallet), notchedRunner)).toBe(
      'runner/1200x100x90/pine//n300+229x38,671+229x38',
    );
    expect([...partNumbers(pallet).values()]).toEqual([1, 2, 3, 4]);
  });

  it('refuses a notch past the end of its board', () => {
    const bad = loadFixture('stringer-notched');
    runnerSlots(bad)[1]!.notches = [{ offsetMm: 1000, lengthMm: 229, depthMm: 38 }];
    const issues = analysePallet(bad).issues;
    const overrun = issues.find((issue) => issue.code === 'notch_overrun')!;
    expect(overrun.severity).toBe('error');
    expect(overrun.message).toContain('board 2');
    expect(overrun.message).toContain('1229');
    // Run out that far, it also swallows the bottom board at 1100.
    expect(issues.map((issue) => issue.code)).toEqual(['notch_overrun', 'board_in_notch']);
    expect(() => computeLayout(bad)).toThrow(/notch/);
  });

  it('refuses a notch as deep as the board, which would cut it in two', () => {
    const bad = loadFixture('stringer-notched');
    runnerSlots(bad)[0]!.notches = [{ offsetMm: 300, lengthMm: 229, depthMm: 90 }];
    expect(analysePallet(bad).issues.map((issue) => issue.code)).toEqual(['notch_too_deep']);
  });

  it('refuses two notches that share timber', () => {
    const bad = loadFixture('stringer-notched');
    runnerSlots(bad)[0]!.notches = [
      { offsetMm: 300, lengthMm: 229, depthMm: 38 },
      { offsetMm: 400, lengthMm: 229, depthMm: 38 },
    ];
    expect(analysePallet(bad).issues.map((issue) => issue.code)).toEqual(['notch_overlap']);
  });

  it('keeps the base footprint and the overhangs off the notches', () => {
    expect(layout.base).toEqual({ x0: 0, x1: 1200, y0: 0, y1: 1000 });
    expect(layout.bottomOverhang).toEqual({
      lengthStart: 0,
      lengthEnd: 0,
      widthStart: 0,
      widthEnd: 0,
    });
  });
});

describe('a notched runner and the boards under it', () => {
  it('is nailed to the bottom boards where the timber is', () => {
    const layout = computeLayout(loadFixture('stringer-notched'));
    // 3 bottom boards under 3 runners, none in a notch: 9 crossings of 2.
    expect(layout.nailDots.filter((dot) => dot.face === 'bottom')).toHaveLength(9 * 2);
    expect(layout.issues).toEqual([]);
  });

  it('has nothing to nail a board lying in a notch to, and says so once', () => {
    const pallet = loadFixture('stringer-notched');
    // The middle bottom board, from 550 back to 350: wholly inside the 300–529 cut.
    bottomSlots(pallet)[1]!.nudgeMm = -200;
    const layout = analysePallet(pallet);
    expect(layout.nailDots.filter((dot) => dot.face === 'bottom')).toHaveLength(6 * 2);
    const warnings = layout.issues.filter((issue) => issue.code === 'board_in_notch');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.severity).toBe('warning');
    expect(warnings[0]!.message).toContain('board 2 of the bottom deck layer');
    expect(warnings[0]!.message).toContain('runner layer');
  });

  it('nails a board that laps into a notch on the part of it outside', () => {
    const pallet = loadFixture('stringer-notched');
    // From 550 back to 450: 450–529 is in the cut, 529–550 is under timber.
    bottomSlots(pallet)[1]!.nudgeMm = -100;
    const layout = analysePallet(pallet);
    const crossings = layout.nailCrossings.filter(
      (crossing) => crossing.face === 'bottom' && crossing.lowerSource.kind === 'slot' && crossing.lowerSource.index === 1,
    );
    expect(crossings).toHaveLength(3);
    for (const crossing of crossings) expect([crossing.x0, crossing.x1]).toEqual([529, 550]);
    expect(layout.issues).toEqual([]);
  });
});

describe('a notched runner in the flat views', () => {
  const layout = computeLayout(loadFixture('stringer-notched'));

  it('is drawn in the side view as its profile, bites and all', () => {
    const side = polygons(renderView(layout, 'side'));
    expect(side).toHaveLength(3);
    // Four corners, and round each notch from mouth corner to mouth corner.
    const perNotch = notchOutline(229, 38, 38).length;
    for (const outline of side) expect(outline).toHaveLength(4 + 2 * perNotch);
  });

  it('shows the bites only where the eye looks across the cut', () => {
    // End on, the timber either side of a notch fills the outline; from
    // above it is underneath. Neither has a hole to draw.
    expect(polygons(renderView(layout, 'end'))).toHaveLength(0);
    expect(polygons(renderView(layout, 'top'))).toHaveLength(0);
    const cuts = (view: 'top' | 'bottom' | 'side' | 'end'): number[] =>
      projectPieces(layout, view).map((item) => item.cuts.length);
    expect(cuts('side').filter((n) => n > 0)).toEqual([2, 2, 2]);
    expect(cuts('end').every((n) => n === 0)).toBe(true);
    expect(cuts('top').every((n) => n === 0)).toBe(true);
  });

  it('outlines each notch on the underside in the bottom view', () => {
    const recesses = (svg: string): number =>
      [...svg.matchAll(/<rect[^>]*fill="none"[^>]*pointer-events="none"/g)].length;
    // Six in the drawing and six more in the ghost pass clipped to the boards.
    expect(recesses(renderView(layout, 'bottom'))).toBe(6 + 6);
    // Flattened for the vector export, a ghost is only what overlaps a board,
    // and no bottom board lies over a notch.
    expect(recesses(renderView(layout, 'bottom', { fragment: true }))).toBe(6);
  });

  it('measures the entry through the notch on the face that was blind before', () => {
    // The cut stands 38 above the underside of a runner that sits 18 up on the
    // bottom boards, and the pocket is clear to the ground: 56 to get a fork in.
    expect(labels(renderView(layout, 'side'))).toContain('56');
    // The ends are unchanged: between the runners, over the bottom boards.
    expect(labels(renderView(layout, 'end'))).toContain('90');
    const plain = computeLayout(loadFixture('stringer-2way'));
    expect(labels(renderView(plain, 'side'))).not.toContain('56');
  });

  it('is only a way in where every runner is cut', () => {
    const pallet = loadFixture('stringer-notched');
    delete runnerSlots(pallet)[1]!.notches;
    const found = labels(renderView(computeLayout(pallet), 'side'));
    expect(found).not.toContain('56');
    // Back to the blind face: the runner course itself is what gets measured.
    expect(found).toContain('90');
  });

  it('dimensions the notches for the saw as a chain along the runner, and their depth', () => {
    const found = labels(renderView(layout, 'side')).filter((label) => /^\d/.test(label));
    expect(found.join(' ')).toContain('300 229 142 229 300');
    expect(found).toContain('38');
    // Neither the end view nor the plans carry any of it.
    expect(labels(renderView(layout, 'end'))).not.toContain('229');
    expect(labels(renderView(layout, 'top'))).not.toContain('229');
  });
});

describe('a notched runner in the pictorial views', () => {
  const layout = computeLayout(loadFixture('stringer-notched'));
  const runner = layout.pieces.find((piece) => piece.layerKind === 'runner')!;
  const board = layout.pieces.find((piece) => piece.layerKind === 'top_deck')!;

  const perNotch = notchOutline(229, 38, 38).length;
  const profileCorners = 4 + 2 * perNotch;
  const strips = (faces: Array<{ points: unknown[] }>) =>
    faces.filter((face) => face.points.length === 4).length;

  it('shows the fixed isometric its profile, and the inside of each notch that faces the eye', () => {
    const faces = isoFaces(runner);
    // The profile, the end and the top, and the notch strips before them.
    expect(faces.filter((face) => face.points.length === profileCorners)).toHaveLength(1);
    expect(faces.filter((face) => face.points.length === profileCorners)[0]!.name).toBe('left');
    expect(strips(faces)).toBe(faces.length - 1);
    // From up and along, the two walls that face +x show and so do the
    // rounded corners over them; the ceilings, facing down, do not.
    const stripsBeforeProfile = faces.findIndex((face) => face.points.length === profileCorners);
    expect(stripsBeforeProfile).toBeGreaterThan(2);
    // A plain board is what it always was.
    expect(isoFaces(board).map((face) => face.points.length)).toEqual([4, 4, 4]);
  });

  it('shows more of the inside from below, and the underside in pieces between the notches', () => {
    const above = visibleFaces(runner, viewFor({ yaw: 0.8, pitch: 0.6 }));
    const below = visibleFaces(runner, viewFor({ yaw: 0.8, pitch: -0.6 }));
    // Below sees the ceilings and the far corners, so it sees more strips.
    expect(strips(below)).toBeGreaterThan(strips(above));
    // One deck face from above; three pieces of underside from below.
    const flats = (faces: ReturnType<typeof visibleFaces>) =>
      faces.filter((face) => face.name === 'top' && face.points.length === 4);
    expect(flats(above).length).toBeGreaterThanOrEqual(1);
    expect(flats(below).length).toBeGreaterThanOrEqual(3 + 2);
    for (const faces of [above, below]) {
      expect(faces.filter((face) => face.points.length === profileCorners)).toHaveLength(1);
    }
  });

  it('paints the notch strips first, so the runner covers them where it is in the way', () => {
    const faces = isoFaces(runner);
    const profile = faces.findIndex((face) => face.points.length === profileCorners);
    for (let i = profile + 1; i < faces.length; i++) expect(faces[i]!.points).toHaveLength(4);
    expect(faces.slice(profile + 1).map((face) => face.name)).toEqual(['right', 'top']);
  });

  it('renders from anywhere', () => {
    for (const yaw of [0, 1, 2, 3, 4, 5, 6]) {
      for (const pitch of [-1.2, -0.3, 0.3, 1.2]) {
        const svg = renderOrbit(layout, { orientation: { yaw, pitch }, width: 400, height: 300 });
        expect(svg.startsWith('<svg')).toBe(true);
      }
    }
  });
});

describe('a notched runner on the sheet', () => {
  const pallet = loadFixture('stringer-notched');
  const layout = computeLayout(pallet);

  it('is its own row in the components table, named as notched and no more', () => {
    const groups = componentTable(pallet, layout);
    const runners = groups.find((group) => group.heading === 'Notched runners')!;
    expect(runners.rows.map((row) => [row.name, row.description, row.quantity])).toEqual([
      ['Notched runners', 'Notched runner', 3],
    ]);
    // The sizes are the drawing's to say; the row carries nothing but the name.
    expect(Object.keys(runners.rows[0]!)).not.toContain('detail');
    // Plain boards are what they were.
    expect(groups.map((group) => group.heading)).toEqual(['Top boards', 'Notched runners', 'Bottom boards']);
  });

  it('numbers a layer that is only partly notched off by what each row is', () => {
    const mixed = loadFixture('stringer-notched');
    delete runnerSlots(mixed)[1]!.notches;
    const runners = componentTable(mixed, computeLayout(mixed)).find((group) => group.heading === 'Runners')!;
    expect(runners.rows.map((row) => [row.name, row.quantity])).toEqual([
      ['Notched runner-1', 2],
      ['Runner-2', 1],
    ]);
  });

  it('says so on paper and in the vector sheet alike', () => {
    expect(renderSheet(pallet, layout)).toContain('Notched runners');
    expect(renderSheetSvg(pallet, layout)).toContain('Notched runners');
    expect(renderSheet(pallet, layout)).not.toContain('R38');
  });

  it('describes notches in words, once per size, radius and all', () => {
    expect(describeNotches(undefined)).toBe('');
    expect(describeNotches([])).toBe('');
    expect(describeNotches([{ offsetMm: 100, lengthMm: 229, depthMm: 38 }])).toBe('1 notch 229 × 38 R38');
    expect(
      describeNotches([
        { offsetMm: 100, lengthMm: 229, depthMm: 38 },
        { offsetMm: 600, lengthMm: 150, depthMm: 38 },
      ]),
    ).toBe('2 notches 229 × 38 R38, 150 × 38 R38');
    // A notch too short for the full radius takes what fits.
    expect(describeNotches([{ offsetMm: 100, lengthMm: 50, depthMm: 20 }])).toBe('1 notch 50 × 20 R25');
  });
});

describe('the document', () => {
  it('reads a design without notches exactly as before, and writes none into it', () => {
    const plain = loadFixture('stringer-2way');
    for (const slot of runnerSlots(plain)) expect('notches' in slot).toBe(false);
    const again = parsePallet(JSON.parse(JSON.stringify(plain)));
    expect(again).toEqual(plain);
  });

  it('refuses a notch with no size to it', () => {
    const raw = JSON.parse(JSON.stringify(loadFixture('stringer-notched')));
    raw.layers[1].content.slots[0].notches[0].lengthMm = 0;
    expect(() => parsePallet(raw)).toThrow(/notches\.0\.lengthMm/);
  });

  it('names a notch the way a person would look for it', () => {
    const names = ['Top boards', 'Runners', 'Bottom boards'];
    expect(describePath(['layers', 1, 'content', 'slots', 1, 'notches', 0, 'depthMm'], names)).toBe(
      'Runners, board 2, notch 1 — depth',
    );
  });
});

describe('notches in the form', () => {
  const start = (): EditorState => ({ pallet: loadFixture('stringer-2way'), selection: null });
  const run = (state: EditorState, ...actions: Action[]): EditorState => actions.reduce(reducer, state);

  it('cuts every runner in the layer alike from how many, how big and how far in', () => {
    const state = start();
    const layer = runnerLayer(state.pallet);
    const cut = run(state, {
      type: 'setNotches',
      layerId: layer.id,
      pattern: { count: 2, lengthMm: 229, depthMm: 38, fromEndMm: 300 },
    });
    for (const slot of runnerSlots(cut.pallet)) {
      expect(slot.notches).toEqual([
        { offsetMm: 300, lengthMm: 229, depthMm: 38 },
        { offsetMm: 671, lengthMm: 229, depthMm: 38 },
      ]);
    }
    expect(computeLayout(cut.pallet).issues).toEqual([]);
  });

  it('takes the notches off again at a count of nought, leaving no trace', () => {
    const state = start();
    const layer = runnerLayer(state.pallet);
    const pattern = { count: 2, lengthMm: 229, depthMm: 38, fromEndMm: 300 };
    const plain = run(
      state,
      { type: 'setNotches', layerId: layer.id, pattern },
      { type: 'setNotches', layerId: layer.id, pattern: { ...pattern, count: 0 } },
    );
    for (const slot of runnerSlots(plain.pallet)) expect('notches' in slot).toBe(false);
  });

  it('sits one notch in the middle and spaces three or more evenly between the ends', () => {
    expect(notchesFor(1200, { count: 1, lengthMm: 229, depthMm: 38, fromEndMm: 300 })).toEqual([
      { offsetMm: 486, lengthMm: 229, depthMm: 38 },
    ]);
    expect(
      notchesFor(1200, { count: 3, lengthMm: 100, depthMm: 38, fromEndMm: 100 })!.map((n) => n.offsetMm),
    ).toEqual([100, 550, 1000]);
    expect(notchesFor(1200, { count: 0, lengthMm: 229, depthMm: 38, fromEndMm: 300 })).toBeUndefined();
  });

  it('reads the pattern back off a board, and admits when there is none to read', () => {
    const notched = runnerSlots(loadFixture('stringer-notched'))[0]!;
    expect(notchPattern(notched)).toEqual({ count: 2, lengthMm: 229, depthMm: 38, fromEndMm: 300 });
    const plain = runnerSlots(loadFixture('stringer-2way'))[0]!;
    expect(notchPattern(plain)).toEqual({ ...defaultNotchPattern(1200), count: 0 });
    // The GMA notch, set in an eighth of the length: 6 in on a 48 in stringer.
    expect(defaultNotchPattern(1200)).toEqual({ count: 0, lengthMm: 229, depthMm: 35, fromEndMm: 150 });
    expect(defaultNotchPattern(1219).fromEndMm).toBe(152);
    // Cut by hand to places the form has no words for.
    const custom = { ...notched, notches: [{ offsetMm: 100, lengthMm: 229, depthMm: 38 }, { offsetMm: 500, lengthMm: 229, depthMm: 38 }] };
    expect(notchPattern(custom)).toBeNull();
  });

  it('keeps notches their distance from the ends when the runners are cut to a new length', () => {
    const state: EditorState = { pallet: loadFixture('stringer-notched'), selection: null };
    const layer = runnerLayer(state.pallet);
    const longer = run(state, { type: 'patchAllSlots', layerId: layer.id, patch: { length: 1400 } });
    for (const slot of runnerSlots(longer.pallet)) {
      expect(slot.length).toBe(1400);
      expect(slot.notches!.map((n) => n.offsetMm)).toEqual([300, 871]);
    }
    const one = run(state, { type: 'patchSlot', layerId: layer.id, index: 2, patch: { length: 1000 } });
    expect(runnerSlots(one.pallet)[2]!.notches!.map((n) => n.offsetMm)).toEqual([300, 471]);
    expect(runnerSlots(one.pallet)[0]!.notches!.map((n) => n.offsetMm)).toEqual([300, 671]);
  });

  it('leaves notches cut by hand where they are when the board is resized', () => {
    const state: EditorState = { pallet: loadFixture('stringer-notched'), selection: null };
    const layer = runnerLayer(state.pallet);
    runnerSlots(state.pallet)[0]!.notches = [{ offsetMm: 100, lengthMm: 229, depthMm: 38 }, { offsetMm: 500, lengthMm: 229, depthMm: 38 }];
    const shorter = run(state, { type: 'patchSlot', layerId: layer.id, index: 0, patch: { length: 600 } });
    expect(runnerSlots(shorter.pallet)[0]!.notches!.map((n) => n.offsetMm)).toEqual([100, 500]);
    // And the layout is the one that says it no longer fits.
    expect(analysePallet(shorter.pallet).issues.map((issue) => issue.code)).toContain('notch_overrun');
  });

  it('gives another runner its own copy of the notches, not a share of them', () => {
    const state: EditorState = { pallet: loadFixture('stringer-notched'), selection: null };
    const layer = runnerLayer(state.pallet);
    const four = run(state, { type: 'addSlot', layerId: layer.id });
    const slots = runnerSlots(four.pallet);
    expect(slots).toHaveLength(4);
    expect(slots[3]!.notches).toEqual(slots[2]!.notches);
    expect(slots[3]!.notches).not.toBe(slots[2]!.notches);
  });
});

describe('the shape of the cut', () => {
  const at = (points: Array<{ x: number; y: number }>, i: number) => points.at(i)!;

  it('is square at the mouth and rounded at the top, tangent to the ceiling', () => {
    const outline = notchOutline(229, 38, 20, 4);
    expect(at(outline, 0)).toEqual({ x: 0, y: 0 });
    expect(at(outline, -1)).toEqual({ x: 229, y: 0 });
    // Up the wall to where the corner starts, then round to the ceiling.
    expect(at(outline, 1)).toEqual({ x: 0, y: 18 });
    expect(at(outline, 5).x).toBeCloseTo(20, 9);
    expect(at(outline, 5).y).toBeCloseTo(38, 9);
    // Every point of the corner is the radius from its centre.
    for (let i = 1; i <= 5; i++) {
      expect(Math.hypot(at(outline, i).x - 20, at(outline, i).y - 18)).toBeCloseTo(20, 9);
    }
    // The other end is the mirror image.
    const n = outline.length;
    for (let i = 0; i < n; i++) {
      expect(at(outline, i).x).toBeCloseTo(229 - at(outline, n - 1 - i).x, 9);
      expect(at(outline, i).y).toBeCloseTo(at(outline, n - 1 - i).y, 9);
    }
  });

  it('sweeps from the mouth corner straight into the curve when the radius is deeper than the cut', () => {
    // The GMA notch: 1.38 in deep, R1.5 — no straight wall at all.
    const outline = notchOutline(229, 35, 38, 6);
    expect(at(outline, 0)).toEqual({ x: 0, y: 0 });
    // Still starts exactly at the mouth — the mouth corner is the first point
    // of the curve, so six segments are seven points — and still ends
    // tangent to the ceiling, where the flat begins.
    expect(at(outline, 1).y).toBeGreaterThan(0);
    expect(at(outline, 6).y).toBeCloseTo(35, 9);
    expect(at(outline, 7).y).toBeCloseTo(35, 9);
    expect(at(outline, 7).x).toBeGreaterThan(at(outline, 6).x);
    // And the curve is a true 38 radius about a centre 38 below the ceiling.
    const centre = { x: at(outline, 6).x, y: 35 - 38 };
    for (let i = 0; i <= 6; i++) {
      expect(Math.hypot(at(outline, i).x - centre.x, at(outline, i).y - centre.y)).toBeCloseTo(38, 9);
    }
    // Which is the GMA's 1.5 in radius reaching the underside 0.12 mm in from the mouth
    // corner — near enough vertical that the mouth reads as square.
    expect(centre.x).toBeCloseTo(Math.sqrt(35 * (2 * 38 - 35)), 9);
  });

  it('cuts to the standard radius, or to half the length of a notch too short for it', () => {
    expect(NOTCH_RADIUS_MM).toBe(38);
    expect(notchRadius({ lengthMm: 229 })).toBe(38);
    expect(notchRadius({ lengthMm: 50 })).toBe(25);
    // Two corners meeting in the middle: no flat ceiling left, no duplicate point.
    const outline = notchOutline(50, 20, 25, 4);
    const xs = outline.map((point) => point.x);
    expect(new Set(xs.map((x) => Math.round(x * 1e6))).size).toBe(xs.length);
  });

  it('is a plain rectangle with no radius', () => {
    expect(notchOutline(229, 38, 0)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 38 },
      { x: 229, y: 38 },
      { x: 229, y: 0 },
    ]);
  });
});

describe('the GMA 48 x 40 example', () => {
  const pallet = loadFixture('gma-48x40');
  const layout = computeLayout(pallet);
  const by = (kind: string) => layout.pieces.filter((piece) => piece.layerKind === kind);

  it('is the NWPCA sheet in millimetres: 48 x 40 x 4.76 in', () => {
    expect(layout.issues).toEqual([]);
    expect([layout.overallLength, layout.overallWidth, layout.derivedHeight]).toEqual([1219, 1016, 121]);
    expect(pallet.entry).toBe('partial_4way');
  });

  it('puts the deck boards where the sheet does', () => {
    // Top: 5.5 in leads and 3.5 in inner boards at 3.25 in gaps — 8.75, 15.5, 22.25 ...
    expect(by('top_deck').map((piece) => Math.round(piece.x))).toEqual([0, 222, 394, 565, 736, 908, 1079]);
    // Bottom: the inner boards between the notches, the outer two butted to the mouths at 15 and 33 in.
    expect(by('bottom_deck').map((piece) => [piece.x, piece.x + piece.dx])).toEqual([
      [0, 140], [381, 470], [565, 654], [749, 838], [1079, 1219],
    ]);
  });

  it('cuts the stringers 9 in long, 1.38 in deep, 6 in from each end, R1.5', () => {
    const stringers = by('runner');
    expect(stringers.map((piece) => piece.y)).toEqual([0, 490.5, 981]);
    for (const stringer of stringers) {
      expect(stringer.notches!.map((n) => [n.x, n.dx, n.dz, n.radius])).toEqual([
        [152, 229, 35, 38],
        [838, 229, 35, 38],
      ]);
    }
    const side = labels(renderView(layout, 'side')).filter((label) => /^\d/.test(label));
    expect(side.join(' ')).toContain('152 229 457 229 152');
    expect(side).toContain('35');
    // A fork gets in from the side under the 51 the notch leaves above the ground.
    expect(side).toContain('51');
  });

  it('nails every bottom board, since none lies in a notch', () => {
    expect(layout.issues.filter((issue) => issue.code === 'board_in_notch')).toEqual([]);
    expect(layout.nailDots.filter((dot) => dot.face === 'bottom')).toHaveLength(15 * 2);
  });

  it('lists the stringers as notched runners', () => {
    const runners = componentTable(pallet, layout).find((group) => group.heading === 'Notched runners')!;
    expect(runners.rows.map((row) => [row.name, row.quantity])).toEqual([['Notched runners', 3]]);
  });
});
