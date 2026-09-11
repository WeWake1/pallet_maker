import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { currentTenant, NoTenantContextError, runInTenant } from '../src/tenancy/context.js';
import { Registry } from '../src/tenancy/registry.js';
import { Tenants } from '../src/tenancy/tenants.js';
import { PalletRepository } from '../src/server/repository.js';
import {
  cleanupStores,
  closeRegistries,
  EDITOR_HEADER,
  loadFixture,
  seedTenant,
  signIn,
  tempDataRoot,
  tempRegistry,
} from './helpers.js';

/**
 * One server, several companies, and no way from one to another.
 *
 * This is the whole of what makes it safe to put a second company's designs on
 * the same machine as the first, so it is checked at both ends: that the
 * folders really are separate, and that no route can be talked into reading
 * the wrong one.
 */

const SECRET = 'a-test-secret-of-at-least-thirty-two-characters';

let server: Server | undefined;
let base = '';
let staticDir: string;
let dataRoot: string;

async function serve(registry: Registry): Promise<Tenants> {
  const tenants = new Tenants(dataRoot, registry);
  const app = createApp(tenants, {
    staticDir,
    auth: { registry, secret: SECRET, secure: false, publicUrl: 'http://127.0.0.1' },
  });
  server = await new Promise<Server>((done) => {
    const listening = app.listen(0, '127.0.0.1', () => done(listening));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return tenants;
}

async function call(method: string, path: string, cookie: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      cookie,
      ...EDITOR_HEADER,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, text };
}

/** A client and a design of theirs, as that company's editor would save them. */
async function addDesign(cookie: string, clientName: string, palletName: string) {
  const client = (await call('POST', '/api/clients', cookie, { name: clientName })).body;
  const pallet = {
    ...loadFixture('block-1000x800'),
    id: `design-${palletName.replace(/\s+/g, '-')}`,
    clientId: client.id,
    clientName,
    palletName,
  };
  const saved = await call('POST', '/api/pallets', cookie, pallet);
  return { client, design: saved.body as { id: string } };
}

beforeEach(() => {
  staticDir = mkdtempSync(join(tmpdir(), 'pallet-editor-'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>editor</title>');
  dataRoot = tempDataRoot();
});

afterEach(async () => {
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  server = undefined;
  rmSync(staticDir, { recursive: true, force: true });
  cleanupStores();
  closeRegistries();
});

describe('two companies on one server', () => {
  it('keep their designs in folders of their own, named so a person can read them', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const northgate = await seedTenant(registry, { slug: 'northgate', email: 'n@northgate.test' });
    await serve(registry);

    const acmeCookie = await signIn(base, acme.user.email, acme.password);
    const northCookie = await signIn(base, northgate.user.email, northgate.password);
    await addDesign(acmeCookie, 'Biocon', 'Acme 1200');
    await addDesign(northCookie, 'Biocon', 'Northgate 1000');

    expect(existsSync(join(dataRoot, 'tenants', 'acme', 'designs'))).toBe(true);
    expect(existsSync(join(dataRoot, 'tenants', 'northgate', 'designs'))).toBe(true);

    const acmeClients = JSON.parse(readFileSync(join(dataRoot, 'tenants', 'acme', 'clients.json'), 'utf8'));
    const northClients = JSON.parse(readFileSync(join(dataRoot, 'tenants', 'northgate', 'clients.json'), 'utf8'));
    expect(acmeClients).toHaveLength(1);
    expect(northClients).toHaveLength(1);
    // The same customer, entered by both, is two records — as it should be:
    // they are two different relationships with the same firm.
    expect(acmeClients[0].id).not.toBe(northClients[0].id);
  }, 20_000);

  it('never see each other on the dashboard', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const northgate = await seedTenant(registry, { slug: 'northgate', email: 'n@northgate.test' });
    await serve(registry);

    const acmeCookie = await signIn(base, acme.user.email, acme.password);
    const northCookie = await signIn(base, northgate.user.email, northgate.password);
    await addDesign(acmeCookie, 'Biocon', 'Acme 1200');

    const acmeBoard = (await call('GET', '/api/dashboard', acmeCookie)).body;
    const northBoard = (await call('GET', '/api/dashboard', northCookie)).body;
    expect(acmeBoard).toHaveLength(1);
    expect(acmeBoard[0].designs[0].palletName).toBe('Acme 1200');
    expect(northBoard).toEqual([]);
  }, 20_000);

  /**
   * The one that matters. Knowing another company's design id must not be
   * enough to read it, and ids travel — in a download's file name, in a link
   * somebody pasted into an email.
   */
  it('cannot read each other\'s designs even knowing the id', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const northgate = await seedTenant(registry, { slug: 'northgate', email: 'n@northgate.test' });
    await serve(registry);

    const acmeCookie = await signIn(base, acme.user.email, acme.password);
    const northCookie = await signIn(base, northgate.user.email, northgate.password);
    const { design } = await addDesign(acmeCookie, 'Biocon', 'Acme 1200');

    expect((await call('GET', `/api/pallets/${design.id}`, acmeCookie)).status).toBe(200);
    for (const path of [
      `/api/pallets/${design.id}`,
      `/api/pallets/${design.id}/design.json`,
      `/api/pallets/${design.id}/sheet.html`,
      `/api/pallets/${design.id}/sheet.svg`,
      `/api/pallets/${design.id}/costing`,
      `/api/pallets/${design.id}/drawing.dxf`,
    ]) {
      expect((await call('GET', path, northCookie)).status, path).toBe(404);
    }
    expect((await call('DELETE', `/api/pallets/${design.id}`, northCookie)).status).toBe(404);
    expect((await call('POST', `/api/pallets/${design.id}/duplicate`, northCookie)).status).toBe(404);
    // And it is still there afterwards.
    expect((await call('GET', `/api/pallets/${design.id}`, acmeCookie)).status).toBe(200);
  }, 20_000);

  it('cannot take each other\'s whole library', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const northgate = await seedTenant(registry, { slug: 'northgate', email: 'n@northgate.test' });
    await serve(registry);

    const acmeCookie = await signIn(base, acme.user.email, acme.password);
    const northCookie = await signIn(base, northgate.user.email, northgate.password);
    await addDesign(acmeCookie, 'Biocon', 'Acme 1200');

    const theirs = await call('GET', '/api/library.json', northCookie);
    expect(theirs.status).toBe(200);
    expect(theirs.body.designs).toEqual([]);
    expect(theirs.text).not.toContain('Acme 1200');
  }, 20_000);

  it('keep their own prices and their own name on the sheet', async () => {
    const registry = tempRegistry();
    const acme = await seedTenant(registry, { slug: 'acme', email: 'a@acme.test' });
    const northgate = await seedTenant(registry, { slug: 'northgate', email: 'n@northgate.test' });
    await serve(registry);

    // Each company's folder is made when it is first used.
    const acmeCookie = await signIn(base, acme.user.email, acme.password);
    const northCookie = await signIn(base, northgate.user.email, northgate.password);
    await call('GET', '/api/dashboard', acmeCookie);
    await call('GET', '/api/dashboard', northCookie);

    writeFileSync(
      join(dataRoot, 'tenants', 'acme', 'brand.json'),
      JSON.stringify({ companyName: 'Acme Pallets Ltd' }),
    );
    writeFileSync(
      join(dataRoot, 'tenants', 'northgate', 'brand.json'),
      JSON.stringify({ companyName: 'Northgate Crates' }),
    );
    writeFileSync(
      join(dataRoot, 'tenants', 'acme', 'rates.json'),
      JSON.stringify({ currency: 'INR', timberPerCft: { default: 850 }, nailsPerThousand: { default: 900 } }),
    );
    writeFileSync(
      join(dataRoot, 'tenants', 'northgate', 'rates.json'),
      JSON.stringify({ currency: 'GBP', timberPerCft: { default: 40 }, nailsPerThousand: { default: 12 } }),
    );

    expect((await call('GET', '/api/brand', acmeCookie)).body.companyName).toBe('Acme Pallets Ltd');
    expect((await call('GET', '/api/brand', northCookie)).body.companyName).toBe('Northgate Crates');
    expect((await call('GET', '/api/rates', acmeCookie)).body.currency).toBe('INR');
    expect((await call('GET', '/api/rates', northCookie)).body.currency).toBe('GBP');

    const { design } = await addDesign(acmeCookie, 'Biocon', 'Acme 1200');
    const sheet = await call('GET', `/api/pallets/${design.id}/sheet.svg`, acmeCookie);
    expect(sheet.text).toContain('Acme Pallets Ltd');
    expect(sheet.text).not.toContain('Northgate');
  }, 20_000);

  it('stamp designs with the date where each of them is', async () => {
    const registry = tempRegistry();
    const kolkata = await seedTenant(registry, { slug: 'kolkata', email: 'k@x.test', timezone: 'Asia/Kolkata' });
    const samoa = await seedTenant(registry, { slug: 'samoa', email: 's@x.test', timezone: 'Pacific/Pago_Pago' });
    await serve(registry);

    const kCookie = await signIn(base, kolkata.user.email, kolkata.password);
    const sCookie = await signIn(base, samoa.user.email, samoa.password);
    const k = await addDesign(kCookie, 'A Client', 'One');
    const s = await addDesign(sCookie, 'A Client', 'Two');

    const kDate = (await call('GET', `/api/pallets/${k.design.id}`, kCookie)).body.updatedAt;
    const sDate = (await call('GET', `/api/pallets/${s.design.id}`, sCookie)).body.updatedAt;
    // The first zone to see a day and nearly the last: never the other way round.
    expect(kDate >= sDate).toBe(true);
  }, 20_000);
});

