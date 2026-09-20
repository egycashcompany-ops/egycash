// «الصلاحيات» — what one colleague may do, unit by unit, as the manager who hands it out sees it.
//
// A unit is one department in one branch («الحركة · المهندسين»), or — from a manager who holds the
// whole branch — the branch as a whole. One block per unit; each block is its own table and its
// own record on the server (ADR-032, Gap 1): what is ticked for one unit does not touch another,
// and saving writes only the units that changed.
//
// What the manager cannot grant here is DISABLED with the reason on it, in both directions: a key
// outside their ceiling for this unit cannot be ticked, and one somebody with more authority
// ticked cannot be cleared by them. The server refuses either anyway; the screen only declines to
// promise what the save would refuse. The rules are pure functions in `delegation-grid`; this
// component is the wiring.
import { useEffect, useMemo, useState } from 'react';
import { type DelegationCatalogDto, type Locale } from '@ecms/contracts';
import { useT } from '../../localization/useT';
import { useAppSelector } from '../../../store';
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, LoadingState, toast } from '../../../shared/ui';
import { Checkbox, Select } from '../../../shared/ui/form';
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

/** One department in one branch, or (`departmentId: null`) the whole branch. */
export interface Unit {
  branchId: string;
  departmentId: string | null;
}
const unitKey = (u: Unit): string => `${u.branchId}:${u.departmentId ?? '*'}`;
const parseUnit = (key: string): Unit => {
  const [branchId = '', dept = '*'] = key.split(':');
  return { branchId, departmentId: dept === '*' ? null : dept };
};

/** The keys the caller may hand out over a unit: the branch's whole-branch keys plus the department's own. */
const ceilingOf = (cat: DelegationCatalogDto, unit: Unit): Set<string> => {
  const branch = cat.branches.find((b) => b.id === unit.branchId);
  if (branch === undefined) return new Set();
  const own = unit.departmentId === null ? [] : (branch.departments.find((d) => d.id === unit.departmentId)?.permissionKeys ?? []);
  // A department the catalog does not list under this branch is not one the caller delegates in,
  // even when the branch itself is: the whole-branch keys apply only to units the catalog offers.
  const offered = unit.departmentId === null || branch.departments.some((d) => d.id === unit.departmentId);
  return new Set(offered ? [...branch.permissionKeys, ...own] : []);
};

