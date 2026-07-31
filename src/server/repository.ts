import { parsePallet } from '../schema.js';
import { duplicatePallet, revisePallet } from '../revisions.js';
import type { Pallet } from '../types.js';
import type { Db } from './db.js';

/**
 * Everything the tool does to stored designs. The rules about revisions live
 * here and in the database triggers behind it, not in the UI.
 */

export interface PalletSummary {
  id: string;
  palletCode: string;
  clientName: string;
  palletName: string;
  revision: string;
  revisionDate: string;
  supersedes: string | null;
  frozen: boolean;
  updatedAt: string;
  /** Set when a later revision supersedes this one. */
  supersededBy: string | null;
}

export class FrozenPalletError extends Error {
  constructor(id: string) {
    super(`Pallet ${id} is a published revision and is never edited. Revise it instead.`);
    this.name = 'FrozenPalletError';
  }
}

export class PalletNotFoundError extends Error {
  constructor(id: string) {
    super(`No pallet ${id}`);
    this.name = 'PalletNotFoundError';
  }
}

interface Row {
  id: string;
  pallet_code: string;
  client_name: string;
  pallet_name: string;
  revision: string;
  revision_date: string;
  supersedes: string | null;
  frozen: number;
  updated_at: string;
  doc: string;
  superseded_by?: string | null;
}

function toSummary(row: Row): PalletSummary {
  return {
    id: row.id,
    palletCode: row.pallet_code,
    clientName: row.client_name,
    palletName: row.pallet_name,
    revision: row.revision,
    revisionDate: row.revision_date,
    supersedes: row.supersedes,
    frozen: row.frozen === 1,
    updatedAt: row.updated_at,
    supersededBy: row.superseded_by ?? null,
  };
}

export class PalletRepository {
  constructor(private readonly db: Db) {}

  /** Every stored revision, newest first. Superseded ones stay in the list. */
  list(): PalletSummary[] {
    const rows = this.db
      .prepare<[], Row>(
        `SELECT p.*, later.id AS superseded_by
           FROM pallets p
           LEFT JOIN pallets later ON later.supersedes = p.id
          ORDER BY p.client_name, p.pallet_code, p.revision`,
      )
      .all();
    return rows.map(toSummary);
  }

  get(id: string): Pallet {
    const row = this.db.prepare<[string], Row>('SELECT * FROM pallets WHERE id = ?').get(id);
    if (!row) throw new PalletNotFoundError(id);
    return parsePallet(JSON.parse(row.doc));
  }

  has(id: string): boolean {
    return (
      this.db.prepare<[string], { one: number }>('SELECT 1 AS one FROM pallets WHERE id = ?').get(id) !==
      undefined
    );
  }

  isFrozen(id: string): boolean {
    const row = this.db
      .prepare<[string], { frozen: number }>('SELECT frozen FROM pallets WHERE id = ?')
      .get(id);
    return row?.frozen === 1;
  }

  /**
   * Write a design. Creates the row if it is new.
   *
   * A frozen revision is refused: editing one means making the next revision,
   * which is a different row.
   */
  save(input: Pallet): Pallet {
    const pallet = parsePallet(input);
    if (this.isFrozen(pallet.id)) throw new FrozenPalletError(pallet.id);

    this.db
      .prepare(
        `INSERT INTO pallets
           (id, pallet_code, client_name, pallet_name, revision, revision_date,
            supersedes, frozen, updated_at, doc)
         VALUES
           (@id, @pallet_code, @client_name, @pallet_name, @revision, @revision_date,
            @supersedes, @frozen, @updated_at, @doc)
         ON CONFLICT(id) DO UPDATE SET
           pallet_code = excluded.pallet_code,
           client_name = excluded.client_name,
           pallet_name = excluded.pallet_name,
           revision = excluded.revision,
           revision_date = excluded.revision_date,
           supersedes = excluded.supersedes,
           frozen = excluded.frozen,
           updated_at = excluded.updated_at,
           doc = excluded.doc`,
      )
      .run({
        id: pallet.id,
        pallet_code: pallet.palletCode,
        client_name: pallet.clientName,
        pallet_name: pallet.palletName,
        revision: pallet.revision,
        revision_date: pallet.revisionDate,
        supersedes: pallet.supersedes ?? null,
        frozen: pallet.frozen ? 1 : 0,
        updated_at: new Date().toISOString(),
        doc: JSON.stringify(pallet),
      });

    return pallet;
  }

  /** Publish. From here the design is read-only and stays readable forever. */
  freeze(id: string): Pallet {
    const pallet = this.get(id);
    if (pallet.frozen) return pallet;
    return this.save({ ...pallet, frozen: true });
  }

  /**
   * The next revision: a new row, the next letter, superseding the one it came
   * from, with a fresh date. The old row is not touched.
   */
  revise(id: string): Pallet {
    const previous = this.get(id);
    return this.save(revisePallet(previous));
  }

  /** A copy, which is a new design and linked to nothing. */
  duplicate(id: string): Pallet {
    return this.save(duplicatePallet(this.get(id)));
  }

  /** Only ever an unpublished draft. Frozen rows are refused by the database. */
  delete(id: string): void {
    if (!this.has(id)) throw new PalletNotFoundError(id);
    if (this.isFrozen(id)) throw new FrozenPalletError(id);
    this.db.prepare('DELETE FROM pallets WHERE id = ?').run(id);
  }

  /** Oldest first: the whole history of a design, for looking up what was built. */
  history(id: string): PalletSummary[] {
    const chain: PalletSummary[] = [];
    const byId = new Map(this.list().map((summary) => [summary.id, summary]));

    let start = byId.get(id);
    if (!start) throw new PalletNotFoundError(id);
    while (start.supersedes) {
      const previous = byId.get(start.supersedes);
      if (!previous) break;
      start = previous;
    }

    let current: PalletSummary | undefined = start;
    while (current) {
      chain.push(current);
      current = current.supersededBy ? byId.get(current.supersededBy) : undefined;
    }
    return chain;
  }
}
