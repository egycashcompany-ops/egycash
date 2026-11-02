// «تصحيح أرقام الكروت» (6d) — one cycle, as the approved sample draws it (01, 02, 04, 09): the
// strip (its size, «تُصحَّح كاملة أو لا تُصحَّح», whether it matches the review, is held, or was
// corrected), the chain of cars with the number each record holds, and one row per record — its
// name and live balance (they stay), the number before → after with where the right number is now
// and where today's PIN goes, the expiry, the two photos (today's ✗ → the right one ✓), the live
// check, and the top-ups logged on it since go-live, for information only. A record changed by
// hand says what changed, from what to what, when and by whom; it is never touched, and its whole
// cycle waits with it.
import { type ReactNode } from 'react';
import {
  type FleetFuelNumberRepairChangeDto,
  type FleetFuelNumberRepairCycleDto,
  type FleetFuelNumberRepairCycleRowDto,
  type FleetFuelNumberRepairTopUpDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { HistoryIcon } from '../../../../shared/ui/icons';
import { BoardIcon, NUM } from '../FuelCardBoard';
import { MOVES_CHIP, SECTION_CARD, SECTION_STRIP } from '../custody-board-looks';
import { NOTE, TITLE } from '../custody-dashboard-parts';
import { ACTION_GROUP, actionTone } from '../row-actions-look';
import { Filled } from '../fuel-reconcile/reconcile-cells';
import {
  changeShown,
  changedCarsOf,
  expiryChangeOf,
  expiryMoves,
} from '../../lib/fuel-number-repair';
import { N, useRepairWords } from '../../lib/fuel-number-repair-words';
import { stampOf } from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { COL_HEAD, CYCLE_GRID, PHONE_LABEL } from './repair-looks';
import {
  BeforeAfter,
  CarBox,
  CarCode,
  Chain,
  ReadArrow,
  DateText,
  Dots,
  ICON,
  Masked,
  Money,
  PinFate,
  StateChip,
  Tag,
  TopUpChip,
  ymdOf,
} from './repair-parts';
import { RepairThumb } from './RepairThumb';

/**
 * The top-ups logged on a record since go-live — plain information. No top-up is said to have
 * reached any particular physical card: the company loads by number and by name.
 */
export const TopUpsLine = ({
  car,
  topUps,
  more,
}: {
  car: string;
  topUps: readonly FleetFuelNumberRepairTopUpDto[];
  more: number;
}): JSX.Element => {
  const t = useT();
  return (
    <div
      data-repair-topups={car}
      className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-[12px] text-slate-600 lg:ms-[7.25rem] dark:border-slate-700/70 dark:bg-[#0b1220]/60 dark:text-slate-300"
    >
      <BoardIcon d={ICON.money} className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
      {topUps.length === 0 ? (
        <span className="font-semibold">{t(`${N}topUps.none`)}</span>
      ) : (
        <>
          <span className="font-semibold">{t(`${N}topUps.title`)}</span>
          {topUps.map((topUp) => (
            <TopUpChip key={topUp.id} topUp={topUp} />
          ))}
          {more > 0 && (
            <span dir="ltr" className={cn(NUM, 'font-bold text-slate-500 dark:text-slate-400')}>
              {t(`${N}topUps.more`, { count: more })}
            </span>
          )}
        </>
      )}
      <span className="ms-auto text-[11px] text-slate-500 lg:whitespace-nowrap dark:text-slate-400">
        {t(`${N}topUps.note`)}
      </span>
    </div>
  );
};

/** One side of a change, in its own form: a last four, a day, a name or car, yes/no, a photo. */
const ChangeValue = ({
  change,
  side,
}: {
  change: FleetFuelNumberRepairChangeDto;
  side: 'expected' | 'now';
}): JSX.Element => {
  const t = useT();
  const shown = changeShown(change.field, change[side]);
  switch (shown.kind) {
    case 'number':
      return <Dots last4={shown.last4} />;
    case 'date':
      return (
        <span dir="ltr" className={NUM}>
          {ymdOf(shown.day)}
        </span>
      );
    case 'text':
      return (
        <span dir="auto" className="font-bold">
          {shown.text}
        </span>
      );
    case 'pin':
      return <b>{t(shown.stored ? `${N}changed.pinYes` : `${N}changed.pinNo`)}</b>;
    case 'photo':
      return (
        <Filled
          template={t(`${N}changed.photoOf`)}
          values={{ number: <Dots last4={shown.last4} /> }}
        />
      );
    case 'photoOther':
      return <>{t(`${N}changed.photoOther`)}</>;
    case 'none':
      return <>{t(`${N}changed.none`)}</>;
  }
};

/**
 * Why a record reads «تغيّر — لن يُلمس»: each field changed by hand since go-live, with the value
 * the owner reviewed and the value now — and when, by whom, when the audit says. The record is not
 * touched, and its unit waits until the new value is reviewed.
 */
export const ChangeLines = ({
  car,
  changes,
  pair = false,
}: {
  car: string;
  changes: readonly FleetFuelNumberRepairChangeDto[];
  pair?: boolean;
}): JSX.Element | null => {
  const t = useT();
  if (changes.length === 0) return null;
  const who = (change: FleetFuelNumberRepairChangeDto): ReactNode => (
    <>
      {change.at !== null && (
        <>
          {' '}
          <Filled
            template={t(`${N}changed.at`)}
            values={{
              at: (
                <span dir="ltr" className={NUM}>
                  {stampOf(change.at)}
                </span>
              ),
            }}
          />
        </>
      )}
      {change.byName !== null && <> {t(`${N}changed.by`, { by: change.byName })}</>}
    </>
  );
  return (
    <div
      data-repair-changed-note={car}
      className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[12px] font-semibold leading-relaxed text-red-800 lg:ms-[7.25rem] dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
    >
      {/* One paragraph, as the sample: each change a sentence, then what that means. */}
      {changes.map((change) => (
        <span key={change.field} data-repair-change={change.field}>
          {change.field === 'missing' ? (
            t(`${N}changed.missing`, { car })
          ) : change.field === 'repairLine' ? (
            t(`${N}changed.repairLine`)
          ) : (
            <>
              <Filled
                template={t(`${N}changed.lead`)}
                values={{
                  what: t(`${N}field.${change.field}`),
                  expected: <ChangeValue change={change} side="expected" />,
                  now: <ChangeValue change={change} side="now" />,
                }}
              />
              {who(change)}
              {t(`${N}changed.stop`)}
            </>
          )}{' '}
        </span>
      ))}
      <span>{t(pair ? `${N}changed.tailPair` : `${N}changed.tail`)}</span>
    </div>
  );
};

/** The history button of a corrected record — «سجل الكارت». */
export const LogButton = ({
  cardId,
  onLog,
}: {
  cardId: string;
  onLog: () => void;
}): JSX.Element => {
  const t = useT();
  return (
    <span className={ACTION_GROUP}>
      <button
        type="button"
        data-repair-log={cardId}
        title={t('fleet.fuelCards.history.open')}
        aria-label={t('fleet.fuelCards.history.open')}
        onClick={onLog}
        className={actionTone('history')}
      >
        <HistoryIcon className="h-4 w-4" />
      </button>
    </span>
  );
};

const CycleRow = ({
  row,
  done,
  onLog,
}: {
  row: FleetFuelNumberRepairCycleRowDto;
  /** The cycle was corrected — the row reads «كان / أصبح». */
  done: boolean;
  onLog: (cardId: string) => void;
}): JSX.Element => {
  const t = useT();
  const changed = row.state === 'changed';
  const muted = changed || row.state === 'held';
  const moves = expiryMoves(row);
  const expiryChange = changed ? expiryChangeOf(row.changes) : undefined;
  return (
    <article
      data-repair-row={row.car}
      data-repair-row-state={row.state}
      className={cn(
        'border-t border-slate-100 px-4 py-3 first:border-t-0 dark:border-slate-800/80',
        changed && 'bg-red-50/60 dark:bg-red-500/[0.05]',
        row.state === 'held' && 'bg-amber-50/40 dark:bg-amber-500/[0.03]',
      )}
    >
      <div className={cn('flex flex-col gap-3', CYCLE_GRID)}>
        {/* The car and the name: on a phone side by side. */}
        <div className="flex items-center gap-3 lg:contents">
          <div className="lg:flex lg:justify-center">
            <CarBox code={row.car} tone={changed ? 'amber' : 'emerald'} />
          </div>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <span
              dir="ltr"
              data-repair-name={row.car}
              className="whitespace-nowrap font-figures text-[15px] font-bold tracking-wide text-slate-900 dark:text-white"
            >
              {row.name}
            </span>
            <span className="text-[12px] text-slate-600 dark:text-slate-300">
              <Filled
                template={t(`${N}row.balance`)}
                values={{
                  amount: (
                    <Money
                      value={row.balance}
                      className="text-[13px] text-slate-800 dark:text-slate-100"
                    />
                  ),
                }}
              />
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Tag tone="slate" icon={ICON.lock}>
                {t(`${N}row.stays`)}
              </Tag>
            </span>
            {row.chassisTypo && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {t(`${N}row.chassisTypo`)}
              </span>
            )}
          </div>
        </div>

        <div className={cn('flex flex-col items-start gap-1.5', muted && 'opacity-50')}>
          <span className={PHONE_LABEL}>{t(`${N}phone.number`)}</span>
          <BeforeAfter
            done={done}
            now={<Masked prefix={row.numberPrefix} last4={row.numberBeforeLast4} tone="struck" />}
            after={
              <Masked
                prefix={row.numberPrefix}
                last4={row.numberAfterLast4}
                tone={changed ? 'plain' : 'after'}
              />
            }
          />
          {!done && (
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              <Filled
                template={t(`${N}row.afterIsOn`)}
                values={{ car: <CarCode code={row.afterIsNowOnCar} /> }}
              />
            </span>
          )}
          <PinFate
            pinAfter={row.pinAfter}
            pinBefore={row.pinBefore}
            numberBefore={row.numberBeforeLast4}
            goesTo={row.beforeGoesToCar}
            done={done}
          />
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3 lg:contents">
          <div
            className={cn(
              'flex flex-col items-start gap-1.5',
              row.state === 'held' && 'opacity-50',
            )}
          >
            <span className={PHONE_LABEL}>{t(`${N}col.expiry`)}</span>
            {expiryChange !== undefined && expiryChange.now !== null ? (
              <span
                className="flex flex-col items-start gap-1"
                data-repair-expiry-changed={row.car}
              >
                <DateText day={expiryChange.now} tone="plain" />
                <span className="text-[11px] font-semibold text-red-700 dark:text-red-300">
                  <Filled
                    template={t(`${N}expiry.expected`)}
                    values={{
                      date: (
                        <span dir="ltr" className={NUM}>
                          {ymdOf(expiryChange.expected ?? row.expiryBefore)}
                        </span>
                      ),
                    }}
                  />
                </span>
              </span>
            ) : (
              <BeforeAfter
                done={done}
                now={<DateText day={row.expiryBefore} tone={moves ? 'struck' : 'same'} />}
                after={<DateText day={row.expiryAfter} tone={moves ? 'after' : 'same'} />}
              />
            )}
            {expiryChange === undefined &&
              (moves ? (
                <Tag tone="amber">{t(`${N}expiry.changes`)}</Tag>
              ) : (
                <Tag tone="slate">{t(`${N}expiry.same`)}</Tag>
              ))}
          </div>

          <div
            className={cn(
              'flex flex-col items-start gap-1.5 lg:items-center',
              muted && 'opacity-50',
            )}
          >
            <span className={PHONE_LABEL}>{t(`${N}col.photo`)}</span>
            <span className="inline-flex items-start gap-1.5">
              {done ? (
                <RepairThumb photo={row.photoAfter} verdict="ok" />
              ) : (
                <>
                  <RepairThumb photo={row.photoBefore} verdict="no" />
                  <ReadArrow className="pt-5 text-lg font-black text-slate-400 dark:text-slate-500" />
                  <RepairThumb photo={row.photoAfter} verdict="ok" />
                </>
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-center">
          <span className={PHONE_LABEL}>{t(done ? `${N}col.result` : `${N}col.check`)}</span>
          <StateChip state={row.state} />
          {done && row.cardId !== null && (
            <LogButton cardId={row.cardId} onLog={() => onLog(row.cardId ?? '')} />
          )}
        </div>
      </div>
      {changed && <ChangeLines car={row.car} changes={row.changes} />}
      {!done && <TopUpsLine car={row.car} topUps={row.topUps} more={row.topUpsMore} />}
    </article>
  );
};

export const RepairCycleSection = ({
  cycle,
  onLog,
}: {
  cycle: FleetFuelNumberRepairCycleDto;
  onLog: (cardId: string) => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const words = useRepairWords();
  const done = cycle.state === 'done';
  const stopped = changedCarsOf(cycle.rows);
  const ok = cycle.rows.filter((row) => row.state === 'ok').length;
  const [first, second] = cycle.rows;
  return (
    <section
      className={SECTION_CARD}
      data-repair-cycle={cycle.n}
      data-repair-unit-state={cycle.state}
    >
      <div className={SECTION_STRIP}>
        <span className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-amber-500/10 p-1.5 text-amber-700 dark:text-amber-300">
            <BoardIcon d={ICON.cycle} className="h-4 w-4" />
          </span>
          <h2 className={TITLE}>
            {t(`${N}cycle.title`, { n: cycle.n, cards: count.cards(cycle.rows.length) })}
          </h2>
          <span className={MOVES_CHIP}>{t(`${N}cycle.whole`)}</span>
        </span>
        {done ? (
          <Tag tone="emerald" icon={ICON.ok} data-repair-cycle-tag="done">
            {t(`${N}cycle.done`, { cards: count.cards(cycle.rows.length) })}
          </Tag>
        ) : cycle.state === 'held' ? (
          <Tag tone="red" icon={ICON.warn} data-repair-cycle-tag="held">
            {stopped.length > 1
              ? t(`${N}cycle.heldMany`, { cars: words.list(stopped) })
              : t(`${N}cycle.held`, { car: stopped[0] ?? '—' })}
          </Tag>
        ) : (
          <Tag tone="emerald" icon={ICON.ok} data-repair-cycle-tag="ready">
            {t(`${N}cycle.ok`, { ok, all: cycle.rows.length })}
          </Tag>
        )}
      </div>
      {!done && (
        <div className="grid items-center gap-x-6 gap-y-3 border-b border-slate-200 px-4 py-3 lg:grid-cols-[auto_minmax(0,1fr)] dark:border-[#1c293f]">
          <Chain cars={cycle.cars} held={cycle.heldLast4} stopped={stopped} />
          <div className="space-y-1.5 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
            <p>{t(`${N}cycle.explain`)}</p>
            {first !== undefined && second !== undefined && (
              <p className={NOTE}>
                <Filled
                  template={t(`${N}cycle.arrow`)}
                  values={{
                    from: <CarCode code={first.car} />,
                    to: <CarCode code={second.car} />,
                    number: (
                      <Masked
                        prefix={first.numberPrefix}
                        last4={first.numberBeforeLast4}
                        size="sm"
                      />
                    ),
                  }}
                />
              </p>
            )}
          </div>
        </div>
      )}
      <div className={cn(COL_HEAD, CYCLE_GRID)}>
        <span className="text-center">{t(`${N}col.car`)}</span>
        <span>{t(`${N}col.nameBalance`)}</span>
        <span>{t(`${N}col.number`)}</span>
        <span>{t(`${N}col.expiry`)}</span>
        <span className="text-center">{t(`${N}col.photo`)}</span>
        <span className="text-center">{t(done ? `${N}col.result` : `${N}col.check`)}</span>
      </div>
      <div className="bg-white dark:bg-[#0d1424]/85">
        {cycle.rows.map((row) => (
          <CycleRow key={row.car} row={row} done={done} onLog={onLog} />
        ))}
      </div>
    </section>
  );
};
