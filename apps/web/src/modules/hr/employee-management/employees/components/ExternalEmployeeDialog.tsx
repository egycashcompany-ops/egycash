// Registering an EXTERNAL person — «موظفين خارجيين .. يعني تعيين خارجى .. بالتالى ملهمش كود عندنا
// ولا بيانات .. محتاج أسجل بس أسمهم والإدارة والوظيفة بتاعتهم عشان أقدر أسلملهم عهده فى الـ IT».
//
// Four boxes and no more. Everything the registration screen beside it asks for — a national ID, a
// phone, a salary, a start date, a probation — would be asking the company to write down facts
// about somebody it did not employ, so none of it is here.
//
// The branch is the one field the owner did not name, and it is not bureaucracy: it is what decides
// who may see the person afterwards — without it, a branch-scoped IT user could not find the very
// person they are handing a laptop to.
//
// THE CODE IS TYPED, AND MAY CARRY LETTERS — «زود فى الموظف الخارجى دا كود .. واسمح ان الكود يتكتب
// فيه حروف انجليزي .. وبردو عرفنى تحته كدا أخر كود كام للموظفين الخارجيين دول». An external person's
// code is the company's own name for them, not an issued employee code, so it is not composed from
// the branch and the counter the way everybody else's is, and the last one issued is stated under
// the box — the same help the ordinary registration screen gives, for the same reason: so the next
// code can follow the last.
//
// THE DEPARTMENT, THE SECTION AND THE JOB ARE TYPED INTO — «عايز الإدارة والمسمي الوظيفي والقسم يكون
// قابل للبحث فى الأختيارات من خلال Input ميبقاش فقط Selection من Dropdown». The job catalog runs to
// well over a hundred titles, and three letters of one find it faster than scrolling. The branch stays
// a plain list: a handful of sites, and the owner did not name it.
import { useState } from 'react';
import {
  EXTERNAL_EMPLOYEE_CODE_PATTERN,
  type EmployeeDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Button } from '../../../../../shared/ui/Button';
