import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Panes and buttons of glass, for the sign-in screens.
 *
 * Two grades of it. Everywhere, the pane is frosted: what is behind it blurs
 * and brightens, and a rim of light runs round the edge. In Chromium — Chrome
 * and Edge, which is what most people here use — it also bends what is behind
 * it near the edge, the way a thick slab with a rounded rim would: an SVG
 * displacement filter run as a backdrop filter, which no other engine draws
 * yet. Safari and Firefox take the frosted pane and lose nothing else.
 *
 * The styles are in styles.css, under "Glass".
 */

/**
 * Chrome, Edge and the rest of Chromium all say `Chrome/` in their user agent;
 * nothing else does — on iOS every browser is WebKit, and says `CriOS`.
 */
const refracts = typeof navigator !== 'undefined' && /Chrome\/\d/.test(navigator.userAgent);

/**
 * How far in from the edge the glass bends, and how hard. Found by looking:
 * much more and the dots at the rim smear into streaks, much less and the
 * pane is only a frosted card.
 */
const BEZEL = 26;
const BEND = 56;
/** Red, green and blue bend by slightly different amounts: a faint fringe. */
const SPREAD = 2;

/**
 * Which way, and how far, to look for what shows through each point.
 *
 * Red runs left to right and blue top to bottom, so near an edge each points
 * outward, and the rim shows what is just beyond it, squeezed in — as at the
 * edge of a lens. A grey slab over the middle, softened at its edge, says
 * "straight through" everywhere but the rim.
 */
function displacementMap(width: number, height: number, radius: number): string {
  const inset = BEZEL;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    '<defs>' +
    '<linearGradient id="x" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#f00"/></linearGradient>' +
    '<linearGradient id="y" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#00f"/></linearGradient>' +
    `<filter id="soft"><feGaussianBlur stdDeviation="${BEZEL / 2.9}"/></filter>` +
    '</defs>' +
    `<rect width="${width}" height="${height}" fill="url(#x)"/>` +
    `<rect width="${width}" height="${height}" fill="url(#y)" style="mix-blend-mode:screen"/>` +
    `<rect x="${inset}" y="${inset}" width="${Math.max(0, width - 2 * inset)}" height="${Math.max(0, height - 2 * inset)}" ` +
    `rx="${Math.max(0, radius - inset)}" fill="#808080" filter="url(#soft)"/>` +
    '</svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** The colour matrix that keeps one channel and drops the other two. */
const ONLY = {
  red: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  green: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  blue: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
};

/** One colour channel of what is behind, bent by its own amount. */
function Channel({ channel, scale }: { channel: keyof typeof ONLY; scale: number }) {
  return (
    <>
      <feDisplacementMap in="SourceGraphic" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="B" />
      <feColorMatrix type="matrix" values={ONLY[channel]} result={channel} />
    </>
  );
}

export function GlassPane({ children, className = '' }: { children: ReactNode; className?: string }) {
  const pane = useRef<HTMLDivElement>(null);
  const filter = `glass-${useId().replace(/[^\w-]/g, '')}`;
  const [size, setSize] = useState<{ width: number; height: number; radius: number } | null>(null);

  // The map has to be the pane's own size, so it is redrawn when that changes —
  // when a problem is shown under the form, say.
  useLayoutEffect(() => {
    const element = pane.current;
    if (!refracts || !element) return;
    const measure = () => {
      const width = Math.round(element.offsetWidth);
      const height = Math.round(element.offsetHeight);
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
      setSize((was) => (was && was.width === width && was.height === height && was.radius === radius ? was : { width, height, radius }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const bent = refracts && size !== null && size.width > 0 && size.height > 0;
  return (
    <div
      ref={pane}
      className={`glass ${className}`}
      style={bent ? { backdropFilter: `url(#${filter}) blur(1.5px) saturate(1.7) brightness(1.04)` } : undefined}
    >
      {bent && (
        <svg aria-hidden="true" width="0" height="0" className="pointer-events-none absolute">
          {/* sRGB, or the map's mid-grey is not read as the middle and the
              whole pane shifts. */}
          <filter id={filter} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feImage
              href={displacementMap(size.width, size.height, size.radius)}
              x="0"
              y="0"
              width={size.width}
              height={size.height}
              preserveAspectRatio="none"
              result="map"
            />
            <Channel channel="red" scale={BEND} />
            <Channel channel="green" scale={BEND + SPREAD} />
            <Channel channel="blue" scale={BEND + 2 * SPREAD} />
            <feBlend in="red" in2="green" mode="screen" result="redgreen" />
            <feBlend in="redgreen" in2="blue" mode="screen" />
          </filter>
        </svg>
      )}
      {children}
    </div>
  );
}

/**
 * A button made of the same glass: blue for the one that does the thing, clear
 * for anything else. Full width — on these screens there is only ever one.
 */
export function GlassButton({
  children,
  tone = 'plain',
  disabled,
  submit = false,
  onClick,
}: {
  children: ReactNode;
  tone?: 'plain' | 'primary';
  disabled?: boolean;
  /** Submit the form it sits in; see Button in ui.tsx for why that matters. */
  submit?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={submit ? 'submit' : 'button'}
      disabled={disabled}
      onClick={onClick}
      className={`glass-button glass-button--${tone}`}
    >
      <span className="relative">{children}</span>
    </button>
  );
}
