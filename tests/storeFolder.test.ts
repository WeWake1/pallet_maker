import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { PalletRepository } from '../src/server/repository.js';
import { StoreUnavailableError } from '../src/store/files.js';
import { StoreHandle } from '../src/store/handle.js';
import { cleanupStores, missingStoreRoot, tempStore } from './helpers.js';

/**
 * Which folder the designs are in.
 *
 * Settled when the server starts — `PALLET_DATA_ROOT` hosted, `PALLET_STORE`
 * or the default folder locally — and never from a browser. What is left to
 * check is that the handle copes with a folder that is not there yet, and that
 * a hosted server keeps its own paths to itself.
 */

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'pallet-store-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
  cleanupStores();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the handle', () => {
  it('is ready when the folder is there', () => {
    const store = tempStore();
    const handle = new StoreHandle(store.root);
    expect(handle.ready()).toBe(true);
    expect(handle.status().root).toBe(store.root);
    expect(handle.status().designs).toBe(0);
  });

  /** Startup with a folder that has gone: reported, never invented. */
  it('is not ready, and makes nothing, when the folder has gone', () => {
    const root = missingStoreRoot();
    const handle = new StoreHandle(root, { source: 'default' });

    expect(handle.ready()).toBe(false);
    expect(existsSync(root)).toBe(false);
    expect(handle.status().problem).toMatch(/no such folder/);
    expect(handle.status().root).toBe(root);
  });

  it('says so plainly to anything that wanted the designs', () => {
    const handle = new StoreHandle(missingStoreRoot(), { source: 'default' });
    expect(() => handle.require()).toThrow(StoreUnavailableError);
    expect(() => new PalletRepository(() => handle.require()).list()).toThrow(/Cannot reach/);
  });

  it('makes the folder when it is told to, and not otherwise', () => {
    const root = missingStoreRoot();
    expect(new StoreHandle(root).ready()).toBe(false);
    expect(existsSync(root)).toBe(false);

    expect(new StoreHandle(root, { create: true }).ready()).toBe(true);
    expect(existsSync(root)).toBe(true);
  });

  /** Drive started after the tool did. */
  it('takes the folder once it comes back', () => {
    const store = tempStore();
    const gone = join(store.root, 'not-yet');
    const handle = new StoreHandle(gone, { source: 'default' });
    expect(handle.ready()).toBe(false);

    new StoreHandle(gone, { create: true });
    expect(handle.retry().ready).toBe(true);
  });

  it('reports where the folder was decided', () => {
    const store = tempStore();
    expect(new StoreHandle(store.root, { source: 'environment' }).status().source).toBe(
      'environment',
    );
    expect(new StoreHandle(store.root, { source: 'default' }).status().source).toBe('default');
  });

  /**
   * A repository asks the handle for its folder every time rather than holding
   * on to one, which is what lets a folder that comes back late be picked up
   * without anything restarting.
   */
  it('sends work to the folder the handle has now', () => {
    const store = tempStore();
    const gone = join(store.root, 'not-yet');
    const handle = new StoreHandle(gone, { source: 'default' });
    const pallets = new PalletRepository(() => handle.require());

    expect(() => pallets.list()).toThrow(StoreUnavailableError);
    new StoreHandle(gone, { create: true });
    handle.retry();
    expect(pallets.list()).toEqual([]);
  });
});

describe('the folder on a hosted server', () => {
  let server: Server;
  let base: string;

  async function serve(handle: StoreHandle): Promise<void> {
    const app = createApp(handle);
    server = await new Promise<Server>((done) => {
      const listening = app.listen(0, () => done(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  async function call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
  }

  afterEach(async () => {
    if (server) await new Promise<void>((done) => server.close(() => done()));
  });

  it('keeps its path to itself and says the folder cannot be changed', async () => {
    await serve(new StoreHandle(tempStore().root));
    const { status, body } = await call('GET', '/api/settings');
    expect(status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.root).toBeNull();
    expect(body.managedStore).toBe(true);
  });

  it('refuses to be pointed anywhere else', async () => {
    const store = tempStore();
    await serve(new StoreHandle(store.root));
    const elsewhere = missingStoreRoot();

    const moved = await call('PUT', '/api/settings', { root: elsewhere });
    expect(moved.status).toBe(403);
    expect(moved.body.error).toMatch(/cannot be changed/);
    expect(existsSync(elsewhere)).toBe(false);

    // The designs are still where they were.
    expect((await call('GET', '/api/dashboard')).status).toBe(200);
  });

  it('says the designs cannot be reached without naming a path on the server', async () => {
    const root = missingStoreRoot();
    await serve(new StoreHandle(root, { source: 'environment' }));

    const { status, body } = await call('GET', '/api/dashboard');
    expect(status).toBe(503);
    expect(body.storeUnavailable).toBe(true);
    expect(body.error).toMatch(/designs cannot be reached/);
    expect(body.error).not.toContain(root);
    // And the same on the one route that answers whatever else is wrong.
    expect((await call('GET', '/api/settings')).body.root).toBeNull();
  });

  it('still looks again when asked, for a disk that has come back', async () => {
    const store = tempStore();
    const later = join(store.root, 'arrives-later');
    await serve(new StoreHandle(later, { source: 'environment' }));
    expect((await call('GET', '/api/settings')).body.ready).toBe(false);
    new StoreHandle(later, { create: true });
    expect((await call('POST', '/api/settings/retry')).body.ready).toBe(true);
  });
});
