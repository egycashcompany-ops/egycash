// The second click before anything goes.
//
// It names the person, their code and how many files are about to be removed, and it says what is
// NOT removed — the applicant record itself stays, with their stage history and every decision
// taken about them. Those two sentences are the whole reason this dialog exists: «حذف المجلد» read
// on its own could be heard as deleting the candidate.
//
// IT ALSO OFFERS THE SECOND HALF OF THE SAME INTENTION. Emptying somebody's folder almost always
// means they are not continuing, and leaving their application sitting in the pipeline afterwards
// is a half-finished act that nobody comes back to tidy. So «اسحب الطلب أيضًا» is ticked by
// default, with a reason to go on the record — and it is a TICK rather than a forced consequence,
// because clearing out papers while the candidate is still in play is a real, if rarer, case.
//
// The box is offered only to a caller holding `applicant.edit`, the key the withdrawal itself
// needs. The API refuses a request that asks for a withdrawal the caller may not perform, so
// hiding it here is the courtesy, not the control.
//
// A click outside does not dismiss it, and the red button is the only way through.
import { useState } from 'react';
import { type ApplicantFolderDto } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Checkbox, Field, Select, Textarea } from '../../../../../shared/ui/form';
import { AlertIcon, TrashIcon } from '../../../../../shared/ui/icons';
import { type FolderWithdrawal } from '../api/applicant-document-queries';
import {
  APPLICANT_WITHDRAW_REASONS,
  withdrawReasonKey,
  withdrawReasonText,
  type ApplicantWithdrawReason,
} from './applicant-withdraw-reasons';

export const DeleteFoldersDialog = ({
  folders,
  onClose,
  onConfirm,
}: {
  /** One folder, or the ticked selection. Empty closes the dialog. */
  folders: ApplicantFolderDto[];
  onClose: () => void;
  onConfirm: (folders: ApplicantFolderDto[], withdrawal: FolderWithdrawal) => Promise<void>;
}): JSX.Element => {
  const t = useT();
  const can = useCan();
  const mayWithdraw = can('applicant.edit');
  const [working, setWorking] = useState(false);
  const [withdraw, setWithdraw] = useState(mayWithdraw);
  const [reason, setReason] = useState<ApplicantWithdrawReason>('candidateWithdrew');
  const [other, setOther] = useState('');
  const one = folders.length === 1 ? folders[0] : undefined;
  const files = folders.reduce((sum, folder) => sum + folder.fileCount, 0);
  // A selection may hold folders the API will refuse. They are neither emptied nor withdrawn, and
  // that is worth one line here rather than a surprise in the toast afterwards.
  const kept = folders.filter((folder) => folder.deleteBlock !== null).length;

  const reasonText = withdrawReasonText(reason, other, t);
  const asking: FolderWithdrawal =
    withdraw && mayWithdraw && reasonText !== null
      ? { withdraw: true, withdrawReason: reasonText }
      : { withdraw: false };
  // Ticking the box and then leaving «أخرى» blank is the one way to reach the red button with
  // nothing to send. Rather than quietly emptying the folder without withdrawing — which answers a
  // different request from the one on screen — the button waits.
  const incomplete = withdraw && mayWithdraw && reasonText === null;

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
            disabled={incomplete}
            onClick={() => {
              setWorking(true);
              void onConfirm(folders, asking).finally(() => setWorking(false));
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

        {mayWithdraw && (
          <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
            <Checkbox
              label={t('hr.applicantFolders.alsoWithdraw')}
              checked={withdraw}
              onChange={(event) => setWithdraw(event.target.checked)}
            />
            {withdraw && (
              <div className="space-y-2">
                <Field label={t('hr.applicantFolders.withdrawReasonLabel')} required>
                  <Select
                    value={reason}
                    onChange={(event) =>
                      setReason(event.target.value as ApplicantWithdrawReason)
                    }
                  >
                    {APPLICANT_WITHDRAW_REASONS.map((key) => (
                      <option key={key} value={key}>
                        {t(withdrawReasonKey(key))}
                      </option>
                    ))}
                  </Select>
                </Field>
                {reason === 'other' && (
                  <Field label={t('hr.applicantFolders.withdrawReasonOther')} required>
                    <Textarea
                      value={other}
                      onChange={(event) => setOther(event.target.value)}
                      rows={2}
                    />
                  </Field>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('hr.applicantFolders.withdrawNote')}
                </p>
                {kept > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t('hr.applicantFolders.withdrawSkipsKept', { n: kept })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('hr.applicantFolders.deleteSoftNote')}
        </p>
      </div>
    </Dialog>
  );
};
