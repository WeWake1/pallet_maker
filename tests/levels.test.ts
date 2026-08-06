import { describe, expect, it } from 'vitest';
import { fitRun } from '../src/geometry/fit.js';
import { analysePallet, computeLayout } from '../src/geometry/layout.js';
import { projectPieces } from '../src/render/project.js';
import { viewDimensions } from '../src/render/views.js';
import { reducer } from '../src/editor/state.js';
import type { Layer, Pallet } from '../src/types.js';
import { layerOf, loadFixture, piecesOf } from './helpers.js';

/**
 * A deck whose boards do not all run the same way.
 *
 * The M pallet is the one that forced this: five bottom boards, two crossing
 * the width at the ends and three running along the length between them, every
 * one nailed straight to the blocks. They are one course of timber, not two
 * decks stacked, and the fixture is the shape of that.
 */

function layer(pallet: Pallet, id: string): Layer {
  const found = pallet.layers.find((one) => one.id === id);
  if (!found) throw new Error(`no layer ${id}`);
  return found;
}

describe('the M pallet', () => {
  const layout = computeLayout(loadFixture('m-pallet'));

  it('lays out with nothing to report', () => {
    expect(layout.issues).toEqual([]);
    expect(layout.pieces).toHaveLength(7 + 3 + 9 + 2 + 3);
  });

  it('puts both halves of the bottom deck on the underside, not one on the other', () => {
    expect(layerOf(layout, 'bottom-ends').zBottom).toBe(0);
    expect(layerOf(layout, 'bottom-inner').zBottom).toBe(0);
    expect(piecesOf(layout, 'bottom-ends').every((piece) => piece.z === 0)).toBe(true);
    expect(piecesOf(layout, 'bottom-inner').every((piece) => piece.z === 0)).toBe(true);
  });

  it('counts the shared course once in the height', () => {
    // 18 top + 20 centre + 100 block + 18 bottom. Two bottom layers, one 18.
    expect(layout.derivedHeight).toBe(156);
    expect(layerOf(layout, 'blocks').zBottom).toBe(18);
  });

  it('keeps each half of the deck running its own way', () => {
    const ends = piecesOf(layout, 'bottom-ends');
    expect(ends.map((piece) => piece.x)).toEqual([0, 1100]);
    expect(ends.every((piece) => piece.dx === 100 && piece.dy === 1000)).toBe(true);

    const inner = piecesOf(layout, 'bottom-inner');
    expect(inner.map((piece) => piece.y)).toEqual([0, 450, 900]);
    expect(inner.every((piece) => piece.x === 100 && piece.dx === 1000)).toBe(true);
  });

  it('spaces each half across its own axis rather than as one run', () => {
    expect(layerOf(layout, 'bottom-ends').spread?.gap).toBe(1000);
    expect(layerOf(layout, 'bottom-inner').spread?.gap).toBe(350);
  });

  it('nails every bottom board to the blocks, and none of them to each other', () => {
    const bottom = layout.nailCrossings.filter((crossing) => crossing.face === 'bottom');
    expect(bottom).toHaveLength(9);
    expect(bottom.every((crossing) => crossing.upperKind === 'block')).toBe(true);
    // The joint is the whole course against the blocks, so both halves are in it.
    expect(new Set(bottom.map((crossing) => crossing.lowerLayerId))).toEqual(
      new Set(['bottom-ends', 'bottom-inner']),
    );
    // Six for the two end boards over three blocks each, three for the inner
    // boards over the middle row — the only blocks they reach.
    expect(bottom.filter((c) => c.lowerLayerId === 'bottom-ends')).toHaveLength(6);
    expect(bottom.filter((c) => c.lowerLayerId === 'bottom-inner')).toHaveLength(3);
  });

  it('does not treat the blocks as an internal joint under the deck', () => {
    // Before levels, five layers meant the block joint was neither the first
    // pair nor the last, so it was drawn as buried and carried no dots.
    expect(layout.nailDots.some((dot) => dot.face === 'bottom')).toBe(true);
  });

  it('draws the whole course solid in the bottom view, both directions of it', () => {
    const projected = projectPieces(layout, 'bottom');
    const near = projected.filter((item) => item.near).map((item) => item.piece.layerId);
    expect(new Set(near)).toEqual(new Set(['bottom-ends', 'bottom-inner']));
  });

  it('dimensions both halves of the deck, each on the side square to its run', () => {
    const dims = viewDimensions(layout, 'bottom');
    // The inner boards are spread across the width, so they measure down the
    // left; the end boards are spread along the length, so they measure below.
    expect(dims.some((dim) => dim.side === 'left' && dim.label === '350')).toBe(true);
    expect(dims.some((dim) => dim.side === 'bottom' && dim.label === '1000')).toBe(true);
  });
});

