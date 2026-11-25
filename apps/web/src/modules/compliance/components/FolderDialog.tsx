// Inside one folder: its files, each with «عرض» and «تنزيل» — all a person the folder is shared with
// may do («محدش يقدر يغير أو يعدل حاجة هما بس يقدروا يفتحوا الفايلات ويعملولها Download و View»).
//
// The responsible person sees more on the same rows: how many of the folder's people have seen each
// file (opening the report of who, how often and when), and the file's rename and removal; above the
// list, who the folder is shared with and the upload; in the footer, the folder's own edit and
// removal. Everything they see is offered by `complianceFile.manage` — a reader's screen has none
// of it, and the server refuses it to them all the same.
//
// The dialog is the reference's (`ApplicantFolderDialog`): the shared `Dialog` at `xl`, the folder's
// name as its title, Close and «تنزيل الكل» in the footer. One level — a folder holds files, not
// drawers.
import { useState } from 'react';
import { type ComplianceDocumentDto, type ComplianceFolderDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { useAppSelector } from '../../../store';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDateTime } from '../../../shared/lib/format';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { LoadingState } from '../../../shared/ui';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  DownloadIcon,
  EditIcon,
  EyeIcon,
  FileIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
} from '../../../shared/ui/icons';
import {
  useComplianceFolder,
  useDeleteDocument,
  useFolderDocuments,
} from '../api/compliance-queries';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { RowButton, downloadDocument, openDocument, sizeOf } from './file-bits';
import { personName } from './PeoplePicker';
import { PreviewDialog } from './PreviewDialog';
import { RenameDocumentDialog } from './RenameDocumentDialog';
import { SeenReportDialog } from './SeenReportDialog';
import { UploadDocumentDialog } from './UploadDocumentDialog';

