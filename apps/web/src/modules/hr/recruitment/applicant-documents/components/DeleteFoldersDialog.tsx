// The second click before anything goes.
//
// It names the person, their code and how many files are about to be removed, and it says what is
// NOT removed — the applicant record itself stays, with their stage history and every decision
// taken about them. Those two sentences are the whole reason this dialog exists: «حذف المجلد» read
// on its own could be heard as deleting the candidate.
//
// A click outside does not dismiss it, and the red button is the only way through.
import { useState } from 'react';
import { type ApplicantFolderDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { AlertIcon, TrashIcon } from '../../../../../shared/ui/icons';

export const DeleteFoldersDialog = ({
  folders,
  onClose,
  onConfirm,
}: {
  /** One folder, or the ticked selection. Empty closes the dialog. */
  folders: ApplicantFolderDto[];
  onClose: () => void;
  onConfirm: (folders: ApplicantFolderDto[]) => Promise<void>;
}): JSX.Element => {
  const t = useT();
  const [working, setWorking] = useState(false);
  const one = folders.length === 1 ? folders[0] : undefined;
  const files = folders.reduce((sum, folder) => sum + folder.fileCount, 0);

  return (
    <Dialog
      open={folders.length > 0}
      onClose={onClose}
      dismissOnOutsideClick={false}
      title={t(
        one === undefined
          ? 'hr.applicantFolders.deleteBulkTitle'
          : 'hr.applicantFolders.deleteTitle',
      )}
      size="md"
      footer={
        <>
          <Button variant="secondary" disabled={working} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={working}
            onClick={() => {
              setWorking(true);
              void onConfirm(folders).finally(() => setWorking(false));
            }}
          >
            <TrashIcon className="h-4 w-4" />
            {t('common.delete')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <span>
            {one === undefined
              ? t('hr.applicantFolders.deleteBulkBody', {
                  folders: folders.length,
                  n: files,
                })
              : t('hr.applicantFolders.deleteBody', {
                  name: one.applicantName,
                  code: one.applicantCode,
                  n: one.fileCount,
                })}
          </span>
        </p>
        {one === undefined && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2 text-sm dark:border-slate-700">
            {folders.map((folder) => (
              <li
                key={folder.applicantId}
                className="flex items-center justify-between gap-2 text-slate-700 dark:text-slate-200"
              >
                <span className="min-w-0 truncate">{folder.applicantName}</span>
                <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400" dir="ltr">
                  {folder.applicantCode} · {folder.fileCount}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('hr.applicantFolders.deleteSoftNote')}
        </p>
      </div>
    </Dialog>
  );
};
