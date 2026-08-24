// Choosing who a message is for.
//
// Three modes, and the widest one is a deliberate click rather than the state you land in by
// clearing a filter. That is the whole shape of this component: `everyone` cannot be reached by
// accident, and a filter with no criteria is refused rather than quietly meaning everybody.
//
// The criteria are all multi-select and they AND together — "the drivers and the guards, in Maadi
// and Giza" is two criteria of two values each. The copy under the mode selector says so, because
// a builder that looks like a search box will be read as an OR.
import { useMemo } from 'react';
import {
  type AnnouncementAudience,
  type EmployeeAudienceFilter,
  type Locale,
  type OrgUnitOptionDto,
} from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { localized } from '../../../../shared/lib/format';
import { cn } from '../../../../shared/lib/cn';
import { MultiSelect } from '../../../../shared/ui/MultiSelect';

export type AudienceMode = AnnouncementAudience['kind'];

export interface AudienceOptions {
  branches: OrgUnitOptionDto[];
  departments: OrgUnitOptionDto[];
  sections: OrgUnitOptionDto[];
  jobTitles: OrgUnitOptionDto[];
  /** Distinct values already present on employee files — never a list this screen invents. */
  religions: string[];
  nationalities: string[];
}

const MODES: AudienceMode[] = ['everyone', 'filter', 'employees'];

export const AudienceBuilder = ({
  mode,
  filter,
  options,
  onModeChange,
  onFilterChange,
}: {
  mode: AudienceMode;
  filter: EmployeeAudienceFilter;
  options: AudienceOptions;
  onModeChange: (next: AudienceMode) => void;
  onFilterChange: (next: EmployeeAudienceFilter) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const unitOptions = useMemo(
    () => ({
      branches: options.branches.map((u) => ({ value: u.id, label: localized(u.name, locale) })),
      departments: options.departments.map((u) => ({ value: u.id, label: localized(u.name, locale) })),
      sections: options.sections.map((u) => ({ value: u.id, label: localized(u.name, locale) })),
      jobTitles: options.jobTitles.map((u) => ({ value: u.id, label: localized(u.name, locale) })),
    }),
    [options, locale],
  );

  /** Set one criterion, dropping it entirely when it is emptied — `{$in: []}` matches nobody. */
  const setCriterion = <K extends keyof EmployeeAudienceFilter>(
    key: K,
    values: string[],
  ): void => {
    const next = { ...filter };
    if (values.length === 0) delete next[key];
    else next[key] = values as EmployeeAudienceFilter[K];
    onFilterChange(next);
  };

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {t('hr.announcements.audience.legend')}
        </legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((option) => (
            <label
              key={option}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                option === mode
                  ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-900/30'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
              )}
            >
              <input
                type="radio"
                name="announcement-audience"
                className="mt-0.5"
                checked={option === mode}
                onChange={() => onModeChange(option)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">
                  {t(`hr.announcements.audience.${option}`)}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {t(`hr.announcements.audience.${option}Hint`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === 'filter' && (
        <div className="space-y-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          {/* Said once, plainly: a builder that looks like a search box reads as an OR. */}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('hr.announcements.audience.filterRule')}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <MultiSelect
              label={t('hr.announcements.filter.branches')}
              options={unitOptions.branches}
              value={filter.branchIds ?? []}
              onChange={(v: string[]) => setCriterion('branchIds', v)}
            />
            <MultiSelect
              label={t('hr.announcements.filter.departments')}
              options={unitOptions.departments}
              value={filter.departmentIds ?? []}
              onChange={(v: string[]) => setCriterion('departmentIds', v)}
            />
            <MultiSelect
              label={t('hr.announcements.filter.sections')}
              options={unitOptions.sections}
              value={filter.sectionIds ?? []}
              onChange={(v: string[]) => setCriterion('sectionIds', v)}
            />
            <MultiSelect
              label={t('hr.announcements.filter.jobTitles')}
              options={unitOptions.jobTitles}
              value={filter.jobTitleIds ?? []}
              onChange={(v: string[]) => setCriterion('jobTitleIds', v)}
            />
            <MultiSelect
              label={t('hr.announcements.filter.genders')}
              options={[
                { value: 'male', label: t('hr.announcements.gender.male') },
                { value: 'female', label: t('hr.announcements.gender.female') },
              ]}
              value={filter.genders ?? []}
              onChange={(v: string[]) => setCriterion('genders', v)}
            />
            {/* Religion is on the employee file already; this reads it. Egyptian labour law gives
                Christian employees their own holidays, and an Eid greeting addressed to the whole
                company is the wrong message to half of it. */}
            <MultiSelect
              label={t('hr.announcements.filter.religions')}
              options={options.religions.map((value) => ({ value, label: value }))}
              value={filter.religions ?? []}
              onChange={(v: string[]) => setCriterion('religions', v)}
            />
            <MultiSelect
              label={t('hr.announcements.filter.nationalities')}
              options={options.nationalities.map((value) => ({ value, label: value }))}
              value={filter.nationalities ?? []}
              onChange={(v: string[]) => setCriterion('nationalities', v)}
            />
            <MultiSelect
              label={t('hr.announcements.filter.employmentTypes')}
              options={['fullTime', 'partTime', 'temporary', 'contract', 'internship'].map((value) => ({
                value,
                label: t(`hr.announcements.employmentType.${value}`),
              }))}
              value={filter.employmentTypes ?? []}
              onChange={(v: string[]) => setCriterion('employmentTypes', v)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
