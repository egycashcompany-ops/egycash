// The 3D folder on the shelf, drawn once.
//
// It was markup inside the applicant tile until the folder grew sub-folders, and a sub-folder that
// looked like anything else would have made the second level read as a different screen rather than
// a drawer inside the same one. So the drawing lives here and both levels ask for it, in two sizes:
// the applicant's folder on the shelf, and the smaller drawers inside it.
//
// The COLOURS are the ones the shelf already had — brand-700/800 for the back panel and the
// brand-500→600 gradient for the front — and nothing here introduces another. Only the geometry
// changes with the size, which is why each size names its own insets rather than scaling a
// shorthand: the papers inside a 6rem folder peek out at offsets a 9rem folder would hide.
import { type ReactNode } from 'react';
import { cn } from '../../../../../shared/lib/cn';

export type FolderSize = 'lg' | 'sm';

/**
 * Per-size geometry. `front` is where the front panel starts, which is what makes the papers
 * behind it visible; the rest follow from it.
 */
const GEOMETRY: Record<
  FolderSize,
  {
    frame: string;
    tab: string;
    back: string;
    paperOuter: string;
    paperInner: string;
    front: string;
    lift: string;
    nudge: string;
  }
> = {
  lg: {
    frame: 'h-36 max-w-[210px]',
    tab: 'h-6 w-2/5',
    back: 'top-3',
    paperOuter: 'inset-x-4 bottom-6 top-5',
    paperInner: 'inset-x-6 bottom-6 top-7',
    front: 'top-10',
    lift: 'group-hover:-translate-y-3',
    nudge: 'group-hover:-translate-y-1.5',
  },
  sm: {
    frame: 'h-24 max-w-[150px]',
    tab: 'h-4 w-2/5',
    back: 'top-2',
    paperOuter: 'inset-x-3 bottom-4 top-3',
    paperInner: 'inset-x-5 bottom-4 top-5',
    front: 'top-7',
    lift: 'group-hover:-translate-y-2',
    nudge: 'group-hover:-translate-y-1',
  },
};

/**
 * One folder.
 *
 * `face` sits in the middle of the front panel — a photograph upstairs, an icon in the drawers.
 * `startBadge` and `endBadge` are the two corners the shelf already uses, kept as slots so the
 * sub-folders can put a file count where the applicant folder puts one and nothing where it puts
 * the «البطاقة» marker.
 *
 * `dimmed` is for a drawer with nothing in it. It lowers the opacity and does NOT recolour: an
 * empty folder must still read as the same folder, or HR learns to look for a grey one.
 */
export const FolderShell = ({
  size,
  face,
  startBadge,
  endBadge,
  dimmed = false,
}: {
  size: FolderSize;
  face: ReactNode;
  startBadge?: ReactNode;
  endBadge?: ReactNode;
  dimmed?: boolean;
}): JSX.Element => {
  const g = GEOMETRY[size];
  return (
    <span
      className={cn('relative block w-full [perspective:900px]', g.frame, dimmed && 'opacity-50')}
    >
      {/* Back panel with its tab */}
      <span
        className={cn('absolute start-0 top-0 rounded-t-xl bg-brand-700 dark:bg-brand-800', g.tab)}
      />
      <span
        className={cn(
          'absolute inset-x-0 bottom-0 rounded-xl rounded-ss-none bg-brand-700 shadow-lg shadow-brand-900/20 dark:bg-brand-800',
          g.back,
        )}
      />
      {/* Papers inside, rising as the folder opens */}
      <span
        className={cn(
          'absolute rounded-lg bg-white shadow-sm transition-transform duration-300 group-hover:-rotate-2 dark:bg-slate-200',
          g.paperOuter,
          g.lift,
        )}
      />
      <span
        className={cn(
          'absolute rounded-lg bg-slate-50 shadow-sm transition-transform duration-300 group-hover:rotate-2 dark:bg-slate-300',
          g.paperInner,
          g.nudge,
        )}
      />
      {/* Front panel, tipping forward on hover */}
      <span
        className={cn(
          'absolute inset-x-0 bottom-0 flex origin-bottom items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 shadow-[0_-4px_12px_rgba(0,0,0,0.12)] ring-1 ring-white/10 transition-transform duration-300 [transform-style:preserve-3d] group-hover:[transform:rotateX(-22deg)]',
          g.front,
        )}
      >
        {face}
        {endBadge !== undefined && (
          <span className="absolute bottom-2 end-2 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold text-white">
            {endBadge}
          </span>
        )}
        {startBadge}
      </span>
    </span>
  );
};