const FileRow = ({
  doc,
  manager,
  onView,
  onDownload,
  onSeen,
  onRename,
  onDelete,
}: {
  doc: ComplianceDocumentDto;
  manager: boolean;
  onView: () => void;
  onDownload: () => void;
  onSeen: () => void;
  onRename: () => void;
  onDelete: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // «اطّلع n من m» — only where the folder is shared with someone: a folder shared with nobody
  // says so once, above the list, not again on every file.
  const seen = manager && doc.seen !== null && doc.seen.sharedWith > 0 ? doc.seen : null;
  const seenText =
    seen === null ? '' : t('compliance.seen.badge', { seen: seen.seenBy, total: seen.sharedWith });
  return (
    // `flex-wrap`, unlike the reference's row: the responsible person's row carries five actions,
    // and on a phone they go under the name rather than past the dialog's edge.
    <li
      className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-900"
      data-document={doc.id}
    >
      <button
        type="button"
        title={t('compliance.file.view')}
        aria-label={`${t('compliance.file.view')} — ${doc.name}`}
        onClick={onView}
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-500 ring-1 ring-slate-200 transition hover:ring-brand-400 dark:bg-slate-800 dark:ring-slate-700"
      >
        <FileIcon className="h-5 w-5" />
      </button>
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-100"
          dir="auto"
        >
          {doc.name}
        </span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
          {t(`compliance.kind.${doc.kind}`)} · {sizeOf(doc.size)} ·{' '}
          {formatDateTime(doc.uploadedAt, locale)}
        </span>
      </span>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {seen !== null && (
          <RowButton
            onClick={onSeen}
            label={seenText}
            ariaLabel={`${t('compliance.seen.open')} — ${seenText}`}
            icon={<UsersIcon className="h-3.5 w-3.5" />}
          />
        )}
        <RowButton
          onClick={onView}
          label={t('compliance.file.view')}
          icon={<EyeIcon className="h-3.5 w-3.5" />}
        />
        <RowButton
          onClick={onDownload}
          label={t('common.download')}
          icon={<DownloadIcon className="h-3.5 w-3.5" />}
        />
        {manager && (
          <>
            <RowButton
              onClick={onRename}
              label={t('compliance.file.rename')}
              icon={<EditIcon className="h-3.5 w-3.5" />}
            />
            <RowButton
              onClick={onDelete}
              tone="danger"
              label={t('common.delete')}
              icon={<TrashIcon className="h-3.5 w-3.5" />}
            />
          </>
        )}
      </span>
    </li>
  );
};

export const FolderDialog = ({
  folder,
  onClose,
  onEdit,
  onDelete,
}: {
  folder: ComplianceFolderDto | null;
  onClose: () => void;
  /** Offered only to the responsible person; absent otherwise. */
  onEdit?: ((folder: ComplianceFolderDto) => void) | undefined;
  onDelete?: ((folder: ComplianceFolderDto) => void) | undefined;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const manager = can('complianceFile.manage');
  const id = folder?.id ?? '';
  const live = useComplianceFolder(id);
  const current = live.data ?? folder;
  const documents = useFolderDocuments(id);
  const remove = useDeleteDocument();
  const [uploading, setUploading] = useState(false);
  const [renaming, setRenaming] = useState<ComplianceDocumentDto | null>(null);
  const [removing, setRemoving] = useState<ComplianceDocumentDto | null>(null);
  const [reporting, setReporting] = useState<ComplianceDocumentDto | null>(null);
  const [previewing, setPreviewing] = useState<ComplianceDocumentDto | null>(null);
  const [saving, setSaving] = useState(false);
  const files = documents.data?.items ?? [];

  const viewFailed = (): void => {
    toast.error(t('compliance.file.viewFailed'));
  };
  const downloadFailed = (): void => {
    toast.error(t('compliance.file.downloadFailed'));
  };
  const view = (doc: ComplianceDocumentDto): void => {
    if (doc.kind === 'pdf') {
      void openDocument(doc.id).then((done) => !done && viewFailed());
    } else {
      setPreviewing(doc);
    }
  };
  const download = (doc: ComplianceDocumentDto): void => {
    void downloadDocument(doc.id, doc.fileName).then((done) => !done && downloadFailed());
  };
  /** Every file in turn (a browser asks once before saving several). */
  const downloadAll = async (): Promise<void> => {
    setSaving(true);
    let failures = 0;
    for (const doc of files) {
      if (!(await downloadDocument(doc.id, doc.fileName))) failures += 1;
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
    setSaving(false);
    if (failures > 0) downloadFailed();
  };
  const confirmRemove = async (): Promise<void> => {
    if (removing === null) return;
    try {
      await remove.mutateAsync({ id: removing.id, version: removing.version });
      toast.success(t('compliance.file.deleted'));
      setRemoving(null);
    } catch (error) {
      toast.error(errorMessage(error, locale));
      setRemoving(null);
    }
  };

  return (
    <>
      <Dialog
        open={folder !== null}
        onClose={onClose}
        title={current?.name ?? ''}
        description={
          current === null ? '' : t('compliance.files.count', { n: current.documentCount })
        }
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.close')}
            </Button>
            {onEdit !== undefined && current !== null && (
              <Button variant="ghost" onClick={() => onEdit(current)}>
                <EditIcon className="h-4 w-4" />
                {t('compliance.folder.edit')}
              </Button>
            )}
            {onDelete !== undefined && current !== null && (
              <Button variant="ghost-danger" onClick={() => onDelete(current)}>
                <TrashIcon className="h-4 w-4" />
                {t('compliance.folder.delete')}
              </Button>
            )}
            <Button
              loading={saving}
              disabled={files.length === 0}
              onClick={() => void downloadAll()}
            >
              <DownloadIcon className="h-4 w-4" />
              {t('compliance.folder.downloadAll')}
            </Button>
          </>
        }
      >
        {current !== null && (
          <div className="space-y-4">
            {manager && (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p
                  className="flex min-w-0 flex-1 items-start gap-2 text-sm text-slate-600 dark:text-slate-300"
                  data-shared-with=""
                >
                  <UsersIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span>
                    {current.viewers.length === 0
                      ? t('compliance.folder.notShared')
                      : t('compliance.folder.sharedWith', {
                          names: current.viewers
                            .map((person) => personName(person, locale))
                            .join('، '),
                        })}
                  </span>
                </p>
                <Button size="sm" onClick={() => setUploading(true)}>
                  <UploadIcon className="h-4 w-4" />
                  {t('compliance.folder.upload')}
                </Button>
              </div>
            )}
            {documents.isPending ? (
              <LoadingState />
            ) : documents.isError ? (
              <ErrorState error={documents.error} onRetry={() => void documents.refetch()} />
            ) : files.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t(manager ? 'compliance.folder.emptyManager' : 'compliance.folder.empty')}
              </p>
            ) : (
              <ul className="grid grid-cols-1 gap-2">
                {files.map((doc) => (
                  <FileRow
                    key={doc.id}
                    doc={doc}
                    manager={manager}
                    onView={() => view(doc)}
                    onDownload={() => download(doc)}
                    onSeen={() => setReporting(doc)}
                    onRename={() => setRenaming(doc)}
                    onDelete={() => setRemoving(doc)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </Dialog>

      {manager && current !== null && (
        <UploadDocumentDialog
          open={uploading}
          folderId={current.id}
          folderName={current.name}
          onClose={() => setUploading(false)}
        />
      )}
      <RenameDocumentDialog document={renaming} onClose={() => setRenaming(null)} />
      <SeenReportDialog document={reporting} onClose={() => setReporting(null)} />
      <PreviewDialog
        document={previewing}
        onClose={() => setPreviewing(null)}
        onDownload={download}
      />
      <ConfirmDeleteDialog
        open={removing !== null}
        title={t('compliance.file.deleteTitle', { name: removing?.name ?? '' })}
        body={t('compliance.file.deleteBody')}
        busy={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => void confirmRemove()}
      />
    </>
  );
};
