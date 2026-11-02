// «تنفيذ التصحيح» asks first (sample 05), in the fleet's own dialog (`DesignDialog`, the shell the
// reconcile confirmation wears): what moves with the physical card and what stays, the PIN rule and
// the records left without a PIN, each cycle with what happens to it (corrected, skipped because a
// record changed, done before), the pair's swap with its two figures, and that it runs once, is
// re-checked at execution, is audited, writes a line in each card's log and changes no balance of
// the fifteen.
//
// ✓ is off until the owner ticks «راجعتُ الصفوف وصور الكروت، وأوافق على التنفيذ.» — unticked each
// time the dialog opens — and while the execution is on its way. What it sends is the dry run's
// own ready units (`executeBodyOf`), never a unit the review did not show ready.
import { Fragment } from 'react';
import { type FleetFuelNumberRepairDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { Spinner } from '../../../../shared/ui/Spinner';
import { DesignCancel, DesignDialog } from '../DesignDialog';
import { BoardIcon, NUM } from '../FuelCardBoard';
import { Filled } from '../fuel-reconcile/reconcile-cells';
import { executeBodyOf, noPinReadyOf, readyCyclesOf } from '../../lib/fuel-number-repair';
import { N, useRepairWords } from '../../lib/fuel-number-repair-words';
import { money } from '../../lib/fuel-reconcile';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { CarCode, Dots, ICON, Masked, ReadArrow, Signed } from './repair-parts';

const CHIP =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[12px] font-bold';

export const RepairConfirmDialog = ({
  open,
  repair,
  reviewed,
  busy,
  onReviewed,
  onClose,
  onConfirm,
}: {
  open: boolean;
  repair: FleetFuelNumberRepairDto;
  /** «راجعتُ الصفوف» — the page unticks it every time the dialog opens. */
  reviewed: boolean;
  busy: boolean;
  onReviewed: (on: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}): JSX.Element | null => {
  const t = useT();
  const count = useReconcileCount();
  const words = useRepairWords();
  const ready = readyCyclesOf(repair);
  const crossed = ready.reduce((sum, cycle) => sum + cycle.rows.length, 0);
  const pairReady = repair.pair.state === 'ready';
  const [a, b] = repair.pair.rows;
  const noPin = noPinReadyOf(repair);
  const body = executeBodyOf(repair, reviewed);
  const example = ready[0]?.rows[0];
  const sendable = body !== null && !busy;
  const moving = [
    t(`${N}rule.number`),
    t(`${N}rule.pin`),
    t(`${N}rule.photo`),
    t(`${N}rule.expiry`),
  ];
  const staying = [t(`${N}rule.name`), t(`${N}rule.car`), t(`${N}rule.balance`), t(`${N}rule.log`)];
  return (
    <DesignDialog
      open={open}
      onClose={onClose}
      title={t(`${N}confirm.title`)}
      subtitle={t(`${N}confirm.subtitle`, {
        company: t(`fleet.fuelCards.company.${repair.company}`),
        cards: count.cards(repair.counts.ready),
      })}
      icon={ICON.fix}
      width="3xl"
      panelProps={{ 'data-repair-confirm': 'true' }}
      footer={
        <>
          <button
            type="button"
            data-repair-confirm-run="true"
            disabled={!sendable}
            onClick={onConfirm}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-7 py-2.5 text-[15px] font-bold text-white shadow-[0_6px_22px_rgba(16,185,129,0.40)] transition-all hover:bg-emerald-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-500 dark:hover:bg-emerald-400"
          >
            {busy && <Spinner className="h-4 w-4" />}
            <span>{t(`${N}confirm.run`)}</span>
          </button>
          <DesignCancel onClick={onClose} label={t(`${N}confirm.back`)} />
        </>
      }
    >
      <p
        className="text-[15px] leading-relaxed text-slate-800 dark:text-slate-100"
        data-repair-confirm-lead={ready.length > 0 ? 'cycles' : 'pair'}
      >
        {ready.length > 0 && t(`${N}confirm.leadCycles`)}
        {ready.length > 0 && pairReady && ' '}
        {pairReady && a !== undefined && b !== undefined && (
          <Filled
            // Alone, the pair's sentence stands by itself — not «ويتبادل…», which continues the
            // cycles' sentence.
            template={t(ready.length > 0 ? `${N}confirm.leadPair` : `${N}confirm.leadPairOnly`)}
            values={{
              a: <span className={NUM}>{a.car}</span>,
              b: <span className={NUM}>{b.car}</span>,
            }}
          />
        )}
      </p>

      <section className="space-y-3">
        {/* Nothing of a number moves in a run of the pair alone: no count, no rules, no PIN. */}
        {ready.length > 0 && (
          <>
            <h3
              className="text-[14px] font-bold text-slate-900 dark:text-white"
              data-repair-confirm-crossed={crossed}
            >
              {t(`${N}confirm.crossed`, { cards: count.cards(crossed) })}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-3 dark:border-indigo-400/30 dark:bg-indigo-500/[0.08]">
                <p className="mb-2 text-[13px] font-bold text-indigo-800 dark:text-indigo-200">
                  {t(`${N}confirm.moves`)}
                </p>
                <span className="flex flex-wrap gap-1.5">
                  {moving.map((word) => (
                    <span
                      key={word}
                      className={cn(
                        CHIP,
                        'border-indigo-300 bg-white text-indigo-800 dark:border-indigo-400/40 dark:bg-indigo-500/10 dark:text-indigo-200',
                      )}
                    >
                      {word}
                    </span>
                  ))}
                </span>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80">
                <p className="mb-2 text-[13px] font-bold text-slate-800 dark:text-slate-100">
                  {t(`${N}rule.stays`)}
                </p>
                <span className="flex flex-wrap gap-1.5">
                  {staying.map((word) => (
                    <span
                      key={word}
                      className={cn(
                        CHIP,
                        'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
                      )}
                    >
                      {word}
                    </span>
                  ))}
                </span>
              </div>
            </div>
            <div
              data-repair-confirm-pin={noPin.join(',')}
              className="space-y-1 rounded-xl border border-indigo-200 bg-white px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-700 dark:border-indigo-400/30 dark:bg-[#0a1233]/60 dark:text-slate-200"
            >
              <p className="flex items-center gap-1.5 font-bold text-indigo-800 dark:text-indigo-200">
                <BoardIcon d={ICON.lock} className="h-3.5 w-3.5" />
                {t(`${N}rule.pinRule`)}
              </p>
              {noPin.length > 0 && (
                <p>
                  <Filled
                    template={t(
                      noPin.length === 1
                        ? `${N}confirm.noPinOne`
                        : noPin.length === 2
                          ? `${N}confirm.noPinTwo`
                          : `${N}confirm.noPin`,
                    )}
                    values={{
                      numbers: words.numbers(noPin.length),
                      cars: <span className={NUM}>{words.list(noPin)}</span>,
                    }}
                  />
                </p>
              )}
            </div>
          </>
        )}
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-[#2b3b6b]">
          <table className="w-full text-[13px]">
            <tbody className="divide-y divide-slate-200 bg-white dark:divide-[#1c293f] dark:bg-[#0a1233]/60">
              {repair.cycles.map((cycle) => (
                <tr
                  key={cycle.unit}
                  data-repair-confirm-cycle={cycle.n}
                  data-repair-confirm-state={cycle.state}
                >
                  <td className="whitespace-nowrap px-3 py-1.5 font-bold text-slate-800 dark:text-slate-100">
                    {t(`${N}cycleName`, { n: cycle.n })}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={cn(NUM, 'text-slate-600 dark:text-slate-300')}>
                      {cycle.cars.map((car, i) => (
                        <Fragment key={car}>
                          {i > 0 && (
                            <>
                              {' '}
                              <ReadArrow />{' '}
                            </>
                          )}
                          {car}
                        </Fragment>
                      ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-end">
                    {cycle.state === 'held' ? (
                      <span className="font-bold text-red-700 dark:text-red-300">
                        {t(`${N}confirm.skipped`)}
                      </span>
                    ) : cycle.state === 'done' ? (
                      <span className="font-bold text-slate-500 dark:text-slate-400">
                        {t(`${N}confirm.doneBefore`)}
                      </span>
                    ) : (
                      <span className="font-bold text-emerald-700 dark:text-emerald-300">
                        {count.cards(cycle.rows.length)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {pairReady && a !== undefined && b !== undefined && (
        <section
          data-repair-confirm-pair="true"
          className="space-y-2 rounded-xl border border-cyan-300 bg-cyan-50/70 px-4 py-3 dark:border-cyan-500/30 dark:bg-cyan-500/[0.07]"
        >
          <h3 className="flex items-center gap-1.5 text-[14px] font-bold text-cyan-900 dark:text-cyan-100">
            <BoardIcon d={ICON.swap} className="h-4 w-4" />
            {t(`${N}confirm.pairTitle`)}
          </h3>
          <p className="text-[13px] leading-relaxed text-cyan-900 dark:text-cyan-100">
            {t(`${N}confirm.pairBody`)}
          </p>
          <span className="grid gap-1.5 text-[13px] sm:grid-cols-2">
            {[a, b].map((row) => (
              <span
                key={row.car}
                className="flex flex-wrap items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-2.5 py-1.5 dark:border-cyan-500/30 dark:bg-[#0a1233]/70"
              >
                <Filled
                  template={t(`${N}confirm.pairCar`)}
                  values={{ car: <CarCode code={row.car} /> }}
                />{' '}
                ·
                <Masked prefix={row.numberPrefix} last4={row.numberLast4} size="sm" />
                <span className="ms-auto">
                  <Signed value={row.delta} />
                </span>
              </span>
            ))}
          </span>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-[14px] font-bold text-slate-900 dark:text-white">
          {t(`${N}confirm.onRun`)}
        </h3>
        <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
          <li className="flex items-start gap-2">
            <BoardIcon d={ICON.cycle} className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
            {t(`${N}confirm.once`)}
          </li>
          <li className="flex items-start gap-2">
            <BoardIcon d={ICON.shield} className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
            {t(`${N}confirm.audit`)}
          </li>
          <li className="flex items-start gap-2">
            <BoardIcon d={ICON.card} className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span>
              <Filled
                template={t(`${N}confirm.logLine`)}
                values={{
                  example: (
                    <b
                      className="text-indigo-800 dark:text-indigo-200"
                      data-repair-confirm-example="true"
                    >
                      «
                      {example !== undefined ? (
                        <Filled
                          template={t('fleet.fuelCards.history.dataFix.number')}
                          values={{
                            before: <Dots last4={example.numberBeforeLast4} />,
                            after: <Dots last4={example.numberAfterLast4} />,
                          }}
                        />
                      ) : a !== undefined ? (
                        t('fleet.fuelCards.history.dataFix.nameSwap', {
                          before: a.nameBefore,
                          after: a.nameAfter,
                          from: money(a.openingBefore),
                          to: money(a.openingAfter),
                        })
                      ) : null}
                      »
                    </b>
                  ),
                }}
              />
            </span>
          </li>
          <li className="flex items-start gap-2">
            <BoardIcon d={ICON.money} className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
            {t(`${N}confirm.balances`)}
          </li>
        </ul>
      </section>

      <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[14px] font-bold text-slate-800 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80 dark:text-slate-100">
        <input
          type="checkbox"
          data-repair-reviewed="true"
          checked={reviewed}
          onChange={(e) => onReviewed(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900"
        />
        {t(`${N}confirm.reviewed`)}
      </label>
    </DesignDialog>
  );
};
