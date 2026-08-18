import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { Pallet } from '../src/types.js';
import { cleanupStores, loadFixture, tempHandle } from './helpers.js';

/** The API, over a real socket, because that is how the editor will meet it. */
let server: Server;
let base: string;
let clientId: string;

beforeAll(async () => {
  const app = createApp(tempHandle());
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Every design belongs to a client, so there has to be one first.
  const created = await call('POST', '/api/clients', { name: 'Demo Client' });
  clientId = (created.body as { id: string }).id;
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
  return {
    status: response.status,
    body: text ? (JSON.parse(text) as unknown) : null,
    type: response.headers.get('content-type') ?? '',
  };
}

function fixture(code: string): Pallet {
  const pallet = loadFixture('block-1000x800');
  return { ...pallet, id: `test-${code}`, palletCode: code, clientId };
}

describe('the API', () => {
  it('saves, lists and reads back a design', async () => {
    const created = await call('POST', '/api/pallets', fixture('AP-100'));
    expect(created.status).toBe(201);

    const listed = await call('GET', '/api/pallets');
    expect(listed.status).toBe(200);
    expect((listed.body as Array<{ palletCode: string }>).map((row) => row.palletCode)).toContain(
      'AP-100',
    );

    const read = await call('GET', '/api/pallets/test-AP-100');
    expect(read.status).toBe(200);
    expect((read.body as Pallet).palletCode).toBe('AP-100');
  });

  it('saves a design that has no pallet code yet', async () => {
    // A design is drawn, saved and printed long before the shop has a code to
    // give it. Refusing to save one without a code only ever meant a
    // placeholder was typed in and never corrected.
    const created = await call('POST', '/api/pallets', {
      ...fixture('AP-101'),
      id: 'test-uncoded',
      palletCode: '',
    });
    expect(created.status).toBe(201);

    const read = await call('GET', '/api/pallets/test-uncoded');
    expect(read.status).toBe(200);
    expect((read.body as Pallet).palletCode).toBe('');

    // And it can still be printed, which is the point of saving it.
    const sheet = await fetch(`${base}/api/pallets/test-uncoded/sheet.html`);
    expect(sheet.status).toBe(200);
    expect(await sheet.text()).toContain('</html>');
  });

  it('answers 404 for a design that is not there', async () => {
    expect((await call('GET', '/api/pallets/nothing')).status).toBe(404);
  });

  it('answers 400 for a document that is not a pallet', async () => {
    const response = await call('POST', '/api/pallets', { id: 'broken' });
    expect(response.status).toBe(400);
    expect(String((response.body as { error: string }).error)).toContain('Invalid pallet document');
  });

  it('answers 400 when the address and the document disagree about the id', async () => {
    await call('POST', '/api/pallets', fixture('AP-101'));
    const response = await call('PUT', '/api/pallets/somewhere-else', fixture('AP-101'));
    expect(response.status).toBe(400);
  });

  it('overwrites on save, keeping one row and nothing of what was there', async () => {
    const pallet = fixture('AP-102');
    await call('POST', '/api/pallets', pallet);
    const saved = await call('PUT', `/api/pallets/${pallet.id}`, {
      ...pallet,
      palletName: 'reworked',
    });
    expect(saved.status).toBe(200);

    const read = await call('GET', `/api/pallets/${pallet.id}`);
    expect((read.body as Pallet).palletName).toBe('reworked');
    const listed = (await call('GET', '/api/pallets')).body as Array<{ id: string }>;
    expect(listed.filter((row) => row.id === pallet.id)).toHaveLength(1);
  });

  it('answers 404 for a design filed under a client that does not exist', async () => {
    const orphan = { ...fixture('AP-112'), clientId: 'nobody' };
    expect((await call('POST', '/api/pallets', orphan)).status).toBe(404);
  });

  it('answers 422 rather than printing a sheet that would be wrong', async () => {
    const broken = fixture('AP-103');
    const layer = broken.layers[0]!;
    if (layer.content.type === 'sequence') {
      layer.content.slots = layer.content.slots.map((slot) => ({ ...slot, width: 400 }));
    }
    await call('POST', '/api/pallets', broken);

    const response = await call('GET', `/api/pallets/${broken.id}/sheet.pdf`);
    expect(response.status).toBe(422);
    expect(String((response.body as { error: string }).error)).toContain('over-full');
  });

  it('serves the sheet as HTML for a design that is sound', async () => {
    const pallet = fixture('AP-104');
    await call('POST', '/api/pallets', pallet);
    const response = await fetch(`${base}/api/pallets/${pallet.id}/sheet.html`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('First-angle projection');
    // The title block carries the date the store stamped, not anything typed.
    expect(html).toContain(new Date().toISOString().slice(0, 10));
  });

  it('lets no browser keep a stale copy of a document', async () => {
    // Every document is generated from the design as it stands right now. A
    // cached one would print a drawing of a pallet nobody is building.
    const pallet = fixture('AP-111');
    await call('POST', '/api/pallets', pallet);
    for (const path of ['sheet.html', 'drawing.dxf', 'sheet.svg']) {
      const response = await fetch(`${base}/api/pallets/${pallet.id}/${path}`);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });

  it('copies a design into one that is linked to nothing', async () => {
    const pallet = fixture('AP-105');
    await call('POST', '/api/pallets', pallet);
    const copy = await call('POST', `/api/pallets/${pallet.id}/duplicate`, {});
    expect(copy.status).toBe(201);
    expect((copy.body as Pallet).id).not.toBe(pallet.id);
    // A copy is how an old design is kept, so it stays with the same client.
    expect((copy.body as Pallet).clientId).toBe(clientId);
  });

  it('deletes any design, and says so when it is already gone', async () => {
    const design = fixture('AP-106');
    await call('POST', '/api/pallets', design);
    expect((await call('DELETE', `/api/pallets/${design.id}`)).status).toBe(204);
    expect((await call('DELETE', `/api/pallets/${design.id}`)).status).toBe(404);
  });

  it('serves the rates, so the editor costs at the same numbers the server does', async () => {
    const response = await call('GET', '/api/rates');
    expect(response.status).toBe(200);
    const rates = response.body as { timberPerCft: Record<string, number>; currency: string };
    expect(rates.timberPerCft['default']).toBeGreaterThan(0);
    expect(rates.currency).toBeTruthy();
  });

  it('costs a stored design', async () => {
    const pallet = fixture('AP-109');
    await call('POST', '/api/pallets', pallet);
    const response = await call('GET', `/api/pallets/${pallet.id}/costing`);
    expect(response.status).toBe(200);
    const costing = response.body as { cft: number; total: number; materials: unknown[] };
    expect(costing.cft).toBeGreaterThan(0);
    expect(costing.total).toBeGreaterThan(0);
    expect(costing.materials).toHaveLength(1);
  });

  // Named for the design, the client and the date, so that a file that has left
  // this program can be found again among other people's.
  it('serves the DXF as a download named for the design, its client and its date', async () => {
    const pallet = { ...fixture('AP-110'), palletName: 'Export crate base' };
    await call('POST', '/api/pallets', pallet);
    const response = await fetch(`${base}/api/pallets/${pallet.id}/drawing.dxf`);
    expect(response.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    expect(response.headers.get('content-disposition')).toContain(
      `filename="Export crate base - Demo Client - ${today}.dxf"`,
    );
    const dxf = await response.text();
    expect(dxf).toContain('AC1009');
    expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true);
  });

  it('serves the whole sheet as an SVG download, for a drawing program', async () => {
    const pallet = fixture('AP-112');
    await call('POST', '/api/pallets', pallet);
    const response = await fetch(`${base}/api/pallets/${pallet.id}/sheet.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    const today = new Date().toISOString().slice(0, 10);
    expect(response.headers.get('content-disposition')).toContain(
      `filename="${pallet.palletName} - Demo Client - ${today}.svg"`,
    );

    const svg = await response.text();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    // The whole sheet, not only the drawing: the written column is on it too.
    expect(svg).toContain('Ambica Patterns India Pvt Ltd');
    expect(svg).toContain('Overall size');
  });

  it('refuses an SVG of a design that does not lay out', async () => {
    const broken = fixture('AP-113');
    const layer = broken.layers[0]!;
    if (layer.content.type === 'sequence') {
      layer.content.slots = layer.content.slots.map((slot) => ({ ...slot, width: 400 }));
    }
    await call('POST', '/api/pallets', broken);
    expect((await call('GET', `/api/pallets/${broken.id}/sheet.svg`)).status).toBe(422);
  });

  it('refuses a DXF of a design that does not lay out', async () => {
    const broken = fixture('AP-111');
    const layer = broken.layers[0]!;
    if (layer.content.type === 'sequence') {
      layer.content.slots = layer.content.slots.map((slot) => ({ ...slot, width: 400 }));
    }
    await call('POST', '/api/pallets', broken);
    expect((await call('GET', `/api/pallets/${broken.id}/drawing.dxf`)).status).toBe(422);
  });

  it('gives the dashboard as clients with their designs', async () => {
    const empty = await call('POST', '/api/clients', { name: 'Nobody Yet Ltd' });
    expect(empty.status).toBe(201);

    const response = await call('GET', '/api/dashboard');
    expect(response.status).toBe(200);
    const sections = response.body as Array<{
      client: { id: string; name: string };
      designs: unknown[];
    }>;

    const demo = sections.find((section) => section.client.id === clientId)!;
    expect(demo.designs.length).toBeGreaterThan(0);
    // A client with nothing drawn for them still gets a section of their own.
    const blank = sections.find((section) => section.client.name === 'Nobody Yet Ltd')!;
    expect(blank.designs).toEqual([]);
  });

  it('refuses a second client of the same name', async () => {
    expect((await call('POST', '/api/clients', { name: 'Demo Client' })).status).toBe(409);
    expect((await call('POST', '/api/clients', { name: '  ' })).status).toBe(400);
  });

  it('renames a client onto every design of theirs', async () => {
    const made = await call('POST', '/api/clients', { name: 'Renameable Ltd' });
    const id = (made.body as { id: string }).id;
    const design = { ...fixture('AP-113'), clientId: id };
    await call('POST', '/api/pallets', design);

    expect((await call('PATCH', `/api/clients/${id}`, { name: 'Renamed Ltd' })).status).toBe(200);
    expect((await call('GET', `/api/pallets/${design.id}`)).body).toMatchObject({
      clientName: 'Renamed Ltd',
    });
  });

  it('deletes a client and their designs with them', async () => {
    const made = await call('POST', '/api/clients', { name: 'Departing Ltd' });
    const id = (made.body as { id: string }).id;
    const design = { ...fixture('AP-114'), clientId: id };
    await call('POST', '/api/pallets', design);

    expect((await call('DELETE', `/api/clients/${id}`)).status).toBe(204);
    expect((await call('GET', `/api/pallets/${design.id}`)).status).toBe(404);
  });

  // The design itself rather than a picture of it: the only download that can
  // be opened again and worked on, and so the only one worth keeping.
  it('downloads a design as the document it is', async () => {
    const design = fixture('AP-120');
    await call('POST', '/api/pallets', design);

    const response = await fetch(`${base}/api/pallets/${design.id}/design.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain('.json');
    expect(((await response.json()) as Pallet).palletCode).toBe('AP-120');
  });

  it('imports a design as a new one of the named client’s', async () => {
    const design = fixture('AP-121');
    await call('POST', '/api/pallets', design);

    const imported = await call('POST', '/api/pallets/import', { pallet: design, clientId });
    expect(imported.status).toBe(201);

    // A new design, not a claim on the one already held under that id.
    const added = imported.body as Pallet;
    expect(added.id).not.toBe(design.id);
    expect((await call('GET', `/api/pallets/${design.id}`)).status).toBe(200);
  });

  it('refuses an import that does not say whose design it is', async () => {
    expect((await call('POST', '/api/pallets/import', { pallet: fixture('AP-122') })).status).toBe(
      400,
    );
    expect(
      (await call('POST', '/api/pallets/import', { pallet: { no: 'good' }, clientId })).status,
    ).toBe(400);
  });

  it('downloads the whole library as one file', async () => {
    const response = await fetch(`${base}/api/library.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('pallet-library-');

    const library = (await response.json()) as { clients: unknown[]; designs: unknown[] };
    expect(library.clients.length).toBeGreaterThan(0);
    expect(library.designs.length).toBeGreaterThan(0);
  });

  /**
   * Reading back what this same store wrote. Nothing is new and nothing is
   * overwritten, which is what makes an import run twice by accident harmless.
   */
  it('reads a library file back in without overwriting anything', async () => {
    const library = await (await fetch(`${base}/api/library.json`)).json();

    const response = await call('POST', '/api/library/import', { library });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ designsAdded: 0, designsReplaced: 0 });
    expect((response.body as { designsSkipped: number }).designsSkipped).toBeGreaterThan(0);
  });

  it('refuses a file that is not a library', async () => {
    const response = await call('POST', '/api/library/import', { library: { designs: [] } });
    expect(response.status).toBe(400);
    expect((response.body as { error: string }).error).toContain('Invalid library');
  });
});
