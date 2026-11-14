// WHO IS OPERATIONS CREW — configured on «إدارات العمليات», a screen of its own (Round 14).
//
// The setting (`operations.crewDepartmentIds`) has existed since the roster became the org chart,
// but only as a list of ObjectIds typed into system settings. It went unset, and unset means the
// roster falls back to whoever already holds a requirements row: an employee configured long ago
// still appeared while two new hires in the same department did not. The reported symptom was
// "قائد الطاقم والأخصائي لا يظهران، والسواق يظهر" — which is not a job-title rule anywhere in the
// code, it is a stale list versus a derived one. So the card is not a convenience; it is the fix.
//
// ONE CHOICE PER COMPANY DEPARTMENT. The first version ticked org units, and a department is one
// unit per branch, so the owner read «نقل الاموال» seven times and «العمليات» six: «القائمة دي كانت
// معمولة لما كان في مشكلة في الإدارات، وأنت عامل تكرار إدارات … على حسب الفروع. فإحنا عايزين نعدل
// الموضوع ده، وعايزين نحسن اليو اي بتاعها». Each department is now offered once, with how many
// branches have it and which; the server reads a chosen department in every branch, a branch that
// adds it later included (lib/crew-departments.ts here, crew/crew-departments.ts on the server).
//
// A SCREEN OF ITS OWN (Round 14): «انا عاوز افصل ان احدد اداره معايا ولا لا عن تجهيز الطاقم», and
// asked where, «شاشة لوحدها في القائمة». Round 15 had folded the card shut on «كشف الأطقم» («عاوز
// أخليها تبقى الديفولت بتاعها إن هي مخفية») because it sat above the roster and was in the way; on
// «إدارات العمليات» (`pages/CrewDepartmentsPage.tsx`) it IS the page, so it is simply open — there is
// nothing for it to be in the way of, and a fold the reader must open on every visit to the one
// thing the screen does would be a click for nothing. Its look is round 15's: one tile per company
// department, the search, «تراجع» / «حفظ» and the count under them; the page title names it, and
// «تغييرات غير محفوظة» sits by «حفظ», where the eye is when it matters.
//
// It writes at ORGANIZATION scope because the setting is declared organization-only — who works in
// Operations is one fact about the company, not a per-branch opinion.
import { useEffect, useMemo, useState } from 'react';
import { OperationsSettingKeys, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { useMySettings } from '../../../platform/settings/settings-api';
import {
  useBranchNames,
  useDepartmentNames,
  useDepartmentReferenceOptions,
} from '../../organization/shared/references';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { BuildingIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useSetOperationsSetting } from '../api/operations-queries';
import {
  choiceMatches,
  crewDepartmentChoices,
  crewDepartmentPayload,
  sameChoices,
  savedChoiceKeys,
  toggleChoice,
  type CrewDepartmentChoice,
} from '../lib/crew-departments';

/** The setting's value, defended against a shape the server should never send but might. */
const configuredIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

export const CrewDepartmentsCard = (): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canEdit = can('setting.edit');

  // None of these requests is made for somebody who cannot write the setting: this card is the
  // only reader here, and it renders nothing without `setting.edit`.
  const settings = useMySettings(canEdit);
  const options = useDepartmentReferenceOptions(canEdit);
  const allDepartments = useDepartmentNames(canEdit);
  const branches = useBranchNames(canEdit);
  const save = useSetOperationsSetting();

  const storedValue = settings.data?.find(
    (row) => row.key === OperationsSettingKeys.CrewDepartmentIds,
  )?.value;
  // Keyed on CONTENT: a refetch that returns the same ids is the same configuration, and must not
  // rebuild the choices (or the draft that follows them) underneath a tick in progress.
  const storedSignature = configuredIds(storedValue).sort().join(',');
  const stored = useMemo(
    () => (storedSignature === '' ? [] : storedSignature.split(',')),
    [storedSignature],
  );

  const branchNames = useMemo(
    () => new Map((branches.data ?? []).map((branch) => [branch.id, branch.name])),
    [branches.data],
  );
  const choices = useMemo(
    () =>
      crewDepartmentChoices({
        active: options.data ?? [],
        all: allDepartments.data,
        branchNames,
        storedIds: stored,
        locale,
      }),
    [options.data, allDepartments.data, branchNames, stored, locale],
  );
  const savedKeys = useMemo(() => savedChoiceKeys(choices, stored), [choices, stored]);

  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string[]>(savedKeys);
  // Follow the server once it answers, and after every save — keyed on CONTENT, so a refetch that
  // returns the same departments in another order does not throw away a tick in progress.
  const savedSignature = [...savedKeys].sort().join('|');
  const [followed, setFollowed] = useState<string | null>(null);
  useEffect(() => {
    if (followed === savedSignature) return;
    setFollowed(savedSignature);
    setDraft(savedKeys);
  }, [savedSignature, followed, savedKeys]);

  // Nothing to offer somebody who cannot change it; the page still explains the state below.
  if (!canEdit) return null;

  const loading =
    options.isLoading || allDepartments.isLoading || branches.isLoading || settings.isLoading;
  // Either read failing leaves the card unable to say what is chosen. The setting unread is not
  // "nothing chosen" (and a save from there would overwrite what is saved without anyone seeing
  // it), and the departments unread would turn every saved one into «إدارة لم تعد نشطة». So the
  // card says it could not load, and offers nothing to save. A failed REFETCH keeps what was read
  // before, which is still the truth as far as anyone knows — not a failure.
  const failed = options.isLoadingError || settings.isLoadingError;

  const submit = (): void => {
    save.mutate(
      {
        key: OperationsSettingKeys.CrewDepartmentIds,
        scope: 'organization',
        value: crewDepartmentPayload(choices, draft, stored),
      },
      { onSuccess: () => toast.success(t('operations.crew.departments.saved')) },
    );
  };

  return (
    <Card className="overflow-hidden">
      <CrewDepartmentsPanel
        label={t('operations.crew.departments.title')}
        state={failed ? 'failed' : loading ? 'loading' : 'ready'}
        choices={choices}
        draft={draft}
        savedKeys={savedKeys}
        search={search}
        onSearch={setSearch}
        onToggleChoice={(key) => setDraft((prev) => toggleChoice(prev, key))}
        onDiscard={() => setDraft(savedKeys)}
        onSave={submit}
        saving={save.isPending}
      />
    </Card>
  );
};

