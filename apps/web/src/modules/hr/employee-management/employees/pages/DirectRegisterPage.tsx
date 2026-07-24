// Direct Employee Registration (frozen design D4) — onboard the existing workforce or a walk-in
// hire WITHOUT a recruitment pipeline. Reuses the shared national-id OCR binding (capture →
// review → populate) and the same identity/contact shapes the applicant form uses; employment
// terms are entered directly. Tenured staff may enter straight at `active`; new hires default
// to probation-first (D1). The server runs the national-id person guard (an exited match must
// be REHIRED on the same employee number).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  type DirectRegisterEmployee,
  type EmploymentType,
  type Locale,
  type MaritalStatus,
} from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useCan } from '../../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../../store';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { Button } from '../../../../../shared/ui/Button';
import { Field, Input, Select } from '../../../../../shared/ui/form';
import { toast } from '../../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../../shared/lib/format';
import { ApplicantNationalIdOcr } from '../../../recruitment/applicants/components/ApplicantNationalIdOcr';
import {
  useBranchOptions,
  useDepartmentOptions,
  useSectionOptions,
} from '../../../../organization/shared/references';
import { useJobTitles } from '../../../recruitment/job-offers/api/job-offer-queries';
import { useRegisterEmployeeDirect, useRehireCheck } from '../api/employee-queries';

const MARITAL: MaritalStatus[] = ['single', 'married', 'divorced', 'widowed'];
const EMPLOYMENT_TYPES: EmploymentType[] = ['fullTime', 'partTime', 'contract', 'temporary'];

