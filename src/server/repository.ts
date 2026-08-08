import { duplicatePallet } from '../duplicate.js';
import { newId, today } from '../ids.js';
import { parsePallet } from '../schema.js';
import type { Client, Pallet } from '../types.js';
import type { Db } from './db.js';

/**
 * Everything the tool does to stored designs.
 *
 * There is no history. Saving a design overwrites it, and the date it carries
 * is the whole of what says how current it is. Keeping an old design means
 * duplicating it before the rework starts, which makes two rows that have
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

interface ClientRow {
  id: string;
  name: string;
  created_at: string;
}

interface PalletRow {
  id: string;
  client_id: string;
  pallet_code: string;
  pallet_name: string;
  updated_at: string;
  doc: string;
}

function toClient(row: ClientRow): Client {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

export class ClientRepository {
  constructor(private readonly db: Db) {}

  list(): Client[] {
    return this.db
      .prepare<[], ClientRow>('SELECT * FROM clients ORDER BY name COLLATE NOCASE')
      .all()
      .map(toClient);
  }

  get(id: string): Client {
    const row = this.db.prepare<[string], ClientRow>('SELECT * FROM clients WHERE id = ?').get(id);
    if (!row) throw new ClientNotFoundError(id);
    return toClient(row);
  }

  /**
   * The client of that name, whoever's spelling of it is used. Names are the
   * only thing two copies of the library agree on — ids are made on whichever
   * machine the client was first entered on — so this is what an import matches
   * against to avoid entering the same customer twice.
   */
  findByName(name: string): Client | undefined {
    const row = this.db
      .prepare<[string], ClientRow>('SELECT * FROM clients WHERE name = ? COLLATE NOCASE')
      .get(name.trim());
    return row ? toClient(row) : undefined;
  }

  create(name: string): Client {
    const client: Client = { id: newId(), name: name.trim(), createdAt: today() };
    if (client.name === '') throw new Error('A client needs a name');
    if (this.findByName(client.name)) throw new DuplicateClientError(client.name);
    this.db
      .prepare('INSERT INTO clients (id, name, created_at) VALUES (?, ?, ?)')
      .run(client.id, client.name, client.createdAt);
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

    this.db.transaction(() => {
      this.db.prepare('UPDATE clients SET name = ? WHERE id = ?').run(next, id);
      const rows = this.db
        .prepare<[string], PalletRow>('SELECT * FROM pallets WHERE client_id = ?')
        .all(id);
      const write = this.db.prepare('UPDATE pallets SET doc = ? WHERE id = ?');
      for (const row of rows) {
        const doc = JSON.parse(row.doc) as Record<string, unknown>;
        doc.clientName = next;
        write.run(JSON.stringify(doc), row.id);
      }
    })();

    return { ...client, name: next };
  }

  /** Deleting a client deletes their designs with them: the rows cascade. */
  delete(id: string): void {
    this.get(id);
    this.db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  }
}

export class PalletRepository {
  constructor(private readonly db: Db) {}

  list(): PalletSummary[] {
    return this.db
      .prepare<[], PalletRow & { client_name: string }>(
        `SELECT p.*, c.name AS client_name
           FROM pallets p
           JOIN clients c ON c.id = p.client_id
          ORDER BY c.name COLLATE NOCASE, p.pallet_code, p.pallet_name`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        clientId: row.client_id,
        clientName: row.client_name,
        palletCode: row.pallet_code,
        palletName: row.pallet_name,
        updatedAt: row.updated_at,
      }));
  }

  /**
   * The dashboard: every client, each with their designs. A client with none
   * still gets a section, which is the point of their being a record of their
   * own — a customer can be on the books before anything is drawn for them.
   */
  dashboard(clients: ClientRepository): ClientDesigns[] {
    const byClient = new Map<string, PalletSummary[]>();
    for (const design of this.list()) {
      const designs = byClient.get(design.clientId) ?? [];
      designs.push(design);
      byClient.set(design.clientId, designs);
    }
    return clients.list().map((client) => ({
      client,
      designs: byClient.get(client.id) ?? [],
    }));
  }

  get(id: string): Pallet {
    const row = this.db.prepare<[string], PalletRow>('SELECT * FROM pallets WHERE id = ?').get(id);
    if (!row) throw new PalletNotFoundError(id);
    return parsePallet(JSON.parse(row.doc));
  }

  /**
   * Every design in full, for writing the library out to a file. The dashboard
   * wants summaries and gets `list`; this is the documents themselves, which is
   * the only thing an export can be made of.
   */
  all(): Pallet[] {
    return this.db
      .prepare<[], PalletRow>('SELECT * FROM pallets ORDER BY pallet_code, pallet_name')
      .all()
      .map((row) => parsePallet(JSON.parse(row.doc)));
  }

  has(id: string): boolean {
    return (
      this.db
        .prepare<[string], { one: number }>('SELECT 1 AS one FROM pallets WHERE id = ?')
        .get(id) !== undefined
    );
  }

  /**
   * Write a design, creating the row if it is new. Overwrites what was there:
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

    this.db
      .prepare(
        `INSERT INTO pallets (id, client_id, pallet_code, pallet_name, updated_at, doc)
         VALUES (@id, @client_id, @pallet_code, @pallet_name, @updated_at, @doc)
         ON CONFLICT(id) DO UPDATE SET
           client_id = excluded.client_id,
           pallet_code = excluded.pallet_code,
           pallet_name = excluded.pallet_name,
           updated_at = excluded.updated_at,
           doc = excluded.doc`,
      )
      .run({
        id: pallet.id,
        client_id: pallet.clientId,
        pallet_code: pallet.palletCode,
        pallet_name: pallet.palletName,
        updated_at: pallet.updatedAt,
        doc: JSON.stringify(pallet),
      });

    return pallet;
  }

  /** A copy, which is a new design and linked to nothing. */
  duplicate(id: string, clients: ClientRepository): Pallet {
    return this.save(duplicatePallet(this.get(id)), clients);
  }

  delete(id: string): void {
    if (!this.has(id)) throw new PalletNotFoundError(id);
    this.db.prepare('DELETE FROM pallets WHERE id = ?').run(id);
  }
}
