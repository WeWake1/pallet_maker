import type { Rates } from '../costing/rates.js';
import type { ImportMode, ImportReport } from '../library.js';
import type { ClientDesigns, PalletSummary } from '../server/repository.js';
import type { StoreStatus } from '../store/handle.js';
import type { Client, Pallet } from '../types.js';

/** The editor's side of the local API. */

/**
 * The designs cannot be reached at all.
 *
 * Told apart from every other failure because the answer is different: nothing
 * here is wrong with the design or the request, and the only thing worth
 * showing is where the tool was looking and how to point it somewhere else.
 */
export class StoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreUnavailable';
  }
}

/**
 * The save was refused because somebody else had saved first.
 *
 * Told apart from every other failure because it is answered by asking rather
 * than by reporting: whoever is at the keyboard is the only one who can say
 * whose version should stand.
 */
export class StaleEdit extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleEdit';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.headers ?? (init?.body ? { 'content-type': 'application/json' } : undefined),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as
      | { error?: string; storeUnavailable?: boolean; staleEdit?: boolean }
      | null;
    const message = detail?.error ?? `${response.status} ${response.statusText}`;
    if (detail?.storeUnavailable) throw new StoreUnavailable(message);
    if (detail?.staleEdit) throw new StaleEdit(message);
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  dashboard: () => call<ClientDesigns[]>('/api/dashboard'),
  clients: () => call<Client[]>('/api/clients'),
  addClient: (name: string) =>
    call<Client>('/api/clients', { method: 'POST', body: JSON.stringify({ name }) }),
  renameClient: (id: string, name: string) =>
    call<Client>(`/api/clients/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  removeClient: (id: string) => call<void>(`/api/clients/${id}`, { method: 'DELETE' }),

  list: () => call<PalletSummary[]>('/api/pallets'),
  get: (id: string) => call<Pallet>(`/api/pallets/${id}`),
  create: (pallet: Pallet) =>
    call<Pallet>('/api/pallets', { method: 'POST', body: JSON.stringify(pallet) }),
  /**
   * Write a design back.
   *
   * `basedOn` is the design as this editor found it, which lets the store
   * refuse a save that would overwrite somebody else's. Left out, the save
   * overwrites whatever is there — which is what is wanted, but only once
   * somebody has been asked.
   */
  save: (pallet: Pallet, basedOn?: string) =>
    call<Pallet>(`/api/pallets/${pallet.id}`, {
      method: 'PUT',
      body: JSON.stringify(pallet),
      ...(basedOn ? { headers: { 'content-type': 'application/json', 'if-match': basedOn } } : {}),
    }),
  duplicate: (id: string) => call<Pallet>(`/api/pallets/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => call<void>(`/api/pallets/${id}`, { method: 'DELETE' }),
  rates: () => call<Rates>('/api/rates'),

  /** One design from a file, as a new design of that client's. */
  importDesign: (pallet: unknown, clientId: string) =>
    call<Pallet>('/api/pallets/import', {
      method: 'POST',
      body: JSON.stringify({ pallet, clientId }),
    }),
  /** A library file read back in. `skip` leaves designs already held alone. */
  importLibrary: (library: unknown, mode: ImportMode = 'skip') =>
    call<ImportReport>('/api/library/import', {
      method: 'POST',
      body: JSON.stringify({ library, mode }),
    }),

  /** Which folder the designs are in. Answers even when it cannot be reached. */
  settings: () => call<StoreStatus>('/api/settings'),
  /** Use this folder from now on, making it if it is not there. */
  useStoreFolder: (root: string) =>
    call<StoreStatus>('/api/settings', { method: 'PUT', body: JSON.stringify({ root }) }),
  /** Look again, for a folder that was not there when the tool started. */
  retryStore: () => call<StoreStatus>('/api/settings/retry', { method: 'POST' }),
  /** Pick a folder in a native dialog. Only the app can do this. */
  browseForFolder: () => call<StoreStatus>('/api/settings/browse', { method: 'POST' }),

  sheetUrl: (id: string) => `/api/pallets/${id}/sheet.pdf`,
  dxfUrl: (id: string) => `/api/pallets/${id}/drawing.dxf`,
  // The whole sheet as vector, for taking into a drawing or page-layout
  // program. Downloads rather than opens.
  svgUrl: (id: string) => `/api/pallets/${id}/sheet.svg`,
  // The design itself rather than a picture of it: the only download that can
  // be opened again and worked on.
  designUrl: (id: string) => `/api/pallets/${id}/design.json`,
  // Every client and every design, as one file to keep somewhere else.
  libraryUrl: () => '/api/library.json',
};

export type { Client, ClientDesigns, PalletSummary, StoreStatus };
