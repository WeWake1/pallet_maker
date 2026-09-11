import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePallet } from '../src/schema.js';
import { hashPassword } from '../src/server/auth.js';
import { FileStore } from '../src/store/files.js';
import { StoreHandle } from '../src/store/handle.js';
import { Registry } from '../src/tenancy/registry.js';
import type { Role, Tenant, User } from '../src/tenancy/registry.js';
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

/** The same, behind the handle the API is built on. */
export function tempHandle(): StoreHandle {
  return new StoreHandle(tempStore().root);
}

export function cleanupStores(): void {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true });
}

/**
 * A folder that is not there, standing for Drive not running or an unplugged
 * disk. Made and then taken away, so the path is a real one that has gone.
 */
export function missingStoreRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pallet-gone-'));
  rmSync(root, { recursive: true, force: true });
  return root;
}

/* ------------------------------------------------ companies and the door */

/**
 * A registry with nothing in it, and a data folder for the companies it will
 * hold. Both are taken away again by `cleanupStores`.
 */
export function tempDataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pallet-data-'));
  temporary.push(root);
  return root;
}

export function tempRegistry(): Registry {
  const held = new Registry(':memory:');
  registries.push(held);
  return held;
}

const registries: Registry[] = [];

export function closeRegistries(): void {
  for (const held of registries.splice(0)) {
    try {
      held.close();
    } catch {
      // Already closed by whatever was being tested.
    }
  }
}

/**
 * A company with somebody in it who can sign in.
 *
 * The password is set straight into the registry rather than through an
 * invitation, because most tests are about what happens after somebody is in
 * rather than about how they got there.
 */
export async function seedTenant(
  registry: Registry,
  options: { slug?: string; name?: string; timezone?: string; email?: string; role?: Role; password?: string } = {},
): Promise<{ tenant: Tenant; user: User; password: string }> {
  const slug = options.slug ?? 'acme';
  const password = options.password ?? 'correct horse battery';
  const tenant = registry.createTenant({
    slug,
    name: options.name ?? `${slug} pallets`,
    timezone: options.timezone ?? 'UTC',
  });
  const user = registry.createUser({
    tenantId: tenant.id,
    email: options.email ?? `${slug}@example.test`,
    name: 'Someone',
    role: options.role ?? 'admin',
  });
  registry.setPassword(user.id, await hashPassword(password));
  return { tenant, user, password };
}

/** Somebody who looks after the service rather than belonging to a company. */
export async function seedVendor(
  registry: Registry,
  options: { email?: string; password?: string } = {},
): Promise<{ user: User; password: string }> {
  const password = options.password ?? 'correct horse battery';
  const user = registry.createUser({
    tenantId: null,
    email: options.email ?? 'owner@vendor.test',
    role: 'vendor',
  });
  registry.setPassword(user.id, await hashPassword(password));
  return { user, password };
}

/** The header the editor sends on everything that changes something. */
export const EDITOR_HEADER = { 'x-requested-with': 'pallet-editor' };

/** Sign in, and hand back the cookie to send with everything after. */
export async function signIn(base: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...EDITOR_HEADER },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`could not sign in as ${email}: ${response.status}`);
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('signing in set no cookie');
  return cookie.split(';')[0]!;
}
