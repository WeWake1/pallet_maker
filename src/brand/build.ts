#!/usr/bin/env node
/**
 * Check a brand file, and say what it comes out as.
 *
 *   npm run brand                       # the one that ships with the program
 *   npm run brand -- path/to/brand.json # somebody else's, before it goes in
 *
 * There is nothing to generate any more. The font used to be turned into a
 * committed TypeScript module holding it as base64, because the sheet is
 * handed to the printer with no base URL and a linked face would not be there.
 * It still travels that way, but it is read off the disk beside the designs
 * when the sheet is printed, so a company can change its own artwork without
 * anybody rebuilding anything.
 *
 * What is left is worth having: a brand file names artwork, and this says
 * whether the artwork is there, whether the logo is made of things a sheet can
 * carry, and how big the name will print.
 */
import { resolve } from 'node:path';
import { readBrand } from './resolve.js';
import { printedWatermarkSizePt, watermarkSizePt } from '../sheet/watermark.js';
import { logoBox } from './markup.js';

const path = resolve(process.cwd(), process.argv[2] ?? 'config/brand.json');

try {
  const { brand, marks } = readBrand(path);
  const box = logoBox(brand);

  console.log(`Brand file   ${path}`);
  console.log(`Company      ${brand.companyName || '(unnamed)'}`);
  console.log(
    `Logo         ${
      brand.logo.kind === 'none'
        ? 'none'
        : `${brand.logo.kind}, ${brand.logo.width} x ${brand.logo.height}` +
          (box ? `, prints ${box.width.toFixed(1)} x ${box.height.toFixed(1)} mm` : '')
    }`,
  );
  if (brand.logo.kind === 'raster') {
    console.log(
      '             note: a picture, so the SVG sheet carries one <image> and is not' +
        '\n             fully takeable-apart in a page-layout program. SVG avoids that.',
    );
  }
  console.log(
    `Font         ${brand.font ? `${brand.font.family}, ${brand.font.format}, ${Math.round(brand.font.dataUri.length / 1024)} kB embedded` : 'none (the sheet’s own sans)'}`,
  );
  if (brand.watermark.enabled) {
    const printed = printedWatermarkSizePt(brand.watermark.text, brand.font, brand.watermark.sizePt);
    console.log(`Watermark    "${brand.watermark.text}" at ${brand.watermark.opacity} opacity`);
    console.log(`             ${printed}pt printed, ${watermarkSizePt(brand.watermark.text)}pt in the SVG`);
  } else {
    console.log('Watermark    off');
  }
  console.log(`Projection   ${brand.projectionNote}`);
  console.log(`Tolerances   ${brand.tolerances.component} component, ${brand.tolerances.pallet} overall`);
  console.log(`Files read   ${marks.map((m) => m.path).join('\n             ')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
