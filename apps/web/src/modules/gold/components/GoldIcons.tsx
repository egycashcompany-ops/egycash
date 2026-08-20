// One glyph the shared kit does not carry: the drawer key.
//
// It lives here rather than in `shared/ui/icons` because it means something only in this module —
// the shared set is the platform's vocabulary, and a key is the vault's.
import { type SVGProps } from 'react';

export const KeyIcon = ({ className, ...props }: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className ?? 'h-5 w-5'}
    {...props}
  >
    <circle cx="8" cy="15" r="4" />
    <path d="M10.85 12.15 19 4" />
    <path d="m18 5 2 2" />
    <path d="m15 8 2 2" />
  </svg>
);
