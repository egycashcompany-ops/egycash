// The profile's Actions menu — entries filtered by current status × the caller's permissions
// (frozen design §8). Exited records offer only Rehire (hidden without eligibility unless the
// caller holds the override — D2). Every entry opens its focused dialog.
import { useRef, useState } from 'react';
import { type EmployeeDto } from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { useCan } from '../../../../../../platform/rbac/Can';
import { Button } from '../../../../../../shared/ui/Button';
import { ChevronIcon } from '../../../../../../shared/ui/icons';
import { useOnClickOutside } from '../../../../../../shared/lib/useOnClickOutside';
import { PromotionDialog, TransferDialog, SalaryChangeDialog, ManagerChangeDialog } from './CareerDialogs';
import {
  SuspendDialog,
  ReinstateDialog,
  LeaveStartDialog,
  LeaveEndDialog,
  ProbationConfirmDialog,
  ProbationExtendDialog,
  ProbationFailDialog,
} from './LifecycleDialogs';
import { ExitDialog, RehireDialog } from './ExitRehireDialogs';

type DialogKind =
  | 'promotion'
  | 'transfer'
  | 'salary'
  | 'manager'
  | 'suspend'
  | 'reinstate'
  | 'leaveStart'
  | 'leaveEnd'
  | 'probationConfirm'
  | 'probationExtend'
  | 'probationFail'
  | 'exit'
  | 'rehire';

interface Item {
  kind: DialogKind;
  label: string;
  danger?: boolean;
}

export const ActionsMenu = ({ employee }: { employee: EmployeeDto }): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false));

  const manage = can('employee.manageActions');
  const comp = can('employee.manageCompensation');
  const exit = can('employee.exit');
  const rehire = can('employee.rehire');
  const override = can('employee.rehireOverride');
  const s = employee.status;
  const employed = s !== 'exited';
  const inProbation =
    s === 'probation' && employee.probation !== null && employee.probation.confirmedAt === null;

  const items: Item[] = [];
  if (employed && manage && inProbation) {
    items.push({ kind: 'probationConfirm', label: t('employees.actions.probationConfirm.title') });
    items.push({ kind: 'probationExtend', label: t('employees.actions.probationExtend.title') });
    items.push({ kind: 'probationFail', label: t('employees.actions.probationFail.title'), danger: true });
  }
  if (employed && manage && (s === 'probation' || s === 'active')) {
    items.push({ kind: 'promotion', label: t('employees.actions.promotion.title') });
    items.push({ kind: 'transfer', label: t('employees.actions.transfer.title') });
    items.push({ kind: 'manager', label: t('employees.actions.manager.title') });
  }
  if (employed && comp && (s === 'probation' || s === 'active')) {
    items.push({ kind: 'salary', label: t('employees.actions.salary.title') });
  }
  if (manage && (s === 'probation' || s === 'active')) {
    items.push({ kind: 'leaveStart', label: t('employees.actions.leaveStart.title') });
  }
  if (manage && s === 'onLeave') {
    items.push({ kind: 'leaveEnd', label: t('employees.actions.leaveEnd.title') });
  }
  if (manage && (s === 'probation' || s === 'active' || s === 'onLeave')) {
    items.push({ kind: 'suspend', label: t('employees.actions.suspend.title'), danger: true });
  }
  if (manage && s === 'suspended') {
    items.push({ kind: 'reinstate', label: t('employees.actions.reinstate.title') });
  }
  if (exit && employed) {
    items.push({ kind: 'exit', label: t('employees.actions.exit.title'), danger: true });
  }
  if (s === 'exited' && rehire && (employee.exit?.eligibleForRehire === true || override)) {
    items.push({ kind: 'rehire', label: t('employees.actions.rehire.title') });
  }

  if (items.length === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <Button size="sm" leftIcon={<ChevronIcon className="h-4 w-4" />} onClick={() => setOpen((v) => !v)}>
        {t('employees.actions.menu')}
      </Button>
      {open && (
        <div className="absolute end-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {items.map((item) => (
            <button
              key={item.kind}
              type="button"
              className={`block w-full px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                item.danger === true ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
              }`}
              onClick={() => {
                setOpen(false);
                setDialog(item.kind);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <PromotionDialog employee={employee} open={dialog === 'promotion'} onClose={() => setDialog(null)} />
      <TransferDialog employee={employee} open={dialog === 'transfer'} onClose={() => setDialog(null)} />
      <SalaryChangeDialog employee={employee} open={dialog === 'salary'} onClose={() => setDialog(null)} />
      <ManagerChangeDialog employee={employee} open={dialog === 'manager'} onClose={() => setDialog(null)} />
      <SuspendDialog employee={employee} open={dialog === 'suspend'} onClose={() => setDialog(null)} />
      <ReinstateDialog employee={employee} open={dialog === 'reinstate'} onClose={() => setDialog(null)} />
      <LeaveStartDialog employee={employee} open={dialog === 'leaveStart'} onClose={() => setDialog(null)} />
      <LeaveEndDialog employee={employee} open={dialog === 'leaveEnd'} onClose={() => setDialog(null)} />
      <ProbationConfirmDialog employee={employee} open={dialog === 'probationConfirm'} onClose={() => setDialog(null)} />
      <ProbationExtendDialog employee={employee} open={dialog === 'probationExtend'} onClose={() => setDialog(null)} />
      <ProbationFailDialog employee={employee} open={dialog === 'probationFail'} onClose={() => setDialog(null)} />
      <ExitDialog employee={employee} open={dialog === 'exit'} onClose={() => setDialog(null)} />
      <RehireDialog employee={employee} open={dialog === 'rehire'} onClose={() => setDialog(null)} />
    </div>
  );
};
