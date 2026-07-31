import type { Rates } from '../costing/rates.js';
import type { PalletSummary } from '../server/repository.js';
import type { Pallet } from '../types.js';

/** The editor's side of the local API. */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `${response.status} ${response.statusText}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
  list: () => call<PalletSummary[]>('/api/pallets'),
  get: (id: string) => call<Pallet>(`/api/pallets/${id}`),
  create: (pallet: Pallet) =>
    call<Pallet>('/api/pallets', { method: 'POST', body: JSON.stringify(pallet) }),
  save: (pallet: Pallet) =>
    call<Pallet>(`/api/pallets/${pallet.id}`, { method: 'PUT', body: JSON.stringify(pallet) }),
  freeze: (id: string) => call<Pallet>(`/api/pallets/${id}/freeze`, { method: 'POST' }),
  revise: (id: string) => call<Pallet>(`/api/pallets/${id}/revise`, { method: 'POST' }),
  duplicate: (id: string) => call<Pallet>(`/api/pallets/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => call<void>(`/api/pallets/${id}`, { method: 'DELETE' }),
  rates: () => call<Rates>('/api/rates'),
  sheetUrl: (id: string) => `/api/pallets/${id}/sheet.pdf`,
  dxfUrl: (id: string) => `/api/pallets/${id}/drawing.dxf`,
};

export type { PalletSummary };
