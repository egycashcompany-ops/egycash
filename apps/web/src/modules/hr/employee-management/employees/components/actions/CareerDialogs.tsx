// Career personnel actions (frozen design §8): Promotion, Transfer, Salary change, Manager
// change. Each dialog shows a from → to preview, submits through the permission-grouped
// endpoints, and supports effective dating. Salary fields render only for holders of
// `employee.manageCompensation`.
import { useState } from 'react';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { useCan } from '../../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../../store';
import { Field, Input } from '../../../../../../shared/ui/form';
import { SearchableSelect } from '../../../../../../shared/ui/SearchableSelect';
import { MoneyInput } from '../../../../../../shared/ui/MoneyInput';
import { SearchInput } from '../../../../../../shared/ui/SearchInput';
import { toast } from '../../../../../../shared/ui/toast/toast-store';
import { localized, orgUnitLabel } from '../../../../../../shared/lib/format';
import {
  useBranchOptions,
  useDepartmentOptions,
  useJobTitleReferenceOptions,
  useSectionOptions,
  useUserSearch,
  useUser,
} from '../../../../../organization/shared/references';
import { useCompensationAction, useEmploymentAction } from '../../api/employee-queries';
import { ActionDialog, useActionCommonFields } from './ActionDialog';

interface DialogProps {
  employee: EmployeeDto;
  open: boolean;
  onClose: () => void;
}

