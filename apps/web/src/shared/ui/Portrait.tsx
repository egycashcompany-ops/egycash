// A person's face: their photo, or — while there is none — the first letter of their name on the
// brand colour, in the same circle. One component for every place a face appears (the welcome
// page, the employee's profile, the top bar) so a person looks the same everywhere.
//
// The circle is the BOX: its size never depends on the picture, and `object-cover` fills it from
// the centre whatever shape the upload was.
import { useEffect, useState } from 'react';
import { cn } from '../lib/cn';

const SIZES = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-12 w-12 text-lg',
  lg: 'h-20 w-20 text-3xl',
  xl: 'h-24 w-24 text-4xl',
} as const;

/** The letter that stands in for a missing photo: the first letter of the first word. */
export const initialOf = (name: string): string => name.trim().charAt(0) || '؟';

export const Portrait = ({
  url,
  name,
  size = 'md',
  className,
  decorative = false,
}: {
  /** An object URL or any `src`; `null` shows the initial. */
  url: string | null;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  /** Beside the person's name already: the picture adds nothing to read aloud. */
  decorative?: boolean;
}): JSX.Element => {
  const [failed, setFailed] = useState(false);
  // A new picture gets a fresh chance to load.
  useEffect(() => setFailed(false), [url]);
  const showImage = url !== null && !failed;
  return (
    <span
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200',
        SIZES[size],
        className,
      )}
    >
      {showImage ? (
        <img
          src={url}
          alt={decorative ? '' : name}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span aria-hidden="true">{initialOf(name)}</span>
      )}
    </span>
  );
};
