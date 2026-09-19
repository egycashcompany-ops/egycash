// «الصلاحيات» — what one colleague may do, site by site, as the manager who hands it out sees it.
//
// One block per site. Each block is its own table and its own record on the server (ADR-032): what
// is ticked for one site does not touch another, and saving writes only the sites that changed.
//
// What the manager cannot grant here is DISABLED with the reason on it, in both directions: a key
// outside their ceiling in this site cannot be ticked, and one somebody with more authority ticked
// cannot be cleared by them. The server refuses either anyway; the screen only declines to promise
// what the save would refuse. The rules themselves are pure functions in `delegation-grid` and are
// tested there; this component is the wiring.
import { useEffect, useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../localization/useT';
import { useAppSelector } from '../../../store';
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, LoadingState, toast } from '../../../shared/ui';
import { Checkbox } from '../../../shared/ui/form';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import {
  buildRows,
  defaultSelection,
  pageState,
  sameSelection,
  summarize,
  toggleKey,
  togglePage,
  type GridRow,
} from './delegation-grid';
import { useDelegationCatalog, useSetUserDelegation, useUserDelegations } from './delegation-queries';

type Name = { ar: string; en: string };

export const DelegationPanel = ({
  userId,
  homeBranch,
}: {
  userId: string;
  /** The account's own site, pinned first and never removable from the strip. */
  homeBranch: { id: string; name?: Name } | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const catalog = useDelegationCatalog();
  const grants = useUserDelegations(userId);
  const save = useSetUserDelegation(userId);

  // Drafts hold only what the manager touched; everything else reads the saved table.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [opened, setOpened] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDrafts({});
    setOpened([]);
  }, [userId]);

  const saved = useMemo(
    () => new Map((grants.data?.grants ?? []).map((g) => [g.branch.id, g])),
    [grants.data],
  );

  if (catalog.isLoading || grants.isLoading) return <LoadingState />;
  if (catalog.isError || catalog.data === undefined) {
    return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />;
  }
  if (grants.isError || grants.data === undefined) {
    return <ErrorState error={grants.error} onRetry={() => void grants.refetch()} />;
  }
  const cat = catalog.data;
  const ceilingOf = (branchId: string): Set<string> =>
    new Set(cat.branches.find((b) => b.id === branchId)?.permissionKeys ?? []);
  const nameOf = (branchId: string): string => {
    const name: Name | undefined =
      cat.branches.find((b) => b.id === branchId)?.name ??
      saved.get(branchId)?.branch.name ??
      (homeBranch?.id === branchId ? homeBranch.name : undefined);
    return name === undefined ? branchId : name[locale];
  };
  const savedKeys = (branchId: string): Set<string> => new Set(saved.get(branchId)?.permissionKeys ?? []);
  const draftOf = (branchId: string): Set<string> =>
    new Set(drafts[branchId] ?? savedKeys(branchId));

  const shown = [
    ...new Set([
      ...(homeBranch === null ? [] : [homeBranch.id]),
      ...[...saved.keys()],
      ...opened,
    ]),
  ];
  const addable = cat.branches.filter((b) => !shown.includes(b.id));
  const dirty = shown.filter((id) => !sameSelection(draftOf(id), savedKeys(id)));

  const open = (branchId: string): void => {
    setOpened((cur) => [...cur, branchId]);
    setDrafts((cur) => ({ ...cur, [branchId]: [...defaultSelection(ceilingOf(branchId))] }));
  };
  const remove = (branchId: string): void => {
    setOpened((cur) => cur.filter((id) => id !== branchId));
    setDrafts((cur) => ({ ...cur, [branchId]: [] }));
  };
  const setDraft = (branchId: string, next: Set<string>): void =>
    setDrafts((cur) => ({ ...cur, [branchId]: [...next] }));
  const reset = (): void => {
    setDrafts({});
    setOpened([]);
  };
  const commit = async (): Promise<void> => {
    setSaving(true);
    try {
      for (const branchId of dirty) {
        await save.mutateAsync({ branchId, permissionKeys: [...draftOf(branchId)].sort() });
      }
      reset();
      toast.success(t('delegation.saved'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('delegation.failed'));
    } finally {
      setSaving(false);
    }
  };

  if (cat.branches.length === 0 && saved.size === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('delegation.noReach')}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-2 rounded-full border border-brand-500 bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-300"
          >
            {nameOf(id)}
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {homeBranch?.id === id ? t('delegation.homeTag') : t('delegation.addedTag')}
            </span>
          </span>
        ))}
        {addable.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => open(b.id)}
            className="rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400"
          >
            + {b.name[locale]}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('delegation.intro')}</p>

      {shown.map((id) => {
        const ceiling = ceilingOf(id);
        const rows = buildRows(cat, ceiling, savedKeys(id));
        const selected = draftOf(id);
        const summary = summarize(rows, selected);
        const isHome = homeBranch?.id === id;
        return (
          <Card key={id}>
            <CardHeader
              title={nameOf(id)}
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {summary.actions === 0
                      ? t('delegation.nothing')
                      : summary.everything
                        ? t('delegation.summaryAll', { screens: summary.screens })
                        : t('delegation.summary', { screens: summary.screens, actions: summary.actions })}
                  </span>
                  {dirty.includes(id) && <Badge tone="warning">{t('delegation.unsaved')}</Badge>}
                  {!isHome && ceiling.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => remove(id)}>
                      {t('delegation.remove')}
                    </Button>
                  )}
                </div>
              }
            />
            <CardBody>
              {ceiling.size === 0 && (
                <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{t('delegation.readOnly')}</p>
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('delegation.nothing')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-start text-xs text-slate-500 dark:text-slate-400">
                        <th className="w-2/5 px-2 py-2 text-start font-semibold">{t('delegation.screen')}</th>
                        <th className="px-2 py-2 text-start font-semibold">{t('delegation.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <ScreenRow
                          key={row.page?.id ?? 'other'}
                          row={row}
                          ceiling={ceiling}
                          selected={selected}
                          locale={locale}
                          otherLabel={t('delegation.other')}
                          lockedLabel={t('delegation.locked')}
                          onPage={() => setDraft(id, togglePage(selected, row, ceiling))}
                          onKey={(key) => setDraft(id, toggleKey(selected, key, row, ceiling))}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}

      <div className="flex items-center gap-2">
        <Button size="sm" loading={saving} disabled={dirty.length === 0} onClick={() => void commit()}>
          {t('delegation.save')}
        </Button>
        <Button size="sm" variant="ghost" disabled={dirty.length === 0 || saving} onClick={reset}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
};

const ScreenRow = ({
  row,
  ceiling,
  selected,
  locale,
  otherLabel,
  lockedLabel,
  onPage,
  onKey,
}: {
  row: GridRow;
  ceiling: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  locale: Locale;
  otherLabel: string;
  lockedLabel: string;
  onPage: () => void;
  onKey: (key: string) => void;
}): JSX.Element => {
  const state = pageState(selected, row);
  const grantable = row.keys.some((k) => ceiling.has(k.key));
  return (
    <tr className={cn('border-t border-slate-100 dark:border-slate-800', state === 'none' && 'text-slate-500')}>
      <td className="px-2 py-2 align-top">
        <Checkbox
          label={row.page === null ? otherLabel : row.page.name[locale]}
          checked={state === 'all'}
          indeterminate={state === 'some'}
          disabled={!grantable}
          onChange={onPage}
          className="font-medium"
        />
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {row.keys.map((k) => {
            const locked = !ceiling.has(k.key);
            return (
              <Checkbox
                key={k.key}
                label={k.name[locale]}
                checked={selected.has(k.key)}
                disabled={locked}
                title={locked ? lockedLabel : undefined}
                onChange={() => onKey(k.key)}
                className={cn('text-xs', locked && 'line-through decoration-slate-300 text-slate-400')}
              />
            );
          })}
        </div>
      </td>
    </tr>
  );
};

export default DelegationPanel;
