// Who has seen one file — «المسئول يشوف هما عملوا Seen ولا لأ وكام مره بالتوقيت والتاريخ».
//
// One line per person the folder is shared with: seen or not, how many times it was opened and
// downloaded, the first and the last time. Those who have not seen it come first — they are who the
// report is for. A line opens in place (the review queue's expanding row) onto every opening and
// download with its date and time, newest first. People who saw it while the folder was shared
// with them and are no longer on its list are kept apart, under their own heading: it happened.
import { useState } from 'react';
import {
  type ComplianceDocumentDto,
  type ComplianceViewerReportDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { formatDateTime } from '../../../shared/lib/format';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { LoadingState } from '../../../shared/ui';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { ChevronIcon, DownloadIcon, EyeIcon } from '../../../shared/ui/icons';
import { useSeenReport } from '../api/compliance-queries';
import { personName } from './PeoplePicker';

const PersonLine = ({ row }: { row: ComplianceViewerReportDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [open, setOpen] = useState(false);
  return (
    <li
      className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      data-seen={row.seen ? 'yes' : 'no'}
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={!row.seen}
        onClick={() => setOpen(!open)}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-start disabled:cursor-default"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {personName(row.person, locale)}
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400">
            {row.seen && row.lastAt !== null
              ? t('compliance.seen.lastAt', { at: formatDateTime(row.lastAt, locale) })
              : t('compliance.seen.never')}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          {row.seen ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                <EyeIcon className="h-3.5 w-3.5" />
                {t('compliance.seen.views', { n: row.viewCount })}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <DownloadIcon className="h-3.5 w-3.5" />
                {t('compliance.seen.downloads', { n: row.downloadCount })}
              </span>
              <ChevronIcon
                className={cn('h-4 w-4 text-slate-400 transition-transform', open && 'rotate-180')}
              />
            </>
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              {t('compliance.seen.notSeen')}
            </span>
          )}
        </span>
      </button>
      {open && row.seen && (
        <div className="border-t border-slate-200 px-4 pb-3 pt-2 dark:border-slate-800">
          {row.firstAt !== null && (
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              {t('compliance.seen.firstAt', { at: formatDateTime(row.firstAt, locale) })}
            </p>
          )}
          <ol className="space-y-1">
            {row.events.map((event, index) => (
              <li
                key={`${event.at}-${String(index)}`}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                  {event.action === 'view' ? (
                    <EyeIcon className="h-3.5 w-3.5 text-slate-400" />
                  ) : (
                    <DownloadIcon className="h-3.5 w-3.5 text-slate-400" />
                  )}
                  {t(`compliance.seen.action.${event.action}`)}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {formatDateTime(event.at, locale)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
};

export const SeenReportDialog = ({
  document,
  onClose,
}: {
  document: ComplianceDocumentDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const report = useSeenReport(document?.id ?? '');
  const data = report.data;
  const seen = data?.viewers.filter((row) => row.seen).length ?? 0;

  return (
    <Dialog
      open={document !== null}
      onClose={onClose}
      size="lg"
      title={t('compliance.seen.title')}
      {...(document === null ? {} : { description: document.name })}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('compliance.folder.close')}
        </Button>
      }
    >
      {report.isPending ? (
        <LoadingState />
      ) : report.isError || data === undefined ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-slate-600 dark:text-slate-300" data-seen-summary="">
            {data.viewers.length === 0
              ? t('compliance.seen.notShared')
              : t('compliance.seen.summary', { seen, total: data.viewers.length })}
          </p>
          {data.viewers.length > 0 && (
            <ul className="space-y-2">
              {data.viewers.map((row) => (
                <PersonLine key={row.person.userId} row={row} />
              ))}
            </ul>
          )}
          {data.former.length > 0 && (
            <section className="space-y-2">
              <h5 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {t('compliance.seen.former')}
              </h5>
              <ul className="space-y-2">
                {data.former.map((row) => (
                  <PersonLine key={row.person.userId} row={row} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Dialog>
  );
};
