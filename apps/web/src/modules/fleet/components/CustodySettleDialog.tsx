// «تسوية العهدة» — the licensing memos not settled yet («مصروفات التراخيص»), picked with «علامة
// صح»: what they add up to leaves «إجمالي العهدة», and his «تسويه عهدة» letter says so.
//
// One line per licensing MEMO: a record that holds a renewal and an extension is two lines, settled
// apart. Every line is ticked when the dialog opens. «البيان» is the memo's kind and cars, then its
// cars' codes (five fit; a longer list shows four and how many more); «المبلغ» its total with the
// card's and the cash part under it. The eye shows the memo itself, from the record the custody
// router sent — no licensing grant is needed to look at it.
//
// The fund may go below zero: a settlement larger than the fund is allowed (decision 3), and the
// fund after it is shown in red.
import { useState } from 'react';
import { type FleetCustodySettleCandidateDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { MissingFieldsBanner, useRequiredFields } from '../../../shared/ui/required-fields';
import { Spinner } from '../../../shared/ui/Spinner';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { EyeIcon } from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { useCustodyFundSummary, useSettleCandidates, useSettleCustody } from '../api/fleet-queries';
import {
  codesShown,
  freshLetterHead,
  fundAfter,
  letterPeriod,
  periodInOrder,
  settleBody,
  settlePartKey,
  sumMoney,
  toggled,
  type LetterHead,
} from '../lib/custody-fund-forms';
import { memoHtml, memoTitle, memosOf } from '../lib/license-expense-memo';
import { useCustodyCount } from '../lib/custody-words';
import { DesignCancel, DesignDialog, DesignSave, DesignSection } from './DesignDialog';
import { MONO } from './FuelCardDialog';
import { PATH } from './FuelCardBoard';
import { CUSTODY_OPS } from './CustodyFundActions';
import { ACTION_GROUP, actionTone } from './row-actions-look';
import { useCount } from './custody-dashboard-parts';
import {
  CountChip,
  Day,
  FORM_TABLE,
  FORM_TABLE_WRAP,
  FORM_TBODY,
  FORM_THEAD,
  LEFT_ROW,
  Money,
  PICKED_ROW,
  PrintButton,
  SectionHead,
  Tick,
} from './custody-memo-parts';
import {
  DialogButtons,
  FundResult,
  LetterFields,
  ListNote,
  useFigure,
  useFigureLine,
  useFundOperation,
} from './custody-fund-form-parts';

/** A renewal in sky, an extension in violet — the licensing memos' two kinds. */
export const LICENCE_PILL = {
  renewal: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  extension: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
} as const;
export const LICENCE_DOT = { renewal: 'bg-sky-400', extension: 'bg-violet-400' } as const;

/** The memo the eye shows: the record's part, as «مصروفات التراخيص» draws it. */
const partMemo = (candidate: FleetCustodySettleCandidateDto) =>
  memosOf(candidate.expense).find((memo) => memo.kind === candidate.part) ?? null;

export const CustodySettleDialog = ({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null => {
  const t = useT();
  const figure = useFigure();
  const figureLine = useFigureLine();
  const { count, form } = useCustodyCount();
  const cars = useCount();
  const fund = useCustodyFundSummary(open);
  const candidates = useSettleCandidates(open);
  const settle = useSettleCustody();
  const [head, setHead] = useState<LetterHead>(() => freshLetterHead());
  // The parts taken OUT — every part starts ticked.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  // The licensing memo shown over the dialog.
  const [viewing, setViewing] = useState<FleetCustodySettleCandidateDto | null>(null);

  const parts = candidates.data?.parts ?? [];
  const picked = parts.filter((part) => !unticked.has(settlePartKey(part)));
  const total = sumMoney(picked.map((part) => part.total));
  const all = parts.length > 0 && picked.length === parts.length;
  const some = picked.length > 0 && !all;
  const before = fund.data?.fundTotal ?? candidates.data?.fundTotal ?? 0;
  const after = fundAfter(before, -total);
  const period = letterPeriod(
    head,
    picked.map((part) => part.date),
  );

  const required = useRequiredFields(
    [
      { key: 'parts', label: t('fleet.custody.fundForm.required.parts'), ok: picked.length > 0 },
      // «إلى» before «من» is refused by the server naming no field: «إلى» says it here instead.
      {
        key: 'period',
        label: t('fleet.custody.fundForm.required.period'),
        ok: periodInOrder(period),
      },
    ],
    open,
  );
  const { run, busy } = useFundOperation({
    mutation: settle,
    letter: 'settle',
    done: t('fleet.custody.fundForm.settle.done'),
    taken: t('fleet.custody.fundForm.settle.taken'),
    onDone: onClose,
    onTaken: () => {
      void candidates.refetch();
      void fund.refetch();
    },
  });
  const send = (print: boolean): void =>
    run(
      settleBody({
        date: head.date,
        period,
        parts: picked.map(({ expenseId, part }) => ({ expenseId, part })),
      }),
      print,
    );
  const shown = viewing === null ? null : partMemo(viewing);

  const list = (): JSX.Element => {
    if (candidates.isLoading) {
      return (
        <ListNote>
          <Spinner className="mx-auto h-5 w-5" />
        </ListNote>
      );
    }
    if (candidates.isError) {
      return <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} />;
    }
    if (parts.length === 0) {
      return <ListNote>{t('fleet.custody.fundForm.settle.empty')}</ListNote>;
    }
    return (
      <div
        className={cn(
          FORM_TABLE_WRAP,
          required.isMissing('parts') &&
            'border-red-400 ring-2 ring-red-400/40 dark:border-red-500',
        )}
        {...(required.isMissing('parts') ? { 'data-field-missing': 'true' } : {})}
      >
        <table className={FORM_TABLE} data-memo-settle-list="true">
          <thead className={FORM_THEAD}>
            <tr>
              <th className="w-12">
                <Tick
                  on={all}
                  partly={some}
                  label={
                    all
                      ? t('fleet.custody.fundForm.untickAll')
                      : t('fleet.custody.fundForm.tickAll')
                  }
                  onClick={() => setUnticked(all ? new Set(parts.map(settlePartKey)) : new Set())}
                  data-memo-settle-tick-all="true"
                />
              </th>
              <th>{t('fleet.licenseExpenses.date')}</th>
              <th>{t('fleet.custody.fundForm.settle.statement')}</th>
              <th className="hidden sm:table-cell">{t('fleet.custody.fundForm.settle.amount')}</th>
              <th
                className="hidden w-14 sm:table-cell"
                aria-label={t('fleet.licenseExpenses.view')}
              />
            </tr>
          </thead>
          <tbody className={FORM_TBODY}>
            {parts.map((part) => {
              const key = settlePartKey(part);
              const on = !unticked.has(key);
              const codes = codesShown(part.codes);
              const pill = t('fleet.custody.fundForm.settle.pill', {
                kind: t(`fleet.custody.fundForm.settle.kind.${part.part}`),
                cars: cars.count('car', part.cars),
              });
              return (
                <tr key={key} className={on ? PICKED_ROW : LEFT_ROW} data-memo-settle-row={key}>
                  <td>
                    <Tick
                      on={on}
                      label={t('fleet.custody.fundForm.settle.tickOne', { memo: pill })}
                      onClick={() => setUnticked((held) => toggled(held, key))}
                      data-memo-settle-tick={key}
                    />
                  </td>
                  <td>
                    <Day day={part.date} />
                  </td>
                  <td className="!text-start">
                    <span className="flex flex-col items-start gap-1">
                      <span
                        data-memo-settle-part={part.part}
                        className={cn(
                          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm leading-5',
                          LICENCE_PILL[part.part],
                        )}
                      >
                        <i className={cn('h-1.5 w-1.5 rounded-full', LICENCE_DOT[part.part])} />
                        {pill}
                      </span>
                      {/* A phone has no room for the amount's own column: it rides under. */}
                      <span className="sm:hidden">
                        <Money value={part.total} unit="wide" />
                      </span>
                      <span className="hidden flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-slate-500 sm:flex dark:text-slate-400">
                        <span
                          className={cn(MONO, 'inline-flex items-center gap-1 whitespace-nowrap')}
                          data-memo-settle-codes={key}
                        >
                          {codes.shown.map((code, index) => (
                            <span
                              key={`${code}:${index}`}
                              className="inline-flex items-center gap-1"
                            >
                              {index > 0 && <span aria-hidden="true">·</span>}
                              <bdi>{code}</bdi>
                            </span>
                          ))}
                        </span>
                        {codes.more > 0 && (
                          <span
                            data-memo-settle-more={codes.more}
                            className="whitespace-nowrap rounded bg-slate-200/80 px-1.5 py-px text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
                          >
                            {t(`fleet.custody.fundForm.settle.moreCars.${form(codes.more)}`, {
                              count: codes.more,
                            })}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td className="hidden sm:table-cell">
                    <span className="flex flex-col items-center gap-0.5">
                      <Money value={part.total} />
                      <span className="whitespace-nowrap text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        {t('fleet.custody.fundForm.settle.visa')}{' '}
                        <span dir="ltr" className={MONO}>
                          {figure(part.visaTotal)}
                        </span>{' '}
                        · {t('fleet.custody.fundForm.settle.cash')}{' '}
                        <span dir="ltr" className={MONO}>
                          {figure(part.cashTotal)}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="hidden sm:table-cell">
                    <span className={ACTION_GROUP}>
                      <button
                        type="button"
                        title={t('fleet.licenseExpenses.view')}
                        aria-label={t('fleet.licenseExpenses.view')}
                        className={actionTone('view')}
                        onClick={() => setViewing(part)}
                        data-memo-settle-view={key}
                      >
                        <EyeIcon className="h-4 w-4" />
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <DesignDialog
        open={open}
        // While a memo is shown over it, the dialog stays: its Escape is the memo's.
        onClose={viewing === null ? onClose : () => undefined}
        title={t('fleet.custody.actions.settle')}
        subtitle={t('fleet.custody.fundForm.settle.subtitle')}
        icon={CUSTODY_OPS.settle.icon}
        width="3xl"
        panelProps={{ 'data-memo-settle': 'true' }}
        footer={
          <DialogButtons
            save={
              <DesignSave
                label={t('fleet.custody.fundForm.settle.save')}
                busy={busy}
                onClick={required.guard(() => send(false))}
                data-memo-settle-save="true"
              />
            }
            print={
              <PrintButton
                label={t('fleet.custody.fundForm.savePrint')}
                busy={busy}
                onClick={required.guard(() => send(true))}
                data-memo-settle-print="true"
              />
            }
            cancel={<DesignCancel onClick={onClose} />}
          />
        }
      >
        <MissingFieldsBanner missing={required.missing} attempt={required.attempt} />
        <DesignSection title={t('fleet.custody.fundForm.letter.section')} icon={PATH.calendar}>
          <LetterFields
            date={head.date}
            from={period.from}
            to={period.to}
            onChange={(patch) => setHead((held) => ({ ...held, ...patch }))}
            periodMissing={required.isMissing('period')}
          />
        </DesignSection>

        <section className="space-y-3">
          <SectionHead
            title={t('fleet.custody.fundForm.settle.list')}
            icon={PATH.card}
            end={
              candidates.data === undefined ? undefined : (
                <CountChip>{count('memo', parts.length)}</CountChip>
              )
            }
          />
          {list()}
          <div
            data-memo-settle-selected="true"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-[#2b3b6b] dark:bg-[#0a1233]/80"
          >
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              {t('fleet.custody.fundForm.settle.selected', { memos: count('memo', picked.length) })}
            </span>
            <Money value={total} className="text-base font-bold" />
          </div>
        </section>

        <FundResult
          tone="emerald"
          data-memo-settle-result="true"
          line={figureLine('fleet.custody.fundForm.settle.result', {
            amount: figure(total),
            after: figure(after),
          })}
          before={before}
          change={-total}
          after={after}
          changeLabel={t('fleet.custody.fundForm.settle.change')}
        />
      </DesignDialog>
      <Dialog
        open={shown !== null}
        onClose={() => setViewing(null)}
        size="xl"
        title={t('fleet.licenseExpenses.view')}
        description={shown === null ? '' : memoTitle(shown)}
        footer={
          <Button variant="secondary" onClick={() => setViewing(null)}>
            {t('common.close')}
          </Button>
        }
      >
        <div className="max-h-[70vh] overflow-auto rounded-lg bg-slate-200 p-3 dark:bg-slate-800">
          {shown !== null && (
            <div className="mx-auto w-[640px] max-w-full overflow-hidden rounded shadow-xl">
              <div
                data-memo-settle-preview={viewing === null ? '' : settlePartKey(viewing)}
                className="origin-top-right"
                style={{ zoom: 0.8, width: '210mm' }}
                dangerouslySetInnerHTML={{ __html: memoHtml(shown) }}
              />
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
};
