// A platform's mark, wherever an applicant source is shown.
//
// One component so the fallback is one decision: a source with no icon gets the same neutral glyph
// everywhere, instead of each screen inventing its own placeholder (or showing a broken image).
// That matters because the icon is optional by design — most catalogs will never have one for
// "walk-in" — so the empty case is the normal case, not an error.
import { type ApplicantSourceDto, type Locale } from '@ecms/contracts';
import { useFileTicket } from '../../../../../shared/lib/file-ticket';
import { localized } from '../../../../../shared/lib/format';
import { cn } from '../../../../../shared/lib/cn';
import { LinkIcon } from '../../../../../shared/ui/icons';

export const SourceIcon = ({
  source,
  locale,
  size = 'sm',
}: {
  source: Pick<ApplicantSourceDto, 'iconFileId' | 'name'>;
  locale: Locale;
  size?: 'sm' | 'lg';
}): JSX.Element => {
  const ticket = useFileTicket(source.iconFileId);
  const box = size === 'lg' ? 'h-12 w-12' : 'h-8 w-8';
  const shell = cn(
    box,
    'shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800',
  );

  // No icon, or a ticket that could not be issued (deleted file, no download grant): the default
  // mark. Never a broken <img>.
  if (source.iconFileId === null || ticket.data === undefined) {
    return (
      <span className={cn(shell, 'grid place-items-center text-slate-400')}>
        <LinkIcon className={size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'} />
      </span>
    );
  }

  return (
    <span className={shell}>
      <img
        src={ticket.data.url}
        alt={localized(source.name, locale)}
        className="h-full w-full object-contain"
        loading="lazy"
      />
    </span>
  );
};