describe('a level that does not add up', () => {
  it('refuses two layers at one height whose boards would occupy the same timber', () => {
    const pallet = loadFixture('m-pallet');
    // The inner boards run the full length again, straight through the ends.
    const inner = layer(pallet, 'bottom-inner');
    inner.runOffsetMm = 0;
    inner.runSpanMm = null;
    if (inner.content.type === 'sequence') {
      for (const slot of inner.content.slots) slot.length = 1200;
    }

    const issues = analysePallet(pallet).issues.filter((issue) => issue.severity === 'error');
    expect(issues.map((issue) => issue.code)).toEqual(['level_clash']);
    expect(issues[0]!.message).toContain('bottom deck layer at position 5');
  });

  it('warns when boards sharing a course are not the same thickness', () => {
    const pallet = loadFixture('m-pallet');
    const inner = layer(pallet, 'bottom-inner');
    if (inner.content.type === 'sequence') {
      for (const slot of inner.content.slots) slot.thickness = 22;
    }

    const layout = analysePallet(pallet);
    expect(layout.issues.map((issue) => issue.code)).toContain('level_thickness');
    expect(layout.issues.every((issue) => issue.severity === 'warning')).toBe(true);
    // The course is as deep as the deeper of the two, and nothing above moves.
    expect(layout.derivedHeight).toBe(160);
  });

  it('ignores the flag on the topmost layer, which has nothing above it', () => {
    const pallet = loadFixture('block-1000x800');
    pallet.layers[0]!.sameLevelAsPrev = true;
    const layout = computeLayout(pallet);
    expect(layout.derivedHeight).toBe(156);
    expect(layout.issues).toEqual([]);
  });
});

describe('fitting a cross-running group between the boards it sits between', () => {
  it('reads the run left free off the boards sharing the level', () => {
    const layout = computeLayout(loadFixture('m-pallet'));
    expect(fitRun(layout, 'bottom-inner')).toEqual({ runOffsetMm: 100, runSpanMm: 1000 });
  });

  it('follows the end boards when they change width', () => {
    const pallet = loadFixture('m-pallet');
    const ends = layer(pallet, 'bottom-ends');
    if (ends.content.type === 'sequence') {
      for (const slot of ends.content.slots) slot.width = 140;
    }
    expect(fitRun(analysePallet(pallet), 'bottom-inner')).toEqual({
      runOffsetMm: 140,
      runSpanMm: 920,
    });
  });

  it('has nothing to say about a layer with its level to itself', () => {
    const layout = computeLayout(loadFixture('block-1000x800'));
    expect(fitRun(layout, 'bottom')).toBeNull();
  });

  it('never offers to cut the group that started the level', () => {
    // The end boards run the full width. Read the other way round this would
    // offer to cut them to the 350 gap between the inner boards, which is not
    // a pallet anyone asked for.
    const layout = computeLayout(loadFixture('m-pallet'));
    expect(fitRun(layout, 'bottom-ends')).toBeNull();
  });

  it('cuts the boards as well as setting the run, so the two cannot disagree', () => {
    const pallet = loadFixture('m-pallet');
    const before = layer(pallet, 'bottom-inner');
    before.runOffsetMm = 0;
    before.runSpanMm = null;
    if (before.content.type === 'sequence') {
      for (const slot of before.content.slots) slot.length = 1200;
    }

    const { pallet: fitted } = reducer(
      { pallet, selection: null },
      { type: 'fitRun', layerId: 'bottom-inner', runOffsetMm: 100, runSpanMm: 1000 },
    );

    const after = layer(fitted, 'bottom-inner');
    expect(after.runOffsetMm).toBe(100);
    expect(after.runSpanMm).toBe(1000);
    if (after.content.type !== 'sequence') throw new Error('expected boards');
    expect(after.content.slots.every((slot) => slot.length === 1000)).toBe(true);
    expect(computeLayout(fitted).issues).toEqual([]);
  });
});

describe('documents written before a deck could run two ways', () => {
  it('read as one layer per level, which is what they meant', () => {
    const pallet = loadFixture('block-1000x800');
    expect(pallet.layers.every((one) => one.sameLevelAsPrev === false)).toBe(true);
    const layout = computeLayout(pallet);
    expect(new Set(layout.layers.map((one) => one.level)).size).toBe(pallet.layers.length);
  });
});
