// Tab 10 «الحوادث» — the approved Phase-1 sample (zz-fleetdash-p1.tsx, `PAccidents`) over R2's
// `accidents` and `accidentList` (T10.1, T10.2, R-22, R-23), in the system palette. Full width: the
// operating-cost ranking is Phase 2 and is not drawn.
//
// The heading is the period's count, the open files and their outstanding amount (= tab 6's card).
// Each row: the accident's DATE only — never a time —, the car, the responsible driver (the driver
// card only when the file names our employees; otherwise the text as it was written), the state and
// the outstanding amount NOW. A row opens the accidents screen on that car and day.
import { type FleetDashboardPeriodAccidentRowDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { slashDay } from '../../lib/fleet-dashboard-tabs';
import { DriverHoverText } from '../DriverHoverCard';
import { useEmployeeRecords } from '../EmployeeName';
import { custodyCountForm } from '../custody-dashboard-parts';
import {
  Card,
  CardHead,
  CarChip,
  DIVIDE,
  Fig,
  FootLink,
  HEAD_CHIP,
  LINKED_TIGHT,
  MUTED,
  N,
  NOTE,
  TH_ROW,
  Tag,
  WELL,
  cn,
} from './dash-kit';
import { Amount, Phrase, SectionError, count } from './dash-shell';
import { sectionFailed, type PeriodBodyProps } from './tab-period';

const SECTIONS = ['accidents', 'accidentList'] as const;
const DATE_COL = 'w-[84px] shrink-0';
const CAR_COL = 'w-16 shrink-0';
const STATE_COL = 'w-16 shrink-0 text-center';
const LEFT_COL = 'w-32 shrink-0 text-end';

/** The driver card on a culprit who is one of ours; the text as written otherwise (R-23). */
const Culprit = ({ row }: { row: FleetDashboardPeriodAccidentRowDto }): JSX.Element => {
  const t = useT();
  const people = useEmployeeRecords(row.culpritEmployeeIds);
  const text = row.culprit ?? t('fleet.dash.licences.noCulprit');
  if (row.culpritEmployeeIds.length === 0) return <span data-culprit="text">{text}</span>;
  return (
    <DriverHoverText
      people={[...people.values()]}
      className="cursor-pointer underline decoration-slate-400 decoration-dotted underline-offset-4 dark:decoration-slate-500"
    >
      <span data-culprit="driver">{text}</span>
    </DriverHoverText>
  );
};

export const AccidentsTab = ({ data, links, onRetry }: PeriodBodyProps): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const header = data.accidents;
  const list = data.accidentList;
  const failed = SECTIONS.filter((section) => sectionFailed(data, section));
  const accidentsWord = (n: number): string =>
    t(`fleet.dash.accidents.noun.${custodyCountForm(locale, n)}`);

  const chip =
    header === null ? undefined : (
      <span data-accidents-head="true" className={HEAD_CHIP}>
        <Phrase
          text={t('fleet.dash.accidents.head')}
          parts={{
            count: (
              <Fig link={links.accidents('accidents.count')} linkedClassName={LINKED_TIGHT}>
                <N>{count(header.count)}</N> {accidentsWord(header.count)}
              </Fig>
            ),
            open: (
              <Fig link={links.accidents('accidents.open', 'open')} linkedClassName={LINKED_TIGHT}>
                <N>{count(header.open)}</N>
              </Fig>
            ),
            amount: (
              <Fig
                link={links.accidents('accidents.openRemaining', 'open')}
                linkedClassName={LINKED_TIGHT}
              >
                <Amount value={header.openRemaining} />
              </Fig>
            ),
          }}
        />
      </span>
    );

  return (
    <div data-dash-tab-body="accidents" className="grid grid-cols-1 gap-5">
      {failed.map((section) => (
        <SectionError key={section} section={section} onRetry={onRetry} />
      ))}
      {(header !== null || list !== null) && (
        <Card className="p-5" data-period-card="accidentList">
          <CardHead title={t('fleet.dash.accidents.title')} end={chip} className="mb-4" />
          {list !== null &&
            (list.rows.length === 0 ? (
              <p className={NOTE}>{t('fleet.dash.accidents.empty')}</p>
            ) : (
              <div className={cn(WELL, DIVIDE, 'overflow-x-auto')}>
                <div
                  className={cn(
                    'flex min-w-[560px] items-center gap-3 px-3 py-2 text-[11px] font-semibold',
                    TH_ROW,
                    MUTED,
                  )}
                >
                  <span className={DATE_COL}>{t('fleet.dash.accidents.col.date')}</span>
                  <span className={CAR_COL}>{t('fleet.dash.accidents.col.vehicle')}</span>
                  <span className="min-w-0 flex-1">{t('fleet.dash.accidents.col.culprit')}</span>
                  <span className={STATE_COL}>{t('fleet.dash.accidents.col.status')}</span>
                  <span className={LEFT_COL}>{t('fleet.dash.accidents.col.remaining')}</span>
                </div>
                {list.rows.map((row) => {
                  const open = row.status === 'open';
                  return (
                    <div
                      key={row.accidentId}
                      data-accident-row={row.accidentId}
                      className="flex min-w-[560px] items-center gap-3 px-3 py-2.5 text-[13px]"
                    >
                      <Fig
                        link={links.accidentDay(row.code, row.date)}
                        className={cn(
                          DATE_COL,
                          'text-xs font-semibold text-slate-700 dark:text-slate-200',
                        )}
                      >
                        <N>{slashDay(row.date)}</N>
                      </Fig>
                      <span className={CAR_COL}>
                        <CarChip code={row.code} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                        <Culprit row={row} />
                      </span>
                      <span className={STATE_COL}>
                        <Tag tone={open ? 'amber' : 'slate'}>
                          {t(`fleet.accidents.status.${row.status}`)}
                        </Tag>
                      </span>
                      <span className={LEFT_COL}>
                        <Amount
                          value={row.remaining}
                          className={
                            open
                              ? 'text-slate-900 dark:text-white'
                              : 'text-slate-400 dark:text-slate-500'
                          }
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          {list !== null && list.more > 0 && (
            <p className={cn('mt-2 text-xs font-semibold', MUTED)}>
              <Fig link={links.accidents('accidentList.more')}>
                <Phrase
                  text={t('fleet.dash.accidents.more')}
                  parts={{ count: <N>{count(list.more)}</N> }}
                />
              </Fig>
            </p>
          )}
          <p className={cn(NOTE, 'mt-3')}>
            {t('fleet.dash.accidents.note')}
            {header !== null && header.undated !== null && header.undated > 0 && (
              <>
                {' '}
                <Phrase
                  text={t('fleet.dash.accidents.undated')}
                  parts={{ count: <N>{count(header.undated)}</N> }}
                />
              </>
            )}
          </p>
          <div className="mt-auto flex justify-end pt-3">
            <FootLink link={links.accidents('accidentList.all')}>
              {t('fleet.dash.licences.accidentsLog')}
            </FootLink>
          </div>
        </Card>
      )}
    </div>
  );
};
