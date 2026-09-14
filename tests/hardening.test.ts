import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app.js';
import type { AppOptions } from '../src/server/app.js';
import type { RequestLog } from '../src/server/log.js';
import { usePrinter } from '../src/sheet/pdf.js';
import { PrinterBusyError } from '../src/sheet/pooledPrinter.js';
import { StoreHandle } from '../src/store/handle.js';
import { cleanupStores, loadFixture, missingStoreRoot, tempHandle } from './helpers.js';

/**
 * What a server on the internet has to do that a tool on a laptop never did:
 * say whether it is well, say how its answers may be used, name every request,
 * take only as much as a request could honestly need, and keep what went wrong
 * on its side for the log.
 */

const here = dirname(fileURLToPath(import.meta.url));

let server: Server | undefined;
let base = '';
let staticDir: string;

async function serve(handle: StoreHandle, options: AppOptions = {}): Promise<void> {
  const app = createApp(handle, { staticDir, ...options });
  server = await new Promise<Server>((done) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, headers: response.headers, text, body: json };
}

/** A client and a design of theirs, as the editor would have made them. */
async function savedDesign(): Promise<{ id: string }> {
  const client = (await call('POST', '/api/clients', { name: 'Acme Ltd' })).body;
  const pallet = { ...loadFixture('block-1000x800'), clientId: client.id, clientName: client.name };
  return (await call('POST', '/api/pallets', pallet)).body;
}

beforeEach(() => {
  staticDir = mkdtempSync(join(tmpdir(), 'pallet-editor-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>editor</title>');
});

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  rmSync(staticDir, { recursive: true, force: true });
  cleanupStores();
  vi.restoreAllMocks();
});

describe('/healthz', () => {
  it('says yes when the designs can be reached, and reports the printer', async () => {
    await serve(tempHandle(), { version: '9.9.9', health: () => ({ printer: { running: false } }) });
    const { status, body, headers } = await call('GET', '/healthz');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.version).toBe('9.9.9');
    expect(body.store.ready).toBe(true);
    expect(body.printer).toEqual({ running: false });
    expect(headers.get('cache-control')).toContain('no-store');
  });

  it('says no, with a status a monitor understands, when they cannot', async () => {
    await serve(new StoreHandle(missingStoreRoot(), { source: 'settings' }));
    const { status, body } = await call('GET', '/healthz');
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.store.problem).toMatch(/no such folder/);
  });
});

