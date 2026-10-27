// /atm/settlements/plans «خطة التغذية» (docs/12-planning/atm-settlements-phase1.md §9.4) — the day's
// plan of one bank in the work branch: its lines, their counts and Notes, and the four papers.
// Source: the bank's daily Master workbook (`REP. TAPE`, `Print`, `بيان التغذية`, `سيلزات`).
//
// ONE BRANCH, THE SERVER'S (DS-22): the page asks S1 which branch it works in and sends that branch
// on every read and write; it never decides one itself. When none resolves, the page says why and
// shows nothing else — the same state whether S1 said so or a read answered 422.
//
// THE DAY OPENS ON TOMORROW (Cairo) and is never remembered (DS-25): plans are built the evening
// before. `bank` is the one filter remembered; `line` is a selection.
//
// A PRINT IS A WRITE OF RECORD (DS-21): the tab opens inside the click, before the request, so a
// blocked tab sends nothing and nothing is counted or audited; a refused request closes the tab
// (§8, `lib/papers/settlement-print.ts`).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ATM_BANK_NAMES,
  ATM_PLAN_ADD_REFUSALS,
  ErrorCodes,
  type AddAtmSpareLine,
  type AtmBankCode,
  type AtmHandoverPrintDto,
  type AtmNotePrintDto,
  type AtmPlanAddResultDto,
  type AtmPlanLineDto,
  type AtmPlanLineIssueCode,
  type AtmPlanRun,
  type AtmReceiptPrintDto,
  type AtmRepTapeExportDto,
  type AtmSettlementPrint,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { ApiError, saveBlob } from '../../../shared/lib/api-client';
import { formatBusinessDateTime, formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { SettlementDialog } from '../components/settlements/SettlementDialog';
import { Field, Select } from '../../../shared/ui/form';
import { DownloadIcon, PrinterIcon } from '../../../shared/ui/icons';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useAddPlanLines,
  useAddSpareLine,
  useCancelPlanLine,
  useCassetteLayouts,
  useCreatePlan,
  useDeletePlanLine,
  useIssuePlan,
  usePrintPlan,
  useRecordSpareUse,
  useReopenPlanLine,
  useSettlementContext,
  useSettlementPlan,
  useStandardLoads,
  useUpdatePlanLine,
} from '../api/settlements-queries';
import { AddMachinesDialog } from '../components/settlements/AddMachinesDialog';
import { BlockedNotice, DayField } from '../components/settlements/DayField';
import { IssueDialog, type ServerIssue } from '../components/settlements/IssueDialog';
import { MenuButton } from '../components/settlements/MenuButton';
import { PlanLinePanel, type LinePatch } from '../components/settlements/PlanLinePanel';
import { PlanLinesTable, printable } from '../components/settlements/PlanLinesTable';
import { PrintReceiptDialog } from '../components/settlements/PrintReceiptDialog';
import { ReasonDialog } from '../components/settlements/ReasonDialog';
import { SettlementFigures } from '../components/settlements/SettlementFigures';
import { SpareLineDialog } from '../components/settlements/SpareLineDialog';
import { SpareUseDialog } from '../components/settlements/SpareUseDialog';
import { buildHandoverHtml } from '../lib/papers/handover-print';
import { buildNotesHtml } from '../lib/papers/note-print';
import { buildReceiptHtml } from '../lib/papers/receipt-print';
import { buildRepTapeXlsx } from '../lib/papers/rep-tape-xlsx';
import { printSettlementPaper } from '../lib/papers/settlement-print';
import { cairoTomorrow } from '../lib/settlement-dates';
import {
  blockedKey,
  blockedOf,
  currentVersion,
  denominationMinor,
  formatEgp,
  lineCode,
  PLAN_STATE_TONE,
  planState,
  settlementErrorText,
  settlementErrorToast,
  toastWords,
} from '../lib/settlement-view';

