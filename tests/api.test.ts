import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { openDb } from '../src/server/db.js';
import type { Pallet } from '../src/types.js';
import { loadFixture } from './helpers.js';

/** The API, over a real socket, because that is how the editor will meet it. */
let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp(openDb(':memory:'));
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
  return { ...pallet, id: `test-${code}`, palletCode: code };
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

  it('answers 409 when asked to edit a published revision', async () => {
    const pallet = fixture('AP-102');
    await call('POST', '/api/pallets', pallet);
    await call('POST', `/api/pallets/${pallet.id}/freeze`, {});

    const refused = await call('PUT', `/api/pallets/${pallet.id}`, {
      ...pallet,
      frozen: true,
      palletName: 'meddled',
    });
    expect(refused.status).toBe(409);

    const revised = await call('POST', `/api/pallets/${pallet.id}/revise`, {});
    expect(revised.status).toBe(201);
    expect(revised.body).toMatchObject({ revision: 'B', supersedes: pallet.id, frozen: false });
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
    expect(html).toContain('Rev A');
  });

  it('copies a design into one that is linked to nothing', async () => {
    const pallet = fixture('AP-105');
    await call('POST', '/api/pallets', pallet);
    const copy = await call('POST', `/api/pallets/${pallet.id}/duplicate`, {});
    expect(copy.status).toBe(201);
    expect((copy.body as Pallet).id).not.toBe(pallet.id);
    expect((copy.body as Pallet).supersedes).toBeUndefined();
  });

  it('deletes a draft and refuses to delete a publication', async () => {
    const draft = fixture('AP-106');
    await call('POST', '/api/pallets', draft);
    expect((await call('DELETE', `/api/pallets/${draft.id}`)).status).toBe(204);

    const published = fixture('AP-107');
    await call('POST', '/api/pallets', published);
    await call('POST', `/api/pallets/${published.id}/freeze`, {});
    expect((await call('DELETE', `/api/pallets/${published.id}`)).status).toBe(409);
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

  it('serves the DXF as a download named for the revision', async () => {
    const pallet = fixture('AP-110');
    await call('POST', '/api/pallets', pallet);
    const response = await fetch(`${base}/api/pallets/${pallet.id}/drawing.dxf`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('AP-110-rev-A.dxf');
    const dxf = await response.text();
    expect(dxf).toContain('AC1009');
    expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true);
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

  it('gives the history of a design, oldest first', async () => {
    const pallet = fixture('AP-108');
    await call('POST', '/api/pallets', pallet);
    await call('POST', `/api/pallets/${pallet.id}/freeze`, {});
    await call('POST', `/api/pallets/${pallet.id}/revise`, {});

    const history = await call('GET', `/api/pallets/${pallet.id}/history`);
    expect((history.body as Array<{ revision: string }>).map((row) => row.revision)).toEqual([
      'A',
      'B',
    ]);
  });
});