describe('what every answer says about itself', () => {
  it('carries the security headers, and a policy only on pages', async () => {
    await serve(tempHandle());
    const page = await call('GET', '/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(page.headers.get('x-powered-by')).toBeNull();

    // Data is not a page: a policy on it would only get in a viewer's way.
    const data = await call('GET', '/api/dashboard');
    expect(data.headers.get('content-security-policy')).toBeNull();
    expect(data.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('puts the policy on the printable sheet, which a browser renders', async () => {
    await serve(tempHandle());
    const design = await savedDesign();
    const sheet = await call('GET', `/api/pallets/${design.id}/sheet.html`);
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get('content-security-policy')).toContain("font-src 'self' data:");
    const pdfLike = await call('GET', `/api/pallets/${design.id}/design.json`);
    expect(pdfLike.headers.get('content-security-policy')).toBeNull();
  });

  it('names every request, and writes it down once answered', async () => {
    const lines: RequestLog[] = [];
    await serve(tempHandle(), { log: (entry) => lines.push(entry) });
    const { headers } = await call('GET', '/api/clients');
    const id = headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise((done) => setTimeout(done, 20));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ requestId: id, method: 'GET', path: '/api/clients', status: 200 });
    expect(lines[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it('writes nothing down when nobody asked for a log', async () => {
    const wrote = vi.spyOn(process.stdout, 'write');
    await serve(tempHandle());
    await call('GET', '/api/clients');
    expect(wrote).not.toHaveBeenCalled();
  });
});

describe('what a request may carry', () => {
  it('turns away a body far bigger than a design could be', async () => {
    await serve(tempHandle());
    const { status, body } = await call('POST', '/api/clients', { name: 'x'.repeat(3_000_000) });
    expect(status).toBe(413);
    expect(body.error).toMatch(/more than this server takes/);
  });

  it('takes a whole library, which is bigger', async () => {
    await serve(tempHandle());
    const { status, body } = await call('POST', '/api/library/import', {
      library: { padding: 'x'.repeat(3_000_000) },
    });
    // Past the parser, and judged as a document rather than as a size.
    expect(status).toBe(400);
    expect(body.error).toMatch(/Invalid library/);
  });

  it('says when the body is not JSON', async () => {
    await serve(tempHandle());
    const { status, body } = await call('POST', '/api/clients', '{ not json', {
      'content-type': 'application/json',
    });
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });
});

describe('when something goes wrong on the server', () => {
  it('says so with an id, and keeps the detail for the log', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await serve(tempHandle(), {
      allowFolderChange: true,
      chooseFolder: async () => {
        throw new Error('ENOSPC on /srv/secret-volume');
      },
    });
    const { status, body, headers } = await call('POST', '/api/settings/browse');
    expect(status).toBe(500);
    expect(body.error).not.toContain('secret');
    expect(body.requestId).toBe(headers.get('x-request-id'));
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0]![0])).toContain(body.requestId);
  });

  it('asks for the sheet again shortly when every printer is busy', async () => {
    await serve(tempHandle());
    const design = await savedDesign();
    usePrinter(async () => {
      throw new PrinterBusyError(20);
    });
    const { status, headers, body } = await call('GET', `/api/pallets/${design.id}/sheet.pdf`);
    expect(status).toBe(503);
    expect(headers.get('retry-after')).toBe('5');
    expect(body.error).toMatch(/waiting to print/);
  });
});

/**
 * Whose drawing the server prints, and whether the editor is told the same.
 *
 * The editor renders the sheet itself for its preview, so the two have to
 * agree: a preview under one name and a printout under another is the sort of
 * thing nobody notices until a customer does.
 */
describe('the brand the server prints with', () => {
  const brandsDir = resolve(here, 'fixtures', 'brands');

  it('comes from the designs folder when there is one there', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'pallet-brandstore-'));
    cpSync(join(brandsDir, 'vector'), folder, { recursive: true });
    await serve(new StoreHandle(folder));

    const { status, body } = await call('GET', '/api/brand');
    expect(status).toBe(200);
    expect(body.companyName).toBe('Northgate Pallets Ltd');
    expect(body.projectionNote).toContain('Third-angle');
    expect(body.logo.kind).toBe('svg');

    // And the sheet the server prints says the same.
    const design = await savedDesign();
    const sheet = await call('GET', `/api/pallets/${design.id}/sheet.html`);
    expect(sheet.text).toContain('Northgate Pallets Ltd');
    expect(sheet.text).toContain('Third-angle projection');
    rmSync(folder, { recursive: true, force: true });
  });

  it('is the one shipped with the program when the folder has none', async () => {
    await serve(tempHandle(), { brandPath: resolve(here, '..', 'config', 'brand.json') });
    const { body } = await call('GET', '/api/brand');
    expect(body.companyName).toBe('Ambica Patterns India Pvt Ltd');
    expect((await call('GET', '/api/settings')).body.brandFrom).toBe('built-in');
  });

  it('carries no name at all when nothing says one', async () => {
    await serve(tempHandle());
    const { body } = await call('GET', '/api/brand');
    expect(body.companyName).toBe('');
    expect(body.watermark.enabled).toBe(false);
    expect(body.logo.kind).toBe('none');
  });

  it('says so on the settings when a folder brand will not read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const folder = mkdtempSync(join(tmpdir(), 'pallet-brandstore-'));
    cpSync(join(brandsDir, 'broken'), folder, { recursive: true });
    await serve(new StoreHandle(folder));

    const { body } = await call('GET', '/api/settings');
    expect(body.brandFrom).toBe('built-in');
    expect(body.brandProblem).toMatch(/could not be read/);
    rmSync(folder, { recursive: true, force: true });
  });
});
