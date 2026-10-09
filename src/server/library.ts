import { ChoiceError, CHOICE_FIELDS, withChoice } from '../choices.js';
import { duplicatePallet } from '../duplicate.js';
import { today } from '../ids.js';
import { LIBRARY_FORMAT, LIBRARY_VERSION } from '../library.js';
import type { ImportMode, ImportReport, Library } from '../library.js';
import { parsePallet } from '../schema.js';
import type { Pallet } from '../types.js';
import type { FileStore } from '../store/files.js';
import type { ChoiceRepository, ClientRepository, PalletRepository } from './repository.js';

/**
 * The library in and out of a file.
 *
 * The store is a folder of files, which a colleague's machine may already be
 * syncing. This is the whole of it as one document — for a backup, for somebody
 * outside the Drive folder, or for reading years from now — and the way back
 * in.
 */

/**
 * Every client and every design, as one document — and what the company has
 * added to the lists, where it is asked for, so a backup brings those back too.
 */
export function exportLibrary(
  pallets: PalletRepository,
  clients: ClientRepository,
  choices?: ChoiceRepository,
): Library {
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    exportedAt: today(),
    clients: clients.list(),
    designs: pallets.all(),
    ...(choices ? { choices: choices.get() } : {}),
  };
}

/**
 * Read a library file into the store.
 *
 * Nothing is deleted and, by default, nothing is overwritten. An import adds
 * what is missing and leaves alone what is already held, so importing the same
 * file twice does nothing the second time and importing a colleague's library
 * cannot cost you a design of your own. `replace` overwrites the designs that
 * clashed, and is only ever reached from a prompt that has already said how
 * many that is.
 *
 * Clients are matched by name rather than by id. The same customer entered by
 * hand on two machines has one name and two ids, and matching on the id would
 * put them on the dashboard twice.
 *
 * A design carries its client's name, so that is what places it — a file whose
 * client list is short or hand-written still lands every design somewhere,
 * rather than dropping the ones it cannot account for.
 *
 * All of it in one transaction: a file that turns out to be bad halfway through
 * must leave the store as it was, not half-imported.
 */
export function importLibrary(
  store: FileStore,
  library: Library,
  pallets: PalletRepository,
  clients: ClientRepository,
  mode: ImportMode = 'skip',
): ImportReport {
  const report: ImportReport = {
    clientsAdded: 0,
    designsAdded: 0,
    designsSkipped: 0,
    designsReplaced: 0,
  };

  const clientIdFor = (name: string): string => {
    const held = clients.findByName(name);
    if (held) return held.id;
    const created = clients.create(name);
    report.clientsAdded += 1;
    return created.id;
  };

  store.transaction(() => {
    // Named first, so that a client with no designs still arrives. Being a
    // record of their own is the whole point of the clients table.
    for (const client of library.clients) clientIdFor(client.name);

    for (const design of library.designs) {
      const clientId = clientIdFor(design.clientName);
      const held = pallets.has(design.id);
      if (held && mode === 'skip') {
        report.designsSkipped += 1;
        continue;
      }
      pallets.restore({ ...design, clientId }, clients);
      if (held) report.designsReplaced += 1;
      else report.designsAdded += 1;
    }

    // Added to the lists, never taken off them: an entry here that the file
    // does not have is somebody's, and the file does not know about it.
    if (library.choices) {
      let lists = store.readChoices();
      for (const field of CHOICE_FIELDS) {
        for (const value of library.choices[field]) {
          try {
            lists = withChoice(lists, field, value);
          } catch (error) {
            // A list already full, or an entry this version would not take:
            // neither is worth refusing the designs over.
            if (!(error instanceof ChoiceError)) throw error;
          }
        }
      }
      store.writeChoices(lists);
    }
  });

  return report;
}

/**
 * One design from a file, as a new design of the given client's.
 *
 * It is given a new identity on the way in — a new id, and new ids for its
 * layers — so it is a design in its own right rather than a claim on one the
 * store may already hold under that id. Importing the same file twice gives two
 * designs, which is what asking for it twice meant.
 *
 * The client is the one it is being imported into, not whoever the file says.
 * Which client a design belongs to is settled on the dashboard; a file arriving
 * from somewhere else has no business reassigning it.
 */
export function importDesign(
  input: unknown,
  clientId: string,
  pallets: PalletRepository,
  clients: ClientRepository,
): Pallet {
  const client = clients.get(clientId);
  const incoming = duplicatePallet(parsePallet(input));
  return pallets.save({ ...incoming, clientId, clientName: client.name }, clients);
}
