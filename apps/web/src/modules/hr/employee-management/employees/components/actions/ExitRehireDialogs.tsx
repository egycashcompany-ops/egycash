// Exit + Rehire personnel actions (frozen design §8). Exit: typed (resignation / termination /
// end of contract / retirement / death), reason required for termination, an EXPLICIT
// rehire-eligibility decision, automatic login suspension (D3 — stated, not optional), and a
// direct-reports decision when the employee manages others (F1). Rehire: same employee number
// and file — terms from an accepted offer (returning through a fresh recruitment cycle) or
// entered directly; requires employee.rehireOverride when the exit said not eligible (D2).
import { useState } from 'react';
import {
  EMPLOYEE_EXIT_TYPES,
  type EmployeeDto,
  type EmployeeExitType,
  type EmploymentType,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../../../platform/localization/useT';
import { useCan } from '../../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../../store';
import { Field, Checkbox, Input, Select, Textarea } from '../../../../../../shared/ui/form';
import { SearchInput } from '../../../../../../shared/ui/SearchInput';
import { toast } from '../../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../../shared/lib/format';
import {
  useBranchOptions,
  useDepartmentOptions,
  useSectionOptions,
} from '../../../../../organization/shared/references';
import { useJobTitles } from '../../../../recruitment/job-offers/api/job-offer-queries';
import { OfferPicker } from '../OfferPicker';
import { useEmployees, useExitAction, useRehireAction, useSubordinates } from '../../api/employee-queries';
import { ActionDialog, useActionCommonFields } from './ActionDialog';

interface DialogProps {
  employee: EmployeeDto;
  open: boolean;
  onClose: () => void;
}

export const ExitDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const action = useExitAction(employee.id);
  const { fields, common } = useActionCommonFields();
  const subordinates = useSubordinates(open ? employee.id : '');
  const [type, setType] = useState<EmployeeExitType>('resignation');
  const [reason, setReason] = useState('');
  const [eligibleForRehire, setEligibleForRehire] = useState(true);
  const [reportsMode, setReportsMode] = useState<'reassign' | 'unassign'>('reassign');
  const [reassignTerm, setReassignTerm] = useState('');
  const [reassignTo, setReassignTo] = useState<{ id: string; code: string } | null>(null);
  const candidates = useEmployees(
    reassignTerm.trim().length >= 2 ? { search: reassignTerm, employed: true, pageSize: 8 } : { pageSize: 0 },
  );
  const reportCount = subordinates.data?.length ?? 0;

  const submit = async (): Promise<void> => {
    if (type === 'termination' && reason.trim() === '') {
      toast.error(t('employees.actions.reasonRequired'));
      return;
    }
    if (reportCount > 0 && reportsMode === 'reassign' && reassignTo === null) {
      toast.error(t('employees.actions.exit.reassignRequired'));
      return;
    }
    try {
      await action.mutateAsync({
        type,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
        eligibleForRehire,
        ...(reportCount > 0
          ? {
              directReports:
                reportsMode === 'reassign' && reassignTo !== null
                  ? { reassignToEmployeeId: reassignTo.id }
                  : { leaveUnassigned: true },
            }
          : {}),
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
      title={t('employees.actions.exit.title')}
      description={t('employees.actions.exit.loginNote')}
      submitting={action.isPending}
      danger
      onSubmit={() => void submit()}
    >
      <Field label={t('employees.actions.exit.type')} required>
        <Select value={type} onChange={(e) => setType(e.target.value as EmployeeExitType)}>
          {EMPLOYEE_EXIT_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`employees.exitType.${x}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('employees.actions.reason')} required={type === 'termination'} hint={type === 'termination' ? undefined : t('offers.form.optional')}>
        <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Checkbox
        checked={eligibleForRehire}
        onChange={(e) => setEligibleForRehire(e.target.checked)}
        label={t('employees.actions.exit.eligibleForRehire')}
      />

      {reportCount > 0 && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {t('employees.actions.exit.reports', { count: String(reportCount) })}
          </p>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={reportsMode === 'reassign'}
                onChange={() => setReportsMode('reassign')}
              />
              {t('employees.actions.exit.reassign')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={reportsMode === 'unassign'}
                onChange={() => setReportsMode('unassign')}
              />
              {t('employees.actions.exit.unassign')}
            </label>
          </div>
          {reportsMode === 'reassign' && (
            <>
              <SearchInput
                value={reassignTerm}
                onChange={setReassignTerm}
                placeholder={t('employees.actions.exit.reassignSearch')}
              />
              {reassignTerm.trim().length >= 2 && (
                <ul className="max-h-32 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
                  {(candidates.data?.items ?? [])
                    .filter((c) => c.id !== employee.id && c.userId !== null)
                    .map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="w-full px-3 py-2 text-start text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                          onClick={() => {
                            setReassignTo({ id: c.id, code: c.code });
                            setReassignTerm('');
                          }}
                        >
                          <span className="font-mono text-xs" dir="ltr">{c.code}</span>
                          <span className="ms-2">{c.personal.fullNameAr}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {reassignTo !== null && (
                <p className="text-sm">
                  {t('employees.actions.exit.reassignTo')}{' '}
                  <span className="font-mono text-xs" dir="ltr">{reassignTo.code}</span>
                </p>
              )}
            </>
          )}
        </div>
      )}
      {fields}
    </ActionDialog>
  );
};

export const RehireDialog = ({ employee, open, onClose }: DialogProps): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const action = useRehireAction(employee.id);
  const { fields, common } = useActionCommonFields();
  const [mode, setMode] = useState<'offer' | 'direct'>('direct');
  const [jobOfferId, setJobOfferId] = useState<{ id: string; code: string } | null>(null);
  const [reactivateLogin, setReactivateLogin] = useState(true);
  // Direct terms.
  const [branchId, setBranchId] = useState(employee.employment.branchId);
  const [departmentId, setDepartmentId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [jobTitleId, setJobTitleId] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('fullTime');
  const [probationMonths, setProbationMonths] = useState('3');
  const [startDate, setStartDate] = useState('');
  const [salary, setSalary] = useState('');
  const { data: branches = [] } = useBranchOptions(open);
  const { data: departments = [] } = useDepartmentOptions(branchId, open);
  const { data: sections = [] } = useSectionOptions(departmentId === '' ? undefined : departmentId, open);
  const jobTitles = useJobTitles(open && can('jobTitle.view'));
  const canComp = can('employee.manageCompensation');

  const submit = async (): Promise<void> => {
    try {
      if (mode === 'offer') {
        if (jobOfferId === null) {
          toast.error(t('employees.actions.rehire.offerRequired'));
          return;
        }
        await action.mutateAsync({
          type: 'rehire',
          jobOfferId: jobOfferId.id,
          reactivateLogin,
          version: employee.version,
          ...common,
        });
      } else {
        if (departmentId === '' || jobTitleId === '' || startDate === '') {
          toast.error(t('employees.actions.rehire.termsRequired'));
          return;
        }
        await action.mutateAsync({
          type: 'rehire',
          terms: {
            jobTitleId,
            departmentId,
            sectionId: sectionId === '' ? null : sectionId,
            branchId,
            managerId: null,
            employmentType,
            salary: canComp && salary.trim() !== '' ? { amount: Number(salary), currency: 'EGP' } : null,
            allowances: [],
            benefits: [],
            probationMonths: Number(probationMonths) || 0,
            startDate: new Date(startDate),
          },
          reactivateLogin,
          version: employee.version,
          ...common,
        });
      }
      toast.success(t('employees.actions.rehire.done'));
      onClose();
    } catch {
      // surfaced globally
    }
  };

  return (
    <ActionDialog
      open={open}
      onClose={onClose}
      title={t('employees.actions.rehire.title')}
      description={t('employees.actions.rehire.body', { number: employee.employeeNumber })}
      submitting={action.isPending}
      onSubmit={() => void submit()}
    >
      {employee.exit !== null && !employee.exit.eligibleForRehire && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {t('employees.actions.rehire.overrideWarning')}
        </p>
      )}
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'direct'} onChange={() => setMode('direct')} />
          {t('employees.actions.rehire.direct')}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === 'offer'} onChange={() => setMode('offer')} />
          {t('employees.actions.rehire.fromOffer')}
        </label>
      </div>

      {mode === 'offer' ? (
        <div className="space-y-2">
          <OfferPicker onSelect={(o) => setJobOfferId({ id: o.id, code: o.code })} />
          {jobOfferId !== null && (
            <p className="text-sm">
              {t('employees.actions.rehire.pickedOffer')}{' '}
              <span className="font-mono text-xs" dir="ltr">{jobOfferId.code}</span>
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  <option key={b.id} value={b.id}>{localized(b.name, locale)}</option>
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
                  <option key={d.id} value={d.id}>{localized(d.name, locale)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('employees.actions.transfer.section')} hint={t('offers.form.optional')}>
              <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">{t('employees.actions.transfer.noSection')}</option>
                {sections.map((sec) => (
                  <option key={sec.id} value={sec.id}>{localized(sec.name, locale)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('offers.form.jobTitle')} required>
              <Select value={jobTitleId} onChange={(e) => setJobTitleId(e.target.value)}>
                <option value="">{t('common.select')}</option>
                {(jobTitles.data ?? []).map((jt) => (
                  <option key={jt.id} value={jt.id}>{localized(jt.name, locale)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('offers.form.employmentType')} required>
              <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
                <option value="fullTime">{t('offers.employmentType.fullTime')}</option>
                <option value="partTime">{t('offers.employmentType.partTime')}</option>
                <option value="contract">{t('offers.employmentType.contract')}</option>
                <option value="temporary">{t('offers.employmentType.temporary')}</option>
              </Select>
            </Field>
            <Field label={t('offers.form.probation')} required>
              <Input type="number" min={0} max={24} value={probationMonths} onChange={(e) => setProbationMonths(e.target.value)} dir="ltr" />
            </Field>
            <Field label={t('offers.form.startDate')} required>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            {canComp && (
              <Field label={t('offers.form.salary')} hint={t('offers.form.optional')}>
                <Input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} dir="ltr" />
              </Field>
            )}
          </div>
        </>
      )}

      {employee.userId !== null && (
        <Checkbox
          checked={reactivateLogin}
          onChange={(e) => setReactivateLogin(e.target.checked)}
          label={t('employees.actions.rehire.reactivateLogin')}
        />
      )}
      {fields}
    </ActionDialog>
  );
};
