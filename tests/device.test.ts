import { describe, expect, it } from 'vitest';
import { isPhone } from '../src/editor/device.js';
import type { Device } from '../src/editor/device.js';
import { wheelZoom } from '../src/editor/Preview.jsx';

/**
 * Who gets the app and who is told to come back on a computer, and how far a
 * wheel or a trackpad zooms the 3D view.
 */

const laptop: Device = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  mobileHint: false,
  coarsePointer: false,
  screenWidth: 1728,
  screenHeight: 1117,
};

describe('a phone', () => {
  it('is told about the mobile version, however its browser says so', () => {
    const phones: Array<Partial<Device>> = [
      {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
        mobileHint: undefined,
      },
      {
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
        mobileHint: true,
      },
      { userAgent: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0' },
      // Asked for the desktop site: the agent says Linux, the screen says phone.
      {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        coarsePointer: true,
        screenWidth: 412,
        screenHeight: 915,
      },
    ];
    for (const phone of phones) expect(isPhone({ ...laptop, ...phone }), phone.userAgent).toBe(true);
  });

  it('is told so held either way up', () => {
    const sideways = { ...laptop, userAgent: 'Something', coarsePointer: true, screenWidth: 915, screenHeight: 412 };
    expect(isPhone(sideways)).toBe(true);
  });
});

describe('everything that is not a phone', () => {
  it('gets the app: laptops, desktops and tablets', () => {
    const others: Array<Partial<Device>> = [
      {},
      // A Windows laptop with a touch screen still has a trackpad first.
      {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
        screenWidth: 1280,
        screenHeight: 800,
      },
      // An iPad passes itself off as a Mac, and has the screen of a small laptop.
      { coarsePointer: true, screenWidth: 820, screenHeight: 1180 },
      // Chrome on an iPad says iPad and Mobile, but not iPhone.
      {
        userAgent:
          'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1',
        coarsePointer: true,
        screenWidth: 744,
        screenHeight: 1133,
      },
      // An Android tablet leaves Mobile out.
      {
        userAgent:
          'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        mobileHint: false,
        coarsePointer: true,
        screenWidth: 800,
        screenHeight: 1280,
      },
    ];
    for (const other of others) expect(isPhone({ ...laptop, ...other }), JSON.stringify(other)).toBe(false);
  });
});

describe('zooming the 3D view with a wheel', () => {
  const pixels = (deltaY: number) => ({ deltaY, deltaMode: 0, ctrlKey: false });

  it('zooms in for a wheel turned away, out for one turned back, and not at all for none', () => {
    expect(wheelZoom(pixels(-100))).toBeGreaterThan(1);
    expect(wheelZoom(pixels(100))).toBeLessThan(1);
    expect(wheelZoom(pixels(0))).toBe(1);
  });

  it('zooms by how far the wheel moved, not by how many events it sent', () => {
    // A gentle stroke on a trackpad: thirty events of four pixels each.
    let stroke = 1;
    for (let i = 0; i < 30; i += 1) stroke *= wheelZoom(pixels(-4));
    // The same distance as one click of a mouse wheel, near enough.
    expect(stroke).toBeCloseTo(wheelZoom(pixels(-120)), 6);
    // And a modest change, where it used to be 1.12 to the thirtieth: thirty times.
    expect(stroke).toBeGreaterThan(1.1);
    expect(stroke).toBeLessThan(1.2);
  });

  it('gives one click of a mouse wheel about a tenth, in pixels or in lines', () => {
    expect(wheelZoom(pixels(-100))).toBeGreaterThan(1.08);
    expect(wheelZoom(pixels(-100))).toBeLessThan(1.15);
    const lines = wheelZoom({ deltaY: -3, deltaMode: 1, ctrlKey: false });
    expect(lines).toBeGreaterThan(1.08);
    expect(lines).toBeLessThan(1.15);
  });

  it('never jumps far on one event, however big', () => {
    expect(wheelZoom(pixels(-5000))).toBeLessThan(1.3);
    expect(wheelZoom(pixels(5000))).toBeGreaterThan(1 / 1.3);
  });

  it('follows a pinch faster than a scroll of the same size', () => {
    expect(wheelZoom({ deltaY: -10, deltaMode: 0, ctrlKey: true })).toBeGreaterThan(wheelZoom(pixels(-10)));
  });
});
