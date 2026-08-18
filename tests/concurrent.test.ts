import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/ids.js';
import { createApp } from '../src/server/app.js';
import {
  ClientRepository,
  ConcurrentEditError,
  PalletRepository,
} from '../src/server/repository.js';
import type { FileStore } from '../src/store/files.js';
import { fingerprint } from '../src/store/fingerprint.js';
import { StoreHandle } from '../src/store/handle.js';
import type { Client, Pallet } from '../src/types.js';
import { cleanupStores, loadFixture, tempStore } from './helpers.js';

/**
 * Two people with the same design open.
 *
 * The designs are files in a shared folder and there is no server between the
 * people editing them, so this cannot be prevented. What must not happen is the
 * quiet version of it: the second save going through as though the first had
 * never been made.
 */

describe('the fingerprint of a design', () => {
  const design = loadFixture('block-1000x800');

  it('survives a trip through JSON', () => {
    expect(fingerprint(JSON.parse(JSON.stringify(design)))).toBe(fingerprint(design));
  });

  it('does not care what order the keys are written in', () => {
    const shuffled = Object.fromEntries(Object.entries(design).reverse());
    expect(fingerprint(shuffled)).toBe(fingerprint(design));
  });

  /** A key that is absent and a key set to undefined are the same document. */
  it('treats a missing field and an undefined one alike', () => {
    expect(fingerprint({ ...design, notAField: undefined })).toBe(fingerprint(design));
  });

  it('changes when anything about the design changes', () => {
    expect(fingerprint({ ...design, palletName: 'something else' })).not.toBe(fingerprint(design));
    expect(fingerprint({ ...design, overallLength: 1234 })).not.toBe(fingerprint(design));
  });
});

describe('saving a design somebody else has saved', () => {
  let folder: FileStore;
  let pallets: PalletRepository;
  let clients: ClientRepository;
  let acme: Client;

  beforeEach(() => {
    folder = tempStore();
    pallets = new PalletRepository(folder);
    clients = new ClientRepository(folder);
    acme = clients.create('ACME Logistics');
  });

  afterEach(cleanupStores);

  const design = (code: string): Pallet => ({
    ...loadFixture('block-1000x800'),
    id: newId(),
    palletCode: code,
    clientId: acme.id,
    clientName: acme.name,
  });

  it('goes through when nobody else has', () => {
    const saved = pallets.save(design('AP-100'), clients);
    const again = pallets.save({ ...saved, palletName: 'reworked' }, clients, fingerprint(saved));
    expect(again.palletName).toBe('reworked');
  });

  it('is refused when the folder holds a version this editor never saw', () => {
    const mine = pallets.save(design('AP-101'), clients);
    const basedOn = fingerprint(mine);

    // A colleague, through Drive, between the design being opened and saved.
    pallets.save({ ...mine, palletName: 'theirs' }, clients);

    expect(() => pallets.save({ ...mine, palletName: 'mine' }, clients, basedOn)).toThrow(
      ConcurrentEditError,
    );
    // And theirs is still what the folder holds.
    expect(pallets.get(mine.id).palletName).toBe('theirs');
  });

  /** Saying nothing about what it was based on means overwrite, as before. */
  it('goes through anyway when no version is named', () => {
    const mine = pallets.save(design('AP-102'), clients);
    pallets.save({ ...mine, palletName: 'theirs' }, clients);

    pallets.save({ ...mine, palletName: 'mine' }, clients);
    expect(pallets.get(mine.id).palletName).toBe('mine');
  });

  /** A design the folder has never held cannot be clashing with anything. */
  it('does not refuse a design that is new to the folder', () => {
    const fresh = design('AP-103');
    expect(() => pallets.save(fresh, clients, 'whatever-was-here')).not.toThrow();
  });
});

describe('the same over the API', () => {
  let server: Server;
  let base: string;
  let clientId: string;

  beforeAll(async () => {
    const app = createApp(new StoreHandle(tempStore().root));
    server = await new Promise<Server>((done) => {
      const listening = app.listen(0, () => done(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const created = await call('POST', '/api/clients', { name: 'Demo Client' });
    clientId = (created.body as { id: string }).id;
  });

  afterAll(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    cleanupStores();
  });

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      ...(body === undefined
        ? { headers }
        : {
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify(body),
          }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as any) : null };
  }

  async function stored(code: string) {
    const made = await call('POST', '/api/pallets', {
      ...loadFixture('block-1000x800'),
      id: `api-${code}`,
      palletCode: code,
      clientId,
    });
    return made.body as Pallet;
  }

  it('takes the save when the version named is the one held', async () => {
    const mine = await stored('AP-200');
    const { status } = await call(
      'PUT',
      `/api/pallets/${mine.id}`,
      { ...mine, palletName: 'reworked' },
      { 'if-match': fingerprint(mine) },
    );
    expect(status).toBe(200);
  });

  it('refuses it, and says why, when somebody else has saved', async () => {
    const mine = await stored('AP-201');
    const basedOn = fingerprint(mine);
    await call('PUT', `/api/pallets/${mine.id}`, { ...mine, palletName: 'theirs' });

    const { status, body } = await call(
      'PUT',
      `/api/pallets/${mine.id}`,
      { ...mine, palletName: 'mine' },
      { 'if-match': basedOn },
    );
    expect(status).toBe(409);
    expect(body.staleEdit).toBe(true);
    expect(body.error).toMatch(/Somebody else saved this design/);

    // Refused means refused: theirs is untouched.
    const held = await call('GET', `/api/pallets/${mine.id}`);
    expect((held.body as Pallet).palletName).toBe('theirs');
  });

  /** How the editor goes ahead once whoever is at the keyboard has said so. */
  it('takes the save when it is sent again without naming a version', async () => {
    const mine = await stored('AP-202');
    const basedOn = fingerprint(mine);
    await call('PUT', `/api/pallets/${mine.id}`, { ...mine, palletName: 'theirs' });

    expect(
      (await call('PUT', `/api/pallets/${mine.id}`, { ...mine, palletName: 'mine' }, { 'if-match': basedOn }))
        .status,
    ).toBe(409);
    expect(
      (await call('PUT', `/api/pallets/${mine.id}`, { ...mine, palletName: 'mine' })).status,
    ).toBe(200);

    const held = await call('GET', `/api/pallets/${mine.id}`);
    expect((held.body as Pallet).palletName).toBe('mine');
  });
});
