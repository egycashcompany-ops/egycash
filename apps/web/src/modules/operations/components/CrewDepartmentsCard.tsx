// WHO IS OPERATIONS CREW — configured on the screen where its absence is noticed.
//
// The setting (`operations.crewDepartmentIds`) has existed since the roster became the org chart,
// but only as a list of ObjectIds typed into system settings. It went unset, and unset means the
// roster falls back to whoever already holds a requirements row: an employee configured long ago
// still appeared while two new hires in the same department did not. The reported symptom was
// "قائد الطاقم والأخصائي لا يظهران، والسواق يظهر" — which is not a job-title rule anywhere in the
// code, it is a stale list versus a derived one.
//
// So the card is not a convenience. It is the fix: department NAMES, ticked here, on the page that
// shows the consequence.
//
// It writes at ORGANIZATION scope because the setting is declared organization-only — who works in
// Operations is one fact about the company, not a per-branch opinion.
import { useEffect, useState } from 'react';
import { OperationsSettingKeys, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { useMySettings } from '../../../platform/settings/settings-api';
import { useDepartmentReferenceOptions } from '../../organization/shared/references';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Checkbox } from '../../../shared/ui/form';
import { Badge } from '../../../shared/ui/Badge';
import { toast } from '../../../shared/ui/toast/toast-store';
import { useSetOperationsSetting } from '../api/operations-queries';
import { departmentChoices, sameDepartments, toggleDepartment } from '../lib/crew-departments';

/** The setting's value, defended against a shape the server should never send but might. */
const configuredIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

export const CrewDepartmentsCard = (): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canEdit = can('setting.edit');

  // Neither request is made for somebody who cannot write the setting: this card is the only
  // reader of both, and it renders nothing without `setting.edit`.
  const settings = useMySettings(canEdit);
  const options = useDepartmentReferenceOptions(canEdit);
  const save = useSetOperationsSetting();

  const stored = configuredIds(
    settings.data?.find((row) => row.key === OperationsSettingKeys.CrewDepartmentIds)?.value,
  );
  const [draft, setDraft] = useState<string[]>(stored);
  // Follow the server once it answers, and after every save — but keyed on CONTENT, so a refetch
  // that returns the same ids in another order does not throw away a tick in progress.
  const storedSignature = [...stored].sort().join(',');
  const [followed, setFollowed] = useState<string | null>(null);
  useEffect(() => {
    if (followed === storedSignature) return;
    setFollowed(storedSignature);
    setDraft(stored);
  }, [storedSignature, followed, stored]);

  // Nothing to offer somebody who cannot change it; the page still explains the state above.
  if (!canEdit) return null;

  const rows = departmentChoices(options.data ?? [], draft, locale);
  const dirty = !sameDepartments(draft, stored);

  const submit = (): void => {
    save.mutate(
      {
        key: OperationsSettingKeys.CrewDepartmentIds,
        scope: 'organization',
        value: draft,
      },
      { onSuccess: () => toast.success(t('operations.crew.departments.saved')) },
    );
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title={t('operations.crew.departments.title')}
        description={t('operations.crew.departments.hint')}
      />
      <CardBody>
        {options.isError ? (
          // The picker cannot be built without the department list, and inventing an empty one
          // would read as "there are no departments" — which would be a lie about the org chart.
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {t('operations.crew.departments.optionsFailed')}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {options.isLoading ? t('common.loading') : t('operations.crew.departments.none')}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Checkbox
                    label={row.label ?? t('operations.crew.departments.unknownDepartment')}
                    checked={row.selected}
                    disabled={save.isPending}
                    onChange={() => setDraft((prev) => toggleDepartment(prev, row.id))}
                  />
                  {row.known ? (
                    row.code !== null && (
                      <span className="text-xs tabular-nums text-slate-400" dir="ltr">
                        {row.code}
                      </span>
                    )
                  ) : (
                    // Stored but not active any more. Shown rather than dropped, because a
                    // configuration you cannot see is the bug this card was built to end.
                    <Badge tone="warning">{t('operations.crew.departments.stale')}</Badge>
                  )}
                </div>
              ))}
            </div>
            {draft.length === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('operations.crew.departments.emptyWarning')}
              </p>
            )}
            <div className="flex justify-end">
              <Button loading={save.isPending} disabled={!dirty} onClick={submit}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
