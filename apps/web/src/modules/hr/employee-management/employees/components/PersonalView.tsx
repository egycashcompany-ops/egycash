// Read-only render of the employee's OWNED personal data (copied once at hire, maintained
// here — the applicant record stays immutable pre-hire history). National id is masked
// (Security Architecture §3).
import { type ReactNode } from 'react';
import { type EmployeePersonalDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Card, CardBody, CardHeader } from '../../../../../shared/ui/Card';
import { formatDate } from '../../../../../shared/lib/format';

const Row = ({ label, children }: { label: string; children: ReactNode }): JSX.Element => (
  <div>
    <dt className="text-xs text-slate-400">{label}</dt>
    <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{children}</dd>
  </div>
);

const dash = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === '' ? '—' : String(v);

export const PersonalView = ({ personal }: { personal: EmployeePersonalDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const date = (v: string | null): string => (v === null ? '—' : formatDate(v, locale));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={t('employees.personal.identity')} />
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Row label={t('applicants.form.fullNameAr')}>{personal.fullNameAr}</Row>
            <Row label={t('applicants.form.fullNameEn')}>{dash(personal.fullNameEn)}</Row>
            <Row label={t('applicants.form.nationalId')}>
              <span className="font-mono" dir="ltr">{dash(personal.nationalIdMasked)}</span>
            </Row>
            <Row label={t('applicants.detail.birthDate')}>{date(personal.birthDate)}</Row>
            <Row label={t('applicants.detail.gender')}>
              {personal.gender === null ? '—' : t(`applicants.gender.${personal.gender}`)}
            </Row>
            <Row label={t('applicants.form.nationality')}>{personal.nationality}</Row>
            <Row label={t('applicants.form.maritalStatus')}>
              {personal.maritalStatus === null ? '—' : t(`applicants.maritalStatus.${personal.maritalStatus}`)}
            </Row>
            <Row label={t('applicants.form.religion')}>{dash(personal.religion)}</Row>
            <Row label={t('applicants.form.nationalIdExpiry')}>{date(personal.nationalIdExpiry)}</Row>
            <Row label={t('applicants.form.dependents')}>{dash(personal.dependentsCount)}</Row>
            <Row label={t('employees.personal.placeOfBirth')}>{dash(personal.placeOfBirth)}</Row>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('employees.personal.contact')} />
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Row label={t('applicants.form.primaryPhone')}>
              <span dir="ltr">{personal.contact.primaryPhone}</span>
            </Row>
            <Row label={t('applicants.form.secondaryPhone')}>
              <span dir="ltr">{dash(personal.contact.secondaryPhone)}</span>
            </Row>
            <Row label={t('applicants.form.email')}>
              <span dir="ltr">{dash(personal.contact.email)}</span>
            </Row>
            <Row label={t('applicants.form.officialAddress')}>
              {personal.officialAddress === null
                ? '—'
                : `${personal.officialAddress.line1}, ${personal.officialAddress.city}`}
            </Row>
            <Row label={t('applicants.form.currentAddress')}>
              {personal.currentAddress === null
                ? '—'
                : `${personal.currentAddress.line1}, ${personal.currentAddress.city}`}
            </Row>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t('employees.personal.background')} />
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Row label={t('applicants.form.education')}>
              {personal.education === null
                ? '—'
                : `${t(`applicants.educationLevel.${personal.education.level}`)}${
                    personal.education.institution === undefined ? '' : ` — ${personal.education.institution}`
                  }`}
            </Row>
            <Row label={t('applicants.form.military')}>
              {personal.military === null ? '—' : t(`applicants.militaryStatus.${personal.military.status}`)}
            </Row>
            <Row label={t('applicants.form.experience')}>
              {personal.experience.length === 0
                ? '—'
                : personal.experience.map((x) => x.employer).join('، ')}
            </Row>
            <Row label={t('applicants.form.licenses')}>
              {personal.drivingLicenses.length === 0
                ? '—'
                : personal.drivingLicenses.map((d) => d.class).join('، ')}
            </Row>
            <Row label={t('applicants.form.certifications')}>
              {personal.certifications.length === 0 ? '—' : personal.certifications.join('، ')}
            </Row>
            <Row label={t('applicants.form.references')}>
              {personal.references.length === 0 ? '—' : personal.references.map((r) => r.name).join('، ')}
            </Row>
          </dl>
        </CardBody>
      </Card>
    </div>
  );
};
