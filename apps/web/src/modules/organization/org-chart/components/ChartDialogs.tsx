// The org chart's dialogs (P-ORG-3 §2.2): add a section, rename it, stop it, add a job to a place.
// Written as the organize board writes its section dialog — the shared `Dialog`, Cancel and Save in
// its footer — with the module's own `LocalizedNameFields` for the two names.
import { useMemo, useState } from 'react';
import {
  type Locale,
  type OrgChartDepartmentDto,
  type OrgChartDto,
  type OrgChartSectionDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Checkbox, Field } from '../../../../shared/ui/form';
import { SearchableSelect } from '../../../../shared/ui/SearchableSelect';
import { localized } from '../../../../shared/lib/format';
import { LocalizedNameFields, type LocalizedValue } from '../../shared/form-fields';
import { isPlacedAt, otherPlaceLabels } from '../lib/chart-model';

const Footer = ({
  onClose,
  onSubmit,
  pending,
  disabled,
  submitLabel,
  danger = false,
}: {
  onClose: () => void;
  onSubmit: () => void;
  pending: boolean;
  disabled: boolean;
  submitLabel: string;
  danger?: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex justify-end gap-2">
      <Button
        variant={danger ? 'ghost' : 'secondary'}
        size={danger ? 'sm' : 'md'}
        onClick={onClose}
      >
        {t('common.cancel')}
      </Button>
      <Button
        variant={danger ? 'danger' : 'primary'}
        size={danger ? 'sm' : 'md'}
        onClick={onSubmit}
        loading={pending}
        disabled={disabled}
      >
        {submitLabel}
      </Button>
    </div>
  );
};

const trimmed = (value: LocalizedValue): LocalizedValue => ({
  ar: value.ar.trim(),
  en: value.en.trim(),
});
const complete = (value: LocalizedValue): boolean =>
  value.ar.trim() !== '' && value.en.trim() !== '';

/** «إضافة قسم»: both names, and the branches whose department row is linked — all ticked at first. */
export const AddSectionDialog = ({
  department,
  locale,
  pending,
  onClose,
  onSubmit,
}: {
  department: OrgChartDepartmentDto;
  locale: Locale;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: LocalizedValue, branchIds: string[]) => void;
}): JSX.Element => {
  const t = useT();
  const linked = useMemo(() => new Set(department.linkedBranchIds), [department.linkedBranchIds]);
  const [name, setName] = useState<LocalizedValue>({ ar: '', en: '' });
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(department.linkedBranchIds));
  const toggle = (id: string): void =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const invalid = !complete(name) || ticked.size === 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('organization.chart.addSectionTitle', { name: localized(department.name, locale) })}
      description={t('organization.chart.branchesHint')}
      footer={
        <Footer
          onClose={onClose}
          onSubmit={() => {
            if (!invalid) onSubmit(trimmed(name), [...ticked]);
          }}
          pending={pending}
          disabled={invalid}
          submitLabel={t('organization.chart.addSection')}
        />
      }
    >
      <div className="space-y-4">
        <LocalizedNameFields
          label={t('organization.chart.sectionName')}
          value={name}
          onChange={setName}
          required
        />
        <Field label={t('organization.chart.branches')} required>
          <div className="grid gap-2 sm:grid-cols-2">
            {department.branches.map((branch) =>
              linked.has(branch.id) ? (
                <Checkbox
                  key={branch.id}
                  checked={ticked.has(branch.id)}
                  onChange={() => toggle(branch.id)}
                  label={localized(branch.name, locale)}
                />
              ) : (
                <div key={branch.id} className="text-sm text-slate-400 dark:text-slate-500">
                  <Checkbox
                    checked={false}
                    disabled
                    label={localized(branch.name, locale)}
                    onChange={() => undefined}
                  />
                  <p className="ms-6 text-xs">{t('organization.chart.branchNotLinked')}</p>
                </div>
              ),
            )}
          </div>
        </Field>
      </div>
    </Dialog>
  );
};

/** «تغيير الاسم»: both names, prefilled. */
export const RenameSectionDialog = ({
  section,
  locale,
  pending,
  onClose,
  onSubmit,
}: {
  section: OrgChartSectionDto;
  locale: Locale;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: LocalizedValue) => void;
}): JSX.Element => {
  const t = useT();
  const [name, setName] = useState<LocalizedValue>({ ar: section.name.ar, en: section.name.en });
  const invalid = !complete(name);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('organization.chart.renameTitle', { name: localized(section.name, locale) })}
      footer={
        <Footer
          onClose={onClose}
          onSubmit={() => {
            if (!invalid) onSubmit(trimmed(name));
          }}
          pending={pending}
          disabled={invalid}
          submitLabel={t('common.save')}
        />
      }
    >
      <LocalizedNameFields
        label={t('organization.chart.sectionName')}
        value={name}
        onChange={setName}
        required
      />
    </Dialog>
  );
};

/** «إيقاف القسم»: a confirmation, worded as the job delete's (JobTitleDetailPage). */
export const StopSectionDialog = ({
  section,
  locale,
  pending,
  onClose,
  onConfirm,
}: {
  section: OrgChartSectionDto;
  locale: Locale;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('organization.chart.stopTitle', { name: localized(section.name, locale) })}
      footer={
        <Footer
          onClose={onClose}
          onSubmit={onConfirm}
          pending={pending}
          disabled={false}
          submitLabel={t('organization.chart.stop')}
          danger
        />
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {t('organization.chart.stopBody')}
      </p>
    </Dialog>
  );
};

/** «إضافة وظيفة»: one active job, searched; each option says where else the job already sits. */
export const AddJobDialog = ({
  chart,
  department,
  sectionCatalogId,
  locale,
  pending,
  onClose,
  onSubmit,
}: {
  chart: OrgChartDto;
  department: OrgChartDepartmentDto;
  sectionCatalogId: string | null;
  locale: Locale;
  pending: boolean;
  onClose: () => void;
  onSubmit: (jobId: string) => void;
}): JSX.Element => {
  const t = useT();
  const [jobId, setJobId] = useState('');
  const departmentCatalogId = department.departmentCatalogId ?? '';
  const here = { departmentCatalogId, sectionCatalogId };
  const placeName =
    sectionCatalogId === null
      ? `${localized(department.name, locale)} › ${t('organization.chart.direct')}`
      : `${localized(department.name, locale)} › ${localized(
          department.sections.find((s) => s.sectionCatalogId === sectionCatalogId)?.name ?? {
            ar: '',
            en: '',
          },
          locale,
        )}`;
  const options = chart.jobs
    .filter((job) => !isPlacedAt(job, departmentCatalogId, sectionCatalogId))
    .map((job) => {
      const elsewhere = otherPlaceLabels(job, chart, locale, here);
      const name = `${localized(job.name, locale)} (${job.code})`;
      return {
        value: job.id,
        label:
          elsewhere.length === 0
            ? name
            : `${name} — ${t('organization.chart.alsoIn', { places: elsewhere.join(locale === 'ar' ? '، ' : ', ') })}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  return (
    <Dialog
      open
      tall
      onClose={onClose}
      title={t('organization.chart.addJobTitle', { place: placeName })}
      footer={
        <Footer
          onClose={onClose}
          onSubmit={() => {
            if (jobId !== '') onSubmit(jobId);
          }}
          pending={pending}
          disabled={jobId === ''}
          submitLabel={t('organization.chart.addJob')}
        />
      }
    >
      <Field label={t('organization.chart.job')} required>
        <SearchableSelect value={jobId} onChange={setJobId} options={options} />
      </Field>
    </Dialog>
  );
};
