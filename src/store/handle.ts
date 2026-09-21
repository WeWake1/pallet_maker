import { FileStore, StoreUnavailableError } from './files.js';

/**
 * Which folder the designs are in, and whether it can be reached.
 *
 * The folder can be missing — Drive is not running yet, the folder was renamed,
 * an external disk is unplugged — and it can be changed while the program is
 * running. Neither is a reason for the tool to refuse to open: it starts, says
 * what is wrong, and offers somewhere to say where the designs actually are.
 * Everything that reads or writes designs goes through `require`, so a folder
 * that is not there is one clear message rather than a failure per request.
 */

export interface StoreStatus {
  /** The folder being used, or null when none has ever been chosen. */
  root: string | null;
  ready: boolean;
  /** Why it cannot be used, when it cannot. */
  problem: string | null;
  /** Where the folder was decided: an environment variable, or the default. */
  source: 'environment' | 'default';
  designs: number | null;
  clients: number | null;
  /**
   * Whether the designs are the server's own rather than a folder on the
   * reader's machine.
   *
   * True on a hosted server, where the folder was settled when it started, is
   * on somebody else's machine, and is nobody's to move from a browser. False
   * only when the tool is run locally against one folder.
   */
  managedStore?: boolean;
  /** Which build this is, when it is the app rather than a browser tab. */
  version?: string | null;
  /** Whether the branding came from the designs folder or from this version. */
  brandFrom?: 'folder' | 'built-in';
  /** Why the folder's branding was not used, when there is some and it failed. */
  brandProblem?: string | null;
}

export interface HandleOptions {
  /** Make the folder if it is not there. Never true for one from the settings. */
  create?: boolean;
  source?: StoreStatus['source'];
}

export class StoreHandle {
  private store: FileStore | undefined;
  private failure: string | undefined;
  private root: string | undefined;
  private origin: StoreStatus['source'];

  constructor(root: string | undefined, options: HandleOptions = {}) {
    this.origin = options.source ?? 'default';
    if (root !== undefined) this.open(root, options.create ?? false);
  }

  /** The store, or the reason there is not one. */
  require(): FileStore {
    if (this.store) return this.store;
    throw new StoreUnavailableError(this.root ?? '(none chosen)', this.failure ?? 'none chosen yet');
  }

  ready(): boolean {
    return this.store !== undefined;
  }

  /** Try the folder again, for one that was not there when the server started. */
  retry(): StoreStatus {
    if (this.root !== undefined) this.open(this.root, false);
    return this.status();
  }

  status(): StoreStatus {
    const counts = this.count();
    return {
      root: this.store?.root ?? this.root ?? null,
      ready: this.store !== undefined,
      problem: this.failure ?? null,
      source: this.origin,
      designs: counts?.designs ?? null,
      clients: counts?.clients ?? null,
    };
  }

  private count(): { designs: number; clients: number } | undefined {
    if (!this.store) return undefined;
    try {
      return { designs: this.store.listDesigns().length, clients: this.store.readClients().length };
    } catch {
      // Counting is for the setup screen to say the folder looks right. Failing
      // at it is not worth reporting as the folder being unusable.
      return undefined;
    }
  }

  private open(root: string, create: boolean): void {
    try {
      this.store = new FileStore(root, { create });
      this.root = this.store.root;
      this.failure = undefined;
    } catch (error) {
      this.store = undefined;
      this.root = root;
      this.failure = error instanceof StoreUnavailableError ? error.reason
        : error instanceof Error ? error.message
        : String(error);
    }
  }
}
