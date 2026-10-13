// The Data Report's as-of stamp (D7): the moment the server counted, in the sheet's U2 format
// `dd / MMMM / yyyy` on the Cairo calendar. Computation time IS data time — there is no as-of
// picker and no other date on the page.
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { CalendarIcon } from '../../../../shared/ui/icons';
import { formatAsOf } from '../../lib/register-labels';

export const AsOfStamp = ({ generatedAt }: { generatedAt: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <p
      data-report-as-of="true"
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
    >
      <CalendarIcon className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
      <time dateTime={generatedAt}>
        {t('atm.registerReport.asOf', { date: formatAsOf(generatedAt, locale) })}
      </time>
    </p>
  );
};
