// Applicant attachments: list existing files, upload a new one (title + category + file), open
// via a short-lived signed URL, and remove. Bytes flow through the applicant endpoints (Files
// service server-side). Upload/remove are gated by the caller (applicant.edit).
import { useState } from 'react';
import { type FileDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { localized } from '../../../../../shared/lib/format';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { FileUpload } from '../../../../../shared/ui/FileUpload';
import { LoadingState } from '../../../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../../../shared/ui/states/ErrorState';
import { EmptyState } from '../../../../../shared/ui/states/EmptyState';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { DownloadIcon, PlusIcon, TrashIcon } from '../../../../../shared/ui/icons';
import {
  useAddApplicantAttachment,
  useApplicantAttachments,
  useFileCategories,
  useRemoveApplicantAttachment,
} from '../api/applicant-queries';
import { fileDownloadTicket } from '../api/applicant-api';

export const AttachmentsPanel = ({
  applicantId,
  canEdit,
}: {
  applicantId: string;
  canEdit: boolean;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const { data: files = [], isLoading, isError, error, refetch } = useApplicantAttachments(applicantId);
  const { data: categories = [] } = useFileCategories();
  const add = useAddApplicantAttachment(applicantId);
  const remove = useRemoveApplicantAttachment(applicantId);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const reset = (): void => {
    setTitle('');
    setCategoryId('');
    setNotes('');
    setFile(null);
  };

  const submit = async (): Promise<void> => {
    if (file === null || title.trim() === '' || categoryId === '') return;
    const form = new FormData();
    form.append('file', file);
    form.append('title', title.trim());
    form.append('categoryId', categoryId);
    if (notes.trim() !== '') form.append('notes', notes.trim());
    try {
      await add.mutateAsync(form);
      toast.success(t('applicants.attachments.added'));
      setOpen(false);
      reset();
    } catch {
      // surfaced globally
    }
  };

  const download = async (f: FileDto): Promise<void> => {
    try {
      const ticket = await fileDownloadTicket(f.id);
      window.open(ticket.url, '_blank', 'noopener');
    } catch {
      toast.error(t('applicants.attachments.downloadFailed'));
    }
  };

  const doRemove = async (f: FileDto): Promise<void> => {
    try {
      await remove.mutateAsync(f.id);
      toast.success(t('applicants.attachments.removed'));
    } catch {
      // surfaced globally
    }
  };

  return (
    <Card>
      <CardHeader
        title={t('applicants.attachments.title')}
        actions={
          canEdit ? (
            <Button size="sm" variant="secondary" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setOpen(true)}>
              {t('applicants.attachments.add')}
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : files.length === 0 ? (
          <EmptyState title={t('applicants.attachments.empty')} />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{f.displayName}</span>
                  <span className="block truncate text-xs text-slate-400" dir="ltr">{f.originalName}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void download(f)} aria-label={t('common.download')}>
                  <DownloadIcon className="h-4 w-4" />
                </Button>
                {canEdit && (
                  <Button size="sm" variant="ghost" onClick={() => void doRemove(f)} aria-label={t('common.remove')}>
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('applicants.attachments.add')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={add.isPending} disabled={file === null || title.trim() === '' || categoryId === ''} onClick={() => void submit()}>
              {t('applicants.attachments.upload')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('applicants.attachments.docTitle')} required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('applicants.attachments.category')} required>
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('applicants.attachments.selectCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{localized(c.name, locale)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('applicants.attachments.notes')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <FileUpload maxSizeMb={50} onFiles={(fs) => setFile(fs[0] ?? null)} />
        </div>
      </Dialog>
    </Card>
  );
};
