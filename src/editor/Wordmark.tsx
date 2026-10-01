import { PRODUCT } from '../product.js';

/**
 * The service's own mark: a pallet seen from the side — deck, blocks, deck —
 * white on the accent blue. The same drawing is the tab's icon, inlined in
 * index.html, so the two have to be changed together.
 */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} className="shrink-0">
      <rect width="24" height="24" rx="5" fill="var(--color-accent)" />
      <g fill="#ffffff">
        <rect x="4" y="6.5" width="16" height="2.6" rx="0.6" />
        <rect x="5" y="10.1" width="3" height="3.4" rx="0.4" />
        <rect x="10.5" y="10.1" width="3" height="3.4" rx="0.4" />
        <rect x="16" y="10.1" width="3" height="3.4" rx="0.4" />
        <rect x="4" y="14.5" width="16" height="2.6" rx="0.6" />
      </g>
    </svg>
  );
}

/**
 * The mark and the address beside it. The address is the name: it is what
 * somebody types to come back, so it is what the screen says.
 */
export function Wordmark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const [name, tld] = PRODUCT.site.split(/(?=\.)/);
  return (
    <span className={`inline-flex items-center ${size === 'lg' ? 'gap-2.5' : 'gap-2'}`}>
      <Mark size={size === 'lg' ? 28 : 20} />
      <span className={`tracking-tight text-ink ${size === 'lg' ? 'text-[1.375rem]' : 'text-title'}`}>
        <span className="font-semibold">{name}</span>
        <span className="font-normal text-ink-faint">{tld}</span>
      </span>
    </span>
  );
}
