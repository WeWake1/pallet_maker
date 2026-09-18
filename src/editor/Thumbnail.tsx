import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { analysePallet } from '../geometry/layout.js';
import type { Layout } from '../geometry/types.js';
import { renderThumbnail } from '../render/thumbnail.js';
import { fingerprint as fingerprintOf } from '../store/fingerprint.js';
import { api } from './api.js';

/**
 * The picture on a design card.
 *
 * The library is summaries — a name, a code, a date — and a picture needs the
 * design itself. So a card asks for its design as it scrolls into view, draws
 * the isometric from it, and keeps what it drew: the dashboard is fetched
 * afresh after every action, and thirty cards fetching thirty designs each
 * time would be most of what the screen did. The fingerprint on the summary
 * says whether the design a picture was drawn from is still the design.
 *
 * Resting the pointer on a card turns the pallet round, once, slowly, and it
 * settles back to the sheet's own drawing when the pointer leaves. Only the
 * card under the pointer is ever redrawn; the rest are a drawing each and
 * cost nothing while they sit there. That is the whole reason the pallets do
 * not all turn at once: thirty of them would be thirty drawings a frame,
 * every frame, for as long as the library was open.
 */

/** The picture's box, in px. Sized to the card, which is 176 wide. */
export const THUMBNAIL = { width: 176, height: 100 };

/** Radians per second while the pointer rests: a full turn in eight seconds. */
const TURN_RATE = (2 * Math.PI) / 8;
/** Seconds for most of the way home once the pointer has left. */
const SETTLE = 0.12;
/** Closer to home than this is home, and the redrawing stops. */
const HOME = 0.002;
const TAU = 2 * Math.PI;

interface Drawn {
  fingerprint: string;
  layout: Layout;
}

/** Every layout worked out so far, by design id. Held for the life of the page. */
const drawn = new Map<string, Drawn>();
/** Designs being fetched now, so that two cards of one design make one request. */
const pending = new Map<string, Promise<Layout | null>>();

/**
 * The layout of a design, fetched unless it is already held. Null when the
 * store would not give it: the card stays blank rather than the library
 * reporting a failure for every picture it could not draw.
 */
function fetchLayout(id: string): Promise<Layout | null> {
  let inflight = pending.get(id);
  if (!inflight) {
    inflight = api
      .get(id)
      .then((pallet) => {
        const layout = analysePallet(pallet);
        // Named by what actually came back rather than by the summary that
        // asked for it, which may already be a save behind.
        drawn.set(id, { fingerprint: fingerprintOf(pallet), layout });
        return layout;
      })
      .catch(() => null)
      .finally(() => pending.delete(id));
    pending.set(id, inflight);
  }
  return inflight;
}

/**
 * The layout a card should draw: undefined while it is not yet known, null
 * where it could not be had. `wanted` is false for a card nobody has scrolled
 * to yet, which is what keeps a library of hundreds from fetching all of them
 * at once.
 */
export function useDesignLayout(
  id: string,
  fingerprint: string,
  wanted: boolean,
): Layout | null | undefined {
  const held = drawn.get(id);
  const hit = held?.fingerprint === fingerprint ? held.layout : undefined;
  const [fetched, setFetched] = useState<{ fingerprint: string; layout: Layout | null } | null>(null);

  useEffect(() => {
    if (!wanted || hit) return;
    let live = true;
    void fetchLayout(id).then((layout) => {
      if (live) setFetched({ fingerprint, layout });
    });
    return () => {
      live = false;
    };
  }, [id, fingerprint, wanted, hit]);

  if (hit) return hit;
  // A fetch that failed is not tried again until the card is mounted afresh;
  // one that came back newer than the summary is drawn as it is.
  return fetched?.fingerprint === fingerprint ? fetched.layout : undefined;
}

/**
 * True once the element has been on screen, or near it. Stays true: a card
 * that has been scrolled past has its picture and keeps it.
 */
export function useInView(ref: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      // A screen ahead, so a picture is drawn before its card is scrolled to.
      { rootMargin: '240px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, seen]);

  return seen;
}

function prefersStillness(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * How far round from the sheet's drawing the picture is, in radians.
 *
 * While `turning` the eye goes round at a steady rate. When it stops the
 * picture comes home by the shorter way round, closing the gap by a fixed
 * fraction of itself each moment, so it eases in rather than snapping. Once
 * home, nothing is redrawn until the pointer comes back.
 */
export function useTurntable(turning: boolean): number {
  const [turn, setTurn] = useState(0);
  // The live value, for the frame loop: state would be a frame behind it.
  const held = useRef(0);

  useEffect(() => {
    const go = turning && !prefersStillness();
    if (!go && held.current === 0) return;

    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      // A tab that was hidden for a minute gets one small step, not a leap.
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;

      let next: number;
      if (go) {
        next = (held.current + TURN_RATE * dt) % TAU;
      } else {
        const gap = held.current > Math.PI ? held.current - TAU : held.current;
        const eased = gap * Math.exp(-dt / SETTLE);
        next = Math.abs(eased) < HOME ? 0 : (eased + TAU) % TAU;
      }
      held.current = next;
      setTurn(next);
      if (go || next !== 0) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [turning]);

  return turn;
}

/**
 * The picture itself. Blank until there is a layout to draw, and blank where
 * there never will be; the card's words are there either way.
 */
export function Thumbnail({
  layout,
  turning,
}: {
  layout: Layout | null | undefined;
  /** The pointer is resting on the card. */
  turning: boolean;
}) {
  const turn = useTurntable(turning && layout != null);
  const svg = useMemo(
    () => (layout ? renderThumbnail(layout, { ...THUMBNAIL, turn }) : ''),
    [layout, turn],
  );

  return (
    <div
      // The words under it name the design; the drawing is the same thing said again.
      aria-hidden
      // The drawing is replaced every frame while it turns, so the pointer
      // must never be over the drawing itself: a press on an element that is
      // gone by the release is no click, and a pointer whose last resting
      // place was taken away is never seen to leave. Let it fall through to
      // the button around it, which stays put.
      className="pointer-events-none w-full shrink-0 overflow-hidden bg-card"
      style={{ height: THUMBNAIL.height }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
