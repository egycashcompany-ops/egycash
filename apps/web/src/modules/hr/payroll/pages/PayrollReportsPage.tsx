// The payroll report builder (scope B1) — compose a report, preview it, save it.
//
// EVERY FIGURE ON THIS SCREEN IS THE SERVER'S. The grouping, the filtering, the totals and the
// calculated columns are all computed there, under the caller's own scope, and rendered here
// unchanged. A browser that worked out a subtotal would be showing a number nobody authorized —
// which is why the only arithmetic in this file is `fromMinorUnits`, the shared conversion every
// other payroll screen uses to print an amount.
//
// THE SAME SAVED REPORT MEANS DIFFERENT ROWS FOR DIFFERENT READERS, and that is the feature rather
// than a caveat: a definition holds no branch and no employee, so `scopeSelector` narrows it at
// execution — a branch-scoped reader sees their branch, an organization-scoped reader sees the
// company, with no ownership model to maintain. F-B1-1: a DEPARTMENT-scoped grant does not narrow a
// payslip read at all, because a payslip carries no department field; see the execution service.
import { useState } from 'react';
import {
  PAYROLL_REPORT_DIMENSIONS,
  PAYROLL_REPORT_MEASURES,
  fromMinorUnits,
  type CreatePayrollReportDefinition,
  type Locale,
  type PayrollReportDefinitionDto,
  type PayrollReportDimension,
  type PayrollReportMeasure,
  type PayrollReportResultDto,
} from '@ecms/contracts';
import { Can } from '../../../../platform/rbac/Can';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatMoney, formatNumber } from '../../../../shared/lib/format';
import { usePayrollRuns } from '../api/payroll-queries';
import {
  useCreateReportDefinition,
  useDeleteReportDefinition,
  usePreviewReport,
  useReportDefinitions,
  useUpdateReportDefinition,
} from '../api/report-queries';
import {
  CalculatedColumnBuilder,
  toColumn,
  toDraft,
  type ColumnDraft,
} from '../components/CalculatedColumnBuilder';

interface Draft {
  id: string | null;
  version: number;
  nameEn: string;
  nameAr: string;
  dimensions: PayrollReportDimension[];
  measures: PayrollReportMeasure[];
  columns: ColumnDraft[];
}

const emptyDraft = (): Draft => ({
  id: null,
  version: 0,
  nameEn: '',
  nameAr: '',
  dimensions: ['branch'],
  measures: ['amountMinor'],
  columns: [],
});

const toBody = (draft: Draft): CreatePayrollReportDefinition => ({
  name: { ar: draft.nameAr, en: draft.nameEn },
  description: null,
  sourceId: 'payrollRunLines',
  dimensions: draft.dimensions,
  measures: draft.measures,
  filters: [],
  sort: null,
  columns: draft.columns.filter((column) => column.key.trim() !== '').map(toColumn),
  status: 'active',
});

const fromDefinition = (definition: PayrollReportDefinitionDto): Draft => ({
  id: definition.id,
  version: definition.version,
  nameEn: definition.name.en,
  nameAr: definition.name.ar,
  dimensions: [...definition.dimensions],
  measures: [...definition.measures],
  columns: definition.columns.map(toDraft),
});

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

