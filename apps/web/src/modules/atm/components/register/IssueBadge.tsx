// The import notes of a register row, as one quiet mark beside its Name.
//
// An imported row keeps every oddity the workbook had — a blank area, a bank written «نيكست», an
// ATM ID with stray spaces — instead of having it silently fixed (D6, D8). The grid must not read
// as a wall of warnings because of that: ~a third of the sheet carries a note. So a row shows ONE
// amber glyph, and the notes themselves are in its tooltip and its accessible name, each with the
// column it came from. Never a value: the server sends a note's detail only for public columns,
// and the badge shows codes and column letters, nothing else.
import { type AtmRegisterImportIssueDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatNumber } from '../../../../shared/lib/format';
import { AlertIcon } from '../../../../shared/ui/icons';

/** One line per note: «لا يوجد اسم للماكينة في الملف (E)». */
export const issueLines = (
  issues: readonly AtmRegisterImportIssueDto[],
  t: (key: string) => string,
): string[] =>
  issues.map((issue) => {
    const label = t(`atm.register.issue.${issue.code}`);
    return issue.column === null ? label : `${label} (${issue.column})`;
  });

export const IssueBadge = ({
  issues,
}: {
  issues: readonly AtmRegisterImportIssueDto[];
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (issues.length === 0) return null;
  const count = t('atm.register.issues', { count: formatNumber(issues.length, locale) });
  const tooltip = [count, ...issueLines(issues, t)].join('\n');
  return (
    <span
      data-register-issues={issues.length}
      title={tooltip}
      className="inline-flex shrink-0 items-center text-amber-500 dark:text-amber-400"
    >
      <AlertIcon className="h-3.5 w-3.5" />
      <span className="sr-only">{tooltip}</span>
    </span>
  );
};
