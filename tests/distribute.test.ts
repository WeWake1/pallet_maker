import { describe, expect, it } from 'vitest';
import { distribute, distributeEvenly } from '../src/geometry/distribute.js';

const plain = (extents: number[]) =>
  extents.map((extent) => ({ extent, joinedToPrev: false, nudgeMm: 0 }));

describe('distribute', () => {
  it('shares the slack equally and sits flush to both edges', () => {
    const result = distribute(800, 0, plain([100, 100, 100, 100, 100, 100, 100]));
    expect(result.gapCount).toBe(6);
    expect(result.gap).toBeCloseTo(100 / 6, 9);
    expect(result.positions[0]).toBe(0);
    const last = result.positions[6]!;
    expect(last + 100).toBeCloseTo(800, 9);
  });

  it('closes the gap for a joined slot', () => {
    const items = plain([100, 100, 100, 100, 100, 100, 100]);
    items[4]!.joinedToPrev = true;
    const result = distribute(800, 0, items);
    expect(result.gapCount).toBe(5);
    expect(result.gap).toBe(20);
    expect(result.positions).toEqual([0, 120, 240, 360, 460, 580, 700]);
  });

  it('ignores joinedToPrev on the first item, which has no previous', () => {
    const items = plain([100, 100]);
    items[0]!.joinedToPrev = true;
    const result = distribute(300, 0, items);
    expect(result.gapCount).toBe(1);
    expect(result.gap).toBe(100);
  });

  it('starts the run at the offset', () => {
    const result = distribute(600, 50, plain([100, 100, 100]));
    expect(result.gap).toBe(150);
    expect(result.positions).toEqual([50, 300, 550]);
    // Flush to the far edge of the span, which itself starts at the offset.
    expect(result.positions[2]! + 100).toBe(650);
  });

  it('adds a nudge without moving the boards after it', () => {
    const items = plain([100, 100, 100]);
    items[1]!.nudgeMm = 25;
    const result = distribute(400, 0, items);
    expect(result.positions).toEqual([0, 175, 300]);
  });

  it('reports negative slack instead of guessing', () => {
    const result = distribute(500, 0, plain([200, 200, 200]));
    expect(result.slack).toBe(-100);
  });

  it('places a single item at the offset with no gap', () => {
    const result = distributeEvenly(800, 0, [800]);
    expect(result.gapCount).toBe(0);
    expect(result.gap).toBe(0);
    expect(result.positions).toEqual([0]);
  });
});
