// /atm/control «بيانات التغذية والخطوط» (docs/12-planning/atm-settlements-phase1.md §9.7, S-8) —
// Control & Supplies: (a) the day's lines with their bags and seals as Preparation left them, and
// the handover sheet to the ATM vault («سيلزات» with the QRs); (b) the bags distributed over the
// crew lines, with one sheet per line.
//
// THE DAY IS THE SERVER'S SUGGESTION — the day being dispatched (DS-25) — and the tab is a view;
// neither is remembered. Every enabled bank's plan of that day is here: a crew line serves every
// bank's machines (DS-17).
//
// A PRINT IS A WRITE OF RECORD (DS-21): the tab opens inside the click, before the request. The
// handover prints a QR only for a prepared line — any other prints a blank box — so the page warns
// before printing when lines are not prepared, and before the route sheets when lines are left
// undistributed (§8.4, §9.7).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ATM_BANK_NAMES,
  type AssignAtmRoutes,
  type AtmControlPrint,
  type AtmControlRouteDto,
  type AtmHandoverPrintDto,
  type AtmRoutesPrintDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { Button } from '../../../shared/ui/Button';
import { SettlementDialog } from '../components/settlements/SettlementDialog';
import { PrinterIcon } from '../../../shared/ui/icons';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useAssignRoutes,
  useControlDay,
  useCreateRoute,
  useDeleteRoute,
  usePrintControl,
  useRoutesFromZones,
  useUpdateRoute,
} from '../api/settlements-queries';
import { ControlDataTab } from '../components/settlements/ControlDataTab';
import { ControlRoutesTab } from '../components/settlements/ControlRoutesTab';
import { BlockedNotice, DayField } from '../components/settlements/DayField';
import { MenuButton } from '../components/settlements/MenuButton';
import { RouteDialog } from '../components/settlements/RouteDialog';
import { buildHandoverHtml, buildRoutesHtml } from '../lib/papers/handover-print';
import { printSettlementPaper } from '../lib/papers/settlement-print';
import {
  blockedKey,
  blockedOf,
  currentVersion,
  settlementErrorText,
  settlementErrorToast,
  toastWords,
} from '../lib/settlement-view';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Confirm =
  | { kind: 'handover'; planId: string; notPrepared: number }
  | { kind: 'routes'; routeIds: string[] | null; unassigned: number; notPrepared: number }
  | { kind: 'delete'; route: AtmControlRouteDto }
  | null;

type Editing = { route: AtmControlRouteDto | null } | null;

