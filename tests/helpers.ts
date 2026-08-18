import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePallet } from '../src/schema.js';
import { FileStore } from '../src/store/files.js';
import type { Layout, PlacedPiece } from '../src/geometry/types.js';
import type { Pallet } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): Pallet {
  const path = resolve(here, '..', 'fixtures', `${name}.json`);
  return parsePallet(JSON.parse(readFileSync(path, 'utf8')));
}

export function piecesOf(layout: Layout, layerId: string): PlacedPiece[] {
  return layout.pieces.filter((p) => p.layerId === layerId);
}

export function layerOf(layout: Layout, layerId: string) {
  const layer = layout.layers.find((l) => l.layerId === layerId);
  if (!layer) throw new Error(`no layer "${layerId}" in layout`);
  return layer;
}

/** Round to 0.001 mm so expected values stay readable. */
export function round(values: number[]): number[] {
  return values.map((v) => Math.round(v * 1000) / 1000);
}

/**
 * An empty store in a temporary folder.
 *
 * The store is a folder of files rather than a database, so there is no
 * in-memory version of it to test against: every test that touches storage
 * touches a real disk. `cleanupStores` in an `afterEach` takes them away again.
 */
const temporary: string[] = [];

export function tempStore(): FileStore {
  const root = mkdtempSync(join(tmpdir(), 'pallet-store-'));
  temporary.push(root);
  return new FileStore(root);
}

export function cleanupStores(): void {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
}
