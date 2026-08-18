import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import { PalletRepository } from '../src/server/repository.js';
import { StoreUnavailableError } from '../src/store/files.js';
import { StoreHandle } from '../src/store/handle.js';
import {
  configuredStoreRoot,
  readSettings,
  rememberStoreRoot,
  settingsPath,
  writeSettings,
} from '../src/store/settings.js';
import { cleanupStores, missingStoreRoot, tempStore } from './helpers.js';

/**
 * Which folder the designs are in.
 *
 * Kept per machine rather than in the folder itself: several people point at
 * the same shared Drive folder, and Drive mounts somewhere different on each of
 * their laptops.
 */

let settingsDir: string;

beforeEach(() => {
  settingsDir = mkdtempSync(join(tmpdir(), 'pallet-settings-'));
  vi.stubEnv('PALLET_SETTINGS', settingsDir);
});

afterEach(() => {
  rmSync(settingsDir, { recursive: true, force: true });
  cleanupStores();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the settings file', () => {
  it('starts empty rather than missing', () => {
    expect(readSettings()).toEqual({});
    expect(configuredStoreRoot()).toBeUndefined();
  });

  it('remembers the folder, as an absolute path', () => {
    const store = tempStore();
    rememberStoreRoot(store.root);
    expect(configuredStoreRoot()).toBe(store.root);
  });

  it('does not live in the designs folder', () => {
    const store = tempStore();
    rememberStoreRoot(store.root);
    expect(settingsPath().startsWith(store.root)).toBe(false);
  });

  /**
   * Losing the settings costs one answer to one question. Refusing to start
   * because of it would cost the whole tool, so a file that will not parse is
   * treated as no file at all.
   */
  it('is ignored rather than fatal when it will not parse', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    writeFileSync(settingsPath(), '{ this is not json');
    expect(readSettings()).toEqual({});
  });

  it('keeps what else is in it when the folder changes', () => {
    writeSettings({ storeRoot: '/somewhere/old' });
    const store = tempStore();
    rememberStoreRoot(store.root);
    expect(JSON.parse(readFileSync(settingsPath(), 'utf8'))).toEqual({ storeRoot: store.root });
  });
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
    const handle = new StoreHandle(root, { source: 'settings' });

    expect(handle.ready()).toBe(false);
    expect(existsSync(root)).toBe(false);
    expect(handle.status().problem).toMatch(/no such folder/);
    expect(handle.status().root).toBe(root);
  });

  it('says so plainly to anything that wanted the designs', () => {
    const handle = new StoreHandle(missingStoreRoot(), { source: 'settings' });
    expect(() => handle.require()).toThrow(StoreUnavailableError);
    expect(() => new PalletRepository(() => handle.require()).list()).toThrow(/Cannot reach/);
  });

  it('makes the folder when somebody chooses one', () => {
    const root = missingStoreRoot();
    const handle = new StoreHandle(missingStoreRoot(), { source: 'settings' });

    expect(handle.use(root).ready).toBe(true);
    expect(existsSync(root)).toBe(true);
    expect(handle.require().root).toBe(root);
  });

  /** Drive started after the tool did. */
  it('takes the folder once it comes back', () => {
    const store = tempStore();
    const gone = join(store.root, 'not-yet');
    const handle = new StoreHandle(gone, { source: 'settings' });
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
   * Changing folders has to take effect at once. A repository that held on to
   * the old one would go on reading designs from a folder nobody is pointed at
   * any more.
   */
  it('sends work to the folder in use now, not the one it opened with', () => {
    const first = tempStore();
    const second = tempStore();
    const handle = new StoreHandle(first.root);
    const pallets = new PalletRepository(() => handle.require());

    expect(pallets.list()).toEqual([]);
    handle.use(second.root);
    expect(handle.require().root).toBe(second.root);
  });
});

describe('the settings over the API', () => {
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

  it('says which folder is in use', async () => {
    const store = tempStore();
    await serve(new StoreHandle(store.root));

    const { status, body } = await call('GET', '/api/settings');
    expect(status).toBe(200);
    expect(body.ready).toBe(true);
    expect(body.root).toBe(store.root);
  });

  /**
   * The one route that has to work when the designs cannot be reached. It is
   * what the editor asks when everything else is refusing, so that it can say
   * where it was looking instead of only that something went wrong.
   */
  it('answers even when the folder cannot be reached', async () => {
    const root = missingStoreRoot();
    await serve(new StoreHandle(root, { source: 'settings' }));

    const { status, body } = await call('GET', '/api/settings');
    expect(status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.root).toBe(root);
    expect(body.problem).toMatch(/no such folder/);
  });

  it('turns designs away with a status of their own while it cannot', async () => {
    await serve(new StoreHandle(missingStoreRoot(), { source: 'settings' }));

    const { status, body } = await call('GET', '/api/dashboard');
    expect(status).toBe(503);
    expect(body.storeUnavailable).toBe(true);
    expect(body.error).toMatch(/Cannot reach the designs folder/);
  });

  it('takes a new folder and remembers it', async () => {
    const chosen = missingStoreRoot();
    await serve(new StoreHandle(missingStoreRoot(), { source: 'settings' }));

    const { status, body } = await call('PUT', '/api/settings', { root: chosen });
    expect(status).toBe(200);
    expect(body.ready).toBe(true);
    expect(configuredStoreRoot()).toBe(chosen);

    // And the designs are reachable again straight away, without a restart.
    expect((await call('GET', '/api/dashboard')).status).toBe(200);
  });

  it('will not take an empty folder name', async () => {
    await serve(new StoreHandle(tempStore().root));
    expect((await call('PUT', '/api/settings', { root: '  ' })).status).toBe(400);
  });

  /** The environment variable is the more deliberate of the two, so it wins. */
  it('refuses to change the folder when the environment decided it', async () => {
    const store = tempStore();
    await serve(new StoreHandle(store.root, { source: 'environment' }));

    const { status, body } = await call('PUT', '/api/settings', { root: missingStoreRoot() });
    expect(status).toBe(409);
    expect(body.error).toMatch(/PALLET_STORE/);
    expect(configuredStoreRoot()).toBeUndefined();
  });

  it('looks again when asked, for a folder that has come back', async () => {
    const store = tempStore();
    const later = join(store.root, 'arrives-later');
    await serve(new StoreHandle(later, { source: 'settings' }));

    expect((await call('GET', '/api/settings')).body.ready).toBe(false);
    new StoreHandle(later, { create: true });
    expect((await call('POST', '/api/settings/retry')).body.ready).toBe(true);
  });
});