const useChoiceLabel = (): ((choice: CrewDepartmentChoice) => string) => {
  const t = useT();
  return (choice) => choice.label ?? t('operations.crew.departments.unknownDepartment');
};

/** The card's body: what it is for, the search, one tile per department, and «تراجع» / «حفظ». */
export const CrewDepartmentsPanel = ({
  label,
  state,
  choices,
  draft,
  savedKeys,
  search,
  onSearch,
  onToggleChoice,
  onDiscard,
  onSave,
  saving,
}: {
  /** The region's accessible name — the page's title. */
  label: string;
  /**
   * `loading` until the inactive departments and the branch names are in as well: a tile that
   * re-groups or renames itself under the pointer would be worse than a short wait.
   */
  state: 'loading' | 'failed' | 'ready';
  choices: readonly CrewDepartmentChoice[];
  draft: readonly string[];
  savedKeys: readonly string[];
  search: string;
  onSearch: (value: string) => void;
  onToggleChoice: (key: string) => void;
  onDiscard: () => void;
  onSave: () => void;
  saving: boolean;
}): JSX.Element => {
  const t = useT();
  const labelOf = useChoiceLabel();
  const dirty = !sameChoices(draft, savedKeys);
  const shown = choices.filter((choice) => choiceMatches(choice, search));

  return (
    <div
      role="region"
      aria-label={label}
      data-crew-departments="true"
      className="space-y-4 px-4 py-4 sm:px-5"
    >
      <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
        {t('operations.crew.departments.hint')}
      </p>
      {state === 'failed' ? (
        // The picker cannot be built without the department list, and inventing an empty one
        // would read as "there are no departments" — which would be a lie about the org chart.
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {t('operations.crew.departments.optionsFailed')}
        </p>
      ) : state === 'loading' || choices.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {state === 'loading' ? t('common.loading') : t('operations.crew.departments.none')}
        </p>
      ) : (
        <>
          <SearchInput
            value={search}
            onChange={onSearch}
            debounceMs={0}
            placeholder={t('operations.crew.departments.search')}
            className="sm:max-w-sm"
          />
          {shown.length === 0 ? (
            <p className="py-2 text-sm text-slate-500 dark:text-slate-400">
              {t('operations.crew.departments.noMatch')}
            </p>
          ) : (
            // `grid-cols-1` on a phone, not the implicit column: an implicit track is sized by the
            // tile's one-line branch list and pushed the page 234px past a 390px screen.
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {shown.map((choice) => (
                <li key={choice.key} className="min-w-0">
                  <ChoiceTile
                    choice={choice}
                    label={labelOf(choice)}
                    checked={draft.includes(choice.key)}
                    disabled={saving}
                    onToggle={() => onToggleChoice(choice.key)}
                  />
                </li>
              ))}
            </ul>
          )}
          {draft.length === 0 && (
            <p
              className="text-xs text-amber-700 dark:text-amber-400"
              data-crew-departments-empty="true"
            >
              {t('operations.crew.departments.emptyWarning')}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {t('operations.crew.departments.chosenCount', { count: draft.length })}
              </span>
              {dirty && (
                // Beside «حفظ», where the eye is when it matters — the tiles already show the ticks.
                <span data-crew-departments-unsaved="true">
                  <Badge tone="warning" size="sm">
                    {t('operations.crew.departments.unsaved')}
                  </Badge>
                </span>
              )}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={!dirty || saving}
                onClick={onDiscard}
                data-crew-departments-discard="true"
              >
                {t('operations.crew.departments.discard')}
              </Button>
              <Button
                size="sm"
                loading={saving}
                disabled={!dirty}
                onClick={onSave}
                data-crew-departments-save="true"
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

/** One department: its name, the branches that have it, and the tick. */
const ChoiceTile = ({
  choice,
  label,
  checked,
  disabled,
  onToggle,
}: {
  choice: CrewDepartmentChoice;
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}): JSX.Element => {
  const t = useT();
  const branchList = choice.branches.map(
    (branch) => branch.name ?? t('operations.crew.departments.unnamedBranch'),
  );
  return (
    <label
      // Every branch, on hover — the line under the name is cut to one row on a narrow tile.
      title={branchList.join(' · ')}
      data-crew-department={choice.key}
      className={cn(
        'flex h-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors',
        checked
          ? 'border-brand-400 bg-brand-50/70 dark:border-brand-600 dark:bg-brand-950/50'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600 dark:hover:bg-slate-800/60',
        disabled && 'cursor-not-allowed opacity-70',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800"
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {label}
          </span>
          {choice.state === 'inactive' && (
            <Badge tone="warning" size="sm">
              {t('operations.crew.departments.inactive')}
            </Badge>
          )}
          {choice.state === 'unknown' && (
            // Stored but answered by nothing any more. Shown rather than dropped, because a
            // configuration you cannot see is the bug this card was built to end.
            <Badge tone="warning" size="sm">
              {t('operations.crew.departments.stale')}
            </Badge>
          )}
        </span>
        {branchList.length > 0 && (
          <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
            {branchList.join(' · ')}
          </span>
        )}
      </span>
      {choice.state !== 'unknown' && (
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          title={t('operations.crew.departments.branches', { count: choice.branches.length })}
        >
          <BuildingIcon className="h-3 w-3" />
          <span aria-hidden="true">{choice.branches.length}</span>
          <span className="sr-only">
            {t('operations.crew.departments.branches', { count: choice.branches.length })}
          </span>
        </span>
      )}
    </label>
  );
};