export const ControlPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const setParam = (key: 'date' | 'tab', value: string | null): void => {
    const next = new URLSearchParams(sp);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSp(next, { replace: true });
  };
  const fail = (error: unknown): void => {
    const words = settlementErrorToast(error, t, locale);
    toast.error(words.title, words.description);
  };

  const dateParam = sp.get('date');
  const askedDay = dateParam !== null && DAY.test(dateParam) ? dateParam : null;
  const dayQuery = useControlDay(askedDay);
  const day = dayQuery.data;
  const blocked = blockedOf(dayQuery.error);
  const tab = sp.get('tab') === 'routes' && day?.can.manage === true ? 'routes' : 'data';

  const print = usePrintControl();
  const assign = useAssignRoutes();
  const create = useCreateRoute();
  const update = useUpdateRoute();
  const remove = useDeleteRoute();
  const fromZones = useRoutesFromZones();
  const busy =
    assign.isPending ||
    create.isPending ||
    update.isPending ||
    remove.isPending ||
    fromZones.isPending;

  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [routeError, setRouteError] = useState<string | null>(null);

  // ── The papers (§8) ──────────────────────────────────────────────────────────────────────────
  const printPaper = async <T,>(
    body: AtmControlPrint,
    compose: (dto: T) => string,
  ): Promise<void> => {
    try {
      const dto = await printSettlementPaper<T>({
        loading: t('common.loading'),
        load: async () => (await print.mutateAsync(body)) as T,
        compose,
      });
      if (dto === null) {
        const words = toastWords(t('atm.paper.popupBlocked'), 'failed', t);
        toast.error(words.title, words.description);
      }
    } catch (error) {
      fail(error);
    }
  };
  const printHandover = (planId: string): void => {
    setConfirm(null);
    void printPaper<AtmHandoverPrintDto>({ kind: 'handover', planId }, (dto) =>
      buildHandoverHtml(dto),
    );
  };
  const printRoutes = (routeIds: string[] | null): void => {
    setConfirm(null);
    if (day?.branch === null || day === undefined) return;
    void printPaper<AtmRoutesPrintDto>(
      {
        kind: 'routes',
        branchId: day.branch.id,
        replenishDate: day.date,
        ...(routeIds === null ? {} : { routeIds }),
      },
      (dto) => buildRoutesHtml(dto),
    );
  };

  /** Lines of a plan that will print a blank QR box: not prepared, and not cancelled. */
  const notPreparedOf = (planId: string): number =>
    (day?.lines ?? []).filter(
      (l) => l.planId === planId && l.lineStatus !== 'cancelled' && l.lineStatus !== 'prepared',
    ).length;
  const askHandover = (planId: string): void => {
    const notPrepared = notPreparedOf(planId);
    if (notPrepared > 0) setConfirm({ kind: 'handover', planId, notPrepared });
    else printHandover(planId);
  };
  const askRoutes = (routes: readonly AtmControlRouteDto[], ids: string[] | null): void => {
    const unassigned = ids === null ? (day?.unassigned ?? 0) : 0;
    const notPrepared = routes.reduce((sum, r) => sum + r.notPrepared, 0);
    if (unassigned > 0 || notPrepared > 0) {
      setConfirm({ kind: 'routes', routeIds: ids, unassigned, notPrepared });
    } else {
      printRoutes(ids);
    }
  };

  // ── Routes and moves ─────────────────────────────────────────────────────────────────────────
  const move = (moves: AssignAtmRoutes['moves']): void => {
    if (day === undefined || day.branch === null) return;
    assign.mutate({ branchId: day.branch.id, replenishDate: day.date, moves }, { onError: fail });
  };
  const saveRoute = (value: { name: string; leaderName: string | null }): void => {
    if (day === undefined || day.branch === null || editing === null) return;
    setRouteError(null);
    const done = {
      onSuccess: () => setEditing(null),
      onError: (e: unknown) => setRouteError(settlementErrorText(e, t, locale)),
    };
    if (editing.route === null) {
      create.mutate({ branchId: day.branch.id, replenishDate: day.date, ...value }, done);
    } else {
      update.mutate(
        {
          routeId: editing.route.id,
          body: { version: currentVersion(day.routes, editing.route), ...value },
        },
        done,
      );
    }
  };
  const shift = async (route: AtmControlRouteDto, by: -1 | 1): Promise<void> => {
    const routes = [...(day?.routes ?? [])].sort((a, b) => a.order - b.order);
    const at = routes.findIndex((r) => r.id === route.id);
    const other = routes[at + by];
    if (other === undefined) return;
    try {
      await update.mutateAsync({
        routeId: route.id,
        body: { version: route.version, order: other.order },
      });
      await update.mutateAsync({
        routeId: other.id,
        body: { version: other.version, order: route.order },
      });
    } catch (error) {
      fail(error);
    }
  };
  const deleteRoute = (route: AtmControlRouteDto): void => {
    setConfirm(null);
    remove.mutate(
      { routeId: route.id, version: currentVersion(day?.routes, route) },
      { onError: fail },
    );
  };
  const runFromZones = (): void => {
    if (day === undefined || day.branch === null) return;
    fromZones.mutate(
      { branchId: day.branch.id, replenishDate: day.date },
      {
        onSuccess: (result) => {
          const words = toastWords(
            t('atm.control.fromZonesResult', {
              routes: formatNumber(result.routesCreated, locale),
              assigned: formatNumber(result.assigned, locale),
              left: formatNumber(result.unlocated + result.outsideZones, locale),
            }),
            'done',
            t,
          );
          toast.success(words.title, words.description);
        },
        onError: fail,
      },
    );
  };

  if (blocked !== null) {
    return (
      <PageContainer>
        <PageHeader title={t('atm.control.title')} />
        <BlockedNotice text={t(blockedKey(blocked))} />
      </PageContainer>
    );
  }

  const plans = day?.plans ?? [];
  const routes = day?.routes ?? [];
  const canPrint = day?.can.print === true;
  const actions = !canPrint ? undefined : (
    <>
      {plans.length > 1 ? (
        <MenuButton
          icon={<PrinterIcon className="h-4 w-4" />}
          label={t('atm.control.action.printHandover')}
          items={plans.map((p) => ({
            key: p.planId,
            label: ATM_BANK_NAMES[p.bankCode][locale],
            onSelect: () => askHandover(p.planId),
          }))}
        />
      ) : (
        <Button
          variant="secondary"
          disabled={plans.length === 0}
          data-control-action="handover"
          onClick={() => {
            const only = plans[0];
            if (only !== undefined) askHandover(only.planId);
          }}
        >
          <PrinterIcon className="h-4 w-4" />
          {t('atm.control.action.printHandover')}
        </Button>
      )}
      <Button
        variant="secondary"
        disabled={routes.length === 0}
        data-control-action="routes"
        onClick={() => askRoutes(routes, null)}
      >
        <PrinterIcon className="h-4 w-4" />
        {t('atm.control.action.printRoutes')}
      </Button>
    </>
  );

  return (
    <PageContainer>
      <PageHeader title={t('atm.control.title')} actions={actions} />

      <div className="mb-4 flex flex-wrap items-end gap-3" data-control-toolbar="true">
        <DayField
          id="control-day"
          value={day?.date ?? askedDay ?? ''}
          onChange={(next) => setParam('date', next)}
        />
        <div role="tablist" aria-label={t('atm.control.title')} className="ms-auto flex gap-2">
          {(['data', 'routes'] as const)
            .filter((k) => k === 'data' || day?.can.manage === true)
            .map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                data-control-tab={k}
                onClick={() => setParam('tab', k === 'data' ? null : k)}
                className={cn(
                  'h-9 rounded-lg border px-4 text-sm font-medium',
                  tab === k
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
                )}
              >
                {t(k === 'data' ? 'atm.control.tab.data' : 'atm.control.tab.routes')}
              </button>
            ))}
        </div>
      </div>

      {dayQuery.isLoading ? (
        <LoadingState />
      ) : day === undefined ? (
        <ErrorState
          error={dayQuery.error}
          description={settlementErrorText(dayQuery.error, t, locale)}
          onRetry={() => void dayQuery.refetch()}
        />
      ) : day.lines.length === 0 && tab === 'data' ? (
        <p
          data-control-empty="true"
          className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
        >
          {t('atm.control.empty')}
        </p>
      ) : tab === 'routes' ? (
        <ControlRoutesTab
          day={day}
          locale={locale}
          busy={busy}
          canPrint={canPrint}
          actions={{
            onMove: move,
            onCreate: () => {
              setRouteError(null);
              setEditing({ route: null });
            },
            onEdit: (route) => {
              setRouteError(null);
              setEditing({ route });
            },
            onShift: (route, by) => void shift(route, by),
            onDelete: (route) => setConfirm({ kind: 'delete', route }),
            onPrint: (route) => askRoutes([route], [route.id]),
            onFromZones: runFromZones,
          }}
        />
      ) : (
        <ControlDataTab day={day} locale={locale} />
      )}

      <RouteDialog
        open={editing !== null}
        title={editing?.route === null ? t('atm.control.route.create') : t('atm.control.menu.edit')}
        initial={{
          name: editing?.route?.name ?? '',
          leaderName: editing?.route?.leaderName ?? null,
        }}
        busy={create.isPending || update.isPending}
        error={routeError}
        onConfirm={saveRoute}
        onClose={() => setEditing(null)}
      />

      <SettlementDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        size="sm"
        title={
          confirm?.kind === 'delete'
            ? t('atm.control.menu.delete')
            : confirm?.kind === 'routes'
              ? t('atm.control.action.printRoutes')
              : t('atm.control.action.printHandover')
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={confirm?.kind === 'delete' ? 'danger' : 'primary'}
              data-control-confirm={confirm?.kind}
              onClick={() => {
                if (confirm === null) return;
                if (confirm.kind === 'handover') printHandover(confirm.planId);
                else if (confirm.kind === 'routes') printRoutes(confirm.routeIds);
                else deleteRoute(confirm.route);
              }}
            >
              {confirm?.kind === 'delete' ? t('atm.control.menu.delete') : t('common.print')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {confirm?.kind === 'handover'
            ? t('atm.control.handoverWarning', { n: formatNumber(confirm.notPrepared, locale) })
            : confirm?.kind === 'routes'
              ? t('atm.control.confirm.routesPrint', {
                  unassigned: formatNumber(confirm.unassigned, locale),
                  notPrepared: formatNumber(confirm.notPrepared, locale),
                })
              : confirm?.kind === 'delete'
                ? t('atm.control.confirm.delete', { n: formatNumber(confirm.route.lines, locale) })
                : ''}
        </p>
      </SettlementDialog>
    </PageContainer>
  );
};
