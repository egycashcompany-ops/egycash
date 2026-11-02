// «كيف حُسب الفارق» — the card of a «فارق عداد الصيانة» the projection COMPUTED.
//
// «مفيش إنذار والمسافة كبيرة، ومش بيخصم الكيلومترات اللى بتخش كل يوم»: a figure with no alarm
// beside it reads as a broken rule unless the screen shows the rule. The card lays the server's
// own numbers side by side — the reading, the counted visit with both its days and its work type,
// its counters with the one USED marked, «28,297 − 22,790 = 5,507 كم», the make's interval and
// what is left of it, the two thresholds and the level they give, and where each is set — and
// says when a newer visit does not count yet. Nothing is computed here: every fact is
// `figureFacts`', and every figure in it is a field of the alarm as it came.
//
// Drawn in the reason card's type (`AlarmReasonFacts`) and its frame (`ReasonCardLayer`), opened by
// the figure itself (`AlarmFigureCell`), on the odometer register and on «إنذارات الصيانة».
import {
  type FleetAlarmLevel,
  type FleetAlarmNamedDto,
  type FleetAlarmUncountedWhy,
  type FleetMaintenanceAlarmDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { cn } from '../../../shared/lib/cn';
import { localized } from '../../../shared/lib/format';
import { figureFacts, type FigureNewer } from '../lib/alarm-reason-card';
import { AlarmBadge } from './AlarmBadge';
import { Glyph } from './AlarmReasonCell';
import { CounterLine, DOT, Day, FACTS, Fact, Km, ROW, Sentence, Tag } from './AlarmReasonFacts';
import { NUM } from './FuelCardBoard';

const LATIN = new Intl.NumberFormat('en-US');
const CARD = 'fleet.odometer.alarmReason.card.';
/** The figure card's own words. */
export const FIGURE_WORDS = 'fleet.odometer.alarmReason.figure.';
const F = FIGURE_WORDS;

/** A calculator: «كيف حُسب». */
const SUM = (
  <>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 7h8" />
    <path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18.5h.01M12 18.5h.01M16 18.5h.01" />
  </>
);
/** The amber mark's triangle. */
export const WARN = (
  <>
    <path d="M10.3 3.9 2.4 17.5a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </>
);

/** The amber mark's words, beside the figure and at the head of the card's amber box. */
export const NEWER_MARK: Record<FleetAlarmUncountedWhy, string> = {
  open: `${F}mark.open`,
  notCounting: `${F}mark.notCounting`,
  checkedOutEarlier: `${F}mark.checkedOutEarlier`,
};

const LEVEL_WORDS: Record<FleetAlarmLevel, string> = {
  none: `${F}level.none`,
  yellow: `${F}level.yellow`,
  red: `${F}level.red`,
};

const useLocale = (): Locale => useAppSelector((state): Locale => state.locale.locale);

/** A figure in the boards' digits, left to right, never broken. */
const Num = ({ value, className }: { value: number; className?: string }): JSX.Element => (
  <span dir="ltr" className={cn(NUM, 'whitespace-nowrap', className)}>
    {LATIN.format(value)}
  </span>
);

/** A day, or the dash when the server has none. */
const DayOrDash = ({ iso }: { iso: string | null }): JSX.Element =>
  iso === null ? <span className="text-slate-400">—</span> : <Day iso={iso} />;

/** «28,297 − 22,790 = 5,507 كم»: the arithmetic left to right, the unit after the result. */
const Equation = ({ a, b, result }: { a: number; b: number; result: number }): JSX.Element => {
  const t = useT();
  const unit = t('fleet.odometer.kmValue', { km: '' }).trim();
  return (
    <span dir="ltr" className={cn(NUM, 'inline-flex items-baseline gap-x-1.5 whitespace-nowrap')}>
      <span>{LATIN.format(a)}</span>
      <span className="text-slate-400">−</span>
      <span>{LATIN.format(b)}</span>
      <span className="text-slate-400">=</span>
      <span className="text-[15px] text-sky-800 dark:text-sky-200">{LATIN.format(result)}</span>
      <span className="[font-family:'Cairo',sans-serif]">{unit}</span>
    </span>
  );
};

const SUM_LABEL = 'whitespace-nowrap font-bold text-sky-800 dark:text-sky-300';
const SUM_VALUE = 'font-bold text-slate-800 dark:text-slate-100';

/** «"إصلاح" في التوكيل»: the newer visit by its work type and workshop, whichever are named. */
const NewerWhat = ({ newer }: { newer: FigureNewer }): JSX.Element => {
  const t = useT();
  const locale = useLocale();
  const name = (named: FleetAlarmNamedDto | null): string | null =>
    named === null ? null : localized(named.name, locale);
  const work = name(newer.workType);
  const place = name(newer.workshop);
  const template =
    work !== null && place !== null
      ? `${F}newer.workAt`
      : work !== null
        ? `${F}newer.work`
        : place !== null
          ? `${F}newer.at`
          : `${F}newer.visit`;
  return (
    <Sentence
      template={t(template)}
      parts={{ work: <span>{work}</span>, place: <span>{place}</span> }}
    />
  );
};

/** What the amber box says, by why the visit does not count — and what to do about it. */
const NewerBox = ({ newer }: { newer: FigureNewer }): JSX.Element => {
  const t = useT();
  const locale = useLocale();
  const what = <NewerWhat newer={newer} />;
  // An open visit counts once closed only when the server says its work type counts. When it does
  // not, the note names the work type (car 157's «إصلاح» — sample A/04); with no name to give, it
  // says only what holds for any open visit.
  const [sentence, note] =
    newer.why === 'open'
      ? newer.counts
        ? [`${F}newer.open`, null]
        : [
            `${F}newer.openUnknown`,
            newer.workType !== null ? `${F}newer.openNotCountingNote` : `${F}newer.openUnknownNote`,
          ]
      : newer.why === 'notCounting'
        ? [`${F}newer.notCounting`, `${F}newer.notCountingNote`]
        : [`${F}newer.checkedOutEarlier`, null];
  return (
    <div
      className="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[13px] leading-relaxed dark:border-amber-500/40 dark:bg-amber-500/10"
      data-odo-newer={newer.why}
    >
      <p className="flex items-center gap-1.5 font-extrabold text-amber-800 dark:text-amber-200">
        <Glyph className="h-4 w-4 shrink-0">{WARN}</Glyph>
        {t(NEWER_MARK[newer.why])}
      </p>
      <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100">
        <Sentence
          template={t(sentence)}
          parts={{
            what,
            date: <Day iso={newer.inDate} />,
            in: <Day iso={newer.inDate} />,
            out: <DayOrDash iso={newer.outDate} />,
            counted: <DayOrDash iso={newer.countedOut} />,
          }}
        />
      </p>
      {note !== null && (
        <p className="mt-1 font-semibold text-slate-700 dark:text-slate-200">
          <Sentence
            template={t(note)}
            parts={{
              work: (
                <span>{newer.workType === null ? '' : localized(newer.workType.name, locale)}</span>
              ),
            }}
          />
        </p>
      )}
    </div>
  );
};

/** «كيف حُسب الفارق» for a computed figure; nothing for a refused one (that is the reason card). */
export const HowComputedCard = ({
  alarm,
  footer,
}: {
  alarm: FleetMaintenanceAlarmDto;
  footer: string;
}): JSX.Element | null => {
  const t = useT();
  const locale = useLocale();
  const facts = figureFacts(alarm);
  if (facts === null) return null;
  const { latest, newest, service, subtraction, remaining, thresholds, newer } = facts;
  return (
    <div data-odo-how="true">
      <p className="flex items-center gap-2 text-[14.5px] font-extrabold leading-snug">
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300"
        >
          <Glyph className="h-3.5 w-3.5">{SUM}</Glyph>
        </span>
        <span className="min-w-0">{t(`${F}howComputed`)}</span>
      </p>

      <dl className={FACTS} data-odo-facts="true">
        <Fact label={t(`${CARD}car`)} mark="car">
          <span className={ROW}>
            <span dir="ltr" className={NUM}>
              {facts.code}
            </span>
            {facts.vehicleType !== null && DOT}
            {facts.vehicleType !== null && <span>{localized(facts.vehicleType.name, locale)}</span>}
          </span>
        </Fact>
        {latest !== null && (
          // The HIGHEST reading: named so when the newest one is another (C6).
          <Fact
            label={t(newest === null ? `${CARD}latestReading` : `${F}highestReading`)}
            mark="latest"
          >
            <span className={ROW}>
              <Km km={latest.reading} />
              {latest.date !== null && DOT}
              {latest.date !== null && <Day iso={latest.date} />}
            </span>
          </Fact>
        )}
        {newest !== null && (
          <Fact label={t(`${F}newestReading`)} mark="newest">
            <span className="flex flex-col gap-1">
              <span className={ROW}>
                <Km km={newest.reading} />
                {DOT}
                <Day iso={newest.date} />
              </span>
              <span
                className="text-[12.5px] font-semibold leading-snug text-amber-800 dark:text-amber-200"
                data-odo-highest-not-newest="true"
              >
                {t(`${F}highestNotNewest`)}
              </span>
            </span>
          </Fact>
        )}
        {service !== null && (
          <Fact label={t(`${CARD}service`)} mark="service">
            <span className="leading-relaxed">
              <Sentence
                template={t(service.workType === null ? `${CARD}serviceDates` : `${F}serviceWork`)}
                parts={{
                  work: (
                    <span>
                      {service.workType === null ? null : localized(service.workType.name, locale)}
                    </span>
                  ),
                  in: <Day iso={service.inDate} />,
                  out: <Day iso={service.outDate} />,
                }}
              />
            </span>
          </Fact>
        )}
        {facts.counters.map((fact) =>
          fact.kind === 'counter' ? (
            <Fact
              key={fact.which}
              label={t(
                fact.which === 'entry'
                  ? 'fleet.maintenance.fields.odometerAtService'
                  : 'fleet.maintenance.fields.exitOdometer',
              )}
              mark={fact.which}
            >
              <CounterLine fact={fact} />
            </Fact>
          ) : (
            <Fact key="stand-in" label={t(`${CARD}readingStandIn`)} mark="stand-in">
              <span className={ROW}>
                <Km km={fact.value} />
                <Tag tone="used" />
              </span>
            </Fact>
          ),
        )}
        {facts.daysWithoutReading > 0 && (
          <Fact label={t('fleet.alarms.columns.daysWithoutReading')} mark="days">
            <span className="flex flex-col gap-0.5">
              <span className="text-amber-700 dark:text-amber-300">
                <Sentence
                  template={t(`${F}daysWithout`)}
                  parts={{ days: <Num value={facts.daysWithoutReading} /> }}
                />
              </span>
              <span className="text-[12px] font-semibold leading-snug text-slate-500 dark:text-slate-400">
                {t('fleet.alarms.daysWithoutReadingHint')}
              </span>
            </span>
          </Fact>
        )}
      </dl>

      {/* The arithmetic, in one box: the distance, the interval, what is left. */}
      {subtraction !== null && (
        <dl
          className="mt-2.5 grid grid-cols-1 items-center gap-x-3 gap-y-0.5 rounded-lg bg-sky-50 px-2.5 py-2 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1.5 dark:bg-sky-500/10 [&_dt:not(:first-child)]:mt-1.5 sm:[&_dt:not(:first-child)]:mt-0"
          data-odo-sum="true"
        >
          <dt className={SUM_LABEL}>{t(`${F}subtraction`)}</dt>
          <dd className={SUM_VALUE} data-odo-fact="subtraction">
            <Equation a={subtraction.latest} b={subtraction.counter} result={subtraction.since} />
          </dd>
          {facts.intervalKm !== null && (
            <>
              <dt className={SUM_LABEL}>{t(`${F}interval`)}</dt>
              <dd className={SUM_VALUE} data-odo-fact="interval">
                <Km km={facts.intervalKm} />
              </dd>
            </>
          )}
          {remaining !== null && (
            <>
              <dt className={SUM_LABEL}>{t(`${F}remaining`)}</dt>
              <dd className={SUM_VALUE} data-odo-fact="remaining">
                <Equation a={remaining.interval} b={remaining.since} result={remaining.left} />
              </dd>
            </>
          )}
        </dl>
      )}

      <dl className={FACTS} data-odo-thresholds="true">
        <Fact label={t(`${F}thresholds`)} mark="thresholds">
          <span className="flex flex-col gap-1">
            <span className="leading-relaxed">
              <Sentence
                template={t(`${F}thresholdsLine`)}
                parts={{
                  yellow: <Num value={thresholds.yellowKm} />,
                  red: <Num value={thresholds.redKm} />,
                }}
              />
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300">
              <AlarmBadge level={facts.level} />
              <span data-odo-level-words={facts.level}>{t(LEVEL_WORDS[facts.level])}</span>
            </span>
          </span>
        </Fact>
        <Fact label={t(`${F}whereSet`)} mark="where">
          {/* Plain words, as the reason card's «المطلوب» names a place: the card takes no pointer. */}
          <span className="flex flex-col items-start gap-0.5 text-[12.5px] font-semibold leading-5 text-slate-700 dark:text-slate-200">
            <span>{t(`${F}whereInterval`)}</span>
            <span>{t(`${F}whereThresholds`)}</span>
          </span>
        </Fact>
      </dl>

      {newer !== null && <NewerBox newer={newer} />}

      <p className="mt-2.5 text-[12px] leading-snug text-slate-500 dark:text-slate-400">{footer}</p>
    </div>
  );
};
