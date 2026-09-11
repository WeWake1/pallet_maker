import { afterEach, describe, expect, it } from 'vitest';
import { isTimeZone, today } from '../src/ids.js';
import { ClientRepository, PalletRepository } from '../src/server/repository.js';
import { cleanupStores, loadFixture, tempStore } from './helpers.js';

afterEach(cleanupStores);

describe('today', () => {
  it('is the ISO date in UTC when no zone is given', () => {
    expect(today()).toBe(new Date().toISOString().slice(0, 10));
  });

  it('is the date where the company is, in the same form', () => {
    const kolkata = today('Asia/Kolkata');
    expect(kolkata).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Kolkata is ahead of UTC, so its date is UTC's or the one after, never before.
    expect(kolkata >= today()).toBe(true);
    // The first zone to see a day and the last: never the other way round.
    expect(today('Pacific/Kiritimati') >= today('Pacific/Pago_Pago')).toBe(true);
  });

  it('knows a zone name from a made-up one', () => {
    expect(isTimeZone('Asia/Kolkata')).toBe(true);
    expect(isTimeZone('UTC')).toBe(true);
    expect(isTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});

describe('the repositories', () => {
  it('stamp what they write with the clock they are given', () => {
    const store = tempStore();
    const now = () => '2030-01-02';
    const clients = new ClientRepository(store, { now });
    const pallets = new PalletRepository(store, { now });

    const client = clients.create('Acme Ltd');
    expect(client.createdAt).toBe('2030-01-02');

    const saved = pallets.save(
      { ...loadFixture('block-1000x800'), clientId: client.id, clientName: client.name },
      clients,
    );
    expect(saved.updatedAt).toBe('2030-01-02');
  });
});
