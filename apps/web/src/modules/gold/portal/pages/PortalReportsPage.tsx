// التقارير — معدل الحركة الشهرى and الإقفال الشهرى, for this customer alone.
//
// The same two reports the vault runs, and the SAME printed output: the customer prints the exact
// document their account manager would hand them. The server forces the fund filter to their own
// company, so the filters here are only the metal and the period.
//
// Both reports are about FUNDS — gold's own rule, in ported code this work does not edit. A
// customer registered as a company or an institution therefore has no rows, and is told why rather
// than left looking at an empty table.
import { useState } from 'react';
import { useT } from '../../../../platform/localization/useT';
import { Button } from '../../../../shared/ui/Button';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { EmptyState } from '../../../../shared/ui/states/EmptyState';
import { LoadingState } from '../../../../shared/ui/states/LoadingState';
import { PrinterIcon } from '../../../../shared/ui/icons';
import { metalLabel } from '../../components/gold-labels';
import { fmtDecimal2, fmtNumber } from '../../lib/gold-format';
import { printFundClosingHtml, printReportHtml } from '../../lib/gold-print';
import {
  useGoldPortalClosing,
  useGoldPortalMe,
  useGoldPortalMovement,
} from '../api/portal-queries';
import { PortalSection } from '../PortalList';

const METALS = ['gold', 'silver'] as const;
const num = (value: number): string => fmtDecimal2(value);

interface MovementRow {
  companyId: string;
  name: string;
  inCount: number;
  outCount: number;
  inWeight: number;
  outWeight: number;
  netWeight: number;
  balanceCount: number;
  balanceWeight: number;
}

const MovementReport = ({ metalType }: { metalType: string }): JSX.Element => {
  const t = useT();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const query = useGoldPortalMovement({ metalType, year, fromMonth, toMonth });

  const rows = (query.data?.rows ?? []) as MovementRow[];
  const totals = query.data?.totals;

  const head = [
    t('gold.reports.fundName'),
    t('gold.reports.inBars'),
    t('gold.reports.outBars'),
    t('gold.reports.inWeight'),
    t('gold.reports.outWeight'),
    t('gold.reports.netGrams'),
    t('gold.reports.barsCount'),
    t('gold.reports.closingBalance'),
  ];
  const asRow = (r: MovementRow): string[] => [
    r.name,
    fmtNumber(r.inCount),
    fmtNumber(r.outCount),
    num(r.inWeight),
    num(r.outWeight),
    num(r.netWeight),
    fmtNumber(r.balanceCount),
    num(r.balanceWeight),
  ];

  const print = (): void => {
    printReportHtml({
      title: t('gold.reports.movementTitle', { metal: metalLabel(t, metalType) }),
      subtitle: t('gold.reports.period', { from: fromMonth, to: toMonth, year }),
      table: {
        head,
        rows: rows.map(asRow),
        ...(totals === undefined
          ? {}
          : {
              total: [
                t('gold.reports.grandTotal'),
                fmtNumber(totals.inCount),
                fmtNumber(totals.outCount),
                num(totals.inWeight),
                num(totals.outWeight),
                num(totals.netWeight),
                fmtNumber(totals.balanceCount),
                num(totals.balanceWeight),
              ],
            }),
      },
    });
  };

  const columns: Column<MovementRow>[] = head.map((header, index) => ({
    key: String(index),
    header,
    align: index === 0 ? 'start' : 'end',
    render: (row) => asRow(row)[index] ?? '—',
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('gold.reports.year')}>
          <Input
            type="number"
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
          />
        </Field>
        <Field label={t('gold.reports.fromMonth')}>
          <Input
            type="number"
            value={String(fromMonth)}
            onChange={(e) => setFromMonth(Math.min(12, Math.max(1, Number(e.target.value) || 1)))}
          />
        </Field>
        <Field label={t('gold.reports.toMonth')}>
          <Input
            type="number"
            value={String(toMonth)}
            onChange={(e) => setToMonth(Math.min(12, Math.max(1, Number(e.target.value) || 12)))}
          />
        </Field>
        <Button variant="secondary" onClick={print} disabled={rows.length === 0}>
          <PrinterIcon className="h-4 w-4" /> {t('gold.common.print')}
        </Button>
      </div>
      {query.isLoading ? (
        <LoadingState />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.companyId}
          empty={
            <p className="py-8 text-center text-sm text-slate-500">
              {t('gold.portal.reports.empty')}
            </p>
          }
        />
      )}
    </div>
  );
};

