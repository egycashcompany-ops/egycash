// «الصلاحيات» — one person, walked down: his branches, the departments inside each, the screens
// inside each department, and the actions on each screen.
//
// The panel this replaced asked the manager to name a unit in two dropdowns before it would show
// him anything, then drew one seventy-row table per unit he named. Nothing about the records
// changed — same per-unit PUT, same server rules (ADR-032, Gap 1) — only the order the questions
// are asked in, which is the order the owner asks them in: who, then where, then what.
//
// What the manager cannot grant is shown and DISABLED with the reason on it, in both directions: a
// key outside his ceiling for a unit cannot be ticked, and one somebody with more authority ticked
// cannot be cleared by him — not by the action, not by the screen box, not by «شيل الكل», not by
// clearing the whole branch. The server refuses either anyway; the screen only declines to promise
// what the save would refuse. Every rule is a pure function in `delegation-tree`; this file is the
// wiring and the disclosure state.
import { useEffect, useMemo, useState } from 'react';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../localization/useT';
import { useAppSelector } from '../../../store';
import { Badge, Button, Card, CardBody, ErrorState, LoadingState, toast } from '../../../shared/ui';
import { Checkbox } from '../../../shared/ui/form';
import { ChevronIcon, LockIcon } from '../../../shared/ui/icons';
import { ApiError } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { sameSelection, toggleKey, togglePage, type GridRow } from './delegation-grid';
import {
  buildTree,
  clearBranch,
  clearableIn,
  grantLines,
  parseUnit,
  setAll,
  unitKey,
  withSavedUnits,
  type BranchNode,
  type DepartmentNode,
  type HomeUnit,
  type GrantLine,
  type ScreenNode,
  type TickState,
  type Unit,
  type UnitNode,
} from './delegation-tree';
import { useDelegationCatalog, useSetUserDelegation, useUserDelegations } from './delegation-queries';

export type { Unit } from './delegation-tree';

type T = (key: string, params?: Record<string, string | number>) => string;

/** What every level needs to draw itself and report a tick back. */
interface Wiring {
  t: T;
  locale: Locale;
  /** `byDefault` is what a level that has not been touched shows — see `setOpen`. */
  isOpen: (id: string, byDefault?: boolean) => boolean;
  setOpen: (id: string, open: boolean) => void;
  setDraft: (unit: Unit, keys: ReadonlySet<string>) => void;
  setDrafts: (drafts: Record<string, string[]>) => void;
  /** Drop drafts entirely, so those units read their saved records again. */
  clearDrafts: (units: readonly Unit[]) => void;
  isDirty: (unit: Unit) => boolean;
  homeKey: string | null;
}

const homeOpen = (branchId: string | null, departmentId: string | null): string[] =>
  branchId === null
    ? []
    : [`b:${branchId}`, ...(departmentId === null ? [] : [`d:${branchId}:${departmentId}`])];