/** Remembered across visits: the bank. The day opens on tomorrow (DS-25); `line` is a selection. */
const REMEMBERED_FILTERS = ['bank'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type ReasonFor = { kind: 'reopen' | 'cancel'; line: AtmPlanLineDto } | null;

/** S21's refusal of a machine names its reason as the detail code (`unknownCode`, `inactive` …). */
const spareUseRefusal = (error: unknown): string | null => {
  if (!(error instanceof ApiError)) return null;
  const code = error.details?.find((d) => d.field === 'body.machineCode')?.code;
  return code !== undefined && (ATM_PLAN_ADD_REFUSALS as readonly string[]).includes(code)
    ? code
    : null;
};

export const SettlementPlanPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    setSp(next, { replace: true });
  };
  const fail = (error: unknown): void => {
    const words = settlementErrorToast(error, t, locale);
    toast.error(words.title, words.description);
  };

  // ── The context, the bank and the day, then the plan ────────────────────────────────────────
  const context = useSettlementContext('plans');
  const ctx = context.data;
  const banks = ctx?.banks ?? [];
  const bankParam = sp.get('bank');
  const bank: AtmBankCode | null = banks.find((b) => b === bankParam) ?? banks[0] ?? null;
  const dateParam = sp.get('date');
  const date = dateParam !== null && DAY.test(dateParam) ? dateParam : cairoTomorrow();
  const lineParam = sp.get('line');
  const branchId = ctx?.branch?.id ?? null;
  const ready = ctx !== undefined && ctx.blocked === null && branchId !== null && bank !== null;
  const bankCode: AtmBankCode = bank ?? 'BRK';
  const planQuery = useSettlementPlan({ bankCode, date, branchId }, ready);
  const loads = useStandardLoads({ bankCode, branchId }, ready);
  const plan = planQuery.data?.plan ?? null;
  const blocked = ctx?.blocked ?? blockedOf(planQuery.error) ?? null;
  const standardLoads = loads.data ?? [];

  const selected = plan?.lines.find((l) => l.id === lineParam) ?? null;
  const drafts = useMemo(() => (plan?.lines ?? []).filter((l) => l.status === 'draft'), [plan]);
  const issuedCount =
    plan === null ? 0 : plan.summary.byStatus.issued + plan.summary.byStatus.prepared;

  // The lines ticked for «السطور المحددة» — only those that still have a Note to print.
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const live = new Set((plan?.lines ?? []).filter(printable).map((l) => l.id));
    setChecked((current) => {
      const kept = [...current].filter((id) => live.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [plan]);

  // ── Mutations ──────────────────────────────────────────────────────────────────────────────
  const create = useCreatePlan();
  const add = useAddPlanLines();
  const spare = useAddSpareLine();
  const update = useUpdatePlanLine();
  const remove = useDeletePlanLine();
  const issue = useIssuePlan();
  const reopen = useReopenPlanLine();
  const cancel = useCancelPlanLine();
  const spareUse = useRecordSpareUse();
  const print = usePrintPlan();

  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [spareOpen, setSpareOpen] = useState(false);
  const [spareError, setSpareError] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSent, setIssueSent] = useState<AtmPlanLineDto[]>([]);
  const [serverIssues, setServerIssues] = useState<ServerIssue[]>([]);
  const [reasonFor, setReasonFor] = useState<ReasonFor>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [spareUseFor, setSpareUseFor] = useState<AtmPlanLineDto | null>(null);
  const [spareUseError, setSpareUseError] = useState<string | null>(null);
  const [refreshFor, setRefreshFor] = useState<AtmPlanLineDto | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const layouts = useCassetteLayouts(
    { bankCode, branchId },
    ready && spareOpen && ctx?.can.viewLayouts === true,
  );
  const typeLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const line of plan?.lines ?? []) if (line.typeLabel !== null) labels.add(line.typeLabel);
    for (const row of layouts.data?.rows ?? []) {
      if (row.layout?.typeLabel !== null && row.layout?.typeLabel !== undefined) {
        labels.add(row.layout.typeLabel);
      }
    }
    return [...labels].sort((a, b) => a.localeCompare(b));
  }, [plan, layouts.data]);

  const createPlan = (): void => {
    if (bank === null || branchId === null) return;
    create.mutate(
      { bankCode: bank, replenishDate: date, branchId },
      {
        onError: (error) => {
          // Somebody created it meanwhile: say so and open theirs.
          if (error instanceof ApiError && error.code === ErrorCodes.ATM_PLAN_EXISTS) {
            const words = toastWords(t('atm.plan.error.exists'), 'notice', t);
            toast.info(words.title, words.description);
            void planQuery.refetch();
            return;
          }
          fail(error);
        },
      },
    );
  };

  const patchLine = (line: AtmPlanLineDto, body: LinePatch): void => {
    if (plan === null) return;
    update.mutate(
      { planId: plan.id, lineId: line.id, body: { version: line.version, ...body } },
      { onError: fail },
    );
  };

  const addMachines = async (
    run: AtmPlanRun,
    rows: { machineCode: string; scheduleTime: string | null }[],
  ): Promise<AtmPlanAddResultDto | null> => {
    if (plan === null) return null;
    setAddError(null);
    try {
      return await add.mutateAsync({ planId: plan.id, body: { run, rows } });
    } catch (error) {
      setAddError(settlementErrorText(error, t, locale));
      return null;
    }
  };

  const addSpare = (body: AddAtmSpareLine): void => {
    if (plan === null) return;
    setSpareError(null);
    spare.mutate(
      { planId: plan.id, body },
      {
        onSuccess: (line) => {
          setSpareOpen(false);
          patch({ line: line.id });
        },
        onError: (error) => setSpareError(settlementErrorText(error, t, locale)),
      },
    );
  };

  const openIssue = (): void => {
    setIssueSent(drafts);
    setServerIssues([]);
    setIssueOpen(true);
  };
  const confirmIssue = (): void => {
    if (plan === null) return;
    const sent = issueSent.map((l) => drafts.find((d) => d.id === l.id) ?? l);
    issue.mutate(
      { planId: plan.id, body: { lines: sent.map((l) => ({ id: l.id, version: l.version })) } },
      {
        onSuccess: () => {
          setIssueOpen(false);
          setServerIssues([]);
        },
        onError: (error) => {
          if (error instanceof ApiError && error.code === ErrorCodes.ATM_PLAN_ISSUE_BLOCKED) {
            // `lines[i]` names the i-th line sent: the dialog shows them as blocking.
            setServerIssues(
              (error.details ?? []).flatMap((d) => {
                const at = /^lines\[(\d+)\]$/.exec(d.field ?? '');
                const line = at === null ? undefined : sent[Number(at[1])];
                return line === undefined
                  ? []
                  : [{ lineId: line.id, code: d.code as AtmPlanLineIssueCode }];
              }),
            );
            const words = toastWords(t('atm.plan.error.issueBlocked'), 'failed', t);
            toast.error(words.title, words.description);
            return;
          }
          fail(error);
          setIssueOpen(false);
        },
      },
    );
  };

  const confirmReason = (reason: string): void => {
    if (plan === null || reasonFor === null) return;
    const { kind, line } = reasonFor;
    const mutation = kind === 'reopen' ? reopen : cancel;
    setReasonError(null);
    mutation.mutate(
      {
        planId: plan.id,
        lineId: line.id,
        body: { version: currentVersion(plan.lines, line), reason },
      },
      {
        onSuccess: () => setReasonFor(null),
        onError: (error) => setReasonError(settlementErrorText(error, t, locale)),
      },
    );
  };

  const confirmSpareUse = (machineCode: string): void => {
    if (plan === null || spareUseFor === null) return;
    setSpareUseError(null);
    spareUse.mutate(
      {
        planId: plan.id,
        lineId: spareUseFor.id,
        body: { version: currentVersion(plan.lines, spareUseFor), machineCode },
      },
      {
        onSuccess: () => setSpareUseFor(null),
        onError: (error) => {
          const refusal = spareUseRefusal(error);
          setSpareUseError(
            refusal === null
              ? settlementErrorText(error, t, locale)
              : t(`atm.plan.refused.${refusal}`),
          );
        },
      },
    );
  };

  const refreshLayout = (line: AtmPlanLineDto): void => {
    if (line.countsSource === 'manual') setRefreshFor(line);
    else patchLine(line, { refreshLayout: true });
  };

  const deleteLine = (line: AtmPlanLineDto): void => {
    if (plan === null) return;
    remove.mutate(
      { planId: plan.id, lineId: line.id, version: line.version },
      { onSuccess: () => patch({ line: null }), onError: fail },
    );
  };

  // ── The papers (§8): the tab first, then the request, then the paper ──────────────────────
  const printPaper = async <T,>(
    body: AtmSettlementPrint,
    compose: (dto: T) => string,
  ): Promise<T | null> => {
    if (plan === null) return null;
    const planId = plan.id;
    try {
      const dto = await printSettlementPaper<T>({
        loading: t('common.loading'),
        load: async () => (await print.mutateAsync({ planId, body })) as T,
        compose,
      });
      if (dto === null) {
        const words = toastWords(t('atm.paper.popupBlocked'), 'failed', t);
        toast.error(words.title, words.description);
      }
      return dto;
    } catch (error) {
      fail(error);
      return null;
    }
  };

  const printNotes = (body: Extract<AtmSettlementPrint, { kind: 'notes' }>): void => {
    void printPaper<AtmNotePrintDto>(body, (dto) => buildNotesHtml(dto));
  };

  const printReceipt = async (): Promise<void> => {
    setReceiptOpen(false);
    const dto = await printPaper<AtmReceiptPrintDto>({ kind: 'receipt' }, (d) =>
      buildReceiptHtml(d),
    );
    // What changed since the paper before it — known once the server answers with both (GS-27).
    if (dto === null || dto.previous === null) return;
    const before = new Set(dto.previous.serials);
    const now = new Set(dto.serials);
    const added = dto.serials.filter((s) => !before.has(s)).length;
    const removed = dto.previous.serials.filter((s) => !now.has(s)).length;
    if (added + removed > 0) {
      const words = toastWords(
        t('atm.plan.print.changedSince', {
          added: formatNumber(added, locale),
          removed: formatNumber(removed, locale),
        }),
        'notice',
        t,
      );
      toast.info(words.title, words.description);
    }
  };
  const onPrintReceipt = (): void => {
    if (plan === null) return;
    if (plan.summary.byStatus.draft > 0 || plan.summary.receiptPrint !== null) {
      setReceiptOpen(true);
      return;
    }
    void printReceipt();
  };

  const printHandover = (): void => {
    void printPaper<AtmHandoverPrintDto>({ kind: 'handover' }, (dto) => buildHandoverHtml(dto));
  };

  const [exporting, setExporting] = useState(false);
  const exportRepTape = async (): Promise<void> => {
    if (plan === null || exporting) return;
    setExporting(true);
    try {
      const dto = (await print.mutateAsync({
        planId: plan.id,
        body: { kind: 'repTape' },
      })) as AtmRepTapeExportDto;
      const { blob, filename } = buildRepTapeXlsx(dto);
      saveBlob(blob, filename);
    } catch (error) {
      fail(error);
    } finally {
      setExporting(false);
    }
  };

  // ── The header ──────────────────────────────────────────────────────────────────────────────
  const summary = plan?.summary;
  const figures = (
    <SettlementFigures
      label={t('atm.plan.title')}
      locale={locale}
      figures={[
        { key: 'machines', label: t('atm.plan.figure.machines'), value: summary?.machines },
        { key: 'lines', label: t('atm.plan.figure.lines'), value: summary?.lines },
        { key: 'bags', label: t('atm.plan.figure.bags'), value: summary?.bags },
      ]}
    />
  );
  const actions =
    plan === null ? undefined : (
      <>
        {plan.can.print && (
          <Button
            variant="secondary"
            disabled={issuedCount === 0}
            onClick={onPrintReceipt}
            data-plan-action="receipt"
          >
            <PrinterIcon className="h-4 w-4" />
            {t('atm.plan.action.printReceipt')}
          </Button>
        )}
        {plan.can.print && (
          <MenuButton
            disabled={issuedCount === 0}
            icon={<PrinterIcon className="h-4 w-4" />}
            label={t('atm.plan.action.printNotes', { count: formatNumber(issuedCount, locale) })}
            items={[
              {
                key: 'all',
                label: t('atm.plan.action.notesAll'),
                onSelect: () => printNotes({ kind: 'notes' }),
              },
              {
                key: 'unprinted',
                label: t('atm.plan.action.notesUnprinted', {
                  n: formatNumber(plan.summary.notPrinted, locale),
                }),
                disabled: plan.summary.notPrinted === 0,
                onSelect: () => printNotes({ kind: 'notes', unprintedOnly: true }),
              },
              {
                key: 'selected',
                label: t('atm.plan.action.notesSelected'),
                disabled: checked.size === 0,
                onSelect: () => printNotes({ kind: 'notes', lineIds: [...checked] }),
              },
            ]}
          />
        )}
        {plan.can.print && (
          <Button
            variant="secondary"
            disabled={issuedCount === 0}
            onClick={printHandover}
            data-plan-action="handover"
          >
            <PrinterIcon className="h-4 w-4" />
            {t('atm.plan.action.printHandover')}
          </Button>
        )}
        {plan.can.export && (
          <Button
            variant="secondary"
            disabled={issuedCount === 0}
            loading={exporting}
            onClick={() => void exportRepTape()}
            data-plan-action="export"
          >
            <DownloadIcon className="h-4 w-4" />
            {t('atm.plan.action.exportRepTape')}
          </Button>
        )}
      </>
    );

  if (blocked !== null) {
    return (
      <PageContainer>
        <PageHeader title={t('atm.plan.title')} />
        <BlockedNotice text={t(blockedKey(blocked))} />
      </PageContainer>
    );
  }

  const state = summary === undefined ? null : planState(summary);
  const lastAt = (at: string): string => formatBusinessDateTime(at, locale);

  return (
    <PageContainer>
      <PageHeader title={t('atm.plan.title')} figures={figures} actions={actions} />

      {/* ── The toolbar ── */}
      <div className="mb-4 flex flex-wrap items-end gap-3" data-plan-toolbar="true">
        <Field label={t('atm.settlement.bank')} htmlFor="plan-bank">
          <Select
            id="plan-bank"
            value={bank ?? ''}
            onChange={(e) => patch({ bank: e.target.value, line: null })}
          >
            {banks.map((b) => (
              <option key={b} value={b}>
                {ATM_BANK_NAMES[b][locale]}
              </option>
            ))}
          </Select>
        </Field>
        <DayField
          id="plan-day"
          value={date}
          onChange={(day) => patch({ date: day === cairoTomorrow() ? null : day, line: null })}
        />
        {state !== null && (
          <span data-plan-state={state} className="pb-2">
            <Badge tone={PLAN_STATE_TONE[state]}>{t(`atm.settlement.planState.${state}`)}</Badge>
          </span>
        )}
        {plan !== null && plan.can.manage && (
          <div className="ms-auto flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              {t('atm.plan.action.addMachines')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSpareError(null);
                setSpareOpen(true);
              }}
            >
              {t('atm.plan.action.addSpare')}
            </Button>
            <Button variant="secondary" disabled={drafts.length === 0} onClick={openIssue}>
              {t('atm.plan.action.issue', { n: formatNumber(drafts.length, locale) })}
            </Button>
          </div>
        )}
      </div>

      {context.isLoading || (ready && planQuery.isLoading) ? (
        <LoadingState />
      ) : context.error !== null && ctx === undefined ? (
        <ErrorState error={context.error} onRetry={() => void context.refetch()} />
      ) : planQuery.error !== null ? (
        <ErrorState
          error={planQuery.error}
          description={settlementErrorText(planQuery.error, t, locale)}
          onRetry={() => void planQuery.refetch()}
        />
      ) : plan === null ? (
        <div
          data-plan-empty="true"
          className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700"
        >
          <p className="text-sm text-slate-600 dark:text-slate-300">{t('atm.plan.empty')}</p>
          {ctx?.can.managePlans === true && (
            <Button loading={create.isPending} onClick={createPlan} data-plan-create="true">
              {t('atm.plan.action.create')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <section aria-label={t('atm.plan.title')} className="min-w-0 flex-1 space-y-3">
            {plan.summary.receiptStale && plan.summary.receiptPrint !== null && (
              <p
                role="status"
                data-plan-notice="receiptStale"
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
              >
                {t('atm.plan.notice.receiptStale', { at: lastAt(plan.summary.receiptPrint.at) })}
              </p>
            )}
            {plan.summary.handoverStale && plan.summary.handoverPrint !== null && (
              <p
                role="status"
                data-plan-notice="handoverStale"
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
              >
                {t('atm.plan.notice.handoverStale', { at: lastAt(plan.summary.handoverPrint.at) })}
              </p>
            )}
            <PlanLinesTable
              lines={plan.lines}
              locale={locale}
              selectedId={selected?.id ?? null}
              checked={checked}
              onSelect={(id) => patch({ line: id === selected?.id ? null : id })}
              onCheck={(id, on) =>
                setChecked((current) => {
                  const next = new Set(current);
                  if (on) next.add(id);
                  else next.delete(id);
                  return next;
                })
              }
            />
            <footer
              data-plan-footer="true"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <strong className="text-slate-900 dark:text-white">
                {t('atm.plan.footer.title')}
              </strong>
              {plan.summary.all.rows
                .filter((row) => row.notes > 0)
                .map((row) => (
                  <span key={row.denomination} className="text-slate-600 dark:text-slate-300">
                    {t('atm.plan.footer.denomination', {
                      d: row.denomination,
                      n: formatNumber(row.notes, locale),
                      v: formatEgp(denominationMinor(row.denomination, row.notes), locale),
                    })}
                  </span>
                ))}
              <span className="ms-auto font-semibold text-slate-900 dark:text-white">
                {formatEgp(plan.summary.all.egpTotalMinor, locale)} ·{' '}
                {t('atm.plan.footer.machines', {
                  n: formatNumber(plan.summary.all.machineCount, locale),
                })}
              </span>
            </footer>
          </section>
          {selected !== null && (
            <aside
              aria-label={lineCode(selected)}
              className="w-full shrink-0 rounded-xl border border-slate-200 bg-white p-4 lg:sticky lg:top-4 lg:w-[380px] dark:border-slate-800 dark:bg-slate-900"
            >
              <PlanLinePanel
                key={`${selected.id}:${String(selected.version)}`}
                line={selected}
                locale={locale}
                canManage={plan.can.manage}
                standardLoads={standardLoads}
                busy={update.isPending || remove.isPending}
                onPatch={(body) => patchLine(selected, body)}
                onRefreshLayout={() => refreshLayout(selected)}
                onDelete={() => deleteLine(selected)}
                onReopen={() => {
                  setReasonError(null);
                  setReasonFor({ kind: 'reopen', line: selected });
                }}
                onCancel={() => {
                  setReasonError(null);
                  setReasonFor({ kind: 'cancel', line: selected });
                }}
                onSpareUse={() => {
                  setSpareUseError(null);
                  setSpareUseFor(selected);
                }}
              />
            </aside>
          )}
        </div>
      )}

      {/* ── Dialogs ── */}
      <AddMachinesDialog
        open={addOpen}
        locale={locale}
        busy={add.isPending}
        error={addError}
        onSubmit={addMachines}
        onClose={() => setAddOpen(false)}
      />
      <SpareLineDialog
        open={spareOpen}
        locale={locale}
        busy={spare.isPending}
        error={spareError}
        typeLabels={typeLabels}
        standardLoads={standardLoads}
        onSubmit={addSpare}
        onClose={() => setSpareOpen(false)}
      />
      <IssueDialog
        open={issueOpen}
        lines={issueSent.map((l) => drafts.find((d) => d.id === l.id) ?? l)}
        serverIssues={serverIssues}
        locale={locale}
        busy={issue.isPending}
        onConfirm={confirmIssue}
        onClose={() => setIssueOpen(false)}
      />
      <ReasonDialog
        open={reasonFor !== null}
        title={t(
          reasonFor?.kind === 'cancel'
            ? 'atm.plan.reason.cancelTitle'
            : 'atm.plan.reason.reopenTitle',
        )}
        confirmLabel={t(
          reasonFor?.kind === 'cancel' ? 'atm.plan.action.cancelLine' : 'atm.plan.action.reopen',
        )}
        danger={reasonFor?.kind === 'cancel'}
        busy={reopen.isPending || cancel.isPending}
        error={reasonError}
        onConfirm={confirmReason}
        onClose={() => setReasonFor(null)}
      />
      <SpareUseDialog
        open={spareUseFor !== null}
        initialCode={spareUseFor?.spareUse?.machineCode ?? ''}
        busy={spareUse.isPending}
        error={spareUseError}
        onConfirm={confirmSpareUse}
        onClose={() => setSpareUseFor(null)}
      />
      <PrintReceiptDialog
        open={receiptOpen}
        drafts={plan?.summary.byStatus.draft ?? 0}
        lastPrint={plan?.summary.receiptPrint ?? null}
        stale={plan?.summary.receiptStale ?? false}
        locale={locale}
        busy={print.isPending}
        onConfirm={() => void printReceipt()}
        onClose={() => setReceiptOpen(false)}
      />
      <SettlementDialog
        open={refreshFor !== null}
        onClose={() => setRefreshFor(null)}
        size="sm"
        title={t('atm.plan.action.refreshLayout')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefreshFor(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (refreshFor !== null) patchLine(refreshFor, { refreshLayout: true });
                setRefreshFor(null);
              }}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('atm.plan.confirm.refreshManual')}
        </p>
      </SettlementDialog>
    </PageContainer>
  );
};
