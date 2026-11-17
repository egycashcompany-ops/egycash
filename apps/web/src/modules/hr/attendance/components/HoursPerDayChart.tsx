// Hours worked per day, with the average drawn across them.
//
// WHY A CHART AND NOT A COLUMN OF NUMBERS. The table below already prints every day's hours; what
// it cannot show is the SHAPE — the week that ran short, the one long day, the stretch with no
// bars at all. A dashed line at the average turns "7h 27m" from a figure into a reference the
// other days are read against.
//
// THE MISSING BARS ARE THE POINT, and the sentence under the heading says so in words. On this
// payroll most days are a check-in with no check-out, so their hours are genuinely unknown and
// they have NO bar — not a zero one. A zero-height bar would read as "worked nothing", which is a
// different and false claim.
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { type AttendanceDayDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Card, CardBody, CardHeader } from '../../../../shared/ui';
import { formatMinutes } from './minutes';

interface Point {
  label: string;
  /** Hours as a decimal, so bar heights are proportional; the tooltip prints h:mm. */
  hours: number;
  minutes: number;
}

export const HoursPerDayChart = ({
  rows,
  averageMinutes,
}: {
  rows: readonly AttendanceDayDto[];
  averageMinutes: number | null;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const intl = locale === 'ar' ? 'ar-EG' : 'en-GB';

  const axisDate = new Intl.DateTimeFormat(intl, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

  const data: Point[] = [...rows]
    // Oldest first: a time axis reads forward even where the table below reads newest first.
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .map((row) => ({
      label: axisDate.format(new Date(`${row.workDate.slice(0, 10)}T00:00:00.000Z`)),
      hours: row.workedMinutes / 60,
      minutes: row.workedMinutes,
    }));

  const nf = new Intl.NumberFormat(intl, { maximumFractionDigits: 0, useGrouping: false });
  const averageHours = averageMinutes === null ? null : averageMinutes / 60;

  const description =
    averageMinutes === null
      ? t('attendance.chart.noAverage')
      : t('attendance.chart.explain', { average: formatMinutes(averageMinutes, locale) });

  return (
    <Card>
      <CardHeader title={t('attendance.chart.title')} description={description} />
      <CardBody>
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('attendance.chart.empty')}
          </p>
        ) : (
          // `currentColor` carries the theme into the SVG: the axes, the grid and the average line
          // all take their colour from this class, so dark mode needs no second chart.
          <div className="text-slate-400 dark:text-slate-500" dir="ltr">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="currentColor" strokeOpacity={0.2} vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
                  tick={{ fill: 'currentColor', fontSize: 11 }}
                  minTickGap={24}
                />
                <YAxis
                  width={44}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'currentColor', fontSize: 11 }}
                  tickFormatter={(value: number) =>
                    t('attendance.chart.hoursTick', { hours: nf.format(value) })
                  }
                />
                <Tooltip
                  cursor={{ fill: 'currentColor', fillOpacity: 0.08 }}
                  formatter={(_value: number, _name: string, item: { payload?: Point }) => [
                    formatMinutes(item.payload?.minutes ?? 0, locale),
                    t('attendance.days.worked'),
                  ]}
                />
                {averageHours !== null && (
                  <ReferenceLine
                    y={averageHours}
                    stroke="currentColor"
                    strokeDasharray="4 4"
                    label={{
                      value: t('attendance.chart.averageMark', {
                        average: formatMinutes(averageMinutes ?? 0, locale),
                      }),
                      position: 'insideTopLeft',
                      fill: 'currentColor',
                      fontSize: 11,
                    }}
                  />
                )}
                <Bar dataKey="hours" className="fill-brand-500" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardBody>
    </Card>
  );
};
