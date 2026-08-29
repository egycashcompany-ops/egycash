// «سجلي الطبي» — the employee's own health record (P-HR-MED D5).
//
// IT IS ABOUT THEM, so they see all of it. There is no state in which the company knows something
// about somebody's body and they cannot read it, and no summary view standing between them and
// the record — a redacted version of your own health data would be a strange thing to defend.
//
// READ-ONLY, and that is the honest shape: what is recorded here was recorded by whoever was told,
// and an employee editing it directly would make the record say things nobody verified. The way to
// correct it is to tell HR, which is also how it got here.
//
// Self-service, so no permission and no navigation row — the stance `seed-navigation.ts` states
// about My Attendance, and the same one P-HR-PRF P5 shipped.
import { type MedicalProfileDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Card } from '../../../../shared/ui/Card';
import { Spinner } from '../../../../shared/ui/Spinner';
import { useMyMedicalProfile } from '../api/medical-queries';

const Row = ({ label, children }: { label: string; children: React.ReactNode }): JSX.Element => (
  <div className="border-t border-slate-200 py-2 first:border-t-0 dark:border-slate-700">
    <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
    <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">{children}</div>
  </div>
);

const List = ({ values, empty }: { values: readonly string[]; empty: string }): JSX.Element =>
  values.length === 0 ? (
    <span className="text-slate-400">{empty}</span>
  ) : (
    <ul className="list-inside list-disc space-y-0.5">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );

export const MyMedicalPage = (): JSX.Element => {
  const t = useT();
  const { data, isLoading } = useMyMedicalProfile();
  const profile = data as MedicalProfileDto | null | undefined;

  return (
    <PageContainer>
      <PageHeader title={t('medical.mine.title')} description={t('medical.mine.subtitle')} />

      {isLoading && (
        <div className="grid place-items-center py-12">
          <Spinner />
        </div>
      )}

      {!isLoading && (profile === null || profile === undefined) && (
        <Card>
          {/* «Nothing recorded» rather than «no record»: the company holding nothing about your
              health is the normal state, not a gap somebody should read as a problem. */}
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('medical.mine.none')}</p>
        </Card>
      )}

      {profile !== null && profile !== undefined && (
        <Card>
          <Row label={t('medical.profile.bloodType')}>
            {profile.bloodType === null ? (
              <span className="text-slate-400">{t('medical.profile.notRecorded')}</span>
            ) : (
              <span dir="ltr" className="font-mono">
                {profile.bloodType}
              </span>
            )}
          </Row>
          <Row label={t('medical.profile.conditions')}>
            <List values={profile.chronicConditions} empty={t('medical.profile.notRecorded')} />
          </Row>
          <Row label={t('medical.profile.allergies')}>
            <List values={profile.allergies} empty={t('medical.profile.notRecorded')} />
          </Row>
          {profile.hasDisability && (
            <Row label={t('medical.profile.disabilityNote')}>
              {profile.disabilityNote ?? t('medical.profile.notRecorded')}
            </Row>
          )}
          {profile.note !== null && <Row label={t('medical.profile.note')}>{profile.note}</Row>}
          {/* How to change it, said out loud — a read-only screen with no next step reads like a
              screen that is broken. */}
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            {t('medical.mine.howToCorrect')}
          </p>
        </Card>
      )}
    </PageContainer>
  );
};
