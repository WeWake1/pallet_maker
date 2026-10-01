import { afterEach, describe, expect, it } from 'vitest';
import { dayMonthYear, endOfDay, isTimeZone, today } from '../src/ids.js';
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

describe('a day as it reads', () => {
  it('is day first on a sheet, and anything else is left alone', () => {
    expect(dayMonthYear('2026-08-06')).toBe('06-08-2026');
    expect(dayMonthYear('sometime')).toBe('sometime');
  });
});

describe('the end of a day', () => {
  it('is the last moment of it where the company is', () => {
    expect(endOfDay('2026-10-09', 'UTC')).toBe('2026-10-09T23:59:59.999Z');
    expect(endOfDay('2026-10-09', 'Asia/Kolkata')).toBe('2026-10-09T18:29:59.999Z');
  });

  it('follows the clocks on the day they change', () => {
    // New York falls back on 1 November 2026 and springs forward on 8 March.
    expect(endOfDay('2026-11-01', 'America/New_York')).toBe('2026-11-02T04:59:59.999Z');
    expect(endOfDay('2026-03-08', 'America/New_York')).toBe('2026-03-09T03:59:59.999Z');
    expect(endOfDay('2026-03-29', 'Europe/London')).toBe('2026-03-29T22:59:59.999Z');
  });

  it('is nothing for a day that is not one', () => {
    for (const day of ['2026-02-30', '2026-13-01', '9 Oct', '2026-10-9', '']) {
      expect(endOfDay(day, 'UTC'), day).toBeNull();
    }
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