export const DelegationPanel = ({
  userId,
  homeUnit,
  personName,
}: {
  userId: string;
  /** The account's own unit — its department in its branch, or its branch — pinned and tagged. */
  homeUnit: HomeUnit | null;
  /** Whose permissions these are, for the summary. The panel works without it. */
  personName?: string;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const catalog = useDelegationCatalog();
  const grants = useUserDelegations(userId);
  const save = useSetUserDelegation(userId);

  // Drafts hold only what the manager touched; every other unit reads its saved record.
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const homeBranch = homeUnit?.branchId ?? null;
  const homeDepartment = homeUnit?.departmentId ?? null;
  // The person's own unit is the one being asked about nine times in ten, so it starts open — in
  // the initial state rather than in an effect, so the first paint is already the open tree.
  //
  // Two sets rather than one, because some levels are open until told otherwise: a module group
  // holding something ticked must not hide it. An id in neither set shows its own default, and a
  // level the manager actually clicked stays where he put it even when the data around it changes.
  const [open, setOpen] = useState<string[]>(() => homeOpen(homeBranch, homeDepartment));
  const [closed, setClosed] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Deliberately keyed on the PERSON alone. `homeUnit` comes from the parent's own query, so
  // including it would discard a manager's unsaved work the moment that query returned a changed
  // placement — or filled in a department that first arrived as null. Both mounts have the record
  // before they render the panel, so there is nothing to wait for.
  useEffect(() => {
    setDrafts({});
    setOpen(homeOpen(homeBranch, homeDepartment));
    setClosed([]);
  }, [userId]);

  const saved = useMemo(
    () =>
      new Map(
        (grants.data?.grants ?? []).map((g) => [
          unitKey({ branchId: g.branch.id, departmentId: g.department?.id ?? null }),
          g.permissionKeys,
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

  // Units the caller cannot delegate in are folded in read-only rather than hidden: a grant that
  // vanishes because the reader lost the authority to change it reads as a grant that was removed.
  const merged = withSavedUnits(catalog.data, grants.data.grants, homeUnit);
  const savedOf = (unit: Unit): Set<string> => new Set(saved.get(unitKey(unit)) ?? []);
  const selectedOf = (unit: Unit): Set<string> => {
    const draft = drafts[unitKey(unit)];
    return draft === undefined ? savedOf(unit) : new Set(draft);
  };
  const tree = buildTree(merged.catalog, selectedOf, savedOf, merged.readOnly);
  // Only units the tree actually draws. A draft for a unit that has since left the catalog — the
  // department was deleted, or a refetch narrowed the caller's own reach — would otherwise be
  // counted in the footer, drawn nowhere, and PUT on save, where the server refuses it and takes
  // the rest of the save down with it.
  const drawn = new Set(
    tree.flatMap((b) => [unitKey(b.whole.unit), ...b.departments.map((d) => unitKey(d.unit))]),
  );
  const dirty = Object.keys(drafts).filter(
    (key) => drawn.has(key) && !sameSelection(new Set(drafts[key] ?? []), savedOf(parseUnit(key))),
  );

  const wiring: Wiring = {
    t,
    locale,
    isOpen: (id, byDefault = false) =>
      closed.includes(id) ? false : open.includes(id) ? true : byDefault,
    setOpen: (id, next) => {
      setOpen((cur) => (next ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id)));
      setClosed((cur) => (next ? cur.filter((x) => x !== id) : [...cur.filter((x) => x !== id), id]));
    },
    setDraft: (unit, keys) => setDrafts((cur) => ({ ...cur, [unitKey(unit)]: [...keys].sort() })),
    setDrafts: (next) => setDrafts((cur) => ({ ...cur, ...next })),
    clearDrafts: (units) =>
      setDrafts((cur) => {
        const drop = new Set(units.map(unitKey));
        return Object.fromEntries(Object.entries(cur).filter(([key]) => !drop.has(key)));
      }),
    isDirty: (unit) => dirty.includes(unitKey(unit)),
    homeKey: homeUnit === null ? null : unitKey(homeUnit),
  };

  const reset = (): void => setDrafts({});
  const commit = async (): Promise<void> => {
    setSaving(true);
    const written = [...dirty];
    try {
      for (const key of dirty) {
        await save.mutateAsync({ ...parseUnit(key), permissionKeys: [...(drafts[key] ?? [])].sort() });
      }
      // Only the units this save actually wrote. Clearing the whole map would silently discard an
      // edit the manager made while the requests were in flight, under a «saved» toast.
      setDrafts((cur) => Object.fromEntries(Object.entries(cur).filter(([k]) => !written.includes(k))));
      toast.success(t('delegation.saved'));
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t('delegation.failed'));
    } finally {
      setSaving(false);
    }
  };

  // Nothing to delegate and nothing already delegated: the panel has no question to ask. A unit
  // the caller cannot grant in is NOT this case — that one renders, read-only, with its reason.
  if (catalog.data.branches.length === 0 && grants.data.grants.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('delegation.noReach')}</p>
        </CardBody>
      </Card>
    );
  }

  const lines = grantLines(tree);
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{t('delegation.treeIntro')}</p>

      <div className="space-y-3">
        {tree.map((branch) => (
          <BranchCard key={branch.id} branch={branch} w={wiring} />
        ))}
      </div>

      <Card>
        <CardBody className="space-y-2">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {personName === undefined ? t('delegation.willSee') : t('delegation.willSeeNamed', { name: personName })}
          </h4>
          {lines.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('delegation.noneYet')}</p>
          ) : (
            <ul className="list-disc space-y-1 text-sm text-slate-700 ps-5 dark:text-slate-200">
              {lines.map((line) => (
                <li key={unitKey(line.unit)}>
                  {line.department === null
                    ? t('delegation.lineWholeBranch', { branch: line.branch[locale] })
                    : summaryLine(t, line, locale)}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="flex items-center gap-2">
        <Button size="sm" loading={saving} disabled={dirty.length === 0} onClick={() => void commit()}>
          {t('delegation.save')}
        </Button>
        <Button size="sm" variant="ghost" disabled={dirty.length === 0 || saving} onClick={reset}>
          {t('common.cancel')}
        </Button>
        {dirty.length > 0 && <Badge tone="warning">{t('delegation.unsavedUnits', { count: dirty.length })}</Badge>}
      </div>
    </div>
  );
};

// ── The levels ──────────────────────────────────────────────────────────────

/**
 * A branch — a heading, and deliberately NOT a checkbox.
 *
 * There is no record for «a branch» apart from the whole-branch grant inside it, so a tri-state box
 * here would have nothing to write. Worse, it would lie in both directions: a half-ticked box means
 * «tick the rest» everywhere else in this app and on every other screen the reader has ever used,
 * while the only thing this level can do is take away — and a branch whose only grant came from
 * somebody with more authority would draw a checked, enabled box that does nothing at all when
 * clicked. So the state is shown, the count is shown, and taking it all away is a button that says
 * what it does and appears only when there is something the caller may actually remove.
 */
const BranchCard = ({ branch, w }: { branch: BranchNode; w: Wiring }): JSX.Element => {
  const id = `b:${branch.id}`;
  const open = w.isOpen(id);
  const count = branch.whole.actionsOn > 0
    ? w.t('delegation.wholeBranch')
    : branch.departmentsOn > 0
      ? w.t('delegation.departmentsOn', { on: branch.departmentsOn, total: branch.departmentsTotal })
      : w.t('delegation.departments', { count: branch.departmentsTotal });
  const clearable = clearableIn(branch);
  return (
    <Card>
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3',
          branch.state !== 'none' && 'bg-brand-50/60 dark:bg-brand-950/30',
        )}
      >
        <StateMark state={branch.state} />
        <h3 className="min-w-0 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
          {branch.name[w.locale]}
        </h3>
        <span className="truncate text-xs text-slate-500 dark:text-slate-400">{count}</span>
        {clearable > 0 && (
          <Button size="sm" variant="ghost" onClick={() => w.setDrafts(clearBranch(branch))}>
            {w.t('delegation.clearBranch')}
          </Button>
        )}
        <Disclosure id={id} open={open} w={w} className="ms-auto" />
      </div>
      {open && (
        <div id={panelId(id)} className="space-y-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          <WholeBranchBlock branch={branch} w={w} />
          {branch.departments.map((department) => (
            <DepartmentRow key={department.id} branch={branch} department={department} w={w} />
          ))}
          {branch.departments.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{w.t('delegation.noDepartments')}</p>
          )}
        </div>
      )}
    </Card>
  );
};

