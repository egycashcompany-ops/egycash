// /atm/preparation «الشوالات والسيلزات» (docs/12-planning/atm-settlements-phase1.md §9.6, S-7) —
// Preparation closes each line's bags: it scans (or types) every cassette's seal and each bag's QR,
// then marks the line «تم التجهيز» for Control & Supplies to find it ready.
//
// A KEYBOARD-WEDGE SCANNER DRIVES THE PAGE. The first empty field takes the focus when a line opens;
// every scan ends with Enter (or a Tab) and the focus moves to the next field — bag 1's cassettes,
// bag 1's QR, bag 2's cassettes, bag 2's QR (GS-32) — and from the last one to «حفظ». After a save
// or «تم التجهيز» the focus returns to «المسلسل أو رقم الماكينة», ready for the next Note. A value
// with Arabic letters (the keyboard was on the Arabic layout) keeps the focus where it is.
//
// DUPLICATES WARN, NEVER BLOCK (S-7, DS-15): the form checks the line's own fields at once; the
// server checks every bag and seal of every day after a save, without naming a line outside reach.
//
// THE VALUES BEING SCANNED ARE THE USER'S (UI-21): seeded once when a line opens, never overwritten
// by the minute's refetch while unsaved, and re-applied onto the new version after a 409.
//
// THE DAY IS THE SERVER'S SUGGESTION (DS-25) — the earliest day from today with issued lines not yet
// prepared — and is never remembered; `bank` is; `line` is a selection.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ATM_BANK_NAMES,
  cleanScannedValue,
  normalizeAtmMachineCode,
  type AtmPreparationLineDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { BOARD_FRAME } from '../../../shared/ui/board-scroll';
import { SettlementDialog } from '../components/settlements/SettlementDialog';
import { Field, Input, Select } from '../../../shared/ui/form';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useMarkPrepared,
  usePreparationContext,
  usePreparationLines,
  useReopenPreparation,
  useSavePreparation,
} from '../api/settlements-queries';
import { CAPTURE_SAVE_ID, CapturePanel } from '../components/settlements/CapturePanel';
import { BlockedNotice, DayField } from '../components/settlements/DayField';
import { RunChip } from '../components/settlements/RunChip';
import { SettlementFigures } from '../components/settlements/SettlementFigures';
import {
  advanceStep,
  applyAdvance,
  fieldId,
  fieldOrder,
  isDirty,
  localDuplicates,
  mergeAfterConflict,
  requiredMissing,
  resolveConflict,
  saveBodyOf,
  seedOnce,
  setFieldValue,
  type AdvanceStep,
  type CaptureFieldId,
  type CaptureForm,
} from '../lib/preparation-form';
import {
  blockedKey,
  blockedOf,
  isStale,
  lineCode,
  PREPARATION_STATUS_TONE,
  preparationStatusKey,
  prepStateOf,
  runLabel,
  settlementErrorText,
  settlementErrorToast,
} from '../lib/settlement-view';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';

/** Remembered across visits: the bank. The day is the server's suggestion; `line` a selection. */
const REMEMBERED_FILTERS = ['bank'] as const;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const FIND_ID = 'prep-find';

/** The day's lines of one machine (or spare) code, in run order. */
export const linesOfCode = (
  lines: readonly AtmPreparationLineDto[],
  raw: string,
): AtmPreparationLineDto[] => {
  const value = cleanScannedValue(raw);
  if (value === null) return [];
  const code = normalizeAtmMachineCode(value);
  return lines
    .filter((l) => l.machineCode === code || l.spareCode === value)
    .sort((a, b) => a.run - b.run);
};

/**
 * «المسلسل أو رقم الماكينة» → the line to open: a Note's serial — or a voided one, which resolves to
 * its line's current serial — else a machine (or spare) code, whose first line not yet prepared
 * opens when it has two runs (the page then lists both, `atm.prep.codeLines`).
 */
