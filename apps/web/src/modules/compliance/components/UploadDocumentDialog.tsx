// One file into a folder — «يرفع جوا كل فولدر فايلات PDF أو Word أو Excel وحط ليميت 20M». The
// file is checked here before a byte leaves — its kind by its name, its size against 20 MB — so a
// wrong pick is said at once instead of after the upload; the server checks both again, and its
// contents as well. The name is the file's own unless one is typed, and can be changed later.
import { useEffect, useRef, useState } from 'react';
import {
  COMPLIANCE_DOCUMENT_EXTENSIONS,
  COMPLIANCE_DOCUMENT_MAX_MB,
  complianceKindOf,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { Button } from '../../../shared/ui/Button';
import { Field, Input } from '../../../shared/ui/form';
import { FileIcon, UploadIcon } from '../../../shared/ui/icons';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useAddDocument } from '../api/compliance-queries';
import { COMPLIANCE_NAME_MAX, baseNameOf } from '../lib/folder-form';
import { ComplianceDialogFrame } from './ComplianceDialogFrame';
import { sizeOf } from './file-bits';

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
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const add = useAddDocument();

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setName('');
    setProblem(null);
    setProgress(null);
    setFailure(null);
  }, [open]);

  const required = useRequiredFields(
    [{ key: 'file', label: t('compliance.upload.file'), ok: file !== null }],
    open,
  );

  const pick = (picked: File | undefined): void => {
    if (input.current !== null) input.current.value = '';
    if (picked === undefined) return;
    if (complianceKindOf(picked.name) === null) {
      setProblem(t('compliance.upload.wrongType'));
      setFile(null);
      return;
    }
    if (picked.size > COMPLIANCE_DOCUMENT_MAX_MB * 1024 * 1024) {
      setProblem(t('compliance.upload.tooLarge', { size: COMPLIANCE_DOCUMENT_MAX_MB }));
      setFile(null);
      return;
    }
    setProblem(null);
    setFile(picked);
    if (name.trim() === '') setName(baseNameOf(picked.name).slice(0, COMPLIANCE_NAME_MAX));
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
        required
        missing={required.isMissing('file')}
        hint={t('compliance.upload.fileHint', { size: COMPLIANCE_DOCUMENT_MAX_MB })}
        error={problem ?? undefined}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            type="file"
            accept={COMPLIANCE_DOCUMENT_EXTENSIONS.join(',')}
            className="hidden"
            onChange={(event) => pick(event.target.files?.[0])}
          />
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()}>
            <UploadIcon className="h-4 w-4" />
            {t(file === null ? 'compliance.upload.pick' : 'compliance.upload.pickAnother')}
          </Button>
          {file !== null && (
            <span className="inline-flex min-w-0 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <FileIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="truncate" dir="auto">
                {file.name}
              </span>
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                {sizeOf(file.size)}
              </span>
            </span>
          )}
        </div>
      </Field>
      <Field label={t('compliance.upload.name')} hint={t('compliance.upload.nameHint')}>
        <Input
          value={name}
          maxLength={COMPLIANCE_NAME_MAX}
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
