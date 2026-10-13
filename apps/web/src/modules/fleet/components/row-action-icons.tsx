// The glyphs of the owner's picture of a row's actions (`row-actions-look.ts`) that the shared set
// does not draw: the bin with its two inner lines, the pen on a square, the cloud with the arrow
// going up into it and the arrow lifting off a line. Drawn the way the shared set draws (24-unit
// box, 2px round strokes, `currentColor`), so they sit beside its eye and printer as one family.
// Kept in Fleet: the shared `TrashIcon` and `EditIcon` are what every other module shows, and
// they stay as they are.
import { type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const Glyph = ({ className, children, ...props }: IconProps): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className ?? 'h-4 w-4'}
    {...props}
  >
    {children}
  </svg>
);

/** Delete — the bin with the two lines inside it. */
export const Trash2Icon = (p: IconProps): JSX.Element => (
  <Glyph {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </Glyph>
);

/** Edit — the pen on a square. */
export const SquarePenIcon = (p: IconProps): JSX.Element => (
  <Glyph {...p}>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12.4 14.6a2 2 0 0 1-.9.5l-2.9.8.8-2.9a2 2 0 0 1 .5-.9z" />
  </Glyph>
);

/** An empty image cell — the cloud with the arrow going up into it. */
export const CloudUploadIcon = (p: IconProps): JSX.Element => (
  <Glyph {...p}>
    <path d="M12 13v8" />
    <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
    <path d="m8 17 4-4 4 4" />
  </Glyph>
);

/** Replace an image already there — the arrow lifting off a line. */
export const ArrowUpFromLineIcon = (p: IconProps): JSX.Element => (
  <Glyph {...p}>
    <path d="m18 9-6-6-6 6" />
    <path d="M12 3v14" />
    <path d="M5 21h14" />
  </Glyph>
);
