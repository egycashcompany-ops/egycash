// «مسح نهائي» — erasing an employee from the system, with no undo and no state left behind.
//
// EVERY OTHER ACTION ON THIS MENU IS A STATE CHANGE. Suspending, dismissing, failing a probation:
// each of them leaves the person in the registry with a different status, and each is reversible by
// another action. This one is not an action on an employee — it is the end of there having been
// one, and the dialog is written to make that difference impossible to miss before pressing.
//
// SO IT ASKS FOR THE CODE, TYPED. Not a checkbox, not an "are you sure": those are dismissed by
// the same reflex that opened the menu. Typing «0100004» cannot be done by reflex, and it is also
// the one thing that proves the person at the keyboard knows WHICH employee this is — the server
// checks it against the record and refuses otherwise, so a stale tab cannot erase a stranger.
//
// AND IT SAYS WHAT SURVIVES, because the honest answer is "not nothing". A gold receipt, a traffic
// violation and the consumables ledger are records about money, the law and stock — they stay, with
// the person's name rewritten on them. Somebody deciding to erase a record should know that the
// receipt will still exist and will no longer name them.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../../store';
import { Dialog } from '../../../../../../shared/ui/Dialog';
import { Button } from '../../../../../../shared/ui/Button';
import { Field, Input } from '../../../../../../shared/ui/form';
import { toast } from '../../../../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../../../../shared/lib/errors';
import { usePurgeEmployee } from '../../api/employee-queries';

interface Props {
  employee: EmployeeDto;
  open: boolean;
  onClose: () => void;
}

export const PurgeEmployeeDialog = ({ employee, open, onClose }: Props): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const purge = usePurgeEmployee(employee.id);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  if (!open) return null;

  const matches = typed.trim() === employee.code;

  const submit = async (): Promise<void> => {
    if (!matches) return;
    try {
      const report = await purge.mutateAsync({ confirmCode: typed.trim() });
      toast.success(
        t('employees.purge.done', {
          name: employee.personal.fullNameAr,
          rows: report.rowsDeleted,
          names: report.namesScrubbed,
        }),
      );
      onClose();
      // The profile behind this dialog is now a 404, so it is left rather than re-rendered.
      navigate('/employees');
    } catch (e) {
      toast.error(errorMessage(e, locale));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('employees.purge.title')}
      description={t('employees.purge.description', {
        name: employee.personal.fullNameAr,
        code: employee.code,
      })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={purge.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            disabled={!matches || purge.isPending}
          >
            {t('employees.purge.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-semibold text-danger-700">{t('employees.purge.goes')}</p>
        <p className="text-sm text-neutral-700">{t('employees.purge.stays')}</p>
        <Field
          label={t('employees.purge.confirmLabel', { code: employee.code })}
          htmlFor="purge-confirm"
          required
          error={typed.trim() !== '' && !matches ? t('employees.purge.mismatch') : undefined}
        >
          <Input
            id="purge-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            dir="ltr"
            autoComplete="off"
          />
        </Field>
      </div>
    </Dialog>
  );
};
