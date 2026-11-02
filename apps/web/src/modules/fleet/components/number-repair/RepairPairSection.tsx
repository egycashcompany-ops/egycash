// «تصحيح أرقام الكروت» (6d) — the 0849 pair, as the approved sample draws it (03): both numbers end
// 0849, so each is told apart by its car. Number, car, photo, expiry and PIN stay; the two records
// swap the NAME and the go-live OPENING balance, and each balance moves by the opening's difference
// (530 −11,872.62 · 283 +11,872.62 — a balance may go below zero, in red). Under them: the company
// sheet's adjustments on either record since go-live (matched by name, so the other card's figure),
// the 6c lock on their balance ✓ until this runs, and — for the record whose go-live statement
// figure differs from its new opening — the «بديل» note.
import {
  type FleetFuelNumberRepairPairDto,
  type FleetFuelNumberRepairPairRowDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { cn } from '../../../../shared/lib/cn';
import { BoardIcon, NUM } from '../FuelCardBoard';
import { MOVES_CHIP, SECTION_CARD, SECTION_STRIP } from '../custody-board-looks';
import { TITLE } from '../custody-dashboard-parts';
import { FileName, Filled } from '../fuel-reconcile/reconcile-cells';
import { changedCarsOf, pairBalancesOf, statementDiffers } from '../../lib/fuel-number-repair';
import { N } from '../../lib/fuel-number-repair-words';
import { useReconcileCount } from '../../lib/fuel-reconcile-words';
import { COL_HEAD, PAIR_GRID, PHONE_LABEL } from './repair-looks';
import {
  BeforeAfter,
  CarBox,
  CarCode,
  DateText,
  ICON,
  Masked,
  Money,
  PinNote,
  ReadArrow,
  Signed,
  StateChip,
  Tag,
  cairoYmdOf,
  ymdOf,
} from './repair-parts';
import { ChangeLines, LogButton, TopUpsLine } from './RepairCycleSection';
import { RepairThumb } from './RepairThumb';

const Ltr = ({ children }: { children: string }): JSX.Element => (
  <span dir="ltr" className={NUM}>
    {children}
  </span>
);

const PairRow = ({
  row,
  done,
  onLog,
}: {
  row: FleetFuelNumberRepairPairRowDto;
  done: boolean;
  onLog: (cardId: string) => void;
}): JSX.Element => {
  const t = useT();
  const balances = pairBalancesOf(row, done);
  const differs = statementDiffers(row);
  return (
    <article
      data-repair-row={row.car}
      data-repair-row-state={row.state}
      className={cn(
        'px-4 py-3',
        row.state === 'changed' && 'bg-red-50/60 dark:bg-red-500/[0.05]',
        row.state === 'held' && 'bg-amber-50/40 dark:bg-amber-500/[0.03]',
      )}
    >
      <div className={cn('flex flex-col gap-3', PAIR_GRID)}>
        <div className="flex flex-wrap items-start gap-3 lg:contents">
          <div className="lg:flex lg:justify-center">
            <CarBox code={row.car} tone={row.state === 'changed' ? 'amber' : 'emerald'} />
          </div>
          <div className="flex flex-col items-start gap-1.5">
            <span className={PHONE_LABEL}>{t(`${N}phone.numberStays`)}</span>
            <Masked prefix={row.numberPrefix} last4={row.numberLast4} />
            <span className="flex flex-wrap items-center gap-1">
              <Tag tone="slate">{t(`${N}stays`)}</Tag>
              {row.hasPin && <PinNote />}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              <Filled
                template={t(`${N}pair.expires`)}
                values={{ date: <DateText day={row.expiry} tone="same" /> }}
              />
            </span>
          </div>
          <div className="flex flex-col items-start gap-1 lg:items-center">
            <span className={PHONE_LABEL}>{t(`${N}phone.photoStays`)}</span>
            <RepairThumb photo={row.photo} verdict="ok" />
          </div>
        </div>

        <div className="flex flex-col items-start gap-1.5">
          <span className={PHONE_LABEL}>{t(`${N}col.name`)}</span>
          <BeforeAfter
            done={done}
            now={
              <span
                dir="ltr"
                className="whitespace-nowrap font-figures text-[14px] font-bold text-slate-400 line-through decoration-red-400/80 decoration-2 dark:text-slate-500"
              >
                {row.nameBefore}
              </span>
            }
            after={
              <span
                dir="ltr"
                data-repair-name={row.car}
                className="whitespace-nowrap font-figures text-[15px] font-bold text-emerald-700 dark:text-emerald-300"
              >
                {row.nameAfter}
              </span>
            }
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            <Filled
              template={t(`${N}pair.embossed`)}
              values={{ car: <CarCode code={row.car} /> }}
            />
          </span>
        </div>

        <div className="flex flex-col items-start gap-1.5">
          <span className={PHONE_LABEL}>{t(`${N}col.balance`)}</span>
          <span className="inline-grid grid-cols-[auto_auto_auto_auto] items-center gap-x-1.5 gap-y-1 text-[12px]">
            <span className="font-semibold text-slate-500 dark:text-slate-400">
              {t(`${N}pair.opening`)}
            </span>
            <Money value={row.openingBefore} struck className="text-[13px]" />
            <ReadArrow className="text-slate-400" />
            <Money
              value={row.openingAfter}
              className="text-[14px] text-emerald-700 dark:text-emerald-300"
            />
            <span className="font-semibold text-slate-500 dark:text-slate-400">
              {t(done ? `${N}pair.balanceDone` : `${N}pair.balanceNow`)}
            </span>
            <Money value={balances.before} struck className="text-[13px]" />
            <ReadArrow className="text-slate-400" />
            <span data-repair-balance-after={row.car}>
              <Money
                value={balances.after}
                className="text-[14px] text-slate-900 dark:text-white"
              />
            </span>
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {t(`${N}pair.delta`)} <Signed value={row.delta} className="text-[12px]" />
          </span>
          <span
            className="flex flex-col items-start text-[11px] text-slate-500 dark:text-slate-400"
            data-repair-statement={row.car}
          >
            <span className="whitespace-nowrap">
              <Filled
                template={t(`${N}pair.statement`)}
                values={{
                  day: <Ltr>{ymdOf(row.statementDay)}</Ltr>,
                  amount: (
                    <Money
                      value={row.statementOpening}
                      className={cn(
                        'text-[12px]',
                        differs
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    />
                  ),
                }}
              />
            </span>
            <span>
              {t(
                !differs
                  ? `${N}pair.statementSame`
                  : done
                    ? `${N}pair.statementDiffersDone`
                    : `${N}pair.statementDiffers`,
              )}
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 lg:flex-col lg:justify-center">
          <span className={PHONE_LABEL}>{t(done ? `${N}col.result` : `${N}col.check`)}</span>
          <StateChip state={row.state} pair />
          {done && row.cardId !== null && (
            <LogButton cardId={row.cardId} onLog={() => onLog(row.cardId ?? '')} />
          )}
        </div>
      </div>
      {row.state === 'changed' && <ChangeLines car={row.car} changes={row.changes} pair />}
      {!done && <TopUpsLine car={row.car} topUps={row.topUps} more={row.topUpsMore} />}
    </article>
  );
};

export const RepairPairSection = ({
  pair,
  onLog,
}: {
  pair: FleetFuelNumberRepairPairDto;
  onLog: (cardId: string) => void;
}): JSX.Element => {
  const t = useT();
  const count = useReconcileCount();
  const done = pair.state === 'done';
  const [a, b] = pair.rows;
  const stopped = changedCarsOf(pair.rows);
  const ok = pair.rows.filter((row) => row.state === 'ok').length;
  /** The record whose opening would differ if the owner opened it at the statement figure. */
  const alt = pair.rows.find((row) => statementDiffers(row));
  const carOf = (cardId: string): string =>
    pair.rows.find((row) => row.cardId === cardId)?.car ?? '—';
  return (
    <section className={SECTION_CARD} data-repair-pair={pair.state}>
      <div className={SECTION_STRIP}>
        <span className="flex flex-wrap items-center gap-3">
          <span className="rounded-lg bg-cyan-500/10 p-1.5 text-cyan-700 dark:text-cyan-300">
            <BoardIcon d={ICON.swap} className="h-4 w-4" />
          </span>
          <h2 className={TITLE}>{t(`${N}pair.title`)}</h2>
          <span className={MOVES_CHIP}>{count.cards(pair.rows.length)}</span>
        </span>
        {done ? (
          <Tag tone="emerald" icon={ICON.ok} data-repair-pair-tag="done">
            {t(`${N}pair.done`)}
          </Tag>
        ) : pair.state === 'held' ? (
          <Tag tone="red" icon={ICON.warn} data-repair-pair-tag="held">
            {stopped.length > 1
              ? t(`${N}pair.heldBoth`)
              : t(`${N}pair.held`, { car: stopped[0] ?? '—' })}
          </Tag>
        ) : (
          <Tag tone="emerald" icon={ICON.ok} data-repair-pair-tag="ready">
            {t(`${N}pair.ok`, { ok, all: pair.rows.length })}
          </Tag>
        )}
      </div>
      {!done && (
        <p className="border-b border-slate-200 px-4 py-2.5 text-[12px] leading-relaxed text-slate-600 dark:border-[#1c293f] dark:text-slate-300">
          {t(`${N}pair.explain`)}
        </p>
      )}
      <div className={cn(COL_HEAD, PAIR_GRID)}>
        <span className="text-center">{t(`${N}col.car`)}</span>
        <span>{t(`${N}col.number`)}</span>
        <span className="text-center">{t(`${N}col.photoPair`)}</span>
        <span>{t(`${N}col.name`)}</span>
        <span>{t(`${N}col.balance`)}</span>
        <span className="text-center">{t(done ? `${N}col.result` : `${N}col.check`)}</span>
      </div>
      <div className="bg-white dark:bg-[#0d1424]/85">
        {a !== undefined && <PairRow row={a} done={done} onLog={onLog} />}
        <div className="flex items-center gap-2 border-y border-dashed border-cyan-300 bg-cyan-50/60 px-4 py-1.5 text-[12px] font-bold text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/[0.06] dark:text-cyan-200">
          <BoardIcon d={ICON.swap} className="h-3.5 w-3.5" />
          {t(done ? `${N}pair.done` : `${N}pair.swapStrip`)}
        </div>
        {b !== undefined && <PairRow row={b} done={done} onLog={onLog} />}
      </div>
      {!done && (
        <div className="space-y-1 border-t border-slate-200 px-4 py-2.5 text-[12px] text-slate-600 dark:border-[#1c293f] dark:text-slate-300">
          {pair.sheetAdjustments.length === 0 ? (
            <p className="flex items-center gap-1.5" data-repair-sheet-adjust="none">
              <BoardIcon
                d={ICON.ok}
                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
              />
              {t(`${N}pair.adjustNone`)}
            </p>
          ) : (
            <div
              className="space-y-1 rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2 dark:border-violet-500/30 dark:bg-violet-500/[0.06]"
              data-repair-sheet-adjust={pair.sheetAdjustments.length}
            >
              <p className="flex items-center gap-1.5 font-bold text-violet-800 dark:text-violet-200">
                <BoardIcon d={ICON.warn} className="h-3.5 w-3.5" />
                {t(`${N}pair.adjustSome`)}
              </p>
              <ul className="space-y-0.5">
                {pair.sheetAdjustments.map((adjust) => (
                  <li
                    key={adjust.movementId}
                    data-repair-sheet-adjust-line={adjust.movementId}
                    className="flex flex-wrap items-center gap-x-2"
                  >
                    <Filled
                      template={t(`${N}pair.adjustItem`)}
                      values={{
                        car: (
                          <CarCode code={adjust.car === '' ? carOf(adjust.cardId) : adjust.car} />
                        ),
                        at: <Ltr>{cairoYmdOf(adjust.at)}</Ltr>,
                        amount: <Signed value={adjust.amount} className="text-[12px]" />,
                        balance: <Money value={adjust.balanceAfter} className="text-[12px]" />,
                        file: <FileName name={adjust.fileName} className="font-semibold" />,
                      }}
                    />
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-violet-800/90 dark:text-violet-200/80">
                {t(`${N}pair.adjustNote`)}
              </p>
            </div>
          )}
          <p className="flex items-center gap-1.5">
            <BoardIcon d={ICON.lock} className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            {t(`${N}pair.lock`)}
          </p>
          {alt !== undefined && (
            <p
              data-repair-pair-alt={alt.car}
              className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/[0.07] dark:text-amber-100"
            >
              <BoardIcon
                d={ICON.warn}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
              <span>
                <b>{t(`${N}pair.alt`)}</b>{' '}
                <Filled
                  template={t(`${N}pair.altBody`)}
                  values={{
                    car: <CarCode code={alt.car} />,
                    day: <Ltr>{ymdOf(alt.statementDay)}</Ltr>,
                    statement: <Money value={alt.statementOpening} className="text-[12px]" />,
                    opening: <Money value={alt.openingAfter} className="text-[12px]" />,
                  }}
                />
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
};
