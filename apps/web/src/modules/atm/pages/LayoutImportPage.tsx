// /atm/settlements/layouts/import «استيراد من Full list» (docs/12-planning/atm-settlements-phase1.md
// §5, §9.5, S-1) — the one-off seed of the cassette layouts from a bank's daily Master workbook, in
// the work branch: preview, the differences report, apply.
//
// THE PREVIEW IS THE POINT, as on the register import: the file is read twice — once to see what
// would happen (nothing is written), once for real — and the SAME file travels both times with the
// preview's hash, so the server refuses (409) bytes that are not the ones that were looked at. The
// apply also carries the revision of every layout the preview saw; one saved by hand since is a
// conflict and is never written (DS-7, SEC-8).
//
// AN UPLOAD FORM, NOT A FILTERED LIST: the bank select picks the file's import profile and the
// table previews one upload; nothing here narrows a stored list, so nothing is remembered.
import { useState } from 'react';
import {
  ATM_BANK_NAMES,
  ATM_LAYOUT_IMPORT_FLAGS,
  ATM_LAYOUT_IMPORT_MODES,
  ATM_LAYOUT_IMPORT_OUTCOMES,
  type AtmBankCode,
  type AtmLayoutImportMode,
  type AtmLayoutImportOutcome,
  type AtmLayoutImportResultDto,
  type AtmLayoutImportRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useAppSelector } from '../../../store';
import { saveBlob } from '../../../shared/lib/api-client';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { Button } from '../../../shared/ui/Button';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Dialog } from '../../../shared/ui/Dialog';
import { FileUpload } from '../../../shared/ui/FileUpload';
import { Checkbox, Field, Select } from '../../../shared/ui/form';
import { DownloadIcon } from '../../../shared/ui/icons';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useImportLayouts,
  useLayoutImportRuns,
  useSettlementContext,
} from '../api/settlements-queries';
import { BlockedNotice } from '../components/settlements/DayField';
import { LayoutChips } from '../components/settlements/LineChips';
import { buildImportReportXlsx, importReportWords } from '../lib/papers/import-report-xlsx';
import { cairoDay, cairoToday, formatPaperDate } from '../lib/settlement-dates';
import {
  blockedKey,
  blockedOf,
  lastImportFigures,
  settlementErrorText,
} from '../lib/settlement-view';

const XLSX = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The upload cap (§5.1 `MASTER_IMPORT_MAX_MB`). */
const MAX_MB = 10;

/** The rows an apply may write, with the revision the preview saw (§5.4). */
const WRITABLE: readonly AtmLayoutImportOutcome[] = ['new', 'changed', 'changedManual'];

/** What an apply in `mode` would create and update, by the preview's counts. */
export const applyEstimate = (
  counts: Readonly<Record<AtmLayoutImportOutcome, number>>,
  mode: AtmLayoutImportMode,
): { created: number; updated: number } => ({
  created: counts.new,
  updated:
    mode === 'newOnly'
      ? 0
      : counts.changed + (mode === 'overwriteManual' ? counts.changedManual : 0),
});

