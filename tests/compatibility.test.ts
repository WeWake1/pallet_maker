import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analysePallet } from '../src/geometry/layout.js';
import { parsePallet } from '../src/schema.js';
import { renderSheet } from '../src/sheet/sheet.js';
import { renderSheetSvg } from '../src/sheet/svgSheet.js';
import { loadFixture } from './helpers.js';

/**
 * That designs already in the store keep opening.
 *
 * A design is a JSON document, read back through the schema every time it is
 * opened. That read is the one place where a change to this program can lose
 * somebody's work: make a field required that a stored document has not got,
 * and every design drawn before the change stops opening at once. The database
 * is untouched and the backups are fine, and none of that helps, because
 * nothing can read them any more.
 *
 * So the rule this file exists to enforce is: **a field added later must be
 * optional or have a default.** Two guards for it.
 *
 * The first is the snapshots in `fixtures/stored/`. Each is a document exactly
 * as a version of this program wrote it, frozen on the day it was written.
 * They are never edited. When the schema changes, these must still parse, still
 * lay out, and still print — and if they cannot, the change needs a migration
 * in `src/server/db.ts` before it can ship, the way the revisions change had
 * one.
 *
 * The second is `absent` below: the fields a stored document is allowed not to
 * carry. Taking one away must not stop a document parsing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const storedDir = resolve(here, '..', 'fixtures', 'stored');

function storedNames(): string[] {
  return readdirSync(storedDir).filter((name) => name.endsWith('.json'));
}

function readStored(name: string): unknown {
  return JSON.parse(readFileSync(join(storedDir, name), 'utf8'));
}

describe('designs written by an earlier version', () => {
  const names = storedNames();

  it('has snapshots to check against', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)('%s still parses', (name) => {
    const pallet = parsePallet(readStored(name));
    expect(pallet.layers.length).toBeGreaterThan(0);
  });

  it.each(names)('%s still lays out without error', (name) => {
    const layout = analysePallet(parsePallet(readStored(name)));
    expect(layout.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(layout.pieces.length).toBeGreaterThan(0);
  });

  it.each(names)('%s still prints, on paper and as vector', (name) => {
    const pallet = parsePallet(readStored(name));
    const layout = analysePallet(pallet);
    expect(renderSheet(pallet, layout)).toContain(pallet.palletName);
    expect(renderSheetSvg(pallet, layout)).toContain(pallet.palletName);
  });

  it.each(names)('%s is not quietly changed by being read', (name) => {
    // Parsing fills in defaults; parsing the result again must change nothing
    // further, or a design would drift a little every time it was opened.
    const once = parsePallet(readStored(name));
    const twice = parsePallet(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

/**
 * What a stored document is allowed not to carry, at the top level and inside a
 * layer's slots. Every one of these was either added after designs already
 * existed, or is a field the editor only writes when it has something to say.
 */
const absent = {
  pallet: [
    'palletCode',
    'clientPartNo',
    'overallHeight',
    'species',
    'staticLoadKg',
    'dynamicLoadKg',
    'nails',
    'nailPlacements',
    'notes',
    'note',
    'updatedAt',
  ],
  slot: ['joinedToPrev', 'nudgeMm', 'variant'],
  layer: ['spanMm', 'offsetMm', 'runSpanMm', 'runOffsetMm'],
} as const;

describe('a field this program added later', () => {
  const base = loadFixture('block-1000x800') as unknown as Record<string, unknown>;

  it.each(absent.pallet)('is optional: a document with no %s still parses', (field) => {
    const without = { ...base };
    delete without[field];
    expect(() => parsePallet(without)).not.toThrow();
  });

  it.each(absent.layer)('is optional on a layer: no %s still parses', (field) => {
    const without = {
      ...base,
      layers: (base.layers as Array<Record<string, unknown>>).map((layer) => {
        const copy = { ...layer };
        delete copy[field];
        return copy;
      }),
    };
    expect(() => parsePallet(without)).not.toThrow();
  });

  it.each(absent.slot)('is optional on a slot: no %s still parses', (field) => {
    const without = {
      ...base,
      layers: (base.layers as Array<Record<string, unknown>>).map((layer) => {
        const content = layer.content as Record<string, unknown>;
        if (content.type !== 'sequence') return layer;
        return {
          ...layer,
          content: {
            ...content,
            slots: (content.slots as Array<Record<string, unknown>>).map((slot) => {
              const copy = { ...slot };
              delete copy[field];
              return copy;
            }),
          },
        };
      }),
    };
    expect(() => parsePallet(without)).not.toThrow();
  });

  it('is dated today when the document has never been dated', () => {
    // An import, or a document from before the store stamped a date. Refusing
    // it would be refusing somebody's design over a field it never had.
    const without = { ...base };
    delete without.updatedAt;
    expect(parsePallet(without).updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
