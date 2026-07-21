// Upload a PDF for a document type, or replace an existing document with a new version. Multipart
// via the shared api-client `upload`; version-checked (the aggregate version travels in the form).
// PDF-only + client size guard through the shared FileUpload.
import { useState } from 'react';
import { type LocalizedString, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input } from '../../../../../shared/ui/form';
import { FileUpload } from '../../../../../shared/ui/FileUpload';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { useReplaceHiringDoc, useUploadHiringDoc } from '../api/hiring-documents-queries';

export const UploadDocumentDialog = ({
  mode,
  onClose,
  hiringDocsId,
  typeId,
  typeName,
  version,
}: {
  mode: 'upload' | 'replace';
  onClose: () => void;
  hiringDocsId: string;
  typeId: string;
  typeName: LocalizedString;
  version: number;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const uploadDoc = useUploadHiringDoc(hiringDocsId);
  const replaceDoc = useReplaceHiringDoc(hiringDocsId, typeId);
  const pending = mode === 'upload' ? uploadDoc : replaceDoc;
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');

  const submit = async (): Promise<void> => {
    if (file === null) return;
    const form = new FormData();
    form.append('file', file);
    form.append('version', String(version));
    if (mode === 'upload') {
      form.append('typeId', typeId);
      if (notes.trim() !== '') form.append('notes', notes.trim());
      try {
        await uploadDoc.mutateAsync(form);
        toast.success(t('hiringDocs.upload.uploaded'));
        onClose();
      } catch {
        // surfaced globally
      }
    } else {
      try {
        await replaceDoc.mutateAsync(form);
        toast.success(t('hiringDocs.upload.replaced'));
        onClose();
      } catch {
        // surfaced globally
      }
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === 'upload' ? t('hiringDocs.upload.title') : t('hiringDocs.upload.replaceTitle')}
      description={localized(typeName, locale)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={pending.isPending} disabled={file === null} onClick={() => void submit()}>
            {mode === 'upload' ? t('hiringDocs.upload.submit') : t('hiringDocs.upload.replaceSubmit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FileUpload accept="application/pdf" maxSizeMb={25} onFiles={(fs) => setFile(fs[0] ?? null)} />
        {mode === 'upload' && (
          <Field label={t('hiringDocs.upload.notes')} hint={t('hiringDocs.upload.notesHint')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} />
          </Field>
        )}
      </div>
    </Dialog>
  );
};
