// التقارير — the printed statements.
//
// Five reports behind one grant, chosen from a list on the left. Each renders on screen and prints
// through the same EGYCASH letterhead the business already files: the print is the deliverable, and
// the screen is the preview of it.
//
// The two fund reports are the ones with real arithmetic behind them (see the API's reports
// service): a closing balance is the CURRENT balance rewound backwards, never a forward sum.
import { useMemo, useState } from 'react';
import { type GoldMetalType } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Button } from '../../../shared/ui/Button';
import { Card, CardBody } from '../../../shared/ui/Card';
import { Field, Input, Select } from '../../../shared/ui/form';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { PrinterIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  useGoldBranches,
  useGoldClientBalances,
  useGoldFundClosing,
  useGoldFundMovement,
} from '../api/gold-queries';
import { metalLabel, metalOptions } from '../components/gold-labels';
import { useGoldCompanyOptions } from '../components/useGoldCompanyOptions';
import { fmtDecimal2, fmtNumber } from '../lib/gold-format';
import { printFundClosingHtml, printReportHtml } from '../lib/gold-print';

type ReportId = 'gold' | 'silver' | 'control' | 'movement' | 'closing';

const Th = ({ children }: { children: React.ReactNode }): JSX.Element => (
  <th className="border-b border-slate-200 px-3 py-2 text-start text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
    {children}
  </th>
);
const Td = ({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}): JSX.Element => (
  <td
    className={`border-b border-slate-100 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200 ${className}`}
  >
    {children}
  </td>
);

/** Every report shares the same shell: a title, a print button, and its own body. */
const ReportShell = ({
  title,
  subtitle,
  onPrint,
  children,
}: {
  title: string;
  subtitle?: string;
  onPrint: () => void;
  children: React.ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50">{title}</h2>
          {subtitle !== undefined && (
            <p className="text-sm text-brand-700 dark:text-brand-300">{subtitle}</p>
          )}
        </div>
        <Button
          variant="secondary"
          leftIcon={<PrinterIcon className="h-4 w-4" />}
          onClick={onPrint}
        >
          {t('gold.common.print')}
        </Button>
      </div>
      {children}
    </div>
  );
};

