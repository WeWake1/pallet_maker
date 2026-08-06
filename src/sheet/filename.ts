import type { Pallet } from '../types.js';

/**
 * What a downloaded file is called.
 *
 * A sheet leaves this program and lands in a folder of other people's files, so
 * its name has to say what it is without being opened: the design, whose it is,
 * and when it was last saved — "Export crate base - Acme Ltd - 2026-08-06.pdf".
 * The date is the store's stamp, the same one printed in the title block, so a
 * file on disk can be matched to the sheet on the bench.
 *
 * A design that has been named goes by its name, because that is what the shop
 * calls it; one that has not falls back to its code, and a design with neither
 * to "pallet", so there is always something to save.
 */

/** Illegal or awkward in a file name on Windows, macOS or Linux. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

function clean(part: string): string {
  return part.replace(UNSAFE, '').replace(/\s+/g, ' ').trim();
}

/**
 * The name without an extension. Also the document's title, so that a sheet
 * printed from the browser rather than downloaded is offered the same name.
 */
export function documentName(pallet: Pallet): string {
  const parts = [pallet.palletName || pallet.palletCode, pallet.clientName, pallet.updatedAt]
    .map(clean)
    .filter((part) => part !== '');
  return parts.length > 0 ? parts.join(' - ') : 'pallet';
}

/**
 * `extension` without its dot, e.g. `pdf`.
 */
export function downloadName(pallet: Pallet, extension: string): string {
  // Trailing dots and spaces are dropped silently by Windows, which would take
  // the dot off the extension with them.
  return `${documentName(pallet).replace(/[. ]+$/, '')}.${extension}`;
}

/**
 * A `Content-Disposition` value for that name.
 *
 * Two forms of the same name: the quoted one is ASCII, for anything that reads
 * only the old header, and `filename*` carries it in full for every browser in
 * use — a client name with an accent in it should not lose the accent on the
 * way to the download.
 */
export function contentDisposition(name: string, disposition: 'inline' | 'attachment'): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
