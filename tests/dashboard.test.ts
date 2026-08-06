import { describe, expect, it } from 'vitest';
import { visibleSections } from '../src/editor/Dashboard.jsx';
import type { ClientDesigns, PalletSummary } from '../src/server/repository.js';

/**
 * What the library shows, given what has been typed in the search box and how
 * the cards have been asked to be ordered. Both are how a shelf of a few
 * hundred designs is got at, so both are worth being sure of.
 */

function design(fields: Partial<PalletSummary> & { id: string }): PalletSummary {
  return {
    clientId: 'c1',
    clientName: 'Acme Packing',
    palletCode: '',
    palletName: '',
    updatedAt: '2026-01-01',
    ...fields,
  };
}

const acme: ClientDesigns = {
  client: { id: 'c1', name: 'Acme Packing', createdAt: '2025-01-01' },
  designs: [
    design({ id: 'a', palletCode: 'AP-001', palletName: 'Export crate base', updatedAt: '2026-03-04' }),
    design({ id: 'b', palletCode: 'AP-002', palletName: 'Heavy block pallet', updatedAt: '2026-08-01' }),
    design({ id: 'c', palletCode: 'AP-003', palletName: 'Plywood deck', updatedAt: '2026-03-04' }),
  ],
};

const quiet: ClientDesigns = {
  client: { id: 'c2', name: 'Quiet Client Ltd', createdAt: '2025-06-01' },
  designs: [],
};

const sections = [acme, quiet];

const ids = (result: ClientDesigns[]): string[][] =>
  result.map((section) => section.designs.map((d) => d.id));

describe('ordering', () => {
  it('puts the most recently edited first', () => {
    expect(ids(visibleSections(sections, '', 'recent'))).toEqual([['b', 'a', 'c'], []]);
  });

  it('falls back to the code when two were edited the same day', () => {
    // The store stamps a date, not a time, so a day's work is one bucket and
    // the code is what tells those apart.
    const [first] = visibleSections(sections, '', 'recent');
    expect(first!.designs.slice(1).map((d) => d.palletCode)).toEqual(['AP-001', 'AP-003']);
  });

  it('leaves the store order alone when asked for code and name', () => {
    expect(ids(visibleSections(sections, '', 'name'))).toEqual([['a', 'b', 'c'], []]);
  });
});

describe('searching', () => {
  it('finds a design by its name, whatever the case', () => {
    expect(ids(visibleSections(sections, 'PLYWOOD', 'name'))).toEqual([['c']]);
  });

  it('finds a design by its code', () => {
    expect(ids(visibleSections(sections, 'ap-002', 'name'))).toEqual([['b']]);
  });

  it('finds every design of a client named in the search', () => {
    expect(ids(visibleSections(sections, 'acme', 'name'))).toEqual([['a', 'b', 'c']]);
  });

  it('drops the clients with nothing that answers', () => {
    // Quiet Client Ltd has no designs, so a search must not leave an empty
    // heading standing between the results.
    expect(visibleSections(sections, 'crate', 'name').map((s) => s.client.id)).toEqual(['c1']);
  });

  it('gives nothing at all when nothing answers', () => {
    expect(visibleSections(sections, 'nothing like this', 'name')).toEqual([]);
  });

  it('ignores the space around what was typed', () => {
    expect(ids(visibleSections(sections, '  crate  ', 'name'))).toEqual([['a']]);
  });

  it('keeps every client, designs or not, when nothing is being searched for', () => {
    expect(visibleSections(sections, '', 'name').map((s) => s.client.id)).toEqual(['c1', 'c2']);
    expect(visibleSections(sections, '   ', 'name').map((s) => s.client.id)).toEqual(['c1', 'c2']);
  });

  it('still orders what it found', () => {
    expect(ids(visibleSections(sections, 'acme', 'recent'))).toEqual([['b', 'a', 'c']]);
  });
});

describe('the sections it hands back', () => {
  it('never reorders the array it was given', () => {
    const before = acme.designs.map((d) => d.id);
    visibleSections(sections, '', 'recent');
    expect(acme.designs.map((d) => d.id)).toEqual(before);
  });
});
