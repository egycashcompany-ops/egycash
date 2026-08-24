// لوحة التحكم — the vault board.
//
// The gold dashboard, restyled: the seven counters across the top, bars-by-owner split into gold
// and silver, the two doughnuts, and twelve months of net flow. Everything on it is CURRENT
// inventory or CONFIRMED movement — drafts never reach this screen, which is what lets it be read
// as a statement of what is in the building right now.
//
// Chart colours are metal colours, not brand colours: gold is gold and silver is silver in either
// theme, because that is what the reader is looking for.
import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { Card, CardBody, CardHeader } from '../../../shared/ui/Card';
import { LoadingState } from '../../../shared/ui/states/LoadingState';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { StatStrip } from '../../../shared/ui/StatStrip';
import { useGoldDashboardCharts, useGoldDashboardStats } from '../api/gold-queries';
import { metalLabel } from '../components/gold-labels';
import { fmtKilos, fmtNumber, fmtWeightValue } from '../lib/gold-format';

const METAL_COLOURS: Record<string, string> = { gold: '#d8b24e', silver: '#a8a8a8' };
const PALETTE = ['#d8b24e', '#e7cd7a', '#a3762a', '#c69434', '#f3e3ad', '#26345f'];
const OWNER_COLOURS = ['#3ba88f', '#8b6fc7'];
/** How many owners the bar chart shows before the picker is used. */
const DEFAULT_OWNERS = 8;

