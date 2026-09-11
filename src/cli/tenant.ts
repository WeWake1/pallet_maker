#!/usr/bin/env node
/**
 * The companies on this server, and who may sign in to each.
 *
 *   pallet-tenant vendor-admin --email you@example.com
 *   pallet-tenant create --slug ambica --name "Ambica Patterns India Pvt Ltd" \
 *                        --timezone Asia/Kolkata --admin office@ambica.example
 *   pallet-tenant invite --company ambica --email colleague@ambica.example --role member
 *   pallet-tenant reset --email colleague@ambica.example
 *   pallet-tenant list
 *   pallet-tenant users --company ambica
 *   pallet-tenant suspend --company ambica
 *   pallet-tenant resume --company ambica
 *
 * Run on the server, as the user the service runs as. Nobody's password is
 * ever set here: making an account produces a link, the person follows it and
 * chooses one, and so there is never a password an administrator knows.
 *
 *   PALLET_DATA_ROOT   where everything is kept
 *   PALLET_PUBLIC_URL  the address the links should point at
 */
import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isTimeZone } from '../ids.js';
import { createInvitation, invitationLink } from '../server/invitations.js';
import { Registry } from '../tenancy/registry.js';
import { Tenants } from '../tenancy/tenants.js';
import type { Role } from '../tenancy/registry.js';

function flag(argv: string[], name: string): string | undefined {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const argv = process.argv.slice(2);
const command = argv[0];

const dataRoot = process.env.PALLET_DATA_ROOT;
if (!dataRoot) fail('PALLET_DATA_ROOT is not set. It names the folder this server keeps everything in.');
if (!existsSync(dataRoot) || !statSync(dataRoot).isDirectory()) {
  fail(`PALLET_DATA_ROOT is ${dataRoot}, and there is no such folder. Make it first.`);
}
const publicUrl = process.env.PALLET_PUBLIC_URL ?? 'http://localhost:5179';

const registry = new Registry(resolve(dataRoot, 'registry.sqlite'));

/** A company by its short name, or a message saying which ones there are. */
function company(slug: string | undefined) {
  if (!slug) fail('Which company? Pass --company <short name>.');
  const held = registry.tenantBySlug(slug);
  if (!held) {
    const known = registry.listTenants().map((t) => t.slug);
    fail(`No company called "${slug}".${known.length ? ` There is ${known.join(', ')}.` : ''}`);
  }
  return held;
}

function offer(kind: 'invite' | 'reset', tenantId: string | null, email: string, role: Role): void {
  const { token } = createInvitation(registry, { kind, tenantId, email, role, invitedBy: null });
  console.log('');
  console.log(`Send ${email} this link. It works once, and for seven days:`);
  console.log('');
  console.log(`  ${invitationLink(publicUrl, token)}`);
  console.log('');
}

try {
  switch (command) {
    case 'vendor-admin': {
      const email = flag(argv, 'email') ?? fail('Which address? Pass --email.');
      const held = registry.userByEmail(email);
      if (held) {
        if (held.role !== 'vendor') fail(`${email} already has an account with a company.`);
        console.log(`${email} already looks after the service. Sending a way back in.`);
        offer('reset', null, held.email, 'vendor');
      } else {
        offer('invite', null, email, 'vendor');
      }
      break;
    }

    case 'create': {
      const slug = flag(argv, 'slug') ?? fail('What should the company be called, in short? Pass --slug.');
      const name = flag(argv, 'name') ?? fail('What is the company called? Pass --name.');
      const timezone = flag(argv, 'timezone') ?? 'UTC';
      if (!isTimeZone(timezone)) fail(`"${timezone}" is not a time zone name. Use one like Asia/Kolkata.`);

      const tenant = registry.createTenant({ slug, name, timezone });
      // Made now rather than at the company's first save, so that whoever is
      // setting them up has somewhere to put their logo and their prices
      // before anybody signs in.
      const folder = new Tenants(dataRoot, registry).context(tenant).handle.require().root;
      console.log(`Made ${tenant.name} (${tenant.slug}), dates in ${tenant.timezone}.`);
      console.log(`Its designs are in ${folder}`);
      console.log(`Put its branding in ${join(folder, 'brand.json')} and its prices in ${join(folder, 'rates.json')}.`);

      const admin = flag(argv, 'admin');
      if (admin) offer('invite', tenant.id, admin, 'admin');
      else console.log('Invite its first administrator with: pallet-tenant invite --company ' + tenant.slug + ' --email <address> --role admin');
      break;
    }

    case 'invite': {
      const tenant = company(flag(argv, 'company'));
      const email = flag(argv, 'email') ?? fail('Which address? Pass --email.');
      const role = (flag(argv, 'role') ?? 'member') as Role;
      if (role !== 'admin' && role !== 'member') fail('A role is either admin or member.');
      if (registry.userByEmail(email)) fail(`${email} already has an account. Use "reset" to send a way back in.`);
      offer('invite', tenant.id, email, role);
      break;
    }

    case 'reset': {
      const email = flag(argv, 'email') ?? fail('Which address? Pass --email.');
      const user = registry.userByEmail(email) ?? fail(`No account for ${email}.`);
      offer('reset', user.tenantId, user.email, user.role);
      break;
    }

    case 'list': {
      const tenants = registry.listTenants();
      if (tenants.length === 0) {
        console.log('No companies yet. Make one with: pallet-tenant create --slug <short> --name "<name>"');
        break;
      }
      for (const tenant of tenants) {
        const people = registry.listUsers(tenant.id);
        console.log(
          `${tenant.slug.padEnd(18)} ${tenant.status.padEnd(10)} ${String(people.length).padStart(3)} people  ${tenant.timezone.padEnd(18)} ${tenant.name}`,
        );
      }
      break;
    }

    case 'users': {
      const tenant = flag(argv, 'company') ? company(flag(argv, 'company')) : null;
      const people = registry.listUsers(tenant?.id ?? null);
      console.log(tenant ? `${tenant.name}:` : 'Looking after the service:');
      for (const person of people) {
        const state = person.status === 'active' ? (person.hasPassword ? 'signed up' : 'invited') : 'turned off';
        console.log(`  ${person.email.padEnd(34)} ${person.role.padEnd(8)} ${state}`);
      }
      for (const invitation of registry.listInvitations(tenant?.id ?? null)) {
        console.log(`  ${invitation.email.padEnd(34)} ${invitation.role.padEnd(8)} invited, link unused`);
      }
      break;
    }

    case 'suspend':
    case 'resume': {
      const tenant = company(flag(argv, 'company'));
      registry.setTenantStatus(tenant.id, command === 'suspend' ? 'suspended' : 'active');
      console.log(
        command === 'suspend'
          ? `${tenant.name} is suspended. Its people are signed out and cannot sign in.`
          : `${tenant.name} is active again.`,
      );
      break;
    }

    default:
      console.error('Usage: pallet-tenant <vendor-admin|create|invite|reset|list|users|suspend|resume> [options]');
      console.error('See the comment at the top of src/cli/tenant.ts for each.');
      process.exitCode = 2;
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  registry.close();
}