describe('the folder a request is allowed to see', () => {
  /**
   * The guard behind all of the above. A route that somehow ran outside a
   * request must fail loudly rather than fall back on a folder, because every
   * folder it could fall back on belongs to somebody.
   */
  it('is never guessed at when nobody said which company', () => {
    expect(() => currentTenant()).toThrow(NoTenantContextError);
    const repository = new PalletRepository(() => currentTenant().handle.require());
    expect(() => repository.list()).toThrow(NoTenantContextError);
  });

  it('is whichever one the request was put in', () => {
    const registry = tempRegistry();
    const tenants = new Tenants(dataRoot, registry);
    const one = registry.createTenant({ slug: 'one', name: 'One' });
    const two = registry.createTenant({ slug: 'two', name: 'Two' });

    runInTenant(tenants.context(one), () => {
      expect(currentTenant().handle.require().root).toContain(join('tenants', 'one'));
      runInTenant(tenants.context(two), () => {
        expect(currentTenant().handle.require().root).toContain(join('tenants', 'two'));
      });
      // And it is back to the outer one afterwards.
      expect(currentTenant().handle.require().root).toContain(join('tenants', 'one'));
    });
  });

  it('is opened once and kept, and let go when asked', () => {
    const registry = tempRegistry();
    const tenants = new Tenants(dataRoot, registry);
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme' });

    const first = tenants.context(tenant);
    expect(tenants.context(tenant)).toBe(first);
    expect(tenants.openCount).toBe(1);

    tenants.forget(tenant.id);
    expect(tenants.openCount).toBe(0);
    expect(tenants.context(tenant)).not.toBe(first);
  });

  it('follows a company that has been renamed, without moving its designs', () => {
    const registry = tempRegistry();
    const tenants = new Tenants(dataRoot, registry);
    const tenant = registry.createTenant({ slug: 'acme', name: 'Acme' });
    const folder = tenants.context(tenant).handle.require().root;

    const renamed = { ...tenant, name: 'Acme Pallets Limited' };
    const context = tenants.context(renamed);
    expect(context.tenant.name).toBe('Acme Pallets Limited');
    expect(context.handle.require().root).toBe(folder);
  });

  it('leaves out a company that has been suspended when doing the nightly work', () => {
    const registry = tempRegistry();
    const tenants = new Tenants(dataRoot, registry);
    const busy = registry.createTenant({ slug: 'busy', name: 'Busy' });
    const paused = registry.createTenant({ slug: 'paused', name: 'Paused' });
    registry.setTenantStatus(paused.id, 'suspended');

    const seen: string[] = [];
    tenants.forEachActive((context) => seen.push(context.tenant.slug));
    expect(seen).toEqual([busy.slug]);
  });
});