const compact = (value: number): string => {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}K`;
  return String(n);
};

/** The company picker remembers what you last looked at, as gold's dashboard did. */
const OWNERS_KEY = 'ecms.gold.dashboard.companies';

const readOwners = (): string[] => {
  try {
    const raw = window.localStorage.getItem(OWNERS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    // Private mode, or a stale value someone hand-edited. A dashboard that cannot remember works.
    return [];
  }
};

const writeOwners = (value: string[]): void => {
  try {
    window.localStorage.setItem(OWNERS_KEY, JSON.stringify(value));
  } catch {
    /* not remembering is not an error worth showing anyone */
  }
};

/**
 * Click a legend entry to hide that series — the gold dashboard's own affordance, and the only way
 * to read a chart where one metal dwarfs the other.
 */
const useHiddenSeries = (): {
  hidden: string[];
  toggle: (entry: { dataKey?: unknown; value?: unknown }) => void;
  legendLabel: (value: string) => JSX.Element;
} => {
  const [hidden, setHidden] = useState<string[]>([]);
  const toggle = (entry: { dataKey?: unknown; value?: unknown }): void => {
    const key = String(entry.dataKey ?? entry.value ?? '');
    if (key === '') return;
    setHidden((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  };
  const legendLabel = (value: string): JSX.Element => (
    <span
      className={`cursor-pointer ${
        hidden.includes(value)
          ? 'text-slate-400 dark:text-slate-600'
          : 'text-slate-700 dark:text-slate-200'
      }`}
    >
      {value}
    </span>
  );
  return { hidden, toggle, legendLabel };
};

/**
 * The percentage inside each slice, drawn at the doughnut's mid-radius. Slices under 3% get no
 * label — gold's cutoff, and the point below which the text no longer fits the arc.
 */
const pieLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
}): JSX.Element | null => {
  if (percent === undefined || percent < 0.03) return null;
  const rad = Math.PI / 180;
  const inner = innerRadius ?? 0;
  const radius = inner + ((outerRadius ?? 0) - inner) * 0.5;
  const x = (cx ?? 0) + radius * Math.cos(-(midAngle ?? 0) * rad);
  const y = (cy ?? 0) + radius * Math.sin(-(midAngle ?? 0) * rad);
  return (
    <text
      x={x}
      y={y}
      fill="#0f172a"
      fontSize={13}
      fontWeight="bold"
      textAnchor="middle"
      dominantBaseline="central"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

/** Owner names wrap to at most three short lines instead of being cut off mid-word. */
const OwnerTick = ({
  x,
  y,
  payload,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
}): JSX.Element => {
  const words = String(payload?.value ?? '—').split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (`${current} ${word}`.trim().length > 12) {
      if (current !== '') lines.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current !== '') lines.push(current);
  return (
    <g transform={`translate(${String(x ?? 0)},${String(y ?? 0)})`}>
      {lines.slice(0, 3).map((line, i) => (
        <text
          key={line}
          x={0}
          y={0}
          dy={13 + i * 12}
          textAnchor="middle"
          className="fill-slate-500 dark:fill-slate-400"
          fontSize={10}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

export const GoldDashboardPage = (): JSX.Element => {
  const t = useT();
  const stats = useGoldDashboardStats();
  const charts = useGoldDashboardCharts();
  const [pickedOwners, setPickedOwners] = useState<string[]>(readOwners);
  const companyLegend = useHiddenSeries();
  const metalLegend = useHiddenSeries();
  const ownerLegend = useHiddenSeries();
  const flowLegend = useHiddenSeries();
  useEffect(() => {
    writeOwners(pickedOwners);
  }, [pickedOwners]);

  const byCompany = charts.data?.barsByCompany ?? [];
  const ownerOptions = byCompany.map((row) => ({ value: row.companyId, label: row.name }));
  const shownOwnerIds =
    pickedOwners.length > 0
      ? pickedOwners
      : byCompany.slice(0, DEFAULT_OWNERS).map((row) => row.companyId);

  const goldLabel = metalLabel(t, 'gold');
  const silverLabel = metalLabel(t, 'silver');

  const companyData = byCompany
    .filter((row) => shownOwnerIds.includes(row.companyId))
    .map((row) => ({ name: row.name, [goldLabel]: row.gold, [silverLabel]: row.silver }));

  // A legend-hidden slice keeps its place and its colour but drops to zero, which is how gold
  // removed it from the doughnut without renumbering everything beside it.
  const metalData = Object.entries(stats.data?.byMetal ?? {}).map(([key, totals]) => {
    const name = metalLabel(t, key);
    return { key, name, value: metalLegend.hidden.includes(name) ? 0 : totals.weight };
  });

  const ownerType = charts.data?.ownerTypeWeight ?? {};
  const ownerData = [
    { name: t('gold.dashboard.funds'), value: ownerType.fund ?? 0 },
    {
      name: t('gold.dashboard.corporates'),
      value: (ownerType.company ?? 0) + (ownerType.institution ?? 0),
    },
  ]
    .filter((row) => row.value > 0)
    .map((row) => ({ ...row, value: ownerLegend.hidden.includes(row.name) ? 0 : row.value }));

  // Twelve months, ending this month — net (in − out) per metal, in kilos.
  const flow = useMemo(() => {
    const inMap = new Map<string, number>();
    const outMap = new Map<string, number>();
    for (const row of charts.data?.inFlow ?? []) {
      inMap.set(`${String(row.year)}-${String(row.month)}-${row.metal}`, row.weight);
    }
    for (const row of charts.data?.outFlow ?? []) {
      outMap.set(`${String(row.year)}-${String(row.month)}-${row.metal}`, row.weight);
    }
    const now = new Date();
    const months: Record<string, string | number>[] = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${String(d.getFullYear())}-${String(d.getMonth() + 1)}`;
      const net = (metal: string): number =>
        Number(
          (
            ((inMap.get(`${key}-${metal}`) ?? 0) - (outMap.get(`${key}-${metal}`) ?? 0)) /
            1000
          ).toFixed(2),
        );
      months.push({
        name: d.toLocaleDateString('ar-EG', { month: 'short' }),
        [goldLabel]: net('gold'),
        [silverLabel]: net('silver'),
      });
    }
    return months;
  }, [charts.data, goldLabel, silverLabel]);

  if (stats.isLoading || charts.isLoading) {
    return (
      <PageContainer>
        <LoadingState />
      </PageContainer>
    );
  }

  const grams = (value: number | undefined): string =>
    t('gold.common.grams', { value: fmtWeightValue(value) });
  const kilos = (value: number | undefined): string =>
    t('gold.common.kilos', { value: fmtKilos(value) });

  return (
    <PageContainer>
      <PageHeader title={t('gold.nav.dashboard')} description={t('gold.dashboard.subtitle')} />

      <div className="space-y-6">
        <StatStrip
          items={[
            {
              key: 'vaults',
              label: t('gold.dashboard.vaults'),
              value: fmtNumber(stats.data?.totalVaults),
            },
            {
              key: 'drawers',
              label: t('gold.dashboard.drawers'),
              value: fmtNumber(stats.data?.totalDrawers),
            },
            {
              key: 'bars',
              label: t('gold.dashboard.bars'),
              value: fmtNumber(stats.data?.totalBars),
            },
            {
              key: 'owners',
              label: t('gold.dashboard.companies'),
              value: fmtNumber(stats.data?.totalCompanies),
            },
            {
              key: 'gold',
              label: t('gold.dashboard.goldWeight'),
              value: grams(stats.data?.goldWeight),
            },
            {
              key: 'silver',
              label: t('gold.dashboard.silverWeight'),
              value: grams(stats.data?.silverWeight),
            },
            {
              key: 'total',
              label: t('gold.dashboard.totalWeight'),
              value: kilos(stats.data?.totalWeight),
            },
          ]}
        />

        <Card>
          <CardHeader
            title={t('gold.dashboard.byCompany')}
            actions={
              <MultiSelect
                label={t('gold.dashboard.pickCompanies')}
                options={ownerOptions}
                value={shownOwnerIds}
                onChange={setPickedOwners}
              />
            }
          />
          <CardBody>
            {companyData.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                {t('gold.dashboard.empty')}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart
                  data={companyData}
                  margin={{ top: 8, right: 12, left: 20, bottom: 8 }}
                  barGap={2}
                >
                  <XAxis
                    dataKey="name"
                    interval={0}
                    height={56}
                    tick={<OwnerTick />}
                    tickLine={false}
                  />
                  <YAxis
                    width={84}
                    tickMargin={10}
                    tickFormatter={compact}
                    tickLine={false}
                    fontSize={11}
                  />
                  <Tooltip formatter={(v: number) => grams(v)} />
                  <Legend onClick={companyLegend.toggle} formatter={companyLegend.legendLabel} />
                  <Bar
                    dataKey={goldLabel}
                    fill={METAL_COLOURS.gold}
                    radius={[5, 5, 0, 0]}
                    hide={companyLegend.hidden.includes(goldLabel)}
                  />
                  <Bar
                    dataKey={silverLabel}
                    fill={METAL_COLOURS.silver}
                    radius={[5, 5, 0, 0]}
                    hide={companyLegend.hidden.includes(silverLabel)}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader title={t('gold.dashboard.byMetal')} />
            <CardBody>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={metalData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={85}
                    paddingAngle={3}
                    label={pieLabel}
                    labelLine={false}
                  >
                    {metalData.map((row, i) => (
                      <Cell
                        key={row.key}
                        fill={METAL_COLOURS[row.key] ?? PALETTE[i % PALETTE.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => grams(v)} />
                  <Legend onClick={metalLegend.toggle} formatter={metalLegend.legendLabel} />
                </PieChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('gold.dashboard.byOwnerType')} />
            <CardBody>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={ownerData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={45}
                    outerRadius={85}
                    paddingAngle={3}
                    label={pieLabel}
                    labelLine={false}
                  >
                    {ownerData.map((row, i) => (
                      <Cell key={row.name} fill={OWNER_COLOURS[i % OWNER_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => grams(v)} />
                  <Legend onClick={ownerLegend.toggle} formatter={ownerLegend.legendLabel} />
                </PieChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title={t('gold.dashboard.monthlyFlow')} />
            <CardBody>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={flow} margin={{ top: 8, right: 12, left: 20, bottom: 8 }}>
                  <XAxis dataKey="name" interval={0} height={40} tickLine={false} fontSize={10} />
                  <YAxis
                    width={72}
                    tickMargin={10}
                    tickFormatter={compact}
                    tickLine={false}
                    fontSize={11}
                  />
                  <Tooltip
                    formatter={(v: number) => t('gold.common.kilos', { value: String(v) })}
                  />
                  <Legend onClick={flowLegend.toggle} formatter={flowLegend.legendLabel} />
                  <Bar
                    dataKey={goldLabel}
                    fill={METAL_COLOURS.gold}
                    radius={[4, 4, 0, 0]}
                    hide={flowLegend.hidden.includes(goldLabel)}
                  />
                  <Bar
                    dataKey={silverLabel}
                    fill={METAL_COLOURS.silver}
                    radius={[4, 4, 0, 0]}
                    hide={flowLegend.hidden.includes(silverLabel)}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
};
