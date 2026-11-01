// The facts block of the odometer's «فارق عداد الصيانة» reason card (`AlarmReasonCell`): what the
// projection measured from, and what disagrees with it — each line one `CardFact` of
// `lib/alarm-reason-card.ts`, drawn as the owner's approved sample draws it.
//
// Figures are in Latin digits and days year first, each set apart left to right inside the
// Arabic sentence. The counters wear the maintenance screen's own labels («العداد عند الصيانة»,
// «عداد الخروج من الصيانة») — never the odometer columns' «عداد الخروج/الدخول», which mean
// something else. The counter USED is marked, an exit counter SET ASIDE is struck through with the
// reading that contradicts it, and whatever disagrees wears a «تعارض» tag.
import { type ReactNode } from 'react';
import { type FleetVehicleStatus } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { cn } from '../../../shared/lib/cn';
import { templateParts, type CardFact } from '../lib/alarm-reason-card';
import { NUM, ymd } from './FuelCardBoard';

const LATIN = new Intl.NumberFormat('en-US');
const CARD = 'fleet.odometer.alarmReason.card.';

const RED = 'text-red-700 dark:text-red-300';
const FLAGGED_DAY =
  'rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200';
const FACTS =
  'mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-t border-slate-200 pt-2.5 text-[13px] dark:border-[#2b3b6b]';
const ROW = 'flex flex-wrap items-center gap-1.5';
const DOT = <span className="text-slate-400">·</span>;

const Fact = ({
  label,
  mark,
  children,
}: {
  label: string;
  mark: string;
  children: ReactNode;
}): JSX.Element => (
  <>
    <dt className="whitespace-nowrap pt-px font-semibold text-slate-500 dark:text-slate-400">
      {label}
    </dt>
    <dd className="min-w-0 font-bold text-slate-800 dark:text-slate-100" data-odo-fact={mark}>
      {children}
    </dd>
  </>
);

type TagTone = 'used' | 'setAside' | 'conflict';
const TAG: Record<TagTone, string> = {
  used: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200',
  setAside:
    'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200',
  conflict:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-500/15 dark:text-red-200',
};
const Tag = ({ tone }: { tone: TagTone }): JSX.Element => {
  const t = useT();
  return (
    <span
      data-odo-tag={tone}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded border px-1.5 py-px text-[11px] font-bold leading-4',
        TAG[tone],
      )}
    >
      {t(`${CARD}${tone}`)}
    </span>
  );
};

/** «25,631 كم»: the figure in Latin digits, the unit in the page's words, in the locale's order. */
const Km = ({ km, className }: { km: number; className?: string | undefined }): JSX.Element => {
  const t = useT();
  const [before = '', after = ''] = t('fleet.odometer.kmValue', { km: '\u0000' }).split('\u0000');
  return (
    <span className={cn('whitespace-nowrap', className)}>
      {before}
      <span dir="ltr" className={NUM}>
        {LATIN.format(km)}
      </span>
      {after}
    </span>
  );
};

const Day = ({ iso, className }: { iso: string; className?: string | undefined }): JSX.Element => (
  <span dir="ltr" className={cn(NUM, 'whitespace-nowrap', className)}>
    {ymd(iso)}
  </span>
);

/** A sentence with its `{{placeholders}}` filled by figures and days set apart, left to right. */
const Sentence = ({
  template,
  parts,
}: {
  template: string;
  parts: Record<string, ReactNode>;
}): JSX.Element => (
  <>
    {templateParts(template).map((part, i) => (
      <span key={i}>{'name' in part ? parts[part.name] : part.text}</span>
    ))}
  </>
);

const CounterLine = ({ fact }: { fact: Extract<CardFact, { kind: 'counter' }> }): JSX.Element => {
  const t = useT();
  const aside = fact.setAside;
  return (
    <span className="flex flex-col gap-1">
      <span className={ROW}>
        <Km
          km={fact.value}
          className={cn(
            aside !== null && 'text-slate-400 line-through decoration-2 dark:text-slate-500',
            fact.conflict && RED,
          )}
        />
        {fact.used && <Tag tone="used" />}
        {aside !== null && <Tag tone="setAside" />}
        {fact.conflict && <Tag tone="conflict" />}
      </span>
      {aside !== null && (
        <span className={cn(ROW, 'text-[12.5px] font-semibold text-slate-600 dark:text-slate-300')}>
          <span>
            <Sentence
              template={t(
                aside.because === 'belowChain'
                  ? `${CARD}setAsideBelowChain`
                  : `${CARD}setAsideAboveReading`,
              )}
              parts={{
                reading: <Km km={aside.conflict.reading} />,
                date: <Day iso={aside.conflict.date} />,
              }}
            />
          </span>
          <Tag tone="conflict" />
        </span>
      )}
    </span>
  );
};