export const findLine = (
  lines: readonly AtmPreparationLineDto[],
  raw: string,
): { line: AtmPreparationLineDto; voided: boolean } | null => {
  const value = cleanScannedValue(raw);
  if (value === null) return null;
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    const bySerial = lines.find((l) => l.serial === n);
    if (bySerial !== undefined) return { line: bySerial, voided: false };
    const byVoided = lines.find((l) => l.voidedSerials.includes(n));
    if (byVoided !== undefined) return { line: byVoided, voided: true };
  }
  const matches = linesOfCode(lines, value);
  const first = matches.find((l) => l.lineStatus === 'issued') ?? matches[0];
  return first === undefined ? null : { line: first, voided: false };
};

export const PreparationPage = (): JSX.Element => {
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

  // ── The day, the bank's plan, its lines ─────────────────────────────────────────────────────
  const dateParam = sp.get('date');
  const askedDay = dateParam !== null && DAY.test(dateParam) ? dateParam : null;
  const context = usePreparationContext(askedDay);
  const ctx = context.data;
  const blocked = blockedOf(context.error);
  const day = ctx?.date ?? askedDay ?? '';
  const plans = ctx?.plans ?? [];
  const bankParam = sp.get('bank');
  const plan = plans.find((p) => p.bankCode === bankParam) ?? plans[0] ?? null;
  const linesQuery = usePreparationLines(plan?.planId ?? null);
  const lines = useMemo(() => linesQuery.data ?? [], [linesQuery.data]);
  const lineParam = sp.get('line');
  const selected = lines.find((l) => l.lineId === lineParam) ?? null;

  // ── The form: seeded once per line, kept while unsaved ──────────────────────────────────────
  // What the user holds is `stored`; what the page shows is `seedOnce(stored, line)` — the stored
  // form while it is this line's and unsaved, the server's values otherwise — so a refetch never
  // overwrites a half-scanned bag and a clean form follows what a colleague saved.
  const [stored, setForm] = useState<CaptureForm | null>(null);
  const form = selected === null ? null : seedOnce(stored, selected);
  const dirty = form !== null && (isDirty(form) || form.conflicts.length > 0);
  const guard = useUnsavedGuard({ dirty });

  const fields = useRef(new Map<CaptureFieldId, HTMLInputElement>());
  const fieldRef = useCallback(
    (id: CaptureFieldId) => (el: HTMLInputElement | null) => {
      if (el === null) fields.current.delete(id);
      else fields.current.set(id, el);
    },
    [],
  );
  const focusFind = (): void => document.getElementById(FIND_ID)?.focus();

  const readOnly =
    selected === null ||
    ctx?.canCapture !== true ||
    selected.lineStatus === 'cancelled' ||
    selected.preparation.status === 'prepared';

  // The first empty field takes the focus when a line opens, so the first scan lands in it.
  const opened = form?.lineId ?? null;
  useEffect(() => {
    if (selected === null || form === null || readOnly) return;
    const first = fieldOrder(selected.preparation.bags)
      .map(fieldId)
      .find((id) => (form.values[id] ?? '').trim() === '');
    if (first === undefined) return;
    fields.current.get(first)?.focus();
  }, [opened, readOnly]);

  const [find, setFind] = useState('');
  const [findNote, setFindNote] = useState<string | null>(null);
  const openLine = (lineId: string | null): void => {
    if (lineId === selected?.lineId) return;
    guard.confirmLeave(() => {
      setForm(null);
      patch({ line: lineId });
    });
  };
  const onFind = (): void => {
    const hit = findLine(lines, find);
    if (hit === null) {
      setFindNote(t('atm.prep.notFound'));
      return;
    }
    // A code with more than one run lists them all (§9.6); the first not yet prepared is open.
    const runs = hit.voided ? [] : linesOfCode(lines, find);
    setFindNote(
      hit.voided && hit.line.serial !== null
        ? t('atm.prep.voidedSerial', { serial: formatNumber(hit.line.serial, locale) })
        : runs.length > 1 && runs.includes(hit.line)
          ? t('atm.prep.codeLines', {
              n: formatNumber(runs.length, locale),
              list: runs
                .map((l) =>
                  [
                    l.serial === null ? '—' : formatNumber(l.serial, locale),
                    runLabel(l.run, t),
                  ].join(' · '),
                )
                .join('، '),
            })
          : null,
    );
    setFind('');
    openLine(hit.line.lineId);
  };

  // ── Scanning ─────────────────────────────────────────────────────────────────────────────────
  const [arabic, setArabic] = useState<ReadonlySet<CaptureFieldId>>(new Set());
  useEffect(() => setArabic(new Set()), [opened]);
  const onChange = (id: CaptureFieldId, value: string): void => {
    if (form !== null) setForm(setFieldValue(form, id, value));
  };
  const saveButton = (): HTMLElement | null => document.getElementById(CAPTURE_SAVE_ID);
  const onAdvance = (id: CaptureFieldId): void => {
    if (form === null || selected === null) return;
    const cleaned = cleanScannedValue(form.values[id]) ?? '';
    setForm(setFieldValue(form, id, cleaned));
    const step = advanceStep(selected.preparation.bags, id, cleaned);
    setArabic((current) => {
      const next = new Set(current);
      if (step.kind === 'rescan') next.add(id);
      else next.delete(id);
      return next;
    });
    // Arabic letters: the keyboard layout was wrong — stay, the text selected, so the re-scan
    // replaces it. Selected again after the commit: React writing a changed (cleaned) value moves
    // the caret to the end.
    if (step.kind === 'rescan') rescan.current = step;
    applyAdvance(step, (f) => fields.current.get(f), saveButton);
  };
  const rescan = useRef<AdvanceStep | null>(null);
  useLayoutEffect(() => {
    const step = rescan.current;
    if (step === null) return;
    rescan.current = null;
    applyAdvance(step, (f) => fields.current.get(f), saveButton);
  });

  const duplicates = useMemo(() => (form === null ? [] : localDuplicates(form.values)), [form]);
  const missing = useMemo(() => {
    if (form === null || selected === null) return [];
    const valueOf = (id: CaptureFieldId): string | null => form.values[id] ?? null;
    return requiredMissing(
      {
        bags: selected.preparation.bags.map((b) => ({ ...b, qr: valueOf(`qr:${b.bag}`) })),
        seals: selected.preparation.seals.map((s) => ({ ...s, value: valueOf(`seal:${s.slot}`) })),
      },
      selected.slots,
    ).map((m) =>
      m.kind === 'seal'
        ? t('atm.prep.sealLabel', { slot: m.slot })
        : t(`atm.prep.qrLabel.${String(m.bag)}`),
    );
  }, [form, selected, t]);

  // ── Saving, «تم التجهيز», reopening ──────────────────────────────────────────────────────────
  const save = useSavePreparation();
  const mark = useMarkPrepared();
  const reopen = useReopenPreparation();
  const busy = save.isPending || mark.isPending || reopen.isPending;

  /** A 409: keep the user's values, read the line again, and put them back onto it (§9.6). */
  const merge = async (local: CaptureForm): Promise<void> => {
    const fresh = await linesQuery.refetch();
    const line = fresh.data?.find((l) => l.lineId === local.lineId);
    if (line !== undefined) setForm(mergeAfterConflict(local, line));
  };
  const refused = (local: CaptureForm) => (error: unknown) => {
    const words = settlementErrorToast(error, t, locale);
    toast.error(words.title, words.description);
    if (isStale(error)) void merge(local);
  };

  const saveNow = async (): Promise<AtmPreparationLineDto | null> => {
    if (form === null || selected === null) return null;
    const local = form;
    try {
      const { line } = await save.mutateAsync({
        lineId: selected.lineId,
        body: saveBodyOf(local, selected.preparation.bags),
      });
      setForm(seedOnce(null, line));
      return line;
    } catch (error) {
      refused(local)(error);
      return null;
    }
  };
  const onSave = async (): Promise<void> => {
    const line = await saveNow();
    if (line === null) return;
    toast.success(t('atm.prep.saved'));
    focusFind();
  };
  const onPrepared = async (): Promise<void> => {
    if (form === null || selected === null) return;
    // Unsaved values are saved first: «تم التجهيز» marks what the server holds.
    let version = form.version;
    if (isDirty(form)) {
      const line = await saveNow();
      if (line === null) return;
      version = line.preparation.version;
    }
    const local = form;
    mark.mutate(
      { lineId: selected.lineId, body: { version } },
      {
        onSuccess: ({ line }) => {
          setForm(seedOnce(null, line));
          focusFind();
        },
        onError: refused(local),
      },
    );
  };
  const onReopen = (): void => {
    if (form === null || selected === null) return;
    const local = form;
    reopen.mutate(
      { lineId: selected.lineId, body: { version: selected.preparation.version } },
      { onSuccess: ({ line }) => setForm(seedOnce(null, line)), onError: refused(local) },
    );
  };

  // ── The page ─────────────────────────────────────────────────────────────────────────────────
  if (blocked !== null) {
    return (
      <PageContainer>
        <PageHeader title={t('atm.prep.title')} />
        <BlockedNotice text={t(blockedKey(blocked))} />
      </PageContainer>
    );
  }

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27 «تثبت الفورم والفلتر وتخلي الجدول
          بس هو اللى يعمل Scroll»): on a computer the title and the toolbar keep their place, and
          only the lines — and the capture beside them — scroll. */}
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('atm.prep.title')}
          figures={
            <SettlementFigures
              label={t('atm.prep.title')}
              locale={locale}
              figures={[
                {
                  key: 'prepared',
                  label: t('atm.settlement.prep.prepared'),
                  value: plan?.prepared,
                },
                {
                  key: 'complete',
                  label: t('atm.settlement.prep.complete'),
                  value: plan?.complete,
                },
                { key: 'partial', label: t('atm.settlement.prep.partial'), value: plan?.partial },
                { key: 'none', label: t('atm.settlement.prep.none'), value: plan?.none },
              ]}
            />
          }
        />

        <div className="flex flex-wrap items-end gap-3" data-prep-toolbar="true">
          <DayField
            id="prep-day"
            value={day}
            onChange={(next) => guard.confirmLeave(() => patch({ date: next, line: null }))}
          />
          <Field label={t('atm.settlement.bank')} htmlFor="prep-bank">
            <Select
              id="prep-bank"
              value={plan?.bankCode ?? ''}
              disabled={plans.length === 0}
              onChange={(e) =>
                guard.confirmLeave(() => patch({ bank: e.target.value, line: null }))
              }
            >
              {plans.map((p) => (
                <option key={p.planId} value={p.bankCode}>
                  {ATM_BANK_NAMES[p.bankCode][locale]}
                </option>
              ))}
            </Select>
          </Field>
          <div className="min-w-64 space-y-1.5">
            <label
              htmlFor={FIND_ID}
              className="block text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              {t('atm.prep.find')}
            </label>
            <Input
              id={FIND_ID}
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                onFind();
              }}
            />
            <p aria-live="polite" className="min-h-4 text-xs text-amber-700 dark:text-amber-400">
              {findNote ?? ''}
            </p>
          </div>
        </div>

        {context.isLoading ? (
          <LoadingState />
        ) : ctx === undefined && context.error !== null ? (
          <ErrorState
            error={context.error}
            description={settlementErrorText(context.error, t, locale)}
            onRetry={() => void context.refetch()}
          />
        ) : plan !== null && linesQuery.data === undefined && linesQuery.error !== null ? (
          <ErrorState
            error={linesQuery.error}
            description={settlementErrorText(linesQuery.error, t, locale)}
            onRetry={() => void linesQuery.refetch()}
          />
        ) : plan !== null && linesQuery.isLoading ? (
          <LoadingState />
        ) : plan === null ? (
          <p
            data-prep-empty="true"
            className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            {t('atm.prep.empty')}
          </p>
        ) : (
          // The height left is the lines' and the capture's: each scrolls on its own. The lines'
          // head stays, opaque as `DataTable stickyHead` paints it; a phone scrolls as before.
          <div className="flex flex-col gap-4 lg:min-h-[14rem] lg:flex-1 lg:flex-row">
            <section
              aria-label={t('atm.prep.title')}
              className="relative min-w-0 overflow-x-auto rounded-xl border border-slate-200 bg-white lg:w-[440px] lg:shrink-0 lg:overflow-auto dark:border-slate-800 dark:bg-slate-900"
            >
              <table className="w-full border-collapse text-sm" data-prep-lines="true">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-800">
                  <tr className="text-xs text-slate-600 dark:text-slate-300">
                    <th className="px-3 py-2.5 text-start">{t('atm.settlement.serial')}</th>
                    <th className="px-3 py-2.5 text-start">{t('atm.settlement.machineCode')}</th>
                    <th className="px-3 py-2.5 text-start">{t('atm.settlement.run')}</th>
                    <th className="px-3 py-2.5 text-start">{t('atm.settlement.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const state = prepStateOf(line);
                    return (
                      <tr
                        key={line.lineId}
                        data-prep-line={line.lineId}
                        tabIndex={0}
                        aria-selected={line.lineId === selected?.lineId}
                        onClick={() => openLine(line.lineId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.target === e.currentTarget)
                            openLine(line.lineId);
                        }}
                        className={cn(
                          'cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60',
                          line.lineId === selected?.lineId && 'bg-brand-50/70 dark:bg-brand-950/40',
                          state === 'cancelled' && 'text-slate-400',
                        )}
                      >
                        <td className="px-3 py-2.5 tabular-nums">
                          {line.serial === null ? '—' : formatNumber(line.serial, locale)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span dir="ltr" className="font-medium">
                            {lineCode(line)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <RunChip run={line.run} time={line.scheduleTime} locale={locale} />
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            size="sm"
                            tone={
                              state === 'cancelled' ? 'neutral' : PREPARATION_STATUS_TONE[state]
                            }
                          >
                            {state === 'cancelled'
                              ? t('atm.settlement.status.cancelled')
                              : t(preparationStatusKey(state))}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
            {selected !== null && form !== null && (
              <section
                aria-label={lineCode(selected)}
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-4 lg:min-h-0 lg:overflow-y-auto dark:border-slate-800 dark:bg-slate-900"
              >
                <CapturePanel
                  line={selected}
                  form={form}
                  locale={locale}
                  readOnly={readOnly}
                  canCapture={ctx?.canCapture === true}
                  localDuplicates={duplicates}
                  arabicFields={arabic}
                  missing={missing}
                  busy={busy}
                  fieldRef={fieldRef}
                  onChange={onChange}
                  onAdvance={onAdvance}
                  onResolve={(id, choice) => setForm(resolveConflict(form, id, choice))}
                  onSave={() => void onSave()}
                  onPrepared={() => void onPrepared()}
                  onReopen={onReopen}
                />
              </section>
            )}
          </div>
        )}
      </div>

      <SettlementDialog
        open={guard.leaveOpen}
        onClose={guard.cancel}
        size="sm"
        title={t('atm.prep.title')}
        footer={
          <>
            <Button variant="secondary" onClick={guard.cancel}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={guard.confirm}>
              {t('common.continue')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('atm.prep.leave.body')}</p>
      </SettlementDialog>
    </PageContainer>
  );
};
