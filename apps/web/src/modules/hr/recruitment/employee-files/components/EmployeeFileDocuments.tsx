// The Employee File's documents: independent COPIES made from the hiring documents at assembly
// (editing/removing a copy never touches the original) plus any custom HR uploads. Upload/remove
// are gated by `employeeFile.upload` and version-checked. RTL-safe.
import { useRef, useState } from 'react';
import { type EmployeeFileDocumentDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can, useCan } from '../../../../../platform/rbac/Can';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Input } from '../../../../../shared/ui/form';
import { StatusBadge } from '../../../../../shared/ui/Badge';
import { TrashIcon } from '../../../../../shared/ui/icons';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { formatDateTime } from '../../../../../shared/lib/format';
import {
  useRemoveEmployeeFileDocument,
  useUploadEmployeeFileDocument,
} from '../api/employee-file-queries';

export const EmployeeFileDocuments = ({
  fileId,
  documents,
  version,
}: {
  fileId: string;
  documents: EmployeeFileDocumentDto[];
  version: number;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const uploadDoc = useUploadEmployeeFileDocument(fileId);
  const removeDoc = useRemoveEmployeeFileDocument(fileId);
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');

  const canUpload = can('employeeFile.upload');

  const onPickFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    const docName = name.trim() === '' ? file.name : name.trim();
    try {
      await uploadDoc.mutateAsync({ file, name: docName, version });
      toast.success(t('employeeFiles.documents.uploaded'));
      setName('');
    } catch {
      // surfaced globally
    } finally {
      if (fileInput.current !== null) fileInput.current.value = '';
    }
  };

  const onRemove = async (documentId: string): Promise<void> => {
    try {
      await removeDoc.mutateAsync({ documentId, version });
      toast.success(t('employeeFiles.documents.removed'));
    } catch {
      // surfaced globally
    }
  };

  return (
    <Card>
      <CardHeader title={t('employeeFiles.documents.title')} description={t('employeeFiles.documents.hint')} />
      <CardBody>
        {canUpload && (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <Input
              className="flex-1"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('employeeFiles.documents.namePlaceholder')}
              maxLength={200}
            />
            <input
              ref={fileInput}
              type="file"
              className="hidden"
              onChange={(e) => void onPickFile(e.target.files?.[0])}
            />
            <Button size="sm" variant="secondary" loading={uploadDoc.isPending} onClick={() => fileInput.current?.click()}>
              {t('employeeFiles.documents.upload')}
            </Button>
          </div>
        )}

        {documents.length === 0 ? (
          <p className="text-sm text-slate-400">{t('employeeFiles.documents.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-700 dark:text-slate-200">{d.name}</p>
                  <div className="flex items-center gap-2">
                    <StatusBadge
                      tone={d.source === 'hiringDocumentCopy' ? 'info' : 'neutral'}
                      label={t(`employeeFiles.documents.source.${d.source}`)}
                    />
                    <span className="text-xs text-slate-400">{formatDateTime(d.uploadedAt, locale)}</span>
                  </div>
                </div>
                <Can permission="employeeFile.upload">
                  <button
                    type="button"
                    onClick={() => void onRemove(d.id)}
                    className="text-slate-400 hover:text-red-600"
                    aria-label={t('common.remove')}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </Can>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
};