const ClosingReport = ({ metalType }: { metalType: string }): JSX.Element => {
  const t = useT();
  const query = useGoldPortalClosing({ metalType });
  const funds = query.data?.funds ?? [];

  const print = (): void => {
    printFundClosingHtml({
      metalLabel: metalLabel(t, metalType),
      funds: funds.map((fund) => ({ name: fund.name, rows: fund.rows })),
    });
  };

  if (query.isLoading) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Button variant="secondary" onClick={print} disabled={funds.length === 0}>
        <PrinterIcon className="h-4 w-4" /> {t('gold.common.print')}
      </Button>
      {funds.length === 0 && (
        <EmptyState
          title={t('gold.portal.reports.empty')}
          description={t('gold.portal.reports.fundsOnly')}
        />
      )}
      {funds.map((fund) => (
        <div key={fund.companyId} className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">{fund.name}</h3>
          <DataTable
            columns={[
              {
                key: 'month',
                header: t('gold.reports.monthYear'),
                render: (r: (typeof fund.rows)[number]) =>
                  `${String(r.year)}-${String(r.month).padStart(2, '0')}`,
              },
              {
                key: 'inCount',
                header: t('gold.reports.inBars'),
                align: 'end',
                render: (r: (typeof fund.rows)[number]) => fmtNumber(r.inCount),
              },
              {
                key: 'outCount',
                header: t('gold.reports.outBars'),
                align: 'end',
                render: (r: (typeof fund.rows)[number]) => fmtNumber(r.outCount),
              },
              {
                key: 'inWeight',
                header: t('gold.reports.inWeight'),
                align: 'end',
                render: (r: (typeof fund.rows)[number]) => num(r.inWeight),
              },
              {
                key: 'outWeight',
                header: t('gold.reports.outWeight'),
                align: 'end',
                render: (r: (typeof fund.rows)[number]) => num(r.outWeight),
              },
              {
                key: 'balance',
                header: t('gold.reports.closingBalance'),
                align: 'end',
                render: (r: (typeof fund.rows)[number]) => num(r.balanceWeight),
              },
            ]}
            rows={fund.rows}
            rowKey={(r) => `${String(r.year)}-${String(r.month)}`}
          />
        </div>
      ))}
    </div>
  );
};

export const PortalReportsPage = (): JSX.Element => {
  const t = useT();
  const me = useGoldPortalMe();
  const [tab, setTab] = useState<'movement' | 'closing'>('movement');
  const [metalType, setMetalType] = useState<string>('gold');

  return (
    <PortalSection
      title={t('gold.portal.tabs.reports')}
      description={me.data?.companyType === 'fund' ? undefined : t('gold.portal.reports.fundsOnly')}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {(['movement', 'closing'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-3 py-1.5 text-sm ${
                tab === key
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t(`gold.portal.reports.${key}`)}
            </button>
          ))}
        </div>
        <Field label={t('gold.common.metalType')}>
          <Select value={metalType} onChange={(e) => setMetalType(e.target.value)}>
            {METALS.map((metal) => (
              <option key={metal} value={metal}>
                {metalLabel(t, metal)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {tab === 'movement' ? (
        <MovementReport metalType={metalType} />
      ) : (
        <ClosingReport metalType={metalType} />
      )}
    </PortalSection>
  );
};
