// «موظفو الصراف الآلي — قائمة القائد»: whose names the leader pickers offer — the maintenance close
// (an employee is required) and both kinds' edit dialogs.
//
// The owner (2026-11-01): «تظهر أسماء الموظفين اللى فى ATM في Drop Down القائد في الصيانة والتغذية
// .. وخصوصاً عند تقفيل ماكينات الصيانة». The list is HR's: the working employees of the departments
// ticked here (`atm.maintenanceLeaderDepartmentIds`) — or, while none is ticked, of every active
// department NAMED for ATM, which was the legacy's own rule («الصراف الالى»). The card shows which
// applies, ticks what the list is drawn from right now, counts the people, and saves the ticks.
// «استخدام إدارة الصراف الآلي باسمها» empties the list, which returns to the name rule.
//
// The operations crew card (CrewDepartmentsCard) is the precedent: department NAMES ticked on the
// page whose consequence they are, never ids typed into system settings. The server answers
// `atmSettings.manage` at organization scope, as the page's other cards.
import { useEffect, useState } from 'react';
import { type AtmLeaderDepartmentDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../../store';
import { useT } from '../../../../platform/localization/useT';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Button } from '../../../../shared/ui/Button';
import { Badge } from '../../../../shared/ui/Badge';
import { Checkbox } from '../../../../shared/ui/form';
import { ErrorState } from '../../../../shared/ui/states/ErrorState';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { localized } from '../../../../shared/lib/format';
import { useAtmLeaderDepartments, useSaveAtmLeaderDepartments } from '../../api/settings-queries';

/** Pure: the ids in the list now — ticked, or found by name while none is. */
export const selectedDepartmentIds = (rows: readonly AtmLeaderDepartmentDto[]): string[] =>
  rows.filter((row) => row.selected).map((row) => row.id);

/** Pure: one id added or taken away. */
export const toggleId = (ids: readonly string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];

/** Pure: the same ids, whatever their order. */
export const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export const LeaderDepartmentsCard = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const query = useAtmLeaderDepartments();
  const save = useSaveAtmLeaderDepartments();

  const rows = query.data?.departments ?? [];
  const stored = selectedDepartmentIds(rows);
  const [draft, setDraft] = useState<string[]>(stored);
  // Follow the server once it answers, and after every save — keyed on CONTENT, so a refetch that
  // returns the same ids in another order does not throw away a tick in progress.
  const storedSignature = [...stored].sort().join(',');
  const [followed, setFollowed] = useState<string | null>(null);
  useEffect(() => {
    if (followed === storedSignature) return;
    setFollowed(storedSignature);
    setDraft(stored);
  }, [storedSignature, followed, stored]);

  const write = (departmentIds: string[]): void => {
    save.mutate(
      { departmentIds },
      // A refused save is toasted by the global handler — the save declares no `onError`.
      {
        onSuccess: (saved) => {
          // The ticks become the server's answer, whatever the selection signature: saving none
          // returns to the name rule, which can answer with the same department ticked as before.
          const next = selectedDepartmentIds(saved.departments);
          setFollowed([...next].sort().join(','));
          setDraft(next);
          toast.success(t('atm.settings.leaders.saved'));
        },
      },
    );
  };

  const labelOf = (row: AtmLeaderDepartmentDto): string => {
    if (row.name === null) return t('atm.settings.leaders.unknown');
    const name = localized(row.name, locale);
    return row.branchName === null ? name : `${name} — ${localized(row.branchName, locale)}`;
  };

  return (
    <Card>
      <CardHeader
        title={t('atm.settings.leaders.title')}
        description={t('atm.settings.leaders.hint')}
      />
      <CardBody className="space-y-4">
        {query.isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('atm.settings.leaders.none')}
          </p>
        ) : (
          <>
            {query.data?.source === 'byName' && (
              <p
                className="text-sm text-slate-600 dark:text-slate-300"
                data-leaders-source="byName"
              >
                {t('atm.settings.leaders.byName')}
              </p>
            )}
            {query.data?.source === 'none' && (
              <p className="text-sm text-amber-700 dark:text-amber-400" data-leaders-source="none">
                {t('atm.settings.leaders.noneFound')}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-2"
                  data-leader-department={row.id}
                >
                  <Checkbox
                    label={labelOf(row)}
                    checked={draft.includes(row.id)}
                    disabled={save.isPending}
                    onChange={() => setDraft((prev) => toggleId(prev, row.id))}
                  />
                  <span className="text-xs tabular-nums text-slate-400">
                    {t('atm.settings.leaders.employees', { count: row.employees })}
                  </span>
                  {row.name === null ? (
                    // Stored but not active any more — shown rather than dropped, so it can be
                    // unticked (the crew card's rule).
                    <Badge tone="warning">{t('atm.settings.leaders.stale')}</Badge>
                  ) : (
                    row.matchesName && (
                      <Badge tone="info">{t('atm.settings.leaders.matchesName')}</Badge>
                    )
                  )}
                </div>
              ))}
            </div>
            {draft.length === 0 && (
              // Saving none is not «nobody»: it returns to the ATM department found by its name.
              <p
                className="text-xs text-amber-700 dark:text-amber-400"
                data-leaders-empty-warning="true"
              >
                {t('atm.settings.leaders.emptyWarning')}
              </p>
            )}
            <p className="text-sm text-slate-600 dark:text-slate-300" data-leaders-count="true">
              {t('atm.settings.leaders.count', { count: query.data?.employees ?? 0 })}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              {query.data?.source === 'configured' && (
                <Button variant="ghost" disabled={save.isPending} onClick={() => write([])}>
                  {t('atm.settings.leaders.reset')}
                </Button>
              )}
              <Button
                loading={save.isPending}
                disabled={sameIds(draft, stored)}
                onClick={() => write(draft)}
              >
                {t('common.save')}
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
};
