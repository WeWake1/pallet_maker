import { readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  BUILT_IN_CHOICES,
  CHOICE_FIELDS,
  ChoiceError,
  choiceLabel,
  emptyChoices,
  isOwnWords,
  MAX_CHOICE_LENGTH,
  MAX_SAVED_CHOICES,
  settleWords,
  withChoice,
  withoutChoice,
} from '../src/choices.js';
import { computeLayout } from '../src/geometry/layout.js';
import { parseLibrary } from '../src/library.js';
import { parsePallet } from '../src/schema.js';
import { createApp } from '../src/server/app.js';
import { backupLibrary } from '../src/server/backup.js';
import { exportLibrary, importLibrary } from '../src/server/library.js';
import { ChoiceRepository, ClientRepository, PalletRepository } from '../src/server/repository.js';
import { sheetContent } from '../src/sheet/content.js';
import { CHOICES_FILE } from '../src/store/files.js';
import { cleanupStores, loadFixture, tempHandle, tempStore } from './helpers.js';

/**
 * Type, deck, entry and planing: a list to pick from, the design's own words
 * where nothing on it fits, and what the company has added to each list.
 */

describe('a list attribute', () => {
  it('prints a built-in choice as its label, and words as they were typed', () => {
    expect(choiceLabel('palletType', 'block_4way')).toBe('4-way');
    expect(choiceLabel('palletType', 'stringer_2way')).toBe('2-way');
    expect(choiceLabel('palletType', 'plywood')).toBe('Plywood pallet');
    expect(choiceLabel('deckType', 'single_face')).toBe('Single face');
    expect(choiceLabel('palletType', 'Collar pallet')).toBe('Collar pallet');
    // Words that happen to name something on every object are still words.
    expect(choiceLabel('planing', 'constructor')).toBe('constructor');
    expect(choiceLabel('entry', 'toString')).toBe('toString');
  });

  it('tells words of the design’s own from a code, a blank and n/a', () => {
    expect(isOwnWords('palletType', 'Euro')).toBe(true);
    expect(isOwnWords('palletType', 'block_4way')).toBe(false);
    expect(isOwnWords('palletType', '')).toBe(false);
    expect(isOwnWords('palletType', '  ')).toBe(false);
    expect(isOwnWords('palletType', 'na')).toBe(false);
    expect(isOwnWords('palletType', 'NA')).toBe(false);
  });

  it('takes typed words that already name a choice as that choice', () => {
    expect(settleWords('palletType', ' 4-way ', [])).toBe('block_4way');
    expect(settleWords('palletType', 'plywood PALLET', [])).toBe('plywood');
    expect(settleWords('entry', '4-way', [])).toBe('4_way');
    expect(settleWords('planing', 'none', [])).toBe('none');
    expect(settleWords('palletType', 'euro', ['Euro'])).toBe('Euro');
    expect(settleWords('deckType', ' Na ', [])).toBe('na');
    expect(settleWords('palletType', '  Collar pallet  ', [])).toBe('Collar pallet');
  });

  it('no longer offers Block, Stringer, the plywood types, Wing or Other', () => {
    expect(BUILT_IN_CHOICES.palletType.map(([, label]) => label)).toEqual([
      '4-way',
      '2-way',
      'Plywood pallet',
    ]);
  });
});

