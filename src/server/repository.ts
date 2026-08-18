import { duplicatePallet } from '../duplicate.js';
import { newId, today } from '../ids.js';
import { parsePallet } from '../schema.js';
import type { FileStore } from '../store/files.js';
import type { Client, Pallet } from '../types.js';

/**
 * Everything the tool does to stored designs.
 *
 * There is no history. Saving a design overwrites it, and the date it carries
 * is the whole of what says how current it is. Keeping an old design means
 * duplicating it before the rework starts, which makes two files that have
 * nothing to do with each other from then on.
 */

export interface PalletSummary {
  id: string;
  clientId: string;
  clientName: string;
  palletCode: string;
  palletName: string;
  updatedAt: string;
}

/** A client and every design of theirs: one section of the dashboard. */
export interface ClientDesigns {
  client: Client;
  designs: PalletSummary[];
}

export class PalletNotFoundError extends Error {
  constructor(id: string) {
    super(`No pallet ${id}`);
    this.name = 'PalletNotFoundError';
  }
}

export class ClientNotFoundError extends Error {
  constructor(id: string) {
    super(`No client ${id}`);
    this.name = 'ClientNotFoundError';
  }
}

export class DuplicateClientError extends Error {
  constructor(name: string) {
    super(`There is already a client called "${name}"`);
    this.name = 'DuplicateClientError';
  }
}