/**
 * «الفرع كله» — a grant, not a «tick them all» button.
 *
 * It is its own record (`departmentId: null`) and it covers departments that do not exist yet,
 * which is the whole reason it is kept: without it there is no way to make a branch manager whose
 * authority survives the next department somebody opens in his branch.
 */
const WholeBranchBlock = ({ branch, w }: { branch: BranchNode; w: Wiring }): JSX.Element => {
  const unit = branch.whole;
  const on = unit.actionsOn > 0;
  const id = `w:${branch.id}`;
  const open = w.isOpen(id);
  const tick = (): void => {
    if (on) {
      w.setDraft(unit.unit, setAll(unit.selected, unit.ceiling, false));
      return;
    }
    // Turning it back on puts back what was THERE, not everything the caller could put there. The
    // block's contents are behind a chevron, so widening a deliberately narrow branch grant to the
    // caller's whole ceiling would happen out of sight; only a unit that holds nothing yet starts
    // with everything.
    w.setDraft(
      unit.unit,
      unit.saved.size > 0 ? new Set(unit.saved) : setAll(unit.selected, unit.ceiling, true),
    );
    // Turning it on can hide a department beneath it, and an unsaved draft down there would then
    // be a write the manager can no longer see. The drafts are DROPPED, not rewritten: writing
    // `d.selected` back would write the draft as itself and revert nothing.
    w.clearDrafts(branch.departments.map((d) => d.unit));
  };
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        on
          ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-950/50'
          : 'border-dashed border-slate-300 dark:border-slate-700',
      )}
    >
      <div className="flex items-center gap-3">
        {unit.editable ? (
          <Checkbox
            label={w.t('delegation.wholeTitle')}
            checked={on}
            onChange={tick}
            className="min-w-0 font-medium text-slate-800 dark:text-slate-100"
          />
        ) : (
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-400 dark:text-slate-500">
            <LockIcon className="h-3.5 w-3.5 shrink-0" />
            {w.t('delegation.wholeTitle')}
          </span>
        )}
        {w.isDirty(unit.unit) && <Badge tone="warning">{w.t('delegation.unsaved')}</Badge>}
        {on && unit.editable && <Disclosure id={id} open={open} w={w} className="ms-auto" />}
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {unit.editable ? w.t('delegation.wholeHint') : w.t('delegation.wholeLockedHint')}
      </p>
      {on && open && unit.editable && <ScreenList unit={unit} nodeId={id} w={w} />}
    </div>
  );
};

