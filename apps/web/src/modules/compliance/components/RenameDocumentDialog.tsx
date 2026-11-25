// A file's name, changed by the responsible person — «وبردو يقدر يغير مسمياتهم». The name only: the
// bytes, and the name the file had on the uploader's computer, stay as they were.
import { useEffect, useState } from 'react';
import { ErrorCodes, type ComplianceDocumentDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { ApiError } from '../../../shared/lib/api-client';
import { errorMessage } from '../../../shared/lib/errors';
import { Field, Input } from '../../../shared/ui/form';
import { useRequiredFields } from '../../../shared/ui/required-fields';
import { toast } from '../../../shared/ui/toast/toast-store';
import { listDocuments } from '../api/compliance-api';
import { useRenameDocument } from '../api/compliance-queries';
import { COMPLIANCE_NAME_MAX } from '../lib/folder-form';
import { ComplianceDialogFrame } from './ComplianceDialogFrame';

export const RenameDocumentDialog = ({
  document,
  onClose,
}: {
  document: ComplianceDocumentDto | null;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<unknown>(null);
  /** The file as the server last answered it: a stale save rebases on it, keeping what was typed. */
  const [base, setBase] = useState<ComplianceDocumentDto | null>(document);
  const rename = useRenameDocument();
  const open = document !== null;

  useEffect(() => {
    if (document === null) return;
    setBase(document);
    setName(document.name);
    setFailure(null);
  }, [document]);

  const required = useRequiredFields(
    [{ key: 'name', label: t('compliance.rename.name'), ok: name.trim() !== '' }],
    open,
  );

  const save = async (): Promise<void> => {
    if (base === null) return;
    setFailure(null);
    try {
      if (name.trim() !== base.name) {
        await rename.mutateAsync({ id: base.id, name: name.trim(), version: base.version });
        toast.success(t('compliance.rename.done'));
      }
      onClose();
    } catch (error) {
      setFailure(error);
      if (error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) {
        const page = await listDocuments(base.folderId).catch(() => null);
        const fresh = page?.items.find((item) => item.id === base.id);
        if (fresh !== undefined) {
          // A name this person did not change takes the one saved meanwhile.
          if (name.trim() === base.name) setName(fresh.name);
          setBase(fresh);
        }
      }
    }
  };

  return (
    <ComplianceDialogFrame
      open={open}
      onClose={onClose}
      title={t('compliance.rename.title')}
      {...(base === null ? {} : { description: base.fileName })}
      required={required}
      onSave={save}
      busy={rename.isPending}
      error={failure === null ? null : errorMessage(failure, locale)}
    >
      <Field label={t('compliance.rename.name')} required missing={required.isMissing('name')}>
        <Input
          value={name}
          maxLength={COMPLIANCE_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
    </ComplianceDialogFrame>
  );
};
