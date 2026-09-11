import { LOGO } from '../sheet/layout.js';
import { esc } from '../render/svg.js';
import type { Brand } from './types.js';

/**
 * Putting a brand on a sheet.
 *
 * Both presenters of the sheet need the same three things — the face, the
 * mark, and how big the mark is — and they need them in two different
 * languages: CSS and an `<img>` for the browser, a placed `<g>` or `<image>`
 * for the SVG. Working them out twice is how the two drift apart, so they are
 * worked out once here.
 */

/** Fallbacks for anywhere the company's face does not arrive. */
export const FALLBACK_FONT_STACK = `'Helvetica Neue', Helvetica, Arial, sans-serif`;

/** The face the watermark is set in on the printed sheet. */
export function watermarkFontStack(brand: Brand): string {
  return brand.font ? `'${brand.font.family}', ${FALLBACK_FONT_STACK}` : FALLBACK_FONT_STACK;
}

/**
 * The `@font-face` rule, or nothing.
 *
 * The face travels inside the document as a data URI: the sheet is handed to
 * the printer, and to the browser, as one self-contained string with no base
 * URL to resolve a file path against, so a linked face would simply not be
 * there.
 */
export function fontFaceCss(brand: Brand): string {
  if (!brand.font) return '';
  return `@font-face {
    font-family: '${brand.font.family}';
    src: url('${brand.font.dataUri}') format('${brand.font.format}');
    font-weight: normal;
    font-style: normal;
  }`;
}

/**
 * How big the mark prints, in millimetres.
 *
 * As tall as the footer band, unless that would make it wider than the corner
 * has room for — a wordmark three times as wide as it is tall is given the
 * width and takes the height that follows.
 */
export function logoBox(brand: Brand): { width: number; height: number } | null {
  if (brand.logo.kind === 'none') return null;
  const aspect = brand.logo.width / brand.logo.height;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;

  let height = LOGO.height;
  let width = height * aspect;
  if (width > LOGO.maxWidth) {
    width = LOGO.maxWidth;
    height = width / aspect;
  }
  return { width, height };
}

/** The mark for the printed sheet, sized by the stylesheet's `.logo` rule. */
export function logoHtml(brand: Brand): string {
  const logo = brand.logo;
  if (logo.kind === 'none' || !logoBox(brand)) return '';

  if (logo.kind === 'raster') {
    return `<img class="logo" src="${logo.dataUri}" alt="${esc(brand.companyName)}">`;
  }
  const title = brand.companyName === '' ? '' : `<title>${esc(brand.companyName)}</title>`;
  return (
    `<svg class="logo" role="img" xmlns="http://www.w3.org/2000/svg"` +
    ` viewBox="0 0 ${logo.width} ${logo.height}">` +
    title +
    logo.svg +
    `</svg>`
  );
}

/**
 * The mark for the SVG sheet, placed and scaled into the corner.
 *
 * A vector mark becomes a `<g>` of the shapes it is made of, which is what
 * keeps the file takeable-apart in a page-layout program. A raster one becomes
 * the single `<image>` such a file is otherwise free of — the cost of a company
 * whose logo only exists as a picture, and theirs alone.
 */
export function logoSvgFragment(
  brand: Brand,
  left: number,
  top: number,
  px: (mm: number) => number,
  fmt: (value: number) => string,
): string {
  const logo = brand.logo;
  const box = logoBox(brand);
  if (logo.kind === 'none' || !box) return '';

  if (logo.kind === 'raster') {
    return (
      `<image x="${fmt(px(left))}" y="${fmt(px(top))}"` +
      ` width="${fmt(px(box.width))}" height="${fmt(px(box.height))}"` +
      ` preserveAspectRatio="xMaxYMax meet" href="${logo.dataUri}"/>`
    );
  }
  const scale = px(box.width) / logo.width;
  return (
    `<g transform="translate(${fmt(px(left))} ${fmt(px(top))}) scale(${fmt(scale)})">` +
    logo.svg +
    `</g>`
  );
}
