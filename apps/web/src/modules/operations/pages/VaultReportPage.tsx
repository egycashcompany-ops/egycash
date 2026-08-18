// Vault roll-up (B6) — the legacy `/vault1_reports` screen.
//
// WHAT `/vault1_reports` ACTUALLY WAS (discovery §C, contad_app.js:1311-1333): a SHELL. It loaded
// `DataLists`, threw it away, and rendered a template carrying nothing but the session. Every
// figure on the page came from the client re-hitting `/vault1`, which ran two aggregations:
// a per-bank roll-up of what the vault holds, and the non-EGP breakdown of that same set.
//
// Both are one server answer here, and it runs through the SAME roll-up as the bank report. That
// is deliberate: legacy computed package counts two different ways over overlapping sets — per
// document on this screen, per currency line on the reports (Q26) — so the two screens disagreed
// about the same shipments. One code path cannot.
//
// NO DATE PICKER (Q32 PRESERVE): the legacy screen had one and both of its aggregations had their
// date filters commented out, so it was always all-time. That is also the right answer — "what is
// in the vault" is a question about now — so the control is dropped rather than reproduced dead.
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { useVaultReport } from '../api/operations-queries';
import { ReportView, type ReportRow } from '../components/ReportView';

export const VaultReportPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((s) => s.locale.locale);
  const report = useVaultReport();

  const rows: ReportRow[] = (report.data?.rows ?? []).map((row) => ({
    key: row.bankId ?? 'unattributed',
    label: row.bankName,
    unattributed: row.bankId === null,
    totals: row.totals,
  }));

  const foreign = report.data?.foreignCurrencies ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.vaultReport.title')}
        description={t('operations.vaultReport.subtitle')}
      />
      <ReportView
        keyHeader={t('operations.reports.bank')}
        rows={rows}
        grandTotal={report.data?.grandTotal}
        loading={report.isLoading}
        error={report.error}
        onRetry={() => void report.refetch()}
        empty={t('operations.vault.empty')}
      />

      {/* The legacy second aggregation. It is a VIEW of the totals above, not a second question —
          the server decides which currency is domestic so no screen has to carry that list. */}
      {report.data !== undefined && rows.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <div className="mb-2 text-sm font-semibold">
            {t('operations.vaultReport.foreign', { base: report.data.baseCurrencyCode })}
          </div>
          {foreign.length === 0 ? (
            <p className="text-sm text-slate-500">{t('operations.vaultReport.noForeign')}</p>
          ) : (
            <div className="space-y-1">
              {foreign.map((line) => (
                <div key={line.currencyId ?? line.currencyName} className="flex gap-2 text-sm">
                  <span className="tabular-nums">{formatNumber(line.amount, locale)}</span>
                  <span className="text-slate-500">{line.currencyName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
};
