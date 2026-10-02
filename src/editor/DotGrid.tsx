import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { InertiaPlugin } from 'gsap/InertiaPlugin';

gsap.registerPlugin(InertiaPlugin);

/**
 * A field of dots that light up near the pointer and scatter from it.
 *
 * After React Bits' DotGrid (reactbits.dev/backgrounds/dot-grid), with the
 * same physics — a dot is thrown, slows against `resistance`, and springs home
 * — and two changes. It draws only while something is moving, where theirs
 * redrew every dot sixty times a second for as long as the page was open,
 * which is a laptop's battery spent on a picture standing still. And for
 * somebody whose system asks for less motion the dots stay put: they still
 * light up under the pointer, which is colour, not movement.
 *
 * Behind everything and never in the way: the canvas takes no clicks, and
 * listens on the window instead.
 */

type Dot = { cx: number; cy: number; xOffset: number; yOffset: number; thrown: boolean };

function rgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match ? [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)] : [0, 0, 0];
}

export default function DotGrid({
  dotSize = 10,
  gap = 15,
  baseColor = '#cbd5e1',
  activeColor = '#2563eb',
  proximity = 120,
  speedTrigger = 100,
  shockRadius = 250,
  shockStrength = 5,
  maxSpeed = 5000,
  resistance = 750,
  returnDuration = 1.5,
  className = '',
}: {
  dotSize?: number;
  gap?: number;
  /** Six-digit hex, both: the two are blended between. */
  baseColor?: string;
  activeColor?: string;
  /** How near the pointer a dot has to be to light up or be thrown. */
  proximity?: number;
  /** Pixels a second the pointer has to be moving to throw anything. */
  speedTrigger?: number;
  shockRadius?: number;
  shockStrength?: number;
  maxSpeed?: number;
  resistance?: number;
  /** Seconds a dot takes to spring home. */
  returnDuration?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const base = rgb(baseColor);
    const active = rgb(activeColor);
    const radius = dotSize / 2;
    let width = 0;
    let height = 0;
    let dots: Dot[] = [];
    // Far off until the pointer is first seen, so nothing is lit before then.
    const pointer = { x: -1e5, y: -1e5, lastX: 0, lastY: 0, lastTime: 0 };
    let frame = 0;

    const draw = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      ctx.clearRect(0, 0, width, height);
      // Every unlit dot in one path and one fill; only the few near the
      // pointer, each its own shade, are filled one at a time.
      const lit: Dot[] = [];
      ctx.beginPath();
      for (const dot of dots) {
        const dx = dot.cx - pointer.x;
        const dy = dot.cy - pointer.y;
        if (dx * dx + dy * dy < proximity * proximity) {
          lit.push(dot);
          continue;
        }
        const x = dot.cx + dot.xOffset;
        const y = dot.cy + dot.yOffset;
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.fillStyle = baseColor;
      ctx.fill();
      for (const dot of lit) {
        const t = 1 - Math.hypot(dot.cx - pointer.x, dot.cy - pointer.y) / proximity;
        const [r, g, b] = base.map((channel, i) => Math.round(channel + (active[i]! - channel) * t));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.arc(dot.cx + dot.xOffset, dot.cy + dot.yOffset, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const redraw = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    const layout = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const cell = dotSize + gap;
      const cols = Math.floor((width + gap) / cell);
      const rows = Math.floor((height + gap) / cell);
      const startX = (width - (cell * cols - gap)) / 2 + radius;
      const startY = (height - (cell * rows - gap)) / 2 + radius;
      gsap.killTweensOf(dots);
      dots = [];
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          dots.push({ cx: startX + col * cell, cy: startY + row * cell, xOffset: 0, yOffset: 0, thrown: false });
        }
      }
      // Now rather than next frame: resizing the canvas has just cleared it.
      draw();
    };

    /** Send a dot off at this many pixels a second, and bring it back. */
    const thrown = (dot: Dot, vx: number, vy: number) => {
      dot.thrown = true;
      gsap.killTweensOf(dot);
      gsap.to(dot, {
        inertia: { xOffset: vx, yOffset: vy, resistance },
        onUpdate: redraw,
        onComplete: () => {
          gsap.to(dot, {
            xOffset: 0,
            yOffset: 0,
            duration: returnDuration,
            ease: 'elastic.out(1,0.75)',
            onUpdate: redraw,
          });
          dot.thrown = false;
        },
      });
    };

    // Speed is measured over at least 50ms: between two consecutive mouse
    // events it is mostly noise.
    const fling = (event: PointerEvent) => {
      const now = performance.now();
      if (now - pointer.lastTime < 50) return;
      const dt = pointer.lastTime ? now - pointer.lastTime : 16;
      let vx = ((event.clientX - pointer.lastX) / dt) * 1000;
      let vy = ((event.clientY - pointer.lastY) / dt) * 1000;
      let speed = Math.hypot(vx, vy);
      if (speed > maxSpeed) {
        vx *= maxSpeed / speed;
        vy *= maxSpeed / speed;
        speed = maxSpeed;
      }
      pointer.lastTime = now;
      pointer.lastX = event.clientX;
      pointer.lastY = event.clientY;
      if (speed <= speedTrigger) return;
      for (const dot of dots) {
        if (dot.thrown || Math.hypot(dot.cx - pointer.x, dot.cy - pointer.y) >= proximity) continue;
        thrown(dot, dot.cx - pointer.x + vx * 0.005, dot.cy - pointer.y + vy * 0.005);
      }
    };

    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      redraw();
      if (!still) fling(event);
    };

    const onLeave = () => {
      pointer.x = pointer.y = -1e5;
      redraw();
    };

    const onClick = (event: MouseEvent) => {
      if (still) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      for (const dot of dots) {
        const distance = Math.hypot(dot.cx - x, dot.cy - y);
        if (dot.thrown || distance >= shockRadius) continue;
        const falloff = 1 - distance / shockRadius;
        thrown(dot, (dot.cx - x) * shockStrength * falloff, (dot.cy - y) * shockStrength * falloff);
      }
    };

    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(canvas);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('click', onClick);
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('click', onClick);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      gsap.killTweensOf(dots);
    };
  }, [
    dotSize,
    gap,
    baseColor,
    activeColor,
    proximity,
    speedTrigger,
    shockRadius,
    shockStrength,
    maxSpeed,
    resistance,
    returnDuration,
  ]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