export const LayoutImportPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const context = useSettlementContext('import');
  const ctx = context.data;
  const banks = ctx?.banks ?? [];
  const [bankChoice, setBankChoice] = useState<AtmBankCode | null>(null);
  const bank: AtmBankCode | null = bankChoice ?? banks[0] ?? null;
  const branchId = ctx?.branch?.id ?? null;
  const ready = ctx !== undefined && ctx.blocked === null && branchId !== null && bank !== null;
  const bankCode: AtmBankCode = bank ?? 'BRK';

  const runs = useLayoutImportRuns({ bankCode, branchId }, ready);
  const importer = useImportLayouts();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AtmLayoutImportResultDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AtmLayoutImportOutcome | null>(null);
  const [mode, setMode] = useState<AtmLayoutImportMode>('newOnly');
  const [withLoads, setWithLoads] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const blocked = ctx?.blocked ?? blockedOf(runs.error) ?? null;

  const show = (next: AtmLayoutImportResultDto | null): void => {
    setResult(next);
    setOutcome(null);
  };

  const preview = (): void => {
    if (file === null || bank === null || branchId === null) return;
    setError(null);
    importer.mutate(
      { file, options: { bankCode: bank, branchId } },
      {
        onSuccess: show,
        onError: (e) => {
          show(null);
          setError(settlementErrorText(e, t, locale));
        },
      },
    );
  };

  const apply = (): void => {
    setConfirmOpen(false);
    if (file === null || result === null || bank === null || branchId === null) return;
    setError(null);
    importer.mutate(
      {
        file,
        options: {
          bankCode: bank,
          branchId,
          apply: {
            mode,
            fileSha256: result.fileSha256,
            previewRevisions: result.rows
              .filter((row) => WRITABLE.includes(row.outcome) && row.machineId !== null)
              .map((row) => ({ machineId: row.machineId as string, revision: row.revision })),
            standardLoads: withLoads,
          },
        },
      },
      {
        onSuccess: (applied) => {
          show(applied);
          const counts = applied.applyCounts;
          if (counts === null) return;
          toast.success(
            t('atm.layoutImport.result', {
              created: formatNumber(counts.created, locale),
              updated: formatNumber(counts.updated, locale),
            }),
          );
          if (counts.conflicts > 0) {
            toast.warning(
              t('atm.layoutImport.conflicts', {
                conflicts: formatNumber(counts.conflicts, locale),
              }),
            );
          }
        },
        onError: (e) => setError(settlementErrorText(e, t, locale)),
      },
    );
  };

  const download = (): void => {
    if (result === null) return;
    const { blob, filename } = buildImportReportXlsx(result, importReportWords(t), cairoToday());
    saveBlob(blob, filename);
  };

  const notes = (row: AtmLayoutImportRowDto): string =>
    [
      ...row.flags.map((flag) => t(`atm.layoutImport.flag.${flag}`)),
      ...(row.outcome === 'noRegisterBank' && row.bankName !== null
        ? [t('atm.layoutImport.bankName', { name: row.bankName })]
        : []),
    ].join(' · ');

  const columns: Column<AtmLayoutImportRowDto>[] = [
    {
      key: 'row',
      header: t('atm.layoutImport.column.row'),
      render: (row) => formatNumber(row.row, locale),
    },
    {
      key: 'code',
      header: t('atm.settlement.machineCode'),
      render: (row) => (
        <span dir="ltr" className="font-medium">
          {row.code ?? '—'}
        </span>
      ),
    },
    {
      key: 'name',
      header: t('atm.settlement.machineName'),
      render: (row) => row.machineName ?? '—',
    },
    {
      key: 'outcome',
      header: t('atm.layoutImport.column.outcome'),
      render: (row) => t(`atm.layoutImport.outcome.${row.outcome}`),
    },
    { key: 'notes', header: t('atm.layoutImport.column.notes'), render: notes },
    {
      key: 'before',
      header: t('atm.layoutImport.column.before'),
      render: (row) => (row.before === null ? '—' : <LayoutChips slots={row.before} />),
    },
    {
      key: 'after',
      header: t('atm.layoutImport.column.after'),
      render: (row) => (row.after === null ? '—' : <LayoutChips slots={row.after} />),
    },
  ];

  if (blocked !== null) {
    return (
      <PageContainer>
        <PageHeader title={t('atm.layoutImport.title')} />
        <BlockedNotice text={t(blockedKey(blocked))} />
      </PageContainer>
    );
  }

  const last = runs.data?.[0] ?? null;
  const lastFigures = last === null ? null : lastImportFigures(last.counts);
  const estimate = result === null ? null : applyEstimate(result.counts, mode);
  const shown =
    result === null ? [] : result.rows.filter((r) => outcome === null || r.outcome === outcome);

  return (
    <PageContainer>
      <PageHeader title={t('atm.layoutImport.title')} />
      {context.isLoading ? (
        <LoadingState />
      ) : (
        <div className="space-y-6">
          {/* ── The upload ── */}
          <section
            data-import-upload="true"
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('atm.settlement.bank')} htmlFor="import-bank">
                <Select
                  id="import-bank"
                  value={bank ?? ''}
                  onChange={(e) => {
                    setBankChoice(e.target.value as AtmBankCode);
                    show(null);
                  }}
                >
                  {banks.map((b) => (
                    <option key={b} value={b}>
                      {ATM_BANK_NAMES[b][locale]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="space-y-1.5">
                <span className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t('atm.layoutImport.branch')}
                </span>
                <p className="flex h-10 items-center text-sm text-slate-800 dark:text-slate-100">
                  {ctx?.branch?.name[locale] ?? '—'}
                </p>
              </div>
            </div>
            <Field label={t('atm.layoutImport.file')}>
              <FileUpload
                accept={XLSX}
                maxSizeMb={MAX_MB}
                onFiles={(files) => {
                  setFile(files[0] ?? null);
                  show(null);
                  setError(null);
                }}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                loading={importer.isPending && result === null}
                disabled={file === null || !ready}
                onClick={preview}
              >
                {t('atm.layoutImport.preview')}
              </Button>
              {error !== null && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}
            </div>
          </section>

          {/* ── The last run, while there is no preview: counts only (§5.3) ── */}
          {result === null && last !== null && lastFigures !== null && (
            <section
              data-import-last-run="true"
              className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <p className="text-slate-700 dark:text-slate-200">
                {t('atm.layouts.lastImport', {
                  date: formatPaperDate(cairoDay(last.at)),
                  rows: formatNumber(lastFigures.rows, locale),
                  matched: formatNumber(lastFigures.matched, locale),
                  notFound: formatNumber(lastFigures.notFound, locale),
                  flags: formatNumber(lastFigures.review, locale),
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                {ATM_LAYOUT_IMPORT_OUTCOMES.map((o) => (
                  <span
                    key={o}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs dark:border-slate-700"
                  >
                    {t(`atm.layoutImport.outcome.${o}`)}
                    <strong className="tabular-nums">
                      {formatNumber(last.counts[o] ?? 0, locale)}
                    </strong>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── The report ── */}
          {result !== null && (
            <section className="space-y-4" data-import-report="true">
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t('atm.layoutImport.column.outcome')}
              >
                {ATM_LAYOUT_IMPORT_OUTCOMES.map((o) => (
                  <button
                    key={o}
                    type="button"
                    data-outcome-chip={o}
                    aria-pressed={outcome === o}
                    onClick={() => setOutcome((current) => (current === o ? null : o))}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                      outcome === o
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
                    )}
                  >
                    {t(`atm.layoutImport.outcome.${o}`)}
                    <strong className="tabular-nums">
                      {formatNumber(result.counts[o], locale)}
                    </strong>
                  </button>
                ))}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300" data-import-flags="true">
                {ATM_LAYOUT_IMPORT_FLAGS.map(
                  (flag) =>
                    `${t(`atm.layoutImport.flag.${flag}`)} ${formatNumber(result.flags[flag], locale)}`,
                ).join(' · ')}
              </p>
              <DataTable columns={columns} rows={shown} rowKey={(row) => String(row.row)} dense />

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t('atm.layoutImport.missing', {
                      n: formatNumber(result.missingFromFile.length, locale),
                    })}
                  </h2>
                  <ul
                    className="max-h-64 space-y-1 overflow-y-auto text-sm"
                    data-import-missing="true"
                  >
                    {result.missingFromFile.map((m) => (
                      <li key={m.machineId} className="flex gap-2">
                        <span dir="ltr" className="font-medium">
                          {m.machineCode}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">{m.machineName}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t('atm.layoutImport.standardLoads')}
                  </h2>
                  <ul className="space-y-1 text-sm" data-import-standard-loads="true">
                    {result.standardLoads.map((load) => (
                      <li key={load.row} className="flex flex-wrap gap-2">
                        <span dir="ltr" className="tabular-nums">
                          {load.notes
                            .map(
                              (n) => `${String(n.denomination)} × ${formatNumber(n.notes, locale)}`,
                            )
                            .join(' · ')}
                        </span>
                        <span className="text-slate-600 dark:text-slate-300">
                          {t(`atm.layoutImport.standardOutcome.${load.outcome}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" onClick={download}>
                  <DownloadIcon className="h-4 w-4" />
                  {t('atm.layoutImport.download')}
                </Button>
              </div>

              {/* An applied result is spent: its revisions are the ones just written, so a second
                  apply would only conflict — a new preview starts the next one. */}
              {ctx?.can.importLayouts === true && result.applyCounts === null && (
                <div
                  data-import-apply="true"
                  className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                >
                  <fieldset className="space-y-2">
                    <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      {t('atm.layoutImport.apply')}
                    </legend>
                    {ATM_LAYOUT_IMPORT_MODES.map((m) => (
                      <label
                        key={m}
                        className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
                      >
                        <input
                          type="radio"
                          name="import-mode"
                          value={m}
                          checked={mode === m}
                          onChange={() => setMode(m)}
                          className="h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        {t(`atm.layoutImport.mode.${m}`)}
                      </label>
                    ))}
                  </fieldset>
                  <Checkbox
                    label={t('atm.layoutImport.withStandardLoads')}
                    checked={withLoads}
                    onChange={(e) => setWithLoads(e.target.checked)}
                  />
                  <Button
                    loading={importer.isPending && result !== null}
                    disabled={file === null}
                    onClick={() => setConfirmOpen(true)}
                  >
                    {t('atm.layoutImport.apply')}
                  </Button>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        size="sm"
        title={t('atm.layoutImport.apply')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={apply}>{t('atm.layoutImport.apply')}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-700 dark:text-slate-200">
          {t('atm.layoutImport.confirm', {
            created: formatNumber(estimate?.created ?? 0, locale),
            updated: formatNumber(estimate?.updated ?? 0, locale),
          })}
        </p>
      </Dialog>
    </PageContainer>
  );
};
