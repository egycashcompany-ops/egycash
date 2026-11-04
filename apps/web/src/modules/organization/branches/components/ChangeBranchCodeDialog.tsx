// «عايزك تسمحلى أغير كود الفرع» — correcting a branch's code, behind its own key `branch.changeCode`
// (ADR-017, amended 2026-11-03). Opened from the branches list and from the branch's own page.
//
// The code a branch carries is the first three digits of every Employee Code issued in it, and the
// register screen reads the branch off them. So a code that is not three digits is not refused (the
// catalogue has always allowed other shapes) but it is WARNED about: no employee code will ever name
// that branch. Codes already issued do not change — that is said in the dialog, not left to surprise.
import { useState } from 'react';
import { type BranchDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { ApiError } from '../../../../shared/lib/api-client';
import { useChangeBranchCode } from '../branch-queries';

/** The shape an employee code's branch prefix takes: three digits (`010`). */
export const EMPLOYEE_CODE_BRANCH = /^\d{3}$/;

export const ChangeBranchCodeDialog = ({
  branch,
  onClose,
}: {
  branch: BranchDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const changeCode = useChangeBranchCode(branch.id);
  const [code, setCode] = useState(branch.code);
  const next = code.trim().toUpperCase();

  const submit = async (): Promise<void> => {
    if (next === '') {
      toast.error(t('organization.form.codeRequired'));
      return;
    }
    if (next === branch.code) {
      onClose();
      return;
    }
    try {
      await changeCode.mutateAsync({ code: next, version: branch.version });
      toast.success(t('organization.branch.codeChanged'));
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'STALE_DOCUMENT') {
        toast.error(t('organization.form.stale'));
      } else if (e instanceof ApiError && e.code === 'DUPLICATE') {
        toast.error(t('organization.branch.codeTaken'));
      }
      // other errors surface globally
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('organization.branch.changeCode')}
      description={t('organization.branch.changeCodeHint')}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" loading={changeCode.isPending} onClick={() => void submit()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field
        label={t('organization.field.code')}
        required
        hint={t('organization.branch.codeCurrent', { code: branch.code })}
        warning={
          next !== '' && !EMPLOYEE_CODE_BRANCH.test(next) ? t('organization.branch.codeNotThreeDigits') : undefined
        }
      >
        <Input
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={20}
          data-branch-code="true"
        />
      </Field>
    </Dialog>
  );
};