describe('a design written before the type list changed', () => {
  const base = loadFixture('block-1000x800') as unknown as Record<string, unknown>;
  const read = (palletType: string) => parsePallet({ ...base, palletType }).palletType;

  it('reads the three plywood types as the one', () => {
    expect(read('plywood_type1')).toBe('plywood');
    expect(read('plywood_type2')).toBe('plywood');
    expect(read('plywood_type3')).toBe('plywood');
  });

  it('keeps Wing and Other as its own words, so its sheet prints what it did', () => {
    expect(read('wing')).toBe('Wing');
    expect(read('other')).toBe('Other');
    const pallet = parsePallet({ ...base, palletType: 'wing' });
    const rows = sheetContent(pallet, computeLayout(pallet)).overall;
    expect(rows).toContainEqual(['Type', 'Wing']);
  });

  it('is not changed again by being read a second time', () => {
    const once = parsePallet({ ...base, palletType: 'wing' });
    expect(parsePallet(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('keeps the codes it still offers as they were', () => {
    expect(read('block_4way')).toBe('block_4way');
    expect(read('stringer_2way')).toBe('stringer_2way');
    expect(read('')).toBe('');
    expect(read('na')).toBe('na');
  });
});

describe('words of the design’s own', () => {
  const pallet = loadFixture('block-1000x800');
  const layout = computeLayout(pallet);

  it('are taken by all four attributes and printed as typed', () => {
    const own = parsePallet({
      ...pallet,
      palletType: 'Collar pallet',
      deckType: 'Open deck',
      entry: '3-way',
      planing: 'Top face only',
    });
    const content = sheetContent(own, layout);
    expect(content.overall).toContainEqual(['Type', 'Collar pallet']);
    expect(content.overall).toContainEqual(['Deck', 'Open deck']);
    expect(content.overall).toContainEqual(['Entry', '3-way']);
    expect(content.material).toContainEqual(['Planing', 'Top face only']);
  });

  it('still take the row off for na, however it was typed', () => {
    const content = sheetContent({ ...pallet, palletType: 'NA', planing: ' na ' }, layout);
    expect(content.overall.map(([label]) => label)).not.toContain('Type');
    expect(content.material.map(([label]) => label)).not.toContain('Planing');
  });
});

describe('a company’s own entries on a list', () => {
  it('are added once, whichever way they are spelled', () => {
    let lists = withChoice(emptyChoices(), 'palletType', '  Euro ');
    expect(lists.palletType).toEqual(['Euro']);
    lists = withChoice(lists, 'palletType', 'EURO');
    expect(lists.palletType).toEqual(['Euro']);
    lists = withChoice(lists, 'palletType', 'Collar');
    expect(lists.palletType).toEqual(['Euro', 'Collar']);
    // Each list is its own.
    expect(lists.deckType).toEqual([]);
  });

  it('are never a second copy of a built-in choice', () => {
    const lists = emptyChoices();
    expect(withChoice(lists, 'palletType', '4-way')).toBe(lists);
    expect(withChoice(lists, 'entry', 'partial 4-way')).toBe(lists);
    expect(withChoice(lists, 'planing', '4_side')).toBe(lists);
  });

  it('refuse nothing, n/a, and words too long to print', () => {
    expect(() => withChoice(emptyChoices(), 'palletType', '   ')).toThrow(ChoiceError);
    expect(() => withChoice(emptyChoices(), 'palletType', 'na')).toThrow(ChoiceError);
    expect(() => withChoice(emptyChoices(), 'palletType', 'x'.repeat(MAX_CHOICE_LENGTH + 1))).toThrow(
      ChoiceError,
    );
  });

  it('stop at a list’s worth', () => {
    let lists = emptyChoices();
    for (let i = 0; i < MAX_SAVED_CHOICES; i += 1) lists = withChoice(lists, 'deckType', `Deck ${i}`);
    expect(() => withChoice(lists, 'deckType', 'One more')).toThrow(ChoiceError);
  });

  it('come off without touching anything else', () => {
    const lists = withChoice(withChoice(emptyChoices(), 'entry', 'Side only'), 'entry', 'Front only');
    expect(withoutChoice(lists, 'entry', 'Side only').entry).toEqual(['Front only']);
    expect(withoutChoice(lists, 'entry', 'Not there').entry).toEqual(['Side only', 'Front only']);
  });
});

describe('the lists in the store', () => {
  afterEach(() => cleanupStores());

  it('are empty until something is added, and kept in a file of their own', () => {
    const store = tempStore();
    const choices = new ChoiceRepository(store);
    expect(choices.get()).toEqual(emptyChoices());

    choices.add('palletType', 'Euro');
    choices.add('planing', 'Top face only');
    const written = JSON.parse(readFileSync(join(store.root, CHOICES_FILE), 'utf8'));
    expect(written.palletType).toEqual(['Euro']);
    expect(written.planing).toEqual(['Top face only']);

    expect(choices.remove('palletType', 'Euro').palletType).toEqual([]);
  });

  it('drop an entry they would not take, and keep the rest of the file', () => {
    const store = tempStore();
    writeFileSync(
      join(store.root, CHOICES_FILE),
      JSON.stringify({ palletType: ['Euro', '', 'x'.repeat(MAX_CHOICE_LENGTH + 1), 7, 'Collar'] }),
    );
    const choices = new ChoiceRepository(store);
    expect(choices.get().palletType).toEqual(['Euro', 'Collar']);
    expect(choices.get().entry).toEqual([]);
    expect(choices.add('palletType', 'Skid').palletType).toEqual(['Euro', 'Collar', 'Skid']);
  });

  it('read a damaged file as no lists rather than failing', () => {
    const store = tempStore();
    writeFileSync(join(store.root, CHOICES_FILE), '{ not json');
    expect(new ChoiceRepository(store).get()).toEqual(emptyChoices());
    expect(store.lastProblems().map((problem) => problem.file)).toContain(CHOICES_FILE);
  });

  it('go out with the library, and come back in added to what is there', () => {
    const here = tempStore();
    const hereChoices = new ChoiceRepository(here);
    hereChoices.add('palletType', 'Euro');
    hereChoices.add('deckType', 'Open deck');
    const file = parseLibrary(
      JSON.parse(
        JSON.stringify(exportLibrary(new PalletRepository(here), new ClientRepository(here), hereChoices)),
      ),
    );
    expect(file.choices?.palletType).toEqual(['Euro']);

    const there = tempStore();
    const thereChoices = new ChoiceRepository(there);
    thereChoices.add('palletType', 'Collar');
    importLibrary(there, file, new PalletRepository(there), new ClientRepository(there));
    expect(thereChoices.get().palletType).toEqual(['Collar', 'Euro']);
    expect(thereChoices.get().deckType).toEqual(['Open deck']);
  });

  it('are in every snapshot taken of the library', () => {
    const store = tempStore();
    new ChoiceRepository(store).add('entry', 'Side only');
    const snapshot = parseLibrary(JSON.parse(readFileSync(backupLibrary(store), 'utf8')));
    expect(snapshot.choices?.entry).toEqual(['Side only']);
  });

  it('leave a library file without any alone', () => {
    const store = tempStore();
    const file = exportLibrary(new PalletRepository(store), new ClientRepository(store));
    expect(file).not.toHaveProperty('choices');
    expect(parseLibrary(JSON.parse(JSON.stringify(file))).choices).toBeUndefined();
  });
});

describe('the lists over the API', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = createApp(tempHandle());
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    cleanupStores();
  });

  async function call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
  }

  it('starts every list empty', async () => {
    const got = await call('GET', '/api/choices');
    expect(got.status).toBe(200);
    expect(Object.keys(got.body ?? {}).sort()).toEqual([...CHOICE_FIELDS].sort());
  });

  it('adds to a list and takes off it, answering with all four', async () => {
    const added = await call('POST', '/api/choices/palletType', { value: 'Euro' });
    expect(added.status).toBe(200);
    expect(added.body?.palletType).toEqual(['Euro']);

    const odd = 'Half / half & more?';
    expect((await call('POST', '/api/choices/deckType', { value: odd })).body?.deckType).toEqual([odd]);
    const removed = await call('DELETE', `/api/choices/deckType?value=${encodeURIComponent(odd)}`);
    expect(removed.status).toBe(200);
    expect(removed.body?.deckType).toEqual([]);
    expect(removed.body?.palletType).toEqual(['Euro']);
  });

  it('says what it will not take, and that a list it does not have is not there', async () => {
    const empty = await call('POST', '/api/choices/palletType', { value: '  ' });
    expect(empty.status).toBe(400);
    expect(String(empty.body?.error)).toMatch(/nothing to add/i);
    expect((await call('POST', '/api/choices/species', { value: 'Oak' })).status).toBe(404);
    expect((await call('DELETE', '/api/choices/species?value=Oak')).status).toBe(404);
  });
});