/** A department: the level the owner thinks in, and the one a grant is actually confined to. */
const DepartmentRow = ({
  branch,
  department,
  w,
}: {
  branch: BranchNode;
  department: DepartmentNode;
  w: Wiring;
}): JSX.Element => {
  const id = `d:${branch.id}:${department.id}`;
  const open = w.isOpen(id);
  const isHome = w.homeKey === unitKey(department.unit);

  if (department.coveredByBranch) {
    return (
      <LockedRow
        label={department.name[w.locale]}
        note={w.t('delegation.covered')}
        reason={w.t('delegation.coveredHint')}
        ticked
        tag={isHome ? w.t('delegation.homeTag') : null}
      />
    );
  }
  if (!department.editable) {
    return (
      <LockedRow
        label={department.name[w.locale]}
        note={
          department.actionsOn > 0
            ? w.t('delegation.summary', { screens: department.screensOn, actions: department.actionsOn })
            : w.t('delegation.nothing')
        }
        reason={w.t('delegation.readOnly')}
        ticked={department.actionsOn > 0}
        tag={isHome ? w.t('delegation.homeTag') : null}
      />
    );
  }

  const tick = (): void => {
    const next =
      department.state === 'all'
        ? setAll(department.selected, department.ceiling, false)
        : department.state === 'none' && department.saved.size > 0
          ? // Cleared a moment ago and clicked again: that is an undo, not a request for everything.
            new Set(department.saved)
          : setAll(department.selected, department.ceiling, true);
    w.setDraft(department.unit, next);
    w.setOpen(id, true);
  };
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center gap-3 px-3 py-2">
        <Checkbox
          label={department.name[w.locale]}
          checked={department.state === 'all'}
          indeterminate={department.state === 'some'}
          onChange={tick}
          className="min-w-0 font-medium text-slate-800 dark:text-slate-100"
        />
        {isHome && <Badge tone="neutral">{w.t('delegation.homeTag')}</Badge>}
        <span className="truncate text-xs text-slate-500 dark:text-slate-400">
          {department.screensOn > 0
            ? w.t('delegation.screensOn', { on: department.screensOn, total: department.screensTotal })
            : w.t('delegation.screens', { count: department.screensTotal })}
        </span>
        {w.isDirty(department.unit) && <Badge tone="warning">{w.t('delegation.unsaved')}</Badge>}
        <Disclosure id={id} open={open} w={w} className="ms-auto" />
      </div>
      {open && <ScreenList unit={department} nodeId={id} w={w} />}
    </div>
  );
};

/**
 * The screens of one unit, in the registry's own grouping.
 *
 * The module level only appears when there is more than one — a fleet manager delegating fleet
 * screens should not have to open a group called «الحركة» to reach the only thing he has.
 */
