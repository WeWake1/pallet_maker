/**
 * What the service calls itself, wherever it speaks for itself.
 *
 * A sheet carries the customer's name and never this one. This is for the
 * service's own surfaces — the sign-in screen, the library's header, the
 * browser tab, the emails it sends — so that they all say the same thing.
 */
export const PRODUCT = {
  name: 'Pallet Spec',
  /** The address, which is also the name people remember it by. */
  site: 'palletspec.app',
} as const;