const FactLine = ({ fact }: { fact: CardFact }): JSX.Element => {
  const t = useT();
  switch (fact.kind) {
    case 'car':
      return (
        <Fact label={t(`${CARD}car`)} mark="car">
          <span dir="ltr" className={NUM}>
            {fact.code}
          </span>
        </Fact>
      );
    case 'latest':
      return (
        <Fact label={t(`${CARD}latestReading`)} mark="latest">
          <span className={ROW}>
            <Km km={fact.reading} className={fact.conflict ? RED : undefined} />
            {fact.date !== null && DOT}
            {fact.date !== null && (
              <Day iso={fact.date} className={fact.dateFlagged ? FLAGGED_DAY : undefined} />
            )}
            {fact.conflict && <Tag tone="conflict" />}
          </span>
        </Fact>
      );
    case 'service':
      return (
        <Fact label={t(`${CARD}service`)} mark="service">
          <span>
            <Sentence
              template={t(`${CARD}serviceDates`)}
              parts={{
                in: <Day iso={fact.inDate} />,
                out: (
                  <Day iso={fact.outDate} className={fact.outFlagged ? FLAGGED_DAY : undefined} />
                ),
              }}
            />
          </span>
        </Fact>
      );
    case 'counter':
      return (
        <Fact
          label={t(
            fact.which === 'entry'
              ? 'fleet.maintenance.fields.odometerAtService'
              : 'fleet.maintenance.fields.exitOdometer',
          )}
          mark={fact.which}
        >
          <CounterLine fact={fact} />
        </Fact>
      );
    case 'standIn':
      return (
        <Fact label={t(`${CARD}readingStandIn`)} mark="stand-in">
          <span className={ROW}>
            <Km km={fact.value} />
            <Tag tone="used" />
          </span>
        </Fact>
      );
    case 'judged':
      return (
        <Fact label={t(`${CARD}judgedAgainst`)} mark="judged">
          <span className={ROW}>
            <Km km={fact.point.reading} className={fact.conflict ? RED : undefined} />
            {DOT}
            <Day iso={fact.point.date} className={fact.conflict ? RED : undefined} />
            {fact.conflict && <Tag tone="conflict" />}
          </span>
        </Fact>
      );
    case 'newer':
      return (
        <Fact label={t(`${CARD}newerVisit`)} mark="newer">
          <span className="font-semibold leading-relaxed">
            <Sentence
              template={t(
                fact.why === 'open' ? `${CARD}newerVisitOpen` : `${CARD}newerVisitNotCounting`,
              )}
              parts={{ date: <Day iso={fact.date} /> }}
            />
          </span>
        </Fact>
      );
  }
};

/** The facts of a refused car, in `cardFacts`' order. */
export const ReasonFacts = ({ facts }: { facts: readonly CardFact[] }): JSX.Element => (
  <dl className={FACTS} data-odo-facts="true">
    {facts.map((fact, i) => (
      <FactLine key={`${fact.kind}-${i}`} fact={fact} />
    ))}
  </dl>
);

/** The facts of a car that is not active: its code, and its status and reason when known. */
export const NotActiveFacts = ({
  code,
  vehicle,
}: {
  code: string | null;
  vehicle: { status: FleetVehicleStatus; statusReason: string | null } | null;
}): JSX.Element => {
  const t = useT();
  return (
    <dl className={FACTS} data-odo-facts="true">
      <Fact label={t(`${CARD}car`)} mark="car">
        <span dir="ltr" className={NUM}>
          {code ?? '—'}
        </span>
      </Fact>
      {vehicle !== null && (
        <Fact label={t(`${CARD}status`)} mark="status">
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-px text-[12px] font-bold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
            {t(`fleet.vehicles.status.${vehicle.status}`)}
          </span>
        </Fact>
      )}
      {vehicle !== null && vehicle.statusReason !== null && (
        <Fact label={t(`${CARD}statusReason`)} mark="status-reason">
          {vehicle.statusReason}
        </Fact>
      )}
    </dl>
  );
};