const BalancesReport = ({
  metalType,
  subtitle,
  branch,
}: {
  metalType: GoldMetalType;
  subtitle: string;
  branch: string;
}): JSX.Element => {
  const t = useT();
  const [funds, setFunds] = useState<string[]>([]);
  const clients = useGoldCompanyOptions();
  const { data, isFetching, isError, error, refetch } = useGoldClientBalances({
    metalType,
    funds: funds.length === 0 ? undefined : funds,
  });
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { count: 0, weight: 0 };
  const title = t('gold.reports.balancesTitle');

  const doPrint = (): void => {
    const ok = printReportHtml({
      title,
      subtitle,
      branch,
      note: t('gold.reports.metalNote', { metal: metalLabel(t, metalType) }),
      table: {
        head: [
          t('gold.reports.serialColumn'),
          t('gold.reports.clientName'),
          t('gold.reports.barsCount'),
          t('gold.reports.totalWeight'),
        ],
        rows: rows.map((row, index) => [
          index + 1,
          row.name,
          fmtNumber(row.count),
          fmtDecimal2(row.weight),
        ]),
        total: [
          '',
          t('gold.reports.vaultTotal'),
          t('gold.reports.barsUnit', { count: fmtNumber(totals.count) }),
          t('gold.reports.gramsUnit', { value: fmtDecimal2(totals.weight) }),
        ],
      },
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  return (
    <ReportShell title={title} subtitle={subtitle} onPrint={doPrint}>
      <div className="mb-4">
        <MultiSelect
          label={t('gold.reports.clients')}
          options={clients}
          value={funds}
          onChange={setFunds}
        />
      </div>
      {isFetching ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full">
            <thead>
              <tr>
                <Th>{t('gold.reports.serialColumn')}</Th>
                <Th>{t('gold.reports.clientName')}</Th>
                <Th>{t('gold.reports.barsCount')}</Th>
                <Th>{t('gold.reports.totalWeight')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <Td className="text-center text-slate-500">{t('gold.reports.noData')}</Td>
                  <Td />
                  <Td />
                  <Td />
                </tr>
              )}
              {rows.map((row, index) => (
                <tr key={row.companyId}>
                  <Td>{index + 1}</Td>
                  <Td className="font-medium">{row.name}</Td>
                  <Td>{fmtNumber(row.count)}</Td>
                  <Td>{fmtDecimal2(row.weight)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-brand-50 dark:bg-brand-950/40">
                <Td className="font-bold">—</Td>
                <Td className="font-bold">{t('gold.reports.vaultTotal')}</Td>
                <Td className="font-bold">
                  {t('gold.reports.barsUnit', { count: fmtNumber(totals.count) })}
                </Td>
                <Td className="font-bold">
                  {t('gold.reports.gramsUnit', { value: fmtDecimal2(totals.weight) })}
                </Td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportShell>
  );
};

/** Shared period controls: metal, year, and one or two months. */
const PeriodControls = ({
  metalType,
  setMetalType,
  year,
  setYear,
  fromMonth,
  setFromMonth,
  toMonth,
  setToMonth,
  singleMonth = false,
  funds,
  setFunds,
}: {
  metalType: GoldMetalType;
  setMetalType: (value: GoldMetalType) => void;
  year: number;
  setYear: (value: number) => void;
  fromMonth: number;
  setFromMonth: (value: number) => void;
  toMonth: number;
  setToMonth: (value: number) => void;
  singleMonth?: boolean;
  funds: string[];
  setFunds: (value: string[]) => void;
}): JSX.Element => {
  const t = useT();
  const fundOptions = useGoldCompanyOptions('fund');
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <Field label={t('gold.common.metalType')}>
        <Select
          value={metalType}
          className="w-36"
          onChange={(e) => {
            setMetalType(e.target.value as GoldMetalType);
          }}
        >
          {metalOptions(t).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('gold.reports.year')}>
        <Input
          type="number"
          value={year}
          className="w-28"
          onChange={(e) => {
            setYear(Number(e.target.value) || year);
          }}
        />
      </Field>
      <Field label={singleMonth ? t('gold.reports.month') : t('gold.reports.fromMonth')}>
        <Input
          type="number"
          min={1}
          max={12}
          value={fromMonth}
          className="w-24"
          onChange={(e) => {
            const month = Number(e.target.value) || 1;
            setFromMonth(month);
            if (singleMonth) setToMonth(month);
          }}
        />
      </Field>
      {!singleMonth && (
        <Field label={t('gold.reports.toMonth')}>
          <Input
            type="number"
            min={1}
            max={12}
            value={toMonth}
            className="w-24"
            onChange={(e) => {
              setToMonth(Number(e.target.value) || 1);
            }}
          />
        </Field>
      )}
      <MultiSelect
        label={t('gold.reports.funds')}
        options={fundOptions}
        value={funds}
        onChange={setFunds}
      />
    </div>
  );
};

const ControlReport = ({ branch }: { branch: string }): JSX.Element => {
  const t = useT();
  const now = new Date();
  const [metalType, setMetalType] = useState<GoldMetalType>('gold');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [funds, setFunds] = useState<string[]>([]);
  const { data, isFetching, isError, error, refetch } = useGoldFundMovement({
    metalType,
    year,
    fromMonth: month,
    toMonth: month,
    funds: funds.length === 0 ? undefined : funds,
  });
  const rows = (data?.rows ?? []).map((row) => ({
    companyId: row.companyId,
    name: row.name,
    count: row.balanceCount,
    weight: row.balanceWeight,
  }));
  const totals = {
    count: data?.totals.balanceCount ?? 0,
    weight: data?.totals.balanceWeight ?? 0,
  };
  const title = t('gold.reports.controlTitle', { metal: metalLabel(t, metalType) });

  const doPrint = (): void => {
    const ok = printReportHtml({
      title,
      subtitle: t('gold.reports.forMonth', { month, year }),
      branch,
      note: t('gold.reports.metalNote', { metal: metalLabel(t, metalType) }),
      table: {
        head: [
          t('gold.reports.serialColumn'),
          t('gold.reports.fundName'),
          t('gold.reports.barsCount'),
          t('gold.reports.barsWeightGrams'),
        ],
        rows: rows.map((row, index) => [
          index + 1,
          row.name,
          fmtNumber(row.count),
          fmtDecimal2(row.weight),
        ]),
        total: [
          '',
          t('gold.reports.grandTotal'),
          fmtNumber(totals.count),
          fmtDecimal2(totals.weight),
        ],
      },
      signature: `<span class="line">${t('gold.reports.signatureLine')}</span><div class="who">${t('gold.reports.signatureWho')}</div>`,
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  return (
    <ReportShell
      title={t('gold.reports.control')}
      subtitle={t('gold.reports.controlSubtitle')}
      onPrint={doPrint}
    >
      <PeriodControls
        metalType={metalType}
        setMetalType={setMetalType}
        year={year}
        setYear={setYear}
        fromMonth={month}
        setFromMonth={setMonth}
        toMonth={month}
        setToMonth={setMonth}
        singleMonth
        funds={funds}
        setFunds={setFunds}
      />
      {isFetching ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full">
            <thead>
              <tr>
                <Th>{t('gold.reports.serialColumn')}</Th>
                <Th>{t('gold.reports.fundName')}</Th>
                <Th>{t('gold.reports.barsCount')}</Th>
                <Th>{t('gold.reports.barsWeightGrams')}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <Td className="text-center text-slate-500">{t('gold.reports.noFunds')}</Td>
                  <Td />
                  <Td />
                  <Td />
                </tr>
              )}
              {rows.map((row, index) => (
                <tr key={row.companyId}>
                  <Td>{index + 1}</Td>
                  <Td className="font-medium">{row.name}</Td>
                  <Td>{fmtNumber(row.count)}</Td>
                  <Td>{fmtDecimal2(row.weight)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-brand-50 dark:bg-brand-950/40">
                <Td className="font-bold">—</Td>
                <Td className="font-bold">{t('gold.reports.grandTotal')}</Td>
                <Td className="font-bold">{fmtNumber(totals.count)}</Td>
                <Td className="font-bold">{fmtDecimal2(totals.weight)}</Td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ReportShell>
  );
};

const MovementReport = ({ branch }: { branch: string }): JSX.Element => {
  const t = useT();
  const now = new Date();
  const [metalType, setMetalType] = useState<GoldMetalType>('gold');
  const [year, setYear] = useState(now.getFullYear());
  const [fromMonth, setFromMonth] = useState(now.getMonth() + 1);
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const [funds, setFunds] = useState<string[]>([]);
  const { data, isFetching, isError, error, refetch } = useGoldFundMovement({
    metalType,
    year,
    fromMonth,
    toMonth,
    funds: funds.length === 0 ? undefined : funds,
  });
  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const heads = [
    t('gold.reports.fundName'),
    t('gold.reports.inBars'),
    t('gold.reports.outBars'),
    t('gold.reports.inWeight'),
    t('gold.reports.outWeight'),
    t('gold.reports.netGrams'),
    t('gold.reports.barsCount'),
    t('gold.reports.closingBalance'),
  ];

  const doPrint = (): void => {
    const ok = printReportHtml({
      title: t('gold.reports.movementTitle', { metal: metalLabel(t, metalType) }),
      subtitle: t('gold.reports.period', { from: fromMonth, to: toMonth, year }),
      branch,
      note: t('gold.reports.metalNote', { metal: metalLabel(t, metalType) }),
      table: {
        head: heads,
        rows: rows.map((row) => [
          row.name,
          row.inCount,
          row.outCount,
          fmtDecimal2(row.inWeight),
          fmtDecimal2(row.outWeight),
          fmtDecimal2(row.netWeight),
          row.balanceCount,
          fmtDecimal2(row.balanceWeight),
        ]),
        // The totals row is omitted entirely while the numbers are still loading, rather than
        // printed as a row of zeros.
        ...(totals === undefined
          ? {}
          : {
              total: [
                t('gold.reports.grandTotal'),
                totals.inCount,
                totals.outCount,
                fmtDecimal2(totals.inWeight),
                fmtDecimal2(totals.outWeight),
                fmtDecimal2(totals.netWeight),
                totals.balanceCount,
                fmtDecimal2(totals.balanceWeight),
              ],
            }),
      },
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  return (
    <ReportShell
      title={t('gold.reports.movement')}
      subtitle={t('gold.reports.movementSubtitle', { metal: metalLabel(t, metalType) })}
      onPrint={doPrint}
    >
      <PeriodControls
        metalType={metalType}
        setMetalType={setMetalType}
        year={year}
        setYear={setYear}
        fromMonth={fromMonth}
        setFromMonth={setFromMonth}
        toMonth={toMonth}
        setToMonth={setToMonth}
        funds={funds}
        setFunds={setFunds}
      />
      {isFetching ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full">
            <thead>
              <tr>
                {heads.map((head) => (
                  <Th key={head}>{head}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <Td className="text-center text-slate-500">{t('gold.reports.noMovement')}</Td>
                  {heads.slice(1).map((head) => (
                    <Td key={head} />
                  ))}
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.companyId}>
                  <Td className="font-medium">{row.name}</Td>
                  <Td>{row.inCount}</Td>
                  <Td>{row.outCount}</Td>
                  <Td>{fmtDecimal2(row.inWeight)}</Td>
                  <Td>{fmtDecimal2(row.outWeight)}</Td>
                  <Td
                    className={
                      row.netWeight < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }
                  >
                    {fmtDecimal2(row.netWeight)}
                  </Td>
                  <Td>{row.balanceCount}</Td>
                  <Td>{fmtDecimal2(row.balanceWeight)}</Td>
                </tr>
              ))}
            </tbody>
            {totals !== undefined && (
              <tfoot>
                <tr className="bg-brand-50 font-bold dark:bg-brand-950/40">
                  <Td className="font-bold">{t('gold.reports.grandTotal')}</Td>
                  <Td className="font-bold">{totals.inCount}</Td>
                  <Td className="font-bold">{totals.outCount}</Td>
                  <Td className="font-bold">{fmtDecimal2(totals.inWeight)}</Td>
                  <Td className="font-bold">{fmtDecimal2(totals.outWeight)}</Td>
                  <Td className="font-bold">{fmtDecimal2(totals.netWeight)}</Td>
                  <Td className="font-bold">{totals.balanceCount}</Td>
                  <Td className="font-bold">{fmtDecimal2(totals.balanceWeight)}</Td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </ReportShell>
  );
};

const ClosingReport = ({ branch }: { branch: string }): JSX.Element => {
  const t = useT();
  const now = new Date();
  const [metalType, setMetalType] = useState<GoldMetalType>('gold');
  const [year, setYear] = useState(now.getFullYear());
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(now.getMonth() + 1);
  const [funds, setFunds] = useState<string[]>([]);
  const { data, isFetching, isError, error, refetch } = useGoldFundClosing({
    metalType,
    year,
    fromMonth,
    toMonth,
    funds: funds.length === 0 ? undefined : funds,
  });
  const list = data?.funds ?? [];
  const heads = [
    t('gold.reports.monthYear'),
    t('gold.reports.inBars'),
    t('gold.reports.outBars'),
    t('gold.reports.inWeight'),
    t('gold.reports.outWeight'),
    t('gold.reports.netGrams'),
    t('gold.reports.barsCount'),
    t('gold.reports.closingBalance'),
  ];

  const doPrint = (): void => {
    const ok = printFundClosingHtml({
      title: t('gold.reports.closingTitle'),
      branch,
      metalLabel: metalLabel(t, metalType),
      funds: list.map((fund) => ({ name: fund.name, rows: fund.rows })),
    });
    if (!ok) toast.error(t('gold.common.popupBlocked'));
  };

  return (
    <ReportShell
      title={t('gold.reports.closingTitle')}
      subtitle={t('gold.reports.closingSubtitle', { metal: metalLabel(t, metalType) })}
      onPrint={doPrint}
    >
      <PeriodControls
        metalType={metalType}
        setMetalType={setMetalType}
        year={year}
        setYear={setYear}
        fromMonth={fromMonth}
        setFromMonth={setFromMonth}
        toMonth={toMonth}
        setToMonth={setToMonth}
        funds={funds}
        setFunds={setFunds}
      />
      {isFetching ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="space-y-6">
          {list.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('gold.reports.noFunds')}
            </p>
          )}
          {list.map((fund) => (
            <div key={fund.companyId}>
              <div className="mb-2 rounded-lg bg-brand-50 px-3 py-2 font-bold text-brand-800 ring-1 ring-brand-200 dark:bg-brand-950/40 dark:text-brand-200 dark:ring-brand-900">
                {fund.name}
              </div>
              <div className="max-h-[420px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white dark:bg-slate-900">
                    <tr>
                      {heads.map((head) => (
                        <Th key={head}>{head}</Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {fund.rows.map((row) => (
                      <tr key={`${String(row.year)}-${String(row.month)}`}>
                        <Td className="font-medium">
                          {row.year}-{String(row.month).padStart(2, '0')}
                        </Td>
                        <Td>{row.inCount}</Td>
                        <Td>{row.outCount}</Td>
                        <Td>{fmtDecimal2(row.inWeight)}</Td>
                        <Td>{fmtDecimal2(row.outWeight)}</Td>
                        <Td
                          className={
                            row.netWeight > 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }
                        >
                          {fmtDecimal2(row.netWeight)}
                        </Td>
                        <Td>{row.balanceCount}</Td>
                        <Td>{fmtDecimal2(row.balanceWeight)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </ReportShell>
  );
};

export const GoldReportsPage = (): JSX.Element => {
  const t = useT();
  const [active, setActive] = useState<ReportId>('gold');
  const branches = useGoldBranches();

  // The branch printed on the letterhead: the one branch in scope, or nothing when the reader sees
  // several — a statement headed with the wrong branch is worse than one headed with none.
  const branch = useMemo(() => {
    const items = branches.data ?? [];
    return items.length === 1 ? (items[0]?.name.ar ?? '') : '';
  }, [branches.data]);

  const reports: { id: ReportId; label: string }[] = [
    { id: 'gold', label: t('gold.reports.goldBalances') },
    { id: 'silver', label: t('gold.reports.silverBalances') },
    { id: 'control', label: t('gold.reports.control') },
    { id: 'movement', label: t('gold.reports.movement') },
    { id: 'closing', label: t('gold.reports.closing') },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('gold.nav.reports')}
        description={t('gold.reports.subtitle')}
        breadcrumbs={[
          { label: t('gold.module.title'), to: '/gold' },
          { label: t('gold.nav.reports') },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {reports.map((report) => (
            <button
              key={report.id}
              type="button"
              onClick={() => {
                setActive(report.id);
              }}
              className={`w-full rounded-lg border p-3 text-start text-sm transition ${
                active === report.id
                  ? 'border-brand-400 bg-brand-50 text-brand-900 dark:border-brand-600 dark:bg-brand-950/40 dark:text-brand-100'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {report.label}
            </button>
          ))}
          <p className="px-1 pt-2 text-[11px] text-slate-400">{t('gold.reports.more')}</p>
        </div>

        <Card>
          <CardBody>
            {active === 'gold' && (
              <BalancesReport
                metalType="gold"
                subtitle={t('gold.reports.goldBars')}
                branch={branch}
              />
            )}
            {active === 'silver' && (
              <BalancesReport
                metalType="silver"
                subtitle={t('gold.reports.silverBars')}
                branch={branch}
              />
            )}
            {active === 'control' && <ControlReport branch={branch} />}
            {active === 'movement' && <MovementReport branch={branch} />}
            {active === 'closing' && <ClosingReport branch={branch} />}
          </CardBody>
        </Card>
      </div>
    </PageContainer>
  );
};
