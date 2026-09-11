import type { Brand } from '../brand/types.js';
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

/**
 * Nobody is signed in any more.
 *
 * Told apart from every other failure because it is answered by showing the
 * sign-in screen rather than by reporting anything: a session runs out while a
 * tab is open, and what should happen then is a login form, not an error
 * across the top of a library that is no longer there.
 */
export class Unauthenticated extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unauthenticated';
  }
}

/**
 * The header the server insists on for anything that changes something.
 *
 * A form on another site can post to this one; it cannot add a header of its
 * own without asking first, and the server answers no such question.
 */
const REQUESTED_WITH = 'pallet-editor';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // The session is a cookie, and a cookie is only sent if it is asked for.
    credentials: 'same-origin',
    headers: {
      'x-requested-with': REQUESTED_WITH,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as
      | { error?: string; storeUnavailable?: boolean; staleEdit?: boolean; unauthenticated?: boolean }
      | null;
    const message = detail?.error ?? `${response.status} ${response.statusText}`;
    if (detail?.unauthenticated) throw new Unauthenticated(message);
    if (detail?.storeUnavailable) throw new StoreUnavailable(message);
    if (detail?.staleEdit) throw new StaleEdit(message);
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Who is signed in, and whether this server asks at all. */
export interface Session {
  signInRequired: boolean;
  user: { id: string; email: string; name: string; role: string } | null;
  company: { slug: string; name: string; timezone: string } | null;
}

/** What a link in an invitation is worth, before it is used. */
export interface InvitationOffer {
  email: string;
  kind: 'invite' | 'reset';
  companyName: string | null;
  returning: boolean;
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
  /**
   * Whose drawing this is. The editor renders the sheet itself, for the
   * preview and for opening one in a tab, so it needs the same brand the
   * server prints with — or what is on screen and what comes off the printer
   * would carry different names.
   */
  brand: () => call<Brand>('/api/brand'),

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

  /** Who is signed in. The first thing the editor asks, every time it loads. */
  session: () => call<Session>('/api/session'),
  signIn: (email: string, password: string) =>
    call<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  signOut: () => call<void>('/api/auth/logout', { method: 'POST' }),
  /** What an invitation is for, without using it up. */
  invitation: (token: string) => call<InvitationOffer>(`/api/auth/invitation/${encodeURIComponent(token)}`),
  /** Follow it: choose a password, and be signed in. */
  acceptInvitation: (token: string, name: string, password: string) =>
    call<Session>('/api/auth/accept', {
      method: 'POST',
      body: JSON.stringify({ token, name, password }),
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