const ScreenList = ({ unit, nodeId, w }: { unit: UnitNode; nodeId: string; w: Wiring }): JSX.Element => {
  const single = unit.modules.length <= 1;
  const bulk = (on: boolean): void => w.setDraft(unit.unit, setAll(unit.selected, unit.ceiling, on));
  return (
    <div id={panelId(nodeId)} className="space-y-1.5 border-t border-slate-100 px-3 py-2 dark:border-slate-800">
      {unit.modules.map((group) => {
        const id = `${nodeId}:m:${group.moduleId ?? 'other'}`;
        const open = single || w.isOpen(id, group.openByDefault);
        return (
          <div key={group.moduleId ?? 'other'}>
            {!single && (
              <div className="flex items-center gap-2 py-1">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {moduleLabel(w, group.moduleId)}
                </span>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  {group.on > 0
                    ? w.t('delegation.screensOn', { on: group.on, total: group.total })
                    : w.t('delegation.screens', { count: group.total })}
                </span>
                <Disclosure id={id} open={open} w={w} className="ms-auto" />
              </div>
            )}
            {open && (
              <div id={panelId(id)} className={cn('space-y-1', !single && 'ps-3')}>
                {group.screens.map((screen) => (
                  <ScreenRow key={screen.id} unit={unit} screen={screen} nodeId={nodeId} w={w} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400 dark:text-slate-500">
        <Button size="sm" variant="ghost" onClick={() => bulk(true)}>
          {w.t('delegation.tickAll')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => bulk(false)}>
          {w.t('delegation.clearAll')}
        </Button>
        {unit.untickedScreens > 0 && (
          <span>{w.t('delegation.unticked', { count: unit.untickedScreens })}</span>
        )}
        {unit.lockedScreens > 0 && <span>{w.t('delegation.lockedScreens', { count: unit.lockedScreens })}</span>}
      </div>
    </div>
  );
};

/** One screen. Ticking it turns on every action the caller may grant — that is what a screen means. */
const ScreenRow = ({
  unit,
  screen,
  nodeId,
  w,
}: {
  unit: UnitNode;
  screen: ScreenNode;
  nodeId: string;
  w: Wiring;
}): JSX.Element => {
  const label = screen.page === null ? w.t('delegation.other') : screen.page.name[w.locale];
  if (!screen.grantable) {
    return (
      <LockedRow
        label={label}
        note={
          screen.on > 0
            ? w.t('delegation.actionsOn', { on: screen.on, total: screen.total })
            : w.t('delegation.nothing')
        }
        reason={screen.on > 0 ? w.t('delegation.grantedElsewhere') : w.t('delegation.locked')}
        ticked={screen.on > 0}
        tag={null}
      />
    );
  }
  const id = `${nodeId}:s:${screen.id}`;
  const open = w.isOpen(id);
  return (
    <div>
      <div className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/50">
        <Checkbox
          label={label}
          checked={screen.state === 'all'}
          indeterminate={screen.state === 'some'}
          onChange={() => w.setDraft(unit.unit, togglePage(unit.selected, screen.row, unit.ceiling))}
          className="min-w-0 text-sm"
        />
        <span className="truncate text-[11px] text-slate-400 dark:text-slate-500">
          {screen.state === 'all'
            ? w.t('delegation.actionsAll')
            : w.t('delegation.actionsOn', { on: screen.on, total: screen.total })}
        </span>
        <Disclosure id={id} open={open} w={w} className="ms-auto" />
      </div>
      {open && <Actions unit={unit} row={screen.row} nodeId={id} w={w} />}
    </div>
  );
};

/** The actions of one screen. Ticked by default when the screen is; here to be taken away. */
const Actions = ({
  unit,
  row,
  nodeId,
  w,
}: {
  unit: UnitNode;
  row: GridRow;
  nodeId: string;
  w: Wiring;
}): JSX.Element => (
  <div id={panelId(nodeId)} className="flex flex-wrap gap-1.5 px-2 pb-2 ps-7">
    {row.keys.map((key) => {
      const locked = !unit.ceiling.has(key.key);
      const on = unit.selected.has(key.key);
      return (
        <button
          key={key.key}
          type="button"
          disabled={locked}
          aria-pressed={on}
          title={locked ? w.t('delegation.locked') : undefined}
          onClick={() => w.setDraft(unit.unit, toggleKey(unit.selected, key.key, row, unit.ceiling))}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
            locked
              ? 'cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-600'
              : on
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-slate-300 text-slate-600 hover:border-slate-400 dark:border-slate-600 dark:text-slate-300',
          )}
        >
          {key.name[w.locale]}
        </button>
      );
    })}
  </div>
);

// ── Shared bits ─────────────────────────────────────────────────────────────

/**
 * A module's name, or the module's own id when the dictionary has no name for it.
 *
 * The key is built from data (`systemAdmin.roles.module.<id>`), so no source scan can check it and
 * `translate` answers a missing key with the key itself — a module added to the registry without a
 * label would put `systemAdmin.roles.module.gold` on the screen as a heading. The id is a poor
 * heading; the key is a broken one.
 */
const moduleLabel = (w: Wiring, moduleId: string | null): string => {
  if (moduleId === null) return w.t('delegation.other');
  const key = `systemAdmin.roles.module.${moduleId}`;
  const label = w.t(key);
  return label === key ? moduleId : label;
};

/**
 * One line of «what this person will see», written with a literal key per shape.
 *
 * The three shapes could be one key chosen by a ternary inside `t(...)`, and that is exactly what
 * hides a key from `delegation-i18n.spec` — its scan only sees a single-quoted literal as the first
 * thing after `t(`. A key it cannot see is a key that can ship untranslated.
 */
const summaryLine = (t: T, line: GrantLine, locale: Locale): string => {
  const params = {
    department: line.department === null ? '' : line.department[locale],
    branch: line.branch[locale],
    screens: line.screens,
    actions: line.actions,
  };
  if (line.everything) return t('delegation.lineAll', params);
  if (line.viewOnly) return t('delegation.lineView', params);
  return t('delegation.lineSome', params);
};

/** What a level holds, drawn and not clickable — the level itself is not a record. */
const StateMark = ({ state }: { state: TickState }): JSX.Element => (
  <span
    aria-hidden
    className={cn(
      'grid h-4 w-4 shrink-0 place-items-center rounded border text-[10px] font-bold',
      state === 'all'
        ? 'border-brand-600 bg-brand-600 text-white'
        : state === 'some'
          ? 'border-brand-500 text-brand-600 dark:text-brand-300'
          : 'border-slate-300 dark:border-slate-600',
    )}
  >
    {state === 'all' ? '✓' : state === 'some' ? '–' : ''}
  </span>
);

const panelId = (id: string): string => `delegation-${id.replace(/[.:|]/g, '-')}`;

/** A row nobody may change here. No chevron: there is nothing behind it to open. */
const LockedRow = ({
  label,
  note,
  reason,
  ticked,
  tag,
}: {
  label: string;
  note: string;
  reason: string;
  ticked: boolean;
  tag: string | null;
}): JSX.Element => (
  <div className="cursor-not-allowed rounded-lg border border-slate-200 px-3 py-2 opacity-70 dark:border-slate-700">
    <div className="flex items-center gap-3">
      {ticked ? (
        <span className="text-sm text-slate-400 dark:text-slate-500" aria-hidden>
          ✓
        </span>
      ) : (
        <LockIcon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
      )}
      <span className="min-w-0 truncate text-sm text-slate-500 dark:text-slate-400">{label}</span>
      {tag !== null && <Badge tone="neutral">{tag}</Badge>}
      <span className="ms-auto shrink-0 text-xs text-slate-400 dark:text-slate-500">{note}</span>
    </div>
    <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{reason}</p>
  </div>
);

const Disclosure = ({
  id,
  open,
  w,
  className,
}: {
  id: string;
  open: boolean;
  w: Wiring;
  className?: string;
}): JSX.Element => (
  <button
    type="button"
    onClick={() => w.setOpen(id, !open)}
    aria-expanded={open}
    aria-controls={panelId(id)}
    aria-label={open ? w.t('delegation.collapse') : w.t('delegation.expand')}
    className={cn(
      'shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:hover:bg-slate-800 dark:hover:text-slate-200',
      className,
    )}
  >
    <ChevronIcon className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
  </button>
);

export default DelegationPanel;
