// WHO THE TECHNICIANS ARE — «الفنى يكون من موظفين الـ IT بس», decided where the help desk is set up.
//
// The technicians are the org chart, not a list IT keeps: every current employee of the departments
// ticked here (`it.technicianDepartmentIds`). A new hire in IT is a technician the day HR files
// them, and a leaver stops being one the day HR records the exit — nobody has to remember either.
//
// The setting is a list of department ids, so this card turns it into department NAMES, each with
// its branch, since a department is one record per branch. An id that is stored but no longer an
// active department is still shown, and can be unticked: a configuration nobody can see is the
// failure the Operations crew card was built to end, and the same card-shaped fix applies here.
//
// It writes at ORGANIZATION scope — the setting is declared organization-only — and needs the
// platform's `setting.edit`, which is what the write itself demands. Without it the card is not
// rendered at all: an unticked box that cannot be saved would be a form that lies.
import { useEffect, useMemo, useState } from 'react';
import { ItSettingKeys, type Locale } from '@ecms/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { useMySettings, useSetSetting } from '../../../platform/settings/settings-api';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { Checkbox } from '../../../shared/ui/form';
import { Badge } from '../../../shared/ui/Badge';
import { toast } from '../../../shared/ui/toast/toast-store';
import { localized } from '../../../shared/lib/format';
import { featureKey } from '../../../shared/lib/query-keys';
import { useItBranchOptions, useItDepartmentOptions } from '../api/it-queries';

/** The setting's value, defended against a shape the server should never send but might. */
const configuredIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/** Same SET, whatever the order: a list the server returned reordered has not changed. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

export const TechnicianDepartmentsCard = (): JSX.Element | null => {
  const t = useT();
  const can = useCan();
  const qc = useQueryClient();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const canEdit = can('setting.edit');

  const settings = useMySettings(canEdit);
  const departments = useItDepartmentOptions(canEdit);
  const branches = useItBranchOptions();
  const save = useSetSetting(() => {
    // Who is offered as a technician changes the moment this does.
    void qc.invalidateQueries({ queryKey: featureKey('it', 'technicians') });
  });

  const stored = configuredIds(
    settings.data?.find((row) => row.key === ItSettingKeys.TechnicianDepartmentIds)?.value,
  );
  const storedSignature = [...stored].sort().join(',');
  const [draft, setDraft] = useState<string[]>(stored);
  const [followed, setFollowed] = useState<string | null>(null);
  // Follow the server once it answers and after every save — keyed on CONTENT, so a refetch that
  // returns the same ids in another order does not throw away a tick in progress.
  useEffect(() => {
    if (followed === storedSignature) return;
    setFollowed(storedSignature);
    setDraft(stored);
  }, [storedSignature, followed, stored]);

  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);

  if (!canEdit) return null;

  const options = departments.data ?? [];
  const known = new Set(options.map((option) => option.id));
  const rows = [
    ...options.map((option) => ({
      id: option.id,
      label: localized(option.name, locale),
      branch: option.parentId === null ? null : (branchName.get(option.parentId) ?? null),
      known: true,
    })),
    // Stored but not an active department any more — shown so it can be unticked.
    ...draft
      .filter((id) => !known.has(id))
      .map((id) => ({ id, label: null, branch: null, known: false })),
  ];
  const toggle = (id: string): void =>
    setDraft((prev) => (prev.includes(id) ? prev.filter((each) => each !== id) : [...prev, id]));

  return (
    <Card>
      <CardHeader title={t('it.technicians.title')} description={t('it.technicians.hint')} />
      <CardBody>
        {departments.isError ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {t('it.technicians.optionsFailed')}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {departments.isLoading ? t('common.loading') : t('it.technicians.none')}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Checkbox
                    label={
                      row.label === null
                        ? t('it.technicians.unknownDepartment')
                        : row.branch === null
                          ? row.label
                          : `${row.label} — ${row.branch}`
                    }
                    checked={draft.includes(row.id)}
                    disabled={save.isPending}
                    onChange={() => toggle(row.id)}
                  />
                  {!row.known && <Badge tone="warning">{t('it.technicians.stale')}</Badge>}
                </div>
              ))}
            </div>
            {draft.length === 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {t('it.technicians.emptyWarning')}
              </p>
            )}
            <div className="flex justify-end">
              <Button
                loading={save.isPending}
                disabled={sameSet(draft, stored)}
                onClick={() =>
                  save.mutate(
                    {
                      key: ItSettingKeys.TechnicianDepartmentIds,
                      scope: 'organization',
                      value: draft,
                    },
                    { onSuccess: () => toast.success(t('it.technicians.saved')) },
                  )
                }
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
