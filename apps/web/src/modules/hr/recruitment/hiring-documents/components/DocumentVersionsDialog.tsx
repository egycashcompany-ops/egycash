// Version history for one document type: the preserved prior file versions (newest first), each
// openable via a short-lived signed URL. Reuses the platform Files download ticket.
import { type FileDto, type Locale, type LocalizedString } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Spinner } from '../../../../../shared/ui/Spinner';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { DownloadIcon } from '../../../../../shared/ui/icons';
import { formatDateTime, formatNumber, localized } from '../../../../../shared/lib/format';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { fileDownloadTicket } from '../../applicants/api/applicant-api';
import { useDocumentVersions } from '../api/hiring-documents-queries';

export const DocumentVersionsDialog = ({
  onClose,
  hiringDocsId,
  typeId,
  typeName,
}: {
  onClose: () => void;
  hiringDocsId: string;
  typeId: string;
  typeName: LocalizedString;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data: versions = [], isLoading, isError, error, refetch } = useDocumentVersions(hiringDocsId, typeId);

  const download = async (f: FileDto): Promise<void> => {
    try {
      const ticket = await fileDownloadTicket(f.id);
      window.open(ticket.url, '_blank', 'noopener');
    } catch {
      toast.error(t('hiringDocs.doc.downloadFailed'));
    }
  };

  const ordered = versions.slice().reverse();

  return (
    <Dialog open onClose={onClose} title={t('hiringDocs.versions.title')} description={localized(typeName, locale)}>
      {isLoading ? (
        <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-brand-600" /></div>
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : ordered.length === 0 ? (
        <EmptyState title={t('hiringDocs.versions.empty')} />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {ordered.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800 dark:text-slate-100" dir="ltr">{f.originalName}</span>
                <span className="block text-xs text-slate-400">
                  {t('hiringDocs.versions.version', { n: formatNumber(f.fileVersion, locale) })} · {formatDateTime(f.uploadedAt, locale)}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void download(f)} aria-label={t('common.download')}>
                <DownloadIcon className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
};