import { Dialog } from '../../../../../shared/ui/Dialog';
import { Combobox } from '../../../../../shared/ui/Combobox';
import { Field, Input } from '../../../../../shared/ui/form';
import { SearchableSelect } from '../../../../../shared/ui/SearchableSelect';
import { ApiError } from '../../../../../shared/lib/api-client';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized, orgUnitLabel } from '../../../../../shared/lib/format';
import {
  useBranchOptions,
  useDepartmentOptions,
  useJobTitleReferenceOptions,
  useSectionOptions,
} from '../../../../organization/shared/references';
import {
  useLastExternalEmployeeCode,
  useRegisterEmployeeExternal,
} from '../api/employee-queries';
import { idsMatching } from '../lib/register-code';

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

  const [code, setCode] = useState('');
  const [fullNameAr, setFullNameAr] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [jobTitleId, setJobTitleId] = useState('');

  const { data: branches = [] } = useBranchOptions();
  const departmentsQuery = useDepartmentOptions(branchId === '' ? undefined : branchId);
  const sectionsQuery = useSectionOptions(departmentId === '' ? undefined : departmentId);
  const jobTitlesQuery = useJobTitleReferenceOptions();
  const departments = departmentsQuery.data ?? [];
  const sections = sectionsQuery.data ?? [];
  const jobTitles = jobTitlesQuery.data ?? [];
  // The boxes commit ids and read as names; «…» while the catalog that names one is still loading.
  // What is typed is matched against the name alone (`idsMatching`).
  const [departmentTyped, setDepartmentTyped] = useState('');
  const [sectionTyped, setSectionTyped] = useState('');
  const [jobTitleTyped, setJobTitleTyped] = useState('');
  const departmentLabel = (d: (typeof departments)[number]): string => orgUnitLabel(d, locale);
  const sectionLabel = (sec: (typeof sections)[number]): string => orgUnitLabel(sec, locale);
  const jobTitleLabel = (jt: (typeof jobTitles)[number]): string => localized(jt.name, locale);
  const nameIn =
    <T extends { id: string }>(items: readonly T[], label: (item: T) => string) =>
    (id: string): string => {
      const item = items.find((x) => x.id === id);
      return item === undefined ? '…' : label(item);
    };
  // Asked only while the dialog is open: a closed dialog has nothing to hint at.
  const lastCode = useLastExternalEmployeeCode(open);

  const reset = (): void => {
    setCode('');
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
    // The box reports a re-pick of the department already held, as a native list did not; only a
    // real change throws the section under it away.
    if (id === departmentId) return;
    setDepartmentId(id);
    setSectionId('');
  };

  const codeShaped = EXTERNAL_EMPLOYEE_CODE_PATTERN.test(code.trim());
  const ready =
    codeShaped &&
    fullNameAr.trim().length >= 2 &&
    branchId !== '' &&
    departmentId !== '' &&
    jobTitleId !== '';

  const submit = async (): Promise<void> => {
    if (!ready) {
      toast.error(t('employees.external.incomplete'));
      return;
    }
    try {
      const employee = await register.mutateAsync({
        code: code.trim(),
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
    } catch (e) {
      // The code is the one thing a second clerk can collide on, so that answer gets its own
      // message instead of «تعذَّر التسجيل», which would leave HR guessing which field to change.
      if (e instanceof ApiError && e.code === 'DUPLICATE') {
        toast.error(t('employees.external.codeTaken'));
        return;
      }
      toast.error(t('employees.external.failed'));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      // The three boxes' lists open inside the body; a short body would cut them (`Dialog`, `tall`).
      tall
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
        <Field
          label={t('employees.external.code')}
          htmlFor="external-code"
          required
          hint={
            lastCode.data?.code == null
              ? t('employees.external.noneYet')
              : t('employees.external.lastCode', { code: lastCode.data.code })
          }
          error={
            code.trim() !== '' && !codeShaped ? t('employees.external.codeShape') : undefined
          }
        >
          <Input
            id="external-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            dir="ltr"
          />
        </Field>
        <Field label={t('employees.external.fullNameAr')} htmlFor="external-name" required>
          <Input
            id="external-name"
            value={fullNameAr}
            onChange={(e) => setFullNameAr(e.target.value)}
            dir="rtl"
          />
        </Field>
        <Field label={t('offers.form.branch')} htmlFor="external-branch" required>
          <SearchableSelect
            id="external-branch"
            value={branchId}
            onChange={(next) => {
              // A re-pick of the branch already held must not throw the department away.
              if (next !== branchId) pickBranch(next);
            }}
            options={branches.map((b) => ({ value: b.id, label: localized(b.name, locale) }))}
          />
        </Field>
        <Field
          label={t('offers.form.department')}
          htmlFor="external-department"
          required
          hint={branchId === '' ? t('employees.external.pickBranchFirst') : undefined}
        >
          <Combobox
            id="external-department"
            value={departmentId}
            options={idsMatching(departments, departmentLabel, departmentTyped)}
            optionLabel={nameIn(departments, departmentLabel)}
            onSearch={setDepartmentTyped}
            onChange={(id) => {
              setDepartmentTyped('');
              pickDepartment(id);
            }}
            disabled={branchId === ''}
            placeholder={t('common.select')}
            emptyText={t(departmentsQuery.isLoading ? 'common.loading' : 'common.noResults')}
            clearLabel={t('common.clear')}
          />
        </Field>
        <Field label={t('employees.actions.transfer.section')} htmlFor="external-section">
          <Combobox
            id="external-section"
            value={sectionId}
            options={idsMatching(sections, sectionLabel, sectionTyped)}
            optionLabel={nameIn(sections, sectionLabel)}
            onSearch={setSectionTyped}
            onChange={(id) => {
              setSectionTyped('');
              setSectionId(id);
            }}
            disabled={departmentId === ''}
            placeholder={t('common.select')}
            emptyText={t(sectionsQuery.isLoading ? 'common.loading' : 'common.noResults')}
            clearLabel={t('common.clear')}
          />
        </Field>
        <Field label={t('offers.form.jobTitle')} htmlFor="external-job" required>
          <Combobox
            id="external-job"
            value={jobTitleId}
            options={idsMatching(jobTitles, jobTitleLabel, jobTitleTyped)}
            optionLabel={nameIn(jobTitles, jobTitleLabel)}
            onSearch={setJobTitleTyped}
            onChange={(id) => {
              setJobTitleTyped('');
              setJobTitleId(id);
            }}
            placeholder={t('common.select')}
            emptyText={t(jobTitlesQuery.isLoading ? 'common.loading' : 'common.noResults')}
            clearLabel={t('common.clear')}
          />
        </Field>
      </div>
    </Dialog>
  );
};