export const PayrollReportsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [runId, setRunId] = useState('');
  const [result, setResult] = useState<PayrollReportResultDto | null>(null);

  const definitions = useReportDefinitions({ page: 1, pageSize: 50 });
  const runs = usePayrollRuns({ page: 1, pageSize: 20 });
  const create = useCreateReportDefinition();
  const update = useUpdateReportDefinition();
  const remove = useDeleteReportDefinition();
  const preview = usePreviewReport();

  const save = (): void => {
    const body = toBody(draft);
    if (draft.id === null) {
      create.mutate(body, { onSuccess: (saved) => { setDraft(fromDefinition(saved)); } });
    } else {
      update.mutate(
        { id: draft.id, body: { ...body, version: draft.version } },
        { onSuccess: (saved) => { setDraft(fromDefinition(saved)); } },
      );
    }
  };

  const runPreview = (): void => {
    if (runId === '') return;
    preview.mutate({ runId, definition: toBody(draft) }, { onSuccess: setResult });
  };

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-0.5">
        <h1 className="text-lg font-medium">{t('payroll.reports.title')}</h1>
        <p className="text-xs text-slate-500">{t('payroll.reports.hint')}</p>
      </header>

      {/* ── Saved definitions ─────────────────────────────────────────── */}
      <section className="space-y-1 rounded border border-slate-200 p-3 dark:border-slate-700">
        <h2 className="text-sm font-medium">{t('payroll.reports.saved')}</h2>
        {definitions.data === undefined ? (
          <p className="text-xs text-slate-400">{t('common.loading')}</p>
        ) : definitions.data.items.length === 0 ? (
          <p className="text-xs text-slate-400">{t('payroll.reports.none')}</p>
        ) : (
          definitions.data.items.map((definition) => (
            <p key={definition.id} className="flex flex-wrap items-baseline gap-x-3 text-xs">
              <span>{definition.name[locale === 'ar' ? 'ar' : 'en']}</span>
              <span className="text-slate-400">{definition.dimensions.join(' · ')}</span>
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() => {
                  setDraft(fromDefinition(definition));
                  setResult(null);
                }}
              >
                {t('common.edit')}
              </button>
              <Can permission="payrollReport.manage">
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-600"
                  onClick={() => {
                    remove.mutate(definition.id);
                  }}
                >
                  {t('common.delete')}
                </button>
              </Can>
            </p>
          ))
        )}
      </section>

      {/* ── The editor ────────────────────────────────────────────────── */}
      <section className="space-y-3 rounded border border-slate-200 p-3 dark:border-slate-700">
        <h2 className="text-sm font-medium">{t('payroll.reports.editor')}</h2>

        <div className="flex flex-wrap gap-2 text-xs">
          <input
            className="w-48 rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
            value={draft.nameEn}
            placeholder={t('payroll.reports.nameEn')}
            onChange={(event) => { setDraft({ ...draft, nameEn: event.target.value }); }}
            aria-label={t('payroll.reports.nameEn')}
          />
          <input
            className="w-48 rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
            value={draft.nameAr}
            placeholder={t('payroll.reports.nameAr')}
            onChange={(event) => { setDraft({ ...draft, nameAr: event.target.value }); }}
            aria-label={t('payroll.reports.nameAr')}
          />
        </div>

        <div className="space-y-1">
          <h4 className="text-xs font-medium text-slate-500">{t('payroll.reports.dimensions')}</h4>
          <div className="flex flex-wrap gap-3 text-xs">
            {PAYROLL_REPORT_DIMENSIONS.map((dimension) => (
              <label key={dimension} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={draft.dimensions.includes(dimension)}
                  onChange={() => { setDraft({ ...draft, dimensions: toggle(draft.dimensions, dimension) }); }}
                />
                {t(`payroll.costReport.axis.${dimension}`)}
              </label>
            ))}
          </div>
          {/* Currency is in every key and is not offered as a choice — there is no exchange rate. */}
          <p className="text-xs text-slate-400">{t('payroll.reports.currencyAlways')}</p>
        </div>

        <div className="space-y-1">
          <h4 className="text-xs font-medium text-slate-500">{t('payroll.reports.measures')}</h4>
          <div className="flex flex-wrap gap-3 text-xs">
            {PAYROLL_REPORT_MEASURES.map((measure) => (
              <label key={measure} className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={draft.measures.includes(measure)}
                  onChange={() => { setDraft({ ...draft, measures: toggle(draft.measures, measure) }); }}
                />
                {t(`payroll.reports.field.${measure}`)}
              </label>
            ))}
          </div>
        </div>

        <CalculatedColumnBuilder
          columns={draft.columns}
          onChange={(columns) => { setDraft({ ...draft, columns }); }}
        />

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Can permission="payrollReport.manage">
            <button
              type="button"
              className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-50"
              disabled={create.isPending || update.isPending}
              onClick={save}
            >
              {draft.id === null ? t('common.create') : t('common.save')}
            </button>
          </Can>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 dark:border-slate-600"
            onClick={() => { setDraft(emptyDraft()); setResult(null); }}
          >
            {t('payroll.reports.newReport')}
          </button>
          {update.isError ? (
            // A 409 here means somebody else edited first; the list refetches on success, so the
            // honest instruction is to reopen the definition rather than to retry blindly.
            <span className="text-red-600">{t('payroll.reports.stale')}</span>
          ) : null}
        </div>
      </section>

      {/* ── Preview ───────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-700">
        <h2 className="text-sm font-medium">{t('payroll.reports.preview')}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select
            className="rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
            value={runId}
            onChange={(event) => { setRunId(event.target.value); }}
            aria-label={t('payroll.reports.run')}
          >
            <option value="">{t('payroll.reports.chooseRun')}</option>
            {(runs.data?.items ?? []).map((run) => (
              <option key={run.id} value={run.id}>
                {run.period}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-1 disabled:opacity-50 dark:border-slate-600"
            disabled={runId === '' || preview.isPending}
            onClick={runPreview}
          >
            {t('payroll.reports.runPreview')}
          </button>
        </div>

        {preview.isError ? <p className="text-xs text-red-600">{t('payroll.reports.failed')}</p> : null}

        {result === null ? null : result.rows.length === 0 ? (
          <p className="text-xs text-slate-400">{t('payroll.cost.nothingIssued')}</p>
        ) : (
          <div className="space-y-1">
            {result.rows.map((row, index) => (
              <p key={index} className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <span className="font-mono" dir="ltr">{row.currency}</span>
                {row.cells.map((cell) => (
                  <span key={cell.dimension}>
                    {cell.label === null
                      ? (cell.code ?? cell.id ?? t('payroll.costReport.unassigned'))
                      : cell.label[locale === 'ar' ? 'ar' : 'en']}
                  </span>
                ))}
                {result.measures.map((measure) => (
                  <span key={measure} dir="ltr" className="tabular-nums">
                    {measure === 'amountMinor'
                      ? formatMoney(fromMinorUnits(row.measures[measure] ?? 0), row.currency, locale)
                      : formatNumber(row.measures[measure] ?? 0, locale)}
                  </span>
                ))}
                {result.columns.map((key) => (
                  <span key={key} className="text-slate-500" dir="ltr">
                    {key}:{' '}
                    {row.calculated[key] === null || row.calculated[key] === undefined
                      ? '—'
                      : formatNumber(row.calculated[key] as number, locale)}
                  </span>
                ))}
              </p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
