// Where an account sits in the company: branch → department → section, in that order and only in
// that order.
//
// The cascade is the point. `user.service.assertPlacementConsistent` refuses a department that does
// not belong to the chosen branch and a section that does not belong to the chosen department, so a
// form that let the three be picked independently would be a form whose valid combinations the
// administrator has to guess. Choosing a parent CLEARS its children rather than silently keeping a
// now-inconsistent child — the alternative is a save that fails on a field nobody touched.
//
// Departments and sections are searched server-side (ADR-019 rule 5) through the ordinary list
// endpoints, which are gated by `department.view` / `section.view`. An administrator who may edit
// accounts without holding those gets a note instead of a picker, and the stored placement is left
// exactly as it is — a field that cannot be read is not a field that should be cleared.
import { useState } from 'react';
import { type Locale, type OrgUnitOptionDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useCan } from '../../../../platform/rbac/Can';
import { Field, SearchInput, Select, Spinner } from '../../../../shared/ui';
import { CloseIcon } from '../../../../shared/ui/icons';
import {
  useDepartment,
  useDepartmentSearch,
  useSection,
  useSectionSearch,
} from '../api/user-queries';

export interface Placement {
  branchId: string;
  departmentId: string;
  sectionId: string;
}

/** One picked unit, with a way to unpick it. */
const Picked = ({
  label,
  onClear,
  clearLabel,
}: {
  label: string;
  onClear: () => void;
  clearLabel: string;
}): JSX.Element => (
  <div className="flex items-center justify-between gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm dark:border-brand-900 dark:bg-brand-950/40">
    <span className="truncate text-brand-800 dark:text-brand-200">{label}</span>
    <button
      type="button"
      onClick={onClear}
      aria-label={clearLabel}
      title={clearLabel}
      className="rounded-md p-1 text-brand-700 hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
    >
      <CloseIcon className="h-3.5 w-3.5" />
    </button>
  </div>
);

const UnitPicker = ({
  value,
  resolvedName,
  search,
  onSearch,
  results,
  loading,
  onPick,
  onClear,
  placeholder,
  disabledHint,
}: {
  value: string;
  resolvedName: string | undefined;
  /** Controlled by the parent, because the parent is what runs the query it drives. */
  search: string;
  onSearch: (term: string) => void;
  results: { id: string; name: { ar: string; en: string }; code: string }[];
  loading: boolean;
  onPick: (id: string) => void;
  onClear: () => void;
  placeholder: string;
  /** Present = the parent has not been chosen yet, so there is nothing to search within. */
  disabledHint: string | undefined;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);

  if (disabledHint !== undefined) {
    return <p className="text-xs text-slate-400">{disabledHint}</p>;
  }

  return (
    <div className="space-y-2">
      {value !== '' && (
        <Picked
          label={resolvedName ?? t('common.loading')}
          onClear={onClear}
          clearLabel={t('systemAdmin.users.placement.clear')}
        />
      )}
      <SearchInput
        value={search}
        onChange={onSearch}
        aria-label={placeholder}
        placeholder={placeholder}
      />
      {search.trim() !== '' && (
        <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
          {loading ? (
            <div className="grid place-items-center p-3">
              <Spinner />
            </div>
          ) : results.length === 0 ? (
            <p className="p-3 text-sm text-slate-500 dark:text-slate-400">
              {t('systemAdmin.users.placement.noResults')}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {results.map((unit) => (
                <li key={unit.id}>
                  <button
                    type="button"
                    aria-pressed={unit.id === value}
                    onClick={() => {
                      onPick(unit.id);
                      onSearch('');
                    }}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60"
                  >
                    <span className="truncate">{unit.name[locale]}</span>
                    <span className="shrink-0 font-mono text-xs text-slate-500" dir="ltr">
                      {unit.code}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export const OrgPlacementFields = ({
  value,
  onChange,
  branches,
}: {
  value: Placement;
  onChange: (next: Placement) => void;
  branches: OrgUnitOptionDto[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const can = useCan();
  const [departmentTerm, setDepartmentTerm] = useState('');
  const [sectionTerm, setSectionTerm] = useState('');

  const mayReadDepartments = can('department.view');
  const mayReadSections = can('section.view');

  const inOptions = value.branchId === '' || branches.some((b) => b.id === value.branchId);

  const departments = useDepartmentSearch(value.branchId, departmentTerm, mayReadDepartments);
  const sections = useSectionSearch(value.departmentId, sectionTerm, mayReadSections);
  const department = useDepartment(mayReadDepartments ? value.departmentId : '');
  const section = useSection(mayReadSections ? value.sectionId : '');

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Field label={t('systemAdmin.users.fields.branch')} hint={t('systemAdmin.users.form.branchHint')}>
        <Select
          value={value.branchId}
          onChange={(e) =>
            // A new branch invalidates both children — see the file note.
            onChange({ branchId: e.target.value, departmentId: '', sectionId: '' })
          }
        >
          <option value="">{t('systemAdmin.users.form.noBranch')}</option>
          {/* The options endpoint returns ACTIVE branches only. An account placed in a branch that
              has since been deactivated would otherwise show no selection, and saving the form
              would clear a placement nobody touched — so the stored one stays selectable. */}
          {!inOptions && (
            <option value={value.branchId}>{t('systemAdmin.users.placement.inactiveBranch')}</option>
          )}
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name[locale]}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('systemAdmin.users.fields.department')}>
        {mayReadDepartments ? (
          <UnitPicker
            value={value.departmentId}
            resolvedName={department.data?.name[locale]}
            search={departmentTerm}
            onSearch={setDepartmentTerm}
            results={departments.data ?? []}
            loading={departments.isFetching}
            onPick={(id) => onChange({ ...value, departmentId: id, sectionId: '' })}
            onClear={() => onChange({ ...value, departmentId: '', sectionId: '' })}
            placeholder={t('systemAdmin.users.placement.searchDepartment')}
            disabledHint={
              value.branchId === '' ? t('systemAdmin.users.placement.pickBranchFirst') : undefined
            }
          />
        ) : (
          <p className="text-xs text-slate-400">{t('systemAdmin.users.placement.noDepartmentAccess')}</p>
        )}
      </Field>

      <Field label={t('systemAdmin.users.fields.section')}>
        {mayReadSections ? (
          <UnitPicker
            value={value.sectionId}
            resolvedName={section.data?.name[locale]}
            search={sectionTerm}
            onSearch={setSectionTerm}
            results={sections.data ?? []}
            loading={sections.isFetching}
            onPick={(id) => onChange({ ...value, sectionId: id })}
            onClear={() => onChange({ ...value, sectionId: '' })}
            placeholder={t('systemAdmin.users.placement.searchSection')}
            disabledHint={
              value.departmentId === ''
                ? t('systemAdmin.users.placement.pickDepartmentFirst')
                : undefined
            }
          />
        ) : (
          <p className="text-xs text-slate-400">{t('systemAdmin.users.placement.noSectionAccess')}</p>
        )}
      </Field>
    </div>
  );
};
