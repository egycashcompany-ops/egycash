// A ticket's attachments (design §2 files row, §15).
//
// **No new upload path.** The platform Files service already accepts the owning `entityRef` from
// the caller, so a ticket attachment is an ordinary platform file tagged `it/ticket/<id>` — IT
// mints no upload endpoint and no permission of its own. The gates are the platform's own
// `file.view` and `file.create`, and a caller lacking either is told so rather than being shown a
// control that can only 403.
//
// Direct ticket attachments are PUBLIC to anyone who can see the ticket (design §13-Q9), so there
// is no visibility control here — the ticket's own scope is the boundary.
//
// Downloads go through a signed TICKET rather than a URL with a header: a stored file is not
// addressable by a plain link, which is exactly what `useFileTicket` exists for.
import { useRef, useState } from 'react';
import { type FileDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { Button } from '../../../shared/ui/Button';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import { DownloadIcon, FileIcon, UploadIcon } from '../../../shared/ui/icons';
import { formatDateTime } from '../../../shared/lib/format';
import { get } from '../../../shared/lib/api-client';
import {
  useItFileCategories,
  useItTicketAttachments,
  useUploadItTicketAttachment,
} from '../api/it-queries';

/** Bytes → something a human reads. Presentation only; the server owns the limit. */
const humanSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
};

export const TicketAttachments = ({ ticketId }: { ticketId: string }): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canView = can('file.view');
  const canUpload = can('file.create');
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const files = useItTicketAttachments(ticketId, canView);
  const categories = useItFileCategories(canUpload);
  const uploadFile = useUploadItTicketAttachment();

  // The upload needs a category id; without any category configured there is nothing valid to
  // send, so the control says why instead of failing on submit.
  const categoryId = categories.data?.items[0]?.id ?? '';

  const onPick = async (file: File | undefined): Promise<void> => {
    if (file === undefined || categoryId === '') return;
    setBusy(true);
    try {
      await uploadFile.mutateAsync({ ticketId, file, categoryId });
      toast.success(t('it.tickets.attachmentAdded'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setBusy(false);
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  };

  const download = async (file: FileDto): Promise<void> => {
    try {
      const ticket = await get<{ url: string }>(`/platform/files/${file.id}/download?mode=ticket`);
      window.open(ticket.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  if (!canView) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('it.tickets.filesNoAccess')}</p>
    );
  }

  return (
    <div className="space-y-3">
      {canUpload && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            aria-label={t('it.tickets.addAttachment')}
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<UploadIcon className="h-4 w-4" />}
            loading={busy}
            disabled={categoryId === ''}
            onClick={() => inputRef.current?.click()}
          >
            {t('it.tickets.addAttachment')}
          </Button>
          {categoryId === '' && !categories.isPending && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('it.tickets.noFileCategory')}
            </span>
          )}
        </div>
      )}

      {files.isPending ? (
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : files.isError ? (
        <ErrorState error={files.error} onRetry={() => void files.refetch()} />
      ) : (files.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          title={t('it.tickets.filesEmptyTitle')}
          description={t('it.tickets.filesEmptyBody')}
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(files.data?.items ?? []).map((file) => (
            <li key={file.id} className="flex items-center gap-3 py-2">
              <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800 dark:text-slate-100">
                {file.displayName}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {humanSize(file.size)}
              </span>
              <span className="hidden shrink-0 text-xs tabular-nums text-slate-500 sm:inline dark:text-slate-400">
                {formatDateTime(file.uploadedAt, locale)}
              </span>
              <button
                type="button"
                onClick={() => void download(file)}
                aria-label={`${t('common.download')} — ${file.displayName}`}
                title={t('common.download')}
                className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <DownloadIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