export const DirectRegisterPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const can = useCan();
  const register = useRegisterEmployeeDirect();

  // Identity + contact.
  const [fullNameAr, setFullNameAr] = useState('');
  const [fullNameEn, setFullNameEn] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [religion, setReligion] = useState('');
  const [nationalIdExpiry, setNationalIdExpiry] = useState('');
  const [dependents, setDependents] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [email, setEmail] = useState('');
  // Employment terms.
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [jobTitleId, setJobTitleId] = useState('');
  const [employmentType, setEmploymentType] = useState<EmploymentType>('fullTime');
  const [probationMonths, setProbationMonths] = useState('3');
  const [startDate, setStartDate] = useState('');
  const [hiringDate, setHiringDate] = useState('');
  const [salary, setSalary] = useState('');
  const [entryStatus, setEntryStatus] = useState<'probation' | 'active'>('probation');

  const { data: branches = [] } = useBranchOptions();
  const { data: departments = [] } = useDepartmentOptions(branchId === '' ? undefined : branchId);
  const { data: sections = [] } = useSectionOptions(departmentId === '' ? undefined : departmentId);
  const jobTitles = useJobTitles(can('jobTitle.view'));
  const canComp = can('employee.manageCompensation');

  // Rehire guard preview (F2): an exited match must be rehired, not re-registered.
  const rehireMatch = useRehireCheck(nationalId);

  const submit = async (): Promise<void> => {
    if (fullNameAr.trim().length < 2 || primaryPhone.trim() === '') {
      toast.error(t('employees.register.identityRequired'));
      return;
    }
    if (branchId === '' || departmentId === '' || jobTitleId === '' || startDate === '') {
      toast.error(t('employees.register.employmentRequired'));
      return;
    }
    const body: DirectRegisterEmployee = {
      personal: {
        identity: {
          fullNameAr: fullNameAr.trim(),
          ...(fullNameEn.trim() === '' ? {} : { fullNameEn: fullNameEn.trim() }),
          ...(nationalId.trim() === '' ? {} : { nationalId: nationalId.trim() }),
          nationality: 'Egyptian',
          ...(maritalStatus === '' ? {} : { maritalStatus: maritalStatus as MaritalStatus }),
          ...(religion.trim() === '' ? {} : { religion: religion.trim() }),
          ...(nationalIdExpiry === '' ? {} : { nationalIdExpiry: new Date(nationalIdExpiry) }),
          ...(dependents === '' ? {} : { dependentsCount: Number(dependents) }),
        },
        contact: {
          primaryPhone: primaryPhone.trim(),
          ...(secondaryPhone.trim() === '' ? {} : { secondaryPhone: secondaryPhone.trim() }),
          ...(email.trim() === '' ? {} : { email: email.trim() }),
        },
        experience: [],
        drivingLicenses: [],
        certifications: [],
        references: [],
      },
      employment: {
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
      ...(hiringDate === '' ? {} : { hiringDate: new Date(hiringDate) }),
      entryStatus,
    };
    try {
      const created = await register.mutateAsync(body);
      toast.success(t('employees.register.done', { code: created.code }));
      navigate(`/employees/${created.id}`);
    } catch {
      // surfaced globally
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.register.title')}
        description={t('employees.register.subtitle')}
        breadcrumbs={[
          { label: t('employees.module.title'), to: '/employees' },
          { label: t('employees.register.title') },
        ]}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader title={t('employees.register.ocrTitle')} />
          <CardBody>
            <ApplicantNationalIdOcr
              onConfirm={(d) => {
                setFullNameAr(d.fullNameAr);
                setFullNameEn(d.fullNameEn);
                setNationalId(d.nationalId);
                if (d.maritalStatus !== '') setMaritalStatus(d.maritalStatus);
                setReligion(d.religion);
                setNationalIdExpiry(d.nationalIdExpiry);
              }}
            />
          </CardBody>
        </Card>

        {rehireMatch.data != null && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {rehireMatch.data.status === 'exited'
              ? t('employees.register.rehireMatch', { code: rehireMatch.data.code })
              : t('employees.register.employedMatch', { code: rehireMatch.data.code })}
            {rehireMatch.data.status === 'exited' && (
              <Button
                size="sm"
                variant="secondary"
                className="ms-3"
                onClick={() => navigate(`/employees/${rehireMatch.data?.employeeId ?? ''}`)}
              >
                {t('employees.register.openProfile')}
              </Button>
            )}
          </div>
        )}

        <Card>
          <CardHeader title={t('employees.personal.identity')} />
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('applicants.form.fullNameAr')} required>
                <Input value={fullNameAr} onChange={(e) => setFullNameAr(e.target.value)} maxLength={200} />
              </Field>
              <Field label={t('applicants.form.fullNameEn')}>
                <Input value={fullNameEn} onChange={(e) => setFullNameEn(e.target.value)} maxLength={200} dir="ltr" />
              </Field>
              <Field label={t('applicants.form.nationalId')}>
                <Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} maxLength={14} dir="ltr" />
              </Field>
              <Field label={t('applicants.form.maritalStatus')}>
                <Select value={maritalStatus} onChange={(e) => setMaritalStatus(e.target.value)}>
                  <option value="">—</option>
                  {MARITAL.map((m) => (
                    <option key={m} value={m}>
                      {t(`applicants.maritalStatus.${m}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('applicants.form.religion')}>
                <Input value={religion} onChange={(e) => setReligion(e.target.value)} maxLength={100} />
              </Field>
              <Field label={t('applicants.form.nationalIdExpiry')}>
                <Input type="date" value={nationalIdExpiry} onChange={(e) => setNationalIdExpiry(e.target.value)} />
              </Field>
              <Field label={t('applicants.form.dependents')}>
                <Input type="number" min={0} max={50} value={dependents} onChange={(e) => setDependents(e.target.value)} dir="ltr" />
              </Field>
              <Field label={t('applicants.form.primaryPhone')} required>
                <Input value={primaryPhone} onChange={(e) => setPrimaryPhone(e.target.value)} dir="ltr" maxLength={30} />
              </Field>
              <Field label={t('applicants.form.secondaryPhone')}>
                <Input value={secondaryPhone} onChange={(e) => setSecondaryPhone(e.target.value)} dir="ltr" maxLength={30} />
              </Field>
              <Field label={t('applicants.form.email')}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" maxLength={200} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('employees.detail.employment')} />
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label={t('offers.form.branch')} required>
                <Select
                  value={branchId}
                  onChange={(e) => {
                    setBranchId(e.target.value);
                    setDepartmentId('');
                    setSectionId('');
                  }}
                >
                  <option value="">{t('common.select')}</option>
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
              <Field label={t('employees.actions.transfer.section')}>
                <Select value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                  <option value="">{t('employees.actions.transfer.noSection')}</option>
                  {sections.map((sec) => (
                    <option key={sec.id} value={sec.id}>
                      {localized(sec.name, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('offers.form.jobTitle')} required>
                <Select value={jobTitleId} onChange={(e) => setJobTitleId(e.target.value)}>
                  <option value="">{t('common.select')}</option>
                  {(jobTitles.data ?? []).map((jt) => (
                    <option key={jt.id} value={jt.id}>
                      {localized(jt.name, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('offers.form.employmentType')} required>
                <Select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)}>
                  {EMPLOYMENT_TYPES.map((et) => (
                    <option key={et} value={et}>
                      {t(`offers.employmentType.${et}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('offers.form.probation')} required>
                <Input type="number" min={0} max={24} value={probationMonths} onChange={(e) => setProbationMonths(e.target.value)} dir="ltr" />
              </Field>
              <Field label={t('offers.form.startDate')} required>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label={t('employees.register.hiringDate')} hint={t('employees.register.hiringDateHint')}>
                <Input type="date" value={hiringDate} onChange={(e) => setHiringDate(e.target.value)} />
              </Field>
              {canComp && (
                <Field label={t('offers.form.salary')} hint={t('offers.form.optional')}>
                  <Input type="number" min={0} value={salary} onChange={(e) => setSalary(e.target.value)} dir="ltr" />
                </Field>
              )}
              <Field label={t('employees.register.entryStatus')} hint={t('employees.register.entryStatusHint')}>
                <Select value={entryStatus} onChange={(e) => setEntryStatus(e.target.value as 'probation' | 'active')}>
                  <option value="probation">{t('employees.status.probation')}</option>
                  <option value="active">{t('employees.status.active')}</option>
                </Select>
              </Field>
            </div>
          </CardBody>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate('/employees')}>
            {t('common.cancel')}
          </Button>
          <Button loading={register.isPending} onClick={() => void submit()}>
            {t('employees.register.submit')}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
};
