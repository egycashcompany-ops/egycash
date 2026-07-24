// Career personnel actions (frozen design §8): Promotion, Transfer, Salary change, Manager
// change. Each dialog shows a from → to preview, submits through the permission-grouped
// endpoints, and supports effective dating. Salary fields render only for holders of
// `employee.manageCompensation`.
import { useState } from 'react';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { useCan } from '../../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../../store';
import { Field, Input, Select } from '../../../../../../shared/ui/form';
import { SearchInput } from '../../../../../../shared/ui/SearchInput';
import { toast } from '../../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../../shared/lib/format';
import {
  useBranchOptions,
  useDepartmentOptions,
  useSectionOptions,
  useUserSearch,
  useUser,
} from '../../../../../organization/shared/references';
import { useJobTitles } from '../../../../recruitment/job-offers/api/job-offer-queries';
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
  const jobTitles = useJobTitles(can('jobTitle.view'));
  const action = useEmploymentAction(employee.id);
  const { fields, common } = useActionCommonFields();
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
      submitting={action.isPending}
      onSubmit={() => void submit()}
    >
      <Field label={t('employees.actions.promotion.newTitle')} required>
        <Select value={jobTitleId} onChange={(e) => setJobTitleId(e.target.value)}>
          <option value="">{t('common.select')}</option>
          {(jobTitles.data ?? [])
            .filter((jt) => jt.id !== employee.employment.jobTitleId)
            .map((jt) => (
              <option key={jt.id} value={jt.id}>
                {localized(jt.name, locale)}
              </option>
            ))}
        </Select>
      </Field>
      {canComp && (
        <Field label={t('employees.actions.promotion.newSalary')} hint={t('offers.form.optional')}>
          <Input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} dir="ltr" />
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
  const { fields, common } = useActionCommonFields();
  const [branchId, setBranchId] = useState(employee.employment.branchId);
  const [departmentId, setDepartmentId] = useState(employee.employment.departmentId);
  const [sectionId, setSectionId] = useState(employee.employment.sectionId ?? '');
  const [reason, setReason] = useState('');
  const { data: branches = [] } = useBranchOptions();
  const { data: departments = [] } = useDepartmentOptions(branchId);
  const { data: sections = [] } = useSectionOptions(departmentId === '' ? undefined : departmentId);

  const submit = async (): Promise<void> => {
    const changedBranch = branchId !== employee.employment.branchId;
    const changedDept = departmentId !== employee.employment.departmentId;
    const changedSection = sectionId !== (employee.employment.sectionId ?? '');
    if (!changedBranch && !changedDept && !changedSection) {
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
      description={t('employees.actions.transfer.codeHint')}
      submitting={action.isPending}
      onSubmit={() => void submit()}
    >
      <Field label={t('offers.form.branch')} required>
        <Select
          value={branchId}
          onChange={(e) => {
            setBranchId(e.target.value);
            setDepartmentId('');
            setSectionId('');
          }}
        >
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {localized(b.name, locale)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('offers.form.department')} required>
        <Select
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            setSectionId('');
          }}
        >
          <option value="">{t('common.select')}</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {localized(d.name, locale)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('employees.actions.transfer.section')} hint={t('offers.form.optional')}>
        <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
          <option value="">{t('employees.actions.transfer.noSection')}</option>
          {sections.map((sec) => (
            <option key={sec.id} value={sec.id}>
              {localized(sec.name, locale)}
            </option>
          ))}
        </Select>
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
  const { fields, common } = useActionCommonFields();
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
        <Input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} dir="ltr" />
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
  const { fields, common } = useActionCommonFields();
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