export const DelegationPanel = ({
  userId,
  homeUnit,
}: {
  userId: string;
  /** The account's own unit — its department in its branch, or its branch — pinned first. */
  homeUnit: (Unit & { branchName?: Name; departmentName?: Name }) | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const catalog = useDelegationCatalog();
  const grants = useUserDelegations(userId);
  const save = useSetUserDelegation(userId);

  // Drafts hold only what the manager touched; everything else reads the saved table.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [opened, setOpened] = useState<string[]>([]);
  const [pickBranch, setPickBranch] = useState('');
  const [pickDepartment, setPickDepartment] = useState('*');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDrafts({});
    setOpened([]);
  }, [userId]);

  const saved = useMemo(
    () =>
      new Map(
        (grants.data?.grants ?? []).map((g) => [
          unitKey({ branchId: g.branch.id, departmentId: g.department?.id ?? null }),
          g,
        ]),
      ),
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
  const nameOf = (key: string): string => {
    const unit = parseUnit(key);
    const branch = cat.branches.find((b) => b.id === unit.branchId);
    const grant = saved.get(key);
    const branchName: Name | undefined =
      branch?.name ?? grant?.branch.name ?? (homeUnit?.branchId === unit.branchId ? homeUnit.branchName : undefined);
    const b = branchName === undefined ? unit.branchId : branchName[locale];
    if (unit.departmentId === null) return `${b} · ${t('delegation.wholeBranch')}`;
    const departmentName: Name | undefined =
      branch?.departments.find((d) => d.id === unit.departmentId)?.name ??
      grant?.department?.name ??
      (homeUnit?.departmentId === unit.departmentId ? homeUnit.departmentName : undefined);
    return `${departmentName === undefined ? unit.departmentId : departmentName[locale]} · ${b}`;
  };
  const savedKeys = (key: string): Set<string> => new Set(saved.get(key)?.permissionKeys ?? []);
  const draftOf = (key: string): Set<string> => new Set(drafts[key] ?? savedKeys(key));

  const homeKey = homeUnit === null ? null : unitKey(homeUnit);
  const shown = [...new Set([...(homeKey === null ? [] : [homeKey]), ...saved.keys(), ...opened])];
  const dirty = shown.filter((key) => !sameSelection(draftOf(key), savedKeys(key)));

  // The picker offers what the catalog offers and the strip does not yet show.
  const pickable = cat.branches.map((b) => ({
    branch: b,
    units: [
      ...(b.permissionKeys.length > 0 ? [{ departmentId: null as string | null, label: t('delegation.wholeBranch') }] : []),
      ...b.departments.map((d) => ({ departmentId: d.id as string | null, label: d.name[locale] })),
    ].filter((u) => !shown.includes(unitKey({ branchId: b.id, departmentId: u.departmentId }))),
  })).filter((p) => p.units.length > 0);
  const picked = pickable.find((p) => p.branch.id === pickBranch) ?? pickable[0];
  const pickedUnit = picked === undefined ? null : (picked.units.find((u) => (u.departmentId ?? '*') === pickDepartment) ?? picked.units[0] ?? null);

  const open = (): void => {
    if (picked === undefined || pickedUnit === null) return;
    const unit = { branchId: picked.branch.id, departmentId: pickedUnit.departmentId };
    const key = unitKey(unit);
    setOpened((cur) => [...cur, key]);
    setDrafts((cur) => ({ ...cur, [key]: [...defaultSelection(ceilingOf(cat, unit))] }));
    setPickDepartment('*');
  };
  const remove = (key: string): void => {
    setOpened((cur) => cur.filter((k) => k !== key));
    setDrafts((cur) => ({ ...cur, [key]: [] }));
  };
  const setDraft = (key: string, next: Set<string>): void =>
    setDrafts((cur) => ({ ...cur, [key]: [...next] }));
  const reset = (): void => {
    setDrafts({});
    setOpened([]);
  };
  const commit = async (): Promise<void> => {
    setSaving(true);
    try {
      for (const key of dirty) {
        const unit = parseUnit(key);
        await save.mutateAsync({ ...unit, permissionKeys: [...draftOf(key)].sort() });
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
        {shown.map((key) => (
          <span
            key={key}
            className="inline-flex items-center gap-2 rounded-full border border-brand-500 bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-300"
          >
            {nameOf(key)}
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
              {homeKey === key ? t('delegation.homeTag') : t('delegation.addedTag')}
            </span>
          </span>
        ))}
        {picked !== undefined && pickedUnit !== null && (
          <span className="inline-flex items-center gap-1">
            <Select
              aria-label={t('delegation.pickBranch')}
              value={picked.branch.id}
              onChange={(e) => {
                setPickBranch(e.target.value);
                setPickDepartment('*');
              }}
            >
              {pickable.map((p) => (
                <option key={p.branch.id} value={p.branch.id}>
                  {p.branch.name[locale]}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('delegation.pickDepartment')}
              value={pickedUnit.departmentId ?? '*'}
              onChange={(e) => setPickDepartment(e.target.value)}
            >
              {picked.units.map((u) => (
                <option key={u.departmentId ?? '*'} value={u.departmentId ?? '*'}>
                  {u.label}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="ghost" onClick={open}>
              {t('delegation.addUnit')}
            </Button>
          </span>
        )}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('delegation.intro')}</p>

      {shown.map((key) => {
        const unit = parseUnit(key);
        const ceiling = ceilingOf(cat, unit);
        const rows = buildRows(cat, ceiling, savedKeys(key));
        const selected = draftOf(key);
        const summary = summarize(rows, selected);
        const isHome = homeKey === key;
        return (
          <Card key={key}>
            <CardHeader
              title={nameOf(key)}
              actions={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {summary.actions === 0
                      ? t('delegation.nothing')
                      : summary.everything
                        ? t('delegation.summaryAll', { screens: summary.screens })
                        : t('delegation.summary', { screens: summary.screens, actions: summary.actions })}
                  </span>
                  {dirty.includes(key) && <Badge tone="warning">{t('delegation.unsaved')}</Badge>}
                  {!isHome && ceiling.size > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => remove(key)}>
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
                          onPage={() => setDraft(key, togglePage(selected, row, ceiling))}
                          onKey={(k) => setDraft(key, toggleKey(selected, k, row, ceiling))}
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