export const PromotionDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const { data: jobTitles = [] } = useJobTitleReferenceOptions();
  const action = useEmploymentAction(employee.id);
  const { fields, common } = useActionCommonFields(employee.id);
  const [jobTitleId, setJobTitleId] = useState('');
  const [salary, setSalary] = useState('');
  const [reason, setReason] = useState('');
  const canComp = can('employee.manageCompensation');

  const submit = async (): Promise<void> => {
    if (jobTitleId === '') {
      toast.error(t('employees.actions.promotion.titleRequired'));
      return;
    }
    try {
      await action.mutateAsync({
        type: 'promotion',
        jobTitleId,
        ...(canComp && salary.trim() !== ''
          ? { salary: { amount: Number(salary), currency: 'EGP' } }
          : {}),
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        version: employee.version,
        ...common,
      });
      toast.success(t('employees.actions.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.promotion.title')}
      overlap={{ employeeId: employee.id, type: 'promotion' }}
      submitting={action.isPending}
      onSubmit={() => void submit()}
    >
      <Field label={t('employees.actions.promotion.newTitle')} required>
        <SearchableSelect
          value={jobTitleId}
          onChange={setJobTitleId}
          options={jobTitles
            .filter((jt) => jt.id !== employee.employment.jobTitleId)
            .map((jt) => ({ value: jt.id, label: localized(jt.name, locale) }))}
          ariaLabel={t('employees.actions.promotion.newTitle')}
        />
      </Field>
      {canComp && (
        <Field label={t('employees.actions.promotion.newSalary')} hint={t('offers.form.optional')}>
          <MoneyInput value={salary} onChange={(next) => setSalary(next)} />
        </Field>
      )}
      <Field label={t('employees.actions.reason')} hint={t('offers.form.optional')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      {fields}
    </ActionDialog>
  );
};

export const TransferDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const action = useEmploymentAction(employee.id);
  const { fields, common } = useActionCommonFields(employee.id);
  const [branchId, setBranchId] = useState(employee.employment.branchId);
  const [departmentId, setDepartmentId] = useState(employee.employment.departmentId);
  const [sectionId, setSectionId] = useState(employee.employment.sectionId ?? '');
  // «إمكانية تعديل المسمي الوظيفي أيضاً» — the job held in the new placement; the current one
  // until HR picks another.
  const [jobTitleId, setJobTitleId] = useState(employee.employment.jobTitleId);
  const [reason, setReason] = useState('');
  const { data: branches = [] } = useBranchOptions();
  const { data: departments = [] } = useDepartmentOptions(branchId);
  const { data: sections = [] } = useSectionOptions(departmentId === '' ? undefined : departmentId);
  const { data: jobTitles = [] } = useJobTitleReferenceOptions();
  // The catalog offers active titles only. A title retired since the employee took it is still
  // the one they hold, so it stays on the list, by the name their record carries, instead of the
  // list showing its first title as if it were theirs.
  const heldTitleRetired = !jobTitles.some((jt) => jt.id === employee.employment.jobTitleId);

  const submit = async (): Promise<void> => {
    const changedBranch = branchId !== employee.employment.branchId;
    const changedDept = departmentId !== employee.employment.departmentId;
    const changedSection = sectionId !== (employee.employment.sectionId ?? '');
    const changedJob = jobTitleId !== employee.employment.jobTitleId;
    if (!changedBranch && !changedDept && !changedSection && !changedJob) {
      toast.error(t('employees.actions.transfer.nothingChanged'));
      return;
    }
    try {
      await action.mutateAsync({
        type: 'transfer',
        ...(changedBranch ? { branchId } : {}),
        ...(changedDept || changedBranch ? { departmentId } : {}),
        ...(changedSection || changedDept || changedBranch
          ? { sectionId: sectionId === '' ? null : sectionId }
          : {}),
        ...(changedJob ? { jobTitleId } : {}),
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        version: employee.version,
        ...common,
      });
      toast.success(t('employees.actions.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.transfer.title')}
      overlap={{ employeeId: employee.id, type: 'transfer' }}
      description={t('employees.actions.transfer.codeHint')}
      submitting={action.isPending}
      onSubmit={() => void submit()}
    >
      <Field label={t('offers.form.branch')} required>
        <SearchableSelect
          value={branchId}
          onChange={(next) => {
            if (next === branchId) return;
            setBranchId(next);
            setDepartmentId('');
            setSectionId('');
          }}
          options={branches.map((b) => ({ value: b.id, label: localized(b.name, locale) }))}
          ariaLabel={t('offers.form.branch')}
        />
      </Field>
      <Field label={t('offers.form.department')} required>
        <SearchableSelect
          value={departmentId}
          onChange={(next) => {
            if (next === departmentId) return;
            setDepartmentId(next);
            setSectionId('');
          }}
          options={departments.map((d) => ({ value: d.id, label: orgUnitLabel(d, locale) }))}
          disabled={branchId === ''}
          ariaLabel={t('offers.form.department')}
        />
      </Field>
      <Field label={t('employees.actions.transfer.section')} hint={t('offers.form.optional')}>
        <SearchableSelect
          value={sectionId}
          onChange={setSectionId}
          options={sections.map((sec) => ({ value: sec.id, label: orgUnitLabel(sec, locale) }))}
          placeholder={t('employees.actions.transfer.noSection')}
          disabled={departmentId === ''}
          ariaLabel={t('employees.actions.transfer.section')}
        />
      </Field>
      <Field label={t('offers.form.jobTitle')} required hint={t('employees.actions.transfer.jobTitleHint')}>
        <SearchableSelect
          value={jobTitleId}
          onChange={setJobTitleId}
          options={[
            // A retired title the employee still holds stays theirs to keep.
            ...(heldTitleRetired
              ? [
                  {
                    value: employee.employment.jobTitleId,
                    label: employee.placement.jobTitle === null ? '—' : localized(employee.placement.jobTitle.name, locale),
                  },
                ]
              : []),
            ...jobTitles.map((jt) => ({ value: jt.id, label: localized(jt.name, locale) })),
          ]}
          ariaLabel={t('offers.form.jobTitle')}
        />
      </Field>
      <Field label={t('employees.actions.reason')} hint={t('offers.form.optional')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      {fields}
    </ActionDialog>
  );
};

export const SalaryChangeDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const action = useCompensationAction(employee.id);
  const { fields, common } = useActionCommonFields(employee.id);
  const [salary, setSalary] = useState(String(employee.employment.salary?.amount ?? ''));
  const [reason, setReason] = useState('');

  const submit = async (): Promise<void> => {
    if (salary.trim() === '' || Number.isNaN(Number(salary))) {
      toast.error(t('employees.actions.salary.amountRequired'));
      return;
    }
    try {
      await action.mutateAsync({
        type: 'salaryChange',
        salary: { amount: Number(salary), currency: employee.employment.salary?.currency ?? 'EGP' },
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        version: employee.version,
        ...common,
      });
      toast.success(t('employees.actions.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.salary.title')}
      overlap={{ employeeId: employee.id, type: 'salaryChange' }}
      submitting={action.isPending}
      onSubmit={() => void submit()}
    >
      <Field label={t('employees.actions.salary.current')}>
        <p className="text-sm text-slate-500" dir="ltr">
          {employee.compensationVisible
            ? (employee.employment.salary?.amount ?? '—')
            : t('employees.compensation.hidden')}
        </p>
      </Field>
      <Field label={t('employees.actions.salary.new')} required>
        <MoneyInput value={salary} onChange={(next) => setSalary(next)} />
      </Field>
      <Field label={t('employees.actions.reason')} hint={t('offers.form.optional')}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </Field>
      {fields}
    </ActionDialog>
  );
};

export const ManagerChangeDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const action = useEmploymentAction(employee.id);
  const { fields, common } = useActionCommonFields(employee.id);
  const [term, setTerm] = useState('');
  const [managerId, setManagerId] = useState<string | null>(employee.employment.managerId);
  const results = useUserSearch(term, open);
  const current = useUser(employee.employment.managerId);
  const picked = useUser(managerId);

  const submit = async (): Promise<void> => {
    try {
      await action.mutateAsync({
        type: 'managerChange',
        managerId,
        version: employee.version,
        ...common,
      });
      toast.success(t('employees.actions.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  const nameOf = (u: { firstName: { ar: string; en: string }; lastName: { ar: string; en: string } }): string =>
    `${localized(u.firstName, locale)} ${localized(u.lastName, locale)}`;

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.manager.title')}
      overlap={{ employeeId: employee.id, type: 'managerChange' }}
      submitting={action.isPending}
      onSubmit={() => void submit()}
    >
      <Field label={t('employees.actions.manager.current')}>
        <p className="text-sm text-slate-500">
          {current.data === undefined ? '—' : nameOf(current.data)}
        </p>
      </Field>
      <Field label={t('employees.actions.manager.new')}>
        <SearchInput value={term} onChange={setTerm} placeholder={t('employees.actions.manager.search')} />
      </Field>
      {term.trim().length >= 2 && (
        <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
          {(results.data ?? []).map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                onClick={() => {
                  setManagerId(u.id);
                  setTerm('');
                }}
              >
                {nameOf(u)}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
        <span>
          {managerId === null
            ? t('employees.actions.manager.none')
            : picked.data === undefined
              ? '…'
              : nameOf(picked.data)}
        </span>
        {managerId !== null && (
          <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setManagerId(null)}>
            {t('common.remove')}
          </button>
        )}
      </div>
      {fields}
    </ActionDialog>
  );
};
