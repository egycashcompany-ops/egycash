// One file into a folder — «يرفع جوا كل فولدر فايلات PDF أو Word أو Excel وحط ليميت 20M». Written
// after Administrative Affairs' «إضافة مستند» (`AddPaperDialog`): the shared `FileUpload` picks the
// file and refuses one over 20 MB itself; a file whose name is not PDF, Word or Excel is refused
// beside the field, and the picker starts afresh so it never lists what will not be sent. The
// server checks both again, and the contents as well. The name is the file's own unless one is
// typed, and can be changed later. While the file is being sent, the picker is closed and a bar
// shows how far it has gone — a 20 MB file takes a moment.
import { useEffect, useState } from 'react';
import {
  COMPLIANCE_DOCUMENT_EXTENSIONS,
  COMPLIANCE_DOCUMENT_MAX_MB,
  complianceKindOf,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { FileUpload } from '../../../shared/ui/FileUpload';
import { Field, Input } from '../../../shared/ui/form';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAddDocument } from '../api/compliance-queries';
import { COMPLIANCE_NAME_MAX, baseNameOf } from '../lib/folder-form';
import { ComplianceDialogFrame } from './ComplianceDialogFrame';

const ACCEPT = COMPLIANCE_DOCUMENT_EXTENSIONS.join(',');

export const UploadDocumentDialog = ({
  open,
  folderId,
  folderName,
  onClose,
}: {
  open: boolean;
  folderId: string;
  folderName: string;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [wrongType, setWrongType] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // The picker keeps its own list: a fresh one per opening, and after a refused file.
  const [opening, setOpening] = useState(0);
  /** The name last filled in from a picked file — replaced by the next pick unless it was edited. */
  const [suggested, setSuggested] = useState('');
  const add = useAddDocument();

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setName('');
    setSuggested('');
    setWrongType(false);
    setProgress(null);
    setFailure(null);
    setOpening((n) => n + 1);
  }, [open]);

  const required = useRequiredFields(
    [{ key: 'file', label: t('compliance.upload.file'), ok: file !== null }],
    open,
  );

  const pick = (files: File[]): void => {
    const picked = files[0] ?? null;
    if (picked !== null && complianceKindOf(picked.name) === null) {
      setFile(null);
      setWrongType(true);
      setOpening((n) => n + 1);
      return;
    }
    setWrongType(false);
    setFile(picked);
    // The name follows the file while the person has not written their own.
    if (name.trim() === '' || name === suggested) {
      const next = picked === null ? '' : baseNameOf(picked.name).slice(0, COMPLIANCE_NAME_MAX);
      setName(next);
      setSuggested(next);
    }
  };

  const save = async (): Promise<void> => {
    if (file === null) return;
    setFailure(null);
    setProgress(0);
    try {
      await add.mutateAsync({ folderId, file, name, onProgress: setProgress });
      toast.success(t('compliance.upload.done'));
      onClose();
    } catch (error) {
      setFailure(error);
    } finally {
      setProgress(null);
    }
  };

  return (
    <ComplianceDialogFrame
      open={open}
      onClose={onClose}
      title={t('compliance.upload.title')}
      description={folderName}
      required={required}
      onSave={save}
      busy={add.isPending}
      saveLabel={t('compliance.upload.save')}
      error={failure === null ? null : errorMessage(failure, locale)}
    >
      <Field
        label={t('compliance.upload.file')}
        hint={t('compliance.upload.fileHint', { size: COMPLIANCE_DOCUMENT_MAX_MB })}
        required
        missing={required.isMissing('file')}
        error={wrongType ? t('compliance.upload.wrongType') : undefined}
      >
        <FileUpload
          key={opening}
          accept={ACCEPT}
          maxSizeMb={COMPLIANCE_DOCUMENT_MAX_MB}
          onFiles={pick}
          disabled={add.isPending}
        />
      </Field>
      <Field label={t('compliance.upload.name')} hint={t('compliance.upload.nameHint')}>
        <Input
          value={name}
          maxLength={COMPLIANCE_NAME_MAX}
          disabled={add.isPending}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {progress !== null && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('compliance.upload.progress')}
          className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        >
          <div
            className="h-full bg-brand-600 transition-[width]"
            style={{ width: `${String(progress)}%` }}
          />
        </div>
      )}
    </ComplianceDialogFrame>
  );
};
