// A platform's mark, wherever an applicant source is shown.
//
// One component so the fallback is one decision: a source with no icon gets the same neutral glyph
// everywhere, instead of each screen inventing its own placeholder (or showing a broken image).
// That matters because the icon is optional by design — most catalogs will never have one for
// "walk-in" — so the empty case is the normal case, not an error.
import { type ApplicantSourceDto, type Locale } from '@ecms/contracts';
import { useFileTicket } from '../../../../../shared/lib/file-ticket';
import { localized } from '../../../../../shared/lib/format';
import { Avatar } from '../../../../../shared/ui/Avatar';
import { LinkIcon } from '../../../../../shared/ui/icons';

/** The fallback glyph tracks the box, so a placeholder never looks like a shrunken logo. */
const GLYPH = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' } as const;

export const SourceIcon = ({
  source,
  locale,
  size = 'sm',
}: {
  source: Pick<ApplicantSourceDto, 'iconFileId' | 'name'>;
  locale: Locale;
  size?: keyof typeof GLYPH;
}): JSX.Element => {
  const ticket = useFileTicket(source.iconFileId);
  // No icon, or a ticket that could not be issued (deleted file, no download grant): the default
  // mark. Never a broken <img>.
  const src = source.iconFileId === null ? null : (ticket.data?.url ?? null);
  return (
    <Avatar
      src={src}
      alt={localized(source.name, locale)}
      size={size}
      fallback={<LinkIcon className={GLYPH[size]} />}
    />
  );
};
