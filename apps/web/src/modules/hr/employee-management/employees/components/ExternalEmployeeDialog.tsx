// Registering an EXTERNAL person — «موظفين خارجيين .. يعني تعيين خارجى .. بالتالى ملهمش كود عندنا
// ولا بيانات .. محتاج أسجل بس أسمهم والإدارة والوظيفة بتاعتهم عشان أقدر أسلملهم عهده فى الـ IT».
//
// Four boxes and no more. Everything the registration screen beside it asks for — a national ID, a
// phone, a salary, a start date, a probation — would be asking the company to write down facts
// about somebody it did not employ, so none of it is here.
//
// The branch is the one field the owner did not name, and it is not bureaucracy: the code's first
// three digits ARE the hiring branch (ADR-017), and the branch is what decides who may see the
// person afterwards — without it, a branch-scoped IT user could not find the very person they are
// handing a laptop to. The code itself is never typed: the server composes it, and the toast says
// what it issued, because that code is how IT will look this person up.
import { useState } from 'react';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized, orgUnitLabel } from '../../../../../shared/lib/format';
import {
  useBranchOptions,
  useDepartmentOptions,
  useJobTitleReferenceOptions,
  useSectionOptions,
} from '../../../../organization/shared/references';
import { useRegisterEmployeeExternal } from '../api/employee-queries';

export const ExternalEmployeeDialog = ({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  /** The new person, so the page that opened this can take the reader to them. */
  onRegistered?: (employee: EmployeeDto) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const register = useRegisterEmployeeExternal();

  const [fullNameAr, setFullNameAr] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [jobTitleId, setJobTitleId] = useState('');

  const { data: branches = [] } = useBranchOptions();
  const { data: departments = [] } = useDepartmentOptions(branchId === '' ? undefined : branchId);
  const { data: sections = [] } = useSectionOptions(departmentId === '' ? undefined : departmentId);
  const { data: jobTitles = [] } = useJobTitleReferenceOptions();

  const reset = (): void => {
    setFullNameAr('');
    setBranchId('');
    setDepartmentId('');
    setSectionId('');
    setJobTitleId('');
  };

  const close = (): void => {
    reset();
    onClose();
  };

  // A department belongs to one branch and a section to one department, so changing the one above
  // drops what was picked under it rather than submitting a pair the server would refuse.
  const pickBranch = (id: string): void => {
    setBranchId(id);
    setDepartmentId('');
    setSectionId('');
  };
  const pickDepartment = (id: string): void => {
    setDepartmentId(id);
    setSectionId('');
  };

  const ready =
    fullNameAr.trim().length >= 2 && branchId !== '' && departmentId !== '' && jobTitleId !== '';

  const submit = async (): Promise<void> => {
    if (!ready) {
      toast.error(t('employees.external.incomplete'));
      return;
    }
    try {
      const employee = await register.mutateAsync({
        fullNameAr: fullNameAr.trim(),
        branchId,
        departmentId,
        ...(sectionId === '' ? {} : { sectionId }),
        jobTitleId,
      });
      // The code is the point of the message: it is what IT types to find this person.
      toast.success(
        t('employees.external.registered', {
          name: employee.personal.fullNameAr,
          code: employee.code,
        }),
      );
      reset();
      onClose();
      onRegistered?.(employee);
    } catch {
      toast.error(t('employees.external.failed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('employees.external.title')}
      description={t('employees.external.description')}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={register.isPending}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!ready || register.isPending}>
            {t('employees.external.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('employees.external.fullNameAr')} htmlFor="external-name" required>
          <Input
            id="external-name"
            value={fullNameAr}
            onChange={(e) => setFullNameAr(e.target.value)}
            dir="rtl"
          />
        </Field>
        <Field label={t('offers.form.branch')} htmlFor="external-branch" required>
          <Select
            id="external-branch"
            value={branchId}
            onChange={(e) => pickBranch(e.target.value)}
          >
            <option value="">{t('common.select')}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {localized(b.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={t('offers.form.department')}
          htmlFor="external-department"
          required
          hint={branchId === '' ? t('employees.external.pickBranchFirst') : undefined}
        >
          <Select
            id="external-department"
            value={departmentId}
            onChange={(e) => pickDepartment(e.target.value)}
            disabled={branchId === ''}
          >
            <option value="">{t('common.select')}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {orgUnitLabel(d, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('employees.actions.transfer.section')} htmlFor="external-section">
          <Select
            id="external-section"
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            disabled={departmentId === ''}
          >
            <option value="">{t('common.select')}</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {orgUnitLabel(s, locale)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('offers.form.jobTitle')} htmlFor="external-job" required>
          <Select
            id="external-job"
            value={jobTitleId}
            onChange={(e) => setJobTitleId(e.target.value)}
          >
            <option value="">{t('common.select')}</option>
            {jobTitles.map((j) => (
              <option key={j.id} value={j.id}>
                {localized(j.name, locale)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
};