/** SQLite's NOCASE, which is what the dashboard was ordered by. */
function byNameNoCase(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class ClientRepository {
  constructor(private readonly store: FileStore) {}

  list(): Client[] {
    return [...this.store.readClients()].sort((a, b) => byNameNoCase(a.name, b.name));
  }

  get(id: string): Client {
    const client = this.store.readClients().find((held) => held.id === id);
    if (!client) throw new ClientNotFoundError(id);
    return client;
  }

  /**
   * The client of that name, whoever's spelling of it is used. Names are the
   * only thing two copies of the library agree on — ids are made on whichever
   * machine the client was first entered on — so this is what an import matches
   * against to avoid entering the same customer twice.
   */
  findByName(name: string): Client | undefined {
    const wanted = name.trim().toLowerCase();
    return this.store.readClients().find((held) => held.name.toLowerCase() === wanted);
  }

  create(name: string): Client {
    const client: Client = { id: newId(), name: name.trim(), createdAt: today() };
    if (client.name === '') throw new Error('A client needs a name');
    if (this.findByName(client.name)) throw new DuplicateClientError(client.name);
    this.store.writeClients([...this.store.readClients(), client]);
    return client;
  }

  /**
   * Rename, and refresh the copy of the name held on each of their designs. The
   * copy is what lets a sheet be printed from the document alone, so it has to
   * be brought along or a reprint would carry the old spelling.
   */
  rename(id: string, name: string): Client {
    const client = this.get(id);
    const next = name.trim();
    if (next === '') throw new Error('A client needs a name');
    const clash = this.findByName(next);
    if (clash && clash.id !== id) throw new DuplicateClientError(next);

    return this.store.transaction(() => {
      this.store.writeClients(
        this.store.readClients().map((held) => (held.id === id ? { ...held, name: next } : held)),
      );
      for (const design of this.store.listDesigns()) {
        if (design.clientId === id) this.store.writeDesign({ ...design, clientName: next });
      }
      return { ...client, name: next };
    });
  }

  /** Deleting a client deletes their designs with them. */
  delete(id: string): void {
    this.get(id);
    this.store.transaction(() => {
      this.store.writeClients(this.store.readClients().filter((held) => held.id !== id));
      for (const design of this.store.listDesigns()) {
        if (design.clientId === id) this.store.deleteDesign(design.id);
      }
    });
  }
}

export class PalletRepository {
  constructor(private readonly store: FileStore) {}

  list(): PalletSummary[] {
    const names = new Map(this.store.readClients().map((client) => [client.id, client.name]));
    return this.store
      .listDesigns()
      .map((design) => ({
        id: design.id,
        clientId: design.clientId,
        // The clients file is the authority on the spelling. A design whose
        // client is not in it has not lost its own copy of the name, and that
        // is better than showing nothing.
        clientName: names.get(design.clientId) ?? design.clientName,
        palletCode: design.palletCode,
        palletName: design.palletName,
        updatedAt: design.updatedAt,
      }))
      .sort(
        (a, b) =>
          byNameNoCase(a.clientName, b.clientName) ||
          byText(a.palletCode, b.palletCode) ||
          byText(a.palletName, b.palletName),
      );
  }

  /**
   * The dashboard: every client, each with their designs. A client with none
   * still gets a section, which is the point of their being a record of their
   * own — a customer can be on the books before anything is drawn for them.
   *
   * A design whose client is missing from the clients file gets that client
   * rebuilt from the design's own copy of the name. Files arrive in this folder
   * from a colleague's machine and from Drive, in whatever order those two
   * choose, and a design that is on disk must never be missing from the
   * dashboard because the file naming it happens to be behind.
   */
  dashboard(clients: ClientRepository): ClientDesigns[] {
    const byClient = new Map<string, PalletSummary[]>();
    for (const design of this.list()) {
      const designs = byClient.get(design.clientId) ?? [];
      designs.push(design);
      byClient.set(design.clientId, designs);
    }

    const known = clients.list();
    const sections = known.map((client) => ({
      client,
      designs: byClient.get(client.id) ?? [],
    }));

    const held = new Set(known.map((client) => client.id));
    const orphans = [...byClient.entries()]
      .filter(([id]) => !held.has(id))
      .map(([id, designs]) => ({
        client: { id, name: designs[0]!.clientName, createdAt: designs[0]!.updatedAt },
        designs,
      }));

    return [...sections, ...orphans].sort((a, b) => byNameNoCase(a.client.name, b.client.name));
  }

  get(id: string): Pallet {
    const design = this.store.readDesign(id);
    if (!design) throw new PalletNotFoundError(id);
    return design;
  }

  /**
   * Every design in full, for writing the library out to a file. The dashboard
   * wants summaries and gets `list`; this is the documents themselves, which is
   * the only thing an export can be made of.
   */
  all(): Pallet[] {
    return this.store
      .listDesigns()
      .sort((a, b) => byText(a.palletCode, b.palletCode) || byText(a.palletName, b.palletName));
  }

  has(id: string): boolean {
    return this.store.hasDesign(id);
  }

  /**
   * Write a design, creating the file if it is new. Overwrites what was there:
   * the previous state is not kept anywhere.
   *
   * The date and the copy of the client's name are set here rather than taken
   * from the document, so neither can be stale or wrong about itself.
   */
  save(input: Pallet, clients: ClientRepository): Pallet {
    return this.write({ ...parsePallet(input), updatedAt: today() }, clients);
  }

  /**
   * Write a design exactly as it came, keeping the date it carries.
   *
   * Only an import does this. Every other write is somebody editing, and is
   * stamped with today because that is what the date on a design means. A
   * design read back out of a backup was not edited today, and stamping it
   * would lose the one fact the dashboard sorts on and the sheet prints — how
   * old the design actually is.
   */
  restore(input: Pallet, clients: ClientRepository): Pallet {
    return this.write(parsePallet(input), clients);
  }

  private write(submitted: Pallet, clients: ClientRepository): Pallet {
    const client = clients.get(submitted.clientId);
    const pallet: Pallet = { ...submitted, clientName: client.name };
    this.store.writeDesign(pallet);
    return pallet;
  }

  /** A copy, which is a new design and linked to nothing. */
  duplicate(id: string, clients: ClientRepository): Pallet {
    return this.save(duplicatePallet(this.get(id)), clients);
  }

  delete(id: string): void {
    if (!this.has(id)) throw new PalletNotFoundError(id);
    this.store.deleteDesign(id);
  }
}

/**
 * Make sure every client a design names is in the clients file.
 *
 * Designs and the clients file sync independently, and a design can land first.
 * Run at startup, this folds any such client back in from the design's own copy
 * of the name, so the dashboard settles rather than relying on the rebuilding
 * that `dashboard` does on the fly.
 */
export function reconcileClients(store: FileStore): number {
  const clients = store.readClients();
  const held = new Set(clients.map((client) => client.id));
  const missing = new Map<string, Client>();

  for (const design of store.listDesigns()) {
    if (held.has(design.clientId) || missing.has(design.clientId)) continue;
    missing.set(design.clientId, {
      id: design.clientId,
      name: design.clientName,
      createdAt: design.updatedAt,
    });
  }

  if (missing.size > 0) store.writeClients([...clients, ...missing.values()]);
  return missing.size;
}
